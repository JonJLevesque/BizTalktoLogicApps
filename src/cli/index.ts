#!/usr/bin/env node
/**
 * BizTalk to Logic Apps — CLI Entry Point
 *
 * Provides command-line access to the three-stage migration pipeline.
 * All processing is local — no customer artifacts leave the machine.
 *
 * Commands:
 *   analyze    Analyze BizTalk artifacts and produce a migration spec
 *   build      Build a Logic Apps Standard deployment package
 *   convert    Convert a single BizTalk map to LML/XSLT
 *   validate   Validate generated Logic Apps artifacts
 *   templates  List available workflow templates (Premium)
 *
 * Examples:
 *   biztalk-migrate analyze --app MyBizTalkApp --dir ./artifacts --out ./spec.json
 *   biztalk-migrate build --spec ./spec.json --out ./output
 *   biztalk-migrate convert --map ./OrderMap.btm --out ./Maps
 *   biztalk-migrate templates --search "sftp"
 *
 * License:
 *   Set BTLA_LICENSE_KEY env var or pass --license <key>
 */

import { Command }        from 'commander';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PKG_VERSION = (JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as { version: string }).version;
import chalk              from 'chalk';
import ora                from 'ora';
import { analyzeOrchestration, analyzeOrchestrationXml } from '../stage1-understand/orchestration-analyzer.js';
import { analyzeMap, analyzeMapXml }           from '../stage1-understand/map-analyzer.js';
import { analyzePipeline, analyzePipelineXml } from '../stage1-understand/pipeline-analyzer.js';
import { analyzeBindings, analyzeBindingsXml } from '../stage1-understand/binding-analyzer.js';
import { scoreApplication }        from '../stage1-understand/complexity-scorer.js';
import { detectPatterns }          from '../stage1-understand/pattern-detector.js';
import { analyzeGaps }         from '../stage2-document/gap-analyzer.js';
import { recommendArchitecture } from '../stage2-document/architecture-recommender.js';
import { generateMigrationSpec } from '../stage2-document/migration-spec-generator.js';
import { convertMap }          from '../stage3-build/map-converter.js';
import { buildPackage }        from '../stage3-build/package-builder.js';
import { listTemplates }       from '../greenfield/template-library.js';
import { validateLicense }     from '../licensing/index.js';
import { runMigration }        from '../runner/index.js';
import { writeOutput }         from '../runner/index.js';
import type { BizTalkApplication } from '../types/biztalk.js';
import type { MigrationResult }    from '../types/migration.js';

// ─── Program ──────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('biztalk-migrate')
  .description('BizTalk Server → Azure Logic Apps Standard migration tool')
  .version(PKG_VERSION)
  .option('--license <key>', 'License key (overrides BTLA_LICENSE_KEY env var)')
  .hook('preAction', async (cmd) => {
    if (process.env['BTLA_DEV_MODE'] === 'true') {
      console.log(chalk.magenta('⚡ Dev mode active — all features unlocked'));
    }
    const key = cmd.opts()['license'] ?? process.env['BTLA_LICENSE_KEY'];
    if (key) {
      try {
        const v = await validateLicense(String(key));
        if (!v.valid) {
          console.warn(chalk.yellow(`⚠ License: ${v.error ?? 'validation failed'}. Running in free tier.`));
        }
      } catch {
        // offline — continue
      }
    }
  });

// ─── run command (one-command pipeline) ──────────────────────────────────────

