/**
 * Refinement Engine — Greenfield Stage G3 (PREMIUM TIER)
 *
 * Applies natural language modification instructions to an existing
 * IntegrationIntent or workflow, producing a revised version.
 *
 * This enables iterative workflow development:
 *   User: "Also save each record to Cosmos DB"
 *   → Adds a 'send' step with connector 'cosmosDb' after the existing send step
 *
 *   User: "Change the retry count to 5"
 *   → Updates errorHandling.retryPolicy.count to 5
 *
 *   User: "Add email notification on failure"
 *   → Updates errorHandling.strategy to 'notify', adds notificationTarget
 *
 *   User: "Remove the validation step"
 *   → Removes steps of type 'validate'
 *
 * Operations supported:
 *   add-step       — append or insert a new processing step
 *   remove-step    — remove a step by description/type
 *   modify-step    — change a step's configuration
 *   change-trigger — replace the trigger
 *   update-error-handling — change retry/dead-letter/notification config
 *   add-system     — add an external system
 *   remove-system  — remove an external system
 *   update-data-format — change input/output formats
 *
 * Architecture note: This is a rule-based pre-processor. For complex or
 * ambiguous instructions, it returns a RefinementResult with the original
 * intent unchanged + a structured description of what the LLM should do.
 * The MCP layer then prompts Claude with this description to perform the edit.
 */

import type { IntegrationIntent, IntegrationStep, ExternalSystem, DataFormat } from '../shared/integration-intent.js';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface RefinementResult {
  /** The updated intent (may be same as input if no rule matched) */
  intent:          IntegrationIntent;
  /** Operations that were applied */
  appliedOps:      AppliedOperation[];
  /** Operations that could not be applied automatically */
  pendingOps:      PendingOperation[];
  /** Whether the refinement was fully automated or requires LLM assistance */
  requiresLlm:     boolean;
  /** Prompt to use when requiresLlm is true */
  llmPrompt?:      string;
}

export interface AppliedOperation {
  type:        RefinementOpType;
  description: string;
}

export interface PendingOperation {
  type:        RefinementOpType;
  description: string;
  reason:      string;
}

export type RefinementOpType =
  | 'add-step'
  | 'remove-step'
  | 'modify-step'
  | 'change-trigger'
  | 'update-error-handling'
  | 'add-system'
  | 'remove-system'
  | 'update-data-format';

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Apply a natural language refinement instruction to an existing IntegrationIntent.
 */
export function refineIntent(
  intent: IntegrationIntent,
  instruction: string
): RefinementResult {
  const text     = instruction.toLowerCase().trim();
  const updated  = deepClone(intent);
  const applied:  AppliedOperation[] = [];
  const pending:  PendingOperation[] = [];

  // Try each rule in order; rules can chain
  applyAddStepRules(text, instruction, updated, applied, pending);
  applyRemoveStepRules(text, updated, applied, pending);
  applyModifyStepRules(text, instruction, updated, applied, pending);
  applyChangeTriggerRules(text, instruction, updated, applied, pending);
  applyErrorHandlingRules(text, instruction, updated, applied, pending);
  applyDataFormatRules(text, updated, applied);

  const requiresLlm = pending.length > 0;
  const llmPrompt   = requiresLlm ? buildLlmPrompt(intent, pending) : undefined;

  return {
    intent:     applied.length > 0 ? updated : intent,
    appliedOps: applied,
    pendingOps: pending,
    requiresLlm,
    ...(llmPrompt !== undefined ? { llmPrompt } : {}),
  };
}

// ─── Add Step Rules ───────────────────────────────────────────────────────────

