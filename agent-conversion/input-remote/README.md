# input-remote

This directory stores tracked exam batches that are committed to GitHub (unlike local `input/` which is gitignored).

## Folders

### `physics-0625-paper-2/`
Organized by year and variant:
- **`2020/`** to **`2025/`**
  - **`feb-march-22/`** — Question paper (`qp`) and mark scheme (`ms`) for February/March series (variant 22)
  - **`may-june-21/`** — Question paper (`qp`) and mark scheme (`ms`) for May/June series (variant 21)
  - **`may-june-22/`** — Question paper (`qp`) and mark scheme (`ms`) for May/June series (variant 22)
  - **`may-june-23/`** — Question paper (`qp`) and mark scheme (`ms`) for May/June series (variant 23)
  - **`oct-nov-21/`** — Question paper (`qp`) and mark scheme (`ms`) for October/November series (variant 21)
  - **`oct-nov-22/`** — Question paper (`qp`) and mark scheme (`ms`) for October/November series (variant 22)
  - **`oct-nov-23/`** — Question paper (`qp`) and mark scheme (`ms`) for October/November series (variant 23)

## Usage

Prepare a specific year or variant, or the entire batch into `output-remote`:

```bash
# Entire batch
npm run agent:prepare -- agent-conversion/input-remote/physics-0625-paper-2 --out agent-conversion/output-remote/physics-0625-paper-2

# Single year
npm run agent:prepare -- agent-conversion/input-remote/physics-0625-paper-2/2024 --out agent-conversion/output-remote/physics-0625-paper-2/2024

# Single variant
npm run agent:prepare -- agent-conversion/input-remote/physics-0625-paper-2/2024/may-june-21 --out agent-conversion/output-remote/physics-0625-paper-2/2024/may-june-21
```
