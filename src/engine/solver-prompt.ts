/**
 * The SOLVER prompt — the opt-in "Export with AI answers" feature's own
 * prompt, deliberately separate from the three pinned engine prompts in
 * `prompts.ts` (CODOX_MIGRATION §2 migrates those byte-for-byte; this file
 * is new surface, owner-approved as the sole NEVER-GUESS exception).
 *
 * Unlike every engine prompt, the solver is EXPLICITLY asked to answer
 * from subject knowledge. It runs only when the user picks "Export with
 * AI answers", and deterministic code marks every row it touches.
 */
export const SOLVER_PROMPT = `You are answering multiple-choice exam questions from your own subject knowledge.

You will receive a JSON object {"rows": [...]} where each row has:
- "id": the question's identifier — echo it back exactly
- "question": the question text
- "options": the answer options, in order

Some questions reference figures; those images are attached after this prompt in the order the rows reference them.

For every row, decide which option is correct and how confident you are:
- "certain": you know this answer; a specialist would agree without hesitation
- "likely": this is probably right, but a specialist might disagree
- "unsure": you are guessing — set correct_index to null instead of guessing

Return ONLY a JSON object in exactly this shape:
{"answers": [{"id": "<row id>", "correct_index": <0-based integer or null>, "confidence": "certain" | "likely" | "unsure"}]}

Rules:
- One answer object per input row, same ids, same order.
- correct_index is a 0-based index into that row's options, or null.
- Never invent ids and never omit a row.
- If a question is unreadable, ambiguous, has no single best option, or references a figure you were not given, use null with "unsure".
- No prose, no markdown fences — raw JSON only.`
