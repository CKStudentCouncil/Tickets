// The frontend and the functions each keep a copy of a few constants and of
// the Taiwan-time parser; these tests fail if the copies drift apart.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SITE_URL, SHOP_OPEN_AT, SCHOOL_CODES, CAMPUS_SCHOOLS, HOME_SCHOOL, SCHOOL_ACCOUNT_DOMAIN, ELIGIBLE_IDENTITIES, MAX_SELLER_TICKETS, MAX_GUEST_TICKETS, MAX_OFFICER_QUOTA, guestRelationText } from '../../lib/constants.js'
import { parseTaipeiDateTime } from '../../lib/time.js'
import { generateOrderNotificationHTML } from '../../templates/notification.js'

const srcFile = (path) => new URL(`../../../src/${path}`, import.meta.url)

test('SITE_URL and the default opening time match src/config/app.js', async () => {
  const app = await import(srcFile('config/app.js'))
  assert.equal(app.SITE_URL, SITE_URL)
  assert.equal(app.SHOP_OPEN_AT.getTime(), SHOP_OPEN_AT.getTime())
})

test('the analytics page and the archive derive grades and sale rows alike', async () => {
  const analytics = await import(srcFile('utils/salesAnalytics.js'))
  const salesImport = await import(srcFile('utils/salesImport.js'))
  const archive = await import('../../lib/salesArchive.js')
  for (const className of ['329', '329/三數', '１０５', '205班', '三數', '高二', '', '數資', '4012']) {
    assert.equal(analytics.gradeOf('建國中學', className), archive.gradeOf('建國中學', className), className)
  }
  const order = {
    createdAt: '2025-11-05T04:03:00.000Z', finalTotal: 1800, paid: true, delivered: false, school: '建國中學', class: '205',
    items: [{ ticketTypeId: 'open', name: '一階票', price: 900, quantity: 2 }]
  }
  assert.deepEqual(salesImport.compactRowOf({ ...order, at: Date.parse(order.createdAt) }), archive.saleRowOf(order))
})

test('the party survey checks answers with the limits of its page, and takes its default questions', async () => {
  const { LIMITS: page, defaultSections } = await import(srcFile('data/partySurveyQuestions.js'))
  const { LIMITS: server, cleanAnswers } = await import('../../lib/partySurvey.js')
  assert.equal(page.other, server.other)
  assert.equal(page.text, server.text)
  // a sheet the page could send for the default questions passes
  const answers = Object.fromEntries(defaultSections().flatMap((section) => section.questions).map((question) => [
    question.id,
    question.type === 'scale' ? Object.fromEntries(question.rows.map((row) => [row.id, 5]))
      : question.type === 'multiple' ? [question.options[0]]
        : question.type === 'text' ? '好' : question.options[0]
  ]))
  assert.deepEqual(cleanAnswers(defaultSections(), answers), answers)
})

test('the purge confirmation phrase matches src/config/app.js', async () => {
  const app = await import(srcFile('config/app.js'))
  const { PURGE_CONFIRM_PHRASE } = await import('../../lib/orderPurge.js')
  assert.equal(app.PURGE_CONFIRM_PHRASE, PURGE_CONFIRM_PHRASE)
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

test('the seller registration limit matches src/data/sellerGuide.js', async () => {
  const guide = await import(srcFile('data/sellerGuide.js'))
  assert.equal(guide.MAX_SELLER_TICKETS, MAX_SELLER_TICKETS)
})

test('公關票 limits and relation text match src/data/guests.js', async () => {
  const guests = await import(srcFile('data/guests.js'))
  assert.equal(guests.MAX_GUEST_TICKETS, MAX_GUEST_TICKETS)
  assert.equal(guests.MAX_OFFICER_QUOTA, MAX_OFFICER_QUOTA)
  for (const guest of [
    { relation: 'alumni', relationDetail: '78 屆' },
    { relation: 'friend', relationDetail: ' 王小明 ' },
    { relation: 'alumni' },
    { relation: 'friend', relationDetail: '' },
    {},
    null
  ]) {
    assert.equal(guests.guestRelationText(guest), guestRelationText(guest), JSON.stringify(guest))
  }
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
