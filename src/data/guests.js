// 公關票: the officer page (/officer), the invite page and the admin page
// (/super_admin/guests). Keep MAX_GUEST_TICKETS, MAX_OFFICER_QUOTA and
// MAX_INVITE_NOTE in sync with functions/lib/constants.js (the last two
// also with firestore.rules)

// Tickets one send or invite link may carry
export const MAX_GUEST_TICKETS = 10

// The largest quota an officer (幹部) may be given
export const MAX_OFFICER_QUOTA = 500

// Characters in an invite link's note, which only its officer and super
// admins read
export const MAX_INVITE_NOTE = 100

// How a guest invited before the officer quotas knew the council, kept on
// their order: "建班大學長・80 屆 主席" / "親友・副主席 鄭詠齊不存在的女朋友".
// Keep in sync with functions/lib/constants.js
export function guestRelationText(guest) {
  const detail = String(guest?.relationDetail || '').trim()
  if (guest?.relation === 'alumni') return detail ? `建班大學長・${detail}` : '建班大學長'
  if (guest?.relation === 'friend') return detail ? `親友・${detail}` : '親友'
  return ''
}

// Who gave a 公關票 out: the officer's name, or 班聯會 for one a super admin
// sent directly; older tickets show how the guest knew the council
export function guestSourceText(order) {
  if (order?.officerEmail) return order.officerName ? `${order.officerName} 邀請` : `${order.officerEmail} 邀請`
  return guestRelationText(order?.guest) || '班聯會'
}
