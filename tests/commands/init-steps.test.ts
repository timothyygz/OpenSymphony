import { test, describe, expect, beforeEach, afterEach } from "bun:test";
import { createMockPrompts, CANCEL } from "../__mocks__/clack-prompts.ts";
import {
  stepTracker,
  stepAgent,
  stepWorkspace,
  stepTemplate,
  checkExistingWorkflow,
  parseBitableUrl,
  type InitDeps,
  type SetupApi,
} from "../../src/commands/init-core.ts";
import { STANDARD_FIELDS } from "../../src/adapters/tracker/feishu-bitable/setup-api.ts";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REQUIRED_FIELD_NAMES = STANDARD_FIELDS.map((f) => f.field_name);

function makeValidFields() {
  return REQUIRED_FIELD_NAMES.map((name) => ({ field_name: name, type: 1 }));
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
    listFields: overrides.listFields ?? (async () => makeValidFields()),
  };
}

function createMockDeps(setupApiOverrides: Partial<SetupApi> = {}): {
  deps: InitDeps;
  enqueue: (...values: unknown[]) => void;
  reset: () => void;
} {
  const { prompts, enqueue, reset } = createMockPrompts();
  const deps: InitDeps = {
    prompts,
    createSetupApi: () => createMockSetupApi(setupApiOverrides),
    checkClaudeCli: async () => true,
    homedir: () => "/tmp/test-home",
  };
  return { deps, enqueue, reset };
}

// --- stepTracker ---

