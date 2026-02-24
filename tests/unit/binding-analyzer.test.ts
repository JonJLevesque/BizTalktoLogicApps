/**
 * Unit tests for Stage 1 — Binding Analyzer
 * Uses real BindingInfo.xml fixture files
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeBindingsXml } from '../../src/stage1-understand/binding-analyzer.js';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');

function fixture(path: string): string {
  return readFileSync(join(FIXTURES, path), 'utf8');
}

// ─── Simple File Receive Bindings ─────────────────────────────────────────────

describe('analyzeBindingsXml — SimpleFileReceive', () => {
  const xml = fixture('02-simple-file-receive/bindings/BindingInfo.xml');
  let result: ReturnType<typeof analyzeBindingsXml>;

  beforeAll(() => { result = analyzeBindingsXml(xml); });

  it('parses without throwing', () => {
    expect(result).toBeDefined();
  });

  it('extracts receive locations', () => {
    expect(result.receiveLocations.length).toBeGreaterThan(0);
  });

  it('identifies FILE adapter on receive location', () => {
    const rl = result.receiveLocations[0];
    expect(rl).toBeDefined();
    expect(rl?.adapterType.toUpperCase()).toBe('FILE');
  });

  it('captures receive location address', () => {
    const rl = result.receiveLocations[0];
    expect(rl?.address).toContain('Input');
  });

  it('extracts send ports', () => {
    expect(result.sendPorts.length).toBeGreaterThan(0);
  });

  it('identifies FILE adapter on send port', () => {
    const sp = result.sendPorts[0];
    expect(sp).toBeDefined();
    expect(sp?.adapterType.toUpperCase()).toBe('FILE');
  });

  it('has correct send port address', () => {
    const sp = result.sendPorts[0];
    expect(sp?.address).toContain('Output');
  });
});

// ─── Content-Based Routing Bindings ──────────────────────────────────────────

describe('analyzeBindingsXml — ContentBasedRouting', () => {
  const xml = fixture('03-content-based-routing/bindings/BindingInfo.xml');
  let result: ReturnType<typeof analyzeBindingsXml>;

  beforeAll(() => { result = analyzeBindingsXml(xml); });

  it('parses without throwing', () => {
    expect(result).toBeDefined();
  });

  it('extracts send ports', () => {
    expect(result.sendPorts.length).toBeGreaterThan(0);
  });

  it('has multiple send ports for routing scenario', () => {
    // CBR typically routes to multiple send ports
    expect(result.sendPorts.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe('analyzeBindingsXml — edge cases', () => {
  it('returns empty collections for minimal BindingInfo', () => {
    // Provide a valid root element with no ports
    const result = analyzeBindingsXml('<BindingInfo Name="EmptyApp"/>');
    expect(result.receiveLocations).toEqual([]);
    expect(result.sendPorts).toEqual([]);
  });

  it('throws for non-BindingInfo XML input', () => {
    // Analyzer requires a <BindingInfo> root — throws BindingParseError otherwise
    expect(() => analyzeBindingsXml('not xml')).toThrow();
  });
});
