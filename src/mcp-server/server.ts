#!/usr/bin/env node
/**
 * BizTalk to Logic Apps MCP Server
 *
 * Runs as a local stdio MCP server, exposing all migration and greenfield
 * tools to Claude (via Claude Desktop, VS Code, or other MCP clients).
 *
 * Transport: stdio (never opens a network listener — satisfies data privacy requirement)
 * Protocol:  Model Context Protocol (MCP) v1.0
 *
 * Usage:
 *   node dist/mcp-server/server.js
 *   npm run mcp:start
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "biztalk-migrate": {
 *         "command": "node",
 *         "args": ["/path/to/dist/mcp-server/server.js"],
 *         "env": {
 *           "BTLA_LICENSE_KEY": "your-license-key"
 *         }
 *       }
 *     }
 *   }
 *
 * VS Code config (.vscode/mcp.json in workspace):
 *   { "servers": { "biztalk-migrate": { "type": "stdio", "command": "node", "args": [...] } } }
 */

import { Server }              from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
}                              from '@modelcontextprotocol/sdk/types.js';
import { readFileSync }        from 'fs';
import { join, dirname }       from 'path';
import { fileURLToPath }       from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PKG_VERSION = (JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as { version: string }).version;

import { ALL_TOOLS, getToolsForTier }    from './tools/definitions.js';
import { dispatchTool }                  from './tools/handler.js';
import { PROMPT_DEFINITIONS, buildPromptMessages } from './prompts/migration-guide.js';
import { BUNDLED_REFERENCE }             from './resources/bundled-reference.js';
import { validateLicense, getLicenseTier }         from '../licensing/index.js';

// ─── Server Info ──────────────────────────────────────────────────────────────

const SERVER_INFO = {
  name:    'biztalk-to-logicapps',
  version: PKG_VERSION,
};

