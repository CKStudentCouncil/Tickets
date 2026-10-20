// Mail jobs: the old mailQueue emulator tests (outcome rules, pacing, crash
// recovery, notifications), against local D1 with a fake SES.
import assert from 'node:assert/strict'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, test } from 'vitest'
import { processMailJob, sweepMail, consumeMailBatch } from '../../src/server/mail/worker'
import { SesError, buildMime, sesSender, type MailMessage } from '../../src/server/mail/ses'
import { HOUR, as, call, createOrder, db, ok, order, resetData, setShopOpenAt, setTypes, type Account } from './helpers'

let clock = Date.now()
const now = () => clock
const sleeps: number[] = []
const sleep = async (ms: number) => { sleeps.push(ms); clock += ms }

function fakeSes(outcomes: (string | Error)[] = []) {
  const sent: MailMessage[] = []
  return {
    sent,
    send: async (message: MailMessage) => {
      sent.push(message)
      const next = outcomes.shift() ?? `ses-${sent.length}`
      if (next instanceof Error) throw next
      return { providerMessageId: next }
    }
  }
}

const job = (id: string) => db.prepare('SELECT * FROM mail_jobs WHERE id = ?').bind(id).first<Record<string, any>>()
const emailStatus = (orderId: string) => db.prepare('SELECT email_status FROM orders WHERE id = ?').bind(orderId).first('email_status')

let buyer: Account
let orderId: string
let jobId: string

beforeEach(async () => {
  await resetData()
  await setTypes()
  await setShopOpenAt(new Date(Date.now() - HOUR))
  clock = Date.now()
  sleeps.length = 0
  buyer = await as('buyer@example.com')
  orderId = (await createOrder(order([{ id: 'open', quantity: 2 }]), buyer)).id
  jobId = `confirmation_${orderId}`
})

