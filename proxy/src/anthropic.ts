/**
 * Raw Anthropic Messages API caller.
 *
 * Uses fetch() directly — no SDK dependency.
 * Cloudflare Workers bundle stays lean; no Node.js polyfills needed.
 *
 * System prompts are passed as an array of content blocks (layered prompts).
 * Blocks marked with cache_control are eligible for prompt caching:
 *   - First call: full token price
 *   - Subsequent calls within 5 min: ~90% cost reduction on cached blocks
 */

import type { AnthropicSystemBlock, AnthropicRequest, AnthropicResponse } from './types.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Calls the Anthropic Messages API (non-streaming).
 *
 * @param apiKey      - Anthropic API key
 * @param model       - Model ID (e.g. "claude-sonnet-4-6")
 * @param systemLayers - Ordered array of system prompt blocks. Mark stable
 *                       layers with cache_control for prompt caching savings.
 * @param userMessage  - The user turn content
 * @param maxTokens    - Max output tokens (default 8192)
 * @throws AnthropicError on non-2xx or missing text block
 */
export async function callAnthropic(
  apiKey:       string,
  model:        string,
  systemLayers: AnthropicSystemBlock[],
  userMessage:  string,
  maxTokens     = 8192,
): Promise<string> {
  const body: AnthropicRequest = {
    model,
    max_tokens: maxTokens,
    system:     systemLayers,
    messages:   [{ role: 'user', content: userMessage }],
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method:  'POST',
    headers: {
      'Content-Type':          'application/json',
      'x-api-key':             apiKey,
      'anthropic-version':     ANTHROPIC_VERSION,
      'anthropic-beta':        'prompt-caching-2024-07-31',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new AnthropicError(response.status, errorText);
  }

  const data = await response.json() as AnthropicResponse;

  const textBlock = data.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.text === undefined) {
    throw new AnthropicError(500, 'No text content block in Anthropic response');
  }

  return textBlock.text;
}

export class AnthropicError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AnthropicError';
  }
}
