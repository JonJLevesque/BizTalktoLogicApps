/**
 * Output Writer — Write BuildResult + migration-report to disk
 *
 * Produces a Logic Apps Standard project matching the reference template.
 * The output directory IS the Logic Apps project root (flat structure).
 * If local code functions are present, the C# project lives in a sibling subfolder.
 *
 *   {outputDir}/                       ← Workspace root (matches Sandro's canonical structure)
 *     {AppName}.code-workspace         multi-root workspace file
 *     migration-report.md / .html      reports at workspace root
 *     {AppName}/                       ← Logic Apps Standard project
 *       .funcignore
 *       .gitignore
 *       .vscode/
 *         extensions.json
 *         launch.json
 *         settings.json
 *         tasks.json
 *       Artifacts/
 *         Maps/   {name}.xslt / .lml
 *         Rules/  (placeholder for migrated BRE rule policies)
 *         Schemas/ {name}.xsd
 *       lib/
 *         builtinOperationSdks/JAR/    (empty placeholder)
 *         builtinOperationSdks/net472/ (empty placeholder)
 *         custom/
 *           net472/
 *             extensions.json          {"extensions":[]}
 *           {FunctionName}/
 *             function.json            binding descriptor per local code function
 *       workflow-designtime/
 *         host.json
 *         local.settings.json
 *       {WorkflowName}/
 *         workflow.json
 *       connections.json
 *       host.json
 *       local.settings.json
 *       parameters.json
 *       arm-template.json / arm-parameters.json (if infrastructure included)
 *       tests/ {WorkflowName}.tests.json
 *     {AppName}_Functions/             ← C# project (only if local code functions exist)
 *       {FunctionName}.cs
 *       {AppName}_Functions.csproj
 *       {AppName}_Functions.sln
 *       .vscode/
 */

import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, basename, resolve } from 'path';
import type { BuildResult } from '../stage3-build/package-builder.js';
import { migrationReportToHtml } from './markdown-to-html.js';

export interface WriteOptions {
  /** The directory to write all output files to */
  outputDir: string;
  /** The fully generated BuildResult from the scaffold step */
  buildResult: BuildResult;
  /** The markdown migration report */
  migrationReport: string;
}

