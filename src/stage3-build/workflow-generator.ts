/**
 * Workflow Generator — Stage 3 (Build)
 *
 * Converts an IntegrationIntent into a valid Azure Logic Apps Standard
 * WorkflowJson (the workflow.json file).
 *
 * The generator is intentionally intent-driven: it does NOT parse BizTalk XML —
 * it consumes the structured IntegrationIntent produced by Stage 1 (Migration)
 * or Stage G1 (NLP Greenfield). This is the convergence point of both modes.
 *
 * Generation strategy:
 *   1. Map intent.trigger   → WDL trigger (Recurrence, Request, ServiceProvider)
 *   2. Map intent.steps     → WDL actions (type-driven, with runAfter chains)
 *   3. Apply error handling → Scope + retry policy wrapping where indicated
 *   4. Return valid WorkflowJson
 *
 * WDL rules enforced:
 *   - runAfter uses "SUCCEEDED" (ALL CAPS) as required by Standard runtime
 *   - First action has runAfter: {} (depends on trigger)
 *   - Action names are unique PascalCase identifiers
 *   - Stateful kind is always used for BizTalk migrations
 */

import type {
  IntegrationIntent,
  IntegrationStep,
  IntegrationTrigger,
  ErrorHandlingConfig,
} from '../shared/integration-intent.js';
import {
  translateCSharpToWdl,
  isComplexCSharpCall,
  extractMethodCallInfo,
} from './csharp-translator.js';
import type {
  WorkflowJson,
  WorkflowDefinition,
  WdlTrigger,
  WdlAction,
  RunAfterMap,
  RecurrenceTrigger,
  HttpRequestTrigger,
  ServiceProviderTrigger,
  ServiceProviderAction,
  HttpAction,
  ComposeAction,
  IfAction,
  SwitchAction,
  ForEachAction,
  UntilAction,
  ScopeAction,
  TerminateAction,
  DelayAction,
  InitializeVariableAction,
  SetVariableAction,
  WorkflowAction,
  TransformAction,
  InvokeFunctionAction,
  RetryPolicy,
} from '../types/logicapps.js';

// ─── WDL Constants ────────────────────────────────────────────────────────────

const WDL_SCHEMA = 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#' as const;

const DEFAULT_HTTP_RETRY: RetryPolicy = { type: 'fixed', count: 3, interval: 'PT30S' };

// ─── Connector → ServiceProvider ID mapping ───────────────────────────────────
// Single source of truth: the canonical connector catalog. getServiceProviderId()
// normalizes any legacy spelling ('blob', 'azureBlob', 'eventHubs', …) and returns
// the case-correct id (e.g. 'azureblob' → '/serviceProviders/AzureBlob' — the old
// local table missed 'azureblob' and fell back to the wrong-case
// '/serviceProviders/azureblob', which breaks deployment).
import {
  getServiceProviderId,
  normalizeConnectorName,
  CONNECTOR_CATALOG,
} from './connector-catalog.js';

/**
 * Normalizes a connector name coming from the IntegrationIntent (Stage 1 uses
 * names like "azureblob", "eventhub", "sqlServer") to the canonical token used
 * by the canonical connector catalog. Unknown connectors pass through unchanged.
 */
function normalizeConnector(connector: string): string {
  return normalizeConnectorName(connector);
}

/**
 * Default ServiceProvider operation IDs for send steps, per canonical connector.
 * Mirrors the BizTalk adapter → Logic Apps operation mapping
 * (FILE→createBlob, SB-Messaging→sendMessage, SFTP→uploadFile, ...).
 * Keys are canonical connector-catalog names.
 */
const SERVICE_PROVIDER_SEND_OPERATIONS: Record<string, string> = {
  azureblob:  'createBlob',
  serviceBus: 'sendMessage',
  sftp:       'uploadFile',
  ftp:        'uploadFile',
  sql:        'executeQuery',
  smtp:       'sendEmail',
  eventhub:   'sendEvent',
  azurequeue: 'putMessage',
  filesystem: 'createFile',
};

/**
 * Which operation parameter carries the message payload for each connector's
 * send operation. Used to default the payload to the predecessor's output when
 * the intent config does not provide one.
 */
