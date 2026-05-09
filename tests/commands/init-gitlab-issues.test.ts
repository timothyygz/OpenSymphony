import { test, describe, expect, mock, beforeEach, afterEach } from "bun:test";
import { createMockPrompts, CANCEL } from "../__mocks__/clack-prompts.ts";
import { stepTracker } from "../../src/setup/steps.ts";
import { initCommand } from "../../src/setup/wizard.ts";
import type { InitDeps, SetupApi } from "../../src/setup/types.ts";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- Mock GitLabApi via module mocking ---

const mockTestConnection = mock(() => Promise.resolve({ name: "Test Project" }));
const mockCreateLabel = mock(() => Promise.resolve());

mock.module("../../src/adapters/tracker/gitlab-issues/api.ts", () => {
  return {
    GitLabApi: class {
      constructor() {}
      testConnection = mockTestConnection;
      createLabel = mockCreateLabel;
    },
  };
});

// --- Shared helpers ---

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

function createMockDeps(): {
  deps: InitDeps;
  enqueue: (...values: unknown[]) => void;
  reset: () => void;
} {
  const { prompts, enqueue, reset } = createMockPrompts();
  const deps: InitDeps = {
    prompts,
    createSetupApi: () => createMockSetupApi(),
    checkClaudeCli: async () => true,
    homedir: () => "/tmp/test-home",
  };
  return { deps, enqueue, reset };
}

// --- stepTracker with gitlab_issues ---

describe("stepTracker — gitlab_issues", () => {
  beforeEach(() => {
    mockTestConnection.mockImplementation(() => Promise.resolve({ name: "Test Project" }));
    mockCreateLabel.mockImplementation(() => Promise.resolve());
    mockTestConnection.mockClear();
    mockCreateLabel.mockClear();
  });

  test("happy path: connection ok, create labels, default states", async () => {
    const { deps, enqueue } = createMockDeps();
    // tracker kind, group(host, token, projectId), createLabels=true, activeStates, terminalStates
    enqueue(
      "gitlab_issues",
      // group answers
      "https://gitlab.example.com", "glpat-test-token", "123",
      // confirm create labels
      true,
      // active states (default)
      "Todo,In Progress",
      // terminal states (default)
      "Done,Cancelled",
    );

    const result = await stepTracker(deps);

    expect(result).not.toBeNull();
    expect(result!.config).toEqual({
      kind: "gitlab_issues",
      gitlab_host: "https://gitlab.example.com",
      project_id: "123",
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done", "Cancelled"],
    });
    expect(result!.credentials).toEqual({ gitlab_token: "glpat-test-token" });
  });

  test("uses default host when empty", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      // group: host empty → defaults to https://gitlab.com
      "", "glpat-token", "group/project",
      true,
      "Todo,In Progress",
      "Done,Cancelled",
    );

    const result = await stepTracker(deps);

    expect(result).not.toBeNull();
    expect(result!.config.gitlab_host).toBe("https://gitlab.com");
    expect(result!.config.project_id).toBe("group/project");
  });

  test("declines label creation", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      "https://gitlab.com", "glpat-token", "42",
      // decline label creation
      false,
      "Todo,In Progress",
      "Done,Cancelled",
    );

    const result = await stepTracker(deps);

    expect(result).not.toBeNull();
    expect(result!.config.kind).toBe("gitlab_issues");
    // Labels should not be created
    expect(mockCreateLabel).not.toHaveBeenCalled();
  });

  test("custom active/terminal states", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      "https://gitlab.com", "glpat-token", "99",
      true,
      "Backlog,Doing,Review",
      "Closed,Rejected",
    );

    const result = await stepTracker(deps);

    expect(result).not.toBeNull();
    expect(result!.config.active_states).toEqual(["Backlog", "Doing", "Review"]);
    expect(result!.config.terminal_states).toEqual(["Closed", "Rejected"]);
  });

  test("returns null on cancel at group (host/token/projectId)", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("gitlab_issues", CANCEL);

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null when token is empty", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      "https://gitlab.com", "", "123",
    );

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null when projectId is empty", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      "https://gitlab.com", "glpat-token", "",
    );

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null on connection failure", async () => {
    mockTestConnection.mockImplementation(() => {
      throw new Error("401 Unauthorized");
    });

    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      "https://gitlab.com", "bad-token", "123",
    );

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null on cancel at activeStates", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      "https://gitlab.com", "glpat-token", "123",
      true,
      CANCEL,
    );

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null on cancel at terminalStates", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      "https://gitlab.com", "glpat-token", "123",
      true,
      "Todo,In Progress",
      CANCEL,
    );

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("label creation errors are silently skipped", async () => {
    let callCount = 0;
    mockCreateLabel.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) throw new Error("already exists");
    });

    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      "https://gitlab.com", "glpat-token", "123",
      true,
      "Todo,In Progress",
      "Done,Cancelled",
    );

    const result = await stepTracker(deps);
    expect(result).not.toBeNull();
    // All 4 labels attempted despite errors
    expect(mockCreateLabel).toHaveBeenCalledTimes(4);
  });
});

// --- initCommand full flow with gitlab_issues ---

