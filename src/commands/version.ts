import { registerCommand } from "./index.ts";

async function versionCommand(_args: string[]): Promise<void> {
  // Read version from package.json
  const { readFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const thisDir = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(thisDir, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

  const json = process.env.OPENSYMPHONY_JSON === "1";
  if (json) {
    console.log(JSON.stringify({ version: pkg.version, name: pkg.name }));
  } else {
    console.log(`opensymphony v${pkg.version}`);
  }
}

registerCommand("version", versionCommand);
