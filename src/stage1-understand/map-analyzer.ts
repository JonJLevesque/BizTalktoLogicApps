/**
 * Map Analyzer — Stage 1 (Understand)
 *
 * Parses a BizTalk .btm file and produces a ParsedMap.
 *
 * The .btm file is XML with this structure:
 *   <BizTalkFlatFileSchemas> or <BizTalkMaps>
 *     <CLRNamespace>...</CLRNamespace>
 *     <SourceSchema>...</SourceSchema>
 *     <DestinationSchema>...</DestinationSchema>
 *     <Functoids>
 *       <Functoid FunctoidID="104" .../>
 *       ...
 *     </Functoids>
 *     <Links>
 *       <Link LinkID="1" SourceNode="..." DestinationNode="..."/>
 *       ...
 *     </Links>
 *   </BizTalkFlatFileSchemas>
 *
 * Scripting functoid detection is critical: if the compiled XSLT contains
 * msxsl:script blocks (FID >= 10000 or ScriptBuffer present), Logic Apps
 * XSLT action cannot run it — it uses .NET XslCompiledTransform which
 * does not support extension objects.
 */

import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { basename } from 'node:path';
import type {
  ParsedMap,
  BtmFunctoid,
  BtmLink,
  FunctoidCategory,
} from '../types/biztalk.js';

// ─── Functoid ID Ranges ───────────────────────────────────────────────────────
// From BizTalk Server documentation and BizTalkMigrationStarter registry

const FUNCTOID_RANGES: Array<{ min: number; max: number; category: FunctoidCategory }> = [
  { min: 60,    max: 99,    category: 'database'   },
  { min: 104,   max: 165,   category: 'string'     },
  { min: 200,   max: 265,   category: 'math'       },
  { min: 300,   max: 365,   category: 'logical'    },
  { min: 400,   max: 460,   category: 'date-time'  },
  { min: 500,   max: 565,   category: 'conversion' },
  { min: 600,   max: 660,   category: 'scientific' },
  { min: 700,   max: 760,   category: 'cumulative' },
  { min: 900,   max: 970,   category: 'advanced'   },
  { min: 10000, max: 99999, category: 'scripting'  },
];

function classifyFunctoid(fid: number): FunctoidCategory {
  for (const range of FUNCTOID_RANGES) {
    if (fid >= range.min && fid <= range.max) return range.category;
  }
  return 'advanced'; // fallback for unknown FIDs
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function analyzeMap(filePath: string): Promise<ParsedMap> {
  const xml = await readFile(filePath, 'utf-8');
  return analyzeMapXml(xml, filePath);
}

export function analyzeMapXml(xml: string, filePath: string = '<inline>'): ParsedMap {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) => ['Functoid', 'Link', 'ScriptType', 'InputParam'].includes(name),
    parseTagValue: true,
    trimValues: true,
    cdataPropName: '__cdata',
  });

  const doc = parser.parse(xml) as Record<string, unknown>;

  // Root element varies: BizTalkFlatFileSchemas (older) or BizTalkMaps (newer)
  const root = (doc['BizTalkMaps'] ?? doc['BizTalkFlatFileSchemas'] ?? doc['Root']) as
    Record<string, unknown> | undefined;

  if (!root) {
    throw new BtmParseError(`Could not find root map element in ${filePath}`);
  }

  // Class/namespace info
  const className = String(root['CLRNamespace'] ?? root['ClassName'] ?? basename(filePath, '.btm'));
  const name = className.split('.').pop() ?? className;

  // Schema references
  const sourceSchemaRef = extractSchemaRef(root, 'SourceSchema');
  const destinationSchemaRef = extractSchemaRef(root, 'DestinationSchema');

  // Functoids
  const functoidEls = getArray(root, 'Functoids', 'Functoid')
    ?? (root['Functoid'] as Record<string, unknown>[] | undefined)
    ?? [];
  const functoids = functoidEls.map(parseFunctoid);

  // Links
  const linkEls = getArray(root, 'Links', 'Link')
    ?? (root['Link'] as Record<string, unknown>[] | undefined)
    ?? [];
  const links = linkEls.map(parseLink);

  // Derived properties
  const hasScriptingFunctoids = functoids.some(f => f.isScripting);
  const hasLooping = functoids.some(f => f.functoidId === 900);
  const hasDatabaseFunctoids = functoids.some(f => f.category === 'database');
  const functoidCategories = [...new Set(functoids.map(f => f.category))];

  const recommendedMigrationPath = determineMapMigrationPath({
    hasScriptingFunctoids,
    hasDatabaseFunctoids,
    linkCount: links.length,
    functoidCategories,
    functoids,
  });

  return {
    name,
    className,
    filePath,
    sourceSchemaRef,
    destinationSchemaRef,
    functoids,
    links,
    linkCount: links.length,
    hasScriptingFunctoids,
    hasLooping,
    hasDatabaseFunctoids,
    functoidCategories,
    ...(recommendedMigrationPath !== undefined ? { recommendedMigrationPath } : {}),
  };
}

// ─── Functoid Parsing ─────────────────────────────────────────────────────────

