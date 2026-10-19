// The Worker: the API, the lineup images in R2, and the static Astro site
// (Workers Static Assets): the staff app for /admin URLs, the public app
// (index.html, the SPA fallback) for every other page. Also the mail queue consumer, the cron sweep
// and the checkout gate (a Durable Object).
import { api } from '../server/app'
import type { Env, MailMessage } from '../server/env'
import { consumeMailBatch, sweepMail } from '../server/mail/worker'

export { CheckoutGate } from '../server/checkoutGate'

async function serveMedia(env: Env, key: string) {
  const object = await env.MEDIA.get(key)
  if (!object) return new Response('Not found', { status: 404 })
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(object.body, { headers })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return api.fetch(request, env, ctx)
    if (url.pathname.startsWith('/media/lineup/') && request.method === 'GET') {
      return serveMedia(env, decodeURIComponent(url.pathname.slice('/media/'.length)))
    }
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      // every staff page is the staff app's one HTML page
      return env.ASSETS.fetch(new Request(new URL('/admin/', url), request))
    }
    return env.ASSETS.fetch(request)
  },

  async queue(batch, env) {
    await consumeMailBatch(batch, env)
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(sweepMail(env))
  }
} satisfies ExportedHandler<Env, MailMessage>
