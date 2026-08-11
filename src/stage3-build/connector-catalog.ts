/**
 * Connector Catalog — the single canonical source of truth for connector naming.
 *
 * Before this module existed, three tables disagreed about connector names:
 *   1. intent-constructor.ts  ADAPTER_TO_CONNECTOR   (emitted 'azureblob', 'eventhub', …)
 *   2. connection-generator.ts CONNECTOR_REGISTRY     (keyed by 'blob', 'eventHubs', …)
 *   3. workflow-generator.ts  SERVICE_PROVIDER_IDS   (keyed by 'blob'/'azureBlob', missing 'azureblob')
 *
 * The mismatch had two deployment-breaking consequences:
 *   - workflow.json fell back to the WRONG-CASE '/serviceProviders/azureblob'
 *     (the real ServiceProvider id is '/serviceProviders/AzureBlob')
 *   - connections.json ended up EMPTY for intents whose connector was 'azureblob',
 *     because the registry only knew the key 'blob'
 *
 * Canonical naming rule:
 *   The intent-level connector name (what IntegrationIntent.trigger.connector and
 *   IntegrationStep.connector carry — 'azureblob', 'serviceBus', 'sftp', …) is
 *   canonical. It is used as:
 *     - the key in connections.json serviceProviderConnections / managedApiConnections
 *     - the connectionName in workflow serviceProviderConfiguration blocks
 *   This matches the golden-master fixtures (tests/fixtures/02, 03).
 *
 * Every consumer must call normalizeConnectorName() before lookups so that
 * legacy variants ('blob', 'azureBlob', 'eventHubs', 'oracleDb', …) resolve to
 * the same canonical entry.
 */

import type { TriggerType } from '../shared/integration-intent.js';

// ─── App Setting name helper (Pascal_Snake_Case convention) ──────────────────

/**
 * Builds an app setting key: [Type]_[Category]_[ServiceName]_[SettingName]
 * KVS_ prefix for sensitive values (Key Vault secrets), Common_ for plain config.
 */
export function appSettingKey(
  type: string,
  category: 'API' | 'DB' | 'KVS' | 'Workflow' | 'Storage',
  service: string,
  setting: string
): string {
  return `${type}_${category}_${service}_${setting}`;
}

const s = appSettingKey;

/** Lowercase per WDL rules — connections.json uses @appsetting('...'), never hardcoded values. */
function appsetting(key: string): string {
  return `@appsetting('${key}')`;
}

// ─── Catalog entry shape ──────────────────────────────────────────────────────

export interface ConnectorCatalogEntry {
  /** 'built-in' = ServiceProvider (preferred), 'managed' = ApiConnection */
  kind:              'built-in' | 'managed';
  /** Real Azure ServiceProvider id — case-sensitive, e.g. '/serviceProviders/AzureBlob' */
  serviceProviderId: string;
  displayName:       string;
  /** App Settings keys this connector needs (placeholders generated for each) */
  settingsKeys:      string[];
  /** Default parameterValues — sensitive values MUST use @appsetting('KVS_...') */
  parameterValues:   Record<string, string>;
  /** For managed connectors: ARM managed API resource id pattern */
  managedApiId?:     string;
  /** Default trigger operationId when this connector is used as a polling trigger */
  defaultTriggerOperation?: string;
  /** True when the connector exposes actions only (no trigger) */
  actionsOnly?:      boolean;
  /** Human note surfaced in generated docs/reports */
  notes?:            string;
}

// ─── Canonical catalog ────────────────────────────────────────────────────────

