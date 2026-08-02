/**
 * Generates a tiny, deterministic Pyrite benchmark PDF from three questions
 * visually verified on page 1 of `sample/EMLE 1st Real Exam Dec-03-2025.pdf`.
 *
 * The source page visibly marks A, B, and E in green. Keeping this fixture as
 * code instead of a binary lets Git review the evidence and lets any machine
 * regenerate the exact PDF used by the browser test or a live Pyrite run.
 *
 * Usage: node scripts/create-pyrite-fixture.mjs [output.pdf]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const output = path.resolve(process.argv[2] ?? 'C:/tmp/pyrite-emle-page-1.pdf')

const lines = [
  'Pyrite visual benchmark - EMLE page 1',
  '',
  '1. A 52-year-old woman has a benign duodenal ulcer. What is the most appropriate next step?',
  'A. 6-8 weeks of Omeprazole or Ranitidine  [MARKED CORRECT]',
  'B. Amoxicillin',
  'C. Doxycycline',
  'D. Azithromycin',
  'E. Levofloxacin',
  '',
  '2. A 2-year-old boy has barking cough, inspiratory stridor, and low-grade fever. What is the initial treatment?',
  'A. Intravenous ceftriaxone',
  'B. A single dose of oral or intramuscular dexamethasone  [MARKED CORRECT]',
  'C. Nebulized salbutamol',
  'D. Immediate endotracheal intubation',
  'E. Humidified oxygen via a face mask',
  '',
  '3. A cyanotic child squats during play and has clubbing. What congenital heart defect is most likely?',
  'A. Ventricular Septal Defect',
  'B. Atrial Septal Defect',
  'C. Patent Ductus Arteriosus',
  'D. Coarctation of the Aorta',
  'E. Tetralogy of Fallot  [MARKED CORRECT]',
]

function escapePdf(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

const stream = [
  'BT',
  '/F1 10 Tf',
  '42 760 Td',
  ...lines.flatMap((line, index) => [
    index === 0 ? `(${escapePdf(line)}) Tj` : `0 -22 Td (${escapePdf(line)}) Tj`,
  ]),
  'ET',
].join('\n')

const objects = [
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
  '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
]
let pdf = '%PDF-1.4\n%Pyrite\n'
const offsets = [0]
for (const object of objects) {
  offsets.push(Buffer.byteLength(pdf))
  pdf += object
}
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, pdf)
console.log(`wrote ${output}`)
