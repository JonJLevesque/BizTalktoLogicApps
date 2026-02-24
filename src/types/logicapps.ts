/**
 * Azure Logic Apps type definitions.
 * These types represent Logic Apps Standard artifacts that the Build stage generates.
 * All JSON structures conform to Workflow Definition Language (WDL) schema:
 * https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json
 */

// ─── Workflow Definition Language (WDL) ──────────────────────────────────────

/** Status values used in runAfter — ALL CAPS as required by Logic Apps Standard runtime */
export type RunAfterStatus = 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'TIMEDOUT';

export type RunAfterMap = Record<string, RunAfterStatus[]>;

export type RetryPolicyType = 'fixed' | 'exponential' | 'none';

export interface RetryPolicy {
  type: RetryPolicyType;
  count?: number;
  /** ISO 8601 duration, e.g. "PT10S" */
  interval?: string;
  /** ISO 8601 duration — exponential only */
  minimumInterval?: string;
  /** ISO 8601 duration — exponential only */
  maximumInterval?: string;
}

// ─── Trigger Types ────────────────────────────────────────────────────────────

export interface RecurrenceTrigger {
  type: 'Recurrence';
  recurrence: {
    frequency: 'Second' | 'Minute' | 'Hour' | 'Day' | 'Week' | 'Month';
    interval: number;
    startTime?: string;
    timeZone?: string;
  };
}

export interface HttpRequestTrigger {
  type: 'Request';
  kind: 'Http';
  inputs?: {
    schema?: Record<string, unknown>;
    method?: string;
    relativePath?: string;
  };
}

export interface ServiceProviderTrigger {
  type: 'ServiceProvider';
  inputs: {
    parameters: Record<string, unknown>;
    serviceProviderConfiguration: ServiceProviderConfiguration;
  };
  recurrence?: RecurrenceTrigger['recurrence'];
}

export type WdlTrigger =
  | RecurrenceTrigger
  | HttpRequestTrigger
  | ServiceProviderTrigger;

// ─── Action Types ─────────────────────────────────────────────────────────────

export interface ServiceProviderConfiguration {
  connectionName: string;
  operationId: string;
  serviceProviderId: string;
}

export interface ServiceProviderAction {
  type: 'ServiceProvider';
  inputs: {
    parameters: Record<string, unknown>;
    serviceProviderConfiguration: ServiceProviderConfiguration;
  };
  runAfter?: RunAfterMap;
  retryPolicy?: RetryPolicy;
}

export interface HttpAction {
  type: 'Http';
  inputs: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    uri: string;
    headers?: Record<string, string>;
    body?: unknown;
    authentication?: HttpAuthentication;
    queries?: Record<string, string>;
  };
  runAfter?: RunAfterMap;
  retryPolicy?: RetryPolicy;
}

export type HttpAuthType = 'None' | 'Basic' | 'ClientCertificate' | 'ActiveDirectoryOAuth' | 'ManagedServiceIdentity';

export interface HttpAuthentication {
  type: HttpAuthType;
  username?: string;
  password?: string;
  pfx?: string;
  password_cert?: string;
  tenant?: string;
  audience?: string;
  clientId?: string;
  secret?: string;
}

export interface ComposeAction {
  type: 'Compose';
  inputs: unknown;
  runAfter?: RunAfterMap;
}

export interface ParseJsonAction {
  type: 'ParseJson';
  inputs: {
    content: string;
    schema: Record<string, unknown>;
  };
  runAfter?: RunAfterMap;
}

export interface IfAction {
  type: 'If';
  expression: WdlExpression;
  actions: Record<string, WdlAction>;
  else?: { actions: Record<string, WdlAction> };
  runAfter?: RunAfterMap;
}

export interface SwitchAction {
  type: 'Switch';
  expression: string;
  cases: Record<string, { case: string; actions: Record<string, WdlAction> }>;
  default?: { actions: Record<string, WdlAction> };
  runAfter?: RunAfterMap;
}

export interface ForEachAction {
  type: 'Foreach';
  foreach: string;
  actions: Record<string, WdlAction>;
  runtimeConfiguration?: {
    concurrency?: { repetitions: number };
  };
  runAfter?: RunAfterMap;
}

export interface UntilAction {
  type: 'Until';
  expression: string;
  limit: {
    count?: number;
    /** ISO 8601 duration */
    timeout?: string;
  };
  actions: Record<string, WdlAction>;
  runAfter?: RunAfterMap;
}

export interface ScopeAction {
  type: 'Scope';
  actions: Record<string, WdlAction>;
  runAfter?: RunAfterMap;
}

export interface TerminateAction {
  type: 'Terminate';
  inputs: {
    runStatus: 'Failed' | 'Cancelled';
    runError?: {
      code?: string;
      message?: string;
    };
  };
  runAfter?: RunAfterMap;
}

export interface ResponseAction {
  type: 'Response';
  kind: 'Http';
  inputs: {
    statusCode: number;
    headers?: Record<string, string>;
    body?: unknown;
    schema?: Record<string, unknown>;
  };
  runAfter?: RunAfterMap;
}

