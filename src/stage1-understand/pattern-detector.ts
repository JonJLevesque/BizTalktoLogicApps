/**
 * Pattern Detector — Stage 1 (Understand)
 *
 * Identifies enterprise integration patterns present in a BizTalk application.
 * Operates on already-parsed artifacts — no XML parsing here.
 *
 * Patterns are detected by recognizing shape combinations, adapter configurations,
 * and structural markers. Each detector function is independent and can be
 * composed arbitrarily.
 *
 * Reference: Enterprise Integration Patterns (Hohpe & Woolf)
 * See also: docs/reference/pattern-mapping.md
 */

import { flattenShapes } from './orchestration-analyzer.js';
import type { BizTalkApplication, ParsedOrchestration } from '../types/biztalk.js';
import type { IntegrationPattern } from '../shared/integration-intent.js';

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Detects all enterprise integration patterns present in a BizTalk application.
 * Returns deduplicated list of detected patterns.
 */
export function detectPatterns(app: BizTalkApplication): IntegrationPattern[] {
  const detected = new Set<IntegrationPattern>();

  for (const orch of app.orchestrations) {
    for (const pattern of detectOrchestrationPatterns(orch)) {
      detected.add(pattern);
    }
  }

  // Application-level patterns (from binding file configuration)
  for (const pattern of detectBindingPatterns(app)) {
    detected.add(pattern);
  }

  // Pipeline-level patterns (custom components, flat file debatching)
  for (const pattern of detectPipelinePatterns(app)) {
    detected.add(pattern);
  }

  return Array.from(detected);
}

/**
 * Detects patterns in a single orchestration.
 */
export function detectOrchestrationPatterns(orch: ParsedOrchestration): IntegrationPattern[] {
  const detected = new Set<IntegrationPattern>();
  const shapes = flattenShapes(orch.shapes);

  // ── Content-Based Router ────────────────────────────────────────────────────
  // Decide or Switch shape followed by Send shapes in different branches
  const hasDecide = shapes.some(s => s.shapeType === 'DecisionShape');
  const hasSend = shapes.some(s => s.shapeType === 'SendShape');
  if (hasDecide && hasSend) {
    detected.add('content-based-routing');
  }

  // ── Sequential Convoy ───────────────────────────────────────────────────────
  // Multiple Receive shapes with correlation sets initialized
  const receiveShapes = shapes.filter(s => s.shapeType === 'ReceiveShape');
  const hasMultipleReceives = receiveShapes.length > 1;
  const hasCorrelationSets = orch.correlationSets.length > 0;
  if (hasMultipleReceives && hasCorrelationSets) {
    detected.add('sequential-convoy');
  }

  // ── Scatter-Gather ──────────────────────────────────────────────────────────
  // ParallelActions with multiple Send shapes and a subsequent aggregation step
  const hasParallel = shapes.some(s => s.shapeType === 'ParallelActionsShape');
  const hasMultipleSends = shapes.filter(s => s.shapeType === 'SendShape').length >= 2;
  if (hasParallel && hasMultipleSends) {
    detected.add('scatter-gather');
  }

  // ── Request-Reply ───────────────────────────────────────────────────────────
  // A Send shape on a two-way port (Uses polarity + port type that has response)
  // OR: an HTTP receive location with a two-way orchestration port
  const twoWayPorts = orch.ports.filter(p => p.polarity === 'Implements');
  const sendPorts = orch.ports.filter(p => p.polarity === 'Uses');
  if (twoWayPorts.length > 0 && sendPorts.length > 0) {
    // Has both inbound (implements) and outbound (uses) ports — request-reply possible
    detected.add('request-reply');
  }

  // ── Message Enricher ────────────────────────────────────────────────────────
  // A Send followed by a Receive (request-reply to external system) then a Construct
  // Pattern: Receive→Send→Receive→Construct (fetch enrichment data then build new message)
  const hasEnrichmentPattern = detectEnrichmentPattern(shapes);
  if (hasEnrichmentPattern) {
    detected.add('message-enricher');
  }

  // ── Dead Letter Queue ───────────────────────────────────────────────────────
  // Scope with exception handling that sends to a specific dead-letter port
  const hasScopeWithCatch = shapes.some(s =>
    s.shapeType === 'ScopeShape' && s.children?.some(c => c.shapeType === 'SendShape')
  );
  if (hasScopeWithCatch || orch.hasCompensation) {
    detected.add('dead-letter-queue');
  }

  // ── Message Aggregator ──────────────────────────────────────────────────────
  // Loop shape containing a Receive and a variable accumulation (Expression/MessageAssignment)
  const hasLoop = shapes.some(s => s.shapeType === 'LoopShape');
  const hasExpressionInLoop = detectLoopAccumulation(shapes);
  if (hasLoop && (hasCorrelationSets || hasExpressionInLoop)) {
    detected.add('message-aggregator');
  }

  // ── Splitter ────────────────────────────────────────────────────────────────
  // Loop or ForEach sending multiple messages to the same port
  // OR: XML Disassembler in receive pipeline (debatching)
  if (hasLoop && hasMultipleSends) {
    detected.add('splitter');
  }

  // ── Process Manager ─────────────────────────────────────────────────────────
  // Long-running or complex orchestration with multiple states
  const isLongRunning = orch.hasLongRunningTransactions;
  const isComplex = shapes.length > 15 || hasCorrelationSets || hasParallel;
  if (isLongRunning || isComplex) {
    detected.add('process-manager');
  }

  // ── Correlation ──────────────────────────────────────────────────────────────
  if (hasCorrelationSets) {
    detected.add('correlation');
  }

  // ── Fan-Out ──────────────────────────────────────────────────────────────────
  // Multiple activating Receive shapes (different entry points for same orchestration)
  if (orch.activatingReceiveCount > 1) {
    detected.add('fan-out');
  }

  // ── Retry (Idempotent Receiver) ─────────────────────────────────────────────
  // Loop wrapping a Send shape (retry pattern) with a counter variable
  if (hasLoop && hasSend && detectRetryPattern(shapes)) {
    detected.add('retry-idempotent');
  }

  // ── Wire Tap ────────────────────────────────────────────────────────────────
  // Send to an audit/logging port alongside the main processing path
  if (detectWireTapPattern(shapes, orch)) {
    detected.add('wire-tap');
  }

  return Array.from(detected);
}

