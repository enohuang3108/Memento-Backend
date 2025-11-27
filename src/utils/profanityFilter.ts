// Basic profanity filter with blacklist
// Implements requirement FR-015: 彈幕訊息必須通過基本敏感詞過濾

const BLACKLIST = new Set([
  // Add traditional Chinese profanity words here
  // This is a basic implementation - production should use a comprehensive list
  '幹',
  '操',
  '靠北',
  '白癡',
  '笨蛋',
  '垃圾',
  'fuck',
  'shit',
  'damn',
])

/**
 * Check if content contains profanity
 * @param content Text to check
 * @returns True if profanity detected
 */
export function containsProfanity(content: string): boolean {
  const normalized = content.toLowerCase().trim()
  
  for (const word of BLACKLIST) {
    if (normalized.includes(word.toLowerCase())) {
      return true
    }
  }
  
  return false
}

/**
 * Filter profanity from content (replace with asterisks)
 * @param content Text to filter
 * @returns Filtered text and clean status
 */
export function filterProfanity(content: string): { clean: boolean; filtered: string } {
  let filtered = content
  let clean = true

  for (const word of BLACKLIST) {
    const regex = new RegExp(word, 'gi')
    if (regex.test(filtered)) {
      clean = false
      filtered = filtered.replace(regex, '*'.repeat(word.length))
    }
  }

  return { clean, filtered }
}

/**
 * Validate danmaku content
 * @param content Text to validate
 * @returns Validation result
 */
export function validateDanmaku(content: string): {
  valid: boolean
  error?: string
} {
  // Length validation: 1-50 characters
  if (content.length === 0) {
    return { valid: false, error: '彈幕內容不可為空' }
  }
  
  if (content.length > 50) {
    return { valid: false, error: '彈幕長度不可超過 50 字元' }
  }
  
  // Profanity check
  if (containsProfanity(content)) {
    return { valid: false, error: '彈幕包含不當內容，請修改後重試' }
  }
  
  return { valid: true }
}
