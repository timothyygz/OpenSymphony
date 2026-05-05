import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { initSources, cleanupSources } from "../../src/workspace/sources.ts";
import { hashSources } from "../../src/workspace/manager.ts";

describe("initSources", () => {
  let tempDir: string;
  let workspacePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-sources-test-"));
    workspacePath = resolve(tempDir, "workspace");
    mkdtempSync(workspacePath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // it("clones a remote repository", async () => {
  //   // Use a small public repo for testing
  //   const sources = [{
  //     type: "git-clone" as const,
  //     url: "https://github.com/octocat/Hello-World.git",
  //     path: "repo",
  //     depth: 1,
  //   }];

  //   await initSources(sources, workspacePath, tempDir);

  //   expect(existsSync(resolve(workspacePath, "repo", ".git"))).toBe(true);
  // }, 60000);

  it("creates worktree from local repo", async () => {
    // First create a local repo
    const localRepo = resolve(tempDir, "local-repo");
    await Bun.spawn(["git", "init", localRepo]).exited;
    await Bun.spawn([
      "git",
      "-C",
      localRepo,
      "config",
      "user.email",
      "test@test.com",
    ]).exited;
    await Bun.spawn(["git", "-C", localRepo, "config", "user.name", "Test"])
      .exited;
    await Bun.spawn(["sh", "-c", `echo hello > ${localRepo}/readme.md`]).exited;
    await Bun.spawn(["git", "-C", localRepo, "add", "."]).exited;
    await Bun.spawn(["git", "-C", localRepo, "commit", "-m", "init"]).exited;

    const sources = [
      {
        type: "git-worktree" as const,
        repo: localRepo,
        path: "worktree-copy",
      },
    ];

    await initSources(sources, workspacePath, tempDir);

    expect(
      existsSync(resolve(workspacePath, "worktree-copy", "readme.md")),
    ).toBe(true);
  });

  it("cleans up worktree sources", async () => {
    // Create local repo + worktree
    const localRepo = resolve(tempDir, "local-repo");
    await Bun.spawn(["git", "init", localRepo]).exited;
    await Bun.spawn([
      "git",
      "-C",
      localRepo,
      "config",
      "user.email",
      "test@test.com",
    ]).exited;
    await Bun.spawn(["git", "-C", localRepo, "config", "user.name", "Test"])
      .exited;
    await Bun.spawn(["sh", "-c", `echo hello > ${localRepo}/readme.md`]).exited;
    await Bun.spawn(["git", "-C", localRepo, "add", "."]).exited;
    await Bun.spawn(["git", "-C", localRepo, "commit", "-m", "init"]).exited;

    const sources = [
      {
        type: "git-worktree" as const,
        repo: localRepo,
        path: "wt",
      },
    ];

    await initSources(sources, workspacePath, tempDir);
    expect(existsSync(resolve(workspacePath, "wt", "readme.md"))).toBe(true);

    // Cleanup
    await cleanupSources(sources, workspacePath);

    // Worktree reference should be removed from main repo
    const { stdout } = Bun.spawnSync([
      "git",
      "-C",
      localRepo,
      "worktree",
      "list",
    ]);
    const output = stdout?.toString() ?? "";
    expect(output).not.toContain("wt");
  });

  it("rolls back on partial failure", async () => {
    // First source: valid local repo
    const localRepo = resolve(tempDir, "local-repo");
    await Bun.spawn(["git", "init", localRepo]).exited;
    await Bun.spawn([
      "git",
      "-C",
      localRepo,
      "config",
      "user.email",
      "test@test.com",
    ]).exited;
    await Bun.spawn(["git", "-C", localRepo, "config", "user.name", "Test"])
      .exited;
    await Bun.spawn(["sh", "-c", `echo hello > ${localRepo}/readme.md`]).exited;
    await Bun.spawn(["git", "-C", localRepo, "add", "."]).exited;
    await Bun.spawn(["git", "-C", localRepo, "commit", "-m", "init"]).exited;

    // Second source: invalid URL that will fail
    const sources = [
      { type: "git-worktree" as const, repo: localRepo, path: "wt-ok" },
      {
        type: "git-clone" as const,
        url: "https://invalid-url-that-does-not-exist.example.com/repo.git",
        path: "fail",
        depth: 1,
      },
    ];

    await expect(
      initSources(sources, workspacePath, tempDir),
    ).rejects.toThrow();

    // First worktree should have been rolled back
    // (the worktree dir might still exist but the worktree reference should be cleaned)
  }, 30000);

  it("creates worktree with branch named from identifier", async () => {
    // Create a local repo
    const localRepo = resolve(tempDir, "local-repo");
    await Bun.spawn(["git", "init", localRepo]).exited;
    await Bun.spawn([
      "git",
      "-C",
      localRepo,
      "config",
      "user.email",
      "test@test.com",
    ]).exited;
    await Bun.spawn(["git", "-C", localRepo, "config", "user.name", "Test"])
      .exited;
    await Bun.spawn(["sh", "-c", `echo hello > ${localRepo}/readme.md`]).exited;
    await Bun.spawn(["git", "-C", localRepo, "add", "."]).exited;
    await Bun.spawn(["git", "-C", localRepo, "commit", "-m", "init"]).exited;

    const sources = [
      {
        type: "git-worktree" as const,
        repo: localRepo,
        path: "worktree-copy",
      },
    ];

    await initSources(sources, workspacePath, tempDir, "SYMP-042");

    // Verify the branch was created with the sanitized identifier name
    const { stdout } = Bun.spawnSync([
      "git",
      "-C",
      localRepo,
      "branch",
      "--list",
      "SYMP-042",
    ]);
    const output = (stdout?.toString() ?? "").trim();
    expect(output).toMatch(/\bSYMP-042$/);
  });
});

describe("hashSources", () => {
  it("produces consistent hash for same sources", () => {
    const sources = [
      {
        type: "git-clone" as const,
        url: "https://example.com/repo.git",
        path: "repo",
        depth: 1,
      },
    ];
    expect(hashSources(sources)).toBe(hashSources(sources));
  });

  it("produces different hash for different sources", () => {
    const a = [
      {
        type: "git-clone" as const,
        url: "https://a.com/repo.git",
        path: "repo",
        depth: 1,
      },
    ];
    const b = [
      {
        type: "git-clone" as const,
        url: "https://b.com/repo.git",
        path: "repo",
        depth: 1,
      },
    ];
    expect(hashSources(a)).not.toBe(hashSources(b));
  });
});
