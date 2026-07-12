/**
 * Hand-rolled minimal PDF generator (ASCII only, so byte offsets equal
 * string lengths). Shared by the drive scripts.
 */
export function makeTestPdf(pageTexts) {
  const objs = []
  const kids = []
  let next = 4 // 1 = catalog, 2 = pages, 3 = font
  const pageObjs = pageTexts.map(() => {
    const ids = { page: next, content: next + 1 }
    kids.push(`${next} 0 R`)
    next += 2
    return ids
  })
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageTexts.length} >>`
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  pageTexts.forEach((text, i) => {
    const { page, content } = pageObjs[i]
    objs[page] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`
    objs[content] = { stream: `BT /F1 24 Tf 72 700 Td (${text}) Tj ET` }
  })

  let out = '%PDF-1.4\n'
  const offsets = []
  for (let n = 1; n < next; n++) {
    offsets[n] = out.length
    const body = objs[n]
    out +=
      typeof body === 'string'
        ? `${n} 0 obj\n${body}\nendobj\n`
        : `${n} 0 obj\n<< /Length ${body.stream.length} >>\nstream\n${body.stream}\nendstream\nendobj\n`
  }
  const xrefStart = out.length
  out += `xref\n0 ${next}\n0000000000 65535 f \n`
  for (let n = 1; n < next; n++) {
    out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
