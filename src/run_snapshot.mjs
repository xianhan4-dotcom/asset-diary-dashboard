import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writePortableWorkbook } from "./write_workbook.mjs";
import { writeDashboardData } from "./write_dashboard_data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const CATEGORY_ORDER = [
  "稳定低风险资产",
  "高风险资产",
  "较高风险资产",
  "极高风险资产",
];

const DEFAULT_COLORS = {
  "稳定低风险资产": "#00A3E0",
  "高风险资产": "#F59E0B",
  "较高风险资产": "#92400E",
  "极高风险资产": "#DC2626",
};

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveWorkspace(relativeOrAbsolute) {
  if (!relativeOrAbsolute) return relativeOrAbsolute;
  if (path.isAbsolute(relativeOrAbsolute)) return relativeOrAbsolute;
  const normalized = String(relativeOrAbsolute).replace(/\\/g, "/");
  const standalonePath = normalized.startsWith("asset-diary/")
    ? normalized.slice("asset-diary/".length)
    : normalized;
  return path.join(projectRoot, standalonePath);
}

function env(name) {
  return name ? process.env[name] : undefined;
}

function isoDateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function localTimeInTimezone(date, timezone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function appendJsonl(filePath, value) {
  await ensureParent(filePath);
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJsonl(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function normalizeAddress(address) {
  return String(address || "").toLowerCase();
}

function strip0x(value) {
  return String(value || "").replace(/^0x/i, "");
}

function padAddress(address) {
  return strip0x(address).padStart(64, "0");
}

function parseHexQuantity(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function formatUnits(value, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const padded = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return padded ? `${whole}.${padded}` : whole.toString();
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : {};
}

async function rpcCall(rpcUrl, method, params) {
  const payload = {
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params,
  };
  const result = await fetchJson(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (result.error) throw new Error(`RPC ${method}: ${JSON.stringify(result.error)}`);
  return result.result;
}

async function getNativeBalance(rpcUrl, address, decimals) {
  const hex = await rpcCall(rpcUrl, "eth_getBalance", [address, "latest"]);
  return toNumber(formatUnits(parseHexQuantity(hex), decimals));
}

async function getErc20Balance(rpcUrl, token, address) {
  const data = `0x70a08231${padAddress(address)}`;
  const hex = await rpcCall(rpcUrl, "eth_call", [
    { to: token.contract, data },
    "latest",
  ]);
  return toNumber(formatUnits(parseHexQuantity(hex), token.decimals));
}

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function hmacBase64(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64");
}

async function getBinanceBalances(exchange) {
  const apiKey = env(exchange.apiKeyEnv);
  const apiSecret = env(exchange.apiSecretEnv);
  if (!apiKey || !apiSecret) {
    throw new Error(`${exchange.id}: missing Binance API key or secret env`);
  }
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = hmacHex(apiSecret, query);
  const url = `https://api.binance.com/api/v3/account?${query}&signature=${signature}`;
  const data = await fetchJson(url, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  return (data.balances || [])
    .map((item) => ({
      sourceId: exchange.id,
      sourceLabel: exchange.label || exchange.id,
      venue: "binance",
      symbol: item.asset,
      quantity: toNumber(item.free) + toNumber(item.locked),
    }))
    .filter((item) => item.quantity > 0);
}

async function getOkxBalances(exchange) {
  const apiKey = env(exchange.apiKeyEnv);
  const apiSecret = env(exchange.apiSecretEnv);
  const passphrase = env(exchange.passphraseEnv);
  if (!apiKey || !apiSecret || !passphrase) {
    throw new Error(`${exchange.id}: missing OKX API key, secret, or passphrase env`);
  }
  const timestamp = new Date().toISOString();
  const method = "GET";
  const requestPath = "/api/v5/account/balance";
  const signature = hmacBase64(apiSecret, `${timestamp}${method}${requestPath}`);
  const data = await fetchJson(`https://www.okx.com${requestPath}`, {
    headers: {
      "OK-ACCESS-KEY": apiKey,
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": passphrase,
    },
  });
  const details = data?.data?.flatMap((account) => account.details || []) || [];
  return details
    .map((item) => ({
      sourceId: exchange.id,
      sourceLabel: exchange.label || exchange.id,
      venue: "okx",
      symbol: item.ccy,
      quantity: toNumber(item.cashBal || item.eq || item.availBal),
    }))
    .filter((item) => item.quantity > 0);
}

function tokenKey(token) {
  if (token.chain && token.contract) return `${token.chain}:${normalizeAddress(token.contract)}`;
  if (token.coingeckoId) return `cg:${token.coingeckoId}`;
  return `symbol:${String(token.symbol).toUpperCase()}`;
}

function buildTokenRegistry(config) {
  const registry = new Map();
  for (const token of config.trackedTokens || []) {
    registry.set(tokenKey(token), token);
    registry.set(`symbol:${String(token.symbol).toUpperCase()}`, token);
  }
  for (const manual of config.manualHoldings || []) {
    const symbolKey = `symbol:${String(manual.symbol).toUpperCase()}`;
    if (!registry.has(symbolKey)) registry.set(symbolKey, manual);
  }
  return registry;
}

async function getCoinGeckoMarketData(token, config) {
  const headers = {};
  const apiKey = env("ASSET_DIARY_COINGECKO_API_KEY");
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;
  const chain = token.chain ? config.chains?.[token.chain] : null;
  let url = null;
  if (token.coingeckoId) {
    url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(token.coingeckoId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  } else if (chain?.assetPlatformId && token.contract) {
    url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(chain.assetPlatformId)}/contract/${normalizeAddress(token.contract)}`;
  }
  if (!url) return null;
  const data = await fetchJson(url, { headers });
  const market = data.market_data || {};
  return {
    priceUsd: market.current_price?.usd ?? null,
    fdvUsd: market.fully_diluted_valuation?.usd ?? null,
    marketCapUsd: market.market_cap?.usd ?? null,
    priceSource: "coingecko",
  };
}

async function getBinancePublicPrice(symbol) {
  const upper = String(symbol).toUpperCase();
  if (["USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD", "USDE", "USD"].includes(upper)) {
    return 1;
  }
  const quotePairs = [`${upper}USDT`, `${upper}USDC`];
  for (const pair of quotePairs) {
    try {
      const data = await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
      const price = toNumber(data.price, null);
      if (price) return price;
    } catch {
      // Try next quote pair.
    }
  }
  return null;
}

async function resolveMarketData(token, config, cache) {
  const key = tokenKey(token);
  if (cache.has(key)) return cache.get(key);
  const stable = Boolean(token.stable) || isStableSymbol(token.symbol);
  let data = {
    priceUsd: token.priceUsd ?? (stable ? 1 : null),
    fdvUsd: token.fdvUsd ?? null,
    marketCapUsd: token.marketCapUsd ?? null,
    priceSource: token.priceUsd ? "config" : stable ? "stable-peg" : "unresolved",
  };
  if (data.priceUsd === null || data.fdvUsd === null) {
    try {
      const cgData = await getCoinGeckoMarketData(token, config);
      if (cgData) {
        data = {
          ...data,
          priceUsd: data.priceUsd ?? cgData.priceUsd,
          fdvUsd: data.fdvUsd ?? cgData.fdvUsd,
          marketCapUsd: data.marketCapUsd ?? cgData.marketCapUsd,
          priceSource: cgData.priceSource,
        };
      }
    } catch (error) {
      data.priceError = error.message;
    }
  }
  if (data.priceUsd === null) {
    const binancePrice = await getBinancePublicPrice(token.symbol);
    if (binancePrice !== null) {
      data.priceUsd = binancePrice;
      data.priceSource = "binance-public";
    }
  }
  cache.set(key, data);
  cache.set(`symbol:${String(token.symbol).toUpperCase()}`, data);
  return data;
}

function isStableSymbol(symbol) {
  return ["USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD", "USDE", "USD"].includes(
    String(symbol || "").toUpperCase(),
  );
}

function classifyAsset(asset, config) {
  const stable = Boolean(asset.stable) || isStableSymbol(asset.symbol);
  if (stable) {
    return {
      category: config.riskRules?.stable?.label || "稳定低风险资产",
      color: config.riskRules?.stable?.color || DEFAULT_COLORS["稳定低风险资产"],
      reason: "stablecoin",
    };
  }
  const fdv = toNumber(asset.fdvUsd, null);
  if (fdv !== null && fdv >= 10000000000) {
    return {
      category: config.riskRules?.fdvGte10B?.label || "高风险资产",
      color: config.riskRules?.fdvGte10B?.color || DEFAULT_COLORS["高风险资产"],
      reason: "FDV >= 10B",
    };
  }
  if (fdv !== null && fdv >= 1000000000) {
    return {
      category: config.riskRules?.fdvGte1B?.label || "较高风险资产",
      color: config.riskRules?.fdvGte1B?.color || DEFAULT_COLORS["较高风险资产"],
      reason: "1B <= FDV < 10B",
    };
  }
  return {
    category: config.riskRules?.fdvLt1B?.label || "极高风险资产",
    color: config.riskRules?.fdvLt1B?.color || DEFAULT_COLORS["极高风险资产"],
    reason: fdv === null ? "FDV missing; conservative bucket" : "FDV < 1B",
  };
}

async function collectWalletHoldings(config) {
  const holdings = [];
  for (const wallet of config.wallets || []) {
    if (!wallet.enabled) continue;
    const chain = config.chains?.[wallet.chain];
    if (!chain) throw new Error(`${wallet.id}: unknown chain ${wallet.chain}`);
    const rpcUrl = env(chain.rpcEnv);
    if (!rpcUrl) throw new Error(`${wallet.id}: missing RPC env ${chain.rpcEnv}`);
    for (const token of config.trackedTokens || []) {
      if (token.chain !== wallet.chain) continue;
      const quantity = token.native
        ? await getNativeBalance(rpcUrl, wallet.address, token.decimals)
        : await getErc20Balance(rpcUrl, token, wallet.address);
      if (quantity <= 0) continue;
      holdings.push({
        sourceId: wallet.id,
        sourceLabel: wallet.label || wallet.id,
        venue: "onchain",
        chain: wallet.chain,
        address: wallet.address,
        symbol: token.symbol,
        tokenName: token.name || token.symbol,
        contract: token.contract || null,
        quantity,
        stable: token.stable,
        decimals: token.decimals,
        coingeckoId: token.coingeckoId,
      });
    }
  }
  return holdings;
}

async function collectExchangeHoldings(config) {
  const holdings = [];
  for (const exchange of config.exchanges || []) {
    if (!exchange.enabled) continue;
    if (exchange.venue === "binance") {
      holdings.push(...(await getBinanceBalances(exchange)));
    } else if (exchange.venue === "okx") {
      holdings.push(...(await getOkxBalances(exchange)));
    } else {
      throw new Error(`${exchange.id}: unsupported exchange venue ${exchange.venue}`);
    }
  }
  return holdings;
}

function collectManualHoldings(config) {
  return (config.manualHoldings || [])
    .filter((item) => item.quantity > 0)
    .map((item) => ({
      sourceId: item.sourceId || "manual",
      sourceLabel: item.sourceLabel || "Manual holding",
      venue: item.venue || "manual",
      chain: item.chain || null,
      address: item.address || null,
      symbol: item.symbol,
      tokenName: item.tokenName || item.name || item.symbol,
      contract: item.contract || null,
      quantity: toNumber(item.quantity),
      stable: item.stable,
      priceUsd: item.priceUsd,
      fdvUsd: item.fdvUsd,
      marketCapUsd: item.marketCapUsd,
      coingeckoId: item.coingeckoId,
    }));
}

async function enrichHoldings(rawHoldings, config) {
  const registry = buildTokenRegistry(config);
  const marketCache = new Map();
  const enriched = [];
  for (const holding of rawHoldings) {
    const registered =
      registry.get(
        holding.chain && holding.contract
          ? `${holding.chain}:${normalizeAddress(holding.contract)}`
          : `symbol:${String(holding.symbol).toUpperCase()}`,
      ) || {};
    const token = { ...registered, ...holding };
    const market = await resolveMarketData(token, config, marketCache);
    const priceUsd = toNumber(token.priceUsd ?? market.priceUsd, 0);
    const fdvUsd = token.fdvUsd ?? market.fdvUsd ?? null;
    const usdValue = toNumber(token.quantity) * priceUsd;
    const classified = classifyAsset({ ...token, fdvUsd }, config);
    enriched.push({
      ...holding,
      tokenName: token.tokenName || token.name || token.symbol,
      quantity: toNumber(token.quantity),
      priceUsd,
      fdvUsd,
      marketCapUsd: token.marketCapUsd ?? market.marketCapUsd ?? null,
      usdValue,
      category: classified.category,
      categoryColor: classified.color,
      categoryReason: classified.reason,
      priceSource: market.priceSource,
      priceError: market.priceError || null,
    });
  }
  return enriched.sort((a, b) => b.usdValue - a.usdValue);
}

function summarizeHoldings(holdings, history, date) {
  const totalUsd = holdings.reduce((sum, item) => sum + item.usdValue, 0);
  const byCategory = Object.fromEntries(
    CATEGORY_ORDER.map((category) => [
      category,
      { category, usdValue: 0, allocation: 0, count: 0 },
    ]),
  );
  for (const item of holdings) {
    if (!byCategory[item.category]) {
      byCategory[item.category] = { category: item.category, usdValue: 0, allocation: 0, count: 0 };
    }
    byCategory[item.category].usdValue += item.usdValue;
    byCategory[item.category].count += 1;
  }
  for (const bucket of Object.values(byCategory)) {
    bucket.allocation = totalUsd > 0 ? bucket.usdValue / totalUsd : 0;
  }
  const previous = latestBefore(history, date);
  const weekAgo = nearestDaysBack(history, date, 7);
  const monthAgo = nearestDaysBack(history, date, 30);
  return {
    date,
    totalUsd,
    byCategory: Object.values(byCategory),
    changeDaily: pctChange(totalUsd, previous?.summary?.totalUsd),
    changeWeekly: pctChange(totalUsd, weekAgo?.summary?.totalUsd),
    changeMonthly: pctChange(totalUsd, monthAgo?.summary?.totalUsd),
    comparisonDates: {
      daily: previous?.date || null,
      weekly: weekAgo?.date || null,
      monthly: monthAgo?.date || null,
    },
  };
}

function latestBefore(history, date) {
  return [...history].reverse().find((snapshot) => snapshot.date < date) || null;
}

function nearestDaysBack(history, date, days) {
  const target = new Date(`${date}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - days);
  const targetDate = target.toISOString().slice(0, 10);
  const candidates = history.filter((snapshot) => snapshot.date <= targetDate);
  return candidates[candidates.length - 1] || null;
}

function pctChange(current, previous) {
  if (!previous || previous === 0) return null;
  return current / previous - 1;
}

function money(value) {
  return `$${toNumber(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function percent(value) {
  if (value === null || value === undefined) return "N/A";
  return `${(value * 100).toFixed(2)}%`;
}

function telegramEscape(text) {
  return String(text).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
}

function buildTelegramSummary(snapshot) {
  const lines = [
    "<b>资产日记每日快照</b>",
    `日期：${telegramEscape(snapshot.date)}`,
    `总资产：${telegramEscape(money(snapshot.summary.totalUsd))}`,
    `日变动：${telegramEscape(percent(snapshot.summary.changeDaily))}`,
    `周变动：${telegramEscape(percent(snapshot.summary.changeWeekly))}`,
    `月变动：${telegramEscape(percent(snapshot.summary.changeMonthly))}`,
    "",
    "<b>风险分类</b>",
    ...snapshot.summary.byCategory.map(
      (bucket) =>
        `${telegramEscape(bucket.category)}：${telegramEscape(money(bucket.usdValue))} / ${telegramEscape(
          percent(bucket.allocation),
        )}`,
    ),
    "",
    "<b>Top Holdings</b>",
    ...snapshot.holdings.slice(0, 8).map((item) =>
      `${telegramEscape(item.symbol)} ${telegramEscape(item.quantity.toFixed(6))} = ${telegramEscape(
        money(item.usdValue),
      )}`,
    ),
  ];
  return lines.join("\n");
}

async function sendTelegram(config, snapshot, dryRun) {
  if (!config.telegram?.enabled || dryRun) return { sent: false, reason: dryRun ? "dry-run" : "disabled" };
  const token = env(config.telegram.botTokenEnv);
  const chatId = env(config.telegram.chatIdEnv);
  if (!token || !chatId) throw new Error("telegram enabled but bot token or chat id env is missing");
  const result = await fetchJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: buildTelegramSummary(snapshot),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  return { sent: true, result };
}

async function run() {
  const configPath = resolveWorkspace(argValue("--config", "asset-diary/config.json"));
  const noTelegram = hasFlag("--no-telegram");
  const dryRun = hasFlag("--dry-run");
  const config = await loadJson(configPath);
  const now = new Date();
  const date = isoDateInTimezone(now, config.timezone || "Asia/Shanghai");
  const generatedAtLocal = localTimeInTimezone(now, config.timezone || "Asia/Shanghai");
  const ledgerPath = resolveWorkspace(config.ledgerPath);
  const historyBefore = await readJsonl(ledgerPath);
  const rawHoldings = [
    ...collectManualHoldings(config),
    ...(await collectWalletHoldings(config)),
    ...(await collectExchangeHoldings(config)),
  ];
  const enriched = await enrichHoldings(rawHoldings, config);
  const summary = summarizeHoldings(enriched, historyBefore, date);
  const snapshot = {
    date,
    generatedAtUtc: now.toISOString(),
    generatedAtLocal,
    baseCurrency: config.baseCurrency || "USD",
    summary,
    holdings: enriched,
  };
  if (!dryRun) await appendJsonl(ledgerPath, snapshot);
  const fullHistory = dryRun ? [...historyBefore, snapshot] : await readJsonl(ledgerPath);
  const dashboardDataPath = await writeDashboardData(fullHistory, projectRoot);
  const workbookResult = await writePortableWorkbook(config, fullHistory, projectRoot);
  const telegramResult = noTelegram ? { sent: false, reason: "disabled by --no-telegram" } : await sendTelegram(config, snapshot, dryRun);
  const output = {
    status: "ok",
    configPath,
    ledgerPath,
    excelPath: workbookResult.excelPath,
    dashboardDataPath,
    snapshotDate: snapshot.date,
    totalUsd: snapshot.summary.totalUsd,
    telegram: telegramResult,
    holdings: snapshot.holdings.length,
  };
  console.log(JSON.stringify(output, null, 2));
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "error",
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
