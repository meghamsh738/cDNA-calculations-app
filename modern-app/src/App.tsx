import { useEffect, useMemo, useState } from 'react'
import {
  Clipboard,
  Download,
  FlaskConical,
  RefreshCw,
  Settings,
  Table
} from 'lucide-react'
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

type AppPaths = {
  dataPath: string
  attachmentsPath: string
  exportsPath: string
  syncPath: string
}

type ElectronAPI = {
  selectDirectory: (options?: { title?: string; defaultPath?: string }) => Promise<string | null>
  ensureDirectories: (paths: Record<string, string>) => Promise<{ ok: boolean; message?: string }>
  getAppInfo: () => Promise<{ name: string; version: string; platform?: string }>
  getDefaultPaths: () => Promise<AppPaths>
}

const EXAMPLE_TEXT = exampleCsv.trim()
const FIXED = { buffer: 2.0, dntps: 0.8, rand: 2.0, enzyme: 1.0 }
const FINAL_VOL = 20.0
const AVAIL_RNA_H2O = FINAL_VOL - (FIXED.buffer + FIXED.dntps + FIXED.rand + FIXED.enzyme)
const MIN_PIP = 0.5
const STORAGE_KEY = 'easylab:cdna:paths'
const resolveApiBase = () => {
  if (typeof window === 'undefined') return undefined
  const params = new URLSearchParams(window.location.search)
  const queryBase = params.get('apiBase') ?? undefined
  const injected = (window as Window & { __EASYLAB_API__?: string }).__EASYLAB_API__
  return injected ?? queryBase
}

const API_BASE = resolveApiBase() ?? import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8003'

const PATH_FIELDS: Array<{ key: keyof AppPaths; label: string; helper: string }> = [
  { key: 'dataPath', label: 'Data folder', helper: 'Saved calculations, cached state, and metadata.' },
  { key: 'attachmentsPath', label: 'Attachments folder', helper: 'Files generated or stored with this workspace.' },
  { key: 'exportsPath', label: 'Exports folder', helper: 'CSV / Excel export destination.' },
  { key: 'syncPath', label: 'Sync folder', helper: 'Optional sync target for backups.' },
]

const fallbackPaths = (): AppPaths => ({
  dataPath: 'Easylab/cDNA/data',
  attachmentsPath: 'Easylab/cDNA/attachments',
  exportsPath: 'Easylab/cDNA/exports',
  syncPath: 'Easylab/cDNA/sync',
})

const readStoredPaths = (): AppPaths | null => {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AppPaths>
    if (!parsed || typeof parsed !== 'object') return null
    return {
      dataPath: parsed.dataPath ?? '',
      attachmentsPath: parsed.attachmentsPath ?? '',
      exportsPath: parsed.exportsPath ?? '',
      syncPath: parsed.syncPath ?? '',
    }
  } catch {
    return null
  }
}

const persistPaths = (paths: AppPaths) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(paths))
}

