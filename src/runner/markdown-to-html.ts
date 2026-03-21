/**
 * Markdown → HTML converter for migration and estate reports.
 *
 * Features:
 *   - Dark gradient hero with animated SVG score ring
 *   - Grade-aware colour theme — B = Microsoft Azure blue = GOOD
 *   - Collapsible <details> sections with smooth JS animation
 *   - Sticky quick-nav pill strip inside hero
 *   - Severity-coloured h3 headings (🔴/🟠/🟡)
 *   - 2-column key/value table styling
 *   - Print / PDF optimised layout
 *   - Zero external dependencies
 */

// ─── Grade palette ────────────────────────────────────────────────────────────

const GRADE_HEX: Record<string, string> = {
  A: '#0ead6a',  // vibrant green
  B: '#0078d4',  // Microsoft Azure blue — a B is a GOOD score
  C: '#d98c00',  // amber
  D: '#da3b01',  // orange-red
  F: '#d13438',  // red
};

// ─── Section icons ────────────────────────────────────────────────────────────

const SECTION_ICONS: Record<string, string> = {
  'Executive Summary':            '📋',
  'Integration Patterns':         '🔄',
  'Gap Analysis':                 '⚠️',
  'Architecture Recommendation':  '🏗️',
  'Generated Artifacts':          '📦',
  'Quality Report':               '⭐',
  'Actionable Fix List':          '🔧',
  'Warnings':                     '💬',
  'Non-Fatal Errors':             '❌',
  'Getting Started':              '🚀',
  'Manual Next Steps':            '📝',
  'Deployment':                   '☁️',
  'Estate Overview':              '🏢',
  'Complexity Distribution':      '📊',
  'Application Inventory':        '📋',
  'Migration Waves':              '🌊',
  'Adapter Inventory':            '🔌',
  'Gap Heat Map':                 '🗺️',
  'Infrastructure Requirements':  '🏗️',
  'Effort Summary':               '⏱️',
  'Parse Failures':               '❌',
  'BizTalk Architecture':         '🗺️',
  'Logic Apps Architecture':      '🏗️',
};

// Sections open by default
const AUTO_OPEN = new Set([
  'Executive Summary',
  'Quality Report',
  'Estate Overview',
  'Application Inventory',
  'Integration Patterns',
]);

// ─── Public API ───────────────────────────────────────────────────────────────

export function migrationReportToHtml(markdown: string, appName: string): string {
  const meta     = parseMigrationMeta(markdown);
  const sections = extractSections(markdown);
  const hero     = buildMigrationHero(appName, meta, sections);
  const body     = convertMarkdown(markdown);
  const accent   = GRADE_HEX[meta.grade ?? 'B'] ?? GRADE_HEX['B']!;
  return htmlDocument(escHtml(`Migration Report — ${appName}`), hero, body, accent);
}

export function estateReportToHtml(markdown: string): string {
  const meta     = parseEstateMeta(markdown);
  const sections = extractSections(markdown);
  const hero     = buildEstateHero(meta, sections);
  const body     = convertMarkdown(markdown);
  return htmlDocument('BizTalk Estate Assessment Report', hero, body, GRADE_HEX['B']!);
}

// ─── Meta extraction ──────────────────────────────────────────────────────────

interface MigrationMeta {
  score?: number; grade?: string; date?: string; runtime?: string; mode?: string;
}
interface EstateMeta {
  apps?: number; orchs?: number; maps?: number; effort?: number; date?: string;
  criticalGaps?: number; highGaps?: number;
}
interface SectionInfo { title: string; id: string; icon: string; }

function parseMigrationMeta(md: string): MigrationMeta {
  const m: MigrationMeta = {};
  const qm = /(\d+)\/100 Grade ([A-F])/.exec(md);
  if (qm) { m.score = parseInt(qm[1]!); m.grade = qm[2]!; }
  const dm = /\*\*Date:\*\* ([\d-]+)/.exec(md);        if (dm) m.date    = dm[1]!;
  const rm = /\*\*Runtime:\*\* ([\d.]+s)/.exec(md);    if (rm) m.runtime = rm[1]!;
  const mm = /\*\*Mode:\*\* (\w+)/.exec(md);           if (mm) m.mode    = mm[1]!;
  return m;
}

