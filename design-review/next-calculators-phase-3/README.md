# cDNA Calculator — EasyLab Next phase 3

Friendly milestone: `next-calculators-phase-3-20261117` · branch `codex/easylab-next-20261113`.

## Reviewed behavior

Recipe → Samples → Review & export. Common inputs remain visible; reagent/scaling details and kit constraints expand where needed. Invalid and excluded rows remain in review, with specific reasons. Fixed aliquots stay fixed, while fractional/concentration components follow reaction volume. Actual stock, water, individual and pooled transfers are checked. RNA input is not silently reduced; finished-cDNA dilution is labelled RNA-input equivalent rather than measured yield.

Saved named recipes, local inputs, original uploaded text, revisioned portable experiments, undo and resets are available. Edits hide old calculated preparation volumes and require review again. CSV and XLSX use the reviewed result values. The legacy 20 µL recipe is explicitly unvalidated for a particular kit.

## Evidence

- `cdna-01-recipe-desktop.png`: final compact recipe view at 1440×900.
- `cdna-02-reviewed-desktop.png`: reviewed fictional preparation.
- `cdna-03-review-narrow.png`, `cdna-04-keyboard-narrow.png`: 768×900 review and keyboard focus.
- `cdna-practice.csv`, `cdna-practice.xlsx`, `cdna-practice.easylab.json`: actual checked browser downloads, with two ready and two explicitly excluded fictional samples.
- `cdna-export-check.json`: agreement of CSV/XLSX/package rows and volumes. Practice A adds4µL RNA; Practice B uses a3-fold RNA dilution and0.6µL diluted RNA. Both target200ng; the4-fold finished dilution uses20µL completed reaction plus60µL water.

All four browser regressions passed; the custom-recipe/undo test passed again after the final advanced-controls change. Independent browser QA checked31 conditions and actual exports, followed by a scoped final title/expanded-controls/keyboard/narrow check. No browser console errors or external network requests were observed. No app server or browser remains owned by that QA run.

Core calculation/export/legacy tests and the isolated runtime tests pass. Final exact test counts, source pin and preservation checks are recorded in the Suite `docs/BUILD_INDEX.md`. Build and lint pass; the only frontend-tool notice is stale baseline-browser-mapping data.

## Isolation and limits

Frontend19511 and API18511 are fixed loopback ports. The launcher verifies its own child listener and health; occupied active listeners cannot be reused. Next-only bytecode cache/profile/data paths are explicit. A macOS socket restart regression allows reuse of a closed connection's TIME_WAIT state without allowing active listeners or SO_REUSEPORT. Build-parent symlinks and inherited path/API overrides fail closed. Electron downloads are attached to the window's Next session.

Only fictional data was used. No native Electron app or installed version was launched or replaced. Packaged macOS, native Excel and Windows remain unverified. The Suite's source/artifact receipt checks remain enabled.
