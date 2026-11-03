import { collection, doc, documentId, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/boot/firebase'

// 清除所有訂單 (functions/lib/orderPurge.js). A run may take the function's
// full 9 minutes; it keeps going on the server if this page stops waiting.
const purgeCallable = httpsCallable(functions, 'purgeOrders', { timeout: 540_000 })
const importCallable = httpsCallable(functions, 'importSalesArchive', { timeout: 120_000 })

// `confirm` is the phrase as the super admin typed it. `orderIds` starts a
// run; leave them out to resume one with its purgeId.
export async function purgeOrders({ purgeId, confirm, orderIds }) {
  const { data } = await purgeCallable({ purgeId, confirm, ...(orderIds ? { orderIds } : {}) })
  return data
}

// The run's progress, live (orderPurges/{purgeId}); null until it exists
export function subscribePurge(purgeId, { onData, onError }) {
  return onSnapshot(doc(db, 'orderPurges', purgeId), (snap) => {
    onData(snap.exists() ? { purgeId: snap.id, ...snap.data() } : null)
  }, onError)
}

// A run that stopped before deleting every order, to resume
export async function fetchUnfinishedPurge() {
  const snapshot = await getDocs(query(collection(db, 'orderPurges'), where('stage', 'in', ['archive', 'delete']), limit(1)))
  return snapshot.empty ? null : { purgeId: snapshot.docs[0].id, ...snapshot.docs[0].data() }
}

// salesArchives/{year}: each archived or imported year's summary
export async function fetchSalesArchives() {
  const snapshot = await getDocs(collection(db, 'salesArchives'))
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

// The year's sale rows (functions/lib/salesArchive.js), in order
export async function fetchArchiveRows(year) {
  const snapshot = await getDocs(query(collection(db, 'salesArchives', String(year), 'rows'), orderBy(documentId())))
  return snapshot.docs.flatMap((item) => item.data().rows || [])
}

// 匯入往年資料: { openDate, closeDate, rows, names } -> { year, orderCount, revenue }
export async function importSalesArchive(payload) {
  const { data } = await importCallable(payload)
  return data
}
