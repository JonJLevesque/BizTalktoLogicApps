/**
 * Unit tests for Stage 3 — Map Converter
 * Tests BTM map analysis and conversion to LML/XSLT
 */

import { convertMap } from '../../src/stage3-build/map-converter.js';
import type { ParsedMap } from '../../src/types/biztalk.js';

function makeMap(overrides: Partial<ParsedMap> = {}): ParsedMap {
  return {
    name:                   'TestMap',
    className:              'TestNamespace.TestMap',
    filePath:               'TestMap.btm',
    sourceSchemaRef:        'TestNamespace.InputSchema',
    destinationSchemaRef:   'TestNamespace.OutputSchema',
    functoids:              [],
    links:                  [],
    linkCount:              0,
    hasScriptingFunctoids:  false,
    hasLooping:             false,
    hasDatabaseFunctoids:   false,
    functoidCategories:     [],
    ...overrides,
  };
}

// ─── Simple Map → LML ────────────────────────────────────────────────────────

describe('convertMap — simple map', () => {
  // Set recommendedMigrationPath so convertMap selects the 'lml' format
  const result = convertMap(makeMap({ recommendedMigrationPath: 'lml' }));

  it('returns a conversion result', () => {
    expect(result).toBeDefined();
  });

  it('has a name', () => {
    expect(typeof result.name).toBe('string');
    expect(result.name.length).toBeGreaterThan(0);
  });

  it('has content', () => {
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('specifies a format', () => {
    expect(['lml', 'xslt', 'xslt-rewrite', 'function-stub', 'manual']).toContain(result.format);
  });

  it('has a warnings array', () => {
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('converts simple map to LML format', () => {
    expect(result.format).toBe('lml');
  });
});

// ─── Map with Scripting Functoids → XSLT ─────────────────────────────────────

describe('convertMap — scripting functoids', () => {
  const result = convertMap(makeMap({
    hasScriptingFunctoids: true,
    functoids: [{
      functoidId: 1,
      category: 'scripting',
      isScripting: true,
      scriptCode: 'return input.ToUpper();',
      inputs: [],
      outputs: [],
    }],
  }));

  it('uses XSLT format for scripting maps', () => {
    expect(['xslt', 'xslt-rewrite', 'function-stub']).toContain(result.format);
  });

  it('adds a warning about scripting functoids', () => {
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ─── Map with Looping ─────────────────────────────────────────────────────────

describe('convertMap — looping functoids', () => {
  const result = convertMap(makeMap({
    hasLooping: true,
    functoids: [{
      functoidId: 2,
      category: 'logical',
      isScripting: false,
      inputs: [],
      outputs: [],
    }],
  }));

  it('produces a result', () => {
    expect(result).toBeDefined();
  });

  it('handles looping gracefully', () => {
    expect(result.format).toBeDefined();
  });
});

// ─── Database Functoids → Function Stub ───────────────────────────────────────

describe('convertMap — database functoids', () => {
  const result = convertMap(makeMap({
    hasDatabaseFunctoids: true,
    functoids: [{
      functoidId: 3,
      category: 'database',
      isScripting: false,
      databaseTableRef: 'dbo.Products',
      inputs: [],
      outputs: [],
    }],
  }));

  it('uses function-stub format for database functoids', () => {
    expect(['function-stub', 'xslt', 'xslt-rewrite']).toContain(result.format);
  });
});
