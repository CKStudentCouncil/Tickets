// The council's Google Drive (DRIVE_OWNER), where 報帳 invoices are kept
// (reimbursements.js). The functions act as that account through an OAuth
// refresh token it granted once with scripts/driveAuth.js, limited to the
// drive.file scope: they see only the folders and files they made
// themselves, nothing else in that Drive. Plain fetch against the REST API,
// so no Google API client is loaded.
//   DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET  the OAuth client (Desktop app) of
//                                         the Firebase project
//   DRIVE_REFRESH_TOKEN                   the account's grant
import { randomUUID } from 'node:crypto'

export const DRIVE_OWNER = 'ckhssc@gl.ck.tp.edu.tw'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const DRIVE_SECRETS = ['DRIVE_CLIENT_ID', 'DRIVE_CLIENT_SECRET', 'DRIVE_REFRESH_TOKEN']

export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
export const FOLDER_TYPE = 'application/vnd.google-apps.folder'
const TIMEOUT_MS = 30_000

// `status` is the HTTP status; `auth` marks a grant that no longer works
// (revoked, or the secrets are wrong), which retrying does not fix
export class DriveError extends Error {
  constructor(message, { status = 0, auth = false } = {}) {
    super(message)
    this.name = 'DriveError'
    this.status = status
    this.auth = auth
  }
}

// An access token lasts an hour; one is kept per instance until shortly before
let cachedToken = null

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token

  const [clientId, clientSecret, refreshToken] = DRIVE_SECRETS.map((name) => process.env[name] || '')
  if (!clientId || !clientSecret || !refreshToken) {
    throw new DriveError('the DRIVE_* secrets are not set', { auth: true })
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) {
    // invalid_grant: revoked or expired; run scripts/driveAuth.js again
    throw new DriveError(`token refresh failed: ${body.error || response.status}`, {
      status: response.status,
      auth: response.status === 400 || response.status === 401
    })
  }

  cachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000
  }
  return cachedToken.token
}

async function call(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!response.ok) {
    if (response.status === 401) cachedToken = null
    const detail = await response.text().catch(() => '')
    throw new DriveError(
      `Drive ${init.method || 'GET'} ${new URL(url).pathname} ${response.status}: ${detail.slice(0, 300)}`,
      { status: response.status }
    )
  }
  return response.json()
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=UTF-8' }
const quote = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

// A folder this app made with that name, wherever the owner moved it; null if none
export async function findFolder(name) {
  const q = `name = ${quote(name)} and mimeType = '${FOLDER_TYPE}' and trashed = false`
  const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' })
  const { files = [] } = await call(`${API}/files?${params}`)
  return files[0]?.id || null
}

// In the root of the owner's My Drive
export async function createFolder(name) {
  const { id } = await call(`${API}/files?fields=id`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, mimeType: FOLDER_TYPE })
  })
  return id
}

// A multipart/related upload: the file's metadata, then its content
export function multipartBody(metadata, contentType, content, boundary) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])
}

// Returns { id, webViewLink }
export async function uploadFile({ name, contentType, content, folderId, description = '' }) {
  const boundary = `cksc-${randomUUID()}`
  return call(`${UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody({ name, parents: [folderId], description }, contentType, content, boundary)
  })
}

// Anyone with the file's link can view it, signed in or not; it does not
// show up in anyone's Drive search
export const LINK_VIEWER = { type: 'anyone', role: 'reader', allowFileDiscovery: false }

export async function shareByLink(fileId) {
  await call(`${API}/files/${encodeURIComponent(fileId)}/permissions?fields=id`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(LINK_VIEWER)
  })
}

// To the Drive's trash, where the owner can still restore it for 30 days.
// One already gone counts as done.
export async function trashFile(fileId) {
  try {
    await call(`${API}/files/${encodeURIComponent(fileId)}?fields=id`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ trashed: true })
    })
  } catch (error) {
    if (error.status !== 404) throw error
  }
}
