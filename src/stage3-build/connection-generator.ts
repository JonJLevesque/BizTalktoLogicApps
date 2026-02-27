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
 * App Settings references: @AppSetting('SETTING_NAME')
 * The corresponding appSettings entries are generated with placeholder values.
 */

import type { IntegrationIntent, ExternalSystem } from '../shared/integration-intent.js';
import type { BizTalkApplication } from '../types/biztalk.js';
import type {
  ConnectionsJson,
  ServiceProviderConnection,
  ManagedApiConnection,
} from '../types/logicapps.js';

// ─── App Setting Name Builder ─────────────────────────────────────────────────

/**
 * Builds an app setting key following the Pascal_Snake_Case naming convention:
 *   [Type]_[Category]_[ServiceName]_[SettingName]
 *
 * Categories:
 *   API      — external API endpoints or keys
 *   DB       — connection strings for databases / messaging infra
 *   KVS      — Key Vault secret references (@Microsoft.KeyVault)
 *   Workflow — global settings used across multiple actions
 *   Storage  — container names, storage accounts
 *
 * Type defaults to 'Common' (shared across processes).
 * Override with process name (e.g. 'Plum005') for dedicated settings.
 *
 * Sensitive values (connection strings, passwords, API keys) use KVS_ prefix.
 * Non-sensitive values (hosts, ports, channels) use Common_ prefix.
 */
function s(
  type: string,
  category: 'API' | 'DB' | 'KVS' | 'Workflow' | 'Storage',
  service: string,
  setting: string
): string {
  return `${type}_${category}_${service}_${setting}`;
}

// ─── Connector registry ───────────────────────────────────────────────────────

interface ConnectorDef {
  type:              'built-in' | 'managed';
  serviceProviderId: string;
  displayName:       string;
  /** App Settings key(s) this connector needs */
  settingsKeys:      string[];
  /** Default parameterValues — values use @AppSetting('...') references */
  parameterValues:   Record<string, string>;
  /** For managed connectors: ARM resource ID pattern */
  managedApiId?:     string;
}

