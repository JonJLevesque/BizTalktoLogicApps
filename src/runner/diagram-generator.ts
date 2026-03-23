/**
 * Diagram Generator — Inline SVG flow diagrams for migration reports.
 *
 * Produces two diagrams:
 *   1. BizTalk Architecture — Receive Locations → Pipelines → Orchestrations → Maps → Send Ports
 *   2. Logic Apps Architecture — workflows with trigger types, connectors, and child workflow calls
 *
 * Output is raw HTML (SVG + details table) suitable for embedding in the HTML report.
 */

import type { BizTalkApplication, OdxShape } from '../types/biztalk.js';
import type {
  WorkflowJson,
  ServiceProviderAction,
  WorkflowAction,
  WdlAction,
  WdlTrigger,
} from '../types/logicapps.js';

// ─── Colours ──────────────────────────────────────────────────────────────────

const COLORS = {
  receive:       { fill: '#d4edda', stroke: '#28a745', text: '#155724' },
  pipeline:      { fill: '#cce5ff', stroke: '#0056b3', text: '#004085' },
  orchestration: { fill: '#e2d9f3', stroke: '#6f42c1', text: '#432874' },
  map:           { fill: '#fde8cd', stroke: '#e8760a', text: '#7a3e00' },
  sendport:      { fill: '#fff3cd', stroke: '#d39e00', text: '#7d5a00' },
  workflow:      { fill: '#cce5ff', stroke: '#0078d4', text: '#004578' },
  trigger:       { fill: '#d4edda', stroke: '#28a745', text: '#155724' },
  connector:     { fill: '#fff3cd', stroke: '#d39e00', text: '#7d5a00' },
};

// ─── Layout constants ─────────────────────────────────────────────────────────

const NODE_W  = 160;
const NODE_H  = 50;
const COL_GAP = 220;
const ROW_GAP = 70;
const PAD_X   = 20;
const PAD_Y   = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiagramNode {
  id:    string;
  label: string;
  sub:   string;
  kind:  keyof typeof COLORS;
  col:   number;
  row:   number;
}

interface DiagramEdge {
  from:   string;
  to:     string;
  dashed?: boolean;
}

// ─── SVG builder helpers ──────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, max = 18): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function nodeX(col: number): number { return PAD_X + col * COL_GAP; }
function nodeY(row: number): number { return PAD_Y + row * ROW_GAP; }
function nodeCy(row: number): number { return nodeY(row) + NODE_H / 2; }

function renderNode(n: DiagramNode): string {
  const c = COLORS[n.kind];
  const x = nodeX(n.col);
  const y = nodeY(n.row);
  return `
  <g class="dia-node" data-id="${esc(n.id)}">
    <title>${esc(n.label)}${n.sub ? ' — ' + esc(n.sub) : ''}</title>
    <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="8"
      fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>
    <text x="${x + NODE_W / 2}" y="${y + 19}" text-anchor="middle"
      font-family="system-ui,-apple-system,sans-serif" font-size="12" font-weight="600"
      fill="${c.text}">${esc(truncate(n.label, 20))}</text>
    <text x="${x + NODE_W / 2}" y="${y + 34}" text-anchor="middle"
      font-family="system-ui,-apple-system,sans-serif" font-size="10"
      fill="${c.stroke}">${esc(truncate(n.sub, 24))}</text>
  </g>`;
}

