import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultSections } from '../src/data/partySurveyQuestions.js'
import {
  firstMissing,
  linesOf,
  lowestRows,
  newQuestion,
  newSection,
  problemOf,
  rowsFromLines,
  summarizeSurvey
} from '../src/utils/partySurvey.js'

const SECTIONS = [
  {
    id: 's1',
    title: '基本',
    questions: [
      { id: 'reason', type: 'single', title: '原因', required: true, options: ['藝人', '朋友'], allowOther: true },
      { id: 'channels', type: 'multiple', title: '管道', required: false, options: ['IG', '海報'], allowOther: true }
    ]
  },
  {
    id: 's2',
    title: '評分',
    questions: [
      { id: 'ratings', type: 'scale', title: '', required: true, rows: [{ id: 'sound', text: '音響' }, { id: 'staff', text: '工作人員' }], lowLabel: '差', highLabel: '好' },
      { id: 'feedback', type: 'text', title: '意見', required: false }
    ]
  }
]

test('the default questions can be saved as they are, and ids are unique', () => {
  const sections = defaultSections()
  assert.equal(problemOf(sections), '')
  const ids = sections.flatMap((section) => section.questions.map((question) => question.id))
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('favoriteArtist') && ids.includes('system-usability'))
})

test('questions are checked before they are saved', () => {
  const section = (questions, title = '區塊') => [{ ...newSection(), title, questions }]
  const titled = (type, extra = {}) => ({ ...newQuestion(type), title: '題目', ...extra })

  assert.equal(problemOf(section([], '')), '第 1 個區塊還沒有標題')
  assert.equal(problemOf(section([])), '第 1 個區塊還沒有題目')
  assert.equal(problemOf(section([newQuestion('text')])), '第 1 個區塊的第 1 題還沒有題目文字')
  assert.equal(problemOf(section([titled('single', { options: ['是'] })])), '第 1 個區塊的第 1 題至少要有 2 個選項')
  assert.equal(problemOf(section([titled('scale')])), '第 1 個區塊的第 1 題至少要有 1 個評分項目')
  // a rating question needs no title of its own
  assert.equal(problemOf(section([{ ...newQuestion('scale'), rows: [{ id: 'r', text: '音響' }] }])), '')
  assert.equal(newQuestion('text').required, false)
})

test('options and rating rows come one per line; a row keeps its id', () => {
  assert.deepEqual(linesOf(' 是 \n\n否\n是'), ['是', '否'])
  const rows = rowsFromLines('音響\n燈光', [{ id: 'sound', text: '音響' }])
  assert.equal(rows[0].id, 'sound')
  assert.ok(rows[1].id.startsWith('r'))
})

test('the first required question left unanswered is named', () => {
  assert.equal(firstMissing(SECTIONS, {}).question.id, 'reason')
  assert.equal(firstMissing(SECTIONS, { reason: '自己想來', ratings: { sound: 5 } }).question.id, 'ratings')
  assert.equal(firstMissing(SECTIONS, { reason: '藝人', ratings: { sound: 5, staff: 4 } }), null)
})

test('a year of answers is summed up question by question', () => {
  const summary = summarizeSurvey(SECTIONS, [
    { answers: { reason: '藝人', channels: ['IG', '學長說的'], ratings: { sound: 2, staff: 5 }, feedback: ' 很好玩 ' } },
    { answers: { reason: '自己想來', channels: ['IG'], ratings: { sound: 3, staff: 4 } } },
    { answers: { reason: '藝人', ratings: { sound: 9 } } }
  ])
  const [reason, channels] = summary.sections[0].questions.map((question) => question.summary)
  const [ratings, feedback] = summary.sections[1].questions.map((question) => question.summary)

  assert.equal(summary.count, 3)
  assert.deepEqual(reason.options.map((option) => [option.label, option.count]), [['藝人', 2], ['朋友', 0]])
  assert.deepEqual(reason.others, ['自己想來'])
  assert.deepEqual([channels.answered, channels.options[0].count, channels.options[0].share], [2, 2, 1])
  assert.deepEqual(channels.others, ['學長說的'])
  // 9 is not a score
  assert.deepEqual(ratings.rows.map((row) => [row.id, row.average, row.count]), [['sound', 2.5, 2], ['staff', 4.5, 2]])
  assert.deepEqual(feedback.texts, ['很好玩'])
  assert.deepEqual(lowestRows(summary, 1).map((row) => row.text), ['音響'])
})