const SEND_CONTENT_PARAMETER: Record<string, string> = {
  azureblob:  'content',
  sftp:       'content',
  ftp:        'content',
  filesystem: 'content',
  smtp:       'body',
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface WorkflowGeneratorOptions {
  /** Logical name used for this workflow (appears in child-workflow references) */
  workflowName?: string;
  /** Stateful (default) or Stateless. BizTalk migrations always use Stateful. */
  kind?: 'Stateful' | 'Stateless';
  /** When true, wraps the main flow in a top-level Scope for error handling */
  wrapInScope?: boolean;
}

export function generateWorkflow(
  intent: IntegrationIntent,
  options: WorkflowGeneratorOptions = {}
): WorkflowJson {
  const kind = options.kind ?? 'Stateful';

  // Sequential convoy pattern: generate Service Bus sessions workflow
  if (intent.patterns.includes('sequential-convoy')) {
    return generateSequentialConvoyWorkflow(intent, kind);
  }

  // Build a consistent step-ID → action-name map for the entire intent
  const maps = buildFullNameMap(intent.steps);

  // Honor the intent's retry policy: HTTP/ServiceProvider send actions use it
  // instead of the hardcoded default when the intent declares one.
  const intentRetry = buildRetryPolicy(intent.errorHandling);
  if (intentRetry) maps.retry = intentRetry;

  const triggers = buildTrigger(intent.trigger);
  let   actions  = buildActions(intent.steps, maps);

  // FIX-04: BizTalk FTP/SFTP adapters auto-delete processed files; Logic Apps does NOT.
  // Append an explicit deleteFile action as the last success-path action so files
  // are not left accumulating on the FTP/SFTP server after processing.
  const triggerConnector = intent.trigger.connector?.toLowerCase() ?? '';
  if (triggerConnector === 'ftp' || triggerConnector === 'sftp') {
    actions = appendFtpDeleteAction(actions, triggerConnector);
  }

  // HARD RULE: Every SetVariable must have a preceding InitializeVariable.
  // Add missing initializers at the top so wrapInErrorScope can hoist them above Scope_Main.
  actions = ensureVariablesInitialized(actions);

  // Optionally wrap everything in a top-level error-handling Scope
  if (options.wrapInScope) {
    actions = wrapInErrorScope(actions, intent.errorHandling);
  }

  const definition: WorkflowDefinition = {
    $schema: WDL_SCHEMA,
    contentVersion: '1.0.0.0',
    triggers,
    actions,
    outputs: {},
  };

  return { definition, kind };
}

/**
 * Generates a Service Bus sessions workflow for the sequential convoy pattern.
 *
 * BizTalk sequential convoys use correlation sets to process related messages
 * in order. Logic Apps equivalent: Service Bus sessions (sessionId = convoy key).
 *
 * Structure:
 *   Trigger: Service Bus peek-lock (sessions enabled, "Next available")
 *   ├── Initialize_Process_Completed (false)
 *   ├── Scope_Process_Message
 *   │   ├── Scope_Business_Logic   ← generated from intent.steps
 *   │   ├── Set_Process_Completed (true)  runAfter: all statuses
 *   │   └── Until_Renew_Lock
 *   │       ├── Renew_Message_Lock
 *   │       └── Delay_30s
 *   ├── Abandon_Message            runAfter: Scope_Process_Message [FAILED]
 *   └── Complete_Message           runAfter: Scope_Process_Message [SUCCEEDED]
 */
function generateSequentialConvoyWorkflow(
  intent: IntegrationIntent,
  kind: 'Stateful' | 'Stateless'
): WorkflowJson {
  const queueName = (intent.trigger.config as Record<string, unknown>)['queueOrTopicName'] as string
    ?? "@parameters('ServiceBusQueueName')";

  const triggers: Record<string, WdlTrigger> = {
    trigger: {
      type: 'ServiceProvider',
      inputs: {
        parameters: {
          entityName:  queueName,
          sessionId:   'Next available',
          isSessionsEnabled: true,
        },
        serviceProviderConfiguration: {
          connectionName:    'serviceBus',
          operationId:       'receiveMessagesFromSession',
          serviceProviderId: '/serviceProviders/serviceBus',
        },
      },
      recurrence: { frequency: 'Minute', interval: 1 },
    } satisfies ServiceProviderTrigger,
  };

  // Build inner business logic actions from intent steps
  const maps  = buildFullNameMap(intent.steps);
  const convoyRetry = buildRetryPolicy(intent.errorHandling);
  if (convoyRetry) maps.retry = convoyRetry;
  const bizLogic = buildActions(intent.steps, maps);

  const processScope: ScopeAction = {
    type: 'Scope',
    actions: {
      Scope_Business_Logic: {
        type:    'Scope',
        actions: bizLogic,
        runAfter: {},
      } satisfies ScopeAction,

      Set_Process_Completed: {
        type: 'SetVariable',
        inputs: { name: 'processCompleted', value: true },
        runAfter: {
          Scope_Business_Logic: ['SUCCEEDED', 'FAILED', 'SKIPPED', 'TIMEDOUT'],
        },
      } satisfies SetVariableAction,

      Until_Renew_Lock: {
        type:       'Until',
        expression: "@equals(variables('processCompleted'), true)",
        limit:      { count: 60, timeout: 'PT1H' },
        actions: {
          Renew_Message_Lock: {
            type: 'ServiceProvider',
            inputs: {
              parameters: {
                entityName: queueName,
                lockToken:  "@triggerBody()?['lockToken']",
              },
              serviceProviderConfiguration: {
                connectionName:    'serviceBus',
                operationId:       'renewMessageLock',
                serviceProviderId: '/serviceProviders/serviceBus',
              },
            },
            runAfter: {},
          } satisfies ServiceProviderAction,

          Delay_30_Seconds: {
            type:   'Delay',
            inputs: { interval: { count: 30, unit: 'Second' } },
            runAfter: { Renew_Message_Lock: ['SUCCEEDED'] },
          } satisfies DelayAction,
        },
        runAfter: { Scope_Business_Logic: ['SUCCEEDED'] },
      } satisfies UntilAction,
    },
    runAfter: { Initialize_Process_Completed: ['SUCCEEDED'] },
  };

  const actions: Record<string, WdlAction> = {
    Initialize_Process_Completed: {
      type: 'InitializeVariable',
      inputs: {
        variables: [{ name: 'processCompleted', type: 'boolean', value: false }],
      },
      runAfter: {},
    } satisfies InitializeVariableAction,

    Scope_Process_Message: processScope,

    Abandon_Message: {
      type: 'ServiceProvider',
      inputs: {
        parameters: {
          entityName: queueName,
          lockToken:  "@triggerBody()?['lockToken']",
        },
        serviceProviderConfiguration: {
          connectionName:    'serviceBus',
          operationId:       'abandonMessage',
          serviceProviderId: '/serviceProviders/serviceBus',
        },
      },
      runAfter: { Scope_Process_Message: ['FAILED', 'TIMEDOUT'] },
    } satisfies ServiceProviderAction,

    Complete_Message: {
      type: 'ServiceProvider',
      inputs: {
        parameters: {
          entityName: queueName,
          lockToken:  "@triggerBody()?['lockToken']",
        },
        serviceProviderConfiguration: {
          connectionName:    'serviceBus',
          operationId:       'completeMessage',
          serviceProviderId: '/serviceProviders/serviceBus',
        },
      },
      runAfter: { Scope_Process_Message: ['SUCCEEDED'] },
    } satisfies ServiceProviderAction,
  };

  return {
    definition: {
      $schema: WDL_SCHEMA,
      contentVersion: '1.0.0.0',
      triggers,
      actions,
    },
    kind,
  };
}

// ─── Name Map ─────────────────────────────────────────────────────────────────

/**
 * Two-map structure for action name resolution:
 *  - step: Map<IntegrationStep, string>  keyed by object reference — used in buildActions
 *           so the same step.id in different branches gets DIFFERENT unique names.
 *  - id:   Map<string, string>           keyed by step.id (first occurrence wins) — used
 *           in buildRunAfter to resolve explicit dependency references by ID.
 */
interface NameMaps {
  step: Map<IntegrationStep, string>;
  id:   Map<string, string>;
  /** Retry policy from the intent's errorHandling config — applied to send actions */
  retry?: RetryPolicy;
}

function buildFullNameMap(steps: IntegrationStep[]): NameMaps {
  const maps: NameMaps = { step: new Map(), id: new Map() };
  const usedNames = new Set<string>();
  populateNameMap(steps, maps, usedNames);
  return maps;
}

function populateNameMap(
  steps: IntegrationStep[],
  maps: NameMaps,
  usedNames: Set<string>
): void {
  for (const step of steps) {
    const name = uniqueActionName(step.description || step.type, usedNames);
    maps.step.set(step, name);
    // id map: first occurrence wins (for runAfter resolution within same branch)
    if (!maps.id.has(step.id)) maps.id.set(step.id, name);
    usedNames.add(name);

    // Recurse into branches — same usedNames ensures global uniqueness
    const b = step.branches;
    if (b) {
      if (b.trueBranch)   populateNameMap(b.trueBranch,   maps, usedNames);
      if (b.falseBranch)  populateNameMap(b.falseBranch,  maps, usedNames);
      if (b.defaultSteps) populateNameMap(b.defaultSteps, maps, usedNames);
      if (b.cases) {
        for (const c of b.cases) populateNameMap(c.steps, maps, usedNames);
      }
    }
  }
}

function uniqueActionName(description: string, usedNames: Set<string>): string {
  // Produce PascalCase from the description (up to 4 words).
  // Forbidden characters (per Logic Apps designer): < > % & \ ? / and single quotes.
  // The regex below strips all non-alphanumeric chars (except space, underscore, hyphen),
  // which implicitly removes all forbidden chars.
  const words = description
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .split(/[\s_-]+/)
    .filter(w => w.length > 0)
    .slice(0, 4)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  // Logic Apps action names max 80 chars — truncate before uniqueness check
  const base = (words.join('_') || 'Action').slice(0, 80);
  if (!usedNames.has(base)) return base;

  let counter = 2;
  // Leave room for suffix (_N) when truncating
  const maxBase = 77; // 80 - len('_99')
  const trimmedBase = base.slice(0, maxBase);
  while (usedNames.has(`${trimmedBase}_${counter}`)) counter++;
  return `${trimmedBase}_${counter}`;
}

// ─── Trigger Generation ───────────────────────────────────────────────────────

const TRIGGER_DISPLAY_NAMES: Record<string, string> = {
  recurrence:  'Recurrence_Schedule',
  request:     'When_a_HTTP_request_is_received',
  azureblob:   'When_a_blob_is_added_or_modified',
  azureBlob:   'When_a_blob_is_added_or_modified',
  blob:        'When_a_blob_is_added_or_modified',
  serviceBus:  'When_a_message_is_received_in_a_queue',
  servicebus:  'When_a_message_is_received_in_a_queue',
  sql:         'When_an_item_is_created',
  sqlServer:   'When_an_item_is_created',
  sftp:        'When_a_file_is_added_or_modified',
  ftp:         'When_a_file_is_added_or_modified',
  eventHubs:   'When_events_are_available_in_Event_Hub',
  eventhub:    'When_events_are_available_in_Event_Hub',
};

function buildTrigger(trigger: IntegrationTrigger): Record<string, WdlTrigger> {
  const connector = trigger.connector ?? '';
  const name = TRIGGER_DISPLAY_NAMES[connector]
    ?? (trigger.type === 'schedule' ? 'Recurrence_Schedule'
      : trigger.type === 'webhook' ? 'When_a_HTTP_request_is_received'
      : trigger.type === 'manual'  ? 'When_a_HTTP_request_is_received'
      : 'manual_trigger');

  switch (trigger.type) {
    case 'schedule':
      return { [name]: buildRecurrenceTrigger(trigger) };

    case 'webhook':
    case 'manual':
      return { [name]: buildRequestTrigger() };

    case 'polling':
    default:
      return { [name]: buildServiceProviderTrigger(trigger) };
  }
}

/**
 * Reads recurrence settings from a trigger config.
 * Stage 1 writes them as a NESTED object (config.recurrence = { frequency, interval });
 * flat config.frequency / config.interval is also accepted for hand-written intents.
 */
function readRecurrence(cfg: Record<string, unknown>): RecurrenceTrigger['recurrence'] {
  const nested = cfg['recurrence'] as Partial<RecurrenceTrigger['recurrence']> | undefined;
  return {
    frequency: nested?.frequency
      ?? (cfg['frequency'] as RecurrenceTrigger['recurrence']['frequency'])
      ?? 'Minute',
    interval: nested?.interval ?? (cfg['interval'] as number) ?? 5,
  };
}

function buildRecurrenceTrigger(trigger: IntegrationTrigger): RecurrenceTrigger {
  const cfg = trigger.config as Record<string, unknown>;
  return {
    type: 'Recurrence',
    recurrence: readRecurrence(cfg),
  };
}

function buildRequestTrigger(): HttpRequestTrigger {
  return {
    type: 'Request',
    kind: 'Http',
    inputs: { schema: {} },
  };
}

function buildServiceProviderTrigger(trigger: IntegrationTrigger): ServiceProviderTrigger {
  // Canonical connector name — MUST match the connections.json key (WDL Rule 7)
  const connector  = normalizeConnectorName(trigger.connector ?? 'azureblob');
  const providerId = getServiceProviderId(connector);
  const cfg        = trigger.config as Record<string, unknown>;

  // Derive a sensible operation ID from connector + direction
  const operationId = cfg['operationId'] as string
    ?? connectorDefaultTriggerOperation(connector);

  return {
    type: 'ServiceProvider',
    inputs: {
      parameters: stripInternalKeys(cfg),
      serviceProviderConfiguration: {
        connectionName:    connector,
        operationId,
        serviceProviderId: providerId,
      },
    },
    recurrence: readRecurrence(cfg),
  };
}

function connectorDefaultTriggerOperation(connector: string): string {
  const canonical = normalizeConnectorName(connector);
  return CONNECTOR_CATALOG[canonical]?.defaultTriggerOperation ?? 'trigger';
}

// ─── Action Generation ────────────────────────────────────────────────────────

function buildActions(
  steps: IntegrationStep[],
  maps: NameMaps
): Record<string, WdlAction> {
  const actions: Record<string, WdlAction> = {};
  let prevActionName: string | undefined;

  for (const step of steps) {
    const actionName = maps.step.get(step) ?? step.id;

    // BizTalk orchestrations are sequential by default. If a step has no explicit
    // runAfter dependencies declared in the intent, chain it after the previous action.
    // This prevents unintended parallel execution. Only the first action gets runAfter:{}.
    let runAfter: RunAfterMap;
    if ((!step.runAfter || step.runAfter.length === 0) && prevActionName !== undefined) {
      runAfter = { [prevActionName]: ['SUCCEEDED'] };
    } else {
      runAfter = buildRunAfter(step.runAfter, maps);
    }

    const action = buildStep(step, maps, runAfter);
    actions[actionName] = action;
    prevActionName = actionName;
  }

  return actions;
}

function buildRunAfter(stepIds: string[] | undefined | null, maps: NameMaps): RunAfterMap {
  if (!Array.isArray(stepIds) || stepIds.length === 0) return {};
  const ra: RunAfterMap = {};
  for (const id of stepIds) {
    const name = maps.id.get(id);
    if (name) ra[name] = ['SUCCEEDED'];
  }
  return ra;
}

function buildStep(
  step: IntegrationStep,
  maps: NameMaps,
  runAfter: RunAfterMap
): WdlAction {
  switch (step.type) {
    case 'transform':      return buildTransformAction(step, runAfter);
    case 'route':          return buildRouteAction(step, maps, runAfter);
    case 'condition':
      // If the intent constructor produced cases (3+ branch Decision → Switch), use route builder
      return (step.branches?.cases && step.branches.cases.length > 0)
        ? buildRouteAction(step, maps, runAfter)
        : buildConditionAction(step, maps, runAfter);
    case 'send':           return buildSendAction(step, maps, runAfter);
    case 'enrich':         return buildEnrichAction(step, maps, runAfter);
    case 'validate':       return buildValidateAction(step, maps, runAfter);
    case 'split':          return buildSplitAction(step, maps, runAfter);
    case 'loop':           return buildLoopAction(step, maps, runAfter);
    case 'aggregate':      return buildAggregateAction(step, maps, runAfter);
    case 'delay':          return buildDelayAction(step, runAfter);
    case 'invoke-child':   return buildInvokeChildAction(step, runAfter);
    case 'invoke-function':return buildInvokeFunctionAction(step, runAfter);
    case 'set-variable':   return buildSetVariableAction(step, runAfter);
    case 'error-handler':
      // Terminate/Throw/Suspend shapes map to Terminate actions — an empty
      // Scope here would silently swallow the terminate semantics.
      return step.actionType === 'Terminate'
        ? buildTerminateAction(step, runAfter)
        : buildErrorHandlerAction(step, maps, runAfter);
    case 'parallel':       return buildParallelAction(step, maps, runAfter);
    case 'receive':
    default:               return buildDefaultAction(step, runAfter);
  }
}

// ─── Individual Action Builders ───────────────────────────────────────────────

function buildTransformAction(step: IntegrationStep, runAfter: RunAfterMap): TransformAction {
  const cfg = step.config as Record<string, unknown>;
  const actionType = step.actionType ?? 'Xslt';

  // FIX-4: FlatFileDecoding/FlatFileEncoding are built-in Logic Apps Standard actions
  if (actionType === 'FlatFileDecoding' || actionType === 'FlatFileEncoding') {
    return {
      type: actionType as 'FlatFileDecoding' | 'FlatFileEncoding',
      inputs: {
        content: (cfg['content'] as string) ?? '@triggerBody()',
        schema: { name: (cfg['schemaName'] as string) ?? 'TODO_flat_file_schema' },
      },
      runAfter,
    } as unknown as TransformAction;
  }

  return {
    type: 'Xslt',
    inputs: {
      content: (cfg['content'] as string) ?? "@{triggerBody()}",
      ...(cfg['mapName']
        ? { integrationAccount: { map: { name: cfg['mapName'] as string } } }
        : {}),
    },
    runAfter,
  };
}

function buildRouteAction(
  step: IntegrationStep,
  maps: NameMaps,
  runAfter: RunAfterMap
): IfAction | SwitchAction {
  const cfg = step.config as Record<string, unknown>;
  const b   = step.branches;

  // Multi-case routing → Switch
  if (b?.cases && b.cases.length > 1) {
    const cases: SwitchAction['cases'] = {};
    for (const c of b.cases) {
      cases[`case_${c.value.replace(/\W/g, '_')}`] = {
        case:    c.value,
        actions: buildActions(c.steps, maps),
      };
    }
    return {
      type:       'Switch',
      expression: (cfg['expression'] as string) ?? "@{triggerBody()}",
      cases,
      ...(b.defaultSteps ? { default: { actions: buildActions(b.defaultSteps, maps) } } : {}),
      runAfter,
    };
  }

  // Binary routing → If
  return buildConditionAction(step, maps, runAfter);
}

function buildConditionAction(
  step: IntegrationStep,
  maps: NameMaps,
  runAfter: RunAfterMap
): IfAction {
  const cfg = step.config as Record<string, unknown>;
  const b   = step.branches;

  // Prefer branches.condition (XLANG/s string from ODX), then cfg.expression
  const conditionStr = (b?.condition as string | undefined) ?? (cfg['expression'] as string | undefined);
  const expression = conditionStr
    ? parseXlangCondition(conditionStr)
    : { equals: ['@true', true] as [string, unknown] }; // honest placeholder

  return {
    type:       'If',
    expression: expression as IfAction['expression'],
    actions:    b?.trueBranch  ? buildActions(b.trueBranch,  maps) : {},
    ...(b?.falseBranch ? { else: { actions: buildActions(b.falseBranch, maps) } } : {}),
    runAfter,
  };
}

/**
 * Returns the WDL expression for the message payload a send step should emit:
 * the output of its predecessor action, or the trigger body when the step is
 * first in the chain. Never uses step.description — descriptions are NOT
 * action names, so body('<description>') would be a dangling reference.
 */
function predecessorBodyExpr(runAfter: RunAfterMap): string {
  const predecessor = Object.keys(runAfter)[0];
  return predecessor ? `body('${predecessor}')` : 'triggerBody()';
}

/** True for config values the intent constructor left as TODO_CLAUDE sentinels. */
function isTodoSentinel(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('TODO_CLAUDE');
}

function buildSendAction(step: IntegrationStep, maps: NameMaps, runAfter: RunAfterMap): WdlAction {
  const cfg = step.config as Record<string, unknown>;
  const connector  = step.connector;
  const normalized = connector ? normalizeConnector(connector) : undefined;
  const spOperation = normalized ? SERVICE_PROVIDER_SEND_OPERATIONS[normalized] : undefined;

  // ServiceProvider send: the step declares a ServiceProvider actionType, uses a
  // known built-in connector, or carries legacy Service Bus config. Previously
  // everything except Service Bus fell through to a broken HTTP action.
  const wantsServiceProvider =
    step.actionType === 'ServiceProvider' ||
    spOperation !== undefined ||
    cfg['queueOrTopicName'] !== undefined;

  if (wantsServiceProvider && step.actionType !== 'Http') {
    const spConnector = (spOperation !== undefined || step.actionType === 'ServiceProvider') && connector
      ? connector
      : 'serviceBus';
    return buildServiceProviderSendAction(step, spConnector, maps, runAfter);
  }

  // HTTP send (default)
  return {
    type: 'Http',
    inputs: {
      method:  (cfg['method'] as HttpAction['inputs']['method']) ?? 'POST',
      uri:     (cfg['uri'] as string) ?? '@parameters(\'TargetEndpointUrl\')',
      body:    cfg['body'] ?? `@{${predecessorBodyExpr(runAfter)}}`,
      headers: (cfg['headers'] as Record<string, string>) ?? { 'Content-Type': 'application/xml' },
    },
    retryPolicy: maps.retry ?? DEFAULT_HTTP_RETRY,
    runAfter,
  } satisfies HttpAction;
}

function buildServiceProviderSendAction(
  step: IntegrationStep,
  connector: string,
  maps: NameMaps,
  runAfter: RunAfterMap
): ServiceProviderAction {
  const cfg        = step.config as Record<string, unknown>;
  const normalized = normalizeConnector(connector);
  const providerId = getServiceProviderId(normalized);
  const operationId = (cfg['operationId'] as string | undefined)
    ?? SERVICE_PROVIDER_SEND_OPERATIONS[normalized]
    ?? 'sendMessage';
  const bodyExpr = predecessorBodyExpr(runAfter);

  let parameters: Record<string, unknown>;
  if (normalized === 'serviceBus') {
    parameters = {
      entityName: cfg['entityName'] ?? cfg['queueOrTopicName'] ?? '@parameters(\'ServiceBusQueueName\')',
      message:    { body: cfg['body'] ?? `@{base64(${bodyExpr})}` },
    };
  } else {
    // Pass the step config through as operation parameters (containerName,
    // blobName, filePath, query, ...), excluding non-parameter keys.
    parameters = stripSendInternalKeys(cfg);
    // Default the payload parameter to the predecessor's output when the
    // config does not provide one (or left a TODO_CLAUDE sentinel).
    const contentKey = SEND_CONTENT_PARAMETER[normalized];
    if (contentKey && (parameters[contentKey] === undefined || isTodoSentinel(parameters[contentKey]))) {
      parameters[contentKey] = `@{${bodyExpr}}`;
    }
  }

  return {
    type: 'ServiceProvider',
    inputs: {
      parameters,
      serviceProviderConfiguration: {
        connectionName:    connector,
        operationId,
        serviceProviderId: providerId,
      },
    },
    ...(maps.retry ? { retryPolicy: maps.retry } : {}),
    runAfter,
  };
}

function stripSendInternalKeys(cfg: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set(['operationId', 'method', 'uri', 'headers', 'queueOrTopicName']);
  return Object.fromEntries(
    Object.entries(cfg).filter(([k]) => !skip.has(k))
  );
}

function buildEnrichAction(step: IntegrationStep, maps: NameMaps, runAfter: RunAfterMap): HttpAction {
  const cfg = step.config as Record<string, unknown>;
  return {
    type: 'Http',
    inputs: {
      method:  (cfg['method'] as HttpAction['inputs']['method']) ?? 'GET',
      uri:     (cfg['uri'] as string) ?? '@parameters(\'EnrichmentApiUrl\')',
      queries: (cfg['queries'] as Record<string, string>) ?? {},
    },
    retryPolicy: maps.retry ?? DEFAULT_HTTP_RETRY,
    runAfter,
  };
}

function buildValidateAction(
  step: IntegrationStep,
  maps: NameMaps,
  runAfter: RunAfterMap
): IfAction {
  const cfg = step.config as Record<string, unknown>;
  return {
    type:       'If',
    expression: (cfg['expression'] as Record<string, unknown>) ?? { equals: ['@true', '@true'] },
    actions:    {},
    else: {
      actions: {
        Terminate_Validation_Failed: {
          type:   'Terminate',
          inputs: {
            runStatus: 'Failed',
            runError:  {
              code:    'ValidationFailed',
              message: (cfg['errorMessage'] as string) ?? 'Message validation failed',
            },
          },
          runAfter: {},
        } satisfies TerminateAction,
      },
    },
    runAfter,
  };
}

function buildSplitAction(
  step: IntegrationStep,
  maps: NameMaps,
  runAfter: RunAfterMap
): ForEachAction {
  const cfg = step.config as Record<string, unknown>;
  return {
    type:    'Foreach',
    foreach: (cfg['collection'] as string) ?? "@{body('Parse_Message')?['items']}",
    actions: step.branches?.trueBranch
      ? buildActions(step.branches.trueBranch, maps)
      : {},
    ...(step.loopConfig?.concurrency
      ? { runtimeConfiguration: { concurrency: { repetitions: step.loopConfig.concurrency } } }
      : {}),
    runAfter,
  };
}

function buildLoopAction(
  step: IntegrationStep,
  maps: NameMaps,
  runAfter: RunAfterMap
): UntilAction | ForEachAction {
  const cfg = step.config as Record<string, unknown>;
  const lc  = step.loopConfig;

  // Iterate over collection → ForEach
  if (lc?.iterateOver) {
    return {
      type:    'Foreach',
      foreach: lc.iterateOver,
      actions: step.branches?.trueBranch
        ? buildActions(step.branches.trueBranch, maps)
        : {},
      runAfter,
    } satisfies ForEachAction;
  }

  // Until (BizTalk LoopShape — condition inverted)
  const rawExpr = lc?.untilExpression ?? (cfg['untilExpression'] as string);
  const resolvedExpr = rawExpr?.startsWith('TODO_CLAUDE_INVERT:')
    ? (invertXlangCondition(rawExpr.replace(/^TODO_CLAUDE_INVERT:\s*/, '')) ?? rawExpr)
    : rawExpr ?? '@equals(1, 1)';

  return {
    type:       'Until',
    expression: resolvedExpr,
    limit:      { count: 60, timeout: 'PT1H' },
    actions:    step.branches?.trueBranch
      ? buildActions(step.branches.trueBranch, maps)
      : {},
    runAfter,
  } satisfies UntilAction;
}

/**
 * Inverts a simple XLANG/s binary condition for use in a WDL Until expression.
 * BizTalk: while(cond) → Logic Apps: Until(!cond)
 *
 * Until expressions are WDL INLINE STRINGS — "@lessOrEquals(a, b)" — NOT JSON
 * predicate objects. JSON predicates are only valid inside If action expressions.
 *
 * Inversion table:
 *   ==  → not(equals)        !=  → equals
 *   >   → lessOrEquals       >=  → less
 *   <   → greaterOrEquals    <=  → greater
 */
function invertXlangCondition(expr: string): string | null {
  const trimmed = expr.trim();

  // Try compound: && → De Morgan: NOT(A && B) = NOT(A) || NOT(B)
  if (trimmed.includes('&&')) {
    const parts = splitTopLevel(trimmed, '&&');
    if (parts) {
      const inverted = parts.map(p => invertXlangCondition(p.trim())).filter(Boolean) as string[];
      if (inverted.length === parts.length) {
        return `@or(${inverted.join(', ')})`;
      }
    }
  }

  // Try compound: || → De Morgan: NOT(A || B) = NOT(A) && NOT(B)
  if (trimmed.includes('||')) {
    const parts = splitTopLevel(trimmed, '||');
    if (parts) {
      const inverted = parts.map(p => invertXlangCondition(p.trim())).filter(Boolean) as string[];
      if (inverted.length === parts.length) {
        return `@and(${inverted.join(', ')})`;
      }
    }
  }

  // Try simple binary comparison
  const OPS: [string, string][] = [
    ['>=', 'less'], ['<=', 'greater'], ['==', 'not'],
    ['!=', 'equals'], ['>', 'lessOrEquals'], ['<', 'greaterOrEquals'],
  ];

  for (const [op, wdlFn] of OPS) {
    const idx = trimmed.indexOf(op);
    if (idx < 0) continue;
    const lhs = trimmed.slice(0, idx).trim();
    const rhs = trimmed.slice(idx + op.length).trim();
    if (!lhs || !rhs) continue;

    // Convert bare variable names → variables('name') WDL accessor
    const wdlLhs = toWdlRef(lhs);
    const wdlRhs = isNumeric(rhs) ? rhs : `'${rhs.replace(/^["']|["']$/g, '')}'`;

    // Until expression = WDL inline function string, e.g. "@lessOrEquals(x, y)"
    if (wdlFn === 'not') {
      return `@not(equals(${wdlLhs}, ${wdlRhs}))`;
    }
    return `@${wdlFn}(${wdlLhs}, ${wdlRhs})`;
  }

  return null;
}

/**
 * Converts a bare XLANG/s variable reference to its WDL equivalent.
 * Simple identifiers → variables('name')
 * Already-qualified WDL refs (@{...} or triggerBody...) → pass through
 */
function toWdlRef(expr: string): string {
  const s = expr.trim();
  // Already a WDL expression — pass through
  if (s.startsWith('@') || s.startsWith('triggerBody') || s.startsWith('variables(')) return s;
  // Simple identifier — treat as workflow variable
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(s)) return `variables('${s}')`;
  return s;
}

