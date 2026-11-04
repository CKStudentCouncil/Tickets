import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'

import { DRIVE_SECRETS, LINK_VIEWER, shareByLink } from '../../lib/drive.js'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  DRIVE_SECRETS.forEach((name) => delete process.env[name])
})

test('shareByLink lets anyone with the link view the file, unlisted', async () => {
  DRIVE_SECRETS.forEach((name) => { process.env[name] = `test-${name}` })
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const body = String(url).startsWith('https://oauth2.googleapis.com/')
      ? { access_token: 'access', expires_in: 3600 }
      : { id: 'anyoneWithLink' }
    return { ok: true, status: 200, json: async () => body }
  }

  await shareByLink('file/1')

  const share = calls.at(-1)
  assert.equal(share.url, 'https://www.googleapis.com/drive/v3/files/file%2F1/permissions?fields=id')
  assert.equal(share.init.method, 'POST')
  assert.equal(share.init.headers.Authorization, 'Bearer access')
  assert.deepEqual(JSON.parse(share.init.body), { type: 'anyone', role: 'reader', allowFileDiscovery: false })
  assert.deepEqual(LINK_VIEWER, JSON.parse(share.init.body))
})
