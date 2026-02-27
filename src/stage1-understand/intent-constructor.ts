/**
 * IntentConstructor — Mechanical BizTalkApplication → partial IntegrationIntent
 *
 * Handles the deterministic 70% of the BizTalk→Intent conversion:
 *   - Shape type → step type/actionType lookup
 *   - Adapter type → connector lookup
 *   - Binding addresses → system endpoints
 *   - Pipeline names → data format detection
 *
 * Values that require Claude's reasoning are marked with TODO_CLAUDE sentinel.
 * Claude enriches these markers before passing to Stage 3 (build).
 */

import { createIntegrationIntent } from '../shared/integration-intent.js';
import type {
  IntegrationIntent,
  IntegrationStep,
  IntegrationTrigger,
  ExternalSystem,
  IntegrationPattern,
  TriggerType,
  DataFormat,
  ErrorStrategy,
  StepType,
} from '../shared/integration-intent.js';
import type {
  BizTalkApplication,
  OdxShape,
  ShapeType,
} from '../types/biztalk.js';
import { flattenShapes } from './orchestration-analyzer.js';

export const TODO_CLAUDE = 'TODO_CLAUDE';

// ─── Adapter to Connector Mapping ──────────────────────────────────────────────

const ADAPTER_TO_CONNECTOR: Record<string, { connector: string; triggerType: TriggerType; onPremises?: boolean }> = {
  'FILE':             { connector: 'azureblob',    triggerType: 'polling' },
  'FTP':              { connector: 'ftp',           triggerType: 'polling' },
  'SFTP':             { connector: 'sftp',          triggerType: 'polling' },
  'HTTP':             { connector: 'request',       triggerType: 'webhook' },
  'HTTPS':            { connector: 'request',       triggerType: 'webhook' },
  'SOAP':             { connector: 'request',       triggerType: 'webhook' },
  'WCF-BasicHttp':    { connector: 'request',       triggerType: 'webhook' },
  'WCF-WSHttp':       { connector: 'request',       triggerType: 'webhook' },
  'WCF-NetTcp':       { connector: 'azurefunction', triggerType: 'webhook' },
  'WCF-NetMsmq':      { connector: 'serviceBus',   triggerType: 'polling' },
  'WCF-NetNamedPipe': { connector: 'azurefunction', triggerType: 'webhook' },
  'WCF-Custom':       { connector: 'request',       triggerType: 'webhook' },
  'MSMQ':             { connector: 'serviceBus',   triggerType: 'polling' },
  'SB-Messaging':     { connector: 'serviceBus',   triggerType: 'polling' },
  'EventHubs':        { connector: 'eventhub',     triggerType: 'polling' },
  'SQL':              { connector: 'sql',           triggerType: 'polling',  onPremises: true },
  'SQL Server':       { connector: 'sql',           triggerType: 'polling' },
  'Oracle':           { connector: 'oracle',        triggerType: 'polling',  onPremises: true },
  'SAP':              { connector: 'sap',           triggerType: 'polling',  onPremises: true },
  'MQSeries':         { connector: 'ibmmq',         triggerType: 'polling' },
  'WebSphere MQ':     { connector: 'ibmmq',         triggerType: 'polling' },
  'SharePoint':       { connector: 'sharepoint',   triggerType: 'polling' },
  'SMTP':             { connector: 'smtp',          triggerType: 'manual' },
  'POP3':             { connector: 'office365',    triggerType: 'polling' },
  'AzureBlob':        { connector: 'azureblob',    triggerType: 'polling' },
  'AzureQueue':       { connector: 'azurequeue',   triggerType: 'polling' },
  'EDI':              { connector: 'x12',           triggerType: 'polling' },
  'AS2':              { connector: 'as2',           triggerType: 'polling' },
};