describe("stepTracker", () => {
  test("happy path (new): connection ok, skip ownership transfer", async () => {
    const { deps, enqueue } = createMockDeps();
    // appId, appSecret (from group), mode="new", phone (empty)
    enqueue("cli_test_app", "test_secret", "new", "");

    const result = await stepTracker(deps);

    expect(result).not.toBeNull();
    expect(result!.config.app_token).toBe("test_app_token");
    expect(result!.config.table_id).toBe("test_new_table");
    expect(result!.credentials).toEqual({ app_id: "cli_test_app", app_secret: "test_secret" });
  });

  test("with ownership transfer (new)", async () => {
    const { deps, enqueue } = createMockDeps({
      lookupUserByMobile: async () => "ou_transferred_user",
      transferOwnership: async () => {},
    });
    enqueue("cli_app", "secret", "new", "13800138000");

    const result = await stepTracker(deps);
    expect(result).not.toBeNull();
    expect(result!.config.app_token).toBe("test_app_token");
  });

  test("returns null on connection failure", async () => {
    const { deps, enqueue } = createMockDeps({
      testConnection: async () => { throw new Error("Auth failed"); },
    });
    enqueue("cli_app", "bad_secret");

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null on createApp failure (new mode)", async () => {
    const { deps, enqueue } = createMockDeps({
      createApp: async () => { throw new Error("API error"); },
    });
    enqueue("cli_app", "secret", "new");

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null on createTable failure (new mode)", async () => {
    const { deps, enqueue } = createMockDeps({
      createTable: async () => { throw new Error("Table error"); },
    });
    enqueue("cli_app", "secret", "new");

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null when user cancels on appId/appSecret", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(CANCEL);

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null when user cancels on mode selection", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("cli_app", "secret", CANCEL);

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  // --- Existing Bitable tests ---

  test("existing: select existing table with valid fields", async () => {
    const { deps, enqueue } = createMockDeps({
      listTables: async () => [
        { table_id: "tbl_existing", name: "我的任务" },
      ],
      listFields: async () => makeValidFields(),
    });
    // appId, appSecret, mode="existing", url, selected table
    enqueue("cli_app", "secret", "existing",
      "https://xxx.feishu.cn/base/basTest123",
      "tbl_existing");

    const result = await stepTracker(deps);
    expect(result).not.toBeNull();
    expect(result!.config.app_token).toBe("basTest123");
    expect(result!.config.table_id).toBe("tbl_existing");
    expect(result!.credentials).toEqual({ app_id: "cli_app", app_secret: "secret" });
  });

  test("existing: URL with table_id, fields valid — skip selection", async () => {
    const { deps, enqueue } = createMockDeps({
      listTables: async () => [
        { table_id: "tbl_from_url", name: "URL任务" },
      ],
      listFields: async () => makeValidFields(),
    });
    // appId, appSecret, mode="existing", url (with table param)
    enqueue("cli_app", "secret", "existing",
      "https://xxx.feishu.cn/base/basTest123?table=tbl_from_url");

    const result = await stepTracker(deps);
    expect(result).not.toBeNull();
    expect(result!.config.app_token).toBe("basTest123");
    expect(result!.config.table_id).toBe("tbl_from_url");
  });

  test("existing: URL with table_id but fields invalid — fall through to selection", async () => {
    const { deps, enqueue } = createMockDeps({
      listTables: async () => [
        { table_id: "tbl_bad", name: "不完整表" },
      ],
      listFields: async () => [{ field_name: "标题", type: 1 }], // missing many fields
    });
    // appId, appSecret, mode, url (with table), select create new table
    enqueue("cli_app", "secret", "existing",
      "https://xxx.feishu.cn/base/basTest?table=tbl_bad",
      "__create__");

    const result = await stepTracker(deps);
    expect(result).not.toBeNull();
    expect(result!.config.app_token).toBe("basTest");
    expect(result!.config.table_id).toBe("test_new_table");
  });

  test("existing: create new table in existing app", async () => {
    const { deps, enqueue } = createMockDeps({
      listTables: async () => [
        { table_id: "tbl_other", name: "其他表" },
      ],
    });
    // appId, appSecret, mode, url, select "__create__"
    enqueue("cli_app", "secret", "existing",
      "https://xxx.feishu.cn/base/basExisting",
      "__create__");

    const result = await stepTracker(deps);
    expect(result).not.toBeNull();
    expect(result!.config.app_token).toBe("basExisting");
    expect(result!.config.table_id).toBe("test_new_table");
  });

  test("existing: selected table missing fields, confirm create new", async () => {
    const { deps, enqueue } = createMockDeps({
      listTables: async () => [
        { table_id: "tbl_incomplete", name: "不完整" },
      ],
      listFields: async () => [{ field_name: "标题", type: 1 }],
    });
    // appId, appSecret, mode, url, select existing table, confirm create new
    enqueue("cli_app", "secret", "existing",
      "https://xxx.feishu.cn/base/basTest",
      "tbl_incomplete", true);

    const result = await stepTracker(deps);
    expect(result).not.toBeNull();
    expect(result!.config.table_id).toBe("test_new_table");
  });

  test("existing: selected table missing fields, reject create → null", async () => {
    const { deps, enqueue } = createMockDeps({
      listTables: async () => [
        { table_id: "tbl_incomplete", name: "不完整" },
      ],
      listFields: async () => [{ field_name: "标题", type: 1 }],
    });
    // appId, appSecret, mode, url, select existing table, reject create
    enqueue("cli_app", "secret", "existing",
      "https://xxx.feishu.cn/base/basTest",
      "tbl_incomplete", false);

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("existing: invalid URL → null", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("cli_app", "secret", "existing", "not-a-valid-url");

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("existing: cancel on URL input → null", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("cli_app", "secret", "existing", CANCEL);

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("existing: cancel on table selection → null", async () => {
    const { deps, enqueue } = createMockDeps({
      listTables: async () => [
        { table_id: "tbl_x", name: "表" },
      ],
    });
    enqueue("cli_app", "secret", "existing",
      "https://xxx.feishu.cn/base/basTest", CANCEL);

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("existing: listTables fails → null", async () => {
    const { deps, enqueue } = createMockDeps({
      listTables: async () => { throw new Error("Access denied"); },
    });
    enqueue("cli_app", "secret", "existing",
      "https://xxx.feishu.cn/base/basTest");

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });
});

// --- stepAgent ---

describe("stepAgent", () => {
  test("happy path with defaults", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("auto");

    const result = await stepAgent(deps);
    expect(result).not.toBeNull();
    expect((result!.config as Record<string, unknown>).approval_policy).toBe("auto");
  });

  test("custom approval policy", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("suggest");

    const result = await stepAgent(deps);
    expect((result!.config as Record<string, unknown>).approval_policy).toBe("suggest");
  });

  test("returns null on cancel", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(CANCEL);

    const result = await stepAgent(deps);
    expect(result).toBeNull();
  });

  test("warns when Claude CLI not found", async () => {
    const { prompts, enqueue, reset } = createMockPrompts();
    const warnMessages: string[] = [];
    const origWarn = prompts.log.warn;
    prompts.log.warn = (msg: string) => warnMessages.push(msg);

    const deps: InitDeps = {
      prompts,
      createSetupApi: () => createMockSetupApi(),
      checkClaudeCli: async () => false,
      homedir: () => "/tmp/test-home",
    };
    enqueue("auto");

    await stepAgent(deps);
    expect(warnMessages.length).toBeGreaterThan(0);
    expect(warnMessages[0]).toContain("Claude CLI not found");
    prompts.log.warn = origWarn;
  });
});

// --- stepWorkspace ---

describe("stepWorkspace", () => {
  test("none type", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("none", "~/.open-symphony/workspace");

    const result = await stepWorkspace(deps);
    expect(result).not.toBeNull();
    expect(result!.root).toBe("~/.open-symphony/workspace");
    expect(result!.sources).toBeUndefined();
  });

  test("git-worktree type", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("git-worktree", "~/.open-symphony/workspace");

    const result = await stepWorkspace(deps);
    expect(result).not.toBeNull();
    expect(result!.sources).toEqual([{ type: "git-worktree", repo: "~/.open-symphony/workspace", path: "/" }]);
  });

  test("git-clone type", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("git-clone", "~/.open-symphony/workspace", "git@github.com:org/repo.git", "repo", "main");

    const result = await stepWorkspace(deps);
    expect(result).not.toBeNull();
    expect(result!.sources).toEqual([{ type: "git-clone", url: "git@github.com:org/repo.git", path: "repo", depth: 1, branch: "main" }]);
  });

  test("git-clone without branch", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("git-clone", "~/.open-symphony/workspace", "git@github.com:org/repo.git", "repo", "");

    const result = await stepWorkspace(deps);
    expect(result).not.toBeNull();
    expect((result!.sources as Record<string, unknown>[])[0].branch).toBeUndefined();
  });

  test("returns null on cancel at sourceType", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(CANCEL);

    const result = await stepWorkspace(deps);
    expect(result).toBeNull();
  });

  test("returns null on cancel at root", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("none", CANCEL);

    const result = await stepWorkspace(deps);
    expect(result).toBeNull();
  });

  test("returns null on cancel at git-clone url", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("git-clone", "~/.open-symphony/workspace", CANCEL);

    const result = await stepWorkspace(deps);
    expect(result).toBeNull();
  });
});

