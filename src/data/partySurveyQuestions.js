// 舞會滿意度調查: each party year keeps its own questions in
// partySurveys/{year}.sections, edited by super admins on /admin/party-survey;
// this is the set a new year starts from. Answers are stored by question id
// (and, for ratings, row id), so a year copied from an earlier one stays
// comparable with it.
//
// A section is { id, title, questions }. A question is { id, type, title,
// required } plus, by type:
//   single / multiple: options (strings), allowOther (a 其他 the person types)
//   scale: rows ({ id, text }) each rated 1–5, lowLabel and highLabel
//   text: nothing more
import {
  CHANNEL_OPTIONS,
  DEVICE_OPTIONS,
  IDENTITY_OPTIONS,
  ISSUE_COUNT_OPTIONS,
  ISSUE_TYPE_OPTIONS,
  SCALE_SECTIONS
} from './surveyQuestions.js'

export const QUESTION_TYPES = [
  { key: 'single', label: '單選' },
  { key: 'multiple', label: '複選' },
  { key: 'scale', label: '李克特5點量表' },
  { key: 'text', label: '文字回答' }
]

// Keep in sync with functions/lib/partySurvey.js (and the sections limit with
// firestore.rules)
export const LIMITS = {
  sections: 20,
  questions: 40,
  options: 40,
  title: 300,
  label: 200,
  other: 200,
  text: 2000
}

const single = (id, title, options, extra = {}) => ({ id, type: 'single', title, required: true, options, allowOther: false, ...extra })
const multiple = (id, title, options, extra = {}) => ({ id, type: 'multiple', title, required: true, options, allowOther: false, ...extra })
const text = (id, title, required = false) => ({ id, type: 'text', title, required })
const scale = (id, title, rows, lowLabel, highLabel) => ({ id, type: 'scale', title, required: true, rows, lowLabel, highLabel })

export function defaultSections() {
  return [
    {
      id: 'about',
      title: '基本資料',
      questions: [
        single('identity', '請問您的身分為何？', IDENTITY_OPTIONS),
        single('attendedBefore', '請問您是否曾參加往年的建中舞會？', ['是', '否']),
        single('nextYear', '請問您是否考慮參加明年的建中舞會？', ['是', '否'])
      ]
    },
    {
      id: 'reasons',
      title: '參加動機與資訊來源',
      questions: [
        single('reason', '請問您參加本次舞會的主要原因為何？', [
          '受演出藝人陣容吸引', '受親友邀請', '親友為本次舞會的表演者', '希望體驗校園活動氛圍'
        ], { allowOther: true }),
        multiple('partyChannels', '請問您從哪些管道得知本次舞會的相關資訊？', [
          '親友直接邀請', '親友於社群媒體分享', '原本即有追蹤主辦單位官方 Instagram', 'Instagram 推薦內容',
          'Threads 推薦內容', 'Facebook 推薦內容', '校園海報', 'CK APP', '班聯會官網'
        ], { allowOther: true })
      ]
    },
    {
      id: 'artists',
      title: '藝人與演出',
      questions: [
        single('favoriteArtist', '舞會開始前，您最期待哪一組藝人的演出？', ['周興哲', '康士坦的變化球', '福夢', '胡凱兒', '艾薇', '呂士軒', '鄭沐晴', '達嗨']),
        text('wishArtists', '請問您希望未來的舞會邀請哪些藝人演出？', true)
      ]
    },
    {
      id: 'ratings',
      title: '綜合評價',
      questions: [
        scale('ratings', '請依您的實際感受，針對下列項目給予 1 至 5 分的評價', [
          { id: 'lighting', text: '舞臺燈光' },
          { id: 'sound', text: '舞臺音響' },
          { id: 'artists', text: '藝人演出' },
          { id: 'clubs', text: '社團表演' },
          { id: 'queue', text: '入場排隊與動線規劃' },
          { id: 'staff', text: '工作人員服務' },
          { id: 'audience', text: '現場觀眾秩序' },
          { id: 'decor', text: '場地佈置' },
          { id: 'tickets', text: '售票與取票流程' }
        ], '非常不滿意', '非常滿意'),
        text('feedback', '請問您對主辦單位是否有其他意見或建議？亦歡迎針對上述評分項目補充說明')
      ]
    },
    // the user survey (/survey), with the identity question shared above
    {
      id: 'system',
      title: '購票系統：基本資料',
      questions: [
        multiple('systemChannels', '您是如何得知本系統的？', CHANNEL_OPTIONS),
        single('device', '您主要使用什麼裝置操作本系統？', DEVICE_OPTIONS)
      ]
    },
    ...SCALE_SECTIONS.map((section) => ({
      id: `system-${section.key}`,
      title: section.title.startsWith('購票系統') ? section.title : `購票系統：${section.title}`,
      questions: [
        scale(
          `system-${section.key}`,
          '',
          section.questions.map((question) => ({ id: question.id, text: question.text })),
          '非常不同意',
          '非常同意'
        )
      ]
    })),
  ]
}
