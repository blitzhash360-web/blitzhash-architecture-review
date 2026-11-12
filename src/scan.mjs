// Read-only project scan: collects files and facts. Never stores .env values.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.nuxt', '.svelte-kit', 'dist', 'build', 'out', '.vercel', '.netlify', '.turbo', 'coverage', '.cache', 'vendor', '.venv', 'venv', '__pycache__', '.output', '.expo', 'ios', 'android', '.idea', '.vscode', 'fixtures', '__fixtures__', '__mocks__']);
const TEXT_EXT = /\.(m?[jt]sx?|cjs|vue|svelte|astro|sql|prisma|py|rb|go|json|toml|ya?ml|md|mdx|html|sh)$/i;
const CODE_EXT = /\.(m?[jt]sx?|cjs|vue|svelte|astro|py|rb|go)$/i;
const MAX_FILES = 6000;
const MAX_BYTES = 400_000;

export const isEnvFile = (p) => /(^|\/)\.env(\.[\w-]+)?$/.test(p) || /(^|\/)env\.(local|example|sample)$/.test(p);
export const isEnvExample = (p) => /(^|\/)\.env\.(example|sample|template|dist|defaults)$/.test(p);

function walk(root, ignore = []) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      const rel = relative(root, abs).split(sep).join('/');
      if (ignore.some((g) => rel === g || rel.startsWith(`${g}/`))) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(abs); continue; }
      if (!e.isFile()) continue;
      if (isEnvFile(rel) || TEXT_EXT.test(e.name) || /^(Dockerfile|Procfile|_headers|_redirects|\.gitignore|\.replit)$/.test(e.name)) files.push(rel);
      if (files.length >= MAX_FILES) break;
    }
  }
  return files.sort();
}

/** Parse an env file for NAMES only. Values are discarded line by line. */
export function envNames(text) {
  const names = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

const ENV_REF = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
  /Deno\.env\.get\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /os\.(?:environ\.get|getenv)\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /os\.environ\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
];
const BUILTIN_ENV = new Set(['NODE_ENV', 'CI', 'PORT', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'DEV', 'PROD', 'MODE', 'SSR', 'BASE_URL', 'HOME', 'PWD', 'TZ', 'NEXT_RUNTIME', 'NO_COLOR', 'FORCE_COLOR']);

export function scanProject(root, opts = {}) {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`not a folder: ${root}`);
  const paths = walk(root, (opts.ignore || []).map((g) => g.replace(/^\.\//, '').replace(/\/+$/, '')));
  const files = [];
  const envFiles = [];
  for (const rel of paths) {
    let text = '';
    try {
      const st = statSync(join(root, rel));
      if (st.size > MAX_BYTES) continue;
      text = readFileSync(join(root, rel), 'utf8');
    } catch { continue; }
    if (isEnvFile(rel)) {
      // Names only. The text is dropped right here, except for example files (placeholders), kept for pooler hints.
      envFiles.push({ path: rel, names: envNames(text), example: isEnvExample(rel), poolerHint: isEnvExample(rel) && /pgbouncer=true|:6543\b|pooler/i.test(text) });
      continue;
    }
    files.push({ path: rel, text, code: CODE_EXT.test(rel) });
  }
  const byPath = new Map(files.map((f) => [f.path, f]));

  // package.json files (root first)
  const pkgs = files.filter((f) => basename(f.path) === 'package.json').map((f) => { try { return { path: f.path, json: JSON.parse(f.text) }; } catch { return null; } }).filter(Boolean)
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const rootPkg = pkgs.find((p) => p.path === 'package.json')?.json || null;
  const deps = new Set();
  for (const p of pkgs) for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) for (const d of Object.keys(p.json[k] || {})) deps.add(d);
  const py = files.filter((f) => /(^|\/)(requirements[\w-]*\.txt|pyproject\.toml)$/.test(f.path)).map((f) => f.text.toLowerCase()).join('\n');

  const envRefs = new Map();
  for (const f of files) {
    if (!f.code) continue;
    for (const re of ENV_REF) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(f.text))) {
        if (BUILTIN_ENV.has(m[1]) || /^(NEXT_PUBLIC_)?VERCEL_/.test(m[1])) continue;
        if (!envRefs.has(m[1])) envRefs.set(m[1], []);
        const where = envRefs.get(m[1]);
        if (!where.includes(f.path)) where.push(f.path);
      }
    }
  }

  let gitTracked = null;
  if (!opts.noGit && existsSync(join(root, '.git'))) {
    try { gitTracked = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 20e6 }).split('\n').filter(Boolean); } catch { gitTracked = null; }
  }

  const has = (p) => byPath.has(p) || paths.includes(p);
  const lockfile = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'].find((l) => existsSync(join(root, l))) || null;

  return {
    root, name: rootPkg?.name || basename(root), description: rootPkg?.description || '',
    files, byPath, paths, has, pkgs, rootPkg, deps, py, envFiles, envRefs, gitTracked, lockfile,
  };
}
