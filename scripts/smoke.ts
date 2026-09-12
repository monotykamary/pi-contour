import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { run } from "../src/core/util.js";

const root = await mkdtemp(join(tmpdir(), "contour-smoke-"));
const project = fileURLToPath(new URL("../", import.meta.url));
try {
  const standalone = join(root, "standalone package"), repository = join(root, "repository");
  await mkdir(standalone); await mkdir(repository);
  // No node_modules or source checkout: the CLI must be genuinely self-contained.
  await cp(join(project, "dist"), join(standalone, "dist"), { recursive: true });
  const cli = join(standalone, "dist/cli.mjs"), bin = join(standalone, "contour");
  await symlink(cli, bin);
  assert.match((await run(bin, ["--help"], repository)).stdout.toString(), /contour review/);
  const git = (args: string[], allowFailure = false) => run("git", args, repository, { allowFailure });
  const contour = (args: string[], allowFailure = false) => run(process.execPath, [cli, ...args], repository, { allowFailure });
  await git(["init", "-b", "main"]); await git(["config", "user.name", "Contour smoke"]); await git(["config", "user.email", "smoke@example.invalid"]);
  await git(["config", "core.hooksPath", ".git/hooks"]); await git(["config", "commit.gpgSign", "false"]);
  await writeFile(join(repository, "a.ts"), "export const a = 1;\n"); await git(["add", "."]); await git(["commit", "-m", "test(smoke): initialize repository"]);
  const staged = "export function parse(n:number) {\n" + Array.from({ length: 12 }, (_, i) => `if(n === ${i}) return ${i + 1};`).join("\n") + "\nreturn 0;\n}\n";
  await writeFile(join(repository, "a.ts"), staged); await git(["add", "a.ts"]);
  await writeFile(join(repository, "a.ts"), "// unstaged cleanup must not affect the commit review\n");
  const indexBefore = await readFile(join(repository, ".git/index"));
  const report = JSON.parse((await contour(["review", "--json"])).stdout.toString());
  assert.equal(report.target, "staged"); assert.equal(report.after.decisions, 12); assert.equal(report.blockingFindings, 0);
  assert.deepEqual(await readFile(join(repository, ".git/index")), indexBefore);
  await contour(["hook", "install"]);
  const committed = await git(["commit", "-m", "test(smoke): allow advisory structural findings"]);
  assert.match(committed.stdout.toString() + committed.stderr, /Contour/);
  assert.equal((await git(["show", "HEAD:a.ts"])).stdout.toString(), staged);
  assert.match(await readFile(join(repository, "a.ts"), "utf8"), /unstaged cleanup/);
  await contour(["hook", "uninstall"]);
  await mkdir(join(repository, "core")); await mkdir(join(repository, "ui"));
  await writeFile(join(repository, "core/a.ts"), "export const a = 1;"); await writeFile(join(repository, "ui/b.ts"), "export const b = 1;");
  await git(["add", "core", "ui"]); await git(["commit", "-m", "test(smoke): establish boundary baseline"]);
  const policy = join(root, "policy.json"); await writeFile(policy, JSON.stringify({ boundaries: [{ from: "core", to: "ui", reason: "Core is independent of presentation." }] }));
  await contour(["hook", "install", "--policy", policy]);
  await writeFile(join(repository, "core/a.ts"), "import { b } from '../ui/b'; export const a = b;"); await git(["add", "core/a.ts"]);
  const head = (await git(["rev-parse", "HEAD"])).stdout.toString();
  const blocked = await git(["commit", "-m", "test(smoke): reject explicit boundary violation"], true);
  assert.notEqual(blocked.code, 0); assert.match(blocked.stderr + blocked.stdout.toString(), /Forbidden dependency/);
  assert.equal((await git(["rev-parse", "HEAD"])).stdout.toString(), head);
  await contour(["hook", "uninstall"]);
  // Import the actual built extension from its package (Pi supplies its peer modules).
  const { default: extension } = await import(new URL("../dist/index.mjs", import.meta.url).href);
  const tools: string[] = [], commands: string[] = [];
  extension({ on() {}, registerTool(tool: { name: string }) { tools.push(tool.name); }, registerCommand(name: string) { commands.push(name); } });
  assert.deepEqual(tools, ["contour_review"]); assert.deepEqual(commands, ["contour"]);
  console.log(JSON.stringify({ standaloneCli: true, symlinkedBin: true, stagedIsolation: true, reviewReadOnly: true, advisoryCommit: true, policyCommitBlocked: true, extensionRegistrations: { tools, commands } }));
} finally { await rm(root, { recursive: true, force: true }); }