function applyAddStepRules(
  text: string,
  original: string,
  intent: IntegrationIntent,
  applied: AppliedOperation[],
  pending: PendingOperation[]
): void {
  // "also save to / log to / store in" → add send step
  const saveMatch = text.match(/(?:also\s+)?(?:save|store|log|write|insert)\s+(?:each\s+)?(?:record|row|item|message|data)?\s+(?:to|in|into)\s+([\w\s]+)/);
  if (saveMatch) {
    const target = (saveMatch[1] ?? '').trim();
    const connector = inferConnectorFromTarget(target);

    if (connector) {
      const lastId   = getLastStepId(intent.steps);
      const newStepId = `step-${intent.steps.length + 1}`;
      const newStep: IntegrationStep = {
        id:          newStepId,
        type:        'send',
        description: `Store record in ${target}`,
        connector,
        config:      {},
        runAfter:    lastId ? [lastId] : [],
      };
      intent.steps.push(newStep);
      applied.push({ type: 'add-step', description: `Added 'send' step: ${newStep.description}` });
    } else {
      pending.push({
        type:        'add-step',
        description: `Save to ${target}`,
        reason:      `Unknown storage target '${target}'. Specify connector manually.`,
      });
    }
    return;
  }

  // "also send / also post / also notify" → add send/notify step
  const alsoSendMatch = text.match(/(?:also\s+)?(?:send|post|call|notify)\s+(?:it\s+)?(?:to|an?\s+)?(.{5,50})/);
  if (alsoSendMatch && !saveMatch) {
    const target = (alsoSendMatch[1] ?? '').trim();

    if (/email|notify|alert/i.test(target)) {
      const emailMatch = original.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)/);
      const lastId = getLastStepId(intent.steps);
      intent.steps.push({
        id:          `step-${intent.steps.length + 1}`,
        type:        'send',
        description: `Send notification email${emailMatch ? ` to ${emailMatch[1]}` : ''}`,
        connector:   'office365',
        runAfter:    lastId ? [lastId] : [],
        config:      { to: emailMatch?.[1] ?? '@parameters(\'notificationEmail\')' },
      });
      applied.push({ type: 'add-step', description: 'Added email notification step' });
    } else {
      pending.push({
        type:        'add-step',
        description: `Send to ${target}`,
        reason:      'Target system needs connector selection.',
      });
    }
  }

  // "add a validation step" / "validate that..."
  if (/add\s+(?:a\s+)?validat|also\s+validat/i.test(text)) {
    const validationMatch = original.match(/validat[e\w]*\s+(?:that\s+)?(.{5,60})/i);
    const lastSendIdx = [...intent.steps].reverse().findIndex(s => s.type !== 'validate');
    const insertAfterIdx = intent.steps.length - 1 - lastSendIdx;
    const insertAfterId  = intent.steps[insertAfterIdx]?.id;

    const newStepId = `step-${intent.steps.length + 1}`;
    const validationStep: IntegrationStep = {
      id:          newStepId,
      type:        'validate',
      description: validationMatch ? `Validate: ${validationMatch[1]?.trim() ?? 'input'}` : 'Validate message',
      config:      {},
      runAfter:    insertAfterId ? [insertAfterId] : [],
    };

    // Insert before send steps
    const sendIdx = intent.steps.findIndex(s => s.type === 'send');
    if (sendIdx >= 0) {
      intent.steps.splice(sendIdx, 0, validationStep);
      // Update runAfter for the displaced step
      const displaced = intent.steps[sendIdx + 1];
      if (displaced) displaced.runAfter = [newStepId];
    } else {
      intent.steps.push(validationStep);
    }

    applied.push({ type: 'add-step', description: `Added validation step: ${validationStep.description}` });
  }
}

// ─── Remove Step Rules ────────────────────────────────────────────────────────

