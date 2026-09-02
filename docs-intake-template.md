# Asset Diary Intake Template

把信息填到本文件或直接填入 `asset-diary/config.json`。不要把任何私钥、助记词、交易所 Secret、Telegram Token 发到聊天。

## 链上钱包

| id | label | chain | address | 需要追踪的代币 |
|---|---|---|---|---|
| wallet_001 |  | bsc | 0x... | BNB, USDT, USDC, OPG |

## 代币合约

| symbol | chain | contract | decimals | stable | coingeckoId | fdvUsd 手工兜底 |
|---|---|---|---:|---|---|---:|
| OPG | bsc | 0x5feccd17c393caf1001d18164236a37e731fcb9d | 18 | false |  |  |

## 交易所账户

交易所 API 只允许只读权限。禁止交易、提现、划转权限。

| id | venue | label | enabled | API Key 环境变量 | Secret 环境变量 | Passphrase 环境变量 |
|---|---|---|---|---|---|---|
| binance_main | binance | Binance main | false | ASSET_DIARY_BINANCE_API_KEY | ASSET_DIARY_BINANCE_API_SECRET |  |
| okx_main | okx | OKX main | false | ASSET_DIARY_OKX_API_KEY | ASSET_DIARY_OKX_API_SECRET | ASSET_DIARY_OKX_API_PASSPHRASE |

## 手工初始资产

无法自动读取的平台、锁仓、空投、未上链记账资产，填在这里。

| sourceId | sourceLabel | venue | symbol | quantity | priceUsd | fdvUsd | stable |
|---|---|---|---|---:|---:|---:|---|
| manual_001 |  | manual | USDC | 0 | 1 |  | true |

## Telegram

| 项 | 值 |
|---|---|
| Bot Token 环境变量 | `ASSET_DIARY_TELEGRAM_BOT_TOKEN` |
| Chat ID 环境变量 | `ASSET_DIARY_TELEGRAM_CHAT_ID` |

## 必填环境变量

```text
ASSET_DIARY_BSC_RPC_HTTP=
ASSET_DIARY_TELEGRAM_BOT_TOKEN=
ASSET_DIARY_TELEGRAM_CHAT_ID=
```

