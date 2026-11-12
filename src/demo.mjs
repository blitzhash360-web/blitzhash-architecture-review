// Copies the bundled fake demo app into a temp folder and fills in obviously fake keys,
// so the review has real-looking problems to find. Nothing here is a real credential.
import { mkdtempSync, cpSync, renameSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'demo-app');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', ref: 'demo-fake-project', role, iat: 1700000000, exp: 2000000000 })}.DEMOfakeSignatureNotReal0000`;

// Built at runtime so no key-shaped string is ever committed to the repo.
export const FAKE = {
  __FAKE_STRIPE_KEY__: ['sk', 'live', '51DEMOonlyFAKEkeyNOTreal000000'].join('_'),
  __FAKE_SERVICE_JWT__: jwt('service_role'),
  __FAKE_ANON_JWT__: jwt('anon'),
  __FAKE_OPENAI_KEY__: ['sk', 'proj', 'DEMOonlyFAKEkeyNOTreal0000000000000000'].join('-'),
};

function fill(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { fill(p); continue; }
    let t = readFileSync(p, 'utf8');
    const before = t;
    for (const [k, v] of Object.entries(FAKE)) t = t.split(k).join(v);
    if (t !== before) writeFileSync(p, t);
  }
}

/** Returns the path of a fresh copy of the demo app in a temp folder. */
export function makeDemoApp() {
  const base = mkdtempSync(join(tmpdir(), 'arch-review-demo-'));
  const dir = join(base, 'taskpilot-demo');
  cpSync(DEMO_SRC, dir, { recursive: true });
  renameSync(join(dir, 'env.demo'), join(dir, '.env'));
  renameSync(join(dir, 'env.example.demo'), join(dir, '.env.example'));
  renameSync(join(dir, 'gitignore.demo'), join(dir, '.gitignore'));
  fill(dir);
  return { base, dir };
}
