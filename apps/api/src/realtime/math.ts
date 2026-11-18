import { GoogleGenAI } from '@google/genai';
import { all, create, type MathNode } from 'mathjs';
import type { ToolDefinition } from '../../../../shared/realtime-protocol.js';

export const CALCULATE_TOOL: ToolDefinition = {
  name: 'calculate',
  description: 'Evaluate a math expression exactly using mathjs syntax. Use it for ANY arithmetic, percentages (e.g. "340 * 15 / 100"), '
    + 'powers, roots, trigonometry, logarithms, unit conversions (e.g. "5 km to mi"), derivative("x^2", "x") and simplify("2x + 3x"). '
    + 'Never compute numbers mentally. If it returns an error, fix the expression or use solve_math.',
  parameters: {
    type: 'object',
    properties: { expression: { type: 'string', description: 'A single mathjs expression, in English notation with "." as decimal separator.', minLength: 1, maxLength: 500 } },
    required: ['expression'],
    additionalProperties: false,
  },
};

export const SOLVE_MATH_TOOL: ToolDefinition = {
  name: 'solve_math',
  description: 'Solve math that needs reasoning: equations, systems of equations, word problems, statistics, or calculus beyond simple derivatives. '
    + 'Slower than calculate; use it only when calculate cannot express the problem.',
  parameters: {
    type: 'object',
    properties: { problem: { type: 'string', description: 'The full problem statement with all the data the user gave.', minLength: 1, maxLength: 2000 } },
    required: ['problem'],
    additionalProperties: false,
  },
};

export type CalculateResult =
  | { success: true; expression: string; result: string; spoken: string }
  | { success: false; error: string };

export type SolveMathResult = { success: true; answer: string; computedOutput?: string };

const math = create(all);

// mathjs' parser is sandboxed, but these names can mutate the shared instance,
// evaluate nested strings, or allocate unbounded memory/CPU.
const BLOCKED = new Set([
  'import', 'createUnit', 'config', 'evaluate', 'parse', 'compile', 'parser', 'reviver', 'replacer', 'resolve', 'chain',
  'zeros', 'ones', 'identity', 'range', 'matrix', 'sparse', 'resize', 'reshape', 'concat', 'diag', 'kron', 'map', 'forEach',
  'random', 'randomInt', 'pickRandom', 'bignumber', 'BigNumber', 'fraction', 'Fraction',
]);
const MAX_OUTPUT_LENGTH = 2000;

function blockedReason(node: MathNode): string | undefined {
  let reason: string | undefined;
  node.traverse(item => {
    if (reason) return;
    if (item.type === 'RangeNode') reason = 'Ranges are not supported';
    else if (item.type === 'SymbolNode' && BLOCKED.has((item as MathNode & { name: string }).name)) {
      reason = `Function ${(item as MathNode & { name: string }).name} is not available`;
    }
  });
  return reason;
}

function formatValue(value: unknown, precision: number): string {
  if (value && typeof value === 'object' && 'entries' in value && Array.isArray((value as { entries: unknown[] }).entries)) {
    const entries = (value as { entries: unknown[] }).entries;
    return formatValue(entries.at(-1), precision);
  }
  if (typeof value === 'function') throw new Error('The expression defines a function instead of computing a value');
  if (value === undefined) throw new Error('The expression did not produce a value');
  if (math.isNode(value)) return value.toString();
  return math.format(value as Parameters<typeof math.format>[0], { precision });
}

/** Deterministic local evaluation for the realtime `calculate` tool. */
export function calculate(expression: string): CalculateResult {
  const trimmed = expression.trim();
  if (!trimmed || trimmed.length > 500) return { success: false, error: 'Expression must have between 1 and 500 characters' };
  try {
    const node = math.parse(trimmed);
    const blocked = blockedReason(node);
    if (blocked) return { success: false, error: blocked };
    const value: unknown = node.compile().evaluate(new Map());
    const result = formatValue(value, 12);
    if (result.length > MAX_OUTPUT_LENGTH) return { success: false, error: 'Result is too large to return' };
    return { success: true, expression: trimmed, result, spoken: formatValue(value, 6) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid expression';
    return { success: false, error: `Could not evaluate expression: ${message.slice(0, 300)}` };
  }
}

const SOLVE_INSTRUCTIONS = 'You are a precise math solver. Use Python code execution to compute the answer; do not guess. '
  + 'Reply in the same language as the problem, giving the final answer first, then at most two short sentences explaining the steps. '
  + 'The reply will be read aloud, so avoid LaTeX and markdown.';
export const SOLVE_MATH_TIMEOUT_MS = 15_000;

type ResponsePart = { text?: string; thought?: boolean; codeExecutionResult?: { output?: string } };

/** Delegates a reasoning-heavy math problem to Gemini with native code execution. */
export async function solveMath(apiKey: string, model: string, problem: string, signal?: AbortSignal): Promise<SolveMathResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, SOLVE_MATH_TIMEOUT_MS);
  if (signal?.aborted) controller.abort();
  let cancel: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error('Math solver cancelled or timed out'));
    controller.signal.addEventListener('abort', cancel, { once: true });
    if (controller.signal.aborted) cancel();
  });
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await Promise.race([client.models.generateContent({
      model,
      contents: problem,
      config: {
        systemInstruction: SOLVE_INSTRUCTIONS,
        tools: [{ codeExecution: {} }],
        maxOutputTokens: 1024,
        abortSignal: controller.signal,
        httpOptions: { timeout: SOLVE_MATH_TIMEOUT_MS },
      },
    }), cancelled]);
    const parts = (response.candidates?.[0]?.content?.parts ?? []) as ResponsePart[];
    const answer = parts.filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('').trim();
    const computedOutput = parts.map(part => part.codeExecutionResult?.output).filter((output): output is string => Boolean(output?.trim())).at(-1)?.trim();
    if (!answer && !computedOutput) throw new Error('Math solver returned an empty response');
    return {
      success: true,
      answer: (answer || computedOutput!).slice(0, MAX_OUTPUT_LENGTH),
      ...(computedOutput ? { computedOutput: computedOutput.slice(0, MAX_OUTPUT_LENGTH) } : {}),
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    if (cancel) controller.signal.removeEventListener('abort', cancel);
  }
}
