/**
 * Connection Generator — Stage 3 (Build)
 *
 * Generates the connections.json file for a Logic Apps Standard project.
 *
 * Logic Apps Standard supports two connection types:
 *   - serviceProviderConnections: built-in connectors (preferred for BizTalk migration)
 *   - managedApiConnections: managed (shared) connectors from the Azure API catalog
 *
 * Built-in connectors run in-process with the Logic Apps runtime, offer lower
 * latency, and do NOT require managed connector resources. These are always
 * preferred over managed connectors when available.
 *
 * The generator uses:
 *   1. ExternalSystem[] from IntegrationIntent.systems (for system-level connections)
 *   2. BizTalkApplication.bindingFiles (for adapter-specific connection parameters)
 *
 * Sensitive values (connection strings, passwords, SAS keys) are replaced with
 * App Settings references: @appsetting('SETTING_NAME')
 * The corresponding appSettings entries are generated with placeholder values.
 *
 * Connector naming: all definitions live in the canonical connector catalog
 * (connector-catalog.ts). connections.json keys are canonical connector names
 * (e.g. 'azureblob', 'serviceBus') — the same names the workflow generator
 * emits as connectionName, so the two always match (WDL Rule 7).
 */

import type { IntegrationIntent, ExternalSystem } from '../shared/integration-intent.js';
import type { BizTalkApplication } from '../types/biztalk.js';
import type {
  ConnectionsJson,
  ServiceProviderConnection,
  ManagedApiConnection,
} from '../types/logicapps.js';
import {
  CONNECTOR_CATALOG,
  normalizeConnectorName,
  connectionKeyForAdapter,
} from './connector-catalog.js';
import type { ConnectorCatalogEntry } from './connector-catalog.js';

// ─── Connector registry (derived from the canonical catalog) ─────────────────

/**
 * The registry IS the canonical connector catalog. Keys are canonical
 * connector names ('azureblob', 'serviceBus', …) — the same names used as
 * connectionName in generated workflows, so connections.json keys always
 * match workflow references (WDL Rule 7).
 */
const CONNECTOR_REGISTRY: Record<string, ConnectorCatalogEntry> = CONNECTOR_CATALOG;

// ─── Protocol → connector name mapping ───────────────────────────────────────

const PROTOCOL_TO_CONNECTOR: Record<string, string> = {
  'Service Bus':    'serviceBus',
  'SFTP':           'sftp',
  'FTP':            'ftp',
  'HTTP/REST':      'http',
  'SMTP':           'smtp',
  'Azure Blob':     'azureblob',
  'SQL Server':     'sql',
  'Cosmos DB':      'cosmosdb',
  'Event Hubs':     'eventhub',
  'SAP':            'sap',
  'IBM MQ':         'ibmmq',
  'IBM Db2':        'db2',
  'Oracle DB':      'oracle',
  'MLLP':           'mllp',
  'AS2':            'as2',
  'X12':            'x12',
  'EDIFACT':        'edifact',
  'RabbitMQ':       'rabbitmq',
  'JDBC':           'jdbc',
  'Kafka':          'confluent',
  'Confluent Kafka':'confluent',
  'IBM 3270':       'ibm3270',
  'IBM CICS':       'cics',
  'IBM IMS':        'ims',
  'IBM i':          'ibmi',
  'IBM Host File':  'hostfile',
};

// ─── Main Entry Points ────────────────────────────────────────────────────────

export interface ConnectionGeneratorResult {
  connections: ConnectionsJson;
  /** App Settings keys and placeholder values to add to local.settings.json */
  appSettings: Record<string, string>;
}

/**
 * Generates connections.json from an IntegrationIntent.
 * Used by the Greenfield NLP path where intent is the only input.
 */
export function generateConnectionsFromIntent(
  intent: IntegrationIntent
): ConnectionGeneratorResult {
  const connectorNames = collectConnectorsFromIntent(intent);
  return buildConnections(connectorNames);
}

/**
 * Generates connections.json from a BizTalk application's adapter configuration.
 * Used by the Migration path where adapter types are known from binding files.
 */
