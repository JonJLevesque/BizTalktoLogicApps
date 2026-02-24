/**
 * Template Library — Greenfield Stage G1 (PREMIUM TIER)
 *
 * A catalog of pre-built IntegrationIntent templates for common integration
 * patterns. Users can select a template and customize it via NLP rather than
 * starting from scratch, dramatically reducing the time to first deployment.
 */

import type { IntegrationIntent } from '../shared/integration-intent.js';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface WorkflowTemplate {
  id:          string;
  name:        string;
  category:    TemplateCategory;
  description: string;
  /** Tags for searchability */
  tags:        string[];
  /** Common BizTalk patterns this maps from */
  biztalkPatterns?: string[];
  /** Tier required to use this template */
  tier:        'standard' | 'premium';
  intent:      IntegrationIntent;
}

export type TemplateCategory =
  | 'file-processing'
  | 'messaging'
  | 'api-integration'
  | 'scheduled-batch'
  | 'b2b-edi'
  | 'database-sync'
  | 'notification';

// ─── Template Catalog ─────────────────────────────────────────────────────────

export const TEMPLATE_CATALOG: WorkflowTemplate[] = [

  // ── File Processing ─────────────────────────────────────────────────────────

  {
    id:          'sftp-to-api',
    name:        'SFTP File → Transform → REST API',
    category:    'file-processing',
    description: 'Poll an SFTP server for new files, parse the content, transform to JSON, and POST to a REST API.',
    tags:        ['sftp', 'file', 'transform', 'rest', 'api', 'batch'],
    biztalkPatterns: ['FILE adapter receive', 'map', 'HTTP send port'],
    tier:        'standard',
    intent: {
      trigger: {
        type:      'polling',
        source:    'SFTP server',
        connector: 'sftp',
        config:    { frequency: 'Minute', interval: 5, folder: '/inbound', fileFilter: '*.csv' },
      },
      steps: [
        {
          id:          'step-1',
          type:        'transform',
          description: 'Parse CSV file content',
          config:      {},
          runAfter:    [],
        },
        {
          id:          'step-2',
          type:        'split',
          description: 'Loop over each CSV row',
          config:      { loopOver: 'rows' },
          runAfter:    ['step-1'],
        },
        {
          id:          'step-3',
          type:        'transform',
          description: 'Transform row to target JSON format',
          config:      {},
          runAfter:    ['step-2'],
        },
        {
          id:          'step-4',
          type:        'send',
          description: 'POST record to REST API',
          connector:   'http',
          config:      { method: 'POST', uri: '@parameters(\'apiEndpoint\')' },
          runAfter:    ['step-3'],
        },
      ],
      errorHandling: {
        strategy:         'dead-letter',
        retryPolicy:      { count: 3, interval: 'PT30S', type: 'exponential' },
        deadLetterTarget: 'sftp-dlq',
      },
      systems: [
        { name: 'SFTP Server',  protocol: 'SFTP',     role: 'source',      authentication: 'basic',     onPremises: false, requiresGateway: false },
        { name: 'Target API',   protocol: 'HTTP/REST', role: 'destination', authentication: 'api-key',   onPremises: false, requiresGateway: false },
      ],
      dataFormats: { input: 'csv', output: 'json' },
      patterns:    ['splitter', 'dead-letter-queue', 'retry-idempotent'],
      metadata:    { source: 'nlp-greenfield', complexity: 'moderate', estimatedActions: 8, requiresIntegrationAccount: false, requiresOnPremGateway: false },
    },
  },

  {
    id:          'blob-to-service-bus',
    name:        'Blob Storage File → Service Bus',
    category:    'file-processing',
    description: 'Trigger on new blob, parse XML content, and forward to a Service Bus queue for downstream processing.',
    tags:        ['blob', 'storage', 'xml', 'service-bus', 'queue'],
    biztalkPatterns: ['FILE adapter', 'XML pipeline', 'MSMQ send port'],
    tier:        'standard',
    intent: {
      trigger: {
        type:      'polling',
        source:    'Azure Blob Storage',
        connector: 'blob',
        config:    { frequency: 'Minute', interval: 1, container: 'inbound' },
      },
      steps: [
        {
          id:          'step-1',
          type:        'transform',
          description: 'Parse XML blob content',
          config:      {},
          runAfter:    [],
        },
        {
          id:          'step-2',
          type:        'validate',
          description: 'Validate against XML schema',
          config:      {},
          runAfter:    ['step-1'],
        },
        {
          id:          'step-3',
          type:        'send',
          description: 'Send message to Service Bus queue',
          connector:   'serviceBus',
          config:      { queueName: '@parameters(\'outputQueue\')' },
          runAfter:    ['step-2'],
        },
      ],
      errorHandling: {
        strategy:         'dead-letter',
        deadLetterTarget: 'blob-error-queue',
      },
      systems: [
        { name: 'Azure Blob Storage', protocol: 'Azure Blob',  role: 'source',      authentication: 'connection-string', onPremises: false, requiresGateway: false },
        { name: 'Azure Service Bus',  protocol: 'Service Bus', role: 'destination', authentication: 'connection-string', onPremises: false, requiresGateway: false },
      ],
      dataFormats: { input: 'xml', output: 'xml' },
      patterns:    ['dead-letter-queue'],
      metadata:    { source: 'nlp-greenfield', complexity: 'simple', estimatedActions: 6, requiresIntegrationAccount: false, requiresOnPremGateway: false },
    },
  },

  // ── Messaging ───────────────────────────────────────────────────────────────

  {
    id:          'service-bus-to-api',
    name:        'Service Bus Queue → Process → REST API',
    category:    'messaging',
    description: 'Receive messages from a Service Bus queue, deserialize, process, and call a REST API.',
    tags:        ['service-bus', 'queue', 'json', 'rest', 'api'],
    biztalkPatterns: ['MSMQ receive location', 'orchestration', 'HTTP send port'],
    tier:        'standard',
    intent: {
      trigger: {
        type:      'polling',
        source:    'Azure Service Bus',
        connector: 'serviceBus',
        config:    { queueName: '@parameters(\'inputQueue\')' },
      },
      steps: [
        {
          id:          'step-1',
          type:        'transform',
          description: 'Parse JSON message body',
          config:      {},
          runAfter:    [],
        },
        {
          id:          'step-2',
          type:        'validate',
          description: 'Validate message schema',
          config:      {},
          runAfter:    ['step-1'],
        },
        {
          id:          'step-3',
          type:        'send',
          description: 'POST to target REST API',
          connector:   'http',
          config:      { method: 'POST', uri: '@parameters(\'targetApiUrl\')' },
          runAfter:    ['step-2'],
        },
      ],
      errorHandling: {
        strategy:         'dead-letter',
        retryPolicy:      { count: 3, interval: 'PT1M', type: 'exponential' },
        deadLetterTarget: 'processing-dlq',
      },
      systems: [
        { name: 'Azure Service Bus', protocol: 'Service Bus', role: 'source',      authentication: 'connection-string', onPremises: false, requiresGateway: false },
        { name: 'Target REST API',   protocol: 'HTTP/REST',   role: 'destination', authentication: 'api-key',           onPremises: false, requiresGateway: false },
      ],
      dataFormats: { input: 'json', output: 'json' },
      patterns:    ['dead-letter-queue', 'retry-idempotent'],
      metadata:    { source: 'nlp-greenfield', complexity: 'simple', estimatedActions: 6, requiresIntegrationAccount: false, requiresOnPremGateway: false },
    },
  },

  // ── API Integration ──────────────────────────────────────────────────────────

  {
    id:          'http-webhook-to-service-bus',
    name:        'HTTP Webhook → Validate → Service Bus',
    category:    'api-integration',
    description: 'Receive an HTTP POST webhook, validate the payload, route it to a Service Bus topic.',
    tags:        ['webhook', 'http', 'validate', 'service-bus', 'routing'],
    biztalkPatterns: ['WCF-WebHttp receive', 'content-based routing', 'Service Bus send port'],
    tier:        'standard',
    intent: {
      trigger: {
        type:      'webhook',
        source:    'HTTP endpoint',
        connector: 'request',
        config:    { method: 'POST' },
      },
      steps: [
        {
          id:          'step-1',
          type:        'validate',
          description: 'Validate webhook payload schema',
          config:      {},
          runAfter:    [],
        },
        {
          id:          'step-2',
          type:        'route',
          description: 'Route by event type',
          config:      {},
          runAfter:    ['step-1'],
          branches: {
            cases: [
              {
                value: 'order.created',
                steps: [{ id: 'step-2a', type: 'send', description: 'Send to orders topic',        connector: 'serviceBus', config: {}, runAfter: [] }],
              },
              {
                value: 'order.cancelled',
                steps: [{ id: 'step-2b', type: 'send', description: 'Send to cancellations topic', connector: 'serviceBus', config: {}, runAfter: [] }],
              },
            ],
          },
        },
      ],
      errorHandling: {
        strategy:    'terminate',
        retryPolicy: { count: 0, interval: 'PT0S', type: 'fixed' },
      },
      systems: [
        { name: 'Webhook caller',    protocol: 'HTTP/REST',   role: 'source',      authentication: 'api-key',           onPremises: false, requiresGateway: false },
        { name: 'Azure Service Bus', protocol: 'Service Bus', role: 'destination', authentication: 'connection-string', onPremises: false, requiresGateway: false },
      ],
      dataFormats: { input: 'json', output: 'json' },
      patterns:    ['content-based-routing'],
      metadata:    { source: 'nlp-greenfield', complexity: 'moderate', estimatedActions: 7, requiresIntegrationAccount: false, requiresOnPremGateway: false },
    },
  },

  // ── Scheduled Batch ──────────────────────────────────────────────────────────

  {
    id:          'scheduled-db-extract',
    name:        'Scheduled Database Extract → API',
    category:    'scheduled-batch',
    description: 'Run on a schedule, query a SQL database, transform each row, and send to a REST API.',
    tags:        ['schedule', 'timer', 'sql', 'batch', 'rest', 'api'],
    biztalkPatterns: ['SQL adapter receive', 'map', 'HTTP send'],
    tier:        'standard',
    intent: {
      trigger: {
        type:      'schedule',
        source:    'Timer schedule',
        connector: 'recurrence',
        config:    { frequency: 'Hour', interval: 1 },
      },
      steps: [
        {
          id:          'step-1',
          type:        'enrich',
          description: 'Query SQL database for new records',
          connector:   'sql',
          config:      { storedProcedure: '@parameters(\'extractProcedure\')' },
          runAfter:    [],
        },
        {
          id:          'step-2',
          type:        'split',
          description: 'Loop over each record',
          config:      { loopOver: 'records' },
          runAfter:    ['step-1'],
        },
        {
          id:          'step-3',
          type:        'transform',
          description: 'Transform record to API format',
          config:      {},
          runAfter:    ['step-2'],
        },
        {
          id:          'step-4',
          type:        'send',
          description: 'POST record to destination API',
          connector:   'http',
          config:      { method: 'POST', uri: '@parameters(\'destinationApi\')' },
          runAfter:    ['step-3'],
        },
      ],
      errorHandling: {
        strategy:           'notify',
        retryPolicy:        { count: 2, interval: 'PT2M', type: 'fixed' },
        notificationTarget: '@parameters(\'alertEmail\')',
      },
      systems: [
        { name: 'SQL Database',   protocol: 'SQL Server', role: 'source',      authentication: 'connection-string', onPremises: false, requiresGateway: false },
        { name: 'Destination API', protocol: 'HTTP/REST', role: 'destination', authentication: 'api-key',           onPremises: false, requiresGateway: false },
      ],
      dataFormats: { input: 'json', output: 'json' },
      patterns:    ['splitter', 'retry-idempotent'],
      metadata:    { source: 'nlp-greenfield', complexity: 'moderate', estimatedActions: 9, requiresIntegrationAccount: false, requiresOnPremGateway: false },
    },
  },

  // ── Notification ──────────────────────────────────────────────────────────────

  {
    id:          'event-hub-alert',
    name:        'Event Hubs → Filter → Email Alert',
    category:    'notification',
    description: 'Consume events from Event Hubs, filter by severity/type, and send email alerts.',
    tags:        ['event-hub', 'alert', 'email', 'filter', 'notification', 'monitoring'],
    tier:        'standard',
    intent: {
      trigger: {
        type:      'polling',
        source:    'Azure Event Hubs',
        connector: 'eventHubs',
        config:    { consumerGroup: '$Default' },
      },
      steps: [
        {
          id:          'step-1',
          type:        'condition',
          description: 'Filter: only critical severity events',
          config:      {},
          runAfter:    [],
          branches: {
            trueBranch: [
              {
                id:          'step-1a',
                type:        'send',
                description: 'Send alert email to ops team',
                connector:   'office365',
                config:      { to: '@parameters(\'alertEmail\')' },
                runAfter:    [],
              },
            ],
            falseBranch: [],
          },
        },
      ],
      errorHandling: { strategy: 'ignore' },
      systems: [
        { name: 'Azure Event Hubs',     protocol: 'Event Hubs', role: 'source',      authentication: 'connection-string', onPremises: false, requiresGateway: false },
        { name: 'Office 365 / Email',   protocol: 'SMTP',       role: 'destination', authentication: 'oauth',             onPremises: false, requiresGateway: false },
      ],
      dataFormats: { input: 'json', output: 'json' },
      patterns:    ['content-based-routing'],
      metadata:    { source: 'nlp-greenfield', complexity: 'simple', estimatedActions: 4, requiresIntegrationAccount: false, requiresOnPremGateway: false },
    },
  },

];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List all templates, optionally filtered by category or search term.
 */