function parseEstateMeta(md: string): EstateMeta {
  const m: EstateMeta = {};
  const am = /Applications assessed:\*\* (\d+)/.exec(md); if (am) m.apps   = parseInt(am[1]!);
  const em = /estimated effort:\*\* ~(\d+)/.exec(md);     if (em) m.effort = parseInt(em[1]!);
  const dm = /\*\*Date:\*\* ([\d-]+)/.exec(md);           if (dm) m.date   = dm[1]!;
  const or = /\| Orchestrations \| (\d+)/.exec(md);       if (or) m.orchs  = parseInt(or[1]!);
  const ma = /\| Maps \| (\d+)/.exec(md);                 if (ma) m.maps   = parseInt(ma[1]!);
  const cg = /Critical gaps \| 🔴 (\d+)/.exec(md);        if (cg) m.criticalGaps = parseInt(cg[1]!);
  const hg = /High gaps \| 🟠 (\d+)/.exec(md);            if (hg) m.highGaps     = parseInt(hg[1]!);
  return m;
}

function extractSections(md: string): SectionInfo[] {
  return md.split('\n')
    .filter(l => /^## /.test(l))
    .map(l => {
      const title = l.slice(3).trim();
      return {
        title,
        id:   'sec-' + title.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, ''),
        icon: SECTION_ICONS[title] ?? '📄',
      };
    });
}

// ─── Hero builders ────────────────────────────────────────────────────────────

function buildMigrationHero(appName: string, meta: MigrationMeta, sections: SectionInfo[]): string {
  const score  = meta.score ?? 0;
  const grade  = meta.grade ?? 'B';
  const color  = GRADE_HEX[grade] ?? GRADE_HEX['B']!;
  const circ   = 301.59; // 2π × 48
  const offset = (circ * (1 - score / 100)).toFixed(2);

  const ring = `
<div class="score-wrap">
  <svg class="score-ring" viewBox="0 0 110 110" aria-label="Score ${score}/100 Grade ${grade}">
    <circle cx="55" cy="55" r="48" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="9"/>
    <circle class="ring-arc" cx="55" cy="55" r="48" fill="none"
      stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${circ}" stroke-dashoffset="${circ}"
      data-target="${offset}" transform="rotate(-90 55 55)"/>
    <text x="55" y="50"  text-anchor="middle" fill="white"
      font-family="system-ui,-apple-system,sans-serif" font-weight="700" font-size="24">${score}</text>
    <text x="55" y="66" text-anchor="middle" fill="rgba(255,255,255,.55)"
      font-family="system-ui,-apple-system,sans-serif" font-size="11">/100</text>
    <text x="55" y="83" text-anchor="middle" fill="${color}"
      font-family="system-ui,-apple-system,sans-serif" font-weight="700" font-size="14">Grade ${grade}</text>
  </svg>
</div>`;

  const pills = [
    meta.date    ? `<span class="hero-pill">📅 ${escHtml(meta.date)}</span>`    : '',
    meta.runtime ? `<span class="hero-pill">⚡ ${escHtml(meta.runtime)}</span>` : '',
    meta.mode    ? `<span class="hero-pill">🔧 ${escHtml(meta.mode)}</span>`    : '',
  ].filter(Boolean).join('');

  const nav = sections.map(s =>
    `<a class="nav-chip" href="#${s.id}" onclick="jumpTo(event,'${s.id}')">${s.icon} ${escHtml(s.title)}</a>`
  ).join('');

  return `
<div class="hero" style="--grade-color:${color}">
  <button class="print-btn" onclick="window.print()">🖨 Export PDF</button>
  <div class="hero-body">
    <div class="hero-left">
      <div class="hero-eyebrow">BizTalk → Azure Logic Apps Standard</div>
      <div class="hero-title">${escHtml(appName)}</div>
      <div class="hero-pills">${pills}</div>
    </div>
    ${ring}
  </div>
  <nav class="section-nav" aria-label="Sections">${nav}</nav>
</div>`;
}

