// 舞會滿意度調查 with questions super admins edit (src/data/partySurveyQuestions.js
// describes their shape): building and checking them on the results page,
// checking an answer sheet, and summing up a year's answers. Pure (no
// Firebase), so tests/partySurvey.test.js runs it with node.
import { LIMITS } from '../data/partySurveyQuestions.js'

/* ---------- editing ---------- */

// ids answers are stored under; never reused once a question is deleted
export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function newQuestion(type) {
  const question = { id: newId('q'), type, title: '', required: true }
  if (type === 'single' || type === 'multiple') Object.assign(question, { options: [], allowOther: false })
  if (type === 'scale') Object.assign(question, { rows: [], lowLabel: '非常不滿意', highLabel: '非常滿意' })
  if (type === 'text') question.required = false
  return question
}

export const newSection = () => ({ id: newId('s'), title: '', questions: [] })

// non-empty trimmed lines, each once
export const linesOf = (text) => [...new Set(String(text).split('\n').map((line) => line.trim()).filter(Boolean))]

// Rating rows from one line each; a line that was already a row keeps its id,
// so its earlier answers still count
export function rowsFromLines(text, rows = []) {
  const byText = new Map(rows.map((row) => [row.text, row.id]))
  return linesOf(text).map((line) => ({ id: byText.get(line) || newId('r'), text: line }))
}

// What stops these questions from being saved, or ''
export function problemOf(sections) {
  if (sections.length > LIMITS.sections) return `最多 ${LIMITS.sections} 個區塊`
  for (const [s, section] of sections.entries()) {
    const where = `第 ${s + 1} 個區塊`
    if (!section.title.trim()) return `${where}還沒有標題`
    if (section.title.length > LIMITS.title) return `${where}的標題太長`
    if (!section.questions.length) return `${where}還沒有題目`
    if (section.questions.length > LIMITS.questions) return `${where}最多 ${LIMITS.questions} 題`
    for (const [q, question] of section.questions.entries()) {
      const name = `${where}的第 ${q + 1} 題`
      // a rating question may go without a title: its rows say it all
      if (!question.title.trim() && question.type !== 'scale') return `${name}還沒有題目文字`
      if (question.title.length > LIMITS.title) return `${name}的題目太長`
      const items = question.type === 'scale' ? question.rows.map((row) => row.text) : question.options || []
      if (question.type === 'single' && items.length < 2) return `${name}至少要有 2 個選項`
      if (question.type === 'multiple' && items.length < 1) return `${name}至少要有 1 個選項`
      if (question.type === 'scale' && items.length < 1) return `${name}至少要有 1 個評分項目`
      if (items.length > LIMITS.options) return `${name}最多 ${LIMITS.options} 個選項`
      if (items.some((item) => item.length > LIMITS.label)) return `${name}有太長的選項`
    }
  }
  return ''
}

/* ---------- answering ---------- */

export const questionsOf = (sections) => sections.flatMap((section) => section.questions)

function isAnswered(question, value) {
  if (question.type === 'multiple') return Array.isArray(value) && value.length > 0
  if (question.type === 'scale') return question.rows.every((row) => Number.isInteger(value?.[row.id]))
  return typeof value === 'string' && value.trim() !== ''
}

// The first required question left unanswered, with its section, or null
export function firstMissing(sections, answers) {
  for (const section of sections) {
    const question = section.questions.find((item) => item.required && !isAnswered(item, answers[item.id]))
    if (question) return { section, question }
  }
  return null
}

/* ---------- results ---------- */

const mean = (values) => (values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null)

// how many picked each option (in the question's order), what was typed as
// 其他, and how many answered at all
function choicesOf(question, values) {
  const picked = values.flatMap((value) => (Array.isArray(value) ? value : [value]))
  const options = question.options || []
  return {
    answered: values.length,
    options: options.map((label) => {
      const count = picked.filter((value) => value === label).length
      return { label, count, share: values.length ? count / values.length : 0 }
    }),
    others: picked.filter((value) => !options.includes(value))
  }
}

function ratingsOf(question, values) {
  return {
    rows: question.rows.map((row) => {
      const scores = values.map((value) => value?.[row.id]).filter((score) => Number.isInteger(score) && score >= 1 && score <= 5)
      const dist = Array(5).fill(0)
      scores.forEach((score) => { dist[score - 1] += 1 })
      return { id: row.id, text: row.text, average: mean(scores), count: scores.length, dist }
    })
  }
}

export function summarizeQuestion(question, responses) {
  const values = responses
    .map((response) => response.answers?.[question.id])
    .filter((value) => value !== undefined && value !== null && value !== '')
  if (question.type === 'single' || question.type === 'multiple') return choicesOf(question, values)
  if (question.type === 'scale') return ratingsOf(question, values)
  return { answered: values.length, texts: values.map((value) => String(value).trim()).filter(Boolean) }
}

// A year's answers by the year's questions
export function summarizeSurvey(sections, responses) {
  return {
    count: responses.length,
    sections: sections.map((section) => ({
      ...section,
      questions: section.questions.map((question) => ({ ...question, summary: summarizeQuestion(question, responses) }))
    }))
  }
}

// The lowest-rated rows of every rating question, lowest first
export function lowestRows(summary, count = 3) {
  return summary.sections
    .flatMap((section) => section.questions)
    .filter((question) => question.type === 'scale')
    .flatMap((question) => question.summary.rows.map((row) => ({ ...row, question: question.title || '' })))
    .filter((row) => row.average !== null)
    .sort((a, b) => a.average - b.average)
    .slice(0, count)
}
