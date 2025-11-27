/**
 * DanmakuMessage Model
 * Ephemeral message that is NOT stored (only transmitted)
 */

export interface DanmakuMessage {
  // Identification
  id: string // ULID (time-sortable)

  // Content
  content: string // Message text (1-50 chars)

  // Source info
  activityId: string // Which event
  sessionId: string // Who sent it

  // Metadata
  timestamp: number // Unix timestamp
}

/**
 * Validate danmaku content
 */
export function validateDanmakuContent(content: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!content || content.trim().length === 0) {
    errors.push('Danmaku content cannot be empty')
  }

  if (content.length > 50) {
    errors.push('Danmaku content exceeds 50 characters')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Create a new danmaku message object
 * Note: This is for transmission only - NOT stored
 */
export function createDanmakuMessage(data: {
  id: string
  content: string
  activityId: string
  sessionId: string
}): DanmakuMessage {
  return {
    id: data.id,
    content: data.content.trim(),
    activityId: data.activityId,
    sessionId: data.sessionId,
    timestamp: Date.now(),
  }
}
