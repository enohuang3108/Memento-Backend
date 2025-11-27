/**
 * ParticipantSession Model
 * Temporary participant identification for tracking and rate limiting
 */

export interface ParticipantSession {
  // Identification
  id: string // UUID v4

  // Event association
  activityId: string // Which event the participant joined

  // Connection info
  connectedAt: number // When they connected (Unix timestamp)
  lastActivityAt: number // Last action timestamp
  isConnected: boolean // WebSocket connection status

  // Rate limiting tracking
  photoUploads: number[] // Array of upload timestamps (keep last 60 seconds)
  danmakuSends: number[] // Array of send timestamps (keep last 10 seconds)
}

/**
 * Validate session ID
 */
export function validateSessionId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
}

/**
 * Create a new participant session
 */
export function createSession(data: {
  id: string
  activityId: string
}): ParticipantSession {
  return {
    id: data.id,
    activityId: data.activityId,
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
    isConnected: true,
    photoUploads: [],
    danmakuSends: [],
  }
}

/**
 * Check rate limit for photo uploads
 * Limit: 20 photos per 60 seconds
 */
export function checkPhotoRateLimit(session: ParticipantSession): {
  allowed: boolean
  retryAfter?: number
} {
  const now = Date.now()
  const window = 60000 // 60 seconds

  // Filter recent uploads (last 60 seconds)
  const recentUploads = session.photoUploads.filter((t) => now - t < window)

  if (recentUploads.length >= 20) {
    const oldestUpload = Math.min(...recentUploads)
    return {
      allowed: false,
      retryAfter: window - (now - oldestUpload),
    }
  }

  return { allowed: true }
}

/**
 * Check rate limit for danmaku sends
 * Limit: 1 danmaku per 2 seconds
 */
export function checkDanmakuRateLimit(session: ParticipantSession): {
  allowed: boolean
  retryAfter?: number
} {
  const now = Date.now()
  const window = 2000 // 2 seconds

  // Filter recent sends (last 2 seconds)
  const recentSends = session.danmakuSends.filter((t) => now - t < window)

  if (recentSends.length >= 1) {
    const lastSend = Math.max(...recentSends)
    return {
      allowed: false,
      retryAfter: window - (now - lastSend),
    }
  }

  return { allowed: true }
}

/**
 * Record a photo upload timestamp
 */
export function recordPhotoUpload(session: ParticipantSession): void {
  const now = Date.now()
  session.photoUploads.push(now)

  // Clean up old timestamps (keep last 60 seconds)
  const window = 60000
  session.photoUploads = session.photoUploads.filter((t) => now - t < window)

  session.lastActivityAt = now
}

/**
 * Record a danmaku send timestamp
 */
export function recordDanmakuSend(session: ParticipantSession): void {
  const now = Date.now()
  session.danmakuSends.push(now)

  // Clean up old timestamps (keep last 10 seconds)
  const window = 10000
  session.danmakuSends = session.danmakuSends.filter((t) => now - t < window)

  session.lastActivityAt = now
}
