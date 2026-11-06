// The frontend and the functions each keep a copy of a few constants and of
// the Taiwan-time parser; these tests fail if the copies drift apart.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SITE_URL, SHOP_OPEN_AT, SCHOOL_CODES, CAMPUS_SCHOOLS, HOME_SCHOOL, SCHOOL_ACCOUNT_DOMAIN, STUDENT_ACCOUNT_PREFIX, STUDENT_ID_PATTERN, ELIGIBLE_IDENTITIES, BUYER_TYPES, MAX_SELLER_TICKETS, MAX_GUEST_TICKETS, MAX_OFFICER_QUOTA, MAX_INVITE_NOTE, MAX_SIGNUP_TITLE, MAX_SIGNUP_NOTE, STREET_SCHOOL, guestRelationText } from '../../lib/constants.js'
import { MAX_TICKETS_PER_ORDER } from '../../lib/orderValidation.js'
import { LINK_ID_PATTERN, newInviteId, sanitizeQuantity } from '../../lib/guests.js'
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

test('student card IDs and their school accounts match src/data/schools.js', async () => {
  const schools = await import(srcFile('data/schools.js'))
  const cards = await import('../../lib/studentCards.js')
  assert.equal(schools.STUDENT_ACCOUNT_PREFIX, STUDENT_ACCOUNT_PREFIX)
  assert.equal(String(schools.STUDENT_ID_PATTERN), String(STUDENT_ID_PATTERN))
  const [min, max] = schools.STUDENT_ID_LENGTH
  assert.ok(STUDENT_ID_PATTERN.test('1'.repeat(min)) && !STUDENT_ID_PATTERN.test('1'.repeat(min - 1)))
  assert.ok(STUDENT_ID_PATTERN.test('1'.repeat(max)) && !STUDENT_ID_PATTERN.test('1'.repeat(max + 1)))
  for (const id of ['1130524', ' 113 0524 ', '１１３０５２４', '12345', '123456789', 'B1234567', '', null]) {
    assert.equal(schools.studentAccountEmail(id), typeof id === 'string' ? cards.studentAccountEmail(id) : '', String(id))
  }
})

test('isEduAccount matches src/data/schools.js', async () => {
  const schools = await import(srcFile('data/schools.js'))
  const { isEduAccount } = await import('../../lib/orderValidation.js')
  for (const email of ['a@gl.ck.tp.edu.tw', 'A@EDU.TW', 'a@fakeedu.tw', 'a@edu.tw.evil.com', 'a@-x.edu.tw', 'a@gmail.com', '']) {
    assert.equal(schools.isEduAccount(email), isEduAccount(email), email)
  }
})

test('ELIGIBLE_IDENTITIES match src/data/ticketTypes.js (PARTY-27)', async () => {
  const frontend = await import(srcFile('data/ticketTypes.js'))
  assert.deepEqual(frontend.ELIGIBLE_IDENTITIES, ELIGIBLE_IDENTITIES)
  assert.deepEqual(frontend.BUYER_TYPES, BUYER_TYPES)
})

test('the seller registration limit matches src/data/sellerGuide.js', async () => {
  const guide = await import(srcFile('data/sellerGuide.js'))
  assert.equal(guide.MAX_SELLER_TICKETS, MAX_SELLER_TICKETS)
})

test('路宣 sales use the school and per-sale cap of src/data', async () => {
  const schools = await import(srcFile('data/schools.js'))
  const street = await import(srcFile('data/streetSales.js'))
  assert.equal(schools.STREET_SCHOOL, STREET_SCHOOL)
  // not a school a checkout may choose
  assert.ok(!Object.hasOwn(SCHOOL_CODES, STREET_SCHOOL))
  assert.equal(street.MAX_STREET_TICKETS, MAX_TICKETS_PER_ORDER)
})

