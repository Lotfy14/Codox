import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function verify(slug) {
  const file = path.resolve(`agent-conversion/output/2020 Feb-March/${slug}/exam.json`);
  const data = JSON.parse(await readFile(file, 'utf8'));
  console.log(`\n=== ${slug} ===`);
  console.log(`Total questions parsed: ${data.questions.length}`);
  console.log('Question IDs:', data.questions.map(q => q.id).join(', '));
  console.log('First 5 questions:');
  for (let i = 0; i < Math.min(5, data.questions.length); i++) {
    const q = data.questions[i];
    console.log(`- ${q.id} (page ${q.page}): ${q.question.replace(/\n/g, ' ').substring(0, 100)}...`);
    console.log(`  Options: ${JSON.stringify(q.options)}`);
  }
}

verify('0610-m20-qp-12');
verify('0610-m20-qp-22');
