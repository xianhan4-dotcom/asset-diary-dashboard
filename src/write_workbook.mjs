import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

const CATEGORY_COLORS = {
  "稳定低风险资产": "00A3E0",
  "高风险资产": "F59E0B",
  "较高风险资产": "92400E",
  "极高风险资产": "DC2626",
};

function resolveProjectPath(projectRoot, configuredPath) {
  if (path.isAbsolute(configuredPath)) return configuredPath;
  const normalized = String(configuredPath).replace(/\\/g, "/");
  const standalonePath = normalized.startsWith("asset-diary/")
    ? normalized.slice("asset-diary/".length)
    : normalized;
  return path.join(projectRoot, standalonePath);
}

function styleHeader(row, color = "111827") {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    cell.font = { bold: true, color: { argb: "FFFFFF" } };
    cell.alignment = { vertical: "middle" };
  });
}

function applyFormats(sheet, columns) {
  for (const [column, format] of Object.entries(columns)) {
    sheet.getColumn(column).numFmt = format;
  }
}

function finishSheet(sheet, widths) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  Object.entries(widths).forEach(([column, width]) => {
    sheet.getColumn(column).width = width;
  });
  sheet.eachRow((row) => {
    row.alignment = { vertical: "middle" };
  });
}

function addDashboard(workbook, latest) {
  const sheet = workbook.addWorksheet("Dashboard", { views: [{ showGridLines: false }] });
  sheet.mergeCells("A1:H1");
  const title = sheet.getCell("A1");
  title.value = "虚拟资产日记";
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0F172A" } };
  title.font = { bold: true, color: { argb: "FFFFFF" }, size: 18 };
  title.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 30;

  sheet.addRows([
    [],
    ["快照日期", latest.date, "风险分类", "USD 市值", "占比", "资产数"],
    ["总资产 USD", latest.summary.totalUsd],
    ["日变动", latest.summary.changeDaily],
    ["周变动", latest.summary.changeWeekly],
    ["月变动", latest.summary.changeMonthly],
    ["资产条目数", latest.holdings.length],
    ["生成时间", latest.generatedAtLocal],
  ]);
  styleHeader(sheet.getRow(3), "1F2937");
  latest.summary.byCategory.forEach((bucket, index) => {
    const rowNumber = 4 + index;
    sheet.getCell(rowNumber, 3).value = bucket.category;
    sheet.getCell(rowNumber, 4).value = bucket.usdValue;
    sheet.getCell(rowNumber, 5).value = bucket.allocation;
    sheet.getCell(rowNumber, 6).value = bucket.count;
    const fill = CATEGORY_COLORS[bucket.category] || "64748B";
    for (let column = 3; column <= 6; column += 1) {
      const cell = sheet.getCell(rowNumber, column);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
    }
  });

  const tableHeaderRow = 12;
  sheet.getRow(tableHeaderRow).values = ["Symbol", "来源", "数量", "价格 USD", "市值 USD", "分类"];
  styleHeader(sheet.getRow(tableHeaderRow), "334155");
  latest.holdings.slice(0, 12).forEach((item) => {
    sheet.addRow([
      item.symbol,
      item.sourceLabel,
      item.quantity,
      item.priceUsd,
      item.usdValue,
      item.category,
    ]);
  });
  sheet.getColumn(2).numFmt = "$#,##0.00";
  sheet.getColumn(4).numFmt = "$#,##0.00";
  sheet.getColumn(5).numFmt = "$#,##0.00";
  finishSheet(sheet, { A: 20, B: 28, C: 24, D: 18, E: 16, F: 22 });
  return sheet;
}

function addDailySummary(workbook, snapshots) {
  const sheet = workbook.addWorksheet("Daily Summary", { views: [{ showGridLines: false }] });
  sheet.addRow([
    "Date",
    "Total USD",
    "Daily Change",
    "Weekly Change",
    "Monthly Change",
    "稳定低风险资产 USD",
    "高风险资产 USD",
    "较高风险资产 USD",
    "极高风险资产 USD",
    "稳定低风险资产 %",
    "高风险资产 %",
    "较高风险资产 %",
    "极高风险资产 %",
  ]);
  styleHeader(sheet.getRow(1));
  for (const snapshot of snapshots) {
    const categories = Object.fromEntries(
      snapshot.summary.byCategory.map((bucket) => [bucket.category, bucket]),
    );
    sheet.addRow([
      snapshot.date,
      snapshot.summary.totalUsd,
      snapshot.summary.changeDaily,
      snapshot.summary.changeWeekly,
      snapshot.summary.changeMonthly,
      categories["稳定低风险资产"]?.usdValue || 0,
      categories["高风险资产"]?.usdValue || 0,
      categories["较高风险资产"]?.usdValue || 0,
      categories["极高风险资产"]?.usdValue || 0,
      categories["稳定低风险资产"]?.allocation || 0,
      categories["高风险资产"]?.allocation || 0,
      categories["较高风险资产"]?.allocation || 0,
      categories["极高风险资产"]?.allocation || 0,
    ]);
  }
  applyFormats(sheet, {
    B: "$#,##0.00",
    C: "0.00%",
    D: "0.00%",
    E: "0.00%",
    F: "$#,##0.00",
    G: "$#,##0.00",
    H: "$#,##0.00",
    I: "$#,##0.00",
    J: "0.00%",
    K: "0.00%",
    L: "0.00%",
    M: "0.00%",
  });
  finishSheet(sheet, {
    A: 14, B: 16, C: 16, D: 16, E: 16, F: 22, G: 18, H: 22, I: 22,
    J: 20, K: 18, L: 20, M: 20,
  });
}

