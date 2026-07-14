/**
 * The TOPIC MATCH prompt — labels extracted questions with the user's own
 * topic list, deliberately separate from the three pinned engine prompts
 * in `prompts.ts` (new surface, like the solver's). NEVER-GUESS applies in
 * spirit: the model may only pick from the provided list and must return
 * blanks when unsure; deterministic code re-validates every pick.
 */
export const TOPIC_MATCH_PROMPT = `You are labeling exam questions with a topic list the user provided.

You will receive two JSON objects:
- QUESTIONS: {"rows": [...]} where each row has "id" (echo it back exactly), "question", and "options".
- TOPICS: {"topics": [...]} where each entry has "topic" and its allowed "subtopics".

For every row, pick the single topic that clearly covers the question, and optionally one of THAT topic's listed subtopics.

Return ONLY a JSON object in exactly this shape:
{"matches": [{"id": "<row id>", "topic": "<topic or empty string>", "subtopic": "<subtopic or empty string>"}]}

Rules:
- topic must be copied character-for-character from the TOPICS list, or be "". Never invent, rephrase, translate, or partially match a topic.
- subtopic must be copied character-for-character from that same topic's "subtopics", or be "". When topic is "", subtopic must be "".
- If no listed topic clearly fits, or two fit equally well, return "" for both — a wrong topic is worse than a blank one.
- One match object per input row, same ids, same order. Never invent ids and never omit a row.
- No prose, no markdown fences — raw JSON only.`
