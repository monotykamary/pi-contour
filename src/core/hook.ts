import { mkdir, readFile, writeFile, unlink, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { digest, run } from "./util.js";

const MARKER = "# pi-contour managed pre-commit v1";
const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
async function hookPath(root: string): Promise<string> {
  const { stdout } = await run("git", ["rev-parse", "--git-path", "hooks/pre-commit"], root);
  return resolve(root, stdout.toString().trim());
}
export async function installHook(root: string, cli: string, policy?: string): Promise<string> {
  if (!cli.endsWith(".mjs")) throw new Error("Build first, then install using node dist/cli.mjs hook install");
  const path = await hookPath(root);
  const content = `#!/bin/sh\n${MARKER}\n${quote(process.execPath)} ${quote(cli)} review --staged --checkpoint${policy ? ` --policy ${quote(policy)}` : ""}\ncode=$?\n`
    + (policy ? "exit \"$code\"\n" : 'if [ "$code" -eq 2 ]; then exit 2; fi\nif [ "$code" -ne 0 ]; then printf "%s\\n" "Contour analysis unavailable; advisory hook did not block this commit." >&2; fi\nexit 0\n');
  await mkdir(dirname(path), { recursive: true });
  // Exclusive creation protects existing hooks, including symlinks and concurrent installers.
  const prefix = `#!/bin/sh\n${MARKER}\n`;
  const signed = prefix + `# sha256:${digest(content)}\n` + content.slice(prefix.length);
  try { await writeFile(path, signed, { flag: "wx", mode: 0o755 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Hook already exists at ${path}; integrate Contour manually or explicitly uninstall its managed hook first`);
    throw error;
  }
  return `Installed ${path}${policy ? " (explicit policy enforcement; analysis failures block)" : " (advisory)"}`;
}
export async function uninstallHook(root: string): Promise<string> {
  const path = await hookPath(root);
  if (!(await lstat(path)).isFile()) throw new Error("Refusing to remove a hook not managed by Contour");
  const content = await readFile(path, "utf8"), prefix = `#!/bin/sh\n${MARKER}\n`;
  const tail = content.slice(prefix.length), end = tail.indexOf("\n");
  if (!content.startsWith(prefix) || tail.slice(0, end) !== `# sha256:${digest(prefix + tail.slice(end + 1))}`) throw new Error("Refusing to remove a modified or unmanaged Contour hook");
  await unlink(path); return `Removed ${path}`;
}
