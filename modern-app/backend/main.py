"""
cDNA Calculations API
Ported from the original Tkinter RT mix helper.
"""

from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

APP_TITLE = "cDNA Calculations API"

DEFAULT_TARGET_NG = 200.0
FINAL_VOL = 20.0
OVERAGE_PCT = 10.0
MIN_PIPET_VOL = 0.5
FIXED = {"10x buffer": 2.0, "dNTPs": 0.8, "Random primers": 2.0, "Enzyme": 1.0}
TOTAL_FIXED = sum(FIXED.values())
AVAIL_RNA_H2O = FINAL_VOL - TOTAL_FIXED  # 14.2 µl

ROOT_DIR = Path(__file__).resolve().parent.parent
EXAMPLE_PATH = ROOT_DIR / "example_data" / "samples.csv"


class Sample(BaseModel):
    sample: str
    conc: float  # ng/µl


class CalcRequest(BaseModel):
    target_ng: float = DEFAULT_TARGET_NG
    overage_pct: float = OVERAGE_PCT
    samples: List[Sample] = []
    use_example: bool = False


app = FastAPI(title=APP_TITLE)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------- Core helpers -----------------
def load_example_samples() -> List[Sample]:
    if not EXAMPLE_PATH.exists():
        raise FileNotFoundError(f"Missing example data at {EXAMPLE_PATH}")
    rows = []
    for line in EXAMPLE_PATH.read_text().strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 2 or parts[0].lower().startswith("sample"):
            continue
        rows.append(Sample(sample=parts[0], conc=float(parts[1])))
    return rows


def dilution_recipe_text(D: int, prep_total_ul: float = 10.0) -> str:
    if D <= 1:
        return "No pre-dilution needed."
    rna_ul = round(prep_total_ul / D, 3)
    h2o_ul = round(prep_total_ul - rna_ul, 3)
    return (
        f"Pre-dilute {D}× (1:{D-1}). For example, make {prep_total_ul:g} µl by mixing "
        f"{rna_ul} µl RNA + {h2o_ul} µl nuclease-free H₂O."
    )


