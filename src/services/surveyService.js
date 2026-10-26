import { collection, getDocs } from 'firebase/firestore'
import { db } from 'src/boot/firebase'

// surveyResponses, readable by staff (firestore.rules); the sales report
// counts its 得知管道 answers
export async function fetchSurveyResponses() {
  const snapshot = await getDocs(collection(db, 'surveyResponses'))
  return snapshot.docs.map((item) => item.data())
}
