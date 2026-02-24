/**
 * Connector Recommender — Greenfield Stage G1 (PREMIUM TIER)
 *
 * Selects the best Logic Apps connectors for systems described in natural
 * language or in an IntegrationIntent's systems array.
 *
 * Selection criteria (in priority order):
 *   1. Built-in connectors preferred over managed (lower latency, no managed
 *      connector resource required, no network egress to shared infrastructure)
 *   2. Service Bus preferred over Storage Queue (enterprise features, sessions,
 *      dead-letter, topic/subscription fan-out)
 *   3. For SAP: built-in SAP connector (requires on-premises data gateway)
 *   4. For SFTP: built-in SFTP connector (Logic Apps Standard only)
 *   5. Managed connectors only when no built-in equivalent exists
 *
 * Also produces:
 *   - Reasoning text for each recommendation (useful for LLM explanations)
 *   - Required Azure resources for each connector
 *   - Authentication recommendations
 *   - Estimated connection setup effort
 */

import type { ExternalSystem } from '../shared/integration-intent.js';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ConnectorRecommendation {
  system:          ExternalSystem;
  /** Connector identifier matching connection-generator.ts registry */
  connectorName:   string;
  displayName:     string;
  connectorType:   'built-in' | 'managed' | 'custom';
  reasoning:       string;
  alternatives:    AlternativeConnector[];
  requiredResources: string[];
  authMethod:      string;
  setupEffortDays: number;
  /** Warnings or caveats for this connector choice */
  caveats:         string[];
}

export interface AlternativeConnector {
  connectorName: string;
  displayName:   string;
  tradeOff:      string;
}

// ─── Connector Catalog ────────────────────────────────────────────────────────

interface ConnectorCatalogEntry {
  name:            string;
  displayName:     string;
  type:            'built-in' | 'managed';
  protocols:       string[];
  keywords:        string[];
  requiredResources: string[];
  defaultAuth:     string;
  setupEffortDays: number;
  caveats:         string[];
  alternatives:    Array<{ name: string; displayName: string; tradeOff: string }>;
}