function renderEdge(from: DiagramNode, to: DiagramNode, prefix: string, dashed = false): string {
  const dash = dashed ? ' stroke-dasharray="4,2"' : '';
  if (from.col === to.col) {
    // Same-column edge: use quadratic bezier arcing to the right
    const x  = nodeX(from.col) + NODE_W;
    const y1 = nodeCy(from.row);
    const y2 = nodeCy(to.row);
    const cx = x + 35;
    return `<path d="M${x},${y1} Q${cx},${(y1 + y2) / 2} ${x},${y2}"
    fill="none" stroke="#9ca3af" stroke-width="1.5" marker-end="url(#${prefix}-arrow)"${dash}/>`;
  }
  const x1 = nodeX(from.col) + NODE_W;
  const y1 = nodeCy(from.row);
  const x2 = nodeX(to.col);
  const y2 = nodeCy(to.row);
  const mx = (x1 + x2) / 2;
  return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"
    fill="none" stroke="#9ca3af" stroke-width="1.5" marker-end="url(#${prefix}-arrow)"${dash}/>`;
}

function svgWrapper(nodes: DiagramNode[], edges: DiagramEdge[], prefix: string): string {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const cols = nodes.reduce((m, n) => Math.max(m, n.col), 0) + 1;
  const rows = nodes.reduce((m, n) => Math.max(m, n.row), 0) + 1;
  const svgW = PAD_X * 2 + cols * COL_GAP - (COL_GAP - NODE_W);
  const svgH = PAD_Y * 2 + rows * ROW_GAP - (ROW_GAP - NODE_H);

  const edgeSvg = edges.map(e => {
    const f = nodeMap.get(e.from);
    const t = nodeMap.get(e.to);
    if (!f || !t) return '';
    return renderEdge(f, t, prefix, e.dashed);
  }).join('');

  const nodeSvg = nodes.map(renderNode).join('');

  return `<svg viewBox="0 0 ${svgW} ${svgH}" width="100%" preserveAspectRatio="xMinYMin meet"
  xmlns="http://www.w3.org/2000/svg" style="max-width:${svgW}px;overflow:visible">
  <defs>
    <marker id="${prefix}-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#9ca3af"/>
    </marker>
  </defs>
  ${edgeSvg}
  ${nodeSvg}
</svg>`;
}

// ─── Heuristic edge builder ────────────────────────────────────────────────────
// Connects each fromId[i] to toIds[min(i, toIds.length-1)].
// Avoids cartesian N×M explosion; deduplicates.

function heuristicEdges(fromIds: string[], toIds: string[], edges: DiagramEdge[]): void {
  if (fromIds.length === 0 || toIds.length === 0) return;
  const seen = new Set<string>();
  fromIds.forEach((fId, i) => {
    const tId = toIds[Math.min(i, toIds.length - 1)] as string;
    const key = `${fId}->${tId}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ from: fId, to: tId });
    }
  });
}

// ─── BizTalk Architecture Diagram ─────────────────────────────────────────────

export function generateBizTalkDiagram(app: BizTalkApplication): string {
  const receiveLocations = app.bindingFiles.flatMap(b => b.receiveLocations);
  const sendPorts        = app.bindingFiles.flatMap(b => b.sendPorts);

  // Deduplicate orchestrations by name (same class may appear in multiple .odx files)
  const orchSeen       = new Set<string>();
  const orchestrations = app.orchestrations.filter(o => orchSeen.has(o.name) ? false : (orchSeen.add(o.name), true));

  if (orchestrations.length === 0 && receiveLocations.length === 0) return '';

  // Per-orchestration collapsible accordions
  const orchItems = orchestrations
    .filter(o => o.shapes.length > 0)
    .map(o => {
      const flowNodes = buildOrchestrationFlow(o.shapes, 0);
      const pfx       = `bztflow-${o.name.replace(/\W+/g, '')}`;
      const bodyHtml  = flowNodes.length > 0
        ? `<div class="dia-svg-wrap">${generateFlowSvg(flowNodes, pfx)}</div>`
        : `<p style="color:var(--muted);font-size:13px">No flow nodes generated.</p>`;
      return `<details class="dia-item">
  <summary class="dia-item-hd">
    <span class="dia-item-name">${esc(o.name)}</span>
    <span class="dia-item-badge">${o.shapes.length} shapes</span>
  </summary>
  <div class="dia-item-body">${bodyHtml}</div>
</details>`;
    }).join('');

  // Details table
  const tableRows: string[] = [];
  receiveLocations.forEach(rl =>
    tableRows.push(`<tr><td>Receive Location</td><td><strong>${esc(rl.name)}</strong></td><td>${esc(rl.adapterType)}</td><td><code>${esc(rl.address)}</code></td></tr>`)
  );
  orchestrations.forEach(orch =>
    tableRows.push(`<tr><td>Orchestration</td><td><strong>${esc(orch.name)}</strong></td><td>${orch.shapes.length} shapes</td><td></td></tr>`)
  );
  app.maps.forEach(m =>
    tableRows.push(`<tr><td>Map</td><td><strong>${esc(m.name)}</strong></td><td>${m.functoids.length} functoids</td><td>${esc((m.sourceSchemaRef.split('.').pop() ?? ''))} → ${esc((m.destinationSchemaRef.split('.').pop() ?? ''))}</td></tr>`)
  );
  app.pipelines.forEach(p =>
    tableRows.push(`<tr><td>${p.direction === 'receive' ? 'Receive' : 'Send'} Pipeline</td><td><strong>${esc(p.name)}</strong></td><td>${p.components.length} components</td><td></td></tr>`)
  );
  sendPorts.forEach(sp =>
    tableRows.push(`<tr><td>Send Port</td><td><strong>${esc(sp.name)}</strong></td><td>${esc(sp.adapterType)}</td><td><code>${esc(sp.address)}</code></td></tr>`)
  );

  return `
<div class="dia-wrap">
  ${orchItems}
  <details class="dia-details">
    <summary>View artifact details</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>Type</th><th>Name</th><th>Adapter / Info</th><th>Address</th></tr></thead>
      <tbody>${tableRows.join('')}</tbody>
    </table></div>
  </details>
</div>`;
}

