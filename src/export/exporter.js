/**
 * exporter.js — Export orchestration results to Markdown, JSON, or HTML.
 *
 * Phase 4 addition.
 *
 * Usage:
 *   const exporter = require('./exporter');
 *   const md = exporter.toMarkdown({ task, mode, ranked, durationMs });
 *   fs.writeFileSync(filePath, md, 'utf8');
 */

const pkg = { name: 'AI Council', version: '6.0.0' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString();
}

function humanDuration(ms) {
  if (!ms) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function escMd(str) {
  return String(str || '').replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Markdown ────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}   opts.task
 * @param {string}   opts.mode
 * @param {string}   opts.taskType
 * @param {object[]} opts.ranked
 * @param {number}   opts.durationMs
 * @returns {string}
 */
function toMarkdown({ task, mode, taskType, ranked = [], durationMs }) {
  const lines = [];
  const passed = ranked.filter(r => r.success);

  lines.push(`# AI Council — Export`);
  lines.push(`> Generated: ${ts()}`);
  lines.push('');
  lines.push(`## Task`);
  lines.push('');
  lines.push(task || '');
  lines.push('');
  lines.push(`**Mode:** ${mode || '—'}  `);
  lines.push(`**Task type:** ${taskType || 'default'}  `);
  lines.push(`**Duration:** ${humanDuration(durationMs)}  `);
  lines.push(`**Responses:** ${passed.length}/${ranked.length} succeeded`);
  lines.push('');
  lines.push('---');
  lines.push('');

  ranked.forEach((r, i) => {
    const rankLabel = r.rank ? `#${r.rank}` : `#${i + 1}`;
    const score     = r.score != null ? ` · ${r.score}/100` : '';
    const time      = r.timeMs ? ` · ${humanDuration(r.timeMs)}` : '';
    const status    = r.success ? '✓' : '✗';

    lines.push(`## ${rankLabel} — ${escMd(r.label || r.provider)} ${status}${score}${time}`);
    lines.push('');

    if (r.breakdown) {
      const bd = Object.entries(r.breakdown)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
      lines.push(`*Scores: ${bd}*`);
      lines.push('');
    }

    if (r.error) {
      lines.push(`> ⚠️ Error: ${escMd(r.error)}`);
    } else if (r.text) {
      lines.push('```');
      lines.push(r.text);
      lines.push('```');
    } else {
      lines.push('*(no response)*');
    }
    lines.push('');
  });

  lines.push('---');
  lines.push(`*Exported by ${pkg.name} v${pkg.version}*`);

  return lines.join('\n');
}

// ─── JSON ────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @returns {string} — pretty-printed JSON
 */
function toJson({ task, mode, taskType, ranked = [], durationMs }) {
  const out = {
    exportedAt : ts(),
    tool       : `${pkg.name} v${pkg.version}`,
    task,
    mode,
    taskType,
    durationMs,
    summary    : {
      total   : ranked.length,
      passed  : ranked.filter(r => r.success).length,
      topScore: ranked[0]?.score ?? null,
      topLabel: ranked[0]?.label || ranked[0]?.provider || null,
    },
    results : ranked.map(r => ({
      rank      : r.rank,
      provider  : r.provider,
      label     : r.label,
      score     : r.score,
      breakdown : r.breakdown,
      success   : r.success,
      timeMs    : r.timeMs,
      text      : r.text,
      error     : r.error,
    })),
  };
  return JSON.stringify(out, null, 2);
}

// ─── HTML ────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @returns {string} — standalone HTML document
 */
function toHtml({ task, mode, taskType, ranked = [], durationMs }) {
  const passed = ranked.filter(r => r.success);

  const cardHtml = ranked.map((r, i) => {
    const rank   = r.rank || i + 1;
    const score  = r.score != null ? r.score : null;
    const time   = r.timeMs ? humanDuration(r.timeMs) : '';
    const isBest = i === 0 && r.success;

    const breakdownHtml = r.breakdown
      ? Object.entries(r.breakdown).map(([k, v]) =>
          `<span class="bd">${escHtml(k[0].toUpperCase())}: ${escHtml(String(v))}</span>`
        ).join('')
      : '';

    const contentHtml = r.error
      ? `<div class="error">⚠️ ${escHtml(r.error)}</div>`
      : r.text
        ? `<pre class="response-text">${escHtml(r.text)}</pre>`
        : '<div class="empty">No response</div>';

    return `
    <div class="card ${isBest ? 'best' : ''} ${r.success ? '' : 'failed'}">
      <div class="card-header">
        <span class="rank">#${rank}</span>
        <span class="label">${escHtml(r.label || r.provider)}</span>
        ${score != null ? `<span class="score">${score}/100</span>` : ''}
        ${time ? `<span class="time">${escHtml(time)}</span>` : ''}
        ${r.success ? '' : '<span class="fail-badge">failed</span>'}
      </div>
      ${score != null ? `<div class="score-bar"><div class="score-fill" style="width:${score}%"></div></div>` : ''}
      ${breakdownHtml ? `<div class="breakdown">${breakdownHtml}</div>` : ''}
      ${contentHtml}
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Council Export — ${escHtml(task ? task.slice(0, 60) : 'Results')}</title>
  <style>
    :root { --bg:#0f0f1a; --surface:#1a1a2e; --accent:#a78bfa; --green:#34d399; --red:#f87171; --text:#e2e8f0; --muted:rgba(255,255,255,.45); }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family: system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); padding:32px; line-height:1.5; }
    h1 { font-size:1.6rem; font-weight:700; color:var(--accent); margin-bottom:4px; }
    .meta { color:var(--muted); font-size:.85em; margin-bottom:24px; }
    .meta strong { color:var(--text); }
    .task-box { background:var(--surface); border-radius:10px; padding:16px; margin-bottom:28px; font-size:.95em; white-space:pre-wrap; border-left:3px solid var(--accent); }
    .summary { display:flex; gap:16px; margin-bottom:28px; flex-wrap:wrap; }
    .stat { background:var(--surface); border-radius:8px; padding:10px 18px; }
    .stat-val { font-size:1.4rem; font-weight:700; color:var(--accent); }
    .stat-lbl { font-size:.72em; color:var(--muted); }
    .cards { display:flex; flex-direction:column; gap:16px; }
    .card { background:var(--surface); border-radius:12px; padding:18px; border:1px solid rgba(255,255,255,.08); }
    .card.best { border-color:var(--accent); }
    .card.failed { opacity:.7; }
    .card-header { display:flex; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap; }
    .rank { font-size:.85em; color:var(--muted); }
    .label { font-weight:600; font-size:1rem; }
    .score { background:rgba(167,139,250,.2); color:var(--accent); padding:2px 8px; border-radius:6px; font-size:.78em; }
    .time  { color:var(--muted); font-size:.78em; }
    .fail-badge { background:rgba(248,113,113,.2); color:var(--red); padding:2px 8px; border-radius:6px; font-size:.78em; }
    .score-bar  { height:4px; background:rgba(255,255,255,.1); border-radius:2px; margin-bottom:10px; }
    .score-fill { height:100%; background:var(--accent); border-radius:2px; }
    .breakdown  { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
    .bd { background:rgba(255,255,255,.06); padding:2px 7px; border-radius:4px; font-size:.72em; color:var(--muted); }
    .response-text { font-size:.85em; white-space:pre-wrap; word-break:break-word; line-height:1.6; color:rgba(255,255,255,.82); background:rgba(0,0,0,.2); padding:14px; border-radius:8px; max-height:400px; overflow:auto; }
    .error { color:var(--red); font-size:.85em; }
    .empty { color:var(--muted); font-style:italic; font-size:.85em; }
    footer { margin-top:40px; color:var(--muted); font-size:.78em; text-align:center; }
  </style>
</head>
<body>
  <h1>🤖 AI Council — Export</h1>
  <div class="meta">Generated: ${escHtml(ts())} &nbsp;·&nbsp; <strong>${escHtml(pkg.name)} v${pkg.version}</strong></div>

  <div class="task-box">${escHtml(task || '')}</div>

  <div class="summary">
    <div class="stat"><div class="stat-val">${escHtml(mode || '—')}</div><div class="stat-lbl">Mode</div></div>
    <div class="stat"><div class="stat-val">${escHtml(taskType || 'default')}</div><div class="stat-lbl">Task Type</div></div>
    <div class="stat"><div class="stat-val">${passed.length}/${ranked.length}</div><div class="stat-lbl">Succeeded</div></div>
    ${durationMs ? `<div class="stat"><div class="stat-val">${escHtml(humanDuration(durationMs))}</div><div class="stat-lbl">Total Time</div></div>` : ''}
    ${ranked[0]?.score != null ? `<div class="stat"><div class="stat-val">${ranked[0].score}/100</div><div class="stat-lbl">Top Score</div></div>` : ''}
  </div>

  <div class="cards">
    ${cardHtml}
  </div>

  <footer>Exported by ${escHtml(pkg.name)} v${pkg.version}</footer>
</body>
</html>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

module.exports = { toMarkdown, toJson, toHtml };