test('公關票 limits and relation text match src/data/guests.js', async () => {
  const guests = await import(srcFile('data/guests.js'))
  assert.equal(guests.MAX_GUEST_TICKETS, MAX_GUEST_TICKETS)
  assert.equal(guests.MAX_OFFICER_QUOTA, MAX_OFFICER_QUOTA)
  assert.equal(guests.MAX_INVITE_NOTE, MAX_INVITE_NOTE)
  assert.equal(guests.MAX_SIGNUP_TITLE, MAX_SIGNUP_TITLE)
  assert.equal(guests.MAX_SIGNUP_NOTE, MAX_SIGNUP_NOTE)
  // the pages check a link's id, and a form's ticket count, as the functions do
  assert.equal(guests.LINK_ID_PATTERN.source, LINK_ID_PATTERN.source)
  assert.match(newInviteId(), guests.LINK_ID_PATTERN)
  for (const quantity of [-1, 0, 1, MAX_GUEST_TICKETS, MAX_GUEST_TICKETS + 1, 1.5]) {
    let accepted = true
    try {
      sanitizeQuantity({ quantity })
    } catch {
      accepted = false
    }
    assert.equal(guests.validTicketQuantity(quantity), accepted, String(quantity))
  }
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

test('submitSurvey takes exactly the options and rating questions of the survey page', async () => {
  const page = await import(srcFile('data/surveyQuestions.js'))
  const server = await import('../../lib/survey.js')
  for (const name of ['IDENTITY_OPTIONS', 'CHANNEL_OPTIONS', 'DEVICE_OPTIONS', 'ISSUE_COUNT_OPTIONS', 'ISSUE_TYPE_OPTIONS']) {
    assert.deepEqual(server[name], page[name], name)
  }
  const pageScores = page.SCALE_SECTIONS.flatMap((section) => section.questions.map((q) => q.id))
  assert.deepEqual([...server.SCORE_IDS].sort(), [...pageScores].sort())
})

test('報帳 limits and 科目 match src/data/reimbursements.js', async () => {
  const page = await import(srcFile('data/reimbursements.js'))
  const server = await import('../../lib/reimbursements.js')
  for (const name of ['MAX_REIMBURSER_NAME', 'MAX_REIMBURSEMENT_AMOUNT', 'MAX_REIMBURSEMENT_NOTE', 'MAX_INVOICE_FILES', 'MAX_INVOICE_BYTES', 'REIMBURSEMENT_CATEGORIES']) {
    assert.deepEqual(page[name], server[name], name)
  }
})

test('取消訂單 reasons, limits and notice counting match src/data/cancellations.js', async () => {
  const page = await import(srcFile('data/cancellations.js'))
  const pageUtils = await import(srcFile('utils/cancellations.js'))
  const server = await import('../../lib/orderCancel.js')
  for (const name of ['CANCEL_REASONS', 'NOTE_REQUIRED_REASONS', 'PAYMENT_NOTICES_TO_CANCEL', 'PICKUP_NOTICES_TO_CANCEL', 'MAX_CANCEL_ORDERS', 'MAX_CANCEL_NOTE', 'NOTICE_TYPES_COUNTED']) {
    assert.deepEqual(page[name], server[name], name)
  }
  for (const notices of [undefined, {}, { a: { type: 'both' }, b: { type: 'pickup' }, c: { type: 'payment' }, d: { type: 'custom' }, e: null }]) {
    assert.deepEqual(pageUtils.noticeCountsOf({ notices }), server.noticeCountsOf({ notices }))
  }
  // the page offers an order for a reason exactly when the server takes it
  const cases = [
    {}, { paid: true }, { delivered: true }, { complimentary: true, paid: true }, { streetSale: true },
    { notices: { a: { type: 'payment' } } }, { paid: true, notices: { a: { type: 'payment' } } },
    { notices: { a: { type: 'pickup' }, b: { type: 'both' } } },
    { paid: true, notices: { a: { type: 'pickup' }, b: { type: 'both' }, c: { type: 'pickup' } } }
  ]
  for (const fields of cases) {
    for (const reason of Object.keys(server.CANCEL_REASONS)) {
      const order = { finalTotal: 900, ...fields }
      const pageOk = !pageUtils.cancelBlockOf(order) && !pageUtils.reasonBlockOf(order, reason)
      let serverOk = true
      try { server.checkCancellation(order, { reason, refund: 'full' }) } catch { serverOk = false }
      assert.equal(pageOk, serverOk, `${reason} ${JSON.stringify(fields)}`)
    }
  }
})
