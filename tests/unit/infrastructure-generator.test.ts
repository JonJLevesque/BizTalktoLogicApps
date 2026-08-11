/**
 * Unit tests for Stage 3 — Infrastructure Generator
 *
 * Guards the deploy-time vs local-dev settings split:
 *   - Workflows.<name>.FlowState=Disabled belongs in the ARM template's
 *     siteConfig.appSettings (deployed) — NEVER in local.settings.json
 *     (not deployed; would only break local F5 debugging).
 *   - FUNCTIONS_WORKER_RUNTIME must be 'dotnet' (+ FUNCTIONS_INPROC_NET8_ENABLED=1)
 *     consistently across ARM and local.settings.json. 'dotnet-isolated' is
 *     explicitly forbidden for Logic Apps Standard custom code.
 *   - TLS 1.2 minimum on the Microsoft.Web/sites resource.
 */

import { describe, it, expect } from 'vitest';
import {
  generateArmTemplate,
  generateLocalSettings,
  generateBicepTemplate,
  generateTerraformFiles,
} from '../../src/stage3-build/infrastructure-generator.js';
import type { ArchitectureRecommendation } from '../../src/types/migration.js';

function makeArch(overrides: Partial<ArchitectureRecommendation> = {}): ArchitectureRecommendation {
  return {
    targetSku:                  'standard',
    workflowCount:              2,
    requiresIntegrationAccount: false,
    requiresOnPremGateway:      false,
    requiresVnetIntegration:    false,
    azureServicesRequired:      [],
    rationale:                  'test',
    ...overrides,
  };
}

interface SiteAppSetting { name: string; value: string }

function getSiteAppSettings(arch: ArchitectureRecommendation, workflowNames: string[]): SiteAppSetting[] {
  const template = generateArmTemplate(arch, workflowNames);
  const site = template.resources.find(r => r.type === 'Microsoft.Web/sites');
  expect(site, 'ARM template must contain a Microsoft.Web/sites resource').toBeDefined();
  const siteConfig = (site!.properties as Record<string, unknown>)['siteConfig'] as Record<string, unknown>;
  return siteConfig['appSettings'] as SiteAppSetting[];
}

describe('generateArmTemplate — FlowState placement', () => {
  it('adds Workflows.<name>.FlowState=Disabled to siteConfig.appSettings for every workflow', () => {
    const appSettings = getSiteAppSettings(makeArch(), ['Process-Order', 'Route-Payment']);

    const flowStates = appSettings.filter(s => s.name.endsWith('.FlowState'));
    expect(flowStates).toHaveLength(2);
    expect(flowStates).toContainEqual({ name: 'Workflows.Process-Order.FlowState', value: 'Disabled' });
    expect(flowStates).toContainEqual({ name: 'Workflows.Route-Payment.FlowState', value: 'Disabled' });
  });

  it('emits no FlowState entries when no workflow names are given', () => {
    const appSettings = getSiteAppSettings(makeArch(), []);
    expect(appSettings.some(s => s.name.includes('.FlowState'))).toBe(false);
  });
});

describe('generateLocalSettings — FlowState must NOT appear', () => {
  it('never emits Workflows.<name>.FlowState entries (local.settings.json is not deployed)', () => {
    const settings = generateLocalSettings({ KVS_Storage_Blob_ConnectionString: 'x' });
    const values = settings['Values'] as Record<string, string>;
    expect(Object.keys(values).some(k => k.includes('.FlowState'))).toBe(false);
  });
});

describe('worker runtime consistency (dotnet, never dotnet-isolated)', () => {
  it('ARM siteConfig.appSettings uses FUNCTIONS_WORKER_RUNTIME=dotnet with FUNCTIONS_INPROC_NET8_ENABLED=1', () => {
    const appSettings = getSiteAppSettings(makeArch(), ['Wf']);
    expect(appSettings).toContainEqual({ name: 'FUNCTIONS_WORKER_RUNTIME', value: 'dotnet' });
    expect(appSettings).toContainEqual({ name: 'FUNCTIONS_INPROC_NET8_ENABLED', value: '1' });
  });

  it('local.settings.json matches the ARM worker runtime settings', () => {
    const values = generateLocalSettings({})['Values'] as Record<string, string>;
    expect(values['FUNCTIONS_WORKER_RUNTIME']).toBe('dotnet');
    expect(values['FUNCTIONS_INPROC_NET8_ENABLED']).toBe('1');
  });

  it('no generated IaC output contains dotnet-isolated', () => {
    const arch = makeArch();
    const arm = JSON.stringify(generateArmTemplate(arch, ['Wf']));
    const bicep = generateBicepTemplate(arch);
    const terraform = Object.values(generateTerraformFiles(arch)).join('\n');

    expect(arm).not.toContain('dotnet-isolated');
    expect(bicep).not.toContain('dotnet-isolated');
    expect(terraform).not.toContain('dotnet-isolated');
    expect(bicep).toContain('FUNCTIONS_INPROC_NET8_ENABLED');
    expect(terraform).toContain('FUNCTIONS_INPROC_NET8_ENABLED');
  });
});

describe('TLS hardening on the Logic App site', () => {
  it('ARM Microsoft.Web/sites enforces TLS 1.2 minimum and HTTPS only', () => {
    const template = generateArmTemplate(makeArch(), []);
    const site = template.resources.find(r => r.type === 'Microsoft.Web/sites')!;
    const props = site.properties as Record<string, unknown>;
    const siteConfig = props['siteConfig'] as Record<string, unknown>;

    expect(siteConfig['minTlsVersion']).toBe('1.2');
    expect(props['httpsOnly']).toBe(true);
  });

  it('Terraform logic app sets min_tls_version = "1.2"', () => {
    const mainTf = generateTerraformFiles(makeArch())['main.tf']!;
    expect(mainTf).toContain('min_tls_version = "1.2"');
  });
});
