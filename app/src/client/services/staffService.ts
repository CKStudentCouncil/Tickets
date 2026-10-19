// Staff accounts and invites (super admins)
import { client, unwrap } from 'src/api'

export async function fetchStaff() {
  return (await unwrap(client.admin.staff.$get())).users
}

export function inviteStaff(invite: { email: string; name: string; role: string }) {
  return unwrap(client.admin.staff.invites.$post({ json: invite }))
}

export function updateStaffRole(user: { id: string; pending: boolean }, role: string) {
  return unwrap(client.admin.staff[':id'].$patch({ param: { id: user.id }, json: { role, pending: user.pending } }))
}

export function deleteStaff(user: { id: string; pending: boolean }) {
  return unwrap(client.admin.staff[':id'].$delete({ param: { id: user.id }, query: { pending: String(user.pending) as 'true' | 'false' } }))
}

// Removes every manager / admin account and invite; super admins stay
export function deleteAllStaff() {
  return unwrap(client.admin.staff['delete-all'].$post())
}
