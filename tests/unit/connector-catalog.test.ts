/**
 * Unit tests for the canonical connector catalog (WS6 — mappings audit).
 *
 * Covers:
 *  - Alias normalization (legacy 'blob'/'azureBlob'/'eventHubs'/… spellings)
 *  - The wrong-case '/serviceProviders/azureblob' fallback fix
 *  - Cross-consumer agreement: workflow connectionName === connections.json key
 *  - buildPackageFromIntent emitting real serviceProviderConnections
 *  - New connectors: Oracle (built-in), RabbitMQ, JDBC, Confluent Kafka, IBM family
 *  - SBMP retirement gap rule (dated: 30 September 2026, KB5091375)
 *  - Corrected Integration Account logic (maps do NOT require an IA)
 *  - Updated BRE gap text (RETE runtime, XML/.NET Framework facts only)
 */

import {
  CONNECTOR_CATALOG,
  CONNECTOR_ALIASES,
  normalizeConnectorName,
  getServiceProviderId,
  ADAPTER_CONNECTOR_MAP,
  connectionKeyForAdapter,
  isOnPremAdapter,
} from '../../src/stage3-build/connector-catalog.js';
import {
  generateConnectionsFromIntent,
  generateConnectionsFromApp,
} from '../../src/stage3-build/connection-generator.js';
import { generateWorkflow } from '../../src/stage3-build/workflow-generator.js';
import { buildPackageFromIntent } from '../../src/stage3-build/package-builder.js';
import { analyzeGaps } from '../../src/stage2-document/gap-analyzer.js';
import { constructIntent } from '../../src/stage1-understand/intent-constructor.js';
import { createIntegrationIntent } from '../../src/shared/integration-intent.js';
import type { IntegrationIntent } from '../../src/shared/integration-intent.js';
import type {
  BizTalkApplication,
  ParsedBindingFile,
  ParsedMap,
  ParsedOrchestration,
} from '../../src/types/biztalk.js';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeApp(overrides: Partial<BizTalkApplication> = {}): BizTalkApplication {
  return {
    name:                    'TestApp',
    biztalkVersion:          'unknown',
    orchestrations:          [],
    maps:                    [],
    pipelines:               [],
    schemas:                 [],
    bindingFiles:            [],
    complexityScore:         0,
    complexityClassification: 'simple',
    ...overrides,
  };
}

function makeBinding(
  receive: Array<{ adapterType: string; name?: string; address?: string }>,
  send: Array<{ adapterType: string; name?: string; address?: string }> = []
): ParsedBindingFile {
  return {
    applicationName: 'TestApp',
    filePath:        'BindingInfo.xml',
    receiveLocations: receive.map((r, i) => ({
      name:              r.name ?? `RL_${r.adapterType}_${i}`,
      receivePortName:   `RP_${i}`,
      adapterType:       r.adapterType,
      address:           r.address ?? 'https://example.test/in',
      pipelineName:      'Microsoft.BizTalk.DefaultPipelines.XMLReceive',
      adapterProperties: {},
      isEnabled:         true,
    })),
    sendPorts: send.map((sp, i) => ({
      name:              sp.name ?? `SP_${sp.adapterType}_${i}`,
      adapterType:       sp.adapterType,
      address:           sp.address ?? 'https://example.test/out',
      pipelineName:      'Microsoft.BizTalk.DefaultPipelines.XMLTransmit',
      adapterProperties: {},
      isDynamic:         false,
      isTwoWay:          false,
    })),
  };
}

function makeMap(name = 'OrderMap'): ParsedMap {
  return {
    name,
    className:             `Maps.${name}`,
    filePath:              `${name}.btm`,
    sourceSchemaRef:       'Schemas.Order',
    destinationSchemaRef:  'Schemas.ProcessedOrder',
    functoids:             [],
    links:                 [],
    linkCount:             0,
    hasScriptingFunctoids: false,
    hasLooping:            false,
    hasDatabaseFunctoids:  false,
    functoidCategories:    [],
  };
}

function makeOrch(overrides: Partial<ParsedOrchestration> = {}): ParsedOrchestration {
  return {
    name: 'Orch1', namespace: 'Test', filePath: '',
    shapes: [], ports: [], correlationSets: [], messages: [], variables: [],
    hasAtomicTransactions: false,
    hasLongRunningTransactions: false,
    hasCompensation: false,
    hasBRECalls: false,
    hasSuspend: false,
    activatingReceiveCount: 0,
    ...overrides,
  };
}

