import { useEffect, useMemo, useState } from 'react'
import exampleCsv from '../example_data/samples.csv?raw'
import './App.css'

type CalcRow = {
  _order?: number
  Sample: string
  'RNA Conc (ng/µl)': number | string
  'RNA Volume (µl)': number | string | null
  '10x buffer': number | string
  dNTPs: number | string
  'Random primers': number | string
  Enzyme: number | string
  'H2O (µl)': number | string | null
  'final volume (µl)': number | string
  'Achievable RNA (ng)': number | string
  Note: string
}

const EXAMPLE_TEXT = exampleCsv.trim()
const FIXED = { buffer: 2.0, dntps: 0.8, rand: 2.0, enzyme: 1.0 }
const FINAL_VOL = 20.0
const AVAIL_RNA_H2O = FINAL_VOL - (FIXED.buffer + FIXED.dntps + FIXED.rand + FIXED.enzyme)
const MIN_PIP = 0.5

const parseSamples = (text: string) => {
  const lines = text.trim().split('\n').filter(l => l.trim())
  const out: { sample: string; conc: number }[] = []
  for (const line of lines) {
    if (line.toLowerCase().includes('sample') && line.toLowerCase().includes('conc')) continue
    const parts = line.split(/[, \t]+/).map(p => p.trim()).filter(Boolean)
    if (parts.length >= 2) {
      const conc = parseFloat(parts[1])
      if (!Number.isNaN(conc)) out.push({ sample: parts[0], conc })
    }
  }
  return out
}

const dilutionRecipeText = (D: number, prep = 10) => {
  if (D <= 1) return 'No pre-dilution needed.'
  const rna = Math.round((prep / D) * 1000) / 1000
  const h2o = Math.round((prep - rna) * 1000) / 1000
  return `Pre-dilute ${D}× (1:${D - 1}). Make ${prep} µl: ${rna} µl RNA + ${h2o} µl H₂O.`
}

const suggestDilution = (req: number) => {
  const candidates = [2, 3, 4, 5, 10, 20, 50]
  const dMin = Math.ceil(MIN_PIP / req)
  const dMax = Math.floor(AVAIL_RNA_H2O / req)
  if (dMax < 1) return null
  for (const D of candidates) {
    const aliq = D * req
    if (aliq >= MIN_PIP && aliq <= AVAIL_RNA_H2O) return { D, aliq, recipe: dilutionRecipeText(D) }
  }
  const D = Math.max(1, dMin)
  const aliq = D * req
  if (aliq > AVAIL_RNA_H2O) return null
  return { D, aliq, recipe: dilutionRecipeText(D) }
}

