const TAIPEI_OFFSET = '+08:00'
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

// Admin-entered datetimes always mean Taiwan time. New values are stored as
// "YYYY-MM-DDTHH:mm:00+08:00"; older ones as "YYYY-MM-DDTHH:mm" without an
// offset, which is read as Taiwan time too (same as functions/lib/time.js).
export function parseDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value.toDate === 'function') return value.toDate()

  let text = String(value)
  if (NAIVE_DATETIME.test(text)) {
    text = `${text.length === 16 ? `${text}:00` : text}${TAIPEI_OFFSET}`
  }

  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

export function isPublished(publishAt, now = new Date()) {
  const date = parseDate(publishAt)
  return !!date && date <= now
}

export function formatDateTime(value) {
  const date = parseDate(value)
  return date ? date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : ''
}

export function formatLongDate(value) {
  const date = parseDate(value)
  if (!date) return ''

  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date)
}

// "YYYY-MM-DD" in Taiwan time, for grouping records by day
export function getTaiwanDateKey(value) {
  const date = parseDate(value)
  if (!date) return null

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

/* ---------- split date / time inputs bound to a "YYYY-MM-DDTHH:mm" value ---------- */
// Input values are Taiwan wall-clock time regardless of the admin's device.

const TAIPEI_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

export function toDateTimeInputValue(date) {
  const parts = Object.fromEntries(
    TAIPEI_PARTS.formatToParts(date).map((part) => [part.type, part.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

// Stored value (with or without offset) -> "YYYY-MM-DDTHH:mm" for the inputs
export function toDateTimeInput(value) {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    (NAIVE_DATETIME.test(value) || value.endsWith(TAIPEI_OFFSET))) {
    return value.slice(0, 16)
  }
  const date = parseDate(value)
  return date ? toDateTimeInputValue(date) : ''
}

// "YYYY-MM-DDTHH:mm" -> "YYYY-MM-DDTHH:mm:00+08:00" for saving
export function toStoredDateTime(inputValue) {
  return inputValue ? `${toDateTimeInput(inputValue)}:00${TAIPEI_OFFSET}` : ''
}

export function getDateTimePart(value, part) {
  const [date = '', time = ''] = (value || '').split('T')
  return part === 'date' ? date : time.slice(0, 5)
}

// Returns the updated "YYYY-MM-DDTHH:mm" string ('' when no date is set)
export function setDateTimePart(value, part, newValue, defaultTime = '00:00') {
  const [date = '', time = ''] = (value || '').split('T')
  const nextDate = part === 'date' ? newValue : date
  const nextTime = (part === 'time' ? newValue : time.slice(0, 5)) || defaultTime

  return nextDate ? `${nextDate}T${nextTime}` : ''
}

const DAY_MS = 24 * 60 * 60 * 1000

// `days` after the given input value (or after now), Taiwan has no DST
export function addDaysInputValue(value, days) {
  const base = parseDate(value) || new Date()
  return toDateTimeInputValue(new Date(base.getTime() + days * DAY_MS))
}

// Taiwan midnight `days` from today
export function startOfDayInputValue(days) {
  const date = toDateTimeInputValue(new Date(Date.now() + days * DAY_MS)).slice(0, 10)
  return `${date}T00:00`
}
