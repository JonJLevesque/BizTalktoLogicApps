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

const SERVICE_PROVIDER_IDS: Record<string, string> = {
  blob:            '/serviceProviders/AzureBlob',
  azureBlob:       '/serviceProviders/AzureBlob',
  serviceBus:      '/serviceProviders/serviceBus',
  sftp:            '/serviceProviders/sftpWithSsh',
  ftp:             '/serviceProviders/ftp',
  sql:             '/serviceProviders/sql',
  sqlServer:       '/serviceProviders/sql',
  eventHubs:       '/serviceProviders/eventHubs',
  cosmosDb:        '/serviceProviders/documentdb',
  servicebus:      '/serviceProviders/serviceBus',
  azureQueues:     '/serviceProviders/azurequeues',
  azureTables:     '/serviceProviders/azuretables',
  azureFile:       '/serviceProviders/azureFile',
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
  const nameMap = buildFullNameMap(intent.steps);

  const triggers = buildTrigger(intent.trigger);
  let   actions  = buildActions(intent.steps, nameMap);

  // FIX-04: BizTalk FTP/SFTP adapters auto-delete processed files; Logic Apps does NOT.
  // Append an explicit deleteFile action as the last success-path action so files
  // are not left accumulating on the FTP/SFTP server after processing.
  const triggerConnector = intent.trigger.connector?.toLowerCase() ?? '';
  if (triggerConnector === 'ftp' || triggerConnector === 'sftp') {
    actions = appendFtpDeleteAction(actions, triggerConnector);
  }

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
  const nameMap  = buildFullNameMap(intent.steps);
  const bizLogic = buildActions(intent.steps, nameMap);

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
 * Builds a Map<stepId, actionName> for ALL steps (including nested branches).
 * Action names are unique PascalCase strings safe for use as WDL action keys.
 */
function buildFullNameMap(steps: IntegrationStep[]): Map<string, string> {
  const nameMap   = new Map<string, string>();
  const usedNames = new Set<string>();
  populateNameMap(steps, nameMap, usedNames);
  return nameMap;
}

function populateNameMap(
  steps: IntegrationStep[],
  nameMap: Map<string, string>,
  usedNames: Set<string>
): void {
  for (const step of steps) {
    const name = uniqueActionName(step.description || step.type, usedNames);
    nameMap.set(step.id, name);
    usedNames.add(name);

    // Recurse into branches
    const b = step.branches;
    if (b) {
      if (b.trueBranch)   populateNameMap(b.trueBranch,   nameMap, usedNames);
      if (b.falseBranch)  populateNameMap(b.falseBranch,  nameMap, usedNames);
      if (b.defaultSteps) populateNameMap(b.defaultSteps, nameMap, usedNames);
      if (b.cases) {
        for (const c of b.cases) populateNameMap(c.steps, nameMap, usedNames);
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
  let base = (words.join('_') || 'Action').slice(0, 80);
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

function buildRecurrenceTrigger(trigger: IntegrationTrigger): RecurrenceTrigger {
  const cfg = trigger.config as Record<string, unknown>;
  return {
    type: 'Recurrence',
    recurrence: {
      frequency: (cfg['frequency'] as RecurrenceTrigger['recurrence']['frequency']) ?? 'Minute',
      interval:  (cfg['interval'] as number) ?? 5,
    },
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
  const connector  = trigger.connector ?? 'blob';
  const providerId = SERVICE_PROVIDER_IDS[connector] ?? `/serviceProviders/${connector}`;
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
    recurrence: {
      frequency: (cfg['frequency'] as RecurrenceTrigger['recurrence']['frequency']) ?? 'Minute',
      interval:  (cfg['interval'] as number) ?? 5,
    },
  };
}

function connectorDefaultTriggerOperation(connector: string): string {
  const ops: Record<string, string> = {
    blob:       'whenABlobIsAddedOrModified',
    serviceBus: 'receiveMessages',
    sftp:       'whenAFileIsAddedOrModified',
    ftp:        'whenAFileIsAdded',
    sql:        'whenAnItemIsCreated',
    eventHubs:  'receiveEvents',
  };
  return ops[connector] ?? 'trigger';
}

// ─── Action Generation ────────────────────────────────────────────────────────

function buildActions(
  steps: IntegrationStep[],
  nameMap: Map<string, string>
): Record<string, WdlAction> {
  const actions: Record<string, WdlAction> = {};

  for (const step of steps) {
    const actionName = nameMap.get(step.id) ?? step.id;
    const runAfter   = buildRunAfter(step.runAfter, nameMap);
    const action     = buildStep(step, nameMap, runAfter);

    actions[actionName] = action;
  }

  return actions;
}

function buildRunAfter(stepIds: string[] | undefined | null, nameMap: Map<string, string>): RunAfterMap {
  if (!Array.isArray(stepIds) || stepIds.length === 0) return {};
  const ra: RunAfterMap = {};
  for (const id of stepIds) {
    const name = nameMap.get(id);
    if (name) ra[name] = ['SUCCEEDED'];
  }
  return ra;
}

function buildStep(
  step: IntegrationStep,
  nameMap: Map<string, string>,
  runAfter: RunAfterMap
): WdlAction {
  switch (step.type) {
    case 'transform':      return buildTransformAction(step, runAfter);
    case 'route':          return buildRouteAction(step, nameMap, runAfter);
    case 'condition':
      // If the intent constructor produced cases (3+ branch Decision → Switch), use route builder
      return (step.branches?.cases && step.branches.cases.length > 0)
        ? buildRouteAction(step, nameMap, runAfter)
        : buildConditionAction(step, nameMap, runAfter);
    case 'send':           return buildSendAction(step, runAfter);
    case 'enrich':         return buildEnrichAction(step, runAfter);
    case 'validate':       return buildValidateAction(step, nameMap, runAfter);
    case 'split':          return buildSplitAction(step, nameMap, runAfter);
    case 'loop':           return buildLoopAction(step, nameMap, runAfter);
    case 'aggregate':      return buildAggregateAction(step, nameMap, runAfter);
    case 'delay':          return buildDelayAction(step, runAfter);
    case 'invoke-child':   return buildInvokeChildAction(step, runAfter);
    case 'invoke-function':return buildInvokeFunctionAction(step, runAfter);
    case 'set-variable':   return buildSetVariableAction(step, runAfter);
    case 'error-handler':  return buildErrorHandlerAction(step, nameMap, runAfter);
    case 'parallel':       return buildParallelAction(step, nameMap, runAfter);
    case 'receive':
    default:               return buildDefaultAction(step, runAfter);
  }
}

// ─── Individual Action Builders ───────────────────────────────────────────────

function buildTransformAction(step: IntegrationStep, runAfter: RunAfterMap): TransformAction {
  const cfg = step.config as Record<string, unknown>;
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
  nameMap: Map<string, string>,
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
        actions: buildActions(c.steps, nameMap),
      };
    }
    return {
      type:       'Switch',
      expression: (cfg['expression'] as string) ?? "@{triggerBody()}",
      cases,
      ...(b.defaultSteps ? { default: { actions: buildActions(b.defaultSteps, nameMap) } } : {}),
      runAfter,
    };
  }

  // Binary routing → If
  return buildConditionAction(step, nameMap, runAfter);
}

function buildConditionAction(
  step: IntegrationStep,
  nameMap: Map<string, string>,
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
    actions:    b?.trueBranch  ? buildActions(b.trueBranch,  nameMap) : {},
    ...(b?.falseBranch ? { else: { actions: buildActions(b.falseBranch, nameMap) } } : {}),
    runAfter,
  };
}

function buildSendAction(step: IntegrationStep, runAfter: RunAfterMap): WdlAction {
  const cfg = step.config as Record<string, unknown>;

  // Service Bus send
  if (step.connector === 'serviceBus' || (cfg['queueOrTopicName'] as string)) {
    return {
      type: 'ServiceProvider',
      inputs: {
        parameters: {
          entityName:   cfg['queueOrTopicName'] ?? '@parameters(\'ServiceBusQueueName\')',
          message:      { body: cfg['body'] ?? `@{base64(body('${step.description}'))}` },
        },
        serviceProviderConfiguration: {
          connectionName:    'serviceBus',
          operationId:       'sendMessage',
          serviceProviderId: '/serviceProviders/serviceBus',
        },
      },
      runAfter,
    } satisfies ServiceProviderAction;
  }

  // HTTP send (default)
  return {
    type: 'Http',
    inputs: {
      method:  (cfg['method'] as HttpAction['inputs']['method']) ?? 'POST',
      uri:     (cfg['uri'] as string) ?? '@parameters(\'TargetEndpointUrl\')',
      body:    cfg['body'] ?? `@{body('${step.description}')}`,
      headers: (cfg['headers'] as Record<string, string>) ?? { 'Content-Type': 'application/xml' },
    },
    retryPolicy: DEFAULT_HTTP_RETRY,
    runAfter,
  } satisfies HttpAction;
}

function buildEnrichAction(step: IntegrationStep, runAfter: RunAfterMap): HttpAction {
  const cfg = step.config as Record<string, unknown>;
  return {
    type: 'Http',
    inputs: {
      method:  (cfg['method'] as HttpAction['inputs']['method']) ?? 'GET',
      uri:     (cfg['uri'] as string) ?? '@parameters(\'EnrichmentApiUrl\')',
      queries: (cfg['queries'] as Record<string, string>) ?? {},
    },
    retryPolicy: DEFAULT_HTTP_RETRY,
    runAfter,
  };
}

function buildValidateAction(
  step: IntegrationStep,
  nameMap: Map<string, string>,
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
  nameMap: Map<string, string>,
  runAfter: RunAfterMap
): ForEachAction {
  const cfg = step.config as Record<string, unknown>;
  return {
    type:    'Foreach',
    foreach: (cfg['collection'] as string) ?? "@{body('Parse_Message')?['items']}",
    actions: step.branches?.trueBranch
      ? buildActions(step.branches.trueBranch, nameMap)
      : {},
    ...(step.loopConfig?.concurrency
      ? { runtimeConfiguration: { concurrency: { repetitions: step.loopConfig.concurrency } } }
      : {}),
    runAfter,
  };
}

function buildLoopAction(
  step: IntegrationStep,
  nameMap: Map<string, string>,
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
        ? buildActions(step.branches.trueBranch, nameMap)
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
      ? buildActions(step.branches.trueBranch, nameMap)
      : {},
    runAfter,
  } satisfies UntilAction;
}

