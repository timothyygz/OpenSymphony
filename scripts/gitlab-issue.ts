const env = Bun.env;
const TOKEN = env.GITLAB_TOKEN;
const GITLAB_URL = env.GITLAB_URL || "https://gitlab.sto.cn";

if (!TOKEN) {
  console.error("Error: GITLAB_TOKEN not set in .env");
  process.exit(1);
}

const headers = { "PRIVATE-TOKEN": TOKEN };

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${GITLAB_URL}/api/v4${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

const command = process.argv[2];
const arg = process.argv[3];

async function main() {
  switch (command) {
    case "get-issue": {
      // arg: "project/path" or project_id, issue_iid
      const [project, iid] = arg.split("#");
      const encoded = encodeURIComponent(project);
      const issue: any = await api(`/projects/${encoded}/issues/${iid}`);
      console.log(JSON.stringify(issue, null, 2));
      break;
    }
    case "list-issues": {
      const encoded = encodeURIComponent(arg);
      const issues: any = await api(`/projects/${encoded}/issues?state=opened&per_page=20`);
      console.log(JSON.stringify(issues, null, 2));
      break;
    }
    case "comment": {
      const [project, iid] = arg.split("#");
      const body = process.argv[4];
      if (!body) {
        console.error("Usage: comment <project#iid> <message>");
        process.exit(1);
      }
      const encoded = encodeURIComponent(project);
      const note: any = await api(`/projects/${encoded}/issues/${iid}/notes`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      console.log("Comment added:", note.id);
      break;
    }
    case "close": {
      const [project, iid] = arg.split("#");
      const encoded = encodeURIComponent(project);
      const issue: any = await api(`/projects/${encoded}/issues/${iid}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ state_event: "close" }),
      });
      console.log("Issue closed:", issue.state);
      break;
    }
    default:
      console.log("Usage: gitlab-issue.ts <command> <arg>");
      console.log("Commands:");
      console.log("  get-issue <project/path#iid>");
      console.log("  list-issues <project/path>");
      console.log("  comment <project/path#iid> <message>");
      console.log("  close <project/path#iid>");
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
