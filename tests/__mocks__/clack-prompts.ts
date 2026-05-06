/**
 * Controllable mock for @clack/prompts.
 *
 * Usage:
 *   import { createMockPrompts, CANCEL } from "../__mocks__/clack-prompts.ts";
 *   const { prompts, enqueue, reset } = createMockPrompts();
 *   enqueue("value1", "value2", true);
 *   // ... call step functions with prompts ...
 *   reset(); // clear queue between tests
 */

const CANCEL = Symbol("clack:cancel");
export { CANCEL };

export function createMockPrompts() {
  let answers: unknown[] = [];

  function enqueue(...values: unknown[]) {
    answers.push(...values);
  }

  function reset() {
    answers = [];
  }

  const prompts = {
    async text(): Promise<unknown> {
      return answers.length > 0 ? answers.shift() : CANCEL;
    },

    async select(): Promise<unknown> {
      return answers.length > 0 ? answers.shift() : CANCEL;
    },

    async confirm(): Promise<unknown> {
      return answers.length > 0 ? answers.shift() : CANCEL;
    },

    async group<T extends Record<string, () => Promise<unknown>>>(promptMap: T): Promise<Record<string, unknown> | typeof CANCEL> {
      const result: Record<string, unknown> = {};
      for (const [key, fn] of Object.entries(promptMap)) {
        const val = await fn();
        if (val === CANCEL) return CANCEL;
        result[key] = val;
      }
      return result;
    },

    isCancel(val: unknown): boolean {
      return val === CANCEL;
    },

    spinner() {
      return { start() {}, stop() {} };
    },

    note() {},
    intro() {},
    outro() {},

    log: {
      success() {},
      error() {},
      warn() {},
      info() {},
    },
  };

  return { prompts, enqueue, reset };
}