const SERVER_CAPABILITIES = {
  tools:     { listChanged: false },
  prompts:   { listChanged: false },
  resources: { listChanged: false },
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  // Validate license on startup (non-fatal — server runs in limited mode if invalid)
  let licenseTier: 'free' | 'standard' | 'premium' = 'free';
  const licenseKey = process.env['BTLA_LICENSE_KEY'];

  if (licenseKey) {
    try {
      const validation = await validateLicense(licenseKey);
      if (validation.valid) {
        const tier = validation.tier ?? 'standard';
        licenseTier = (tier === 'none' ? 'free' : tier) as 'free' | 'standard' | 'premium';
      } else {
        console.error(`[biztalk-migrate] License validation failed: ${validation.error ?? 'unknown error'}. Running in free tier.`);
      }
    } catch {
      console.error('[biztalk-migrate] License check skipped (offline mode). Running in free tier.');
    }
  } else {
    console.error('[biztalk-migrate] No BTLA_LICENSE_KEY set. Running in free tier (understand + document only).');
  }

  // Create MCP server
  const server = new Server(SERVER_INFO, { capabilities: SERVER_CAPABILITIES });

  // ── List Tools ──────────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const rawTier = getLicenseTier();
    const tier    = (rawTier === 'none' ? 'free' : rawTier) as 'free' | 'standard' | 'premium';
    const tools   = getToolsForTier(tier);

    return {
      tools: tools.map(t => ({
        name:        t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  // ── Call Tool ───────────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    // Verify the tool exists in the full catalog (even if gated)
    const toolDef = ALL_TOOLS.find(t => t.name === name);
    if (!toolDef) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    // Dispatch — handler performs its own tier check via isFeatureAvailable()
    const result = await dispatchTool(name, args as Record<string, unknown>);
    return result;
  });

  // ── List Prompts ────────────────────────────────────────────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPT_DEFINITIONS.map(p => ({
      name:        p.name,
      description: p.description,
      arguments:   p.arguments,
    })),
  }));

  // ── Get Prompt ──────────────────────────────────────────────────────────────
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const result = buildPromptMessages(name, args as Record<string, string>);
    if (!result.messages || result.messages.length === 0) {
      throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
    }
    return result;
  });

  // ── Resources ───────────────────────────────────────────────────────────────

  // Resolve relative to the compiled server.js location so npm global installs work correctly
  const PROJECT_ROOT = join(__dirname, '..', '..');

  // Each resource lists candidate files (relative to PROJECT_ROOT), tried in order:
  //   - docs/reference/*.md exists only on a full source checkout with the
  //     private reference docs — npm installs fall back to the bundled summary.
  //   - training-pair.json files ship in the npm tarball (package.json "files")
  //     and are copied into dist/mcp-server/resources/examples/ for the
  //     bundled VS Code extension build.
  const RESOURCES: ReadonlyArray<{
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    files: readonly string[];
  }> = [
    {
      uri:         'biztalk://reference/component-mapping',
      name:        'Component Mapping Reference',
      description: 'BizTalk orchestration shapes → Logic Apps actions (35+ mappings)',
      mimeType:    'text/markdown',
      files:       ['docs/reference/component-mapping.md'],
    },
    {
      uri:         'biztalk://reference/connector-mapping',
      name:        'Connector Mapping Reference',
      description: 'BizTalk adapters → Logic Apps connectors (47+ adapters with config examples)',
      mimeType:    'text/markdown',
      files:       ['docs/reference/connector-mapping.md'],
    },
    {
      uri:         'biztalk://reference/expression-mapping',
      name:        'Expression Mapping Reference',
      description: 'XLANG/s to WDL expression translation guide',
      mimeType:    'text/markdown',
      files:       ['docs/reference/expression-mapping.md'],
    },
    {
      uri:         'biztalk://reference/pattern-mapping',
      name:        'Pattern Mapping Reference',
      description: 'Enterprise integration pattern migrations (16 patterns)',
      mimeType:    'text/markdown',
      files:       ['docs/reference/pattern-mapping.md'],
    },
    {
      uri:         'biztalk://reference/gap-analysis',
      name:        'Gap Analysis Reference',
      description: 'Critical gaps between BizTalk capabilities and Logic Apps equivalents',
      mimeType:    'text/markdown',
      files:       ['docs/reference/gap-analysis.md'],
    },
    {
      uri:         'biztalk://schema/decision-trees',
      name:        'Decision Trees Schema',
      description: 'Machine-readable decision trees for SKU, connector, and transform choices',
      mimeType:    'application/json',
      files:       [
        'schemas/decision-trees.json',
        'dist/mcp-server/resources/schemas/decision-trees.json',
      ],
    },
    {
      uri:         'biztalk://examples/simple-file-receive',
      name:        'Simple File Receive Example',
      description: 'Training pair: FILE receive → transform → send (simple linear flow)',
      mimeType:    'application/json',
      files:       [
        'tests/fixtures/02-simple-file-receive/training-pair.json',
        'dist/mcp-server/resources/examples/02-simple-file-receive.training-pair.json',
      ],
    },
    {
      uri:         'biztalk://examples/content-based-routing',
      name:        'Content-Based Routing Example',
      description: 'Training pair: FILE receive → decide → route (CBR pattern)',
      mimeType:    'application/json',
      files:       [
        'tests/fixtures/03-content-based-routing/training-pair.json',
        'dist/mcp-server/resources/examples/03-content-based-routing.training-pair.json',
      ],
    },
  ];

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES.map(r => ({
      uri:         r.uri,
      name:        r.name,
      description: r.description,
      mimeType:    r.mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const resource = RESOURCES.find(r => r.uri === uri);
    if (!resource) {
      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
    }

    // 1. Prefer the full document when it exists on disk (source checkout,
    //    npm-shipped fixture, or bundled extension copy).
    for (const relPath of resource.files) {
      try {
        const content = readFileSync(join(PROJECT_ROOT, relPath), 'utf-8');
        return {
          contents: [{
            uri,
            mimeType: resource.mimeType,
            text:     content,
          }],
        };
      } catch {
        // try the next candidate
      }
    }

    // 2. Bundled condensed reference (ships with every install).
    const bundled = BUNDLED_REFERENCE[uri];
    if (bundled) {
      return {
        contents: [{
          uri,
          mimeType: resource.mimeType,
          text:     bundled,
        }],
      };
    }

    // 3. Honest fallback — nothing usable in this installation.
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: `Resource "${resource.name}" is not available in this installation.\n\n`
            + `Description: ${resource.description}\n\n`
            + `The equivalent knowledge is applied automatically by the AI enrichment\n`
            + `step when BTLA_LICENSE_KEY is configured, and the analysis tools\n`
            + `(detect_patterns, generate_gap_analysis, generate_architecture) expose\n`
            + `the same mappings per-application. Support: me@jonlevesque.com`,
      }],
    };
  });

  // ── Start ───────────────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error(`[biztalk-migrate] MCP server started — tier: ${licenseTier}, tools: ${getToolsForTier(licenseTier).length}`);
}

export const startMcpServer = main;

// Auto-start when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    console.error('[biztalk-migrate] Fatal startup error:', err);
    process.exit(1);
  });
}
