# Codox — Error language (Phase 3 pass)

_Written 2026-07-11. Every message a tutor can see, in plain English, for
owner review. The live strings ship in
[`src/copy/messages.ts`](../src/copy/messages.ts) and the running app is the
design and copy review surface._

**Owner: read each line once. If any message sounds confusing, say which.**

## The rules every message follows

1. **Bad key ≠ can't reach ≠ quota used up.** Three different situations,
   three different messages, three different colors. Never just "failed".
2. **Quota is calm.** Running out of the free daily allowance is normal and
   expected — it reads as "paused / resting", amber, never red, never "error".
3. **Order inside a message:** what happened → is my work safe → what should
   I do (often: nothing).
4. **Codox never guesses**, and the words say so wherever it matters.

## Keys (checking a pasted key)

| Situation | Exact words | Why phrased this way |
|---|---|---|
| Empty field | Paste a key first. | Shortest possible nudge. |
| Checking | Checking your key… | Present tense, something is happening. |
| Key works | Key works. You are ready to convert. | Confirms and points forward. |
| Wrong key | Gemini rejected this key. Check that you copied the whole key, or make a new one on Google's API key page. | Names the only provider and gives the two realistic fixes. |
| Can't reach | Can't reach Gemini right now. This is not about your key — Gemini may be down or blocked on this network. Your progress is saved; Codox will try again when the connection returns. | Explicitly separates reachability from a wrong key without promising another provider. |
| Quota used up | Your Gemini key has used its available free allowance. Nothing is broken — your progress is saved, and the run resumes when Gemini allows requests again. | Explains that this user's own quota is paused and avoids implying pooled capacity. |
| Status chip words | Working · Wrong key · Can't reach · Resting until quota returns · Checking · Not checked | Chip-length versions of the same distinctions (built into the design system). |
| Key ownership note | Codox uses only your Gemini key. Requests count against your Gemini quota and never another user's. | States the quota-isolation guarantee directly. |

## Progress (during a run)

| Situation | Exact words | Why phrased this way |
|---|---|---|
| Quota pause | Paused — resumes when quota allows. Your progress is saved; there is nothing you need to do. | The owner-approved calm-pause line, plus the two reassurances. |
| Offline | No internet connection. The run picks up exactly where it left off when you are back online. | "Picks up where it left off" kills the fear of restarting. |
| Gemini unreachable | Gemini is unavailable right now. Your progress is saved, and the run resumes when Gemini is reachable again. | There is no fallback provider; the truthful state is a safe pause. |
| Gemini quota pause | Your Gemini allowance is resting. The run resumes when Gemini allows requests again — you can close Codox and come back later. | Permission to walk away without implying another key or provider will be used. |
| One bad page | Page 7 of bio_exam.pdf could not be read reliably. It is flagged for your review — the rest of the run continues. | One bad page never kills a job; says so. |
| Wrong declaration | The answers in maths_mock.pdf do not match what you declared. To be safe, every question from this file is flagged for your review — Codox never guesses. | The degrade-to-all-flagged path, framed as safety, not failure. |
| Finished, flags | Done. 4 answers need your eyes — everything else is ready. | "Need your eyes" instead of "errors" — these are not mistakes. |
| Finished, clean | Done. Every answer was read cleanly. | |

## Upload

| Situation | Exact words | Why phrased this way |
|---|---|---|
| Non-PDF dropped | Only PDF files work here — "notes.docx" was skipped. | Names the file, no blame. |
| Password-protected PDF | "chemistry_final.pdf" is password-protected, so Codox cannot open it. Remove the password and drop it again. | The one fixable-by-user PDF failure; says the fix. |
| The declaration question | Where are the answers? | The single routing question, as approved. |
| Declaration help | This tells Codox how to read each PDF. If a file is different, change it on that row. | |
| Key file needed | You said the answers are in a separate file — drop that answer key below before starting. | Explains why the second drop zone appeared. |

## Review

| Situation | Exact words | Why phrased this way |
|---|---|---|
| Flag reason: blank | No answer found — Codox never guesses, so this one is yours. | Turns NEVER-GUESS into a human sentence. |
| Flag reason: conflict | Two answers appear marked. Pick the right one from the page. | |
| Flag reason: length | The options list looks incomplete. Check it against the page. | |
| Flag reason: low confidence | The scan is hard to read here. Confirm what the page says. | |
| Export with flags left | 3 answers still need your eyes. You can export as-is — unresolved rows stay blank and marked for review. They are never guessed. | Flags never gate export; blank ≠ wrong. |
| Offline during review | You are offline. Reviewing works fully offline — export whenever you finish. | Offline review is a feature; sound like one. |
| All resolved | All flags resolved. Your answers are in — export the bundle. | Hands straight to export (export-early). |

## Export & History

| Situation | Exact words | Why phrased this way |
|---|---|---|
| Unexported badge | Not exported yet | The quiet badge — the only eviction "nag" allowed. |
| Export done | Saved. The bundle now lives safely outside Codox — import it into Triviadox whenever you like. | Confirms safety, points to the next real step. |
| Why export matters (Help) | Codox stores work in the browser, which the system can clear to free space. An exported bundle is the copy nothing can take away. | The honest one-paragraph version of the eviction risk, kept in Help, not shoved at the user. |
| Re-run unavailable | Re-running needs the original PDF, which was not kept for this run. Drop the PDF on Convert to run it again. | Explains the "keep original PDF" toggle's consequence with the workaround. |
| Delete confirm | Delete bio_exam? / This removes the run and its stored files from this device. Bundles you already exported are not affected. | Says exactly what is and is not lost. |

## First run

| Situation | Exact words | Why phrased this way |
|---|---|---|
| Welcome | Codox turns exam PDFs into ready-to-import Triviadox question sets. It runs on this device — you bring your own Gemini API key. | The product in two sentences, with the only supported provider named. |
| Gemini key | Codox uses only this Gemini key. Every request counts against your own Gemini quota, never another user's. | States the quota-isolation rule directly; there is no add-provider promise. |
| Privacy notice | Exam pages go straight from this device to Gemini, under your key. Your key never leaves this device. | The owner-approved one-line minimal notice, naming the only provider. |