const CONNECTOR_REGISTRY: Record<string, ConnectorDef> = {
  blob: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/AzureBlob',
    displayName:       'Azure Blob Storage',
    settingsKeys:      [s('KVS', 'Storage', 'Blob', 'ConnectionString')],
    parameterValues:   { connectionString: `@AppSetting('${s('KVS', 'Storage', 'Blob', 'ConnectionString')}')` },
  },
  serviceBus: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/serviceBus',
    displayName:       'Azure Service Bus',
    settingsKeys:      [s('KVS', 'DB', 'ServiceBus', 'ConnectionString')],
    parameterValues:   { connectionString: `@AppSetting('${s('KVS', 'DB', 'ServiceBus', 'ConnectionString')}')` },
  },
  sftp: {
    type:              'managed',
    serviceProviderId: '/serviceProviders/sftpWithSsh',
    displayName:       'SFTP-SSH',
    settingsKeys:      [
      s('Common', 'API', 'Sftp', 'Host'),
      s('Common', 'API', 'Sftp', 'Username'),
      s('KVS',    'API', 'Sftp', 'Password'),
    ],
    parameterValues:   {
      hostName:   `@AppSetting('${s('Common', 'API', 'Sftp', 'Host')}')`,
      userName:   `@AppSetting('${s('Common', 'API', 'Sftp', 'Username')}')`,
      password:   `@AppSetting('${s('KVS',    'API', 'Sftp', 'Password')}')`,
      rootFolder: '/',
    },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/sftpwithssh',
  },
  ftp: {
    type:              'managed',
    serviceProviderId: '/serviceProviders/ftp',
    displayName:       'FTP',
    settingsKeys:      [
      s('Common', 'API', 'Ftp', 'ServerAddress'),
      s('Common', 'API', 'Ftp', 'Username'),
      s('KVS',    'API', 'Ftp', 'Password'),
    ],
    parameterValues:   {
      serverAddress: `@AppSetting('${s('Common', 'API', 'Ftp', 'ServerAddress')}')`,
      userName:      `@AppSetting('${s('Common', 'API', 'Ftp', 'Username')}')`,
      password:      `@AppSetting('${s('KVS',    'API', 'Ftp', 'Password')}')`,
    },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/ftp',
  },
  sql: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/sql',
    displayName:       'SQL Server',
    settingsKeys:      [s('KVS', 'DB', 'Sql', 'ConnectionString')],
    parameterValues:   { connectionString: `@AppSetting('${s('KVS', 'DB', 'Sql', 'ConnectionString')}')` },
  },
  http: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/http',
    displayName:       'HTTP',
    settingsKeys:      [],
    parameterValues:   {},
  },
  eventHubs: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/eventHubs',
    displayName:       'Azure Event Hubs',
    settingsKeys:      [s('KVS', 'DB', 'EventHubs', 'ConnectionString')],
    parameterValues:   { connectionString: `@AppSetting('${s('KVS', 'DB', 'EventHubs', 'ConnectionString')}')` },
  },
  cosmosDb: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/documentdb',
    displayName:       'Azure Cosmos DB',
    settingsKeys:      [s('KVS', 'DB', 'CosmosDb', 'ConnectionString')],
    parameterValues:   { connectionString: `@AppSetting('${s('KVS', 'DB', 'CosmosDb', 'ConnectionString')}')` },
  },
  sap: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/SAP',
    displayName:       'SAP',
    settingsKeys:      [
      s('Common', 'API', 'Sap', 'ApplicationServerHost'),
      s('Common', 'API', 'Sap', 'Client'),
      s('Common', 'API', 'Sap', 'SystemNumber'),
    ],
    parameterValues:   {
      applicationServerHost: `@AppSetting('${s('Common', 'API', 'Sap', 'ApplicationServerHost')}')`,
      client:                `@AppSetting('${s('Common', 'API', 'Sap', 'Client')}')`,
      systemNumber:          `@AppSetting('${s('Common', 'API', 'Sap', 'SystemNumber')}')`,
      logonType:             'ApplicationServer',
    },
  },
  office365: {
    type:              'managed',
    serviceProviderId: '/serviceProviders/office365',
    displayName:       'Office 365 Outlook',
    settingsKeys:      [],
    parameterValues:   {},
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/office365',
  },
  smtp: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/smtp',
    displayName:       'SMTP',
    settingsKeys:      [
      s('Common', 'API', 'Smtp', 'ServerAddress'),
      s('Common', 'API', 'Smtp', 'Username'),
      s('KVS',    'API', 'Smtp', 'Password'),
    ],
    parameterValues:   {
      serverAddress: `@AppSetting('${s('Common', 'API', 'Smtp', 'ServerAddress')}')`,
      userName:      `@AppSetting('${s('Common', 'API', 'Smtp', 'Username')}')`,
      password:      `@AppSetting('${s('KVS',    'API', 'Smtp', 'Password')}')`,
    },
  },
  ibmMq: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/ibmMQ',
    displayName:       'IBM MQ',
    settingsKeys:      [
      s('Common', 'API', 'IbmMq', 'Hostname'),
      s('Common', 'API', 'IbmMq', 'Port'),
      s('Common', 'API', 'IbmMq', 'Channel'),
      s('Common', 'API', 'IbmMq', 'QueueManager'),
    ],
    parameterValues:   {
      serverName:   `@AppSetting('${s('Common', 'API', 'IbmMq', 'Hostname')}')`,
      port:         `@AppSetting('${s('Common', 'API', 'IbmMq', 'Port')}')`,
      channelName:  `@AppSetting('${s('Common', 'API', 'IbmMq', 'Channel')}')`,
      queueManager: `@AppSetting('${s('Common', 'API', 'IbmMq', 'QueueManager')}')`,
    },
  },
  db2: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/db2',
    displayName:       'IBM Db2',
    settingsKeys:      [s('KVS', 'DB', 'Db2', 'ConnectionString')],
    parameterValues:   { connectionString: `@AppSetting('${s('KVS', 'DB', 'Db2', 'ConnectionString')}')` },
  },
  azureTable: {
    type:              'managed',
    serviceProviderId: '/serviceProviders/azureTables',
    displayName:       'Azure Table Storage',
    settingsKeys:      [s('KVS', 'Storage', 'AzureTable', 'ConnectionString')],
    parameterValues:   { connectionString: `@AppSetting('${s('KVS', 'Storage', 'AzureTable', 'ConnectionString')}')` },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/azuretables',
  },
  mllp: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/mllp',
    displayName:       'MLLP (HL7)',
    settingsKeys:      [
      s('Common', 'API', 'Mllp', 'Host'),
      s('Common', 'API', 'Mllp', 'Port'),
    ],
    parameterValues:   {
      hostName: `@AppSetting('${s('Common', 'API', 'Mllp', 'Host')}')`,
      port:     `@AppSetting('${s('Common', 'API', 'Mllp', 'Port')}')`,
    },
  },
  as2: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/as2',
    displayName:       'AS2',
    settingsKeys:      [],
    parameterValues:   {},
  },
  x12: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/x12',
    displayName:       'X12',
    settingsKeys:      [],
    parameterValues:   {},
  },
  edifact: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/edifact',
    displayName:       'EDIFACT',
    settingsKeys:      [],
    parameterValues:   {},
  },
  oracleDb: {
    type:              'managed',
    serviceProviderId: '/serviceProviders/oracle',
    displayName:       'Oracle Database',
    settingsKeys:      [s('KVS', 'DB', 'Oracle', 'ConnectionString')],
    parameterValues:   { connectionString: `@AppSetting('${s('KVS', 'DB', 'Oracle', 'ConnectionString')}')` },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/oracle',
  },
};

