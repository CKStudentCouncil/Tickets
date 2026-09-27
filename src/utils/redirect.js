// Only same-site paths, never "//evil.com" or absolute URLs
export function safeRedirect(value, fallback = '/') {
  const path = String(value || '')
  return path.startsWith('/') && !path.startsWith('//') ? path : fallback
}