const getElectronAPI = (): ElectronAPI | null => {
  if (typeof window === 'undefined') return null
  return (window as typeof window & { electronAPI?: ElectronAPI }).electronAPI ?? null
}

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
  const [storedPaths] = useState(() => readStoredPaths())
  const [paths, setPaths] = useState<AppPaths>(() => storedPaths ?? fallbackPaths())
  const [defaultPaths, setDefaultPaths] = useState<AppPaths>(() => storedPaths ?? fallbackPaths())
  const [setupOpen, setSetupOpen] = useState(() => !storedPaths)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [savingSetup, setSavingSetup] = useState(false)
  const [appInfo, setAppInfo] = useState<{ name: string; version: string } | null>(null)

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

  useEffect(() => {
    let active = true
    const api = getElectronAPI()
    if (!storedPaths && api?.getDefaultPaths) {
      api.getDefaultPaths().then((defaults: AppPaths) => {
        if (!active) return
        setDefaultPaths(defaults)
        setPaths(defaults)
      }).catch(() => {})
    }
    if (api?.getAppInfo) {
      api.getAppInfo().then((info: { name: string; version: string }) => {
        if (!active) return
        setAppInfo(info)
      }).catch(() => {})
    }
    return () => {
      active = false
    }
  }, [storedPaths])

  const updatePath = (key: keyof AppPaths, value: string) => {
    setPaths((prev) => ({ ...prev, [key]: value }))
  }

  const handlePick = async (key: keyof AppPaths, label: string) => {
    const api = getElectronAPI()
    if (!api?.selectDirectory) return
    const selection = await api.selectDirectory({ title: `Select ${label}`, defaultPath: paths[key] })
    if (selection) updatePath(key, selection)
  }

  const handleUseDefaults = () => {
    setPaths(defaultPaths)
    setSetupError(null)
  }

  const ensureDirectories = async (nextPaths: AppPaths) => {
    const api = getElectronAPI()
    if (api?.ensureDirectories) {
      return api.ensureDirectories(nextPaths)
    }
    return { ok: true }
  }

  const handleFinishSetup = async () => {
    setSetupError(null)
    setSavingSetup(true)
    try {
      const trimmed: AppPaths = {
        dataPath: paths.dataPath.trim(),
        attachmentsPath: paths.attachmentsPath.trim(),
        exportsPath: paths.exportsPath.trim(),
        syncPath: paths.syncPath.trim(),
      }
      const missing = Object.entries(trimmed).filter(([, value]) => !value)
      if (missing.length) {
        setSetupError('Please fill all paths before finishing setup.')
        setSavingSetup(false)
        return
      }
      const result = await ensureDirectories(trimmed)
      if (!result?.ok) {
        setSetupError(result?.message || 'Unable to create folders.')
        setSavingSetup(false)
        return
      }
      persistPaths(trimmed)
      setSetupOpen(false)
      setSettingsOpen(false)
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Setup failed.')
    } finally {
      setSavingSetup(false)
    }
  }

  const isDesktop = typeof window !== 'undefined' && !!getElectronAPI()

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
      const response = await fetch(`${API_BASE}/calculate`, {
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
    const keys = tableColumns.map(col => col.key)
    const lines = [tableColumns.map(col => col.label).join(',')]
    rows.forEach(row => {
      lines.push(keys.map(key => String(row[key] ?? '')).join(','))
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
      const response = await fetch(`${API_BASE}/export-excel`, {
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
    const keys = tableColumns.map(col => col.key)
    const lines = [tableColumns.map(col => col.label).join('\t')]
    rows.forEach(row => {
      lines.push(keys.map(key => String(row[key] ?? '')).join('\t'))
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
    <div className="app-bg">
      {setupOpen && (
        <div className="modal-overlay" data-testid="setup-overlay">
          <div className="modal setup-modal">
            <div className="modal-head">
              <div>
                <p className="eyebrow">First run setup</p>
                <h2>Choose storage folders</h2>
                <p className="muted">
                  These folders keep exports, attachments, and sync data together. You can edit them later in Settings.
                </p>
              </div>
              <span className="pill soft">Required</span>
            </div>

            <div className="modal-grid">
              {PATH_FIELDS.map((field) => (
                <label key={field.key} className="field">
                  <span className="eyebrow">{field.label}</span>
                  <div className="field-row">
                    <input
                      value={paths[field.key]}
                      onChange={(event) => updatePath(field.key, event.target.value)}
                      placeholder={defaultPaths[field.key]}
                      data-testid={`path-${field.key}`}
                    />
                    {isDesktop && (
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => handlePick(field.key, field.label)}
                      >
                        Browse
                      </button>
                    )}
                  </div>
                  <span className="muted tiny">{field.helper}</span>
                </label>
              ))}
            </div>

            {setupError && <div className="setup-message error" role="alert">{setupError}</div>}
            {!isDesktop && (
              <div className="setup-message">
                Folder creation runs automatically in the desktop app. In the web build, paths are stored for reference.
              </div>
            )}

            <div className="modal-actions">
              <button className="ghost" type="button" onClick={handleUseDefaults}>
                Use defaults
              </button>
              <button
                className="accent"
                type="button"
                onClick={handleFinishSetup}
                data-testid="setup-finish"
                disabled={savingSetup}
              >
                {savingSetup ? 'Saving…' : 'Finish setup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-overlay" data-testid="settings-overlay">
          <div className="modal settings-modal">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Settings</p>
                <h2>Storage paths</h2>
                <p className="muted">Update where this app stores outputs and sync content.</p>
              </div>
              <button className="ghost" type="button" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
            </div>

            <div className="modal-grid">
              {PATH_FIELDS.map((field) => (
                <label key={field.key} className="field">
                  <span className="eyebrow">{field.label}</span>
                  <div className="field-row">
                    <input
                      value={paths[field.key]}
                      onChange={(event) => updatePath(field.key, event.target.value)}
                      placeholder={defaultPaths[field.key]}
                    />
                    {isDesktop && (
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => handlePick(field.key, field.label)}
                      >
                        Browse
                      </button>
                    )}
                  </div>
                  <span className="muted tiny">{field.helper}</span>
                </label>
              ))}
            </div>

            <div className="about-card">
              <div className="section-title">About</div>
              <p className="muted">Easylab cDNA Calculations</p>
              <p className="muted tiny">Version: {appInfo?.version ?? 'Web build'}</p>
              <p className="muted tiny">License: All Rights Reserved.</p>
            </div>

            <div className="modal-actions">
              <button className="ghost" type="button" onClick={handleUseDefaults}>
                Reset to defaults
              </button>
              <button className="accent" type="button" onClick={handleFinishSetup}>
                Save settings
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="panel">
        <div className="lab-head">
          <div>
            <p className="eyebrow">cDNA planner</p>
            <h2>RT mix calculations without guesswork</h2>
            <p className="muted">
              Paste concentrations, set a target ng + overage, and get pipetting volumes, pre-dilution recipes, and master-mix totals.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`status-chip ${loading ? 'warning' : 'success'}`}>
              {loading ? 'Calculating' : 'Ready'}
            </span>
            <span className="pill soft">Final volume: {FINAL_VOL} µl</span>
            <span className="pill">Min pipet: {MIN_PIP} µl</span>
            <span className="pill">
              <FlaskConical className="icon" aria-hidden="true" />
              {AVAIL_RNA_H2O.toFixed(1)} µl RNA + H₂O capacity
            </span>
            <button className="ghost" type="button" onClick={() => setSettingsOpen(true)} data-testid="open-settings">
              <Settings className="icon" aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="panel" role="alert">
          <div className="lab-head">
            <div>
              <p className="eyebrow">Alert</p>
              <h2>Error</h2>
              <p className="muted">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="ghost">Dismiss</button>
          </div>
        </div>
      )}

      {warning && !error && (
        <div className="panel">
          <div className="lab-head">
            <div>
              <p className="eyebrow">Notice</p>
              <h2>Backend offline</h2>
              <p className="muted">{warning}</p>
            </div>
            <button onClick={() => setWarning(null)} className="ghost">Dismiss</button>
          </div>
        </div>
      )}

      <div className="app-shell">
        <aside className="panel sidebar">
          <div className="lab-head">
            <div>
              <p className="eyebrow">Inputs</p>
              <h2>Samples + Targets</h2>
              <p className="muted">Header required. Supports pasted TSV/CSV from Excel or Sheets.</p>
            </div>
            <button className="pill soft" onClick={() => setUseExample(true)} type="button">
              <RefreshCw className="icon" aria-hidden="true" />
              Sample
            </button>
          </div>

          <div className="sidebar-section">
            <div className="section-title">Samples</div>
            <div className="chip-row">
              <label className="pill soft">
                <input
                  type="checkbox"
                  checked={useExample}
                  onChange={(e) => setUseExample(e.target.checked)}
                />
                <span>Use example</span>
              </label>
              <span className="pill soft">Detected: {samples.length || '—'} samples</span>
            </div>
            <textarea
              className="data-textarea"
              placeholder="Sample,Conc\nSample1,178.2"
              aria-label="Sample concentration input"
              value={useExample ? EXAMPLE_TEXT : sampleText}
              onChange={(e) => {
                setUseExample(false)
                setSampleText(e.target.value)
              }}
            />
            <p className="muted tiny">Volumes below {MIN_PIP} µl trigger pre-dilution suggestions.</p>
          </div>

          <div className="sidebar-section">
            <div className="section-title">Targets</div>
            <div className="template-row">
              <label className="field">
                <span className="eyebrow">Target RNA (ng)</span>
                <input
                  type="number"
                  value={targetNg}
                  onChange={(e) => setTargetNg(parseFloat(e.target.value) || 0)}
                />
              </label>
              <label className="field">
                <span className="eyebrow">Overage (%)</span>
                <input
                  type="number"
                  value={overagePct}
                  onChange={(e) => setOveragePct(parseFloat(e.target.value) || 0)}
                />
              </label>
              <div className="template-card active">
                <p className="eyebrow">RNA + H₂O capacity</p>
                <p className="muted">{AVAIL_RNA_H2O.toFixed(1)} µl</p>
              </div>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-title">Actions</div>
            <div className="edit-actions">
              <button
                onClick={handleCalculate}
                disabled={loading}
                data-testid="calculate-btn"
                className="accent"
                type="button"
              >
                {loading ? 'Calculating…' : 'Calculate volumes'}
              </button>
              {rows.length > 0 && (
                <button onClick={copyTsv} className="ghost" type="button">
                  <Clipboard className="icon" aria-hidden="true" />
                  Copy TSV
                </button>
              )}
            </div>
            {rows.length > 0 && (
              <div className="template-row">
                <button onClick={exportCsv} className="ghost" type="button">
                  <Table className="icon" aria-hidden="true" />
                  CSV
                </button>
                <button onClick={exportExcel} className="ghost" type="button">
                  <Download className="icon" aria-hidden="true" />
                  Excel
                </button>
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <div className="section-title">Quick Stats</div>
            <div className="chip-row">
              {stats.map((s) => (
                <span key={s.label} className="pill soft">{s.label}: {s.value}</span>
              ))}
              <span className="pill">{backendUsed ? 'Source: FastAPI' : 'Source: Local'}</span>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-title">Sheet Helper</div>
            <div className="link-panel">
              <div className="field">
                <span className="muted tiny">Open your preferred chat, paste this prompt, get back a clean CSV, then paste it above.</span>
              </div>
              <div className="edit-actions">
                <a href="https://chat.openai.com/" target="_blank" rel="noreferrer" className="pill soft">ChatGPT</a>
                <a href="https://gemini.google.com/app" target="_blank" rel="noreferrer" className="pill soft">Gemini</a>
                <a href="https://grok.com/" target="_blank" rel="noreferrer" className="pill soft">Grok</a>
              </div>
              <pre className="data-textarea" aria-label="Formatting prompt">
                Convert my table to CSV with headers: Sample, Conc. Conc in ng/µL numeric; keep sample names as-is; no invented rows; output CSV text only.
              </pre>
            </div>
          </div>
        </aside>

        <section className="panel editor">
          <div className="editor-header">
            <div className="title-row">
              <h1>cDNA Mix Planner</h1>
              <span className={`status-chip ${rows.length ? 'success' : 'warning'}`}>
                {rows.length ? 'Output ready' : 'Waiting'}
              </span>
            </div>
            <div className="chip-row">
              <span className="pill soft">Samples: {samples.length}</span>
              <span className="pill soft">Target: {targetNg} ng</span>
              <span className="pill soft">Overage: {overagePct}%</span>
            </div>
          </div>

          <div className="editor-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`tab-button ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="editor-body">
            {tab === 'plan' && (
              <div className="results-grid">
                <div className="today-card">
                  <div className="today-head">
                    <div>
                      <h2>Fixed per reaction</h2>
                      <p className="muted tiny">Always included in the 20 µl final volume.</p>
                    </div>
                    <span className="pill soft">Final volume: {FINAL_VOL} µl</span>
                  </div>
                  <div className="template-row">
                    {reagentCards.map((reagent) => (
                      <div key={reagent.label} className="template-card active">
                        <p className="eyebrow">{reagent.label}</p>
                        <p className="muted">{reagent.value} µl / rxn</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="today-card">
                  <div className="today-head">
                    <div>
                      <h2>Example preview</h2>
                      <p className="muted tiny">First few rows from example_data/samples.csv.</p>
                    </div>
                    <span className="pill soft">Sample CSV</span>
                  </div>
                  <div className="table-wrap">
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
                </div>

                <div className="today-card">
                  <div className="today-head">
                    <div>
                      <h2>Rules & checks</h2>
                      <p className="muted tiny">Automatic safeguards while calculating volumes.</p>
                    </div>
                  </div>
                  <ul className="note-list">
                    <li>Pre-dilution recipes appear when RNA volume is below {MIN_PIP} µl.</li>
                    <li>Available RNA + H₂O per well: {AVAIL_RNA_H2O.toFixed(1)} µl.</li>
                    <li>Master mix row includes your overage to give pipetting headroom.</li>
                  </ul>
                </div>
              </div>
            )}

            {tab === 'output' && (
              <div className="results-grid">
                <div className="today-card">
                  <div className="today-head">
                    <div>
                      <h2>Output table</h2>
                      <p className="muted tiny">Volumes, notes, and master mix row.</p>
                    </div>
                    <span className="pill soft">
                      Source: {backendUsed ? 'FastAPI' : 'Local calculation'}
                    </span>
                  </div>

                  {!rows.length && (
                    <div className="empty">
                      <p className="muted">No output yet. Paste samples, set target/overage, then click Calculate.</p>
                    </div>
                  )}

                  {rows.length > 0 && (
                    <div className="table-wrap">
                      <table>
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
                  )}
                </div>
              </div>
            )}

            {tab === 'master' && (
              <div className="results-grid">
                <div className="today-card">
                  <div className="today-head">
                    <div>
                      <h2>Master mix totals</h2>
                      <p className="muted tiny">Build once for all reactions.</p>
                    </div>
                    <span className="pill soft">{masterMix ? `${masterMix.n_total} reactions` : 'Run a calculation first'}</span>
                  </div>

                  {masterMix ? (
                    <div className="template-row">
                      {reagentCards.map((reagent) => (
                        <div key={reagent.label} className="template-card active">
                          <p className="eyebrow">{reagent.label}</p>
                          <p className="muted">{reagent.total} µl total</p>
                        </div>
                      ))}
                      <div className="template-card active">
                        <p className="eyebrow">Overage applied</p>
                        <p className="muted">{overagePct}%</p>
                      </div>
                    </div>
                  ) : (
                    <div className="empty">
                      <p className="muted">Run a calculation in the Plan tab to see master mix totals.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'notes' && (
              <div className="results-grid">
                <div className="today-card">
                  <div className="today-head">
                    <div>
                      <h2>Notes & rules</h2>
                      <p className="muted tiny">How this app behaves.</p>
                    </div>
                  </div>
                  <ul className="note-list">
                    <li>Pre-dilution recipes surface automatically when RNA volume is below {MIN_PIP} µl.</li>
                    <li>Final volume is fixed to {FINAL_VOL} µl for every reaction.</li>
                    <li>Exports mirror the output table, including the master mix row.</li>
                    <li>Local calculation mirrors the FastAPI backend; backend results replace local when reachable.</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="signature" data-testid="signature">
        <span className="sig-primary">Made by Meghamsh Teja Konda</span>
        <span className="sig-dot" aria-hidden="true" />
        <a className="sig-link" href="mailto:meghamshteja555@gmail.com">
          meghamshteja555@gmail.com
        </a>
      </footer>
    </div>
  )
}

export default App
