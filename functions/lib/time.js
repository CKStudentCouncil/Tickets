// Admin-entered datetimes mean Taiwan time. They are saved as
// "YYYY-MM-DDTHH:mm:00+08:00"; older values may lack the offset
// ("YYYY-MM-DDTHH:mm"). Functions run in UTC, so a missing offset must be
// treated as +08:00 or every sale window would shift by 8 hours.
export function parseTaipeiDateTime(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()

  let text = String(value)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    text = `${text.length === 16 ? `${text}:00` : text}+08:00`
  }

  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

// "YYYYMMDD" in Taiwan time
export function getTaiwanDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .format(date)
    .replace(/-/g, '')
}

export function toIsoString(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  return value instanceof Date ? value.toISOString() : value
}
