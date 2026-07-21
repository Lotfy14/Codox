/**
 * The TOPIC EXTRACT prompt — transcribes a user-uploaded topics document
 * (PDF pages or a single image) into the structured topic list the editor
 * shows and the matcher consumes. Separate from the three pinned engine
 * prompts (new surface, like the solver's). Transcription only — the model
 * copies what is printed and invents nothing; deterministic code cleans
 * and caps the result.
 */
export const TOPIC_EXTRACT_PROMPT = `You are reading a document that lists subjects to study from the attached page images. Extract them into topics and subtopics.

Return ONLY a JSON object in exactly this shape:
{"topics": [{"topic": "<topic name>", "subtopics": ["<subtopic name>", ...]}]}

Rules:
- Copy names exactly as printed, including their language and punctuation. Never invent, merge, reorder, translate, or rephrase entries.
- Organize what you find into topics and their subtopics using your own judgment. A subject with no items under it is a topic with an empty "subtopics" array. Do not force structure that is not there, and do not flatten structure that is.
- Ignore page furniture: titles, page numbers, headers, footers, and any text that is clearly not part of the topic list.
- Ignore count badges and tallies attached to a name: a trailing number or bracketed count that reports how many items fall under a topic (e.g. "Cardiology 167", "Chest (138)") is NOT part of the name — copy only the name ("Cardiology", "Chest"). Keep numbers that are genuinely part of the name (e.g. "Trisomy 21", "Cranial nerve III").
- If the document contains no recognizable topic list, return {"topics": []}.
- No prose, no markdown fences — raw JSON only.`
