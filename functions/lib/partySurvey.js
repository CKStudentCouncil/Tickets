import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'

import { db, HttpsError } from './common.js'
import { REGION } from './constants.js'
import { ENFORCE_APP_CHECK } from './params.js'

// 舞會滿意度調查 (src/pages/PartySurveyPage.vue). Super admins keep each year's
// questions in partySurveys/{year}.sections and change them as they like, so
// the rules cannot check an answer sheet: this function checks it against
// that year's questions and writes partySurveys/{year}/responses, where no
// client may write (firestore.rules).

// Keep in sync with LIMITS in src/data/partySurveyQuestions.js
export const LIMITS = { other: 200, text: 2000 }

const invalid = (message) => new HttpsError('invalid-argument', message)
const textOf = (value) => (typeof value === 'string' ? value.trim() : '')

// One answer in its question's shape, undefined when not answered; throws
// on an answer the question cannot take
function cleanAnswer(question, value, name) {
  const options = Array.isArray(question.options) ? question.options : []
  // text typed for 其他
  const other = (text) => {
    if (!question.allowOther) throw invalid(`「${name}」沒有這個選項`)
    if (text.length > LIMITS.other) throw invalid(`「${name}」的其他最多 ${LIMITS.other} 字`)
    return text
  }

  if (question.type === 'single') {
    const text = textOf(value)
    if (!text) return undefined
    return options.includes(text) ? text : other(text)
  }
  if (question.type === 'multiple') {
    if (!Array.isArray(value)) return undefined
    const picked = [...new Set(value.map(textOf).filter(Boolean))]
    if (!picked.length) return undefined
    const typed = picked.filter((text) => !options.includes(text))
    if (typed.length > 1) throw invalid(`「${name}」只能自填一個其他`)
    typed.forEach(other)
    return picked
  }
  if (question.type === 'scale') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const rows = Array.isArray(question.rows) ? question.rows : []
    const scores = {}
    rows.forEach((row) => {
      const score = value[row.id]
      if (score === undefined || score === null) return
      if (!Number.isInteger(score) || score < 1 || score > 5) throw invalid('評分只能是 1 到 5 分')
      scores[row.id] = score
    })
    if (!Object.keys(scores).length) return undefined
    if (question.required && Object.keys(scores).length < rows.length) throw invalid(`請完成「${name}」的所有評分`)
    return scores
  }
  if (question.type === 'text') {
    const text = textOf(value)
    if (!text) return undefined
    if (text.length > LIMITS.text) throw invalid(`「${name}」最多 ${LIMITS.text} 字`)
    return text
  }
  return undefined
}

// The answers to store: one per question of the survey, in its shape, and
// nothing else; throws when a required question is unanswered
export function cleanAnswers(sections, input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const answers = {}
  ;(Array.isArray(sections) ? sections : []).forEach((section) => {
    ;(section.questions || []).forEach((question) => {
      // a rating question may go without a title of its own
      const name = question.title || section.title
      const value = cleanAnswer(question, raw[question.id], name)
      if (value !== undefined) answers[question.id] = value
      else if (question.required) throw invalid(`尚未回答「${name}」`)
    })
  })
  return answers
}

export const submitPartySurvey = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    if (ENFORCE_APP_CHECK.value() && !context.app) {
      throw new HttpsError('failed-precondition', '請使用正式網站填寫問卷')
    }
    // only signed-in accounts may answer; the response still stores no uid
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', '請先登入再填寫問卷')
    const year = Number(data?.year)
    if (!Number.isInteger(year) || year < 2000 || year > 2999) throw invalid('問卷年度不正確')

    const survey = await db.doc(`partySurveys/${year}`).get()
    if (!survey.exists || survey.get('open') !== true) {
      throw new HttpsError('failed-precondition', '問卷目前沒有開放')
    }

    const answers = cleanAnswers(survey.get('sections'), data?.answers)
    await db.collection(`partySurveys/${year}/responses`).add({ answers, createdAt: FieldValue.serverTimestamp() })
    return { ok: true }
  })
