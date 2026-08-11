/**
 * Map Converter — Stage 3 (Build)
 *
 * Converts BizTalk .btm maps into Logic Apps transformation artifacts:
 *   - LML (Logic Apps Mapping Language, YAML) for simple direct-link maps
 *   - XSLT for standard maps without scripting extensions
 *   - XSLT scaffold (with TODO comments) for maps requiring rewrite
 *   - Azure Function stub for maps with C# scripting or database functoids
 *
 * The converter does NOT re-implement the BizTalk compiler — it generates
 * structurally valid transformation files that a consultant can then
 * fine-tune. The migration path is determined by ParsedMap.recommendedMigrationPath
 * which was set during Stage 1 analysis.
 *
 * LML format (YAML):
 *   https://learn.microsoft.com/en-us/azure/logic-apps/data-mapper-overview
 *
 * XSLT rules enforced:
 *   - No msxsl:script or exslt extensions (not supported by Logic Apps)
 *   - Standard XSLT 1.0 templates
 *   - Namespace declarations preserved from source schema references
 */

import type { ParsedMap, BtmFunctoid } from '../types/biztalk.js';

// ─── Output types ─────────────────────────────────────────────────────────────

export type MapOutputFormat = 'lml' | 'xslt' | 'function-stub';

export interface ConvertedMap {
  name:    string;
  format:  MapOutputFormat;
  content: string;
  /** Warnings generated during conversion (e.g., untranslatable functoids) */
  warnings: string[];
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function convertMap(map: ParsedMap): ConvertedMap {
  const warnings: string[] = [];

  switch (map.recommendedMigrationPath) {
    case 'lml':
      return {
        name:     map.name,
        format:   'lml',
        content:  generateLml(map, warnings),
        warnings,
      };

    case 'xslt':
      // EMAP-04: Check map properties that affect migration correctness
      addMapPropertyWarnings(map, warnings);
      return {
        name:     map.name,
        format:   'xslt',
        content:  generateXslt(map, warnings, false),
        warnings,
      };

    case 'xslt-rewrite':
      // EMAP-04: Check map properties that affect migration correctness
      addMapPropertyWarnings(map, warnings);
      warnings.push(
        `Map "${map.name}" contains ${map.functoids.filter(f => f.isScripting).length} ` +
        `scripting functoid(s). These have been replaced with TODO placeholders in the XSLT. ` +
        `Each TODO block must be replaced with a standard XSLT template.`
      );
      return {
        name:     map.name,
        format:   'xslt',
        content:  generateXslt(map, warnings, true),
        warnings,
      };

    case 'azure-function':
      warnings.push(
        `Map "${map.name}" uses C# scripting or database functoids that cannot be expressed ` +
        `in XSLT. A Local Code Function stub has been generated. Port the business logic from ` +
        `the scripting functoids into the function implementation.`
      );
      return {
        name:     map.name,
        format:   'function-stub',
        content:  generateFunctionStub(map),
        warnings,
      };

    case 'manual':
    default:
      warnings.push(
        `Map "${map.name}" requires manual conversion. The generated XSLT is a structural ` +
        `scaffold only — all transformation logic must be implemented manually.`
      );
      return {
        name:     map.name,
        format:   'xslt',
        content:  generateXsltScaffold(map),
        warnings,
      };
  }
}

/**
 * EMAP-04: Checks map-level properties and adds warnings for known migration issues.
 * Called before generating XSLT for any map.
 */
function addMapPropertyWarnings(map: ParsedMap, warnings: string[]): void {
  if (map.mapProperties?.generateDefaultFixedNodes) {
    warnings.push(
      `Map "${map.name}" uses GenerateDefaultFixedNodes=Yes: schema default values were ` +
      `auto-emitted by the BizTalk compiler. Logic Apps Integration Account XSLT engine does ` +
      `not apply schema defaults automatically. Review the destination schema for elements with ` +
      `default= or fixed= attributes and add explicit xsl:otherwise fallbacks.`
    );
  }
  if (map.mapProperties?.method === 'text') {
    warnings.push(
      `Map "${map.name}" uses Method=Text: the Transform action output is a raw string, ` +
      `not XML. Downstream workflow actions must handle the output as text content, ` +
      `not as an XML body.`
    );
  }
  if (map.mapProperties?.preserveSequenceOrder === false) {
    warnings.push(
      `Map "${map.name}" has PreserveSequenceOrder=No: sibling type union patterns ` +
      `(TypeA | TypeB in compiled XSLT) may produce different element ordering when ` +
      `replaced with separate xsl:for-each blocks. Review generated XSLT for union selectors.`
    );
  }
}

// ─── LML Generation ──────────────────────────────────────────────────────────

/**
 * Generates Logic Apps Mapping Language (LML) YAML.
 *
 * LML is the preferred format for simple maps that use only direct field
 * links with no scripting or complex functoid chains.
 */
function generateLml(map: ParsedMap, warnings: string[]): string {
  const sourceNs  = extractNamespace(map.sourceSchemaRef);
  const destNs    = extractNamespace(map.destinationSchemaRef);
  const sourceRoot = extractRootNode(map.sourceSchemaRef);
  const destRoot   = extractRootNode(map.destinationSchemaRef);

  const directLinks = map.links.filter(l => !l.functoidRef);

  if (map.functoids.length > 0) {
    warnings.push(
      `Map "${map.name}" has ${map.functoids.length} functoid(s). Only direct links are ` +
      `represented in LML. Functoid logic requires manual LML expression authoring.`
    );
  }

  const mappings = directLinks.map(link => {
    const src  = sanitizePath(link.from);
    const dest = sanitizePath(link.to);
    return `  - source: ${src}\n    target: ${dest}`;
  }).join('\n');

  return [
    `# Logic Apps Data Mapper — LML`,
    `# Generated from BizTalk map: ${map.name}`,
    `# Source schema:      ${map.sourceSchemaRef}`,
    `# Destination schema: ${map.destinationSchemaRef}`,
    `# Generated: ${new Date().toISOString()}`,
    `#`,
    `# Review all mappings before deployment.`,
    `# Functoid-derived mappings are NOT included — add them manually.`,
    ``,
    `$schema: https://aka.ms/logicapps-data-mapper-schema/lml`,
    `version: 1.0`,
    ``,
    `sourceSchema:`,
    `  name: ${sourceRoot}`,
    `  namespace: "${sourceNs}"`,
    ``,
    `targetSchema:`,
    `  name: ${destRoot}`,
    `  namespace: "${destNs}"`,
    ``,
    `mappings:`,
    mappings || '  # TODO: No direct links found — add mappings manually',
  ].join('\n');
}

// ─── XSLT Generation ─────────────────────────────────────────────────────────

/**
 * Generates an XSLT stylesheet from the map.
 *
 * When `includeTodos` is true, scripting functoids emit TODO placeholder
 * templates rather than the C# code (which is incompatible with XSLT processors).
 */
function generateXslt(
  map: ParsedMap,
  warnings: string[],
  includeTodos: boolean
): string {
  const sourceNs   = extractNamespace(map.sourceSchemaRef);
  const destNs     = extractNamespace(map.destinationSchemaRef);
  const destRoot   = extractRootNode(map.destinationSchemaRef);

  const templates = buildXsltTemplates(map, includeTodos, warnings);

  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<!--`,
    `  XSLT Map: ${map.name}`,
    `  Generated from BizTalk map: ${map.filePath}`,
    `  Source schema:      ${map.sourceSchemaRef}`,
    `  Destination schema: ${map.destinationSchemaRef}`,
    `  Generated: ${new Date().toISOString()}`,
    `-->`,
    `<xsl:stylesheet version="1.0"`,
    `  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"`,
    sourceNs ? `  xmlns:src="${sourceNs}"` : `  xmlns:src="urn:source"`,
    destNs   ? `  xmlns:dest="${destNs}"` : `  xmlns:dest="urn:destination"`,
    `  exclude-result-prefixes="src">`,
    ``,
    `  <xsl:output method="xml" indent="yes" encoding="utf-8"/>`,
    ``,
    `  <!-- ═══ Main Template ══════════════════════════════════════════════════ -->`,
    `  <xsl:template match="/">`,
    `    <${destRoot}>`,
    ...buildXsltRootMappings(map, warnings),
    `    </${destRoot}>`,
    `  </xsl:template>`,
    ``,
    ...templates,
    ``,
    `</xsl:stylesheet>`,
  ].join('\n');
}

