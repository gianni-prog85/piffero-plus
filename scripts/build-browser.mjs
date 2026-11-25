import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const browserOutDir = join(rootDir, "esm", "browser");
const playgroundLibDir = join(rootDir, "docs", "playground", "lib");

const FORBIDDEN_PATTERNS = [
  /\bfrom\s+["'](?:node:)?(?:stream|fs|path|os|util|events|buffer|string_decoder|process)["']/,
  /\brequire\s*\(/,
  /\bBuffer\./,
];

function collectJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (entry.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

const files = collectJsFiles(browserOutDir);
if (files.length === 0) {
  throw new Error(
    `[build-browser] No JS files found in ${browserOutDir}. Run "tsc -p tsconfig.browser.json" first.`
  );
}

for (const file of files) {
  let code = readFileSync(file, "utf8");
  // Ensure relative ESM specifiers include the ".js" extension for native browsers, Deno, and Workers.
  code = code.replace(
    /((?:from|import)\s+["'])(\.\.?\/[^"']+?)(["'])/g,
    (match, prefix, spec, suffix) => {
      if (spec.endsWith(".js") || spec.endsWith(".mjs")) return match;
      return `${prefix}${spec}.js${suffix}`;
    }
  );
  for (const re of FORBIDDEN_PATTERNS) {
    if (re.test(code)) {
      throw new Error(
        `[build-browser] Node.js dependency detected in browser bundle (${file}): ${re}`
      );
    }
  }
  writeFileSync(file, code, "utf8");
}

// Mark esm/browser as native ESM for Node.js subpath resolution.
writeFileSync(
  join(browserOutDir, "package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n",
  "utf8"
);

// Sync the pure browser ESM bundle into docs/playground/lib for standalone GitHub Pages hosting.
rmSync(playgroundLibDir, { recursive: true, force: true });
mkdirSync(playgroundLibDir, { recursive: true });
cpSync(browserOutDir, playgroundLibDir, { recursive: true });
rmSync(join(playgroundLibDir, "package.json"), { force: true });

console.log(
  `[build-browser] ok — ${files.length} pure ESM files emitted (0 Node built-ins) and synced to docs/playground/lib`
);
