/**
 * NLP Interpreter — Greenfield Stage G1 (PREMIUM TIER)
 *
 * Parses a natural language description of an integration requirement and
 * extracts a structured IntegrationIntent — the same intermediate
 * representation produced by the BizTalk analysis pipeline.
 *
 * This is a *rule-based pre-processor*, not an LLM itself.
 * It applies regex heuristics, keyword dictionaries, and pattern matching
 * to extract as much structure as possible from plain English.
 *
 * The MCP tool layer passes the user's NLP description to this module FIRST
 * to produce a partial IntegrationIntent, then asks Claude to fill in any
 * gaps via a structured prompt. This two-pass approach keeps the LLM focused
 * on interpretation rather than JSON generation.
 *
 * Extraction capabilities:
 *   - Trigger detection: SFTP/FTP polling, HTTP webhook, Service Bus, schedule
 *   - Step identification: receive, transform, validate, send, loop, condition
 *   - Error handling: retry counts, dead-letter, email notification
 *   - System inventory: external system names, protocols, authentication hints
 *   - Data format detection: CSV, JSON, XML, EDI, flat-file
 *   - Integration pattern recognition: batch, scatter-gather, CBR, aggregation
 *   - Connector selection: maps detected systems to Logic Apps connector names
 */

import type {
  IntegrationIntent,
  IntegrationStep,
  ExternalSystem,
  DataFormat,
  AuthMethod,
  IntegrationPattern,
} from '../shared/integration-intent.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface NlpInterpretResult {
  intent:         IntegrationIntent;
  /** Aspects of the description that could not be fully interpreted */
  ambiguities:    NlpAmbiguity[];
  /** Confidence score 0–1 for the overall extraction */
  confidence:     number;
}

export interface NlpAmbiguity {
  aspect:   string;
  question: string;
  /** Suggested default value to use if user doesn't clarify */
  defaultValue?: string;
}

/**
 * Main entry point. Parses a free-form English description of an integration
 * into a structured IntegrationIntent + any ambiguities to clarify.
 */
export function interpretNlp(description: string): NlpInterpretResult {
  const text   = description.toLowerCase();
  const lines  = description.split(/[.\n]+/).map(l => l.trim()).filter(l => l.length > 0);

  const trigger       = extractTrigger(text, lines);
  const steps         = extractSteps(text, lines);
  const errorHandling = extractErrorHandling(text);
  const systems       = extractSystems(text, trigger, steps);
  const dataFormats   = extractDataFormats(text);
  const patterns      = detectPatterns(text, steps);
  const ambiguities   = identifyAmbiguities(text, trigger, steps, errorHandling, systems);

  // Complexity heuristic
  const complexity =
    steps.length > 8 || patterns.length > 2 ? 'complex' :
    steps.length > 4 || patterns.length > 0 ? 'moderate' : 'simple';

  const intent: IntegrationIntent = {
    trigger,
    steps,
    errorHandling,
    systems,
    dataFormats,
    patterns,
    metadata: {
      source:                    'nlp-greenfield',
      complexity,
      estimatedActions:          steps.length + 2,  // trigger + scope overhead
      requiresIntegrationAccount: dataFormats.input === 'edi-x12' || dataFormats.input === 'edi-edifact' ||
                                  dataFormats.output === 'edi-x12' || dataFormats.output === 'edi-edifact',
      requiresOnPremGateway:     false,
    },
  };

  const confidence = computeConfidence(intent, ambiguities);

  return { intent, ambiguities, confidence };
}

// ─── Trigger Extraction ───────────────────────────────────────────────────────

