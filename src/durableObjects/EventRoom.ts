import { getSystemAccessToken } from '../services/systemTokenManager'
import type {
  Event as ActivityEvent,
  ClientMessage,
  DurableObjectState,
  Env,
  ParticipantSession,
  Photo,
  ServerMessage,
} from '../types'
import { filterProfanity } from '../utils/profanityFilter'
import { generateULID } from '../utils/ulid'
import { validateDanmakuContent, validatePhotoUpload } from '../utils/validation'

/**
 * Rate limiter state for a session
 */
interface RateLimitState {
  photoUploads: number[] // timestamps of recent uploads (keep last 60s)
  danmakuSends: number[] // timestamps of recent danmaku (keep last 10s)
}

/**
 * EventRoom Durable Object
 *
 * Manages state and WebSocket connections for a single event/activity.
 * Each event gets its own DO instance identified by the 6-digit activity code.
 */
export class EventRoom {
  // In-memory state
  private event: ActivityEvent | null = null
  private photos: Photo[] = []
  private sessions: Map<string, WebSocket> = new Map() // sessionId -> WebSocket
  private sessionMetadata: Map<string, ParticipantSession> = new Map()
  private rateLimitState: Map<string, RateLimitState> = new Map()
  private wsToSessionId: Map<WebSocket, string> = new Map() // WebSocket -> sessionId mapping
  private env: Env
  private syncInterval: number | null = null
  private state: DurableObjectState<Record<string, never>>

  constructor(state: DurableObjectState<Record<string, never>>, env: Env) {
    this.state = state
    this.env = env
    // Start syncing photos from Google Drive every 10 seconds
    this.startPhotoSync()
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // Initialize event (POST /init)
    if (url.pathname === '/init' && request.method === 'POST') {
      return this.handleInitEvent(request)
    }

    // Get event info (GET /)
    if (url.pathname === '/' && request.method === 'GET') {
      return this.handleGetEvent()
    }

    // End event (DELETE /)
    if (url.pathname === '/' && request.method === 'DELETE') {
      return this.handleEndEvent()
    }

    return new Response('Not found', { status: 404 })
  }