program
  .command('run')
  .description('Run the full BizTalk → Logic Apps migration pipeline in one command')
  .requiredOption('--dir <path>', 'Directory containing BizTalk artifacts (.odx, .btm, .btp, BindingInfo.xml)')
  .requiredOption('--app <name>', 'BizTalk application name')
  .option('--output <dir>', 'Output directory for generated Logic Apps project', './logic-apps-output')
  .option('--skip-enrichment', 'Skip Claude AI enrichment (offline/dev mode)')
  .action(async (opts) => {
    // Fail fast if no credentials are configured (avoids silent TODO_CLAUDE-filled output)
    const hasDevMode   = process.env['BTLA_DEV_MODE'] === 'true';
    const hasApiKey    = !!process.env['ANTHROPIC_API_KEY'];
    const hasLicenseKey = !!(process.env['BTLA_LICENSE_KEY'] ?? (opts as { license?: string }).license);
    if (!hasDevMode && !hasApiKey && !hasLicenseKey) {
      console.error(chalk.red('✗ No credentials configured.'));
      console.error(chalk.yellow('  Set one of:'));
      console.error(chalk.yellow('    BTLA_LICENSE_KEY=<key>       (production — proxy mode)'));
      console.error(chalk.yellow('    ANTHROPIC_API_KEY=sk-...     (direct Anthropic API, dev use)'));
      console.error(chalk.yellow('    BTLA_DEV_MODE=true           (offline, no AI enrichment)'));
      process.exit(1);
    }

    const spinner = ora().start();

    const steps: string[] = [];
    const startTime = Date.now();

    try {
      const result = await runMigration({
        artifactDir:     opts.dir as string,
        appName:         opts.app as string,
        outputDir:       opts.output as string,
        skipEnrichment:  !!(opts.skipEnrichment as boolean | undefined),
        onProgress: ({ step, message, detail }) => {
          const label = `[${step.toUpperCase().padEnd(8)}]`;
          spinner.text = `${chalk.cyan(label)} ${message}${detail ? chalk.gray(' — ' + detail) : ''}`;
          steps.push(`${label} ${message}`);
        },
      });

      if (!result.success) {
        spinner.fail(chalk.red('Migration failed'));
        for (const e of result.errors) {
          console.error(chalk.red(`  ✗ ${e}`));
        }
        process.exit(1);
      }

      // Write output to disk
      spinner.text = '[WRITE   ] Writing output files...';
      writeOutput({
        outputDir:      opts.output as string,
        buildResult:    result.buildResult!,
        migrationReport: result.migrationReport,
      });

      spinner.succeed(chalk.green('Migration complete'));

      // Print summary
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('');
      console.log(chalk.bold('── Migration Summary ────────────────────────────────'));
      console.log(`  Application:  ${chalk.cyan(opts.app as string)}`);
      console.log(`  Output:       ${chalk.cyan(opts.output as string)}`);
      console.log(`  Workflows:    ${chalk.cyan(result.buildResult?.project.workflows.length ?? 0)}`);
      if (result.qualityReport) {
        const gradeColor = result.qualityReport.grade <= 'B' ? chalk.green : chalk.yellow;
        console.log(`  Quality:      ${gradeColor(`${result.qualityReport.totalScore}/100 Grade ${result.qualityReport.grade}`)}`);
      }
      console.log(`  Time:         ${elapsed}s`);

      if (result.warnings.length > 0) {
        const unique = [...new Set(result.warnings)];
        console.log(`  Warnings:     ${chalk.yellow(unique.length)}`);
        for (const w of unique.slice(0, 5)) {
          console.log(chalk.yellow(`    ⚠ ${w}`));
        }
      }

      console.log('');
      console.log(`  ${chalk.bold('migration-report.md')} written to ${chalk.cyan(opts.output as string)}`);
      console.log(chalk.bold('────────────────────────────────────────────────────\n'));

    } catch (error) {
      spinner.fail('Migration pipeline failed');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// ─── analyze command ──────────────────────────────────────────────────────────

program
  .command('analyze')
  .description('Analyze BizTalk artifacts and generate a migration specification')
  .requiredOption('--app <name>', 'BizTalk application name')
  .option('--dir <path>', 'Directory containing .odx/.btm/.btp files', '.')
  .option('--bindings <file>', 'Path to binding XML export file')
  .option('--out <file>', 'Output file for migration spec JSON', 'migration-spec.json')
  .option('--verbose', 'Show detailed output')
  .action(async (opts) => {
    const spinner = ora('Analyzing BizTalk application...').start();

    try {
      const dir  = opts.dir as string;
      const appName = opts.app as string;

      // Collect artifact files — use file-path analyzers for UTF-16 LE support
      const orchestrations = [];
      for (const f of collectFiles(dir, '.odx')) {
        spinner.text = `Parsing orchestration: ${basename(f)}`;
        orchestrations.push(await analyzeOrchestration(f));
      }

      const maps = [];
      for (const f of collectFiles(dir, '.btm')) {
        spinner.text = `Parsing map: ${basename(f)}`;
        maps.push(await analyzeMap(f));
      }

      const pipelines = [];
      for (const f of collectFiles(dir, '.btp')) {
        spinner.text = `Parsing pipeline: ${basename(f)}`;
        pipelines.push(await analyzePipeline(f));
      }

      // Auto-discover BindingInfo.xml from --dir if --bindings not specified
      const bindingPaths: string[] = opts.bindings
        ? [opts.bindings as string]
        : collectFiles(dir, '.xml').filter(f => basename(f).toLowerCase() === 'bindinginfo.xml');
      const bindingFiles = [];
      for (const bp of bindingPaths) {
        spinner.text = `Parsing bindings: ${basename(bp)}`;
        bindingFiles.push(await analyzeBindings(bp));
      }

      spinner.text = 'Scoring complexity...';
      const app: BizTalkApplication = {
        name:                    appName,
        biztalkVersion:          'unknown',
        orchestrations,
        maps,
        pipelines,
        schemas:                 [],
        bindingFiles,
        complexityScore:         0,
        complexityClassification: 'moderate',
      };
      const complexity = scoreApplication(app);
      app.complexityScore          = complexity.totalScore;
      app.complexityClassification = complexity.classification;

      spinner.text = 'Detecting patterns...';
      const patterns = detectPatterns(app);

      spinner.text = 'Analyzing gaps...';
      const gaps = analyzeGaps(app);

      spinner.text = 'Generating architecture recommendation...';
      const arch = recommendArchitecture(app, gaps, patterns);

      // Build a synthetic intent for the spec generator
      const intent = buildSyntheticIntent(app);

      spinner.text = 'Generating migration specification...';
      const plan = generateMigrationSpec(app, intent);

      const migrationResult: MigrationResult = {
        schemaVersion:      '1.0.0',
        analysisDate:       new Date().toISOString(),
        biztalkApplication: app,
        integrationIntent:  intent,
        migrationPlan:      plan,
      };

      const outPath = opts.out as string;
      writeFileSync(outPath, JSON.stringify(migrationResult, null, 2));
      spinner.succeed(`Migration spec written to ${chalk.green(outPath)}`);

      // Print summary
      printAnalysisSummary(app, gaps, arch, complexity);

    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// ─── build command ────────────────────────────────────────────────────────────

program
  .command('build')
  .description('Build a Logic Apps Standard deployment package from a migration spec')
  .requiredOption('--spec <file>', 'Migration spec JSON file (output of analyze command)')
  .option('--out <dir>', 'Output directory for generated artifacts', './logic-apps-output')
  .option('--no-tests', 'Skip unit test generation')
  .option('--no-infrastructure', 'Skip ARM template generation')
  .option('--app-name <name>', 'Override Logic App name')
  .action(async (opts) => {
    const spinner = ora('Building Logic Apps package...').start();

    try {
      const spec = JSON.parse(readFileSync(opts.spec as string, 'utf8')) as MigrationResult;
      const outDir = opts.out as string;

      spinner.text = 'Generating workflows and maps...';
      const buildOpts: import('../stage3-build/package-builder.js').BuildOptions = {
        includeTests:          opts.tests as boolean,
        includeInfrastructure: opts.infrastructure as boolean,
        wrapInScope:           true,
      };
      if (opts.appName) buildOpts.appName = opts.appName as string;
      const result = buildPackage(spec, buildOpts);

      spinner.text = 'Writing artifacts to disk...';
      ensureDir(outDir);

      // Write workflow files
      for (const wf of result.project.workflows) {
        const wfDir = join(outDir, wf.name);
        ensureDir(wfDir);
        writeFileSync(join(wfDir, 'workflow.json'), JSON.stringify(wf.workflow, null, 2));
      }

      // Write root files
      writeFileSync(join(outDir, 'connections.json'), JSON.stringify(result.project.connections, null, 2));
      writeFileSync(join(outDir, 'host.json'), JSON.stringify(result.project.host, null, 2));

      // Write maps
      if (Object.keys(result.project.xsltMaps).length > 0) {
        const mapsDir = join(outDir, 'Maps');
        ensureDir(mapsDir);
        for (const [name, content] of Object.entries(result.project.xsltMaps)) {
          writeFileSync(join(mapsDir, name), content);
        }
      }
      if (Object.keys(result.project.lmlMaps).length > 0) {
        const mapsDir = join(outDir, 'Maps');
        ensureDir(mapsDir);
        for (const [name, content] of Object.entries(result.project.lmlMaps)) {
          writeFileSync(join(mapsDir, name), content);
        }
      }

      // Write infrastructure
      if (Object.keys(result.armTemplate).length > 0) {
        writeFileSync(join(outDir, 'arm-template.json'),   JSON.stringify(result.armTemplate, null, 2));
        writeFileSync(join(outDir, 'arm-parameters.json'), JSON.stringify(result.armParameters, null, 2));
      }
      writeFileSync(join(outDir, 'local.settings.json'), JSON.stringify(result.localSettings, null, 2));

      // Write tests
      if (Object.keys(result.testSpecs).length > 0) {
        const testsDir = join(outDir, 'tests');
        ensureDir(testsDir);
        for (const [name, content] of Object.entries(result.testSpecs)) {
          writeFileSync(join(testsDir, name), content);
        }
      }

      spinner.succeed(`Logic Apps package written to ${chalk.green(outDir)}`);
      printBuildSummary(result.summary, result.warnings);

    } catch (error) {
      spinner.fail('Build failed');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// ─── convert command ──────────────────────────────────────────────────────────

program
  .command('convert')
  .description('Convert a single BizTalk .btm map to Logic Apps format (LML/XSLT/Function stub)')
  .requiredOption('--map <file>', 'Path to .btm map XML file')
  .option('--out <dir>', 'Output directory for converted map', '.')
  .action(async (opts) => {
    const spinner = ora('Converting map...').start();

    try {
      const mapXml = readFileSync(opts.map as string, 'utf8');
      const parsed = analyzeMapXml(mapXml);
      const converted = convertMap(parsed);
      const outDir = opts.out as string;
      ensureDir(outDir);

      const ext = converted.format === 'lml' ? '.lml' : converted.format === 'function-stub' ? '.csx' : '.xslt';
      const outFile = join(outDir, `${converted.name}${ext}`);
      writeFileSync(outFile, converted.content);

      spinner.succeed(`Converted: ${chalk.green(outFile)} (format: ${converted.format})`);

      if (converted.warnings.length > 0) {
        console.log(chalk.yellow('\nWarnings:'));
        for (const w of converted.warnings) {
          console.log(chalk.yellow(`  ⚠ ${w}`));
        }
      }

    } catch (error) {
      spinner.fail('Conversion failed');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// ─── templates command ────────────────────────────────────────────────────────

program
  .command('templates')
  .description('[Premium] List available Logic Apps workflow templates')
  .option('--search <term>', 'Search templates by name or description')
  .option('--category <cat>', 'Filter by category')
  .action((opts) => {
    const templates = listTemplates({
      ...(opts.search   ? { search:   opts.search   as string } : {}),
      ...(opts.category ? { category: opts.category as 'file-processing' | 'messaging' | 'api-integration' | 'scheduled-batch' | 'b2b-edi' | 'database-sync' | 'notification' } : {}),
    });

    if (templates.length === 0) {
      console.log(chalk.yellow('No templates found matching your criteria.'));
      return;
    }

    console.log(chalk.bold(`\nAvailable Templates (${templates.length}):\n`));
    for (const t of templates) {
      console.log(chalk.cyan(`  ${t.id.padEnd(30)}`), chalk.bold(t.name));
      console.log(`  ${chalk.gray(t.description)}`);
      console.log(`  ${chalk.gray('Category: ' + t.category + ' · Tags: ' + (t.tags ?? []).join(', '))}\n`);
    }
  });

// ─── Utilities ────────────────────────────────────────────────────────────────

function collectFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFiles(fullPath, ext));
      } else if (extname(entry.name).toLowerCase() === ext) {
        results.push(fullPath);
      }
    }
  } catch {
    // ignore permission errors
  }
  return results;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function adapterToConnector(adapterType: string | undefined): string {
  switch ((adapterType ?? '').toUpperCase()) {
    case 'FILE':            return 'azureblob';
    case 'HTTP':
    case 'WCF-BASICHTTP':
    case 'WCF-WSHTTP':      return 'request';
    case 'SB-MESSAGING':
    case 'WCF-NETMSMQ':
    case 'MSMQ':            return 'serviceBus';
    case 'SFTP':            return 'sftp';
    case 'FTP':             return 'ftp';
    case 'SQL':             return 'sql';
    case 'EVENT HUBS':
    case 'EVENTHUBS':       return 'eventhub';
    case 'SCHEDULE':        return 'recurrence';
    default:                return 'serviceBus';
  }
}

function buildSyntheticIntent(app: BizTalkApplication): import('../shared/integration-intent.js').IntegrationIntent {
  // Build a minimal intent from the application for the migration spec
  const firstBinding = app.bindingFiles[0];
  const firstReceive = firstBinding?.receiveLocations[0];
  const connector = adapterToConnector(firstReceive?.adapterType);
  const triggerType = (connector === 'request' || connector === 'recurrence')
    ? (connector === 'recurrence' ? 'schedule' : 'webhook')
    : 'polling';

  return {
    trigger: {
      type:      triggerType,
      source:    firstReceive?.adapterType ?? 'BizTalk receive location',
      connector,
      config:    {},
    },
    steps: [],
    errorHandling: { strategy: 'terminate' },
    systems: [],
    dataFormats: { input: 'xml', output: 'xml' },
    patterns: [],
    metadata: {
      source:                    'biztalk-migration',
      complexity:                (app.complexityClassification === 'highly-complex' ? 'complex' : app.complexityClassification) as 'simple' | 'moderate' | 'complex',
      estimatedActions:          app.orchestrations.reduce((n, o) => n + (o.shapes?.length ?? 0), 0),
      requiresIntegrationAccount: false,
      requiresOnPremGateway:     false,
    },
  };
}

function printAnalysisSummary(
  app: BizTalkApplication,
  gaps: ReturnType<typeof analyzeGaps>,
  arch: ReturnType<typeof recommendArchitecture>,
  complexity: ReturnType<typeof scoreApplication>
): void {
  console.log('\n' + chalk.bold('── Migration Analysis Summary ───────────────────────'));
  console.log(`  Application:     ${chalk.cyan(app.name)}`);
  console.log(`  Orchestrations:  ${app.orchestrations.length}`);
  console.log(`  Maps:            ${app.maps.length}`);
  console.log(`  Pipelines:       ${app.pipelines.length}`);
  console.log(`  Complexity:      ${complexityColor(complexity.classification)}`);
  console.log(`  Target SKU:      ${chalk.cyan(arch.targetSku)}`);
  console.log(`  Workflows:       ~${arch.workflowCount}`);

  if (gaps.length > 0) {
    const critical = gaps.filter(g => g.severity === 'critical').length;
    const high     = gaps.filter(g => g.severity === 'high').length;
    const medium   = gaps.filter(g => g.severity === 'medium').length;

    console.log(`\n  Gaps Found:`);
    if (critical > 0) console.log(`    ${chalk.red(`${critical} critical`)}`);
    if (high > 0)     console.log(`    ${chalk.yellow(`${high} high`)}`);
    if (medium > 0)   console.log(`    ${chalk.blue(`${medium} medium`)}`);
  } else {
    console.log(`  Gaps:            ${chalk.green('None — clean migration')}`);
  }
  console.log(chalk.bold('────────────────────────────────────────────────────\n'));
}

function printBuildSummary(
  summary: { workflowCount: number; mapCount: number; connectionCount: number; testCaseCount: number; warnings: number },
  warnings: string[]
): void {
  console.log('\n' + chalk.bold('── Build Summary ────────────────────────────────────'));
  console.log(`  Workflows:   ${chalk.cyan(summary.workflowCount)}`);
  console.log(`  Maps:        ${chalk.cyan(summary.mapCount)}`);
  console.log(`  Connections: ${chalk.cyan(summary.connectionCount)}`);
  console.log(`  Test cases:  ${chalk.cyan(summary.testCaseCount)}`);
  if (summary.warnings > 0) {
    console.log(`  Warnings:    ${chalk.yellow(summary.warnings)}`);
    for (const w of warnings) {
      console.log(`    ${chalk.yellow('⚠')} ${w}`);
    }
  }
  console.log(chalk.bold('────────────────────────────────────────────────────\n'));
}

function complexityColor(complexity: string): string {
  switch (complexity) {
    case 'simple':        return chalk.green(complexity);
    case 'moderate':      return chalk.yellow(complexity);
    case 'complex':       return chalk.red(complexity);
    case 'highly-complex': return chalk.red(chalk.bold(complexity));
    default:              return complexity;
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

program.parse(process.argv);

if (process.argv.length < 3) {
  program.help();
}
