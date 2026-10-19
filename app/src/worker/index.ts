// The Worker: the API, the lineup images in R2, and the static Astro site
// (Workers Static Assets). Also the mail queue consumer and the cron sweep.
import { api } from '../server/app'
import type { Env, MailMessage } from '../server/env'
import { consumeMailBatch, sweepMail } from '../server/mail/worker'

// Pages for paths with an id in them; the page reads the id from the URL
const PAGE_REWRITES: [RegExp, string][] = [
  [/^\/product\/[^/]+\/?$/, '/product/'],
  [/^\/orders\/[^/]+\/?$/, '/order-detail/'],
  [/^\/admin\/orders\/[^/]+\/?$/, '/admin/order-detail/']
]

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
    for (const [pattern, page] of PAGE_REWRITES) {
      if (pattern.test(url.pathname)) return env.ASSETS.fetch(new URL(page, url))
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