export function listTemplates(options?: {
  category?: TemplateCategory;
  search?:   string;
  tier?:     'standard' | 'premium';
}): WorkflowTemplate[] {
  let results = TEMPLATE_CATALOG;

  if (options?.category) {
    results = results.filter(t => t.category === options.category);
  }

  if (options?.tier) {
    results = results.filter(t => t.tier === options.tier);
  }

  if (options?.search) {
    const query = options.search.toLowerCase();
    results = results.filter(t =>
      t.name.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query) ||
      t.tags.some(tag => tag.includes(query))
    );
  }

  return results;
}

/**
 * Get a template by ID. Returns null if not found.
 */
export function getTemplate(id: string): WorkflowTemplate | null {
  return TEMPLATE_CATALOG.find(t => t.id === id) ?? null;
}

/**
 * Find templates most relevant to a given BizTalk pattern.
 */
export function findTemplatesByBizTalkPattern(pattern: string): WorkflowTemplate[] {
  const lower = pattern.toLowerCase();
  return TEMPLATE_CATALOG.filter(t =>
    t.biztalkPatterns?.some(p => p.toLowerCase().includes(lower))
  );
}

/**
 * Clone a template's intent for customization.
 * Returns a deep copy so the original template is not modified.
 */
export function cloneTemplateIntent(templateId: string): IntegrationIntent | null {
  const template = getTemplate(templateId);
  if (!template) return null;
  return JSON.parse(JSON.stringify(template.intent)) as IntegrationIntent;
}
