import * as functions from 'firebase-functions'
import nodemailer from 'nodemailer'
import QRCode from 'qrcode'
import sharp from 'sharp'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

import { generateEmailHTML } from './emailTemplate.js'
import { generateOrderNotificationHTML } from './paymentNotificationTemplate.js'

initializeApp()

const db = getFirestore()
const bucket = getStorage().bucket()

const ELIGIBLE_IDENTITIES = {
  CAMPUS_STUDENTS: 'campus_students',
  ALL_USERS: 'all_users'
}

const CAMPUS_SCHOOLS = new Set([
  '建國中學',
  '北一女中',
  '中山女高',
  '景美女中',
  '成功高中',
  '師大附中'
])

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

// Must match the IAM policy condition: ses:FromAddress = *@tickets.cksc.tw
const SENDER_EMAIL =
  'no-reply@tickets.cksc.tw'

const DEFAULT_SES_REGION =
  'us-east-1'

const MAX_BCC_PER_BATCH = 49

const MAX_SENDS_PER_SECOND = 14

const MIN_MS_BETWEEN_SENDS =
  Math.ceil(1000 / MAX_SENDS_PER_SECOND)

const NOTIFY_SUBJECTS = {
  payment: '【建中舞會購票系統】繳費通知',
  pickup: '【建中舞會購票系統】取票通知',
  both: '【建中舞會購票系統】繳費暨取票通知',
  custom: '【建中舞會購票系統】購票通知'
}

function parseTimestamp(value) {
  if (!value) return null

  if (value.toDate) {
    return value.toDate()
  }

  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? null
    : date
}

function normalizeTicketTypeConfig(ticketType) {
  return {
    ...ticketType,

    id: String(ticketType.id || ''),

    name: String(ticketType.name || ''),

    totalTicketQuantity:
      Number(ticketType.totalTicketQuantity || 0),

    purchaseLimitPerPerson:
      ticketType.purchaseLimitPerPerson === null ||
      ticketType.purchaseLimitPerPerson === undefined
        ? null
        : Number(ticketType.purchaseLimitPerPerson),

    salesStartTime:
      ticketType.salesStartTime || null,

    salesEndTime:
      ticketType.salesEndTime || null,

    eligibleBuyerIdentity:
      ticketType.eligibleBuyerIdentity ||
      ELIGIBLE_IDENTITIES.ALL_USERS
  }
}

async function loadTicketTypeConfigs() {
  const snapshot =
    await db
      .collection('settings')
      .doc('ticketTypes')
      .get()

  if (!snapshot.exists) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      '票種設定不存在'
    )
  }

  const data = snapshot.data()

  const types =
    Array.isArray(data?.types)
      ? data.types
      : []

  const ticketTypeMap =
    new Map()

  types.forEach((ticketType) => {
    if (!ticketType || !ticketType.id) {
      return
    }

    const normalized =
      normalizeTicketTypeConfig(
        ticketType
      )

    ticketTypeMap.set(
      normalized.id,
      normalized
    )
  })

  if (ticketTypeMap.size === 0) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      '目前沒有有效的票種設定'
    )
  }

  return ticketTypeMap
}

function getTicketTypeIdFromItem(item) {
  if (item?.ticketTypeId) {
    return String(item.ticketTypeId)
  }

  if (item?.id) {
    return String(item.id)
  }

  return ''
}