function isOnPrem(adapterType: string, address?: string): boolean {
  const onPremAdapters = ['SQL', 'Oracle', 'SAP', 'SharePoint', 'MQSeries', 'WebSphere MQ'];
  if (onPremAdapters.includes(adapterType)) return true;
  // FILE adapter with local path (not Blob) is on-prem
  if (adapterType === 'FILE' && address && (address.match(/^[A-Za-z]:\\/) || address.startsWith('\\\\') || address.startsWith('/'))) return true;
  return false;
}

function requiresGateway(adapterType: string, address?: string): boolean {
  return isOnPrem(adapterType, address);
}

// ─── Shape to Step Type Mapping ────────────────────────────────────────────────

type StepTypeEntry = { type: StepType; actionType: string };

const SHAPE_TO_STEP: Partial<Record<ShapeType, StepTypeEntry>> = {
  'TransformShape':           { type: 'transform',      actionType: 'Xslt' },
  'DecisionShape':            { type: 'condition',      actionType: 'If' },
  'LoopShape':                { type: 'loop',           actionType: 'Until' },
  'ScopeShape':               { type: 'error-handler',  actionType: 'Scope' },
  'DelayShape':               { type: 'delay',          actionType: 'Delay' },
  'CallOrchestrationShape':   { type: 'invoke-child',   actionType: 'Workflow' },
  'StartOrchestrationShape':  { type: 'invoke-child',   actionType: 'Workflow' },
  'CallRulesShape':           { type: 'invoke-function',actionType: 'Workflow' },
  'ExpressionShape':          { type: 'set-variable',   actionType: 'SetVariable' },
  'MessageAssignmentShape':   { type: 'set-variable',   actionType: 'Compose' },
  'ConstructShape':           { type: 'set-variable',   actionType: 'Compose' },
  'ParallelActionsShape':     { type: 'parallel',       actionType: 'parallel-group' },
  'TerminateShape':           { type: 'error-handler',  actionType: 'Terminate' },
  'ThrowShape':               { type: 'error-handler',  actionType: 'Terminate' },
  'SuspendShape':             { type: 'error-handler',  actionType: 'Terminate' },
  'CompensateShape':          { type: 'error-handler',  actionType: 'Compensate' },
  'ListenShape':              { type: 'condition',      actionType: 'If' },
  'GroupShape':               { type: 'condition',      actionType: 'If' },
};

// ─── Detect data format from pipeline name ─────────────────────────────────────

function detectDataFormat(pipelineName: string): DataFormat {
  const lower = pipelineName.toLowerCase();
  if (lower.includes('xml')) return 'xml';
  if (lower.includes('json')) return 'json';
  if (lower.includes('flatfile') || lower.includes('flat_file')) return 'flat-file';
  if (lower.includes('edi') || lower.includes('x12')) return 'edi-x12';
  if (lower.includes('edifact')) return 'edi-edifact';
  if (lower.includes('as2')) return 'as2';
  if (lower.includes('passthru') || lower.includes('passthrough')) return 'unknown';
  return 'xml'; // BizTalk default
}

// ─── Build trigger from first activating ReceiveShape ─────────────────────────

