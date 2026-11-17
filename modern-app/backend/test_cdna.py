import unittest
from cdna_logic import calculate_cdna, parse_samples
from recipes import legacy_cdna_recipe


class CdnaTests(unittest.TestCase):
    def calculate(self, text, **kwargs):
        return calculate_cdna(legacy_cdna_recipe(), parse_samples(text), **kwargs)

    def test_preserves_bad_rows_and_named_samples(self):
        r = self.calculate(
            'Sample,Concentration,Available\n"Sample 1",50,10\nBad,12oops,20\nLow,1,20'
        )
        self.assertEqual(
            r["counts"], {"total": 3, "ready": 1, "excluded": 0, "unresolved": 2}
        )
        self.assertFalse(r["ready"])
        self.assertEqual(r["rows"][1]["conc_text"], "12oops")
        self.assertIsNone(r["rows"][2]["rna_ul"] if r["rows"][2]["feasible"] else None)
        self.assertAlmostEqual(r["rows"][0]["rna_ul"] + r["rows"][0]["water_ul"], 14.2)

    def test_reasoned_exclusions_and_mix_count(self):
        r = self.calculate("A,50\nB,bad", exclusions={"2": "RNA result missing"})
        self.assertTrue(r["ready"])
        self.assertEqual(r["master_mix"]["n_samples"], 1)
        self.assertEqual(r["master_mix"]["n_total"], 2)
        self.assertEqual(len(r["rows"]), 2)
        self.assertFalse(self.calculate("A,50\nB,bad", exclusions={"2": ""})["ready"])

    def test_dilution_preserves_mass_and_actual_transfer_minimum(self):
        r = self.calculate("A,10000,0.6")["rows"][0]
        self.assertTrue(r["feasible"])
        d = r["dilution"]
        self.assertGreaterEqual(d["stock_ul"], 0.5)
        self.assertGreaterEqual(d["water_ul"], 0.5)
        self.assertAlmostEqual(r["rna_ul"] * 10000 / d["factor"], 200)
        self.assertFalse(self.calculate("A,10000,0.1")["ready"])

    def test_finished_cdna_and_unknown_volume_are_explicit(self):
        r = self.calculate("A,50", finished_dilution_factor=3)
        self.assertTrue(r["ready"])
        d = r["rows"][0]["finished_dilution"]
        self.assertEqual(d["stock_ul"], 20)
        self.assertEqual(d["water_ul"], 40)
        self.assertAlmostEqual(r["rna_input_equivalent_ng_ul"], 200 / 60)
        self.assertIn("unknown", r["rows"][0]["notes"][0])

    def test_duplicate_and_ragged_inputs_are_not_silently_accepted(self):
        self.assertFalse(self.calculate("Sample,Conc,Available\nA,50,2\nB,50")["ready"])
        self.assertFalse(self.calculate("A,50\nA,50")["ready"])

    def test_target_not_changed_for_infeasible_sample_or_kit(self):
        recipe = legacy_cdna_recipe()
        recipe["constraints"].update(source="Test limit", max_input_ng=100)
        r = calculate_cdna(recipe, parse_samples("A,50"))
        self.assertFalse(r["ready"])
        self.assertEqual(r["recipe"]["sample_input"]["value"], 200)

    def test_empty_is_not_practice(self):
        self.assertEqual(self.calculate("")["counts"]["total"], 0)
        self.assertFalse(self.calculate("")["ready"])


if __name__ == "__main__":
    unittest.main()
