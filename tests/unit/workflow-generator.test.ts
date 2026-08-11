/**
 * Unit tests for Stage 3 — Workflow Generator
 * Validates WDL JSON structure of generated Logic Apps workflows.
 *
 * generateWorkflow() returns WorkflowJson = { definition: WorkflowDefinition, kind: ... }
 * Access triggers via wf.definition.triggers, not wf.workflow.definition.triggers.
 */

import { generateWorkflow } from '../../src/stage3-build/workflow-generator.js';
import type { IntegrationIntent } from '../../src/shared/integration-intent.js';

function makeIntent(overrides: Partial<IntegrationIntent> = {}): IntegrationIntent {
  return {
    trigger: {
      type:      'polling',
      source:    'Service Bus queue',
      connector: 'serviceBus',
      config:    {},
    },
    steps: [],
    errorHandling: { strategy: 'retry' },
    systems: [],
    dataFormats: { input: 'xml', output: 'xml' },
    patterns: [],
    metadata: {
      source:                    'biztalk-migration',
      complexity:                'simple',
      estimatedActions:          0,
      requiresIntegrationAccount: false,
      requiresOnPremGateway:     false,
    },
    ...overrides,
  };
}

// ─── Basic Generation ─────────────────────────────────────────────────────────

describe('generateWorkflow — basic structure', () => {
  const wf = generateWorkflow(makeIntent());

  it('returns a workflow object', () => {
    expect(wf).toBeDefined();
  });

  it('has a workflow definition', () => {
    expect(wf.definition).toBeDefined();
  });

  it('has at least one trigger', () => {
    const triggers = Object.keys(wf.definition.triggers);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('actions is a record', () => {
    expect(typeof wf.definition.actions).toBe('object');
  });

  it('has the correct WDL $schema', () => {
    expect(wf.definition.$schema).toContain('workflowdefinition');
  });
});

// ─── Trigger Types ────────────────────────────────────────────────────────────

describe('generateWorkflow — webhook trigger', () => {
  const intent = makeIntent({
    trigger: { type: 'webhook', source: 'REST API', connector: 'request', config: {} },
  });
  const wf = generateWorkflow(intent);

  it('produces a Request trigger for webhook type', () => {
    const trigger = Object.values(wf.definition.triggers)[0];
    expect(trigger?.type).toBe('Request');
  });
});

describe('generateWorkflow — schedule trigger', () => {
  const intent = makeIntent({
    trigger: { type: 'schedule', source: 'timer', connector: 'recurrence', config: { frequency: 'Hour', interval: 1 } },
  });
  const wf = generateWorkflow(intent);

  it('produces a Recurrence trigger for schedule type', () => {
    const trigger = Object.values(wf.definition.triggers)[0];
    expect(trigger?.type).toBe('Recurrence');
  });
});

// ─── Steps → Actions ──────────────────────────────────────────────────────────

describe('generateWorkflow — with steps', () => {
  const intent = makeIntent({
    steps: [
      {
        id: 'step1',
        type: 'transform',
        description: 'Transform message',
        connector: 'xml',
        config: {},
        runAfter: [],
      },
      {
        id: 'step2',
        type: 'send',
        description: 'Send to Service Bus',
        connector: 'serviceBus',
        config: { queueOrTopicName: 'orders' },
        runAfter: ['step1'],
      },
    ],
  });
  const wf = generateWorkflow(intent);

  it('generates actions from steps', () => {
    const actionCount = Object.keys(wf.definition.actions).length;
    expect(actionCount).toBeGreaterThan(0);
  });
});

// ─── Options ──────────────────────────────────────────────────────────────────

describe('generateWorkflow — options', () => {
  it('generates Stateless kind when specified', () => {
    const wf = generateWorkflow(makeIntent(), { kind: 'Stateless' });
    expect(wf.kind).toBe('Stateless');
  });

  it('generates Stateful kind by default', () => {
    const wf = generateWorkflow(makeIntent());
    expect(wf.kind).toBe('Stateful');
  });
});

// ─── Send Actions — actionType/connector contract ─────────────────────────────

type AnyAction = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper for untyped action assertions

function actions(wf: ReturnType<typeof generateWorkflow>): Record<string, AnyAction> {
  return wf.definition.actions as Record<string, AnyAction>;
}

describe('generateWorkflow — ServiceProvider send actions', () => {
  it('generates a ServiceProvider blob action for connector azureblob (not HTTP)', () => {
    const wf = generateWorkflow(makeIntent({
      steps: [{
        id: 'step_send_blob',
        type: 'send',
        description: 'Write processed order',
        connector: 'azureblob',
        actionType: 'ServiceProvider',
        config: {
          containerName: 'orders-outbound',
          blobName: "@{triggerBody()?['Name']}",
          content: "@{body('Transform_Order')}",
        },
        runAfter: [],
      }],
    }));

    const action = actions(wf)['Write_Processed_Order'];
    expect(action?.type).toBe('ServiceProvider');
    expect(action?.inputs.serviceProviderConfiguration).toEqual({
      connectionName:    'azureblob',
      operationId:       'createBlob',
      serviceProviderId: '/serviceProviders/AzureBlob',
    });
    expect(action?.inputs.parameters).toEqual({
      containerName: 'orders-outbound',
      blobName: "@{triggerBody()?['Name']}",
      content: "@{body('Transform_Order')}",
    });
  });

  it('generates an SFTP uploadFile action with payload defaulted from the predecessor', () => {
    const wf = generateWorkflow(makeIntent({
      steps: [
        {
          id: 'step_transform',
          type: 'transform',
          description: 'Transform order',
          actionType: 'Xslt',
          config: { mapName: 'OrderMap' },
          runAfter: [],
        },
        {
          id: 'step_send_sftp',
          type: 'send',
          description: 'Upload result',
          connector: 'sftp',
          actionType: 'ServiceProvider',
          config: { filePath: '/out/result.xml' },
          runAfter: ['step_transform'],
        },
      ],
    }));

    const action = actions(wf)['Upload_Result'];
    expect(action?.type).toBe('ServiceProvider');
    expect(action?.inputs.serviceProviderConfiguration.operationId).toBe('uploadFile');
    expect(action?.inputs.serviceProviderConfiguration.serviceProviderId).toBe('/serviceProviders/sftpWithSsh');
    expect(action?.inputs.parameters['filePath']).toBe('/out/result.xml');
    // Payload defaults to the PREDECESSOR ACTION NAME — never the raw description
    expect(action?.inputs.parameters['content']).toBe("@{body('Transform_Order')}");
  });

  it('replaces a TODO_CLAUDE content sentinel with the predecessor body reference', () => {
    const wf = generateWorkflow(makeIntent({
      steps: [
        {
          id: 'step_transform',
          type: 'transform',
          description: 'Transform order',
          actionType: 'Xslt',
          config: { mapName: 'OrderMap' },
          runAfter: [],
        },
        {
          id: 'step_send_blob',
          type: 'send',
          description: 'Send message',
          connector: 'azureblob',
          actionType: 'ServiceProvider',
          config: { containerName: 'out', content: 'TODO_CLAUDE' },
          runAfter: ['step_transform'],
        },
      ],
    }));

    const action = actions(wf)['Send_Message'];
    expect(action?.inputs.parameters['content']).toBe("@{body('Transform_Order')}");
  });

  it('Service Bus send honors the entityName config key written by Stage 1', () => {
    const wf = generateWorkflow(makeIntent({
      steps: [{
        id: 'step_send_sb',
        type: 'send',
        description: 'Send to queue',
        connector: 'serviceBus',
        actionType: 'ServiceProvider',
        config: { entityName: 'orders-queue' },
        runAfter: [],
      }],
    }));

    const action = actions(wf)['Send_To_Queue'];
    expect(action?.type).toBe('ServiceProvider');
    expect(action?.inputs.parameters['entityName']).toBe('orders-queue');
  });

  it('Service Bus send message body references the predecessor action, not the description', () => {
    const wf = generateWorkflow(makeIntent({
      steps: [
        {
          id: 'step_transform',
          type: 'transform',
          description: 'Transform order',
          actionType: 'Xslt',
          config: { mapName: 'OrderMap' },
          runAfter: [],
        },
        {
          id: 'step_send_sb',
          type: 'send',
          description: 'Send to Service Bus (Port_1)',
          connector: 'serviceBus',
          config: { queueOrTopicName: 'orders' },
          runAfter: ['step_transform'],
        },
      ],
    }));

    const action = Object.values(actions(wf)).find(a => a.type === 'ServiceProvider');
    expect(action?.inputs.parameters.message.body).toBe("@{base64(body('Transform_Order'))}");
  });

  it('HTTP send body references triggerBody() when the send is the first action', () => {
    const wf = generateWorkflow(makeIntent({
      steps: [{
        id: 'step_send_http',
        type: 'send',
        description: 'Post order (Port_2)',
        connector: 'request',
        actionType: 'Http',
        config: { uri: 'https://example.com/orders' },
        runAfter: [],
      }],
    }));

    const action = Object.values(actions(wf)).find(a => a.type === 'Http');
    expect(action?.inputs.body).toBe('@{triggerBody()}');
    expect(action?.inputs.body).not.toContain('Port_2');
  });
});

// ─── Trigger — nested recurrence config ───────────────────────────────────────

describe('generateWorkflow — ServiceProvider trigger recurrence', () => {
  const wf = generateWorkflow(makeIntent({
    trigger: {
      type: 'polling',
      source: 'Azure Blob container',
      connector: 'azureblob',
      config: {
        containerName: 'orders-inbound',
        blobMatchingCondition: { matchWildcardPattern: '*.xml' },
        recurrence: { frequency: 'Minute', interval: 1 },
      },
    },
  }));
  const trigger = Object.values(wf.definition.triggers)[0] as AnyAction;

  it('reads the nested recurrence config written by Stage 1', () => {
    expect(trigger.recurrence).toEqual({ frequency: 'Minute', interval: 1 });
  });

  it('does not leak the recurrence object into inputs.parameters', () => {
    expect(trigger.inputs.parameters['recurrence']).toBeUndefined();
    expect(trigger.inputs.parameters['containerName']).toBe('orders-inbound');
  });

  it('resolves the canonical serviceProviderId for the azureblob connector', () => {
    expect(trigger.inputs.serviceProviderConfiguration.serviceProviderId)
      .toBe('/serviceProviders/AzureBlob');
    expect(trigger.inputs.serviceProviderConfiguration.operationId)
      .toBe('whenABlobIsAddedOrModified');
  });
});

// ─── Error Handlers — handlesErrorFrom + Terminate ────────────────────────────

describe('generateWorkflow — error handling contract', () => {
  it('catch handler scope runs after the watched scope FAILED, not SUCCEEDED', () => {
    const wf = generateWorkflow(makeIntent({
      steps: [
        {
          id: 'step_scope',
          type: 'error-handler',
          description: 'Main scope',
          actionType: 'Scope',
          config: {},
          runAfter: [],
          branches: {
            trueBranch: [{
              id: 'step_body',
              type: 'set-variable',
              description: 'Do work',
              actionType: 'SetVariable',
              config: { variableName: 'x', value: '1' },
              runAfter: [],
            }],
          },
        },
        {
          id: 'step_scope_catch',
          type: 'error-handler',
          description: 'Handle error from scope',
          actionType: 'Scope',
          config: {},
          runAfter: [],
          handlesErrorFrom: 'step_scope',
          branches: {
            trueBranch: [{
              id: 'step_handler',
              type: 'set-variable',
              description: 'Log failure',
              actionType: 'SetVariable',
              config: { variableName: 'err', value: 'failed' },
              runAfter: [],
            }],
          },
        },
      ],
    }));

    const catchAction = actions(wf)['Handle_Error_From_Scope'];
    expect(catchAction?.type).toBe('Scope');
    expect(catchAction?.runAfter).toEqual({ Main_Scope: ['FAILED', 'TIMEDOUT'] });
  });

  it('Terminate steps generate a Terminate action, not an empty Scope', () => {
    const wf = generateWorkflow(makeIntent({
      steps: [{
        id: 'step_terminate',
        type: 'error-handler',
        description: 'TerminateShape: terminate or error',
        actionType: 'Terminate',
        config: { runStatus: 'Failed' },
        runAfter: [],
      }],
    }));

    const action = Object.values(actions(wf)).find(a => a.type === 'Terminate');
    expect(action).toBeDefined();
    expect(action?.inputs.runStatus).toBe('Failed');
    expect(action?.inputs.runError?.message).toBeDefined();
    expect(Object.values(actions(wf)).some(a => a.type === 'Scope')).toBe(false);
  });
});

// ─── Loops — loopConfig contract ──────────────────────────────────────────────

describe('generateWorkflow — loopConfig', () => {
  it('generates a Foreach action when loopConfig.iterateOver is set', () => {
    const wf = generateWorkflow(makeIntent({
      steps: [{
        id: 'step_loop',
        type: 'loop',
        description: 'Process each item',
        actionType: 'Foreach',
        config: {},
        loopConfig: { iterateOver: "@body('Parse')?['items']" },
        runAfter: [],
        branches: {
          trueBranch: [{
            id: 'step_item',
            type: 'set-variable',
            description: 'Handle item',
            actionType: 'SetVariable',
            config: { variableName: 'current', value: '@item()' },
            runAfter: [],
          }],
        },
      }],
    }));

    const action = actions(wf)['Process_Each_Item'];
    expect(action?.type).toBe('Foreach');
    expect(action?.foreach).toBe("@body('Parse')?['items']");
  });

  it('generates an Until action with inverted condition from loopConfig.untilExpression', () => {
    const wf = generateWorkflow(makeIntent({
      steps: [{
        id: 'step_loop',
        type: 'loop',
        description: 'Retry loop',
        actionType: 'Until',
        config: {},
        loopConfig: { untilExpression: 'TODO_CLAUDE_INVERT: counter < 3' },
        runAfter: [],
      }],
    }));

    const action = actions(wf)['Retry_Loop'];
    expect(action?.type).toBe('Until');
    expect(action?.expression).toBe("@greaterOrEquals(variables('counter'), 3)");
  });
});

// ─── Retry Policy — intent errorHandling honored ──────────────────────────────

describe('generateWorkflow — retry policy from intent', () => {
  const retryIntent = makeIntent({
    errorHandling: {
      strategy: 'retry',
      retryPolicy: { count: 5, interval: 'PT1M', type: 'exponential' },
    },
    steps: [
      {
        id: 'step_send_http',
        type: 'send',
        description: 'Post order',
        connector: 'request',
        actionType: 'Http',
        config: { uri: 'https://example.com' },
        runAfter: [],
      },
      {
        id: 'step_send_blob',
        type: 'send',
        description: 'Write blob',
        connector: 'azureblob',
        actionType: 'ServiceProvider',
        config: { containerName: 'out' },
        runAfter: ['step_send_http'],
      },
    ],
  });
  const wf = generateWorkflow(retryIntent);

  it('HTTP send uses the intent retry policy instead of the hardcoded default', () => {
    const http = Object.values(actions(wf)).find(a => a.type === 'Http');
    expect(http?.retryPolicy).toEqual({ type: 'exponential', count: 5, interval: 'PT1M' });
  });

  it('ServiceProvider send carries the intent retry policy', () => {
    const sp = Object.values(actions(wf)).find(a => a.type === 'ServiceProvider');
    expect(sp?.retryPolicy).toEqual({ type: 'exponential', count: 5, interval: 'PT1M' });
  });

  it('HTTP send falls back to the default retry policy when the intent has none', () => {
    const wfDefault = generateWorkflow(makeIntent({
      steps: [{
        id: 'step_send_http',
        type: 'send',
        description: 'Post order',
        connector: 'request',
        actionType: 'Http',
        config: {},
        runAfter: [],
      }],
    }));
    const http = Object.values(actions(wfDefault)).find(a => a.type === 'Http');
    expect(http?.retryPolicy).toEqual({ type: 'fixed', count: 3, interval: 'PT30S' });
  });
});
