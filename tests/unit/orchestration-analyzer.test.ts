/**
 * Unit tests for Stage 1 — Orchestration Analyzer
 * Uses real .odx.xml fixture files from tests/fixtures/
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeOrchestrationXml, flattenShapes } from '../../src/stage1-understand/orchestration-analyzer.js';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');

function fixture(path: string): string {
  return readFileSync(join(FIXTURES, path), 'utf8');
}

// ─── Simple File Receive ODX ─────────────────────────────────────────────────

describe('analyzeOrchestrationXml — SimpleFileReceive', () => {
  const xml = fixture('02-simple-file-receive/orchestration/SimpleFileReceive.odx.xml');
  let result: ReturnType<typeof analyzeOrchestrationXml>;

  beforeAll(() => { result = analyzeOrchestrationXml(xml); });

  it('parses orchestration name', () => {
    expect(result.name).toMatch(/SimpleFileOrchestration/i);
  });

  it('extracts shapes', () => {
    expect(result.shapes.length).toBeGreaterThan(0);
  });

  it('identifies a ReceiveShape', () => {
    const shapes = flattenShapes(result.shapes);
    const hasReceive = shapes.some(s => s.shapeType === 'ReceiveShape');
    expect(hasReceive).toBe(true);
  });

  it('identifies a TransformShape', () => {
    const shapes = flattenShapes(result.shapes);
    const hasTransform = shapes.some(s => s.shapeType === 'TransformShape');
    expect(hasTransform).toBe(true);
  });

  it('identifies a SendShape', () => {
    const shapes = flattenShapes(result.shapes);
    const hasSend = shapes.some(s => s.shapeType === 'SendShape');
    expect(hasSend).toBe(true);
  });

  it('extracts ports', () => {
    expect(result.ports.length).toBeGreaterThan(0);
  });

  it('identifies receive port polarity', () => {
    const receivePort = result.ports.find(p => p.name.toLowerCase().includes('receive'));
    expect(receivePort).toBeDefined();
    expect(receivePort?.polarity).toBe('Implements');
  });

  it('identifies send port polarity', () => {
    const sendPort = result.ports.find(p => p.name.toLowerCase().includes('send'));
    expect(sendPort).toBeDefined();
    expect(sendPort?.polarity).toBe('Uses');
  });

  it('has no atomic transactions in simple orchestration', () => {
    expect(result.hasAtomicTransactions).toBe(false);
  });

  it('has no correlation sets in simple orchestration', () => {
    expect(result.correlationSets.length).toBe(0);
  });

  it('returns required string fields', () => {
    expect(typeof result.name).toBe('string');
    expect(typeof result.namespace).toBe('string');
  });
});

// ─── Content-Based Routing ODX ───────────────────────────────────────────────

describe('analyzeOrchestrationXml — OrderRouter (CBR)', () => {
  const xml = fixture('03-content-based-routing/orchestration/OrderRouter.odx.xml');
  let result: ReturnType<typeof analyzeOrchestrationXml>;

  beforeAll(() => { result = analyzeOrchestrationXml(xml); });

  it('parses without throwing', () => {
    expect(result).toBeDefined();
  });

  it('has shapes', () => {
    expect(result.shapes.length).toBeGreaterThan(0);
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

// Minimal valid ODX: Module root + one Service element (no shapes or declarations)
const MINIMAL_ODX = `<om:Module xmlns:om="http://schemas.microsoft.com/BizTalk/2003/DesignerData"><om:Service Name="EmptyOrch" RootDefaultNamespace="NS"></om:Service></om:Module>`;

describe('analyzeOrchestrationXml — edge cases', () => {
  it('handles minimal valid ODX gracefully', () => {
    const result = analyzeOrchestrationXml(MINIMAL_ODX);
    expect(result).toBeDefined();
    expect(result.shapes).toEqual([]);
  });

  it('throws for non-ODX XML input', () => {
    // Analyzer requires a <Module> root — throws OdxParseError for unrecognised XML
    expect(() => analyzeOrchestrationXml('<BindingInfo/>')).toThrow();
  });

  it('returns empty arrays for orchestration with no declarations', () => {
    const result = analyzeOrchestrationXml(MINIMAL_ODX);
    expect(result.variables).toEqual([]);
    expect(result.messages).toEqual([]);
  });
});
