/**
 * Binding Analyzer — Stage 1 (Understand)
 *
 * Parses a BizTalk BindingInfo.xml file and produces a ParsedBindingFile.
 *
 * The binding file captures the physical connectivity configuration:
 *   - Receive ports + locations (with adapter type, address, TransportTypeData)
 *   - Send ports (with adapter type, address, filter expressions)
 *   - Pipeline assignments
 *
 * TransportTypeData is a CDATA-encoded XML string of CustomProps —
 * we parse it to extract adapter-specific settings (polling interval, etc.)
 *
 * IMPORTANT: This analyzer intentionally does NOT capture credential values
 * (passwords, SAS keys, connection strings). Those are scrubbed and replaced
 * with placeholder strings. Only structural metadata is retained.
 */

import { XMLParser } from 'fast-xml-parser';
import { readBizTalkFile } from './read-biztalk-file.js';
import type {
  ParsedBindingFile,
  ReceiveLocation,
  SendPort,
} from '../types/biztalk.js';

// ─── Credential Scrubbing ─────────────────────────────────────────────────────

/** Property names that contain credentials — their values are replaced */
const CREDENTIAL_PROPERTY_NAMES = new Set([
  'Password', 'password', 'SasKey', 'PrimaryKey', 'SecondaryKey',
  'ConnectionString', 'AccountKey', 'SharedAccessKey', 'Secret',
  'ClientSecret', 'ApiKey', 'Token', 'PrivateKey', 'Passphrase',
  'SSOConfigApp', // SSO app names are retained but flagged
]);

function scrubCredentialValue(key: string, value: string): string {
  if (CREDENTIAL_PROPERTY_NAMES.has(key)) {
    return '<REDACTED>';
  }
  // Also redact if value looks like a connection string
  if (value.includes('AccountKey=') || value.includes('Password=') || value.includes('pwd=')) {
    return '<REDACTED_CONNECTION_STRING>';
  }
  return value;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function analyzeBindings(filePath: string): Promise<ParsedBindingFile> {
  const xml = await readBizTalkFile(filePath);
  return analyzeBindingsXml(xml, filePath);
}

export function analyzeBindingsXml(xml: string, filePath: string = '<inline>'): ParsedBindingFile {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) => [
      'ReceivePort', 'ReceiveLocation', 'SendPort', 'SendPortGroup',
      'BizTalkBinding', 'SendPortRef',
    ].includes(name),
    parseTagValue: true,
    trimValues: true,
    cdataPropName: '__cdata',
  });

  const doc = parser.parse(xml) as Record<string, unknown>;

  // Root element: BindingInfo
  const root = doc['BindingInfo'] as Record<string, unknown> | undefined;
  if (!root) {
    throw new BindingParseError(`Root <BindingInfo> element not found in ${filePath}`);
  }

  const applicationName = String(root['@_Name'] ?? root['@_Assembly'] ?? 'UnknownApplication');

  const receiveLocations = extractReceiveLocations(root);
  const sendPorts = extractSendPorts(root);

  return {
    applicationName,
    filePath,
    receiveLocations,
    sendPorts,
  };
}

// ─── Receive Location Extraction ──────────────────────────────────────────────

function extractReceiveLocations(root: Record<string, unknown>): ReceiveLocation[] {
  const result: ReceiveLocation[] = [];

  // ReceivePortCollection (BizTalk native) or ReceivePorts (alternative) → ReceivePort[]
  const receivePorts =
    getArray(root, 'ReceivePortCollection', 'ReceivePort') ??
    getArray(root, 'ReceivePorts', 'ReceivePort') ?? [];

  for (const rp of receivePorts) {
    const receivePortName = String(rp['@_Name'] ?? '');
    const locations =
      getArray(rp, 'ReceiveLocationCollection', 'ReceiveLocation') ??
      getArray(rp, 'ReceiveLocations', 'ReceiveLocation') ?? [];

    for (const rl of locations) {
      const adapterType = extractAdapterType(rl);
      const address = String(rl['@_Address'] ?? rl['Address'] ?? '');
      const pipelineName = extractPipelineName(rl, 'Receive');
      const transportTypeData = extractTransportTypeData(rl);

      result.push({
        name: String(rl['@_Name'] ?? ''),
        receivePortName,
        adapterType,
        address,
        pipelineName,
        adapterProperties: transportTypeData,
        isEnabled: String(rl['@_Enable'] ?? rl['@_Enabled'] ?? 'true') === 'true',
      });
    }
  }

  return result;
}