function makeIntent(connector: string): IntegrationIntent {
  return createIntegrationIntent('biztalk-migration', {
    trigger: {
      type:      'polling',
      source:    `FILE — test`,
      connector,
      config:    {},
    },
  });
}

// ─── Alias normalization ──────────────────────────────────────────────────────

describe('normalizeConnectorName', () => {
  it('maps every legacy blob spelling to azureblob', () => {
    expect(normalizeConnectorName('blob')).toBe('azureblob');
    expect(normalizeConnectorName('azureBlob')).toBe('azureblob');
    expect(normalizeConnectorName('AzureBlob')).toBe('azureblob');
    expect(normalizeConnectorName('azureblob')).toBe('azureblob');
  });

  it('maps legacy registry keys to canonical names', () => {
    expect(normalizeConnectorName('eventHubs')).toBe('eventhub');
    expect(normalizeConnectorName('servicebus')).toBe('serviceBus');
    expect(normalizeConnectorName('serviceBus')).toBe('serviceBus');
    expect(normalizeConnectorName('oracleDb')).toBe('oracle');
    expect(normalizeConnectorName('sqlServer')).toBe('sql');
    expect(normalizeConnectorName('cosmosDb')).toBe('cosmosdb');
    expect(normalizeConnectorName('ibmMq')).toBe('ibmmq');
    expect(normalizeConnectorName('azureTables')).toBe('azuretable');
  });

  it('maps kafka variants to confluent', () => {
    expect(normalizeConnectorName('kafka')).toBe('confluent');
    expect(normalizeConnectorName('ConfluentKafka')).toBe('confluent');
  });

  it('passes pseudo-connectors through unchanged', () => {
    expect(normalizeConnectorName('request')).toBe('request');
    expect(normalizeConnectorName('recurrence')).toBe('recurrence');
    expect(normalizeConnectorName('azurefunction')).toBe('azurefunction');
  });

  it('every alias target is a real catalog entry', () => {
    for (const [alias, canonical] of Object.entries(CONNECTOR_ALIASES)) {
      expect(CONNECTOR_CATALOG[canonical], `alias '${alias}' → '${canonical}'`).toBeDefined();
    }
  });
});

// ─── ServiceProvider id resolution (the wrong-case bug) ───────────────────────

describe('getServiceProviderId', () => {
  it("fixes the wrong-case fallback: 'azureblob' → '/serviceProviders/AzureBlob'", () => {
    expect(getServiceProviderId('azureblob')).toBe('/serviceProviders/AzureBlob');
  });

  it('resolves the same id for every blob spelling', () => {
    for (const spelling of ['blob', 'azureBlob', 'AzureBlob', 'azureblob']) {
      expect(getServiceProviderId(spelling)).toBe('/serviceProviders/AzureBlob');
    }
  });

  it('resolves known connectors case-correctly', () => {
    expect(getServiceProviderId('serviceBus')).toBe('/serviceProviders/serviceBus');
    expect(getServiceProviderId('eventhub')).toBe('/serviceProviders/eventHubs');
    expect(getServiceProviderId('eventHubs')).toBe('/serviceProviders/eventHubs');
    expect(getServiceProviderId('sap')).toBe('/serviceProviders/SAP');
    expect(getServiceProviderId('cosmosdb')).toBe('/serviceProviders/documentdb');
  });

  it('falls back to /serviceProviders/{name} only for unknown connectors', () => {
    expect(getServiceProviderId('someUnknownThing')).toBe('/serviceProviders/someUnknownThing');
  });

  it('every catalog entry has a well-formed serviceProviderId', () => {
    for (const [name, def] of Object.entries(CONNECTOR_CATALOG)) {
      expect(def.serviceProviderId.startsWith('/serviceProviders/'), name).toBe(true);
    }
  });
});

// ─── Catalog invariants (WDL rules) ───────────────────────────────────────────

