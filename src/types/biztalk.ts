/**
 * BizTalk Server artifact type definitions.
 * These types represent the parsed structure of BizTalk XML artifacts
 * (.odx, .btm, .btp, BindingInfo.xml, .xsd).
 *
 * All parsing produces these types — they feed into Stage 1 (Understand).
 */

// ─── Orchestration (.odx) ────────────────────────────────────────────────────

export type BizTalkVersion = '2010' | '2013' | '2013R2' | '2016' | '2020' | 'unknown';

export type ShapeType =
  | 'ReceiveShape'
  | 'SendShape'
  | 'ConstructShape'
  | 'MessageAssignmentShape'
  | 'TransformShape'
  | 'DecisionShape'
  | 'LoopShape'
  | 'ListenShape'
  | 'ParallelActionsShape'
  | 'ScopeShape'
  | 'CompensateShape'
  | 'ThrowShape'
  | 'TerminateShape'
  | 'DelayShape'
  | 'ExpressionShape'
  | 'CallOrchestrationShape'
  | 'StartOrchestrationShape'
  | 'CallRulesShape'
  | 'SuspendShape'
  | 'GroupShape'
  | 'RoleLinkShape'
  | 'CommentShape';

export type TransactionType = 'None' | 'Atomic' | 'LongRunning';
export type PortPolarity = 'Implements' | 'Uses';

export interface OdxShape {
  shapeType: ShapeType;
  shapeId: string;
  name?: string;
  /** XLANG/s condition expression for Decide/Loop/Listen branches */
  conditionExpression?: string;
  /** true for activating Receive shapes */
  isActivating?: boolean;
  /** For TransformShape: name of the .btm map class used */
  mapClass?: string;
  /** For CallOrchestrationShape / StartOrchestrationShape */
  calledOrchestration?: string;
  /** For CallRulesShape: name of the BRE policy */
  rulePolicyName?: string;
  /** For ScopeShape */
  transactionType?: TransactionType;
  /** For DelayShape: C# TimeSpan expression */
  delayExpression?: string;
  /** For ExpressionShape / MessageAssignmentShape */
  codeExpression?: string;
  /** Nested shapes (for scopes, branches, parallel blocks) */
  children?: OdxShape[];
}

export interface OdxPort {
  name: string;
  portTypeRef: string;
  polarity: PortPolarity;
  /** The logical binding name referencing a physical port in BindingInfo.xml */
  binding?: string;
}

export interface OdxCorrelationSet {
  name: string;
  correlationTypeRef: string;
  /** Promoted property names used in the correlation type */
  correlationProperties: string[];
}

export interface OdxMessageDeclaration {
  name: string;
  /** Fully-qualified schema type, e.g. "Namespace.RootNode" */
  messageType: string;
  isMultiPart?: boolean;
}

export interface OdxVariable {
  name: string;
  /** C# type name, e.g. "System.String", "System.Int32" */
  csharpType: string;
}

export interface ParsedOrchestration {
  name: string;
  namespace: string;
  filePath: string;
  shapes: OdxShape[];
  ports: OdxPort[];
  correlationSets: OdxCorrelationSet[];
  messages: OdxMessageDeclaration[];
  variables: OdxVariable[];
  /** Whether the orchestration contains any Scope with AtomicTransaction */
  hasAtomicTransactions: boolean;
  /** Whether the orchestration contains any Scope with LongRunning */
  hasLongRunningTransactions: boolean;
  /** Whether any Compensate shapes are present */
  hasCompensation: boolean;
  /** Whether any CallRules shapes are present */
  hasBRECalls: boolean;
  /** Whether any Suspend shapes are present */
  hasSuspend: boolean;
  /** Number of activating Receive shapes */
  activatingReceiveCount: number;
}

// ─── Map (.btm) ──────────────────────────────────────────────────────────────

export type FunctoidCategory =
  | 'string'
  | 'math'
  | 'logical'
  | 'date-time'
  | 'conversion'
  | 'scientific'
  | 'cumulative'
  | 'database'
  | 'advanced'
  | 'scripting';

