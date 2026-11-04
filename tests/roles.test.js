// Staff roles: the client's list must rank roles exactly as the functions do
// (functions/lib/constants.js); firestore.rules keep a third copy in roleRank().
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLE_RANK, STAFF_ROLES, isStaffRole, roleLabel } from '../src/data/roles.js'
import { ROLE_RANK as FUNCTIONS_ROLE_RANK } from '../functions/lib/constants.js'

test('the client ranks roles exactly as the functions do', () => {
  assert.deepEqual(ROLE_RANK, FUNCTIONS_ROLE_RANK)
})

test('roles are listed lowest rank first', () => {
  const ranks = STAFF_ROLES.map((r) => r.rank)
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))
})

test('only the listed roles are staff roles', () => {
  for (const role of ['manager', 'admin', 'super_admin', 'developer']) assert.equal(isStaffRole(role), true)
  for (const role of ['owner', '', null, undefined, 'toString', 'hasOwnProperty']) assert.equal(isStaffRole(role), false)
})

test('super admins are shown as 舞會總副召 and developers as 開發者', () => {
  assert.equal(roleLabel('super_admin'), '舞會總副召')
  assert.equal(roleLabel('developer'), '開發者')
  assert.equal(roleLabel(undefined), '未設定')
})
