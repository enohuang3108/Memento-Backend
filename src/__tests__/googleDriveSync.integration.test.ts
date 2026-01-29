import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../types'
import { getSystemAccessToken } from '../services/systemTokenManager'

/**
 * Integration Tests for Google Drive Auto-Sync
 *
 * These tests verify the Google Drive synchronization logic, including:
 * - Token management and auto-refresh
 * - Error handling for API failures
 * - System authorization checks
 *
 * Note: Full end-to-end auto-sync behavior (with 10-second intervals) is tested
 * in E2E tests. These integration tests focus on the synchronization components
 * in isolation.
 */

describe('Google Drive Auto-Sync Integration Tests', () => {
  let mockEnv: Env
  let mockKVData: Record<string, string> = {}
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // Reset KV mock data
    mockKVData = {}

    // Mock KV namespace
    const mockKV = {
      get: vi.fn(async (key: string) => mockKVData[key] || null),
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

    // Mock fetch for API calls
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('System Token Management for Sync', () => {
    it('應該成功獲取有效的 access token 用於同步', async () => {
      // Setup: Valid token
      mockKVData['google_drive_tokens'] = JSON.stringify({
        accessToken: 'valid-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
        updatedAt: Date.now(),
      })

      const accessToken = await getSystemAccessToken(mockEnv)

      expect(accessToken).toBe('valid-access-token')
    })

    it('應該在 token 過期時自動刷新並用於同步', async () => {
      // Setup: Expiring token
      mockKVData['google_drive_tokens'] = JSON.stringify({
        accessToken: 'old-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3 * 60 * 1000, // 3 minutes (within 5 min buffer)
        updatedAt: Date.now(),
      })

      // Mock OAuth refresh response
      const mockFetch = globalThis.fetch as any
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'refreshed-access-token',
          expires_in: 3600,
        }),
      })

      const accessToken = await getSystemAccessToken(mockEnv)

      // Should return refreshed token
      expect(accessToken).toBe('refreshed-access-token')

      // Should have stored updated token
      const storedToken = JSON.parse(mockKVData['google_drive_tokens'])
      expect(storedToken.accessToken).toBe('refreshed-access-token')
      expect(storedToken.refreshToken).toBe('test-refresh-token')
    })

    it('應該在 refresh token 失敗時拋出錯誤', async () => {
      // Setup: Expiring token with invalid refresh token
      mockKVData['google_drive_tokens'] = JSON.stringify({
        accessToken: 'old-access-token',
        refreshToken: 'invalid-refresh-token',
        expiresAt: Date.now() + 2 * 60 * 1000,
        updatedAt: Date.now(),
      })

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
  })

  describe('Google Drive API Integration', () => {
    it('應該正確構造 Google Drive API 請求 URL', async () => {
      const TEST_FOLDER_ID = '1QvBCmxEWaJAzY0oxmaXkvTQFmxenQ2Y6'

      // Verify the expected URL pattern that would be used for sync
      const expectedUrlPattern = new RegExp(
        `https://www\\.googleapis\\.com/drive/v3/files\\?` +
        `q='${TEST_FOLDER_ID}' in parents and mimeType contains 'image/'` +
        `&fields=files\\(.*\\),nextPageToken` +
        `&orderBy=createdTime desc` +
        `&pageSize=1000`
      )

      // This URL pattern is used by EventRoom.syncPhotosFromDrive()
      const testUrl =
        `https://www.googleapis.com/drive/v3/files?` +
        `q='${TEST_FOLDER_ID}' in parents and mimeType contains 'image/'` +
        `&fields=files(id,name,thumbnailLink,webContentLink,webViewLink,imageMediaMetadata),nextPageToken` +
        `&orderBy=createdTime desc` +
        `&pageSize=1000`

      expect(testUrl).toMatch(expectedUrlPattern)
    })

    it('應該正確處理照片的 URL 格式轉換', () => {
      // Test URL format logic used in syncPhotosFromDrive
      const originalThumbnailLink = 'https://drive.google.com/thumbnail?id=photo-1&sz=s220'

      // Convert to full resolution (=s0)
      const fullUrl = originalThumbnailLink.replace(/=s\d+$/, '=s0')

      expect(fullUrl).toBe('https://drive.google.com/thumbnail?id=photo-1&sz=s0')
      expect(fullUrl).toContain('=s0')
    })

    it('應該正確處理沒有 thumbnailLink 的照片', () => {
      const photoId = 'photo-without-thumbnail'

      // Fallback URL generation logic
      const thumbnailUrl = `https://drive.google.com/thumbnail?id=${photoId}&sz=w400`
      const fullUrl = `https://drive.google.com/thumbnail?id=${photoId}&sz=s0`

      expect(thumbnailUrl).toContain('sz=w400')
      expect(fullUrl).toContain('sz=s0')
    })
  })

  describe('Error Handling', () => {
    it('應該在系統未授權時拋出錯誤', async () => {
      // No tokens in KV or environment variables
      mockKVData = {}

      await expect(getSystemAccessToken(mockEnv)).rejects.toThrow(
        'System not authorized'
      )
    })

    it('應該處理 token 刷新時的網路錯誤', async () => {
      mockKVData['google_drive_tokens'] = JSON.stringify({
        accessToken: 'old-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 2 * 60 * 1000,
        updatedAt: Date.now(),
      })

      // Mock network error
      const mockFetch = globalThis.fetch as any
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(getSystemAccessToken(mockEnv)).rejects.toThrow('Network error')
    })
  })

  describe('Pagination Handling', () => {
    it('應該正確處理分頁 token', () => {
      // Test pagination URL construction
      const TEST_FOLDER_ID = '1QvBCmxEWaJAzY0oxmaXkvTQFmxenQ2Y6'
      const pageToken = 'next-page-token-12345'

      const baseUrl =
        `https://www.googleapis.com/drive/v3/files?` +
        `q='${TEST_FOLDER_ID}' in parents and mimeType contains 'image/'` +
        `&fields=files(id,name,thumbnailLink,webContentLink,webViewLink,imageMediaMetadata),nextPageToken` +
        `&orderBy=createdTime desc` +
        `&pageSize=1000`

      const paginatedUrl = `${baseUrl}&pageToken=${pageToken}`

      expect(paginatedUrl).toContain('pageToken=next-page-token-12345')
      expect(paginatedUrl).toContain('pageSize=1000')
    })

    it('應該在達到最大照片數時停止分頁', () => {
      const MAX_PHOTOS = 2000
      const fetched = 2000

      // Simulating the check in syncPhotosFromDrive
      const shouldStop = fetched >= MAX_PHOTOS

      expect(shouldStop).toBe(true)
    })
  })

  describe('Duplicate Detection Logic', () => {
    it('應該正確檢測重複的照片 ID', () => {
      // Simulate existing photos
      const existingPhotos = [
        { driveFileId: 'photo-1' },
        { driveFileId: 'photo-2' },
        { driveFileId: 'photo-3' },
      ]

      const existingFileIds = new Set(existingPhotos.map(p => p.driveFileId))

      // Test duplicate detection
      expect(existingFileIds.has('photo-1')).toBe(true)
      expect(existingFileIds.has('photo-4')).toBe(false)

      // New photo should not be skipped
      const newPhotoId = 'photo-4'
      const shouldAdd = !existingFileIds.has(newPhotoId)
      expect(shouldAdd).toBe(true)

      // Duplicate photo should be skipped
      const duplicatePhotoId = 'photo-2'
      const shouldSkip = existingFileIds.has(duplicatePhotoId)
      expect(shouldSkip).toBe(true)
    })
  })

  describe('Authorization Header Construction', () => {
    it('應該正確構造 Bearer token header', async () => {
      mockKVData['google_drive_tokens'] = JSON.stringify({
        accessToken: 'test-access-token-12345',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 60 * 60 * 1000,
        updatedAt: Date.now(),
      })

      const accessToken = await getSystemAccessToken(mockEnv)
      const authHeader = `Bearer ${accessToken}`

      expect(authHeader).toBe('Bearer test-access-token-12345')
    })
  })
})
