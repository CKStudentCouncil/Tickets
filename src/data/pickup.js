// 領票 checks besides the ticket QR code (functions/lib/orderActions.js).
// When the buyer's student card can't be scanned, staff record how they
// checked who is collecting instead; 其他 needs a note.
export const ID_CHECK_METHODS = [
  { value: 'kuclass', label: '酷課雲學生證', short: '酷課雲' },
  { value: 'other_id', label: '其他證件（身分證、健保卡）', short: '其他證件' },
  { value: 'other', label: '其他（請寫說明）', short: '其他方式' }
]
// ID_NOTE_MAX in functions/lib/orderActions.js
export const ID_NOTE_MAX = 200
