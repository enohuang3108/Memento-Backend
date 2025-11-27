# CORS 配置指南

## 🔒 當前 CORS 設定

### HTTP Headers

```typescript
Access-Control-Allow-Origin: <動態匹配 Origin>
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400 (24 小時)
```

### 允許的來源（依環境）

| 環境 | 允許的 Origins |
|------|---------------|
| **Development** | `http://localhost:3000`, `http://127.0.0.1:3000` |
| **Beta** | `https://beta.memento.oddlabcc.cc`, `http://localhost:3000` |
| **Production** | `https://memento.oddlabcc.cc` |

---

## 🛡️ CORS 驗證流程

### 1. Preflight Request (OPTIONS)

瀏覽器在發送實際請求前會先發送 OPTIONS 請求：

```http
OPTIONS /events HTTP/1.1
Origin: https://memento.oddlabcc.cc
Access-Control-Request-Method: POST
Access-Control-Request-Headers: Content-Type
```

**Worker 回應：**

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://memento.oddlabcc.cc
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
```

### 2. Actual Request

Preflight 通過後，瀏覽器發送實際請求：

```http
POST /events HTTP/1.1
Origin: https://memento.oddlabcc.cc
Content-Type: application/json

{
  "title": "My Event",
  "driveFolderId": "..."
}
```

**Worker 回應：**

```http
HTTP/1.1 201 Created
Access-Control-Allow-Origin: https://memento.oddlabcc.cc
Access-Control-Allow-Credentials: true
Content-Type: application/json

{
  "event": {...},
  "qrCodeUrl": "..."
}
```

### 3. WebSocket Upgrade

WebSocket 連線也會檢查 Origin：

```javascript
const ws = new WebSocket('wss://memento-api.oddlabcc.cc/events/xxx/ws')
```

Worker 會：
1. 檢查 `Origin` header
2. 驗證是否在允許清單中
3. 允許或拒絕連線

---

## 🔧 配置 CORS 白名單

### 修改 wrangler.toml

```toml
# Development
[env.dev]
vars = {
  CORS_ALLOWED_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173"
}

# Beta
[env.beta]
vars = {
  CORS_ALLOWED_ORIGINS = "https://beta.memento.oddlabcc.cc,http://localhost:3000"
}

# Production
[env.production]
vars = {
  CORS_ALLOWED_ORIGINS = "https://memento.oddlabcc.cc"
}
```

### 本地開發（.dev.vars）

```env
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

**注意：** 多個 origin 用逗號分隔，**不要有空格**。

---

## 🐛 常見 CORS 問題與解決

### 問題 1: "No 'Access-Control-Allow-Origin' header is present"

**原因：** Origin 不在白名單中

**解決方法：**

1. 檢查前端請求的 Origin：
   ```javascript
   console.log(window.location.origin)
   // 例如: https://memento.oddlabcc.cc
   ```

2. 確認 `wrangler.toml` 包含該 Origin：
   ```toml
   vars = { CORS_ALLOWED_ORIGINS = "https://memento.oddlabcc.cc" }
   ```

3. 重新部署

---

### 問題 2: "CORS policy: Credentials flag is 'true', but 'Access-Control-Allow-Credentials' header is ''"

**原因：** 前端設定 `credentials: 'include'` 但後端未回傳對應 header

**已修正：** 現在所有回應都包含 `Access-Control-Allow-Credentials: true`

**前端使用：**
```javascript
fetch('https://memento-api.oddlabcc.cc/events', {
  method: 'POST',
  credentials: 'include', // 會攜帶 cookies
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({...})
})
```

---

### 問題 3: "Request header field xxx is not allowed by Access-Control-Allow-Headers"

**原因：** 使用的 header 不在允許清單中

**已允許的 Headers：**
- `Content-Type`
- `Authorization`
- `X-Requested-With`

**新增自訂 Header：**

編輯 [src/index.ts](../src/index.ts:22)：

```typescript
'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Custom-Header',
```

---

### 問題 4: WebSocket 連線被拒絕

**原因：** WebSocket Origin 檢查失敗

**檢查步驟：**

1. 確認前端 Origin：
   ```javascript
   console.log(window.location.origin)
   ```

2. 檢查 WebSocket 建立時的 Origin：
   ```javascript
   const ws = new WebSocket('wss://memento-api.oddlabcc.cc/events/xxx/ws')
   // 瀏覽器會自動帶上 Origin header
   ```

3. 確認 `CORS_ALLOWED_ORIGINS` 包含該 Origin

**程式碼位置：** [src/index.ts](../src/index.ts:88-94)

---

### 問題 5: 本地開發 CORS 錯誤

**常見情況：**
- 前端在 `http://localhost:5173` (Vite)
- 但 `CORS_ALLOWED_ORIGINS` 只有 `http://localhost:3000`

**解決方法：**

1. 修改 `.dev.vars`：
   ```env
   CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000
   ```

2. 重啟 Wrangler：
   ```bash
   pnpm dev
   ```

---

## 🧪 測試 CORS

### 使用 curl 測試 Preflight

```bash
# Preflight request
curl -X OPTIONS https://memento-api.oddlabcc.cc/events \
  -H "Origin: https://memento.oddlabcc.cc" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v
```

**預期回應：**
```
< HTTP/2 200
< access-control-allow-origin: https://memento.oddlabcc.cc
< access-control-allow-methods: GET, POST, DELETE, OPTIONS
< access-control-allow-headers: Content-Type, Authorization, X-Requested-With
< access-control-allow-credentials: true
< access-control-max-age: 86400
```

### 使用瀏覽器 DevTools

1. 打開 **Network** tab
2. 觀察請求
3. 檢查 **Headers** 區塊：
   - Request Headers: `Origin`
   - Response Headers: `Access-Control-Allow-Origin`

---

## 📋 CORS 檢查清單

部署前確認：

- [ ] `wrangler.toml` 的 `CORS_ALLOWED_ORIGINS` 正確
- [ ] 包含所有需要的前端網域
- [ ] 多個 origin 用逗號分隔（無空格）
- [ ] Production 只允許正式網域
- [ ] Beta 允許測試網域 + localhost
- [ ] WebSocket Origin 檢查啟用

部署後測試：

- [ ] Preflight (OPTIONS) 正常
- [ ] GET/POST/DELETE 請求正常
- [ ] WebSocket 連線正常
- [ ] 瀏覽器 Console 無 CORS 錯誤

---

## 🔐 安全性建議

### ✅ 好的做法

1. **明確指定 Origins** - 不要使用 `*`
2. **使用 HTTPS** - Production 只允許 HTTPS
3. **最小權限原則** - 只允許必要的 Headers 和 Methods
4. **WebSocket 驗證** - 檢查 Origin

### ❌ 避免的做法

```typescript
// ❌ 不要這樣做！
'Access-Control-Allow-Origin': '*'
'Access-Control-Allow-Headers': '*'

// ✅ 應該這樣做
'Access-Control-Allow-Origin': getAllowedOrigin(request, env)
'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
```

---

## 📚 相關資源

- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Cloudflare Workers: CORS](https://developers.cloudflare.com/workers/examples/cors-header-proxy/)
- [WebSocket CORS](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers#cross-origin_security)
