"""cDNA preparation plans; all unparsed observations remain in the result."""

import csv
import io
import math
from collections import Counter

try:
    from .recipes import (
        evaluate_recipe,
        legacy_cdna_recipe,
        master_mix,
        number,
        plan_dilution,
        validate_recipe,
    )
except ImportError:
    from recipes import (
        evaluate_recipe,
        legacy_cdna_recipe,
        master_mix,
        number,
        plan_dilution,
        validate_recipe,
    )


def parse_samples(text):
    if len(text) > 2_000_000:
        raise ValueError("Use a sample table smaller than 2 MB.")
    delimiter = (
        "\t" if "\t" in text else "," if "," in text else ";" if ";" in text else None
    )
    rows = (
        list(csv.reader(io.StringIO(text), delimiter=delimiter))
        if delimiter
        else [line.split() for line in text.splitlines()]
    )
    rows = [row for row in rows if row and any(cell.strip() for cell in row)]
    if not rows:
        return []
    header = [cell.strip().casefold() for cell in rows[0]]
    has_header = (
        header[0] in ("sample", "sample id", "sampleid", "id")
        and len(header) > 1
        and ("conc" in header[1])
    )
    data = rows[1:] if has_header else rows
    expected = len(header) if has_header else None
    output = []
    for index, cells in enumerate(data):
        issues = []
        if not 2 <= len(cells) <= 3 or (
            expected is not None and len(cells) != expected
        ):
            issues.append(
                "Row columns do not match the sample table; check missing or extra separators."
            )
        output.append(
            {
                "id": str(index + 1),
                "source_row": index + (2 if has_header else 1),
                "sample": cells[0].strip(),
                "conc_text": cells[1].strip() if len(cells) > 1 else "",
                "available_text": cells[2].strip() if len(cells) > 2 else "",
                "original": cells,
                "issues": issues,
            }
        )
    return output


