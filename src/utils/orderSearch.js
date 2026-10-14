function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().trim()
}

function phoneSearch(value) {
  if (!/^[\d+().\s-]+$/.test(value) || !/\d/.test(value)) return ''
  return value.replace(/[+().\s-]/g, '')
}

export function createOrderMatcher(searchText) {
  const search = normalizeText(searchText)
  const terms = search.split(/\s+/).filter(Boolean)
  const wholePhone = phoneSearch(search)

  return (order) => {
    if (!terms.length) return true
    const nonPhoneFields = [
      order?.id, order?.customerName, order?.customerEmail,
      order?.school, order?.class, order?.number, order?.office,
      order?.deliveryUpdatedByName, order?.paymentUpdatedByName,
      ...(Array.isArray(order?.items) ? order.items.map((item) => item?.name) : [])
    ].map(normalizeText)
    const phoneText = normalizeText(order?.customerPhone)
    const phone = phoneSearch(phoneText)
    const fields = [...nonPhoneFields, phoneText]

    // A wholly numeric/formatted query must match a contiguous phone number.
    // Numeric class/seat terms may still match independently outside the phone.
    if (wholePhone) {
      return phone.includes(wholePhone) || fields.some((field) => field.includes(search)) ||
        terms.every((term) => nonPhoneFields.some((field) => field.includes(term)))
    }
    return terms.every((term) => fields.some((field) => field.includes(term)) ||
      (phoneSearch(term) && phone.includes(phoneSearch(term))))
  }
}

function checkAborted(signal) {
  if (!signal?.aborted) return
  throw signal.reason ?? Object.assign(new Error('Order search cancelled'), { name: 'AbortError' })
}

export async function scanOrderSearchPage({
  searchText, fetchBatch, cursor = null, pageSize = 50, batchSize = 250, signal
}) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || !Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('Search page and batch sizes must be positive integers')
  }

  const matches = createOrderMatcher(searchText)
  const orders = []
  let scanCursor = cursor
  let resultCursor = null

  for (;;) {
    checkAborted(signal)
    const batch = await fetchBatch(scanCursor, batchSize)
    checkAborted(signal)

    for (const entry of batch) {
      if (!matches(entry.order)) continue
      // Resume after the last displayed match, not the batch end: the
      // lookahead and any remaining matching documents belong to next page.
      if (orders.length === pageSize) return { orders, cursor: resultCursor, hasNext: true }
      orders.push(entry.order)
      resultCursor = entry.cursor
    }

    if (batch.length < batchSize) return { orders, cursor: resultCursor, hasNext: false }
    scanCursor = batch.at(-1).cursor
  }
}