export interface DelayAction {
  type: 'Delay';
  inputs: {
    interval: {
      count: number;
      unit: 'Second' | 'Minute' | 'Hour' | 'Day' | 'Week' | 'Month';
    };
  };
  runAfter?: RunAfterMap;
}

export interface DelayUntilAction {
  type: 'DelayUntil';
  inputs: {
    timestamp: string;
  };
  runAfter?: RunAfterMap;
}

export interface InitializeVariableAction {
  type: 'InitializeVariable';
  inputs: {
    variables: Array<{
      name: string;
      type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'object';
      value?: unknown;
    }>;
  };
  runAfter?: RunAfterMap;
}

export interface SetVariableAction {
  type: 'SetVariable';
  inputs: {
    name: string;
    value: unknown;
  };
  runAfter?: RunAfterMap;
}

export interface IncrementVariableAction {
  type: 'IncrementVariable';
  inputs: {
    name: string;
    value: number;
  };
  runAfter?: RunAfterMap;
}

export interface AppendToArrayVariableAction {
  type: 'AppendToArrayVariable';
  inputs: {
    name: string;
    value: unknown;
  };
  runAfter?: RunAfterMap;
}

/** Child workflow call — Logic Apps Standard only */
export interface WorkflowAction {
  type: 'Workflow';
  inputs: {
    host: {
      workflow: { id: string };
    };
    headers?: Record<string, string>;
    body?: unknown;
  };
  runAfter?: RunAfterMap;
}

export interface TransformAction {
  type: 'Xslt';
  inputs: {
    content: string;
    integrationAccount?: {
      map: { name: string };
    };
    /** For Standard: local map file reference */
    xsltParameters?: Record<string, string>;
  };
  runAfter?: RunAfterMap;
}

export type WdlAction =
  | ServiceProviderAction
  | HttpAction
  | ComposeAction
  | ParseJsonAction
  | IfAction
  | SwitchAction
  | ForEachAction
  | UntilAction
  | ScopeAction
  | TerminateAction
  | ResponseAction
  | DelayAction
  | DelayUntilAction
  | InitializeVariableAction
  | SetVariableAction
  | IncrementVariableAction
  | AppendToArrayVariableAction
  | WorkflowAction
  | TransformAction;

// ─── WDL Expression ──────────────────────────────────────────────────────────

/** Simple equality expression for If conditions */
export interface SimpleCondition {
  equals?: [string, unknown];
  greater?: [string, unknown];
  greaterOrEquals?: [string, unknown];
  less?: [string, unknown];
  lessOrEquals?: [string, unknown];
  not?: WdlExpression;
  contains?: [string, string];
  empty?: string;
}

export interface AndExpression {
  and: WdlExpression[];
}

export interface OrExpression {
  or: WdlExpression[];
}

export type WdlExpression = SimpleCondition | AndExpression | OrExpression;

// ─── Workflow Definition ──────────────────────────────────────────────────────

export interface WorkflowDefinition {
  $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#';
  contentVersion: '1.0.0.0';
  parameters?: Record<string, { type: string; defaultValue?: unknown }>;
  triggers: Record<string, WdlTrigger>;
  actions: Record<string, WdlAction>;
  outputs?: Record<string, unknown>;
}

export interface WorkflowJson {
  definition: WorkflowDefinition;
  kind: 'Stateful' | 'Stateless';
}

// ─── connections.json ─────────────────────────────────────────────────────────

export interface ServiceProviderConnection {
  parameterValues: Record<string, string>;
  serviceProvider: { id: string };
  displayName?: string;
}

export interface ManagedApiConnection {
  api: { id: string };
  connection: { id: string };
  displayName?: string;
  parameterValues?: Record<string, string>;
}

export interface ConnectionsJson {
  serviceProviderConnections: Record<string, ServiceProviderConnection>;
  managedApiConnections: Record<string, ManagedApiConnection>;
}

// ─── host.json ────────────────────────────────────────────────────────────────

export interface HostJson {
  version: '2.0';
  extensionBundle?: {
    id: string;
    version: string;
  };
  extensions?: {
    workflow?: {
      settings?: {
        'Runtime.FlowRetentionDays'?: string;
        'Runtime.Backend.FlowRunRetentionInDays'?: string;
      };
    };
  };
  logging?: {
    applicationInsights?: {
      samplingSettings?: { isEnabled: boolean };
    };
  };
}

// ─── Logic Apps Standard project structure ────────────────────────────────────

export interface LogicAppsProject {
  /** Resource name of the Logic Apps Standard app */
  appName: string;
  workflows: Array<{
    name: string;
    workflow: WorkflowJson;
  }>;
  connections: ConnectionsJson;
  host: HostJson;
  /** App Settings keys (values are placeholder strings — never real credentials) */
  appSettings: Record<string, string>;
  /** XSLT map files: name → content */
  xsltMaps: Record<string, string>;
  /** LML map files: name → content */
  lmlMaps: Record<string, string>;
}
