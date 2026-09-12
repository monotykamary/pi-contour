import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

export const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export const yieldLoop = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  let next = 0;
  const out = new Array<R>(items.length);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  }));
  return out;
}

/** Byte- and entry-bounded LRU; failed/aborted work is never cached by callers. */
export class Lru<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  constructor(private maxEntries: number, private maxBytes = Infinity) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  snapshot(): Array<[string, T]> { return [...this.entries].map(([key, entry]) => [key, entry.value]); }
  set(key: string, value: T, bytes = 1): void {
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(key); }
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes }); this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const key = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(key)!.bytes; this.entries.delete(key);
    }
  }
}

export function run(command: string, args: string[], cwd: string, options: { input?: string; signal?: AbortSignal; maxBytes?: number; allowFailure?: boolean } = {}): Promise<{ stdout: Buffer; code: number; stderr: string }> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["pipe", "pipe", "pipe"], signal: options.signal });
    const chunks: Buffer[] = [];
    let bytes = 0, stderr = "", failure: Error | undefined;
    const timer = setTimeout(() => { failure = new Error(`${command} exceeded 45s deadline`); child.kill("SIGKILL"); }, 45_000);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 16 * 1024 * 1024)) { failure = new Error(`${command} output limit exceeded`); child.kill("SIGKILL"); }
      else chunks.push(chunk);
    });
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-8192); });
    child.stdin.on("error", () => {});
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (options.signal?.aborted) return reject(options.signal.reason);
      if (code !== 0 && !options.allowFailure) return reject(new Error(`${command} ${args[0] ?? ""}: ${stderr.trim() || `exit ${code}`}`));
      resolve({ stdout: Buffer.concat(chunks), code: code ?? 1, stderr });
    });
    child.stdin.end(options.input);
  });
}
