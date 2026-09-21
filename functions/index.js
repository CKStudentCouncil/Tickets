import * as functions from 'firebase-functions'
import nodemailer from 'nodemailer'
import QRCode from 'qrcode'
import sharp from 'sharp'
import AWS from 'aws-sdk'

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { generateEmailHTML } from './emailTemplate.js'
import { generateOrderNotificationHTML } from './paymentNotificationTemplate.js'

initializeApp()

const db = getFirestore()

const SENDER_EMAIL = process.env.SENDER_EMAIL || process.env.GMAIL_EMAIL

const createTransporter = () => {
  // Configure AWS SES. Prefer providing AWS credentials via Secret Manager
  // (requested below) or via an attached IAM role to the Cloud Functions runtime.
  const region = process.env.AWS_REGION || 'us-east-1'
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

  if (accessKeyId && secretAccessKey) {
    AWS.config.update({ accessKeyId, secretAccessKey, region })
  } else {
    AWS.config.update({ region })
  }

  const ses = new AWS.SES({ apiVersion: '2010-12-01', region })

  return nodemailer.createTransport({
    SES: { ses, aws: AWS }
  })
}

export const sendOrderQRCode = functions
  .region('asia-east1')
  .runWith({
      secrets: ['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','SENDER_EMAIL','AWS_REGION']
  })
  .firestore
  .document('orders/{orderId}')
  .onCreate(async (snap, context) => {
    const order = snap.data()
    const orderId = context.params.orderId

    console.log(
          `Sending email using account: ${SENDER_EMAIL}`
    )

    if (!order.customerEmail) {
      console.log(
        `Order ${orderId} has no customer email, skipping`
      )
      return
    }

    try {
      const transporter = createTransporter()

      const orderUrl =
        `https://souvenir.cksc.tw/admin/orders/${orderId}`

      const qrCodeBuffer = await QRCode.toBuffer(orderUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#1d1d1f',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'H',
        type: 'png'
      })

      const qrPngBuffer = await sharp(qrCodeBuffer)
        .flatten({
          background: '#ffffff'
        })
        .png()
        .toBuffer()


      const mailOptions = {
        from: `"建國中學班聯會" <${SENDER_EMAIL}>`,
        to: order.customerEmail,
        subject:
          `建中校慶紀念品訂單確認 - 訂單編號：${orderId}`,
        html: generateEmailHTML(orderId, order),

        attachments: [
          {
            filename: 'order-qrcode.png',
            content: qrPngBuffer,
            contentType: 'image/png',
            cid: 'qrcode',
            contentDisposition: 'inline'
          }
        ]
      }


      await transporter.sendMail(mailOptions)

      console.log(
        `Successfully sent order confirmation email to ${order.customerEmail}`
      )

    } catch (error) {
      console.error(
        `Error sending email for order ${orderId}:`,
        error
      )
    }
  })

const MAX_BCC_PER_BATCH = 49

// AWS SES default sending rate limit is commonly 14 messages/second.
// Each batched sendMail() call counts as one "message" toward that quota,
// so we throttle to at most MAX_SENDS_PER_SECOND sendMail() calls per second.
const MAX_SENDS_PER_SECOND = 14
const MIN_MS_BETWEEN_SENDS = Math.ceil(1000 / MAX_SENDS_PER_SECOND)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}


function chunk(array, size) {
  const result = []

  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }

  return result
}


async function assertIsAdmin(context) {

  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      '請先登入'
    )
  }


  const userDoc = await db
    .collection('users')
    .doc(context.auth.uid)
    .get()


  const role =
    userDoc.exists
      ? userDoc.data()?.role
      : null


  if (role !== 'admin' && role !== 'super_admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      '無管理員權限'
    )
  }
}



const NOTIFY_SUBJECTS = {
  payment: '【建中校慶紀念品】繳費通知',
  pickup: '【建中校慶紀念品】領貨通知',
  both: '【建中校慶紀念品】繳費暨領貨通知',
  custom: '【建中校慶紀念品】訂購通知'
}