// --- stepTemplate ---

describe("stepTemplate", () => {
  test("selects basic template", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("basic.md");

    const result = await stepTemplate(deps);
    expect(result).not.toBeNull();
    expect(result).toContain("identifier");
  });

  test("selects chinese template", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("chinese.md");

    const result = await stepTemplate(deps);
    expect(result).not.toBeNull();
  });

  test("selects empty template", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("empty.md");

    const result = await stepTemplate(deps);
    expect(result).not.toBeNull();
  });

  test("returns null on cancel", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(CANCEL);

    const result = await stepTemplate(deps);
    expect(result).toBeNull();
  });
});

// --- checkExistingWorkflow ---

describe("checkExistingWorkflow", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns true when no WORKFLOW.md exists", async () => {
    const { deps } = createMockDeps();
    const result = await checkExistingWorkflow(deps, tempDir);
    expect(result).toBe(true);
  });

  test("returns true when user chooses overwrite", async () => {
    writeFileSync(join(tempDir, "WORKFLOW.md"), "old content");
    const { deps, enqueue } = createMockDeps();
    enqueue("overwrite");

    const result = await checkExistingWorkflow(deps, tempDir);
    expect(result).toBe(true);
  });

  test("returns false when user chooses cancel", async () => {
    writeFileSync(join(tempDir, "WORKFLOW.md"), "old content");
    const { deps, enqueue } = createMockDeps();
    enqueue("cancel");

    const result = await checkExistingWorkflow(deps, tempDir);
    expect(result).toBe(false);
  });

  test("returns false when user presses Ctrl+C", async () => {
    writeFileSync(join(tempDir, "WORKFLOW.md"), "old content");
    const { deps, enqueue } = createMockDeps();
    enqueue(CANCEL);

    const result = await checkExistingWorkflow(deps, tempDir);
    expect(result).toBe(false);
  });
});

// --- parseBitableUrl ---

describe("parseBitableUrl", () => {
  test("parses URL with app_token only", () => {
    const result = parseBitableUrl("https://xxx.feishu.cn/base/basTest123");
    expect(result).toEqual({ appToken: "basTest123" });
  });

  test("parses URL with table query param", () => {
    const result = parseBitableUrl("https://xxx.feishu.cn/base/basABC?table=tblXYZ");
    expect(result).toEqual({ appToken: "basABC", tableId: "tblXYZ" });
  });

  test("parses URL with additional query params", () => {
    const result = parseBitableUrl("https://xxx.feishu.cn/base/basABC?table=tblXYZ&view=vew123");
    expect(result).toEqual({ appToken: "basABC", tableId: "tblXYZ" });
  });

  test("returns null for non-bitable URL", () => {
    expect(parseBitableUrl("https://google.com")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseBitableUrl("")).toBeNull();
  });

  test("returns null for random string", () => {
    expect(parseBitableUrl("just-some-text")).toBeNull();
  });
});