describe('CONNECTOR_CATALOG invariants', () => {
  it('never hardcodes sensitive values — all references use lowercase @appsetting()', () => {
    for (const [name, def] of Object.entries(CONNECTOR_CATALOG)) {
      for (const [param, value] of Object.entries(def.parameterValues)) {
        if (value.includes('appsetting') || value.includes('AppSetting')) {
          expect(value.startsWith("@appsetting('"), `${name}.${param}: ${value}`).toBe(true);
        }
      }
    }
  });

  it('sensitive settings keys use the KVS_ prefix', () => {
    for (const [name, def] of Object.entries(CONNECTOR_CATALOG)) {
      for (const key of def.settingsKeys) {
        if (/connectionstring|password|secret|apikey/i.test(key)) {
          expect(key.startsWith('KVS_'), `${name}: ${key}`).toBe(true);
        }
      }
    }
  });

  it('managed connectors carry a managedApiId', () => {
    for (const [name, def] of Object.entries(CONNECTOR_CATALOG)) {
      if (def.kind === 'managed') {
        expect(def.managedApiId, name).toBeDefined();
      }
    }
  });
});

// ─── New connector entries ────────────────────────────────────────────────────

describe('new connector mappings', () => {
  it('Oracle is a built-in ServiceProvider connector (public preview May 2026)', () => {
    const oracle = CONNECTOR_CATALOG['oracle']!;
    expect(oracle.kind).toBe('built-in');
    expect(oracle.serviceProviderId).toBe('/serviceProviders/oracle');
    expect(oracle.actionsOnly).toBe(true);
  });

  it('Oracle adapter no longer forces the on-premises data gateway', () => {
    expect(isOnPremAdapter('Oracle')).toBe(false);
    expect(ADAPTER_CONNECTOR_MAP['Oracle']!.connector).toBe('oracle');
    // Actions only — polling happens via a Recurrence trigger
    expect(ADAPTER_CONNECTOR_MAP['Oracle']!.triggerType).toBe('schedule');
  });

  it('RabbitMQ is present as the official hybrid MessageBox answer', () => {
    expect(CONNECTOR_CATALOG['rabbitmq']!.kind).toBe('built-in');
    expect(ADAPTER_CONNECTOR_MAP['RabbitMQ']!.connector).toBe('rabbitmq');
  });

  it('JDBC and Confluent Kafka are present', () => {
    expect(CONNECTOR_CATALOG['jdbc']).toBeDefined();
    expect(CONNECTOR_CATALOG['confluent']).toBeDefined();
    expect(ADAPTER_CONNECTOR_MAP['JDBC']!.connector).toBe('jdbc');
    expect(ADAPTER_CONNECTOR_MAP['Kafka']!.connector).toBe('confluent');
    expect(ADAPTER_CONNECTOR_MAP['Confluent Kafka']!.connector).toBe('confluent');
  });

  it('IBM mainframe family (3270 / CICS / IMS / IBM i / Host File) is mapped', () => {
    expect(ADAPTER_CONNECTOR_MAP['IBM 3270']!.connector).toBe('ibm3270');
    expect(ADAPTER_CONNECTOR_MAP['CICS']!.connector).toBe('cics');
    expect(ADAPTER_CONNECTOR_MAP['IMS']!.connector).toBe('ims');
    expect(ADAPTER_CONNECTOR_MAP['IBM i']!.connector).toBe('ibmi');
    expect(ADAPTER_CONNECTOR_MAP['AS400']!.connector).toBe('ibmi');
    expect(ADAPTER_CONNECTOR_MAP['HostFile']!.connector).toBe('hostfile');
    expect(ADAPTER_CONNECTOR_MAP['VSAM']!.connector).toBe('hostfile');
    for (const name of ['ibm3270', 'cics', 'ims', 'ibmi', 'hostfile']) {
      expect(CONNECTOR_CATALOG[name]!.kind, name).toBe('built-in');
    }
  });

  it('legacy on-prem rules are preserved (SQL, SAP, local FILE paths)', () => {
    expect(isOnPremAdapter('SQL')).toBe(true);
    expect(isOnPremAdapter('SAP')).toBe(true);
    expect(isOnPremAdapter('FILE', 'C:\\Input\\Orders')).toBe(true);
    expect(isOnPremAdapter('FILE', '\\\\server\\share')).toBe(true);
    expect(isOnPremAdapter('FILE', 'https://storage.blob.core.windows.net/in')).toBe(false);
  });
});