export const CONNECTOR_CATALOG: Record<string, ConnectorCatalogEntry> = {
  azureblob: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/AzureBlob',
    displayName:       'Azure Blob Storage',
    settingsKeys:      [s('KVS', 'Storage', 'Blob', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'Storage', 'Blob', 'ConnectionString')) },
    defaultTriggerOperation: 'whenABlobIsAddedOrModified',
  },
  serviceBus: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/serviceBus',
    displayName:       'Azure Service Bus',
    settingsKeys:      [s('KVS', 'DB', 'ServiceBus', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'DB', 'ServiceBus', 'ConnectionString')) },
    defaultTriggerOperation: 'receiveMessages',
  },
  sftp: {
    kind:              'managed',
    serviceProviderId: '/serviceProviders/sftpWithSsh',
    displayName:       'SFTP-SSH',
    settingsKeys:      [
      s('Common', 'API', 'Sftp', 'Host'),
      s('Common', 'API', 'Sftp', 'Username'),
      s('KVS',    'API', 'Sftp', 'Password'),
    ],
    parameterValues:   {
      hostName:   appsetting(s('Common', 'API', 'Sftp', 'Host')),
      userName:   appsetting(s('Common', 'API', 'Sftp', 'Username')),
      password:   appsetting(s('KVS',    'API', 'Sftp', 'Password')),
      rootFolder: '/',
    },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/sftpwithssh',
    defaultTriggerOperation: 'whenAFileIsAddedOrModified',
  },
  ftp: {
    kind:              'managed',
    serviceProviderId: '/serviceProviders/ftp',
    displayName:       'FTP',
    settingsKeys:      [
      s('Common', 'API', 'Ftp', 'ServerAddress'),
      s('Common', 'API', 'Ftp', 'Username'),
      s('KVS',    'API', 'Ftp', 'Password'),
    ],
    parameterValues:   {
      serverAddress: appsetting(s('Common', 'API', 'Ftp', 'ServerAddress')),
      userName:      appsetting(s('Common', 'API', 'Ftp', 'Username')),
      password:      appsetting(s('KVS',    'API', 'Ftp', 'Password')),
    },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/ftp',
    defaultTriggerOperation: 'whenAFileIsAdded',
  },
  sql: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/sql',
    displayName:       'SQL Server',
    settingsKeys:      [s('KVS', 'DB', 'Sql', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'DB', 'Sql', 'ConnectionString')) },
    defaultTriggerOperation: 'whenAnItemIsCreated',
  },
  http: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/http',
    displayName:       'HTTP',
    settingsKeys:      [],
    parameterValues:   {},
  },
  eventhub: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/eventHubs',
    displayName:       'Azure Event Hubs',
    settingsKeys:      [s('KVS', 'DB', 'EventHubs', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'DB', 'EventHubs', 'ConnectionString')) },
    defaultTriggerOperation: 'receiveEvents',
  },
  cosmosdb: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/documentdb',
    displayName:       'Azure Cosmos DB',
    settingsKeys:      [s('KVS', 'DB', 'CosmosDb', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'DB', 'CosmosDb', 'ConnectionString')) },
  },
  azurequeue: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/azurequeues',
    displayName:       'Azure Queue Storage',
    settingsKeys:      [s('KVS', 'Storage', 'AzureQueue', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'Storage', 'AzureQueue', 'ConnectionString')) },
  },
  azurefile: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/azureFile',
    displayName:       'Azure File Storage',
    settingsKeys:      [s('KVS', 'Storage', 'AzureFile', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'Storage', 'AzureFile', 'ConnectionString')) },
  },
  // FIX-05: SAP systemNumber MUST be stored and passed as a string, NOT an integer.
  // ARM template parameters for systemNumber must use "type": "string" — integer type
  // strips leading zeros (e.g., "00" becomes 0), causing silent SAP connection failure.
  // FIX-06: Do NOT generate an sncPse ARM parameter unless SNC is explicitly configured.
  sap: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/SAP',
    displayName:       'SAP',
    settingsKeys:      [
      s('Common', 'API', 'Sap', 'ApplicationServerHost'),
      s('Common', 'API', 'Sap', 'Client'),
      s('Common', 'API', 'Sap', 'SystemNumber'),
    ],
    parameterValues:   {
      applicationServerHost: appsetting(s('Common', 'API', 'Sap', 'ApplicationServerHost')),
      client:                appsetting(s('Common', 'API', 'Sap', 'Client')),
      // systemNumber resolves to a STRING value — never coerce (leading zeros: "00", "09").
      systemNumber:          appsetting(s('Common', 'API', 'Sap', 'SystemNumber')),
      logonType:             'ApplicationServer',
    },
  },
  office365: {
    kind:              'managed',
    serviceProviderId: '/serviceProviders/office365',
    displayName:       'Office 365 Outlook',
    settingsKeys:      [],
    parameterValues:   {},
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/office365',
  },
  smtp: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/smtp',
    displayName:       'SMTP',
    settingsKeys:      [
      s('Common', 'API', 'Smtp', 'ServerAddress'),
      s('Common', 'API', 'Smtp', 'Username'),
      s('KVS',    'API', 'Smtp', 'Password'),
    ],
    parameterValues:   {
      serverAddress: appsetting(s('Common', 'API', 'Smtp', 'ServerAddress')),
      userName:      appsetting(s('Common', 'API', 'Smtp', 'Username')),
      password:      appsetting(s('KVS',    'API', 'Smtp', 'Password')),
    },
  },
  sharepoint: {
    kind:              'managed',
    serviceProviderId: '/serviceProviders/sharepointonline',
    displayName:       'SharePoint Online',
    settingsKeys:      [],
    parameterValues:   {},
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/sharepointonline',
  },
  filesystem: {
    kind:              'managed',
    serviceProviderId: '/serviceProviders/filesystem',
    displayName:       'File System (on-premises data gateway)',
    settingsKeys:      [s('Common', 'API', 'FileSystem', 'RootFolder')],
    parameterValues:   { rootFolder: appsetting(s('Common', 'API', 'FileSystem', 'RootFolder')) },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/filesystem',
    notes: 'Requires the on-premises data gateway for local file shares.',
  },
  ibmmq: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/ibmMQ',
    displayName:       'IBM MQ',
    settingsKeys:      [
      s('Common', 'API', 'IbmMq', 'Hostname'),
      s('Common', 'API', 'IbmMq', 'Port'),
      s('Common', 'API', 'IbmMq', 'Channel'),
      s('Common', 'API', 'IbmMq', 'QueueManager'),
    ],
    parameterValues:   {
      serverName:   appsetting(s('Common', 'API', 'IbmMq', 'Hostname')),
      port:         appsetting(s('Common', 'API', 'IbmMq', 'Port')),
      channelName:  appsetting(s('Common', 'API', 'IbmMq', 'Channel')),
      queueManager: appsetting(s('Common', 'API', 'IbmMq', 'QueueManager')),
    },
  },
  db2: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/db2',
    displayName:       'IBM Db2',
    settingsKeys:      [s('KVS', 'DB', 'Db2', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'DB', 'Db2', 'ConnectionString')) },
  },
  azuretable: {
    kind:              'managed',
    serviceProviderId: '/serviceProviders/azureTables',
    displayName:       'Azure Table Storage',
    settingsKeys:      [s('KVS', 'Storage', 'AzureTable', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'Storage', 'AzureTable', 'ConnectionString')) },
    managedApiId: '/subscriptions/{subscriptionId}/providers/Microsoft.Web/locations/{location}/managedApis/azuretables',
  },
  mllp: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/mllp',
    displayName:       'MLLP (HL7)',
    settingsKeys:      [
      s('Common', 'API', 'Mllp', 'Host'),
      s('Common', 'API', 'Mllp', 'Port'),
    ],
    parameterValues:   {
      hostName: appsetting(s('Common', 'API', 'Mllp', 'Host')),
      port:     appsetting(s('Common', 'API', 'Mllp', 'Port')),
    },
  },
  as2: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/as2',
    displayName:       'AS2',
    settingsKeys:      [],
    parameterValues:   {},
    notes: 'Integration Account required for partner agreements and certificates.',
  },
  x12: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/x12',
    displayName:       'X12',
    settingsKeys:      [],
    parameterValues:   {},
    notes: 'Integration Account required for X12 schemas and trading partner agreements.',
  },
  edifact: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/edifact',
    displayName:       'EDIFACT',
    settingsKeys:      [],
    parameterValues:   {},
    notes: 'Integration Account required for EDIFACT schemas and trading partner agreements.',
  },
  // Oracle Database built-in ServiceProvider connector — public preview May 2026.
  // Actions only (no trigger); poll via Recurrence + query action. No on-premises
  // data gateway needed when the Logic App has network line-of-sight (VNet
  // integration / ExpressRoute) to the Oracle host.
  oracle: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/oracle',
    displayName:       'Oracle Database',
    settingsKeys:      [s('KVS', 'DB', 'Oracle', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'DB', 'Oracle', 'ConnectionString')) },
    actionsOnly:       true,
    notes: 'Built-in ServiceProvider (public preview May 2026). Actions only — use a Recurrence trigger for polling. No data gateway required with network line-of-sight.',
  },
  // RabbitMQ built-in connector — Microsoft's official hybrid answer for
  // BizTalk MessageBox-style pub/sub when Service Bus is not available on-premises.
  rabbitmq: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/rabbitmq',
    displayName:       'RabbitMQ',
    settingsKeys:      [s('KVS', 'DB', 'RabbitMq', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'DB', 'RabbitMq', 'ConnectionString')) },
    defaultTriggerOperation: 'receiveMessages',
    notes: 'Official hybrid replacement for MessageBox-style pub/sub in mixed cloud/on-premises topologies.',
  },
  jdbc: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/jdbc',
    displayName:       'JDBC',
    settingsKeys:      [s('KVS', 'DB', 'Jdbc', 'ConnectionString')],
    parameterValues:   { connectionString: appsetting(s('KVS', 'DB', 'Jdbc', 'ConnectionString')) },
    actionsOnly:       true,
    notes: 'Generic JDBC access to databases without a dedicated connector. Actions only.',
  },
  // Confluent (Apache Kafka) built-in connector — actions only.
  confluent: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/confluent',
    displayName:       'Confluent Kafka',
    settingsKeys:      [
      s('Common', 'API', 'Confluent', 'BootstrapServers'),
      s('KVS',    'API', 'Confluent', 'ApiSecret'),
    ],
    parameterValues:   {
      bootstrapServers: appsetting(s('Common', 'API', 'Confluent', 'BootstrapServers')),
      apiSecret:        appsetting(s('KVS',    'API', 'Confluent', 'ApiSecret')),
    },
    actionsOnly:       true,
    notes: 'Confluent/Apache Kafka built-in connector. Actions only (produce).',
  },
  // IBM mainframe / midrange family (built-in ServiceProvider connectors).
  ibm3270: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/ibm3270',
    displayName:       'IBM 3270',
    settingsKeys:      [
      s('Common', 'API', 'Ibm3270', 'Host'),
      s('Common', 'API', 'Ibm3270', 'Port'),
    ],
    parameterValues:   {
      hostName: appsetting(s('Common', 'API', 'Ibm3270', 'Host')),
      port:     appsetting(s('Common', 'API', 'Ibm3270', 'Port')),
    },
    actionsOnly:       true,
    notes: 'Screen-driven 3270 application integration. Requires an HIDX design artifact.',
  },
  cics: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/cics',
    displayName:       'IBM CICS',
    settingsKeys:      [
      s('Common', 'API', 'Cics', 'Host'),
      s('Common', 'API', 'Cics', 'Port'),
    ],
    parameterValues:   {
      hostName: appsetting(s('Common', 'API', 'Cics', 'Host')),
      port:     appsetting(s('Common', 'API', 'Cics', 'Port')),
    },
    actionsOnly:       true,
    notes: 'Calls CICS programs directly. Requires an HIDX design artifact.',
  },
  ims: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/ims',
    displayName:       'IBM IMS',
    settingsKeys:      [
      s('Common', 'API', 'Ims', 'Host'),
      s('Common', 'API', 'Ims', 'Port'),
    ],
    parameterValues:   {
      hostName: appsetting(s('Common', 'API', 'Ims', 'Host')),
      port:     appsetting(s('Common', 'API', 'Ims', 'Port')),
    },
    actionsOnly:       true,
    notes: 'Calls IMS transactions via IMS Connect. Requires an HIDX design artifact.',
  },
  ibmi: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/ibmi',
    displayName:       'IBM i',
    settingsKeys:      [
      s('Common', 'API', 'IbmI', 'Host'),
      s('Common', 'API', 'IbmI', 'Port'),
    ],
    parameterValues:   {
      hostName: appsetting(s('Common', 'API', 'IbmI', 'Host')),
      port:     appsetting(s('Common', 'API', 'IbmI', 'Port')),
    },
    actionsOnly:       true,
    notes: 'Calls ILE programs on IBM i (AS/400). Requires an HIDX design artifact.',
  },
  hostfile: {
    kind:              'built-in',
    serviceProviderId: '/serviceProviders/hostfile',
    displayName:       'IBM Host File',
    settingsKeys:      [
      s('Common', 'API', 'HostFile', 'Host'),
      s('Common', 'API', 'HostFile', 'Port'),
    ],
    parameterValues:   {
      hostName: appsetting(s('Common', 'API', 'HostFile', 'Host')),
      port:     appsetting(s('Common', 'API', 'HostFile', 'Port')),
    },
    actionsOnly:       true,
    notes: 'Parses/generates IBM host file (VSAM) formats. Requires an HIDX design artifact.',
  },
};

