// Party intro stories and lineup: scheduled public content.
//
// publishAt is stored as a Firestore Timestamp so the security rules can hide
// unpublished (and, for stories, disabled) documents from the public
// (PARTY-16). Public pages therefore query with matching where() filters;
// the rules reject queries that could return hidden documents.
import {
  Timestamp,
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  updateDoc,
  where
} from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { parseDate } from 'src/utils/datetime'

export const STORIES = 'partyStories'
export const LINEUP = 'partyLineup'

// "YYYY-MM-DDTHH:mm" (Taiwan time) from the admin form -> Timestamp
export function toPublishTimestamp(inputValue) {
  const date = parseDate(inputValue)
  return date ? Timestamp.fromDate(date) : null
}

function docsOf(snapshot) {
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }))
}

export async function fetchPublishedStories() {
  const snapshot = await getDocs(
    query(
      collection(db, STORIES),
      where('enabled', '==', true),
      where('publishAt', '<=', Timestamp.now())
    )
  )
  return docsOf(snapshot)
}

export async function fetchPublishedLineup() {
  const snapshot = await getDocs(
    query(collection(db, LINEUP), where('publishAt', '<=', Timestamp.now()))
  )
  return docsOf(snapshot)
}

// Super admins read everything, drafts included
export async function fetchAllContent(collectionName) {
  return docsOf(await getDocs(collection(db, collectionName)))
}

// Older documents stored publishAt as a string (invisible under the new
// rules) and the editor's name/email in updatedBy/createdBy, which is public
// (PARTY-26). Converts them in place; returns how many were updated.
export async function migrateLegacyContent(collectionName, items) {
  // stories used to be shown unless enabled === false; the public query now
  // needs enabled === true, so a missing flag must be written explicitly
  const missingEnabled = (item) => collectionName === STORIES && typeof item.enabled !== 'boolean'

  const legacy = items.filter(
    (item) =>
      typeof item.publishAt === 'string' ||
      'updatedBy' in item ||
      'createdBy' in item ||
      missingEnabled(item)
  )

  await Promise.all(
    legacy.map((item) => {
      const patch = { updatedBy: deleteField(), createdBy: deleteField() }
      if (typeof item.publishAt === 'string') {
        patch.publishAt = toPublishTimestamp(item.publishAt)
      }
      if (missingEnabled(item)) {
        patch.enabled = true
      }
      return updateDoc(doc(db, collectionName, item.id), patch)
    })
  )

  return legacy.length
}
