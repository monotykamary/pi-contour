import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";
import { run, digest } from "../src/core/util.js";
import type { Snapshot } from "../src/core/types.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
export const git = async (root: string, args: string[], input?: string): Promise<string> => (await run("git", args, root, { input })).stdout.toString();
export async function put(root: string, file: string, text: string): Promise<void> { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), text); }
export async function repo(files: Record<string, string> = {}, commit = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "contour-test-")); roots.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Contour tests"]); await git(root, ["config", "user.email", "tests@example.invalid"]);
  await git(root, ["config", "commit.gpgSign", "false"]); await git(root, ["config", "core.hooksPath", ".git/hooks"]);
  for (const [file, text] of Object.entries(files)) await put(root, file, text);
  await git(root, ["add", "."]);
  if (commit) await git(root, ["commit", "--allow-empty", "-m", "test(fixture): initialize repository"]);
  return root;
}
export function snapshot(files: Record<string, string>): Snapshot {
  return { id: digest(JSON.stringify(files)), revision: "test", files: new Map(Object.entries(files).map(([file, text]) => [file, { file, text, hash: digest(text) }])), omissions: [], listed: Object.keys(files).length };
}
export const complex = (name = "parse", decisions = 12): string => `export function ${name}(n: number) {\n${Array.from({ length: decisions }, (_, i) => `  if (n === ${i}) return ${i + 1};`).join("\n")}\n  return -1;\n}\n`;
