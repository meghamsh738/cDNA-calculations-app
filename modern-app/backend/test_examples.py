import asyncio
import unittest

from main import CalcRequest, calculate, load_example_samples


class ExampleSamplesTest(unittest.TestCase):
    def test_bundled_sample_names_are_retained(self):
        samples = load_example_samples()
        self.assertEqual([sample.sample for sample in samples], ["Sample1", "Sample2", "Sample3"])
        self.assertEqual([sample.conc for sample in samples], [178.2, 129.9, 59.2])

    def test_example_calculation_has_volumes_and_overage(self):
        result = asyncio.run(calculate(CalcRequest(use_example=True)))
        self.assertEqual(result["master_mix"]["n_samples"], 3)
        self.assertEqual(result["master_mix"]["n_total"], 4)
        for row in result["rows"][:3]:
            self.assertAlmostEqual(row["RNA Volume (µl)"] + row["H2O (µl)"], 14.2)
            self.assertEqual(row["final volume (µl)"], 20)


if __name__ == "__main__":
    unittest.main()
