const state = {
  snapshots: [],
  selectedIndex: 0,
  source: "all",
  search: "",
};

const categoryColors = {
  "稳定低风险资产": "#00a3e0",
  "高风险资产": "#f59e0b",
  "较高风险资产": "#92400e",
  "极高风险资产": "#dc2626",
};

function categoryColor(bucket) {
  const candidate = bucket.color || bucket.categoryColor || categoryColors[bucket.category];
  return /^#[0-9a-f]{6}$/i.test(candidate || "") ? candidate : "#6a717b";
}

const elements = Object.fromEntries(
  [
    "dashboard", "errorState", "errorMessage", "retryButton", "dataStatus", "dateSelect",
    "totalUsd", "dailyChange", "weeklyChange", "monthlyChange", "dailyBasis", "weeklyBasis",
    "monthlyBasis", "snapshotTime", "trendDelta", "trendChart", "allocationChart",
    "allocationLegend", "assetCount", "sourceBars", "sourceFilter", "tokenSearch",
    "holdingsBody", "emptyHoldings",
  ].map((id) => [id, document.getElementById(id)]),
);

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const quantity = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function percent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "--";
  const numeric = Number(value) * 100;
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function deltaClass(value) {
  if (value === null || value === undefined || Number(value) === 0) return "neutral";
  return Number(value) > 0 ? "positive" : "negative";
}

function setDelta(element, value) {
  element.textContent = percent(value);
  element.className = deltaClass(value);
}

