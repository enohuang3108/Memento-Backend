/**
 * Simple reversible encryption for ID obfuscation
 * Uses XOR cipher with a static key + Base64 encoding
 */

const KEY = 'memento-secret-key-2024'

export function encryptId(text: string): string {
  if (!text) return ''

  // XOR encryption
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length)
    result += String.fromCharCode(charCode)
  }

  // Base64 encode and make URL safe
  return btoa(result)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function decryptId(encryptedText: string): string {
  if (!encryptedText) return ''

  try {
    // Restore Base64 padding and URL unsafe chars
    let base64 = encryptedText
      .replace(/-/g, '+')
      .replace(/_/g, '/')

    const pad = base64.length % 4
    if (pad) {
      base64 += '='.repeat(4 - pad)
    }

    // Base64 decode
    const text = atob(base64)

    // XOR decryption
    let result = ''
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length)
      result += String.fromCharCode(charCode)
    }

    return result
  } catch (e) {
    console.error('Failed to decrypt ID:', e)
    return ''
  }
}
