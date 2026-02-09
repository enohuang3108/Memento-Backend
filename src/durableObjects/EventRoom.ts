import { getFolderName } from '../services/googleDriveOAuth'
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
import { encryptId } from '../utils/crypto'
import { filterProfanity } from '../utils/profanityFilter'
import { generateULID } from '../utils/ulid'
import { validateDanmakuContent, validatePhotoUpload } from '../utils/validation'
import {
  checkRateLimit as checkRateLimitUtil,
  createRateLimitState,
  recordAction as recordActionUtil,
  type RateLimitState,
} from '../utils/rateLimiter'

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
  private driveFileIdSet: Set<string> = new Set() // O(1) duplicate detection
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

    // Notify new photo uploaded (POST /notify-photo)
    if (url.pathname === '/notify-photo' && request.method === 'POST') {
      return this.handleNotifyPhoto(request)
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

    // Stop photo sync
    this.stopPhotoSync()

    // Broadcast to all connected clients
    this.broadcast({
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
   * Handle instant photo notification from upload handler
   * This reduces the 10-second polling delay to near-instant display
   */
  private async handleNotifyPhoto(request: Request): Promise<Response> {
    if (!this.event || this.event.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Event not active' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json() as {
      driveFileId: string
      thumbnailUrl: string
      fullUrl: string
      width?: number
      height?: number
    }

    // Check if photo already exists
    if (this.driveFileIdSet.has(body.driveFileId)) {
      return new Response(
        JSON.stringify({ success: true, duplicate: true }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Create photo object
    const photo: Photo = {
      id: generateULID(),
      activityId: this.event.id,
      sessionId: 'upload', // Uploaded via HTTP endpoint
      driveFileId: body.driveFileId,
      thumbnailUrl: body.thumbnailUrl,
      fullUrl: body.fullUrl,
      uploadedAt: Date.now(),
      width: body.width,
      height: body.height,
    }

    // Add to photos array and tracking set
    this.photos.push(photo)
    this.driveFileIdSet.add(photo.driveFileId)
    this.event.photoCount = this.photos.length

    // Broadcast to Display clients
    this.broadcastToDisplays({
      type: 'photo_added',
      photo,
    })

    console.log(`[EventRoom] Instant photo notification: ${photo.driveFileId} (total: ${this.photos.length})`)

    return new Response(
      JSON.stringify({ success: true, photo }),
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
      console.error(`[EventRoom] Connection limit reached: ${this.sessions.size}/500`)
      return new Response('Too many connections', { status: 503 })
    }

    // Connection count monitoring - warn when approaching limit
    if (this.sessions.size >= 450) {
      console.warn(`[EventRoom] Connection count approaching limit: ${this.sessions.size}/500`)
    } else if (this.sessions.size >= 400 && this.sessions.size % 50 === 0) {
      console.log(`[EventRoom] Connection count: ${this.sessions.size}/500`)
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

        // Handle initial join message to get session ID and role
        if (message.type === 'join' && message.sessionId) {
          const { sessionId, role } = message

          // Move from temp ID to actual session ID
          if (this.sessions.has(tempId)) {
            this.sessions.delete(tempId)
            this.sessions.set(sessionId, server)
            this.wsToSessionId.set(server, sessionId) // Update WebSocket -> sessionId mapping

            // Create session metadata with role
            this.sessionMetadata.set(sessionId, {
              id: sessionId,
              activityId: this.event!.id,
              joinedAt: Date.now(),
              role: role || 'participant',
              isActive: true,
            })

            // Initialize rate limit state
            this.rateLimitState.set(sessionId, createRateLimitState())

            // Update participant count
            this.event!.participantCount = this.sessionMetadata.size

            // Fetch latest folder name from Google Drive
            try {
              const systemToken = await getSystemAccessToken(this.env)
              const folderName = await getFolderName(this.event!.driveFolderId, systemToken)
              if (folderName && folderName !== this.event!.title) {
                console.log(`[EventRoom] Folder name updated: "${this.event!.title}" → "${folderName}"`)
                this.event!.title = folderName
              }
            } catch (error) {
              console.error('[EventRoom] Failed to get folder name on join:', error)
              // Continue with existing title
            }

            // Prepare joined response
            const joinedMessage: ServerMessage = {
              type: 'joined',
              activityId: this.event!.id,
              photos: this.photos,
              timestamp: Date.now(),
              title: this.event!.title,
            }

            if (role === 'display') {
              console.log(`[EventRoom] Display client joined: ${sessionId}, photos: ${this.photos.length}`)
            }

            server.send(JSON.stringify(joinedMessage))
            return
          }
        }

        // Legacy: Handle old-style sessionId message (backward compatibility)
        if ('sessionId' in message && message.sessionId && message.type !== 'join') {
          const sessionId = message.sessionId as string

          // Move from temp ID to actual session ID
          if (this.sessions.has(tempId)) {
            this.sessions.delete(tempId)
            this.sessions.set(sessionId, server)
            this.wsToSessionId.set(server, sessionId)

            this.sessionMetadata.set(sessionId, {
              id: sessionId,
              activityId: this.event!.id,
              joinedAt: Date.now(),
              role: 'participant',
              isActive: true,
            })

            this.rateLimitState.set(sessionId, createRateLimitState())

            this.event!.participantCount = this.sessionMetadata.size

            // Fetch latest folder name from Google Drive
            try {
              const systemToken = await getSystemAccessToken(this.env)
              const folderName = await getFolderName(this.event!.driveFolderId, systemToken)
              if (folderName && folderName !== this.event!.title) {
                console.log(`[EventRoom] Folder name updated: "${this.event!.title}" → "${folderName}"`)
                this.event!.title = folderName
              }
            } catch (error) {
              console.error('[EventRoom] Failed to get folder name on join:', error)
              // Continue with existing title
            }

            server.send(JSON.stringify({
              type: 'joined',
              activityId: this.event!.id,
              photos: this.photos,
              timestamp: Date.now(),
              title: this.event!.title,
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

    // Get actual sessionId from WebSocket mapping
    const actualSessionId = this.wsToSessionId.get(ws)

    // Check if session metadata exists (may be lost after DO eviction)
    if (!actualSessionId || !this.sessionMetadata.has(actualSessionId)) {
      // Session metadata lost - request client to reconnect
      ws.send(JSON.stringify({
        type: 'error',
        code: 'SESSION_EXPIRED',
        message: 'Session expired, please reconnect',
      } as ServerMessage))
      ws.close(4000, 'Session expired')
      return
    }

    switch (message.type) {
      case 'ping':
        // Fixed format for react-use-websocket heartbeat compatibility
        ws.send('{"type":"pong"}')
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

    // Check for duplicate photo (already added via /notify-photo or Drive sync)
    if (this.driveFileIdSet.has(message.driveFileId)) {
      // Already exists, silently ignore (not an error, just a race condition)
      console.log(`[EventRoom] Duplicate photo ignored via WebSocket: ${message.driveFileId}`)
      return
    }

    // Check rate limit (20 photos / 60 seconds)
    const state = this.rateLimitState.get(sessionId)
    if (state) {
      const rateLimitCheck = checkRateLimitUtil(state, 'photo')
      if (!rateLimitCheck.allowed) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many photo uploads. Please wait.',
          retryAfter: rateLimitCheck.retryAfter,
        } as ServerMessage))
        return
      }
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

    // Add to photos array and tracking set
    this.photos.push(photo)
    this.driveFileIdSet.add(photo.driveFileId)
    this.event!.photoCount = this.photos.length

    // Record upload timestamp for rate limiting
    if (state) {
      const newState = recordActionUtil(state, 'photo')
      this.rateLimitState.set(sessionId, newState)
    }

    // Broadcast to Display clients only (reduces 99%+ broadcast volume)
    this.broadcastToDisplays({
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
    const state = this.rateLimitState.get(sessionId)
    if (state) {
      const rateLimitCheck = checkRateLimitUtil(state, 'danmaku')
      if (!rateLimitCheck.allowed) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Please wait before sending another message',
          retryAfter: rateLimitCheck.retryAfter,
        } as ServerMessage))
        return
      }
    }

    // Record send timestamp for rate limiting
    if (state) {
      const newState = recordActionUtil(state, 'danmaku')
      this.rateLimitState.set(sessionId, newState)
    }

    // Broadcast danmaku (NO STORAGE - ephemeral only)
    this.broadcast({
      type: 'danmaku',
      id: generateULID(),
      content: message.content,
      sessionId,
      timestamp: Date.now(),
    })
  }


  /**
   * Broadcast message to all connected clients
   */
  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message)
    for (const ws of this.sessions.values()) {
      if (ws.readyState === 1) { // 1 = OPEN
        ws.send(data)
      }
    }
  }

  /**
   * Broadcast message only to Display clients
   * This significantly reduces broadcast volume (99%+ reduction for photo messages)
   */
  private broadcastToDisplays(message: ServerMessage): void {
    const data = JSON.stringify(message)
    for (const [sessionId, ws] of this.sessions) {
      const meta = this.sessionMetadata.get(sessionId)
      if (meta?.role === 'display' && ws.readyState === 1) {
        ws.send(data)
      }
    }
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
   * Stop periodic photo sync from Google Drive
   */
  private stopPhotoSync(): void {
    if (this.syncInterval !== null) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
      console.log('[EventRoom] Stopped photo sync')
    }
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

      for (const file of allFiles) {
        // Skip if already exists (O(1) lookup using maintained Set)
        if (this.driveFileIdSet.has(file.id)) {
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
        this.driveFileIdSet.add(file.id) // Maintain O(1) duplicate detection
      }

      // Update photo count
      this.event.photoCount = this.photos.length

      // Broadcast new photos to Display clients
      if (newPhotos.length > 0) {
        console.log(`[EventRoom] Synced ${newPhotos.length} new photos from Drive (total: ${this.photos.length})`)

        for (const photo of newPhotos) {
          // Broadcast to Display clients only (reduces 99%+ broadcast volume)
          this.broadcastToDisplays({
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

      // Get folder name from Google Drive as title
      let folderName: string | undefined
      try {
        const accessToken = await getSystemAccessToken(this.env)
        folderName = await getFolderName(driveFolderId, accessToken)
      } catch (error) {
        console.error('[EventRoom] Failed to get folder name:', error)
        // Continue without title if folder name fetch fails
      }

      // Reinitialize the event with encrypted ID
      this.event = {
        id: encryptId(driveFolderId), // Use encrypted ID for public use
        title: folderName,
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