// ─── Send Port Extraction ─────────────────────────────────────────────────────

function extractSendPorts(root: Record<string, unknown>): SendPort[] {
  const result: SendPort[] = [];

  const sendPorts =
    getArray(root, 'SendPortCollection', 'SendPort') ??
    getArray(root, 'SendPorts', 'SendPort') ?? [];

  for (const sp of sendPorts) {
    const name = String(sp['@_Name'] ?? '');
    const adapterType = extractAdapterType(sp);
    const primary = sp['PrimaryTransport'] as Record<string, unknown> | undefined;
    const address = String(sp['@_Address'] ?? sp['Address'] ?? primary?.['Address'] ?? '');
    const pipelineName = extractPipelineName(sp, 'Send');
    const transportTypeData = extractTransportTypeData(sp);
    const filterExpression = extractFilterExpression(sp);
    const isDynamic = String(sp['@_IsDynamic'] ?? sp['@_Dynamic'] ?? 'false') === 'true';
    const isTwoWay = String(sp['@_IsTwoWay'] ?? sp['@_TwoWay'] ?? 'false') === 'true';

    result.push({
      name,
      adapterType,
      address,
      pipelineName,
      adapterProperties: transportTypeData,
      ...(filterExpression ? { filterExpression } : {}),
      isDynamic,
      isTwoWay,
    });
  }

  return result;
}

// ─── TransportTypeData Parsing ────────────────────────────────────────────────

/**
 * TransportTypeData is a CDATA-encoded XML fragment of adapter-specific properties.
 *
 * Example (FILE adapter):
 *   <![CDATA[<CustomProps>
 *     <PollingInterval vt="3">60000</PollingInterval>
 *     <FileMask vt="8">*.xml</FileMask>
 *   </CustomProps>]]>
 *
 * We parse the inner XML and return a flat key→value map.
 * Credential values are scrubbed.
 */
function extractTransportTypeData(port: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  // Find TransportTypeData — may be direct child or nested in TransportInfo
  const ttd = port['TransportTypeData']
    ?? (port['PrimaryTransport'] as Record<string, unknown> | undefined)?.['TransportTypeData']
    ?? (port['SecondaryTransport'] as Record<string, unknown> | undefined)?.['TransportTypeData'];

  if (!ttd) return result;

  // Extract the raw XML string (from CDATA or text content)
  let rawXml = '';
  if (typeof ttd === 'string') {
    rawXml = ttd;
  } else if (typeof ttd === 'object') {
    const ttdObj = ttd as Record<string, unknown>;
    rawXml = String(ttdObj['__cdata'] ?? ttdObj['#text'] ?? ttdObj['_'] ?? '');
  }

  if (!rawXml.trim()) return result;

  // Parse the inner XML
  try {
    const innerParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: true,
      trimValues: true,
    });
    const inner = innerParser.parse(rawXml) as Record<string, unknown>;
    const customProps = (inner['CustomProps'] ?? inner) as Record<string, unknown>;

    for (const [key, value] of Object.entries(customProps)) {
      if (key.startsWith('@_') || key === '#text') continue;
      // Value may be a string or an object with vt attribute (variant type) and text content
      let strValue: string;
      if (typeof value === 'string') {
        strValue = value;
      } else if (typeof value === 'object' && value !== null) {
        strValue = String((value as Record<string, unknown>)['#text']
          ?? (value as Record<string, unknown>)['_']
          ?? value);
      } else {
        strValue = String(value);
      }
      result[key] = scrubCredentialValue(key, strValue);
    }
  } catch {
    // If inner XML parsing fails, store the raw value (truncated)
    result['_rawTransportTypeData'] = rawXml.substring(0, 200);
  }

  return result;
}

// ─── Filter Expression Extraction ─────────────────────────────────────────────