function buildTrigger(app: BizTalkApplication): IntegrationTrigger {
  // Find first orchestration with an activating Receive
  for (const orch of app.orchestrations) {
    const allShapes = flattenShapes(orch.shapes);
    const activatingReceive = allShapes.find(s => s.shapeType === 'ReceiveShape' && s.isActivating);
    if (!activatingReceive) continue;

    // Find the port for this receive shape
    const port = orch.ports.find(p => p.polarity === 'Implements');
    if (!port) continue;

    // Find matching receive location in binding files
    for (const binding of app.bindingFiles) {
      const receiveLocation = binding.receiveLocations.find(
        rl => rl.receivePortName === port.binding || rl.name.includes(port.name)
      );
      if (!receiveLocation) continue;

      const adapterType = receiveLocation.adapterType;
      const mapping = ADAPTER_TO_CONNECTOR[adapterType] ?? { connector: 'request', triggerType: 'webhook' as TriggerType };

      // Determine if on-premises
      const onPrem = isOnPrem(adapterType, receiveLocation.address);

      // Build connector-specific config
      const config: Record<string, unknown> = {};

      if (adapterType === 'FILE' && !onPrem) {
        // Cloud: FILE → Azure Blob
        const address = receiveLocation.address;
        // Extract container name from path (last non-wildcard folder)
        const parts = address.replace(/\\/g, '/').split('/').filter(Boolean);
        const containerName = parts.slice(0, -1).pop()?.toLowerCase().replace(/[^a-z0-9-]/g, '-') ?? 'input';

        config['containerName'] = containerName;
        const fileMask = receiveLocation.adapterProperties['FileMask'] ?? '*.xml';
        config['blobMatchingCondition'] = { matchWildcardPattern: fileMask };

        const pollingMs = parseInt(receiveLocation.adapterProperties['PollingInterval'] ?? '60000', 10);
        const intervalMin = Math.max(1, Math.round(pollingMs / 60000));
        config['recurrence'] = { frequency: 'Minute', interval: intervalMin };
      } else if (adapterType === 'SB-Messaging' || adapterType === 'WCF-NetMsmq' || adapterType === 'MSMQ') {
        // Service Bus — extract queue/topic name from address
        const address = receiveLocation.address;
        const queueName = address.split('/').pop() ?? 'messages';
        config['entityName'] = queueName;
        config['receiveMode'] = 'peekLock';
      } else if (adapterType === 'SQL') {
        config['query'] = receiveLocation.adapterProperties['PollingStatement'] ?? TODO_CLAUDE;
      }

      return {
        type: mapping.triggerType,
        source: `${adapterType} — ${receiveLocation.address}`,
        connector: onPrem ? (mapping.connector === 'azureblob' ? 'filesystem' : mapping.connector) : mapping.connector,
        config,
      };
    }
  }

  // Fallback: no activating receive found
  return {
    type: 'webhook',
    source: 'Unknown — no activating receive shape found',
    connector: 'request',
    config: {},
  };
}

// ─── Build a single step from a shape ─────────────────────────────────────────