  /**
   * Initialize event in this DO instance
   */
  private async handleInitEvent(request: Request): Promise<Response> {
    if (this.event) {
      return new Response(
        JSON.stringify({ error: 'Event already initialized' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json() as {
      id: string
      title?: string
      driveFolderId?: string
    }

    if (!body.driveFolderId) {
      return new Response(
        JSON.stringify({ error: 'driveFolderId is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    this.event = {
      id: body.id,
      title: body.title,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      status: 'active',
      driveFolderId: body.driveFolderId,
      photoCount: 0,
      participantCount: 0,
    }

    return new Response(
      JSON.stringify({ event: this.event }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }

  /**
   * Get current event state
   */
  private async handleGetEvent(): Promise<Response> {
    // Auto-restart if event is null
    if (!this.event) {
      await this.autoRestartEvent()
    }

    if (!this.event) {
      return new Response(
        JSON.stringify({ error: 'Event not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Update participant count
    this.event.participantCount = this.sessionMetadata.size

    return new Response(
      JSON.stringify({
        event: this.event,
        photos: this.photos,
        activeConnections: this.sessions.size,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }

  /**
   * End the event
   */
  private async handleEndEvent(): Promise<Response> {
    if (!this.event) {
      return new Response(
        JSON.stringify({ error: 'Event not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    this.event.status = 'ended'

    // Broadcast to all connected clients
    await this.broadcast({
      type: 'activity_ended',
      activityId: this.event.id,
      reason: 'Host ended the event',
      timestamp: Date.now(),
    })

    // Close all WebSocket connections
    for (const ws of this.sessions.values()) {
      ws.close(1000, 'Event ended')
    }
    this.sessions.clear()
    this.sessionMetadata.clear()
    this.rateLimitState.clear()
    this.wsToSessionId.clear()

    return new Response(
      JSON.stringify({ success: true, event: this.event }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }

  /**
   * Handle WebSocket upgrade
   */
  private async handleWebSocketUpgrade(_request: Request): Promise<Response> {
    // Auto-restart if event is null (DO was evicted)
    if (!this.event) {
      await this.autoRestartEvent()
    }

    if (!this.event) {
      return new Response('Event not found', { status: 404 })
    }

    // Auto-restart ended events when reconnecting
    if (this.event.status === 'ended') {
      console.log(`[EventRoom] Auto-restarting ended event: ${this.event.id}`)
      this.event.status = 'active'
      // Extend expiration time by 24 hours
      this.event.expiresAt = Date.now() + 24 * 60 * 60 * 1000
    }

    // Check connection limit (max 500 per DO)
    if (this.sessions.size >= 500) {
      return new Response('Too many connections', { status: 503 })
    }

    // Create WebSocket pair
    const webSocketPair = new (globalThis as any).WebSocketPair()
    const client = webSocketPair[0]
    const server = webSocketPair[1] as WebSocket

    // Accept the connection
    (server as any).accept()

    // Store temporarily until we get session ID from client
    const tempId = generateULID()
    this.sessions.set(tempId, server)
    this.wsToSessionId.set(server, tempId) // Track WebSocket -> sessionId mapping

    // Setup message handlers
    server.addEventListener('message', async (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data as string) as ClientMessage & { sessionId?: string }

        // Handle initial join message to get session ID
        if ('sessionId' in message && message.sessionId) {
          const sessionId = message.sessionId

          // Move from temp ID to actual session ID
          if (this.sessions.has(tempId)) {
            this.sessions.delete(tempId)
            this.sessions.set(sessionId, server)
            this.wsToSessionId.set(server, sessionId) // Update WebSocket -> sessionId mapping

            // Create session metadata
            this.sessionMetadata.set(sessionId, {
              id: sessionId,
              activityId: this.event!.id,
              joinedAt: Date.now(),
              role: 'participant',
              isActive: true,
            })

            // Initialize rate limit state
            this.rateLimitState.set(sessionId, {
              photoUploads: [],
              danmakuSends: [],
            })

            // Update participant count
            this.event!.participantCount = this.sessionMetadata.size

            // Send joined confirmation with current photos
            server.send(JSON.stringify({
              type: 'joined',
              activityId: this.event!.id,
              photos: this.photos,
              timestamp: Date.now(),
            } as ServerMessage))

            return
          }
        }

        await this.handleWebSocketMessage(message, tempId, server)
      } catch (error) {
        console.error('WebSocket message error:', error)
        server.send(JSON.stringify({
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'Invalid message format',
        } as ServerMessage))
      }
    })

    server.addEventListener('close', () => {
      // Get the actual sessionId for this WebSocket
      const actualSessionId = this.wsToSessionId.get(server)

      if (actualSessionId) {
        // Remove session using the actual sessionId
        this.sessions.delete(actualSessionId)
        this.sessionMetadata.delete(actualSessionId)
        this.rateLimitState.delete(actualSessionId)
        this.wsToSessionId.delete(server)

        // Update participant count
        if (this.event) {
          this.event.participantCount = this.sessionMetadata.size
        }
      }
    })

    server.addEventListener('error', (ev: Event) => {
      console.error('WebSocket error:', ev)
    })

    return new Response(null, {
      status: 101,
      webSocket: client as any, // Cloudflare Workers Response type
    } as any)
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleWebSocketMessage(
    message: ClientMessage,
    sessionId: string,
    ws: WebSocket
  ): Promise<void> {
    if (!this.event || this.event.status !== 'active') {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'EVENT_INACTIVE',
        message: 'Event is not active',
      } as ServerMessage))
      return
    }

    switch (message.type) {
      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: Date.now(),
        } as ServerMessage))
        break

      case 'photo_added':
        await this.handlePhotoAdded(message, sessionId, ws)
        break

      case 'danmaku':
        await this.handleDanmaku(message, sessionId, ws)
        break

      default:
        ws.send(JSON.stringify({
          type: 'error',
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: 'Unknown message type',
        } as ServerMessage))
    }
  }

  /**
   * Handle photo_added message
   */
  private async handlePhotoAdded(
    message: Extract<ClientMessage, { type: 'photo_added' }>,
    sessionId: string,
    ws: WebSocket
  ): Promise<void> {
    // Validate photo data
    const validation = validatePhotoUpload({
      driveFileId: message.driveFileId,
      thumbnailUrl: message.thumbnailUrl,
      fullUrl: message.fullUrl,
    })

    if (!validation.valid) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_PHOTO',
        message: validation.errors.join(', '),
      } as ServerMessage))
      return
    }

    // Check rate limit (20 photos / 60 seconds)
    const rateLimitCheck = this.checkRateLimit(sessionId, 'photo')
    if (!rateLimitCheck.allowed) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many photo uploads. Please wait.',
        retryAfter: rateLimitCheck.retryAfter,
      } as ServerMessage))
      return
    }

    // Create photo object
    const photo: Photo = {
      id: generateULID(),
      activityId: this.event!.id,
      sessionId,
      driveFileId: message.driveFileId,
      thumbnailUrl: message.thumbnailUrl,
      fullUrl: message.fullUrl,
      uploadedAt: Date.now(),
      width: message.width,
      height: message.height,
    }

    // Add to photos array
    this.photos.push(photo)
    this.event!.photoCount = this.photos.length

    // Record upload timestamp for rate limiting
    this.recordAction(sessionId, 'photo')

    // Broadcast to all connected clients
    await this.broadcast({
      type: 'photo_added',
      photo,
    })
  }

  /**
   * Handle danmaku message
   */
  private async handleDanmaku(
    message: Extract<ClientMessage, { type: 'danmaku' }>,
    sessionId: string,
    ws: WebSocket
  ): Promise<void> {
    // Validate content
    const validation = validateDanmakuContent(message.content)
    if (!validation.valid) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_DANMAKU',
        message: validation.errors.join(', '),
      } as ServerMessage))
      return
    }

    // Filter profanity
    const filterResult = filterProfanity(message.content)
    if (!filterResult.clean) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'PROFANITY_DETECTED',
        message: 'Message contains inappropriate content',
      } as ServerMessage))
      return
    }

