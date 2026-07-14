/**
 * The TOPIC EXTRACT prompt — transcribes a user-uploaded topics document
 * (PDF pages or a single image) into the structured topic list the editor
 * shows and the matcher consumes. Separate from the three pinned engine
 * prompts (new surface, like the solver's). Transcription only — the model
 * copies what is printed and invents nothing; deterministic code cleans
 * and caps the result.
 */
export const TOPIC_EXTRACT_PROMPT = `You are transcribing a document that lists a topic taxonomy — topics, optionally with subtopics — from the attached page images.

Return ONLY a JSON object in exactly this shape:
{"topics": [{"topic": "<topic name>", "subtopics": ["<subtopic name>", ...]}]}

Rules:
- Copy names exactly as printed, including their language and punctuation. Never invent, merge, reorder, translate, or rephrase entries.
- Nesting on the page (indentation, numbering, headings above lists) decides what is a topic and what is its subtopic. A flat list is topics with empty "subtopics" arrays.
- Ignore page furniture: titles, page numbers, headers, footers, and any text that is clearly not part of the topic list.
- If the document contains no recognizable topic list, return {"topics": []}.
- No prose, no markdown fences — raw JSON only.`
