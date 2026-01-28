import { describe, expect, it } from 'vitest'
import {
  checkRateLimit,
  createRateLimitState,
  recordAction,
  DEFAULT_RATE_LIMIT_CONFIG,
  type RateLimitConfig,
  type RateLimitState,
} from '../utils/rateLimiter'

describe('Rate Limiter', () => {
  describe('createRateLimitState', () => {
    it('應該建立空的 rate limit state', () => {
      const state = createRateLimitState()

      expect(state).toEqual({
        photoUploads: [],
        danmakuSends: [],
      })
    })
  })

  describe('checkRateLimit - Photo', () => {
    it('應該允許第一次照片上傳', () => {
      const state = createRateLimitState()
      const result = checkRateLimit(state, 'photo')

      expect(result.allowed).toBe(true)
      expect(result.retryAfter).toBeUndefined()
    })

    it('應該允許在限制內的照片上傳 (19次)', () => {
      const state = createRateLimitState()
      const now = Date.now()

      // 模擬 19 次上傳
      for (let i = 0; i < 19; i++) {
        state.photoUploads.push(now - i * 1000)
      }

      const result = checkRateLimit(state, 'photo', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(result.allowed).toBe(true)
    })

    it('應該拒絕 60 秒內超過 20 次的照片上傳', () => {
      const state = createRateLimitState()
      const now = Date.now()

      // 模擬 20 次上傳 (達到限制)
      for (let i = 0; i < 20; i++) {
        state.photoUploads.push(now - i * 1000) // 每秒一次
      }

      const result = checkRateLimit(state, 'photo', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBeDefined()
      expect(result.retryAfter).toBeGreaterThan(0)
    })

    it('應該正確計算 retryAfter 時間', () => {
      const state = createRateLimitState()
      const now = Date.now()
      const photoWindow = DEFAULT_RATE_LIMIT_CONFIG.photoWindow // 60000ms

      // 模擬 20 次上傳,最舊的在 50 秒前
      for (let i = 0; i < 20; i++) {
        state.photoUploads.push(now - 50000 - i * 100)
      }

      const result = checkRateLimit(state, 'photo', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(result.allowed).toBe(false)
      // 最舊的上傳在 51.9 秒前,所以應該等待約 8.1 秒 (60秒 - 51.9秒)
      expect(result.retryAfter).toBeGreaterThan(8000)
      expect(result.retryAfter).toBeLessThanOrEqual(8200)
    })

    it('應該在時間窗口過後允許新的上傳', () => {
      const state = createRateLimitState()
      const now = Date.now()

      // 模擬 20 次上傳,但都在 61 秒前 (超出時間窗口)
      for (let i = 0; i < 20; i++) {
        state.photoUploads.push(now - 61000 - i * 1000)
      }

      const result = checkRateLimit(state, 'photo', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(result.allowed).toBe(true)
    })

    it('應該支援自訂的 rate limit 設定', () => {
      const state = createRateLimitState()
      const now = Date.now()
      const customConfig: RateLimitConfig = {
        photoLimit: 5,
        photoWindow: 10000, // 10 seconds
        danmakuLimit: 1,
        danmakuWindow: 2000,
      }

      // 模擬 5 次上傳
      for (let i = 0; i < 5; i++) {
        state.photoUploads.push(now - i * 1000)
      }

      const result = checkRateLimit(state, 'photo', customConfig, now)

      expect(result.allowed).toBe(false)
    })
  })

  describe('checkRateLimit - Danmaku', () => {
    it('應該允許第一次彈幕發送', () => {
      const state = createRateLimitState()
      const result = checkRateLimit(state, 'danmaku')

      expect(result.allowed).toBe(true)
      expect(result.retryAfter).toBeUndefined()
    })

    it('應該拒絕 2 秒內的重複彈幕發送', () => {
      const state = createRateLimitState()
      const now = Date.now()

      // 模擬 1 秒前發送過彈幕
      state.danmakuSends.push(now - 1000)

      const result = checkRateLimit(state, 'danmaku', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBeDefined()
      expect(result.retryAfter).toBeGreaterThan(0)
    })

    it('應該正確計算彈幕的 retryAfter 時間', () => {
      const state = createRateLimitState()
      const now = Date.now()

      // 1.5 秒前發送過彈幕
      state.danmakuSends.push(now - 1500)

      const result = checkRateLimit(state, 'danmaku', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(result.allowed).toBe(false)
      // 應該等待約 0.5 秒 (2秒 - 1.5秒)
      expect(result.retryAfter).toBeGreaterThan(400)
      expect(result.retryAfter).toBeLessThanOrEqual(500)
    })

    it('應該在 2 秒後允許新的彈幕發送', () => {
      const state = createRateLimitState()
      const now = Date.now()

      // 2.1 秒前發送過彈幕 (超出時間窗口)
      state.danmakuSends.push(now - 2100)

      const result = checkRateLimit(state, 'danmaku', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(result.allowed).toBe(true)
    })

    it('應該支援自訂的彈幕 rate limit 設定', () => {
      const state = createRateLimitState()
      const now = Date.now()
      const customConfig: RateLimitConfig = {
        photoLimit: 20,
        photoWindow: 60000,
        danmakuLimit: 1,
        danmakuWindow: 5000, // 5 seconds
      }

      // 4 秒前發送過彈幕
      state.danmakuSends.push(now - 4000)

      const result = checkRateLimit(state, 'danmaku', customConfig, now)

      expect(result.allowed).toBe(false)
    })
  })

  describe('recordAction - Photo', () => {
    it('應該記錄照片上傳時間戳', () => {
      const state = createRateLimitState()
      const now = Date.now()

      const newState = recordAction(state, 'photo', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(newState.photoUploads).toHaveLength(1)
      expect(newState.photoUploads[0]).toBe(now)
    })

    it('應該清理超出時間窗口的舊時間戳', () => {
      const state = createRateLimitState()
      const now = Date.now()

      // 新增一些舊的時間戳
      state.photoUploads = [
        now - 70000, // 70 秒前 (應該被清理)
        now - 50000, // 50 秒前 (保留)
        now - 30000, // 30 秒前 (保留)
      ]

      const newState = recordAction(state, 'photo', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(newState.photoUploads).toHaveLength(3) // 2 個舊的 + 1 個新的
      expect(newState.photoUploads).not.toContain(now - 70000)
      expect(newState.photoUploads).toContain(now - 50000)
      expect(newState.photoUploads).toContain(now - 30000)
      expect(newState.photoUploads).toContain(now)
    })

    it('應該保持不可變性 (不修改原始 state)', () => {
      const state = createRateLimitState()
      const now = Date.now()

      state.photoUploads = [now - 10000]
      const originalLength = state.photoUploads.length

      const newState = recordAction(state, 'photo', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(state.photoUploads).toHaveLength(originalLength)
      expect(newState.photoUploads).toHaveLength(originalLength + 1)
    })
  })

  describe('recordAction - Danmaku', () => {
    it('應該記錄彈幕發送時間戳', () => {
      const state = createRateLimitState()
      const now = Date.now()

      const newState = recordAction(state, 'danmaku', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(newState.danmakuSends).toHaveLength(1)
      expect(newState.danmakuSends[0]).toBe(now)
    })

    it('應該清理超出時間窗口的舊時間戳', () => {
      const state = createRateLimitState()
      const now = Date.now()

      // 新增一些舊的時間戳
      state.danmakuSends = [
        now - 5000, // 5 秒前 (應該被清理)
        now - 1500, // 1.5 秒前 (保留)
        now - 500,  // 0.5 秒前 (保留)
      ]

      const newState = recordAction(state, 'danmaku', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(newState.danmakuSends).toHaveLength(3) // 2 個舊的 + 1 個新的
      expect(newState.danmakuSends).not.toContain(now - 5000)
      expect(newState.danmakuSends).toContain(now - 1500)
      expect(newState.danmakuSends).toContain(now - 500)
      expect(newState.danmakuSends).toContain(now)
    })

    it('應該保持不可變性 (不修改原始 state)', () => {
      const state = createRateLimitState()
      const now = Date.now()

      state.danmakuSends = [now - 1000]
      const originalLength = state.danmakuSends.length

      const newState = recordAction(state, 'danmaku', DEFAULT_RATE_LIMIT_CONFIG, now)

      expect(state.danmakuSends).toHaveLength(originalLength)
      expect(newState.danmakuSends).toHaveLength(originalLength + 1)
    })
  })

  describe('整合場景測試', () => {
    it('應該正確處理多次照片上傳的完整流程', () => {
      let state = createRateLimitState()
      const startTime = Date.now()

      // 模擬 25 次上傳嘗試
      for (let i = 0; i < 25; i++) {
        const now = startTime + i * 2000 // 每 2 秒一次

        const checkResult = checkRateLimit(state, 'photo', DEFAULT_RATE_LIMIT_CONFIG, now)

        if (checkResult.allowed) {
          state = recordAction(state, 'photo', DEFAULT_RATE_LIMIT_CONFIG, now)
        }
      }

      // 前 20 次應該成功,後 5 次應該失敗
      expect(state.photoUploads.length).toBeLessThanOrEqual(20)
    })

    it('應該正確處理多次彈幕發送的完整流程', () => {
      let state = createRateLimitState()
      const startTime = Date.now()

      let successCount = 0

      // 模擬 5 次發送嘗試,每次間隔 1 秒
      for (let i = 0; i < 5; i++) {
        const now = startTime + i * 1000

        const checkResult = checkRateLimit(state, 'danmaku', DEFAULT_RATE_LIMIT_CONFIG, now)

        if (checkResult.allowed) {
          state = recordAction(state, 'danmaku', DEFAULT_RATE_LIMIT_CONFIG, now)
          successCount++
        }
      }

      // 每 2 秒只能發送 1 次,所以 5 秒內應該最多成功 3 次
      expect(successCount).toBeLessThanOrEqual(3)
    })

    it('應該在達到限制後,時間窗口過後恢復正常', () => {
      let state = createRateLimitState()
      const startTime = Date.now()

      // 第一次上傳 20 張照片
      for (let i = 0; i < 20; i++) {
        const now = startTime + i * 1000
        state = recordAction(state, 'photo', DEFAULT_RATE_LIMIT_CONFIG, now)
      }

      // 此時應該被限制
      const blockedResult = checkRateLimit(
        state,
        'photo',
        DEFAULT_RATE_LIMIT_CONFIG,
        startTime + 20000
      )
      expect(blockedResult.allowed).toBe(false)

      // 61 秒後應該恢復
      const allowedResult = checkRateLimit(
        state,
        'photo',
        DEFAULT_RATE_LIMIT_CONFIG,
        startTime + 61000
      )
      expect(allowedResult.allowed).toBe(true)
    })
  })
})