function buildEstateHero(meta: EstateMeta, sections: SectionInfo[]): string {
  const stats = [
    { n: meta.apps   ?? 0, label: 'Applications'   },
    { n: meta.orchs  ?? 0, label: 'Orchestrations'  },
    { n: meta.maps   ?? 0, label: 'Maps'            },
    { n: meta.effort ?? 0, label: 'Effort Days'     },
  ].map(s => `
<div class="estate-stat">
  <div class="estate-num">${s.n}</div>
  <div class="estate-label">${s.label}</div>
</div>`).join('');

  const badges: string[] = [];
  if ((meta.criticalGaps ?? 0) > 0)
    badges.push(`<span class="gap-badge critical">🔴 ${meta.criticalGaps} Critical</span>`);
  if ((meta.highGaps ?? 0) > 0)
    badges.push(`<span class="gap-badge high">🟠 ${meta.highGaps} High</span>`);

  const nav = sections.map(s =>
    `<a class="nav-chip" href="#${s.id}" onclick="jumpTo(event,'${s.id}')">${s.icon} ${escHtml(s.title)}</a>`
  ).join('');

  return `
<div class="hero estate-hero" style="--grade-color:${GRADE_HEX['B']!}">
  <button class="print-btn" onclick="window.print()">🖨 Export PDF</button>
  <div class="hero-body">
    <div class="hero-left">
      <div class="hero-eyebrow">BizTalk Estate Assessment${meta.date ? ` · ${escHtml(meta.date)}` : ''}</div>
      <div class="hero-title">Estate Migration Report</div>
      <div class="hero-pills">${badges.join('')}</div>
    </div>
    <div class="estate-stats">${stats}</div>
  </div>
  <nav class="section-nav" aria-label="Sections">${nav}</nav>
</div>`;
}

// ─── Markdown converter ───────────────────────────────────────────────────────

function convertMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  let inSection  = false;
  let skipHeader = false;
  let skipMeta   = false;
  let skipHr     = false;

  while (i < lines.length) {
    const line = lines[i]!;

    // Skip h1 — lives in hero
    if (!skipHeader && /^# /.test(line)) { skipHeader = true; i++; continue; }

    // Skip first blockquote (report metadata) — lives in hero
    if (!skipMeta && line.startsWith('> ')) {
      while (i < lines.length && lines[i]!.startsWith('> ')) i++;
      skipMeta = true;
      continue;
    }

    // Skip first horizontal rule (hero divider)
    if (!skipHr && line === '---') { skipHr = true; i++; continue; }

    // ── Raw HTML pass-through block (<!-- HTML_BLOCK --> ... <!-- /HTML_BLOCK -->)
    if (line.startsWith('<!-- HTML_BLOCK -->')) {
      const html: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('<!-- /HTML_BLOCK -->')) {
        html.push(lines[i]!);
        i++;
      }
      out.push(html.join('\n'));
      i++; // skip closing marker
      continue;
    }

    // ── Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) { code.push(lines[i]!); i++; }
      out.push(`<pre><code${lang ? ` class="lang-${escHtml(lang)}"` : ''}>${escHtml(code.join('\n'))}</code></pre>`);
      i++;
      continue;
    }

    // ── Table
    if (line.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) { rows.push(lines[i]!); i++; }
      out.push(buildTable(rows));
      continue;
    }

    // ── Subsequent blockquotes (not the first meta one)
    if (line.startsWith('> ')) {
      const bq: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('> ')) { bq.push(lines[i]!.slice(2)); i++; }
      out.push(`<blockquote>${bq.map(l => `<p>${inline(l)}</p>`).join('')}</blockquote>`);
      continue;
    }

    // ── h2 → collapsible section card
    const h2m = /^## (.+)/.exec(line);
    if (h2m) {
      if (inSection) out.push('</div></details>');
      const title = h2m[1]!;
      const id    = 'sec-' + title.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
      const icon  = SECTION_ICONS[title] ?? '📄';
      const open  = AUTO_OPEN.has(title);
      out.push(`<details class="section"${open ? ' open' : ''} id="${escHtml(id)}">`);
      out.push(`<summary><span class="sec-icon">${icon}</span><span class="sec-title">${inline(title)}</span><svg class="sec-chevron" viewBox="0 0 20 20" fill="none"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>`);
      out.push('<div class="section-body">');
      inSection = true;
      i++;
      continue;
    }

    // ── h3 with severity colouring
    const h3m = /^### (.+)/.exec(line);
    if (h3m) {
      const txt = h3m[1]!;
      let cls = 'h3-default';
      if (txt.includes('🔴') || /critical/i.test(txt)) cls = 'h3-critical';
      else if (txt.includes('🟠') || /\bhigh\b/i.test(txt)) cls = 'h3-high';
      else if (txt.includes('🟡') || /medium/i.test(txt)) cls = 'h3-medium';
      out.push(`<h3 class="${cls}">${inline(txt)}</h3>`);
      i++;
      continue;
    }

    // ── remaining horizontal rules
    if (line === '---') { out.push('<hr>'); i++; continue; }

    // ── unordered list
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('- ')) {
        items.push(`<li>${inline(lines[i]!.slice(2))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // ── blank line
    if (line.trim() === '') { i++; continue; }

    // ── paragraph
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }

  if (inSection) out.push('</div></details>');
  return out.join('\n');
}

// ─── Table builder ────────────────────────────────────────────────────────────

function buildTable(lines: string[]): string {
  const isSep = (r: string[]) => r.every(c => /^[-: ]+$/.test(c));
  const rows  = lines.map(l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
  if (!rows.length) return '';
  const header   = rows[0]!;
  const bodyRows = rows.slice(1).filter(r => !isSep(r));
  const twoCol   = header.length === 2 ? ' kv' : '';
  return `<div class="table-wrap"><table class="${twoCol.trim()}">
<thead><tr>${header.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead>
<tbody>${bodyRows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>
</table></div>`;
}

// ─── Inline formatting ────────────────────────────────────────────────────────

function inline(text: string): string {
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return text;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── HTML document ────────────────────────────────────────────────────────────

function htmlDocument(title: string, hero: string, body: string, accent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
<style>
/* ── Reset ── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}

/* ── Tokens ── */
:root{
  --accent:     ${accent};
  --text:       #1a1d23;
  --muted:      #6b7280;
  --border:     #e5e7eb;
  --bg:         #f0f4f9;
  --card:       #ffffff;
  --radius:     10px;
  --radius-lg:  16px;
  --shadow:     0 1px 3px rgba(0,0,0,.06),0 4px 12px rgba(0,0,0,.06);
  --shadow-lg:  0 4px 8px rgba(0,0,0,.08),0 12px 40px rgba(0,0,0,.12);
}

/* ── Base ── */
body{
  font-family:'Segoe UI',system-ui,-apple-system,BlinkMacSystemFont,sans-serif;
  font-size:14px;line-height:1.65;color:var(--text);background:var(--bg);min-height:100vh;
}
.shell{max-width:1120px;margin:0 auto;padding:32px 24px 72px}

/* ── Hero ── */
.hero{
  position:relative;
  background:
    radial-gradient(ellipse at 8% 65%, rgba(0,120,212,.28) 0%, transparent 52%),
    radial-gradient(ellipse at 88% 12%, rgba(90,50,200,.22) 0%, transparent 45%),
    radial-gradient(ellipse at 60% 90%, rgba(0,80,150,.15) 0%, transparent 40%),
    linear-gradient(135deg,#050d1e 0%,#0b1936 55%,#081323 100%);
  border-radius:var(--radius-lg);
  overflow:hidden;
  margin-bottom:28px;
  box-shadow:var(--shadow-lg);
  border:1px solid rgba(255,255,255,.07);
}
/* dot grid overlay */
.hero::before{
  content:'';position:absolute;inset:0;pointer-events:none;
  background-image:radial-gradient(circle,rgba(255,255,255,.045) 1px,transparent 0);
  background-size:26px 26px;
}
/* grade accent bar */
.hero::after{
  content:'';position:absolute;top:0;left:0;right:0;height:3px;
  background:linear-gradient(90deg,var(--grade-color,${accent}),rgba(0,0,0,0));
}

.hero-body{
  position:relative;display:flex;justify-content:space-between;
  align-items:center;padding:44px 52px 36px;gap:40px;
}

.hero-eyebrow{
  font-size:11px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;
  color:rgba(255,255,255,.45);margin-bottom:10px;
}
.hero-title{
  font-size:34px;font-weight:700;color:#fff;letter-spacing:-.025em;
  line-height:1.12;margin-bottom:20px;max-width:580px;
  text-shadow:0 2px 24px rgba(0,0,0,.35);
}
.hero-pills{display:flex;flex-wrap:wrap;gap:8px}
.hero-pill{
  display:inline-flex;align-items:center;gap:5px;
  padding:5px 13px;border-radius:100px;
  background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.13);
  font-size:12px;color:rgba(255,255,255,.85);backdrop-filter:blur(10px);
}

/* ── Score ring ── */
.score-wrap{flex-shrink:0}
.score-ring{
  width:138px;height:138px;
  filter:drop-shadow(0 0 24px rgba(0,120,212,.35));
}
.ring-arc{transition:stroke-dashoffset 1.5s cubic-bezier(.4,0,.2,1)}

/* ── Estate stat cards ── */
.estate-stats{display:flex;gap:14px;flex-shrink:0}
.estate-stat{
  text-align:center;padding:18px 22px;min-width:94px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);
  border-radius:var(--radius);backdrop-filter:blur(10px);
}
.estate-num{font-size:30px;font-weight:700;color:#fff;line-height:1;margin-bottom:5px}
.estate-label{font-size:11px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.07em}
.gap-badge{
  display:inline-flex;align-items:center;gap:5px;
  padding:5px 13px;border-radius:100px;font-size:12px;font-weight:600;
}
.gap-badge.critical{background:rgba(209,52,56,.2);border:1px solid rgba(209,52,56,.4);color:#ff8c8c}
.gap-badge.high{background:rgba(218,59,1,.2);border:1px solid rgba(218,59,1,.4);color:#ffb07a}

/* ── Section nav ── */
.section-nav{
  position:relative;display:flex;flex-wrap:wrap;gap:7px;
  padding:16px 52px 18px;
  background:rgba(0,0,0,.22);border-top:1px solid rgba(255,255,255,.07);
}
.nav-chip{
  display:inline-flex;align-items:center;gap:5px;
  padding:5px 13px;border-radius:100px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);
  color:rgba(255,255,255,.75);font-size:12px;text-decoration:none;
  transition:background .15s,color .15s,transform .1s;white-space:nowrap;cursor:pointer;
}
.nav-chip:hover{background:rgba(255,255,255,.16);color:#fff;transform:translateY(-1px);text-decoration:none}

/* ── Print button ── */
.print-btn{
  position:absolute;top:18px;right:22px;z-index:10;
  display:inline-flex;align-items:center;gap:6px;
  padding:7px 16px;border-radius:100px;
  background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);
  color:rgba(255,255,255,.9);font-size:12px;font-weight:500;
  cursor:pointer;backdrop-filter:blur(10px);transition:background .15s;
}
.print-btn:hover{background:rgba(255,255,255,.2)}

/* ── Content ── */
.content{display:flex;flex-direction:column;gap:10px}

/* ── Collapsible section cards ── */
details.section{
  background:var(--card);border-radius:var(--radius-lg);
  border:1px solid var(--border);box-shadow:var(--shadow);
  overflow:hidden;transition:box-shadow .2s;
}
details.section[open]{box-shadow:var(--shadow-lg)}
details.section>summary{
  display:flex;align-items:center;gap:12px;
  padding:18px 24px;cursor:pointer;user-select:none;list-style:none;
  transition:background .15s;
}
details.section>summary:hover{background:#f8fafc}
details.section>summary::-webkit-details-marker{display:none}
.sec-icon{font-size:18px;width:28px;text-align:center;flex-shrink:0}
.sec-title{font-size:15px;font-weight:600;color:var(--text);flex:1}
.sec-chevron{
  width:20px;height:20px;color:var(--muted);flex-shrink:0;
  transition:transform .25s cubic-bezier(.4,0,.2,1);
}
details.section[open] .sec-chevron{transform:rotate(180deg)}

.section-body{
  padding:4px 24px 24px;
  overflow:hidden;
  transition:height .3s cubic-bezier(.4,0,.2,1);
}

/* ── Typography ── */
.section-body p{margin:0 0 10px;color:var(--text)}
.section-body strong{font-weight:600}
.section-body em{font-style:italic;color:var(--muted)}
.section-body a{color:var(--accent);text-decoration:none}
.section-body a:hover{text-decoration:underline}

/* ── h3 severity headings ── */
h3{
  font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
  padding:8px 14px;border-radius:var(--radius);margin:20px 0 12px;
  display:flex;align-items:center;gap:6px;
}
h3.h3-critical{background:rgba(209,52,56,.08);color:#c0282c;border-left:3px solid #d13438}
h3.h3-high    {background:rgba(218,59,1,.08); color:#ab3500;border-left:3px solid #da3b01}
h3.h3-medium  {background:rgba(217,140,0,.08);color:#8f6200;border-left:3px solid #d98c00}
h3.h3-default {background:rgba(0,120,212,.06);color:#004f96;border-left:3px solid ${accent}}

/* ── Tables ── */
.table-wrap{
  overflow-x:auto;margin:12px 0 16px;
  border-radius:var(--radius);border:1px solid var(--border);
}
table{width:100%;border-collapse:collapse;font-size:13px}
thead tr{background:linear-gradient(135deg,#090e1f,#0e1d3a)}
th{
  padding:11px 16px;text-align:left;font-size:11px;font-weight:600;
  text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.82);
  white-space:nowrap;border-bottom:2px solid rgba(0,120,212,.5);
}
td{
  padding:9px 16px;border-bottom:1px solid var(--border);
  color:var(--text);vertical-align:top;
}
tbody tr:last-child td{border-bottom:none}
tbody tr:nth-child(even) td{background:#f8fafc}
tbody tr:hover td{background:#eef4fb;transition:background .1s}

/* 2-col key/value table — bold first column */
table.kv td:first-child{font-weight:600;white-space:nowrap;width:220px}

/* ── Code ── */
code{
  font-family:'Cascadia Code','Consolas','Menlo',monospace;
  font-size:12px;background:#f3f4f6;color:#c7254e;
  padding:2px 6px;border-radius:4px;border:1px solid #e5e7eb;
}
pre{
  background:#1e2030;border-radius:var(--radius);
  padding:18px 22px;margin:14px 0;overflow-x:auto;
  border:1px solid rgba(255,255,255,.07);
}
pre code{
  background:none;color:#c9d1d9;border:none;
  padding:0;font-size:13px;white-space:pre;line-height:1.55;
}

/* ── Blockquote ── */
blockquote{
  margin:12px 0;padding:12px 18px;
  background:#f8fafc;border-left:3px solid var(--accent);
  border-radius:0 var(--radius) var(--radius) 0;
}
blockquote p{margin:0;color:var(--muted);font-size:13px}

/* ── Lists ── */
ul{padding-left:22px;margin:8px 0 14px}
li{margin:5px 0;line-height:1.55}

/* ── HR ── */
hr{border:none;border-top:1px solid var(--border);margin:20px 0}

/* ── Diagrams ── */
.dia-wrap{margin:12px 0}
.dia-svg-wrap{overflow-x:auto;padding:16px;background:#f8fafc;border:1px solid var(--border);border-radius:var(--radius)}
.dia-node rect{transition:opacity .15s}
.dia-node:hover rect{opacity:.85}
.dia-details{margin-top:10px}
.dia-details>summary{font-size:12px;color:var(--muted);cursor:pointer;padding:4px 0;user-select:none}
.dia-details>summary:hover{color:var(--accent)}
.dia-flow-section{margin-top:16px}
.dia-flow-label{font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px}

/* ── Footer ── */
.footer{
  display:flex;justify-content:space-between;align-items:center;
  margin-top:44px;padding-top:18px;border-top:1px solid var(--border);
  font-size:12px;color:var(--muted);
}
.footer a{color:var(--accent);text-decoration:none}
.footer a:hover{text-decoration:underline}

/* ── Print ── */
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  body{background:#fff;font-size:11px}
  .shell{padding:0;max-width:100%}
  .print-btn,.section-nav{display:none!important}
  .hero{border-radius:0;box-shadow:none;margin-bottom:20px}
  .hero-body{padding:24px 32px 20px}
  .hero::before{display:none}
  details.section{box-shadow:none;border-radius:4px;break-inside:avoid;margin-bottom:12px}
  details.section:not([open]){display:none}
  .section-body{overflow:visible!important;height:auto!important}
  table{font-size:10px;break-inside:avoid}
  pre{break-inside:avoid}
  .footer{justify-content:center;gap:24px}
}

/* ── Responsive ── */
@media(max-width:720px){
  .hero-body{flex-direction:column;padding:32px 24px 24px}
  .hero-title{font-size:24px}
  .shell{padding:16px 12px 56px}
  .section-nav{padding:14px 24px}
  .estate-stats{flex-wrap:wrap}
  .score-wrap{align-self:center}
}
</style>
</head>
<body>
<div class="shell">
${hero}
<main class="content">
${body}
</main>
<footer class="footer">
  <span>Generated by <a href="https://biztalkmigrate.com" target="_blank" rel="noopener">BizTalk to Logic Apps Migration Framework</a></span>
  <span><a href="mailto:me@jonlevesque.com">me@jonlevesque.com</a></span>
</footer>
</div>
<script>
(function(){
  // Animate score ring
  var arc = document.querySelector('.ring-arc');
  if(arc){
    var t = parseFloat(arc.getAttribute('data-target')||'0');
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      arc.style.strokeDashoffset = t;
    })});
  }

  // Smooth section toggle
  document.querySelectorAll('details.section').forEach(function(det){
    var body = det.querySelector('.section-body');
    var summ = det.querySelector('summary');
    if(!body||!summ) return;
    summ.addEventListener('click',function(e){
      e.preventDefault();
      if(det.open){
        body.style.height = body.scrollHeight+'px';
        body.offsetHeight;
        requestAnimationFrame(function(){
          body.style.height='0';
          body.addEventListener('transitionend',function h(){
            body.removeEventListener('transitionend',h);
            det.open=false;
            body.style.height='';
          });
        });
      } else {
        det.open=true;
        body.style.height='0';
        body.offsetHeight;
        var h=body.scrollHeight;
        requestAnimationFrame(function(){
          body.style.height=h+'px';
          body.addEventListener('transitionend',function done(){
            body.removeEventListener('transitionend',done);
            body.style.height='auto';
          });
        });
      }
    });
  });

  // Nav chip click: open section + scroll
  window.jumpTo=function(e,id){
    e.preventDefault();
    var el=document.getElementById(id);
    if(!el) return;
    if(!el.open){
      el.open=true;
      var b=el.querySelector('.section-body');
      if(b){b.style.height='auto'}
    }
    setTimeout(function(){el.scrollIntoView({behavior:'smooth',block:'start'})},60);
  };
})();
</script>
</body>
</html>`;
}