// EMAP-03: Strip namespace prefix from each path segment before wrapping in local-name().
// BTM link refs often include schema namespace prefixes (e.g. s0:Order/s0:OrderID) —
// after splitting, the segment is 's0:OrderID' and local-name()='s0:OrderID' never matches.
function buildXsltRootMappings(map: ParsedMap, warnings: string[]): string[] {
  const lines: string[] = [];
  const directLinks = map.links.filter(l => !l.functoidRef);

  // Warn when namespace-prefixed link refs are detected (EMAP-03)
  const hasNsPrefixes = directLinks.some(l => l.from.includes(':') || l.to.includes(':'));
  if (hasNsPrefixes) {
    warnings.push(
      `Map "${map.name}" has namespace-prefixed link references (e.g. s0:Field). ` +
      `Namespace prefixes are stripped — local-name() predicate is used for element selection. ` +
      `For full namespace-aware XPath, declare the destination schema namespace URI in the ` +
      `stylesheet header (see sandro-ebook-map-patterns.md Section 6.1).`
    );
  }

  for (const link of directLinks) {
    const src  = xpathFromRef(link.from);
    // Strip namespace prefix from destination element name too
    const destFull  = link.to.split('/').pop() ?? link.to;
    const destLocal = destFull.includes(':') ? destFull.split(':')[1]! : destFull;
    lines.push(`      <${destLocal}><xsl:value-of select="${src}"/></${destLocal}>`);
  }

  if (lines.length === 0) {
    lines.push(`      <!-- TODO: No direct links found — add element mappings here -->`);
  }

  return lines;
}