// ─── Alias normalization ──────────────────────────────────────────────────────

/**
 * Legacy / variant spellings → canonical catalog key.
 * Keys are lowercase; normalizeConnectorName() lowercases input before lookup.
 */
export const CONNECTOR_ALIASES: Record<string, string> = {
  // Azure Blob
  'blob':            'azureblob',
  'azureblob':       'azureblob',
  // Service Bus
  'servicebus':      'serviceBus',
  // SFTP / FTP
  'sftp':            'sftp',
  'sftpwithssh':     'sftp',
  'ftp':             'ftp',
  // SQL
  'sql':             'sql',
  'sqlserver':       'sql',
  // Event Hubs
  'eventhub':        'eventhub',
  'eventhubs':       'eventhub',
  // Cosmos DB
  'cosmosdb':        'cosmosdb',
  'documentdb':      'cosmosdb',
  // Oracle
  'oracle':          'oracle',
  'oracledb':        'oracle',
  // IBM MQ / Db2
  'ibmmq':           'ibmmq',
  'db2':             'db2',
  // Azure Storage
  'azuretable':      'azuretable',
  'azuretables':     'azuretable',
  'azurequeue':      'azurequeue',
  'azurequeues':     'azurequeue',
  'azurefile':       'azurefile',
  // Kafka
  'kafka':           'confluent',
  'confluent':       'confluent',
  'confluentkafka':  'confluent',
  // RabbitMQ / JDBC
  'rabbitmq':        'rabbitmq',
  'jdbc':            'jdbc',
  // IBM mainframe family
  'ibm3270':         'ibm3270',
  '3270':            'ibm3270',
  'tn3270':          'ibm3270',
  'cics':            'cics',
  'ims':             'ims',
  'ibmi':            'ibmi',
  'as400':           'ibmi',
  'hostfile':        'hostfile',
  'vsam':            'hostfile',
  // Misc
  'http':            'http',
  'smtp':            'smtp',
  'sap':             'sap',
  'office365':       'office365',
  'sharepoint':      'sharepoint',
  'filesystem':      'filesystem',
  'mllp':            'mllp',
  'as2':             'as2',
  'x12':             'x12',
  'edifact':         'edifact',
};

