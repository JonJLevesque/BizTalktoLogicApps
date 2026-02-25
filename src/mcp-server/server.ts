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
import { join }                from 'path';

import { ALL_TOOLS, getToolsForTier }    from './tools/definitions.js';
import { dispatchTool }                  from './tools/handler.js';
import { PROMPT_DEFINITIONS, buildPromptMessages } from './prompts/migration-guide.js';
import { validateLicense, getLicenseTier }         from '../licensing/index.js';

// ─── Server Info ──────────────────────────────────────────────────────────────

const SERVER_INFO = {
  name:    'biztalk-to-logicapps',
  version: '0.1.0',
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

  const PROJECT_ROOT = process.cwd();

  const RESOURCES = [
    {
      uri:         'biztalk://reference/component-mapping',
      name:        'Component Mapping Reference',
      description: 'BizTalk orchestration shapes → Logic Apps actions (35+ mappings)',
      mimeType:    'text/markdown',
      file:        'docs/reference/component-mapping.md',
    },
    {
      uri:         'biztalk://reference/connector-mapping',
      name:        'Connector Mapping Reference',
      description: 'BizTalk adapters → Logic Apps connectors (47+ adapters with config examples)',
      mimeType:    'text/markdown',
      file:        'docs/reference/connector-mapping.md',
    },
    {
      uri:         'biztalk://reference/expression-mapping',
      name:        'Expression Mapping Reference',
      description: 'XLANG/s to WDL expression translation guide',
      mimeType:    'text/markdown',
      file:        'docs/reference/expression-mapping.md',
    },
    {
      uri:         'biztalk://reference/pattern-mapping',
      name:        'Pattern Mapping Reference',
      description: 'Enterprise integration pattern migrations (16 patterns)',
      mimeType:    'text/markdown',
      file:        'docs/reference/pattern-mapping.md',
    },
    {
      uri:         'biztalk://reference/gap-analysis',
      name:        'Gap Analysis Reference',
      description: 'Critical gaps between BizTalk capabilities and Logic Apps equivalents',
      mimeType:    'text/markdown',
      file:        'docs/reference/gap-analysis.md',
    },
    {
      uri:         'biztalk://schema/decision-trees',
      name:        'Decision Trees Schema',
      description: 'Machine-readable decision trees for SKU, connector, and transform choices',
      mimeType:    'application/json',
      file:        'schemas/decision-trees.json',
    },
    {
      uri:         'biztalk://examples/simple-file-receive',
      name:        'Simple File Receive Example',
      description: 'Training pair: FILE receive → transform → send (simple linear flow)',
      mimeType:    'application/json',
      file:        'tests/fixtures/02-simple-file-receive/training-pair.json',
    },
    {
      uri:         'biztalk://examples/content-based-routing',
      name:        'Content-Based Routing Example',
      description: 'Training pair: FILE receive → decide → route (CBR pattern)',
      mimeType:    'application/json',
      file:        'tests/fixtures/03-content-based-routing/training-pair.json',
    },
  ] as const;

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

    try {
      const filePath = join(PROJECT_ROOT, resource.file);
      const content = readFileSync(filePath, 'utf-8');
      return {
        contents: [{
          uri,
          mimeType: resource.mimeType,
          text:     content,
        }],
      };
    } catch {
      // Resource files aren't shipped in the npm package — graceful fallback
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: `Resource "${resource.name}" is not available in this installation.\n\n`
              + `This resource requires the full repository clone from:\n`
              + `https://github.com/JonJLevesque/BTtoLA\n\n`
              + `Description: ${resource.description}`,
        }],
      };
    }
  });

  // ── Start ───────────────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error(`[biztalk-migrate] MCP server started — tier: ${licenseTier}, tools: ${getToolsForTier(licenseTier).length}`);
}

main().catch(err => {
  console.error('[biztalk-migrate] Fatal startup error:', err);
  process.exit(1);
});