// ─── Pipeline-Level Pattern Detection ────────────────────────────────────────

function detectPipelinePatterns(app: BizTalkApplication): IntegrationPattern[] {
  const detected = new Set<IntegrationPattern>();

  // Custom pipeline components → 'custom-pipeline' pattern
  const hasCustomComponents = app.pipelines.some(p => p.hasCustomComponents);
  if (hasCustomComponents) {
    detected.add('custom-pipeline');
  }

  // Flat file disassembler pipeline → 'splitter' pattern (envelope debatching)
  const hasFlatFile = app.pipelines.some(p =>
    p.components.some(c => {
      const tn = c.fullTypeName.toLowerCase();
      return (
        tn.includes('flatfile') ||
        tn.includes('ffdasm') ||
        tn.includes('ffasm') ||
        c.componentType === 'FFDasmComp' ||
        c.componentType === 'FFAsmComp' ||
        c.componentType === 'FlatFileDasmComp' ||
        c.componentType === 'FlatFileAsmComp'
      );
    })
  );
  if (hasFlatFile) {
    detected.add('splitter');
  }

  return Array.from(detected);
}

// ─── Application-Level Pattern Detection ─────────────────────────────────────

function detectBindingPatterns(app: BizTalkApplication): IntegrationPattern[] {
  const detected = new Set<IntegrationPattern>();

  // Pub/sub: multiple send ports with filter expressions on promoted properties
  const allSendPorts = app.bindingFiles.flatMap(b => b.sendPorts);
  const portsWithFilters = allSendPorts.filter(sp => sp.filterExpression && sp.filterExpression.length > 0);
  if (portsWithFilters.length >= 2) {
    detected.add('publish-subscribe');
  }

  // Content-based routing via send port filters (subscription-based CBR)
  if (portsWithFilters.length > 0) {
    detected.add('content-based-routing');
  }

  // Message filter: single send port with restrictive filter
  if (portsWithFilters.length === 1) {
    detected.add('message-filter');
  }

  // Splitter: any receive location using EDI disassembler pipeline
  const allReceiveLocations = app.bindingFiles.flatMap(b => b.receiveLocations);
  const hasEdiPipeline = allReceiveLocations.some(rl =>
    rl.pipelineName.toLowerCase().includes('edi') ||
    rl.pipelineName.toLowerCase().includes('as2')
  );
  if (hasEdiPipeline) {
    detected.add('splitter');
  }

  // Claim check: any adapter that involves large message storage (Blob, File)
  const hasFileOrBlob = allReceiveLocations.some(rl =>
    rl.adapterType === 'FILE' || rl.adapterType === 'AzureBlob'
  );
  if (hasFileOrBlob && app.orchestrations.some(o => o.shapes.length > 5)) {
    detected.add('claim-check');
  }

  return Array.from(detected);
}