function isNumeric(s: string): boolean {
  return !isNaN(Number(s));
}

function splitTopLevel(expr: string, op: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < expr.length - op.length + 1; i++) {
    if (expr[i] === '(') { depth++; continue; }
    if (expr[i] === ')') { depth--; continue; }
    if (depth === 0 && expr.startsWith(op, i)) {
      parts.push(expr.slice(last, i));
      last = i + op.length;
      i += op.length - 1;
    }
  }
  parts.push(expr.slice(last));
  return parts.length > 1 ? parts : null;
}

/**
 * Converts a simple XLANG/s binary condition into a WDL predicate object.
 * Used for If-action expressions (which must be JSON objects, not strings).
 *
 *   a == b   → { equals:         ['@{a}', 'b'] }
 *   a != b   → { not: { equals:  ['@{a}', 'b'] } }
 *   a > b    → { greater:        ['@{a}', b]   }
 *   a && b   → { and: [ ... ] }
 *   a || b   → { or:  [ ... ] }
 *
 * Returns { equals: ['@true', true] } when the expression cannot be parsed.
 */
function parseXlangCondition(expr: string): Record<string, unknown> {
  const trimmed = expr.trim();

  // Compound: &&
  if (trimmed.includes('&&')) {
    const parts = splitTopLevel(trimmed, '&&');
    if (parts) {
      return { and: parts.map(p => parseXlangCondition(p.trim())) };
    }
  }

  // Compound: ||
  if (trimmed.includes('||')) {
    const parts = splitTopLevel(trimmed, '||');
    if (parts) {
      return { or: parts.map(p => parseXlangCondition(p.trim())) };
    }
  }

  // Prefix negation: !condition
  if (trimmed.startsWith('!')) {
    const inner = trimmed.slice(1).trim();
    if (inner) {
      return { not: parseXlangCondition(inner) };
    }
  }

  // str.Contains("x") → {"contains": ["@{variables('str')}", "x"]}
  const containsMatch = /^([a-zA-Z_]\w*)\.Contains\((.+)\)$/.exec(trimmed);
  if (containsMatch) {
    const varName = containsMatch[1]!;
    const argRaw = containsMatch[2]!.trim();
    const argVal = /^"[^"]*"$/.test(argRaw) ? argRaw.slice(1, -1) : argRaw;
    return { contains: [`@{variables('${varName}')}`, argVal] };
  }

  // string.IsNullOrEmpty(s) → {"equals": ["@{variables('s')}", ""]}
  const isNullOrEmptyMatch = /^(?:string|String)\.IsNullOrEmpty\(([a-zA-Z_]\w*)\)$/.exec(trimmed);
  if (isNullOrEmptyMatch) {
    const varName = isNullOrEmptyMatch[1]!;
    return { equals: [`@{variables('${varName}')}`, ''] };
  }

  // Simple binary — check longer ops first to avoid partial match
  const OPS: [string, string][] = [
    ['>=', 'greaterOrEquals'], ['<=', 'lessOrEquals'],
    ['==', 'equals'],         ['!=', 'not_equals'],
    ['>',  'greater'],        ['<',  'less'],
  ];

  for (const [op, wdlFn] of OPS) {
    const idx = trimmed.indexOf(op);
    if (idx < 0) continue;
    const lhs = trimmed.slice(0, idx).trim();
    const rhs = trimmed.slice(idx + op.length).trim();
    if (!lhs || !rhs) continue;

    const wdlLhs = `@{${lhs}}`;
    // Handle null literal → JSON null; otherwise numeric or string
    const wdlRhs = rhs === 'null' ? null : isNumeric(rhs) ? Number(rhs) : rhs.replace(/^["']|["']$/g, '');

    if (wdlFn === 'not_equals') {
      return { not: { equals: [wdlLhs, wdlRhs] } };
    }
    return { [wdlFn]: [wdlLhs, wdlRhs] };
  }

  // Bare identifier (boolean variable): boolVar → {"equals": ["@{variables('boolVar')}", true]}
  if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
    return { equals: [`@{variables('${trimmed}')}`, true] };
  }

  // Unparseable — use an honest placeholder rather than a tautology
  return { equals: ['@true', true] };
}

