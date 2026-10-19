// Payment / pickup notifications to buyers (managers)
import { client, unwrap } from 'src/api'

export function prepareOrderNotification(data: Record<string, string>) {
  return unwrap(client.admin.notifications.$post({ json: data as never }))
}

export function sendOrderNotification({ jobId }: { jobId: string }) {
  return unwrap(client.admin.notifications[':jobId'].send.$post({ param: { jobId } }))
}

export function getOrderNotificationStatus({ jobId }: { jobId: string }) {
  return unwrap(client.admin.notifications[':jobId'].$get({ param: { jobId } }))
}