export function writeOutput(options: WriteOptions): void {
  const { outputDir, buildResult, migrationReport } = options;
  const appName = buildResult.project.appName;

  // ── Workspace root (outputDir) — matches Sandro's canonical structure ───────
  //
  //   {outputDir}/                        ← workspace root (4 items + reports)
  //     {AppName}.code-workspace
  //     {AppName}/                        ← Logic Apps project
  //       connections.json, host.json, workflows/, Artifacts/, lib/, ...
  //     {AppName}_Infra/                  ← Infrastructure-as-code (ARM / Terraform)
  //       arm-template.json, arm-parameters.json, README.md
  //     {AppName}_Functions/              ← C# Functions project (only if custom code)
  //       *.cs, *.csproj, *.sln, .vscode/
  //     migration-report.md
  //     migration-report.html
  //
  ensureDir(outputDir);

  // Logic Apps project lives in a named subdirectory, not directly in outputDir
  const logicAppDir = join(outputDir, appName);
  ensureDir(logicAppDir);

  // ── Workflows ──────────────────────────────────────────────────────────────
  for (const wf of buildResult.project.workflows) {
    const wfDir = join(logicAppDir, wf.name);
    ensureDir(wfDir);
    writeJson(join(wfDir, 'workflow.json'), wf.workflow);
  }

  // ── Root Logic Apps project files ──────────────────────────────────────────
  writeJson(join(logicAppDir, 'connections.json'), buildResult.project.connections);
  writeJson(join(logicAppDir, 'host.json'), buildResult.project.host);
  // Patch ProjectDirectoryPath to the absolute path of the Logic Apps project folder
  // so that the VS Code designer can discover local code functions in lib/custom/.
  const localSettings = JSON.parse(JSON.stringify(buildResult.localSettings)) as Record<string, unknown>;
  const localSettingsVals = localSettings['Values'] as Record<string, string> | undefined;
  if (localSettingsVals) localSettingsVals['ProjectDirectoryPath'] = resolve(logicAppDir);
  writeJson(join(logicAppDir, 'local.settings.json'), localSettings);
  writeJson(join(logicAppDir, 'parameters.json'), {});

  // ── Artifacts — always created (Maps, Rules, Schemas always present) ────────
  const mapsDir    = join(logicAppDir, 'Artifacts', 'Maps');
  const rulesDir   = join(logicAppDir, 'Artifacts', 'Rules');
  const schemasDir = join(logicAppDir, 'Artifacts', 'Schemas');
  ensureDir(mapsDir);
  ensureDir(rulesDir);
  ensureDir(schemasDir);

  for (const [name, content] of Object.entries(buildResult.project.xsltMaps)) {
    writeFileSync(join(mapsDir, name), content, 'utf-8');
  }
  for (const [name, content] of Object.entries(buildResult.project.lmlMaps)) {
    writeFileSync(join(mapsDir, name), content, 'utf-8');
  }

  if (buildResult.schemaFiles && buildResult.schemaFiles.length > 0) {
    for (const schemaPath of buildResult.schemaFiles) {
      try {
        copyFileSync(schemaPath, join(schemasDir, basename(schemaPath)));
      } catch {
        // Non-fatal: schema file may have moved since artifact scan
      }
    }
  }

  // ── workflow-designtime — inside Logic Apps project ─────────────────────────
  const wdDir = join(logicAppDir, 'workflow-designtime');
  ensureDir(wdDir);
  writeJson(join(wdDir, 'host.json'), WORKFLOW_DESIGNTIME_HOST);
  // Patch ProjectDirectoryPath to the Logic Apps project root for the designtime settings too
  const wdLocalSettings = JSON.parse(JSON.stringify(WORKFLOW_DESIGNTIME_LOCAL_SETTINGS)) as Record<string, unknown>;
  const wdVals = wdLocalSettings['Values'] as Record<string, string> | undefined;
  if (wdVals) wdVals['ProjectDirectoryPath'] = resolve(logicAppDir);
  writeJson(join(wdDir, 'local.settings.json'), wdLocalSettings);

  // ── lib/custom structure (inside Logic Apps project) ───────────────────────
  const net472Dir = join(logicAppDir, 'lib', 'custom', 'net472');
  ensureDir(net472Dir);
  writeJson(join(net472Dir, 'extensions.json'), { extensions: [] });

  // builtinOperationSdks placeholder dirs — Logic Apps Standard runtime expects these
  ensureDir(join(logicAppDir, 'lib', 'builtinOperationSdks', 'JAR'));
  ensureDir(join(logicAppDir, 'lib', 'builtinOperationSdks', 'net472'));

  // ── .vscode/ (inside Logic Apps project) ───────────────────────────────────
  const vscodeDir = join(logicAppDir, '.vscode');
  ensureDir(vscodeDir);
  writeJson(join(vscodeDir, 'extensions.json'), {
    recommendations: ['ms-azuretools.vscode-azurelogicapps'],
  });
  writeJson(join(vscodeDir, 'settings.json'), generateVscodeSettings());
  writeJson(join(vscodeDir, 'tasks.json'), VSCODE_TASKS);

  // ── .funcignore / .gitignore (inside Logic Apps project) ───────────────────
  writeFileSync(join(logicAppDir, '.funcignore'), FUNCIGNORE_CONTENT, 'utf-8');
  writeFileSync(join(logicAppDir, '.gitignore'), GITIGNORE_CONTENT, 'utf-8');

  // ── Infra folder — sibling to Logic Apps project, NOT in the workspace ──────
  // Infrastructure-as-code lives here, separate from the Logic Apps code project.
  // Includes ARM (for Azure CLI / pipelines), Bicep (recommended Azure IaC), and Terraform.
  const infraDir = join(outputDir, `${appName}_Infra`);
  ensureDir(infraDir);

  if (buildResult.armTemplate && Object.keys(buildResult.armTemplate).length > 0) {
    const armDir = join(infraDir, 'arm');
    ensureDir(armDir);
    writeJson(join(armDir, 'arm-template.json'),   buildResult.armTemplate);
    writeJson(join(armDir, 'arm-parameters.json'), buildResult.armParameters);
  }

  if (buildResult.bicepTemplate) {
    const bicepDir = join(infraDir, 'bicep');
    ensureDir(bicepDir);
    writeFileSync(join(bicepDir, 'main.bicep'), buildResult.bicepTemplate, 'utf-8');
  }

  if (buildResult.terraformFiles && Object.keys(buildResult.terraformFiles).length > 0) {
    const tfDir = join(infraDir, 'terraform');
    ensureDir(tfDir);
    for (const [fileName, content] of Object.entries(buildResult.terraformFiles)) {
      writeFileSync(join(tfDir, fileName), content, 'utf-8');
    }
  }

  writeFileSync(
    join(infraDir, 'README.md'),
    `# ${appName} — Infrastructure\n\n` +
    `This folder contains infrastructure-as-code templates for provisioning the Azure resources\n` +
    `required to host the \`${appName}\` Logic Apps Standard application.\n\n` +
    `> **This folder is intentionally separate from the Logic Apps project.**\n` +
    `> Infrastructure provisioning is independent of workflow code deployment.\n\n` +
    `## Terraform (recommended)\n\n` +
    `\`\`\`bash\n` +
    `cd terraform/\n` +
    `terraform init\n` +
    `terraform plan -var="app_name=${appName}" -var="resource_group_name=<rg-name>"\n` +
    `terraform apply\n` +
    `\`\`\`\n\n` +
    `## Bicep\n\n` +
    `\`\`\`bash\n` +
    `cd bicep/\n` +
    `az deployment group create \\\n` +
    `  --resource-group <resource-group> \\\n` +
    `  --template-file main.bicep \\\n` +
    `  --parameters appName=${appName}\n` +
    `\`\`\`\n\n` +
    `## ARM (legacy)\n\n` +
    `\`\`\`bash\n` +
    `cd arm/\n` +
    `az deployment group create \\\n` +
    `  --resource-group <resource-group> \\\n` +
    `  --template-file arm-template.json \\\n` +
    `  --parameters arm-parameters.json\n` +
    `\`\`\`\n`,
    'utf-8',
  );

  // ── Test specs (inside Logic Apps project) ─────────────────────────────────
  if (buildResult.testSpecs && Object.keys(buildResult.testSpecs).length > 0) {
    const testsDir = join(logicAppDir, 'tests');
    ensureDir(testsDir);
    for (const [name, content] of Object.entries(buildResult.testSpecs)) {
      writeFileSync(join(testsDir, name), String(content), 'utf-8');
    }
  }

  // ── C# Functions project — sibling to Logic Apps project ───────────────────
  const localFunctions = buildResult.localCodeFunctions ?? {};
  const functionFileNames = Object.keys(localFunctions).filter(k => k.endsWith('.cs'));
  const functionNames = functionFileNames.map(k => k.replace(/\.cs$/, ''));

  if (functionNames.length > 0) {
    const functionsProjectName = `${appName}_Functions`;
    // Namespace must match the C# stubs (package-builder uses appName + 'Functions')
    const functionsNamespace = appName.replace(/[^A-Za-z0-9]/g, '') + 'Functions';
    // Functions project is a sibling to the Logic Apps project — both under outputDir
    const functionsDir = join(outputDir, functionsProjectName);
    ensureDir(functionsDir);

    // .cs stubs
    for (const [fileName, content] of Object.entries(localFunctions)) {
      if (fileName.endsWith('.cs')) {
        writeFileSync(join(functionsDir, fileName), content, 'utf-8');
      }
    }

    // .csproj — matches SampleLogicApps/Empty exactly; LogicAppFolder = sibling folder name
    writeFileSync(
      join(functionsDir, `${functionsProjectName}.csproj`),
      generateCsproj(appName),
      'utf-8',
    );

    // .sln — needed for Visual Studio to open the project correctly
    writeFileSync(
      join(functionsDir, `${functionsProjectName}.sln`),
      generateSolutionFile(functionsProjectName),
      'utf-8',
    );

    // .vscode for the C# project
    const fvsDir = join(functionsDir, '.vscode');
    ensureDir(fvsDir);
    writeJson(join(fvsDir, 'extensions.json'), FUNCTIONS_VSCODE_EXTENSIONS);
    writeJson(join(fvsDir, 'settings.json'), FUNCTIONS_VSCODE_SETTINGS);
    writeJson(join(fvsDir, 'tasks.json'), FUNCTIONS_VSCODE_TASKS);

    // lib/custom/{functionName}/function.json — inside Logic Apps project
    for (const functionName of functionNames) {
      const fnDescDir = join(logicAppDir, 'lib', 'custom', functionName);
      ensureDir(fnDescDir);
      writeJson(
        join(fnDescDir, 'function.json'),
        generateFunctionJson(functionsNamespace, functionName, functionsProjectName),
      );
    }

    // launch.json goes in Logic Apps project .vscode (references Functions debug)
    writeJson(join(vscodeDir, 'launch.json'), generateLaunchJson(appName, true));
  } else {
    writeJson(join(vscodeDir, 'launch.json'), generateLaunchJson(appName, false));
  }

  // ── code-workspace — at workspace root ─────────────────────────────────────
  const workspaceFolders: Array<{ name: string; path: string }> = [
    { name: appName, path: `./${appName}` },
  ];
  if (functionNames.length > 0) {
    workspaceFolders.push({
      name: `${appName}_Functions`,
      path: `./${appName}_Functions`,
    });
  }
  writeJson(join(outputDir, `${appName}.code-workspace`), {
    folders: workspaceFolders,
    settings: {
      'terminal.integrated.env.windows': {
        PATH: '${env:USERPROFILE}\\.azurelogicapps\\dependencies\\DotNetSDK;${env:PATH}',
      },
      'omnisharp.dotNetCliPaths': [
        '${env:USERPROFILE}\\.azurelogicapps\\dependencies\\DotNetSDK',
      ],
    },
  });

  // ── Migration reports — at workspace root alongside .code-workspace ─────────
  writeFileSync(join(outputDir, 'migration-report.md'), migrationReport, 'utf-8');
  writeFileSync(
    join(outputDir, 'migration-report.html'),
    migrationReportToHtml(migrationReport, appName),
    'utf-8',
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── workflow-designtime ───────────────────────────────────────────────────────

const WORKFLOW_DESIGNTIME_HOST = {
  version: '2.0',
  extensionBundle: {
    id: 'Microsoft.Azure.Functions.ExtensionBundle.Workflows',
    version: '[1.*, 2.0.0)',
  },
  extensions: {
    workflow: {
      settings: {
        'Runtime.WorkflowOperationDiscoveryHostMode': 'true',
      },
    },
  },
};

const WORKFLOW_DESIGNTIME_LOCAL_SETTINGS = {
  IsEncrypted: false,
  Values: {
    APP_KIND: 'workflowapp',
    FUNCTIONS_WORKER_RUNTIME: 'node',
    AzureWebJobsSecretStorageType: 'Files',
    ProjectDirectoryPath: '',
  },
};

// ─── .vscode generators ────────────────────────────────────────────────────────

function generateVscodeSettings(): Record<string, unknown> {
  return {
    'azureLogicAppsStandard.projectLanguage': 'JavaScript',
    'azureLogicAppsStandard.projectRuntime':  '~4',
    'debug.internalConsoleOptions':           'neverOpen',
    'azureFunctions.suppressProject':          true,
  };
}

function generateLaunchJson(appName: string, hasCustomCode: boolean): Record<string, unknown> {
  return {
    version: '0.2.0',
    configurations: [
      {
        name: hasCustomCode
          ? `Run/Debug logic app with local function ${appName}`
          : `Run/Debug ${appName}`,
        type: 'logicapp',
        request: 'launch',
        isCodeless: true,
        ...(hasCustomCode ? { funcRuntime: 'coreclr', customCodeRuntime: 'clr' } : {}),
      },
    ],
  };
}

const VSCODE_TASKS = {
  version: '2.0.0',
  tasks: [
    {
      label: 'generateDebugSymbols',
      command: '${config:azureLogicAppsStandard.dotnetBinaryPath}',
      args: ['${input:getDebugSymbolDll}'],
      type: 'process',
      problemMatcher: '$msCompile',
    },
    {
      type: 'shell',
      command: '${config:azureLogicAppsStandard.funcCoreToolsBinaryPath}',
      args: ['host', 'start'],
      options: {
        env: {
          PATH: '${config:azureLogicAppsStandard.autoRuntimeDependenciesPath}\\NodeJs;${config:azureLogicAppsStandard.autoRuntimeDependenciesPath}\\DotNetSDK;$env:PATH',
        },
      },
      problemMatcher: '$func-watch',
      isBackground: true,
      label: 'func: host start',
      group: { kind: 'build', isDefault: true },
    },
  ],
  inputs: [
    {
      id: 'getDebugSymbolDll',
      type: 'command',
      command: 'azureLogicAppsStandard.getDebugSymbolDll',
    },
  ],
};

const FUNCTIONS_VSCODE_EXTENSIONS = {
  recommendations: [
    'ms-azuretools.vscode-azurefunctions',
    'ms-dotnettools.csharp',
  ],
};

const FUNCTIONS_VSCODE_SETTINGS: Record<string, unknown> = {
  'azureFunctions.deploySubpath':              'bin/Release/net472/publish',
  'azureFunctions.projectLanguage':            'C#',
  'azureFunctions.projectRuntime':             '~4',
  'debug.internalConsoleOptions':              'neverOpen',
  'azureFunctions.preDeployTask':              'publish (functions)',
  'azureFunctions.templateFilter':             'Core',
  'azureFunctions.showTargetFrameworkWarning': false,
  'azureFunctions.projectSubpath':             'bin\\Release\\net472\\publish',
};

const FUNCTIONS_VSCODE_TASKS = {
  version: '2.0.0',
  tasks: [
    {
      label: 'build',
      command: '${config:azureLogicAppsStandard.dotnetBinaryPath}',
      type: 'process',
      args: ['build', '${workspaceFolder}'],
      group: { kind: 'build', isDefault: true },
    },
  ],
};

// ─── C# project generators ────────────────────────────────────────────────────

function generateCsproj(appName: string): string {
  // Match SampleLogicApps/Empty/empty-workspace/Empty_Function/Empty_Function.csproj exactly.
  // LogicAppFolder is just the sibling folder name; all target paths use ..\$(LogicAppFolder).
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <IsPackable>false</IsPackable>
    <TargetFramework>net472</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
    <OutputType>Library</OutputType>
    <PlatformTarget>x64</PlatformTarget>
    <LogicAppFolder>${appName}</LogicAppFolder>
    <CopyToOutputDirectory>Always</CopyToOutputDirectory>
 </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.WebJobs.Core" Version="3.0.39" />
    <PackageReference Include="Microsoft.Azure.Workflows.WebJobs.Sdk" Version="1.1.0" />
    <PackageReference Include="Microsoft.NET.Sdk.Functions" Version="4.2.0" />
    <PackageReference Include="Microsoft.Extensions.Logging.Abstractions" Version="2.1.1" />
    <PackageReference Include="Microsoft.Extensions.Logging" Version="2.1.1" />
  </ItemGroup>

<Target Name="Task" AfterTargets="Compile">
    <ItemGroup>
        <DirsToClean2 Include="..\\$(LogicAppFolder)\\lib\\custom" />
      </ItemGroup>
      <RemoveDir Directories="@(DirsToClean2)" />
 </Target>

  <Target Name="CopyExtensionFiles" AfterTargets="ParameterizedFunctionJsonGenerator">
    <ItemGroup>
        <CopyFiles Include="$(MSBuildProjectDirectory)\\bin\\$(Configuration)\\net472\\**\\*.*" CopyToOutputDirectory="PreserveNewest" Exclude="$(MSBuildProjectDirectory)\\bin\\$(Configuration)\\net472\\*.*" />
      <CopyFiles2 Include="$(MSBuildProjectDirectory)\\bin\\$(Configuration)\\net472\\*.*" />
    </ItemGroup>
    <Copy SourceFiles="@(CopyFiles)" DestinationFolder="..\\$(LogicAppFolder)\\lib\\custom\\%(RecursiveDir)" SkipUnchangedFiles="true" />
    <Copy SourceFiles="@(CopyFiles2)" DestinationFolder="..\\$(LogicAppFolder)\\lib\\custom\\net472\\" SkipUnchangedFiles="true" />
    <ItemGroup>
        <MoveFiles Include="..\\$(LogicAppFolder)\\lib\\custom\\bin\\*.*" />
    </ItemGroup>

   <Move SourceFiles="@(MoveFiles)" DestinationFolder="..\\$(LogicAppFolder)\\lib\\custom\\net472" />
    <ItemGroup>
       <DirsToClean Include="..\\$(LogicAppFolder)\\lib\\custom\\bin" />
     </ItemGroup>
       <RemoveDir Directories="@(DirsToClean)" />
  </Target>

  <ItemGroup>
      <Reference Include="Microsoft.CSharp" />
  </ItemGroup>
  <ItemGroup>
    <Folder Include="bin\\$(Configuration)\\net472\\" />
  </ItemGroup>
</Project>
`;
}

function generateFunctionJson(namespace: string, functionName: string, assemblyName: string): Record<string, unknown> {
  // FIX-2: Add InputSchema, Trigger, Cardinality, Raw fields — matches canonical function.json
  // from Sample LogicApps/las-training 2/LAS-Training/lib/custom/test/function.json
  const binding = {
    Name: 'requestBody',
    Connection: null,
    Type: 'workflowActionTrigger',
    Properties: {},
    Direction: 'In',
    DataType: null,
    Cardinality: null,
    IsTrigger: true,
    IsReturn: false,
    Raw: null,
  };
  return {
    Name: null,
    ScriptFile: `../net472/${assemblyName}.dll`,
    FunctionDirectory: null,
    EntryPoint: `${namespace}.${functionName}.${functionName}Run`,
    Language: 'net472',
    Properties: {},
    Bindings: [binding],
    InputBindings: [binding],
    OutputBindings: [],
    Trigger: binding,
    InputSchema: {
      type: 'object',
      properties: {
        requestBody: { type: 'string' },
      },
      required: ['requestBody'],
    },
  };
}

function generateSolutionFile(projectName: string): string {
  // FIX-13: Minimal .sln for Visual Studio to open the Functions project
  const projectGuid = randomGuid();
  const solutionGuid = randomGuid();
  return `
Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.0.31903.59
MinimumVisualStudioVersion = 10.0.40219.1
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${projectName}", "${projectName}.csproj", "{${projectGuid}}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
		Debug|Any CPU = Debug|Any CPU
		Release|Any CPU = Release|Any CPU
	EndGlobalSection
	GlobalSection(ProjectConfigurationPlatforms) = postSolution
		{${projectGuid}}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{${projectGuid}}.Debug|Any CPU.Build.0 = Debug|Any CPU
		{${projectGuid}}.Release|Any CPU.ActiveCfg = Release|Any CPU
		{${projectGuid}}.Release|Any CPU.Build.0 = Release|Any CPU
	EndGlobalSection
	GlobalSection(SolutionProperties) = preSolution
		HideSolutionNode = FALSE
	EndGlobalSection
	GlobalSection(ExtensibilityGlobals) = postSolution
		SolutionGuid = {${solutionGuid}}
	EndGlobalSection
EndGlobal
`.trimStart();
}

function randomGuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16).toUpperCase();
  });
}

// ─── Static templates ─────────────────────────────────────────────────────────

const FUNCIGNORE_CONTENT = `\
.debug
.git*
.vscode
__azurite_db*__.json
__blobstorage__
__queuestorage__
global.json
local.settings.json
*_Functions
test
workflow-designtime/
`;

const GITIGNORE_CONTENT = `\
# Azure logic apps artifacts
bin
obj
appsettings.json
local.settings.json
__blobstorage__
.debug
__queuestorage__
__azurite_db*__.json

# Added folders and file patterns
workflow-designtime/
*.code-workspace
`;
