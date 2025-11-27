/**
 * Generate a deterministic 6-digit activity ID
 * Uses current timestamp with random component for collision resistance
 * @returns 6-digit numeric string
 */
export function generateActivityId(): string {
  // Use timestamp modulo + random for uniqueness
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 1000)
  const combined = (timestamp + random) % 1000000
  
  return combined.toString().padStart(6, '0')
}

/**
 * Validate activity ID format
 * @param id String to validate
 * @returns True if valid 6-digit format
 */
export function isValidActivityId(id: string): boolean {
  return /^\d{6}$/.test(id)
}

/**
 * Generate a ULID (time-sortable unique ID)
 */
export function generateULID(): string {
  const timestamp = Date.now()
  const randomness = crypto.getRandomValues(new Uint8Array(10))
  
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  
  let ulid = ''
  
  // Encode timestamp (10 chars)
  let t = timestamp
  for (let i = 9; i >= 0; i--) {
    ulid = ENCODING[t % 32] + ulid
    t = Math.floor(t / 32)
  }
  
  // Encode randomness (16 chars)
  for (let i = 0; i < 16; i++) {
    ulid += ENCODING[randomness[i % 10] % 32]
  }
  
  return ulid
}

export function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  )
}