describe('confirmation email', () => {
  test('is sent once with the ticket QR and recorded on the order', async () => {
    const ses = fakeSes(['msg-1'])
    assert.equal(await processMailJob(env, jobId, { send: ses.send, now, sleep }), null)
    // a duplicate queue delivery sends nothing more
    assert.equal(await processMailJob(env, jobId, { send: ses.send, now, sleep }), null)

    assert.equal(ses.sent.length, 1)
    const [message] = ses.sent
    assert.equal(message.to, 'buyer@example.com')
    assert.match(message.subject, new RegExp(orderId))
    assert.match(message.html, /cid:qrcode/)
    assert.deepEqual(message.attachments.map((a) => a.cid), ['qrcode', 'hero-terrain'])
    const saved = await job(jobId)
    assert.equal(saved!.status, 'accepted')
    assert.equal(saved!.provider_message_id, 'msg-1')
    assert.equal(await emailStatus(orderId), 'accepted')
  })

  test('explicit SES rejections retry with backoff, then fail', async () => {
    const ses = fakeSes(Array.from({ length: 5 }, () => new SesError(429, 'Throttled')))
    for (let attempt = 1; attempt <= 5; attempt++) {
      const wait = await processMailJob(env, jobId, { send: ses.send, now, sleep })
      if (attempt < 5) {
        assert.equal(wait, 60_000 * 2 ** (attempt - 1))
        assert.equal((await job(jobId))!.status, 'retry')
        // an early redelivery is told to wait again and sends nothing
        assert.ok((await processMailJob(env, jobId, { send: ses.send, now, sleep }))! > 0)
        clock += wait!
      } else {
        assert.equal(wait, null)
      }
    }
    assert.equal(ses.sent.length, 5)
    assert.equal((await job(jobId))!.status, 'failed')
    assert.equal(await emailStatus(orderId), 'failed')
  })

  test('server errors, timeouts and a missing message id stay uncertain and are never resent', async () => {
    for (const outcome of [new SesError(500, 'Internal'), new SesError(408, 'Timeout'), '']) {
      await resetData()
      await setTypes()
      await setShopOpenAt(new Date(Date.now() - HOUR))
      const id = (await createOrder(order([{ id: 'open', quantity: 1 }]), buyer)).id
      const ses = fakeSes([outcome])
      assert.equal(await processMailJob(env, `confirmation_${id}`, { send: ses.send, now, sleep }), null)
      assert.equal((await job(`confirmation_${id}`))!.status, 'uncertain')
      await processMailJob(env, `confirmation_${id}`, { send: ses.send, now, sleep })
      assert.equal(ses.sent.length, 1)
    }
  })

  test('a send that never answers becomes uncertain', async () => {
    const send = () => new Promise<never>(() => {})
    await processMailJob(env, jobId, { send, now, sleep, sendTimeoutMs: 10 })
    assert.equal((await job(jobId))!.status, 'uncertain')
  })

  test('a crash after the send began becomes uncertain in the sweep, not a duplicate send', async () => {
    await db.prepare(`UPDATE mail_jobs SET status = 'sending', lease_until = ? WHERE id = ?`).bind(Date.now() - 1, jobId).run()
    await db.prepare(`UPDATE orders SET email_status = 'sending' WHERE id = ?`).bind(orderId).run()
    const result = await sweepMail(env)
    assert.equal(result.recovered, 1)
    assert.equal((await job(jobId))!.status, 'uncertain')
    assert.equal(await emailStatus(orderId), 'uncertain')
    const ses = fakeSes()
    await processMailJob(env, jobId, { send: ses.send, now, sleep })
    assert.equal(ses.sent.length, 0)
  })

  test('a deleted order skips its queued confirmation without contacting SES', async () => {
    await db.prepare('UPDATE orders SET deleted_at = ? WHERE id = ?').bind(Date.now(), orderId).run()
    const ses = fakeSes()
    await processMailJob(env, jobId, { send: ses.send, now, sleep })
    assert.equal(ses.sent.length, 0)
    assert.equal((await job(jobId))!.status, 'skipped')
  })

  test('an older confirmation does not overwrite a newer resend on the order', async () => {
    const admin = await as('admin@example.com', { role: 'admin' })
    await ok(call(admin, 'POST', `/admin/orders/${orderId}/resend`, { requestId: 'resend-0001' }))
    const ses = fakeSes(['first', 'second'])
    await processMailJob(env, jobId, { send: ses.send, now, sleep })
    assert.equal(await emailStatus(orderId), 'queued')
    await processMailJob(env, `resend_${orderId}_resend-0001`, { send: ses.send, now, sleep })
    assert.equal(await emailStatus(orderId), 'accepted')
  })

  test('every mail source is paced together by recipients per second', async () => {
    const second = (await createOrder(order([{ id: 'open', quantity: 1 }]), await as('second@example.com'))).id
    const ses = fakeSes()
    const deps = { send: ses.send, now, sleep }
    await processMailJob({ ...env, SES_RECIPIENTS_PER_SECOND: '2' }, jobId, deps)
    await processMailJob({ ...env, SES_RECIPIENTS_PER_SECOND: '2' }, `confirmation_${second}`, deps)
    // the second message waits for the first one's half-second slot
    assert.deepEqual(sleeps, [500])
  })

  test('the sweep puts stranded jobs back on the queue', async () => {
    await db.prepare('UPDATE mail_jobs SET updated_at = ? WHERE id = ?').bind(Date.now() - 11 * 60 * 1000, jobId).run()
    assert.equal((await sweepMail(env)).requeued, 1)
    assert.equal((await sweepMail(env)).requeued, 0)
  })

  test('the queue consumer acks sent jobs and retries rejected ones later', async () => {
    const acked: string[] = []
    const retried: number[] = []
    const message = (id: string) => ({ body: { jobId: id }, ack: () => acked.push(id), retry: (o?: { delaySeconds?: number }) => retried.push(o?.delaySeconds ?? 0) })
    const ses = fakeSes([new SesError(400, 'Bad request')])
    await consumeMailBatch({ messages: [message(jobId)] } as never, env, { send: ses.send, now, sleep })
    assert.deepEqual(retried, [60])
    clock += 60_000
    await consumeMailBatch({ messages: [message(jobId)] } as never, env, { send: fakeSes().send, now, sleep })
    assert.deepEqual(acked, [jobId])
  })
})

