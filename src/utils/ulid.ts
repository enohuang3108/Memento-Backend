/**
 * ULID (Universally Unique Lexicographically Sortable Identifier) utilities
 * Uses the ulid package for generating time-sortable unique IDs
 */

import { ulid } from 'ulid'

/**
 * Generate a ULID
 * @returns 26-character time-sortable unique ID
 */
export function generateULID(): string {
  return ulid()
}

/**
 * Validate ULID format
 * @param id String to validate
 * @returns True if valid ULID format
 */
export function isValidULID(id: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)
}
