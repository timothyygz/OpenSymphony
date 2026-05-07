import { test, describe, expect } from "bun:test";
import {
  stepTracker,
  stepAgent,
  stepWorkspace,
  initCommand,
  type InitDeps,
  type SetupApi,
  type Prompts,
} from "../../src/commands/init-core.ts";
import { CANCEL } from "../__mocks__/clack-prompts.ts";

/**
 * Enhanced mock that captures prompt arguments for verifying messages.
 */
function createCapturingMock() {
  const capturedTexts: Array<{ message: string; placeholder?: string; defaultValue?: string }> = [];
  const capturedSelects: Array<{ message: string; optionLabels: string[]; optionHints: string[] }> = [];
  const capturedNotes: Array<{ content: string; title: string }> = [];
  const capturedIntros: string[] = [];
  let answers: unknown[] = [];

  function enqueue(...values: unknown[]) {
    answers.push(...values);
  }

  const prompts: Prompts = {
    async text(opts): Promise<unknown> {
      if (opts) capturedTexts.push({ message: opts.message, placeholder: opts.placeholder, defaultValue: opts.defaultValue });
      return answers.length > 0 ? answers.shift()! : CANCEL;
    },

    async select(opts): Promise<unknown> {
      if (opts) capturedSelects.push({
        message: opts.message,
        optionLabels: opts.options.map((o) => o.label),
        optionHints: opts.options.map((o) => o.hint ?? ""),
      });
      return answers.length > 0 ? answers.shift()! : CANCEL;
    },

    async confirm(): Promise<unknown> {
      return answers.length > 0 ? answers.shift()! : CANCEL;
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

    note(content: string, title: string) {
      capturedNotes.push({ content, title });
    },

    intro(msg: string) {
      capturedIntros.push(msg);
    },

    outro() {},

    log: {
      success() {},
      error() {},
      warn() {},
      info() {},
    },
  };

  return { prompts, enqueue, capturedTexts, capturedSelects, capturedNotes, capturedIntros };
}

function createMockSetupApi(overrides: Partial<SetupApi> = {}): SetupApi {
  return {
    testConnection: overrides.testConnection ?? (async () => {}),
    createApp: overrides.createApp ?? (async () => ({
      app_token: "test_app_token",
      table_id: "test_default_table",
      url: "https://feishu.cn/base/test",
    })),
    createTable: overrides.createTable ?? (async () => ({
      table_id: "test_new_table",
    })),
    deleteTable: overrides.deleteTable ?? (async () => {}),
    lookupUserByMobile: overrides.lookupUserByMobile ?? (async () => "ou_test_user"),
    transferOwnership: overrides.transferOwnership ?? (async () => {}),
    listTables: overrides.listTables ?? (async () => []),
    listFields: overrides.listFields ?? (async () => []),
  };
}

// --- stepTracker prompt messages ---

describe("stepTracker prompt messages", () => {
  test("shows a help note with Feishu open platform links", async () => {
    const mock = createCapturingMock();
    const deps: InitDeps = {
      prompts: mock.prompts,
      createSetupApi: () => createMockSetupApi(),
      checkClaudeCli: async () => true,
      homedir: () => "/tmp/test-home",
    };
    mock.enqueue("feishu_bitable", "cli_test_app", "test_secret", "new", "");

    await stepTracker(deps);

    // Should have a note about Feishu credentials
    expect(mock.capturedNotes.length).toBeGreaterThanOrEqual(1);
    const helpNote = mock.capturedNotes[0];
    expect(helpNote.title).toContain("飞书");
    expect(helpNote.content).toContain("open.feishu.cn/app");
    expect(helpNote.content).toContain("open.feishu.cn/app/ai/playground");
  });

  test("App ID prompt mentions where to find it", async () => {
    const mock = createCapturingMock();
    const deps: InitDeps = {
      prompts: mock.prompts,
      createSetupApi: () => createMockSetupApi(),
      checkClaudeCli: async () => true,
      homedir: () => "/tmp/test-home",
    };
    mock.enqueue("feishu_bitable", "cli_test_app", "test_secret", "new", "");

    await stepTracker(deps);

    const appIdPrompt = mock.capturedTexts.find((t) =>
      t.message.toLowerCase().includes("app id"),
    );
    expect(appIdPrompt).toBeDefined();
    expect(appIdPrompt!.message).toContain("凭证");
  });

  test("App Secret prompt mentions where to find it", async () => {
    const mock = createCapturingMock();
    const deps: InitDeps = {
      prompts: mock.prompts,
      createSetupApi: () => createMockSetupApi(),
      checkClaudeCli: async () => true,
      homedir: () => "/tmp/test-home",
    };
    mock.enqueue("feishu_bitable", "cli_test_app", "test_secret", "new", "");

    await stepTracker(deps);

    const secretPrompt = mock.capturedTexts.find((t) =>
      t.message.toLowerCase().includes("app secret") ||
      t.message.toLowerCase().includes("secret"),
    );
    expect(secretPrompt).toBeDefined();
    expect(secretPrompt!.message).toContain("显示");
  });
});

// --- stepAgent prompt messages ---

describe("stepAgent prompt messages", () => {
  test("approval policy options include Chinese hints", async () => {
    const mock = createCapturingMock();
    const deps: InitDeps = {
      prompts: mock.prompts,
      createSetupApi: () => createMockSetupApi(),
      checkClaudeCli: async () => true,
      homedir: () => "/tmp/test-home",
    };
    mock.enqueue("auto");

    await stepAgent(deps);

    expect(mock.capturedSelects.length).toBe(1);
    const select = mock.capturedSelects[0];
    // Should have hints
    const hints = select.optionHints.filter((h) => h.length > 0);
    expect(hints.length).toBeGreaterThan(0);
  });

  test("approval policy message is in Chinese", async () => {
    const mock = createCapturingMock();
    const deps: InitDeps = {
      prompts: mock.prompts,
      createSetupApi: () => createMockSetupApi(),
      checkClaudeCli: async () => true,
      homedir: () => "/tmp/test-home",
    };
    mock.enqueue("auto");

    await stepAgent(deps);

    const select = mock.capturedSelects[0];
    expect(select.message).toContain("审批策略");
  });
});

// --- stepWorkspace prompt messages ---

describe("stepWorkspace prompt messages", () => {
  test("workspace root message explains the directory purpose", async () => {
    const mock = createCapturingMock();
    const deps: InitDeps = {
      prompts: mock.prompts,
      createSetupApi: () => createMockSetupApi(),
      checkClaudeCli: async () => true,
      homedir: () => "/tmp/test-home",
    };
    mock.enqueue("none", "~/.open-symphony/workspace");

    await stepWorkspace(deps);

    const rootPrompt = mock.capturedTexts.find((t) =>
      t.message.includes("根目录"),
    );
    expect(rootPrompt).toBeDefined();
    expect(rootPrompt!.message).toContain("子目录");
  });

  test("source type options have hints explaining each type", async () => {
    const mock = createCapturingMock();
    const deps: InitDeps = {
      prompts: mock.prompts,
      createSetupApi: () => createMockSetupApi(),
      checkClaudeCli: async () => true,
      homedir: () => "/tmp/test-home",
    };
    mock.enqueue("none", "~/.open-symphony/workspace");

    await stepWorkspace(deps);

    const select = mock.capturedSelects[0];
    // All options should have non-empty hints
    const nonEmptyHints = select.optionHints.filter((h) => h.length > 0);
    expect(nonEmptyHints.length).toBe(select.optionHints.length);
  });
});

// --- initCommand intro ---

describe("initCommand intro message", () => {
  test("shows a welcome note with setup overview", async () => {
    const mock = createCapturingMock();
    const deps: InitDeps = {
      prompts: mock.prompts,
      createSetupApi: () => createMockSetupApi(),
      checkClaudeCli: async () => true,
      homedir: () => "/tmp/test-home",
    };
    mock.enqueue(
      "cli_test_app", "test_secret", "",
      "auto",
      "none", "/tmp/test-ws",
      "basic.md",
    );

    await initCommand(["/tmp/test-ws"], deps);

    // Should have intro message
    expect(mock.capturedIntros.length).toBeGreaterThan(0);
    // Should have a welcome note (the overview note)
    const welcomeNote = mock.capturedNotes.find((n) =>
      n.title.includes("欢迎"),
    );
    expect(welcomeNote).toBeDefined();
    expect(welcomeNote!.content).toContain("飞书");
    expect(welcomeNote!.content).toContain("Agent");
    expect(welcomeNote!.content).toContain("工作区");
  });
});
