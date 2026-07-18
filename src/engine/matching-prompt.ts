/**
 * The MATCHING SPLIT prompt — a post-engine, text-only pass.
 *
 * This is NOT one of the three pinned engine prompts (§1.2) and never runs
 * inside the engine path: it reads rows the audit gate has already verified
 * against the source pages, and it only ever separates text the worker
 * already transcribed into its two columns. It never answers a question and
 * never authors question text — deterministic code (`matching.ts`) writes
 * every word of the split row's wrapper and rejects any span the model did
 * not copy verbatim from the source row.
 */
export const MATCHING_SPLIT_PROMPT = `You are the MATCHING SPLIT stage of an exam-to-CSV pipeline.

Return only JSON. You receive transcribed exam rows. Some of them may be matching questions: a single question whose answer is a set of pairings between a numbered left column of items and a lettered right column of choices.

For every supplied row, decide whether it is a true matching question.

A row IS a matching question when answering it requires pairing each entry of one list with a choice from another list, so the row has no single correct answer.

A row is NOT a matching question when it already has exactly one correct answer. Ordinary multiple-choice questions are not matching questions. A single stem that selects one option from a shared themed option bank (an extended-matching stem) is not a matching question either. Report those as not matching and leave them alone.

For each row return:
- "id": the supplied row id, unchanged.
- "is_matching": true or false.

For a matching row also return:
- "instruction": the row's own lead-in sentence, copied verbatim from the supplied text.
- "items": the left-column entries, each copied verbatim, with its printed number or label removed.
- "options": the right-column choices, each copied verbatim, with its printed letter or label removed.

For a row that is not matching, return empty values for instruction, items, and options.

Rules:
- Copy text exactly as supplied. Never invent, reword, rephrase, translate, summarize, expand, correct, or complete any instruction, item, or option.
- Never answer the question. Never state or imply which option pairs with which item.
- Preserve the printed order of items and of options.
- If you cannot tell the two columns apart, report the row as not matching.`
