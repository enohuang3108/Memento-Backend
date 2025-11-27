# Memento Backend API

基於 Cloudflare Workers + Durable Objects 的即時照片牆後端服務。

## 🚀 快速開始

### 安裝依賴

```bash
pnpm install
```

### 本地開發

```bash
# 連線 Cloudflare 開發環境
pnpm dev

# 純本地模式（不連線 Cloudflare）
pnpm dev:local
```

開發伺服器會在 `http://localhost:8787` 啟動。

### 環境變數

複製範本並填入你的憑證：

```bash
cp .dev.vars.example .dev.vars
```

編輯 `.dev.vars`：

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

## 📦 專案架構

```
backend/
├── src/
│   ├── durableObjects/
│   │   └── EventRoom.ts          # Durable Object - 活動房間
│   ├── handlers/
│   │   ├── events.ts              # 活動 CRUD
│   │   ├── upload.ts              # 照片上傳
│   │   └── systemAuth.ts          # 系統授權
│   ├── services/
│   │   ├── googleDriveOAuth.ts    # Google Drive 整合
│   │   └── systemTokenManager.ts  # Token 管理
│   ├── models/                    # 資料模型
│   ├── utils/                     # 工具函式
│   ├── types.ts                   # TypeScript 型別
│   └── index.ts                   # 主要入口
├── wrangler.toml                  # Cloudflare 配置
└── package.json
```

## 🔌 API 端點

### 活動管理

- `POST /events` - 建立活動
- `GET /events/:id` - 取得活動資訊
- `DELETE /events/:id` - 結束活動

### WebSocket

- `GET /events/:id/ws` - 即時連線（照片與彈幕）

### 上傳

- `POST /upload` - 上傳照片到 Google Drive

### 系統管理

- `GET /admin/auth/google` - 啟動 OAuth 授權流程
- `GET /admin/auth/google/callback` - OAuth 回調
- `GET /admin/token/status` - 檢查 Token 狀態

### Health Check

- `GET /health` - 健康檢查

## 🏗️ 核心技術

### Durable Objects

每個活動使用獨立的 Durable Object 實例：

- **即時通訊**: WebSocket 連線管理
- **自動同步**: 每 10 秒從 Google Drive 同步照片
- **速率限制**: 照片 (20/60s)、彈幕 (1/2s)
- **連線上限**: 500 並發連線 per DO

### KV Namespace

- `SYSTEM_TOKENS`: 儲存系統級 OAuth Token

## 🧪 測試

```bash
# 執行測試
pnpm test

# 型別檢查
npx tsc --noEmit

# 建置測試
pnpm build
```

## 🚀 部署

### 使用 GitHub Actions（推薦）

詳見 [DEPLOYMENT.md](.github/DEPLOYMENT.md)

**Production:**

```bash
git tag v1.0.0
git push origin v1.0.0
```

**Beta:**

```bash
git tag v1.0.0b1
git push origin v1.0.0b1
```

### 手動部署

```bash
# Beta 環境
pnpm deploy:beta

# Production 環境
pnpm deploy:production
```

## 🌍 環境配置

| 環境 | 名稱 | 網域 |
|------|------|------|
| Development | `memento-api-dev` | localhost:8787 |
| Beta | `memento-api-beta` | beta.memento-api.oddlabcc.cc |
| Production | `memento-api-production` | memento-api.oddlabcc.cc |

## 📝 開發規範

- 使用 TypeScript 嚴格模式
- 遵循 Functional Programming 原則
- 使用 pnpm 管理依賴
- Commit message 使用繁體中文

## 🔐 安全性

- ✅ ID 加密/解密（公開 ID vs 內部 ID）
- ✅ CORS 白名單控制
- ✅ 輸入驗證與清理
- ✅ 髒話過濾
- ✅ 速率限制

## 📚 相關連結

- [Cloudflare Workers 文件](https://developers.cloudflare.com/workers/)
- [Durable Objects 文件](https://developers.cloudflare.com/durable-objects/)
- [Wrangler CLI 文件](https://developers.cloudflare.com/workers/wrangler/)
- [專案部署指南](.github/DEPLOYMENT.md)

## 📄 授權

Private Project
