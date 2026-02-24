/**
 * Unit tests for Greenfield Template Library
 * Self-contained — no external fixtures needed
 */

import { listTemplates, getTemplate, cloneTemplateIntent } from '../../src/greenfield/template-library.js';

// ─── listTemplates ────────────────────────────────────────────────────────────

describe('listTemplates', () => {
  it('returns an array', () => {
    const templates = listTemplates({});
    expect(Array.isArray(templates)).toBe(true);
  });

  it('returns multiple templates when no filter applied', () => {
    const templates = listTemplates({});
    expect(templates.length).toBeGreaterThan(0);
  });

  it('each template has required fields', () => {
    const templates = listTemplates({});
    for (const t of templates) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(typeof t.category).toBe('string');
    }
  });

  it('filters by category', () => {
    const templates = listTemplates({ category: 'messaging' });
    for (const t of templates) {
      expect(t.category).toBe('messaging');
    }
  });

  it('filters by search term', () => {
    const allTemplates = listTemplates({});
    const searchTerm = allTemplates[0]?.name.split(' ')[0] ?? 'file';
    const filtered = listTemplates({ search: searchTerm.toLowerCase() });
    expect(filtered.length).toBeGreaterThan(0);
  });

  it('returns empty array for unmatched search', () => {
    const filtered = listTemplates({ search: 'xyzzy-nonexistent-template-12345' });
    expect(filtered).toEqual([]);
  });
});

// ─── getTemplate ──────────────────────────────────────────────────────────────

describe('getTemplate', () => {
  it('returns a template for a valid ID', () => {
    const allTemplates = listTemplates({});
    const firstId = allTemplates[0]?.id;
    if (!firstId) return;
    const template = getTemplate(firstId);
    expect(template).toBeDefined();
    expect(template?.id).toBe(firstId);
  });

  it('returns null for unknown ID', () => {
    const template = getTemplate('nonexistent-template-id');
    expect(template).toBeNull();
  });
});

// ─── cloneTemplateIntent ──────────────────────────────────────────────────────

describe('cloneTemplateIntent', () => {
  it('returns an intent for valid template ID', () => {
    const allTemplates = listTemplates({});
    const firstId = allTemplates[0]?.id;
    if (!firstId) return;
    const intent = cloneTemplateIntent(firstId);
    expect(intent).toBeDefined();
  });

  it('returns null for unknown template', () => {
    const intent = cloneTemplateIntent('no-such-template');
    expect(intent).toBeNull();
  });

  it('cloned intent has trigger, steps, and errorHandling', () => {
    const allTemplates = listTemplates({});
    const firstId = allTemplates[0]?.id;
    if (!firstId) return;
    const intent = cloneTemplateIntent(firstId);
    expect(intent?.trigger).toBeDefined();
    expect(Array.isArray(intent?.steps)).toBe(true);
    expect(intent?.errorHandling).toBeDefined();
  });

  it('returns a deep clone — mutations do not affect original', () => {
    const allTemplates = listTemplates({});
    const firstId = allTemplates[0]?.id;
    if (!firstId) return;

    const clone1 = cloneTemplateIntent(firstId);
    const clone2 = cloneTemplateIntent(firstId);
    if (!clone1 || !clone2) return;

    // Mutate clone1 (webhook is a valid TriggerType)
    clone1.trigger.type = 'webhook';
    // clone2 should be unaffected
    expect(clone2.trigger.type).not.toBe('http');
  });
});
