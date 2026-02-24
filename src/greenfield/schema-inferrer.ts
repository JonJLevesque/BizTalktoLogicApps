/**
 * Schema Inferrer — Greenfield Stage G1 (PREMIUM TIER)
 *
 * Derives JSON schemas from natural language descriptions of data structures.
 * Used when the user describes their data in plain English and needs Logic Apps
 * to have schemas for parsing, validating, and transforming.
 *
 * Inference capabilities:
 *   - Field name extraction from prose ("each row has an email, name, and phone")
 *   - Type inference from context ("the amount is a decimal", "date in ISO format")
 *   - Required vs optional field detection ("must have", "if present", "optional")
 *   - Array structure detection ("a list of records", "collection of orders")
 *   - Nested object detection ("each order has a customer object with...")
 *   - Format hints ("email address", "ISO date", "GUID", "phone number")
 *
 * Output: JSON Schema draft-07 compatible objects suitable for use in:
 *   - Logic Apps "Parse JSON" action schemas
 *   - Integration Account schemas (for XML/EDI)
 *   - Workflow parameter definitions
 *   - Unit test trigger payloads
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface InferredSchema {
  /** JSON Schema draft-07 */
  schema:      JsonSchema;
  /** Name for this schema (derived from context or provided) */
  name:        string;
  /** Fields that were inferred (may be incomplete — LLM should supplement) */
  inferredFields: InferredField[];
  /** Aspects that need human clarification */
  gaps:        string[];
}

export interface InferredField {
  name:     string;
  type:     JsonSchemaType;
  format?:  string;
  required: boolean;
  source:   string;  // sentence that suggested this field
}

export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export interface JsonSchema {
  $schema?:    string;
  type:        JsonSchemaType | JsonSchemaType[];
  title?:      string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?:      JsonSchema;
  required?:   string[];
  format?:     string;
  enum?:       unknown[];
  default?:    unknown;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Infer a JSON Schema from a natural language description of a data structure.
 *
 * @param description  Free-form English describing the data
 * @param schemaName   Optional name for the schema
 */
export function inferSchema(
  description: string,
  schemaName?: string
): InferredSchema {
  const fields   = extractFields(description);
  const required = extractRequiredFields(description, fields);
  const isArray  = detectTopLevelArray(description);
  const name     = schemaName ?? deriveSchemaName(description);

  const itemSchema = buildObjectSchema(fields, required, name);
  const schema: JsonSchema = isArray
    ? { type: 'array', items: itemSchema, $schema: 'http://json-schema.org/draft-07/schema#' }
    : { ...itemSchema, $schema: 'http://json-schema.org/draft-07/schema#' };

  const gaps = identifySchemaGaps(description, fields);

  return { schema, name, inferredFields: fields, gaps };
}

/**
 * Infer schemas for both the input and output sides of a transformation.
 */
export function inferTransformSchemas(
  description: string
): { input: InferredSchema; output: InferredSchema } {
  // Split description into before/after transformation context
  const splitPattern = /(?:transform|convert|map|send|output|result|produce|generate)\s+(?:it\s+)?(?:to|as|into)/i;
  const splitIdx = description.search(splitPattern);

  const inputDesc  = splitIdx > 0 ? description.substring(0, splitIdx) : description;
  const outputDesc = splitIdx > 0 ? description.substring(splitIdx) : description;

  return {
    input:  inferSchema(inputDesc,  'InputSchema'),
    output: inferSchema(outputDesc, 'OutputSchema'),
  };
}

// ─── Field Extraction ─────────────────────────────────────────────────────────

/**
 * Common data field patterns in plain English descriptions.
 * Pattern → { type, format? }
 */
const FIELD_TYPE_HINTS: Array<{ pattern: RegExp; type: JsonSchemaType; format?: string }> = [
  // Numeric
  { pattern: /\b(amount|price|total|cost|fee|rate|percentage|quantity|count|number)\b/i, type: 'number' },
  { pattern: /\b(age|year|month|day|hour|minute|second|size|length|width|height)\b/i, type: 'integer' },
  { pattern: /\b(id|identifier|index|sequence)\b/i, type: 'integer' },

  // Boolean
  { pattern: /\b(flag|enabled|disabled|active|inactive|is_|has_|valid|invalid)\b/i, type: 'boolean' },

  // Date/time
  { pattern: /\b(date|timestamp|created|updated|modified|expiry|expires|dob|birth)\b/i, type: 'string', format: 'date-time' },
  { pattern: /\b(time)\b(?!\s*zone)/i, type: 'string', format: 'time' },

  // String with format
  { pattern: /\b(email|mail)\b/i, type: 'string', format: 'email' },
  { pattern: /\b(url|uri|link|href|website)\b/i, type: 'string', format: 'uri' },
  { pattern: /\b(guid|uuid)\b/i, type: 'string', format: 'uuid' },
  { pattern: /\b(phone|telephone|mobile|cell)\b/i, type: 'string' },
  { pattern: /\b(zip|postal|postcode)\b/i, type: 'string' },
  { pattern: /\b(ip\s*address|ipv4|ipv6)\b/i, type: 'string', format: 'ipv4' },
];

function extractFields(description: string): InferredField[] {
  const fields: InferredField[] = [];
  const fieldNames  = new Set<string>();

  // Pattern 1: "has a/an {field}" or "with a/an {field}"
  const hasPattern = /(?:has|with|contains?|includes?)\s+(?:a(?:n)?\s+)?(\w+(?:[\s_]\w+)?)\s+(?:field|property|attribute|column)?/gi;
  for (const m of description.matchAll(hasPattern)) {
    const name = normalizeFieldName(m[1] ?? '');
    if (name && !fieldNames.has(name)) {
      fieldNames.add(name);
      fields.push(buildField(name, description, m[0]));
    }
  }

  // Pattern 2: "the {field} is/are ..."
  const thePattern = /the\s+(\w+(?:[\s_]\w+)?)\s+(?:is|are|should|must|will)\s/gi;
  for (const m of description.matchAll(thePattern)) {
    const name = normalizeFieldName(m[1] ?? '');
    if (name && !fieldNames.has(name) && isFieldName(name)) {
      fieldNames.add(name);
      fields.push(buildField(name, description, m[0]));
    }
  }

  // Pattern 3: Comma-separated field lists "fields: email, name, phone"
  const listPattern = /(?:fields?|columns?|properties|attributes|keys?)[:]\s*((?:[a-z_]\w*(?:,\s*)?)+)/gi;
  for (const m of description.matchAll(listPattern)) {
    for (const part of (m[1] ?? '').split(/,\s*/)) {
      const name = normalizeFieldName(part.trim());
      if (name && !fieldNames.has(name)) {
        fieldNames.add(name);
        fields.push(buildField(name, description, m[0]));
      }
    }
  }

  // Pattern 4: "email address", "order number", "customer name" (noun phrases)
  const nounPhrasePattern = /\b([a-z]+(?:[\s_][a-z]+)?)\s+(?:address|number|name|id|code|status|type|date|time|amount)\b/gi;
  for (const m of description.matchAll(nounPhrasePattern)) {
    const fullName = normalizeFieldName(m[0].trim());
    if (fullName && !fieldNames.has(fullName)) {
      fieldNames.add(fullName);
      fields.push(buildField(fullName, description, m[0]));
    }
  }

  return fields.slice(0, 30);  // cap at 30 inferred fields
}

function buildField(name: string, context: string, source: string): InferredField {
  const lName = name.toLowerCase();
  let type: JsonSchemaType = 'string';
  let format: string | undefined;

  for (const hint of FIELD_TYPE_HINTS) {
    if (hint.pattern.test(lName)) {
      type   = hint.type;
      format = hint.format;
      break;
    }
  }

  return { name, type, ...(format !== undefined ? { format } : {}), required: false, source };
}

function extractRequiredFields(
  description: string,
  fields: InferredField[]
): string[] {
  const required: string[] = [];

  for (const field of fields) {
    // "must have", "required", "mandatory", "cannot be empty"
    const reqPattern = new RegExp(
      `(?:must|required|mandatory|need|needs)\\s+(?:have\\s+)?${field.name}|${field.name}\\s+(?:is\\s+)?(?:required|mandatory)`,
      'i'
    );
    if (reqPattern.test(description)) {
      field.required = true;
      required.push(field.name);
    }
  }

  return required;
}

function detectTopLevelArray(description: string): boolean {
  return /(?:a\s+)?(?:list|array|collection|set)\s+of\s+(?:records?|objects?|items?|messages?|orders?)/i.test(description) ||
         /for\s+each\s+(?:record|row|item)/i.test(description);
}

function buildObjectSchema(
  fields: InferredField[],
  required: string[],
  title: string
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};

  for (const field of fields) {
    const prop: JsonSchema = { type: field.type };
    if (field.format) prop.format = field.format;
    properties[field.name] = prop;
  }

  const schema: JsonSchema = {
    type:        'object',
    title,
    properties,
  };

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}

