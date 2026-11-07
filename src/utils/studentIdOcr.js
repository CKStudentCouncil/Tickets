// Reads the student ID number off a photo of a student card, in the browser
// (the photo never leaves the device). Door staff scan a 建中 student card at
// the check-in desk to find the orders of that student's school account.
//
// The number is only a lookup key: anyone can show a photo or a copy of
// someone else's card, so staff still compare the card's photo with the
// person in front of them.
//
// 1. Find the card (OpenCV.js): edges → contours → a quadrilateral with the
//    85.6 × 54 mm shape. A finger over a corner or an edge hides part of the
//    outline, so besides the plain 4-corner fit the card's straight edges are
//    fitted as lines and intersected, which puts back the hidden corners.
// 2. Warp the card flat, drop coloured pixels (logos, frames, skin), and
//    binarise against the local mean so shadows and backgrounds go white.
// 3. When the card's layout is known (`idCorner`: 建中 cards have the number
//    in small print at the bottom right), only that corner is read: the row
//    of digit-sized marks in it is picked out and read alone, from the
//    black-and-white corner and from the picture itself. A few tens of
//    milliseconds instead of reading the whole card.
// 4. Otherwise, or when that finds nothing: Tesseract.js (sparse text) reads
//    the whole card upright and upside down; the ID is the largest confident
//    number of the expected length. Unsure reads are repeated with other
//    thresholds and the readings vote.
// 5. No card found: rows of digit-sized marks anywhere in the picture, at any
//    angle (`findLines`); for a photo also the whole picture, deskewed, in
//    four orientations.

const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js'

// ISO/IEC 7810 ID-1 (student cards, 悠遊卡, bank cards)
export const CARD_RATIO = 85.6 / 54

const DEFAULTS = {
  idLength: [6, 8],
  // only numbers like this count (e.g. /^11[0-9]00[0-9]{3}$/); null: any
  idPattern: null,
  // (digits) => the ID they stand for, or '': puts back a fixed part that is
  // often misread (the 11 of 11x00xxx read as 41 or 1)
  repairId: null,
  // [x0, y0, x1, y1] of the upright card (0–1) where the number is printed
  idCorner: null,
  // no card, or nothing in its corner: look for rows of digits anywhere
  findLines: false,
  maxWorkers: 0, // 0: by CPU cores, 2–4
  workMax: 1800, // longest side of the picture searched for the card
  hiResMax: 3000, // longest side the card is cut from
  cardWidth: 1400, // width of the flattened card
  opencvUrl: OPENCV_URL,
  // Tesseract.js paths (default: its own CDN copies of the same version)
  workerPath: '',
  corePath: '',
  langPath: '',
  loadTesseract: () => import('tesseract.js').then((module) => module.default || module)
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.crossOrigin = 'anonymous'
    script.onload = resolve
    script.onerror = () => reject(new Error(`無法載入 ${src}`))
    document.head.appendChild(script)
  })
}

// ---------- pixels ----------

function toCanvas(source, maxSide, maxScale = 2.5) {
  const width = source.videoWidth || source.naturalWidth || source.width
  const height = source.videoHeight || source.naturalHeight || source.height
  const scale = Math.min(maxSide / Math.max(width, height), maxScale)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

// Brightness with coloured pixels (red frames, logos, fingers) turned white;
// dark pixels keep their value so the black digits stay
function decolor(canvas) {
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height)
  const values = new Float32Array(canvas.width * canvas.height)
  for (let i = 0, p = 0; i < values.length; i++, p += 4) {
    const max = Math.max(data[p], data[p + 1], data[p + 2])
    const spread = max - Math.min(data[p], data[p + 1], data[p + 2])
    values[i] = max > 90 && spread > 35 && spread > max * 0.25 ? 255 : max
  }
  return values
}

// Black where a pixel is `offset` darker than the mean around it (box of
// side 2r + 1, summed with an integral image)
function threshold(values, width, height, offset, radius = 0) {
  const r = radius || Math.max(8, Math.round(Math.max(width, height) / 40))
  const stride = width + 1
  const sums = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += values[y * width + x]
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row
    }
  }
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height, y + r + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width, x + r + 1)
      const sum = sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0]
      out[y * width + x] = values[y * width + x] < sum / ((y1 - y0) * (x1 - x0)) - offset ? 0 : 255
    }
  }
  return out
}

function binaryCanvas(bits, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const image = context.createImageData(width, height)
  for (let i = 0, p = 0; i < bits.length; i++, p += 4) {
    image.data[p] = image.data[p + 1] = image.data[p + 2] = bits[i]
    image.data[p + 3] = 255
  }
  context.putImageData(image, 0, 0)
  return canvas
}

function canvasBits(canvas) {
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height)
  const bits = new Uint8Array(canvas.width * canvas.height)
  for (let i = 0, p = 0; i < bits.length; i++, p += 4) bits[i] = data[p] < 128 ? 0 : 255
  return bits
}

// share of black pixels (sampled)
const inkCache = new WeakMap()
function inkShare(canvas) {
  if (!inkCache.has(canvas)) {
    const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height)
    let black = 0
    let total = 0
    for (let p = 0; p < data.length; p += 4 * 7) {
      total++
      if (data[p] < 128) black++
    }
    inkCache.set(canvas, black / total)
  }
  return inkCache.get(canvas)
}

