/**
 * Diagram Generator — Inline SVG flow diagrams for migration reports.
 *
 * Produces two diagrams:
 *   1. BizTalk Architecture — Receive Locations → Pipelines → Orchestrations → Maps → Send Ports
 *   2. Logic Apps Architecture — workflows with trigger types, connectors, and child workflow calls
 *
 * Output is raw HTML (SVG + details table) suitable for embedding in the HTML report.
 */

import type { BizTalkApplication } from '../types/biztalk.js';
import type {
  WorkflowJson,
  ServiceProviderAction,
  WorkflowAction,
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
  xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
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
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  const receiveLocations = app.bindingFiles.flatMap(b => b.receiveLocations);
  const sendPorts        = app.bindingFiles.flatMap(b => b.sendPorts);
  const rcvPipelines     = [...new Set(receiveLocations.map(r => r.pipelineName).filter(Boolean))];
  const sndPipelines     = [...new Set(sendPorts.map(s => s.pipelineName).filter(Boolean))];
  const orchestrations   = app.orchestrations;
  const maps             = app.maps;

  // Column layout: ReceiveLocations | RcvPipelines | Orchestrations | Maps | SndPipelines | SendPorts
  let col = 0;

  // Col 0: Receive Locations
  const rlIds: string[] = [];
  receiveLocations.forEach((rl, i) => {
    const id = `rl_${i}`;
    rlIds.push(id);
    nodes.push({ id, label: rl.name, sub: rl.adapterType, kind: 'receive', col, row: i });
  });
  if (receiveLocations.length > 0) col++;

  // Col 1: Receive Pipelines
  const rpIds: string[] = [];
  if (rcvPipelines.length > 0) {
    rcvPipelines.forEach((p, i) => {
      const id = `rp_${i}`;
      rpIds.push(id);
      nodes.push({ id, label: p, sub: 'Receive Pipeline', kind: 'pipeline', col, row: i });
      // Match receive locations to pipelines by name
      receiveLocations.forEach((rl, ri) => {
        if (rl.pipelineName === p) edges.push({ from: `rl_${ri}`, to: id });
      });
    });
    col++;
  }

  // Col 2: Orchestrations
  const orchIds: string[] = [];
  if (orchestrations.length > 0) {
    orchestrations.forEach((orch, i) => {
      const id = `orch_${i}`;
      orchIds.push(id);
      nodes.push({ id, label: orch.name, sub: 'Orchestration', kind: 'orchestration', col, row: i });
    });
    // Connect previous column → orchestrations (heuristic, not cartesian)
    heuristicEdges(rpIds.length > 0 ? rpIds : rlIds, orchIds, edges);
    col++;
  }

  // Col 3: Maps
  const mapIds: string[] = [];
  if (maps.length > 0) {
    maps.forEach((m, i) => {
      const id = `map_${i}`;
      mapIds.push(id);
      const srcShort = m.sourceSchemaRef.split('.').pop() ?? m.sourceSchemaRef;
      const dstShort = m.destinationSchemaRef.split('.').pop() ?? m.destinationSchemaRef;
      nodes.push({ id, label: m.name, sub: `${srcShort} → ${dstShort}`, kind: 'map', col, row: i });
    });
    // Connect orchestrations → maps (heuristic), or rcvPipelines if no orchs
    const prevIds = orchIds.length > 0 ? orchIds : (rpIds.length > 0 ? rpIds : rlIds);
    heuristicEdges(prevIds, mapIds, edges);
    col++;
  }

  // Col 4: Send Pipelines
  const spIds: string[] = [];
  if (sndPipelines.length > 0) {
    sndPipelines.forEach((p, i) => {
      const id = `sp_${i}`;
      spIds.push(id);
      nodes.push({ id, label: p, sub: 'Send Pipeline', kind: 'pipeline', col, row: i });
    });
    // Connect previous column → send pipelines (heuristic)
    const prevIds = mapIds.length > 0 ? mapIds
      : orchIds.length > 0 ? orchIds
      : rpIds.length > 0 ? rpIds
      : rlIds;
    heuristicEdges(prevIds, spIds, edges);
    col++;
  }

  // Col 5: Send Ports
  const sptIds: string[] = [];
  sendPorts.forEach((sp, i) => {
    const id = `spt_${i}`;
    sptIds.push(id);
    nodes.push({ id, label: sp.name, sub: sp.adapterType, kind: 'sendport', col, row: i });
    if (sndPipelines.length > 0) {
      // Match send ports to pipelines by name
      sndPipelines.forEach((p, si) => {
        if (sp.pipelineName === p) edges.push({ from: `sp_${si}`, to: id });
      });
    }
  });
  if (sptIds.length > 0 && spIds.length === 0) {
    // No send pipelines — connect from previous column (heuristic)
    const prevIds = mapIds.length > 0 ? mapIds
      : orchIds.length > 0 ? orchIds
      : rlIds;
    heuristicEdges(prevIds, sptIds, edges);
  }

  if (nodes.length === 0) return '';

  const svg = svgWrapper(nodes, edges, 'biztalk');

  // Details table
  const tableRows: string[] = [];
  receiveLocations.forEach(rl =>
    tableRows.push(`<tr><td>Receive Location</td><td><strong>${esc(rl.name)}</strong></td><td>${esc(rl.adapterType)}</td><td><code>${esc(rl.address)}</code></td></tr>`)
  );
  app.orchestrations.forEach(orch =>
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
  <div class="dia-svg-wrap">${svg}</div>
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

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  // Build workflow name → index map for child call resolution
  const wfNameToIndex = new Map(workflows.map((wf, i) => [wf.name, i]));

  // Collect connectors and child calls per workflow
  const allConnectors = new Map<string, string>(); // connectionName → serviceProviderId
  const wfConnectors  = new Map<number, string[]>(); // wf index → connectionNames used
  const wfChildCalls  = new Map<number, string[]>(); // wf index → child workflow names

  workflows.forEach((wf, i) => {
    const actions    = wf.workflow.definition.actions ?? {};
    const triggers   = wf.workflow.definition.triggers ?? {};
    const connUsed: string[] = [];
    const childCalls: string[] = [];

    for (const action of Object.values(actions)) {
      if (action.type === 'ServiceProvider') {
        const sp = (action as ServiceProviderAction).inputs.serviceProviderConfiguration;
        connUsed.push(sp.connectionName);
        if (!allConnectors.has(sp.connectionName)) {
          allConnectors.set(sp.connectionName, sp.serviceProviderId);
        }
      } else if (action.type === 'Workflow') {
        const wa = action as WorkflowAction;
        childCalls.push(wa.inputs.host.workflow.id);
      }
    }
    // Also check trigger connectors
    for (const trigger of Object.values(triggers)) {
      if (trigger.type === 'ServiceProvider') {
        const sp = trigger.inputs.serviceProviderConfiguration;
        connUsed.push(sp.connectionName);
        if (!allConnectors.has(sp.connectionName)) {
          allConnectors.set(sp.connectionName, sp.serviceProviderId);
        }
      }
    }

    wfConnectors.set(i, [...new Set(connUsed)]);
    wfChildCalls.set(i, childCalls);
  });

  const connList = [...allConnectors.entries()]; // [connectionName, serviceProviderId][]

  // Col 0: Triggers, Col 1: Workflows
  workflows.forEach((wf, i) => {
    const def            = wf.workflow.definition;
    const triggerEntries = Object.entries(def.triggers ?? {});
    const trigName       = triggerEntries[0]?.[0] ?? 'Trigger';
    const trigObj        = triggerEntries[0]?.[1];

    let trigSub = 'Trigger';
    if (trigObj) {
      if (trigObj.type === 'Request') {
        trigSub = 'HTTP Trigger';
      } else if (trigObj.type === 'Recurrence') {
        trigSub = 'Schedule';
      } else if (trigObj.type === 'ServiceProvider') {
        trigSub = trigObj.inputs.serviceProviderConfiguration.connectionName;
      }
    }

    const actCount = Object.keys(def.actions ?? {}).length;
    const wfSub    = actCount > 0 ? `${actCount} action${actCount !== 1 ? 's' : ''}` : 'no actions';

    nodes.push({ id: `trig_${i}`, label: trigName.replace(/_/g, ' '), sub: trigSub, kind: 'trigger', col: 0, row: i });
    nodes.push({ id: `wf_${i}`,   label: wf.name, sub: wfSub, kind: 'workflow', col: 1, row: i });
    edges.push({ from: `trig_${i}`, to: `wf_${i}` });
  });

  // Col 2: Connectors (if any)
  if (connList.length > 0) {
    connList.forEach(([connName, serviceProviderId], j) => {
      const providerShort = serviceProviderId.split('/').pop() ?? serviceProviderId;
      nodes.push({ id: `conn_${j}`, label: connName, sub: providerShort, kind: 'connector', col: 2, row: j });
    });
    // Edges: workflow → connectors it uses
    workflows.forEach((_, i) => {
      const used = wfConnectors.get(i) ?? [];
      used.forEach(connName => {
        const j = connList.findIndex(([cn]) => cn === connName);
        if (j >= 0) edges.push({ from: `wf_${i}`, to: `conn_${j}` });
      });
    });
  }

  // Dashed edges for child workflow calls (within workflow column)
  workflows.forEach((_, i) => {
    const calls = wfChildCalls.get(i) ?? [];
    calls.forEach(calledName => {
      const j = wfNameToIndex.get(calledName);
      if (j !== undefined && j !== i) {
        edges.push({ from: `wf_${i}`, to: `wf_${j}`, dashed: true });
      }
    });
  });

  const svg = svgWrapper(nodes, edges, 'logicapps');

  const tableRows = workflows.map(wf => {
    const def      = wf.workflow.definition;
    const triggers = Object.keys(def.triggers ?? {});
    const actions  = Object.keys(def.actions ?? {});
    return `<tr><td><strong>${esc(wf.name)}</strong></td><td>${esc(triggers.join(', ') || '—')}</td><td>${actions.length}</td><td>${esc(wf.workflow.kind ?? 'Stateful')}</td></tr>`;
  });

  return `
<div class="dia-wrap">
  <div class="dia-svg-wrap">${svg}</div>
  <details class="dia-details">
    <summary>View workflow details</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>Workflow</th><th>Trigger</th><th>Actions</th><th>Kind</th></tr></thead>
      <tbody>${tableRows.join('')}</tbody>
    </table></div>
  </details>
</div>`;
}
