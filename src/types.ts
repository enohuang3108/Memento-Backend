// Core domain types based on data-model.md

export interface Event {
  id: string // Encrypted activity code (public ID)
  title?: string
  createdAt: number
  expiresAt?: number
  status: 'active' | 'ended'
  driveFolderId: string // Required: Google Drive folder ID for photo storage
  displayPassword?: string // 6-digit password for Display access control
  photoCount: number
  participantCount: number
}

export interface Photo {
  id: string // ULID
  activityId: string
  sessionId: string
  driveFileId: string
  thumbnailUrl: string
  fullUrl: string
  uploadedAt: number
  width?: number
  height?: number
}

export interface DanmakuMessage {
  id: string // ULID
  content: string
  sessionId: string
  timestamp: number
}

export interface ParticipantSession {
  id: string // UUID v4
  activityId: string
  joinedAt: number
  role: 'participant' | 'display'
  isActive: boolean
}

// WebSocket message types
export type ClientMessage =
  | { type: 'join'; sessionId: string; role: 'participant' | 'display' }
  | { type: 'photo_added'; driveFileId: string; thumbnailUrl: string; fullUrl: string; width?: number; height?: number }
  | { type: 'danmaku'; content: string }
  | { type: 'ping' }

export type ServerMessage =
  | { type: 'joined'; activityId: string; photos: Photo[]; timestamp: number; playlist?: Photo[]; currentIndex?: number }
  | { type: 'photo_added'; photo: Photo }
  | { type: 'play_photo'; photo: Photo; index: number; total: number; timestamp: number }
  | { type: 'danmaku'; id: string; content: string; sessionId: string; timestamp: number }
  | { type: 'activity_ended'; activityId: string; reason: string; timestamp: number }
  | { type: 'pong'; timestamp: number }
  | { type: 'error'; code: string; message: string; retryAfter?: number }

// API request/response types
export interface CreateEventRequest {
  title?: string
  driveFolderId: string // Required: Google Drive folder ID for photo storage
}

export interface CreateEventResponse {
  event: Event
  qrCodeUrl: string
}

export interface AddPhotoRequest {
  driveFileId: string
  thumbnailUrl: string
  fullUrl: string
  sessionId: string
  width?: number
  height?: number
}

export interface AddPhotoResponse {
  photo: Photo
}

export interface GetPhotosResponse {
  photos: Photo[]
  total: number
  hasMore: boolean
}

export interface ActivityStatistics {
  activityId: string
  photoCount: number
  participantCount: number
  activeConnections: number
  totalDanmakuSent: number
}

export interface ApiError {
  error: string
  message: string
  details?: Record<string, unknown>
}

// Cloudflare Workers environment bindings
export interface Env {
  EVENT_ROOM: DurableObjectNamespace
  CORS_ALLOWED_ORIGINS?: string

  // Google OAuth 2.0 credentials
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  // System-level tokens (stored in KV or secrets)
  SYSTEM_TOKENS?: KVNamespace
  SYSTEM_GOOGLE_REFRESH_TOKEN?: string
  SYSTEM_GOOGLE_ACCESS_TOKEN?: string
  SYSTEM_GOOGLE_TOKEN_EXPIRY?: string
}

// Re-export Cloudflare Workers types
import type {
  DurableObjectNamespace as DONamespace,
  DurableObjectState as DOState,
  KVNamespace as KVNs
} from '@cloudflare/workers-types'

export type DurableObjectNamespace = DONamespace
export type DurableObjectState<T = Record<string, never>> = DOState<T>
export type KVNamespace = KVNs