// Turns a black-and-white canvas (white fill). Right angles are copied pixel
// for pixel, since smoothing would blur and thicken the strokes
function rotate(source, degrees) {
  const t = (degrees * Math.PI) / 180
  const cos = Math.abs(Math.cos(t))
  const sin = Math.abs(Math.sin(t))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(source.width * cos + source.height * sin)
  canvas.height = Math.round(source.width * sin + source.height * cos)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const square = degrees % 90 === 0
  context.imageSmoothingEnabled = !square
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(t)
  context.drawImage(source, -source.width / 2, -source.height / 2)
  if (!square) {
    // smoothing left grey edges: back to black and white
    context.setTransform(1, 0, 0, 1, 0, 0)
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let p = 0; p < image.data.length; p += 4) {
      image.data[p] = image.data[p + 1] = image.data[p + 2] = image.data[p] < 128 ? 0 : 255
    }
    context.putImageData(image, 0, 0)
  }
  return canvas
}

// Tilt of the text lines (−45° to 45°, so with the four right-angle turns any
// angle is covered): the angle whose row histogram of the black pixels is the
// most peaked
function estimateSkew(bits, width, height) {
  const step = Math.max(1, Math.round(Math.max(width, height) / 500))
  const xs = []
  const ys = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (bits[y * width + x] === 0) {
        xs.push(x / step)
        ys.push(y / step)
      }
    }
  }
  if (xs.length < 50) return 0
  const size = Math.ceil((width + height) / step) + 2
  let best = 0
  let bestScore = -1
  for (let angle = -45; angle <= 45.001; angle += 0.5) {
    const t = (angle * Math.PI) / 180
    const cos = Math.cos(t)
    const sin = Math.sin(t)
    const histogram = new Float64Array(size * 2)
    for (let i = 0; i < xs.length; i++) histogram[Math.round(ys[i] * cos - xs[i] * sin) + size]++
    let score = 0
    for (const count of histogram) score += count * count
    if (score > bestScore) {
      bestScore = score
      best = angle
    }
  }
  return best
}

// ---------- geometry ----------

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function polygonArea(points) {
  let sum = 0
  points.forEach((p, i) => {
    const n = points[(i + 1) % points.length]
    sum += p.x * n.y - n.x * p.y
  })
  return Math.abs(sum) / 2
}

function isConvex(quad) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    const c = quad[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-6) return false
    if (sign && Math.sign(cross) !== sign) return false
    sign = Math.sign(cross)
  }
  return true
}

// Corners clockwise from the top left, the first side a long side, so the
// flattened card is always landscape (only upright or upside down remain)
export function orderQuad(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / 4
  const cy = points.reduce((s, p) => s + p.y, 0) / 4
  const sorted = points.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let first = 0
  sorted.forEach((p, i) => {
    if (p.x + p.y < sorted[first].x + sorted[first].y) first = i
  })
  let quad = sorted.slice(first).concat(sorted.slice(0, first))
  if (distance(quad[0], quad[1]) + distance(quad[2], quad[3]) < distance(quad[1], quad[2]) + distance(quad[3], quad[0])) {
    quad = [quad[3], quad[0], quad[1], quad[2]]
  }
  return quad
}

function quadRatio(quad) {
  const long = (distance(quad[0], quad[1]) + distance(quad[2], quad[3])) / 2
  const short = (distance(quad[1], quad[2]) + distance(quad[3], quad[0])) / 2
  return long / Math.max(1, short)
}

// A line through `points` (total least squares), as n·p = rho with the unit
// normal n at angle theta + 90°, theta in [0°, 180°)
function fitLine(points) {
  let sx = 0
  let sy = 0
  let sw = 0
  for (const p of points) {
    sx += p.x * p.w
    sy += p.y * p.w
    sw += p.w
  }
  const mx = sx / sw
  const my = sy / sw
  let xx = 0
  let xy = 0
  let yy = 0
  for (const p of points) {
    const dx = p.x - mx
    const dy = p.y - my
    xx += dx * dx * p.w
    xy += dx * dy * p.w
    yy += dy * dy * p.w
  }
  let theta = 0.5 * Math.atan2(2 * xy, xx - yy)
  if (theta < 0) theta += Math.PI
  const nx = -Math.sin(theta)
  const ny = Math.cos(theta)
  return { theta, nx, ny, rho: nx * mx + ny * my }
}

function intersect(a, b) {
  const det = a.nx * b.ny - a.ny * b.nx
  if (Math.abs(det) < 1e-9) return null
  return { x: (a.rho * b.ny - a.ny * b.rho) / det, y: (a.nx * b.rho - a.rho * b.nx) / det }
}

// angle between two directions, 0–90°
function angleBetween(a, b) {
  const d = Math.abs(a - b) % Math.PI
  return Math.min(d, Math.PI - d)
}

// Signed distance from the line (n·p − rho); used to tell opposite sides apart
const lineOffset = (line, p) => line.nx * p.x + line.ny * p.y - line.rho

