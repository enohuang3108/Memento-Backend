/**
 * Photo Model
 * Reference to a photo stored in Google Drive
 */

export interface Photo {
  // Identification
  id: string // ULID (time-sortable)

  // Source info
  activityId: string // Which event this photo belongs to
  sessionId: string // Who uploaded it

  // Google Drive reference
  driveFileId: string // Google Drive file ID
  thumbnailUrl: string // Thumbnail URL from Drive
  fullUrl: string // Full image URL from Drive

  // Metadata
  uploadedAt: number // Unix timestamp
  width?: number // Image width in pixels
  height?: number // Image height in pixels
}

/**
 * Validate photo data
 */
export function validatePhoto(photo: Partial<Photo>): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!photo.id || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(photo.id)) {
    errors.push('Invalid photo ID: must be valid ULID')
  }

  if (!photo.activityId || !/^\d{6}$/.test(photo.activityId)) {
    errors.push('Invalid activityId: must be 6-digit string')
  }

  if (!photo.sessionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(photo.sessionId)) {
    errors.push('Invalid sessionId: must be UUID v4')
  }

  if (!photo.driveFileId || !/^[\w-]{20,}$/.test(photo.driveFileId)) {
    errors.push('Invalid Google Drive file ID')
  }

  if (!photo.thumbnailUrl || !photo.thumbnailUrl.startsWith('https://')) {
    errors.push('Invalid thumbnail URL: must be HTTPS')
  }

  if (!photo.fullUrl || !photo.fullUrl.startsWith('https://')) {
    errors.push('Invalid full URL: must be HTTPS')
  }

  if (photo.width !== undefined && photo.width <= 0) {
    errors.push('Width must be positive number')
  }

  if (photo.height !== undefined && photo.height <= 0) {
    errors.push('Height must be positive number')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Create a new photo object
 */
export function createPhoto(data: {
  id: string
  activityId: string
  sessionId: string
  driveFileId: string
  thumbnailUrl: string
  fullUrl: string
  width?: number
  height?: number
}): Photo {
  return {
    id: data.id,
    activityId: data.activityId,
    sessionId: data.sessionId,
    driveFileId: data.driveFileId,
    thumbnailUrl: data.thumbnailUrl,
    fullUrl: data.fullUrl,
    uploadedAt: Date.now(),
    width: data.width,
    height: data.height,
  }
}
