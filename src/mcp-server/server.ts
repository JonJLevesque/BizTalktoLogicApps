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
 *           "BIZTALK_LICENSE_KEY": "your-license-key"
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
  ErrorCode,
  McpError,
}                              from '@modelcontextprotocol/sdk/types.js';

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
  tools:   { listChanged: false },
  prompts: { listChanged: false },
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  // Validate license on startup (non-fatal — server runs in limited mode if invalid)
  let licenseTier: 'free' | 'standard' | 'premium' = 'free';
  const licenseKey = process.env['BIZTALK_LICENSE_KEY'];

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
    console.error('[biztalk-migrate] No BIZTALK_LICENSE_KEY set. Running in free tier (understand + document only).');
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
