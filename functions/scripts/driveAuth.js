// Grants the functions access to the council's Google Drive (lib/drive.js),
// once, or again after the grant was revoked. Run on your own computer:
//
//   DRIVE_CLIENT_ID=… DRIVE_CLIENT_SECRET=… yarn drive:auth
//
// It prints a Google sign-in link. Open it, sign in as DRIVE_OWNER and
// allow access; the account is checked, and its refresh token is written to
// a file only you can read, with the command that stores it as the
// DRIVE_REFRESH_TOKEN secret. Nothing is sent anywhere else.
import { createHash, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DRIVE_OWNER, DRIVE_SCOPE, TOKEN_URL } from '../lib/drive.js'

const clientId = process.env.DRIVE_CLIENT_ID
const clientSecret = process.env.DRIVE_CLIENT_SECRET
if (!clientId || !clientSecret) {
  console.error('Set DRIVE_CLIENT_ID and DRIVE_CLIENT_SECRET (the OAuth client, Desktop app type); see functions/README.md')
  process.exit(1)
}

const base64url = (buffer) => buffer.toString('base64url')
const state = base64url(randomBytes(16))
const verifier = base64url(randomBytes(32))
const challenge = base64url(createHash('sha256').update(verifier).digest())

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname !== '/') {
    response.writeHead(404).end()
    return
  }

  const finish = (status, message) => {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message)
    server.close()
  }

  if (url.searchParams.get('state') !== state) return finish(400, 'State mismatch; run the script again.')
  const code = url.searchParams.get('code')
  if (!code) return finish(400, `Not allowed: ${url.searchParams.get('error') || 'no code'}`)

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier
    })
  })
  const tokens = await tokenResponse.json().catch(() => ({}))
  if (!tokenResponse.ok || !tokens.refresh_token || !tokens.id_token) {
    console.error('Token exchange failed:', tokens.error || tokenResponse.status, tokens.error_description || '')
    return finish(500, 'Token exchange failed; see the terminal.')
  }

  // the id token came straight from Google over TLS, so its payload is read as is
  const identity = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString())
  const email = String(identity.email || '').toLowerCase()
  if (email !== DRIVE_OWNER || identity.email_verified !== true) {
    console.error(`Signed in as ${email || 'an unknown account'}, not ${DRIVE_OWNER}. Nothing was saved; run again and pick ${DRIVE_OWNER}.`)
    return finish(403, `Wrong account: sign in as ${DRIVE_OWNER}.`)
  }
  if (!String(tokens.scope || '').split(' ').includes(DRIVE_SCOPE)) {
    console.error('Drive access was not granted (the Drive box was unticked). Run again and allow it.')
    return finish(403, 'Drive access was not granted.')
  }

  const file = join(tmpdir(), `drive-refresh-token-${Date.now()}.txt`)
  writeFileSync(file, tokens.refresh_token, { mode: 0o600 })
  console.log(`\nGranted by ${email}. Store the token as the secret, then delete the file:\n`)
  console.log(`  firebase functions:secrets:set DRIVE_REFRESH_TOKEN --data-file "${file}"`)
  console.log(`  rm "${file}"\n`)
  console.log('Then redeploy the functions that use it (submitReimbursement, trashReimbursementInvoices).')
  finish(200, 'Done. You can close this tab and go back to the terminal.')
})

// a loopback redirect on any port is allowed for Desktop app clients
const redirectUri = () => `http://127.0.0.1:${server.address().port}`

server.listen(0, '127.0.0.1', () => {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: `openid email ${DRIVE_SCOPE}`,
    // a refresh token, also when this account granted access before
    access_type: 'offline',
    prompt: 'consent',
    login_hint: DRIVE_OWNER,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })
  console.log(`Open this link, sign in as ${DRIVE_OWNER} and allow access:\n`)
  console.log(`https://accounts.google.com/o/oauth2/v2/auth?${params}\n`)
})
