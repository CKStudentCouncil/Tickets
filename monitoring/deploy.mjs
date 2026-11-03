#!/usr/bin/env node
// Sets up (or updates) the createOrder log-based metrics, the 購票即時監控
// dashboard and its alert policies in a Google Cloud project, through the
// Logging and Monitoring REST APIs with your gcloud login. Safe to run again:
// everything is found by name and updated in place.
//
//   node monitoring/deploy.mjs [--project cksc-ticket] [--email you@example.com] [--dry-run]
//
// --email   where the alerts go (an email notification channel, made once);
//           without it the policies are set up with no one to notify
// --dry-run prints what would be sent, calls nothing
import { execFileSync } from 'node:child_process'
import { ALERTS, DASHBOARD_NAME, METRICS, dashboard } from './config.mjs'

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const project = option('project', 'cksc-ticket')
const email = option('email', '')
const dryRun = process.argv.includes('--dry-run')

const LOGGING = `https://logging.googleapis.com/v2/projects/${project}`
const MONITORING = `https://monitoring.googleapis.com/v3/projects/${project}`
const DASHBOARDS = `https://monitoring.googleapis.com/v1/projects/${project}/dashboards`

if (dryRun) {
  console.log(JSON.stringify({ project, email, metrics: METRICS, dashboard: dashboard(project), alerts: ALERTS }, null, 2))
  process.exit(0)
}

const gcloud = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud'
const token = execFileSync(gcloud, ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': project
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  if (response.status === 404 && method === 'GET') return null
  if (!response.ok) throw new Error(`${method} ${url}: ${response.status} ${json.error?.message || text}`)
  return json
}

async function listAll(url, key) {
  const items = []
  let pageToken = ''
  do {
    const page = await api('GET', `${url}${url.includes('?') ? '&' : '?'}pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`)
    items.push(...(page?.[key] || []))
    pageToken = page?.nextPageToken || ''
  } while (pageToken)
  return items
}

async function deployMetrics() {
  for (const metric of METRICS) {
    const url = `${LOGGING}/metrics/${metric.name}`
    if (await api('GET', url)) {
      await api('PUT', url, metric)
      console.log(`metric ${metric.name}: updated`)
    } else {
      await api('POST', `${LOGGING}/metrics`, metric)
      console.log(`metric ${metric.name}: created`)
    }
  }
}

async function deployDashboard() {
  const body = dashboard(project)
  const existing = (await listAll(DASHBOARDS, 'dashboards')).find((item) => item.displayName === DASHBOARD_NAME)
  if (existing) {
    await api('PATCH', `https://monitoring.googleapis.com/v1/${existing.name}`, { ...body, name: existing.name, etag: existing.etag })
    console.log(`dashboard ${DASHBOARD_NAME}: updated`)
  } else {
    await api('POST', DASHBOARDS, body)
    console.log(`dashboard ${DASHBOARD_NAME}: created`)
  }
  console.log(`  https://console.cloud.google.com/monitoring/dashboards?project=${project}`)
}

async function emailChannel() {
  if (!email) return null
  const channels = await listAll(`${MONITORING}/notificationChannels?filter=${encodeURIComponent('type="email"')}`, 'notificationChannels')
  const existing = channels.find((channel) => channel.labels?.email_address === email)
  if (existing) return existing.name
  const created = await api('POST', `${MONITORING}/notificationChannels`, {
    type: 'email',
    displayName: `購票告警 ${email}`,
    labels: { email_address: email }
  })
  console.log(`notification channel for ${email}: created`)
  return created.name
}

async function deployAlerts() {
  const channel = await emailChannel()
  if (!channel) console.log('no --email: alert policies get no notification channel (incidents show in the console only)')
  const policies = await listAll(`${MONITORING}/alertPolicies`, 'alertPolicies')
  for (const alert of ALERTS) {
    const existing = policies.find((item) => item.displayName === alert.displayName)
    const channels = [...new Set([...(existing?.notificationChannels || []), ...(channel ? [channel] : [])])]
    const body = { ...alert, notificationChannels: channels }
    if (existing) {
      await api('PATCH', `https://monitoring.googleapis.com/v3/${existing.name}`, { ...body, name: existing.name })
      console.log(`alert ${alert.displayName}: updated`)
    } else {
      await api('POST', `${MONITORING}/alertPolicies`, body)
      console.log(`alert ${alert.displayName}: created`)
    }
  }
}

try {
  await deployMetrics()
  await deployDashboard()
  await deployAlerts()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
