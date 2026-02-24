/**
 * Pipeline Analyzer — Stage 1 (Understand)
 *
 * Parses a BizTalk .btp file and produces a ParsedPipeline.
 *
 * BTP files are XML describing pipeline stages and their components.
 * The structure varies slightly between BizTalk versions but the key
 * elements are:
 *   <Document>
 *     <DocData>
 *       <Stages>
 *         <Stage CategoryId="{stage GUID}" ...>
 *           <Components>
 *             <Component Name="XML Disassembler" ...>
 *               <Properties>...</Properties>
 *             </Component>
 *           </Components>
 *         </Stage>
 *       </Stages>
 *     </DocData>
 *   </Document>
 *
 * Stage GUIDs map to the well-known BizTalk pipeline stage names.
 */

import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { basename } from 'node:path';
import type { ParsedPipeline, BtpComponent, PipelineStage, PipelineDirection } from '../types/biztalk.js';

// ─── Stage GUID → Name Mapping ────────────────────────────────────────────────
// From BizTalk Server SDK constants

const STAGE_GUIDS: Record<string, PipelineStage> = {
  // Receive pipeline stages
  '{9D0E4103-4CCE-4536-83FA-4A5040674AD6}': 'Decode',
  '{9D0E4105-4CCE-4536-83FA-4A5040674AD6}': 'Disassemble',
  '{9D0E4108-4CCE-4536-83FA-4A5040674AD6}': 'Validate',
  '{9D0E410D-4CCE-4536-83FA-4A5040674AD6}': 'ResolveParty',
  // Send pipeline stages
  '{9D0E4101-4CCE-4536-83FA-4A5040674AD6}': 'PreAssemble',
  '{9D0E4107-4CCE-4536-83FA-4A5040674AD6}': 'Assemble',
  '{9D0E4102-4CCE-4536-83FA-4A5040674AD6}': 'Encode',
};

/** Well-known stage name strings (fallback when GUID not found) */
const STAGE_NAME_MAP: Record<string, PipelineStage> = {
  'decode': 'Decode',
  'disassemble': 'Disassemble',
  'disassembler': 'Disassemble',
  'validate': 'Validate',
  'validator': 'Validate',
  'resolveparty': 'ResolveParty',
  'preassemble': 'PreAssemble',
  'assemble': 'Assemble',
  'assembler': 'Assemble',
  'encode': 'Encode',
  'encoder': 'Encode',
};

// ─── Well-Known Component Type Names ─────────────────────────────────────────

const KNOWN_COMPONENTS = new Set([
  'Microsoft.BizTalk.Component.XmlDasmComp',
  'Microsoft.BizTalk.Component.XmlAsmComp',
  'Microsoft.BizTalk.Component.FlatFileDasmComp',
  'Microsoft.BizTalk.Component.FlatFileAsmComp',
  'Microsoft.BizTalk.Component.XmlValidator',
  'Microsoft.BizTalk.Component.MIME_SMIME_Decoder',
  'Microsoft.BizTalk.Component.MIME_SMIME_Encoder',
  'Microsoft.BizTalk.Component.PartyRes',
  'Microsoft.BizTalk.Edi.BatchMarker.BatchMarkerPipelineComponent',
  'Microsoft.BizTalk.Edi.Disassembler.EDIDisassemblerComp',
  'Microsoft.BizTalk.Edi.Assembler.EDIAssemblerComp',
  'Microsoft.BizTalk.Component.AS2Decoder',
  'Microsoft.BizTalk.Component.AS2Encoder',
  'Microsoft.BizTalk.Component.JsonDecoder',
  'Microsoft.BizTalk.Component.JsonEncoder',
]);

// ─── Default Pipeline Detection ───────────────────────────────────────────────

const DEFAULT_PIPELINE_NAMES = new Set([
  'XMLReceive', 'PassThruReceive', 'XMLTransmit', 'PassThruTransmit',
  'ReceiveXml', 'SendXml', 'SQLReceive',
  'Microsoft.BizTalk.DefaultPipelines.XMLReceive',
  'Microsoft.BizTalk.DefaultPipelines.PassThruReceive',
  'Microsoft.BizTalk.DefaultPipelines.XMLTransmit',
  'Microsoft.BizTalk.DefaultPipelines.PassThruTransmit',
]);

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function analyzePipeline(filePath: string): Promise<ParsedPipeline> {
  const xml = await readFile(filePath, 'utf-8');
  return analyzePipelineXml(xml, filePath);
}