// The card's sides as straight runs of an outline: the outline is cut into
// segments, segments on one line are merged, and every pair of roughly
// parallel lines crossed with another pair is a possible card. Corners hidden
// under a finger come back where the visible parts of two sides meet.
export function quadsFromOutline(outline, { minSide }) {
  const n = outline.length
  if (n < 8) return []
  const segments = []
  for (let i = 0; i < n; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % n]
    const length = distance(a, b)
    if (length < minSide) continue
    // sample along the segment so long runs weigh more in the fit
    const points = []
    const steps = Math.max(2, Math.round(length / 4))
    for (let k = 0; k <= steps; k++) points.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps, w: 1 })
    segments.push({ points, length, line: fitLine(points), a, b })
  }

  // merge segments lying on one line (a side interrupted by a finger)
  const tolerance = minSide * 0.35
  const lines = []
  for (const segment of segments.sort((x, y) => y.length - x.length)) {
    const home = lines.find(
      (line) =>
        angleBetween(line.line.theta, segment.line.theta) < (5 * Math.PI) / 180 &&
        Math.abs(lineOffset(line.line, segment.a)) < tolerance &&
        Math.abs(lineOffset(line.line, segment.b)) < tolerance
    )
    if (home) {
      home.points.push(...segment.points)
      home.length += segment.length
      home.line = fitLine(home.points)
    } else {
      lines.push({ points: segment.points.slice(), length: segment.length, line: segment.line })
    }
  }
  const strong = lines.sort((x, y) => y.length - x.length).slice(0, 8)

  // pairs of opposite sides: nearly parallel (perspective allows some), apart
  const pairs = []
  for (let i = 0; i < strong.length; i++) {
    for (let j = i + 1; j < strong.length; j++) {
      const a = strong[i]
      const b = strong[j]
      if (angleBetween(a.line.theta, b.line.theta) > (25 * Math.PI) / 180) continue
      const mid = b.points[Math.floor(b.points.length / 2)]
      if (Math.abs(lineOffset(a.line, mid)) < minSide * 2) continue
      pairs.push([a, b])
    }
  }

  const quads = []
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a1, a2] = pairs[i]
      const [b1, b2] = pairs[j]
      if (new Set([a1, a2, b1, b2]).size < 4) continue
      const cross = angleBetween(a1.line.theta, b1.line.theta)
      if (cross < (50 * Math.PI) / 180) continue
      const corners = [intersect(a1.line, b1.line), intersect(b1.line, a2.line), intersect(a2.line, b2.line), intersect(b2.line, a1.line)]
      if (corners.some((c) => !c)) continue
      if (!isConvex(corners)) continue
      const perimeter = corners.reduce((s, c, k) => s + distance(c, corners[(k + 1) % 4]), 0)
      // how much of the outline lies on these four sides (a finger hides some)
      const coverage = Math.min(1, (a1.length + a2.length + b1.length + b2.length) / perimeter)
      quads.push({ corners, coverage })
    }
  }
  return quads
}

// ---------- reading the number ----------

function pickNumbers(data, [minLength, maxLength], pattern = null, repair = null) {
  const found = []
  const add = (text, confidence, bbox) => {
    if (text.length < minLength || text.length > maxLength) return
    if (pattern && !pattern.test(text)) return
    found.push({ text, confidence, bbox, height: bbox.y1 - bbox.y0 })
  }
  for (const word of data.words || []) {
    const text = word.text.replace(/^[^0-9]+|[^0-9]+$/g, '')
    if (!/^\d+$/.test(text)) continue
    add(text, word.confidence, word.bbox)
    const fixed = repair?.(text)
    if (fixed && fixed !== text) add(fixed, word.confidence - 10, word.bbox)
  }
  // a number split into two words ("1234 567")
  for (const line of data.lines || []) {
    const words = (line.words || []).filter((word) => /^\d+$/.test(word.text))
    for (let i = 0; i + 1 < words.length; i++) {
      const a = words[i]
      const b = words[i + 1]
      const gap = b.bbox.x0 - a.bbox.x1
      if (gap >= 0 && gap < (a.bbox.y1 - a.bbox.y0) * 0.8) {
        add(a.text + b.text, Math.min(a.confidence, b.confidence) - 5, {
          x0: a.bbox.x0,
          y0: Math.min(a.bbox.y0, b.bbox.y0),
          x1: b.bbox.x1,
          y1: Math.max(a.bbox.y1, b.bbox.y1)
        })
      }
    }
  }
  // the ID is usually the largest number on the card
  const tallest = Math.max(1, ...found.map((c) => c.height))
  for (const c of found) {
    c.size = c.height / tallest
    c.score = c.confidence + 25 * c.size
  }
  found.sort((a, b) => b.score - a.score)
  const seen = new Set()
  return found.filter((c) => !seen.has(c.text) && seen.add(c.text))
}

// ---------- rows of digits ----------

// Long straight black runs (a frame, the photo's edge, the card's edge) turn
// white, so digits touching them come apart
export function wipeLongRuns(bits, width, height, longest) {
  const wipe = new Uint8Array(width * height)
  const runs = (count, length, at) => {
    for (let a = 0; a < count; a++) {
      let start = -1
      for (let b = 0; b <= length; b++) {
        const black = b < length && bits[at(a, b)] === 0
        if (black && start < 0) start = b
        if (!black && start >= 0) {
          if (b - start > longest) for (let k = start; k < b; k++) wipe[at(a, k)] = 1
          start = -1
        }
      }
    }
  }
  runs(height, width, (y, x) => y * width + x)
  runs(width, height, (x, y) => y * width + x)
  for (let i = 0; i < bits.length; i++) if (wipe[i]) bits[i] = 255
  return bits
}

// Connected black areas: { x0, y0, x1, y1, w, h, area, cx, cy, pixels? }.
// Areas wider or taller than `maxSide` are dropped (and not kept whole)
function components(bits, width, height, { maxSide = Infinity, keepPixels = false } = {}) {
  const label = new Uint8Array(width * height)
  const found = []
  const stack = []
  for (let start = 0; start < bits.length; start++) {
    if (bits[start] !== 0 || label[start]) continue
    let x0 = width, y0 = height, x1 = 0, y1 = 0, area = 0, sx = 0, sy = 0
    const pixels = keepPixels ? [] : null
    label[start] = 1
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()
      const x = i % width
      const y = (i - x) / width
      area++
      sx += x
      sy += y
      if (pixels) pixels.push(i)
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
        if (next >= 0 && bits[next] === 0 && !label[next]) {
          label[next] = 1
          stack.push(next)
        }
      }
    }
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    if (w > maxSide || h > maxSide) continue
    found.push({ x0, y0, x1, y1, w, h, area, cx: sx / area, cy: sy / area, pixels })
  }
  return found
}

