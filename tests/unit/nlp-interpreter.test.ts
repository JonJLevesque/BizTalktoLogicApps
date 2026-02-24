/**
 * Unit tests for Greenfield NLP Interpreter
 * Tests that natural language descriptions produce correct IntegrationIntents.
 *
 * TriggerType values: 'polling' | 'webhook' | 'schedule' | 'manual'
 * The NLP interpreter maps REST/HTTP keywords → type: 'webhook'
 * and Event Hubs → type: 'polling' (uses ServiceProvider trigger pattern)
 */

import { interpretNlp } from '../../src/greenfield/nlp-interpreter.js';

// ─── Basic Trigger Extraction ─────────────────────────────────────────────────

describe('interpretNlp — trigger detection', () => {
  it('detects webhook trigger from "REST API" description', () => {
    const result = interpretNlp('Expose a REST API endpoint to receive order submissions');
    expect(result.intent.trigger.type).toBe('webhook');
  });

  it('detects polling trigger from Service Bus description', () => {
    const result = interpretNlp('Poll a Service Bus queue for incoming customer messages');
    expect(result.intent.trigger.type).toBe('polling');
    expect(result.intent.trigger.connector).toBe('serviceBus');
  });

  it('detects schedule trigger from "hourly" description', () => {
    const result = interpretNlp('Run hourly to sync records from SQL database');
    expect(result.intent.trigger.type).toBe('schedule');
  });

  it('detects polling trigger from event hub description', () => {
    // Event Hubs uses ServiceProvider polling pattern in Logic Apps
    const result = interpretNlp('React when an event arrives in the Event Hub');
    expect(result.intent.trigger.type).toBe('polling');
  });

  it('detects SFTP trigger', () => {
    const result = interpretNlp('Poll SFTP server for new XML files');
    expect(result.intent.trigger.connector).toMatch(/sftp|ftp/i);
  });
});

// ─── Step Extraction ──────────────────────────────────────────────────────────

describe('interpretNlp — step extraction', () => {
  it('extracts transform step', () => {
    // "convert to" triggers the transform step regex
    const result = interpretNlp('Receive XML message and convert to JSON format');
    const hasTransform = result.intent.steps.some(s => s.type === 'transform');
    expect(hasTransform).toBe(true);
  });

  it('extracts send step', () => {
    // "send to the rest api" triggers the send step regex
    const result = interpretNlp('Receive a message and send to the rest api');
    const hasSend = result.intent.steps.some(s => s.type === 'send');
    expect(hasSend).toBe(true);
  });

  it('extracts condition/routing step for CBR', () => {
    // "route based on" triggers the condition step regex
    const result = interpretNlp('Route based on priority: high priority to express queue');
    const hasRoute = result.intent.steps.some(s =>
      s.type === 'route' || s.type === 'condition'
    );
    expect(hasRoute).toBe(true);
  });
});

// ─── Data Formats ────────────────────────────────────────────────────────────

describe('interpretNlp — data formats', () => {
  it('detects XML input format', () => {
    const result = interpretNlp('Process XML invoices from a file share');
    expect(result.intent.dataFormats.input).toBe('xml');
  });

  it('detects JSON format', () => {
    const result = interpretNlp('Receive JSON payloads from a REST API');
    expect(result.intent.dataFormats.input).toBe('json');
  });

  it('detects EDI format', () => {
    const result = interpretNlp('Process EDI X12 850 purchase orders from trading partners');
    expect(['edi-x12', 'edi-edifact']).toContain(result.intent.dataFormats.input);
  });
});

// ─── Error Handling ───────────────────────────────────────────────────────────

describe('interpretNlp — error handling', () => {
  it('detects retry from "retry N times" pattern', () => {
    // The NLP parser matches "retry N times" to set strategy: 'retry'
    const result = interpretNlp('Process orders with retry 3 times on failure');
    expect(result.intent.errorHandling.strategy).toMatch(/retry/i);
  });

  it('detects dead-letter routing', () => {
    const result = interpretNlp('Route failed messages to a dead-letter queue');
    expect(result.intent.errorHandling.strategy).toBe('dead-letter');
  });
});

// ─── Return Shape ────────────────────────────────────────────────────────────

describe('interpretNlp — return structure', () => {
  it('returns confidence between 0 and 1', () => {
    const result = interpretNlp('Receive XML and send to Service Bus');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('returns ambiguities array', () => {
    const result = interpretNlp('Do something with data');
    expect(Array.isArray(result.ambiguities)).toBe(true);
  });

  it('returns a complete IntegrationIntent', () => {
    const result = interpretNlp('Poll a queue and send to HTTP endpoint');
    expect(result.intent.trigger).toBeDefined();
    expect(result.intent.errorHandling).toBeDefined();
    expect(result.intent.metadata).toBeDefined();
  });

  it('does not crash on empty string', () => {
    expect(() => interpretNlp('')).not.toThrow();
  });
});