function extractTrigger(
  text: string,
  lines: string[]
): IntegrationIntent['trigger'] {
  // SFTP polling — check before schedule so "poll SFTP every 5 minutes" → SFTP, not Recurrence
  if (/sftp/i.test(text)) {
    const intervalMatch = text.match(/every\s+(\d+)\s+(minute|hour)s?/);
    return {
      type:      'polling',
      source:    'SFTP server',
      connector: 'sftp',
      config: {
        frequency: 'Minute',
        interval:  intervalMatch ? parseInt(intervalMatch[1] ?? '5', 10) : 5,
        folder:    extractQuotedOrDefault(text, /folder[:\s]+["']?([^"'\s,]+)/i, '/'),
      },
    };
  }

  // FTP polling
  if (/\bftp\b/i.test(text) && !/sftp/i.test(text)) {
    return {
      type:      'polling',
      source:    'FTP server',
      connector: 'ftp',
      config:    { frequency: 'Minute', interval: 5 },
    };
  }

  // Service Bus
  if (/service\s*bus|azure\s*queue|asb/i.test(text)) {
    const queueMatch = text.match(/queue\s+["']?([a-z0-9-]+)["']?/i);
    return {
      type:      'polling',
      source:    'Azure Service Bus',
      connector: 'serviceBus',
      config:    { queueName: queueMatch?.[1] ?? '{queueName}' },
    };
  }

  // Event Hubs
  if (/event\s*hub/i.test(text)) {
    return {
      type:      'polling',
      source:    'Azure Event Hubs',
      connector: 'eventHubs',
      config:    {},
    };
  }

  // Blob Storage
  if (/blob\s*storage|azure\s*storage/i.test(text)) {
    return {
      type:      'polling',
      source:    'Azure Blob Storage',
      connector: 'blob',
      config:    {},
    };
  }

  // HTTP webhook / request
  if (/http|webhook|rest\s*api|endpoint|post\s+request|incoming\s+request/i.test(text)) {
    const methodMatch = text.match(/\b(get|post|put|patch|delete)\s+request/i);
    return {
      type:      'webhook',
      source:    'HTTP endpoint',
      connector: 'request',
      config:    { method: methodMatch?.[1]?.toUpperCase() ?? 'POST' },
    };
  }

  // Schedule / recurring — checked last so specific source checks (SFTP, Service Bus…) win
  const scheduleMatch =
    text.match(/every\s+(\d+)\s+(minute|hour|day|week)s?/) ||
    text.match(/(?:run|execute|trigger)\s+(?:at|on)\s+(\d{1,2}:\d{2})/i) ||
    text.match(/(?:daily|weekly|hourly|nightly)/);

  if (scheduleMatch) {
    const freqMap: Record<string, string> = {
      minute: 'Minute', hour: 'Hour', day: 'Day', week: 'Week',
      daily: 'Day', weekly: 'Week', hourly: 'Hour', nightly: 'Day',
    };
    const unit      = scheduleMatch[2] ?? scheduleMatch[0] ?? '';
    const interval  = scheduleMatch[1] !== undefined ? parseInt(scheduleMatch[1], 10) : 1;
    const frequency = freqMap[unit] ?? 'Day';

    return {
      type:      'schedule',
      source:    'Timer schedule',
      connector: 'recurrence',
      config:    { frequency, interval },
    };
  }

  // Manual / default
  return {
    type:      'manual',
    source:    'Manual trigger',
    connector: 'manual',
    config:    {},
  };
}

// ─── Step Extraction ──────────────────────────────────────────────────────────

function extractSteps(text: string, lines: string[]): IntegrationStep[] {
  const steps: IntegrationStep[] = [];
  let seq = 0;

  // Scan for step keywords in natural reading order
  for (const line of lines) {
    const lower = line.toLowerCase();

    // Parse / read CSV, JSON, XML
    if (/parse\s+(the\s+)?(csv|json|xml|file|message)|read\s+(the\s+)?(csv|file)/i.test(line)) {
      steps.push({
        id:          `step-${++seq}`,
        type:        'transform',
        description: `Parse ${detectFormat(lower)} content`,
        config:      {},
        runAfter:    seq > 1 ? [`step-${seq - 1}`] : [],
      });
    }

    // Validate / check
    if (/validat|check\s+(each|every|if|that|for)\s+(row|record|field|email|value)/i.test(line)) {
      const what = line.match(/validat\w*\s+([^,.]+)/i)?.[1]?.trim() ?? 'message';
      steps.push({
        id:          `step-${++seq}`,
        type:        'validate',
        description: `Validate ${what}`,
        config:      {},
        runAfter:    seq > 1 ? [`step-${seq - 1}`] : [],
      });
    }

    // Transform / convert / map / format
    if (/transform\s+(?:the\s+)?(?:data|record|message|csv|xml|json)|convert\s+to|map\s+(?:the\s+)?(?:data|record|field)/i.test(line)) {
      const targetMatch = line.match(/(?:transform\s+to|convert\s+to|into)\s+([^,.]+)/i);
      steps.push({
        id:          `step-${++seq}`,
        type:        'transform',
        description: `Transform to ${targetMatch?.[1]?.trim() ?? 'target format'}`,
        config:      {},
        runAfter:    seq > 1 ? [`step-${seq - 1}`] : [],
      });
    }

    // Loop / iterate
    if (/for\s+each\s+(row|record|item|file|message)|loop\s+(through|over)\s+(each|all)/i.test(line)) {
      const what = line.match(/(?:each|over)\s+(row|record|item|file|message)/i)?.[1] ?? 'item';
      steps.push({
        id:          `step-${++seq}`,
        type:        'split',
        description: `Loop over each ${what}`,
        runAfter:    seq > 1 ? [`step-${seq - 1}`] : [],
        config:      { loopOver: what },
      });
    }

    // Condition / if / route
    if (/\bif\s+(any|the|a\s+)?(row|record|item|request|message|condition|value)\s+(?:fails?|is|matches|equals|has)/i.test(line) ||
        /route\s+(based\s+on|by)\s+|condition\s+(?:is|evaluates)/i.test(line)) {
      steps.push({
        id:          `step-${++seq}`,
        type:        'condition',
        description: extractConditionDescription(line),
        config:      {},
        runAfter:    seq > 1 ? [`step-${seq - 1}`] : [],
      });
    }

    // HTTP POST / PUT / send to API
    if (/post\s+(?:them|it|the\s+(?:data|record|message))\s+to|send\s+to\s+(?:the\s+)?(?:rest|api|endpoint|url)/i.test(line) ||
        /http[s]?\s+post\s+to/i.test(line)) {
      const urlMatch = line.match(/(?:api\.|https?:\/\/)([^\s,'"]+)/i);
      steps.push({
        id:          `step-${++seq}`,
        type:        'send',
        description: `POST to REST API${urlMatch ? ` (${urlMatch[0]})` : ''}`,
        connector:   'http',
        runAfter:    seq > 1 ? [`step-${seq - 1}`] : [],
        config:      { method: 'POST', uri: urlMatch?.[0] ?? '@parameters(\'apiEndpoint\')' },
      });
    }

    // Email / notify
    if (/email\s+(?:a\s+)?(?:summary|report|notification|alert)|send\s+(?:an?\s+)?email\s+to/i.test(line)) {
      const toMatch = line.match(/(?:to|notify)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)/i);
      steps.push({
        id:          `step-${++seq}`,
        type:        'send',
        description: `Send email notification${toMatch ? ` to ${toMatch[1]}` : ''}`,
        connector:   'office365',
        runAfter:    seq > 1 ? [`step-${seq - 1}`] : [],
        config:      { to: toMatch?.[1] ?? '@parameters(\'notificationEmail\')' },
      });
    }

    // Save / store / write to database / cosmos / SQL / blob
    if (/(?:save|store|write|log|insert)\s+(?:each\s+)?(?:record|row|item|result|data)\s+(?:to|in|into)/i.test(line)) {
      const targetMatch = line.match(/(?:to|in|into)\s+(cosmos\s*db|sql|blob|database|table)/i);
      const connector   = detectStorageConnector(lower);
      steps.push({
        id:          `step-${++seq}`,
        type:        'send',
        description: `Store record in ${targetMatch?.[1] ?? 'database'}`,
        connector,
        config:      {},
        runAfter:    seq > 1 ? [`step-${seq - 1}`] : [],
      });
    }

    // Aggregate / collect failures
    if (/collect\s+(?:the\s+)?(failure|error|invalid)\s+(records?|rows?|items?)|aggregat/i.test(line)) {
      steps.push({
        id:          `step-${++seq}`,
        type:        'aggregate',
        description: `Collect and aggregate failures`,
        config:      {},
        runAfter:    seq > 1 ? [`step-${seq - 1}`] : [],
      });
    }
  }

  return steps;
}

// ─── Error Handling Extraction ────────────────────────────────────────────────

function extractErrorHandling(text: string): IntegrationIntent['errorHandling'] {
  const retryMatch = text.match(/retry\s+(\d+)\s+times?/i) ||
                     text.match(/(\d+)\s+retry\s+attempts?/i);

  const hasDeadLetter = /dead[\s-]letter|poison\s+message|fallback\s+queue/i.test(text);
  const hasSendEmail  = /(?:on|after|when)\s+(?:failure|error),?\s+(?:send|email|notify)/i.test(text);
  const hasTerminate  = /terminate|cancel\s+the\s+workflow|stop\s+processing/i.test(text);

  // Determine primary strategy
  let strategy: IntegrationIntent['errorHandling']['strategy'] = 'terminate';
  if (hasDeadLetter)              strategy = 'dead-letter';
  else if (hasSendEmail)          strategy = 'notify';
  else if (retryMatch)            strategy = 'retry';
  else if (/compensat/i.test(text)) strategy = 'compensate';
  else if (/ignor|skip/i.test(text)) strategy = 'ignore';

  // Dead letter target
  const deadLetterMatch = text.match(
    /dead[\s-]letter\s+(?:to\s+)?(?:a\s+)?(?:service\s+bus\s+)?queue\s+["']?([a-z0-9-]+)["']?/i
  );

  // Notification target
  const notifyMatch = text.match(/(?:email|notify)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)/i);

  // Retry policy
  const retryPolicy = retryMatch
    ? {
        count:    parseInt(retryMatch[1] ?? '3', 10),
        interval: extractRetryInterval(text),
        type:     /exponential/i.test(text) ? 'exponential' as const : 'fixed' as const,
      }
    : undefined;

  return {
    strategy,
    ...(retryPolicy !== undefined ? { retryPolicy } : {}),
    ...(deadLetterMatch?.[1] !== undefined
      ? { deadLetterTarget: deadLetterMatch[1] }
      : hasDeadLetter
        ? { deadLetterTarget: 'dead-letter-queue' }
        : {}),
    ...(notifyMatch?.[1] !== undefined ? { notificationTarget: notifyMatch[1] } : {}),
  };
}

// ─── Systems Extraction ───────────────────────────────────────────────────────

function extractSystems(
  text: string,
  trigger: IntegrationIntent['trigger'],
  steps: IntegrationStep[]
): ExternalSystem[] {
  const systems: ExternalSystem[] = [];
  const seen = new Set<string>();

  const add = (s: ExternalSystem) => {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      systems.push(s);
    }
  };

  // Source system from trigger
  if (trigger.connector !== 'request' && trigger.connector !== 'manual' && trigger.connector !== 'recurrence') {
    add({
      name:            trigger.source,
      protocol:        connectorToProtocol(trigger.connector),
      role:            'source',
      authentication:  guessAuth(text, trigger.connector),
      onPremises:      false,
      requiresGateway: false,
    });
  }

  // Systems from steps
  for (const step of steps) {
    if (!step.connector) continue;

    const role: ExternalSystem['role'] =
      step.type === 'send' ? 'destination' : 'intermediate';

    add({
      name:            systemNameFromStep(step),
      protocol:        connectorToProtocol(step.connector),
      role,
      authentication:  guessAuth(text, step.connector),
      onPremises:      false,
      requiresGateway: false,
    });
  }

  // Detect URLs mentioned explicitly
  const urlMatches = text.matchAll(/https?:\/\/([\w.-]+(?:\/[\w./-]*)?)/gi);
  for (const m of urlMatches) {
    const host = (m[1] ?? '').split('/')[0] ?? '';
    if (host && !seen.has(host)) {
      add({
        name:            host,
        protocol:        'HTTP/REST',
        role:            'destination',
        authentication:  guessAuthFromText(text),
        onPremises:      false,
        requiresGateway: false,
      });
    }
  }

  return systems;
}

// ─── Data Formats ─────────────────────────────────────────────────────────────

function extractDataFormats(text: string): IntegrationIntent['dataFormats'] {
  const rawInput  = detectFormat(text.substring(0, Math.floor(text.length / 2)));
  const rawOutput = detectFormat(text.substring(Math.floor(text.length / 2)));
  const input:  DataFormat = (rawInput  || 'json') as DataFormat;
  const output: DataFormat = (rawOutput || rawInput || 'json') as DataFormat;

  return { input, output };
}

// ─── Pattern Detection ────────────────────────────────────────────────────────

function detectPatterns(text: string, steps: IntegrationStep[]): IntegrationPattern[] {
  const patterns: IntegrationPattern[] = [];

  if (/for\s+each|loop\s+(over|through)|process\s+(each|all)\s+(record|row|file)/i.test(text))
    patterns.push('splitter');

  if (/collect\s+(failure|error)|aggregat|summary\s+of|gather/i.test(text))
    patterns.push('message-aggregator');

  if (/dead[\s-]letter|poison/i.test(text))
    patterns.push('dead-letter-queue');

  if (/retry\s+\d+\s+times?|\d+\s+retry/i.test(text))
    patterns.push('retry-idempotent');

  if (/route|condition|if\s+.*\s+then|switch\s+on|based\s+on/i.test(text))
    patterns.push('content-based-routing');

  if (/parallel|simultaneously|at\s+the\s+same\s+time/i.test(text))
    patterns.push('scatter-gather');

  if (steps.filter(s => s.type === 'send').length > 2)
    patterns.push('fan-out');

  if (/(?:wait|until|poll)\s+for\s+(?:a\s+)?response|request[\s-]reply/i.test(text))
    patterns.push('request-reply');

  return [...new Set(patterns)];
}

// ─── Ambiguity Detection ──────────────────────────────────────────────────────

function identifyAmbiguities(
  text: string,
  trigger: IntegrationIntent['trigger'],
  steps: IntegrationStep[],
  errorHandling: IntegrationIntent['errorHandling'],
  systems: ExternalSystem[]
): NlpAmbiguity[] {
  const ambiguities: NlpAmbiguity[] = [];

  // Authentication for external systems
  for (const sys of systems) {
    if (sys.authentication === 'unknown') {
      ambiguities.push({
        aspect:       `Authentication for ${sys.name}`,
        question:     `What authentication does ${sys.name} use? (API key, OAuth 2.0, managed identity, connection string)`,
        defaultValue: 'managed-identity',
      });
    }
  }

  // Data format ambiguity
  if (!text.match(/\b(csv|json|xml|edi|flat[\s-]file|parquet|avro)\b/i)) {
    ambiguities.push({
      aspect:       'Input data format',
      question:     'What is the input data format? (CSV, JSON, XML, EDI, flat-file)',
      defaultValue: 'json',
    });
  }

  // Missing schema for transforms
  const hasTransform = steps.some(s => s.type === 'transform');
  if (hasTransform && !/schema|format|struct|field/i.test(text)) {
    ambiguities.push({
      aspect:       'Target schema/structure',
      question:     'Can you describe the target data structure or provide a sample JSON/XML?',
      defaultValue: 'Infer from context',
    });
  }

  // Polling interval
  if (trigger.type === 'polling' && !text.match(/every\s+\d+/i)) {
    ambiguities.push({
      aspect:       'Polling interval',
      question:     'How often should the workflow poll for new data? (e.g., every 5 minutes)',
      defaultValue: '5 minutes',
    });
  }

  // Error notification recipient
  if (errorHandling.strategy === 'notify' && !errorHandling.notificationTarget) {
    ambiguities.push({
      aspect:       'Notification recipient',
      question:     'Who should receive error notifications? (email address or distribution list)',
      defaultValue: 'ops@company.com',
    });
  }

  return ambiguities;
}

// ─── Confidence Scorer ────────────────────────────────────────────────────────

function computeConfidence(
  intent: IntegrationIntent,
  ambiguities: NlpAmbiguity[]
): number {
  let score = 1.0;

  // Deduct for each ambiguity
  score -= ambiguities.length * 0.10;

  // Deduct for unknown connector
  if (intent.trigger.connector === 'manual') score -= 0.15;

  // Deduct for no steps
  if (intent.steps.length === 0) score -= 0.30;

  // Deduct for unknown systems
  const unknownSystems = intent.systems.filter(s => s.authentication === 'unknown').length;
  score -= unknownSystems * 0.05;

  return Math.max(0, Math.min(1, score));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectFormat(text: string): DataFormat | '' {
  if (/\bcsv\b/i.test(text))                              return 'csv';
  if (/\bxml\b/i.test(text))                              return 'xml';
  if (/\bjson\b/i.test(text))                             return 'json';
  if (/\bedi\b|\bx12\b|\bedifact\b/i.test(text))         return 'edi-x12';
  if (/flat[\s-]file|fixed[\s-]width|positional/i.test(text)) return 'flat-file';
  if (/parquet|avro/i.test(text))                         return 'binary';
  return '';
}

function detectStorageConnector(text: string): string {
  if (/cosmos/i.test(text)) return 'cosmosDb';
  if (/sql|table/i.test(text)) return 'sql';
  if (/blob/i.test(text)) return 'blob';
  return 'sql';
}

function connectorToProtocol(connector: string): string {
  const map: Record<string, string> = {
    sftp:         'SFTP',
    ftp:          'FTP',
    serviceBus:   'Service Bus',
    blob:         'Azure Blob',
    http:         'HTTP/REST',
    request:      'HTTP/REST',
    sql:          'SQL Server',
    cosmosDb:     'Cosmos DB',
    eventHubs:    'Event Hubs',
    sap:          'SAP',
    office365:    'SMTP',
    recurrence:   'Timer',
  };
  return map[connector] ?? connector;
}

function guessAuth(text: string, connector: string): AuthMethod {
  if (/managed\s*identity|msi/i.test(text)) return 'managed-identity';
  if (/api[\s-]key/i.test(text))            return 'api-key';
  if (/oauth/i.test(text))                  return 'oauth';
  if (/connection\s*string/i.test(text))    return 'connection-string';

  // Connector-specific defaults
  const defaults: Record<string, AuthMethod> = {
    serviceBus: 'connection-string',
    blob:       'connection-string',
    sql:        'connection-string',
    sftp:       'basic',
    ftp:        'basic',
    http:       'api-key',
    office365:  'oauth',
  };
  return defaults[connector] ?? 'unknown';
}

function guessAuthFromText(text: string): AuthMethod {
  if (/managed\s*identity/i.test(text)) return 'managed-identity';
  if (/api[\s-]key/i.test(text))        return 'api-key';
  if (/oauth/i.test(text))              return 'oauth';
  return 'unknown';
}

function systemNameFromStep(step: IntegrationStep): string {
  if (step.config?.['uri']) {
    const uri = String(step.config['uri']);
    const m   = uri.match(/https?:\/\/([\w.-]+)/);
    if (m) return m[1] ?? step.description;
  }
  return step.description;
}

function extractQuotedOrDefault(
  text: string,
  pattern: RegExp,
  fallback: string
): string {
  const m = text.match(pattern);
  return m?.[1] ?? fallback;
}

function extractRetryInterval(text: string): string {
  const m = text.match(/wait\s+(\d+)\s+(second|minute|hour)s?\s+between\s+retries?/i) ||
            text.match(/retry\s+(?:every\s+)?(\d+)\s+(second|minute|hour)s?/i);
  if (!m) return 'PT30S';

  const n    = parseInt(m[1] ?? '0', 10);
  const unit = (m[2] ?? 'second').toLowerCase();
  if (unit === 'second') return `PT${n}S`;
  if (unit === 'minute') return `PT${n}M`;
  if (unit === 'hour')   return `PT${n}H`;
  return 'PT30S';
}

function extractConditionDescription(line: string): string {
  const m = line.match(/if\s+(.{5,60}?)(?:\s+then|\s*[,.]|$)/i);
  return m ? `Condition: ${m[1]?.trim() ?? ''}` : 'Condition check';
}
