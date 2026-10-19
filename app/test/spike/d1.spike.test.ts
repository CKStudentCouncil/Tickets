import { env } from 'cloudflare:workers'
import { beforeEach, expect, it } from 'vitest'

const db = env.DB

function checkout(orderId: string, qty: number, limit = 4) {
  return db.batch([
    db.prepare('UPDATE ticket_types SET sold = sold + ? WHERE id = ?').bind(qty, 'A'),
    db.prepare(`INSERT INTO buyer_purchases (email_hash, ticket_type_id, quantity, max_quantity) VALUES (?, 'A', ?, ?)
      ON CONFLICT DO UPDATE SET quantity = quantity + excluded.quantity, max_quantity = excluded.max_quantity`).bind('u1', qty, limit),
    db.prepare('INSERT INTO orders (id, user_id) VALUES (?, ?)').bind(orderId, 'u1')
  ])
}

const state = async () => ({
  sold: (await db.prepare("SELECT sold FROM ticket_types WHERE id = 'A'").first<number>('sold')),
  bought: await db.prepare("SELECT quantity FROM buyer_purchases WHERE email_hash = 'u1'").first<number>('quantity'),
  orders: await db.prepare('SELECT count(*) AS n FROM orders').first<number>('n')
})

beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM orders'), db.prepare('DELETE FROM buyer_purchases'), db.prepare('DELETE FROM ticket_types'),
    db.prepare("INSERT INTO ticket_types (id, stock, sold) VALUES ('A', 5, 0)")
  ])
})

it('commits the whole batch when every constraint holds', async () => {
  await checkout('o1', 3)
  expect(await state()).toEqual({ sold: 3, bought: 3, orders: 1 })
})

it('rolls back the whole batch when stock would be oversold', async () => {
  await checkout('o1', 3)
  await expect(checkout('o2', 3, 10)).rejects.toThrow(/CHECK constraint failed: stock_available/)
  expect(await state()).toEqual({ sold: 3, bought: 3, orders: 1 })
})

it('rolls back the whole batch when the per-person limit is exceeded', async () => {
  await checkout('o1', 3)
  await expect(checkout('o2', 2)).rejects.toThrow(/CHECK constraint failed: per_person_limit/)
  expect(await state()).toEqual({ sold: 3, bought: 3, orders: 1 })
})

it('rolls back stock and allowance when the order id is taken', async () => {
  await checkout('o1', 1)
  await expect(checkout('o1', 1)).rejects.toThrow(/UNIQUE constraint failed: orders.id/)
  expect(await state()).toEqual({ sold: 1, bought: 1, orders: 1 })
})

it('never oversells under concurrent checkouts', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      db.batch([
        db.prepare("UPDATE ticket_types SET sold = sold + 1 WHERE id = 'A'"),
        db.prepare('INSERT INTO orders (id, user_id) VALUES (?, ?)').bind(`c${i}`, `u${i}`)
      ])
    )
  )
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
  expect(await state()).toMatchObject({ sold: 5, orders: 5 })
})
