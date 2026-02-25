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

import { readBizTalkFile } from './read-biztalk-file.js';
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
      // These elements always come back as arrays even when singular.
      // 'Element' and 'Property' cover the real BizTalk MetaModel format.
      ['Service', 'PortDeclaration', 'MessageDeclaration', 'CorrelationDeclaration',
       'VariableDeclaration', 'Shape', 'Branch', 'ExceptionHandler',
       'PropertyDeclaration', 'Parameter', 'Element', 'Property'].includes(name),
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
  const raw = await readBizTalkFile(filePath);
  // Real .odx files embed the XML designer data inside a C# preprocessor block:
  //   #if __DESIGNER_DATA
  //   <Module xmlns="...">...</Module>
  //   #endif
  // Extract just the XML portion if the wrapper is present.
  const xml = extractOdxXml(raw);
  return analyzeOrchestrationXml(xml, filePath);
}

/**
 * Extracts the XML designer data block from a raw .odx file.
 * If the content is already pure XML (e.g. a .odx.xml fixture), returns it unchanged.
 */
function extractOdxXml(raw: string): string {
  const start = raw.indexOf('#if __DESIGNER_DATA');
  const end   = raw.indexOf('#endif', start);
  if (start !== -1 && end !== -1) {
    // Grab everything between the two markers, trimmed
    return raw.slice(start + '#if __DESIGNER_DATA'.length, end).trim();
  }
  return raw;
}

/**
 * Parses ODX XML content directly (useful for testing without file I/O).
 */
