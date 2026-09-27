// Renders an element to an A4 PDF. html2pdf renders a copy of the element
// (in its own container under <body>), and only that copy is changed: it gets
// `pdf-export` so page styles can swap the dark theme for a print palette,
// and loses whatever matches `hideSelector` (e.g. the button row). The page
// the user is looking at never changes.
export async function downloadElementAsPdf(element, filename, hideSelector) {
  const html2pdf = (await import('html2pdf.js')).default

  await html2pdf()
    .set({
      margin: [15, 12, 15, 12],
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    })
    .from(element)
    .toContainer()
    .get('container', (container) => {
      const copy = container.firstElementChild
      copy.classList.add('pdf-export')
      if (hideSelector) copy.querySelectorAll(hideSelector).forEach((node) => node.remove())
    })
    .save()
}
