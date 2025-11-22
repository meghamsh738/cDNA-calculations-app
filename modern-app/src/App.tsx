import { useEffect, useMemo, useState } from 'react'
import exampleCsv from '../example_data/samples.csv?raw'

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

function App() {
  const [sampleText, setSampleText] = useState(EXAMPLE_TEXT)
  const [useExample, setUseExample] = useState(true)
  const [targetNg, setTargetNg] = useState(200)
  const [overagePct, setOveragePct] = useState(10)
  const [rows, setRows] = useState<CalcRow[]>([])
  const [masterMix, setMasterMix] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const samples = useMemo(() => (useExample ? parseSamples(EXAMPLE_TEXT) : parseSamples(sampleText)), [useExample, sampleText])

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
      if (!response.ok) throw new Error('Failed to process data')
      const data = await response.json()
      setRows(data.rows || [])
      setMasterMix(data.master_mix || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate')
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <header className="text-center mb-10">
          <h1 className="text-5xl font-extrabold bg-gradient-to-r from-blue-700 to-indigo-600 bg-clip-text text-transparent mb-3">
            cDNA Calculations
          </h1>
          <p className="text-gray-600 text-lg max-w-3xl mx-auto">
            Paste sample concentrations, set a target ng, and get pipetting volumes + master mix totals. Includes predilution tips when the RNA volume is too small.
          </p>
        </header>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <strong>Error:</strong> {error}
            <button onClick={() => setError(null)} className="ml-4 text-red-900 underline">Dismiss</button>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-8">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Input</h2>

            <div className="flex items-center justify-between mb-3">
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
                <input
                  type="checkbox"
                  className="w-5 h-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  checked={useExample}
                  onChange={(e) => setUseExample(e.target.checked)}
                />
                Use Example Data
              </label>
              <button
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded"
                onClick={() => {
                  setUseExample(false)
                  setSampleText('')
                }}
              >
                Clear
              </button>
            </div>

            <textarea
              className="w-full h-40 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm resize-none"
              placeholder="Sample,Conc\nSample1,178.2"
              value={useExample ? EXAMPLE_TEXT : sampleText}
              onChange={(e) => {
                setUseExample(false)
                setSampleText(e.target.value)
              }}
            />
            <p className="text-xs text-gray-500 mt-2">Two columns: Sample name and concentration (ng/µl). Tab, comma, or space separated.</p>

            <div className="grid grid-cols-2 gap-4 mt-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Target RNA (ng)</label>
                <input
                  type="number"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={targetNg}
                  onChange={(e) => setTargetNg(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Mix overage (%)</label>
                <input
                  type="number"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={overagePct}
                  onChange={(e) => setOveragePct(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            <button
              onClick={handleCalculate}
              disabled={loading}
              data-testid="calculate-btn"
              className="mt-6 w-full bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-semibold py-3 px-6 rounded-lg hover:from-indigo-700 hover:to-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Calculating...' : 'Calculate Volumes'}
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-800">Output</h2>
              <div className="flex gap-2">
                <button
                  onClick={exportCsv}
                  disabled={!rows.length}
                  className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded disabled:opacity-50"
                >
                  Export CSV
                </button>
                <button
                  onClick={exportExcel}
                  disabled={!rows.length}
                  className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded disabled:opacity-50"
                >
                  Export Excel
                </button>
                <button
                  onClick={copyTsv}
                  disabled={!rows.length}
                  className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded disabled:opacity-50"
                >
                  Copy TSV
                </button>
              </div>
            </div>

            {!rows.length && <p className="text-sm text-gray-500">No output yet. Paste samples and click Calculate.</p>}

            {rows.length > 0 && (
              <div className="overflow-auto border border-gray-200 rounded-lg">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {Object.keys(rows[0]).filter(k => k !== '_order').map(key => (
                        <th key={key} className="px-3 py-2 text-left font-semibold text-gray-700 border-b">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        {Object.entries(row).filter(([k]) => k !== '_order').map(([k, v]) => (
                          <td key={k} className="px-3 py-2 border-b text-gray-800">{v === null ? '' : v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {masterMix && (
              <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-lg p-4 text-sm text-indigo-900">
                <div className="font-semibold mb-2">Master mix totals ({overagePct}% overage)</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <span>10x buffer: {masterMix['10x buffer']} µl</span>
                  <span>dNTPs: {masterMix['dNTPs']} µl</span>
                  <span>Random primers: {masterMix['Random primers']} µl</span>
                  <span>Enzyme: {masterMix['Enzyme']} µl</span>
                  <span>Total reactions: {masterMix['n_total']}</span>
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