// ─── Adapter → connection key resolution ─────────────────────────────────────

describe('connectionKeyForAdapter', () => {
  it('every adapter resolves to a catalog entry or is intentionally connection-less', () => {
    for (const [adapter, mapping] of Object.entries(ADAPTER_CONNECTOR_MAP)) {
      const key = connectionKeyForAdapter(adapter);
      if (mapping.connectionKey === null) {
        expect(key, adapter).toBeUndefined();
      } else {
        expect(key, adapter).toBeDefined();
        expect(CONNECTOR_CATALOG[key!], `${adapter} → ${key}`).toBeDefined();
      }
    }
  });

  it('HTTP-family adapters map to the http connection while triggering via request', () => {
    expect(ADAPTER_CONNECTOR_MAP['HTTP']!.connector).toBe('request');
    expect(connectionKeyForAdapter('HTTP')).toBe('http');
    expect(connectionKeyForAdapter('WCF-BasicHttp')).toBe('http');
  });

  it('Azure Functions adapters produce no connection entry', () => {
    expect(connectionKeyForAdapter('WCF-NetTcp')).toBeUndefined();
    expect(connectionKeyForAdapter('WCF-NetNamedPipe')).toBeUndefined();
  });
});

// ─── Cross-consumer agreement (the reconciliation itself) ─────────────────────

describe('workflow ↔ connections agreement', () => {
  it("intent connector 'azureblob' produces matching connectionName and connections key", () => {
    const intent = makeIntent('azureblob');

    const wf = generateWorkflow(intent, { wrapInScope: false });
    const trigger = Object.values(wf.definition.triggers)[0] as {
      inputs?: { serviceProviderConfiguration?: { connectionName?: string; serviceProviderId?: string } };
    };
    const spc = trigger.inputs?.serviceProviderConfiguration;
    expect(spc?.connectionName).toBe('azureblob');
    expect(spc?.serviceProviderId).toBe('/serviceProviders/AzureBlob');

    const { connections } = generateConnectionsFromIntent(intent);
    expect(connections.serviceProviderConnections).toBeDefined();
    expect(Object.keys(connections.serviceProviderConnections!)).toContain('azureblob');
    expect(connections.serviceProviderConnections!['azureblob']!.serviceProvider.id)
      .toBe('/serviceProviders/AzureBlob');
  });

  it("legacy intent connector 'blob' normalizes to the same canonical output", () => {
    const intent = makeIntent('blob');

    const wf = generateWorkflow(intent, { wrapInScope: false });
    const trigger = Object.values(wf.definition.triggers)[0] as {
      inputs?: { serviceProviderConfiguration?: { connectionName?: string; serviceProviderId?: string } };
    };
    expect(trigger.inputs?.serviceProviderConfiguration?.connectionName).toBe('azureblob');
    expect(trigger.inputs?.serviceProviderConfiguration?.serviceProviderId)
      .toBe('/serviceProviders/AzureBlob');

    const { connections } = generateConnectionsFromIntent(intent);
    expect(Object.keys(connections.serviceProviderConnections ?? {})).toContain('azureblob');
  });

  it('buildPackageFromIntent emits real serviceProviderConnections (regression: was empty)', () => {
    const result = buildPackageFromIntent(makeIntent('azureblob'), {
      includeTests: false,
      includeInfrastructure: false,
    });

    const spConns = result.project.connections.serviceProviderConnections ?? {};
    expect(Object.keys(spConns).length).toBeGreaterThan(0);
    expect(spConns['azureblob']).toBeDefined();
    expect(result.summary.connectionCount).toBeGreaterThan(0);

    // The workflow's connectionName must be a key in connections.json (WDL Rule 7)
    const wf = result.project.workflows[0]!.workflow;
    const trigger = Object.values(wf.definition.triggers)[0] as {
      inputs?: { serviceProviderConfiguration?: { connectionName?: string } };
    };
    const connName = trigger.inputs?.serviceProviderConfiguration?.connectionName;
    expect(connName).toBeDefined();
    expect(Object.keys(spConns)).toContain(connName!);
  });

  it('generateConnectionsFromApp resolves new adapters', () => {
    const app = makeApp({
      bindingFiles: [makeBinding(
        [{ adapterType: 'RabbitMQ' }, { adapterType: 'Oracle' }],
        [{ adapterType: 'JDBC' }, { adapterType: 'CICS' }]
      )],
    });
    const { connections } = generateConnectionsFromApp(app);
    const keys = Object.keys(connections.serviceProviderConnections ?? {});
    expect(keys).toContain('rabbitmq');
    expect(keys).toContain('oracle');
    expect(keys).toContain('jdbc');
    expect(keys).toContain('cics');
  });
});