function parseFunctoid(el: Record<string, unknown>): BtmFunctoid {
  const fidRaw = el['@_FunctoidID'] ?? el['@_FID'] ?? el['@_Id'] ?? '0';
  const functoidId = parseInt(String(fidRaw), 10);
  const category = classifyFunctoid(functoidId);
  const isScripting = category === 'scripting' || hasScriptBuffer(el);

  // Extract inline C# script code from ScriptBuffer (CDATA)
  let scriptCode: string | undefined;
  if (isScripting) {
    scriptCode = extractScriptCode(el);
  }

  // Database functoid reference (sanitized — connection strings not captured)
  let databaseTableRef: string | undefined;
  if (category === 'database') {
    databaseTableRef = String(el['@_TableName'] ?? el['@_DBName'] ?? '') || undefined;
  }

  // Input parameters (source link references)
  const inputParamsEl = el['InputParams'] as Record<string, unknown> | undefined;
  const inputParams = inputParamsEl
    ? (inputParamsEl['InputParam'] as Record<string, unknown>[] | undefined ?? [])
        .map(ip => String(ip['@_Value'] ?? ''))
    : [];

  // Output connections
  const outputs = [String(el['@_OutputConnectionType'] ?? '')].filter(Boolean);

  return {
    functoidId,
    category,
    isScripting,
    ...(scriptCode !== undefined ? { scriptCode } : {}),
    ...(databaseTableRef !== undefined ? { databaseTableRef } : {}),
    inputs: inputParams,
    outputs,
  };
}

function hasScriptBuffer(el: Record<string, unknown>): boolean {
  // ScriptBuffer is the XML element containing the C# code in a scripting functoid
  if (el['ScriptBuffer'] !== undefined) return true;
  if (el['ScriptType'] !== undefined) return true;
  // Check for userCSharp namespace marker in any string value
  const json = JSON.stringify(el);
  return json.includes('userCSharp') || json.includes('msxsl:script') || json.includes('ScriptBuffer');
}

function extractScriptCode(el: Record<string, unknown>): string | undefined {
  // ScriptBuffer may be a CDATA section or a nested element
  const scriptBuffer = el['ScriptBuffer'] as Record<string, unknown> | string | undefined;
  if (typeof scriptBuffer === 'string') return scriptBuffer;
  if (scriptBuffer && typeof scriptBuffer === 'object') {
    const cdata = (scriptBuffer as Record<string, unknown>)['__cdata'];
    if (typeof cdata === 'string') return cdata;
    const text = (scriptBuffer as Record<string, unknown>)['#text'];
    if (typeof text === 'string') return text;
  }
  return undefined;
}

// ─── Link Parsing ─────────────────────────────────────────────────────────────

function parseLink(el: Record<string, unknown>): BtmLink {
  const functoidRef = el['@_FunctoidID'] !== undefined
    ? parseInt(String(el['@_FunctoidID']), 10)
    : undefined;
  return {
    from: String(el['@_SourceNode'] ?? el['@_From'] ?? el['@_Source'] ?? ''),
    to: String(el['@_DestinationNode'] ?? el['@_To'] ?? el['@_Destination'] ?? ''),
    ...(functoidRef !== undefined ? { functoidRef } : {}),
  };
}

// ─── Schema Reference Extraction ──────────────────────────────────────────────

function extractSchemaRef(root: Record<string, unknown>, key: string): string {
  const el = root[key] as Record<string, unknown> | string | undefined;
  if (typeof el === 'string') return el;
  if (el && typeof el === 'object') {
    return String((el as Record<string, unknown>)['@_FullName']
      ?? (el as Record<string, unknown>)['@_ClassName']
      ?? (el as Record<string, unknown>)['#text']
      ?? '');
  }
  return '';
}

// ─── Migration Path Determination ─────────────────────────────────────────────

interface MapAnalysis {
  hasScriptingFunctoids: boolean;
  hasDatabaseFunctoids: boolean;
  linkCount: number;
  functoidCategories: FunctoidCategory[];
  functoids: BtmFunctoid[];
}

function determineMapMigrationPath(analysis: MapAnalysis): ParsedMap['recommendedMigrationPath'] {
  // Database functoids make the map non-portable — needs Azure Function for enrichment
  if (analysis.hasDatabaseFunctoids) {
    return 'azure-function';
  }

  if (analysis.hasScriptingFunctoids) {
    // Check if the scripts are doing something that CAN be rewritten in XSLT
    const allScripts = analysis.functoids
      .filter(f => f.isScripting && f.scriptCode)
      .map(f => f.scriptCode ?? '');

    const hasComplexScript = allScripts.some(code =>
      // Patterns that require Azure Function (cannot be expressed in XSLT 1.0)
      code.includes('SqlConnection') ||
      code.includes('WebRequest') ||
      code.includes('HttpClient') ||
      code.includes('File.') ||
      code.includes('Registry.') ||
      code.includes('Process.') ||
      // Complex date operations beyond simple formatting
      (code.includes('DateTime') && code.includes('TimeZone')) ||
      // Regex
      code.includes('Regex') ||
      // LINQ
      code.includes('.Where(') ||
      code.includes('.Select(') ||
      code.includes('.FirstOrDefault(')
    );

    if (hasComplexScript) return 'azure-function';
    // Simple string/math scripts can be rewritten as pure XSLT 1.0
    return 'xslt-rewrite';
  }

  // Pure functoid maps (no scripting)
  // Small simple maps → LML (modern format, designer support)
  if (analysis.linkCount <= 20 && !analysis.functoidCategories.includes('cumulative')) {
    return 'lml';
  }

  // Larger maps or cumulative functoids → XSLT (more expressive)
  return 'xslt';
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function getArray(
  root: Record<string, unknown>,
  containerKey: string,
  itemKey: string
): Record<string, unknown>[] | undefined {
  const container = root[containerKey] as Record<string, unknown> | undefined;
  if (!container) return undefined;
  return container[itemKey] as Record<string, unknown>[] | undefined;
}

export class BtmParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BtmParseError';
  }
}
