/**
 * Architecture Recommender — Stage 2 (Document)
 *
 * Analyzes the BizTalk application, its gaps, and detected patterns to recommend
 * the target Azure architecture for the Logic Apps migration.
 *
 * Determines:
 *   - Logic Apps SKU (always Standard for BizTalk migrations — stateful required)
 *   - Number of Logic Apps workflows the application will produce
 *   - Whether an Integration Account is needed (and at which tier)
 *   - On-premises data gateway requirement
 *   - VNET integration requirement
 *   - Complete list of required Azure services
 *   - Rationale for all recommendations
 */

import type { BizTalkApplication } from '../types/biztalk.js';
import type {
  ArchitectureRecommendation,
  MigrationGap,
  RequiredAzureService,
  IntegrationAccountTier,
} from '../types/migration.js';
import type { IntegrationPattern } from '../shared/integration-intent.js';

// ─── Adapter classification sets ──────────────────────────────────────────────

/** Adapters that communicate with on-premises systems (may need data gateway) */
const ON_PREM_ADAPTERS = new Set([
  'FILE', 'SQL', 'Oracle', 'DB2', 'ODBC', 'OracleEBusiness',
  'MQSeries', 'WebSphere MQ', 'MSMQ',
  'WCF-NetNamedPipe', 'WCF-NetTcp',
  'SAP', 'Siebel', 'PeopleSoft', 'JD Edwards',
]);

/** Adapters that strongly suggest VNET integration is needed */
const VNET_ADAPTERS = new Set([
  'WCF-NetTcp', 'WCF-NetNamedPipe', 'WCF-Custom', 'WCF-CustomIsolated',
  'SAP', 'Siebel', 'PeopleSoft', 'JD Edwards',
  'SQL', 'Oracle', 'DB2', 'ODBC',
  'MQSeries', 'WebSphere MQ',
]);

/** Adapters that are (or are usually) on-premises and need the data gateway */
const GATEWAY_ADAPTERS = new Set([
  'FILE', 'SQL', 'Oracle', 'DB2', 'ODBC',
  'MQSeries', 'WebSphere MQ',
  'SAP', 'Siebel', 'PeopleSoft', 'JD Edwards',
]);

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function recommendArchitecture(
  app: BizTalkApplication,
  gaps: MigrationGap[],
  patterns: IntegrationPattern[]
): ArchitectureRecommendation {
  const usedAdapters = collectUsedAdapters(app);

  const requiresIntegrationAccount = needsIntegrationAccount(app, patterns);
  const integrationAccountTier     = requiresIntegrationAccount
    ? chooseIntegrationAccountTier(app) : undefined;

  const requiresOnPremGateway      = usedAdapters.some(a => GATEWAY_ADAPTERS.has(a));
  const requiresVnetIntegration    = usedAdapters.some(a => VNET_ADAPTERS.has(a));

  const azureServicesRequired = deriveRequiredServices(
    app, gaps, patterns, usedAdapters, requiresIntegrationAccount, requiresOnPremGateway
  );

  const workflowCount = estimateWorkflowCount(app, patterns);

  const rationale = buildRationale(
    app, gaps, usedAdapters,
    requiresIntegrationAccount, requiresOnPremGateway, requiresVnetIntegration
  );

  return {
    // Always Standard for BizTalk migration: stateful workflows, VNET, on-prem, multi-workflow
    targetSku: 'standard',
    workflowCount,
    requiresIntegrationAccount,
    ...(integrationAccountTier !== undefined ? { integrationAccountTier } : {}),
    requiresOnPremGateway,
    requiresVnetIntegration,
    azureServicesRequired,
    rationale,
  };
}

// ─── Adapter Inventory ────────────────────────────────────────────────────────

function collectUsedAdapters(app: BizTalkApplication): string[] {
  const seen = new Set<string>();
  for (const binding of app.bindingFiles) {
    binding.receiveLocations.forEach(rl => seen.add(rl.adapterType));
    binding.sendPorts.forEach(sp => seen.add(sp.adapterType));
  }
  return Array.from(seen);
}

// ─── Integration Account ──────────────────────────────────────────────────────

