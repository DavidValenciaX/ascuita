import { GoogleGenAI } from '@google/genai';
import type { GroundingResult, ToolDefinition } from '../../../../shared/realtime-protocol.js';
import { groundingResult } from './gemini.js';

export const WEB_SEARCH_TOOL: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for current, verifiable information. Return an answer based on the results and acknowledge unavailable searches.',
  parameters: {
    type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 1000 } },
    required: ['query'], additionalProperties: false,
  },
};

export async function searchWeb(apiKey: string, model: string, query: string, signal?: AbortSignal): Promise<GroundingResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 10_000);
  if (signal?.aborted) controller.abort();
  let cancel: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error('Web search cancelled or timed out'));
    controller.signal.addEventListener('abort', cancel, { once: true });
    if (controller.signal.aborted) cancel();
  });
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await Promise.race([client.models.generateContent({
      model,
      contents: query,
      config: {
        tools: [{ googleSearch: {} }],
        maxOutputTokens: 1024,
        abortSignal: controller.signal,
        httpOptions: { timeout: 10_000 },
      },
    }), cancelled]);
    const summary = response.text || '';
    return groundingResult(response.candidates?.[0]?.groundingMetadata, summary) ?? { summary, sources: [] };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    if (cancel) controller.signal.removeEventListener('abort', cancel);
  }
}