def suggest_dilution(req_rna_vol: float, avail_vol: float = AVAIL_RNA_H2O, min_pip: float = MIN_PIPET_VOL):
    if req_rna_vol <= 0:
        return None
    candidates = [2, 3, 4, 5, 10, 20, 50]
    d_needed_min = int((min_pip / req_rna_vol) + 0.9999)
    d_needed_max = int(avail_vol // req_rna_vol)
    if d_needed_max < 1:
        return None
    for D in candidates:
        aliquot = D * req_rna_vol
        if min_pip <= aliquot <= avail_vol:
            return D, aliquot, dilution_recipe_text(D)
    D = max(1, d_needed_min)
    if D * req_rna_vol > avail_vol:
        return None
    return D, D * req_rna_vol, dilution_recipe_text(D)


def calc_rows(target_ng: float, samples: List[Sample], overage_pct: float):
    rows = []
    for idx, s in enumerate(samples):
        conc = s.conc
        req_rna_vol = (target_ng / conc) if conc > 0 else float("nan")
        feasible_by_space = req_rna_vol <= AVAIL_RNA_H2O

        rna_vol_to_add = None
        h2o = None
        achievable = max(0.0, conc * AVAIL_RNA_H2O) if conc > 0 else 0.0
        note = ""

        if feasible_by_space:
            if req_rna_vol >= MIN_PIPET_VOL:
                rna_vol_to_add = req_rna_vol
                h2o = AVAIL_RNA_H2O - rna_vol_to_add
                achievable = target_ng
            else:
                suggestion = suggest_dilution(req_rna_vol)
                if suggestion:
                    D, aliq, recipe = suggestion
                    rna_vol_to_add = aliq
                    h2o = AVAIL_RNA_H2O - rna_vol_to_add
                    achievable = target_ng
                    note = (
                        f"Required stock volume {req_rna_vol:.3f} µl < {MIN_PIPET_VOL} µl. "
                        f"{recipe} Then add {aliq:.3f} µl of the diluted RNA."
                    )
                else:
                    note = (
                        f"Required stock volume {req_rna_vol:.3f} µl is too small to pipette "
                        f"and no suitable pre-dilution fits within {AVAIL_RNA_H2O:.1f} µl."
                    )
        else:
            note = f"Conc too low: max {achievable:.1f} ng in {AVAIL_RNA_H2O:.1f} µl."

        rows.append({
            "_order": idx,
            "Sample": s.sample,
            "RNA Conc (ng/µl)": round(conc, 3),
            "RNA Volume (µl)": None if rna_vol_to_add is None else round(rna_vol_to_add, 3),
            "10x buffer": FIXED["10x buffer"],
            "dNTPs": FIXED["dNTPs"],
            "Random primers": FIXED["Random primers"],
            "Enzyme": FIXED["Enzyme"],
            "H2O (µl)": None if h2o is None else round(h2o, 3),
            "final volume (µl)": FINAL_VOL,
            "Achievable RNA (ng)": round(achievable, 1),
            "Note": note,
        })

    n_total = max(1, int(len(samples) * (1.0 + overage_pct/100.0) + 0.9999))
    mm = {
        "n_samples": len(samples),
        "n_total": n_total,
        "10x buffer": round(FIXED["10x buffer"] * n_total, 3),
        "dNTPs": round(FIXED["dNTPs"] * n_total, 3),
        "Random primers": round(FIXED["Random primers"] * n_total, 3),
        "Enzyme": round(FIXED["Enzyme"] * n_total, 3),
    }
    rows.append({
        "_order": 10**9,
        "Sample": f"MASTER MIX ({overage_pct:.0f}% overage) — {n_total} rxns",
        "RNA Conc (ng/µl)": "",
        "RNA Volume (µl)": "",
        "10x buffer": mm["10x buffer"],
        "dNTPs": mm["dNTPs"],
        "Random primers": mm["Random primers"],
        "Enzyme": mm["Enzyme"],
        "H2O (µl)": "",
        "final volume (µl)": "",
        "Achievable RNA (ng)": "",
        "Note": f"Make in one tube; covers {mm['n_samples']} samples + {overage_pct:.0f}% overage.",
    })

    return rows, mm


# ----------------- API -----------------
@app.get("/example")
async def example():
    samples = load_example_samples()
    return {"samples": [s.dict() for s in samples], "target_ng": DEFAULT_TARGET_NG, "overage_pct": OVERAGE_PCT}


@app.post("/calculate")
async def calculate(req: CalcRequest):
    samples = req.samples or []
    if req.use_example or not samples:
        samples = load_example_samples()
    if not samples:
        raise HTTPException(status_code=400, detail="No samples provided.")
    rows, mm = calc_rows(req.target_ng, samples, req.overage_pct)
    rows = sorted(rows, key=lambda r: r["_order"])
    return {"rows": rows, "master_mix": mm, "settings": {"target_ng": req.target_ng, "overage_pct": req.overage_pct}}


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.post("/export-excel")
async def export_excel(req: CalcRequest):
    """
    Export calculation to an Excel workbook (single sheet).
    """
    try:
        from openpyxl import Workbook  # imported here to keep startup light
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Excel export unavailable: {exc}")

    samples = req.samples or []
    if req.use_example or not samples:
        samples = load_example_samples()
    if not samples:
        raise HTTPException(status_code=400, detail="No samples provided.")

    rows, mm = calc_rows(req.target_ng, samples, req.overage_pct)
    rows = sorted(rows, key=lambda r: r["_order"])

    wb = Workbook()
    ws = wb.active
    ws.title = "RT Mix"

    headers = [k for k in rows[0].keys() if k != "_order"]
    ws.append(headers)
    for r in rows:
        ws.append([r.get(h, "") for h in headers])

    # Autosize-ish columns
    for col_idx, header in enumerate(headers, start=1):
        max_len = max(len(str(header)), *(len(str(r.get(header, ""))) for r in rows))
        ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = min(max_len + 2, 40)

    import io
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    from fastapi.responses import StreamingResponse

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=cdna_mix.xlsx"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8003)
