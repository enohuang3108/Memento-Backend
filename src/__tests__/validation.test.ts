import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  validatePhotoMessage,
  validatePhotoUpload,
  validateDanmakuMessage,
  validateDanmakuContent,
  validateActivityId,
  validateDriveFolderId,
} from '../utils/validation'
import * as profanityFilter from '../utils/profanityFilter'

// Mock profanityFilter
vi.mock('../utils/profanityFilter', () => ({
  containsProfanity: vi.fn((content: string) => {
    const badWords = ['fuck', 'shit', '幹']
    return badWords.some((word) => content.toLowerCase().includes(word))
  }),
}))

describe('Validation Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('validatePhotoMessage', () => {
    it('應該驗證有效的照片訊息', () => {
      const message = {
        type: 'photo_added' as const,
        driveFileId: '1abc123def456ghi789',
        thumbnailUrl: 'https://drive.google.com/thumbnail/abc',
        fullUrl: 'https://drive.google.com/file/abc',
        width: 1920,
        height: 1080,
      }

      const result = validatePhotoMessage(message)
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('應該拒絕缺少 driveFileId 的訊息', () => {
      const message = {
        type: 'photo_added' as const,
        driveFileId: '',
        thumbnailUrl: 'https://drive.google.com/thumbnail/abc',
        fullUrl: 'https://drive.google.com/file/abc',
      }

      const result = validatePhotoMessage(message)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid driveFileId')
    })

    it('應該拒絕無效的 thumbnailUrl', () => {
      const message = {
        type: 'photo_added' as const,
        driveFileId: '1abc123def456ghi789',
        thumbnailUrl: 'not-a-url',
        fullUrl: 'https://drive.google.com/file/abc',
      }

      const result = validatePhotoMessage(message)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid thumbnailUrl')
    })

    it('應該拒絕無效的 fullUrl', () => {
      const message = {
        type: 'photo_added' as const,
        driveFileId: '1abc123def456ghi789',
        thumbnailUrl: 'https://drive.google.com/thumbnail/abc',
        fullUrl: '',
      }

      const result = validatePhotoMessage(message)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid fullUrl')
    })

    it('應該拒絕無效的 width', () => {
      const message = {
        type: 'photo_added' as const,
        driveFileId: '1abc123def456ghi789',
        thumbnailUrl: 'https://drive.google.com/thumbnail/abc',
        fullUrl: 'https://drive.google.com/file/abc',
        width: -100,
      }

      const result = validatePhotoMessage(message)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid width')
    })

    it('應該拒絕無效的 height', () => {
      const message = {
        type: 'photo_added' as const,
        driveFileId: '1abc123def456ghi789',
        thumbnailUrl: 'https://drive.google.com/thumbnail/abc',
        fullUrl: 'https://drive.google.com/file/abc',
        height: 0,
      }

      const result = validatePhotoMessage(message)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid height')
    })

    it('應該允許不提供 width 和 height', () => {
      const message = {
        type: 'photo_added' as const,
        driveFileId: '1abc123def456ghi789',
        thumbnailUrl: 'https://drive.google.com/thumbnail/abc',
        fullUrl: 'https://drive.google.com/file/abc',
      }

      const result = validatePhotoMessage(message)
      expect(result.valid).toBe(true)
    })
  })

  describe('validatePhotoUpload', () => {
    it('應該驗證有效的照片上傳資料', () => {
      const photo = {
        driveFileId: '1abcdefghijklmnopqrstuvwxyz',
        thumbnailUrl: 'https://drive.google.com/thumbnail/abc',
        fullUrl: 'https://drive.google.com/file/abc',
      }

      const result = validatePhotoUpload(photo)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('應該拒絕無效的 Google Drive File ID', () => {
      const invalidIds = ['', 'tooshort', '123', 'invalid id with spaces']

      invalidIds.forEach((driveFileId) => {
        const result = validatePhotoUpload({
          driveFileId,
          thumbnailUrl: 'https://example.com/thumb',
          fullUrl: 'https://example.com/full',
        })

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Invalid Google Drive file ID')
      })
    })

    it('應該拒絕非 HTTPS 的 thumbnailUrl', () => {
      const invalidUrls = ['http://example.com/thumb', 'ftp://example.com/thumb', 'not-a-url']

      invalidUrls.forEach((thumbnailUrl) => {
        const result = validatePhotoUpload({
          driveFileId: '1abcdefghijklmnopqrstuvwxyz',
          thumbnailUrl,
          fullUrl: 'https://example.com/full',
        })

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Invalid thumbnail URL')
      })
    })

    it('應該拒絕非 HTTPS 的 fullUrl', () => {
      const result = validatePhotoUpload({
        driveFileId: '1abcdefghijklmnopqrstuvwxyz',
        thumbnailUrl: 'https://example.com/thumb',
        fullUrl: 'http://example.com/full',
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Invalid full URL')
    })

    it('應該返回所有錯誤', () => {
      const result = validatePhotoUpload({
        driveFileId: 'bad',
        thumbnailUrl: 'http://example.com',
        fullUrl: 'not-a-url',
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(3)
    })
  })

  describe('validateDanmakuMessage', () => {
    it('應該驗證有效的彈幕訊息', () => {
      const message = {
        type: 'danmaku' as const,
        content: '這是一個測試彈幕',
      }

      const result = validateDanmakuMessage(message)
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('應該拒絕空內容', () => {
      const message = {
        type: 'danmaku' as const,
        content: '',
      }

      const result = validateDanmakuMessage(message)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('彈幕內容不可為空')
    })

    it('應該拒絕超過 50 字元的內容', () => {
      const message = {
        type: 'danmaku' as const,
        content: 'a'.repeat(51),
      }

      const result = validateDanmakuMessage(message)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('彈幕長度不可超過 50 字元')
    })

    it('應該拒絕包含髒話的內容', () => {
      const message = {
        type: 'danmaku' as const,
        content: 'this is shit',
      }

      const result = validateDanmakuMessage(message)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('彈幕包含不當內容，請修改後重試')
    })

    it('應該允許剛好 50 字元的內容', () => {
      const message = {
        type: 'danmaku' as const,
        content: 'a'.repeat(50),
      }

      const result = validateDanmakuMessage(message)
      expect(result.valid).toBe(true)
    })
  })

  describe('validateDanmakuContent', () => {
    it('應該驗證有效的彈幕內容', () => {
      const result = validateDanmakuContent('Hello World')
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('應該拒絕空內容', () => {
      const result = validateDanmakuContent('')
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Danmaku content cannot be empty')
    })

    it('應該拒絕只有空白的內容', () => {
      const result = validateDanmakuContent('   ')
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Danmaku content cannot be empty')
    })

    it('應該拒絕超過 50 字元', () => {
      const result = validateDanmakuContent('x'.repeat(51))
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Danmaku content exceeds 50 characters')
    })

    it('應該拒絕包含髒話', () => {
      const result = validateDanmakuContent('what the fuck')
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Danmaku contains inappropriate content')
    })

    it('應該返回所有錯誤', () => {
      const result = validateDanmakuContent('fuck ' + 'x'.repeat(50))
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(1)
    })
  })

  describe('validateActivityId', () => {
    it('應該接受有效的活動 ID', () => {
      const validIds = [
        'abc123',
        'ABC123',
        'event-123',
        'event_456',
        'MixedCase-ID_123',
        '01JFKSDJFKS8382KD', // ULID
      ]

      validIds.forEach((id) => {
        expect(validateActivityId(id)).toBe(true)
      })
    })

    it('應該拒絕包含特殊字元的 ID', () => {
      const invalidIds = ['id with spaces', 'id@invalid', 'id#123', 'id.test', 'id/test']

      invalidIds.forEach((id) => {
        expect(validateActivityId(id)).toBe(false)
      })
    })

    it('應該拒絕空字串', () => {
      expect(validateActivityId('')).toBe(false)
    })
  })

  describe('validateDriveFolderId', () => {
    it('應該接受有效的 Google Drive Folder ID', () => {
      const validIds = [
        '1QvBCmxEWaJAzY0oxmaXkvTQFmxenQ2Y6', // 實際的 Folder ID (33 字元)
        '1' + 'a'.repeat(24), // 最短 (25 字元)
        '1' + 'a'.repeat(50), // 更長的 ID
        '1_abc-def_123-456_xyz-abc', // 包含 _ 和 - (25 字元)
      ]

      validIds.forEach((id) => {
        expect(validateDriveFolderId(id)).toBe(true)
      })
    })

    it('應該拒絕太短的 ID (< 25 字元)', () => {
      const invalidIds = ['', '123', 'abc123', '1' + 'a'.repeat(23)] // 24 字元

      invalidIds.forEach((id) => {
        expect(validateDriveFolderId(id)).toBe(false)
      })
    })

    it('應該拒絕包含無效字元的 ID', () => {
      const invalidIds = [
        '1abc def 123 456 789 012 345', // 包含空格
        '1@abc#def$123%456&789', // 特殊字元
        '1abc.def.123.456.789.012.345', // 句點
      ]

      invalidIds.forEach((id) => {
        expect(validateDriveFolderId(id)).toBe(false)
      })
    })
  })
})
