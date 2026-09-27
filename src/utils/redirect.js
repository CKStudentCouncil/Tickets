// Only same-site paths, never "//evil.com" or absolute URLs
export function safeRedirect(value, fallback = '/admin') {
  const path = String(value || '')
  return path.startsWith('/') && !path.startsWith('//') ? path : fallback
}