export function generateConnectionsFromApp(
  app: BizTalkApplication
): ConnectionGeneratorResult {
  const connectorNames = collectConnectorsFromApp(app);
  return buildConnections(connectorNames);
}

// ─── Connection Builder ───────────────────────────────────────────────────────

function buildConnections(connectorNames: Set<string>): ConnectionGeneratorResult {
  const svcProviderConns: Record<string, ServiceProviderConnection> = {};
  const managedApiConns:  Record<string, ManagedApiConnection>     = {};
  const appSettings:      Record<string, string>                   = {};

  for (const name of connectorNames) {
    const def = CONNECTOR_REGISTRY[name];
    if (!def) continue;

    // Collect App Settings
    for (const key of def.settingsKeys) {
      appSettings[key] = `<PLACEHOLDER — set in Azure App Settings or local.settings.json>`;
    }

    if (def.kind === 'built-in') {
      svcProviderConns[name] = {
        parameterValues:  def.parameterValues,
        serviceProvider:  { id: def.serviceProviderId },
        displayName:      def.displayName,
      };
    } else {
      // Managed connector — use placeholder subscription/location/resource group
      const managedApiId =
        def.managedApiId ??
        `/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/${name}`;
      // Connection resource lives under a resource group (different path from the managed API)
      const connectionId =
        `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Web/connections/${name}`;

      managedApiConns[name] = {
        api:          { id: managedApiId },
        connection:   { id: connectionId },
        displayName:  def.displayName,
        parameterValues: def.parameterValues,
      };
    }
  }

  return {
    connections: {
      ...(Object.keys(svcProviderConns).length > 0 ? { serviceProviderConnections: svcProviderConns } : {}),
      managedApiConnections: managedApiConns,
    },
    appSettings,
  };
}

// ─── Connector Collection ─────────────────────────────────────────────────────

function collectConnectorsFromIntent(intent: IntegrationIntent): Set<string> {
  const names = new Set<string>();

  const addIfKnown = (raw: string | undefined): void => {
    if (!raw) return;
    // Normalize legacy variants ('blob', 'azureBlob', 'eventHubs', …) to the
    // canonical catalog key so connections are never silently dropped.
    const canonical = normalizeConnectorName(raw);
    if (CONNECTOR_REGISTRY[canonical]) names.add(canonical);
  };

  // Trigger connector
  addIfKnown(intent.trigger.connector);

  // Step connectors
  for (const step of intent.steps) {
    addIfKnown(step.connector);
  }

  // External systems
  for (const sys of intent.systems) {
    addIfKnown(PROTOCOL_TO_CONNECTOR[sys.protocol]);
  }

  return names;
}

// ─── Service Bus Entity Name Helper ──────────────────────────────────────────

/**
 * FIX-12: Azure silently lowercases Service Bus queue and topic names.
 * BizTalk port names may contain uppercase letters, causing a drift between
 * the generated name and the deployed Azure name.
 *
 * Rules:
 *  - Lowercase the full name
 *  - Max 260 chars for queues/topics; max 50 chars for subscriptions
 *  - Replace characters not valid in SB entity names with hyphens
 */
export function sanitizeServiceBusEntityName(
  name: string,
  entityType: 'queue' | 'topic' | 'subscription' = 'queue'
): string {
  const maxLen = entityType === 'subscription' ? 50 : 260;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_.~/]/g, '-')   // only valid SB entity name chars
    .replace(/-{2,}/g, '-')              // collapse consecutive hyphens
    .replace(/^-+|-+$/g, '')            // trim leading/trailing hyphens
    .slice(0, maxLen)
    || 'messages';
}

function collectConnectorsFromApp(app: BizTalkApplication): Set<string> {
  const names = new Set<string>();

  for (const binding of app.bindingFiles) {
    for (const rl of binding.receiveLocations) {
      const connName = connectionKeyForAdapter(rl.adapterType);
      if (connName) names.add(connName);
    }
    for (const sp of binding.sendPorts) {
      const connName = connectionKeyForAdapter(sp.adapterType);
      if (connName) names.add(connName);
    }
  }

  return names;
}
