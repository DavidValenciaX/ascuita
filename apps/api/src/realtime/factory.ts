import type { AppConfig } from '../config.js';
import type { RealtimeServerMessage, RealtimeSessionInfo } from '../../../../shared/realtime-protocol.js';
import type { RealtimeSession, SessionCallbacks } from './types.js';
import { GeminiRealtimeAdapter } from './gemini.js';
import { QwenRealtimeAdapter } from './qwen.js';
import { searchWeb, WEB_SEARCH_TOOL } from './search.js';

export function createRealtimeSession(
  config: AppConfig,
  info: RealtimeSessionInfo,
  callbacks: SessionCallbacks,
  legacyConfig?: unknown,
): RealtimeSession {
  let closed = false;
  let searchCount = 0;
  const searches = new Map<string, AbortController>();
  const onEvent = (event: RealtimeServerMessage) => {
    if (closed) return;
    if (event.type === 'tool.cancelled') event.payload.callIds.forEach(id => searches.get(id)?.abort());
    if (event.type !== 'tool.call' || info.provider !== 'qwen') {
      callbacks.onEvent(event);
      return;
    }
    const local = event.payload.calls.filter(call => call.name !== WEB_SEARCH_TOOL.name);
    if (local.length) callbacks.onEvent({ type: 'tool.call', payload: { calls: local } });
    for (const call of event.payload.calls.filter(item => item.name === WEB_SEARCH_TOOL.name)) {
      if (searches.has(call.callId)) continue;
      const controller = new AbortController();
      searches.set(call.callId, controller);
      searchCount += 1;
      const started = Date.now();
      void (async () => {
        let success = false;
        try {
          const result = await searchWeb(config.geminiApiKey!, config.webSearchModel, String(call.args.query), controller.signal);
          if (closed || controller.signal.aborted) return;
          success = true;
          callbacks.onEvent({ type: 'sources', payload: result });
          await adapter.sendToolResults([{ callId: call.callId, name: call.name, result }]);
        } catch {
          if (!closed && !controller.signal.aborted) await adapter.sendToolResults([{
            callId: call.callId, name: call.name, result: { success: false, error: 'Web search unavailable. Do not claim that a search succeeded.' },
          }]);
        } finally {
          searches.delete(call.callId);
          if (!closed) callbacks.onEvent({ type: 'usage', payload: { operation: 'web_search', searchCount, success, elapsedMs: Date.now() - started } });
        }
      })().catch(() => {
        if (!closed && !controller.signal.aborted) callbacks.onEvent({ type: 'error', payload: {
          code: 'TOOL_RESULT_FAILED', message: 'Could not deliver the search result to the realtime session', fatal: true,
        } });
      });
    }
  };
  const adapter: RealtimeSession = info.provider === 'gemini'
    ? new GeminiRealtimeAdapter(config.geminiApiKey!, info, { ...callbacks, onEvent }, legacyConfig)
    : new QwenRealtimeAdapter(config.qwenApiKey!, config.qwenWorkspaceId!, info, { onEvent });
  return {
    info,
    connect: settings => adapter.connect(info.provider === 'qwen' ? {
      ...settings,
      config: { ...settings.config, tools: [
        ...(settings.config.tools ?? []).filter(tool => tool.name !== WEB_SEARCH_TOOL.name),
        ...(settings.config.webSearch ? [WEB_SEARCH_TOOL] : []),
      ] },
    } : settings),
    sendAudio: data => adapter.sendAudio(data),
    sendText: (text, turnComplete) => adapter.sendText(text, turnComplete),
    sendToolResults: results => adapter.sendToolResults(results),
    close: () => {
      closed = true;
      searches.forEach(controller => controller.abort());
      searches.clear();
      adapter.close();
    },
  };
}
