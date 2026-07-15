# Codox Handoff Plan: Case Stems & Question Labels Cleanups

This document serves as the handoff plan for the next agent to address outstanding formatting and coordinate mismatch issues in the Codox conversion engine.

---

## 1. Stripping Question Numbers from Case-Stem Questions

### The Bug
Currently, Codox has a normalization helper [stripLeadingQuestionLabel](file:///c:/Users/anzhe/Documents/GitHub/Codox/src/engine/normalize.ts#L42) which uses the regex `LEADING_QUESTION_LABEL = /^\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[.):\-–—]\s+/i` to strip prefixes (e.g. `"17- "`) from transcribed questions.

However, for case-stem questions, the text is assembled by the worker as:
`"Case stem: 16- A 45-year-old...\nQuestion: 17- Completing..."`

Because this assembled string begins with `"Case stem:"` instead of a digit prefix, `stripLeadingQuestionLabel` fails to match the start of the string, leaving **both** the case stem number (`"16-"`) and the individual question number (`"17-"`) in the final CSV.

### The Fix
Update `stripLeadingQuestionLabel` in [src/engine/normalize.ts](file:///c:/Users/anzhe/Documents/GitHub/Codox/src/engine/normalize.ts#L42) to split and clean both parts if a case stem header is present:

```typescript
export function stripLeadingQuestionLabel(question: string): string {
  if (question.startsWith('Case stem: ')) {
    const parts = question.split('\nQuestion: ')
    if (parts.length === 2) {
      const caseStem = parts[0].slice('Case stem: '.length)
      const questionPrompt = parts[1]
      const cleanCaseStem = caseStem.replace(LEADING_QUESTION_LABEL, '').trim()
      const cleanQuestionPrompt = questionPrompt.replace(LEADING_QUESTION_LABEL, '').trim()
      return `Case stem: ${cleanCaseStem}\nQuestion: ${cleanQuestionPrompt}`
    }
  }
  const stripped = question.replace(LEADING_QUESTION_LABEL, '')
  return stripped.trim() === '' ? question : stripped
}
```

---

## 2. Dynamic Crop Boxes for Case-Stem Questions

### The Behavior
For case-stem questions (e.g. Question 5), the visual crop area shows both Question 4 and Question 5. 

* **Why**: The bounding box in the review screen is calculated as the **union** of the `case_stem` region and the `question_prompt` region. Since the case stem is physically printed above the question, the union box naturally spans the entire height from the case stem down to the options of Question 5.
* **Handoff Action**: This behavior is correct and necessary because tutors must see the case stem to resolve review flags. Keep this union cropping in place.

---

## 3. Investigating Box-to-Anchor Page Mismatches

### The Bug (Image 5 - Question 53 / Page 15)
In some minority cases (like Question 53, `"21- This tool is"`), the visual crop points to the wrong coordinates (showing Question 20 instead of Question 21).

* **Why**: Page 15 physically ends at Question 20. Question 21 is physically printed at the top of Page 16. However, the `INDEX` pass mis-assigned Question 21 to Page 15 (perhaps due to page boundary overlap or case stem reference cues). The `BOX` model was then forced to draw a box for Question 21 on Page 15. Since the text was not there, the model hallucinated and drew the box on top of Question 20's options.
* **Handoff Action**: 
  1. Inspect [output/Family Medicine Previous Exams( 2022 & 2023 ) Cx/debug/pages/page-15.jpg](file:///c:/Users/anzhe/Documents/GitHub/Codox/output/Family%20Medicine%20Previous%20Exams(%202022%20&%202023%20)%20Cx/debug/pages/page-15.jpg) and [page-16.jpg](file:///c:/Users/anzhe/Documents/GitHub/Codox/output/Family%20Medicine%20Previous%20Exams(%202022%20&%202023%20)%20Cx/debug/pages/page-16.jpg) to verify where Question 21 begins.
  2. Refine the window boundary stitching or add a validation step in the BOX stage to discard coordinate boxes if the OCR text inside the returned coordinates does not align with the question anchor.

---

## Next Steps for the Next Agent
1. Apply the split-and-strip fix to `stripLeadingQuestionLabel` in [src/engine/normalize.ts](file:///c:/Users/anzhe/Documents/GitHub/Codox/src/engine/normalize.ts#L42).
2. Run `npm test` to verify no regressions.
3. Perform a full E2E run on the PDF:
   ```bash
   node scripts/cli-convert.mjs "input/Family Medicine Previous Exams( 2022 & 2023 ).pdf" --key <key> -o output
   ```
4. Verify that question numbers like `16-` and `17-` are successfully removed from the resulting CSV file.
