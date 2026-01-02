#!/usr/bin/env node

/**
 * Report Merger
 * 
 * Combines benchmark results with SIMD detector output to produce:
 * - final_report.json
 * - final_report.html
 * 
 * Also computes SIMD provenance (compiler vs explicit)
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BENCH_ROOT = dirname(__dirname)
const BENCH_OUT = join(BENCH_ROOT, 'bench_out')
const SIMD_OUT = join(BENCH_ROOT, 'simd_out')

async function loadJsonFile(path) {
  try {
    const content = await readFile(path, 'utf-8')
    return JSON.parse(content)
  } catch (err) {
    console.warn(`Warning: Could not load ${path}: ${err.message}`)
    return null
  }
}

async function loadSimdReports() {
  const reports = {}
  
  if (!existsSync(SIMD_OUT)) {
    console.warn('No simd_out directory found. Run simd-detect first.')
    return reports
  }
  
  const files = await readdir(SIMD_OUT)
  for (const file of files) {
    if (file.endsWith('.json')) {
      const path = join(SIMD_OUT, file)
      const report = await loadJsonFile(path)
      if (report && report.variant) {
        reports[report.variant] = report
      }
    }
  }
  
  return reports
}

function computeProvenance(simdReports) {
  const provenance = {
    functions: {},
    summary: {},
  }
  
  const scalarReport = simdReports['scalar']
  const autovecReport = simdReports['autovec']
  
  if (!scalarReport || !autovecReport) {
    console.warn('Need both scalar and autovec reports for provenance analysis')
    return provenance
  }
  
  // Build function lookup maps
  const scalarFuncs = new Map()
  const autovecFuncs = new Map()
  
  for (const func of scalarReport.functions) {
    const key = func.name || `func_${func.index}`
    scalarFuncs.set(key, func)
  }
  
  for (const func of autovecReport.functions) {
    const key = func.name || `func_${func.index}`
    autovecFuncs.set(key, func)
  }
  
  // Compute per-function provenance for each explicit variant
  for (const [variantName, report] of Object.entries(simdReports)) {
    if (variantName === 'scalar' || variantName === 'autovec') continue
    
    const variantProvenance = []
    
    for (const func of report.functions) {
      const key = func.name || `func_${func.index}`
      const scalarFunc = scalarFuncs.get(key)
      const autovecFunc = autovecFuncs.get(key)
      
      const simdScalar = scalarFunc?.simd_ops_total || 0
      const simdAutovec = autovecFunc?.simd_ops_total || 0
      const simdExplicit = func.simd_ops_total
      
      const compilerAdded = simdAutovec - simdScalar
      const explicitAdded = simdExplicit - simdAutovec
      
      variantProvenance.push({
        name: key,
        file: func.file,
        line: func.line,
        simd_scalar: simdScalar,
        simd_autovec: simdAutovec,
        simd_explicit: simdExplicit,
        compiler_added: compilerAdded,
        explicit_added: explicitAdded,
        simd_density: func.simd_density,
        op_breakdown: func.op_breakdown,
      })
    }
    
    provenance.functions[variantName] = variantProvenance
    
    // Compute variant summary
    const totalScalar = scalarReport.total_simd_ops
    const totalAutovec = autovecReport.total_simd_ops
    const totalExplicit = report.total_simd_ops
    
    provenance.summary[variantName] = {
      total_scalar: totalScalar,
      total_autovec: totalAutovec,
      total_explicit: totalExplicit,
      compiler_added: totalAutovec - totalScalar,
      explicit_added: totalExplicit - totalAutovec,
    }
  }
  
  return provenance
}

async function main() {
  console.log('Merging benchmark and SIMD reports...')
  
  // Ensure output directory exists
  await mkdir(BENCH_OUT, { recursive: true })
  
  // Load benchmark report
  const benchReport = await loadJsonFile(join(BENCH_OUT, 'report.json'))
  if (!benchReport) {
    console.error('No benchmark report found. Run bench.mjs first.')
    process.exit(1)
  }
  
  // Load SIMD reports
  const simdReports = await loadSimdReports()
  console.log(`Loaded ${Object.keys(simdReports).length} SIMD reports`)
  
  // Compute provenance
  const provenance = computeProvenance(simdReports)
  
  // Merge into final report
  const finalReport = {
    generated: new Date().toISOString(),
    benchmark: benchReport,
    simd: simdReports,
    provenance,
  }
  
  // Write JSON
  const jsonPath = join(BENCH_OUT, 'final_report.json')
  await writeFile(jsonPath, JSON.stringify(finalReport, null, 2))
  console.log(`Wrote ${jsonPath}`)
  
  // Generate HTML
  const html = generateFinalHtml(finalReport)
  const htmlPath = join(BENCH_OUT, 'final_report.html')
  await writeFile(htmlPath, html)
  console.log(`Wrote ${htmlPath}`)
}

function generateFinalHtml(report) {
  const variantNames = Object.keys(report.benchmark.variants)
  const benchNames = Object.keys(report.benchmark.benchmarks)
  const simdVariants = Object.keys(report.simd)
  
  // Benchmark results table
  const benchTables = benchNames.map(benchName => {
    const bench = report.benchmark.benchmarks[benchName]
    const lengths = Object.keys(bench.results[variantNames[0]] || {})
    
    return `
      <h3>${benchName}</h3>
      <p class="desc">${bench.description}</p>
      <table>
        <thead>
          <tr>
            <th>Variant</th>
            ${lengths.map(l => `<th>${l}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${variantNames.map(variant => {
            const data = bench.results[variant] || {}
            return `
              <tr>
                <td class="variant">${variant}</td>
                ${lengths.map(l => {
                  const d = data[l]
                  if (!d) return '<td>-</td>'
                  const speedup = d.speedup_vs_scalar
                  const cls = speedup > 1.1 ? 'faster' : speedup < 0.9 ? 'slower' : ''
                  return `<td class="${cls}">${d.median_ms.toFixed(3)}ms${speedup ? ` (${speedup.toFixed(2)}x)` : ''}</td>`
                }).join('')}
              </tr>`
          }).join('')}
        </tbody>
      </table>`
  }).join('')
  
  // SIMD density table
  const simdTable = simdVariants.length > 0 ? `
    <h3>SIMD Instruction Density</h3>
    <table>
      <thead>
        <tr>
          <th>Variant</th>
          <th>Total Ops</th>
          <th>SIMD Ops</th>
          <th>Density</th>
          <th>Top Opcodes</th>
        </tr>
      </thead>
      <tbody>
        ${simdVariants.map(v => {
          const s = report.simd[v]
          const topOps = Object.entries(s.opcode_summary)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([op, count]) => `${op}: ${count}`)
            .join(', ')
          return `
            <tr>
              <td class="variant">${v}</td>
              <td>${s.total_ops.toLocaleString()}</td>
              <td>${s.total_simd_ops.toLocaleString()}</td>
              <td>${(s.overall_simd_density * 100).toFixed(1)}%</td>
              <td class="opcodes">${topOps || '-'}</td>
            </tr>`
        }).join('')}
      </tbody>
    </table>` : ''
  
  // Provenance table
  const provenanceHtml = Object.keys(report.provenance.summary).length > 0 ? `
    <h3>SIMD Provenance (Compiler vs Explicit)</h3>
    <p class="desc">Shows where SIMD instructions originate: compiler autovectorization vs explicit intrinsics.</p>
    <table>
      <thead>
        <tr>
          <th>Variant</th>
          <th>Scalar</th>
          <th>Autovec</th>
          <th>Explicit</th>
          <th>Compiler Added</th>
          <th>Explicit Added</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(report.provenance.summary).map(([variant, p]) => `
          <tr>
            <td class="variant">${variant}</td>
            <td>${p.total_scalar}</td>
            <td>${p.total_autovec}</td>
            <td>${p.total_explicit}</td>
            <td class="${p.compiler_added > 0 ? 'highlight-compiler' : ''}">${p.compiler_added}</td>
            <td class="${p.explicit_added > 0 ? 'highlight-explicit' : ''}">${p.explicit_added}</td>
          </tr>`
        ).join('')}
      </tbody>
    </table>` : ''
  
  // Top SIMD functions
  const topFuncsHtml = simdVariants.length > 0 ? `
    <h3>Top SIMD-Dense Functions</h3>
    ${simdVariants.filter(v => report.simd[v].functions.length > 0).map(v => {
      const funcs = report.simd[v].functions.slice(0, 5)
      return `
        <h4>${v}</h4>
        <table class="compact">
          <thead>
            <tr>
              <th>Function</th>
              <th>File:Line</th>
              <th>SIMD Ops</th>
              <th>Density</th>
            </tr>
          </thead>
          <tbody>
            ${funcs.map(f => `
              <tr>
                <td class="mono">${f.name || `func_${f.index}`}</td>
                <td class="mono">${f.file ? `${f.file}:${f.line}` : '-'}</td>
                <td>${f.simd_ops_total}</td>
                <td>${(f.simd_density * 100).toFixed(1)}%</td>
              </tr>`
            ).join('')}
          </tbody>
        </table>`
    }).join('')}` : ''
  
  // Speedup chart (simple CSS bars)
  const speedupChart = benchNames.length > 0 ? `
    <h3>Speedup vs Scalar (Largest Length)</h3>
    <div class="chart-container">
      ${benchNames.map(benchName => {
        const bench = report.benchmark.benchmarks[benchName]
        const lengths = Object.keys(bench.results[variantNames[0]] || {})
        const maxLen = lengths[lengths.length - 1]
        
        return `
          <div class="chart-group">
            <div class="chart-label">${benchName} [${maxLen}]</div>
            ${variantNames.filter(v => v !== 'scalar').map(variant => {
              const data = bench.results[variant]?.[maxLen]
              const speedup = data?.speedup_vs_scalar || 1
              const width = Math.min(speedup * 25, 100)
              const color = speedup > 1.5 ? 'var(--green)' : speedup > 1.1 ? 'var(--blue)' : 'var(--gray)'
              return `
                <div class="bar-row">
                  <span class="bar-label">${variant}</span>
                  <div class="bar" style="width: ${width}%; background: ${color}"></div>
                  <span class="bar-value">${speedup.toFixed(2)}x</span>
                </div>`
            }).join('')}
          </div>`
      }).join('')}
    </div>` : ''
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WASM SIMD Benchmark Report</title>
  <style>
    :root {
      --bg: #0f0f0f;
      --surface: #1a1a1a;
      --surface2: #252525;
      --border: #333;
      --text: #e0e0e0;
      --dim: #888;
      --accent: #64b5f6;
      --green: #81c784;
      --red: #e57373;
      --blue: #64b5f6;
      --purple: #ba68c8;
      --orange: #ffb74d;
      --gray: #666;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 2rem;
    }
    
    h1 {
      font-size: 2rem;
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 0.5rem;
      letter-spacing: -0.5px;
    }
    
    .subtitle {
      color: var(--dim);
      margin-bottom: 2rem;
      font-size: 0.9rem;
    }
    
    h2 {
      font-size: 1.4rem;
      font-weight: 500;
      color: var(--text);
      margin: 2.5rem 0 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    
    h3 {
      font-size: 1.1rem;
      font-weight: 500;
      color: var(--accent);
      margin: 1.5rem 0 0.75rem;
    }
    
    h4 {
      font-size: 0.95rem;
      color: var(--dim);
      margin: 1rem 0 0.5rem;
    }
    
    .desc {
      color: var(--dim);
      font-size: 0.85rem;
      margin-bottom: 0.75rem;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
      border-radius: 8px;
      overflow: hidden;
      font-size: 0.85rem;
      margin-bottom: 1rem;
    }
    
    table.compact { font-size: 0.8rem; }
    
    th, td {
      padding: 0.6rem 0.75rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    
    th {
      background: var(--surface2);
      color: var(--accent);
      font-weight: 500;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    tr:last-child td { border-bottom: none; }
    tr:hover { background: rgba(255,255,255,0.02); }
    
    .variant { font-weight: 500; }
    .mono { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.8rem; }
    .opcodes { font-size: 0.75rem; color: var(--dim); }
    
    .faster { color: var(--green); }
    .slower { color: var(--red); }
    .highlight-compiler { color: var(--orange); font-weight: 500; }
    .highlight-explicit { color: var(--purple); font-weight: 500; }
    
    .chart-container {
      display: grid;
      gap: 1.5rem;
      margin-top: 1rem;
    }
    
    .chart-group {
      background: var(--surface);
      border-radius: 8px;
      padding: 1rem;
    }
    
    .chart-label {
      font-weight: 500;
      margin-bottom: 0.75rem;
      font-size: 0.9rem;
    }
    
    .bar-row {
      display: flex;
      align-items: center;
      margin: 0.4rem 0;
      font-size: 0.8rem;
    }
    
    .bar-label {
      width: 120px;
      flex-shrink: 0;
      color: var(--dim);
    }
    
    .bar {
      height: 18px;
      border-radius: 3px;
      min-width: 4px;
      transition: width 0.3s;
    }
    
    .bar-value {
      margin-left: 0.75rem;
      font-weight: 500;
      font-family: 'JetBrains Mono', monospace;
    }
    
    details {
      margin-top: 2rem;
      background: var(--surface);
      border-radius: 8px;
    }
    
    summary {
      padding: 1rem;
      cursor: pointer;
      color: var(--accent);
      font-weight: 500;
    }
    
    pre {
      padding: 1rem;
      overflow-x: auto;
      font-size: 0.7rem;
      color: var(--dim);
      font-family: 'JetBrains Mono', monospace;
    }
    
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 1rem;
    }
    
    @media (max-width: 600px) {
      body { padding: 1rem; }
      .bar-label { width: 80px; font-size: 0.7rem; }
    }
  </style>
</head>
<body>
  <h1>WASM SIMD Benchmark Report</h1>
  <p class="subtitle">Generated: ${report.generated}</p>
  
  <h2>Performance Results</h2>
  ${benchTables}
  
  ${speedupChart}
  
  <h2>SIMD Analysis</h2>
  ${simdTable}
  
  ${provenanceHtml}
  
  ${topFuncsHtml}
  
  <details>
    <summary>Raw JSON Data</summary>
    <pre>${JSON.stringify(report, null, 2)}</pre>
  </details>
</body>
</html>`
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
