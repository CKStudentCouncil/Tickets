// Staff roles, lowest rank first. A role may do everything the roles below
// it can. super_admin is shown as 舞會總副召; developer can do everything a
// super_admin can, and only developers may grant the developer role or
// change or delete a developer. Nobody may change their own role or delete
// their own account, so the last developer (and the last account of rank 3
// or above) can never be removed.
// Keep in sync with ROLE_RANK in functions/lib/constants.js and roleRank()
// in firestore.rules
export const STAFF_ROLES = [
  { value: 'manager', label: '友校幹部', rank: 1 },
  { value: 'admin', label: '建班幹部', rank: 2 },
  { value: 'super_admin', label: '舞會總副召', rank: 3 },
  { value: 'developer', label: '開發者', rank: 4 }
]

export const ROLE_RANK = Object.fromEntries(STAFF_ROLES.map((r) => [r.value, r.rank]))

export function isStaffRole(role) {
  return typeof role === 'string' && Object.hasOwn(ROLE_RANK, role)
}

export function roleLabel(role) {
  return STAFF_ROLES.find((r) => r.value === role)?.label || role || '未設定'
}
