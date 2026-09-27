// Renders an element to an A4 PDF, hiding `hideSelector` (e.g. the button
// row) while it is captured. The element carries `pdf-export` during capture
// so page styles can swap the dark theme for a print-friendly palette.
export async function downloadElementAsPdf(element, filename, hideSelector) {
  const hidden = hideSelector ? element.querySelector(hideSelector) : null

  try {
    const html2pdf = (await import('html2pdf.js')).default

    if (hidden) hidden.style.visibility = 'hidden'
    element.classList.add('pdf-export')

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
      .save()
  } finally {
    element.classList.remove('pdf-export')
    if (hidden) hidden.style.visibility = ''
  }
}
