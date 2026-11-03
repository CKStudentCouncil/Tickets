import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'

import { db, HttpsError } from './common.js'
import { REGION } from './constants.js'
import { SURVEY_ACTION, TURNSTILE_SECRET, requireTurnstile } from './turnstile.js'

// 購票系統使用回饋問卷 (src/pages/SurveyPage.vue). Anyone may answer without
// signing in, so answers come through submitSurvey, which checks them and a
// Turnstile token, and writes surveyResponses; clients may not write there
// (firestore.rules).

// Keep these in sync with src/data/surveyQuestions.js
// (functions/test/unit/consistency.test.js compares them).
export const IDENTITY_OPTIONS = [
  '建國中學學生',
  '建國中學家長',
  '建國中學教師',
  '北一女中學生',
  '中山女高學生',
  '景美女中學生',
  '成功高中學生',
  '師大附中學生',
  '其他學校學生',
  '社會人士',
  '其他'
]
export const CHANNEL_OPTIONS = ['班聯會官方 Instagram', 'CK APP', '班代或班級轉知', '同學或朋友分享', '建中相關社群', '搜尋引擎', '其他']
export const DEVICE_OPTIONS = ['手機', '平板', '筆記型電腦', '桌上型電腦', '其他']
export const ISSUE_COUNT_OPTIONS = ['沒有遇到問題', '遇到過一次', '遇到過 2～3 次', '遇到過 4 次以上']
export const ISSUE_TYPE_OPTIONS = [
  '找不到購票入口',
  '票種資訊不清楚',
  '活動資訊不清楚',
  '購票資格確認',
  '選擇票種',
  '填寫購票資料',
  '付款或付款資訊',
  '訂單送出',
  '訂單確認',
  '電子票券或入場資訊',
  '網頁載入速度',
  '手機版介面',
  '登入或帳號',
  '其他'
]
// the rating questions, each answered 1-5
export const SCORE_IDS = Array.from({ length: 26 }, (_, i) => `q${i + 4}`) // q4..q29
export const MAX_TEXT = 2000

const NO_ISSUE = ISSUE_COUNT_OPTIONS[0]
const invalid = (message) => new HttpsError('invalid-argument', message)

function pickList(value, options, message) {
  if (!Array.isArray(value) || value.some((item) => !options.includes(item))) throw invalid(message)
  return [...new Set(value)]
}

function shortText(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw invalid('文字欄位格式不正確')
  const text = value.trim()
  if (text.length > MAX_TEXT) throw invalid(`文字欄位最多 ${MAX_TEXT} 字`)
  return text
}

// The response to store, with exactly the fields the staff pages read;
// throws on anything the survey page could not have sent
export function cleanSurveyResponse(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}

  if (!IDENTITY_OPTIONS.includes(raw.identity)) throw invalid('請選擇您的身分')
  const channels = pickList(raw.channels, CHANNEL_OPTIONS, '得知管道的選項不正確')
  if (!channels.length) throw invalid('請選擇您是如何得知本系統的')
  if (!DEVICE_OPTIONS.includes(raw.device)) throw invalid('請選擇您主要使用的裝置')
  if (!ISSUE_COUNT_OPTIONS.includes(raw.issueCount)) throw invalid('請選擇是否曾遇到操作上的問題')

  const rawScores = raw.scores && typeof raw.scores === 'object' && !Array.isArray(raw.scores) ? raw.scores : {}
  if (Object.keys(rawScores).some((key) => !SCORE_IDS.includes(key))) throw invalid('評分題目不正確')
  const scores = {}
  for (const id of SCORE_IDS) {
    const score = rawScores[id]
    if (!Number.isInteger(score) || score < 1 || score > 5) throw invalid('請完成所有評分題目（1 到 5 分）')
    scores[id] = score
  }

  const issueTypes =
    raw.issueCount === NO_ISSUE ? [] : pickList(raw.issueTypes ?? [], ISSUE_TYPE_OPTIONS, '問題類型的選項不正確')

  return {
    identity: raw.identity,
    channels,
    device: raw.device,
    scores,
    issueCount: raw.issueCount,
    issueTypes,
    improvement: shortText(raw.improvement),
    suggestion: shortText(raw.suggestion)
  }
}

export const submitSurvey = functions
  .region(REGION)
  .runWith({ secrets: [TURNSTILE_SECRET] })
  .https.onCall(async (data, context) => {
    const response = cleanSurveyResponse(data?.response)
    await requireTurnstile(data, context, SURVEY_ACTION)
    await db.collection('surveyResponses').add({ ...response, createdAt: FieldValue.serverTimestamp() })
    return { ok: true }
  })
