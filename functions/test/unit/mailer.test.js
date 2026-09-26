import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SendEmailCommand } from '@aws-sdk/client-sesv2'

import { createTransporter, SENDER } from '../../lib/mailer.js'
import { generateEmailHTML } from '../../templates/orderConfirmation.js'

// PARTY-13: nodemailer >= 7 throws "Missing SES configuration" unless it gets
// { sesClient, SendEmailCommand } from @aws-sdk/client-sesv2.
test('the installed nodemailer accepts our SESv2 transport and sends a SendEmailCommand', async () => {
  const sent = []
  const sesClient = {
    config: { region: async () => 'ap-northeast-1' },
    send: async (command) => {
      sent.push(command)
      return { MessageId: 'test-message-id' }
    }
  }

  const transporter = createTransporter({ sesClient })
  const info = await transporter.sendMail({
    from: SENDER,
    to: 'buyer@example.com',
    subject: 'test',
    html: '<p>hi</p>'
  })

  assert.equal(sent.length, 1)
  assert.ok(sent[0] instanceof SendEmailCommand)
  assert.deepEqual(sent[0].input.Destination.ToAddresses, ['buyer@example.com'])
  assert.equal(info.response, 'test-message-id')
})

test('the default transporter builds without throwing', () => {
  assert.doesNotThrow(() => createTransporter())
})

test('confirmation email shows Taiwan time, the office, and escapes buyer input', () => {
  const html = generateEmailHTML('CKT202611050001', {
    createdAt: new Date('2026-11-05T04:30:00Z'),
    school: '建中老師',
    office: '莊三<script>',
    customerName: '<b>老師</b>',
    items: [{ name: '一階票', price: 900, quantity: 2 }],
    finalTotal: 1800
  })

  assert.match(html, /12:30:00/) // 04:30 UTC = 12:30 in Taiwan
  assert.match(html, /辦公室/)
  assert.match(html, /莊三&lt;script&gt;/)
  assert.match(html, /&lt;b&gt;老師&lt;\/b&gt;/)
  assert.doesNotMatch(html, /souvenir\.cksc\.tw/)
})
