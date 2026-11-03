// Shown on the 路宣登記 page (/admin/street) to admins

// Tickets one sale may carry; the type's per-person limit does not apply.
// Keep in sync with MAX_TICKETS_PER_ORDER in functions/lib/orderValidation.js
export const MAX_STREET_TICKETS = 20

// the quantities on the price board; others with the stepper
export const BOARD_QUANTITIES = [1, 2, 3, 4, 5, 6, 8, 10]

// NT$ bills a buyer may hand over, for the change calculator
export const CASH_NOTES = [100, 500, 1000, 2000]

// how a sale goes, in order
export const STREET_STEPS = [
  '在價目板點張數，跟購票人確認金額',
  '收下現金，按收到的鈔票算出找零',
  '交付紙本票券，再按「登記」記下這筆',
  '收到的現金交給總副召，我們會依登記紀錄對帳'
]
