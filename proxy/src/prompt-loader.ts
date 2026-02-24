/**
 * Loads large system prompt content from KV storage.
 *
 * Cloudflare secrets have a 5.1 KB limit. The domain knowledge prompt is ~18 KB,
 * so it lives in a dedicated KV namespace instead.
 *
 * Module-level caching: Cloudflare Worker isolates are reused across requests
 * in the same data centre, so the cache is warm after the first request per isolate.
 * No cold-start penalty for the vast majority of requests.
 */

// Module-level cache — lives for the lifetime of the isolate
let domainPromptCache: string | null = null;

/**
 * Returns the domain knowledge prompt, reading from KV on first call
 * and returning the cached value on all subsequent calls.
 */
export async function getDomainPrompt(kv: KVNamespace): Promise<string> {
  if (domainPromptCache !== null) return domainPromptCache;

  const value = await kv.get('domain');
  if (!value) {
    throw new Error(
      'Domain prompt not found in KV. Run ./prompts/upload.sh to initialize.'
    );
  }

  domainPromptCache = value;
  return domainPromptCache;
}

/** Clears the cache — useful for testing or after a prompt update. */
export function clearPromptCache(): void {
  domainPromptCache = null;
}
