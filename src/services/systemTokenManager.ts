/**
 * System Token Manager
 *
 * 管理系統級的 Google Drive OAuth Token
 */

import type { Env } from '../types'
import { refreshAccessToken } from './googleDriveOAuth'

interface SystemTokens {
  refreshToken?: string
  accessToken: string
  expiresAt: number
  updatedAt: number
}

/**
 * Get system tokens from storage
 */
async function getStoredTokens(env: Env): Promise<SystemTokens | null> {
  // Try KV first
  if (env.SYSTEM_TOKENS) {
    const storedData = await env.SYSTEM_TOKENS.get('google_drive_tokens')
    if (storedData) {
      return JSON.parse(storedData)
    }
  }

  // Fall back to environment variables
  if (env.SYSTEM_GOOGLE_ACCESS_TOKEN) {
    return {
      refreshToken: env.SYSTEM_GOOGLE_REFRESH_TOKEN,
      accessToken: env.SYSTEM_GOOGLE_ACCESS_TOKEN,
      expiresAt: env.SYSTEM_GOOGLE_TOKEN_EXPIRY
        ? parseInt(env.SYSTEM_GOOGLE_TOKEN_EXPIRY)
        : Date.now() + 3600 * 1000,
      updatedAt: Date.now(),
    }
  }

  return null
}

/**
 * Store updated tokens
 */
async function storeTokens(env: Env, tokens: SystemTokens): Promise<void> {
  if (env.SYSTEM_TOKENS) {
    await env.SYSTEM_TOKENS.put('google_drive_tokens', JSON.stringify(tokens))
  }
  // Note: Cannot update environment variables at runtime
  // They need to be set manually via wrangler or dashboard
}

/**
 * Get valid access token (auto-refresh if needed)
 */
export async function getSystemAccessToken(env: Env): Promise<string> {
  const tokens = await getStoredTokens(env)

  if (!tokens) {
    throw new Error('System not authorized. Please complete admin OAuth flow at /admin/auth/google')
  }

  // Check if token needs refresh (5 min buffer)
  const now = Date.now()
  const needsRefresh = tokens.expiresAt < now + 5 * 60 * 1000

  if (needsRefresh) {
    if (!tokens.refreshToken) {
      throw new Error('No refresh token available. Please re-authorize at /admin/auth/google')
    }

    console.log('System access token expired, refreshing...')

    // Refresh the token
    const newAccessToken = await refreshAccessToken(tokens.refreshToken, {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    })

    // Update stored tokens
    const updatedTokens: SystemTokens = {
      ...tokens,
      accessToken: newAccessToken.accessToken,
      expiresAt: newAccessToken.expiresAt,
      updatedAt: now,
    }

    await storeTokens(env, updatedTokens)

    console.log('System token refreshed successfully')

    return newAccessToken.accessToken
  }

  return tokens.accessToken
}

/**
 * Check if system is authorized
 */
export async function isSystemAuthorized(env: Env): Promise<boolean> {
  const tokens = await getStoredTokens(env)
  return tokens !== null && !!tokens.accessToken
}