/**
 * Normalizes any connector spelling to its canonical catalog key.
 * Unknown names pass through unchanged (e.g. 'request', 'recurrence',
 * 'azurefunction', 'integrationAccount' — pseudo-connectors with no connection).
 */
export function normalizeConnectorName(name: string): string {
  return CONNECTOR_ALIASES[name.trim().toLowerCase()] ?? name;
}

/**
 * Resolves the case-correct ServiceProvider id for a connector name (any spelling).
 * Fixes the historic wrong-case fallback: 'azureblob' → '/serviceProviders/AzureBlob'
 * (previously fell through to '/serviceProviders/azureblob', which breaks deployment).
 * Unknown connectors fall back to '/serviceProviders/{name}' as a last resort.
 */
export function getServiceProviderId(connector: string): string {
  const canonical = normalizeConnectorName(connector);
  return CONNECTOR_CATALOG[canonical]?.serviceProviderId ?? `/serviceProviders/${canonical}`;
}

// ─── Adapter → connector mapping (single table for all consumers) ─────────────

export interface AdapterMapping {
  /** Canonical intent-level connector name */
  connector:   string;
  triggerType: TriggerType;
  onPremises?: boolean;
  /**
   * Catalog key used for connections.json generation when it differs from
   * `connector`. `null` = adapter produces no connection entry (e.g. the
   * HTTP Request trigger and Azure Functions have no connections.json entry).
   * Undefined = same as `connector`.
   */
  connectionKey?: string | null;
}

