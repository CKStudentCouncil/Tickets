import { collection, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/boot/firebase'

const submitCallable = httpsCallable(functions, 'submitSurvey')

// A response from the survey page; submitSurvey (functions) checks it and
// the Turnstile token (action survey) and writes surveyResponses, where
// clients may not write (firestore.rules).
export function submitSurveyResponse(response, turnstileToken = '') {
  return submitCallable({ response, turnstileToken })
}

// surveyResponses, readable by staff (firestore.rules); the sales report
// counts its 得知管道 answers
export async function fetchSurveyResponses() {
  const snapshot = await getDocs(collection(db, 'surveyResponses'))
  return snapshot.docs.map((item) => item.data())
}