// ─── Logic Apps Architecture Diagram ──────────────────────────────────────────

export function generateLogicAppsDiagram(
  workflows: Array<{ name: string; workflow: WorkflowJson }>
): string {
  if (workflows.length === 0) return '';

  // Recursively collect child workflow calls from an actions map
  function collectChildCalls(actions: Record<string, WdlAction>, out: string[]): void {
    for (const action of Object.values(actions)) {
      if (action.type === 'Workflow') {
        out.push((action as WorkflowAction).inputs.host.workflow.id);
      } else if (action.type === 'If') {
        collectChildCalls(action.actions, out);
        if (action.else) collectChildCalls(action.else.actions, out);
      } else if (action.type === 'Scope' || action.type === 'Until' || action.type === 'Foreach') {
        collectChildCalls(action.actions, out);
      } else if (action.type === 'Switch') {
        for (const body of Object.values(action.cases)) collectChildCalls(body.actions, out);
        if (action.default) collectChildCalls(action.default.actions, out);
      }
    }
  }

  // Collect child calls per workflow
  const wfChildCalls = new Map<number, string[]>(); // wf index → child workflow names called
  workflows.forEach((wf, i) => {
    const childCalls: string[] = [];
    collectChildCalls(wf.workflow.definition.actions ?? {}, childCalls);
    wfChildCalls.set(i, [...new Set(childCalls)]);
  });

  // Reverse map: calledName → callerNames[]
  const calledBy = new Map<string, string[]>();
  workflows.forEach((wf, i) => {
    for (const calledName of wfChildCalls.get(i) ?? []) {
      const arr = calledBy.get(calledName) ?? [];
      arr.push(wf.name);
      calledBy.set(calledName, arr);
    }
  });

  // Per-workflow collapsible accordions
  const wfItems = workflows.map((wf, i) => {
    const def      = wf.workflow.definition;
    const triggers = def.triggers ?? {};
    const actions  = def.actions ?? {};

    // Trigger type badge
    const trigObj = Object.values(triggers)[0];
    let trigBadge = 'Trigger';
    if (trigObj) {
      if (trigObj.type === 'Request')             trigBadge = 'HTTP Trigger';
      else if (trigObj.type === 'Recurrence')     trigBadge = 'Schedule';
      else if (trigObj.type === 'ServiceProvider') trigBadge = trigObj.inputs.serviceProviderConfiguration.connectionName;
    }

    // Relationship badges
    const callBadges     = (wfChildCalls.get(i) ?? []).map(n => `<span class="dia-item-badge call">→ calls ${esc(n)}</span>`).join('');
    const calledByBadges = (calledBy.get(wf.name) ?? []).map(n => `<span class="dia-item-badge child">← called by ${esc(n)}</span>`).join('');

    // Flow diagram
    let bodyHtml = '<p style="color:var(--muted);font-size:13px">No actions.</p>';
    if (Object.keys(actions).length > 0) {
      const flowNodes = buildWorkflowFlow(actions, triggers, 0);
      if (flowNodes.length > 0) {
        const pfx = `laflow-${wf.name.replace(/\W+/g, '')}`;
        bodyHtml = `<div class="dia-svg-wrap">${generateFlowSvg(flowNodes, pfx)}</div>`;
      }
    }

    return `<details class="dia-item">
  <summary class="dia-item-hd">
    <span class="dia-item-name">${esc(wf.name)}</span>
    <span class="dia-item-badge">${esc(trigBadge)}</span>
    ${callBadges}${calledByBadges}
  </summary>
  <div class="dia-item-body">${bodyHtml}</div>
</details>`;
  }).join('');

  return `
<div class="dia-wrap">
  ${wfItems}
</div>`;
}

