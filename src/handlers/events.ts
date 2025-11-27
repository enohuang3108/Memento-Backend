import type {
  ApiError,
  CreateEventRequest,
  CreateEventResponse,
  Env,
} from '../types'
import { decryptId, encryptId } from '../utils/crypto'
import { validateDriveFolderId } from '../utils/validation'

/**
 * Create a new event/activity
 * POST /events
 */
export async function createEvent(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as CreateEventRequest

    // Validate input
    if (body.title && body.title.length > 100) {
      return errorResponse('INVALID_TITLE', 'Title must be 100 characters or less', 400)
    }

    // Validate Google Drive Folder ID (required)
    if (!body.driveFolderId) {
      return errorResponse('MISSING_DRIVE_FOLDER_ID', 'Google Drive Folder ID is required', 400)
    }

    if (!validateDriveFolderId(body.driveFolderId)) {
      return errorResponse('INVALID_DRIVE_FOLDER_ID', 'Invalid Google Drive Folder ID format', 400)
    }

    // Use Drive Folder ID as the internal Activity ID
    const internalId = body.driveFolderId

    // Encrypted ID for public use (URL, QR Code)
    const publicId = encryptId(internalId)

    // Get DO stub and initialize event
    const durableObjectId = env.EVENT_ROOM.idFromName(internalId)
    const stub = env.EVENT_ROOM.get(durableObjectId)

    // Initialize event in DO
    const initRequest = new Request('http://internal/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: publicId, // Store the public ID in the event object for consistency
        title: body.title,
        driveFolderId: body.driveFolderId,
      }),
    })

    const initResponse = await stub.fetch(initRequest)

    let eventData: { event: any }

    if (initResponse.status === 409) {
      // Event already exists, fetch it
      const getRequest = new Request('http://internal/', {
        method: 'GET',
      })
      const getResponse = await stub.fetch(getRequest)

      if (!getResponse.ok) {
        return errorResponse('FETCH_FAILED', 'Failed to fetch existing event', 500)
      }

      eventData = await getResponse.json() as { event: any }
    } else if (!initResponse.ok) {
      const error = await initResponse.json() as ApiError
      return errorResponse('INIT_FAILED', error.message || 'Failed to initialize event', 500)
    } else {
      eventData = await initResponse.json() as { event: any }
    }

    const { event } = eventData

    // Generate QR code URL (pointing to participant page with Encrypted ID)
    const baseUrl = getBaseUrl(request)
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
      `${baseUrl}/event/${publicId}`
    )}`

    const response: CreateEventResponse = {
      event,
      qrCodeUrl,
    }

    return new Response(JSON.stringify(response), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Create event error:', error)
    return errorResponse('INTERNAL_ERROR', 'Failed to create event', 500)
  }
}

/**
 * Get event details
 * GET /events/:activityId
 */
export async function getEvent(activityId: string, env: Env): Promise<Response> {
  try {
    // Decrypt the public ID to get the internal Drive Folder ID
    const internalId = decryptId(activityId)

    if (!internalId) {
       return errorResponse('INVALID_ACTIVITY_ID', 'Invalid activity code', 400)
    }

    // Get DO stub
    const durableObjectId = env.EVENT_ROOM.idFromName(internalId)
    const stub = env.EVENT_ROOM.get(durableObjectId)

    // Get event from DO
    const doRequest = new Request('http://internal/', {
      method: 'GET',
    })

    const doResponse = await stub.fetch(doRequest)
    if (!doResponse.ok) {
      if (doResponse.status === 404) {
        return errorResponse('EVENT_NOT_FOUND', 'Event not found', 404)
      }
      return errorResponse('FETCH_FAILED', 'Failed to fetch event', 500)
    }

    const data = await doResponse.json()
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Get event error:', error)
    return errorResponse('INTERNAL_ERROR', 'Failed to get event', 500)
  }
}

/**
 * End an event
 * DELETE /events/:activityId
 */
export async function endEvent(activityId: string, env: Env): Promise<Response> {
  try {
    // Decrypt the public ID to get the internal Drive Folder ID
    const internalId = decryptId(activityId)

    if (!internalId) {
       return errorResponse('INVALID_ACTIVITY_ID', 'Invalid activity code', 400)
    }

    // Get DO stub
    const durableObjectId = env.EVENT_ROOM.idFromName(internalId)
    const stub = env.EVENT_ROOM.get(durableObjectId)

    // End event in DO
    const doRequest = new Request('http://internal/', {
      method: 'DELETE',
    })

    const doResponse = await stub.fetch(doRequest)
    if (!doResponse.ok) {
      if (doResponse.status === 404) {
        return errorResponse('EVENT_NOT_FOUND', 'Event not found', 404)
      }
      return errorResponse('END_FAILED', 'Failed to end event', 500)
    }

    const data = await doResponse.json()
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('End event error:', error)
    return errorResponse('INTERNAL_ERROR', 'Failed to end event', 500)
  }
}

/**
 * Extract base URL from request
 */
function getBaseUrl(request: Request): string {
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

/**
 * Create error response
 */
function errorResponse(code: string, message: string, status: number): Response {
  const error: ApiError = {
    error: code,
    message,
  }

  return new Response(JSON.stringify(error), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
