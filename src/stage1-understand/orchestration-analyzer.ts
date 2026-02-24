/**
 * Orchestration Analyzer — Stage 1 (Understand)
 *
 * Parses a BizTalk .odx file (which is XML) and produces a ParsedOrchestration.
 * The ODX format uses the om: namespace from:
 *   http://schemas.microsoft.com/BizTalk/2003/DesignerData
 *
 * Key structures extracted:
 *   - All orchestration shapes (recursively, flattened)
 *   - Port declarations with polarity (Implements = receive, Uses = send)
 *   - Message type declarations
 *   - Correlation set declarations
 *   - Variable declarations
 *   - Derived flags (hasAtomicTransactions, hasBRECalls, etc.)
 */

import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import type {
  ParsedOrchestration,
  OdxShape,
  OdxPort,
  OdxCorrelationSet,
  OdxMessageDeclaration,
  OdxVariable,
  ShapeType,
  TransactionType,
  PortPolarity,
} from '../types/biztalk.js';

// ─── XML Parser Setup ─────────────────────────────────────────────────────────

function makeParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,           // Strip om:, baf:, etc. → clean attribute names
    isArray: (name) =>
      // These elements always come back as arrays even when singular
      ['Service', 'PortDeclaration', 'MessageDeclaration', 'CorrelationDeclaration',
       'VariableDeclaration', 'Shape', 'Branch', 'ExceptionHandler',
       'PropertyDeclaration', 'Parameter'].includes(name),
    parseTagValue: true,
    trimValues: true,
  });
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Parses a .odx file and returns a ParsedOrchestration.
 * The filePath should point to the raw .odx XML file (not compiled .dll).
 */
export async function analyzeOrchestration(filePath: string): Promise<ParsedOrchestration> {
  const xml = await readFile(filePath, 'utf-8');
  return analyzeOrchestrationXml(xml, filePath);
}

/**
 * Parses ODX XML content directly (useful for testing without file I/O).
 */
export function analyzeOrchestrationXml(xml: string, filePath: string = '<inline>'): ParsedOrchestration {
  const parser = makeParser();
  const doc = parser.parse(xml) as Record<string, unknown>;

  // Root is Module → contains Service array
  const moduleEl = doc['Module'] as Record<string, unknown> | undefined;
  if (!moduleEl) {
    throw new OdxParseError(`Root <Module> element not found in ${filePath}`);
  }

  const moduleName = String(moduleEl['@_Name'] ?? '');
  const services = (moduleEl['Service'] as Record<string, unknown>[] | undefined) ?? [];

  if (services.length === 0) {
    throw new OdxParseError(`No <Service> elements found in ${filePath}`);
  }

  // BizTalk typically has one Service per .odx file (the orchestration class)
  const service = services[0]!;
  const namespace = String(service['@_RootDefaultNamespace'] ?? moduleName);
  const orchestrationName = String(service['@_Name'] ?? moduleName);

  // Extract component declarations
  const ports = extractPorts(service);
  const messages = extractMessages(service);
  const correlationSets = extractCorrelationSets(service);
  const variables = extractVariables(service);

  // Extract shape tree — shapes live inside the ServiceBody/Symbol/Body structure
  const shapes = extractShapes(service);

  // Derive boolean flags by inspecting what shapes were found
  const allShapes = flattenShapes(shapes);
  const hasAtomicTransactions = allShapes.some(
    s => s.shapeType === 'ScopeShape' && s['transactionType'] === 'Atomic'
  );
  const hasLongRunningTransactions = allShapes.some(
    s => s.shapeType === 'ScopeShape' && s['transactionType'] === 'LongRunning'
  );
  const hasCompensation = allShapes.some(s => s.shapeType === 'CompensateShape');
  const hasBRECalls = allShapes.some(s => s.shapeType === 'CallRulesShape');
  const hasSuspend = allShapes.some(s => s.shapeType === 'SuspendShape');
  const activatingReceiveCount = allShapes.filter(
    s => s.shapeType === 'ReceiveShape' && s.isActivating === true
  ).length;

  return {
    name: orchestrationName,
    namespace,
    filePath,
    shapes,
    ports,
    correlationSets,
    messages,
    variables,
    hasAtomicTransactions,
    hasLongRunningTransactions,
    hasCompensation,
    hasBRECalls,
    hasSuspend,
    activatingReceiveCount,
  };
}