function needsIntegrationAccount(
  app: BizTalkApplication,
  patterns: IntegrationPattern[]
): boolean {
  // EDI schemas → always need Integration Account
  if (app.schemas.some(s => s.isEDISchema)) return true;

  // EDI/AS2 pipeline components
  const ediComponents = ['edi', 'as2', 'x12', 'edifact', 'batchmarker'];
  if (app.pipelines.some(p =>
    p.components.some(c =>
      ediComponents.some(kw => c.fullTypeName.toLowerCase().includes(kw))
    )
  )) return true;

  // EDI in pipeline assignments from binding
  if (app.bindingFiles.flatMap(b => b.receiveLocations).some(rl =>
    rl.pipelineName.toLowerCase().includes('edi') ||
    rl.pipelineName.toLowerCase().includes('as2')
  )) return true;

  // Schema namespaces suggesting B2B/EDI
  if (app.schemas.some(s =>
    s.targetNamespace.toUpperCase().includes('EDI') ||
    s.targetNamespace.toUpperCase().includes('X12') ||
    s.targetNamespace.toUpperCase().includes('EDIFACT')
  )) return true;

  return false;
}

function chooseIntegrationAccountTier(app: BizTalkApplication): IntegrationAccountTier {
  const ediSchemaCount = app.schemas.filter(s => s.isEDISchema).length;
  // Standard tier for large EDI schema sets or RosettaNet
  if (ediSchemaCount > 10) return 'standard';
  // Basic for typical EDI with trading partners
  if (ediSchemaCount > 0)  return 'basic';
  return 'free';
}

// ─── Required Azure Services ──────────────────────────────────────────────────

function deriveRequiredServices(
  app: BizTalkApplication,
  gaps: MigrationGap[],
  patterns: IntegrationPattern[],
  usedAdapters: string[],
  requiresIntegrationAccount: boolean,
  requiresOnPremGateway: boolean
): RequiredAzureService[] {
  const services = new Set<RequiredAzureService>();

  // Always included
  services.add('logic-apps-standard');
  services.add('application-insights'); // BAM / operational monitoring equivalent
  services.add('key-vault');            // Credentials from binding files → Key Vault

  if (requiresIntegrationAccount) services.add('integration-account');
  if (requiresOnPremGateway)       services.add('on-prem-data-gateway');

  // ── Service Bus ────────────────────────────────────────────────────────────
  const needsServiceBus =
    patterns.includes('publish-subscribe')   ||
    patterns.includes('sequential-convoy')   ||
    patterns.includes('scatter-gather')      ||
    patterns.includes('dead-letter-queue')   ||
    usedAdapters.some(a => ['MSMQ', 'WCF-NetMsmq', 'MQSeries', 'WebSphere MQ'].includes(a)) ||
    // MSDTC Saga pattern uses Service Bus as durable state channel
    gaps.some(g => g.capability.includes('MSDTC'))                       ||
    gaps.some(g => g.capability.includes('Long-Running'));

  if (needsServiceBus) services.add('service-bus');

  // ── Azure Functions ────────────────────────────────────────────────────────
  const needsFunctions =
    gaps.some(g =>
      g.capability.includes('BRE')           ||
      g.capability.includes('Scripting')     ||
      g.capability.includes('Custom Pipeline') ||
      g.capability.includes('Database Functoid')
    );
  if (needsFunctions) services.add('azure-functions');

  // ── Blob Storage ───────────────────────────────────────────────────────────
  // FILE adapter → Azure Blob; claim-check pattern uses Blob for large messages
  if (usedAdapters.includes('FILE') || patterns.includes('claim-check')) {
    services.add('blob-storage');
  }

  // ── Cosmos DB ──────────────────────────────────────────────────────────────
  // Long-running aggregation patterns benefit from externalized state store
  if (
    patterns.includes('message-aggregator') &&
    app.orchestrations.some(o => o.hasLongRunningTransactions)
  ) {
    services.add('cosmos-db');
  }

  // ── API Management ─────────────────────────────────────────────────────────
  // HTTP-inbound BizTalk applications should be fronted by APIM
  const httpInboundAdapters = ['HTTP', 'HTTPS', 'WCF-BasicHttp', 'WCF-WSHttp', 'WCF-WebHttp'];
  if (usedAdapters.some(a => httpInboundAdapters.includes(a))) {
    services.add('api-management');
  }

  // ── Azure Relay ────────────────────────────────────────────────────────────
  // WCF-NetTcp can be proxied via Azure Relay Hybrid Connections
  if (usedAdapters.includes('WCF-NetTcp')) services.add('azure-relay');

  // ── Event Grid ─────────────────────────────────────────────────────────────
  // Fan-out / broadcast patterns without a Service Bus already in place
  if (patterns.includes('fan-out') && !needsServiceBus) services.add('event-grid');

  // ── Event Hubs ─────────────────────────────────────────────────────────────
  // High-throughput streaming scenarios
  if (patterns.includes('splitter') && app.maps.some(m => m.linkCount > 50)) {
    services.add('event-hubs');
  }

  return Array.from(services);
}