function parseJsonl(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function loadSnapshots() {
  const sources = [
    { url: "./data/snapshots.json", parse: (text) => JSON.parse(text).snapshots || [] },
    { url: "./data/sample_snapshots.jsonl", parse: parseJsonl },
  ];
  let lastError;
  for (const source of sources) {
    try {
      const response = await fetch(source.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const snapshots = source.parse(await response.text());
      if (!Array.isArray(snapshots) || !snapshots.length) throw new Error("快照文件为空");
      return { snapshots, sample: source.url.includes("sample_") };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("未找到快照文件");
}

function selectedSnapshot() {
  return state.snapshots[state.selectedIndex];
}

function initializeControls() {
  elements.dateSelect.innerHTML = state.snapshots
    .map((snapshot, index) => `<option value="${index}">${escapeHtml(snapshot.date)}</option>`)
    .join("");
  state.selectedIndex = state.snapshots.length - 1;
  elements.dateSelect.value = String(state.selectedIndex);
  elements.dateSelect.addEventListener("change", () => {
    state.selectedIndex = Number(elements.dateSelect.value);
    render();
  });
  elements.sourceFilter.addEventListener("change", () => {
    state.source = elements.sourceFilter.value;
    renderHoldings();
  });
  elements.tokenSearch.addEventListener("input", () => {
    state.search = elements.tokenSearch.value.trim().toLowerCase();
    renderHoldings();
  });
}

function renderSummary(snapshot) {
  elements.totalUsd.textContent = money.format(snapshot.summary.totalUsd || 0);
  elements.snapshotTime.textContent = `生成时间 ${snapshot.generatedAtLocal || snapshot.generatedAtUtc || "--"}`;
  setDelta(elements.dailyChange, snapshot.summary.changeDaily);
  setDelta(elements.weeklyChange, snapshot.summary.changeWeekly);
  setDelta(elements.monthlyChange, snapshot.summary.changeMonthly);
  const dates = snapshot.summary.comparisonDates || {};
  elements.dailyBasis.textContent = dates.daily ? `对比 ${dates.daily}` : "无上一快照";
  elements.weeklyBasis.textContent = dates.weekly ? `对比 ${dates.weekly}` : "无周基准";
  elements.monthlyBasis.textContent = dates.monthly ? `对比 ${dates.monthly}` : "无月基准";
  elements.assetCount.textContent = String(snapshot.holdings.length);
}

function setupCanvas(canvas, cssHeight) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(canvas.clientWidth, 280);
  const height = cssHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

function renderTrend() {
  const history = state.snapshots.slice(0, state.selectedIndex + 1);
  const { context, width, height } = setupCanvas(elements.trendChart, 260);
  const padding = { top: 18, right: 18, bottom: 34, left: 62 };
  const values = history.map((snapshot) => Number(snapshot.summary.totalUsd) || 0);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = Math.max(maxValue - minValue, Math.max(maxValue * 0.08, 1));
  const low = Math.max(0, minValue - spread * 0.3);
  const high = maxValue + spread * 0.3;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index) => padding.left + (history.length === 1 ? plotWidth / 2 : (index / (history.length - 1)) * plotWidth);
  const y = (value) => padding.top + ((high - value) / Math.max(high - low, 1)) * plotHeight;

  context.clearRect(0, 0, width, height);
  context.font = "11px Segoe UI, sans-serif";
  context.textBaseline = "middle";
  for (let index = 0; index <= 4; index += 1) {
    const value = low + ((high - low) * (4 - index)) / 4;
    const lineY = padding.top + (plotHeight * index) / 4;
    context.strokeStyle = "#e4e7eb";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(padding.left, lineY);
    context.lineTo(width - padding.right, lineY);
    context.stroke();
    context.fillStyle = "#737a84";
    context.textAlign = "right";
    context.fillText(compactMoney.format(value), padding.left - 9, lineY);
  }

  context.strokeStyle = "#00a3e0";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.beginPath();
  history.forEach((snapshot, index) => {
    const pointX = x(index);
    const pointY = y(values[index]);
    if (index === 0) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
  });
  context.stroke();
  history.forEach((snapshot, index) => {
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#00a3e0";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x(index), y(values[index]), 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });

  const labelIndexes = [...new Set([0, Math.floor((history.length - 1) / 2), history.length - 1])];
  context.fillStyle = "#737a84";
  context.textAlign = "center";
  labelIndexes.forEach((index) => context.fillText(history[index].date.slice(5), x(index), height - 12));
  elements.trendChart.setAttribute(
    "aria-label",
    `总资产历史折线图，共 ${history.length} 个快照，最新值 ${money.format(values.at(-1) || 0)}`,
  );
  const totalChange = values.length > 1 && values[0] !== 0 ? values.at(-1) / values[0] - 1 : null;
  elements.trendDelta.textContent = totalChange === null ? "历史不足" : `区间 ${percent(totalChange)}`;
  elements.trendDelta.className = `metric-note ${deltaClass(totalChange)}`;
}

function renderAllocation(snapshot) {
  const buckets = snapshot.summary.byCategory || [];
  const { context, width, height } = setupCanvas(elements.allocationChart, 170);
  const total = buckets.reduce((sum, bucket) => sum + (Number(bucket.usdValue) || 0), 0);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - 10;
  const lineWidth = 28;
  let angle = -Math.PI / 2;
  context.clearRect(0, 0, width, height);
  if (total <= 0) {
    context.strokeStyle = "#e4e7eb";
    context.lineWidth = lineWidth;
    context.beginPath();
    context.arc(centerX, centerY, radius - lineWidth / 2, 0, Math.PI * 2);
    context.stroke();
  } else {
    buckets.forEach((bucket) => {
      const share = (Number(bucket.usdValue) || 0) / total;
      if (share <= 0) return;
      const nextAngle = angle + share * Math.PI * 2;
      context.strokeStyle = categoryColor(bucket);
      context.lineWidth = lineWidth;
      context.beginPath();
      context.arc(centerX, centerY, radius - lineWidth / 2, angle, nextAngle);
      context.stroke();
      angle = nextAngle;
    });
  }
  elements.allocationLegend.innerHTML = buckets.map((bucket) => `
    <div class="legend-row">
      <span class="legend-swatch" style="background:${categoryColor(bucket)}"></span>
      <span class="legend-label">${escapeHtml(bucket.category)}</span>
      <span class="legend-value">${(Number(bucket.allocation || 0) * 100).toFixed(1)}%</span>
    </div>
  `).join("");
}

function renderSources(snapshot) {
  const totals = new Map();
  snapshot.holdings.forEach((holding) => {
    const key = holding.sourceLabel || holding.sourceId || "未命名账户";
    totals.set(key, (totals.get(key) || 0) + (Number(holding.usdValue) || 0));
  });
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] || 1;
  elements.sourceBars.innerHTML = rows.length ? rows.map(([label, value]) => `
    <div class="source-row">
      <span class="source-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max((value / max) * 100, 0)}%"></div></div>
      <span class="source-value">${money.format(value)}</span>
    </div>
  `).join("") : '<div class="empty">没有账户数据。</div>';
}

function syncSourceFilter(snapshot) {
  const current = state.source;
  const sources = [...new Set(snapshot.holdings.map((item) => item.sourceLabel || item.sourceId))].sort();
  elements.sourceFilter.innerHTML = ["all", ...sources]
    .map((source) => `<option value="${escapeHtml(source)}">${source === "all" ? "全部账户" : escapeHtml(source)}</option>`)
    .join("");
  state.source = sources.includes(current) ? current : "all";
  elements.sourceFilter.value = state.source;
}

function renderHoldings() {
  const snapshot = selectedSnapshot();
  const filtered = snapshot.holdings.filter((holding) => {
    const source = holding.sourceLabel || holding.sourceId;
    const sourceMatch = state.source === "all" || source === state.source;
    const haystack = `${holding.symbol} ${holding.tokenName || ""} ${holding.contract || ""}`.toLowerCase();
    return sourceMatch && (!state.search || haystack.includes(state.search));
  });
  elements.holdingsBody.innerHTML = filtered.map((holding) => `
    <tr>
      <td><div class="token-cell"><span class="token-icon">${escapeHtml(holding.symbol.slice(0, 3))}</span>${escapeHtml(holding.symbol)}</div></td>
      <td>${escapeHtml(holding.sourceLabel || holding.sourceId)}</td>
      <td class="number">${quantity.format(holding.quantity || 0)}</td>
      <td class="number">${money.format(holding.priceUsd || 0)}</td>
      <td class="number"><strong>${money.format(holding.usdValue || 0)}</strong></td>
      <td><span class="risk-badge" style="background:${escapeHtml(holding.categoryColor || "#6a717b")}">${escapeHtml(holding.category)}</span></td>
      <td>${escapeHtml(holding.priceSource || "--")}</td>
    </tr>
  `).join("");
  elements.emptyHoldings.hidden = filtered.length > 0;
}

function render() {
  const snapshot = selectedSnapshot();
  renderSummary(snapshot);
  renderTrend();
  renderAllocation(snapshot);
  renderSources(snapshot);
  syncSourceFilter(snapshot);
  renderHoldings();
}

async function start() {
  elements.dashboard.hidden = true;
  elements.errorState.hidden = true;
  elements.dataStatus.textContent = "读取中";
  elements.dataStatus.className = "status";
  try {
    const result = await loadSnapshots();
    state.snapshots = result.snapshots.sort((a, b) => a.date.localeCompare(b.date));
    initializeControls();
    render();
    elements.dataStatus.textContent = result.sample ? "示例数据" : "数据已载入";
    elements.dataStatus.className = "status ok";
    elements.dashboard.hidden = false;
  } catch (error) {
    elements.errorMessage.textContent = `${error.message}。先运行 npm run sample 或 npm run snapshot 生成数据。`;
    elements.errorState.hidden = false;
    elements.dataStatus.textContent = "读取失败";
  }
}

elements.retryButton.addEventListener("click", start);
window.addEventListener("resize", () => {
  if (!elements.dashboard.hidden && state.snapshots.length) {
    renderTrend();
    renderAllocation(selectedSnapshot());
  }
});

start();
