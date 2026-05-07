import { describe, it, expect } from "bun:test";
import { STANDARD_FIELDS } from "../../src/adapters/tracker/feishu-bitable/setup-api.ts";

describe("STANDARD_FIELDS", () => {
  const labelsField = STANDARD_FIELDS.find((f) => f.field_name === "标签");

  it("defines a 标签 field of type 4 (multi_select)", () => {
    expect(labelsField).toBeDefined();
    expect(labelsField!.type).toBe(4);
  });

  it("includes bug and feature as label options", () => {
    const options = (labelsField!.property?.options as Array<{ name: string }>) ?? [];
    const names = options.map((o) => o.name);
    expect(names).toContain("bug");
    expect(names).toContain("feature");
  });

  it("includes common development labels", () => {
    const options = (labelsField!.property?.options as Array<{ name: string }>) ?? [];
    const names = options.map((o) => o.name);
    const expectedLabels = [
      "bug",
      "feature",
      "enhancement",
      "documentation",
      "refactor",
      "test",
      "performance",
      "security",
      "hotfix",
      "tech-debt",
    ];
    expect(names).toEqual(expectedLabels);
  });

  it("has non-empty options array", () => {
    const options = labelsField!.property?.options;
    expect(Array.isArray(options)).toBe(true);
    expect(options!.length).toBeGreaterThan(0);
  });
});
