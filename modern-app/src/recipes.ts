export type Component = {
  name: string;
  mode: "fixed" | "fraction" | "concentration";
  value: number;
  stock: number;
  stock_unit: string;
  final: number;
  final_unit: string;
  in_master_mix: boolean;
};
export type Recipe = {
  version: 1;
  name: string;
  total_volume_ul: number;
  reference_volume_ul: number;
  allow_scaling: boolean;
  min_pipette_ul: number;
  overage_pct: number;
  sample_input: { mode: "mass"; value: number; unit: "ng" };
  constraints: {
    source: string;
    min_volume_ul: number | null;
    max_volume_ul: number | null;
    max_input_ng: number | null;
    max_sample_ul: number | null;
  };
  components: Component[];
};
export const legacyRecipe = (): Recipe => ({
  version: 1,
  name: "Legacy cDNA — 20 uL",
  total_volume_ul: 20,
  reference_volume_ul: 20,
  allow_scaling: false,
  min_pipette_ul: 0.5,
  overage_pct: 10,
  sample_input: { mode: "mass", value: 200, unit: "ng" },
  constraints: {
    source: "",
    min_volume_ul: null,
    max_volume_ul: null,
    max_input_ng: null,
    max_sample_ul: null,
  },
  components: [
    ["10x buffer", 2],
    ["dNTPs", 0.8],
    ["Random primers", 2],
    ["Enzyme", 1],
  ].map(([name, value]) => ({
    name: String(name),
    mode: "fixed",
    value: Number(value),
    stock: 1,
    stock_unit: "X",
    final: 1,
    final_unit: "X",
    in_master_mix: true,
  })),
});
export const units = ["X", "nM", "uM", "mM", "ng/uL", "ug/uL", "mg/mL", "U/uL"];
export function recipeShape(value: unknown): value is Recipe {
  if (!value || typeof value !== "object") return false;
  const r = value as Recipe;
  return (
    r.version === 1 &&
    typeof r.name === "string" &&
    r.name.length < 200 &&
    Number.isFinite(r.total_volume_ul) &&
    Number.isFinite(r.reference_volume_ul) &&
    Number.isFinite(r.overage_pct) &&
    Number.isFinite(r.min_pipette_ul) &&
    typeof r.allow_scaling === "boolean" &&
    r.sample_input?.mode === "mass" &&
    r.sample_input.unit === "ng" &&
    Number.isFinite(r.sample_input.value) &&
    !!r.constraints &&
    typeof r.constraints.source === "string" &&
    Array.isArray(r.components) &&
    r.components.length <= 30 &&
    r.components.every(
      (c) =>
        c &&
        typeof c.name === "string" &&
        ["fixed", "fraction", "concentration"].includes(c.mode) &&
        Number.isFinite(c.value) &&
        Number.isFinite(c.stock) &&
        Number.isFinite(c.final) &&
        typeof c.in_master_mix === "boolean" &&
        units.includes(c.stock_unit) &&
        units.includes(c.final_unit),
    )
  );
}