// The rows of digit-sized marks in a level black-and-white canvas (the
// corner of a flattened card), longest first: each a canvas holding only that
// row's marks on white, with `box` (where it was)
export function findDigitRows(canvas, { minCount = 6, max = 2, unline = 0.25 } = {}) {
  const { width, height } = canvas
  const bits = canvasBits(canvas)
  if (unline) wipeLongRuns(bits, width, height, Math.round(height * unline))
  // digit-shaped: not specks, taller than a digit is wide unless digits
  // touch (then one wide mark), not a frame
  const marks = components(bits, width, height, { maxSide: height * 0.6 * 4.5, keepPixels: true }).filter(
    (c) => c.h >= Math.max(8, height * 0.04) && c.h <= height * 0.6 && c.w <= c.h * 4.5 && c.w >= c.h * 0.12 && c.area >= c.w * c.h * 0.12
  )
  marks.forEach((c, i) => (c.id = i))
  const rows = []
  for (const seed of marks) {
    const middle = (seed.y0 + seed.y1) / 2
    const row = marks
      .filter((c) => Math.abs((c.y0 + c.y1) / 2 - middle) < seed.h * 0.35 && c.h > seed.h * 0.7 && c.h < seed.h * 1.4)
      .sort((a, b) => a.x0 - b.x0)
    // the longest run with small gaps
    let run = [row[0]]
    let best = run
    const span = (list) => list.reduce((sum, c) => sum + c.w, 0)
    for (let k = 1; k < row.length; k++) {
      if (row[k].x0 - run[run.length - 1].x1 < seed.h * 0.9) run.push(row[k])
      else run = [row[k]]
      if (span(run) > span(best)) best = run
    }
    // touching digits come as one wide mark: counted by width
    const digits = best.reduce((sum, c) => sum + Math.max(1, Math.round(c.w / (seed.h * 0.6))), 0)
    if (digits >= minCount) rows.push({ marks: best, digits })
  }
  // rows that share no mark, the most digits first
  const used = new Set()
  const picked = []
  for (const row of rows.sort((a, b) => b.digits - a.digits)) {
    if (picked.length >= max) break
    if (row.marks.some((c) => used.has(c.id))) continue
    row.marks.forEach((c) => used.add(c.id))
    picked.push(row)
  }
  return picked.map((row) => drawRow(row.marks, width))
}

function drawRow(marks, sourceWidth) {
  const x0 = Math.min(...marks.map((c) => c.x0))
  const x1 = Math.max(...marks.map((c) => c.x1))
  const y0 = Math.min(...marks.map((c) => c.y0))
  const y1 = Math.max(...marks.map((c) => c.y1))
  const h = y1 - y0 + 1
  const pad = Math.round(h * 0.6)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1 + pad * 2
  out.height = h + pad * 2
  const context = out.getContext('2d', { willReadFrequently: true })
  const image = context.createImageData(out.width, out.height)
  image.data.fill(255)
  for (const c of marks) {
    for (const i of c.pixels) {
      const x = (i % sourceWidth) - x0 + pad
      const y = Math.floor(i / sourceWidth) - y0 + pad
      const p = (y * out.width + x) * 4
      image.data[p] = image.data[p + 1] = image.data[p + 2] = 0
    }
  }
  context.putImageData(image, 0, 0)
  out.box = { x0, y0, x1, y1, h }
  return out
}

// Grey with coloured pixels white, in place (Tesseract binarises a tight
// crop well on its own)
function greyInPlace(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const d = image.data
  for (let p = 0; p < d.length; p += 4) {
    const max = Math.max(d[p], d[p + 1], d[p + 2])
    const spread = max - Math.min(d[p], d[p + 1], d[p + 2])
    d[p] = d[p + 1] = d[p + 2] = max > 90 && spread > 35 && spread > max * 0.25 ? 255 : max
  }
  context.putImageData(image, 0, 0)
  return canvas
}

// A row's box cut from the picture itself, twice as large
function greyRow(source, box, scale = 2) {
  const sx = Math.max(0, box.x0 - box.h * 0.5)
  const sy = Math.max(0, box.y0 - box.h * 0.3)
  const sw = Math.min(source.width - sx, box.x1 - box.x0 + 1 + box.h)
  const sh = Math.min(source.height - sy, box.y1 - box.y0 + 1 + box.h * 0.7)
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(sw * scale))
  out.height = Math.max(1, Math.round(sh * scale))
  const context = out.getContext('2d', { willReadFrequently: true })
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return greyInPlace(out)
}