/**
 * Inverts a simple XLANG/s binary condition for use in a WDL Until expression.
 * BizTalk: while(cond) → Logic Apps: Until(!cond)
 * Returns the inverted WDL JSON predicate string, or null if unparseable.
 *
 * Inversion table:
 *   ==  → not(equals)        !=  → equals
 *   >   → lessOrEquals       >=  → less
 *   <   → greaterOrEquals    <=  → greater
 */
function invertXlangCondition(expr: string): string | null {
  const trimmed = expr.trim();

  // Try compound: &&
  if (trimmed.includes('&&')) {
    const parts = splitTopLevel(trimmed, '&&');
    if (parts) {
      const inverted = parts.map(p => invertXlangCondition(p.trim())).filter(Boolean);
      if (inverted.length === parts.length) {
        // De Morgan: NOT(A && B) = NOT(A) || NOT(B)
        return `@{json('{\"or\":[${inverted.map(i => i as string).join(',')}]}')}`;
      }
    }
  }

  // Try compound: ||
  if (trimmed.includes('||')) {
    const parts = splitTopLevel(trimmed, '||');
    if (parts) {
      const inverted = parts.map(p => invertXlangCondition(p.trim())).filter(Boolean);
      if (inverted.length === parts.length) {
        // De Morgan: NOT(A || B) = NOT(A) && NOT(B)
        return `@{json('{\"and\":[${inverted.map(i => i as string).join(',')}]}')}`;
      }
    }
  }

  // Try simple binary comparison
  const OPS: [string, string][] = [
    ['>=', 'less'], ['<=', 'greater'], ['==', 'not_equals'],
    ['!=', 'equals'], ['>', 'lessOrEquals'], ['<', 'greaterOrEquals'],
  ];

  for (const [op, wdlFn] of OPS) {
    const idx = trimmed.indexOf(op);
    if (idx < 0) continue;
    const lhs = trimmed.slice(0, idx).trim();
    const rhs = trimmed.slice(idx + op.length).trim();
    if (!lhs || !rhs) continue;

    const wdlLhs = `@{${lhs}}`;
    const wdlRhs = isNumeric(rhs) ? Number(rhs) : rhs.replace(/^["']|["']$/g, '');

    if (wdlFn === 'not_equals') {
      return `@{json('{\"not\":{\"equals\":[\"${wdlLhs}\",\"${wdlRhs}\"]}}')}`;
    }
    return `@{json('{\"${wdlFn}\":[\"${wdlLhs}\",${JSON.stringify(wdlRhs)}]}')}`;
  }

  return null;
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
    const wdlRhs = isNumeric(rhs) ? Number(rhs) : rhs.replace(/^["']|["']$/g, '');

    if (wdlFn === 'not_equals') {
      return { not: { equals: [wdlLhs, wdlRhs] } };
    }
    return { [wdlFn]: [wdlLhs, wdlRhs] };
  }

  // Unparseable — use an honest placeholder rather than a tautology
  return { equals: ['@true', true] };
}

function buildAggregateAction(
  step: IntegrationStep,
  nameMap: Map<string, string>,
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
    Object.assign(innerActions, buildActions(step.branches.trueBranch, nameMap));
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
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
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
  // config.expression holds the raw XLANG/s or partial WDL expression from the intent constructor.
  // Use it as the value when config.value was not explicitly set by AI enrichment.
  const resolvedValue = cfg['value'] ?? expression ?? '';

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

function buildErrorHandlerAction(
  step: IntegrationStep,
  nameMap: Map<string, string>,
  runAfter: RunAfterMap
): ScopeAction {
  const cfg = step.config as Record<string, unknown>;

  // Error handler scopes run after the failed action
  const errorRunAfter: RunAfterMap = {};
  if (step.handlesErrorFrom) {
    const srcName = nameMap.get(step.handlesErrorFrom);
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
    Object.assign(innerActions, buildActions(step.branches.trueBranch, nameMap));
  }

  return {
    type:    'Scope',
    actions: innerActions,
    runAfter: Object.keys(errorRunAfter).length > 0 ? errorRunAfter : runAfter,
  };
}

function buildParallelAction(
  step: IntegrationStep,
  nameMap: Map<string, string>,
  runAfter: RunAfterMap
): ScopeAction {
  // Parallel branches in WDL: wrap in Scope, then each branch action
  // has the same runAfter (the Scope's predecessor).
  // The Scope itself acts as a join point.
  const innerActions: Record<string, WdlAction> = {};

  if (step.branches?.trueBranch) {
    for (const sub of step.branches.trueBranch) {
      const name   = nameMap.get(sub.id) ?? sub.id;
      // All parallel branches run with empty runAfter (start simultaneously)
      innerActions[name] = buildStep(sub, nameMap, {});
    }
  }

  if (step.branches?.falseBranch) {
    for (const sub of step.branches.falseBranch) {
      const name = nameMap.get(sub.id) ?? sub.id;
      innerActions[name] = buildStep(sub, nameMap, {});
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
    runAfter: { 'Scope_Main': ['FAILED', 'TIMEDOUT', 'SKIPPED'] },
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

  const retryPolicy = buildRetryPolicy(errorHandling);

  // Hoisted InitializeVariable actions come first (before Scope_Main)
  return {
    ...hoistedInit,
    Scope_Main:     retryPolicy ? { ...mainScope, retryPolicy } as ScopeAction : mainScope,
    ...catchActions,
  };
}

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
  const skip = new Set(['operationId', 'frequency', 'interval']);
  return Object.fromEntries(
    Object.entries(cfg).filter(([k]) => !skip.has(k))
  );
}
