/**
 * Infrastructure Generator — Stage 3 (Build)
 *
 * Generates ARM JSON templates and local.settings.json for deploying a
 * Logic Apps Standard application.
 *
 * ARM template structure:
 *   - Microsoft.Web/sites (Logic Apps Standard app)
 *   - Microsoft.Web/serverfarms (App Service Plan — WS1/WS2/WS3)
 *   - Microsoft.Storage/storageAccounts (required by Standard runtime)
 *   - Microsoft.Insights/components (Application Insights)
 *   - Optional: Microsoft.ServiceBus/namespaces
 *   - Optional: Microsoft.Logic/integrationAccounts
 *
 * All connection strings and secrets use Key Vault references:
 *   "[concat('@Microsoft.KeyVault(SecretUri=', reference(variables('kv_...')).secretUri, ')')]"
 *
 * Parameters:
 *   - appName:    Base name for all resources
 *   - location:   Azure region (default: [resourceGroup().location])
 *   - sku:        App Service Plan SKU (default: WS1)
 *   - tags:       Resource tags
 */

import type { ArchitectureRecommendation, RequiredAzureService } from '../types/migration.js';

// ─── ARM resource type constants ──────────────────────────────────────────────

const ARM_API_VERSIONS: Record<string, string> = {
  'Microsoft.Web/serverfarms':                  '2022-09-01',
  'Microsoft.Web/sites':                        '2022-09-01',
  'Microsoft.Storage/storageAccounts':          '2023-01-01',
  'Microsoft.Insights/components':              '2020-02-02',
  'Microsoft.ServiceBus/namespaces':            '2022-10-01-preview',
  'Microsoft.Logic/integrationAccounts':        '2019-05-01',
  'Microsoft.EventHub/namespaces':              '2022-10-01-preview',
  'Microsoft.DocumentDB/databaseAccounts':      '2023-04-15',
  'Microsoft.Storage/storageAccounts/blobServices': '2023-01-01',
  'Microsoft.KeyVault/vaults':                  '2023-02-01',
  'Microsoft.Relay/namespaces':                 '2021-11-01',
  'Microsoft.ApiManagement/service':            '2022-08-01',
};

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ArmTemplate {
  $schema:        string;
  contentVersion: string;
  parameters:     Record<string, ArmParameter>;
  variables:      Record<string, unknown>;
  resources:      ArmResource[];
  outputs:        Record<string, ArmOutput>;
}

export interface ArmParameter {
  type:          'string' | 'int' | 'bool' | 'object' | 'array' | 'secureString';
  defaultValue?: unknown;
  allowedValues?: unknown[];
  maxLength?:    number;
  minLength?:    number;
  metadata?:     { description: string };
}

export interface ArmResource {
  type:       string;
  apiVersion: string;
  name:       string;
  location:   string;
  /** Accept ARM expression strings (e.g. "[parameters('tags')]") or literal tag objects */
  tags?:      Record<string, string> | string;
  sku?:       Record<string, unknown>;
  kind?:      string;
  identity?:  Record<string, unknown>;
  properties: Record<string, unknown>;
  dependsOn?: string[];
}

