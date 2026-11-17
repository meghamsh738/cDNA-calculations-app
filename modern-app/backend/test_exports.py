"""The workbook must contain the same retained sample volumes as review."""

import asyncio
import io
import unittest
from openpyxl import load_workbook
from fastapi import HTTPException
from main import CalcRequest, resolve, export_excel
from recipes import legacy_cdna_recipe


async def workbook(request):
    response = await export_excel(request)
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
    return load_workbook(io.BytesIO(b"".join(chunks)), data_only=False)


class ExportTests(unittest.TestCase):
    def test_review_and_workbook_agree_and_preserve_invalid_exclusions(self):
        request = CalcRequest(
            raw_text="Sample\tConcentration\tAvailable\n=SUM(1)\t50\t10\nBad\tinvalid\t5",
            exclusions={"2": "Concentration needs remeasurement."},
            finished_dilution_factor=2,
        )
        result = resolve(request)
        self.assertTrue(result["ready"])
        book = asyncio.run(workbook(request))
        rows = list(book["RT Mix"].values)
        mapped = dict(zip(rows[0], rows[1]))
        self.assertEqual(mapped["RNA volume (uL)"], result["rows"][0]["rna_ul"])
        self.assertEqual(mapped["Water (uL)"], result["rows"][0]["water_ul"])
        self.assertEqual(mapped["Finished dilution water (uL)"], 20)
        self.assertEqual(rows[2][0], "Bad")
        self.assertEqual(
            dict(zip(rows[0], rows[2]))["RNA concentration (ng/uL)"], "invalid"
        )
        self.assertEqual(book["RT Mix"]["A2"].value, "=SUM(1)")
        self.assertEqual(book["RT Mix"]["A2"].data_type, "s")
        self.assertIn("Original input", book.sheetnames)

    def test_export_rejects_unresolved_input_and_recipe_limit(self):
        for request in [
            CalcRequest(raw_text="A\tinvalid"),
            CalcRequest(raw_text="A\t1"),
        ]:
            with self.assertRaises(HTTPException):
                asyncio.run(workbook(request))
        recipe = legacy_cdna_recipe()
        recipe["constraints"].update(source="Example declared limit", max_input_ng=100)
        with self.assertRaises(HTTPException):
            asyncio.run(workbook(CalcRequest(recipe=recipe, raw_text="A\t50")))

    def test_nonpooled_and_custom_scaling_exported_without_recipe_math_drift(self):
        recipe = legacy_cdna_recipe()
        recipe.update(name="Custom test", allow_scaling=True, total_volume_ul=25)
        recipe["components"][0].update(mode="fraction", value=0.1)
        recipe["components"][3]["in_master_mix"] = False
        request = CalcRequest(recipe=recipe, raw_text="A\t50\t10")
        result = resolve(request)
        book = asyncio.run(workbook(request))
        rows = list(book["RT Mix"].values)
        row = dict(zip(rows[0], rows[1]))
        self.assertEqual(row["Reagent: Enzyme (uL)"], 1)
        self.assertEqual(row["Reagent: 10x buffer (uL)"], 2.5)
        self.assertEqual(
            sum(
                row[k]
                for k in [
                    "RNA volume (uL)",
                    "Reagent: 10x buffer (uL)",
                    "Reagent: dNTPs (uL)",
                    "Reagent: Random primers (uL)",
                    "Reagent: Enzyme (uL)",
                    "Water (uL)",
                ]
            ),
            25,
        )
        self.assertNotIn(
            "Enzyme", [c["name"] for c in result["master_mix"]["components"]]
        )


if __name__ == "__main__":
    unittest.main()