// ─── Flow Diagram Engine ───────────────────────────────────────────────────────

const FLOW_COLORS = {
  green:  { fill: '#d4edda', stroke: '#28a745', text: '#155724' },
  blue:   { fill: '#cce5ff', stroke: '#0078d4', text: '#004578' },
  purple: { fill: '#e2d9f3', stroke: '#6f42c1', text: '#432874' },
  orange: { fill: '#fde8cd', stroke: '#e8760a', text: '#7a3e00' },
  red:    { fill: '#f8d7da', stroke: '#dc3545', text: '#721c24' },
  gray:   { fill: '#e9ecef', stroke: '#6c757d', text: '#495057' },
} as const;

type FlowColorKey = keyof typeof FLOW_COLORS;

interface FlowNode {
  id:       string;
  label:    string;
  sub:      string;
  shape:    'rect' | 'diamond' | 'pill';
  colorKey: FlowColorKey;
  depth:    number;
  children?: FlowNode[];
  branches?: { label: string; nodes: FlowNode[] }[];
}

// Layout constants
const FW      = 176;   // node width
const FH      = 38;    // node/pill height
const FDIAM_W = 88;    // diamond full width
const FDIAM_H = 52;    // diamond full height
const FGY     = 16;    // vertical gap between sequential nodes
const FGX     = 14;    // horizontal gap between branch columns
const FPX     = 10;    // container horizontal padding
const FPY     = 8;     // container vertical padding
const FHDR    = 18;    // container header height
const MAX_DEPTH = 3;   // collapse nesting beyond this depth

// ─── Measure ──────────────────────────────────────────────────────────────────

function measureSeq(nodes: FlowNode[]): { w: number; h: number } {
  if (nodes.length === 0) return { w: FW, h: 0 };
  let totalH = 0;
  let maxW   = 0;
  for (let i = 0; i < nodes.length; i++) {
    const s = measureNode(nodes[i]!);
    if (i > 0) totalH += FGY;
    totalH += s.h;
    maxW = Math.max(maxW, s.w);
  }
  return { w: maxW, h: totalH };
}

function measureNode(n: FlowNode): { w: number; h: number } {
  // Collapse deep nesting
  if (n.depth >= MAX_DEPTH && (n.children || n.branches)) {
    return { w: FW, h: FH };
  }
  if (n.branches && n.branches.length > 0) {
    const brW = n.branches.map(b => Math.max(measureSeq(b.nodes).w, FW));
    const totalBrW = brW.reduce((s, w) => s + w, 0) + FGX * (n.branches.length - 1);
    const maxBrH = n.branches.reduce((m, b) => Math.max(m, measureSeq(b.nodes).h), 0);
    return {
      w: Math.max(totalBrW, FDIAM_W),
      h: FDIAM_H + FGY + (maxBrH > 0 ? maxBrH + FGY * 2 : 0),
    };
  }
  if (n.children && n.children.length > 0) {
    const inner = measureSeq(n.children);
    return {
      w: Math.max(inner.w + 2 * FPX, FW + 2 * FPX),
      h: FHDR + FPY + inner.h + FPY,
    };
  }
  if (n.shape === 'diamond') return { w: FDIAM_W, h: FDIAM_H };
  return { w: FW, h: FH };
}

// ─── Layout / Render ──────────────────────────────────────────────────────────

function layoutSeq(nodes: FlowNode[], cx: number, y: number, pfx: string, out: string[]): number {
  let curY = y;
  for (let i = 0; i < nodes.length; i++) {
    if (i > 0) {
      // Downward arrow between nodes
      out.push(`<line x1="${cx}" y1="${curY + 1}" x2="${cx}" y2="${curY + FGY - 5}" stroke="#9ca3af" stroke-width="1.5" marker-end="url(#${pfx}-fa)"/>`);
      curY += FGY;
    }
    curY = layoutNode(nodes[i]!, cx, curY, pfx, out);
  }
  return curY;
}

