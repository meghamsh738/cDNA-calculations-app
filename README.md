# EasyLab Next — cDNA Calculator

The Next development version guides recipe selection, sample review and preparation export. It runs locally on the separate `codex/easylab-next-20261113` branch; the original cDNA app and installed Suite remain preserved.

## Workflow

1. Choose the legacy 20 µL recipe or edit and save a named custom recipe. Fixed aliquots, reaction fractions and stock/final concentrations have different scaling rules. Declare kit limits with their source; the legacy recipe makes no kit-validation claim.
2. Paste or load CSV/TSV samples: sample ID, RNA concentration in ng/µL and optional available stock volume in µL. Every non-empty row remains visible. Invalid concentrations, insufficient stock, negative water and transfers below the pipetting minimum require correction or a reasoned exclusion. The RNA target is never silently reduced.
3. Review RNA dilution transfers, individual volumes and master-mix totals, then confirm the preparation. Overage changes the batch amount only. Optional finished-cDNA dilution reports RNA-input equivalent, not measured cDNA yield.
4. Download CSV, Excel or a reopenable experiment package. Edits invalidate approval and hide stale preparation volumes. Undo and confirmed resets are available.

New experiments retain the recipe but clear sample mappings and review decisions. Named recipes and current inputs use `easylab-next:cdna:*` browser keys. Portable packages include original uploaded text, inputs, exclusions, recipe, results and revision. Browser autosave can be limited by browser storage capacity; download a package for a portable backup. There is no account, cloud service or folder-setup gate.

## Isolated development

Use Node 24 and the dedicated Python 3.11 environment under `../../runtime/python-envs/cdna`. Dependency folders must remain separate from stable checkouts. From this worktree:

```sh
npm run dev
```

Open **http://127.0.0.1:19511**. The local API uses **127.0.0.1:18511**. The launcher refuses occupied ports and unsafe path overrides. Standalone writable paths and Electron identities belong to Next. Suite integration continues to use the existing local FastAPI/static-assets architecture.

```sh
npm run build
npm run lint
../../runtime/python-envs/cdna/bin/python -m unittest discover -s modern-app/backend -p 'test_*.py'
npm run test:e2e
```

The backend is the calculation authority for both the screen and Excel export. `backend/recipes.py` is mirrored byte-for-byte in the Next Planner, with common hand-checkable tests for units, scaling, primer dose, actual transfers and overage. React contains schema/default/display logic only.

The old public API's example and volume keys remain supported. Empty input no longer silently substitutes practice data. Practice experiments are explicitly labelled fictional.

## Development status

This is phase 3 of the separate EasyLab Next line. Verification evidence and screenshots are recorded in `design-review/next-calculators-phase-3/` and the Suite `docs/BUILD_INDEX.md`. A browser build does not establish packaged macOS or Windows readiness; no installed app was replaced.

License: All Rights Reserved.
