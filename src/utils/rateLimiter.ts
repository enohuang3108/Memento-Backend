/**
 * Rate Limiter Utility
 *
 * Provides rate limiting functionality for photo uploads and danmaku messages.
 * Uses sliding window algorithm to track and limit actions within time windows.
 */

export interface RateLimitState {
  photoUploads: number[] // timestamps of recent uploads (keep last 60s)
  danmakuSends: number[] // timestamps of recent danmaku (keep last 10s)
}

export interface RateLimitConfig {
  photoLimit: number // max photos per window
  photoWindow: number // time window in milliseconds
  danmakuLimit: number // max danmaku per window
  danmakuWindow: number // time window in milliseconds
}

export interface RateLimitResult {
  allowed: boolean
  retryAfter?: number // milliseconds until next allowed action
}

/**
 * Default rate limit configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  photoLimit: 20,
  photoWindow: 60000, // 60 seconds
  danmakuLimit: 1,
  danmakuWindow: 2000, // 2 seconds
}

/**
 * Check if an action is allowed based on rate limit state
 */
export function checkRateLimit(
  state: RateLimitState,
  type: 'photo' | 'danmaku',
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
  now: number = Date.now()
): RateLimitResult {
  if (type === 'photo') {
    // Filter recent uploads within the time window
    const recentUploads = state.photoUploads.filter(
      t => now - t < config.photoWindow
    )

    if (recentUploads.length >= config.photoLimit) {
      const oldestUpload = Math.min(...recentUploads)
      return {
        allowed: false,
        retryAfter: config.photoWindow - (now - oldestUpload),
      }
    }
  } else {
    // Filter recent danmaku sends within the time window
    const recentSends = state.danmakuSends.filter(
      t => now - t < config.danmakuWindow
    )

    if (recentSends.length >= config.danmakuLimit) {
      const lastSend = Math.max(...recentSends)
      return {
        allowed: false,
        retryAfter: config.danmakuWindow - (now - lastSend),
      }
    }
  }

  return { allowed: true }
}

/**
 * Record an action and clean up old timestamps
 */
export function recordAction(
  state: RateLimitState,
  type: 'photo' | 'danmaku',
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
  now: number = Date.now()
): RateLimitState {
  const newState = { ...state }

  if (type === 'photo') {
    // Keep only timestamps within the window
    newState.photoUploads = state.photoUploads
      .filter(t => now - t < config.photoWindow)
      .concat(now)
  } else {
    // Keep only timestamps within the window
    newState.danmakuSends = state.danmakuSends
      .filter(t => now - t < config.danmakuWindow)
      .concat(now)
  }

  return newState
}

/**
 * Create a new empty rate limit state
 */
export function createRateLimitState(): RateLimitState {
  return {
    photoUploads: [],
    danmakuSends: [],
  }
}