function layoutNode(n: FlowNode, cx: number, y: number, pfx: string, out: string[]): number {
  // Depth collapse
  if (n.depth >= MAX_DEPTH && (n.children || n.branches)) {
    const total = (n.children?.length ?? 0) +
      (n.branches?.reduce((s, b) => s + b.nodes.length, 0) ?? 0);
    const c = FLOW_COLORS.gray;
    const x = cx - FW / 2;
    out.push(`<rect x="${x}" y="${y}" width="${FW}" height="${FH}" rx="5" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1" stroke-dasharray="3,2"/>`);
    out.push(`<text x="${cx}" y="${y + FH / 2 + 4}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="${c.text}">… ${total} nested action${total !== 1 ? 's' : ''}</text>`);
    return y + FH;
  }

  if (n.branches && n.branches.length > 0) {
    return layoutBranches(n, cx, y, pfx, out);
  }
  if (n.children && n.children.length > 0) {
    return layoutContainer(n, cx, y, pfx, out);
  }
  return layoutLeaf(n, cx, y, out);
}

function layoutLeaf(n: FlowNode, cx: number, y: number, out: string[]): number {
  const c = FLOW_COLORS[n.colorKey];
  if (n.shape === 'diamond') {
    const hw = FDIAM_W / 2;
    const hh = FDIAM_H / 2;
    const mcy = y + hh;
    out.push(`<polygon points="${cx},${y} ${cx + hw},${mcy} ${cx},${y + FDIAM_H} ${cx - hw},${mcy}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`);
    out.push(`<text x="${cx}" y="${mcy - 5}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="${c.text}">${esc(truncate(n.label, 16))}</text>`);
    if (n.sub) {
      out.push(`<text x="${cx}" y="${mcy + 8}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8" fill="${c.stroke}">${esc(truncate(n.sub, 20))}</text>`);
    }
    return y + FDIAM_H;
  }
  const rx  = n.shape === 'pill' ? FH / 2 : 5;
  const x   = cx - FW / 2;
  out.push(`<rect x="${x}" y="${y}" width="${FW}" height="${FH}" rx="${rx}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`);
  if (n.sub) {
    out.push(`<text x="${cx}" y="${y + 14}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="${c.text}">${esc(truncate(n.label, 22))}</text>`);
    out.push(`<text x="${cx}" y="${y + 27}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="${c.stroke}">${esc(truncate(n.sub, 28))}</text>`);
  } else {
    out.push(`<text x="${cx}" y="${y + FH / 2 + 4}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="${c.text}">${esc(truncate(n.label, 24))}</text>`);
  }
  return y + FH;
}

function layoutContainer(n: FlowNode, cx: number, y: number, pfx: string, out: string[]): number {
  const children = n.children!;
  const inner    = measureSeq(children);
  const w = Math.max(inner.w + 2 * FPX, FW + 2 * FPX);
  const h = FHDR + FPY + inner.h + FPY;
  const x = cx - w / 2;
  const c = FLOW_COLORS[n.colorKey];
  out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1" stroke-dasharray="4,2" opacity="0.65"/>`);
  out.push(`<text x="${x + 8}" y="${y + 13}" font-family="system-ui,sans-serif" font-size="9" font-weight="600" fill="${c.stroke}">${esc(truncate(n.label, 34))}</text>`);
  layoutSeq(children, cx, y + FHDR + FPY, pfx, out);
  return y + h;
}

function layoutBranches(n: FlowNode, cx: number, y: number, pfx: string, out: string[]): number {
  const branches = n.branches!;
  // Draw the diamond
  const diamBottomY = layoutLeaf(n, cx, y, out);
  const branchTopY  = diamBottomY + FGY;

  // Measure each branch column width
  const brWidths = branches.map(b => Math.max(measureSeq(b.nodes).w, FW));
  const totalW   = brWidths.reduce((s, w) => s + w, 0) + FGX * (branches.length - 1);
  let bx         = cx - totalW / 2;

  let maxBottomY = branchTopY;

  branches.forEach((branch, i) => {
    const bw  = brWidths[i]!;
    const bcx = bx + bw / 2;

    // Fork line: from diamond bottom-center to branch column top-center
    out.push(`<line x1="${cx}" y1="${diamBottomY}" x2="${bcx}" y2="${branchTopY - 2}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="3,2"/>`);

    // Branch label
    out.push(`<text x="${bcx}" y="${branchTopY + 11}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="600" fill="#6c757d">${esc(branch.label)}</text>`);

    const nodeStartY = branchTopY + 16;
    const bottomY    = layoutSeq(branch.nodes, bcx, nodeStartY, pfx, out);
    maxBottomY = Math.max(maxBottomY, bottomY);
    bx += bw + FGX;
  });

  return maxBottomY;
}

