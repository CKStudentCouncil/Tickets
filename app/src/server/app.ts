// The API under /api (Hono, typed for the RPC client in src/client/api.ts).
import { Hono } from 'hono'
import { ApiError } from './errors'
import { authFor, loadSession, staffRole, type AppEnv } from './context'
import { publicRoutes } from './routes/public'
import { orderRoutes } from './routes/orders'
import { adminOrderRoutes } from './routes/admin-orders'
import { adminSiteRoutes } from './routes/admin-site'
import { notificationRoutes } from './routes/notifications'
import { surveyRoutes } from './routes/survey'

const routes = new Hono<AppEnv>()
  .use('*', loadSession)
  .get('/me', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ user: null })
    const { role, staffName } = await staffRole(c.env.DB, user.id)
    return c.json({
      user: {
        uid: user.id, email: user.email, displayName: user.name, photoURL: user.image || '',
        name: staffName || '', role
      }
    })
  })
  .route('/public', publicRoutes)
  .route('/orders', orderRoutes)
  .route('/survey', surveyRoutes)
  .route('/admin/orders', adminOrderRoutes)
  .route('/admin/notifications', notificationRoutes)
  .route('/admin', adminSiteRoutes)

export const api = new Hono<AppEnv>()
  .basePath('/api')
  .onError((error, c) => {
    if (error instanceof ApiError) return c.json(error.toJSON(), error.status)
    // malformed JSON and other client errors from Hono itself
    const status = (error as { status?: number }).status
    if (status && status >= 400 && status < 500) {
      return c.json({ code: 'invalid-argument', message: '資料格式錯誤' }, 400)
    }
    console.error('[api] unexpected error:', error)
    return c.json({ code: 'internal', message: '伺服器發生錯誤，請稍後再試' }, 500)
  })
  // Better Auth's own routes (sign-in, callback, sign-out, session), not RPC
  .on(['GET', 'POST'], '/auth/*', (c) => authFor(c.env).handler(c.req.raw))
  .route('/', routes)

export type AppType = typeof routes
