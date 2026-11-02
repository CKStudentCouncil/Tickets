import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/boot/firebase'
import { RETRYABLE, byCreatedAtDesc } from 'src/services/orderService'

// 路宣登記 (functions/lib/streetSales.js). Admins register tickets sold for
// cash on the street, handed over as paper tickets at once; each sale is a
// paid, collected order of the type chosen in settings/streetSale, with
// nothing about the buyer. Only super admins see the totals.
//   settings/streetSale   { enabled, ticketTypeId }, written by super admins
//   orders/{id}           the sales: streetSale: true, school 路宣,
//                         promoterEmail, promoterName (who sold it)

const registerCallable = httpsCallable(functions, 'registerStreetSale')

const programRef = () => doc(db, 'settings', 'streetSale')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const toItem = (snapshot) => ({ id: snapshot.id, ...snapshot.data() })

export async function fetchStreetProgram() {
  const snapshot = await getDoc(programRef())
  const data = snapshot.exists() ? snapshot.data() : {}

  return {
    enabled: data.enabled === true,
    ticketTypeId: String(data.ticketTypeId || '')
  }
}

/* ---------- admins ---------- */

// The sales this staff member registered
export async function fetchMyStreetSales(email) {
  const snapshot = await getDocs(query(collection(db, 'orders'), where('promoterEmail', '==', email.trim().toLowerCase())))
  return snapshot.docs.map(toItem).sort(byCreatedAtDesc)
}

// { requestId, quantity }; returns { id } of the order.
// Retries a lost or busy call with the same requestId, so it is sold once.
export async function registerStreetSale(input) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { data } = await registerCallable(input)
      return data
    } catch (error) {
      if (!RETRYABLE.includes(error?.code) || attempt >= 3) throw error
      await wait(500 * attempt + Math.random() * 1000)
    }
  }
}

/* ---------- super admins ---------- */

// Sorted here rather than with orderBy, which would need a composite index
export async function fetchAllStreetSales() {
  const snapshot = await getDocs(query(collection(db, 'orders'), where('streetSale', '==', true)))
  return snapshot.docs.map(toItem).sort(byCreatedAtDesc)
}

// The document is public, so only the editor's uid is stored (PARTY-26)
export function saveStreetProgram({ enabled, ticketTypeId }, updatedByUid) {
  return setDoc(programRef(), { enabled, ticketTypeId, updatedAt: serverTimestamp(), updatedByUid })
}
