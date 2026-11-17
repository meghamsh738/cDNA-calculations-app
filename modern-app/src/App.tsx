import { useRef, useState, useEffect, type ChangeEvent } from "react";
import {
  legacyRecipe,
  recipeShape,
  units,
  type Recipe,
  type Component,
} from "./recipes";
import "./App.css";
const API = "http://127.0.0.1:18511";
const KEY = "easylab-next:cdna:experiment:v1",
  PRESETS = "easylab-next:cdna:presets:v1";
const PRACTICE =
  "Sample\tConcentration (ng/uL)\tAvailable stock (uL)\nPractice A\t50\t10\nPractice B\t1000\t5\nPractice C\t1\t20\nPractice D\tinvalid\t5";
type Dilution = {
  stock_ul: number;
  water_ul: number;
  total_ul: number;
  factor: number;
  issues: string[];
};
type Row = {
  id: string;
  source_row: number;
  sample: string;
  conc_text: string;
  available_text: string;
  excluded: boolean;
  exclusion_reason: string;
  feasible: boolean;
  rna_ul: number | null;
  water_ul: number | null;
  total_ul: number;
  achievable_ng: number | null;
  components: { name: string; volume_ul: number; in_master_mix: boolean }[];
  dilution: Dilution | null;
  finished_dilution: Dilution | null;
  issues: string[];
  notes: string[];
  status: string;
};
type Result = {
  engine: string;
  recipe: Recipe;
  rows: Row[];
  issues: string[];
  ready: boolean;
  counts: {
    total: number;
    ready: number;
    excluded: number;
    unresolved: number;
  };
  master_mix: {
    n_samples: number;
    n_total: number;
    components: { name: string; per_reaction_ul: number; total_ul: number }[];
  };
  rna_input_equivalent_ng_ul: number | null;
  source_text: string;
};
type Experiment = {
  version: 1;
  id: string;
  name: string;
  revision: number;
  practice: boolean;
  recipe: Recipe;
  raw_text: string;
  source_copies: { name: string; text: string }[];
  exclusions: Record<string, string>;
  finished_dilution_factor: number;
  reviewed: boolean;
};
const fresh = (recipe = legacyRecipe()): Experiment => ({
  version: 1,
  id: crypto.randomUUID(),
  name: "Untitled cDNA preparation",
  revision: 1,
  practice: false,
  recipe: structuredClone(recipe),
  raw_text: "",
  source_copies: [],
  exclusions: {},
  finished_dilution_factor: 1,
  reviewed: false,
});
function validate(value: unknown): Experiment {
  const e = value as Experiment;
  if (
    !e ||
    e.version !== 1 ||
    typeof e.id !== "string" ||
    typeof e.name !== "string" ||
    typeof e.raw_text !== "string" ||
    e.raw_text.length > 2_000_000 ||
    !Array.isArray(e.source_copies) ||
    e.source_copies.length > 30 ||
    e.source_copies.some(
      (v) =>
        !v ||
        typeof v.name !== "string" ||
        typeof v.text !== "string" ||
        v.text.length > 2_000_000,
    ) ||
    !recipeShape(e.recipe) ||
    !Number.isSafeInteger(e.revision) ||
    e.revision < 1 ||
    !Number.isFinite(e.finished_dilution_factor) ||
    typeof e.reviewed !== "boolean" ||
    typeof e.practice !== "boolean" ||
    !e.exclusions ||
    Array.isArray(e.exclusions) ||
    Object.values(e.exclusions).some((v) => typeof v !== "string")
  )
    throw Error("This is not a compatible cDNA experiment.");
  return structuredClone(e);
}
const input = (e: Experiment) => ({
  recipe: e.recipe,
  raw_text: e.raw_text,
  exclusions: e.exclusions,
  finished_dilution_factor: e.finished_dilution_factor,
});
const key = (e: Experiment) => JSON.stringify(input(e));
const fmt = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : Number(n.toPrecision(6)).toString();
const safe = (name: string) =>
  name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 100) || "cdna-next";
