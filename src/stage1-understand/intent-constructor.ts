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

  // Decision
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

  // Loop
  if (shape.shapeType === 'LoopShape') {
    return {
      id: `step_${shape.name ?? shape.shapeId}_loop`,
      type: 'loop',
      description: `Loop: ${shape.conditionExpression ?? 'condition'}`,
      actionType: 'Until',
      config: { untilExpression: shape.conditionExpression ?? TODO_CLAUDE },
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

  // ConstructShape / GroupShape / RoleLinkShape — skip (container shapes)
  if (shape.shapeType === 'ConstructShape' || shape.shapeType === 'GroupShape' || shape.shapeType === 'RoleLinkShape') {
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

  // Build steps from all orchestrations (flattened)
  const steps: IntegrationStep[] = [];
  let prevId: string | null = null;

  for (const orch of app.orchestrations) {
    // Process top-level shapes sequentially (not recursive — branches handled separately)
    for (const shape of orch.shapes) {
      const step = buildStepFromShape(shape, prevId, app);
      if (step) {
        steps.push(step);
        prevId = step.id;
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