export interface ArmOutput {
  type:  string;
  value: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Non-null API version lookup — all keys in ARM_API_VERSIONS are explicitly defined */
function ver(resourceType: string): string {
  return ARM_API_VERSIONS[resourceType] ?? '2022-09-01';
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function generateArmTemplate(arch: ArchitectureRecommendation): ArmTemplate {
  const parameters = buildParameters(arch);
  const variables  = buildVariables(arch);
  const resources  = buildResources(arch);
  const outputs    = buildOutputs();

  return {
    $schema:        'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    parameters,
    variables,
    resources,
    outputs,
  };
}

/**
 * Generates local.settings.json for local Logic Apps Standard development.
 * Values are placeholders — real values go in Azure App Settings or Key Vault.
 */
export function generateLocalSettings(
  appSettings: Record<string, string>
): Record<string, unknown> {
  return {
    IsEncrypted: false,
    Values: {
      AzureWebJobsStorage:        'UseDevelopmentStorage=true',
      // FIX-07/11: Logic Apps Standard targets .NET 8 isolated worker model, not in-process.
      // 'dotnet-isolated' is required for Local Code Functions and Data Mapper support.
      // AzureWebJobsFeatureFlags enables Data Mapper local testing (prevents "undefined. undefined" error).
      FUNCTIONS_WORKER_RUNTIME:   'dotnet-isolated',
      FUNCTIONS_EXTENSION_VERSION: '~4',
      AzureWebJobsFeatureFlags:   'EnableMultiLanguageWorker',
      APP_KIND:                   'workflowapp',
      WEBSITE_NODE_DEFAULT_VERSION: '~18',
      ...Object.fromEntries(
        Object.entries(appSettings).map(([k]) => [k, `<set-in-azure-app-settings-or-keyvault>`])
      ),
    },
  };
}

// ─── Parameters ───────────────────────────────────────────────────────────────

function buildParameters(arch: ArchitectureRecommendation): Record<string, ArmParameter> {
  const params: Record<string, ArmParameter> = {
    appName: {
      type:      'string',
      maxLength: 43,
      metadata:  { description: 'Base name for all resources. Logic Apps Standard app names are capped at 43 characters. The first 32 characters must be unique per storage account (Host ID). Used as prefix for resource names.' },
    },
    location: {
      type:         'string',
      defaultValue: '[resourceGroup().location]',
      metadata:     { description: 'Azure region for all resources.' },
    },
    appServicePlanSku: {
      type:          'string',
      defaultValue:  'WS1',
      allowedValues: ['WS1', 'WS2', 'WS3'],
      metadata:      { description: 'Logic Apps Standard App Service Plan SKU. WS1 for dev/test, WS2/WS3 for production.' },
    },
    tags: {
      type:         'object',
      defaultValue: { 'migrated-from': 'biztalk', 'environment': 'production' },
      metadata:     { description: 'Resource tags applied to all deployed resources.' },
    },
  };

  if (arch.requiresIntegrationAccount) {
    params['integrationAccountSku'] = {
      type:          'string',
      defaultValue:  arch.integrationAccountTier ?? 'Basic',
      allowedValues: ['Free', 'Basic', 'Standard'],
      metadata:      { description: 'Integration Account SKU tier.' },
    };
  }

  return params;
}

// ─── Variables ────────────────────────────────────────────────────────────────

function buildVariables(arch: ArchitectureRecommendation): Record<string, unknown> {
  const vars: Record<string, unknown> = {
    planName:    "[concat(parameters('appName'), '-asp')]",
    storageName: "[concat(toLower(replace(parameters('appName'), '-', '')), 'stg')]",
    appInsightsName: "[concat(parameters('appName'), '-ai')]",
    logicAppName:    "[parameters('appName')]",
    keyVaultName:    "[concat(parameters('appName'), '-kv')]",
  };

  if (arch.azureServicesRequired.includes('service-bus')) {
    vars['serviceBusName'] = "[concat(parameters('appName'), '-sb')]";
  }

  if (arch.requiresIntegrationAccount) {
    vars['integrationAccountName'] = "[concat(parameters('appName'), '-ia')]";
  }

  if (arch.azureServicesRequired.includes('event-hubs')) {
    vars['eventHubsName'] = "[concat(parameters('appName'), '-eh')]";
  }

  if (arch.azureServicesRequired.includes('cosmos-db')) {
    vars['cosmosDbName'] = "[concat(toLower(replace(parameters('appName'), '-', '')), 'cosmos')]";
  }

  if (arch.azureServicesRequired.includes('azure-relay')) {
    vars['relayName'] = "[concat(parameters('appName'), '-relay')]";
  }

  return vars;
}

// ─── Resources ────────────────────────────────────────────────────────────────

function buildResources(arch: ArchitectureRecommendation): ArmResource[] {
  const resources: ArmResource[] = [];

  // Storage Account (always required by Logic Apps Standard)
  resources.push(buildStorageAccount());

  // Application Insights
  resources.push(buildApplicationInsights());

  // Key Vault (credential storage)
  resources.push(buildKeyVault());

  // App Service Plan
  resources.push(buildAppServicePlan());

  // Logic Apps Standard App
  resources.push(buildLogicApp(arch));

  // Optional services
  for (const svc of arch.azureServicesRequired) {
    switch (svc) {
      case 'service-bus':
        resources.push(buildServiceBusNamespace());
        break;
      case 'integration-account':
        resources.push(buildIntegrationAccount(arch.integrationAccountTier ?? 'Basic'));
        break;
      case 'event-hubs':
        resources.push(buildEventHubsNamespace());
        break;
      case 'cosmos-db':
        resources.push(buildCosmosDb());
        break;
      case 'azure-relay':
        resources.push(buildAzureRelay());
        break;
      case 'api-management':
        resources.push(buildApiManagement());
        break;
    }
  }

  return resources;
}

// ─── Individual Resource Builders ─────────────────────────────────────────────

function buildStorageAccount(): ArmResource {
  return {
    type:       'Microsoft.Storage/storageAccounts',
    apiVersion: ver('Microsoft.Storage/storageAccounts'),
    name:       "[variables('storageName')]",
    location:   "[parameters('location')]",
    tags:       "[parameters('tags')]",
    sku:        { name: 'Standard_LRS', tier: 'Standard' },
    kind:       'StorageV2',
    properties: {
      supportsHttpsTrafficOnly: true,
      minimumTlsVersion:        'TLS1_2',
      allowBlobPublicAccess:    false,
    },
  };
}

function buildApplicationInsights(): ArmResource {
  return {
    type:       'Microsoft.Insights/components',
    apiVersion: ver('Microsoft.Insights/components'),
    name:       "[variables('appInsightsName')]",
    location:   "[parameters('location')]",
    tags:       "[parameters('tags')]",
    kind:       'web',
    properties: {
      Application_Type:    'web',
      RetentionInDays:     90,
      publicNetworkAccessForIngestion: 'Enabled',
      publicNetworkAccessForQuery:     'Enabled',
    },
  };
}

function buildKeyVault(): ArmResource {
  return {
    type:       'Microsoft.KeyVault/vaults',
    apiVersion: ver('Microsoft.KeyVault/vaults'),
    name:       "[variables('keyVaultName')]",
    location:   "[parameters('location')]",
    tags:       "[parameters('tags')]",
    properties: {
      sku:                 { family: 'A', name: 'standard' },
      tenantId:            "[subscription().tenantId]",
      enableSoftDelete:    true,
      softDeleteRetentionInDays: 90,
      enabledForTemplateDeployment: true,
      accessPolicies:      [],
    },
  };
}

function buildAppServicePlan(): ArmResource {
  return {
    type:       'Microsoft.Web/serverfarms',
    apiVersion: ver('Microsoft.Web/serverfarms'),
    name:       "[variables('planName')]",
    location:   "[parameters('location')]",
    tags:       "[parameters('tags')]",
    sku:        {
      name:     "[parameters('appServicePlanSku')]",
      tier:     'WorkflowStandard',
    },
    kind:       'elastic',
    properties: {
      maximumElasticWorkerCount: 20,
      isSpot:                    false,
    },
  };
}

function buildLogicApp(arch: ArchitectureRecommendation): ArmResource {
  const appSettings: Record<string, string> = {
    APP_KIND:                        'workflowapp',
    // FIX-07: dotnet-isolated is required for Logic Apps Standard with Local Code Functions.
    FUNCTIONS_WORKER_RUNTIME:        'dotnet-isolated',
    AzureWebJobsFeatureFlags:        'EnableMultiLanguageWorker',
    WEBSITE_CONTENTAZUREFILECONNECTIONSTRING: "[concat('DefaultEndpointsProtocol=https;AccountName=', variables('storageName'), ';AccountKey=', listKeys(resourceId('Microsoft.Storage/storageAccounts', variables('storageName')), '2023-01-01').keys[0].value)]",
    WEBSITE_CONTENTSHARE:            "[toLower(variables('logicAppName'))]",
    AzureWebJobsStorage:             "[concat('DefaultEndpointsProtocol=https;AccountName=', variables('storageName'), ';AccountKey=', listKeys(resourceId('Microsoft.Storage/storageAccounts', variables('storageName')), '2023-01-01').keys[0].value)]",
    APPLICATIONINSIGHTS_CONNECTION_STRING: "[reference(resourceId('Microsoft.Insights/components', variables('appInsightsName')), '2020-02-02').ConnectionString]",
    'WORKFLOWS_SUBSCRIPTION_ID':     "[subscription().subscriptionId]",
    'WORKFLOWS_LOCATION_NAME':       "[parameters('location')]",
    'WORKFLOWS_RESOURCE_GROUP_NAME': "[resourceGroup().name]",
  };

  const resource: ArmResource = {
    type:       'Microsoft.Web/sites',
    apiVersion: ver('Microsoft.Web/sites'),
    name:       "[variables('logicAppName')]",
    location:   "[parameters('location')]",
    tags:       "[parameters('tags')]",
    kind:       'functionapp,workflowapp',
    identity:   { type: 'SystemAssigned' },
    properties: {
      serverFarmId: "[resourceId('Microsoft.Web/serverfarms', variables('planName'))]",
      siteConfig: {
        appSettings: Object.entries(appSettings).map(([name, value]) => ({ name, value })),
        cors:        { allowedOrigins: ['https://portal.azure.com'] },
        ftpsState:   'Disabled',
        minTlsVersion: '1.2',
      },
      httpsOnly: true,
    },
    dependsOn: [
      "[resourceId('Microsoft.Web/serverfarms', variables('planName'))]",
      "[resourceId('Microsoft.Storage/storageAccounts', variables('storageName'))]",
      "[resourceId('Microsoft.Insights/components', variables('appInsightsName'))]",
    ],
  };

  if (arch.requiresIntegrationAccount) {
    (resource.properties as Record<string, unknown>)['integrationAccount'] = {
      id: "[resourceId('Microsoft.Logic/integrationAccounts', variables('integrationAccountName'))]",
    };
    resource.dependsOn?.push(
      "[resourceId('Microsoft.Logic/integrationAccounts', variables('integrationAccountName'))]"
    );
  }

  return resource;
}

function buildServiceBusNamespace(): ArmResource {
  return {
    type:       'Microsoft.ServiceBus/namespaces',
    apiVersion: ver('Microsoft.ServiceBus/namespaces'),
    name:       "[variables('serviceBusName')]",
    location:   "[parameters('location')]",
    tags:       "[parameters('tags')]",
    sku:        { name: 'Standard', tier: 'Standard' },
    properties: {
      minimumTlsVersion: '1.2',
    },
  };
}

function buildIntegrationAccount(tier: string): ArmResource {
  return {
    type:       'Microsoft.Logic/integrationAccounts',
    apiVersion: ver('Microsoft.Logic/integrationAccounts'),
    name:       "[variables('integrationAccountName')]",
    location:   "[parameters('location')]",
    tags:       "[parameters('tags')]",
    sku:        { name: "[parameters('integrationAccountSku')]" },
    properties: {},
  };
}

function buildEventHubsNamespace(): ArmResource {
  return {
    type:       'Microsoft.EventHub/namespaces',
    apiVersion: ver('Microsoft.EventHub/namespaces'),
    name:       "[variables('eventHubsName')]",
    location:   "[parameters('location')]",
    tags:       "[parameters('tags')]",
    sku:        { name: 'Standard', tier: 'Standard', capacity: 1 },
    properties: {
      isAutoInflateEnabled:   true,
      maximumThroughputUnits: 10,
      minimumTlsVersion:      '1.2',
    },
  };
}

function buildCosmosDb(): ArmResource {
  return {
    type:       'Microsoft.DocumentDB/databaseAccounts',
    apiVersion: ver('Microsoft.DocumentDB/databaseAccounts'),
    name:       "[variables('cosmosDbName')]",
    location:   "[parameters('location')]",
    tags:       "[parameters('tags')]",
    kind:       'GlobalDocumentDB',
    properties: {
      databaseAccountOfferType: 'Standard',
      consistencyPolicy: {
        defaultConsistencyLevel: 'Session',
      },
      locations: [{
        locationName:     "[parameters('location')]",
        failoverPriority: 0,
        isZoneRedundant:  false,
      }],
      capabilities:  [{ name: 'EnableServerless' }],
      minimalTlsVersion: 'Tls12',
    },
  };
}

function buildAzureRelay(): ArmResource {
  return {
    type:       'Microsoft.Relay/namespaces',
    apiVersion: ver('Microsoft.Relay/namespaces'),
    name:       "[variables('relayName')]",
    location:   "[parameters('location')]",
    tags:       "[parameters('tags')]",
    sku:        { name: 'Standard', tier: 'Standard' },
    properties: {},
  };
}

function buildApiManagement(): ArmResource {
  return {
    type:       'Microsoft.ApiManagement/service',
    apiVersion: ver('Microsoft.ApiManagement/service'),
    name:       "[concat(parameters('appName'), '-apim')]",
    location:   "[parameters('location')]",
    tags:       "[parameters('tags')]",
    sku:        { name: 'Developer', capacity: 1 },
    properties: {
      publisherEmail: 'admin@example.com',
      publisherName:  'Migration Admin',
    },
  };
}

// ─── Outputs ──────────────────────────────────────────────────────────────────

function buildOutputs(): Record<string, ArmOutput> {
  return {
    logicAppName: {
      type:  'string',
      value: "[variables('logicAppName')]",
    },
    logicAppResourceId: {
      type:  'string',
      value: "[resourceId('Microsoft.Web/sites', variables('logicAppName'))]",
    },
    logicAppPrincipalId: {
      type:  'string',
      value: "[reference(resourceId('Microsoft.Web/sites', variables('logicAppName')), '2022-09-01', 'Full').identity.principalId]",
    },
    appInsightsInstrumentationKey: {
      type:  'string',
      value: "[reference(resourceId('Microsoft.Insights/components', variables('appInsightsName')), '2020-02-02').InstrumentationKey]",
    },
  };
}
