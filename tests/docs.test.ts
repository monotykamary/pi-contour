import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("documented checkpoint and physics notation", () => {
  it("avoids the GitHub-rejected operator-name macro in public Markdown", async () => {
    const directory = new URL("../docs/", import.meta.url);
    const paths = [new URL("../README.md", import.meta.url), ...(await readdir(directory)).filter(file => file.endsWith(".md")).map(file => new URL(file, directory))];
    for (const path of paths) {
      const text = await readFile(path, "utf8");
      // Generic KaTeX parsing alone does not check GitHub's macro restrictions.
      expect(text, path.pathname).not.toContain(String.raw`\operatorname`);
      expect(text.split("\n").filter(line => line.trim() === "$$").length % 2, path.pathname).toBe(0);
    }
  });

  it("retains the mass, erosion, and verbosity equations with upright CC/SLOC labels", async () => {
    const text = await readFile(new URL("../docs/physics.md", import.meta.url), "utf8");
    expect(text).toContain(String.raw`m(f)=\mathrm{CC}(f)\sqrt{\mathrm{SLOC}(f)}`);
    expect(text).toContain(String.raw`E=\frac{\sum_{f:\mathrm{CC}(f)>10}m(f)}{\sum_f m(f)}`);
    expect(text).toContain(String.raw`V=\frac{|A\cup C|}{\mathrm{SLOC}}`);
  });

  it("documents all five markers without advertising automatic sync or a severity score", async () => {
    const text = await readFile(new URL("../README.md", import.meta.url), "utf8");
    for (const marker of ["Δ", "▪", "↗", "?", "⚠"]) expect(text).toContain(`| \`${marker}\` |`);
    expect(text).toContain("not an automatic edit-by-edit sync");
    expect(text).toContain("Modeled diffusion exposure—not severity");
    expect(text).toContain("`contour-review`");
  });
});
