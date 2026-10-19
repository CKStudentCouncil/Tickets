// Database rows <-> the objects the pages use. The API keeps the field names
// of the Firestore documents (camelCase, ISO date strings) so the Vue pages
// work unchanged.
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString())

export interface OrderRow {
  id: string
  user_id: string
  customer_name: string
  customer_email: string
  customer_phone: string
  school: string
  class: string
  number: string
  office: string
  items: string
  original_total: number
  final_total: number
  ticket_code: string
  delivered: number
  delivery_updated_at: number | null
  delivery_updated_by_uid: string | null
  delivery_updated_by_name: string | null
  paid: number
  payment_updated_at: number | null
  payment_updated_by_uid: string | null
  payment_updated_by_name: string | null
  email_status: string
  email_job_id: string | null
  email_error: string | null
  email_updated_at: number | null
  email_provider_message_id: string | null
  created_at: number
  deleted_at: number | null
}

export interface OrderItem {
  id: string
  ticketTypeId: string
  name: string
  price: number
  quantity: number
}

export function orderFromRow(row: OrderRow) {
  return {
    id: row.id,
    userId: row.user_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    school: row.school,
    class: row.class,
    number: row.number,
    office: row.office,
    items: JSON.parse(row.items) as OrderItem[],
    originalTotal: row.original_total,
    finalTotal: row.final_total,
    ticketCode: row.ticket_code,
    delivered: row.delivered === 1,
    deliveryUpdatedAt: iso(row.delivery_updated_at),
    deliveryUpdatedByUid: row.delivery_updated_by_uid || '',
    deliveryUpdatedByName: row.delivery_updated_by_name || '',
    paid: row.paid === 1,
    paymentUpdatedAt: iso(row.payment_updated_at),
    paymentUpdatedByUid: row.payment_updated_by_uid || '',
    paymentUpdatedByName: row.payment_updated_by_name || '',
    emailStatus: row.email_status,
    emailError: row.email_error || '',
    emailUpdatedAt: iso(row.email_updated_at),
    createdAt: iso(row.created_at)
  }
}
export type Order = ReturnType<typeof orderFromRow>

// A ticket type as the management page edits it
export interface TicketTypeConfig {
  id: string
  name: string
  price: number
  salesStartTime: string
  salesEndTime: string
  totalTicketQuantity?: number
  unlimitedStock?: boolean
  purchaseLimitPerPerson?: number
  unlimited?: boolean
  eligibleBuyerIdentity?: string
  [key: string]: unknown
}

export interface TicketTypeRow {
  id: string
  sort: number
  active: number
  config: string
  stock: number | null
  sold: number
}

export const ticketTypeFromRow = (row: TicketTypeRow): TicketTypeConfig => ({ ...JSON.parse(row.config), id: row.id })

export { iso }
