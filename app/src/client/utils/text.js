export function splitParagraphs(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

export function escapeHtml(value, fallback = '') {
  return String(value ?? fallback)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Single-line preview of long content
export function excerpt(content, maxLength = 100) {
  const text = String(content || '').replace(/\s+/g, ' ').trim()
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`
}
