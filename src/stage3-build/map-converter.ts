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
      return {
        name:     map.name,
        format:   'xslt',
        content:  generateXslt(map, warnings, false),
        warnings,
      };

    case 'xslt-rewrite':
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
        `in XSLT. An Azure Function stub has been generated. Port the business logic from ` +
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
  const sourceRoot = extractRootNode(map.sourceSchemaRef);
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
    `  xmlns:xs="http://www.w3.org/2001/XMLSchema"`,
    sourceNs ? `  xmlns:src="${sourceNs}"` : `  xmlns:src="urn:source"`,
    destNs   ? `  xmlns:dest="${destNs}"` : `  xmlns:dest="urn:destination"`,
    `  exclude-result-prefixes="xs src">`,
    ``,
    `  <xsl:output method="xml" indent="yes" encoding="utf-8"/>`,
    ``,
    `  <!-- ═══ Main Template ══════════════════════════════════════════════════ -->`,
    `  <xsl:template match="/">`,
    `    <${destRoot}>`,
    ...buildXsltRootMappings(map),
    `    </${destRoot}>`,
    `  </xsl:template>`,
    ``,
    ...templates,
    ``,
    `</xsl:stylesheet>`,
  ].join('\n');
}

function buildXsltRootMappings(map: ParsedMap): string[] {
  const lines: string[] = [];
  const directLinks = map.links.filter(l => !l.functoidRef);

  for (const link of directLinks) {
    const src  = xpathFromRef(link.from);
    const dest = link.to.split('/').pop() ?? link.to;
    lines.push(`      <${dest}><xsl:value-of select="${src}"/></${dest}>`);
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
    const block = functoidToXsltTemplate(functoid, includeTodos);
    if (block) blocks.push(block);
  }

  return blocks;
}

function functoidToXsltTemplate(
  f: BtmFunctoid,
  includeTodos: boolean
): string | null {
  if (f.isScripting) {
    if (includeTodos) {
      return [
        `  <!-- ─── Scripting Functoid ${f.functoidId} ──────────────────────────────────── -->`,
        `  <!-- TODO: Replace this placeholder with a standard XSLT template.           -->`,
        `  <!-- Original C# script code is NOT compatible with Logic Apps XSLT action. -->`,
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
      return buildLogicalFunctoidTemplate(f);
    case 'date-time':
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
  const params = f.inputs.map((_, i) => `param${i}`).join(', ');
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

// ─── Azure Function Stub ──────────────────────────────────────────────────────

/**
 * Generates a C# Azure Function stub for maps that use scripting/database functoids.
 * The consultant implements the business logic in the stub.
 */
function generateFunctionStub(map: ParsedMap): string {
  const functionName = sanitizeCSharpName(map.name);
  const scriptingFunctoids = map.functoids.filter(f => f.isScripting);
  const dbFunctoids        = map.functoids.filter(f => f.category === 'database');

  const methodComments: string[] = [];

  for (const f of scriptingFunctoids) {
    methodComments.push(`    // Scripting Functoid ${f.functoidId}:`);
    if (f.scriptCode) {
      const codeLines = f.scriptCode.split('\n').slice(0, 10).map(l => `    // ${l}`);
      methodComments.push(...codeLines);
      if (f.scriptCode.split('\n').length > 10) {
        methodComments.push(`    // ... (${f.scriptCode.split('\n').length - 10} more lines)`);
      }
    }
    methodComments.push('');
  }

  for (const f of dbFunctoids) {
    methodComments.push(`    // Database Functoid ${f.functoidId}:`);
    if (f.databaseTableRef) {
      methodComments.push(`    // Reference: ${f.databaseTableRef}`);
    }
    methodComments.push(`    // TODO: Implement SQL lookup using Azure SQL connector or EF Core`);
    methodComments.push('');
  }

  return [
    `using System;`,
    `using System.IO;`,
    `using System.Threading.Tasks;`,
    `using System.Xml;`,
    `using System.Xml.Linq;`,
    `using Microsoft.AspNetCore.Mvc;`,
    `using Microsoft.Azure.WebJobs;`,
    `using Microsoft.Azure.WebJobs.Extensions.Http;`,
    `using Microsoft.AspNetCore.Http;`,
    `using Microsoft.Extensions.Logging;`,
    `using Newtonsoft.Json;`,
    ``,
    `/// <summary>`,
    `/// Azure Function replacement for BizTalk map: ${map.name}`,
    `/// Source schema:      ${map.sourceSchemaRef}`,
    `/// Destination schema: ${map.destinationSchemaRef}`,
    `/// Migrated from: ${map.filePath}`,
    `/// Generated: ${new Date().toISOString()}`,
    `/// </summary>`,
    `public static class ${functionName}`,
    `{`,
    `    [FunctionName("${functionName}")]`,
    `    public static async Task<IActionResult> Run(`,
    `        [HttpTrigger(AuthorizationLevel.Function, "post", Route = null)] HttpRequest req,`,
    `        ILogger log)`,
    `    {`,
    `        log.LogInformation("${functionName} map function processing request.");`,
    ``,
    `        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();`,
    `        XDocument sourceDoc;`,
    `        try`,
    `        {`,
    `            sourceDoc = XDocument.Parse(requestBody);`,
    `        }`,
    `        catch (XmlException ex)`,
    `        {`,
    `            return new BadRequestObjectResult($"Invalid XML: {ex.Message}");`,
    `        }`,
    ``,
    `        // ═══ Original BizTalk map logic ═══════════════════════════════════════`,
    ...methodComments,
    `        // TODO: Implement the complete transformation logic`,
    `        // Transform source document to target schema`,
    `        var targetDoc = new XDocument();`,
    ``,
    `        // ═══ Return transformed XML ════════════════════════════════════════════`,
    `        return new OkObjectResult(targetDoc.ToString());`,
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

function xpathFromRef(ref: string): string {
  const parts = ref.split(/[/\\]/);
  return parts.map(p => `*[local-name()='${p}']`).join('/') || '.';
}

function sanitizeCSharpName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[0-9]/, '_$&');
}