export function analyzePipelineXml(xml: string, filePath: string = '<inline>'): ParsedPipeline {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) => ['Stage', 'Component', 'Property'].includes(name),
    parseTagValue: true,
    trimValues: true,
  });

  const doc = parser.parse(xml) as Record<string, unknown>;

  // Root is Document → DocData
  const docData = getNestedEl(doc, 'Document', 'DocData') as Record<string, unknown> | undefined
    ?? getNestedEl(doc, 'DocData') as Record<string, unknown> | undefined
    ?? doc;

  if (!docData) {
    throw new BtpParseError(`Could not find DocData in ${filePath}`);
  }

  // Pipeline class name (used for direction detection)
  const className = String(
    getNestedEl(doc, 'Document', '@_ClassName') ??
    (doc as Record<string, unknown>)['@_ClassName'] ??
    basename(filePath, '.btp')
  );
  const name = className.split('.').pop() ?? className;

  const direction = detectDirection(className, docData);
  const stages = docData['Stages'] as Record<string, unknown> | undefined;
  const stageArray = stages
    ? (stages['Stage'] as Record<string, unknown>[] | undefined) ?? []
    : [];

  const components = stageArray.flatMap(stage => extractStageComponents(stage));
  const hasCustomComponents = components.some(c => c.isCustom);
  const isDefault = DEFAULT_PIPELINE_NAMES.has(name) || DEFAULT_PIPELINE_NAMES.has(className);

  return {
    name,
    className,
    filePath,
    direction,
    components,
    hasCustomComponents,
    isDefault,
  };
}

// ─── Stage Component Extraction ───────────────────────────────────────────────

function extractStageComponents(stage: Record<string, unknown>): BtpComponent[] {
  const stage_id = String(stage['@_CategoryId'] ?? stage['@_Id'] ?? '');
  const stageName = resolveStage(stage_id, String(stage['@_Name'] ?? ''));

  const componentsEl = stage['Components'] as Record<string, unknown> | undefined;
  if (!componentsEl) return [];

  const componentArray = componentsEl['Component'] as Record<string, unknown>[] | undefined;
  if (!componentArray) return [];

  return componentArray.map(comp => {
    const fullTypeName = String(
      comp['@_ClassName'] ??
      comp['@_ComponentName'] ??
      comp['@_Name'] ??
      ''
    );
    const shortName = fullTypeName.split('.').pop() ?? fullTypeName;
    const isCustom = !KNOWN_COMPONENTS.has(fullTypeName) && fullTypeName !== '';

    // Extract component properties
    const propsEl = comp['Properties'] as Record<string, unknown> | undefined;
    const properties: Record<string, string> = {};
    if (propsEl) {
      const propArray = propsEl['Property'] as Record<string, unknown>[] | undefined;
      if (propArray) {
        for (const prop of propArray) {
          const key = String(prop['@_Name'] ?? '');
          const value = String(prop['@_Value'] ?? prop['#text'] ?? '');
          if (key) properties[key] = value;
        }
      }
    }

    return {
      componentType: shortName || fullTypeName,
      fullTypeName,
      stage: stageName,
      isCustom,
      properties,
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveStage(guidOrName: string, fallbackName: string): PipelineStage {
  // Try GUID lookup first
  const fromGuid = STAGE_GUIDS[guidOrName.toUpperCase()];
  if (fromGuid) return fromGuid;

  // Try name lookup
  const normalized = (guidOrName || fallbackName).toLowerCase().replace(/[^a-z]/g, '');
  return STAGE_NAME_MAP[normalized] ?? 'Disassemble';
}

function detectDirection(className: string, docData: Record<string, unknown>): PipelineDirection {
  const lower = className.toLowerCase();

  // Explicit name patterns
  if (lower.includes('receive') || lower.includes('input') || lower.includes('inbound')) {
    return 'receive';
  }
  if (lower.includes('send') || lower.includes('transmit') || lower.includes('output') || lower.includes('outbound')) {
    return 'send';
  }

  // Check stage types — receive pipelines have Disassemble, send have Assemble
  const stagesEl = docData['Stages'] as Record<string, unknown> | undefined;
  const stages = stagesEl
    ? (stagesEl['Stage'] as Record<string, unknown>[] | undefined) ?? []
    : [];
  const stageIds = stages.map(s => String(s['@_CategoryId'] ?? '').toUpperCase());

  // Disassemble GUID present → receive pipeline
  if (stageIds.includes('{9D0E4105-4CCE-4536-83FA-4A5040674AD6}')) return 'receive';
  // Assemble GUID present → send pipeline
  if (stageIds.includes('{9D0E4107-4CCE-4536-83FA-4A5040674AD6}')) return 'send';

  // Default: assume receive
  return 'receive';
}

function getNestedEl(obj: unknown, ...keys: string[]): unknown {
  let current = obj;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export class BtpParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BtpParseError';
  }
}
