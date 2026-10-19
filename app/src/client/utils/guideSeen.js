// Remembers on this device that a guide was shown, so it only opens by
// itself on the first visit. Storage can be unavailable (private mode); the
// guide then simply shows again next time.

export function isGuideSeen(key) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function markGuideSeen(key) {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // ignore
  }
}
