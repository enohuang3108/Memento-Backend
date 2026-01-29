import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSystemAccessToken, isSystemAuthorized } from '../services/systemTokenManager'
import type { Env } from '../types'

/**
 * Integration Tests for System Token Manager
 *
 * Tests token management from KV storage, auto-refresh logic,
 * and fallback to environment variables.
 */

describe('System Token Manager Integration Tests', () => {
  let mockEnv: Env
  let mockKVData: Record<string, string> = {}
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // Reset KV mock data
    mockKVData = {}

    // Mock KV namespace
    const mockKV = {
      get: vi.fn(async (key: string) => {
        return mockKVData[key] || null
      }),
      put: vi.fn(async (key: string, value: string) => {
        mockKVData[key] = value
      }),
    }

    // Mock environment
    mockEnv = {
      SYSTEM_TOKENS: mockKV as any,
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      EVENT_ROOM: {} as any,
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    } as Env

    // Mock fetch for OAuth API calls
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('getSystemAccessToken', () => {
    it('應該從 KV 正確讀取有效的 access token', async () => {
      // Setup: Store valid token in KV (expires in 1 hour)
      const validToken = {
        refreshToken: 'test-refresh-token',
        accessToken: 'test-access-token',
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
        updatedAt: Date.now(),
      }
      mockKVData['google_drive_tokens'] = JSON.stringify(validToken)

      const accessToken = await getSystemAccessToken(mockEnv)

      expect(accessToken).toBe('test-access-token')
      expect(mockEnv.SYSTEM_TOKENS!.get).toHaveBeenCalledWith('google_drive_tokens')
    })

    it('應該在 token 過期前 5 分鐘自動刷新', async () => {
      // Setup: Token expires in 3 minutes (within 5 min buffer)
      const expiringToken = {
        refreshToken: 'test-refresh-token',
        accessToken: 'old-access-token',
        expiresAt: Date.now() + 3 * 60 * 1000, // 3 minutes from now
        updatedAt: Date.now() - 60 * 60 * 1000, // Updated 1 hour ago
      }
      mockKVData['google_drive_tokens'] = JSON.stringify(expiringToken)

      // Mock OAuth refresh response
      const mockFetch = globalThis.fetch as any
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          expires_in: 3600,
        }),
      })

      const accessToken = await getSystemAccessToken(mockEnv)

      // Should return new token
      expect(accessToken).toBe('new-access-token')

      // Should have called refresh endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      )

      // Should have stored updated token in KV
      expect(mockEnv.SYSTEM_TOKENS!.put).toHaveBeenCalled()
      const storedData = JSON.parse(mockKVData['google_drive_tokens'])
      expect(storedData.accessToken).toBe('new-access-token')
      expect(storedData.refreshToken).toBe('test-refresh-token')
    })

    it('應該在 refresh token 失敗時拋出錯誤', async () => {
      // Setup: Expiring token
      const expiringToken = {
        refreshToken: 'invalid-refresh-token',
        accessToken: 'old-access-token',
        expiresAt: Date.now() + 2 * 60 * 1000, // 2 minutes from now
        updatedAt: Date.now(),
      }
      mockKVData['google_drive_tokens'] = JSON.stringify(expiringToken)

      // Mock OAuth refresh failure
      const mockFetch = globalThis.fetch as any
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Invalid refresh token',
      })

      await expect(getSystemAccessToken(mockEnv)).rejects.toThrow(
        'Failed to refresh token'
      )
    })

    it('應該在沒有 refresh token 時拋出錯誤', async () => {
      // Setup: Token without refresh token
      const tokenWithoutRefresh = {
        accessToken: 'old-access-token',
        expiresAt: Date.now() + 2 * 60 * 1000, // 2 minutes from now
        updatedAt: Date.now(),
      }
      mockKVData['google_drive_tokens'] = JSON.stringify(tokenWithoutRefresh)

      await expect(getSystemAccessToken(mockEnv)).rejects.toThrow(
        'No refresh token available'
      )
    })

    it('應該在沒有 token 時拋出錯誤', async () => {
      // No tokens in KV
      mockKVData = {}

      await expect(getSystemAccessToken(mockEnv)).rejects.toThrow(
        'System not authorized'
      )
    })

    it('應該從環境變數 fallback 讀取 token', async () => {
      // No tokens in KV, but environment variables are set
      mockKVData = {}

      const envWithTokens = {
        ...mockEnv,
        SYSTEM_GOOGLE_ACCESS_TOKEN: 'env-access-token',
        SYSTEM_GOOGLE_REFRESH_TOKEN: 'env-refresh-token',
        SYSTEM_GOOGLE_TOKEN_EXPIRY: String(Date.now() + 60 * 60 * 1000), // 1 hour
      } as Env

      const accessToken = await getSystemAccessToken(envWithTokens)

      expect(accessToken).toBe('env-access-token')
    })

    it('應該在環境變數沒有 expiry 時使用預設值', async () => {
      // No tokens in KV, environment variables without expiry
      mockKVData = {}

      const envWithTokens = {
        ...mockEnv,
        SYSTEM_GOOGLE_ACCESS_TOKEN: 'env-access-token',
        SYSTEM_GOOGLE_REFRESH_TOKEN: 'env-refresh-token',
        // No SYSTEM_GOOGLE_TOKEN_EXPIRY
      } as Env

      const accessToken = await getSystemAccessToken(envWithTokens)

      expect(accessToken).toBe('env-access-token')
      // Should not throw, uses default expiry (1 hour from now)
    })
  })

  describe('isSystemAuthorized', () => {
    it('應該在有 KV token 時返回 true', async () => {
      const validToken = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 60 * 60 * 1000,
        updatedAt: Date.now(),
      }
      mockKVData['google_drive_tokens'] = JSON.stringify(validToken)

      const isAuthorized = await isSystemAuthorized(mockEnv)

      expect(isAuthorized).toBe(true)
    })

    it('應該在有環境變數 token 時返回 true', async () => {
      mockKVData = {}

      const envWithTokens = {
        ...mockEnv,
        SYSTEM_GOOGLE_ACCESS_TOKEN: 'env-access-token',
      } as Env

      const isAuthorized = await isSystemAuthorized(envWithTokens)

      expect(isAuthorized).toBe(true)
    })

    it('應該在沒有 token 時返回 false', async () => {
      mockKVData = {}

      const isAuthorized = await isSystemAuthorized(mockEnv)

      expect(isAuthorized).toBe(false)
    })

    it('應該在 access token 為空時返回 false', async () => {
      const invalidToken = {
        accessToken: '',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 60 * 60 * 1000,
        updatedAt: Date.now(),
      }
      mockKVData['google_drive_tokens'] = JSON.stringify(invalidToken)

      const isAuthorized = await isSystemAuthorized(mockEnv)

      expect(isAuthorized).toBe(false)
    })
  })

  describe('Token Refresh Integration', () => {
    it('應該正確更新 token 並寫回 KV', async () => {
      // Setup: Token that needs refresh
      const oldToken = {
        refreshToken: 'test-refresh-token',
        accessToken: 'old-access-token',
        expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes (within 5 min buffer)
        updatedAt: Date.now() - 30 * 60 * 1000, // Updated 30 minutes ago
      }
      mockKVData['google_drive_tokens'] = JSON.stringify(oldToken)

      // Mock OAuth refresh response
      const mockFetch = globalThis.fetch as any
      const newExpiresIn = 3600 // 1 hour
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'refreshed-access-token',
          expires_in: newExpiresIn,
        }),
      })

      const beforeRefresh = Date.now()
      const accessToken = await getSystemAccessToken(mockEnv)
      const afterRefresh = Date.now()

      // Verify token was refreshed
      expect(accessToken).toBe('refreshed-access-token')

      // Verify updated token was stored in KV
      const storedToken = JSON.parse(mockKVData['google_drive_tokens'])
      expect(storedToken.accessToken).toBe('refreshed-access-token')
      expect(storedToken.refreshToken).toBe('test-refresh-token')
      expect(storedToken.expiresAt).toBeGreaterThanOrEqual(
        beforeRefresh + newExpiresIn * 1000
      )
      expect(storedToken.expiresAt).toBeLessThanOrEqual(
        afterRefresh + newExpiresIn * 1000
      )
      expect(storedToken.updatedAt).toBeGreaterThanOrEqual(beforeRefresh)
      expect(storedToken.updatedAt).toBeLessThanOrEqual(afterRefresh)
    })

    it('應該在多次呼叫時重用有效 token', async () => {
      // Setup: Valid token
      const validToken = {
        refreshToken: 'test-refresh-token',
        accessToken: 'valid-access-token',
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
        updatedAt: Date.now(),
      }
      mockKVData['google_drive_tokens'] = JSON.stringify(validToken)

      const mockFetch = globalThis.fetch as any

      // Call getSystemAccessToken multiple times
      const token1 = await getSystemAccessToken(mockEnv)
      const token2 = await getSystemAccessToken(mockEnv)
      const token3 = await getSystemAccessToken(mockEnv)

      // Should return same token without refresh
      expect(token1).toBe('valid-access-token')
      expect(token2).toBe('valid-access-token')
      expect(token3).toBe('valid-access-token')

      // Should not have called refresh API
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