const calcLocally = (samples: { sample: string; conc: number }[], target: number, overage: number) => {
  const rows: CalcRow[] = []
  for (const [idx, s] of samples.entries()) {
    const req = s.conc > 0 ? target / s.conc : NaN
    const feasible = req <= AVAIL_RNA_H2O
    let rnaVol: number | null = null
    let h2o: number | null = null
    let achievable = Math.max(0, s.conc * AVAIL_RNA_H2O)
    let note = ''

    if (feasible) {
      if (req >= MIN_PIP) {
        rnaVol = req
        h2o = AVAIL_RNA_H2O - rnaVol
        achievable = target
      } else {
        const sug = suggestDilution(req)
        if (sug) {
          rnaVol = sug.aliq
          h2o = AVAIL_RNA_H2O - rnaVol
          achievable = target
          note = `Stock volume ${req.toFixed(3)} µl < ${MIN_PIP} µl. ${sug.recipe} Then add ${sug.aliq.toFixed(3)} µl of the diluted RNA.`
        } else {
          note = `Stock volume ${req.toFixed(3)} µl too small; no pre-dilution fits in ${AVAIL_RNA_H2O.toFixed(1)} µl.`
        }
      }
    } else {
      note = `Conc too low: max ${achievable.toFixed(1)} ng in ${AVAIL_RNA_H2O.toFixed(1)} µl.`
    }

    rows.push({
      _order: idx,
      Sample: s.sample,
      'RNA Conc (ng/µl)': Number.isFinite(s.conc) ? s.conc : '',
      'RNA Volume (µl)': rnaVol === null ? '' : Number(rnaVol.toFixed(3)),
      '10x buffer': FIXED.buffer,
      dNTPs: FIXED.dntps,
      'Random primers': FIXED.rand,
      Enzyme: FIXED.enzyme,
      'H2O (µl)': h2o === null ? '' : Number(h2o.toFixed(3)),
      'final volume (µl)': FINAL_VOL,
      'Achievable RNA (ng)': Number(achievable.toFixed(1)),
      Note: note
    })
  }

  const nTotal = Math.max(1, Math.ceil(samples.length * (1 + overage / 100)))
  rows.push({
    _order: 10 ** 9,
    Sample: `MASTER MIX (${overage.toFixed(0)}% overage) — ${nTotal} rxns`,
    'RNA Conc (ng/µl)': '',
    'RNA Volume (µl)': '',
    '10x buffer': Number((FIXED.buffer * nTotal).toFixed(3)),
    dNTPs: Number((FIXED.dntps * nTotal).toFixed(3)),
    'Random primers': Number((FIXED.rand * nTotal).toFixed(3)),
    Enzyme: Number((FIXED.enzyme * nTotal).toFixed(3)),
    'H2O (µl)': '',
    'final volume (µl)': '',
    'Achievable RNA (ng)': '',
    Note: `Make in one tube; covers ${samples.length} samples + ${overage.toFixed(0)}% overage.`
  })

  const mm = {
    n_samples: samples.length,
    n_total: nTotal,
    '10x buffer': Number((FIXED.buffer * nTotal).toFixed(3)),
    dNTPs: Number((FIXED.dntps * nTotal).toFixed(3)),
    'Random primers': Number((FIXED.rand * nTotal).toFixed(3)),
    Enzyme: Number((FIXED.enzyme * nTotal).toFixed(3))
  }

  return { rows, masterMix: mm }
}

const tableColumns: { key: keyof CalcRow; label: string }[] = [
  { key: 'Sample', label: 'Sample' },
  { key: 'RNA Conc (ng/µl)', label: 'Conc (ng/µl)' },
  { key: 'RNA Volume (µl)', label: 'RNA (µl)' },
  { key: 'H2O (µl)', label: 'H₂O (µl)' },
  { key: '10x buffer', label: '10x buffer (µl)' },
  { key: 'dNTPs', label: 'dNTPs (µl)' },
  { key: 'Random primers', label: 'Random primers (µl)' },
  { key: 'Enzyme', label: 'Enzyme (µl)' },
  { key: 'final volume (µl)', label: 'Final vol (µl)' },
  { key: 'Achievable RNA (ng)', label: 'Achievable (ng)' },
  { key: 'Note', label: 'Notes' }
]

const tabs = [
  { id: 'plan', label: 'Plan & inputs' },
  { id: 'output', label: 'Output table' },
  { id: 'master', label: 'Master mix' },
  { id: 'notes', label: 'Notes & rules' }
] as const

type TabId = typeof tabs[number]['id']