export const ADAPTER_CONNECTOR_MAP: Record<string, AdapterMapping> = {
  // File / storage
  'FILE':                { connector: 'azureblob',     triggerType: 'polling' },
  'AzureBlob':           { connector: 'azureblob',     triggerType: 'polling' },
  'AzureQueue':          { connector: 'azurequeue',    triggerType: 'polling' },
  'Azure Table Storage': { connector: 'azuretable',    triggerType: 'polling' },
  // File transfer
  'FTP':                 { connector: 'ftp',           triggerType: 'polling' },
  'FTPS':                { connector: 'ftp',           triggerType: 'polling' },
  'SFTP':                { connector: 'sftp',          triggerType: 'polling' },
  'SFTP-Custom':         { connector: 'sftp',          triggerType: 'polling' },
  // HTTP / SOAP / WCF — trigger is the Request trigger; sends use the HTTP action
  'HTTP':                { connector: 'request',       triggerType: 'webhook', connectionKey: 'http' },
  'HTTPS':               { connector: 'request',       triggerType: 'webhook', connectionKey: 'http' },
  'SOAP':                { connector: 'request',       triggerType: 'webhook', connectionKey: 'http' },
  'WCF-BasicHttp':       { connector: 'request',       triggerType: 'webhook', connectionKey: 'http' },
  'WCF-WSHttp':          { connector: 'request',       triggerType: 'webhook', connectionKey: 'http' },
  'WCF-WebHttp':         { connector: 'request',       triggerType: 'webhook', connectionKey: 'http' },
  'WCF-Custom':          { connector: 'request',       triggerType: 'webhook', connectionKey: 'http' },
  'WCF-NetTcp':          { connector: 'azurefunction', triggerType: 'webhook', connectionKey: null },
  'WCF-NetNamedPipe':    { connector: 'azurefunction', triggerType: 'webhook', connectionKey: null },
  // Messaging
  'MSMQ':                { connector: 'serviceBus',    triggerType: 'polling' },
  'WCF-NetMsmq':         { connector: 'serviceBus',    triggerType: 'polling' },
  'SB-Messaging':        { connector: 'serviceBus',    triggerType: 'polling' },
  'SBMessaging':         { connector: 'serviceBus',    triggerType: 'polling' },
  'Service Bus':         { connector: 'serviceBus',    triggerType: 'polling' },
  'MQSeries':            { connector: 'ibmmq',         triggerType: 'polling' },
  'WebSphere MQ':        { connector: 'ibmmq',         triggerType: 'polling' },
  'IBM MQ':              { connector: 'ibmmq',         triggerType: 'polling' },
  'RabbitMQ':            { connector: 'rabbitmq',      triggerType: 'polling' },
  'Rabbit MQ':           { connector: 'rabbitmq',      triggerType: 'polling' },
  'Kafka':               { connector: 'confluent',     triggerType: 'schedule' },
  'Confluent Kafka':     { connector: 'confluent',     triggerType: 'schedule' },
  'EventHubs':           { connector: 'eventhub',      triggerType: 'polling' },
  'Event Hubs':          { connector: 'eventhub',      triggerType: 'polling' },
  'Azure Event Hubs':    { connector: 'eventhub',      triggerType: 'polling' },
  // Databases
  'SQL':                 { connector: 'sql',           triggerType: 'polling', onPremises: true },
  'SQL Server':          { connector: 'sql',           triggerType: 'polling' },
  'WCF-SQL':             { connector: 'sql',           triggerType: 'polling' },
  // Oracle built-in ServiceProvider (public preview May 2026): actions only —
  // poll with a Recurrence trigger + query action. No gateway with line-of-sight.
  'Oracle':              { connector: 'oracle',        triggerType: 'schedule' },
  'OracleEBusiness':     { connector: 'oracle',        triggerType: 'schedule' },
  'DB2':                 { connector: 'db2',           triggerType: 'polling' },
  'Db2':                 { connector: 'db2',           triggerType: 'polling' },
  'JDBC':                { connector: 'jdbc',          triggerType: 'schedule' },
  // Email
  'SMTP':                { connector: 'smtp',          triggerType: 'manual' },
  'POP3':                { connector: 'office365',     triggerType: 'polling' },
  'IMAP':                { connector: 'office365',     triggerType: 'polling' },
  // ERP / legacy
  'SAP':                 { connector: 'sap',           triggerType: 'polling', onPremises: true },
  'SharePoint':          { connector: 'sharepoint',    triggerType: 'polling' },
  // IBM mainframe / midrange family (Host Integration Server adapters)
  'IBM 3270':            { connector: 'ibm3270',       triggerType: 'schedule' },
  'IBM3270':             { connector: 'ibm3270',       triggerType: 'schedule' },
  'TN3270':              { connector: 'ibm3270',       triggerType: 'schedule' },
  'CICS':                { connector: 'cics',          triggerType: 'schedule' },
  'IBMCics':             { connector: 'cics',          triggerType: 'schedule' },
  'IBM CICS':            { connector: 'cics',          triggerType: 'schedule' },
  'IMS':                 { connector: 'ims',           triggerType: 'schedule' },
  'IBMIms':              { connector: 'ims',           triggerType: 'schedule' },
  'IBM IMS':             { connector: 'ims',           triggerType: 'schedule' },
  'IBM i':               { connector: 'ibmi',          triggerType: 'schedule' },
  'IBMi':                { connector: 'ibmi',          triggerType: 'schedule' },
  'AS400':               { connector: 'ibmi',          triggerType: 'schedule' },
  'HostFile':            { connector: 'hostfile',      triggerType: 'schedule' },
  'IBMHostFile':         { connector: 'hostfile',      triggerType: 'schedule' },
  'VSAM':                { connector: 'hostfile',      triggerType: 'schedule' },
  // EDI / B2B (Integration Account required)
  'EDI':                 { connector: 'x12',           triggerType: 'polling' },
  'AS2':                 { connector: 'as2',           triggerType: 'polling' },
  'X12':                 { connector: 'x12',           triggerType: 'polling' },
  'EDIFACT':             { connector: 'edifact',       triggerType: 'polling' },
  // HL7
  'MLLP':                { connector: 'mllp',          triggerType: 'polling' },
};

