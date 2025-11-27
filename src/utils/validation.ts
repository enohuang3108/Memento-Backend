import type { ClientMessage } from '../types';
import { containsProfanity } from './profanityFilter';

export function validatePhotoMessage(
  message: Extract<ClientMessage, { type: 'photo_added' }>
): { valid: boolean; error?: string } {
  if (!message.driveFileId || typeof message.driveFileId !== 'string') {
    return { valid: false, error: 'Invalid driveFileId' }
  }

  if (!message.thumbnailUrl || !isValidUrl(message.thumbnailUrl)) {
    return { valid: false, error: 'Invalid thumbnailUrl' }
  }

  if (!message.fullUrl || !isValidUrl(message.fullUrl)) {
    return { valid: false, error: 'Invalid fullUrl' }
  }

  if (message.width !== undefined && (!Number.isInteger(message.width) || message.width <= 0)) {
    return { valid: false, error: 'Invalid width' }
  }

  if (message.height !== undefined && (!Number.isInteger(message.height) || message.height <= 0)) {
    return { valid: false, error: 'Invalid height' }
  }

  return { valid: true }
}

/**
 * Validate photo upload data
 */
export function validatePhotoUpload(photo: {
  driveFileId?: string
  thumbnailUrl?: string
  fullUrl?: string
}): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!photo.driveFileId || !/^[\w-]{20,}$/.test(photo.driveFileId)) {
    errors.push('Invalid Google Drive file ID')
  }

  if (!photo.thumbnailUrl || !photo.thumbnailUrl.startsWith('https://')) {
    errors.push('Invalid thumbnail URL')
  }

  if (!photo.fullUrl || !photo.fullUrl.startsWith('https://')) {
    errors.push('Invalid full URL')
  }

  return { valid: errors.length === 0, errors }
}

export function validateDanmakuMessage(
  message: Extract<ClientMessage, { type: 'danmaku' }>
): { valid: boolean; error?: string } {
  if (!message.content || typeof message.content !== 'string') {
    return { valid: false, error: '彈幕內容不可為空' }
  }

  if (message.content.length > 50) {
    return { valid: false, error: '彈幕長度不可超過 50 字元' }
  }

  if (containsProfanity(message.content)) {
    return { valid: false, error: '彈幕包含不當內容，請修改後重試' }
  }

  return { valid: true }
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
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

  if (containsProfanity(content)) {
    errors.push('Danmaku contains inappropriate content')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate activity ID format (6 digits)
 */
export function validateActivityId(id: string): boolean {
  return /^[a-zA-Z0-9-_]+$/.test(id)
}

/**
 * Validate Google Drive Folder ID format
 * Google Drive folder IDs are typically 33-44 characters of alphanumeric, underscore, and hyphen
 */
export function validateDriveFolderId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{25,}$/.test(id)
}