// ─── SBMP retirement gap rule ─────────────────────────────────────────────────

describe('SBMP retirement gap (dated: 30 September 2026)', () => {
  it('flags SB-Messaging receive locations as critical with KB5091375 guidance', () => {
    const app = makeApp({
      bindingFiles: [makeBinding([{ adapterType: 'SB-Messaging', address: 'sb://ns.servicebus.windows.net/orders' }])],
    });
    const gaps = analyzeGaps(app);
    const sbmp = gaps.find(g => g.capability.includes('SBMP'));
    expect(sbmp).toBeDefined();
    expect(sbmp!.severity).toBe('critical');
    expect(sbmp!.description).toContain('30 September 2026');
    expect(sbmp!.description).toContain('KB5091375');
    expect(sbmp!.mitigation).toContain('AMQP');
  });

  it('flags MSMQ-family send ports too', () => {
    const app = makeApp({
      bindingFiles: [makeBinding([], [{ adapterType: 'MSMQ' }])],
    });
    const gaps = analyzeGaps(app);
    expect(gaps.some(g => g.capability.includes('SBMP'))).toBe(true);
  });

  it('does not fire for unrelated adapters', () => {
    const app = makeApp({
      bindingFiles: [makeBinding([{ adapterType: 'FILE', address: 'C:\\In' }])],
    });
    const gaps = analyzeGaps(app);
    expect(gaps.some(g => g.capability.includes('SBMP'))).toBe(false);
  });
});

// ─── BRE gap text ─────────────────────────────────────────────────────────────

describe('BRE gap text (Azure Rules Engine)', () => {
  it('mentions the RETE runtime, .brl reuse, and the XML/.NET Framework facts constraint', () => {
    const app = makeApp({
      orchestrations: [makeOrch({ hasBRECalls: true })],
    });
    const gaps = analyzeGaps(app);
    const bre = gaps.find(g => g.capability.includes('BRE'));
    expect(bre).toBeDefined();
    expect(bre!.description).toContain('RETE');
    expect(bre!.description).toContain('.brl');
    expect(bre!.description).toMatch(/XML facts and \.NET \(Framework\) facts/);
  });
});

// ─── Integration Account logic ────────────────────────────────────────────────

describe('requiresIntegrationAccount (Standard packages maps locally)', () => {
  it('is FALSE for an app with XSLT maps but no B2B/EDI artifacts', () => {
    const intent = constructIntent(makeApp({ maps: [makeMap()] }));
    expect(intent.metadata.requiresIntegrationAccount).toBe(false);
  });

  it('is FALSE for an app with BRE calls but no B2B/EDI artifacts', () => {
    const intent = constructIntent(makeApp({
      orchestrations: [makeOrch({ hasBRECalls: true })],
    }));
    expect(intent.metadata.requiresIntegrationAccount).toBe(false);
  });

  it('is TRUE when EDI schemas are present', () => {
    const intent = constructIntent(makeApp({
      schemas: [{
        name: 'X12_850', filePath: 'X12_850.xsd', targetNamespace: 'http://schemas.microsoft.com/BizTalk/EDI/X12/2006',
        rootNode: 'X12_00401_850', isPropertySchema: false, isEDISchema: true,
      }],
    }));
    expect(intent.metadata.requiresIntegrationAccount).toBe(true);
  });

  it('is TRUE when receive pipelines are EDI pipelines', () => {
    const binding = makeBinding([{ adapterType: 'FILE', address: 'C:\\In' }]);
    binding.receiveLocations[0]!.pipelineName = 'Microsoft.BizTalk.Edi.DefaultPipelines.EdiReceive';
    const intent = constructIntent(makeApp({ bindingFiles: [binding] }));
    expect(intent.metadata.requiresIntegrationAccount).toBe(true);
  });
});
