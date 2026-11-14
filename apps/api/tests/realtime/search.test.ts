import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const generate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({ Modality: { AUDIO: 'AUDIO' }, GoogleGenAI: class { models = { generateContent: generate }; } }));
import { searchWeb } from '../../src/realtime/search.js';
import { groundingResult } from '../../src/realtime/gemini.js';

beforeEach(() => { generate.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('web search', () => {
  it('returns grounded sources and the Google search entry point', async () => {
    generate.mockResolvedValue({ text: 'Summary', candidates: [{ groundingMetadata: { groundingChunks: [{ web: { title: 'Page', uri: 'https://example.com' } }], searchEntryPoint: { renderedContent: '<p>Google</p>' } } }] });
    await expect(searchWeb('key', 'search-model', 'question')).resolves.toEqual({ summary: 'Summary', sources: [{ title: 'Page', url: 'https://example.com' }], searchEntryPoint: { renderedContent: '<p>Google</p>' },
      groundingMetadata: { groundingChunks: [{ web: { title: 'Page', uri: 'https://example.com' } }], searchEntryPoint: { renderedContent: '<p>Google</p>' } } });
  });
  it('does not retry failed requests', async () => {
    generate.mockRejectedValue(new Error('Unavailable'));
    await expect(searchWeb('key', 'model', 'question')).rejects.toThrow('Unavailable');
    expect(generate).toHaveBeenCalledOnce();
  });
  it('aborts and rejects after ten seconds even if an SDK promise never settles', async () => {
    vi.useFakeTimers();
    generate.mockReturnValue(new Promise(() => {}));
    const pending = searchWeb('key', 'model', 'question');
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(generate.mock.calls[0][0].config.abortSignal.aborted).toBe(true);
    expect(generate).toHaveBeenCalledOnce();
  });
  it('cancels in-flight searches on disconnection', async () => {
    generate.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = searchWeb('key', 'model', 'question', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });
  it('does not expose non-web links as sources', () => {
    expect(groundingResult({ groundingChunks: [{ web: { uri: 'javascript:alert(1)' } }] })).toBeUndefined();
  });
});