function generateFlowSvg(nodes: FlowNode[], prefix: string): string {
  if (nodes.length === 0) return '';
  const { w, h } = measureSeq(nodes);
  const PAD  = 20;
  const totW = Math.max(w, FW) + PAD * 2;
  const totH = h + PAD * 2;
  const cx   = totW / 2;

  const out: string[] = [];
  layoutSeq(nodes, cx, PAD, prefix, out);

  return `<svg viewBox="0 0 ${totW} ${totH}" width="${totW}" height="${totH}"
  xmlns="http://www.w3.org/2000/svg" style="max-width:100%;overflow:visible">
  <defs>
    <marker id="${prefix}-fa" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L6,3 z" fill="#9ca3af"/>
    </marker>
  </defs>
  ${out.join('')}
</svg>`;
}

// ─── BizTalk Flow Builder ──────────────────────────────────────────────────────

function buildOrchestrationFlow(shapes: OdxShape[], depth: number): FlowNode[] {
  const nodes: FlowNode[] = [];
  for (const shape of shapes) {
    switch (shape.shapeType) {
      case 'ReceiveShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Receive',
          sub: shape.isActivating === true ? 'Activating Receive' : 'Receive',
          shape: 'pill', colorKey: 'green', depth,
        });
        break;
      case 'SendShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Send',
          sub: 'Send', shape: 'pill', colorKey: 'blue', depth,
        });
        break;
      case 'TransformShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Transform',
          sub: shape.mapClass?.split('.').pop() ?? 'Map',
          shape: 'rect', colorKey: 'orange', depth,
        });
        break;
      case 'DecisionShape': {
        const rawBranches = (shape.children ?? []).map((child, i) => ({
          label: child.name ?? `Branch ${i + 1}`,
          nodes: buildOrchestrationFlow(child.children ?? [], depth + 1),
        }));
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Decision',
          sub: truncate(shape.conditionExpression ?? '', 22),
          shape: 'diamond', colorKey: 'purple', depth,
          ...(rawBranches.length > 0 ? { branches: rawBranches } : {}),
        });
        break;
      }
      case 'LoopShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'While Loop',
          sub: truncate(shape.conditionExpression ?? '', 22),
          shape: 'diamond', colorKey: 'purple', depth,
          ...(shape.children && shape.children.length > 0
            ? { children: buildOrchestrationFlow(shape.children, depth + 1) }
            : {}),
        });
        break;
      case 'ScopeShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Scope',
          sub: shape.transactionType ?? 'None',
          shape: 'rect', colorKey: 'gray', depth,
          ...(shape.children && shape.children.length > 0
            ? { children: buildOrchestrationFlow(shape.children, depth + 1) }
            : {}),
        });
        break;
      case 'ConstructShape':
      case 'MessageAssignmentShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Construct',
          sub: 'Construct Message', shape: 'rect', colorKey: 'orange', depth,
        });
        break;
      case 'ExpressionShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Expression',
          sub: truncate(shape.codeExpression ?? 'Expression', 22),
          shape: 'rect', colorKey: 'gray', depth,
        });
        break;
      case 'CallOrchestrationShape':
      case 'StartOrchestrationShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Call Orchestration',
          sub: shape.calledOrchestration?.split('.').pop() ?? 'Child',
          shape: 'rect', colorKey: 'blue', depth,
        });
        break;
      case 'CallRulesShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Call Rules',
          sub: shape.rulePolicyName ?? 'BRE Policy',
          shape: 'rect', colorKey: 'orange', depth,
        });
        break;
      case 'DelayShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Delay',
          sub: truncate(shape.delayExpression ?? 'Delay', 22),
          shape: 'rect', colorKey: 'gray', depth,
        });
        break;
      case 'ThrowShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Throw',
          sub: 'Throw Exception', shape: 'pill', colorKey: 'red', depth,
        });
        break;
      case 'TerminateShape':
        nodes.push({
          id: shape.shapeId, label: shape.name ?? 'Terminate',
          sub: 'Terminate', shape: 'pill', colorKey: 'red', depth,
        });
        break;
      case 'GroupShape':
        // Inline branch body children directly
        nodes.push(...buildOrchestrationFlow(shape.children ?? [], depth));
        break;
      case 'CommentShape':
      case 'RoleLinkShape':
        break;
      default:
        nodes.push({
          id: shape.shapeId, label: shape.name ?? shape.shapeType,
          sub: shape.shapeType, shape: 'rect', colorKey: 'gray', depth,
        });
        break;
    }
  }
  return nodes;
}