// ─── Shape Extraction ─────────────────────────────────────────────────────────

/**
 * Extracts shapes from the service element.
 * BizTalk ODX stores shapes in several possible locations:
 *   1. Directly as <Shape> children of the service
 *   2. Inside a ServiceBody/Symbol/Body structure (older format)
 *   3. Inside XmlContent (designer data format)
 */
function extractShapes(service: Record<string, unknown>): OdxShape[] {
  // Try direct Shape children first
  const directShapes = service['Shape'] as Record<string, unknown>[] | undefined;
  if (directShapes && directShapes.length > 0) {
    return directShapes.map(parseShape);
  }

  // Try ServiceBody → Symbol → Body path (common in BizTalk 2013+)
  const serviceBody = getNestedEl(service, 'Properties', 'XmlContent', 'ServiceBody');
  if (serviceBody) {
    const symbol = getNestedEl(serviceBody as Record<string, unknown>, 'Symbol') as Record<string, unknown> | undefined;
    if (symbol) {
      const body = symbol['Body'] as Record<string, unknown> | undefined;
      if (body) {
        const bodyShapes = body['Shape'] as Record<string, unknown>[] | undefined;
        if (bodyShapes) {
          return bodyShapes.map(parseShape);
        }
      }
    }
  }

  // Try direct Body element (some formats)
  const body = service['Body'] as Record<string, unknown> | undefined;
  if (body) {
    const bodyShapes = body['Shape'] as Record<string, unknown>[] | undefined;
    if (bodyShapes) return bodyShapes.map(parseShape);
  }

  return [];
}

function parseShape(el: Record<string, unknown>): OdxShape {
  const shapeType = normalizeShapeType(String(el['@_type'] ?? el['@_Type'] ?? 'UnknownShape'));
  const shapeId = String(el['@_ID'] ?? el['@_id'] ?? '');
  const name = String(el['@_Name'] ?? el['@_name'] ?? '');

  const shape: OdxShape = { shapeType, shapeId, ...(name ? { name } : {}) };

  // Shape-specific property extraction
  switch (shapeType) {
    case 'ReceiveShape':
      shape.isActivating = String(el['@_Activate'] ?? el['@_activate'] ?? 'false') === 'true';
      break;

    case 'DecisionShape':
    case 'LoopShape': {
      // Condition expression — may be in nested Expression element or attribute
      const exprEl = el['Expression'] ?? el['Condition'];
      shape.conditionExpression = extractTextContent(exprEl) ?? String(el['@_Expression'] ?? '');
      break;
    }

    case 'TransformShape':
      shape.mapClass = String(el['@_MapType'] ?? el['@_ClassName'] ?? '');
      break;

    case 'CallOrchestrationShape':
    case 'StartOrchestrationShape':
      shape.calledOrchestration = String(el['@_OrchestrationTypeName'] ?? el['@_CalledOrchestration'] ?? '');
      break;

    case 'CallRulesShape':
      shape.rulePolicyName = String(el['@_PolicyName'] ?? el['@_RulePolicy'] ?? '');
      break;

    case 'ScopeShape': {
      const txType = String(el['@_TransactionType'] ?? el['@_Transaction_Type'] ?? 'None');
      shape.transactionType = normalizeTransactionType(txType);
      break;
    }

    case 'DelayShape': {
      const delayText = extractTextContent(el['Expression'] ?? el['Delay']);
      if (delayText !== undefined) shape.delayExpression = delayText;
      break;
    }

    case 'ExpressionShape':
    case 'MessageAssignmentShape': {
      const codeEl = el['Expression'] ?? el['Code'] ?? el['Statement'];
      const codeText = extractTextContent(codeEl);
      if (codeText !== undefined) shape.codeExpression = codeText;
      break;
    }
  }

  // Recursively parse children (branches, scope body, etc.)
  const children = extractChildShapes(el);
  if (children.length > 0) {
    shape.children = children;
  }

  return shape;
}