// Lines of digit-sized marks anywhere in a black-and-white picture, at any
// angle: { cx, cy, angle, length, h, digits, count }, the most like an
// 8-digit number first
export function findTextLines(bits, width, height, { minH = 7, maxH = 80, minDigits = 6, maxDigits = 11, digits: want = 8 } = {}) {
  const marks = components(bits, width, height, { maxSide: maxH * 4 })
    .map((c) => ({ ...c, size: Math.max(c.w, c.h) }))
    .filter((c) => c.size >= minH && c.size <= maxH && c.area >= c.size * c.size * 0.06 && c.area <= c.size * c.size * 0.75)
  // neighbours of a like size join one group
  const parent = marks.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const order = marks.map((_, i) => i).sort((a, b) => marks[a].cx - marks[b].cx)
  for (let a = 0; a < order.length; a++) {
    const m = marks[order[a]]
    for (let b = a + 1; b < order.length; b++) {
      const n = marks[order[b]]
      if (n.cx - m.cx > m.size * 1.6) break
      if (Math.abs(n.cy - m.cy) > m.size * 1.6) continue
      if (n.size > m.size * 1.5 || n.size < m.size / 1.5) continue
      if (Math.hypot(n.cx - m.cx, n.cy - m.cy) > Math.max(m.size, n.size) * 1.3) continue
      parent[find(order[a])] = find(order[b])
    }
  }
  const groups = new Map()
  marks.forEach((m, i) => {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(m)
  })
  const lines = []
  for (const group of groups.values()) {
    if (group.length < 3) continue
    // straight: the centres along their principal axis
    const mx = group.reduce((s, m) => s + m.cx, 0) / group.length
    const my = group.reduce((s, m) => s + m.cy, 0) / group.length
    let xx = 0, xy = 0, yy = 0
    for (const m of group) {
      xx += (m.cx - mx) ** 2
      xy += (m.cx - mx) * (m.cy - my)
      yy += (m.cy - my) ** 2
    }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
    const ux = Math.cos(angle)
    const uy = Math.sin(angle)
    let lo = Infinity, hi = -Infinity, off = 0
    for (const m of group) {
      const t = (m.cx - mx) * ux + (m.cy - my) * uy
      lo = Math.min(lo, t)
      hi = Math.max(hi, t)
      off = Math.max(off, Math.abs((m.cy - my) * ux - (m.cx - mx) * uy))
    }
    const h = group.map((m) => m.size).sort((a, b) => a - b)[group.length >> 1]
    if (off > h * 0.6) continue
    const length = hi - lo + h * 0.7
    const digits = Math.round(length / (h * 0.62))
    if (digits < minDigits || digits > maxDigits) continue
    lines.push({ cx: mx + (ux * (lo + hi)) / 2, cy: my + (uy * (lo + hi)) / 2, angle, length, h, digits, count: group.length })
  }
  return lines.sort((a, b) => Math.abs(a.digits - want) - Math.abs(b.digits - want) || b.count - a.count)
}

// A line cut out of the picture and turned level (`flip`: upside down too)
function cutLine(source, line, { scale = 1, flip = false } = {}) {
  const out = document.createElement('canvas')
  out.width = Math.round((line.length + line.h * 1.2) * scale)
  out.height = Math.round(line.h * 2 * scale)
  const context = out.getContext('2d', { willReadFrequently: true })
  context.fillStyle = '#fff'
  context.fillRect(0, 0, out.width, out.height)
  context.imageSmoothingQuality = 'high'
  context.translate(out.width / 2, out.height / 2)
  context.scale(scale, scale)
  context.rotate(-line.angle + (flip ? Math.PI : 0))
  context.translate(-line.cx, -line.cy)
  context.drawImage(source, 0, 0)
  return greyInPlace(out)
}

