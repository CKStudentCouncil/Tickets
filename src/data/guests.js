// 公關票: the registration form on /guest and the send form on
// /super_admin/guests. Keep the relation values and MAX_GUEST_TICKETS in
// sync with functions/lib/constants.js and firestore.rules

// Tickets one invitation may carry
export const MAX_GUEST_TICKETS = 10

// How a guest knows the council; `detail` is what they write next to it
export const GUEST_RELATIONS = [
  { value: 'alumni', label: '建班大學長', detail: '屆數及幹位', placeholder: '例：80 屆 主席' },
  { value: 'friend', label: '親友', detail: '誰的親友及稱謂', placeholder: '例：副主席 鄭詠齊不存在的女朋友' }
]

// "建班大學長・80 屆 主席" / "親友・副主席 鄭詠齊不存在的女朋友". Keep in sync with functions/lib/constants.js
export function guestRelationText(guest) {
  const detail = String(guest?.relationDetail || '').trim()
  if (guest?.relation === 'alumni') return detail ? `建班大學長・${detail}` : '建班大學長'
  if (guest?.relation === 'friend') return detail ? `親友・${detail}` : '親友'
  return ''
}
