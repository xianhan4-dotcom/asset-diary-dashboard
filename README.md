# Asset Diary Dashboard

只读虚拟资产监控系统。每天聚合链上钱包、Binance、OKX 与手工资产，统一按 USD 计价，保存历史快照、Excel 总账、网页 Dashboard，并可通过 Telegram 发送摘要。

## 功能

- BNB Smart Chain 原生币与 ERC-20 余额读取
- Binance、OKX 只读账户余额读取
- CoinGecko 价格与 FDV，Binance 公共行情作为价格兜底
- 稳定币与 FDV 风险分层、分类占比统计
- 日、周、月资产变化率
- Excel 总账与浏览器 Dashboard
- Telegram 每日摘要
- 不读取私钥，不签名，不交易，不提现

## 风险分类

| 分类 | 颜色 | 规则 |
|---|---|---|
| 稳定低风险资产 | 海蓝色 | 稳定币 |
| 高风险资产 | 橙色 | 非稳定币，FDV >= 100 亿美元 |
| 较高风险资产 | 棕色 | 非稳定币，10 亿美元 <= FDV < 100 亿美元 |
| 极高风险资产 | 红色 | 非稳定币，FDV < 10 亿美元；FDV 缺失时保守归入此类 |

## 快速启动

要求 Node.js 20 或更高版本。

```bash
npm install
npm run sample
npm run dashboard
```

浏览器打开 `http://127.0.0.1:4173`。示例运行会生成 Excel 和 Dashboard 数据，但不会写入真实账本，也不会发送 Telegram。

## 配置真实账户

1. 复制 `config.example.json` 为 `config.json`。
2. 复制 `.env.example` 为 `.env`，在本机设置所需环境变量。
3. 在 `config.json` 中添加钱包地址、代币合约和只读交易所账户。
4. 用当前终端载入环境变量后运行 `npm run snapshot`。

运行命令会在 `.env` 存在时自动读取。生产环境可改用操作系统环境变量、密码管理器或任务调度器注入变量，避免密钥落入命令历史和日志。

交易所 API 必须关闭交易、划转和提现权限，并建议启用 IP 白名单。不要向任何人发送私钥、助记词、API Secret 或 Telegram Bot Token。

## 每日运行

Linux/macOS 可用 `cron`，Windows 可用“任务计划程序”，在每天 08:00 执行：

```bash
npm run snapshot
```

每次成功运行会更新：

| 路径 | 内容 |
|---|---|
| `data/snapshots.jsonl` | 追加式每日原始快照 |
| `outputs/asset_diary.xlsx` | Excel 总账 |
| `web/data/snapshots.json` | Dashboard 数据 |

## 数据源配置

链上钱包使用 `wallets`；要读取的资产必须列入 `trackedTokens`。交易所账户使用 `exchanges`，凭据字段只保存环境变量名称。无法自动读取的资产使用 `manualHoldings`。

`config.example.json` 是可运行样例。更多录入字段见 `docs-intake-template.md`。

## GitHub 上传

解压后在项目目录执行：

```bash
git init
git add .
git commit -m "Initial asset diary dashboard"
git branch -M main
git remote add origin https://github.com/xianhan4-dotcom/asset-diary-dashboard.git
git push -u origin main
```

建议将真实资产仓库设为 Private。`.gitignore` 已排除真实配置、环境变量、实时快照和运行输出。执行 `git status` 后确认没有敏感文件再推送。

GitHub Pages 只能展示已提交的静态示例数据，不能安全执行交易所 API、保存私密快照或运行每日采集。真实 Dashboard 应在本机或受控私有服务器运行。

## 目录

```text
asset-diary-dashboard/
  src/                 快照、Excel 和本地服务器
  web/                 静态 Dashboard
  data/                示例与运行时账本
  outputs/             示例 Excel 与预览图
  config.example.json  脱敏配置样例
  .env.example         环境变量模板
  SECURITY.md          安全边界
```