// ─── On-premises detection (shared by Stage 1 and Stage 3) ────────────────────

/**
 * Adapters that always imply an on-premises system requiring the data gateway.
 * NOTE: Oracle is intentionally NOT in this list — the built-in Oracle
 * ServiceProvider connector (public preview May 2026) needs no gateway when the
 * Logic App has network line-of-sight to the database.
 */
export const ON_PREM_ADAPTERS = ['SQL', 'SAP', 'SharePoint', 'MQSeries', 'WebSphere MQ'] as const;

/** True when the adapter (or its address) points at an on-premises system. */
export function isOnPremAdapter(adapterType: string, address?: string): boolean {
  if ((ON_PREM_ADAPTERS as readonly string[]).includes(adapterType)) return true;
  // FILE adapter with a local/UNC path (not Blob) is on-prem
  if (
    adapterType === 'FILE' &&
    address &&
    (address.match(/^[A-Za-z]:\\/) || address.startsWith('\\\\') || address.startsWith('/'))
  ) {
    return true;
  }
  return false;
}

/**
 * Returns the connections.json key for an adapter, or undefined when the
 * adapter produces no connection entry.
 */
export function connectionKeyForAdapter(adapterType: string): string | undefined {
  const mapping = ADAPTER_CONNECTOR_MAP[adapterType];
  if (!mapping) return undefined;
  if (mapping.connectionKey === null) return undefined;
  const key = normalizeConnectorName(mapping.connectionKey ?? mapping.connector);
  return CONNECTOR_CATALOG[key] ? key : undefined;
}