function extractChildShapes(el: Record<string, unknown>): OdxShape[] {
  const result: OdxShape[] = [];

  // Direct child Shape elements
  const shapes = el['Shape'] as Record<string, unknown>[] | undefined;
  if (shapes) result.push(...shapes.map(parseShape));

  // Branch shapes (Decide, Listen)
  const branches = el['Branch'] as Record<string, unknown>[] | undefined;
  if (branches) {
    for (const branch of branches) {
      const branchShapes = branch['Shape'] as Record<string, unknown>[] | undefined;
      if (branchShapes) result.push(...branchShapes.map(parseShape));
    }
  }

  // Exception handlers (Scope catch blocks)
  const handlers = el['ExceptionHandler'] as Record<string, unknown>[] | undefined;
  if (handlers) {
    for (const handler of handlers) {
      const handlerShapes = handler['Shape'] as Record<string, unknown>[] | undefined;
      if (handlerShapes) result.push(...handlerShapes.map(parseShape));
    }
  }

  return result;
}

// ─── Port Extraction ──────────────────────────────────────────────────────────

function extractPorts(service: Record<string, unknown>): OdxPort[] {
  const portDecls = getNestedArray(service, 'PortDeclarations', 'PortDeclaration')
    ?? (service['PortDeclaration'] as Record<string, unknown>[] | undefined)
    ?? [];

  return portDecls.map(pd => {
    const binding = String(pd['@_Binding'] ?? '') || undefined;
    return {
      name: String(pd['@_Name'] ?? ''),
      portTypeRef: String(pd['@_PortTypeName'] ?? pd['@_Type'] ?? ''),
      polarity: normalizePolarity(String(pd['@_Polarity'] ?? pd['@_Direction'] ?? 'Uses')),
      ...(binding ? { binding } : {}),
    };
  });
}

// ─── Message Extraction ───────────────────────────────────────────────────────

function extractMessages(service: Record<string, unknown>): OdxMessageDeclaration[] {
  const msgDecls = getNestedArray(service, 'MessageDeclarations', 'MessageDeclaration')
    ?? (service['MessageDeclaration'] as Record<string, unknown>[] | undefined)
    ?? [];

  return msgDecls.map(md => ({
    name: String(md['@_Name'] ?? ''),
    messageType: String(md['@_Type'] ?? md['@_TypeName'] ?? md['@_MessageType'] ?? ''),
    isMultiPart: String(md['@_IsMultiPart'] ?? 'false') === 'true',
  }));
}

// ─── Correlation Set Extraction ───────────────────────────────────────────────

function extractCorrelationSets(service: Record<string, unknown>): OdxCorrelationSet[] {
  const corrDecls = getNestedArray(service, 'CorrelationDeclarations', 'CorrelationDeclaration')
    ?? (service['CorrelationDeclaration'] as Record<string, unknown>[] | undefined)
    ?? [];

  return corrDecls.map(cd => {
    const typeRef = String(cd['@_CorrelationTypeName'] ?? cd['@_Type'] ?? '');
    // Correlation properties may be listed as comma-separated string or nested elements
    const propStr = String(cd['@_Properties'] ?? '');
    const correlationProperties = propStr
      ? propStr.split(',').map(p => p.trim()).filter(Boolean)
      : [];
    return {
      name: String(cd['@_Name'] ?? ''),
      correlationTypeRef: typeRef,
      correlationProperties,
    };
  });
}

// ─── Variable Extraction ──────────────────────────────────────────────────────