// ─── Workflow Count Estimate ───────────────────────────────────────────────────

/**
 * Estimates how many Logic Apps workflows the migration will produce.
 *
 * Base: 1 workflow per orchestration.
 * Plus:
 *   - Extra workflows for multiple activating receives
 *   - A dispatcher workflow for fan-out pattern
 *   - An aggregator workflow for scatter-gather
 *   - A compensation handler workflow (if any orchestration uses it)
 *   - A shared error handler workflow for complex/highly-complex apps
 */
function estimateWorkflowCount(
  app: BizTalkApplication,
  patterns: IntegrationPattern[]
): number {
  let count = app.orchestrations.length;

  // Multiple activating receives → multiple trigger workflows
  for (const orch of app.orchestrations) {
    if (orch.activatingReceiveCount > 1) {
      count += orch.activatingReceiveCount - 1;
    }
  }

  // Structural pattern workflows
  if (patterns.includes('fan-out'))        count += 1; // dispatcher workflow
  if (patterns.includes('scatter-gather')) count += 1; // aggregator workflow

  // Compensation handlers: one shared handler workflow
  if (app.orchestrations.some(o => o.hasCompensation)) count += 1;

  // Shared error / dead-letter handler for complex apps
  if (
    app.complexityClassification === 'complex' ||
    app.complexityClassification === 'highly-complex'
  ) {
    count += 1;
  }

  return count;
}

// ─── Rationale ────────────────────────────────────────────────────────────────

function buildRationale(
  app: BizTalkApplication,
  gaps: MigrationGap[],
  usedAdapters: string[],
  requiresIntegrationAccount: boolean,
  requiresOnPremGateway: boolean,
  requiresVnetIntegration: boolean
): string {
  const parts: string[] = [];

  parts.push(
    'Logic Apps Standard (single-tenant) is the correct SKU for all BizTalk Server migrations: ' +
    'it supports stateful workflows (required for long-running processes), VNET integration, ' +
    'multiple workflows per resource, on-premises connectivity via data gateway, ' +
    'and the full set of built-in (ServiceProvider) connectors. ' +
    'For organizations that cannot move to the cloud yet, Logic Apps Standard (Hybrid) is available: ' +
    'it runs on-premises using a Kubernetes-based runtime with a SQL Server backend, ' +
    'providing cloud-parity features while keeping data on-premises. ' +
    'Consider Hybrid if data sovereignty or latency requirements prevent full cloud deployment.'
  );

  if (requiresIntegrationAccount) {
    parts.push(
      'An Integration Account is required: EDI/AS2 schemas or B2B pipeline components were detected. ' +
      'Upload trading partner schemas and agreements to the Integration Account before deployment.'
    );
  }

  if (requiresOnPremGateway) {
    const gatewayAdapters = usedAdapters.filter(a => GATEWAY_ADAPTERS.has(a));
    parts.push(
      `On-premises data gateway required for the following adapters: ${gatewayAdapters.join(', ')}. ` +
      'Install the gateway on a server with network access to the on-premises systems before deployment.'
    );
  }

  if (requiresVnetIntegration) {
    const vnetAdapters = usedAdapters.filter(a => VNET_ADAPTERS.has(a));
    parts.push(
      `VNET integration is recommended: the application uses ${vnetAdapters.join(', ')} adapter(s) ` +
      'that require private network access. Configure the Logic Apps Standard app with VNET integration ' +
      'and ensure NSG rules allow outbound access to the required systems.'
    );
  }

  const critical = gaps.filter(g => g.severity === 'critical');
  if (critical.length > 0) {
    parts.push(
      `The following critical gaps must be resolved BEFORE the migration build phase: ` +
      `${critical.map(g => g.capability).join(', ')}. ` +
      'The generated output will include placeholder actions for these gaps, ' +
      'but they will not function until the architectural redesign is complete.'
    );
  }

  return parts.join(' ');
}
