import { build } from "esbuild";
import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
// Only this package's generated artifacts are removed, regardless of invoking cwd.
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: { index: "src/index.ts", cli: "src/cli.ts" }, outdir: dist, outExtension: { ".js": ".mjs" },
  bundle: true, splitting: true, format: "esm", platform: "node", target: "node20", sourcemap: false, minify: true,
  preserveSymlinks: true, metafile: true,
  external: ["typebox", "@earendil-works/pi-coding-agent"],
  banner: { js: 'import { createRequire as __contourCreateRequire } from "node:module"; import { fileURLToPath as __contourFileURLToPath } from "node:url"; import { dirname as __contourDirname } from "node:path"; const require = __contourCreateRequire(import.meta.url); const __filename = __contourFileURLToPath(import.meta.url); const __dirname = __contourDirname(__filename);' },
  logLevel: "warning",
});
// Guard the complete static import graph, not just the small entrypoint file.
const outputs = result.metafile.outputs;
const startup = new Set<string>();
function visit(path: string): void {
  if (startup.has(path)) return;
  const output = outputs[path];
  if (!output) throw new Error(`Missing bundle metadata: ${path}`);
  startup.add(path);
  for (const imported of output.imports) if (!imported.external && imported.kind !== "dynamic-import") visit(imported.path);
}
const entry = Object.keys(outputs).find(path => outputs[path]!.entryPoint === "src/index.ts");
if (!entry) throw new Error("Missing extension entrypoint");
visit(entry);
const startupInputs = [...startup].flatMap(path => Object.keys(outputs[path]!.inputs));
if (startupInputs.some(path => path.includes("typescript/") || path.includes("pi-fovea/") || path.endsWith("core/engine.ts"))) {
  throw new Error("Startup must not import the parser, Fovea, or analysis engine");
}
const startupBytes = [...startup].reduce((sum, path) => sum + outputs[path]!.bytes, 0);
if (startupBytes > 32 * 1024) throw new Error(`Extension static bundle exceeded 32KiB: ${startupBytes}`);
await writeFile(join(dist, "startup.json"), JSON.stringify({ staticBytes: startupBytes, staticFiles: [...startup].sort(), analysis: "lazy-import", hostExternal: ["typebox"] }, null, 2) + "\n");
await chmod(join(dist, "cli.mjs"), 0o755);
const fovea = dirname(require.resolve("pi-fovea/substrate"));
const typescript = dirname(require.resolve("typescript/package.json"));
const licenses = "pi-fovea\n" + await readFile(join(fovea, "../LICENSE"), "utf8")
  + "\nTypeScript\n" + await readFile(join(typescript, "LICENSE.txt"), "utf8");
await writeFile(join(dist, "THIRD_PARTY_LICENSES.txt"), licenses.replaceAll("\r\n", "\n").trimEnd() + "\n");
console.log(`Bundled standalone CLI and Pi extension. Static extension: ${startupBytes} bytes; analysis loads on demand.`);