/**
 * Extracts the BizTalk send port filter expression (subscription SQL).
 * These look like: "BTS.MessageType == 'http://...#Order' And BTS.ReceivePortName == 'InputPort'"
 */
function extractFilterExpression(sp: Record<string, unknown>): string {
  const filter = sp['Filter'] as Record<string, unknown> | string | undefined;
  if (!filter) return '';
  if (typeof filter === 'string') return filter;

  // Filter may be a nested Group → Statement structure
  const group = (filter as Record<string, unknown>)['Group'] as Record<string, unknown> | undefined;
  if (!group) return String(filter) || '';

  // Build a flat expression string from the statement tree
  return buildFilterExpression(group);
}

function buildFilterExpression(group: Record<string, unknown>): string {
  const statements = group['Statement'] as Record<string, unknown>[] | Record<string, unknown> | undefined;
  if (!statements) return '';

  const stmtArray = Array.isArray(statements) ? statements : [statements];
  const parts = stmtArray.map(stmt => {
    const property = String(stmt['@_Property'] ?? '');
    const operator = String(stmt['@_Operator'] ?? '==');
    const value = String(stmt['@_Value'] ?? '');
    return `${property} ${operatorLabel(operator)} "${value}"`;
  });

  return parts.join(' AND ');
}

function operatorLabel(op: string): string {
  const map: Record<string, string> = {
    '0': '==', '1': '!=', '2': '<', '3': '<=', '4': '>', '5': '>=',
    'Equal': '==', 'NotEqual': '!=', 'LessThan': '<', 'GreaterThan': '>',
  };
  return map[op] ?? op;
}

// ─── Adapter Type Extraction ──────────────────────────────────────────────────

function extractAdapterType(port: Record<string, unknown>): string {
  // Try direct attribute
  const direct = port['@_TransportType'] ?? port['@_AdapterName'];
  if (direct) return String(direct);

  // Try nested TransportType or ReceiveLocationTransportType elements
  const ttRaw = port['TransportType'] ?? port['ReceiveLocationTransportType'];
  const tt = ttRaw as Record<string, unknown> | string | undefined;
  if (typeof tt === 'string') return tt;
  if (tt && typeof tt === 'object') {
    return String((tt as Record<string, unknown>)['@_Name'] ?? (tt as Record<string, unknown>)['#text'] ?? '');
  }

  // Try PrimaryTransport → TransportType
  const primary = port['PrimaryTransport'] as Record<string, unknown> | undefined;
  if (primary) {
    const primaryTT = primary['TransportType'] as Record<string, unknown> | string | undefined;
    if (typeof primaryTT === 'string') return primaryTT;
    if (primaryTT && typeof primaryTT === 'object') {
      return String((primaryTT as Record<string, unknown>)['@_Name'] ?? '');
    }
  }

  return 'Unknown';
}

function extractPipelineName(port: Record<string, unknown>, direction: 'Receive' | 'Send'): string {
  const nameKey = direction === 'Receive' ? 'ReceivePipelineName' : 'SendPipelineName';
  const key = direction === 'Receive' ? 'ReceivePipelineData' : 'SendPipelineData';
  const altKey = direction === 'Receive' ? 'ReceivePipeline' : 'SendPipeline';

  const el = port[nameKey] ?? port[key] ?? port[altKey];
  if (typeof el === 'string') return el;
  if (el && typeof el === 'object') {
    return String(
      (el as Record<string, unknown>)['@_Name'] ??
      (el as Record<string, unknown>)['@_FullyQualifiedName'] ??
      (el as Record<string, unknown>)['#text'] ?? ''
    );
  }
  return direction === 'Receive' ? 'Microsoft.BizTalk.DefaultPipelines.XMLReceive' : 'Microsoft.BizTalk.DefaultPipelines.XMLTransmit';
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function getArray(
  root: Record<string, unknown>,
  containerKey: string,
  itemKey: string
): Record<string, unknown>[] | undefined {
  const container = root[containerKey] as Record<string, unknown> | undefined;
  if (!container) return undefined;
  const items = container[itemKey];
  if (Array.isArray(items)) return items as Record<string, unknown>[];
  if (items && typeof items === 'object') return [items as Record<string, unknown>];
  return undefined;
}

export class BindingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BindingParseError';
  }
}
