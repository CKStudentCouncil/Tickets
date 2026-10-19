// The typed Hono RPC client for /api (src/server/app.ts).
import { hc } from 'hono/client'
import type { AppType } from '../server/app'

export const client = hc<AppType>('/api')

// Errors carry the codes the Firebase callables used ("functions/<code>"),
// so the pages' error handling and checkout recovery work unchanged.
export class ApiCallError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, any>, readonly status?: number) {
    super(message)
    this.name = 'ApiCallError'
  }
}

type JsonOf<R> = R extends { json(): Promise<infer T> } ? T : never
type Success<T> = T extends { code: string; message: string } ? never : T

export async function unwrap<R extends { ok: boolean; status: number; json(): Promise<unknown> }>(request: Promise<R>): Promise<Success<JsonOf<R>>> {
  let response: R
  try {
    response = await request
  } catch (error) {
    throw new ApiCallError('functions/unavailable', '無法連線到伺服器，請檢查網路後再試', { cause: String(error) })
  }
  let body: any = null
  try {
    body = await response.json()
  } catch {
    // not JSON (an HTML error page from a proxy, a lost response...)
  }
  if (!response.ok) {
    const code = typeof body?.code === 'string' ? body.code : response.status >= 500 ? 'internal' : 'unavailable'
    throw new ApiCallError(`functions/${code}`, body?.message || '伺服器暫時無法回應，請稍後再試', body?.details, response.status)
  }
  return body
}
