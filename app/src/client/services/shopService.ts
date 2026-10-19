// The site's opening time (settings key "shop"): public to read, set by
// super admins on the management page, and checked by the checkout.
import { client, unwrap } from 'src/api'

// How often open pages re-read the opening time, so "立即開賣" or a
// postponed opening reaches them (the Firestore version was a live listener)
const POLL_MS = 30_000

export function fetchShopSettings() {
  return unwrap(client.public.shop.$get())
}

// Calls onChange with { openAt } now and whenever it is re-read; returns a
// function that stops it. onError gets each failed read.
export function watchShopSettings(onChange: (data: { openAt: string | null }) => void, onError: (error: unknown) => void) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const load = async () => {
    try {
      const data = await fetchShopSettings()
      if (!stopped) onChange(data)
    } catch (error) {
      if (!stopped) onError(error)
    } finally {
      if (!stopped) timer = setTimeout(load, POLL_MS)
    }
  }
  load()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

// `openAt` is a Date, or null for "now" (the server's clock, not this device's)
export function saveShopOpenAt(openAt: Date | null, _updatedByUid?: string) {
  return unwrap(client.admin.shop.$put({ json: { openAt: openAt ? openAt.toISOString() : null } }))
}
