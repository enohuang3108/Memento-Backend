- 永遠使用繁體中文回答
- spec 永遠使用繁體中文
- 使用 pnpm
- 使用 Tailwind CSS, eslint, vite, vitest
- Function Programming

## 專案架構 (Memento)

### 前端 (Frontend)

- **框架**: React 19, TanStack Start (SSR), TanStack Router, TanStack Query
- **樣式**: Tailwind CSS v4
- **部署**: Cloudflare Workers (Git Integration)
  - **Production**: `main` branch -> `memento.oddlabcc.cc`
  - **Beta**: `beta` branch -> `beta.memento.oddlabcc.cc`
- **目錄**: 根目錄 (Root)

### 後端 (Backend)

- **平台**: Cloudflare Workers
- **核心技術**:
  - **Durable Objects**: 處理 WebSocket 連線與活動房間狀態 (`EventRoom`)
  - **KV**: 儲存系統 Token (`SYSTEM_TOKENS`)
- **部署**: GitHub Actions (Tag-based)
  - **Production**: Tag `v*` -> `memento-api.oddlab.cc`
  - **Beta**: Tag `v*b*` -> `beta.memento-api.oddlab.cc`
- **目錄**: `/workers`

### 開發流程

- **啟動全端開發**: `pnpm dev:all` (同時啟動前端與後端 Worker)
- **前端開發**: `pnpm dev`
- **後端開發**: `pnpm dev:workers`

## Active Technologies

- TypeScript 5.x, React 19 (001-event-photo-wall)

## Recent Changes

- 001-event-photo-wall: Added TypeScript 5.x, React 19
- Renamed project from SnapWall to Memento
- Migrated to Hybrid Deployment (Pages for Frontend, Workers for Backend)
