/**
 * Photo Upload Handler
 * Handles file uploads from clients and stores them in Google Drive using system OAuth token
 */

import { uploadToGoogleDriveOAuth } from '../services/googleDriveOAuth'
import { getSystemAccessToken } from '../services/systemTokenManager'
import type { Env } from '../types'
import { decryptId } from '../utils/crypto'

interface UploadResponse {
  driveFileId: string
  thumbnailUrl: string
  fullUrl: string
  width?: number
  height?: number
}

/**
 * Parse multipart/form-data
 */
async function parseMultipartFormData(request: Request): Promise<{
  file: ArrayBuffer
  fileName: string
  mimeType: string
  activityId: string
  width?: number
  height?: number
}> {
  const contentType = request.headers.get('Content-Type')
  if (!contentType?.includes('multipart/form-data')) {
    throw new Error('Content-Type must be multipart/form-data')
  }

  const formData = await request.formData()

  const file = formData.get('file') as unknown as File
  const activityId = formData.get('activityId') as string
  const width = formData.get('width')
  const height = formData.get('height')

  if (!file) {
    throw new Error('File is required')
  }

  if (!activityId) {
    throw new Error('activityId is required')
  }

  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are allowed')
  }

  // Validate file size (max 20MB)
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('File size must not exceed 20MB')
  }

  return {
    file: await file.arrayBuffer(),
    fileName: file.name,
    mimeType: file.type,
    activityId,
    width: width ? parseInt(width as string) : undefined,
    height: height ? parseInt(height as string) : undefined,
  }
}

/**
 * Handle photo upload request
 */
export async function handlePhotoUpload(request: Request, env: Env): Promise<Response> {
  try {
    // Parse form data
    const { file, fileName, mimeType, activityId, width, height } =
      await parseMultipartFormData(request)

    // Decrypt activity ID to get internal Drive Folder ID
    const internalId = decryptId(activityId)

    if (!internalId) {
      throw new Error('Invalid activity ID')
    }

    // Get event data from Durable Object to get folderId
    const durableObjectId = env.EVENT_ROOM.idFromName(internalId)
    const stub = env.EVENT_ROOM.get(durableObjectId)

    const eventResponse = await stub.fetch(
      new Request(`http://internal/`, {
        method: 'GET',
      })
    )

    if (!eventResponse.ok) {
      throw new Error('Event not found')
    }

    const eventData = (await eventResponse.json()) as {
      event: {
        driveFolderId: string
      }
    }

    // Get system access token (auto-refreshes if needed)
    const accessToken = await getSystemAccessToken(env)

    // Upload to Google Drive using system token
    const result = await uploadToGoogleDriveOAuth(
      { file, fileName, mimeType, folderId: eventData.event.driveFolderId },
      accessToken
    )

    const response: UploadResponse = {
      ...result,
      width,
      height,
    }

    // Notify Durable Object immediately for instant display (reduces 10s delay)
    try {
      await stub.fetch(
        new Request('http://internal/notify-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            driveFileId: result.driveFileId,
            thumbnailUrl: result.thumbnailUrl,
            fullUrl: result.fullUrl,
            width,
            height,
          }),
        })
      )
    } catch (notifyError) {
      // Log but don't fail the upload - photo will be picked up by polling
      console.error('Failed to notify DO of new photo:', notifyError)
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Upload error:', error)

    const errorMessage = error instanceof Error ? error.message : 'Upload failed'
    return new Response(
      JSON.stringify({ error: 'upload_failed', message: errorMessage }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
