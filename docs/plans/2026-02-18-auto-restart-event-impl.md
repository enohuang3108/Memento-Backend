# Auto-Restart Event Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 確保 Production 部署後，原本有效的活動 URL 能自動恢復並正常運作。

**Architecture:** 在後端調用 DO 時，將已解密的 `driveFolderId` 作為 query parameter 傳遞，讓 DO 的 `autoRestartEvent()` 能確定性地恢復活動，而不依賴可能被清空的 storage 或 undefined 的 `state.id.name`。

**Tech Stack:** TypeScript, Cloudflare Workers, Durable Objects

---

## Task 1: 修改 autoRestartEvent() 接受參數

**Files:**
- Modify: `backend/src/durableObjects/EventRoom.ts:861-910`

**Step 1: 修改 autoRestartEvent 函數簽名**

找到 `autoRestartEvent()` 函數（約第 861 行），修改為接受可選的 `providedDriveFolderId` 參數：

```typescript
/**
 * Auto-restart event from persisted storage or Durable Object name
 */
private async autoRestartEvent(providedDriveFolderId?: string | null): Promise<void> {
  try {
    // Priority: provided > storage > DO name
    let driveFolderId = providedDriveFolderId
      || await this.state.storage.get<string>('driveFolderId')
      || this.state.id.name

    console.log(`[EventRoom] Attempting auto-restart:`)
    console.log(`[EventRoom]   - Provided driveFolderId: "${providedDriveFolderId}"`)
    console.log(`[EventRoom]   - DO id: ${this.state.id.toString()}`)
    console.log(`[EventRoom]   - DO name: "${this.state.id.name}"`)
    console.log(`[EventRoom]   - Persisted driveFolderId: "${await this.state.storage.get<string>('driveFolderId')}"`)
    console.log(`[EventRoom]   - Using: "${driveFolderId}"`)

    if (!driveFolderId) {
      console.error('[EventRoom] Cannot auto-restart: no driveFolderId found in storage or DO name')
      return
    }

    console.log(`[EventRoom] Auto-restarting event from driveFolderId: ${driveFolderId}`)

    // Get folder name from Google Drive as title
    let folderName: string | undefined
    try {
      const accessToken = await getSystemAccessToken(this.env)
      folderName = await getFolderName(driveFolderId, accessToken)
    } catch (error) {
      console.error('[EventRoom] Failed to get folder name:', error)
      // Continue without title if folder name fetch fails
    }

    // Reinitialize the event with encrypted ID
    this.event = {
      id: encryptId(driveFolderId), // Use encrypted ID for public use
      title: folderName,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      status: 'active',
      driveFolderId: driveFolderId,
      photoCount: 0,
      participantCount: 0,
    }

    // Persist driveFolderId for future recovery
    await this.state.storage.put('driveFolderId', driveFolderId)

    console.log(`[EventRoom] Event auto-restarted successfully: ${this.event.id}`)
  } catch (error) {
    console.error('[EventRoom] Failed to auto-restart event:', error)
  }
}
```

**Step 2: 執行 TypeScript 檢查**

Run: `cd /Users/huai/side_project/memento/backend && pnpm typecheck`
Expected: 無錯誤

**Step 3: Commit**

```bash
cd /Users/huai/side_project/memento/backend && git add src/durableObjects/EventRoom.ts && git commit -m "refactor: autoRestartEvent 接受可選的 driveFolderId 參數"
```

---

## Task 2: 修改 handleGetEvent() 傳遞 driveFolderId

**Files:**
- Modify: `backend/src/durableObjects/EventRoom.ts:129-158`

**Step 1: 修改 handleGetEvent 接受 request 參數**

找到 `handleGetEvent()` 函數（約第 129 行），修改為從 URL 取得 driveFolderId：

```typescript
/**
 * Get current event state
 */
private async handleGetEvent(request: Request): Promise<Response> {
  // Extract driveFolderId from query parameter
  const url = new URL(request.url)
  const driveFolderId = url.searchParams.get('driveFolderId')

  console.log(`[EventRoom] handleGetEvent called, event exists: ${this.event !== null}, driveFolderId: ${driveFolderId}`)

  // Auto-restart if event is null
  if (!this.event) {
    console.log(`[EventRoom] Event is null, attempting auto-restart...`)
    await this.autoRestartEvent(driveFolderId)
    console.log(`[EventRoom] Auto-restart completed, event exists: ${this.event !== null}`)
  }

  if (!this.event) {
    console.error(`[EventRoom] Event still null after auto-restart, returning 404`)
    return new Response(
      JSON.stringify({ error: 'Event not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Update participant count
  this.event.participantCount = this.sessionMetadata.size

  return new Response(
    JSON.stringify({
      event: this.event,
      photos: this.photos,
      activeConnections: this.sessions.size,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}
```

**Step 2: 確認 fetch() 方法呼叫處有傳遞 request**

檢查 `fetch()` 方法（約第 44 行）中對 `handleGetEvent` 的呼叫，確認已傳遞 request：

```typescript
// 在 fetch() 方法中，找到處理 GET 請求的部分
if (request.method === 'GET' && url.pathname === '/') {
  return this.handleGetEvent(request)  // 確保傳遞 request
}
```

**Step 3: 執行 TypeScript 檢查**

Run: `cd /Users/huai/side_project/memento/backend && pnpm typecheck`
Expected: 無錯誤

**Step 4: Commit**