function buildXsltTemplates(
  map: ParsedMap,
  includeTodos: boolean,
  warnings: string[]
): string[] {
  const blocks: string[] = [];

  for (const functoid of map.functoids) {
    const block = functoidToXsltTemplate(functoid, includeTodos, warnings);
    if (block) blocks.push(block);
  }

  return blocks;
}

// EMAP-01: Check f.scriptCode for userCSharp: to catch functoids not flagged by parser.
// Also pass warnings[] so logical/date-time categories can note their scaffold status.
function functoidToXsltTemplate(
  f: BtmFunctoid,
  includeTodos: boolean,
  warnings: string[]
): string | null {
  // Detect userCSharp: extension calls in scriptCode even if isScripting wasn't set by parser
  const hasUserCSharp = !f.isScripting && (f.scriptCode?.includes('userCSharp:') ?? false);

  if (f.isScripting || hasUserCSharp) {
    if (includeTodos) {
      return [
        `  <!-- ─── Scripting Functoid ${f.functoidId} ──────────────────────────────────── -->`,
        `  <!-- TODO: Replace this placeholder with a standard XSLT template.           -->`,
        `  <!-- userCSharp: extension calls are NOT compatible with Logic Apps XSLT.    -->`,
        `  <!-- Port logic to a Local Code Function or rewrite as XSLT templates.       -->`,
        `  <!-- Inputs:  ${f.inputs.join(', ')} -->`,
        `  <!-- Outputs: ${f.outputs.join(', ')} -->`,
        `  <xsl:template name="functoid_${f.functoidId}">`,
        `    <xsl:param name="input0"/>`,
        `    <!-- TODO: Implement transformation logic here -->`,
        `    <xsl:value-of select="$input0"/>`,
        `  </xsl:template>`,
      ].join('\n');
    }
    return null;
  }

  // Translate common functoid categories to XSLT templates
  switch (f.category) {
    case 'string':
      return buildStringFunctoidTemplate(f);
    case 'math':
      return buildMathFunctoidTemplate(f);
    case 'logical':
      // EMAP-01: Warn that this is a scaffold — logical template must be completed manually
      warnings.push(
        `Functoid ${f.functoidId} (logical): the generated xsl:choose template is a structural ` +
        `scaffold. Implement the correct XPath condition logic — ` +
        `see sandro-ebook-map-patterns.md Section 9.`
      );
      return buildLogicalFunctoidTemplate(f);
    case 'date-time':
      // EMAP-01: Warn that XSLT 1.0 has limited date/time support
      warnings.push(
        `Functoid ${f.functoidId} (date-time): the generated template is a structural scaffold. ` +
        `XSLT 1.0 has limited built-in date/time support — implement the date operation explicitly ` +
        `or consider a Local Code Function for complex date logic.`
      );
      return buildDateTimeFunctoidTemplate(f);
    default:
      return [
        `  <!-- Functoid ${f.functoidId} (${f.category}) — no automatic translation -->`,
        `  <!-- TODO: Implement logic for this ${f.category} functoid -->`,
      ].join('\n');
  }
}