describe("initCommand full flow — gitlab_issues", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-gitlab-"));
    mockTestConnection.mockImplementation(() => Promise.resolve({ name: "Test Project" }));
    mockCreateLabel.mockImplementation(() => Promise.resolve());
    mockTestConnection.mockClear();
    mockCreateLabel.mockClear();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Answer sequence for gitlab happy path:
  // stepTracker: kind, group(host,token,projectId), createLabels, activeStates, terminalStates
  // stepWorkspace: sourceType (none)
  // stepTemplate: template file
  function gitlabHappyPathAnswers(overrides: Partial<{
    template: string;
    sourceType: string;
  }> = {}): unknown[] {
    const sourceType = overrides.sourceType ?? "none";
    const answers: unknown[] = [
      // stepTracker
      "gitlab_issues",
      "https://gitlab.example.com", "glpat-test-token", "42",
      true,
      "Todo,In Progress",
      "Done,Cancelled",
      // stepAgent: approval policy
      "auto",
      // stepWorkspace
      sourceType,
    ];
    if (sourceType === "git-worktree") {
      answers.push("~/Workspace/repo", "repo");
    } else if (sourceType === "git-clone") {
      answers.push("git@gitlab.example.com:org/repo.git", "repo", "main");
    }
    // stepTemplate
    answers.push(overrides.template ?? "basic.md");
    return answers;
  }

  test("happy path — writes WORKFLOW.md with gitlab_issues config", async () => {
    const { deps, enqueue } = createMockDeps();
    deps.homedir = () => tempDir;
    enqueue(...gitlabHappyPathAnswers());

    await initCommand([tempDir], deps);

    const workflowPath = join(tempDir, "WORKFLOW.md");
    expect(existsSync(workflowPath)).toBe(true);

    const content = readFileSync(workflowPath, "utf-8");
    // Config section should have gitlab_issues data
    expect(content).toContain("kind: gitlab_issues");
    expect(content).toContain("project_id: 42");
    expect(content).toContain("gitlab.example.com");
    expect(content).toContain("active_states");
    expect(content).toContain("terminal_states");
    // Credentials should NOT be in WORKFLOW.md
    expect(content).not.toContain("glpat-test-token");
    expect(content).not.toContain("gitlab_token");
    // Template content
    expect(content).toContain("identifier");

    // settings.json should contain credentials
    const settingsPath = join(tempDir, ".open-symphony", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.tracker.gitlab_issues.gitlab_token).toBe("glpat-test-token");
  });

  test("happy path — with git-clone workspace", async () => {
    const { deps, enqueue } = createMockDeps();
    deps.homedir = () => tempDir;
    enqueue(...gitlabHappyPathAnswers({ sourceType: "git-clone" }));

    await initCommand([tempDir], deps);

    const content = readFileSync(join(tempDir, "WORKFLOW.md"), "utf-8");
    expect(content).toContain("kind: gitlab_issues");
    expect(content).toContain("git@gitlab.example.com:org/repo.git");
  });

  test("cancel at tracker kind selection — no file written", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(CANCEL);

    await initCommand([tempDir], deps);

    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(false);
  });

  test("cancel at gitlab group (token) — no file written", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("gitlab_issues", CANCEL);

    await initCommand([tempDir], deps);

    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(false);
  });

  test("cancel at template step — no file written", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      "https://gitlab.com", "glpat-token", "42",
      true,
      "Todo,In Progress",
      "Done,Cancelled",
      "auto",
      "none",
      CANCEL, // cancel at template
    );

    await initCommand([tempDir], deps);

    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(false);
  });

  test("cancel at workspace step — no file written", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      "https://gitlab.com", "glpat-token", "42",
      true,
      "Todo,In Progress",
      "Done,Cancelled",
      "auto",
      CANCEL, // cancel at workspace
    );

    await initCommand([tempDir], deps);

    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(false);
  });

  test("connection failure during setup — no file written", async () => {
    mockTestConnection.mockImplementation(() => {
      throw new Error("Connection refused");
    });

    const { deps, enqueue } = createMockDeps();
    enqueue(
      "gitlab_issues",
      "https://gitlab.com", "bad-token", "42",
    );

    await initCommand([tempDir], deps);

    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(false);
  });

  test("WORKFLOW.md yaml structure is correct", async () => {
    const { deps, enqueue } = createMockDeps();
    deps.homedir = () => tempDir;
    enqueue(...gitlabHappyPathAnswers({ template: "chinese.md" }));

    await initCommand([tempDir], deps);

    const content = readFileSync(join(tempDir, "WORKFLOW.md"), "utf-8");

    // Verify YAML structure between --- delimiters
    const yamlSection = content.split("---")[1] ?? "";
    expect(yamlSection).toContain("tracker:");
    expect(yamlSection).toContain("agent:");
    expect(yamlSection).toContain("workspace:");
    expect(yamlSection).toContain("polling:");

    // Tracker config details
    expect(yamlSection).toContain("kind: gitlab_issues");
    expect(yamlSection).toContain("project_id: 42");
    expect(yamlSection).toContain("gitlab.example.com");
    expect(yamlSection).toContain("active_states:");
    expect(yamlSection).toContain("terminal_states:");

    // Credentials must not leak
    expect(yamlSection).not.toContain("glpat");
  });

  test("credentials are written under gitlab_issues key in settings.json", async () => {
    const { deps, enqueue } = createMockDeps();
    deps.homedir = () => tempDir;
    enqueue(...gitlabHappyPathAnswers());

    await initCommand([tempDir], deps);

    const settings = JSON.parse(
      readFileSync(join(tempDir, ".open-symphony", "settings.json"), "utf-8"),
    );

    expect(settings.tracker).toBeDefined();
    expect(settings.tracker.gitlab_issues).toBeDefined();
    expect(settings.tracker.gitlab_issues.gitlab_token).toBe("glpat-test-token");
    // No other tracker keys
    expect(Object.keys(settings.tracker)).toEqual(["gitlab_issues"]);
  });
});