// ─── Logic Apps Flow Builder ──────────────────────────────────────────────────

function topoSortActions(actions: Record<string, WdlAction>): Array<[string, WdlAction]> {
  const entries  = Object.entries(actions);
  const deps     = new Map(entries.map(([n, a]) => [n, Object.keys(a.runAfter ?? {})]));
  const inDegree = new Map(entries.map(([n]) => [n, (deps.get(n) ?? []).length]));
  const aMap     = new Map(entries);
  const queue    = entries.filter(([n]) => (inDegree.get(n) ?? 0) === 0);
  const sorted: Array<[string, WdlAction]> = [];

  while (queue.length > 0) {
    const item = queue.shift()!;
    sorted.push(item);
    for (const [name, d] of deps.entries()) {
      if (d.includes(item[0])) {
        const deg = (inDegree.get(name) ?? 0) - 1;
        inDegree.set(name, deg);
        if (deg === 0) {
          const a = aMap.get(name);
          if (a) queue.push([name, a]);
        }
      }
    }
  }
  // Append any cycle survivors
  for (const e of entries) {
    if (!sorted.some(([n]) => n === e[0])) sorted.push(e);
  }
  return sorted;
}

function buildWorkflowFlow(
  actions: Record<string, WdlAction>,
  triggers: Record<string, WdlTrigger>,
  depth: number,
): FlowNode[] {
  const nodes: FlowNode[] = [];

  // Trigger node (top pill, green)
  const trigEntries = Object.entries(triggers);
  if (trigEntries.length > 0) {
    const [trigName, trigObj] = trigEntries[0]!;
    let trigSub = 'Trigger';
    if (trigObj.type === 'Request')        trigSub = 'HTTP Trigger';
    else if (trigObj.type === 'Recurrence') trigSub = 'Schedule';
    else if (trigObj.type === 'ServiceProvider') trigSub = trigObj.inputs.serviceProviderConfiguration.connectionName;
    nodes.push({ id: '__trigger__', label: trigName.replace(/_/g, ' '), sub: trigSub, shape: 'pill', colorKey: 'green', depth });
  }

  // Collapse all InitializeVariable actions into one summary node
  const sorted    = topoSortActions(actions);
  const initNames = sorted.filter(([, a]) => a.type === 'InitializeVariable').map(([n]) => n);
  let initEmitted = false;

  for (const [name, action] of sorted) {
    if (action.type === 'InitializeVariable') {
      if (!initEmitted) {
        nodes.push({
          id: '__initvars__', label: 'Initialize Variables',
          sub: `${initNames.length} variable${initNames.length !== 1 ? 's' : ''}`,
          shape: 'rect', colorKey: 'gray', depth,
        });
        initEmitted = true;
      }
      continue;
    }

    const isError = Object.values(action.runAfter ?? {}).some(
      ss => ss.some(s => s === 'FAILED' || s === 'TIMEDOUT'),
    );

    const node = buildWdlNode(name, action, depth, isError);
    if (node !== null) nodes.push(node);
  }
  return nodes;
}

