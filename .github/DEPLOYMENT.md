# 🚀 部署指南

## 部署架構

此專案使用 **GitHub Actions** 進行自動化部署。

### 環境配置

| 環境 | 觸發方式 | 網域 | Workflow |
|------|---------|------|----------|
| **Production** | Tag `v*` (如 `v1.0.0`) | memento-api.oddlabcc.cc | `deploy.yml` |
| **Beta** | Tag `v*b*` (如 `v1.0.0b1`) | beta.memento-api.oddlabcc.cc | `deploy.yml` |
| **Dev** | 本地開發 | localhost:8787 | 手動執行 |

---

## 🔧 初次設定

### 1. 取得 Cloudflare API Token

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 進入 **My Profile** → **API Tokens**
3. 點擊 **Create Token**
4. 使用範本：**Edit Cloudflare Workers**
5. 權限設定：
   ```
   Account - Cloudflare Workers - Edit
   Account - Account Settings - Read
   Zone - Workers Routes - Edit (如果使用 Custom Domain)
   ```
6. 複製產生的 Token

### 2. 設定 GitHub Secrets

進入 GitHub Repository → **Settings** → **Secrets and variables** → **Actions**

新增以下 Secrets：

```bash
CLOUDFLARE_API_TOKEN      # 步驟 1 取得的 API Token
CLOUDFLARE_ACCOUNT_ID     # Cloudflare Account ID (在 Workers 頁面右側)
```

**取得 Account ID：**
- 登入 Cloudflare Dashboard
- 進入 **Workers & Pages**
- 右側會顯示 **Account ID**

---

## 📦 部署流程

### Production 部署

1. 確保所有變更已合併到 `main` branch
2. 建立並推送 Production Tag：

```bash
# 建立 tag (語意化版本)
git tag v1.0.0

# 推送 tag 觸發部署
git push origin v1.0.0
```

3. GitHub Actions 會自動：
   - ✅ 檢查 TypeScript 型別
   - ✅ 執行 Wrangler 建置
   - ✅ 部署到 Production 環境

### Beta 部署

1. 確保所有變更已合併到 `beta` branch
2. 建立並推送 Beta Tag：

```bash
# 建立 beta tag
git tag v1.0.0b1

# 推送 tag 觸發部署
git push origin v1.0.0b1
```

### 手動部署（測試用）

進入 GitHub Repository → **Actions** → **Deploy to Cloudflare Workers** → **Run workflow**

選擇環境：
- `beta` - 部署到 Beta 環境
- `production` - 部署到 Production 環境

---

## 🔍 CI/CD Workflows

### 1. CI - Type Check & Build (`ci.yml`)

**觸發時機：**
- Pull Request 到 `main` 或 `beta` branch
- Push 到 `main` 或 `beta` branch

**執行內容：**
- TypeScript 型別檢查
- Wrangler 建置驗證

### 2. Deploy (`deploy.yml`)

**觸發時機：**
- Push tag `v*` (Production)
- Push tag `v*b*` (Beta)
- 手動觸發

**執行內容：**
- 安裝依賴
- TypeScript 型別檢查
- 根據 tag pattern 自動選擇環境
- 部署到對應的 Cloudflare Workers

---

## 🏷️ Tag 命名規範

### Production Tags

```bash
v1.0.0          # Major release
v1.1.0          # Minor release
v1.1.1          # Patch release
```

### Beta Tags

```bash
v1.0.0b1        # Beta 1 for v1.0.0
v1.0.0b2        # Beta 2 for v1.0.0
v1.1.0b1        # Beta 1 for v1.1.0
```

---

## 🛠️ 本地開發

```bash
# 安裝依賴
pnpm install

# 本地開發（連線 Cloudflare）
pnpm dev

# 本地開發（純本地模式）
pnpm dev:local

# 型別檢查
npx tsc --noEmit

# 建置測試
pnpm build
```

---

## 📝 部署檢查清單

### 部署前

- [ ] 所有測試通過
- [ ] TypeScript 無型別錯誤
- [ ] 已更新 CHANGELOG.md
- [ ] 已更新版本號
- [ ] Code Review 完成

### 部署後

- [ ] 確認 GitHub Actions 部署成功
- [ ] 檢查 Cloudflare Workers 狀態
- [ ] 測試 API 端點
- [ ] 測試 WebSocket 連線
- [ ] 檢查 Durable Objects 運作正常
- [ ] 監控錯誤日誌

---

## 🚨 疑難排解

### 部署失敗

1. **檢查 Secrets**
   - 確認 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 正確
   - Token 權限是否足夠

2. **檢查 wrangler.toml**
   - KV Namespace ID 是否正確
   - Durable Objects 配置是否正確
   - Routes 設定是否正確

3. **檢查 GitHub Actions 日誌**
   - Actions tab 查看詳細錯誤訊息

### Rollback

如果部署後發現問題，快速回退：

```bash
# 1. 找到上一個穩定版本的 tag
git tag

# 2. 重新部署該版本
git push origin v1.0.0 --force

# 或手動透過 GitHub Actions 部署
```

---

## 📚 相關文件

- [Cloudflare Workers 文件](https://developers.cloudflare.com/workers/)
- [Durable Objects 文件](https://developers.cloudflare.com/durable-objects/)
- [GitHub Actions 文件](https://docs.github.com/en/actions)
- [Wrangler CLI 文件](https://developers.cloudflare.com/workers/wrangler/)
