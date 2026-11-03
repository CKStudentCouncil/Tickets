// Where a lineup photo sits inside its frame. The image always covers the
// frame (object-fit: cover); x/y pick the focal point in percent, with the
// same meaning as object-position, and zoom enlarges around that point. One
// setting therefore fits both the 4:3 desktop and the 16:10 mobile frame.
export const MIN_ZOOM = 1
export const MAX_ZOOM = 3

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const round = (value, digits) => Number(value.toFixed(digits))
const numberOr = (value, fallback) => (Number.isFinite(value) ? value : fallback)

export function normalizeCrop(crop) {
  return {
    x: round(clamp(numberOr(crop?.x, 50), 0, 100), 1),
    y: round(clamp(numberOr(crop?.y, 50), 0, 100), 1),
    zoom: round(clamp(numberOr(crop?.zoom, 1), MIN_ZOOM, MAX_ZOOM), 2)
  }
}

// CSS custom properties read by the lineup image styles
export function cropStyle(crop) {
  const { x, y, zoom } = normalizeCrop(crop)
  return { '--crop-x': `${x}%`, '--crop-y': `${y}%`, '--crop-zoom': zoom }
}

// The crop after dragging the image by (dx, dy) screen pixels from `crop`,
// in a frameW x frameH frame showing an image of imageW x imageH natural px.
// Only the part of the rendered image beyond the frame can pan, so a full
// drag across that overflow moves the focal point from one edge to the other.
export function dragCrop(crop, { dx, dy }, { frameW, frameH, imageW, imageH }) {
  const start = normalizeCrop(crop)
  if (!frameW || !frameH || !imageW || !imageH) return start

  const scale = Math.max(frameW / imageW, frameH / imageH) * start.zoom
  const overflowX = imageW * scale - frameW
  const overflowY = imageH * scale - frameH

  return normalizeCrop({
    ...start,
    // under half a pixel of overflow the axis is effectively fixed
    x: overflowX > 0.5 ? start.x - (dx / overflowX) * 100 : start.x,
    y: overflowY > 0.5 ? start.y - (dy / overflowY) * 100 : start.y
  })
}