// ─── Adapter → connector name mapping ────────────────────────────────────────

const ADAPTER_TO_CONNECTOR: Record<string, string> = {
  // File / storage
  FILE:                    'blob',
  // Messaging — including SB-Messaging variant used by binding analyzer
  MSMQ:                    'serviceBus',
  'WCF-NetMsmq':           'serviceBus',
  'SB-Messaging':          'serviceBus',   // BizTalk binding adapterType
  'SBMessaging':           'serviceBus',   // alternate casing
  'Service Bus':           'serviceBus',
  MQSeries:                'ibmMq',
  'WebSphere MQ':          'ibmMq',
  'IBM MQ':                'ibmMq',
  // File transfer
  FTP:                     'ftp',
  FTPS:                    'ftp',
  SFTP:                    'sftp',
  // HTTP / WCF
  HTTP:                    'http',
  HTTPS:                   'http',
  SOAP:                    'http',         // SOAP receive/send uses HTTP connector
  'WCF-BasicHttp':         'http',
  'WCF-WSHttp':            'http',
  'WCF-WebHttp':           'http',
  'WCF-Custom':            'http',         // parsed as custom; often wraps HTTP or SQL
  // Databases
  SQL:                     'sql',
  'SQL Server':            'sql',
  'WCF-SQL':               'sql',          // WCF-SQL adapter = SQL ServiceProvider
  Oracle:                  'oracleDb',
  OracleEBusiness:         'oracleDb',
  DB2:                     'db2',
  Db2:                     'db2',
  // Email
  SMTP:                    'smtp',
  POP3:                    'office365',
  IMAP:                    'office365',
  // ERP / legacy
  SAP:                     'sap',
  // Azure native
  EventHubs:               'eventHubs',
  'Event Hubs':            'eventHubs',
  'Azure Event Hubs':      'eventHubs',
  // EDI / B2B (Integration Account required)
  AS2:                     'as2',
  X12:                     'x12',
  EDIFACT:                 'edifact',
  // HL7
  MLLP:                    'mllp',
  // Azure tables
  'Azure Table Storage':   'azureTable',
};

// ─── Protocol → connector name mapping ───────────────────────────────────────

const PROTOCOL_TO_CONNECTOR: Record<string, string> = {
  'Service Bus':   'serviceBus',
  'SFTP':          'sftp',
  'FTP':           'ftp',
  'HTTP/REST':     'http',
  'SMTP':          'smtp',
  'Azure Blob':    'blob',
  'SQL Server':    'sql',
  'Cosmos DB':     'cosmosDb',
  'Event Hubs':    'eventHubs',
  'SAP':           'sap',
  'IBM MQ':        'ibmMq',
  'IBM Db2':       'db2',
  'Oracle DB':     'oracleDb',
  'MLLP':          'mllp',
  'AS2':           'as2',
  'X12':           'x12',
  'EDIFACT':       'edifact',
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

    if (def.type === 'built-in') {
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
      serviceProviderConnections: svcProviderConns,
      managedApiConnections:      managedApiConns,
    },
    appSettings,
  };
}

// ─── Connector Collection ─────────────────────────────────────────────────────

function collectConnectorsFromIntent(intent: IntegrationIntent): Set<string> {
  const names = new Set<string>();

  // Trigger connector
  const triggerConnector = intent.trigger.connector;
  if (triggerConnector && CONNECTOR_REGISTRY[triggerConnector]) {
    names.add(triggerConnector);
  }

  // Step connectors
  for (const step of intent.steps) {
    if (step.connector && CONNECTOR_REGISTRY[step.connector]) {
      names.add(step.connector);
    }
  }

  // External systems
  for (const sys of intent.systems) {
    const connName = PROTOCOL_TO_CONNECTOR[sys.protocol];
    if (connName) names.add(connName);
  }

  return names;
}

function collectConnectorsFromApp(app: BizTalkApplication): Set<string> {
  const names = new Set<string>();

  for (const binding of app.bindingFiles) {
    for (const rl of binding.receiveLocations) {
      const connName = ADAPTER_TO_CONNECTOR[rl.adapterType];
      if (connName) names.add(connName);
    }
    for (const sp of binding.sendPorts) {
      const connName = ADAPTER_TO_CONNECTOR[sp.adapterType];
      if (connName) names.add(connName);
    }
  }

  return names;
}
