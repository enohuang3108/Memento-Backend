/**
 * System-level Google OAuth Handler
 *
 * 系統管理員一次性授權,取得系統級的 OAuth Token
 * 所有使用者上傳照片時使用這個 Token
 */

import type { Env } from '../types'
import { exchangeCodeForTokens, getAuthorizationUrl } from '../services/googleDriveOAuth'

/**
 * Initiate system-level OAuth flow (Admin only)
 * GET /admin/auth/google
 */
export async function initiateSystemAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const redirectUri = `${url.origin}/admin/auth/google/callback`

  // Generate authorization URL
  const authUrl = getAuthorizationUrl(
    env.GOOGLE_CLIENT_ID,
    redirectUri,
    'system-auth' // Use special state for system auth
  )

  return new Response(JSON.stringify({ authUrl }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Handle system OAuth callback (Admin only)
 * GET /admin/auth/google/callback?code=xxx
 */
export async function handleSystemAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head><title>授權失敗</title><meta charset="utf-8"></head>
        <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center;">
          <h1 style="color: #ef4444;">❌ 系統授權失敗</h1>
          <p>錯誤: ${error}</p>
          <p><a href="/admin/auth/google">重試</a></p>
        </body>
      </html>
      `,
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  if (!code) {
    return new Response(JSON.stringify({ error: 'Missing authorization code' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // Exchange code for tokens
    const redirectUri = `${url.origin}/admin/auth/google/callback`
    const tokens = await exchangeCodeForTokens(code, redirectUri, {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    })

    // Store tokens in KV (if available) or return them for manual storage
    const tokenData = {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      updatedAt: Date.now(),
    }

    if (env.SYSTEM_TOKENS) {
      await env.SYSTEM_TOKENS.put('google_drive_tokens', JSON.stringify(tokenData))
    }

    // Success page with tokens (for manual configuration if needed)
    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>系統授權成功</title>
          <meta charset="utf-8">
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              max-width: 800px;
              margin: 50px auto;
              padding: 20px;
              background: #f3f4f6;
            }
            .success {
              background: white;
              padding: 30px;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .icon {
              color: #22c55e;
              font-size: 4em;
              margin-bottom: 20px;
            }
            h1 { color: #22c55e; }
            .tokens {
              background: #f9fafb;
              border: 1px solid #e5e7eb;
              border-radius: 4px;
              padding: 15px;
              margin: 20px 0;
              font-family: monospace;
              font-size: 12px;
              word-break: break-all;
            }
            .warning {
              background: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 12px;
              margin: 20px 0;
            }
            .info {
              background: #dbeafe;
              border-left: 4px solid #3b82f6;
              padding: 12px;
              margin: 20px 0;
            }
            pre {
              background: #1f2937;
              color: #f3f4f6;
              padding: 15px;
              border-radius: 4px;
              overflow-x: auto;
            }
          </style>
        </head>
        <body>
          <div class="success">
            <div class="icon">✓</div>
            <h1>🎉 系統授權成功!</h1>
            <p>Google Drive API 已成功授權給系統使用。</p>

            ${env.SYSTEM_TOKENS ? `
              <div class="info">
                <strong>✅ Tokens 已自動儲存到 KV</strong><br>
                系統現在可以使用這些 Token 上傳照片。
              </div>
            ` : `
              <div class="warning">
                <strong>⚠️ 需要手動設定</strong><br>
                請將以下 Token 設定為 Worker 的 Secret。
              </div>

              <h3>Refresh Token (長期有效):</h3>
              <div class="tokens">${tokens.refreshToken || '未取得'}</div>

              <h3>Access Token (1小時有效):</h3>
              <div class="tokens">${tokens.accessToken}</div>

              <h3>設定方式:</h3>
              <pre>cd workers
npx wrangler secret put SYSTEM_GOOGLE_REFRESH_TOKEN
# 貼上 Refresh Token

npx wrangler secret put SYSTEM_GOOGLE_ACCESS_TOKEN
# 貼上 Access Token</pre>
            `}

            <h3>📝 Token 資訊:</h3>
            <ul style="text-align: left;">
              <li>Access Token 有效期: 1小時</li>
              <li>Refresh Token: ${tokens.refreshToken ? '✅ 已取得' : '❌ 未取得'}</li>
              <li>過期時間: ${new Date(tokens.expiresAt).toLocaleString('zh-TW')}</li>
            </ul>

            <div class="info">
              <strong>💡 提示:</strong> 系統會自動使用 Refresh Token 更新 Access Token,你不需要重複授權。
            </div>

            <p style="margin-top: 30px;">
              <button onclick="window.close()" style="background: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 6px; font-size: 16px; cursor: pointer;">
                關閉視窗
              </button>
            </p>
          </div>
        </body>
      </html>
      `,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  } catch (error) {
    console.error('System OAuth callback error:', error)

    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head><title>授權失敗</title><meta charset="utf-8"></head>
        <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center;">
          <h1 style="color: #ef4444;">❌ 處理授權時發生錯誤</h1>
          <p>${error instanceof Error ? error.message : '未知錯誤'}</p>
          <p><a href="/admin/auth/google">重試</a></p>
        </body>
      </html>
      `,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }
}

/**
 * Get current system token status (for debugging)
 * GET /admin/token/status
 */
export async function getSystemTokenStatus(env: Env): Promise<Response> {
  let tokenData: any = null

  // Try to get from KV
  if (env.SYSTEM_TOKENS) {
    const storedData = await env.SYSTEM_TOKENS.get('google_drive_tokens')
    if (storedData) {
      tokenData = JSON.parse(storedData)
    }
  }

  // Try to get from env vars
  if (!tokenData && env.SYSTEM_GOOGLE_REFRESH_TOKEN) {
    tokenData = {
      hasRefreshToken: !!env.SYSTEM_GOOGLE_REFRESH_TOKEN,
      hasAccessToken: !!env.SYSTEM_GOOGLE_ACCESS_TOKEN,
      source: 'environment variables'
    }
  }

  if (!tokenData) {
    return new Response(
      JSON.stringify({
        authorized: false,
        message: 'System not authorized. Please visit /admin/auth/google to authorize.'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      authorized: true,
      hasRefreshToken: !!tokenData.refreshToken || tokenData.hasRefreshToken,
      expiresAt: tokenData.expiresAt,
      expiresIn: tokenData.expiresAt ? Math.max(0, tokenData.expiresAt - Date.now()) : null,
      needsRefresh: tokenData.expiresAt ? tokenData.expiresAt < Date.now() + 5 * 60 * 1000 : null,
      source: tokenData.source || 'KV storage',
      updatedAt: tokenData.updatedAt
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}