// ─── Helper Pattern Detectors ─────────────────────────────────────────────────

/**
 * Detects the message enrichment pattern:
 * Receive (inbound) → Send (lookup request) → Receive (lookup response) → Construct
 */
function detectEnrichmentPattern(shapes: ReturnType<typeof flattenShapes>): boolean {
  let foundReceive = false;
  let foundSend = false;
  let foundSecondReceive = false;

  for (const shape of shapes) {
    if (!foundReceive && shape.shapeType === 'ReceiveShape' && shape.isActivating) {
      foundReceive = true;
    } else if (foundReceive && !foundSend && shape.shapeType === 'SendShape') {
      foundSend = true;
    } else if (foundSend && !foundSecondReceive && shape.shapeType === 'ReceiveShape' && !shape.isActivating) {
      foundSecondReceive = true;
    } else if (foundSecondReceive && (shape.shapeType === 'ConstructShape' || shape.shapeType === 'MessageAssignmentShape')) {
      return true;
    }
  }
  return false;
}

/**
 * Detects loop-with-accumulation: a Loop containing Expression shapes
 * that modify a variable (typical aggregation pattern).
 */
function detectLoopAccumulation(shapes: ReturnType<typeof flattenShapes>): boolean {
  const loopShapes = shapes.filter(s => s.shapeType === 'LoopShape');
  return loopShapes.some(loop =>
    loop.children?.some(c =>
      c.shapeType === 'ExpressionShape' ||
      c.shapeType === 'MessageAssignmentShape'
    ) ?? false
  );
}

/**
 * Detects retry pattern: a Loop containing a Send shape
 * with a counter variable in an Expression shape.
 */
function detectRetryPattern(shapes: ReturnType<typeof flattenShapes>): boolean {
  const loopShapes = shapes.filter(s => s.shapeType === 'LoopShape');
  return loopShapes.some(loop => {
    const children = loop.children ?? [];
    const hasSend = children.some(c => c.shapeType === 'SendShape');
    const hasCounter = children.some(c =>
      (c.shapeType === 'ExpressionShape' || c.shapeType === 'MessageAssignmentShape') &&
      (c.codeExpression?.includes('retryCount') ||
       c.codeExpression?.includes('retry') ||
       c.codeExpression?.includes('counter') ||
       c.codeExpression?.includes('attempt'))
    );
    const hasCondition = loop.conditionExpression?.toLowerCase().includes('retry') ||
      loop.conditionExpression?.toLowerCase().includes('count') ||
      loop.conditionExpression?.includes('<') ||
      loop.conditionExpression?.includes('>');
    return hasSend && (hasCounter || hasCondition);
  });
}

/**
 * Detects wire tap: a Send shape that appears to go to an audit/logging destination
 * based on port name heuristics.
 */
function detectWireTapPattern(
  shapes: ReturnType<typeof flattenShapes>,
  orch: ParsedOrchestration
): boolean {
  const auditKeywords = ['audit', 'log', 'archive', 'track', 'monitor', 'copy', 'backup'];
  const sendPorts = orch.ports.filter(p => p.polarity === 'Uses');
  return sendPorts.some(port => {
    const portNameLower = port.name.toLowerCase();
    return auditKeywords.some(kw => portNameLower.includes(kw));
  });
}
