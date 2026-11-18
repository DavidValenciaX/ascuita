import type { AppConfig } from '../config.js';
import type { RealtimeServerMessage, RealtimeSessionInfo, RealtimeToolCall, ToolDefinition } from '../../../../shared/realtime-protocol.js';
import { describeError, type RealtimeSession, type SessionCallbacks, type SessionWarning } from './types.js';
import { GeminiRealtimeAdapter } from './gemini.js';
import { QwenRealtimeAdapter } from './qwen.js';
import { searchWeb, WEB_SEARCH_TOOL } from './search.js';
import { CALCULATE_TOOL, calculate, SOLVE_MATH_TOOL, solveMath } from './math.js';

/** A tool executed by the backend; its calls never reach the client. */
type ServerTool = {
  definition: ToolDefinition;
  /** Text argument used for size-only diagnostics. */
  argument: string;
  run(call: RealtimeToolCall, signal: AbortSignal): Promise<unknown>;
  onResult?(result: unknown): void;
  failure?: { event: SessionWarning['event']; model: string; result: unknown };
};

export function createRealtimeSession(
  config: AppConfig,
  info: RealtimeSessionInfo,
  callbacks: SessionCallbacks,
  legacyConfig?: unknown,
): RealtimeSession {
  let closed = false;
  const counts = new Map<string, number>();
  const running = new Map<string, AbortController>();
  // Legacy /live clients send Gemini's raw config, so server tools cannot be injected there.
  const native = legacyConfig === undefined;
  let serverTools = new Map<string, ServerTool>();

  const toolsFor = (webSearch: boolean | undefined): ServerTool[] => [
    ...(info.provider === 'qwen' && webSearch ? [{
      definition: WEB_SEARCH_TOOL,
      argument: 'query',
      run: (call: RealtimeToolCall, signal: AbortSignal) => searchWeb(config.geminiApiKey!, config.webSearchModel, String(call.args.query), signal),
      onResult: (result: unknown) => callbacks.onEvent({ type: 'sources', payload: result as Extract<RealtimeServerMessage, { type: 'sources' }>['payload'] }),
      failure: {
        event: 'live.provider.web_search_failed' as const,
        model: config.webSearchModel,
        result: { success: false, error: 'Web search unavailable. Do not claim that a search succeeded.' },
      },
    }] : []),
    ...(native ? [{
      definition: CALCULATE_TOOL,
      argument: 'expression',
      run: async (call: RealtimeToolCall) => calculate(String(call.args.expression)),
    }, {
      definition: SOLVE_MATH_TOOL,
      argument: 'problem',
      run: (call: RealtimeToolCall, signal: AbortSignal) => solveMath(config.geminiApiKey!, config.mathModel, String(call.args.problem), signal),
      failure: {
        event: 'live.provider.solve_math_failed' as const,
        model: config.mathModel,
        result: { success: false, error: 'Math solver unavailable. Tell the user you could not verify the result instead of guessing.' },
      },
    }] : []),
  ];

  const execute = (tool: ServerTool, call: RealtimeToolCall) => {
    if (running.has(call.callId)) return;
    const controller = new AbortController();
    running.set(call.callId, controller);
    const name = tool.definition.name;
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    const started = Date.now();
    void (async () => {
      let success = false;
      try {
        const result = await tool.run(call, controller.signal);
        if (closed || controller.signal.aborted) return;
        success = !(result && typeof result === 'object' && 'success' in result && result.success === false);
        tool.onResult?.(result);
        await adapter.sendToolResults([{ callId: call.callId, name: call.name, result }]);
      } catch (error) {
        if (closed || controller.signal.aborted) return;
        if (tool.failure) callbacks.onWarning?.({
          event: tool.failure.event,
          tool: name,
          model: tool.failure.model,
          elapsedMs: Date.now() - started,
          queryLength: String(call.args[tool.argument]).length,
          error: describeError(error),
        });
        await adapter.sendToolResults([{
          callId: call.callId, name: call.name, result: tool.failure?.result ?? { success: false, error: 'Tool unavailable' },
        }]);
      } finally {
        running.delete(call.callId);
        if (!closed) callbacks.onEvent({ type: 'usage', payload: {
          operation: name, count, ...(name === WEB_SEARCH_TOOL.name ? { searchCount: count } : {}), success, elapsedMs: Date.now() - started,
        } });
      }
    })().catch(() => {
      if (!closed && !controller.signal.aborted) callbacks.onEvent({ type: 'error', payload: {
        code: 'TOOL_RESULT_FAILED', message: `Could not deliver the ${name} result to the realtime session`, fatal: true,
      } });
    });
  };

  const onEvent = (event: RealtimeServerMessage) => {
    if (closed) return;
    if (event.type === 'tool.cancelled') event.payload.callIds.forEach(id => running.get(id)?.abort());
    if (event.type !== 'tool.call' || !serverTools.size) {
      callbacks.onEvent(event);
      return;
    }
    const local = event.payload.calls.filter(call => !serverTools.has(call.name));
    if (local.length) callbacks.onEvent({ type: 'tool.call', payload: { calls: local } });
    for (const call of event.payload.calls) {
      const tool = serverTools.get(call.name);
      if (tool) execute(tool, call);
    }
  };

  const adapter: RealtimeSession = info.provider === 'gemini'
    ? new GeminiRealtimeAdapter(config.geminiApiKey!, info, { ...callbacks, onEvent }, legacyConfig)
    : new QwenRealtimeAdapter(config.qwenApiKey!, config.qwenWorkspaceId!, info, { onEvent });
  return {
    info,
    connect: settings => {
      const tools = toolsFor(settings.config.webSearch);
      serverTools = new Map(tools.map(tool => [tool.definition.name, tool]));
      // Qwen never exposes a client-declared web_search; only the server implementation is trusted.
      const reserved = (name: string) => serverTools.has(name) || (info.provider === 'qwen' && name === WEB_SEARCH_TOOL.name);
      if (!tools.length && info.provider !== 'qwen') return adapter.connect(settings);
      return adapter.connect({
        ...settings,
        config: { ...settings.config, tools: [
          ...(settings.config.tools ?? []).filter(tool => !reserved(tool.name)),
          ...tools.map(tool => tool.definition),
        ] },
      });
    },
    sendAudio: data => adapter.sendAudio(data),
    sendText: (text, turnComplete) => adapter.sendText(text, turnComplete),
    updateInstructions: instructions => adapter.updateInstructions(instructions),
    sendToolResults: results => adapter.sendToolResults(results),
    close: () => {
      closed = true;
      running.forEach(controller => controller.abort());
      running.clear();
      adapter.close();
    },
  };
}