function extractVariables(service: Record<string, unknown>): OdxVariable[] {
  const varDecls = getNestedArray(service, 'VariableDeclarations', 'VariableDeclaration')
    ?? (service['VariableDeclaration'] as Record<string, unknown>[] | undefined)
    ?? [];

  return varDecls.map(vd => ({
    name: String(vd['@_Name'] ?? ''),
    csharpType: String(vd['@_Type'] ?? vd['@_CLRType'] ?? vd['@_TypeName'] ?? 'System.Object'),
  }));
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Recursively flattens a shape tree into a single array */
export function flattenShapes(shapes: OdxShape[]): OdxShape[] {
  const result: OdxShape[] = [];
  for (const shape of shapes) {
    result.push(shape);
    if (shape.children) result.push(...flattenShapes(shape.children));
  }
  return result;
}

function normalizeShapeType(raw: string): ShapeType {
  // Map common variants to canonical ShapeType names
  const map: Record<string, ShapeType> = {
    'receiveshape': 'ReceiveShape',
    'receive': 'ReceiveShape',
    'sendshape': 'SendShape',
    'send': 'SendShape',
    'constructshape': 'ConstructShape',
    'construct': 'ConstructShape',
    'messageassignmentshape': 'MessageAssignmentShape',
    'messageassignment': 'MessageAssignmentShape',
    'transformshape': 'TransformShape',
    'transform': 'TransformShape',
    'decisionshape': 'DecisionShape',
    'decideshape':   'DecisionShape',   // ODX uses Type="DecideShape" in the XML
    'decidebranch':  'GroupShape',      // branch container — treated as a group
    'decide': 'DecisionShape',
    'decision': 'DecisionShape',
    'loopshape': 'LoopShape',
    'loop': 'LoopShape',
    'listenshape': 'ListenShape',
    'listen': 'ListenShape',
    'parallelactionsshape': 'ParallelActionsShape',
    'parallelactions': 'ParallelActionsShape',
    'parallel': 'ParallelActionsShape',
    'scopeshape': 'ScopeShape',
    'scope': 'ScopeShape',
    'compensateshape': 'CompensateShape',
    'compensate': 'CompensateShape',
    'throwshape': 'ThrowShape',
    'throw': 'ThrowShape',
    'terminateshape': 'TerminateShape',
    'terminate': 'TerminateShape',
    'delayshape': 'DelayShape',
    'delay': 'DelayShape',
    'expressionshape': 'ExpressionShape',
    'expression': 'ExpressionShape',
    'callorchestrationshape': 'CallOrchestrationShape',
    'callorchestration': 'CallOrchestrationShape',
    'startorchestrationshape': 'StartOrchestrationShape',
    'startorchestration': 'StartOrchestrationShape',
    'callrulesshape': 'CallRulesShape',
    'callrules': 'CallRulesShape',
    'suspendshape': 'SuspendShape',
    'suspend': 'SuspendShape',
    'groupshape': 'GroupShape',
    'group': 'GroupShape',
    'rolelinkshape': 'RoleLinkShape',
    'rolelink': 'RoleLinkShape',
    'commentshape': 'CommentShape',
    'comment': 'CommentShape',
  };
  return map[raw.toLowerCase()] ?? 'CommentShape';
}

function normalizeTransactionType(raw: string): TransactionType {
  const lower = raw.toLowerCase();
  if (lower === 'atomic') return 'Atomic';
  if (lower === 'longrunning' || lower === 'long_running' || lower === 'long running') return 'LongRunning';
  return 'None';
}

function normalizePolarity(raw: string): PortPolarity {
  return raw === 'Implements' || raw.toLowerCase() === 'implements' ? 'Implements' : 'Uses';
}

function extractTextContent(el: unknown): string | undefined {
  if (el === null || el === undefined) return undefined;
  if (typeof el === 'string') return el || undefined;
  if (typeof el === 'object') {
    const obj = el as Record<string, unknown>;
    // Try common text content keys
    const text = obj['#text'] ?? obj['_'] ?? obj['text'] ?? obj['$t'];
    if (text !== undefined) return String(text) || undefined;
  }
  return String(el) || undefined;
}

function getNestedEl(obj: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function getNestedArray(
  obj: Record<string, unknown>,
  containerKey: string,
  itemKey: string
): Record<string, unknown>[] | undefined {
  const container = obj[containerKey] as Record<string, unknown> | undefined;
  if (!container) return undefined;
  const items = container[itemKey] as Record<string, unknown>[] | undefined;
  return items;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class OdxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OdxParseError';
  }
}
