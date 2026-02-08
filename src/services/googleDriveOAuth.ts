/**
 * Google Drive Integration with OAuth 2.0
 *
 * Uses organizer's OAuth token to upload photos to their Drive folder.
 * Participants don't need Google accounts - photos are uploaded using organizer's credentials.
 */

interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

interface UploadOptions {
  file: ArrayBuffer;
  fileName: string;
  mimeType: string;
  folderId: string;
}

interface UploadResult {
  driveFileId: string;
  thumbnailUrl: string;
  fullUrl: string;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  credentials: OAuthCredentials
): Promise<OAuthTokens> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code: ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
  credentials: OAuthCredentials
): Promise<OAuthTokens> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh token: ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Get valid access token (refresh if needed)
 */
export async function getValidAccessToken(
  tokens: OAuthTokens,
  credentials: OAuthCredentials
): Promise<string> {
  // If token is still valid (with 5 min buffer), use it
  if (tokens.expiresAt > Date.now() + 5 * 60 * 1000) {
    return tokens.accessToken;
  }

  // Token expired, refresh it
  if (!tokens.refreshToken) {
    throw new Error("No refresh token available");
  }

  const newTokens = await refreshAccessToken(tokens.refreshToken, credentials);
  return newTokens.accessToken;
}

/**
 * Upload file to Google Drive using OAuth token
 */
export async function uploadToGoogleDriveOAuth(
  options: UploadOptions,
  accessToken: string
): Promise<UploadResult> {
  const { file, fileName, mimeType, folderId } = options;

  // Step 1: Upload file
  const metadata = {
    name: `${Date.now()}`,
    mimeType,
    parents: [folderId],
  };

  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartBody = [
    delimiter,
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata),
    delimiter,
    `Content-Type: ${mimeType}\r\n\r\n`,
  ].join("");

  const multipartBodyBuffer = new Uint8Array(
    new TextEncoder().encode(multipartBody).length +
      new Uint8Array(file).length +
      new TextEncoder().encode(closeDelimiter).length
  );

  let offset = 0;
  const textEncoder = new TextEncoder();

  const multipartBodyStart = textEncoder.encode(multipartBody);
  multipartBodyBuffer.set(multipartBodyStart, offset);
  offset += multipartBodyStart.length;

  multipartBodyBuffer.set(new Uint8Array(file), offset);
  offset += new Uint8Array(file).length;

  const closeDelimiterBytes = textEncoder.encode(closeDelimiter);
  multipartBodyBuffer.set(closeDelimiterBytes, offset);

  const uploadResponse = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBodyBuffer,
    }
  );

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    console.error("Drive API Error:", error);
    throw new Error(`Upload failed: ${error}`);
  }

  const uploadData = (await uploadResponse.json()) as { id: string };
  const fileId = uploadData.id;

  // Step 2: Make file publicly readable
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "reader",
        type: "anyone",
      }),
    }
  );

  // Step 3: Get file info with URLs
  const fileInfoResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink,webContentLink`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!fileInfoResponse.ok) {
    throw new Error("Failed to get file info");
  }

  const fileInfo = (await fileInfoResponse.json()) as {
    thumbnailLink?: string;
    webContentLink?: string;
  };

  return {
    driveFileId: fileId,
    thumbnailUrl:
      fileInfo.thumbnailLink ||
      `https://drive.google.com/thumbnail?id=${fileId}`,
    // Use thumbnailLink with =s0 for full size, as it supports CORS
    // webContentLink and uc URLs are blocked by CORS/OpaqueResponseBlocking
    fullUrl: fileInfo.thumbnailLink
      ? fileInfo.thumbnailLink.replace(/=s\d+$/, "=s0")
      : `https://drive.google.com/thumbnail?id=${fileId}&sz=s0`,
  };
}

/**
 * Generate OAuth authorization URL
 */
export function getAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state?: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive",
    access_type: "offline",
    prompt: "consent",
  });

  if (state) {
    params.set("state", state);
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Get folder name from Google Drive
 */
export async function getFolderName(
  folderId: string,
  accessToken: string
): Promise<string> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}?fields=name`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to get folder info");
  }

  const data = (await response.json()) as { name: string };
  return data.name;
}
