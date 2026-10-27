const options = (filename) => ({
  margin: [15, 12, 15, 12],
  filename,
  image: { type: 'jpeg', quality: 0.98 },
  html2canvas: { scale: 2, useCORS: true },
  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
})

// html2pdf's copy gets `pdf-export` so page styles can swap the dark theme
// for a print palette, and loses whatever matches `hideSelector`
const preparer = (hideSelector) => (container) => {
  const copy = container.firstElementChild
  copy.classList.add('pdf-export')
  if (hideSelector) copy.querySelectorAll(hideSelector).forEach((node) => node.remove())
}

// Renders an element to an A4 PDF. html2pdf renders a copy of the element
// (in its own container under <body>), and only that copy is changed (see
// `preparer`, e.g. to drop the button row). The page the user is looking at
// never changes.
export async function downloadElementAsPdf(element, filename, hideSelector) {
  const html2pdf = (await import('html2pdf.js')).default

  await html2pdf()
    .set(options(filename))
    .from(element)
    .toContainer()
    .get('container', preparer(hideSelector))
    .save()
}

// Like downloadElementAsPdf for a report too long for one canvas: html2pdf
// draws the whole element into a single html2canvas canvas, which browsers
// leave blank past a size limit (about 32,767px high in Chromium, less on
// iOS). `show(i)` makes the element show part i of `count` (and resolves
// once it is drawn); each part is rendered on its own and starts a new page.
export async function downloadElementPartsAsPdf(element, filename, count, show, hideSelector) {
  const html2pdf = (await import('html2pdf.js')).default

  let worker = html2pdf().set(options(filename))
  for (let part = 0; part < count; part++) {
    await show(part)
    if (part) worker = worker.get('pdf').then((pdf) => pdf.addPage())
    worker = worker.from(element).toContainer().get('container', preparer(hideSelector)).toCanvas().toPdf()
    // copied and drawn before the element moves on to the next part
    await worker
  }
  await worker.save()
}