```bash
cd /Users/huai/side_project/memento/backend && git add src/durableObjects/EventRoom.ts && git commit -m "feat: handleGetEvent 從 URL 取得 driveFolderId 並傳遞給 autoRestartEvent"
```

---

## Task 3: 修改 handleWebSocketUpgrade() 傳遞 driveFolderId

**Files:**
- Modify: `backend/src/durableObjects/EventRoom.ts:262-279`

**Step 1: 修改 handleWebSocketUpgrade 從 URL 取得 driveFolderId**

找到 `handleWebSocketUpgrade()` 函數（約第 262 行），修改為從 URL 取得 driveFolderId：

```typescript
/**
 * Handle WebSocket upgrade
 */
private async handleWebSocketUpgrade(request: Request): Promise<Response> {
  // Extract driveFolderId from query parameter
  const url = new URL(request.url)
  const driveFolderId = url.searchParams.get('driveFolderId')

  // Auto-restart if event is null (DO was evicted)
  if (!this.event) {
    await this.autoRestartEvent(driveFolderId)
  }

  if (!this.event) {
    return new Response('Event not found', { status: 404 })
  }

  // Auto-restart ended events when reconnecting
  if (this.event.status === 'ended') {
    console.log(`[EventRoom] Auto-restarting ended event: ${this.event.id}`)
    this.event.status = 'active'
    // Extend expiration time by 24 hours
    this.event.expiresAt = Date.now() + 24 * 60 * 60 * 1000
  }

  // ... rest of the method unchanged
```

**Step 2: 執行 TypeScript 檢查**

Run: `cd /Users/huai/side_project/memento/backend && pnpm typecheck`
Expected: 無錯誤

**Step 3: Commit**

```bash
cd /Users/huai/side_project/memento/backend && git add src/durableObjects/EventRoom.ts && git commit -m "feat: handleWebSocketUpgrade 從 URL 取得 driveFolderId"
```

---

## Task 4: 修改 getEvent handler 傳遞 driveFolderId

**Files:**
- Modify: `backend/src/handlers/events.ts:123-127`

**Step 1: 修改 doRequest 加入 driveFolderId query parameter**

找到 `getEvent()` 函數（約第 110 行），修改 `doRequest` 建立方式：

```typescript
// Get event from DO (with driveFolderId for auto-restart)
const doRequest = new Request(
  `http://internal/?driveFolderId=${encodeURIComponent(internalId)}`,
  { method: 'GET' }
)
```

**Step 2: 執行 TypeScript 檢查**

Run: `cd /Users/huai/side_project/memento/backend && pnpm typecheck`
Expected: 無錯誤

**Step 3: Commit**

```bash
cd /Users/huai/side_project/memento/backend && git add src/handlers/events.ts && git commit -m "feat: getEvent handler 傳遞 driveFolderId 給 DO"
```

---

## Task 5: 修改 WebSocket 路由傳遞 driveFolderId

**Files:**
- Modify: `backend/src/index.ts:108-110`

**Step 1: 修改 WebSocket 請求加入 driveFolderId query parameter**

找到 WebSocket 處理部分（約第 89 行），修改傳遞給 DO 的請求：

```typescript
const durableObjectId = env.EVENT_ROOM.idFromName(internalId)
const stub = env.EVENT_ROOM.get(durableObjectId)

// Add driveFolderId to request URL for auto-restart
const url = new URL(request.url)
url.searchParams.set('driveFolderId', internalId)
const requestWithFolderId = new Request(url.toString(), request)

return stub.fetch(requestWithFolderId)
```

**Step 2: 執行 TypeScript 檢查**

Run: `cd /Users/huai/side_project/memento/backend && pnpm typecheck`
Expected: 無錯誤

**Step 3: Commit**

```bash
cd /Users/huai/side_project/memento/backend && git add src/index.ts && git commit -m "feat: WebSocket 路由傳遞 driveFolderId 給 DO"
```

---

## Task 6: 本地測試

**Step 1: 啟動本地開發環境**

Run: `cd /Users/huai/side_project/memento/backend && pnpm dev`

**Step 2: 建立測試活動**

使用 curl 或 Postman 建立一個活動，記下返回的 `event.id`（加密 ID）。

**Step 3: 重啟 dev server**

停止並重新啟動 `pnpm dev`，模擬 DO 狀態丟失。

**Step 4: 存取活動**

用活動的加密 ID 存取 `GET /events/:activityId`，確認活動能正常恢復。

**Step 5: Commit 所有改動（如果有遺漏）**

```bash
cd /Users/huai/side_project/memento/backend && git status
```

---

## Task 7: 部署到 Beta 測試

**Step 1: 部署到 Beta**

Run: `cd /Users/huai/side_project/memento/backend && pnpm deploy:beta`

**Step 2: 建立測試活動**

在 Beta 環境建立活動並記下 URL。

**Step 3: 重新部署**

再次執行 `pnpm deploy:beta`，模擬 DO 狀態丟失。

**Step 4: 驗證活動恢復**

用原本的 URL 存取活動，確認能正常顯示。

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | 修改 autoRestartEvent 接受參數 | EventRoom.ts |
| 2 | 修改 handleGetEvent 傳遞 driveFolderId | EventRoom.ts |
| 3 | 修改 handleWebSocketUpgrade 傳遞 driveFolderId | EventRoom.ts |
| 4 | 修改 getEvent handler | events.ts |
| 5 | 修改 WebSocket 路由 | index.ts |
| 6 | 本地測試 | - |
| 7 | 部署到 Beta 測試 | - |