export function createStudentIdReader(userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions }
  const workerCount =
    options.maxWorkers || Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 2) - 1))
  let schedulerPromise = null
  let cvPromise = null
  let readyWorkers = 0
  const workers = []

  function addWorker(Tesseract, scheduler) {
    const paths = {}
    for (const key of ['workerPath', 'corePath', 'langPath']) if (options[key]) paths[key] = options[key]
    return Tesseract.createWorker('eng', 1, paths).then(async (worker) => {
      // sparse text: every word on the card, no page layout
      await worker.setParameters({ tessedit_pageseg_mode: '11' })
      scheduler.addWorker(worker)
      workers.push(worker)
      readyWorkers++
      return worker
    })
  }

  function getScheduler() {
    if (!schedulerPromise) {
      schedulerPromise = options
        .loadTesseract()
        .then((Tesseract) => {
          const scheduler = Tesseract.createScheduler()
          // the first worker caches the language data; the others reuse it
          return addWorker(Tesseract, scheduler).then(() => {
            for (let i = 1; i < workerCount; i++) addWorker(Tesseract, scheduler).catch((error) => console.warn('OCR worker failed', error))
            return scheduler
          })
        })
        .catch((error) => {
          schedulerPromise = null
          throw error
        })
    }
    return schedulerPromise
  }

  // OpenCV finds the card; without it the whole picture is read
  function getCV() {
    if (!options.opencvUrl) return Promise.resolve(null)
    if (!cvPromise) {
      cvPromise = (window.cv?.Mat ? Promise.resolve() : loadScript(options.opencvUrl))
        .then(
          () =>
            new Promise((resolve, reject) => {
              const started = Date.now()
              const poll = () => {
                const cv = window.cv
                if (cv?.Mat) return resolve(cv)
                // some builds export a thenable that resolves to the module
                if (cv && typeof cv.then === 'function' && !cv.__waiting) {
                  cv.__waiting = true
                  cv.then((module) => {
                    if (module?.Mat) {
                      try {
                        delete module.then
                      } catch {
                        // ignore
                      }
                      window.cv = module
                    }
                  })
                }
                if (Date.now() - started > 60000) return reject(new Error('OpenCV 載入逾時'))
                setTimeout(poll, 50)
              }
              poll()
            })
        )
        .catch((error) => {
          cvPromise = null
          console.warn(error)
          return null
        })
    }
    return cvPromise
  }

  function findCard(cv, canvas) {
    const scale = Math.min(1, 800 / Math.max(canvas.width, canvas.height))
    const small = document.createElement('canvas')
    small.width = Math.round(canvas.width * scale)
    small.height = Math.round(canvas.height * scale)
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height)
    const W = small.width
    const H = small.height
    const imageArea = W * H
    const mats = []
    const keep = (mat) => (mats.push(mat), mat)
    try {
      const src = keep(cv.imread(small))
      const gray = keep(new cv.Mat())
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0)
      const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)))
      let best = null
      const tried = []
      // normal; low contrast (a white card on a light desk); busy backgrounds
      for (const [low, high] of [[30, 90], [8, 30], [60, 160]]) {
        const edges = keep(new cv.Mat())
        cv.Canny(gray, edges, low, high)
        cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2)
        const edgeBits = edges.data
        // share of each side that runs along detected edges (within a few
        // pixels: fitted corners are not exact)
        const near = Math.max(3, Math.round(Math.max(W, H) / 200))
        const support = (quad) =>
          quad.map((a, k) => {
            const b = quad[(k + 1) % 4]
            const length = Math.max(1, distance(a, b))
            const nx = -(b.y - a.y) / length
            const ny = (b.x - a.x) / length
            let hit = 0
            for (let s = 1; s < 40; s++) {
              const px = a.x + ((b.x - a.x) * s) / 40
              const py = a.y + ((b.y - a.y) * s) / 40
              for (let d = -near; d <= near; d++) {
                const x = Math.round(px + nx * d)
                const y = Math.round(py + ny * d)
                if (x >= 0 && y >= 0 && x < W && y < H && edgeBits[y * W + x]) {
                  hit++
                  break
                }
              }
            }
            return hit / 39
          })
        // share of the inside that is edges: a card is mostly plain (print,
        // fingers), a fit that spills over cloth or a cluttered desk is busy
        const busyness = (quad) => {
          let hit = 0
          let total = 0
          for (let i = 1; i < 24; i++) {
            for (let j = 1; j < 24; j++) {
              const u = i / 24
              const v = j / 24
              const x = Math.round((1 - v) * ((1 - u) * quad[0].x + u * quad[1].x) + v * ((1 - u) * quad[3].x + u * quad[2].x))
              const y = Math.round((1 - v) * ((1 - u) * quad[0].y + u * quad[1].y) + v * ((1 - u) * quad[3].y + u * quad[2].y))
              total++
              if (x >= 0 && y >= 0 && x < W && y < H && edgeBits[y * W + x]) hit++
            }
          }
          return hit / total
        }
        const consider = (points, kind, coverage = 1) => {
          // corners may sit a little outside the picture when hidden by a finger
          if (points.some((p) => p.x < -0.05 * W || p.y < -0.05 * H || p.x > 1.05 * W || p.y > 1.05 * H)) return
          const quad = orderQuad(points)
          const ratio = quadRatio(quad)
          if (ratio < 1.2 || ratio > 2.2) return
          const area = polygonArea(quad)
          if (area < imageArea * 0.06 || area > imageArea * 0.97) return
          // A finger hides part of a side, but every side shows somewhere; a
          // wrong fit runs across the card or the background. One side may
          // all but vanish (a dark card edge on a dark sleeve) when the other
          // three are clear and the shape is right.
          const sides = support(quad)
          const edgeShare = sides.reduce((sum, v) => sum + v, 0) / 4
          const [weakest, second, ...rest] = sides.slice().sort((a, b) => a - b)
          const clear = weakest >= 0.2 && edgeShare >= 0.4
          const oneHidden = second >= 0.3 && (second + rest[0] + rest[1]) / 3 >= 0.6 && Math.abs(ratio - CARD_RATIO) < 0.25
          if (!clear && !oneHidden) return
          const shape = 1 - Math.min(0.9, (Math.abs(ratio - CARD_RATIO) / CARD_RATIO) * 1.5)
          const busy = busyness(quad)
          const score = area * shape * edgeShare * edgeShare * (0.6 + 0.4 * coverage) * (1 - busy) * (1 - busy)
          tried.push({ kind, score: Math.round(score), sides: sides.map((v) => Math.round(v * 100)), busy: Math.round(busy * 100), ratio: Math.round(ratio * 100) / 100, quad })
          if (!best || score > best.score) best = { score, quad, kind, edgeShare }
        }

        const contours = keep(new cv.MatVector())
        const hierarchy = keep(new cv.Mat())
        cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
        for (let i = 0; i < contours.size(); i++) {
          const contour = contours.get(i)
          if (cv.contourArea(contour) < imageArea * 0.05) {
            contour.delete()
            continue
          }
          const hull = new cv.Mat()
          cv.convexHull(contour, hull)
          const hullArea = cv.contourArea(hull)
          const approx = new cv.Mat()
          cv.approxPolyDP(hull, approx, 0.02 * cv.arcLength(hull, true), true)
          if (approx.rows === 4) {
            const points = []
            for (let k = 0; k < 4; k++) points.push({ x: approx.data32S[k * 2], y: approx.data32S[k * 2 + 1] })
            consider(points, 'corners')
          } else {
            // rounded corners: the smallest rectangle around the outline
            const rect = cv.minAreaRect(hull)
            if (hullArea / (rect.size.width * rect.size.height) > 0.85) {
              consider(cv.RotatedRect.points(rect).map((p) => ({ x: p.x, y: p.y })), 'rect')
            }
          }
          // sides fitted as lines: corners hidden under fingers come back
          const outline = new cv.Mat()
          cv.approxPolyDP(contour, outline, 0.006 * cv.arcLength(contour, true), true)
          const points = []
          for (let k = 0; k < outline.rows; k++) points.push({ x: outline.data32S[k * 2], y: outline.data32S[k * 2 + 1] })
          for (const { corners, coverage } of quadsFromOutline(points, { minSide: Math.max(W, H) * 0.03 })) {
            if (coverage >= 0.4) consider(corners, 'lines', coverage)
          }
          outline.delete()
          approx.delete()
          hull.delete()
          contour.delete()
        }
        if (best) break
      }
      const unscale = (quad) => quad.map((p) => ({ x: p.x / scale, y: p.y / scale }))
      return { quad: best ? unscale(best.quad) : null, kind: best?.kind || null, tried: tried.map((t) => ({ ...t, quad: unscale(t.quad) })) }
    } finally {
      mats.forEach((mat) => mat.delete())
    }
  }

  // the card flattened to 85.6:54, trimmed 1.5% to drop the card's rim
  function flatten(cv, canvas, quad) {
    const width = options.cardWidth
    const height = Math.round(width / CARD_RATIO)
    const m = width * 0.015
    const src = cv.imread(canvas)
    const dst = new cv.Mat()
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((p) => [p.x, p.y]))
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [-m, -m, width + m, -m, width + m, height + m, -m, height + m])
    const matrix = cv.getPerspectiveTransform(from, to)
    cv.warpPerspective(src, dst, matrix, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_REPLICATE)
    const out = document.createElement('canvas')
    cv.imshow(out, dst)
    ;[src, dst, from, to, matrix].forEach((mat) => mat.delete())
    return out
  }

  // `quick` (camera frames): fewer passes; the next frame votes instead
  async function recognize(source, { idLength = options.idLength, quick = false, onStatus = () => {} } = {}) {
    const started = performance.now()
    const timing = []
    const mark = (label) => timing.push([label, Math.round(performance.now() - started)])
    onStatus('讀取圖片')
    let image = source
    if (source instanceof Blob) {
      try {
        image = await createImageBitmap(source, { imageOrientation: 'from-image' })
      } catch {
        const url = URL.createObjectURL(source)
        image = new Image()
        image.src = url
        await image.decode()
        URL.revokeObjectURL(url)
      }
    }
    const work = toCanvas(image, options.workMax)
    onStatus('載入辨識引擎')
    const schedulerReady = getScheduler()
    const cv = await getCV()

    mark('engines')
    onStatus('尋找學生證')
    let card = null
    let found = null
    if (cv) {
      try {
        found = findCard(cv, work)
        if (found.quad) {
          const hi = toCanvas(image, options.hiResMax, 1)
          const k = hi.width / work.width
          card = flatten(cv, hi, found.quad.map((p) => ({ x: p.x * k, y: p.y * k })))
        }
      } catch (error) {
        console.warn('Card detection failed', error)
        card = null
        found = null
      }
    }
    mark('card')
    const scheduler = await schedulerReady

    const binarise = (canvas, radius = 0) => {
      const values = decolor(canvas)
      const cache = new Map()
      return (offset) => {
        if (!cache.has(offset)) cache.set(offset, binaryCanvas(threshold(values, canvas.width, canvas.height, offset, radius), canvas.width, canvas.height))
        return cache.get(offset)
      }
    }
    const read = (bitsAt, offset, turn, mode) => {
      // mostly black: background texture, not print. Tesseract takes tens of
      // seconds on such noise and finds nothing
      if (inkShare(bitsAt(offset)) > 0.3) return Promise.resolve([])
      const turned = turn ? rotate(bitsAt(offset), turn) : bitsAt(offset)
      const skew = mode === 'full' ? estimateSkew(canvasBits(turned), turned.width, turned.height) : 0
      const view = skew ? rotate(turned, -skew) : turned
      return scheduler.addJob('recognize', view).then(({ data }) => {
        mark(`ocr ${mode} ${turn}° C${offset}`)
        return pickNumbers(data, idLength, options.idPattern, options.repairId).map((c) => Object.assign(c, { view, turn, skew, mode, offset }))
      })
    }
    const readAll = async (jobs) => (await Promise.all(jobs.map((job) => read(...job)))).flat()

    const search = async (canvas, turns, mode) => {
      const bitsAt = binarise(canvas)
      const batch = Math.max(1, readyWorkers)
      const done = new Set()
      const run = (jobs) => {
        jobs.forEach(([, offset, turn]) => done.add(`${offset}@${turn}`))
        return readAll(jobs)
      }
      let pool = []
      for (let i = 0; i < turns.length; i += batch) {
        const jobs = turns.slice(i, i + batch).map((turn) => [bitsAt, 12, turn, mode])
        // upright is the most common: vote on it at once when workers are free
        if (mode === 'card' && i === 0 && readyWorkers >= jobs.length + 2) jobs.push([bitsAt, 7, 0, mode], [bitsAt, 20, 0, mode])
        onStatus('辨識中')
        pool = pool.concat(await run(jobs))
        if (pool.some((c) => c.confidence >= 40)) break
        if (quick) break
      }
      if (quick) return pool
      if (!pool.length) {
        const jobs = [7, 20].filter((offset) => !done.has(`${offset}@${turns[0]}`)).map((offset) => [bitsAt, offset, turns[0], mode])
        if (jobs.length) pool = pool.concat(await run(jobs))
      }
      const top = pool.slice().sort((a, b) => b.score - a.score)[0]
      if (top && top.confidence < 90) {
        const jobs = [7, 20].filter((offset) => !done.has(`${offset}@${top.turn}`)).map((offset) => [bitsAt, offset, top.turn, mode])
        if (jobs.length) {
          onStatus('再確認一次')
          pool = pool.concat(await run(jobs))
        }
      }
      return pool
    }

    // the corner where the number is printed, upright and (the card upside
    // down) the opposite corner turned
    let rowsSeen = 0
    const readCorner = async () => {
      const W = card.width
      const H = card.height
      const [x0, y0, x1, y1] = options.idCorner
      const cut = (cx0, cy0, cx1, cy1, turned) => {
        const canvas = document.createElement('canvas')
        canvas.width = Math.round((cx1 - cx0) * W)
        canvas.height = Math.round((cy1 - cy0) * H)
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (turned) {
          context.translate(canvas.width, canvas.height)
          context.rotate(Math.PI)
        }
        context.drawImage(card, cx0 * W, cy0 * H, (cx1 - cx0) * W, (cy1 - cy0) * H, 0, 0, canvas.width, canvas.height)
        return canvas
      }
      // the local mean over the same area as for the whole card
      const radius = Math.max(8, Math.round(Math.max(W, H) / 40))
      const jobs = []
      for (const corner of [cut(x0, y0, x1, y1, false), cut(1 - x1, 1 - y1, 1 - x0, 1 - y0, true)]) {
        const bits = binarise(corner, radius)(12)
        for (const row of findDigitRows(bits)) {
          rowsSeen++
          const grey = greyRow(corner, row.box)
          jobs.push([() => row, 12, 0, 'row'], [() => grey, 12, 0, 'row grey'])
        }
      }
      mark('rows')
      return readAll(jobs)
    }

    // rows of digits anywhere, at any angle (no card, or a card fit wrong)
    const readLines = async () => {
      const frame = toCanvas(image, 1280, 1)
      const bits = threshold(decolor(frame), frame.width, frame.height, 25, Math.round(1280 / 60))
      const lines = findTextLines(bits, frame.width, frame.height).slice(0, 8)
      if (!lines.length) return []
      const hi = toCanvas(image, options.hiResMax, 1)
      const k = hi.width / frame.width
      const jobs = []
      for (const line of lines) {
        const big = { ...line, cx: line.cx * k, cy: line.cy * k, length: line.length * k, h: line.h * k }
        const scale = Math.min(3, Math.max(1, 40 / big.h))
        for (const flip of [false, true]) {
          const view = cutLine(hi, big, { scale, flip })
          jobs.push([() => view, 0, 0, 'line'])
        }
      }
      mark('lines')
      return readAll(jobs)
    }

    let pool = []
    if (card && options.idCorner) pool = await readCorner()
    if (!pool.length && options.findLines) pool = await readLines()
    // the whole card (a photo, or no corner known); the next camera frame
    // tries again instead
    if (!pool.length && (!quick || !options.idCorner)) {
      if (card) pool = await search(card, [0, 180], 'card')
      if (!pool.some((c) => c.confidence >= 40) && (!quick || !card)) {
        pool = pool.concat(await search(work, [0, 180, 90, 270], 'full'))
      }
    }

    // the same number read more often and more confidently ranks first
    const tally = new Map()
    for (const c of pool) {
      const entry = tally.get(c.text) || { ...c, votes: 0, sum: 0 }
      entry.votes++
      entry.sum += c.confidence
      entry.size = Math.max(entry.size, c.size)
      if (c.confidence > entry.confidence) Object.assign(entry, { confidence: c.confidence, bbox: c.bbox, view: c.view, score: c.score, mode: c.mode })
      tally.set(c.text, entry)
    }
    const ranked = [...tally.values()]
      // small print (serial numbers, dates) loses to the large ID
      .map((c) => ({ ...c, rank: c.sum + c.confidence * 0.5 + c.score * 0.2 + 40 * c.size }))
      .sort((a, b) => b.rank - a.rank)
    const best = ranked[0] && (ranked[0].confidence >= 30 || ranked[0].votes >= 2) ? ranked[0] : null

    return {
      id: best ? best.text : null,
      confidence: best ? Math.round(best.confidence) : 0,
      votes: best ? best.votes : 0,
      lowConfidence: best ? best.confidence < 75 && best.votes < 2 : true,
      cardFound: !!card,
      // a row of digits in the card's corner: a student card, not a phone
      numberSeen: rowsSeen > 0,
      cardFit: found?.kind || null, // corners | rect | lines (sides fitted past fingers)
      quad: found?.quad || null, // corners in `debug.work` coordinates
      candidates: ranked.map((c) => ({ text: c.text, confidence: Math.round(c.confidence), votes: c.votes })),
      elapsedMs: Math.round(performance.now() - started),
      // processed images for debugging only: never upload them
      debug: { timing, work, card, view: best ? best.view : null, bbox: best ? best.bbox : null, quads: found?.tried || [] }
    }
  }

  return {
    // loads OCR and OpenCV ahead (first time about 15 MB, then cached)
    ready: () => Promise.all([getScheduler(), getCV()]).then(() => ({ workers: workerCount })),
    recognize,
    terminate: async () => {
      await Promise.all(workers.map((worker) => worker.terminate()))
      workers.length = 0
      readyWorkers = 0
      schedulerPromise = null
    }
  }
}