function buildStringFunctoidTemplate(f: BtmFunctoid): string {
  // String concatenation is the most common string functoid
  const concat = f.inputs.map((_, i) => `$param${i}`).join(', ');
  return [
    `  <xsl:template name="string_functoid_${f.functoidId}">`,
    ...f.inputs.map((_, i) => `    <xsl:param name="param${i}"/>`),
    `    <xsl:value-of select="concat(${concat})"/>`,
    `  </xsl:template>`,
  ].join('\n');
}

function buildMathFunctoidTemplate(f: BtmFunctoid): string {
  return [
    `  <xsl:template name="math_functoid_${f.functoidId}">`,
    ...f.inputs.map((_, i) => `    <xsl:param name="param${i}"/>`),
    `    <!-- TODO: Implement math operation for functoid ${f.functoidId} -->`,
    `    <xsl:value-of select="$param0"/>`,
    `  </xsl:template>`,
  ].join('\n');
}

function buildLogicalFunctoidTemplate(f: BtmFunctoid): string {
  return [
    `  <xsl:template name="logical_functoid_${f.functoidId}">`,
    ...f.inputs.map((_, i) => `    <xsl:param name="param${i}"/>`),
    `    <xsl:choose>`,
    `      <xsl:when test="$param0">`,
    `        <xsl:value-of select="$param1"/>`,
    `      </xsl:when>`,
    `      <xsl:otherwise>`,
    `        <xsl:value-of select="$param2"/>`,
    `      </xsl:otherwise>`,
    `    </xsl:choose>`,
    `  </xsl:template>`,
  ].join('\n');
}

function buildDateTimeFunctoidTemplate(f: BtmFunctoid): string {
  return [
    `  <xsl:template name="datetime_functoid_${f.functoidId}">`,
    ...f.inputs.map((_, i) => `    <xsl:param name="param${i}"/>`),
    `    <!-- TODO: Implement date/time operation for functoid ${f.functoidId} -->`,
    `    <!-- Note: XSLT 1.0 has limited date/time support. Consider using EXSLT or -->`,
    `    <!-- an Azure Function for complex date operations.                        -->`,
    `    <xsl:value-of select="$param0"/>`,
    `  </xsl:template>`,
  ].join('\n');
}

// ─── XSLT Scaffold (manual migration) ────────────────────────────────────────