function App() {
  const [sampleText, setSampleText] = useState(EXAMPLE_TEXT)
  const [useExample, setUseExample] = useState(true)
  const [targetNg, setTargetNg] = useState(200)
  const [overagePct, setOveragePct] = useState(10)
  const [rows, setRows] = useState<CalcRow[]>([])
  const [masterMix, setMasterMix] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [backendUsed, setBackendUsed] = useState(false)
  const [tab, setTab] = useState<TabId>('plan')

  const samples = useMemo(() => (useExample ? parseSamples(EXAMPLE_TEXT) : parseSamples(sampleText)), [useExample, sampleText])
  const examplePreview = useMemo(() => parseSamples(EXAMPLE_TEXT).slice(0, 4), [])

  useEffect(() => {
    if (useExample) setSampleText(EXAMPLE_TEXT)
  }, [useExample])

  const handleCalculate = async () => {
    if (!samples.length) {
      setError('Please paste at least one sample with a concentration.')
      return
    }
    setLoading(true)
    setError(null)
    setWarning(null)

    const local = calcLocally(samples, targetNg, overagePct)
    setRows(local.rows)
    setMasterMix(local.masterMix)
    setBackendUsed(false)

    try {
      const response = await fetch('http://localhost:8003/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_ng: targetNg,
          overage_pct: overagePct,
          samples,
          use_example: useExample,
        })
      })
      if (response.ok) {
        const data = await response.json()
        setRows(data.rows || local.rows)
        setMasterMix(data.master_mix || local.masterMix)
        setBackendUsed(true)
      } else {
        setWarning('Backend unavailable; showing local calculation.')
      }
    } catch {
      setWarning('Backend unavailable; showing local calculation.')
    } finally {
      setLoading(false)
    }
  }

  const exportCsv = () => {
    if (!rows.length) return
    const headers = Object.keys(rows[0]).filter(k => k !== '_order')
    const lines = [headers.join(',')]
    rows.forEach(r => {
      lines.push(headers.map(h => (r as any)[h]).join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cdna_mix.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportExcel = async () => {
    try {
      const response = await fetch('http://localhost:8003/export-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_ng: targetNg, overage_pct: overagePct, samples, use_example: useExample })
      })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'cdna_mix.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }

  const copyTsv = async () => {
    if (!rows.length) return
    const headers = Object.keys(rows[0]).filter(k => k !== '_order')
    const lines = [headers.join('\t')]
    rows.forEach(r => {
      lines.push(headers.map(h => (r as any)[h]).join('\t'))
    })
    await navigator.clipboard.writeText(lines.join('\n'))
    alert('Copied to clipboard (TSV).')
  }

  const stats = [
    { label: 'Samples', value: samples.length },
    { label: 'Target (ng)', value: targetNg },
    { label: 'Overage (%)', value: overagePct }
  ]

  const reagentCards = [
    { label: '10x buffer', value: FIXED.buffer, total: masterMix?.['10x buffer'] },
    { label: 'dNTPs', value: FIXED.dntps, total: masterMix?.dNTPs },
    { label: 'Random primers', value: FIXED.rand, total: masterMix?.['Random primers'] },
    { label: 'Enzyme', value: FIXED.enzyme, total: masterMix?.Enzyme },
  ]

  return (
    <div className="page">
      <div className="hero">
        <div className="hero-text">
          <div className="tag">cDNA mix planner · legacy logic</div>
          <h1>RT mix calculations without guesswork</h1>
          <p className="lede">
            Paste concentrations, set a target ng and overage, and get pipetting volumes, pre-dilution recipes, and master-mix totals.
            Local math mirrors the FastAPI backend so you always see results.
          </p>
          <div className="pill-row">
            <span className="pill">20 µl final</span>
            <span className="pill">0.5 µl min pipet</span>
            <span className="pill">14.2 µl RNA + H₂O space</span>
          </div>
        </div>
        <div className="hero-meta">
          <p className="kicker">Fixed per reaction</p>
          <div className="meta-grid">
            <div className="meta-card">
              <p>10x buffer</p>
              <strong>{FIXED.buffer} µl</strong>
            </div>
            <div className="meta-card">
              <p>dNTPs</p>
              <strong>{FIXED.dntps} µl</strong>
            </div>
            <div className="meta-card">
              <p>Random primers</p>
              <strong>{FIXED.rand} µl</strong>
            </div>
            <div className="meta-card">
              <p>Enzyme</p>
              <strong>{FIXED.enzyme} µl</strong>
            </div>
          </div>
          <p className="muted">Available RNA + H₂O: {AVAIL_RNA_H2O.toFixed(1)} µl · Final volume: {FINAL_VOL} µl</p>
        </div>
      </div>

      <div className="alerts">
        {error && (
          <div className="alert error">
            <div><strong>Error:</strong> {error}</div>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        {warning && !error && (
          <div className="alert warn">
            <div>{warning}</div>
            <button onClick={() => setWarning(null)}>Dismiss</button>
          </div>
        )}
      </div>

      <div className="shell">
        <div className="tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'plan' && (
        <div className="shell grid-2 tall">
          <section className="card">
            <div className="section-head">
              <div>
                <p className="kicker">Step 1 · Paste your data</p>
                <h2>Samples (Sample, RNA Conc)</h2>
                <p className="muted">Drop or paste your table here. Header required; delimiter auto-detected.</p>
              </div>
              <label className="toggle" aria-label="Use example">
                <input
                  aria-label="Use example"
                  type="checkbox"
                  checked={useExample}
                  onChange={(e) => setUseExample(e.target.checked)}
                />
                <span className="toggle-ui" />
                <span className="toggle-label">Use example</span>
              </label>
            </div>

            <div className="field big-field">
              <div className="field-top">
                <div className="pill ghost">Paste here · Sample,Conc</div>
                <div className="muted">Detected: {samples.length || '—'} samples</div>
              </div>
              <textarea
                className="textarea large"
                placeholder="Sample,Conc\nSample1,178.2"
                value={useExample ? EXAMPLE_TEXT : sampleText}
                onChange={(e) => {
                  setUseExample(false)
                  setSampleText(e.target.value)
                }}
              />
              <div className="field-foot">
                <div>
                  <p className="help">Keep the header row. Volumes below {MIN_PIP} µl trigger pre-dilution suggestions.</p>
                  <p className="help">Supports pasted TSV/CSV from Excel or Sheets.</p>
                </div>
              </div>
            </div>

            <div className="preview">
              <div className="side-head">
                <p className="kicker">Example preview</p>
                <span className="pill ghost">example_data/samples.csv</span>
              </div>
              <div className="mini-table">
                <table>
                  <thead>
                    <tr>
                      <th>Sample</th>
                      <th>Conc (ng/µl)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {examplePreview.map((ex, idx) => (
                      <tr key={idx}>
                        <td>{ex.sample}</td>
                        <td>{ex.conc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="bullets">
                <li>Header required: Sample, RNA Conc.</li>
                <li>Order preserved; master mix row added automatically.</li>
                <li>Available RNA + H₂O per well: {AVAIL_RNA_H2O.toFixed(1)} µl.</li>
              </ul>
            </div>
          </section>

          <section className="card">
            <div className="section-head">
              <div>
                <p className="kicker">Step 2 · Set the run</p>
                <h2>Target + overage</h2>
                <p className="muted">Local calc mirrors the FastAPI backend; backend replaces results when reachable.</p>
              </div>
            </div>

            <div className="controls">
              <label className="control">
                <span>Target RNA (ng)</span>
                <input
                  type="number"
                  value={targetNg}
                  onChange={(e) => setTargetNg(parseFloat(e.target.value) || 0)}
                />
              </label>
              <label className="control">
                <span>Overage (%)</span>
                <input
                  type="number"
                  value={overagePct}
                  onChange={(e) => setOveragePct(parseFloat(e.target.value) || 0)}
                />
              </label>
              <div className="control readonly">
                <span>RNA + H₂O capacity</span>
                <strong>{AVAIL_RNA_H2O.toFixed(1)} µl</strong>
              </div>
            </div>

            <div className="stats-row">
              {stats.map((s) => (
                <div key={s.label} className="stat">
                  <p className="stat-label">{s.label}</p>
                  <p className="stat-value">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="cta-row">
              <div className="muted">Click calculate to fill the output and master-mix tabs. Exports mirror what you see.</div>
              <button
                onClick={handleCalculate}
                disabled={loading}
                data-testid="calculate-btn"
                className="primary"
              >
                {loading ? 'Calculating…' : 'Calculate volumes'}
              </button>
            </div>
          </section>
        </div>
      )}

      {tab === 'output' && (
        <div className="shell">
          <section className="card">
            <div className="section-head output-head">
              <div>
                <p className="kicker">Step 3 · Output table</p>
                <h2>Volumes, notes, and master mix row</h2>
              </div>
              <div className="output-meta">
                <span className={`pill ${backendUsed ? 'pill-ok' : 'pill-local'}`}>
                  Source: {backendUsed ? 'FastAPI' : 'Local calculation'}
                </span>
                {warning && <span className="pill warn">API unavailable</span>}
                <span className="pill ghost">Target {targetNg} ng · {overagePct}% overage · {samples.length} samples</span>
              </div>
              <div className="button-row">
                <button onClick={exportCsv} disabled={!rows.length} className="ghost">CSV</button>
                <button onClick={exportExcel} disabled={!rows.length} className="ghost">Excel</button>
                <button onClick={copyTsv} disabled={!rows.length} className="ghost">Copy TSV</button>
              </div>
            </div>

            {!rows.length && (
              <div className="empty">
                <p className="muted">No output yet. Paste samples, set target/overage, then click Calculate in the Plan tab.</p>
              </div>
            )}

            {rows.length > 0 && (
              <div className="table-wrap">
                <div className="table-scroll">
                  <table className="data">
                    <thead>
                      <tr>
                        {tableColumns.map((col) => (
                          <th key={col.key as string}>{col.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => (
                        <tr key={idx}>
                          {tableColumns.map((col) => (
                            <td key={col.key as string}>{row[col.key] === null ? '' : row[col.key]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-foot">
                  <span>{rows.length - 1} samples + master mix row</span>
                  <span>{`Pre-dilution suggestions appear when RNA volume < ${MIN_PIP} µl`}</span>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'master' && (
        <div className="shell">
          <section className="card">
            <div className="section-head">
              <div>
                <p className="kicker">Master mix totals</p>
                <h2>Build once for all reactions</h2>
              </div>
              <span className="pill ghost">{masterMix ? `${masterMix.n_total} reactions` : 'Run a calculation first'}</span>
            </div>

            {masterMix ? (
              <div className="reagents">
                {reagentCards.map((reagent) => (
                  <div key={reagent.label} className="reagent-card">
                    <p className="muted">{reagent.label}</p>
                    <p className="big">{reagent.value} µl / rxn</p>
                    <p className="muted">{reagent.total} µl total</p>
                  </div>
                ))}
                <div className="reagent-card highlight">
                  <p className="muted">Overage applied</p>
                  <p className="big">{overagePct}%</p>
                  <p className="muted">Samples: {masterMix.n_samples}</p>
                </div>
              </div>
            ) : (
              <div className="empty">
                <p className="muted">Run a calculation in the Plan tab to see master mix totals.</p>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'notes' && (
        <div className="shell">
          <section className="card notes">
            <div className="section-head">
              <div>
                <p className="kicker">Notes & rules</p>
                <h2>How this app behaves</h2>
              </div>
            </div>
            <ul className="bullets">
              <li>Pre-dilution recipes surface automatically when RNA volume is below {MIN_PIP} µl; follow the recipe, then add the diluted aliquot.</li>
              <li>Available RNA + H₂O per well: {AVAIL_RNA_H2O.toFixed(1)} µl; final volume is fixed to {FINAL_VOL} µl.</li>
              <li>Master mix row includes the overage you set to give pipetting headroom.</li>
              <li>Exports (CSV, Excel, TSV) mirror the output table, including the master mix row.</li>
              <li>Local calculation mirrors the FastAPI backend; backend results replace local when reachable.</li>
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