function addHoldings(workbook, snapshots) {
  const sheet = workbook.addWorksheet("Holdings", { views: [{ showGridLines: false }] });
  sheet.addRow([
    "Date", "Source", "Venue", "Chain", "Address", "Symbol", "Token", "Contract",
    "Quantity", "Price USD", "Value USD", "FDV USD", "Market Cap USD", "Risk Category",
    "Category Reason", "Price Source", "Price Error",
  ]);
  styleHeader(sheet.getRow(1));
  snapshots.forEach((snapshot) => {
    snapshot.holdings.forEach((item) => {
      sheet.addRow([
        snapshot.date,
        item.sourceLabel,
        item.venue,
        item.chain || "",
        item.address || "",
        item.symbol,
        item.tokenName || item.symbol,
        item.contract || "",
        item.quantity,
        item.priceUsd,
        item.usdValue,
        item.fdvUsd ?? "",
        item.marketCapUsd ?? "",
        item.category,
        item.categoryReason,
        item.priceSource,
        item.priceError || "",
      ]);
    });
  });
  applyFormats(sheet, {
    I: "#,##0.000000",
    J: "$#,##0.00",
    K: "$#,##0.00",
    L: "$#,##0.00",
    M: "$#,##0.00",
  });
  finishSheet(sheet, {
    A: 14, B: 28, C: 14, D: 12, E: 44, F: 12, G: 20, H: 44, I: 18,
    J: 16, K: 16, L: 18, M: 18, N: 22, O: 28, P: 18, Q: 36,
  });
  sheet.autoFilter = { from: "A1", to: `Q${Math.max(sheet.rowCount, 1)}` };
}

function addRules(workbook) {
  const sheet = workbook.addWorksheet("Rules", { views: [{ showGridLines: false }] });
  sheet.addRows([
    ["分类", "颜色", "规则", "说明"],
    ["稳定低风险资产", "海蓝色", "stable=true 或稳定币符号", "稳定币优先分类"],
    ["高风险资产", "橙色", "FDV >= 100 亿美元", "非稳定币"],
    ["较高风险资产", "棕色", "10 亿美元 <= FDV < 100 亿美元", "非稳定币"],
    ["极高风险资产", "红色", "FDV < 10 亿美元；FDV 缺失也保守归入此类", "非稳定币"],
  ]);
  styleHeader(sheet.getRow(1));
  ["00A3E0", "F59E0B", "92400E", "DC2626"].forEach((fill, index) => {
    const row = sheet.getRow(index + 2);
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
    });
  });
  finishSheet(sheet, { A: 22, B: 14, C: 48, D: 24 });
}

function addSources(workbook, config) {
  const sheet = workbook.addWorksheet("Sources", { views: [{ showGridLines: false }] });
  sheet.addRow(["Type", "ID", "Label", "Chain/Venue", "Address/Status"]);
  styleHeader(sheet.getRow(1));
  (config.wallets || []).forEach((wallet) => {
    sheet.addRow(["wallet", wallet.id, wallet.label || wallet.id, wallet.chain, wallet.address]);
  });
  (config.exchanges || []).forEach((exchange) => {
    sheet.addRow([
      "exchange",
      exchange.id,
      exchange.label || exchange.id,
      exchange.venue,
      exchange.enabled ? "enabled" : "disabled",
    ]);
  });
  finishSheet(sheet, { A: 14, B: 20, C: 28, D: 18, E: 46 });
}

export async function writePortableWorkbook(config, snapshots, projectRoot) {
  if (!snapshots.length) throw new Error("cannot build workbook without snapshots");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Asset Diary Dashboard";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  addDashboard(workbook, snapshots[snapshots.length - 1]);
  addDailySummary(workbook, snapshots);
  addHoldings(workbook, snapshots);
  addRules(workbook);
  addSources(workbook, config);

  const excelPath = resolveProjectPath(projectRoot, config.excelPath || "outputs/asset_diary.xlsx");
  await fs.mkdir(path.dirname(excelPath), { recursive: true });
  await workbook.xlsx.writeFile(excelPath);
  return { excelPath, formulaScan: "not-applicable" };
}