export function analyzeOrchestrationXml(xml: string, filePath: string = '<inline>'): ParsedOrchestration {
  const parser = makeParser();
  const doc = parser.parse(xml) as Record<string, unknown>;

  // Real BizTalk ODX files use om:MetaModel as root (strips to 'MetaModel' via removeNSPrefix).
  const metaModel = doc['MetaModel'] as Record<string, unknown> | undefined;
  if (metaModel) {
    return parseMetaModelFormat(metaModel, filePath);
  }

  // Simplified fixture format: root is Module → contains Service array
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
    'decideshape':    'DecisionShape',   // ODX uses Type="DecideShape" in the XML
    'decidebranch':   'GroupShape',      // branch container — treated as a group
    'decisionbranch': 'GroupShape',      // real ODX: Type="DecisionBranch"
    'decide': 'DecisionShape',
    'decision': 'DecisionShape',
    'loopshape': 'LoopShape',
    'loop': 'LoopShape',
    'while': 'LoopShape',               // real ODX: Type="While"
    'catch': 'GroupShape',              // real ODX: Type="Catch" (exception handler)
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
    'call': 'CallOrchestrationShape',           // Real ODX: Type="Call"
    'startorchestrationshape': 'StartOrchestrationShape',
    'startorchestration': 'StartOrchestrationShape',
    'start': 'StartOrchestrationShape',         // Real ODX: Type="Start"
    'callrulesshape': 'CallRulesShape',
    'callrules': 'CallRulesShape',
    'suspendshape': 'SuspendShape',
    'suspend': 'SuspendShape',
    'groupshape': 'GroupShape',
    'group': 'GroupShape',
    'parallelbranch': 'GroupShape',             // Real ODX: parallel branch container
    'task': 'GroupShape',                       // Real ODX: task group container
    'variableassignment': 'ExpressionShape',    // Real ODX: variable assignment statement
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

// ─── MetaModel Format Parser ───────────────────────────────────────────────────
//
// Real BizTalk ODX files use a generic Element/Property tree rooted at <om:MetaModel>.
// Every node is <om:Element Type="..."> with <om:Property Name="..." Value="..."> children.

/**
 * Element types within ServiceBody (and nested containers) that represent
 * actual orchestration shapes. All others are declarations or containers.
 */
const SHAPE_ELEMENT_TYPES = new Set([
  'Receive', 'Send', 'Construct', 'Transform', 'MessageAssignment',
  'Call', 'Start', 'CallRules',
  'Decide', 'Decision', 'Loop', 'While', 'Listen',
  'DecisionBranch', 'Parallel', 'ParallelBranch',
  'Scope', 'Catch', 'Compensate', 'Delay',
  'Expression', 'VariableAssignment',
  'Suspend', 'Terminate', 'Throw',
  'Task', 'Group',
]);

function parseMetaModelFormat(metaModel: Record<string, unknown>, filePath: string): ParsedOrchestration {
  const topElements = mmArray(metaModel['Element']);

  // Find the Module element
  const moduleEl = topElements.find(e => mmType(e) === 'Module');
  if (!moduleEl) {
    throw new OdxParseError(`No Module element found in MetaModel in ${filePath}`);
  }

  const moduleProps = mmProps(moduleEl);
  const moduleName = moduleProps['Name'] ?? '';

  // ServiceDeclaration = the orchestration class
  const moduleChildren = mmArray(moduleEl['Element']);
  const serviceDecl = moduleChildren.find(e => mmType(e) === 'ServiceDeclaration');
  if (!serviceDecl) {
    throw new OdxParseError(`No ServiceDeclaration element found in ${filePath}`);
  }

  const serviceProps = mmProps(serviceDecl);
  const orchestrationName = serviceProps['Name'] ?? moduleName;
  const namespace = moduleName;

  const serviceChildren = mmArray(serviceDecl['Element']);

  // Messages
  const messages: OdxMessageDeclaration[] = serviceChildren
    .filter(e => mmType(e) === 'MessageDeclaration')
    .map(e => {
      const p = mmProps(e);
      return {
        name: p['Name'] ?? '',
        messageType: p['Type'] ?? '',
        isMultiPart: false,
      };
    });

  // Ports — polarity comes from PortModifier property
  const ports: OdxPort[] = serviceChildren
    .filter(e => mmType(e) === 'PortDeclaration')
    .map(e => {
      const p = mmProps(e);
      return {
        name: p['Name'] ?? '',
        portTypeRef: p['Type'] ?? '',
        polarity: (p['PortModifier'] === 'Implements' ? 'Implements' : 'Uses') as PortPolarity,
      };
    });

  // Shapes from ServiceBody
  const serviceBody = serviceChildren.find(e => mmType(e) === 'ServiceBody');
  const shapes = serviceBody
    ? extractMetaModelShapes(mmArray(serviceBody['Element']))
    : [];

  // Correlation sets (rare in SDK samples but handle anyway)
  const correlationSets: OdxCorrelationSet[] = [];
  const variables: OdxVariable[] = [];

  const allShapes = flattenShapes(shapes);
  const hasAtomicTransactions = allShapes.some(
    s => s.shapeType === 'ScopeShape' && s['transactionType'] === 'Atomic',
  );
  const hasLongRunningTransactions = allShapes.some(
    s => s.shapeType === 'ScopeShape' && s['transactionType'] === 'LongRunning',
  );
  const hasCompensation = allShapes.some(s => s.shapeType === 'CompensateShape');
  const hasBRECalls = allShapes.some(s => s.shapeType === 'CallRulesShape');
  const hasSuspend = allShapes.some(s => s.shapeType === 'SuspendShape');
  const activatingReceiveCount = allShapes.filter(
    s => s.shapeType === 'ReceiveShape' && s.isActivating === true,
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

function extractMetaModelShapes(elements: Record<string, unknown>[]): OdxShape[] {
  const result: OdxShape[] = [];
  for (const el of elements) {
    const type = mmType(el);
    if (!SHAPE_ELEMENT_TYPES.has(type)) continue;
    result.push(parseMetaModelShape(el, type));
  }
  return result;
}

function parseMetaModelShape(el: Record<string, unknown>, type: string): OdxShape {
  const props = mmProps(el);
  const shapeType = normalizeShapeType(type);
  const name = props['Name'] ?? '';
  const shapeId = String(el['@_OID'] ?? '');

  const shape: OdxShape = {
    shapeType,
    shapeId,
    ...(name ? { name } : {}),
  };

  switch (shapeType) {
    case 'ReceiveShape':
      shape.isActivating = props['Activate'] === 'True';
      break;

    case 'CallOrchestrationShape':
    case 'StartOrchestrationShape':
      // Invokee holds the fully-qualified called orchestration type name
      shape.calledOrchestration = props['Invokee'] ?? '';
      break;

    case 'TransformShape':
      shape.mapClass = props['ClassName'] ?? props['MapType'] ?? '';
      break;

    case 'ScopeShape': {
      // Transaction type is encoded as a child Element (LongRunningTransaction / AtomicTransaction)
      const childEls = mmArray(el['Element']);
      const txEl = childEls.find(
        c => mmType(c) === 'LongRunningTransaction' || mmType(c) === 'AtomicTransaction',
      );
      if (txEl) {
        shape.transactionType = mmType(txEl) === 'AtomicTransaction' ? 'Atomic' : 'LongRunning';
      } else {
        shape.transactionType = 'None';
      }
      break;
    }

    case 'LoopShape': {
      // While loop condition is stored in the Expression property
      const exprProp = props['Expression'] ?? '';
      if (exprProp) shape.conditionExpression = exprProp;
      break;
    }

    case 'DecisionShape': {
      // Condition expressions live on DecisionBranch children, not on Decision itself.
      // Extract the first branch's Expression property as a representative condition.
      const branchEls = mmArray(el['Element']).filter(c => mmType(c) === 'DecisionBranch');
      const firstExpr = branchEls.length > 0 ? mmProps(branchEls[0]!)['Expression'] : undefined;
      if (firstExpr) shape.conditionExpression = firstExpr;
      break;
    }

    case 'ExpressionShape':
    case 'MessageAssignmentShape': {
      const exprProp = props['Expression'] ?? '';
      if (exprProp) shape.codeExpression = exprProp;
      break;
    }
  }

  // Recursively extract child shapes (branches, scope body, etc.)
  const childEls = mmArray(el['Element']);
  const children = extractMetaModelShapes(childEls);
  if (children.length > 0) shape.children = children;

  return shape;
}

// ─── MetaModel Helpers ─────────────────────────────────────────────────────────

/** Returns the Type attribute of an om:Element node */
function mmType(el: Record<string, unknown>): string {
  return String(el['@_Type'] ?? '');
}

/** Extracts all om:Property Name/Value pairs into a flat record */
function mmProps(el: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  const props = mmArray<Record<string, unknown>>(el['Property']);
  for (const p of props) {
    const name = String(p['@_Name'] ?? '');
    const value = String(p['@_Value'] ?? '');
    if (name) result[name] = value;
  }
  return result;
}

/** Ensures a value is always returned as an array */
function mmArray<T = Record<string, unknown>>(val: unknown): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val as T[];
  return [val as T];
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class OdxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OdxParseError';
  }
}
