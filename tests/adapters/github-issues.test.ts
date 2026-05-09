import { test, describe, expect, mock, beforeEach, afterEach } from "bun:test";
import { createMockPrompts, CANCEL } from "../__mocks__/clack-prompts.ts";
import { stepTracker } from "../../src/setup/steps.ts";
import { initCommand } from "../../src/setup/wizard.ts";
import type { InitDeps, SetupApi } from "../../src/setup/types.ts";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- Mock GitHubApi via module mocking ---

const mockTestConnection = mock(() => Promise.resolve({ name: "Test Repo" }));
const mockCreateLabel = mock(() => Promise.resolve());

mock.module("../../src/adapters/tracker/github-issues/api.ts", () => {
  return {
    GitHubApi: class {
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
      url: "https://github.com/test",
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

// --- stepTracker with github_issues ---

describe("stepTracker — github_issues", () => {
  beforeEach(() => {
    mockTestConnection.mockImplementation(() => Promise.resolve({ name: "Test Repo" }));
    mockCreateLabel.mockImplementation(() => Promise.resolve());
    mockTestConnection.mockClear();
    mockCreateLabel.mockClear();
  });

  test("happy path: connection ok, create labels, default states", async () => {
    const { deps, enqueue } = createMockDeps();
    // tracker kind, group(host, token, owner, repo), createLabels=true, activeStates, terminalStates
    enqueue(
      "github_issues",
      // group answers
      "https://github.com", "ghp_test-token", "my-org", "my-repo",
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
      kind: "github_issues",
      github_host: "https://github.com",
      owner: "my-org",
      repo: "my-repo",
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done", "Cancelled"],
    });
    expect(result!.credentials).toEqual({ github_token: "ghp_test-token" });
  });

  test("uses default host when empty", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "github_issues",
      // group: host empty → defaults to https://github.com
      "", "ghp-token", "my-org", "my-repo",
      true,
      "Todo,In Progress",
      "Done,Cancelled",
    );

    const result = await stepTracker(deps);

    expect(result).not.toBeNull();
    expect(result!.config.github_host).toBe("https://github.com");
  });

  test("declines label creation", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "github_issues",
      "https://github.com", "ghp-token", "org", "repo",
      // decline label creation
      false,
      "Todo,In Progress",
      "Done,Cancelled",
    );

    const result = await stepTracker(deps);

    expect(result).not.toBeNull();
    expect(result!.config.kind).toBe("github_issues");
    // Labels should not be created
    expect(mockCreateLabel).not.toHaveBeenCalled();
  });

  test("custom active/terminal states", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "github_issues",
      "https://github.com", "ghp-token", "org", "repo",
      true,
      "Backlog,Doing,Review",
      "Closed,Rejected",
    );

    const result = await stepTracker(deps);

    expect(result).not.toBeNull();
    expect(result!.config.active_states).toEqual(["Backlog", "Doing", "Review"]);
    expect(result!.config.terminal_states).toEqual(["Closed", "Rejected"]);
  });

  test("returns null on cancel at group (host/token/owner/repo)", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue("github_issues", CANCEL);

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null when token is empty", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "github_issues",
      "https://github.com", "", "org", "repo",
    );

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null when owner is empty", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "github_issues",
      "https://github.com", "ghp-token", "", "repo",
    );

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null when repo is empty", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "github_issues",
      "https://github.com", "ghp-token", "org", "",
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
      "github_issues",
      "https://github.com", "bad-token", "org", "repo",
    );

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null on cancel at activeStates", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "github_issues",
      "https://github.com", "ghp-token", "org", "repo",
      true,
      CANCEL,
    );

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });

  test("returns null on cancel at terminalStates", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "github_issues",
      "https://github.com", "ghp-token", "org", "repo",
      true,
      "Todo,In Progress",
      CANCEL,
    );

    const result = await stepTracker(deps);
    expect(result).toBeNull();
  });
});

// --- initCommand full flow with github_issues ---

describe("initCommand full flow — github_issues", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-github-"));
    mockTestConnection.mockImplementation(() => Promise.resolve({ name: "Test Repo" }));
    mockCreateLabel.mockImplementation(() => Promise.resolve());
    mockTestConnection.mockClear();
    mockCreateLabel.mockClear();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function githubHappyPathAnswers(overrides: Partial<{
    template: string;
  }> = {}): unknown[] {
    const answers: unknown[] = [
      // stepTracker
      "github_issues",
      "https://github.com", "ghp-test-token", "org", "repo",
      true,
      "Todo,In Progress",
      "Done,Cancelled",
      // stepTemplate
      overrides.template ?? "basic.md",
    ];
    return answers;
  }

  test("happy path — writes WORKFLOW.md with github_issues config", async () => {
    const { deps, enqueue } = createMockDeps();
    deps.homedir = () => tempDir;
    enqueue(...githubHappyPathAnswers());

    await initCommand([tempDir], deps);

    const workflowPath = join(tempDir, "WORKFLOW.md");
    expect(existsSync(workflowPath)).toBe(true);

    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("kind: github_issues");
    expect(content).toContain("owner: org");
    expect(content).toContain("repo: repo");
    expect(content).toContain("active_states");
    expect(content).toContain("terminal_states");
    // Credentials should NOT be in WORKFLOW.md
    expect(content).not.toContain("ghp-test-token");
    expect(content).not.toContain("github_token");

    // settings.json should contain credentials
    const settingsPath = join(tempDir, ".open-symphony", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.tracker.github_issues.github_token).toBe("ghp-test-token");
  });

  test("cancel at tracker kind selection — no file written", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(CANCEL);

    await initCommand([tempDir], deps);

    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(false);
  });

  test("cancel at agent step — no file written", async () => {
    const { deps, enqueue } = createMockDeps();
    enqueue(
      "github_issues",
      "https://github.com", "ghp-token", "org", "repo",
      true,
      "Todo,In Progress",
      "Done,Cancelled",
      CANCEL, // cancel at agent
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
      "github_issues",
      "https://github.com", "bad-token", "org", "repo",
    );

    await initCommand([tempDir], deps);

    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(false);
  });

  test("credentials are written under github_issues key in settings.json", async () => {
    const { deps, enqueue } = createMockDeps();
    deps.homedir = () => tempDir;
    enqueue(...githubHappyPathAnswers());

    await initCommand([tempDir], deps);

    const settings = JSON.parse(
      readFileSync(join(tempDir, ".open-symphony", "settings.json"), "utf-8"),
    );

    expect(settings.tracker).toBeDefined();
    expect(settings.tracker.github_issues).toBeDefined();
    expect(settings.tracker.github_issues.github_token).toBe("ghp-test-token");
  });
});