const download = (data: Blob | string, name: string) => {
  const url = URL.createObjectURL(
    typeof data === "string"
      ? new Blob([data], { type: "text/plain;charset=utf-8" })
      : data,
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const csv = (rows: (string | number | null)[][]) =>
  rows
    .map((row) =>
      row
        .map((v) => {
          const text =
            typeof v === "string" && /^\s*[=+@-]/.test(v)
              ? `'${v}`
              : String(v ?? "");
          return `"${text.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
const digest = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
async function calculate(e: Experiment): Promise<Result> {
  const response = await fetch(`${API}/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input(e)),
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail),
    );
  return data;
}
function readInitial() {
  try {
    const raw = localStorage.getItem(KEY);
    return {
      exp: raw ? { ...validate(JSON.parse(raw)), reviewed: false } : fresh(),
      error: "",
    };
  } catch {
    return {
      exp: fresh(),
      error:
        "The saved local inputs could not be opened. Their browser copy remains unchanged until you make an edit.",
    };
  }
}
function App() {
  const [initial] = useState(readInitial),
    [exp, setExp] = useState(initial.exp),
    [step, setStep] = useState(0),
    [history, setHistory] = useState<Experiment[]>([]),
    [record, setRecord] = useState<{ key: string; result: Result } | null>(
      null,
    ),
    [notice, setNotice] = useState(initial.error),
    [busy, setBusy] = useState(false),
    [canAutosave, setCanAutosave] = useState(!initial.error),
    [storageError, setStorageError] = useState("");
  const [presets, setPresets] = useState<Recipe[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(PRESETS) ?? "[]");
      return Array.isArray(saved) ? saved.filter(recipeShape) : [];
    } catch {
      return [];
    }
  });
  const request = useRef(0),
    current = record?.key === key(exp),
    result = record?.result,
    ready = !!current && !!result?.ready && exp.reviewed;
  useEffect(() => {
    if (!canAutosave) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(exp));
      queueMicrotask(() => setStorageError(""));
    } catch {
      queueMicrotask(() =>
        setStorageError(
          "Local storage is unavailable or full. Download an experiment package.",
        ),
      );
    }
  }, [exp, canAutosave]);
  const change = (patch: Partial<Experiment>, invalidate = true) => {
    request.current++;
    setBusy(false);
    setHistory((h) => [...h.slice(-29), exp]);
    setExp({
      ...exp,
      ...patch,
      revision: exp.revision + 1,
      reviewed: invalidate ? false : (patch.reviewed ?? exp.reviewed),
    });
    setCanAutosave(true);
  };
  const recipe = (patch: Partial<Recipe>) =>
    change({
      recipe: {
        ...exp.recipe,
        ...patch,
        name:
          patch.name ??
          (exp.recipe.name.startsWith("Custom")
            ? exp.recipe.name
            : `Custom — ${exp.recipe.name}`),
      },
    });
  const component = (index: number, patch: Partial<Component>) =>
    recipe({
      components: exp.recipe.components.map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      ),
    });
  const run = async () => {
    const id = ++request.current;
    setBusy(true);
    try {
      const next = await calculate(exp);
      if (id !== request.current) return;
      setRecord({ key: key(exp), result: next });
      setExp({ ...exp, reviewed: false, revision: exp.revision + 1 });
      setStep(2);
      setNotice(
        "Every input row is shown below. Resolve problems or record specific exclusion reasons, then recalculate.",
      );
    } catch (e) {
      if (id === request.current) setNotice(String(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  const save = async () => {
    try {
      const payload = {
        engine: "next-cdna-1",
        experiment: exp,
        result: current ? result : null,
      };
      const text = JSON.stringify(payload);
      if (new Blob([text]).size > 100_000_000)
        throw Error("This experiment exceeds the 100 MB package limit.");
      download(
        JSON.stringify(
          {
            format: "easylab.cdna",
            version: 1,
            checksum: await digest(text),
            payload,
          },
          null,
          2,
        ),
        `${safe(exp.name)}-r${exp.revision}.easylab.json`,
      );
    } catch (e) {
      setNotice(String(e));
    }
  };
  const open = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const id = ++request.current;
    setBusy(true);
    try {
      if (file.size > 100_000_000)
        throw Error("Use a package smaller than 100 MB.");
      const envelope = JSON.parse(await file.text());
      if (
        envelope.format !== "easylab.cdna" ||
        envelope.version !== 1 ||
        envelope.payload?.engine !== "next-cdna-1" ||
        envelope.checksum !== (await digest(JSON.stringify(envelope.payload)))
      )
        throw Error("Unsupported or changed experiment package.");
      const next = validate(envelope.payload.experiment);
      if (id !== request.current) return;
      const computed = await calculate(next);
      if (id !== request.current) return;
      const matches =
        JSON.stringify(computed) === JSON.stringify(envelope.payload.result);
      setHistory((h) => [...h.slice(-29), exp]);
      setExp({ ...next, reviewed: matches && next.reviewed });
      setRecord({ key: key(next), result: computed });
      setCanAutosave(true);
      setStep(2);
      setNotice(
        matches
          ? "Experiment reopened with its reviewed choices."
          : "Inputs reopened; review the recalculated results.",
      );
    } catch (e) {
      if (id === request.current) setNotice(String(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  const reset = (practice = false) => {
    if (
      exp.raw_text &&
      !window.confirm(
        "Replace this experiment? Save a package first to retain a portable copy. Undo can restore the previous inputs.",
      )
    )
      return;
    const next = fresh(exp.recipe);
    if (practice) {
      next.name = "Practice — fictional RNA samples";
      next.practice = true;
      next.recipe = legacyRecipe();
      next.raw_text = PRACTICE;
      next.source_copies = [{ name: "Fictional practice.tsv", text: PRACTICE }];
    }
    change(next);
    setRecord(null);
    setStep(practice ? 1 : 0);
  };
  const resetStep = () => {
    if (
      !window.confirm("Reset this step? Undo can restore its previous inputs.")
    )
      return;
    if (step === 0) change({ recipe: legacyRecipe() });
    else if (step === 1)
      change({ raw_text: "", exclusions: {}, finished_dilution_factor: 1 });
    else {
      change({ reviewed: false });
      setRecord(null);
    }
    setNotice("Current step reset. Review dependent results again.");
  };
  const savePreset = () => {
    try {
      if (!recipeShape(exp.recipe))
        throw Error("Complete the recipe fields first.");
      if (exp.recipe.name.trim() === legacyRecipe().name)
        throw Error(
          "Choose a custom name; the built-in legacy name is reserved.",
        );
      const next = [
        ...presets.filter((r) => r.name !== exp.recipe.name),
        structuredClone(exp.recipe),
      ];
      localStorage.setItem(PRESETS, JSON.stringify(next));
      setPresets(next);
      setNotice(
        "Named recipe saved. New samples and review decisions are not included.",
      );
    } catch (e) {
      setNotice(String(e));
    }
  };
  const loadSamples = async (file: File) => {
    const id = ++request.current;
    setBusy(true);
    try {
      if (file.size > 2_000_000) throw Error("Use a file smaller than 2 MB.");
      if (exp.source_copies.length >= 30)
        throw Error(
          "This experiment already contains 30 source files. Start a new experiment to import another file.",
        );
      const text = await file.text();
      if (id !== request.current) return;
      if (
        new Blob([...exp.source_copies.map((s) => s.text), text]).size >
        8_000_000
      )
        throw Error(
          "Source files exceed 8 MB together. Start a new experiment for additional files.",
        );
      change({
        raw_text: text,
        source_copies: [...exp.source_copies, { name: file.name, text }],
        exclusions: {},
        practice: false,
      });
    } catch (e) {
      if (id === request.current)
        setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  const exportCsv = () => {
    if (!ready || !result) return;
    const names = exp.recipe.components.map((c) => c.name);
    download(
      csv([
        [
          "Sample",
          "Source row",
          "RNA concentration (ng/uL)",
          "RNA (uL)",
          ...names.map((name) => `Reagent: ${name} (uL)`),
          "Water (uL)",
          "Total (uL)",
          "Status",
          "Reason",
          "RNA dilution stock (uL)",
          "RNA dilution water (uL)",
          "Finished dilution stock (uL)",
          "Finished dilution water (uL)",
        ],
        ...result.rows.map((r) => [
          r.sample,
          r.source_row,
          r.conc_text,
          r.feasible ? r.rna_ul : null,
          ...names.map((n) =>
            r.feasible
              ? (r.components.find((c) => c.name === n)?.volume_ul ?? null)
              : null,
          ),
          r.feasible ? r.water_ul : null,
          r.total_ul,
          r.status,
          r.exclusion_reason || r.issues.join("; "),
          r.dilution?.stock_ul ?? null,
          r.dilution?.water_ul ?? null,
          r.finished_dilution?.stock_ul ?? null,
          r.finished_dilution?.water_ul ?? null,
        ]),
      ]),
      `${safe(exp.name)}-r${exp.revision}.csv`,
    );
  };
  const excel = async () => {
    if (!ready) return;
    try {
      const response = await fetch(`${API}/export-excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input(exp)),
      });
      if (!response.ok) throw Error(await response.text());
      download(
        await response.blob(),
        `${safe(exp.name)}-r${exp.revision}.xlsx`,
      );
    } catch (e) {
      setNotice(String(e));
    }
  };
  return (
    <div className="next-app">
      <aside className="workflow-nav">
        <div className="brand">
          EL <span>EasyLab Next</span>
        </div>
        <p>cDNA Calculator</p>
        <nav aria-label="Preparation steps">
          {["Recipe", "Samples", "Review & export"].map((name, i) => (
            <button
              key={name}
              aria-current={step === i ? "step" : undefined}
              onClick={() => setStep(i)}
            >
              {i + 1}. {name}
              {i === 2 && ready ? " ✓" : ""}
            </button>
          ))}
        </nav>
        <p className="nav-note">
          Local workspace · revision {exp.revision}
          {exp.practice ? " · Practice" : ""}
        </p>
        <div className="actions">
          <button
            disabled={!history.length}
            onClick={() => {
              const previous = history.at(-1)!;
              request.current++;
              setBusy(false);
              setExp({
                ...previous,
                revision: exp.revision + 1,
                reviewed: false,
              });
              setHistory(history.slice(0, -1));
              setNotice(
                "Previous inputs restored. Recalculate to review this revision.",
              );
            }}
          >
            Undo
          </button>
          <button onClick={resetStep}>Reset step</button>
          <button onClick={() => reset()}>New experiment</button>
        </div>
        <p>
          Browser storage belongs to this Next origin. Download a package for a
          portable backup.
        </p>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <p className="eyebrow">
              {exp.practice
                ? "Fictional practice experiment"
                : "RNA to cDNA preparation"}
            </p>
            <h1>cDNA Calculator</h1>
            <p>
              Choose a recipe, check every sample, then prepare the reviewed
              volumes.
            </p>
          </div>
          <div className="actions">
            <button onClick={() => reset(true)}>
              Open practice experiment
            </button>
            <label className="file-button">
              Open experiment
              <input
                type="file"
                accept=".json"
                onChange={(e) => void open(e)}
              />
            </label>
            <button onClick={() => void save()}>Save experiment</button>
          </div>
        </header>
        <label>
          Experiment name
          <input
            value={exp.name}
            onChange={(e) => change({ name: e.target.value }, false)}
          />
        </label>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {storageError && (
          <p role="alert" className="warning">
            {storageError}
          </p>
        )}
        {busy && <p role="status">Calculating with the local backend…</p>}
        {step === 0 && (
          <>
            <section>
              <h2>1. Recipe</h2>
              <p>
                The legacy recipe preserves the existing 20 µL calculation. It
                is not a validated kit protocol. Edited settings are labelled
                Custom; declared kit limits require their source.
              </p>
              <div className="controls">
                <label>
                  Load recipe
                  <select
                    value=""
                    onChange={(e) => {
                      const r = [legacyRecipe(), ...presets].find(
                        (x) => x.name === e.target.value,
                      );
                      if (r) change({ recipe: structuredClone(r) });
                    }}
                  >
                    <option value="">Choose a named recipe</option>
                    {[legacyRecipe(), ...presets].map((r, i) => (
                      <option key={i}>{r.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Recipe name
                  <input
                    value={exp.recipe.name}
                    onChange={(e) => recipe({ name: e.target.value })}
                  />
                </label>
                <button onClick={savePreset}>Save named recipe</button>
              </div>
              <div className="controls">
                {(
                  [
                    ["total_volume_ul", "Reaction volume (µL)"],
                    ["min_pipette_ul", "Minimum pipetting volume (µL)"],
                    ["overage_pct", "Master-mix overage (%)"],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field}>
                    {label}
                    <input
                      type="number"
                      step="any"
                      value={exp.recipe[field]}
                      onChange={(e) =>
                        recipe({ [field]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
                <label>
                  RNA target (ng)
                  <input
                    type="number"
                    step="any"
                    value={exp.recipe.sample_input.value}
                    onChange={(e) =>
                      recipe({
                        sample_input: {
                          ...exp.recipe.sample_input,
                          value: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={exp.recipe.allow_scaling}
                    onChange={(e) =>
                      recipe({ allow_scaling: e.target.checked })
                    }
                  />
                  Permit a different reaction volume
                </label>
              </div>
              <p>
                Fixed aliquots stay fixed. Fractions and final concentrations
                follow reaction volume. Water is the remaining volume after RNA
                and reagents.
              </p>
            </section>
            <section>
              <details>
                <summary>Edit reaction components and scaling details</summary>
                <p>
                  Check these against your protocol when changing the recipe.
                </p>
                <label>
                  Original recipe volume (µL)
                  <input
                    type="number"
                    step="any"
                    value={exp.recipe.reference_volume_ul}
                    onChange={(e) =>
                      recipe({ reference_volume_ul: Number(e.target.value) })
                    }
                  />
                </label>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "Reagent",
                          "Calculation",
                          "Aliquot / fraction",
                          "Stock",
                          "Stock unit",
                          "Final",
                          "Final unit",
                          "Master mix",
                          "",
                        ].map((x, i) => (
                          <th key={i}>{x}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {exp.recipe.components.map((c, i) => (
                        <tr key={i}>
                          <td>
                            <input
                              aria-label={`Reagent ${i + 1}`}
                              value={c.name}
                              onChange={(e) =>
                                component(i, { name: e.target.value })
                              }
                            />
                          </td>
                          <td>
                            <select
                              aria-label={`Mode ${i + 1}`}
                              value={c.mode}
                              onChange={(e) =>
                                component(i, {
                                  mode: e.target.value as Component["mode"],
                                })
                              }
                            >
                              <option value="fixed">Fixed µL</option>
                              <option value="fraction">
                                Fraction of reaction
                              </option>
                              <option value="concentration">
                                Final concentration
                              </option>
                            </select>
                          </td>
                          <td>
                            <input
                              aria-label={`Amount ${i + 1}`}
                              type="number"
                              step="any"
                              disabled={c.mode === "concentration"}
                              value={c.value}
                              onChange={(e) =>
                                component(i, { value: Number(e.target.value) })
                              }
                            />
                          </td>
                          {(
                            [
                              "stock",
                              "stock_unit",
                              "final",
                              "final_unit",
                            ] as const
                          ).map((field) => (
                            <td key={field}>
                              {field.endsWith("unit") ? (
                                <select
                                  aria-label={`${field} ${i + 1}`}
                                  disabled={c.mode !== "concentration"}
                                  value={c[field]}
                                  onChange={(e) =>
                                    component(i, { [field]: e.target.value })
                                  }
                                >
                                  {units.map((u) => (
                                    <option key={u}>{u}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  aria-label={`${field} ${i + 1}`}
                                  disabled={c.mode !== "concentration"}
                                  type="number"
                                  step="any"
                                  value={c[field]}
                                  onChange={(e) =>
                                    component(i, {
                                      [field]: Number(e.target.value),
                                    })
                                  }
                                />
                              )}
                            </td>
                          ))}
                          <td>
                            <input
                              aria-label={`Pool reagent ${i + 1}`}
                              type="checkbox"
                              checked={c.in_master_mix}
                              onChange={(e) =>
                                component(i, {
                                  in_master_mix: e.target.checked,
                                })
                              }
                            />
                          </td>
                          <td>
                            <button
                              aria-label={`Remove reagent ${i + 1}`}
                              onClick={() =>
                                recipe({
                                  components: exp.recipe.components.filter(
                                    (_, j) => i !== j,
                                  ),
                                })
                              }
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={() =>
                    recipe({
                      components: [
                        ...exp.recipe.components,
                        {
                          name: `Reagent ${exp.recipe.components.length + 1}`,
                          mode: "fixed",
                          value: 0,
                          stock: 1,
                          stock_unit: "X",
                          final: 1,
                          final_unit: "X",
                          in_master_mix: true,
                        },
                      ],
                    })
                  }
                >
                  Add reagent
                </button>
              </details>
            </section>
            <section>
              <details>
                <summary>Review declared kit limits</summary>
                <p>
                  Leave unknown limits blank. Limits you declare are enforced;
                  changing a limit creates an edited custom recipe.
                </p>
                <label>
                  Kit / protocol source
                  <input
                    value={exp.recipe.constraints.source}
                    onChange={(e) =>
                      recipe({
                        constraints: {
                          ...exp.recipe.constraints,
                          source: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <div className="controls">
                  {(
                    [
                      ["min_volume_ul", "Minimum reaction (µL)"],
                      ["max_volume_ul", "Maximum reaction (µL)"],
                      ["max_input_ng", "Maximum RNA (ng)"],
                      ["max_sample_ul", "Maximum RNA volume (µL)"],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        type="number"
                        step="any"
                        value={exp.recipe.constraints[field] ?? ""}
                        onChange={(e) =>
                          recipe({
                            constraints: {
                              ...exp.recipe.constraints,
                              [field]:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
              <p>
                {exp.recipe.constraints.source
                  ? `Declared limits: ${exp.recipe.constraints.source}`
                  : "No kit limits supplied. Confirm the protocol before preparing reactions."}
              </p>
              <button className="primary" onClick={() => setStep(1)}>
                Continue to samples
              </button>
            </section>
          </>
        )}
        {step === 1 && (
          <section>
            <h2>2. Samples</h2>
            <p>
              Paste CSV or tab-separated rows: sample ID, RNA concentration in
              ng/µL, and optional available stock volume in µL. Names with
              spaces are supported. All non-empty rows appear in review,
              including invalid values.
            </p>
            <label className="file-button">
              Load sample table
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void loadSamples(file);
                }}
              />
            </label>
            <textarea
              rows={10}
              aria-label="Sample table"
              value={exp.raw_text}
              onChange={(e) =>
                change({ raw_text: e.target.value, exclusions: {} })
              }
            />
            <label>
              Finished-cDNA dilution factor
              <input
                type="number"
                min="1"
                step="any"
                value={exp.finished_dilution_factor}
                onChange={(e) =>
                  change({ finished_dilution_factor: Number(e.target.value) })
                }
              />
            </label>
            <p>
              A factor of 1 leaves finished cDNA undiluted. Larger factors show
              stock and water for dilution of the whole completed reaction.
              RNA-input equivalent is not a measured cDNA concentration or a
              yield estimate.
            </p>
            <button
              className="primary"
              disabled={busy || !exp.raw_text.trim()}
              onClick={() => void run()}
            >
              Review samples and calculate
            </button>
          </section>
        )}
        {step === 2 && (
          <>
            <section>
              <h2>3. Review & export</h2>
              {!current && (
                <p className="warning">
                  Results need recalculation after the latest changes.
                </p>
              )}
              <button
                className="primary"
                disabled={busy || !exp.raw_text.trim()}
                onClick={() => void run()}
              >
                Recalculate
              </button>
              {result && (
                <>
                  {current && (
                    <p>
                      {result.counts.total} input rows · {result.counts.ready}{" "}
                      ready · {result.counts.excluded} excluded ·{" "}
                      {result.counts.unresolved} need correction
                    </p>
                  )}
                  {current && result.issues.length > 0 && (
                    <ul className="warning">
                      {result.issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  )}
                  {result.source_text === exp.raw_text && (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {[
                              "Sample / row",
                              "Original concentration",
                              "Available stock",
                              "RNA µL",
                              "Water µL",
                              "Reaction µL",
                              "Status / reason",
                              "Exclude",
                              "Exclusion reason",
                            ].map((x) => (
                              <th key={x}>{x}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((r) => (
                            <tr key={r.id}>
                              <th>
                                {r.sample || "Missing ID"}
                                <small>Input row {r.source_row}</small>
                              </th>
                              <td>{r.conc_text || "Missing"}</td>
                              <td>{r.available_text || "Unknown"}</td>
                              <td>{current ? fmt(r.rna_ul) : "Recalculate"}</td>
                              <td>{current ? fmt(r.water_ul) : "—"}</td>
                              <td>{current ? fmt(r.total_ul) : "—"}</td>
                              <td>
                                {current ? r.status : "Needs recalculation"}
                                {current && r.issues.length > 0 && (
                                  <ul>
                                    {r.issues.map((v, i) => (
                                      <li key={i}>{v}</li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                              <td>
                                <input
                                  aria-label={`Exclude ${r.id}`}
                                  type="checkbox"
                                  checked={r.id in exp.exclusions}
                                  onChange={(e) => {
                                    const exclusions = { ...exp.exclusions };
                                    if (e.target.checked) exclusions[r.id] = "";
                                    else delete exclusions[r.id];
                                    change({ exclusions });
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  aria-label={`Reason ${r.id}`}
                                  disabled={!(r.id in exp.exclusions)}
                                  value={exp.exclusions[r.id] ?? ""}
                                  onChange={(e) =>
                                    change({
                                      exclusions: {
                                        ...exp.exclusions,
                                        [r.id]: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p>
                    Only ready, retained reactions count toward the master mix.
                    Overage increases the preparation amount; individual
                    reactions keep the same composition.
                  </p>
                </>
              )}
            </section>
            {result && (
              <>
                <section hidden={!current}>
                  <h3>Master mix and individual aliquots</h3>
                  <p>
                    {result.master_mix.n_samples} reactions · prepare{" "}
                    {fmt(result.master_mix.n_total)} reaction equivalents
                    including overage.
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Reagent</th>
                          <th>Per reaction (µL)</th>
                          <th>Preparation total (µL)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          result.rows.find((r) => r.feasible)?.components ?? []
                        ).map((c) => (
                          <tr key={c.name}>
                            <th>{c.name}</th>
                            <td>{fmt(c.volume_ul)}</td>
                            <td>
                              {c.in_master_mix
                                ? fmt(
                                    result.master_mix.components.find(
                                      (m) => m.name === c.name,
                                    )?.total_ul,
                                  )
                                : "Add individually"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {exp.recipe.components.filter((c) => !c.in_master_mix)
                    .length > 0 && (
                    <p>
                      Reagents marked outside the master mix are added
                      individually at the per-reaction volumes above.
                    </p>
                  )}
                </section>
                <section hidden={!current}>
                  <h3>Dilution instructions and sample notes</h3>
                  {result.rows.map((r) => (
                    <div className="sample-note" key={r.id}>
                      <h4>{r.sample || `Row ${r.source_row}`}</h4>
                      {r.excluded ? (
                        <p>Excluded: {r.exclusion_reason}</p>
                      ) : (
                        <>
                          {r.dilution && (
                            <p>
                              RNA dilution: {fmt(r.dilution.stock_ul)} µL stock
                              + {fmt(r.dilution.water_ul)} µL water →{" "}
                              {fmt(r.dilution.total_ul)} µL (
                              {fmt(r.dilution.factor)}-fold). Add{" "}
                              {fmt(r.rna_ul)} µL diluted RNA to the reaction.
                            </p>
                          )}
                          {r.finished_dilution && (
                            <p>
                              Finished cDNA: {fmt(r.finished_dilution.stock_ul)}{" "}
                              µL completed reaction +{" "}
                              {fmt(r.finished_dilution.water_ul)} µL water →{" "}
                              {fmt(r.finished_dilution.total_ul)} µL.
                            </p>
                          )}
                          {r.notes.map((n, i) => (
                            <p key={i}>{n}</p>
                          ))}
                          {r.issues.length > 0 && (
                            <p className="warning">
                              Do not prepare until this sample's problems are
                              resolved.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  <p>
                    RNA-input equivalent after finished dilution:{" "}
                    {fmt(result.rna_input_equivalent_ng_ul)} ng/µL. This
                    describes input mass distributed across final volume, not
                    measured cDNA yield.
                  </p>
                </section>
                <section>
                  <h3>Save the reviewed preparation</h3>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      disabled={!current || !result.ready}
                      checked={exp.reviewed && !!current}
                      onChange={(e) =>
                        change({ reviewed: e.target.checked }, false)
                      }
                    />
                    I checked sample IDs, concentrations, kit limits, available
                    stock and all dilution transfers.
                  </label>
                  <div className="actions">
                    <button disabled={!ready} onClick={exportCsv}>
                      Download CSV
                    </button>
                    <button disabled={!ready} onClick={() => void excel()}>
                      Download Excel workbook
                    </button>
                    <button onClick={() => void save()}>
                      Download experiment package
                    </button>
                  </div>
                  <p>
                    Exports use the same local calculation as this review.
                    Browser downloads use your browser's destination; they do
                    not write into an arbitrary selected folder.
                  </p>
                </section>
              </>
            )}
          </>
        )}
        <footer>
          EasyLab Next · local processing · no kit-specific validation claimed.
        </footer>
      </main>
    </div>
  );
}
export default App;
