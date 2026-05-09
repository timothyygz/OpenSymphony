import { Liquid } from "liquidjs";
import type { Issue } from "../model/index.ts";
import { TemplateParseError, TemplateRenderError } from "../errors/errors.ts";

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
});

export function renderTemplate(
  template: string,
  issue: Issue,
  attempt: number | null,
): string {
  try {
    engine.parse(template);
  } catch (err) {
    throw new TemplateParseError(String(err));
  }

  try {
    return engine.parseAndRenderSync(template, {
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? "",
        priority: issue.priority ?? "",
        state: issue.state,
        branch_name: issue.branchName ?? "",
        url: issue.url ?? "",
        labels: issue.labels,
        blocked_by: issue.blockedBy,
        created_at: issue.createdAt?.toISOString() ?? "",
        updated_at: issue.updatedAt?.toISOString() ?? "",
      },
      attempt,
    });
  } catch (err) {
    throw new TemplateRenderError(String(err));
  }
}

export function buildContinuationGuidance(
  issue: Issue,
  attempt: number | null,
): string {
  const parts = [
    `Continuing work on ${issue.identifier}: ${issue.title}. Current state: ${issue.state}.`,
  ];
  if (attempt) {
    parts.push(`This is retry attempt #${attempt}. Resume from the current workspace state.`);
  }
  parts.push(
    "If the task is complete, use the 'tracker_tool' tool to write a result summary and update the state to mark it done. Otherwise continue.",
  );
  return parts.join(" ");
}
