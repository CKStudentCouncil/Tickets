import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/boot/firebase'
import { EVENT_DATE } from 'src/config/app'

// 舞會滿意度調查, one per party year (firestore.rules: match
// /partySurveys/{year}). partySurveys/{year} is { year, open, sections,
// updatedAt, updatedByUid }: the year's questions
// (src/data/partySurveyQuestions.js) and whether it takes answers. Public, so
// the survey page can show them; written by super admins. Answers go through
// submitPartySurvey (functions), which checks them against the questions, to
// partySurveys/{year}/responses, which only super admins may read.

// the party this year's survey is about
export const PARTY_YEAR = Number(EVENT_DATE.slice(0, 4))

const surveyRef = (year) => doc(db, 'partySurveys', String(year))
const submitCallable = httpsCallable(functions, 'submitPartySurvey')

// { year, open, sections } or null when that year has no survey yet
export async function fetchPartySurvey(year) {
  const snapshot = await getDoc(surveyRef(year))
  return snapshot.exists() ? snapshot.data() : null
}

// every year that has a survey, latest first
export async function fetchPartySurveyYears() {
  const snapshot = await getDocs(collection(db, 'partySurveys'))
  return snapshot.docs.map((item) => Number(item.id)).filter(Number.isInteger).sort((a, b) => b - a)
}

// A plain set replaces the whole document, as the rules only accept these fields.
export function savePartySurvey(year, { open, sections }, updatedByUid) {
  return setDoc(surveyRef(year), { year, open, sections, updatedAt: serverTimestamp(), updatedByUid })
}

export async function fetchPartySurveyResponses(year) {
  const snapshot = await getDocs(collection(db, 'partySurveys', String(year), 'responses'))
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

// answers: { [question id]: value } (see src/data/partySurveyQuestions.js)
export function submitPartySurveyAnswers(year, answers) {
  return submitCallable({ year, answers })
}