function identifySchemaGaps(description: string, fields: InferredField[]): string[] {
  const gaps: string[] = [];

  if (fields.length === 0) {
    gaps.push('No fields could be inferred from the description. Please provide a sample payload or field list.');
  } else if (fields.length < 3) {
    gaps.push(`Only ${fields.length} field(s) inferred. Consider providing more detail about the data structure.`);
  }

  if (!/format|schema|structure|sample|example/i.test(description)) {
    gaps.push('No sample data or schema reference was found. Schema inference may be incomplete.');
  }

  const hasNested = /(?:object|nested|sub[\s-]?(?:object|record))/i.test(description);
  if (hasNested) {
    gaps.push('Nested object structure detected but not fully modeled. Manual schema refinement recommended.');
  }

  return gaps;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'each', 'every', 'all', 'any', 'some',
  'that', 'this', 'these', 'those', 'it', 'its', 'they', 'their',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must',
]);

function normalizeFieldName(text: string): string {
  const words = text.trim().toLowerCase()
    .replace(/[^a-z0-9\s_]/g, '')
    .split(/[\s_]+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));

  if (words.length === 0) return '';
  if (words.length === 1) return words[0] ?? '';

  // camelCase
  return words[0] + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function isFieldName(name: string): boolean {
  const NON_FIELD_WORDS = new Set([
    'workflow', 'trigger', 'action', 'step', 'process', 'logic', 'integration',
    'connection', 'connector', 'message', 'request', 'response', 'service',
    'application', 'function', 'method', 'endpoint', 'api', 'queue', 'topic',
  ]);
  return name.length >= 2 && !NON_FIELD_WORDS.has(name.toLowerCase());
}

function deriveSchemaName(description: string): string {
  // Try to find a noun phrase early in the description
  const m = description.match(/^(?:the\s+|a\s+|an\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (m) return (m[1] ?? 'Derived').replace(/\s+/g, '') + 'Schema';

  const words = description.split(/\s+/).slice(0, 3);
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('') + 'Schema';
}