function buildAggregateAction(
  step: IntegrationStep,
  maps: NameMaps,
  runAfter: RunAfterMap
): ScopeAction {
  const cfg = step.config as Record<string, unknown>;
  const varName = (cfg['variableName'] as string) ?? 'aggregatedItems';

  const innerActions: Record<string, WdlAction> = {
    Initialize_Aggregation_Variable: {
      type: 'InitializeVariable',
      inputs: {
        variables: [{ name: varName, type: 'array', value: [] }],
      },
      runAfter: {},
    } satisfies InitializeVariableAction,
  };

  if (step.branches?.trueBranch) {
    Object.assign(innerActions, buildActions(step.branches.trueBranch, maps));
  }

  return {
    type:    'Scope',
    actions: innerActions,
    runAfter,
  };
}

function buildDelayAction(step: IntegrationStep, runAfter: RunAfterMap): DelayAction {
  const cfg = step.config as Record<string, unknown>;
  return {
    type: 'Delay',
    inputs: {
      interval: {
        count: (cfg['count'] as number) ?? 30,
        unit:  (cfg['unit'] as DelayAction['inputs']['interval']['unit']) ?? 'Second',
      },
    },
    runAfter,
  };
}

function buildInvokeChildAction(step: IntegrationStep, runAfter: RunAfterMap): WorkflowAction {
  const cfg = step.config as Record<string, unknown>;
  const rawName = (cfg['workflowName'] as string) ?? step.description.replace(/\s/g, '');
  // Strip assembly-qualified names like "Namespace.Class, Assembly, Version=1.0.0.0, ..."
  // → keep only the final class-name segment
  const id = rawName.includes(',')
    ? (rawName.split(',')[0]?.split('.').pop() ?? rawName)
    : (rawName.split('.').pop() ?? rawName);
  return {
    type: 'Workflow',
    inputs: {
      host: {
        workflow: { id },
      },
      body: cfg['body'],
    },
    runAfter,
  };
}

