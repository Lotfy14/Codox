# output-remote

This directory stores tracked agent conversion bundles that are saved to GitHub (unlike local `output/` which is gitignored).

When preparing bundles from `input-remote/`, output can be directed here:

```bash
npm run agent:prepare -- agent-conversion/input-remote --out agent-conversion/output-remote
```
