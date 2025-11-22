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

const FIXED = { buffer: 2.0, dntps: 0.8, rand: 2.0, enzyme: 1.0 }
const FINAL_VOL = 20.0
const AVAIL_RNA_H2O = FINAL_VOL - (FIXED.buffer + FIXED.dntps + FIXED.rand + FIXED.enzyme)
const MIN_PIP = 0.5

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

  const samples = useMemo(() => (useExample ? parseSamples(EXAMPLE_TEXT) : parseSamples(sampleText)), [useExample, sampleText])
  const examplePreview = useMemo(() => parseSamples(EXAMPLE_TEXT).slice(0, 3), [])

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

  const tableColumns: { key: keyof CalcRow; label: string }[] = [
    { key: 'Sample', label: 'Sample' },
    { key: 'RNA Conc (ng/µl)', label: 'Conc (ng/µl)' },
    { key: 'RNA Volume (µl)', label: 'RNA Vol (µl)' },
    { key: 'H2O (µl)', label: 'H₂O (µl)' },
    { key: 'final volume (µl)', label: 'Final Vol (µl)' },
    { key: 'Achievable RNA (ng)', label: 'Achievable (ng)' },
    { key: 'Note', label: 'Notes' }
  ]

  return (
    <div className="app-bg min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
        <header className="hero-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3 max-w-3xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs tracking-wide uppercase border border-white/20">
                cDNA Mix Planner
              </div>
              <h1 className="text-4xl sm:text-5xl font-black text-white drop-shadow">
                Fast RT mix calculations
              </h1>
              <p className="text-indigo-100 text-lg">
                Paste sample concentrations, set a target ng, and get pipetting volumes, pre-dilution tips, and master-mix totals.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="pill pill-light">20 µl final</span>
                <span className="pill pill-light">0.5 µl min pipet</span>
                <span className="pill pill-light">10% overage default</span>
              </div>
            </div>
            <div className="mini-card">
              <div className="text-xs uppercase tracking-wide text-indigo-200">Fixed reagents (µl)</div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-sm text-white">
                <span>10x buffer: <strong>{FIXED.buffer}</strong></span>
                <span>dNTPs: <strong>{FIXED.dntps}</strong></span>
                <span>Rand primers: <strong>{FIXED.rand}</strong></span>
                <span>Enzyme: <strong>{FIXED.enzyme}</strong></span>
              </div>
              <div className="mt-3 text-xs text-indigo-100">Available RNA + H₂O: {AVAIL_RNA_H2O.toFixed(1)} µl</div>
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-800 flex items-center justify-between">
            <span><strong>Error:</strong> {error}</span>
            <button onClick={() => setError(null)} className="underline text-red-900 text-sm">Dismiss</button>
          </div>
        )}
        {warning && !error && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 flex items-center justify-between">
            <span>{warning}</span>
            <button onClick={() => setWarning(null)} className="underline text-amber-900 text-sm">Dismiss</button>
          </div>
        )}

        <div className="sticky top-3 z-20 flex flex-wrap items-center gap-3 px-4 py-3 rounded-2xl border border-slate-200 bg-white/90 shadow-md">
          <div className="flex items-center gap-3">
            <div className="form-chip">
              <label className="text-xs text-slate-500">Target (ng)</label>
              <input
                type="number"
                className="chip-input"
                value={targetNg}
                onChange={(e) => setTargetNg(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="form-chip">
              <label className="text-xs text-slate-500">Overage (%)</label>
              <input
                type="number"
                className="chip-input"
                value={overagePct}
                onChange={(e) => setOveragePct(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="pill-btn text-xs">Available RNA+H₂O: {AVAIL_RNA_H2O.toFixed(1)} µl</div>
          </div>
          <div className="flex-1" />
          <button
            onClick={handleCalculate}
            disabled={loading}
            data-testid="calculate-btn"
            className="px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-semibold shadow-md hover:from-indigo-700 hover:to-blue-700 transition-all disabled:opacity-50"
          >
            {loading ? 'Calculating…' : 'Calculate volumes'}
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="glass-card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Input samples</h2>
                <p className="text-sm text-slate-500">Header required. Delimiter auto-detected.</p>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  className="w-5 h-5 accent-indigo-600"
                  checked={useExample}
                  onChange={(e) => setUseExample(e.target.checked)}
                />
                Use example
              </label>
            </div>

            <div className="grid md:grid-cols-2 gap-4 items-start">
              <textarea
                className="w-full h-44 px-4 py-3 rounded-xl border border-slate-200 bg-white/80 shadow-inner focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm"
                placeholder="Sample,Conc\nSample1,178.2"
                value={useExample ? EXAMPLE_TEXT : sampleText}
                onChange={(e) => {
                  setUseExample(false)
                  setSampleText(e.target.value)
                }}
              />
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 space-y-2">
                <div className="font-semibold text-slate-900 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" /> Quick guide
                </div>
                <ul className="list-disc list-inside space-y-1">
                  <li>Accepted columns: <strong>Sample</strong>, <strong>RNA Conc</strong></li>
                  <li>Delimiter auto-detected (tab/comma/space)</li>
                  <li>Header required; order preserved</li>
                  <li>Example preview:</li>
                </ul>
                <div className="rounded-lg border border-slate-200 bg-white text-xs overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-2 py-1 text-left">Sample</th>
                        <th className="px-2 py-1 text-left">Conc</th>
                      </tr>
                    </thead>
                    <tbody>
                      {examplePreview.map((ex, idx) => (
                        <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="px-2 py-1">{ex.sample}</td>
                          <td className="px-2 py-1">{ex.conc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-center">
                  <div className="text-xs uppercase tracking-wide text-slate-500">{s.label}</div>
                  <div className="text-lg font-semibold text-slate-900">{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Output</h2>
                <p className="text-sm text-slate-500">Volumes, pre-dilution notes, master mix.</p>
                <p className="text-xs text-slate-500 mt-1">
                  Source: {backendUsed ? 'API' : 'Local calc'} {warning && '(API unavailable)'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={exportCsv} disabled={!rows.length} className="pill-btn">CSV</button>
                <button onClick={exportExcel} disabled={!rows.length} className="pill-btn">Excel</button>
                <button onClick={copyTsv} disabled={!rows.length} className="pill-btn">Copy TSV</button>
              </div>
            </div>

            {!rows.length && <p className="text-sm text-slate-500">No output yet. Paste samples and click Calculate.</p>}

            {rows.length > 0 && (
              <div className="grid md:grid-cols-3 gap-4">
                <div className="col-span-2 space-y-3">
                  <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                    <div className="table-scroll">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-100 sticky top-0">
                          <tr>
                            {tableColumns.map((col) => (
                              <th key={col.key as string} className="px-3 py-2 text-left font-semibold text-slate-700 border-b">{col.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, idx) => (
                            <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                              {tableColumns.map((col) => (
                                <td key={col.key as string} className="px-3 py-2 border-b text-slate-800 text-sm">
                                  {row[col.key] === null ? '' : row[col.key]}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 shadow-inner">
                    <div className="font-semibold mb-1">Master mix totals ({overagePct}% overage)</div>
                    {masterMix ? (
                      <div className="space-y-1">
                        <div>10x buffer: {masterMix['10x buffer']} µl</div>
                        <div>dNTPs: {masterMix['dNTPs']} µl</div>
                        <div>Random primers: {masterMix['Random primers']} µl</div>
                        <div>Enzyme: {masterMix['Enzyme']} µl</div>
                        <div>Total reactions: {masterMix['n_total']}</div>
                      </div>
                    ) : (
                      <div className="text-indigo-700">Run a calculation to see totals.</div>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 shadow-inner space-y-2">
                    <div className="font-semibold text-slate-900">Notes</div>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Volumes below {MIN_PIP} µl trigger pre-dilution suggestions.</li>
                      <li>Available RNA + H₂O per well: {AVAIL_RNA_H2O.toFixed(1)} µl.</li>
                      <li>Master mix includes overage for pipetting safety.</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
