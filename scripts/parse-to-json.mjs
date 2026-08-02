import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Mark scheme answers (1-based, letters A-D)
const answers1 = [
  "B", "B", "B", "D", "D", "A", "B", "A", "C", "C",
  "A", "B", "B", "C", "B", "A", "D", "D", "D", "D",
  "A", "C", "D", "C", "A", "B", "D", "A", "A", "A",
  "C", "A", "D", "A", "D", "D", "C", "C", "B", "A"
];

const answers2 = [
  "B", "B", "B", "D", "B", "A", "B", "A", "C", "C",
  "C", "B", "B", "C", "B", "A", "D", "D", "A", "D",
  "C", "C", "C", "B", "C", "B", "A", "A", "C", "B",
  "B", "D", "D", "B", "A", "B", "C", "B", "C", "A"
];

function cleanText(text) {
  return text.replace(/[ \t]+/g, ' ').trim();
}

async function processExam(examSlug, answers) {
  const examDir = path.resolve(`agent-conversion/output/2020 Feb-March/${examSlug}`);
  const textFilePath = path.join(examDir, 'extracted_text.txt');
  const examJsonPath = path.join(examDir, 'exam.json');

  const textContent = await readFile(textFilePath, 'utf8');
  const manifest = JSON.parse(await readFile(examJsonPath, 'utf8'));

  const lines = textContent.split('\n');
  let currentPage = 1;
  const questions = [];
  let currentQuestion = null;
  let nextExpectedQ = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Detect page boundary
    const pageMatch = line.match(/^===\s+PAGE\s+(\d+)\s+===$/i);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1], 10);
      continue;
    }

    // Ignore headers, footers and page numbers
    if (line.startsWith('© UCLES 2020') || line.includes('0610/12') || line.includes('0610/22') || line.includes('[Turn over')) {
      continue;
    }
    if (/^\d+$/.test(line) && (parseInt(line, 10) === currentPage)) {
      continue;
    }

    // Detect question start: e.g., "1 Which characteristic..."
    const qMatch = line.match(/^(\d+)\s+(.+)$/);
    if (qMatch) {
      const qNum = parseInt(qMatch[1], 10);
      if (qNum === nextExpectedQ) {
        if (currentQuestion) {
          questions.push(currentQuestion);
        }
        currentQuestion = {
          id: `q${String(qNum).padStart(3, '0')}`,
          question: cleanText(qMatch[2]),
          options: [],
          answer: {
            source: 'extracted',
            index: null,
            evidence: ''
          },
          figures: [],
          topic: '',
          subtopic: '',
          year: '2020',
          page: currentPage
        };
        nextExpectedQ++;
        continue;
      }
    }

    // Detect options: e.g., "A breathing" or "B excretion"
    if (currentQuestion) {
      // Inline options check, e.g. "A 1, 2 and 3 B 1 and 3 only C 2, 3 and 4 D 2 and 4 only"
      const inlineOptionsMatch = line.match(/^A\s+(.+?)\s+B\s+(.+?)\s+C\s+(.+?)\s+D\s+(.+)$/);
      if (inlineOptionsMatch) {
        currentQuestion.options = [
          cleanText(inlineOptionsMatch[1]),
          cleanText(inlineOptionsMatch[2]),
          cleanText(inlineOptionsMatch[3]),
          cleanText(inlineOptionsMatch[4])
        ];
        continue;
      }

      const optMatch = line.match(/^([A-D])\s+(.+)$/);
      if (optMatch) {
        const optLetter = optMatch[1];
        const optText = cleanText(optMatch[2]);
        currentQuestion.options.push(optText);
        continue;
      }

      // If it doesn't match question or option start, append to the question body
      if (currentQuestion.options.length === 0) {
        currentQuestion.question += '\n' + cleanText(line);
      } else {
        // Append to the last option
        currentQuestion.options[currentQuestion.options.length - 1] += ' ' + cleanText(line);
      }
    }
  }

  if (currentQuestion) {
    questions.push(currentQuestion);
  }

  // Map answers to index and evidence
  for (const q of questions) {
    const qNum = parseInt(q.id.replace('q', ''), 10);
    const ansLetter = answers[qNum - 1];
    const letterToIdx = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
    q.answer.index = letterToIdx[ansLetter];

    const keyPage = qNum <= 28 ? 18 : 19;
    q.answer.evidence = `key page ${keyPage} row ${qNum}`;
  }

  manifest.questions = questions;
  await writeFile(examJsonPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Processed ${questions.length} questions for ${examSlug}`);
}

async function run() {
  await processExam('0610-m20-qp-12', answers1);
  await processExam('0610-m20-qp-22', answers2);
}

run().catch(console.error);