function generateXsltScaffold(map: ParsedMap): string {
  const destRoot = extractRootNode(map.destinationSchemaRef);
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<!--`,
    `  MANUAL MIGRATION REQUIRED`,
    `  Map: ${map.name}`,
    `  This map could not be automatically converted.`,
    `  Please implement the XSLT transformation manually.`,
    `  Source:      ${map.sourceSchemaRef}`,
    `  Destination: ${map.destinationSchemaRef}`,
    `-->`,
    `<xsl:stylesheet version="1.0"`,
    `  xmlns:xsl="http://www.w3.org/1999/XSL/Transform">`,
    `  <xsl:output method="xml" indent="yes"/>`,
    ``,
    `  <xsl:template match="/">`,
    `    <${destRoot}>`,
    `      <!-- TODO: Implement ${map.linkCount} field mappings manually -->`,
    `    </${destRoot}>`,
    `  </xsl:template>`,
    ``,
    `</xsl:stylesheet>`,
  ].join('\n');
}

// ─── Local Code Function Stub ─────────────────────────────────────────────────

/**
 * EMAP-02: Generates a C# Local Code Function stub for maps that use scripting/database
 * functoids. Uses the Logic Apps Standard [WorkflowActionTrigger] pattern — not the legacy
 * Azure Functions v1 HTTP trigger pattern.
 *
 * Place the generated file in the lib/custom/ folder of the Logic Apps Standard project.
 * Invoke it from the workflow via the Execute Code Function action.
 */
function generateFunctionStub(map: ParsedMap): string {
  const functionName = sanitizeCSharpName(map.name);
  const scriptingFunctoids = map.functoids.filter(f => f.isScripting);
  const dbFunctoids        = map.functoids.filter(f => f.category === 'database');

  const methodComments: string[] = [];

  for (const f of scriptingFunctoids) {
    methodComments.push(`        // Scripting Functoid ${f.functoidId} (${f.scriptLanguage ?? 'unknown language'}):`);
    if (f.scriptCode) {
      const codeLines = f.scriptCode.split('\n').slice(0, 10).map(l => `        // ${l}`);
      methodComments.push(...codeLines);
      if (f.scriptCode.split('\n').length > 10) {
        methodComments.push(`        // ... (${f.scriptCode.split('\n').length - 10} more lines)`);
      }
    }
    methodComments.push('');
  }

  for (const f of dbFunctoids) {
    methodComments.push(`        // Database Functoid ${f.functoidId}:`);
    if (f.databaseTableRef) {
      methodComments.push(`        // Reference: ${f.databaseTableRef}`);
    }
    methodComments.push(`        // TODO: Implement SQL lookup — use Azure SQL connector in workflow or EF Core here`);
    methodComments.push('');
  }

  const className = functionName;
  return [
    `//------------------------------------------------------------`,
    `// Copyright (c) Microsoft Corporation. All rights reserved.`,
    `//------------------------------------------------------------`,
    ``,
    `namespace ${className}Namespace`,
    `{`,
    `    using System;`,
    `    using System.Threading.Tasks;`,
    `    using System.Xml.Linq;`,
    `    using Microsoft.Azure.Functions.Extensions.Workflows;`,
    `    using Microsoft.Azure.WebJobs;`,
    `    using Microsoft.Extensions.Logging;`,
    ``,
    `    /// <summary>`,
    `    /// Local Code Function replacement for BizTalk map: ${map.name}`,
    `    /// Source schema:      ${map.sourceSchemaRef}`,
    `    /// Destination schema: ${map.destinationSchemaRef}`,
    `    /// Migrated from: ${map.filePath}`,
    `    /// </summary>`,
    `    public class ${className}`,
    `    {`,
    `        private readonly ILogger<${className}> logger;`,
    ``,
    `        public ${className}(ILoggerFactory loggerFactory)`,
    `        {`,
    `            logger = loggerFactory.CreateLogger<${className}>();`,
    `        }`,
    ``,
    `        [FunctionName("${className}")]`,
    `        public Task<string> Run([WorkflowActionTrigger] string inputXml)`,
    `        {`,
    `            this.logger.LogInformation("${className}: processing XML transformation.");`,
    ``,
    `            // ═══ Original BizTalk scripting functoid logic to port ══════════`,
    ...methodComments,
    `            // TODO: Implement the transformation. Parse input, apply transforms,`,
    `            // return result XML as string.`,
    `            var sourceDoc = XDocument.Parse(inputXml);`,
    `            var targetDoc = new XDocument();`,
    ``,
    `            throw new NotImplementedException("Port scripting functoid logic here.");`,
    `        }`,
    `    }`,
    `}`,
  ].join('\n');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function extractNamespace(schemaRef: string): string {
  // "Namespace.RootElement" or "http://namespace.com/path#RootElement"
  if (schemaRef.startsWith('http')) {
    const hashIdx = schemaRef.indexOf('#');
    return hashIdx >= 0 ? schemaRef.substring(0, hashIdx) : schemaRef;
  }
  const lastDot = schemaRef.lastIndexOf('.');
  if (lastDot > 0) return schemaRef.substring(0, lastDot);
  return '';
}

function extractRootNode(schemaRef: string): string {
  const hashIdx = schemaRef.lastIndexOf('#');
  if (hashIdx >= 0) return schemaRef.substring(hashIdx + 1);
  const lastDot = schemaRef.lastIndexOf('.');
  if (lastDot >= 0) return schemaRef.substring(lastDot + 1);
  return schemaRef || 'Root';
}

function sanitizePath(ref: string): string {
  return ref.replace(/\\/g, '/').replace(/^\//, '');
}

// EMAP-03: Strip namespace prefix from each path segment before wrapping in local-name().
// BTM link refs may include schema namespace prefixes: s0:Order/s0:OrderID.
// local-name() returns the local part only — 'local-name()="s0:OrderID"' never matches.
function xpathFromRef(ref: string): string {
  const parts = ref.split(/[/\\]/);
  return parts.map(p => {
    const localName = p.includes(':') ? p.split(':')[1]! : p;
    return `*[local-name()='${localName}']`;
  }).join('/') || '.';
}

function sanitizeCSharpName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[0-9]/, '_$&');
}