def calculate_cdna(recipe, inputs, exclusions=None, finished_dilution_factor=1):
    exclusions = exclusions or {}
    problems = validate_recipe(recipe)
    if (
        not isinstance(recipe.get("sample_input"), dict)
        or recipe["sample_input"].get("mode") != "mass"
    ):
        problems.append("cDNA preparation requires an RNA input mass in ng.")
    finished = number(finished_dilution_factor)
    if finished is None or finished < 1:
        problems.append("Finished-cDNA dilution factor must be at least 1.")
    if not inputs:
        problems.append(
            "Add samples; practice data are loaded only by the practice button."
        )
    unknown = set(exclusions) - {row["id"] for row in inputs}
    if unknown:
        problems.append(
            "An exclusion refers to a missing sample row; review exclusions again."
        )
    counts = Counter(row["sample"].casefold() for row in inputs if row["sample"])
    base = evaluate_recipe(recipe, 0) if not problems else None
    if base and base["issues"]:
        problems.extend(base["issues"])
    target = number(recipe.get("sample_input", {}).get("value"))
    minimum = number(recipe.get("min_pipette_ul"))
    max_input = number(recipe.get("constraints", {}).get("max_input_ng"))
    if max_input and target and target > max_input:
        problems.append(
            "RNA target exceeds the declared kit input limit; choose an allowed target explicitly."
        )
    rows = []
    for source in inputs:
        issues = list(source.get("issues", []))
        conc = number(source["conc_text"])
        available = (
            number(source["available_text"]) if source["available_text"] else None
        )
        if not source["sample"]:
            issues.append("Sample ID is missing.")
        elif counts[source["sample"].casefold()] > 1:
            issues.append(
                "Sample ID is repeated; give each biological sample a distinct ID."
            )
        if conc is None or conc <= 0:
            issues.append("RNA concentration must be a positive number in ng/uL.")
        if source["available_text"] and (available is None or available <= 0):
            issues.append(
                "Available stock volume must be positive or left blank if unknown."
            )
        reason = exclusions.get(source["id"])
        if reason is not None and (not isinstance(reason, str) or not reason.strip()):
            issues.append("An excluded sample needs a reason.")
        excluded = isinstance(reason, str) and bool(reason.strip())
        row = {
            **source,
            "conc": conc,
            "available_ul": available,
            "excluded": excluded,
            "exclusion_reason": reason or "",
            "stock_required_ul": None,
            "rna_ul": None,
            "water_ul": None,
            "total_ul": number(recipe.get("total_volume_ul")),
            "achievable_ng": None,
            "dilution": None,
            "components": base["components"] if base else [],
            "issues": issues,
            "notes": [],
            "status": "excluded" if excluded else "needs-correction",
            "feasible": False,
            "finished_dilution": None,
        }
        if excluded:
            row["notes"].append(reason.strip())
        elif not issues and not problems:
            capacity = base["water_ul"]
            max_sample = number(recipe["constraints"].get("max_sample_ul"))
            if max_sample:
                capacity = min(capacity, max_sample)
            requested = target / conc
            if not math.isfinite(requested) or requested <= 0:
                row["issues"].append(
                    "RNA target and concentration are outside the supported numeric range."
                )
                rows.append(row)
                continue
            row.update(
                stock_required_ul=requested, achievable_ng=max(0, conc * capacity)
            )
            actual = requested
            if requested > capacity + 1e-10:
                issues.append(
                    f"RNA is too dilute: at most {conc * capacity:g} ng fits in {capacity:g} uL; the target has not been changed."
                )
            elif requested < minimum:
                factor = max(2, math.ceil(minimum / requested - 1e-12))
                actual = factor * requested
                dilution = plan_dilution(
                    conc, conc / factor, max(10.0, actual), minimum, available
                )
                row["dilution"] = dilution
                issues.extend(dilution["issues"])
                row["notes"].append(
                    f"Prepare a {factor:g}-fold RNA dilution; add the diluted RNA volume shown."
                )
                if actual > capacity + 1e-10:
                    issues.append(
                        "A pipettable diluted aliquot cannot fit; change the target or recipe explicitly."
                    )
            elif available is not None and requested > available + 1e-10:
                issues.append("Insufficient RNA stock for the requested input.")
            evaluated = evaluate_recipe(recipe, actual)
            issues.extend(evaluated["issues"])
            water = evaluated["water_ul"]
            if water is not None and 0 < water < minimum - 1e-10:
                issues.append(
                    "The individual water transfer is below the pipetting minimum."
                )
            row.update(
                rna_ul=actual, water_ul=water, components=evaluated["components"]
            )
            if available is None:
                row["notes"].append(
                    "Stock volume is unknown; confirm that enough RNA is available before preparation."
                )
            if finished and finished > 1:
                dilution = plan_dilution(
                    1.0,
                    1.0 / finished,
                    recipe["total_volume_ul"] * finished,
                    minimum,
                    recipe["total_volume_ul"],
                )
                row["finished_dilution"] = dilution
                issues.extend(dilution["issues"])
            if not issues:
                row.update(feasible=True, status="ready", achievable_ng=target)
        rows.append(row)
    eligible = sum(row["feasible"] for row in rows)
    mix = (
        master_mix(recipe, base, eligible, ceil_reactions=True, include_water=False)
        if base and not problems
        else {"components": [], "reaction_equivalents": 0, "issues": []}
    )
    problems.extend(mix["issues"])
    output_concentration = (
        target / (recipe["total_volume_ul"] * finished)
        if not problems and target and finished
        else None
    )
    return {
        "engine": "next-cdna-1",
        "recipe": recipe,
        "rows": rows,
        "master_mix": {
            **mix,
            "n_samples": eligible,
            "n_total": mix["reaction_equivalents"],
        },
        "issues": list(dict.fromkeys(problems)),
        "counts": {
            "total": len(rows),
            "ready": eligible,
            "excluded": sum(r["excluded"] for r in rows),
            "unresolved": sum(not r["excluded"] and not r["feasible"] for r in rows),
        },
        "ready": bool(eligible)
        and not problems
        and all(r["feasible"] or r["excluded"] for r in rows),
        "rna_input_equivalent_ng_ul": output_concentration,
    }


def export_rows(result):
    names = [c["name"] for c in result["recipe"]["components"]]
    output = []
    for row in result["rows"]:
        output.append(
            {
                "Sample ID": row["sample"],
                "Source row": row["source_row"],
                "RNA concentration (ng/uL)": row["conc_text"],
                "Available stock (uL)": row["available_text"],
                "RNA volume (uL)": row["rna_ul"] if row["feasible"] else None,
                **{
                    f"Reagent: {name} (uL)": (
                        next(
                            (
                                c["volume_ul"]
                                for c in row["components"]
                                if c["name"] == name
                            ),
                            None,
                        )
                        if row["feasible"]
                        else None
                    )
                    for name in names
                },
                "Water (uL)": row["water_ul"] if row["feasible"] else None,
                "Reaction volume (uL)": row["total_ul"],
                "Status": row["status"],
                "Reason": row["exclusion_reason"] or "; ".join(row["issues"]),
                "RNA dilution factor": (row["dilution"] or {}).get("factor", 1),
                "Dilution stock (uL)": (row["dilution"] or {}).get("stock_ul"),
                "Dilution water (uL)": (row["dilution"] or {}).get("water_ul"),
                "Finished dilution stock (uL)": (row["finished_dilution"] or {}).get(
                    "stock_ul"
                ),
                "Finished dilution water (uL)": (row["finished_dilution"] or {}).get(
                    "water_ul"
                ),
                "Notes": " ".join(row["notes"]),
            }
        )
    return output
