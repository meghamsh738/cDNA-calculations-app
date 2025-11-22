# cDNA Calculations (React + FastAPI)

Modern web UI for the RT mix helper. Paste sample concentrations, set a target ng, and get per-sample RNA/H₂O volumes, predilution suggestions, and master-mix totals. The bundled example dataset plus Playwright E2E generate a screenshot.

## Project structure
- `src/` – React UI (Vite + TypeScript + Tailwind).
- `backend/` – FastAPI API with the calculation logic.
- `example_data/samples.csv` – Bundled example concentrations.
- `tests/` – Playwright E2E covering the example flow.
- `screenshots/example_run.png` – Saved by the E2E.

## Prerequisites
- Node 18+ and npm
- Python 3.10+

## Setup
```bash
npm install
pip install -r backend/requirements.txt
```

## Run (dev)
```bash
# API on :8003
npm run dev:back
# Frontend on :5176
npm run dev:front
```
Open http://localhost:5176, toggle **Use Example Data**, and click **Calculate Volumes**.

## Tests & screenshot
```bash
npx playwright install --with-deps chromium
npm run test:e2e
```
This starts both servers, drives the example flow, and writes `screenshots/example_run.png`.

## API
- `POST /calculate` – Body: samples[], target_ng, overage_pct, use_example?; returns rows + master mix.
- `GET /example` – Returns the bundled sample set and defaults.

All endpoints honor `use_example: true` so you can run without providing data.
