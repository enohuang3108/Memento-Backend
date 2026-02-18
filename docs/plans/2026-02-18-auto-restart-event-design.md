# Auto-Restart Event Design

## Problem

當 Production 環境部署新版本後，原本有效的活動 URL 會顯示 404 錯誤「找不到活動」。

### 根本原因

目前的 `autoRestartEvent()` 依賴以下來源恢復 `driveFolderId`：
1. `this.state.storage.get('driveFolderId')` - 可能在部署後被清空
2. `this.state.id.name` - 可能為 `undefined`

但後端的 `getEvent()` handler 已經成功解密出 `driveFolderId`，卻沒有傳遞給 DO。

## Solution

在後端調用 DO 時，將已解密的 `driveFolderId` 作為 query parameter 傳遞，讓 DO 能確定性地恢復活動。

## Design

### 1. handlers/events.ts - getEvent()

```typescript
// Before
const doRequest = new Request('http://internal/', { method: 'GET' })

// After
const doRequest = new Request(
  `http://internal/?driveFolderId=${encodeURIComponent(internalId)}`,
  { method: 'GET' }
)
```

### 2. handlers/events.ts - connectEventWebSocket()

```typescript
// Before
return stub.fetch(upgradeRequest)

// After
const url = new URL(upgradeRequest.url)
url.searchParams.set('driveFolderId', internalId)
const newRequest = new Request(url.toString(), upgradeRequest)
return stub.fetch(newRequest)
```

### 3. durableObjects/EventRoom.ts - handleGetEvent()

```typescript
private async handleGetEvent(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const driveFolderId = url.searchParams.get('driveFolderId')

  if (!this.event) {
    console.log(`[EventRoom] Event is null, attempting auto-restart...`)
    await this.autoRestartEvent(driveFolderId)
  }
  // ... rest of the method
}
```

### 4. durableObjects/EventRoom.ts - handleWebSocketUpgrade()

```typescript
private async handleWebSocketUpgrade(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const driveFolderId = url.searchParams.get('driveFolderId')

  if (!this.event) {
    await this.autoRestartEvent(driveFolderId)
  }
  // ... rest of the method
}
```

### 5. durableObjects/EventRoom.ts - autoRestartEvent()

```typescript
private async autoRestartEvent(providedDriveFolderId?: string | null): Promise<void> {
  try {
    // Priority: provided > storage > DO name
    let driveFolderId = providedDriveFolderId
      || await this.state.storage.get<string>('driveFolderId')
      || this.state.id.name

    console.log(`[EventRoom] Attempting auto-restart:`)
    console.log(`[EventRoom]   - Provided driveFolderId: "${providedDriveFolderId}"`)
    console.log(`[EventRoom]   - Persisted driveFolderId: "${await this.state.storage.get<string>('driveFolderId')}"`)
    console.log(`[EventRoom]   - DO name: "${this.state.id.name}"`)
    console.log(`[EventRoom]   - Using: "${driveFolderId}"`)

    if (!driveFolderId) {
      console.error('[EventRoom] Cannot auto-restart: no driveFolderId found')
      return
    }

    // ... rest of the method (unchanged)
  } catch (error) {
    console.error('[EventRoom] Failed to auto-restart event:', error)
  }
}
```

## Files to Modify

1. `backend/src/handlers/events.ts`
   - `getEvent()` - 傳遞 driveFolderId
   - `connectEventWebSocket()` - 傳遞 driveFolderId

2. `backend/src/durableObjects/EventRoom.ts`
   - `handleGetEvent()` - 從 URL 取得 driveFolderId
   - `handleWebSocketUpgrade()` - 從 URL 取得 driveFolderId
   - `autoRestartEvent()` - 接受 driveFolderId 參數

## Testing

1. 建立一個活動
2. 重新部署 Worker（模擬 DO 狀態丟失）
3. 用原本的 URL 存取活動
4. 驗證活動能自動恢復並顯示

## Rollback Plan

如果出現問題，可以直接 revert commit，因為改動是向後相容的。
