import test from 'node:test'
import assert from 'node:assert/strict'
import { cropStyle, dragCrop, normalizeCrop } from '../src/utils/imageCrop.js'
import { compareLineupOrder, moveItem, orderUpdates } from '../src/utils/lineupOrder.js'

test('normalizes missing, invalid and out-of-range crops', () => {
  assert.deepEqual(normalizeCrop(undefined), { x: 50, y: 50, zoom: 1 })
  assert.deepEqual(normalizeCrop({ x: '10', y: NaN, zoom: null }), { x: 50, y: 50, zoom: 1 })
  assert.deepEqual(normalizeCrop({ x: -20, y: 140, zoom: 9 }), { x: 0, y: 100, zoom: 3 })
  assert.deepEqual(normalizeCrop({ x: 33.333, y: 66.666, zoom: 1.234 }), { x: 33.3, y: 66.7, zoom: 1.23 })
})

test('exposes the crop as CSS custom properties', () => {
  assert.deepEqual(cropStyle({ x: 20, y: 75, zoom: 1.5 }), {
    '--crop-x': '20%', '--crop-y': '75%', '--crop-zoom': 1.5
  })
})

test('a drag pans only along the axis where the covered image overflows', () => {
  // 2000x1000 image in a 400x300 frame: cover scale 0.3 -> 600x300 rendered
  const sizes = { frameW: 400, frameH: 300, imageW: 2000, imageH: 1000 }
  // 200px of horizontal overflow: dragging the image 100px left shows its right half
  assert.deepEqual(dragCrop({ x: 50, y: 50, zoom: 1 }, { dx: -100, dy: 40 }, sizes), { x: 100, y: 50, zoom: 1 })
  assert.deepEqual(dragCrop({ x: 50, y: 50, zoom: 1 }, { dx: 50, dy: 0 }, sizes), { x: 25, y: 50, zoom: 1 })
  assert.deepEqual(dragCrop({ x: 50, y: 50, zoom: 1 }, { dx: 500, dy: 0 }, sizes), { x: 0, y: 50, zoom: 1 })
})

test('zooming in gives the drag more room on both axes', () => {
  // zoom 2 -> 1200x600 rendered: 800px and 300px of overflow
  const sizes = { frameW: 400, frameH: 300, imageW: 2000, imageH: 1000 }
  assert.deepEqual(dragCrop({ x: 50, y: 50, zoom: 2 }, { dx: -80, dy: 30 }, sizes), { x: 60, y: 40, zoom: 2 })
})

test('ignores drags before the image has loaded', () => {
  assert.deepEqual(
    dragCrop({ x: 40, y: 60, zoom: 1 }, { dx: 10, dy: 10 }, { frameW: 400, frameH: 300, imageW: 0, imageH: 0 }),
    { x: 40, y: 60, zoom: 1 }
  )
})

test('orders by the stored order, then unordered items by publish time', () => {
  const items = [
    { id: 'late', publishAt: '2026-10-03T12:00' },
    { id: 'second', order: 1, publishAt: '2026-10-09T12:00' },
    { id: 'early', publishAt: '2026-10-01T12:00' },
    { id: 'first', order: 0, publishAt: '2026-10-08T12:00' }
  ]
  assert.deepEqual(items.sort(compareLineupOrder).map((item) => item.id), ['first', 'second', 'early', 'late'])
})

test('moves an item and lists only the orders that changed', () => {
  const items = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }, { id: 'c', order: 2 }, { id: 'd' }]
  const moved = moveItem(items, 2, 0)
  assert.deepEqual(moved.map((item) => item.id), ['c', 'a', 'b', 'd'])
  assert.deepEqual(items.map((item) => item.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(orderUpdates(moved).map(([item, order]) => [item.id, order]), [['c', 0], ['a', 1], ['b', 2], ['d', 3]])
  assert.deepEqual(orderUpdates(items.slice(0, 3)), [])
})