const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  {
    name:              'serviceBus',
    displayName:       'Azure Service Bus (built-in)',
    type:              'built-in',
    protocols:         ['Service Bus', 'MSMQ', 'AMQP', 'queue', 'topic', 'subscription'],
    keywords:          ['queue', 'topic', 'subscription', 'service bus', 'asb', 'message broker', 'pub-sub'],
    requiredResources: ['Azure Service Bus namespace'],
    defaultAuth:       'connection-string',
    setupEffortDays:   0.5,
    caveats:           ['Requires Service Bus namespace in same Azure region for lowest latency'],
    alternatives: [
      { name: 'eventHubs', displayName: 'Azure Event Hubs', tradeOff: 'Higher throughput, streaming-oriented, no dead-letter per message' },
    ],
  },
  {
    name:              'blob',
    displayName:       'Azure Blob Storage (built-in)',
    type:              'built-in',
    protocols:         ['Azure Blob', 'Blob Storage', 'Azure Storage', 'file', 'binary'],
    keywords:          ['blob', 'storage', 'file', 'container', 'upload', 'download'],
    requiredResources: ['Azure Storage Account'],
    defaultAuth:       'connection-string',
    setupEffortDays:   0.5,
    caveats:           [],
    alternatives: [
      { name: 'sftp', displayName: 'SFTP', tradeOff: 'Suitable for legacy systems that cannot use Azure native storage' },
    ],
  },
  {
    name:              'sftp',
    displayName:       'SFTP (built-in, Logic Apps Standard)',
    type:              'built-in',
    protocols:         ['SFTP', 'SSH FTP'],
    keywords:          ['sftp', 'ssh', 'secure ftp', 'file transfer', 'sftp server'],
    requiredResources: ['SFTP server (external)', 'Network connectivity (VNet or public)'],
    defaultAuth:       'username-password',
    setupEffortDays:   1,
    caveats:           ['Built-in SFTP only available in Logic Apps Standard (not Consumption)', 'Large files may require chunked transfer'],
    alternatives: [
      { name: 'ftp', displayName: 'FTP (managed)', tradeOff: 'Unencrypted; use only on private networks' },
      { name: 'blob', displayName: 'Azure Blob Storage', tradeOff: 'Requires migrating files to Azure storage first' },
    ],
  },
  {
    name:              'ftp',
    displayName:       'FTP (managed connector)',
    type:              'managed',
    protocols:         ['FTP'],
    keywords:          ['ftp', 'file transfer protocol'],
    requiredResources: ['FTP server (external)', 'Managed connection resource in Azure'],
    defaultAuth:       'username-password',
    setupEffortDays:   1.5,
    caveats:           ['FTP is unencrypted — prefer SFTP in production', 'Managed connector requires API connection resource'],
    alternatives: [
      { name: 'sftp', displayName: 'SFTP (built-in)', tradeOff: 'Encrypted; built-in preferred for Logic Apps Standard' },
    ],
  },
  {
    name:              'sql',
    displayName:       'SQL Server (built-in)',
    type:              'built-in',
    protocols:         ['SQL Server', 'SQL', 'MSSQL', 'Azure SQL', 'database'],
    keywords:          ['sql', 'database', 'table', 'stored procedure', 'azure sql', 'sqlserver', 'mssql'],
    requiredResources: ['Azure SQL Database or SQL Server'],
    defaultAuth:       'connection-string',
    setupEffortDays:   0.5,
    caveats:           ['For on-premises SQL Server, requires On-Premises Data Gateway or private endpoint'],
    alternatives: [
      { name: 'cosmosDb', displayName: 'Azure Cosmos DB', tradeOff: 'NoSQL, schema-less; better for high-scale or variable schemas' },
    ],
  },
  {
    name:              'http',
    displayName:       'HTTP (built-in)',
    type:              'built-in',
    protocols:         ['HTTP', 'HTTPS', 'REST', 'HTTP/REST', 'WCF', 'SOAP (via HTTP)'],
    keywords:          ['http', 'https', 'rest', 'api', 'endpoint', 'webhook', 'web service', 'post', 'get', 'put'],
    requiredResources: [],
    defaultAuth:       'api-key',
    setupEffortDays:   0.5,
    caveats:           ['For mutual TLS or client certificate auth, configure at Logic App level'],
    alternatives: [],
  },
  {
    name:              'eventHubs',
    displayName:       'Azure Event Hubs (built-in)',
    type:              'built-in',
    protocols:         ['Event Hubs', 'Kafka', 'AMQP', 'streaming', 'telemetry'],
    keywords:          ['event hub', 'kafka', 'streaming', 'telemetry', 'iot', 'high throughput'],
    requiredResources: ['Azure Event Hubs namespace'],
    defaultAuth:       'connection-string',
    setupEffortDays:   0.5,
    caveats:           ['No per-message dead-letter — implement application-level error routing'],
    alternatives: [
      { name: 'serviceBus', displayName: 'Azure Service Bus', tradeOff: 'Lower throughput, richer messaging semantics (sessions, dead-letter)' },
    ],
  },
  {
    name:              'cosmosDb',
    displayName:       'Azure Cosmos DB (built-in)',
    type:              'built-in',
    protocols:         ['Cosmos DB', 'CosmosDB', 'NoSQL', 'DocumentDB'],
    keywords:          ['cosmos', 'cosmosdb', 'nosql', 'document', 'json document store'],
    requiredResources: ['Azure Cosmos DB account'],
    defaultAuth:       'connection-string',
    setupEffortDays:   0.5,
    caveats:           [],
    alternatives: [
      { name: 'sql', displayName: 'SQL Server', tradeOff: 'Relational model; better for structured data with joins' },
    ],
  },
  {
    name:              'sap',
    displayName:       'SAP (built-in)',
    type:              'built-in',
    protocols:         ['SAP', 'RFC', 'BAPI', 'IDOC', 'tRFC'],
    keywords:          ['sap', 'rfc', 'bapi', 'idoc', 'r/3', 'hana', 's4'],
    requiredResources: ['SAP system', 'On-Premises Data Gateway (if SAP is on-prem)'],
    defaultAuth:       'username-password',
    setupEffortDays:   3,
    caveats:           [
      'Requires SAP NCo (SAP Connector for .NET) licensed separately',
      'On-premises SAP requires On-Premises Data Gateway or ExpressRoute/VPN',
      'Logic Apps Standard only — not available in Consumption plan',
    ],
    alternatives: [],
  },
  {
    name:              'office365',
    displayName:       'Office 365 Outlook (managed)',
    type:              'managed',
    protocols:         ['SMTP', 'email', 'Office 365', 'Exchange'],
    keywords:          ['email', 'smtp', 'mail', 'outlook', 'exchange', 'office365', 'notify', 'notification'],
    requiredResources: ['Microsoft 365 / Office 365 tenant', 'Managed API connection resource'],
    defaultAuth:       'oauth',
    setupEffortDays:   1,
    caveats:           [
      'Requires O365 OAuth consent — a service account with send-mail permission is recommended',
      'For high-volume email, consider SendGrid or communication services instead',
    ],
    alternatives: [
      { name: 'http', displayName: 'HTTP (SendGrid/MailChimp)', tradeOff: 'Requires SendGrid API key but no OAuth consent required' },
    ],
  },
];