function buildStepFromShape(
  shape: OdxShape,
  prevStepId: string | null,
  app: BizTalkApplication
): IntegrationStep | null {
  // Skip shapes that don't produce steps
  if (shape.shapeType === 'ReceiveShape' && shape.isActivating) return null; // activating → trigger
  if (shape.shapeType === 'CommentShape') return null;

  // Non-activating Receive → receive action
  if (shape.shapeType === 'ReceiveShape') {
    return {
      id: `step_${shape.name ?? shape.shapeId}_receive`,
      type: 'receive',
      description: `Receive message on correlated port (${shape.name ?? 'unnamed'})`,
      actionType: 'ServiceProvider',
      config: {},
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // Send → send step with adapter lookup
  if (shape.shapeType === 'SendShape') {
    // Try to find the matching send port in bindings
    let connector = 'request';
    let actionType = 'Http';
    const config: Record<string, unknown> = {};

    for (const binding of app.bindingFiles) {
      if (binding.sendPorts.length > 0) {
        const sp = binding.sendPorts[0]!; // simplified: use first send port
        const adapterType = sp.adapterType;
        const mapping = ADAPTER_TO_CONNECTOR[adapterType];
        if (mapping) {
          connector = mapping.connector;
          if (adapterType === 'FILE') {
            actionType = 'ServiceProvider';
            const address = sp.address;
            const parts = address.replace(/\\/g, '/').split('/').filter(Boolean);
            const containerName = parts.slice(0, -1).pop()?.toLowerCase().replace(/[^a-z0-9-]/g, '-') ?? 'output';
            config['containerName'] = containerName;
            config['blobName'] = "@{triggerBody()?['Name']}";
            config['content'] = TODO_CLAUDE;
          } else if (adapterType === 'HTTP' || adapterType.startsWith('WCF-')) {
            actionType = 'Http';
            config['method'] = 'POST';
            config['uri'] = sp.address || TODO_CLAUDE;
          } else if (adapterType === 'SB-Messaging' || adapterType === 'MSMQ') {
            actionType = 'ServiceProvider';
            config['entityName'] = sp.address.split('/').pop() ?? TODO_CLAUDE;
          }
        }
        break;
      }
    }

    return {
      id: `step_${shape.name ?? shape.shapeId}_send`,
      type: 'send',
      description: `Send message (${shape.name ?? 'unnamed'})`,
      connector,
      actionType,
      config,
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // Transform
  if (shape.shapeType === 'TransformShape') {
    return {
      id: `step_${shape.name ?? shape.shapeId}_transform`,
      type: 'transform',
      description: `Transform message using ${shape.mapClass ?? 'BizTalk map'}`,
      connector: 'integrationAccount',
      actionType: 'Xslt',
      config: { mapName: shape.mapClass ?? TODO_CLAUDE },
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // Decision — actionType starts as 'If'; enrichStepWithChildren() upgrades to 'Switch' if 3+ branches
  if (shape.shapeType === 'DecisionShape') {
    return {
      id: `step_${shape.name ?? shape.shapeId}_route`,
      type: 'condition',
      description: `Route by condition: ${shape.conditionExpression ?? 'condition'}`,
      actionType: 'If',
      config: { expression: TODO_CLAUDE },
      branches: { condition: shape.conditionExpression ?? TODO_CLAUDE },
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // Loop — condition must be INVERTED: BizTalk while(cond) → Logic Apps Until(!cond)
  if (shape.shapeType === 'LoopShape') {
    const rawCondition = shape.conditionExpression;
    return {
      id: `step_${shape.name ?? shape.shapeId}_loop`,
      type: 'loop',
      description: `Loop: ${rawCondition ?? 'condition'}`,
      actionType: 'Until',
      config: {
        untilExpression: rawCondition
          ? `TODO_CLAUDE_INVERT: ${rawCondition}`
          : TODO_CLAUDE,
        inversionRequired: true,
      },
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // Scope
  if (shape.shapeType === 'ScopeShape') {
    return {
      id: `step_${shape.name ?? shape.shapeId}_scope`,
      type: 'error-handler',
      description: `Error handling scope (${shape.transactionType ?? 'None'})`,
      actionType: 'Scope',
      config: { transactionType: shape.transactionType ?? 'None' },
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // Delay
  if (shape.shapeType === 'DelayShape') {
    return {
      id: `step_${shape.name ?? shape.shapeId}_delay`,
      type: 'delay',
      description: `Delay: ${shape.delayExpression ?? 'duration'}`,
      actionType: 'Delay',
      config: { duration: shape.delayExpression ?? TODO_CLAUDE },
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // Call/Start Orchestration
  if (shape.shapeType === 'CallOrchestrationShape' || shape.shapeType === 'StartOrchestrationShape') {
    return {
      id: `step_${shape.name ?? shape.shapeId}_child`,
      type: 'invoke-child',
      description: `Call orchestration: ${shape.calledOrchestration ?? 'unknown'}`,
      actionType: 'Workflow',
      config: { workflowName: shape.calledOrchestration ?? TODO_CLAUDE },
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // Call Rules (BRE)
  if (shape.shapeType === 'CallRulesShape') {
    return {
      id: `step_${shape.name ?? shape.shapeId}_bre`,
      type: 'invoke-function',
      description: `Call BRE policy: ${shape.rulePolicyName ?? 'unknown'} → migrate to Azure Rules Engine or Azure Function`,
      actionType: 'Workflow',
      config: { rulePolicyName: shape.rulePolicyName ?? TODO_CLAUDE },
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // Expression / MessageAssignment
  if (shape.shapeType === 'ExpressionShape' || shape.shapeType === 'MessageAssignmentShape') {
    // Skip CAT Framework instrumentation shapes — these are debug/trace calls
    // (Microsoft.BizTalk.CAT.BestPractices.Framework.Instrumentation) with no business logic.
    if (shape.codeExpression?.includes('Microsoft.BizTalk.CAT.BestPractices')) {
      return null;
    }
    return {
      id: `step_${shape.name ?? shape.shapeId}_expr`,
      type: 'set-variable',
      description: `Expression: ${shape.codeExpression?.substring(0, 60) ?? 'code expression'}`,
      actionType: shape.shapeType === 'MessageAssignmentShape' ? 'Compose' : 'SetVariable',
      config: { expression: shape.codeExpression ?? TODO_CLAUDE },
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // Terminate/Throw/Suspend
  if (shape.shapeType === 'TerminateShape' || shape.shapeType === 'ThrowShape' || shape.shapeType === 'SuspendShape') {
    return {
      id: `step_${shape.name ?? shape.shapeId}_terminate`,
      type: 'error-handler',
      description: `${shape.shapeType}: terminate or error`,
      actionType: 'Terminate',
      config: { runStatus: 'Failed' },
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // ConstructShape / RoleLinkShape — skip (container shapes with no direct LA equivalent)
  if (shape.shapeType === 'ConstructShape' || shape.shapeType === 'RoleLinkShape') {
    return null;
  }

  // GroupShape — processShapes() handles this before calling buildStepFromShape(); return null here
  // so that any direct calls don't produce an action.  GroupShape content is processed via enrichStepWithChildren().
  if (shape.shapeType === 'GroupShape') {
    return null;
  }

  // Parallel
  if (shape.shapeType === 'ParallelActionsShape') {
    return {
      id: `step_${shape.name ?? shape.shapeId}_parallel`,
      type: 'parallel',
      description: 'Parallel actions',
      actionType: 'parallel-group',
      config: {},
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // ListenShape — no direct Logic Apps equivalent.
  // BizTalk Listen waits for the first of multiple branches to fire (first-event-wins).
  // Pattern: separate workflows per event type, all call a shared child workflow.
  if (shape.shapeType === 'ListenShape') {
    return {
      id: `step_${shape.name ?? shape.shapeId}_listen`,
      type: 'set-variable',
      description: 'ListenShape: no direct Logic Apps equivalent — redesign as concurrent workflows or Event Grid',
      actionType: 'Compose',
      config: {
        migrationNote: 'REDESIGN REQUIRED: ListenShape has no Logic Apps equivalent. ' +
          'Create separate trigger workflows per event type; route all to a shared child workflow.',
        originalShape: 'ListenShape',
      },
      runAfter: prevStepId ? [prevStepId] : [],
    };
  }

  // Fallback
  return {
    id: `step_${shape.name ?? shape.shapeId}_${shape.shapeType.toLowerCase()}`,
    type: 'set-variable',
    description: `Unmapped shape: ${shape.shapeType} (${shape.name ?? 'unnamed'})`,
    actionType: 'Compose',
    config: { shapeType: shape.shapeType, originalExpression: shape.codeExpression ?? null },
    runAfter: prevStepId ? [prevStepId] : [],
  };
}

// ─── Recursive shape processing ────────────────────────────────────────────────

/**
 * Enriches a container step with branch/loop/scope content from its children.
 * Called after buildStepFromShape() for any shape that can have children.
 *
 * - DecisionShape (2 branches): produces If with trueBranch / falseBranch
 * - DecisionShape (3+ branches): upgrades actionType to 'Switch', produces cases[]
 * - LoopShape: populates trueBranch with loop body steps
 * - ScopeShape: trueBranch = main body; falseBranch = Catch handler steps (runAfter FAILED)
 * - ParallelActionsShape: produces cases[] — one per parallel branch
 */
function enrichStepWithChildren(
  step: IntegrationStep,
  shape: OdxShape,
  app: BizTalkApplication
): void {
  if (!shape.children || shape.children.length === 0) return;

  if (shape.shapeType === 'DecisionShape') {
    const branchGroups = shape.children.filter(c => c.shapeType === 'GroupShape');
    if (branchGroups.length >= 3) {
      // 3+ branches → Switch action
      step.actionType = 'Switch';
      const nonDefault = branchGroups.slice(0, -1);
      const defaultBranch = branchGroups[branchGroups.length - 1]!;
      step.branches = {
        cases: nonDefault.map(branch => ({
          value: branch.conditionExpression ?? TODO_CLAUDE,
          steps: processShapes(branch.children ?? [], app, null),
        })),
        defaultSteps: processShapes(defaultBranch.children ?? [], app, null),
      };
    } else if (branchGroups.length === 2) {
      // 2 branches → If
      step.branches = {
        condition: shape.conditionExpression ?? TODO_CLAUDE,
        trueBranch:  processShapes(branchGroups[0]?.children ?? [], app, null),
        falseBranch: processShapes(branchGroups[1]?.children ?? [], app, null),
      };
    } else if (branchGroups.length === 1) {
      // Single branch (no else)
      step.branches = {
        condition:  shape.conditionExpression ?? TODO_CLAUDE,
        trueBranch: processShapes(branchGroups[0]?.children ?? [], app, null),
      };
    }
    return;
  }

  if (shape.shapeType === 'LoopShape') {
    // Loop body: all non-GroupShape children
    const bodyShapes = shape.children.filter(c => c.shapeType !== 'GroupShape');
    step.branches = {
      trueBranch: processShapes(bodyShapes, app, null),
    };
    return;
  }

  if (shape.shapeType === 'ScopeShape') {
    // Main body: non-GroupShape children; error handlers: GroupShape (Catch) children
    const catchGroups  = shape.children.filter(c => c.shapeType === 'GroupShape');
    const mainBody     = shape.children.filter(c => c.shapeType !== 'GroupShape');
    const trueBranch   = processShapes(mainBody, app, null);
    const falseBranch  = catchGroups.flatMap(g => processShapes(g.children ?? [], app, null));
    step.branches = {
      ...(trueBranch.length > 0  ? { trueBranch }  : {}),
      ...(falseBranch.length > 0 ? { falseBranch } : {}),
    };
    return;
  }

  if (shape.shapeType === 'ParallelActionsShape') {
    const parallelBranches = shape.children.filter(c => c.shapeType === 'GroupShape');
    step.branches = {
      cases: parallelBranches.map((branch, i) => ({
        value: `parallel_branch_${i + 1}`,
        steps: processShapes(branch.children ?? [], app, null),
      })),
    };
    return;
  }
}

/**
 * Recursively processes an array of OdxShapes into IntegrationSteps.
 *
 * - Handles GroupShape at this level: processes its children as flat steps
 *   (GroupShape at the TOP level = orphaned branch — treat as a linear sequence)
 * - For container shapes (Decision/Loop/Scope/Parallel): calls enrichStepWithChildren()
 *   so branch content is attached to the parent step's branches field.
 * - prevId threads the runAfter chain through the linear sequence.
 */
/**
 * Tags all steps (including nested branch steps) with the source orchestration name.
 * This enables per-orchestration step filtering in the build stage.
 */
function tagStepsWithOrchestration(steps: IntegrationStep[], orchName: string): void {
  for (const step of steps) {
    step.sourceOrchestration = orchName;
    // Recurse into branch children
    if (step.branches) {
      if (step.branches.trueBranch) tagStepsWithOrchestration(step.branches.trueBranch, orchName);
      if (step.branches.falseBranch) tagStepsWithOrchestration(step.branches.falseBranch, orchName);
      if (step.branches.cases) {
        for (const c of step.branches.cases) tagStepsWithOrchestration(c.steps, orchName);
      }
      if (step.branches.defaultSteps) tagStepsWithOrchestration(step.branches.defaultSteps, orchName);
    }
  }
}

function processShapes(
  shapes: OdxShape[],
  app: BizTalkApplication,
  prevId: string | null
): IntegrationStep[] {
  const result: IntegrationStep[] = [];
  let currentPrevId = prevId;

  for (const shape of shapes) {
    // GroupShape at this level: treat children as inline steps (Catch/DecisionBranch at top)
    if (shape.shapeType === 'GroupShape') {
      if (shape.children && shape.children.length > 0) {
        const childSteps = processShapes(shape.children, app, currentPrevId);
        result.push(...childSteps);
        if (childSteps.length > 0) {
          currentPrevId = childSteps[childSteps.length - 1]!.id;
        }
      }
      continue;
    }

    const step = buildStepFromShape(shape, currentPrevId, app);
    if (step === null) continue;

    // Attach branch/body content for container shapes
    enrichStepWithChildren(step, shape, app);

    result.push(step);
    currentPrevId = step.id;
  }

  return result;
}

// ─── Build systems from binding files ──────────────────────────────────────────

function buildSystems(app: BizTalkApplication): ExternalSystem[] {
  const systems: ExternalSystem[] = [];
  const seen = new Set<string>();

  for (const binding of app.bindingFiles) {
    for (const rl of binding.receiveLocations) {
      const key = `${rl.adapterType}-source`;
      if (seen.has(key)) continue;
      seen.add(key);
      const onPrem = isOnPrem(rl.adapterType, rl.address);
      const sourceSystem: ExternalSystem = {
        name: `${rl.adapterType} Source`,
        protocol: rl.adapterType,
        role: 'source',
        authentication: 'connection-string',
        onPremises: onPrem,
        requiresGateway: requiresGateway(rl.adapterType, rl.address),
      };
      if (!onPrem) sourceSystem.endpoint = rl.address;
      systems.push(sourceSystem);
    }

    for (const sp of binding.sendPorts) {
      const key = `${sp.adapterType}-destination`;
      if (seen.has(key)) continue;
      seen.add(key);
      const onPrem = isOnPrem(sp.adapterType, sp.address);
      const destSystem: ExternalSystem = {
        name: `${sp.adapterType} Destination`,
        protocol: sp.adapterType,
        role: 'destination',
        authentication: 'connection-string',
        onPremises: onPrem,
        requiresGateway: requiresGateway(sp.adapterType, sp.address),
      };
      if (!onPrem) destSystem.endpoint = sp.address;
      systems.push(destSystem);
    }
  }

  return systems;
}

// ─── Detect error handling strategy ────────────────────────────────────────────

function detectErrorStrategy(app: BizTalkApplication): { strategy: ErrorStrategy } {
  for (const orch of app.orchestrations) {
    const allShapes = flattenShapes(orch.shapes);
    const hasScope = allShapes.some(s => s.shapeType === 'ScopeShape');
    const hasTerminate = allShapes.some(s => s.shapeType === 'TerminateShape');
    const hasCompensate = allShapes.some(s => s.shapeType === 'CompensateShape');

    if (hasCompensate) return { strategy: 'compensate' };
    if (hasScope && hasTerminate) return { strategy: 'terminate' };
    if (hasScope) return { strategy: 'retry' };
  }
  return { strategy: 'terminate' };
}

// ─── Main export: constructIntent ──────────────────────────────────────────────

/**
 * Mechanically converts a BizTalkApplication to a partial IntegrationIntent.
 *
 * The resulting intent has TODO_CLAUDE markers where Claude's reasoning is needed:
 * - Expression translations (XLANG/s → WDL)
 * - Connector-specific configurations
 * - Ambiguous shape mappings
 *
 * Claude must enrich these markers before passing to validate_intent + build_package.
 */
export function constructIntent(
  app: BizTalkApplication,
  patterns?: IntegrationPattern[]
): IntegrationIntent {
  const trigger = buildTrigger(app);
  const systems = buildSystems(app);
  const errorHandlingResult = detectErrorStrategy(app);

  // Build steps from all orchestrations (recursive — branches and loop bodies included).
  // Each orchestration gets an independent step chain (prevId resets per orchestration)
  // and each step is tagged with sourceOrchestration for per-workflow partitioning.
  const steps: IntegrationStep[] = [];

  for (const orch of app.orchestrations) {
    // Reset prevId per orchestration — steps in different orchestrations are independent
    const orchPrevId: string | null = null;
    const orchSteps = processShapes(orch.shapes, app, orchPrevId);
    // Tag each step (and recursively its branch children) with the orchestration name
    tagStepsWithOrchestration(orchSteps, orch.name);
    steps.push(...orchSteps);
  }

  // Add comment steps for custom pipeline components so they appear in gap analysis.
  // These are not tied to a specific orchestration, so they have no runAfter.
  for (const pipeline of app.pipelines) {
    if (pipeline.hasCustomComponents) {
      const customComps = pipeline.components.filter(c => c.isCustom);
      for (const comp of customComps) {
        const safeId = `${pipeline.name}_${comp.componentType}`.replace(/[^a-zA-Z0-9]/g, '_');
        const compStep: IntegrationStep = {
          id: `step_pipeline_${safeId}`,
          type: 'set-variable',
          description: `CUSTOM_PIPELINE: ${comp.fullTypeName} — use Local Code Function`,
          actionType: 'Compose',
          config: {
            note: `TODO_CLAUDE: custom pipeline component requires migration to Local Code Function: ${comp.fullTypeName}`,
          },
          runAfter: [],
        };
        steps.push(compStep);
      }
    }
  }

  // Detect data formats from pipelines
  let inputFormat: DataFormat = 'xml';
  let outputFormat: DataFormat = 'xml';
  for (const binding of app.bindingFiles) {
    for (const rl of binding.receiveLocations) {
      inputFormat = detectDataFormat(rl.pipelineName);
    }
    for (const sp of binding.sendPorts) {
      outputFormat = detectDataFormat(sp.pipelineName);
    }
  }

  // Determine if Integration Account is required
  const requiresIntegrationAccount = app.maps.length > 0 ||
    app.orchestrations.some(o => o.hasBRECalls) ||
    inputFormat === 'edi-x12' || inputFormat === 'edi-edifact' ||
    outputFormat === 'edi-x12' || outputFormat === 'edi-edifact';

  // Determine if on-premises gateway required
  const requiresOnPremGateway = systems.some(s => s.requiresGateway);

  // Determine complexity
  const complexity: 'simple' | 'moderate' | 'complex' =
    app.complexityClassification === 'highly-complex' ? 'complex' :
    app.complexityClassification === 'complex' ? 'complex' :
    app.complexityClassification === 'moderate' ? 'moderate' : 'simple';

  return createIntegrationIntent('biztalk-migration', {
    trigger,
    steps,
    errorHandling: {
      strategy: errorHandlingResult.strategy,
      ...(errorHandlingResult.strategy === 'retry' ? {
        retryPolicy: { count: 3, interval: 'PT30S', type: 'fixed' }
      } : {}),
    },
    systems,
    dataFormats: { input: inputFormat, output: outputFormat },
    patterns: patterns ?? [],
    metadata: {
      source: 'biztalk-migration',
      complexity,
      estimatedActions: steps.length + 2, // steps + trigger + error handler
      requiresIntegrationAccount,
      requiresOnPremGateway,
      ...(app.orchestrations[0]?.name ? { sourceOrchestrationName: app.orchestrations[0].name } : {}),
    },
  });
}
