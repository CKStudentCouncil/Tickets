// The frontend and the functions each keep a copy of a few constants and of
// the Taiwan-time parser; these tests fail if the copies drift apart.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SITE_URL, SHOP_OPEN_AT, SCHOOL_CODES, CAMPUS_SCHOOLS, HOME_SCHOOL, SCHOOL_ACCOUNT_DOMAIN, ELIGIBLE_IDENTITIES } from '../../lib/constants.js'
import { parseTaipeiDateTime } from '../../lib/time.js'
import { generateOrderNotificationHTML } from '../../templates/notification.js'
import { EVENT_META } from '../../templates/shared.js'

const srcFile = (path) => new URL(`../../../src/${path}`, import.meta.url)

test('SITE_URL and the default opening time match src/config/app.js', async () => {
  const app = await import(srcFile('config/app.js'))
  assert.equal(app.SITE_URL, SITE_URL)
  assert.equal(app.SHOP_OPEN_AT.getTime(), SHOP_OPEN_AT.getTime())
})

test('school lists match src/data/schools.js', async () => {
  const schools = await import(srcFile('data/schools.js'))
  assert.deepEqual(schools.SCHOOL_CODES, SCHOOL_CODES)
  assert.deepEqual(schools.CAMPUS_SCHOOLS, [...CAMPUS_SCHOOLS])
  assert.equal(schools.HOME_SCHOOL, HOME_SCHOOL)
  assert.equal(schools.SCHOOL_ACCOUNT_DOMAIN, SCHOOL_ACCOUNT_DOMAIN)
})

test('ELIGIBLE_IDENTITIES match src/data/ticketTypes.js (PARTY-27)', async () => {
  const frontend = await import(srcFile('data/ticketTypes.js'))
  assert.deepEqual(frontend.ELIGIBLE_IDENTITIES, ELIGIBLE_IDENTITIES)
})

test('client and server parse admin datetimes identically', async () => {
  const { parseDate, toStoredDateTime, toDateTimeInput } = await import(srcFile('utils/datetime.js'))
  for (const value of ['2026-11-05T12:00', '2026-11-05T12:00:00', '2026-11-05T12:00:00+08:00', '2026-11-05T04:00:00Z']) {
    assert.equal(parseDate(value).getTime(), parseTaipeiDateTime(value).getTime(), value)
  }
  assert.equal(toStoredDateTime('2026-11-05T12:00'), '2026-11-05T12:00:00+08:00')
  assert.equal(toDateTimeInput('2026-11-05T12:00:00+08:00'), '2026-11-05T12:00')
  assert.equal(toDateTimeInput('2026-11-05T04:00:00Z'), '2026-11-05T12:00')
})

test('notification email links to this site only', () => {
  const html = generateOrderNotificationHTML({ type: 'custom', message: 'hi' })
  assert.doesNotMatch(html, /souvenir\.cksc\.tw/)
  assert.match(html, new RegExp(`${SITE_URL.replace(/\./g, '\\.')}/survey`))
})

test('email hero shows the same date and venue as the site (src/config/app.js)', async () => {
  const app = await import(srcFile('config/app.js'))
  assert.equal(`${app.EVENT_DATE} · ${app.EVENT_VENUE}`, EVENT_META)
})