function buildInvokeFunctionAction(step: IntegrationStep, runAfter: RunAfterMap): InvokeFunctionAction {
  const cfg = step.config as Record<string, unknown>;
  // Derive function name from config, step id, or a default.
  const functionName = (cfg['functionName'] as string)
    ?? step.id.replace(/^step_/, '').replace(/[^A-Za-z0-9_]/g, '_')
    ?? 'CustomFunction';
  return {
    type: 'InvokeFunction',
    inputs: {
      functionName,
      parameters: {
        requestBody: cfg['body'] ?? '@{triggerBody()}',
      },
    },
    runAfter,
  };
}

/** Sanitize a variable name: strip forbidden chars and enforce the 80-char action name limit. */
function sanitizeVariableName(name: string): string {
  // Replace forbidden chars (< > % & \ ? / and single quotes) with underscores.
  // Also strip any other character not valid in Logic Apps action/variable names.
  return name
    .replace(/[<>%&\\?/']/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80)
    || 'variable';
}

/**
 * Extracts the left-hand-side identifier from a C# assignment expression.
 * e.g. "mchSourceLoyalty = someHelper.Method();" → "mchSourceLoyalty"
 * Returns undefined if no clean identifier can be found.
 */
function extractLhsVariableName(expr: string): string | undefined {
  // Take the first line only (multi-line blocks: first assignment sets the name)
  const firstLine = expr.split(/[\r\n]/)[0]?.trim() ?? '';
  const eqIdx = firstLine.indexOf('=');
  if (eqIdx <= 0) return undefined;
  const lhs = firstLine.slice(0, eqIdx).trim();
  // lhs may be "var name", "Type name", or just "name" — take the last word
  const parts = lhs.split(/\s+/);
  const candidate = parts[parts.length - 1] ?? '';
  // Must be a valid C# / WDL identifier
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(candidate)) return candidate;
  return undefined;
}

function buildSetVariableAction(step: IntegrationStep, runAfter: RunAfterMap): WdlAction {
  const cfg = step.config as Record<string, unknown>;
  const expression = cfg['expression'] as string | undefined;
  // Try explicit variableName first, then extract from the C# LHS, then fall back to a safe default
  const rawVarName =
    (cfg['variableName'] as string | undefined) ??
    (expression ? extractLhsVariableName(expression) : undefined) ??
    'localVar';
  // Sanitize variable names derived from BizTalk — they may contain chars forbidden in WDL.
  const varName = sanitizeVariableName(rawVarName);

  // Resolve the value: prefer explicit config.value, then try C# → WDL translation,
  // then fall back to raw expression.
  let resolvedValue: unknown = cfg['value'];
  if (resolvedValue === undefined && expression) {
    const translated = translateCSharpToWdl(expression);
    if (translated !== null) {
      resolvedValue = translated;
    } else if (isComplexCSharpCall(expression)) {
      // Complex helper class call → route to InvokeFunction instead of SetVariable
      const info = extractMethodCallInfo(expression);
      const functionName = info?.methodName
        ?? step.id.replace(/^step_/, '').replace(/[^A-Za-z0-9_]/g, '_')
        ?? 'CustomFunction';
      return {
        type: 'InvokeFunction',
        inputs: {
          functionName: sanitizeVariableName(functionName).slice(0, 80),
          parameters: {
            requestBody: '@{triggerBody()}',
          },
        },
        runAfter,
      } satisfies InvokeFunctionAction;
    } else {
      resolvedValue = expression;
    }
  }
  resolvedValue = resolvedValue ?? '';

  if (cfg['initialize']) {
    return {
      type: 'InitializeVariable',
      inputs: {
        variables: [{
          name:  varName,
          type:  (cfg['variableType'] as InitializeVariableAction['inputs']['variables'][0]['type']) ?? 'string',
          value: resolvedValue,
        }],
      },
      runAfter,
    } satisfies InitializeVariableAction;
  }

  return {
    type: 'SetVariable',
    inputs: {
      name:  varName,
      value: resolvedValue,
    },
    runAfter,
  } satisfies SetVariableAction;
}

/**
 * Builds a Terminate action for BizTalk Terminate/Throw/Suspend shapes.
 * These arrive as type 'error-handler' with actionType 'Terminate' — routing
 * them through buildErrorHandlerAction produced an empty Scope that silently
 * dropped the terminate semantics.
 */
function buildTerminateAction(step: IntegrationStep, runAfter: RunAfterMap): TerminateAction {
  const cfg = step.config as Record<string, unknown>;
  const runStatus = (cfg['runStatus'] as TerminateAction['inputs']['runStatus']) ?? 'Failed';
  return {
    type: 'Terminate',
    inputs: {
      runStatus,
      ...(runStatus === 'Failed'
        ? {
            runError: {
              code:    (cfg['code'] as string) ?? 'WorkflowTerminated',
              message: (cfg['message'] as string) ?? step.description,
            },
          }
        : {}),
    },
    runAfter,
  };
}

function buildErrorHandlerAction(
  step: IntegrationStep,
  maps: NameMaps,
  runAfter: RunAfterMap
): ScopeAction {
  const cfg = step.config as Record<string, unknown>;

  // Error handler scopes run after the failed action
  const errorRunAfter: RunAfterMap = {};
  if (step.handlesErrorFrom) {
    const srcName = maps.id.get(step.handlesErrorFrom ?? '');
    if (srcName) errorRunAfter[srcName] = ['FAILED', 'TIMEDOUT'];
  }

  const innerActions: Record<string, WdlAction> = {};

  // Add dead-letter if configured
  if (cfg['deadLetterQueue']) {
    innerActions['Send_To_Dead_Letter'] = {
      type: 'ServiceProvider',
      inputs: {
        parameters: {
          entityName: cfg['deadLetterQueue'],
          message:    { body: "@{base64(string(result('Scope_Main')))}" },
        },
        serviceProviderConfiguration: {
          connectionName:    'serviceBus',
          operationId:       'sendMessage',
          serviceProviderId: '/serviceProviders/serviceBus',
        },
      },
      runAfter: {},
    } satisfies ServiceProviderAction;
  }

  // Add notification if configured
  if (cfg['notificationTarget']) {
    innerActions['Send_Error_Notification'] = buildDefaultAction(step, {});
  }

  if (step.branches?.trueBranch) {
    Object.assign(innerActions, buildActions(step.branches.trueBranch, maps));
  }

  return {
    type:    'Scope',
    actions: innerActions,
    runAfter: Object.keys(errorRunAfter).length > 0 ? errorRunAfter : runAfter,
  };
}

function buildParallelAction(
  step: IntegrationStep,
  maps: NameMaps,
  runAfter: RunAfterMap
): ScopeAction {
  // Parallel branches in WDL: wrap in Scope, then each branch action
  // has the same runAfter (the Scope's predecessor).
  // The Scope itself acts as a join point.
  const innerActions: Record<string, WdlAction> = {};

  if (step.branches?.trueBranch) {
    for (const sub of step.branches.trueBranch) {
      const name   = maps.step.get(sub) ?? sub.id;
      // All parallel branches run with empty runAfter (start simultaneously)
      innerActions[name] = buildStep(sub, maps, {});
    }
  }

  if (step.branches?.falseBranch) {
    for (const sub of step.branches.falseBranch) {
      const name = maps.step.get(sub) ?? sub.id;
      innerActions[name] = buildStep(sub, maps, {});
    }
  }

  return { type: 'Scope', actions: innerActions, runAfter };
}

function buildDefaultAction(step: IntegrationStep, runAfter: RunAfterMap): ComposeAction {
  return {
    type:   'Compose',
    inputs: {
      stepType:    step.type,
      description: step.description,
      config:      step.config,
      note:        'TODO: implement this action',
    },
    runAfter,
  };
}

// ─── FTP/SFTP Delete File Helper ─────────────────────────────────────────────

/**
 * FIX-04: BizTalk FTP/SFTP adapters auto-delete processed files after successful
 * processing. Logic Apps FTP/SFTP ServiceProvider connectors do NOT auto-delete.
 * This helper appends an explicit deleteFile action as the last success-path action.
 */
function appendFtpDeleteAction(
  actions: Record<string, WdlAction>,
  connector: 'ftp' | 'sftp',
): Record<string, WdlAction> {
  // Find the last action in the map (insertion order) to set as predecessor
  const actionNames = Object.keys(actions);
  const lastActionName = actionNames[actionNames.length - 1];
  const runAfter: RunAfterMap = lastActionName ? { [lastActionName]: ['SUCCEEDED'] } : {};

  const serviceProviderId = connector === 'sftp'
    ? '/serviceProviders/sftpWithSsh'
    : '/serviceProviders/ftp';
  const operationId   = connector === 'sftp' ? 'deleteFile' : 'deleteFile';
  const actionName    = connector === 'sftp'
    ? 'Delete_Processed_SFTP_File'
    : 'Delete_Processed_FTP_File';
  const filePath      = connector === 'sftp'
    ? "@triggerOutputs()?['body']?['OriginalPath']"
    : "@triggerOutputs()?['body']?['FilePath']";

  const deleteAction: ServiceProviderAction = {
    type: 'ServiceProvider',
    inputs: {
      parameters: { filePath },
      serviceProviderConfiguration: {
        connectionName:    connector,
        operationId,
        serviceProviderId,
      },
    },
    runAfter,
  };

  return { ...actions, [actionName]: deleteAction };
}

// ─── Variable Initialization Guard ────────────────────────────────────────────

/**
 * HARD RULE: Every SetVariable action must have a preceding InitializeVariable
 * for the same variable. Scans the entire action tree recursively; for any
 * variable that is Set but never Initialized, adds an InitializeVariable at the
 * TOP of the map (type: string, value: ''). The caller (wrapInErrorScope) will
 * then hoist these above Scope_Main automatically.
 */
function ensureVariablesInitialized(
  actions: Record<string, WdlAction>
): Record<string, WdlAction> {
  const initializedVars = new Set<string>();
  const setVarNames     = new Set<string>();

  function collectVars(acts: Record<string, WdlAction>): void {
    for (const action of Object.values(acts)) {
      if (action.type === 'InitializeVariable') {
        const a = action as InitializeVariableAction;
        for (const v of a.inputs.variables) initializedVars.add(v.name);
      } else if (action.type === 'SetVariable') {
        const a = action as SetVariableAction;
        setVarNames.add(a.inputs.name);
      }
      // Recurse into child action containers
      const a = action as unknown as Record<string, unknown>;
      for (const key of ['actions', 'else', 'default']) {
        const sub = a[key];
        if (sub && typeof sub === 'object' && 'actions' in (sub as object)) {
          collectVars((sub as { actions: Record<string, WdlAction> }).actions);
        } else if (sub && typeof sub === 'object') {
          collectVars(sub as Record<string, WdlAction>);
        }
      }
      // Switch cases
      if (a['cases'] && typeof a['cases'] === 'object') {
        for (const c of Object.values(a['cases'] as Record<string, { actions: Record<string, WdlAction> }>)) {
          if (c.actions) collectVars(c.actions);
        }
      }
    }
  }

  collectVars(actions);

  const missingVars = [...setVarNames].filter(v => !initializedVars.has(v));
  if (missingVars.length === 0) return actions;

  const newInits: Record<string, WdlAction> = {};
  for (const varName of missingVars) {
    const initName = `Initialize_${varName.replace(/[^A-Za-z0-9]/g, '_')}`.slice(0, 80);
    newInits[initName] = {
      type:   'InitializeVariable',
      inputs: { variables: [{ name: varName, type: 'string', value: '' }] },
      runAfter: {},
    } satisfies InitializeVariableAction;
  }

  return { ...newInits, ...actions };
}

// ─── Error Scope Wrapper ──────────────────────────────────────────────────────

/**
 * Wraps all generated actions in a top-level Scope action.
 * Adds a catch handler that executes after the Scope fails.
 *
 * FIX-01: InitializeVariable actions are hoisted ABOVE the Scope_Main wrapper.
 * Logic Apps Standard prohibits InitializeVariable inside a Scope action — doing so
 * causes a deployment error: "Initialize Variables cannot be placed inside a Scope action."
 * Hoisted actions keep their original runAfter chains; the Scope_Main runAfter is set to
 * reference the last hoisted InitializeVariable (or {} if there are none).
 * Any action inside the Scope whose runAfter references a hoisted InitializeVariable has
 * that reference removed (making it a "first in scope" action with runAfter: {}).
 */
function wrapInErrorScope(
  actions: Record<string, WdlAction>,
  errorHandling: ErrorHandlingConfig
): Record<string, WdlAction> {
  // ── FIX-01: Separate InitializeVariable from remaining actions ──────────────
  const initNames = new Set<string>();
  const hoistedInit: Record<string, WdlAction> = {};
  const scopeBodyRaw: Record<string, WdlAction> = {};

  for (const [name, action] of Object.entries(actions)) {
    if (action.type === 'InitializeVariable') {
      initNames.add(name);
      hoistedInit[name] = action;
    } else {
      scopeBodyRaw[name] = action;
    }
  }

  // Strip references to hoisted init actions from scope-body runAfter maps.
  // If an action's entire runAfter consisted of init-action predecessors, it
  // becomes a "first in scope" action (runAfter: {}).
  const scopeBody: Record<string, WdlAction> = {};
  for (const [name, action] of Object.entries(scopeBodyRaw)) {
    const rawRunAfter = action.runAfter as RunAfterMap | undefined;
    if (rawRunAfter && Object.keys(rawRunAfter).some(k => initNames.has(k))) {
      const filtered: RunAfterMap = Object.fromEntries(
        Object.entries(rawRunAfter).filter(([k]) => !initNames.has(k))
      );
      scopeBody[name] = { ...action, runAfter: filtered };
    } else {
      scopeBody[name] = action;
    }
  }

  // Scope_Main runs after the last InitializeVariable action (or immediately if none)
  const lastInitName = Object.keys(hoistedInit).pop();
  const scopeRunAfter: RunAfterMap = lastInitName
    ? { [lastInitName]: ['SUCCEEDED'] }
    : {};

  const mainScope: ScopeAction = {
    type:    'Scope',
    actions: scopeBody,
    runAfter: scopeRunAfter,
  };

  const catchActions: Record<string, WdlAction> = {};

  // Always add Terminate_On_Error — every strategy needs a catch handler
  catchActions['Terminate_On_Error'] = {
    type:   'Terminate',
    inputs: {
      runStatus: 'Failed',
      runError:  {
        code:    'WorkflowError',
        message: "@{result('Scope_Main')[0]['error']['message']}",
      },
    },
    runAfter: { 'Scope_Main': ['FAILED', 'TIMEDOUT'] },
  } satisfies TerminateAction;

  if (errorHandling.deadLetterTarget) {
    catchActions['Send_To_Dead_Letter_Queue'] = {
      type: 'ServiceProvider',
      inputs: {
        parameters: {
          entityName: errorHandling.deadLetterTarget,
          message:    { body: "@{base64(string(result('Scope_Main')))}" },
        },
        serviceProviderConfiguration: {
          connectionName:    'serviceBus',
          operationId:       'sendMessage',
          serviceProviderId: '/serviceProviders/serviceBus',
        },
      },
      runAfter: { 'Scope_Main': ['FAILED'] },
    } satisfies ServiceProviderAction;
  }

  // Scopes do not support retryPolicy — they are containers, not actions.
  // Hoisted InitializeVariable actions come first (before Scope_Main)
  return {
    ...hoistedInit,
    Scope_Main: mainScope,
    ...catchActions,
  };
}

/**
 * Maps the intent's ErrorHandlingConfig.retryPolicy to a WDL RetryPolicy.
 * Returns undefined when the intent declares none (callers fall back to
 * DEFAULT_HTTP_RETRY).
 */
function buildRetryPolicy(cfg: ErrorHandlingConfig): RetryPolicy | undefined {
  if (!cfg.retryPolicy) return undefined;
  return {
    type:     cfg.retryPolicy.type,
    count:    cfg.retryPolicy.count,
    interval: cfg.retryPolicy.interval,
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function stripInternalKeys(cfg: Record<string, unknown>): Record<string, unknown> {
  // 'recurrence' is hoisted to the trigger's top-level recurrence property —
  // it must NOT leak into inputs.parameters.
  const skip = new Set(['operationId', 'frequency', 'interval', 'recurrence']);
  return Object.fromEntries(
    Object.entries(cfg).filter(([k]) => !skip.has(k))
  );
}
