/**
 * Event Model
 * Represents a single activity/event
 */

export interface Event {
  // Identification
  id: string // 6-digit activity code (e.g., "123456")

  // Basic info
  title?: string // Optional event title (max 100 chars)
  createdAt: number // Unix timestamp
  expiresAt?: number // Optional expiration (default: 24 hours)

  // Status
  status: 'active' | 'ended'

  // Google Drive integration
  driveFolderId?: string // Optional Drive folder ID for organizer

  // Statistics (computed in-memory)
  photoCount: number
  participantCount: number
}

/**
 * Validate event data
 */
export function validateEvent(event: Partial<Event>): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!event.id || !/^\d{6}$/.test(event.id)) {
    errors.push('Invalid event ID: must be 6-digit string')
  }

  if (event.title && event.title.length > 100) {
    errors.push('Title exceeds 100 characters')
  }

  if (event.createdAt && event.createdAt < 0) {
    errors.push('Invalid createdAt timestamp')
  }

  if (event.expiresAt && event.createdAt && event.expiresAt <= event.createdAt) {
    errors.push('expiresAt must be after createdAt')
  }

  if (event.status && !['active', 'ended'].includes(event.status)) {
    errors.push('Invalid status: must be "active" or "ended"')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Create a new event object with defaults
 */
export function createEvent(data: {
  id: string
  title?: string
  driveFolderId?: string
}): Event {
  return {
    id: data.id,
    title: data.title,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    status: 'active',
    driveFolderId: data.driveFolderId,
    photoCount: 0,
    participantCount: 0,
  }
}
