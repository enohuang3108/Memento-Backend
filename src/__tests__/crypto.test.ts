import { describe, expect, it } from 'vitest'
import { encryptId, decryptId } from '../utils/crypto'

describe('Crypto Utils', () => {
  describe('encryptId', () => {
    it('應該加密 ID 字串', () => {
      const original = '12345'
      const encrypted = encryptId(original)

      expect(encrypted).toBeTruthy()
      expect(encrypted).not.toBe(original)
      expect(typeof encrypted).toBe('string')
    })

    it('應該產生 URL-safe 字串 (不包含 +, /, =)', () => {
      const testIds = [
        '12345',
        'event-abc-123',
        '01JFKSDJFKS8382KD',
        'very-long-id-that-could-cause-base64-padding-issues-12345678',
      ]

      testIds.forEach((id) => {
        const encrypted = encryptId(id)
        expect(encrypted).not.toMatch(/\+/)
        expect(encrypted).not.toMatch(/\//)
        expect(encrypted).not.toMatch(/=$/)
      })
    })

    it('應該對相同輸入產生相同輸出 (一致性)', () => {
      const original = 'test-id-123'
      const encrypted1 = encryptId(original)
      const encrypted2 = encryptId(original)

      expect(encrypted1).toBe(encrypted2)
    })

    it('應該對不同輸入產生不同輸出', () => {
      const id1 = 'event-1'
      const id2 = 'event-2'

      const encrypted1 = encryptId(id1)
      const encrypted2 = encryptId(id2)

      expect(encrypted1).not.toBe(encrypted2)
    })

    it('應該處理空字串', () => {
      const encrypted = encryptId('')
      expect(encrypted).toBe('')
    })

    it('應該處理特殊字元', () => {
      const specialIds = [
        'id-with-dashes',
        'id_with_underscores',
        'id.with.dots',
        'id@with#special$chars',
      ]

      specialIds.forEach((id) => {
        const encrypted = encryptId(id)
        const decrypted = decryptId(encrypted)
        expect(decrypted).toBe(id)
      })
    })
  })

  describe('decryptId', () => {
    it('應該正確解密加密過的 ID', () => {
      const original = '12345'
      const encrypted = encryptId(original)
      const decrypted = decryptId(encrypted)

      expect(decrypted).toBe(original)
    })

    it('應該處理各種長度的 ID', () => {
      const testIds = [
        'a',
        'ab',
        'abc',
        'short-id',
        'medium-length-id-123456',
        'very-long-id-that-should-still-work-correctly-with-encryption-and-decryption',
      ]

      testIds.forEach((id) => {
        const encrypted = encryptId(id)
        const decrypted = decryptId(encrypted)
        expect(decrypted).toBe(id)
      })
    })

    it('應該處理 ULID 格式 ID', () => {
      // ULID 格式: 01JFKSDJFKS8382KD (26 字元)
      const ulid = '01JFKSDJFKS8382KD'
      const encrypted = encryptId(ulid)
      const decrypted = decryptId(encrypted)

      expect(decrypted).toBe(ulid)
    })

    it('應該對無效的 Base64 字串返回空字串', () => {
      const invalidStrings = [
        '!!!',
        '@#$%',
        '====', // 只有 padding
      ]

      invalidStrings.forEach((invalid) => {
        const decrypted = decryptId(invalid)
        // 這些會觸發 atob 錯誤,返回空字串
        expect(decrypted).toBe('')
      })
    })

    it('應該處理看似有效但非加密的字串（返回非預期結果）', () => {
      // 這些字串是有效的 Base64,但不是我們加密的
      // decryptId 不會拋錯,但解密結果不會等於原始輸入
      const notEncryptedButValidBase64 = 'dGVzdA' // "test" 的 Base64

      const decrypted = decryptId(notEncryptedButValidBase64)
      // 不應該等於原始字串（因為沒經過我們的加密流程）
      expect(decrypted).not.toBe('dGVzdA')
    })

    it('應該處理空字串', () => {
      const decrypted = decryptId('')
      expect(decrypted).toBe('')
    })

    it('應該處理已經 URL-safe 編碼的字串', () => {
      const original = 'test-event-id'
      const encrypted = encryptId(original)

      // 確保加密結果是 URL-safe 的
      expect(encrypted).toMatch(/^[A-Za-z0-9_-]+$/)

      const decrypted = decryptId(encrypted)
      expect(decrypted).toBe(original)
    })
  })

  describe('加密解密往返測試', () => {
    it('應該成功完成加密解密往返 (ASCII 字元)', () => {
      const testCases = [
        'simple',
        '123456789',
        'event-with-dashes',
        'event_with_underscores',
        'UPPERCASE',
        'MixedCase123',
        '01JFKSDJFKS8382KD', // ULID
        'a'.repeat(100), // 長字串
        'special!@#$%',
      ]

      testCases.forEach((original) => {
        const encrypted = encryptId(original)
        const decrypted = decryptId(encrypted)
        expect(decrypted).toBe(original)
      })
    })

    it('多次加密解密應該保持一致', () => {
      const original = 'test-id'

      for (let i = 0; i < 10; i++) {
        const encrypted = encryptId(original)
        const decrypted = decryptId(encrypted)
        expect(decrypted).toBe(original)
      }
    })
  })
})
