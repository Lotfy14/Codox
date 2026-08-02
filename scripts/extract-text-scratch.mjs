import { readFile, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
const outPath = process.argv[3];
if (!pdfPath) {
  console.error('Usage: node extract.mjs <pdf-path> [out-path]');
  process.exit(1);
}

try {
  const data = new Uint8Array(await readFile(pdfPath));
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true
  });
  const pdf = await loadingTask.promise;
  let output = `Successfully loaded PDF with ${pdf.numPages} pages.\n\n`;
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str + (item.hasEOL ? '\n' : ' '));
    output += `=== PAGE ${i} ===\n`;
    output += strings.join('').trim() + '\n\n';
  }

  if (outPath) {
    await writeFile(outPath, output, 'utf8');
    console.log(`Saved text extraction to ${outPath}`);
  } else {
    console.log(output);
  }
} catch (err) {
  console.error('Error extracting text:', err);
}