    // Check rate limit (1 danmaku / 2 seconds)
    const rateLimitCheck = this.checkRateLimit(sessionId, 'danmaku')
    if (!rateLimitCheck.allowed) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Please wait before sending another message',
        retryAfter: rateLimitCheck.retryAfter,
      } as ServerMessage))
      return
    }

    // Record send timestamp for rate limiting
    this.recordAction(sessionId, 'danmaku')

    // Broadcast danmaku (NO STORAGE - ephemeral only)
    await this.broadcast({
      type: 'danmaku',
      id: generateULID(),
      content: message.content,
      sessionId,
      timestamp: Date.now(),
    })
  }

  /**
   * Check rate limit for a session
   */
  private checkRateLimit(
    sessionId: string,
    type: 'photo' | 'danmaku'
  ): { allowed: boolean; retryAfter?: number } {
    const state = this.rateLimitState.get(sessionId)
    if (!state) {
      return { allowed: true }
    }

    const now = Date.now()

    if (type === 'photo') {
      // 20 uploads / 60 seconds
      const recentUploads = state.photoUploads.filter(t => now - t < 60000)
      if (recentUploads.length >= 20) {
        const oldestUpload = Math.min(...recentUploads)
        return {
          allowed: false,
          retryAfter: 60000 - (now - oldestUpload),
        }
      }
    } else {
      // 1 danmaku / 2 seconds
      const recentSends = state.danmakuSends.filter(t => now - t < 2000)
      if (recentSends.length >= 1) {
        const lastSend = Math.max(...recentSends)
        return {
          allowed: false,
          retryAfter: 2000 - (now - lastSend),
        }
      }
    }

    return { allowed: true }
  }

  /**
   * Record an action for rate limiting
   */
  private recordAction(sessionId: string, type: 'photo' | 'danmaku'): void {
    const state = this.rateLimitState.get(sessionId)
    if (!state) return

    const now = Date.now()

    if (type === 'photo') {
      // Keep only last 60 seconds
      state.photoUploads = state.photoUploads.filter(t => now - t < 60000)
      state.photoUploads.push(now)
    } else {
      // Keep only last 10 seconds
      state.danmakuSends = state.danmakuSends.filter(t => now - t < 10000)
      state.danmakuSends.push(now)
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  private async broadcast(message: ServerMessage): Promise<void> {
    const data = JSON.stringify(message)
    const promises: Promise<void>[] = []

    for (const ws of this.sessions.values()) {
      if (ws.readyState === 1) { // 1 = OPEN
        promises.push(
          new Promise<void>((resolve) => {
            ws.send(data)
            resolve()
          })
        )
      }
    }

    await Promise.all(promises)
  }

  /**
   * Start periodic photo sync from Google Drive
   */
  private startPhotoSync(): void {
    // Sync immediately on start
    this.syncPhotosFromDrive().catch(err => {
      console.error('[EventRoom] Initial photo sync failed:', err)
    })

    // Then sync every 10 seconds
    this.syncInterval = setInterval(() => {
      this.syncPhotosFromDrive().catch(err => {
        console.error('[EventRoom] Photo sync failed:', err)
      })
    }, 10000) as unknown as number
  }

  /**
   * Sync photos from Google Drive folder
   * Supports pagination to fetch up to 2000 photos
   */
  private async syncPhotosFromDrive(): Promise<void> {
    if (!this.event || !this.event.driveFolderId) {
      return
    }

    try {
      // Get system access token using the shared manager
      // This handles storage in KV and auto-refreshing
      const systemToken = await getSystemAccessToken(this.env)

      const MAX_PHOTOS = 2000
      const PAGE_SIZE = 1000 // Google Drive API max page size
      let pageToken: string | undefined = undefined
      let allFiles: Array<{
        id: string
        name: string
        thumbnailLink?: string
        webContentLink?: string
        webViewLink?: string
        imageMediaMetadata?: {
          width?: number
          height?: number
        }
      }> = []

      // Fetch all pages until we hit the limit or run out of photos
      do {
        const url =
          `https://www.googleapis.com/drive/v3/files?` +
          `q='${this.event.driveFolderId}' in parents and mimeType contains 'image/'` +
          `&fields=files(id,name,thumbnailLink,webContentLink,webViewLink,imageMediaMetadata),nextPageToken` +
          `&orderBy=createdTime desc` +
          `&pageSize=${PAGE_SIZE}` +
          (pageToken ? `&pageToken=${pageToken}` : '')

        const driveResponse = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${systemToken}`,
          },
        })

        if (!driveResponse.ok) {
          console.error('[EventRoom] Drive API error:', await driveResponse.text())
          return
        }

        const driveData = await driveResponse.json() as {
          files: Array<{
            id: string
            name: string
            thumbnailLink?: string
            webContentLink?: string
            webViewLink?: string
            imageMediaMetadata?: {
              width?: number
              height?: number
            }
          }>
          nextPageToken?: string
        }

        allFiles.push(...driveData.files)
        pageToken = driveData.nextPageToken

        // Safety limit: stop if we've fetched enough photos
        if (allFiles.length >= MAX_PHOTOS) {
          console.log(`[EventRoom] Reached photo limit (${MAX_PHOTOS}), stopping pagination`)
          allFiles = allFiles.slice(0, MAX_PHOTOS)
          break
        }

      } while (pageToken)

      console.log(`[EventRoom] Fetched ${allFiles.length} total photos from Drive`)

      // Convert Drive files to Photo objects
      const newPhotos: Photo[] = []
      const existingFileIds = new Set(this.photos.map(p => p.driveFileId))

      for (const file of allFiles) {
        // Skip if already exists
        if (existingFileIds.has(file.id)) {
          continue
        }

        // Create Photo object with correct Google Drive URLs
          // thumbnailLink: Direct thumbnail from Drive API (size=s220 by default)
          // fullUrl: Use high-res thumbnail link (=s0) for reliable embedding
          // Note: uc URLs are blocked by CORS/OpaqueResponseBlocking, use thumbnail API instead
          const fullUrl = file.thumbnailLink
            ? file.thumbnailLink.replace(/=s\d+$/, '=s0')
            : `https://drive.google.com/thumbnail?id=${file.id}&sz=s0`

          const photo: Photo = {
            id: generateULID(),
            activityId: this.event.id,
            sessionId: 'system', // System-synced photos
            driveFileId: file.id,
            thumbnailUrl: file.thumbnailLink || `https://drive.google.com/thumbnail?id=${file.id}&sz=w400`,
            fullUrl,
            uploadedAt: Date.now(),
            width: file.imageMediaMetadata?.width,
            height: file.imageMediaMetadata?.height,
          }

        newPhotos.push(photo)
        this.photos.push(photo)
      }

      // Update photo count
      this.event.photoCount = this.photos.length

      // Broadcast new photos to all connected clients
      if (newPhotos.length > 0) {
        console.log(`[EventRoom] Synced ${newPhotos.length} new photos from Drive (total: ${this.photos.length})`)

        for (const photo of newPhotos) {
          await this.broadcast({
            type: 'photo_added',
            photo,
          })
        }
      }

    } catch (error) {
      console.error('[EventRoom] Error syncing photos from Drive:', error)
    }
  }

  /**
   * Auto-restart event from Durable Object name (which is the driveFolderId)
   */
  private async autoRestartEvent(): Promise<void> {
    try {
      // Get the driveFolderId from DO's name
      // Note: state.id.name is a synchronous property
      const driveFolderId = this.state.id.name

      console.log(`[EventRoom] Attempting auto-restart, DO name: "${driveFolderId}"`)

      if (!driveFolderId) {
        console.error('[EventRoom] Cannot auto-restart: no DO name found')
        return
      }

      console.log(`[EventRoom] Auto-restarting event from driveFolderId: ${driveFolderId}`)

      // Reinitialize the event
      this.event = {
        id: driveFolderId, // Use driveFolderId as activity ID for now
        title: undefined,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        status: 'active',
        driveFolderId: driveFolderId,
        photoCount: 0,
        participantCount: 0,
      }

      console.log(`[EventRoom] Event auto-restarted successfully: ${this.event.id}`)
    } catch (error) {
      console.error('[EventRoom] Failed to auto-restart event:', error)
    }
  }
}