export const sendOrderNotification = functions
  .region('asia-east1')
  .runWith({
      secrets: ['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','SENDER_EMAIL','AWS_REGION']
  })
  .https.onCall(async (data, context) => {

    await assertIsAdmin(context)


    const type =
      ['payment', 'pickup', 'both', 'custom'].includes(data.type)
        ? data.type
        : 'payment'

    const school =
      String(data.school || 'all').trim()

    const subject =
      String(data.subject || '').trim()

    const paymentTime =
      String(data.paymentTime || '').trim()

    const pickupTime =
      String(data.pickupTime || '').trim()

    const location =
      String(data.location || '').trim()

    const message =
      String(data.message || '').trim()


    if (type === 'custom') {
      if (!message) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          '請提供訊息內容'
        )
      }
    } else {
      if (!location) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          '請提供地點'
        )
      }


      if (
        (type === 'payment' || type === 'both')
        && !paymentTime
      ) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          '請提供繳費時間'
        )
      }


      if (
        (type === 'pickup' || type === 'both')
        && !pickupTime
      ) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          '請提供領貨時間'
        )
      }
    }



    const snapshot =
      await db.collection('orders').get()


    const emailSet = new Set()


    snapshot.forEach(doc => {

      const order = doc.data()

      if (school !== 'all' && order.school !== school) {
        return
      }

      const email = order.customerEmail

      if (email) {
        emailSet.add(email)
      }

    })


    const recipients =
      Array.from(emailSet).filter(email => {
        const normalizedEmail = email.trim().toLowerCase()
        const senderEmail = SENDER_EMAIL.trim().toLowerCase()

        return (
          normalizedEmail !== senderEmail &&
          !normalizedEmail.startsWith('no-reply@') &&
          !normalizedEmail.startsWith('noreply@')
        )
      })



    if (recipients.length === 0) {
      return {
        sentCount: 0
      }
    }



    console.log(
          `Sending order notification (${type}) using account: ${SENDER_EMAIL}`
    )



    const transporter =
      createTransporter()



    const html =
      generateOrderNotificationHTML({
        type,
        paymentTime,
        pickupTime,
        location,
        message
      })



    const batches =
      chunk(
        recipients,
        MAX_BCC_PER_BATCH
      )



    let lastSendAt = 0

    for (const batch of batches) {

      const now = Date.now()
      const elapsed = now - lastSendAt
      const waitMs = MIN_MS_BETWEEN_SENDS - elapsed

      if (lastSendAt !== 0 && waitMs > 0) {
        await sleep(waitMs)
      }

      lastSendAt = Date.now()

      await transporter.sendMail({

        from: `"建國中學班聯會" <${SENDER_EMAIL}>`,
        to: SENDER_EMAIL,
        bcc: batch,

        subject:
          subject || NOTIFY_SUBJECTS[type],
        html

      })

    }



    console.log(
      `Successfully sent order notification to ${recipients.length} recipients`
    )


    return {
      sentCount: recipients.length
    }

  })

const SCHOOL_IDENTITIES = {
  '建國中學': 'CKS',
  '北一女中': 'TFG',
  '中山女高': 'ZS',
  '景美女中': 'JM',
  '成功高中': 'CG',
  '師大附中': 'HSNU',
  '建中家長會': 'CKP',
  '建中老師': 'CKT',
  '其他學校或社會人士': 'O'
}

function getTaiwanDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())

  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  )

  return `${values.year}${values.month}${values.day}`
}

function getSchoolIdentity(school) {
  return SCHOOL_IDENTITIES[school] || 'O'
}

async function generateOrderId(school) {
  const identity = getSchoolIdentity(school)
  const date = getTaiwanDateString()

  const counterRef = db
    .collection('orderCounters')
    .doc(date)

  const serialNumber = await db.runTransaction(async transaction => {
    const counterSnap = await transaction.get(counterRef)

    const currentSerial = counterSnap.exists
      ? Number(counterSnap.data()?.serialNumber || 0)
      : 0

    const nextSerial = currentSerial + 1

    transaction.set(
      counterRef,
      {
        date,
        serialNumber: nextSerial,
        updatedAt: new Date()
      },
      { merge: true }
    )

    return nextSerial
  })

  return `${identity}${date}${String(serialNumber).padStart(4, '0')}`
}

export const createOrder = functions
  .region('asia-east1')
  .https.onCall(async (data, context) => {
    const orderPayload = data?.orderPayload

    if (!orderPayload || typeof orderPayload !== 'object') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        '訂單資料無效'
      )
    }

    const orderId = await generateOrderId(
      orderPayload.school
    )

    await db
      .collection('orders')
      .doc(orderId)
      .set({
        ...orderPayload,
        createdAt: new Date()
      })

    return {
      status: 201,
      id: orderId
    }
  })