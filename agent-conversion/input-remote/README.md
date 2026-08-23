# input-remote

This directory stores tracked exam documents (such as Cambridge IGCSE Physics 0625 Paper 2 past papers and mark schemes from 2020 to 2025) that are committed to GitHub (unlike local `input/` which is gitignored).

## Contents

- Cambridge IGCSE Physics (0625) Paper 2 Multiple Choice (Extended) Question Papers (`qp`) and Mark Schemes (`ms`) for 2020 through 2025 across all series:
  - February / March (`m`)
  - May / June (`s`)
  - October / November (`w`)
  - Variants: `21`, `22`, `23`

## Usage

Prepare bundles into `output-remote`:

```bash
npm run agent:prepare -- agent-conversion/input-remote --out agent-conversion/output-remote
```