function applyRemoveStepRules(
  text: string,
  intent: IntegrationIntent,
  applied: AppliedOperation[],
  pending: PendingOperation[]
): void {
  const removeMatch =
    text.match(/remove\s+(?:the\s+)?(\w+(?:\s+\w+)?)\s+step/) ||
    text.match(/(?:don't|do\s+not|skip)\s+(?:the\s+)?(\w+(?:\s+\w+)?)/) ||
    text.match(/no\s+(?:longer\s+)?(?:need\s+(?:the\s+)?)?(\w+(?:\s+\w+)?)\s+step/);

  if (!removeMatch) return;

  const targetDesc = (removeMatch[1] ?? '').toLowerCase();

  // Try to match by type first
  const typeMap: Record<string, string[]> = {
    'validation': ['validate'],
    'validate':   ['validate'],
    'transform':  ['transform'],
    'loop':       ['split', 'loop'],
    'split':      ['split'],
    'error':      ['error-handler'],
  };

  const matchedType = Object.entries(typeMap).find(([k]) => targetDesc.includes(k));
  if (matchedType) {
    const removedTypes = matchedType[1];
    const before = intent.steps.length;
    intent.steps = intent.steps.filter(s => !removedTypes.includes(s.type));
    const removed = before - intent.steps.length;

    if (removed > 0) {
      // Repair runAfter chains (remove references to deleted step IDs)
      repairRunAfterChain(intent.steps);
      applied.push({ type: 'remove-step', description: `Removed ${removed} '${matchedType[0]}' step(s)` });
    } else {
      pending.push({
        type:        'remove-step',
        description: `Remove ${targetDesc} step`,
        reason:      `No step of type '${targetDesc}' found in current intent.`,
      });
    }
    return;
  }

  // Fuzzy match by description
  const descMatch = intent.steps.find(s =>
    s.description.toLowerCase().includes(targetDesc)
  );
  if (descMatch) {
    intent.steps = intent.steps.filter(s => s.id !== descMatch.id);
    repairRunAfterChain(intent.steps);
    applied.push({ type: 'remove-step', description: `Removed step: ${descMatch.description}` });
  } else {
    pending.push({
      type:        'remove-step',
      description: `Remove step matching '${targetDesc}'`,
      reason:      'No matching step found. Review current steps and specify more precisely.',
    });
  }
}

// ─── Modify Step Rules ────────────────────────────────────────────────────────

function applyModifyStepRules(
  text: string,
  original: string,
  intent: IntegrationIntent,
  applied: AppliedOperation[],
  pending: PendingOperation[]
): void {
  // "change the polling interval to X"
  const intervalMatch = text.match(/(?:change|update|set)\s+(?:the\s+)?(?:polling\s+)?interval\s+to\s+(\d+)\s+(minute|hour|second)s?/i);
  if (intervalMatch && intent.trigger.type === 'polling') {
    const freqUnit = intervalMatch[2] ?? 'minute';
    intent.trigger.config = {
      ...intent.trigger.config,
      interval:  parseInt(intervalMatch[1] ?? '1', 10),
      frequency: freqUnit.charAt(0).toUpperCase() + freqUnit.slice(1),
    };
    applied.push({ type: 'modify-step', description: `Updated polling interval to every ${intervalMatch[1]} ${intervalMatch[2]}(s)` });
    return;
  }

  // "change the API endpoint / URL to..."
  const urlMatch = original.match(/(?:change|update|set)\s+(?:the\s+)?(?:api\s+)?(?:endpoint|url)\s+to\s+(https?:\/\/\S+|@parameters\('\S+'\))/i);
  if (urlMatch) {
    const sendStep = intent.steps.find(s => s.type === 'send' && s.connector === 'http');
    if (sendStep) {
      sendStep.config = { ...sendStep.config, uri: urlMatch[1] };
      applied.push({ type: 'modify-step', description: `Updated HTTP endpoint to ${urlMatch[1]}` });
    } else {
      pending.push({ type: 'modify-step', description: 'Update API endpoint URL', reason: 'No HTTP send step found.' });
    }
    return;
  }

  // "change the queue name to X"
  const queueMatch = text.match(/(?:change|update|set)\s+(?:the\s+)?(?:queue|topic)\s+(?:name\s+)?to\s+["']?([\w-]+)["']?/);
  if (queueMatch) {
    if (intent.trigger.connector === 'serviceBus') {
      intent.trigger.config = { ...intent.trigger.config, queueName: queueMatch[1] };
      applied.push({ type: 'modify-step', description: `Updated trigger queue name to '${queueMatch[1]}'` });
    }
  }
}

// ─── Trigger Change Rules ─────────────────────────────────────────────────────

function applyChangeTriggerRules(
  text: string,
  original: string,
  intent: IntegrationIntent,
  applied: AppliedOperation[],
  pending: PendingOperation[]
): void {
  // "change trigger to / use X trigger instead"
  if (!/(change|switch|use)\s+(?:the\s+)?trigger/i.test(original)) return;

  if (/schedule|timer|every\s+\d+|daily|hourly/i.test(text)) {
    const m = text.match(/every\s+(\d+)\s+(minute|hour|day)s?/);
    intent.trigger = {
      type:      'schedule',
      source:    'Timer schedule',
      connector: 'recurrence',
      config:    { frequency: m?.[2] ?? 'Hour', interval: m ? parseInt(m[1] ?? '1', 10) : 1 },
    };
    applied.push({ type: 'change-trigger', description: 'Changed trigger to schedule/recurrence' });
    return;
  }

  if (/http|webhook|rest/i.test(text)) {
    intent.trigger = {
      type:      'webhook',
      source:    'HTTP endpoint',
      connector: 'request',
      config:    { method: 'POST' },
    };
    applied.push({ type: 'change-trigger', description: 'Changed trigger to HTTP webhook' });
    return;
  }

  pending.push({
    type:        'change-trigger',
    description: 'Change trigger type',
    reason:      'New trigger type could not be inferred from instruction.',
  });
}

// ─── Error Handling Rules ─────────────────────────────────────────────────────

function applyErrorHandlingRules(
  text: string,
  original: string,
  intent: IntegrationIntent,
  applied: AppliedOperation[],
  pending: PendingOperation[]
): void {
  // Retry count change
  const retryCountMatch = text.match(/(?:change|update|set)\s+(?:the\s+)?retry\s+(?:count|attempts?)\s+to\s+(\d+)/);
  if (retryCountMatch) {
    intent.errorHandling.retryPolicy = {
      ...(intent.errorHandling.retryPolicy ?? { count: 3, interval: 'PT30S', type: 'fixed' }),
      count: parseInt(retryCountMatch[1] ?? '3', 10),
    };
    applied.push({ type: 'update-error-handling', description: `Updated retry count to ${retryCountMatch[1]}` });
  }

  // Add dead-letter
  if (/add\s+(?:a\s+)?dead[\s-]letter|route\s+(?:failures?|errors?)\s+to\s+(?:a\s+)?(?:dead[\s-]letter|dlq)/i.test(text)) {
    const queueMatch = text.match(/dead[\s-]letter\s+queue\s+["']?([\w-]+)["']?/i);
    intent.errorHandling.strategy         = 'dead-letter';
    intent.errorHandling.deadLetterTarget = queueMatch?.[1] ?? 'dead-letter-queue';
    applied.push({ type: 'update-error-handling', description: `Added dead-letter routing to '${intent.errorHandling.deadLetterTarget}'` });
  }

  // Add/change notification
  const notifyMatch = original.match(/(?:notify|send\s+(?:an?\s+)?email)\s+(?:to\s+)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)/i);
  if (notifyMatch) {
    if (intent.errorHandling.strategy !== 'dead-letter') {
      intent.errorHandling.strategy = 'notify';
    }
    if (notifyMatch[1]) intent.errorHandling.notificationTarget = notifyMatch[1];
    applied.push({ type: 'update-error-handling', description: `Set failure notification to ${notifyMatch[1] ?? ''}` });
  }

  // Add retry
  const addRetryMatch = text.match(/add\s+(?:a\s+)?retry\s+(?:policy\s+of\s+)?(\d+)\s+times?/);
  if (addRetryMatch) {
    intent.errorHandling.retryPolicy = {
      count:    parseInt(addRetryMatch[1] ?? '3', 10),
      interval: 'PT30S',
      type:     'fixed',
    };
    if (intent.errorHandling.strategy === 'ignore' || intent.errorHandling.strategy === 'terminate') {
      intent.errorHandling.strategy = 'retry';
    }
    applied.push({ type: 'update-error-handling', description: `Added retry policy (${addRetryMatch[1]} attempts)` });
  }
}

// ─── Data Format Rules ────────────────────────────────────────────────────────

function applyDataFormatRules(
  text: string,
  intent: IntegrationIntent,
  applied: AppliedOperation[]
): void {
  const formatMap: Record<string, DataFormat> = {
    csv:         'csv',
    json:        'json',
    xml:         'xml',
    edi:         'edi-x12',
    'flat-file': 'flat-file',
    parquet:     'binary',
    avro:        'binary',
  };

  for (const [keyword, format] of Object.entries(formatMap)) {
    if (text.includes(`input is ${keyword}`) || text.includes(`receives ${keyword}`) || text.includes(`from ${keyword}`)) {
      intent.dataFormats.input = format;
      applied.push({ type: 'update-data-format', description: `Changed input format to ${format}` });
    }
    if (text.includes(`output is ${keyword}`) || text.includes(`produces ${keyword}`) || text.includes(`to ${keyword}`)) {
      intent.dataFormats.output = format;
      applied.push({ type: 'update-data-format', description: `Changed output format to ${format}` });
    }
  }
}

// ─── LLM Fallback Prompt ──────────────────────────────────────────────────────

function buildLlmPrompt(
  original: IntegrationIntent,
  pending: PendingOperation[]
): string {
  const pendingDesc = pending.map(p => `- ${p.description} (reason: ${p.reason})`).join('\n');

  return [
    'The following changes to an IntegrationIntent could not be applied automatically:',
    '',
    pendingDesc,
    '',
    'Current IntegrationIntent:',
    '```json',
    JSON.stringify(original, null, 2),
    '```',
    '',
    'Please apply these changes to the IntegrationIntent JSON and return the updated object.',
    'Preserve all existing fields. Only modify what the instructions require.',
  ].join('\n');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function inferConnectorFromTarget(target: string): string | null {
  const lower = target.toLowerCase();
  if (/cosmos/i.test(lower))      return 'cosmosDb';
  if (/sql|database|table/i.test(lower)) return 'sql';
  if (/blob|storage/i.test(lower)) return 'blob';
  if (/service\s*bus|queue/i.test(lower)) return 'serviceBus';
  if (/event\s*hub/i.test(lower)) return 'eventHubs';
  if (/email|mail/i.test(lower))  return 'office365';
  return null;
}

function getLastStepId(steps: IntegrationStep[]): string | null {
  if (steps.length === 0) return null;
  return steps[steps.length - 1]?.id ?? null;
}

function repairRunAfterChain(steps: IntegrationStep[]): void {
  const validIds = new Set(steps.map(s => s.id));
  for (const step of steps) {
    step.runAfter = step.runAfter.filter(id => validIds.has(id));
  }
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}