describe('SES request', () => {
  test('signs a raw SendEmail with BCC only in the destination', async () => {
    let request: Request | undefined
    const send = sesSender({ ...env, AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'secret' }, async (input) => {
      request = input as Request
      return new Response(JSON.stringify({ MessageId: 'abc' }))
    })
    const message = { to: 'ckhssc@gl.ck.tp.edu.tw', bcc: ['a@example.com'], subject: '通知', html: '<p>hi</p>', attachments: [] }
    assert.deepEqual(await send(message), { providerMessageId: 'abc' })
    assert.equal(request!.url, 'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails')
    assert.match(request!.headers.get('authorization')!, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
    const body = await request!.json() as any
    assert.deepEqual(body.Destination, { ToAddresses: ['ckhssc@gl.ck.tp.edu.tw'], BccAddresses: ['a@example.com'] })
    const raw = new TextDecoder().decode(Uint8Array.from(atob(body.Content.Raw.Data), (c) => c.charCodeAt(0)))
    assert.doesNotMatch(raw, /a@example\.com/)
    assert.match(raw, /^From: =\?utf-8\?B\?.*\?= <no-reply@tickets\.cksc\.tw>/im)
    assert.match(raw, /^To: <?ckhssc@gl\.ck\.tp\.edu\.tw>?/im)
    assert.match(buildMime(message), /Content-Type: text\/html/)
  })

  test('an HTTP error carries its status for the retry rules', async () => {
    const send = sesSender({ ...env, AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' }, async () => new Response('slow down', { status: 429 }))
    await assert.rejects(send({ to: 'x@example.com', subject: 's', html: '', attachments: [] }), (error: SesError) => error.status === 429)
  })
})

describe('notifications', () => {
  test('freeze recipients in batches of 49, send each batch once, and report progress', async () => {
    // the buyers check out at once, as a rush would
    const buyers = await Promise.all(Array.from({ length: 59 }, (_, i) => as(`n${i}@example.com`)))
    await Promise.all(buyers.map((account) => createOrder(order([{ id: 'open', quantity: 1 }]), account)))
    const manager = await as('manager@example.com', { role: 'manager' })
    assert.equal((await call(buyer, 'POST', '/admin/notifications', { type: 'payment', location: 'A' })).status, 403)
    await assert.rejects(ok(call(manager, 'POST', '/admin/notifications', { type: 'payment', location: 'A' })), { code: 'invalid-argument' })

    const prepared = await ok(call(manager, 'POST', '/admin/notifications', { type: 'payment', location: '學務處', paymentTime: '11/10' }))
    assert.equal(prepared.status, 'ready')
    assert.equal(prepared.total, 60)
    const first = await ok(call(manager, 'POST', `/admin/notifications/${prepared.jobId}/send`))
    assert.equal(first.status, 'queued')
    assert.equal(first.pendingEnqueueCount, 0)
    // sending again after an interruption queues nothing twice
    await ok(call(manager, 'POST', `/admin/notifications/${prepared.jobId}/send`))
    const jobs = (await db.prepare('SELECT id, buyer_count, recipient_count FROM mail_jobs WHERE notification_job_id = ? ORDER BY id').bind(prepared.jobId).all()).results
    assert.deepEqual(jobs.map((j) => [j.buyer_count, j.recipient_count]), [[49, 50], [11, 12]])

    const ses = fakeSes()
    for (const j of jobs) await processMailJob(env, j.id as string, { send: ses.send, now, sleep })
    assert.equal(ses.sent[0].to, 'ckhssc@gl.ck.tp.edu.tw')
    assert.equal(ses.sent[0].bcc!.length, 49)
    assert.equal(ses.sent[0].subject, '【建中舞會購票系統】繳費通知')
    const progress = await ok(call(manager, 'GET', `/admin/notifications/${prepared.jobId}`))
    assert.equal(progress.status, 'done')
    assert.equal(progress.acceptedCount, 60)
  })

  test('an empty school prepares nothing', async () => {
    const manager = await as('manager@example.com', { role: 'manager' })
    const prepared = await ok(call(manager, 'POST', '/admin/notifications', { type: 'custom', message: 'hi', school: '景美女中' }))
    assert.equal(prepared.status, 'empty')
  })
})
