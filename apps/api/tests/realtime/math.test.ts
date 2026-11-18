import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const generate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: generate }; } }));
import { calculate, solveMath } from '../../src/realtime/math.js';

beforeEach(() => { generate.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('calculate', () => {
  it.each([
    ['340 * 15 / 100', '51'],
    ['2^10', '1024'],
    ['sqrt(16) + 1', '5'],
    ['5 km to m', '5000 m'],
    ['derivative("x^2", "x")', '2 * x'],
    ['f(x) = x^2; f(3)', '9'],
  ])('evaluates %s', (expression, result) => {
    expect(calculate(expression)).toMatchObject({ success: true, result });
  });

  it('returns a shorter spoken form', () => {
    const value = calculate('sqrt(2) * pi');
    expect(value).toMatchObject({ success: true, result: '4.44288293816', spoken: '4.44288' });
  });

  it('reports invalid expressions instead of throwing', () => {
    expect(calculate('2 +* 3')).toMatchObject({ success: false });
    expect(calculate('')).toMatchObject({ success: false });
    expect(calculate('x'.repeat(501))).toMatchObject({ success: false });
  });

  it.each([
    'import({ a: 1 })',
    'createUnit("foo")',
    'config({ number: "BigNumber" })',
    'evaluate("1 + 1")',
    'zeros(100000, 100000)',
    '1:1000000000',
    'g = import; g({})',
  ])('blocks %s', expression => {
    expect(calculate(expression)).toMatchObject({ success: false });
  });
});

describe('solveMath', () => {
  it('uses native code execution and returns the spoken answer and computed output', async () => {
    generate.mockResolvedValue({ candidates: [{ content: { parts: [
      { thought: true, text: 'thinking' },
      { executableCode: { code: 'print(6 * 7)' } },
      { codeExecutionResult: { output: '42\n' } },
      { text: 'The answer is 42.' },
    ] } }] });
    await expect(solveMath('key', 'math-model', 'six times seven')).resolves.toEqual({
      success: true, answer: 'The answer is 42.', computedOutput: '42',
    });
    expect(generate.mock.calls[0][0]).toMatchObject({ model: 'math-model', contents: 'six times seven', config: { tools: [{ codeExecution: {} }], maxOutputTokens: 1024 } });
  });

  it('rejects an empty response', async () => {
    generate.mockResolvedValue({ candidates: [{ content: { parts: [] } }] });
    await expect(solveMath('key', 'model', 'problem')).rejects.toThrow('empty');
  });

  it('does not retry failed requests', async () => {
    generate.mockRejectedValue(new Error('Unavailable'));
    await expect(solveMath('key', 'model', 'problem')).rejects.toThrow('Unavailable');
    expect(generate).toHaveBeenCalledOnce();
  });

  it('aborts after fifteen seconds even if the SDK never settles', async () => {
    vi.useFakeTimers();
    generate.mockReturnValue(new Promise(() => {}));
    const rejected = expect(solveMath('key', 'model', 'problem')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(generate.mock.calls[0][0].config.abortSignal.aborted).toBe(true);
  });

  it('cancels with the caller signal', async () => {
    generate.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = solveMath('key', 'model', 'problem', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });
});
