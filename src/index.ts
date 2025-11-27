import { EventRoom } from './durableObjects/EventRoom'
import { createEvent, endEvent, getEvent } from './handlers/events'
import {
  getSystemTokenStatus,
  handleSystemAuthCallback,
  initiateSystemAuth
} from './handlers/systemAuth'
import { handlePhotoUpload } from './handlers/upload'
import type { Env } from './types'
import { decryptId } from './utils/crypto'

export { EventRoom }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: Date.now() }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Admin: System OAuth authorization
    if (url.pathname === '/admin/auth/google' && request.method === 'GET') {
      return await initiateSystemAuth(request, env)
    }

    // Admin: System OAuth callback
    if (url.pathname === '/admin/auth/google/callback' && request.method === 'GET') {
      return await handleSystemAuthCallback(request, env)
    }

    // Admin: Check system token status
    if (url.pathname === '/admin/token/status' && request.method === 'GET') {
      return await getSystemTokenStatus(env)
    }

    // POST /upload - Upload photo to Google Drive
    if (url.pathname === '/upload' && request.method === 'POST') {
      const response = await handlePhotoUpload(request, env)
      return addCorsHeaders(response, corsHeaders)
    }

    // POST /events - Create event
    if (url.pathname === '/events' && request.method === 'POST') {
      const response = await createEvent(request, env)
      return addCorsHeaders(response, corsHeaders)
    }

    // GET /events/:activityId - Get event
    // Match encrypted ID (Base64 URL safe: A-Z a-z 0-9 - _)
    const eventMatch = url.pathname.match(/^\/events\/([a-zA-Z0-9-_]+)$/)
    if (eventMatch && request.method === 'GET') {
      const response = await getEvent(eventMatch[1], env)
      return addCorsHeaders(response, corsHeaders)
    }

    // DELETE /events/:activityId - End event
    if (eventMatch && request.method === 'DELETE') {
      const response = await endEvent(eventMatch[1], env)
      return addCorsHeaders(response, corsHeaders)
    }

    // WebSocket upgrade - GET /events/:activityId/ws
    const wsMatch = url.pathname.match(/^\/events\/([a-zA-Z0-9-_]+)\/ws$/)
    if (wsMatch && request.headers.get('Upgrade') === 'websocket') {
      const activityId = wsMatch[1]

      // Decrypt ID to get internal Drive Folder ID
      const internalId = decryptId(activityId)

      if (!internalId) {
        return new Response('Invalid activity ID', { status: 400, headers: corsHeaders })
      }

      const durableObjectId = env.EVENT_ROOM.idFromName(internalId)
      const stub = env.EVENT_ROOM.get(durableObjectId)
      return stub.fetch(request)
    }

    return new Response('Not found', { status: 404, headers: corsHeaders })
  },
}

function getAllowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get('Origin') || ''
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
  ]

  if (allowedOrigins.includes(origin)) {
    return origin
  }

  return allowedOrigins[0]
}

function addCorsHeaders(response: Response, corsHeaders: Record<string, string>): Response {
  const newHeaders = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  })
}