function getBuyerIdentity(orderPayload) {
  if (
    CAMPUS_SCHOOLS.has(
      orderPayload.school
    )
  ) {
    return ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS
  }

  return ELIGIBLE_IDENTITIES.ALL_USERS
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function chunk(array, size) {
  const result = []

  for (
    let i = 0;
    i < array.length;
    i += size
  ) {
    result.push(
      array.slice(i, i + size)
    )
  }

  return result
}

async function validateOrderAgainstTicketRules(
  orderPayload
) {
  const items =
    Array.isArray(orderPayload.items)
      ? orderPayload.items
      : []

  if (items.length === 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      '訂單內容為空'
    )
  }

  const ticketTypeConfigMap =
    await loadTicketTypeConfigs()

  const now = new Date()

  const buyerIdentity =
    getBuyerIdentity(orderPayload)

  const currentOrderQuantityByType =
    new Map()

  items.forEach((item) => {
    const ticketTypeId =
      getTicketTypeIdFromItem(item)

    if (!ticketTypeId) {
      return
    }

    const quantity =
      Number(item.quantity || 0)

    if (!quantity) {
      return
    }

    currentOrderQuantityByType.set(
      ticketTypeId,
      (
        currentOrderQuantityByType.get(
          ticketTypeId
        ) || 0
      ) + quantity
    )
  })

  if (
    currentOrderQuantityByType.size === 0
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      '票種資料無效'
    )
  }

  for (
    const ticketTypeId of
    currentOrderQuantityByType.keys()
  ) {
    if (
      !ticketTypeConfigMap.has(
        ticketTypeId
      )
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `無效的票種：${ticketTypeId}`
      )
    }
  }

  for (
    const [
      ticketTypeId,
      quantity
    ] of currentOrderQuantityByType.entries()
  ) {
    if (quantity <= 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        '票券數量必須大於 0'
      )
    }

    const config =
      ticketTypeConfigMap.get(
        ticketTypeId
      )

    const startTime =
      parseTimestamp(
        config.salesStartTime
      )

    const endTime =
      parseTimestamp(
        config.salesEndTime
      )

    if (
      startTime &&
      now < startTime
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `${config.name}尚未開賣`
      )
    }

    if (
      endTime &&
      now > endTime
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `${config.name}已結束販售`
      )
    }

    if (
      config.eligibleBuyerIdentity ===
        ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS &&
      buyerIdentity !==
        ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS
    ) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `${config.name}僅限校內學生購買`
      )
    }
  }

  const email =
    String(
      orderPayload.customerEmail || ''
    )
      .trim()
      .toLowerCase()

  const userId =
    String(
      orderPayload.userId || ''
    ).trim()

  const ordersSnapshot =
    await db
      .collection('orders')
      .get()

  const soldQuantityByType =
    new Map()

  const buyerQuantityByType =
    new Map()

  ordersSnapshot.forEach(
    (orderDoc) => {
      const orderData =
        orderDoc.data()

      const orderItems =
        Array.isArray(orderData.items)
          ? orderData.items
          : []

      const matchesBuyer =
        (
          email &&
          String(
            orderData.customerEmail || ''
          )
            .trim()
            .toLowerCase() === email
        ) ||
        (
          userId &&
          String(
            orderData.userId || ''
          ).trim() === userId
        )

      orderItems.forEach(
        (item) => {
          const ticketTypeId =
            getTicketTypeIdFromItem(
              item
            )

          if (
            !ticketTypeConfigMap.has(
              ticketTypeId
            )
          ) {
            return
          }

          const quantity =
            Number(
              item.quantity || 0
            )

          if (!quantity) {
            return
          }

          soldQuantityByType.set(
            ticketTypeId,
            (
              soldQuantityByType.get(
                ticketTypeId
              ) || 0
            ) + quantity
          )

          if (matchesBuyer) {
            buyerQuantityByType.set(
              ticketTypeId,
              (
                buyerQuantityByType.get(
                  ticketTypeId
                ) || 0
              ) + quantity
            )
          }
        }
      )
    }
  )

  for (
    const [
      ticketTypeId,
      quantity
    ] of currentOrderQuantityByType.entries()
  ) {
    const config =
      ticketTypeConfigMap.get(
        ticketTypeId
      )

    const sold =
      soldQuantityByType.get(
        ticketTypeId
      ) || 0

    const alreadyBought =
      buyerQuantityByType.get(
        ticketTypeId
      ) || 0

    if (
      config.totalTicketQuantity &&
      sold + quantity >
        config.totalTicketQuantity
    ) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `${config.name}剩餘票量不足`
      )
    }

    if (
      config.purchaseLimitPerPerson !== null &&
      alreadyBought + quantity >
        config.purchaseLimitPerPerson
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `${config.name}超過每人限購 ${config.purchaseLimitPerPerson} 張`
      )
    }
  }
}

function createTransporter() {
  const region =
    process.env.AWS_REGION ||
    DEFAULT_SES_REGION

  const accessKeyId =
    process.env.AWS_ACCESS_KEY_ID

  const secretAccessKey =
    process.env.AWS_SECRET_ACCESS_KEY

  const sesClient = new SESv2Client({
    region,
    ...(accessKeyId && secretAccessKey
      ? {
          credentials: {
            accessKeyId,
            secretAccessKey
          }
        }
      : {})
  })

  return nodemailer.createTransport({
    SES: {
      sesClient,
      SendEmailCommand
    }
  })
}

