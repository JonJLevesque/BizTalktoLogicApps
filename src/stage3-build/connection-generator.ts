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
    settingsKeys:      ['BLOB_STORAGE_CONNECTION_STRING'],
    parameterValues:   { connectionString: "@AppSetting('BLOB_STORAGE_CONNECTION_STRING')" },
  },
  serviceBus: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/serviceBus',
    displayName:       'Azure Service Bus',
    settingsKeys:      ['SERVICE_BUS_CONNECTION_STRING'],
    parameterValues:   { connectionString: "@AppSetting('SERVICE_BUS_CONNECTION_STRING')" },
  },
  sftp: {
    type:              'managed',
    serviceProviderId: '/serviceProviders/sftpWithSsh',
    displayName:       'SFTP-SSH',
    settingsKeys:      ['SFTP_HOST', 'SFTP_USERNAME', 'SFTP_PASSWORD'],
    parameterValues:   {
      hostName:     "@AppSetting('SFTP_HOST')",
      userName:     "@AppSetting('SFTP_USERNAME')",
      password:     "@AppSetting('SFTP_PASSWORD')",
      rootFolder:   '/',
    },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/sftpwithssh',
  },
  ftp: {
    type:              'managed',
    serviceProviderId: '/serviceProviders/ftp',
    displayName:       'FTP',
    settingsKeys:      ['FTP_SERVER_ADDRESS', 'FTP_USERNAME', 'FTP_PASSWORD'],
    parameterValues:   {
      serverAddress: "@AppSetting('FTP_SERVER_ADDRESS')",
      userName:      "@AppSetting('FTP_USERNAME')",
      password:      "@AppSetting('FTP_PASSWORD')",
    },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/ftp',
  },
  sql: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/sql',
    displayName:       'SQL Server',
    settingsKeys:      ['SQL_CONNECTION_STRING'],
    parameterValues:   { connectionString: "@AppSetting('SQL_CONNECTION_STRING')" },
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
    settingsKeys:      ['EVENT_HUBS_CONNECTION_STRING'],
    parameterValues:   { connectionString: "@AppSetting('EVENT_HUBS_CONNECTION_STRING')" },
  },
  cosmosDb: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/documentdb',
    displayName:       'Azure Cosmos DB',
    settingsKeys:      ['COSMOS_DB_CONNECTION_STRING'],
    parameterValues:   { connectionString: "@AppSetting('COSMOS_DB_CONNECTION_STRING')" },
  },
  sap: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/SAP',
    displayName:       'SAP',
    settingsKeys:      ['SAP_APPLICATION_SERVER_HOST', 'SAP_CLIENT', 'SAP_SYSTEM_NUMBER'],
    parameterValues:   {
      applicationServerHost:   "@AppSetting('SAP_APPLICATION_SERVER_HOST')",
      client:                  "@AppSetting('SAP_CLIENT')",
      systemNumber:            "@AppSetting('SAP_SYSTEM_NUMBER')",
      logonType:               'ApplicationServer',
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
    settingsKeys:      ['SMTP_SERVER_ADDRESS', 'SMTP_USERNAME', 'SMTP_PASSWORD'],
    parameterValues:   {
      serverAddress: "@AppSetting('SMTP_SERVER_ADDRESS')",
      userName:      "@AppSetting('SMTP_USERNAME')",
      password:      "@AppSetting('SMTP_PASSWORD')",
    },
  },
  ibmMq: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/ibmMQ',
    displayName:       'IBM MQ',
    settingsKeys:      ['IBM_MQ_HOSTNAME', 'IBM_MQ_PORT', 'IBM_MQ_CHANNEL', 'IBM_MQ_QUEUEMANAGER'],
    parameterValues:   {
      serverName:   "@AppSetting('IBM_MQ_HOSTNAME')",
      port:         "@AppSetting('IBM_MQ_PORT')",
      channelName:  "@AppSetting('IBM_MQ_CHANNEL')",
      queueManager: "@AppSetting('IBM_MQ_QUEUEMANAGER')",
    },
  },
  db2: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/db2',
    displayName:       'IBM Db2',
    settingsKeys:      ['DB2_CONNECTION_STRING'],
    parameterValues:   { connectionString: "@AppSetting('DB2_CONNECTION_STRING')" },
  },
  azureTable: {
    type:              'managed',
    serviceProviderId: '/serviceProviders/azureTables',
    displayName:       'Azure Table Storage',
    settingsKeys:      ['AZURE_TABLE_CONNECTION_STRING'],
    parameterValues:   { connectionString: "@AppSetting('AZURE_TABLE_CONNECTION_STRING')" },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/azuretables',
  },
  mllp: {
    type:              'built-in',
    serviceProviderId: '/serviceProviders/mllp',
    displayName:       'MLLP (HL7)',
    settingsKeys:      ['MLLP_HOST', 'MLLP_PORT'],
    parameterValues:   {
      hostName: "@AppSetting('MLLP_HOST')",
      port:     "@AppSetting('MLLP_PORT')",
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
    settingsKeys:      ['ORACLE_CONNECTION_STRING'],
    parameterValues:   { connectionString: "@AppSetting('ORACLE_CONNECTION_STRING')" },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/oracle',
  },
};

// ─── Adapter → connector name mapping ────────────────────────────────────────

const ADAPTER_TO_CONNECTOR: Record<string, string> = {
  // File / storage
  FILE:                    'blob',
  // Messaging
  MSMQ:                    'serviceBus',
  'WCF-NetMsmq':           'serviceBus',
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
  'WCF-BasicHttp':         'http',
  'WCF-WSHttp':            'http',
  'WCF-WebHttp':           'http',
  // Databases
  SQL:                     'sql',
  'SQL Server':            'sql',
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
