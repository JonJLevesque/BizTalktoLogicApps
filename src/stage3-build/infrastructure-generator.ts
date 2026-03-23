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
  appSettings: Record<string, string>,
  hasLocalCodeFunctions = false,
): Record<string, unknown> {
  return {
    IsEncrypted: false,
    Values: {
      AzureWebJobsStorage:           'UseDevelopmentStorage=true',
      FUNCTIONS_INPROC_NET8_ENABLED: '1',
      FUNCTIONS_WORKER_RUNTIME:      hasLocalCodeFunctions ? 'node' : 'dotnet',
      APP_KIND:                      'workflowapp',
      AzureWebJobsFeatureFlags:      'EnableMultiLanguageWorker',
      ProjectDirectoryPath:          '',
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

// ─── Bicep Template Generator ─────────────────────────────────────────────────

/**
 * Generates a Bicep template equivalent to the ARM template.
 * Bicep is the recommended IaC language for Azure — cleaner syntax, same resource model.
 */
export function generateBicepTemplate(arch: ArchitectureRecommendation): string {
  const needsIa  = arch.requiresIntegrationAccount;
  const needsSb  = arch.azureServicesRequired.includes('service-bus');
  const needsEh  = arch.azureServicesRequired.includes('event-hubs');

  const lines: string[] = [
    `@description('Base name for all resources. Max 43 chars (Logic Apps Standard limit).')`,
    `@maxLength(43)`,
    `param appName string`,
    ``,
    `@description('Azure region for all resources.')`,
    `param location string = resourceGroup().location`,
    ``,
    `@description('Logic Apps Standard App Service Plan SKU. WS1 = dev/test, WS2/WS3 = production.')`,
    `@allowed(['WS1', 'WS2', 'WS3'])`,
    `param appServicePlanSku string = 'WS1'`,
    ``,
    ...(needsIa ? [
      `@description('Integration Account SKU tier.')`,
      `@allowed(['Free', 'Basic', 'Standard'])`,
      `param integrationAccountSku string = '${arch.integrationAccountTier ?? 'Basic'}'`,
      ``,
    ] : []),
    `param tags object = {`,
    `  'migrated-from': 'biztalk'`,
    `  environment: 'production'`,
    `}`,
    ``,
    `// ── Variables ────────────────────────────────────────────────────────────────`,
    ``,
    `var planName         = '\${appName}-asp'`,
    `var storageName      = toLower(replace(appName, '-', ''))`,
    `var appInsightsName  = '\${appName}-ai'`,
    `var keyVaultName     = '\${appName}-kv'`,
    ...(needsSb ? [`var serviceBusName   = '\${appName}-sb'`] : []),
    ...(needsIa ? [`var integrationAcctName = '\${appName}-ia'`] : []),
    ...(needsEh ? [`var eventHubsName    = '\${appName}-eh'`] : []),
    ``,
    `// ── Storage Account ───────────────────────────────────────────────────────────`,
    ``,
    `resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {`,
    `  name:     storageName`,
    `  location: location`,
    `  tags:     tags`,
    `  sku:      { name: 'Standard_LRS' }`,
    `  kind:     'StorageV2'`,
    `  properties: {`,
    `    supportsHttpsTrafficOnly: true`,
    `    minimumTlsVersion:        'TLS1_2'`,
    `    allowBlobPublicAccess:    false`,
    `  }`,
    `}`,
    ``,
    `// ── Application Insights ──────────────────────────────────────────────────────`,
    ``,
    `resource appInsights 'Microsoft.Insights/components@2020-02-02' = {`,
    `  name:     appInsightsName`,
    `  location: location`,
    `  tags:     tags`,
    `  kind:     'web'`,
    `  properties: {`,
    `    Application_Type: 'web'`,
    `    RetentionInDays:  90`,
    `  }`,
    `}`,
    ``,
    `// ── Key Vault ─────────────────────────────────────────────────────────────────`,
    ``,
    `resource keyVault 'Microsoft.KeyVault/vaults@2023-02-01' = {`,
    `  name:     keyVaultName`,
    `  location: location`,
    `  tags:     tags`,
    `  properties: {`,
    `    sku:                          { family: 'A', name: 'standard' }`,
    `    tenantId:                     subscription().tenantId`,
    `    enableSoftDelete:             true`,
    `    softDeleteRetentionInDays:    90`,
    `    enabledForTemplateDeployment: true`,
    `    accessPolicies:               []`,
    `  }`,
    `}`,
    ``,
    `// ── App Service Plan ──────────────────────────────────────────────────────────`,
    ``,
    `resource appServicePlan 'Microsoft.Web/serverfarms@2022-09-01' = {`,
    `  name:     planName`,
    `  location: location`,
    `  tags:     tags`,
    `  sku:      { name: appServicePlanSku, tier: 'WorkflowStandard' }`,
    `  kind:     'elastic'`,
    `  properties: {`,
    `    maximumElasticWorkerCount: 20`,
    `    isSpot:                    false`,
    `  }`,
    `}`,
    ``,
    ...(needsIa ? [
      `// ── Integration Account ───────────────────────────────────────────────────────`,
      ``,
      `resource integrationAccount 'Microsoft.Logic/integrationAccounts@2019-05-01' = {`,
      `  name:     integrationAcctName`,
      `  location: location`,
      `  tags:     tags`,
      `  sku:      { name: integrationAccountSku }`,
      `  properties: {}`,
      `}`,
      ``,
    ] : []),
    ...(needsSb ? [
      `// ── Service Bus ───────────────────────────────────────────────────────────────`,
      ``,
      `resource serviceBus 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {`,
      `  name:     serviceBusName`,
      `  location: location`,
      `  tags:     tags`,
      `  sku:      { name: 'Standard', tier: 'Standard' }`,
      `  properties: { minimumTlsVersion: '1.2' }`,
      `}`,
      ``,
    ] : []),
    ...(needsEh ? [
      `// ── Event Hubs ────────────────────────────────────────────────────────────────`,
      ``,
      `resource eventHubs 'Microsoft.EventHub/namespaces@2022-10-01-preview' = {`,
      `  name:     eventHubsName`,
      `  location: location`,
      `  tags:     tags`,
      `  sku:      { name: 'Standard', tier: 'Standard', capacity: 1 }`,
      `  properties: { isAutoInflateEnabled: true, maximumThroughputUnits: 10 }`,
      `}`,
      ``,
    ] : []),
    `// ── Logic Apps Standard ───────────────────────────────────────────────────────`,
    ``,
    `resource logicApp 'Microsoft.Web/sites@2022-09-01' = {`,
    `  name:     appName`,
    `  location: location`,
    `  tags:     tags`,
    `  kind:     'functionapp,workflowapp'`,
    `  identity: { type: 'SystemAssigned' }`,
    `  properties: {`,
    `    serverFarmId: appServicePlan.id`,
    `    siteConfig: {`,
    `      appSettings: [`,
    `        { name: 'APP_KIND',                              value: 'workflowapp' }`,
    `        { name: 'FUNCTIONS_WORKER_RUNTIME',              value: 'dotnet-isolated' }`,
    `        { name: 'AzureWebJobsFeatureFlags',              value: 'EnableMultiLanguageWorker' }`,
    `        { name: 'AzureWebJobsStorage',                   value: 'DefaultEndpointsProtocol=https;AccountName=\${storageName};AccountKey=\${storage.listKeys().keys[0].value}' }`,
    `        { name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING', value: 'DefaultEndpointsProtocol=https;AccountName=\${storageName};AccountKey=\${storage.listKeys().keys[0].value}' }`,
    `        { name: 'WEBSITE_CONTENTSHARE',                  value: toLower(appName) }`,
    `        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING',  value: appInsights.properties.ConnectionString }`,
    `        { name: 'WORKFLOWS_SUBSCRIPTION_ID',             value: subscription().subscriptionId }`,
    `        { name: 'WORKFLOWS_LOCATION_NAME',               value: location }`,
    `        { name: 'WORKFLOWS_RESOURCE_GROUP_NAME',         value: resourceGroup().name }`,
    ...(needsIa ? [
    `        { name: 'LOGIC_APP_INTEGRATION_ACCOUNT_ID',      value: integrationAccount.id }`,
    ] : []),
    `      ]`,
    `      ftpsState:     'Disabled'`,
    `      minTlsVersion: '1.2'`,
    `    }`,
    `    httpsOnly: true`,
    ...(needsIa ? [
    `    integrationAccount: { id: integrationAccount.id }`,
    ] : []),
    `  }`,
    `}`,
    ``,
    `// ── Outputs ───────────────────────────────────────────────────────────────────`,
    ``,
    `output logicAppName        string = logicApp.name`,
    `output logicAppResourceId  string = logicApp.id`,
    `output logicAppPrincipalId string = logicApp.identity.principalId`,
    `output appInsightsKey      string = appInsights.properties.InstrumentationKey`,
    ``,
  ];

  return lines.join('\n');
}

// ─── Terraform Generator ──────────────────────────────────────────────────────

/**
 * Generates Terraform HCL files for provisioning the Logic Apps Standard infrastructure.
 * Returns a map of filename → content: main.tf, variables.tf, outputs.tf, providers.tf
 */
export function generateTerraformFiles(arch: ArchitectureRecommendation): Record<string, string> {
  const needsIa  = arch.requiresIntegrationAccount;
  const needsSb  = arch.azureServicesRequired.includes('service-bus');
  const needsEh  = arch.azureServicesRequired.includes('event-hubs');

  const providersTf = [
    `terraform {`,
    `  required_providers {`,
    `    azurerm = {`,
    `      source  = "hashicorp/azurerm"`,
    `      version = "~> 3.0"`,
    `    }`,
    `  }`,
    `  required_version = ">= 1.3.0"`,
    `}`,
    ``,
    `provider "azurerm" {`,
    `  features {`,
    `    key_vault {`,
    `      purge_soft_delete_on_destroy = false`,
    `    }`,
    `  }`,
    `}`,
    ``,
  ].join('\n');

  const variablesTf = [
    `variable "app_name" {`,
    `  description = "Base name for all resources. Max 43 chars (Logic Apps Standard limit)."`,
    `  type        = string`,
    `  validation {`,
    `    condition     = length(var.app_name) <= 43`,
    `    error_message = "app_name must be 43 characters or fewer."`,
    `  }`,
    `}`,
    ``,
    `variable "resource_group_name" {`,
    `  description = "Name of the Azure resource group."`,
    `  type        = string`,
    `}`,
    ``,
    `variable "location" {`,
    `  description = "Azure region for all resources."`,
    `  type        = string`,
    `  default     = "eastus"`,
    `}`,
    ``,
    `variable "app_service_plan_sku" {`,
    `  description = "Logic Apps Standard SKU. WS1 = dev/test, WS2/WS3 = production."`,
    `  type        = string`,
    `  default     = "WS1"`,
    `  validation {`,
    `    condition     = contains(["WS1", "WS2", "WS3"], var.app_service_plan_sku)`,
    `    error_message = "Must be WS1, WS2, or WS3."`,
    `  }`,
    `}`,
    ``,
    ...(needsIa ? [
    `variable "integration_account_sku" {`,
    `  description = "Integration Account SKU tier."`,
    `  type        = string`,
    `  default     = "${arch.integrationAccountTier ?? 'Basic'}"`,
    `  validation {`,
    `    condition     = contains(["Free", "Basic", "Standard"], var.integration_account_sku)`,
    `    error_message = "Must be Free, Basic, or Standard."`,
    `  }`,
    `}`,
    ``,
    ] : []),
    `variable "tags" {`,
    `  description = "Resource tags applied to all resources."`,
    `  type        = map(string)`,
    `  default     = {`,
    `    "migrated-from" = "biztalk"`,
    `    "environment"   = "production"`,
    `  }`,
    `}`,
    ``,
  ].join('\n');

  const mainTf = [
    `data "azurerm_client_config" "current" {}`,
    ``,
    `locals {`,
    `  storage_name         = lower(replace(var.app_name, "-", ""))`,
    `  plan_name            = "\${var.app_name}-asp"`,
    `  app_insights_name    = "\${var.app_name}-ai"`,
    `  key_vault_name       = "\${var.app_name}-kv"`,
    ...(needsSb ? [`  service_bus_name     = "\${var.app_name}-sb"`] : []),
    ...(needsIa ? [`  integration_acct_name = "\${var.app_name}-ia"`] : []),
    ...(needsEh ? [`  event_hubs_name      = "\${var.app_name}-eh"`] : []),
    `}`,
    ``,
    `# ── Storage Account ──────────────────────────────────────────────────────────`,
    ``,
    `resource "azurerm_storage_account" "main" {`,
    `  name                     = local.storage_name`,
    `  resource_group_name      = var.resource_group_name`,
    `  location                 = var.location`,
    `  account_tier             = "Standard"`,
    `  account_replication_type = "LRS"`,
    `  min_tls_version          = "TLS1_2"`,
    `  allow_nested_items_to_be_public = false`,
    `  tags                     = var.tags`,
    `}`,
    ``,
    `# ── Application Insights ─────────────────────────────────────────────────────`,
    ``,
    `resource "azurerm_application_insights" "main" {`,
    `  name                = local.app_insights_name`,
    `  location            = var.location`,
    `  resource_group_name = var.resource_group_name`,
    `  application_type    = "web"`,
    `  retention_in_days   = 90`,
    `  tags                = var.tags`,
    `}`,
    ``,
    `# ── Key Vault ────────────────────────────────────────────────────────────────`,
    ``,
    `resource "azurerm_key_vault" "main" {`,
    `  name                       = local.key_vault_name`,
    `  location                   = var.location`,
    `  resource_group_name        = var.resource_group_name`,
    `  tenant_id                  = data.azurerm_client_config.current.tenant_id`,
    `  sku_name                   = "standard"`,
    `  soft_delete_retention_days = 90`,
    `  enable_rbac_authorization  = true`,
    `  tags                       = var.tags`,
    `}`,
    ``,
    `# ── App Service Plan ─────────────────────────────────────────────────────────`,
    ``,
    `resource "azurerm_service_plan" "main" {`,
    `  name                = local.plan_name`,
    `  location            = var.location`,
    `  resource_group_name = var.resource_group_name`,
    `  os_type             = "Windows"`,
    `  sku_name            = var.app_service_plan_sku`,
    `  tags                = var.tags`,
    `}`,
    ``,
    ...(needsIa ? [
    `# ── Integration Account ──────────────────────────────────────────────────────`,
    ``,
    `resource "azurerm_logic_app_integration_account" "main" {`,
    `  name                = local.integration_acct_name`,
    `  location            = var.location`,
    `  resource_group_name = var.resource_group_name`,
    `  sku_name            = var.integration_account_sku`,
    `  tags                = var.tags`,
    `}`,
    ``,
    ] : []),
    ...(needsSb ? [
    `# ── Service Bus ──────────────────────────────────────────────────────────────`,
    ``,
    `resource "azurerm_servicebus_namespace" "main" {`,
    `  name                = local.service_bus_name`,
    `  location            = var.location`,
    `  resource_group_name = var.resource_group_name`,
    `  sku                 = "Standard"`,
    `  minimum_tls_version = "1.2"`,
    `  tags                = var.tags`,
    `}`,
    ``,
    ] : []),
    ...(needsEh ? [
    `# ── Event Hubs ───────────────────────────────────────────────────────────────`,
    ``,
    `resource "azurerm_eventhub_namespace" "main" {`,
    `  name                = local.event_hubs_name`,
    `  location            = var.location`,
    `  resource_group_name = var.resource_group_name`,
    `  sku                 = "Standard"`,
    `  capacity            = 1`,
    `  auto_inflate_enabled     = true`,
    `  maximum_throughput_units = 10`,
    `  tags                     = var.tags`,
    `}`,
    ``,
    ] : []),
    `# ── Logic Apps Standard ──────────────────────────────────────────────────────`,
    ``,
    `resource "azurerm_logic_app_standard" "main" {`,
    `  name                       = var.app_name`,
    `  location                   = var.location`,
    `  resource_group_name        = var.resource_group_name`,
    `  app_service_plan_id        = azurerm_service_plan.main.id`,
    `  storage_account_name       = azurerm_storage_account.main.name`,
    `  storage_account_access_key = azurerm_storage_account.main.primary_access_key`,
    `  https_only                 = true`,
    `  tags                       = var.tags`,
    ``,
    `  identity {`,
    `    type = "SystemAssigned"`,
    `  }`,
    ``,
    `  app_settings = {`,
    `    "APP_KIND"                              = "workflowapp"`,
    `    "FUNCTIONS_WORKER_RUNTIME"              = "dotnet-isolated"`,
    `    "AzureWebJobsFeatureFlags"              = "EnableMultiLanguageWorker"`,
    `    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.main.connection_string`,
    `    "WORKFLOWS_SUBSCRIPTION_ID"             = data.azurerm_client_config.current.subscription_id`,
    `    "WORKFLOWS_LOCATION_NAME"               = var.location`,
    `    "WORKFLOWS_RESOURCE_GROUP_NAME"         = var.resource_group_name`,
    ...(needsIa ? [
    `    "LOGIC_APP_INTEGRATION_ACCOUNT_ID"      = azurerm_logic_app_integration_account.main.id`,
    ] : []),
    `  }`,
    ...(needsIa ? [
    ``,
    `  # Link to Integration Account`,
    `  integration_account_id = azurerm_logic_app_integration_account.main.id`,
    ] : []),
    `}`,
    ``,
    `# Grant Logic App managed identity access to Key Vault secrets`,
    `resource "azurerm_role_assignment" "logicapp_kv_secrets" {`,
    `  scope                = azurerm_key_vault.main.id`,
    `  role_definition_name = "Key Vault Secrets User"`,
    `  principal_id         = azurerm_logic_app_standard.main.identity[0].principal_id`,
    `}`,
    ``,
  ].join('\n');

  const outputsTf = [
    `output "logic_app_name" {`,
    `  description = "Name of the Logic Apps Standard application."`,
    `  value       = azurerm_logic_app_standard.main.name`,
    `}`,
    ``,
    `output "logic_app_id" {`,
    `  description = "Resource ID of the Logic Apps Standard application."`,
    `  value       = azurerm_logic_app_standard.main.id`,
    `}`,
    ``,
    `output "logic_app_principal_id" {`,
    `  description = "Managed identity principal ID (for RBAC assignments)."`,
    `  value       = azurerm_logic_app_standard.main.identity[0].principal_id`,
    `}`,
    ``,
    `output "app_insights_connection_string" {`,
    `  description = "Application Insights connection string."`,
    `  value       = azurerm_application_insights.main.connection_string`,
    `  sensitive   = true`,
    `}`,
    ``,
    `output "key_vault_uri" {`,
    `  description = "Key Vault URI for storing connection strings and secrets."`,
    `  value       = azurerm_key_vault.main.vault_uri`,
    `}`,
    ``,
    ...(needsSb ? [
    `output "service_bus_namespace" {`,
    `  description = "Service Bus namespace name."`,
    `  value       = azurerm_servicebus_namespace.main.name`,
    `}`,
    ``,
    ] : []),
    ...(needsIa ? [
    `output "integration_account_id" {`,
    `  description = "Integration Account resource ID."`,
    `  value       = azurerm_logic_app_integration_account.main.id`,
    `}`,
    ``,
    ] : []),
  ].join('\n');

  return {
    'main.tf':      mainTf,
    'variables.tf': variablesTf,
    'outputs.tf':   outputsTf,
    'providers.tf': providersTf,
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