export const sendOrderQRCode =
  functions
    .region('asia-east1')
    .runWith({
      secrets: [
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_REGION'
      ]
    })
    .firestore
    .document('orders/{orderId}')
    .onCreate(
      async (snap, context) => {
        const order =
          snap.data()

        const orderId =
          context.params.orderId

        console.log(
          `Sending ticket confirmation email using account: ${SENDER_EMAIL}`
        )

        if (
          !order.customerEmail
        ) {
          console.log(
            `Order ${orderId} has no customer email, skipping`
          )

          return
        }

        try {
          const transporter =
            createTransporter()

          const orderUrl =
            `https://tickets.cksc.tw/admin/orders/${orderId}`

          const qrCodeBuffer =
            await QRCode.toBuffer(
              orderUrl,
              {
                width: 300,
                margin: 2,
                color: {
                  dark: '#1d1d1f',
                  light: '#ffffff'
                },
                errorCorrectionLevel: 'H',
                type: 'png'
              }
            )

          const qrPngBuffer =
            await sharp(
              qrCodeBuffer
            )
              .flatten({
                background: '#ffffff'
              })
              .png()
              .toBuffer()

          const mailOptions = {
            from:
              `"建國中學班聯會" <${SENDER_EMAIL}>`,

            to:
              order.customerEmail,

            subject:
              `建中舞會購票系統購票成功 - 票券編號：${orderId}`,

            html:
              generateEmailHTML(
                orderId,
                order
              ),

            attachments: [
              {
                filename:
                  'ticket-qrcode.png',

                content:
                  qrPngBuffer,

                contentType:
                  'image/png',

                cid:
                  'qrcode',

                contentDisposition:
                  'inline'
              }
            ]
          }

          await transporter.sendMail(
            mailOptions
          )

          console.log(
            `Successfully sent ticket confirmation email to ${order.customerEmail}`
          )
        } catch (error) {
          console.error(
            `Error sending ticket confirmation email for order ${orderId}:`,
            error
          )
        }
      }
    )

async function assertIsAdmin(
  context
) {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      '請先登入'
    )
  }

  const userDoc =
    await db
      .collection('users')
      .doc(context.auth.uid)
      .get()

  const role =
    userDoc.exists
      ? userDoc.data()?.role
      : null

  if (
    role !== 'admin' &&
    role !== 'super_admin'
  ) {
    throw new functions.https.HttpsError(
      'permission-denied',
      '無管理員權限'
    )
  }
}

export const sendOrderNotification =
  functions
    .region('asia-east1')
    .runWith({
      secrets: [
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_REGION'
      ]
    })
    .https
    .onCall(
      async (data, context) => {
        await assertIsAdmin(context)

        const type =
          [
            'payment',
            'pickup',
            'both',
            'custom'
          ].includes(data.type)
            ? data.type
            : 'payment'

        const school =
          String(
            data.school || 'all'
          ).trim()

        const subject =
          String(
            data.subject || ''
          ).trim()

        const paymentTime =
          String(
            data.paymentTime || ''
          ).trim()

        const pickupTime =
          String(
            data.pickupTime || ''
          ).trim()

        const location =
          String(
            data.location || ''
          ).trim()

        const message =
          String(
            data.message || ''
          ).trim()

        if (
          type === 'custom'
        ) {
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
            (
              type === 'payment' ||
              type === 'both'
            ) &&
            !paymentTime
          ) {
            throw new functions.https.HttpsError(
              'invalid-argument',
              '請提供繳費時間'
            )
          }

          if (
            (
              type === 'pickup' ||
              type === 'both'
            ) &&
            !pickupTime
          ) {
            throw new functions.https.HttpsError(
              'invalid-argument',
              '請提供取票時間'
            )
          }
        }

        const snapshot =
          await db
            .collection('orders')
            .get()

        const emailSet =
          new Set()

        snapshot.forEach(
          (doc) => {
            const order =
              doc.data()

            if (
              school !== 'all' &&
              order.school !== school
            ) {
              return
            }

            const email =
              order.customerEmail

            if (email) {
              emailSet.add(
                email
              )
            }
          }
        )

        const recipients =
          Array
            .from(emailSet)
            .filter(
              (email) => {
                const normalizedEmail =
                  email
                    .trim()
                    .toLowerCase()

                const senderEmail =
                  SENDER_EMAIL
                    .trim()
                    .toLowerCase()

                return (
                  normalizedEmail !==
                    senderEmail &&
                  !normalizedEmail.startsWith(
                    'no-reply@'
                  ) &&
                  !normalizedEmail.startsWith(
                    'noreply@'
                  )
                )
              }
            )

        if (
          recipients.length === 0
        ) {
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
          generateOrderNotificationHTML(
            {
              type,
              paymentTime,
              pickupTime,
              location,
              message
            }
          )

        const batches =
          chunk(
            recipients,
            MAX_BCC_PER_BATCH
          )

        let lastSendAt = 0

        for (
          const batch of batches
        ) {
          const now =
            Date.now()

          const elapsed =
            now - lastSendAt

          const waitMs =
            MIN_MS_BETWEEN_SENDS -
            elapsed

          if (
            lastSendAt !== 0 &&
            waitMs > 0
          ) {
            await sleep(waitMs)
          }

          lastSendAt =
            Date.now()

          await transporter.sendMail(
            {
              from:
                `"建國中學班聯會" <${SENDER_EMAIL}>`,

              to:
                SENDER_EMAIL,

              bcc:
                batch,

              subject:
                subject ||
                NOTIFY_SUBJECTS[type],

              html
            }
          )
        }

        console.log(
          `Successfully sent order notification to ${recipients.length} recipients`
        )

        return {
          sentCount:
            recipients.length
        }
      }
    )

function getTaiwanDateString(date = new Date()) {
  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).format(date)
}