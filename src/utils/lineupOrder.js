import { parseDate } from './datetime.js'

// Admins arrange each lineup type by hand; `order` is the position within its
// type. Items saved before ordering existed have none: they follow the
// ordered ones by publish time, which was the public order until then.
export function compareLineupOrder(a, b) {
  const orderA = Number.isFinite(a.order) ? a.order : Infinity
  const orderB = Number.isFinite(b.order) ? b.order : Infinity
  if (orderA !== orderB) return orderA - orderB

  return (parseDate(a.publishAt)?.getTime() || 0) - (parseDate(b.publishAt)?.getTime() || 0)
}

export function moveItem(items, from, to) {
  const next = [...items]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

// [item, order] for every item whose stored order differs from its index
export function orderUpdates(items) {
  return items.flatMap((item, index) => (item.order === index ? [] : [[item, index]]))
}
