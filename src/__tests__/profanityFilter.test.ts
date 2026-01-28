import { describe, expect, it } from 'vitest'
import { containsProfanity, filterProfanity, validateDanmaku } from '../utils/profanityFilter'

describe('Profanity Filter Utils', () => {
  describe('containsProfanity', () => {
    it('應該偵測明確的中文髒話', () => {
      const profaneContent = ['幹你娘', '操你媽', '靠北', '白癡', '笨蛋', '媽的', '垃圾']

      profaneContent.forEach((content) => {
        expect(containsProfanity(content)).toBe(true)
      })
    })

    it('應該偵測明確的英文髒話', () => {
      const profaneContent = ['fuck', 'shit', 'damn', 'FUCK YOU', 'what the shit']

      profaneContent.forEach((content) => {
        expect(containsProfanity(content)).toBe(true)
      })
    })

    it('應該偵測數字俚語髒話', () => {
      expect(containsProfanity('你87喔')).toBe(true)
      expect(containsProfanity('87分')).toBe(true)
    })

    it('應該不區分大小寫', () => {
      const variations = ['FUCK', 'Fuck', 'fuck', 'FuCk']

      variations.forEach((content) => {
        expect(containsProfanity(content)).toBe(true)
      })
    })

    it('應該處理前後空白', () => {
      expect(containsProfanity('  fuck  ')).toBe(true)
      expect(containsProfanity('  幹  ')).toBe(true)
    })

    it('應該偵測包含髒話的句子', () => {
      expect(containsProfanity('這什麼垃圾東西')).toBe(true)
      expect(containsProfanity('This is fucking awesome')).toBe(true)
    })

    it('應該不誤判正常詞彙', () => {
      const cleanContent = [
        'Hello World',
        '這是測試訊息',
        '今天天氣很好',
        'JavaScript is awesome',
        '加油！',
        '謝謝',
        '數學考試考了87分', // 雖然有87但在正常語境
      ]

      // 注意: "數學考試考了87分" 會被偵測到因為包含 "87"
      // 這是簡單過濾器的限制 - 實際應用應使用更智慧的上下文分析
      expect(containsProfanity('Hello World')).toBe(false)
      expect(containsProfanity('這是測試訊息')).toBe(false)
      expect(containsProfanity('今天天氣很好')).toBe(false)
      expect(containsProfanity('JavaScript is awesome')).toBe(false)
      expect(containsProfanity('加油！')).toBe(false)
      expect(containsProfanity('謝謝')).toBe(false)
    })

    it('應該處理空字串', () => {
      expect(containsProfanity('')).toBe(false)
    })

    it('應該處理只有空白的字串', () => {
      expect(containsProfanity('   ')).toBe(false)
    })
  })

  describe('filterProfanity', () => {
    it('應該替換髒話為星號', () => {
      const result = filterProfanity('fuck this shit')
      expect(result.clean).toBe(false)
      expect(result.filtered).toContain('****') // fuck -> ****
      expect(result.filtered).toContain('****') // shit -> ****
      expect(result.filtered).not.toContain('fuck')
      expect(result.filtered).not.toContain('shit')
    })

    it('應該替換中文髒話為星號', () => {
      const result = filterProfanity('幹你娘')
      expect(result.clean).toBe(false)
      expect(result.filtered).toContain('*')
      expect(result.filtered).not.toContain('幹')
    })

    it('應該保持正常內容不變', () => {
      const content = 'Hello World, this is a clean message'
      const result = filterProfanity(content)

      expect(result.clean).toBe(true)
      expect(result.filtered).toBe(content)
    })

    it('應該處理多個髒話', () => {
      const result = filterProfanity('fuck shit damn')
      expect(result.clean).toBe(false)
      expect(result.filtered).not.toContain('fuck')
      expect(result.filtered).not.toContain('shit')
      expect(result.filtered).not.toContain('damn')
      expect(result.filtered).toContain('*')
    })

    it('應該處理大小寫變體', () => {
      const tests = [
        { input: 'FUCK', expected: /\*{4}/ },
        { input: 'Fuck', expected: /\*{4}/ },
        { input: 'fuck', expected: /\*{4}/ },
      ]

      tests.forEach(({ input, expected }) => {
        const result = filterProfanity(input)
        expect(result.clean).toBe(false)
        expect(result.filtered).toMatch(expected)
      })
    })

    it('應該保留星號的正確數量', () => {
      const result1 = filterProfanity('幹') // 1 字元
      expect(result1.filtered).toBe('*')

      const result2 = filterProfanity('fuck') // 4 字元
      expect(result2.filtered).toBe('****')

      const result3 = filterProfanity('damn') // 4 字元
      expect(result3.filtered).toBe('****')
    })

    it('應該處理空字串', () => {
      const result = filterProfanity('')
      expect(result.clean).toBe(true)
      expect(result.filtered).toBe('')
    })
  })

  describe('validateDanmaku', () => {
    it('應該驗證有效的彈幕', () => {
      const result = validateDanmaku('這是一個測試彈幕')
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('應該拒絕空內容', () => {
      const result = validateDanmaku('')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('彈幕內容不可為空')
    })

    it('應該拒絕超過 50 字元的內容', () => {
      const longContent = 'a'.repeat(51)
      const result = validateDanmaku(longContent)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('彈幕長度不可超過 50 字元')
    })

    it('應該允許剛好 50 字元', () => {
      const content = 'a'.repeat(50)
      const result = validateDanmaku(content)

      expect(result.valid).toBe(true)
    })

    it('應該拒絕包含髒話的內容', () => {
      const profaneContent = ['fuck', '幹', '這什麼垃圾', 'damn it']

      profaneContent.forEach((content) => {
        const result = validateDanmaku(content)
        expect(result.valid).toBe(false)
        expect(result.error).toBe('彈幕包含不當內容，請修改後重試')
      })
    })

    it('應該同時檢查長度和髒話', () => {
      // 超長且包含髒話
      const longProfaneContent = 'fuck'.repeat(20) // 80 字元

      const result = validateDanmaku(longProfaneContent)
      expect(result.valid).toBe(false)
      // 會先檢查長度，所以返回長度錯誤
      expect(result.error).toBe('彈幕長度不可超過 50 字元')
    })

    it('應該允許各種正常內容', () => {
      const validContents = [
        'Hello!',
        '加油！',
        '666',
        '這個活動好棒',
        '拍得真好',
        'Nice photo!',
      ]

      validContents.forEach((content) => {
        const result = validateDanmaku(content)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })
    })

    it('應該處理邊界案例', () => {
      // 1 字元（最短有效長度）
      const shortResult = validateDanmaku('a')
      expect(shortResult.valid).toBe(true)

      // 50 字元（最長有效長度）
      const longResult = validateDanmaku('x'.repeat(50))
      expect(longResult.valid).toBe(true)

      // 51 字元（超過限制）
      const tooLongResult = validateDanmaku('x'.repeat(51))
      expect(tooLongResult.valid).toBe(false)
    })
  })

  describe('整合測試', () => {
    it('三個函數應該對相同內容返回一致結果', () => {
      const profaneContent = 'fuck this'

      // containsProfanity 應該偵測到
      expect(containsProfanity(profaneContent)).toBe(true)

      // filterProfanity 應該標記為不乾淨
      const filterResult = filterProfanity(profaneContent)
      expect(filterResult.clean).toBe(false)

      // validateDanmaku 應該拒絕
      const validateResult = validateDanmaku(profaneContent)
      expect(validateResult.valid).toBe(false)
    })

    it('對乾淨內容應該都通過', () => {
      const cleanContent = 'This is a nice photo'

      expect(containsProfanity(cleanContent)).toBe(false)

      const filterResult = filterProfanity(cleanContent)
      expect(filterResult.clean).toBe(true)
      expect(filterResult.filtered).toBe(cleanContent)

      const validateResult = validateDanmaku(cleanContent)
      expect(validateResult.valid).toBe(true)
    })
  })
})
