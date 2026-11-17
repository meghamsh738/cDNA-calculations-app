"""Local cDNA Next API: one calculation engine for review and exports."""

import csv
import io
import json
from pathlib import Path
from typing import Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

try:
    from .recipes import legacy_cdna_recipe, validate_recipe
    from .cdna_logic import calculate_cdna, export_rows, parse_samples
except ImportError:
    from recipes import legacy_cdna_recipe, validate_recipe
    from cdna_logic import calculate_cdna, export_rows, parse_samples

APP_TITLE = "cDNA Calculator Next"
DEFAULT_TARGET_NG = 200.0
OVERAGE_PCT = 10.0
EXAMPLE_PATH = Path(__file__).resolve().parent.parent / "example_data" / "samples.csv"


class Sample(BaseModel):
    sample: str
    conc: float | str
    available_ul: float | str | None = None


class CalcRequest(BaseModel):
    recipe: dict[str, Any] | None = None
    raw_text: str | None = Field(default=None, max_length=2_000_000)
    exclusions: dict[str, str] = Field(default_factory=dict)
    finished_dilution_factor: float = 1.0
    target_ng: float = DEFAULT_TARGET_NG
    overage_pct: float = OVERAGE_PCT
    samples: list[Sample] = Field(default_factory=list)
    use_example: bool = False


app = FastAPI(title=APP_TITLE)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:19511", "http://127.0.0.1:18578", "null"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def load_example_samples():
    with EXAMPLE_PATH.open(newline="", encoding="utf-8-sig") as source:
        return [
            Sample(sample=row["Sample"], conc=float(row["Conc"]))
            for row in csv.DictReader(source)
        ]


def resolve(req):
    recipe = req.recipe if req.recipe is not None else legacy_cdna_recipe()
    if req.recipe is None:
        recipe["sample_input"]["value"], recipe["overage_pct"] = (
            req.target_ng,
            req.overage_pct,
        )
    if validate_recipe(recipe):
        raise HTTPException(status_code=400, detail=validate_recipe(recipe))
    if req.use_example:
        text = EXAMPLE_PATH.read_text()
    elif req.raw_text is not None:
        text = req.raw_text
    else:
        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter="\t")
        writer.writerow(["Sample", "Concentration", "Available"])
        for sample in req.samples:
            writer.writerow(
                [
                    sample.sample,
                    sample.conc,
                    sample.available_ul if sample.available_ul is not None else "",
                ]
            )
        text = buffer.getvalue()
    try:
        result = calculate_cdna(
            recipe, parse_samples(text), req.exclusions, req.finished_dilution_factor
        )
    except (ValueError, TypeError, OverflowError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    result["source_text"] = text
    # Retain the old API's volume keys for clients and the existing regression.
    for row in result["rows"]:
        row.update(
            {
                "Sample": row["sample"],
                "RNA Volume (µl)": row["rna_ul"] if row["feasible"] else None,
                "H2O (µl)": row["water_ul"] if row["feasible"] else None,
                "final volume (µl)": row["total_ul"],
            }
        )
    return result


@app.get("/health")
async def health_check():
    return {"status": "ok", "app": "cdna-next", "engine": "next-cdna-1"}


@app.get("/recipes")
async def recipes():
    return {"recipes": [legacy_cdna_recipe()]}


@app.get("/example")
async def example():
    return {
        "samples": [s.model_dump() for s in load_example_samples()],
        "target_ng": DEFAULT_TARGET_NG,
        "overage_pct": OVERAGE_PCT,
    }


@app.post("/calculate")
async def calculate(req: CalcRequest):
    return resolve(req)


@app.post("/export-excel")
async def export_excel(req: CalcRequest):
    from openpyxl import Workbook

    result = resolve(req)
    if not result["ready"]:
        raise HTTPException(
            status_code=400,
            detail="Resolve all feasibility problems or explicitly exclude affected samples before exporting.",
        )
    wb = Workbook()
    wb.remove(wb.active)
    tables = {
        "RT Mix": export_rows(result),
        "Master mix": result["master_mix"]["components"],
        "Recipe": [
            {"Setting": key, "Value": json.dumps(value, ensure_ascii=False)}
            for key, value in result["recipe"].items()
        ],
        "Original input": [
            {"Row": i + 1, "Text": line}
            for i, line in enumerate(result["source_text"].splitlines())
        ],
    }
    for name, rows in tables.items():
        ws = wb.create_sheet(name)
        if rows:
            headers = list(rows[0])
            ws.append(headers)
            for row in rows:
                ws.append([row.get(h) for h in headers])
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions
            for cells in ws.columns:
                ws.column_dimensions[cells[0].column_letter].width = min(
                    45, max(14, max(len(str(c.value or "")) for c in cells) + 2)
                )
            for row in ws:
                for cell in row:
                    if cell.data_type == "f":
                        cell.data_type = "s"
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=cdna-next.xlsx"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=18511)