function buildWdlNode(name: string, action: WdlAction, depth: number, isError: boolean): FlowNode | null {
  const label = name.replace(/_/g, ' ');
  switch (action.type) {
    case 'Scope':
      return {
        id: name, label, sub: 'Scope',
        shape: 'rect', colorKey: isError ? 'red' : 'gray', depth,
        ...(Object.keys(action.actions).length > 0
          ? { children: buildWorkflowFlow(action.actions, {}, depth + 1) }
          : {}),
      };
    case 'If': {
      const trueBranch  = buildWorkflowFlow(action.actions, {}, depth + 1);
      const falseBranch = action.else ? buildWorkflowFlow(action.else.actions, {}, depth + 1) : [];
      return {
        id: name, label, sub: 'If Condition',
        shape: 'diamond', colorKey: 'purple', depth,
        branches: [
          { label: 'True',  nodes: trueBranch },
          { label: 'False', nodes: falseBranch },
        ],
      };
    }
    case 'Switch': {
      const caseBranches = Object.entries(action.cases).map(([, body]) => ({
        label: body.case,
        nodes: buildWorkflowFlow(body.actions, {}, depth + 1),
      }));
      if (action.default) {
        caseBranches.push({ label: 'Default', nodes: buildWorkflowFlow(action.default.actions, {}, depth + 1) });
      }
      // Cap at 4 branches to avoid excessive width
      const shown = caseBranches.slice(0, 4);
      if (caseBranches.length > 4) shown.push({ label: `+${caseBranches.length - 4} more`, nodes: [] });
      return {
        id: name, label, sub: 'Switch',
        shape: 'diamond', colorKey: 'purple', depth,
        branches: shown,
      };
    }
    case 'Until':
      return {
        id: name, label, sub: 'Until Loop',
        shape: 'diamond', colorKey: 'purple', depth,
        ...(Object.keys(action.actions).length > 0
          ? { children: buildWorkflowFlow(action.actions, {}, depth + 1) }
          : {}),
      };
    case 'Foreach':
      return {
        id: name, label, sub: 'For Each',
        shape: 'diamond', colorKey: 'purple', depth,
        ...(Object.keys(action.actions).length > 0
          ? { children: buildWorkflowFlow(action.actions, {}, depth + 1) }
          : {}),
      };
    case 'Http': {
      const uriRaw    = action.inputs.uri as string;
      const uriShort  = typeof uriRaw === 'string'
        ? uriRaw.replace(/^https?:\/\//, '').split('/')[0] ?? uriRaw
        : 'HTTP';
      return {
        id: name, label, sub: `${action.inputs.method} ${uriShort}`,
        shape: 'rect', colorKey: isError ? 'red' : 'blue', depth,
      };
    }
    case 'ServiceProvider': {
      const sp = action.inputs.serviceProviderConfiguration;
      return {
        id: name, label, sub: `${sp.connectionName}: ${sp.operationId}`,
        shape: 'rect', colorKey: isError ? 'red' : 'blue', depth,
      };
    }
    case 'InvokeFunction':
      return {
        id: name, label, sub: action.inputs.functionName,
        shape: 'rect', colorKey: 'orange', depth,
      };
    case 'Workflow':
      return {
        id: name, label, sub: action.inputs.host.workflow.id,
        shape: 'rect', colorKey: 'blue', depth,
      };
    case 'Xslt': {
      const mapName = action.inputs.integrationAccount?.map.name ?? 'Transform';
      return {
        id: name, label, sub: mapName,
        shape: 'rect', colorKey: 'orange', depth,
      };
    }
    case 'Terminate':
      return {
        id: name, label, sub: action.inputs.runStatus,
        shape: 'pill', colorKey: 'red', depth,
      };
    case 'Response':
      return {
        id: name, label, sub: `HTTP ${action.inputs.statusCode}`,
        shape: 'pill', colorKey: 'green', depth,
      };
    case 'SetVariable':
    case 'IncrementVariable':
    case 'AppendToArrayVariable':
      return {
        id: name, label, sub: action.inputs.name,
        shape: 'rect', colorKey: 'gray', depth,
      };
    case 'Compose':
      return { id: name, label, sub: 'Compose', shape: 'rect', colorKey: 'orange', depth };
    case 'ParseJson':
      return { id: name, label, sub: 'Parse JSON', shape: 'rect', colorKey: 'orange', depth };
    case 'Delay':
      return { id: name, label, sub: 'Delay', shape: 'rect', colorKey: 'gray', depth };
    case 'DelayUntil':
      return { id: name, label, sub: 'Delay Until', shape: 'rect', colorKey: 'gray', depth };
    default:
      return {
        id: name, label,
        sub: (action as { type: string }).type,
        shape: 'rect', colorKey: 'gray', depth,
      };
  }
}
