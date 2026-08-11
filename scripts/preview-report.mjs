/**
 * Preview script — generates a sample migration report HTML from fixture data
 * without calling the proxy API. Safe to run; costs zero credits.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const { generateMigrationReport } = await import(`${root}/dist/runner/report-generator.js`);
const { migrationReportToHtml }   = await import(`${root}/dist/runner/markdown-to-html.js`);

// ── Sample BizTalkApplication (fixture-08 style: 2 orchestrations, send/receive ports) ──
const app = {
  name: 'OrderBroker',
  biztalkVersion: '2020',
  complexityScore: 72,
  complexityClassification: 'complex',
  orchestrations: [
    { name: 'OrderProcessingOrchestration', namespace: 'OrderBroker', filePath: 'OrderProcessing.odx', shapes: new Array(14), ports: [], correlationSets: [], messages: [], variables: [], hasAtomicTransactions: false, hasLongRunningTransactions: true, hasCompensation: false, hasBRECalls: false, hasSuspend: false, activatingReceiveCount: 1 },
    { name: 'OrderRoutingOrchestration',    namespace: 'OrderBroker', filePath: 'OrderRouting.odx',    shapes: new Array(8),  ports: [], correlationSets: [], messages: [], variables: [], hasAtomicTransactions: false, hasLongRunningTransactions: false, hasCompensation: false, hasBRECalls: true,  hasSuspend: false, activatingReceiveCount: 0 },
  ],
  maps: [
    { name: 'OrderToProcessedOrder', className: 'OrderToProcessedOrder', filePath: 'OrderToProcessedOrder.btm', sourceSchemaRef: 'Order', destinationSchemaRef: 'ProcessedOrder', functoids: [], links: [], linkCount: 6, hasScriptingFunctoids: false, hasLooping: false, hasDatabaseFunctoids: false, functoidCategories: [], recommendedMigrationPath: 'lml' },
  ],
  pipelines: [
    { name: 'ReceiveOrder', className: 'ReceiveOrder', filePath: 'ReceiveOrder.btp', direction: 'receive', components: [{componentType:'XmlDasmComp',fullTypeName:'Microsoft.BizTalk.DefaultPipelines.XMLReceive',stage:'Disassemble',isCustom:false,properties:{}}], hasCustomComponents: false, isDefault: false },
    { name: 'SendOrderResponse', className: 'SendOrderResponse', filePath: 'SendOrderResponse.btp', direction: 'send', components: [{componentType:'XmlAsmComp',fullTypeName:'Microsoft.BizTalk.DefaultPipelines.XMLTransmit',stage:'Assemble',isCustom:false,properties:{}}], hasCustomComponents: false, isDefault: false },
  ],
  schemas: [],
  bindingFiles: [{
    applicationName: 'OrderBroker',
    filePath: 'BindingInfo.xml',
    receiveLocations: [
      { name: 'ReceiveOrder_FILE', receivePortName: 'ReceiveOrder_Port', adapterType: 'FILE', address: 'C:\\BizTalk\\Receive\\Orders\\*.xml', pipelineName: 'ReceiveOrder', adapterProperties: { FileMask: '*.xml', PollingInterval: '60' }, isEnabled: true },
      { name: 'ReceiveOrder_HTTP', receivePortName: 'ReceiveOrder_HTTP_Port', adapterType: 'HTTP', address: '/orders/receive', pipelineName: 'ReceiveOrder', adapterProperties: {}, isEnabled: true },
    ],
    sendPorts: [
      { name: 'SendProcessedOrder_SB', adapterType: 'SB-Messaging', address: 'sb://orderbroker.servicebus.windows.net/orders-processed', pipelineName: 'SendOrderResponse', adapterProperties: {}, filterExpression: 'BTS.MessageType == "ProcessedOrder"', isDynamic: false, isTwoWay: false },
      { name: 'SendRejectedOrder_HTTP', adapterType: 'HTTP', address: 'https://legacy-erp.contoso.com/api/rejected', pipelineName: 'SendOrderResponse', adapterProperties: {}, isDynamic: false, isTwoWay: false },
    ],
  }],
};

// ── Sample BuildResult ──
const buildResult = {
  project: {
    appName: 'OrderBroker',
    workflows: [
      { name: 'ReceivePort_ReceiveOrder_FILE', workflow: { kind: 'Stateful', definition: { $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#', contentVersion: '1.0.0.0', triggers: { When_a_blob_is_added_or_modified: { type: 'ApiConnectionWebhook', inputs: {} } }, actions: { Parse_Order: {type:'ParseJson'}, Transform_Order: {type:'Xslt'}, Route_By_Priority: {type:'If'}, Send_To_Service_Bus: {type:'ServiceProvider'}, Scope_Main: {type:'Scope'}, Terminate_On_Error: {type:'Terminate'} } } } },
      { name: 'ReceivePort_ReceiveOrder_HTTP', workflow: { kind: 'Stateful', definition: { $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#', contentVersion: '1.0.0.0', triggers: { When_a_HTTP_request_is_received: { type: 'Request', inputs: {} } }, actions: { Parse_Order: {type:'ParseJson'}, Call_OrderProcessing: {type:'Workflow'}, Response_200: {type:'Response'} } } } },
      { name: 'OrderProcessingOrchestration', workflow: { kind: 'Stateful', definition: { $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#', contentVersion: '1.0.0.0', triggers: { When_a_message_is_received: { type: 'ServiceProvider', inputs: {} } }, actions: { Initialize_Priority: {type:'InitializeVariable'}, Transform_Order_To_ProcessedOrder: {type:'Xslt'}, Route_By_Order_Priority: {type:'If'}, Send_To_ServiceBus_Processed: {type:'ServiceProvider'}, Send_Rejected_HTTP: {type:'Http'}, Scope_Main: {type:'Scope'}, Terminate_On_Error: {type:'Terminate'} } } } },
    ],
    connections: { serviceProviderConnections: { azureblob: { parameterValues: { connectionString: "@appsetting('KVS_Storage_Blob_ConnectionString')" }, serviceProvider: { id: '/serviceProviders/AzureBlob' } }, serviceBus: { parameterValues: { connectionString: "@appsetting('KVS_DB_ServiceBus_ConnectionString')" }, serviceProvider: { id: '/serviceProviders/ServiceBus' } } }, managedApiConnections: {} },
    host: { version: '2.0', extensionBundle: { id: 'Microsoft.Azure.Functions.ExtensionBundle.Workflows', version: '[1.*, 2.0.0)' } },
    appSettings: { KVS_Storage_Blob_ConnectionString: '', KVS_DB_ServiceBus_ConnectionString: '', Workflow_OrderBroker_Input_Container: 'orders-inbound' },
    xsltMaps: { 'OrderToProcessedOrder.xslt': '<!-- XSLT content -->' },
    lmlMaps: {},
    localCodeFunctions: {},
    tests: {},
  },
  localSettings: { IsEncrypted: false, Values: { AzureWebJobsStorage: 'UseDevelopmentStorage=true', FUNCTIONS_WORKER_RUNTIME: 'dotnet', APP_KIND: 'workflowapp', AzureWebJobsFeatureFlags: 'EnableMultiLanguageWorker', ProjectDirectoryPath: '/path/to/OrderBroker' } },
  armTemplate: { '$schema': 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#', contentVersion: '1.0.0.0', parameters: {}, resources: [] },
  armParameters: {},
  schemaFiles: [],
  warnings: [
    '[ReceivePort_ReceiveOrder_FILE] Fixed: runAfter status values normalised to UPPERCASE',
    '[OrderProcessingOrchestration] Fixed: InitializeVariable hoisted above Scope_Main',
    'BRE (Business Rules Engine) detected in OrderRoutingOrchestration — consider Azure Rules Engine or inline If/Switch',
    'WCF-NetTcp adapter detected — requires Azure Functions wrapper or redesign',
  ],
};

// ── Sample QualityReport ──
const qualityReport = {
  totalScore: 87,
  grade: 'A',
  summary: 'Strong migration output. All workflows are Stateful, connections use @appsetting() references, and error scopes are in place. Two TODO_CLAUDE markers remain in routing conditions.',
  dimensions: [
    { name: 'WDL Correctness',       score: 25, maxScore: 25 },
    { name: 'Intent Coverage',        score: 22, maxScore: 25 },
    { name: 'Connection Config',      score: 18, maxScore: 20 },
    { name: 'Error Handling',         score: 15, maxScore: 15 },
    { name: 'Naming Conventions',     score: 7,  maxScore: 10 },
    { name: 'Security Posture',       score: 0,  maxScore: 5  },
  ],
  recommendations: [
    'Resolve all TODO_CLAUDE markers — 2 expression placeholders remain in OrderRoutingOrchestration',
    'Use KVS_ prefix for all sensitive @appsetting keys — 1 key missing prefix',
  ],
};

// ── Sample gaps ──
const gaps = [
  { capability: 'BRE (Business Rules Engine)', severity: 'high', description: 'OrderRoutingOrchestration uses BRE policy "OrderPriority" with 12 conditions.', mitigation: 'Migrate to Azure Rules Engine (same runtime) or extract to inline If/Switch for simple rules.', estimatedEffortDays: 3, affectedArtifacts: ['OrderRoutingOrchestration.odx'] },
  { capability: 'MSDTC distributed transactions', severity: 'critical', description: 'OrderProcessingOrchestration uses Atomic transaction scope wrapping DB write + SB send.', mitigation: 'Redesign as Saga pattern with compensation workflow for rollback.', estimatedEffortDays: 5, affectedArtifacts: ['OrderProcessingOrchestration.odx'] },
  { capability: 'Dynamic Send Ports', severity: 'critical', description: 'Send port "SendRejectedOrder_HTTP" uses runtime-resolved endpoint.', mitigation: 'Use a variable + HTTP action with @{variables(\'EndpointUrl\')} as URI.', estimatedEffortDays: 2, affectedArtifacts: ['BindingInfo.xml'] },
  { capability: 'ForEach envelope debatching', severity: 'medium', description: 'ReceiveOrder pipeline debatches envelopes with XmlDisassembler.', mitigation: 'Use ForEach action with concurrency: 1 for sequential processing.', estimatedEffortDays: 1, affectedArtifacts: ['ReceiveOrder.btp'] },
];

// ── Sample patterns ──
const patterns = ['content-based-routing', 'request-reply', 'dead-letter-queue', 'message-aggregator', 'publish-subscribe'];

const markdown = generateMigrationReport({
  app,
  buildResult,
  qualityReport,
  gaps,
  patterns,
  outputDir: '/tmp/OrderBroker',
  errors: [],
  warnings: buildResult.warnings,
  timings: { understand: 420, document: 890, build: 1340 },
  clientMode: 'proxy',
});

const html = migrationReportToHtml(markdown, 'OrderBroker');

const outPath = join(root, 'outputs', 'preview-report.html');
writeFileSync(outPath, html, 'utf-8');
console.log(`Written: ${outPath}`);