// ─── Main Entry Points ────────────────────────────────────────────────────────

/**
 * Recommend a connector for each external system in the intent.
 */
export function recommendConnectors(
  systems: ExternalSystem[]
): ConnectorRecommendation[] {
  return systems.map(system => recommendForSystem(system));
}

/**
 * Recommend a single connector for a described system or protocol.
 */
export function recommendConnectorForProtocol(
  protocol: string,
  description?: string
): ConnectorRecommendation {
  const syntheticSystem: ExternalSystem = {
    name:            protocol,
    protocol,
    role:            'destination',
    authentication:  'unknown',
    onPremises:      false,
    requiresGateway: false,
  };

  return recommendForSystem(syntheticSystem, description);
}

// ─── Recommendation Engine ────────────────────────────────────────────────────

function recommendForSystem(
  system: ExternalSystem,
  extraContext?: string
): ConnectorRecommendation {
  const searchText = [
    system.name,
    system.protocol,
    extraContext ?? '',
  ].join(' ').toLowerCase();

  // Score each catalog entry
  const scored = CONNECTOR_CATALOG.map(entry => ({
    entry,
    score: scoreEntry(entry, searchText, system),
  }));

  scored.sort((a, b) => b.score - a.score);

  // CONNECTOR_CATALOG always has entries so scored[0] is always defined
  const best = scored[0]!.entry;

  const alternatives: AlternativeConnector[] = best.alternatives.map(a => ({
    connectorName: a.name,
    displayName:   a.displayName,
    tradeOff:      a.tradeOff,
  }));

  const reasoning = buildReasoning(best, system, searchText);

  return {
    system,
    connectorName:     best.name,
    displayName:       best.displayName,
    connectorType:     best.type,
    reasoning,
    alternatives,
    requiredResources: best.requiredResources,
    authMethod:        system.authentication !== 'unknown' ? system.authentication : best.defaultAuth,
    setupEffortDays:   best.setupEffortDays,
    caveats:           best.caveats,
  };
}

function scoreEntry(
  entry: ConnectorCatalogEntry,
  searchText: string,
  system: ExternalSystem
): number {
  let score = 0;

  // Protocol match (highest weight)
  for (const proto of entry.protocols) {
    if (searchText.includes(proto.toLowerCase())) {
      score += 10;
    }
  }

  // Keyword match
  for (const kw of entry.keywords) {
    if (searchText.includes(kw.toLowerCase())) {
      score += 3;
    }
  }

  // Built-in bonus (prefer built-in over managed)
  if (entry.type === 'built-in') score += 2;

  // Auth alignment bonus
  if (system.authentication !== 'unknown' && entry.defaultAuth === system.authentication) {
    score += 1;
  }

  return score;
}

function buildReasoning(
  entry: ConnectorCatalogEntry,
  system: ExternalSystem,
  searchText: string
): string {
  const parts: string[] = [];

  if (entry.type === 'built-in') {
    parts.push(`**${entry.displayName}** is a built-in connector, meaning it runs in-process with the Logic Apps runtime for lower latency and no managed connector overhead.`);
  } else {
    parts.push(`**${entry.displayName}** is a managed connector. It requires an API connection resource in Azure but provides richer ${system.protocol} integration.`);
  }

  const matchedProto = entry.protocols.find(p => searchText.includes(p.toLowerCase()));
  if (matchedProto) {
    parts.push(`Selected because the system uses **${matchedProto}** protocol, which this connector natively supports.`);
  }

  if (entry.requiredResources.length > 0) {
    parts.push(`Requires: ${entry.requiredResources.join(', ')}.`);
  }

  return parts.join(' ');
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Returns all available built-in connector names.
 * Used by the MCP tool to list available connectors.
 */
export function listBuiltInConnectors(): Array<{ name: string; displayName: string; protocols: string[] }> {
  return CONNECTOR_CATALOG
    .filter(e => e.type === 'built-in')
    .map(e => ({ name: e.name, displayName: e.displayName, protocols: e.protocols }));
}

/**
 * Returns all available managed connector names.
 */
export function listManagedConnectors(): Array<{ name: string; displayName: string; protocols: string[] }> {
  return CONNECTOR_CATALOG
    .filter(e => e.type === 'managed')
    .map(e => ({ name: e.name, displayName: e.displayName, protocols: e.protocols }));
}
