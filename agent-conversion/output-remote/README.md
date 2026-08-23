# output-remote

This directory stores tracked agent conversion bundles that are saved to GitHub (unlike local `output/` which is gitignored).

When preparing bundles from `input-remote/<batch>`, output can be directed here:

```bash
npm run agent:prepare -- agent-conversion/input-remote/physics-0625-paper-2 --out agent-conversion/output-remote/physics-0625-paper-2
```