export interface BtmFunctoid {
  functoidId: number;
  category: FunctoidCategory;
  /** True if this is a scripting functoid with inline C# code */
  isScripting: boolean;
  /** For scripting functoids: the inline C# source code */
  scriptCode?: string;
  /** For database functoids: the connection info (sanitized — no credentials) */
  databaseTableRef?: string;
  inputs: string[];
  outputs: string[];
}

export interface BtmLink {
  from: string;
  to: string;
  functoidRef?: number;
}

export interface ParsedMap {
  name: string;
  className: string;
  filePath: string;
  sourceSchemaRef: string;
  destinationSchemaRef: string;
  functoids: BtmFunctoid[];
  links: BtmLink[];
  linkCount: number;
  /** True if any functoid has isScripting=true */
  hasScriptingFunctoids: boolean;
  /** True if Looping functoid (FID 900) is present */
  hasLooping: boolean;
  /** True if Database functoid (FID 60-99) is present */
  hasDatabaseFunctoids: boolean;
  functoidCategories: FunctoidCategory[];
  /** Recommended migration path determined by map-analyzer */
  recommendedMigrationPath?: 'lml' | 'xslt' | 'xslt-rewrite' | 'azure-function' | 'manual';
}

// ─── Pipeline (.btp) ─────────────────────────────────────────────────────────

export type PipelineDirection = 'receive' | 'send';

export type PipelineStage =
  | 'Decode'
  | 'Disassemble'
  | 'Validate'
  | 'ResolveParty'
  | 'PreAssemble'
  | 'Assemble'
  | 'Encode';

export interface BtpComponent {
  componentType: string;
  /** Full .NET type name */
  fullTypeName: string;
  stage: PipelineStage;
  isCustom: boolean;
  /** Component-specific property settings */
  properties: Record<string, string>;
}

export interface ParsedPipeline {
  name: string;
  className: string;
  filePath: string;
  direction: PipelineDirection;
  components: BtpComponent[];
  /** True if any component has isCustom=true */
  hasCustomComponents: boolean;
  isDefault: boolean;
}

// ─── Binding File ─────────────────────────────────────────────────────────────

export interface ReceiveLocation {
  name: string;
  receivePortName: string;
  adapterType: string;
  address: string;
  pipelineName: string;
  /** Parsed TransportTypeData properties */
  adapterProperties: Record<string, string>;
  isEnabled: boolean;
}

export interface SendPort {
  name: string;
  adapterType: string;
  address: string;
  pipelineName: string;
  adapterProperties: Record<string, string>;
  /** BizTalk filter expression (subscription SQL) */
  filterExpression?: string;
  isDynamic: boolean;
  isTwoWay: boolean;
  /** For send port groups */
  sendPortGroupName?: string;
}

export interface ParsedBindingFile {
  applicationName: string;
  filePath: string;
  receiveLocations: ReceiveLocation[];
  sendPorts: SendPort[];
}

// ─── Schema (.xsd) ───────────────────────────────────────────────────────────

export interface ParsedSchema {
  name: string;
  filePath: string;
  targetNamespace: string;
  rootNode: string;
  /** True if this schema declares promoted properties */
  isPropertySchema: boolean;
  /** True if this is an EDI schema (X12 or EDIFACT) */
  isEDISchema: boolean;
  /** Promoted property names declared in this schema */
  promotedProperties?: string[];
}

// ─── BizTalk Application (aggregate) ─────────────────────────────────────────

export interface BizTalkApplication {
  name: string;
  description?: string;
  biztalkVersion: BizTalkVersion;
  orchestrations: ParsedOrchestration[];
  maps: ParsedMap[];
  pipelines: ParsedPipeline[];
  schemas: ParsedSchema[];
  bindingFiles: ParsedBindingFile[];
  /** Computed complexity score (0=trivial, 51+=highly-complex) */
  complexityScore: number;
  complexityClassification: 'simple' | 'moderate' | 'complex' | 'highly-complex';
}
