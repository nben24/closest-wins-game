import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Server files must not import plain functions/values from "use client"
 * modules: on the server those become client references and calling them
 * crashes the page (this broke /admin/generate once an API key was set).
 */
const SRC = path.join(process.cwd(), "src");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
}

const all = files(SRC);
const isClient = (p: string) => fs.readFileSync(p, "utf8").trimStart().startsWith('"use client"');
const clientFiles = new Set(all.filter(isClient));

function resolve(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = path.join(SRC, spec.slice(2));
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

describe("server/client boundaries", () => {
  it("server files only import components (PascalCase) or types from client modules", () => {
    const problems: string[] = [];
    for (const f of all.filter((p) => !clientFiles.has(p))) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
        if (m[1]) continue;
        const target = resolve(m[3]);
        if (!target || !clientFiles.has(target)) continue;
        const names = m[2].split(",").map((n) => n.trim()).filter((n) => n && !n.startsWith("type "));
        const bad = names.filter((n) => !/^[A-Z][a-z]/.test(n));
        if (bad.length) problems.push(`${path.relative(SRC, f)} imports ${bad.join(", ")} from ${m[3]}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
