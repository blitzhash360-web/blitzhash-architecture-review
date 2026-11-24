import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { review, toJSON } from '../src/review.mjs';
import { toMarkdown, toTerminal } from '../src/report.mjs';
import { toHtml, toSvg } from '../src/diagram.mjs';
import { makeDemoApp, FAKE } from '../src/demo.mjs';
import { findSecrets, redact } from '../src/secrets.mjs';
import { main } from '../src/cli.mjs';

const SOLID = resolve('test/fixtures/solid-app');
const SECTIONS = ['## Scorecard', '## What your app is built with', '## How data moves through your app', "## What's right", "## What's risky", '## Prioritized fixes', "## What this review can't see", '## Going to production?'];
const capture = () => { let s = ''; return { io: { out: (x) => { s += `${x}\n`; }, isTTY: false }, get: () => s }; };
const fakeValues = () => Object.values(FAKE);

function withDemo(fn) {
  const d = makeDemoApp();
  try { return fn(d.dir); } finally { rmSync(d.base, { recursive: true, force: true }); }
}

test('demo app: report has every scorecard section and a low score', () => withDemo((dir) => {
  const r = review(dir, { noGit: true });
  const md = toMarkdown(r);
  for (const s of SECTIONS) assert.ok(md.includes(s), `missing section ${s}`);
  for (const area of ['Security', 'Scaling & speed', 'Cost', 'Backups & recovery', 'Tests & reliability', '**Overall**']) assert.match(md, new RegExp(`\\| ${area.replace(/[*&]/g, (c) => `\\${c}`)} \\|`));
  assert.ok(r.score.overall < 50, `score ${r.score.overall}`);
  assert.equal(r.score.grade, 'F');
  assert.match(md, /```mermaid\nflowchart LR/);
  assert.match(md, /Fix before launch/);
  assert.match(md, /https:\/\/blitzhash\.com/);
}));

test('demo app: every planted issue is found', () => withDemo((dir) => {
  const r = review(dir, { noGit: true });
  const st = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
  const failing = ['hardcoded-secrets', 'public-secret-env', 'admin-key-in-browser', 'env-in-git', 'rls', 'webhook-signature', 'api-auth', 'open-ai-endpoint', 'tests-exist'];
  for (const id of failing) assert.equal(st[id], 'fail', `${id} should fail`);
  for (const id of ['rate-limits', 'headers', 'unbounded-queries', 'queries-in-loops', 'fk-indexes', 'ai-token-cap', 'polling', 'cron-frequency', 'function-size', 'restore-plan', 'env-documented', 'ci', 'monitoring', 'ts-strict', 'input-validation']) assert.equal(st[id], 'warn', `${id} should warn`);
  assert.equal(st['schema-as-code'], 'pass');
  assert.equal(st.lockfile, 'pass');
  const rls = r.checks.find((c) => c.id === 'rls');
  assert.equal(rls.severity, 'critical');
  assert.ok(rls.where.some((w) => w.startsWith('tasks: RLS is off')));
  assert.ok(rls.where.some((w) => w.includes('anyone can do anything')));
  const api = r.checks.find((c) => c.id === 'api-auth');
  assert.deepEqual(api.where.map((w) => w.split(' ')[0]).sort(), ['/api/checkout', '/api/generate', '/api/sync']);
  assert.ok(r.good.some((g) => /\/api\/projects/.test(g.good)), 'partial credit for the route that does check auth');
  assert.deepEqual(r.checks.find((c) => c.id === 'public-secret-env').where, ['NEXT_PUBLIC_STRIPE_SECRET_KEY']);
  assert.ok(r.checks.find((c) => c.id === 'env-documented').where[0].startsWith('SUPABASE_SERVICE_ROLE_KEY'));
}));

test('demo app: maps stack, routes, tables and data flow', () => withDemo((dir) => {
  const r = review(dir, { noGit: true });
  assert.deepEqual(r.map.stack.Frontend, ['Next.js (App Router)']);
  assert.ok(r.map.stack.Database.includes('Supabase (Postgres)'));
  assert.deepEqual(r.map.stack.Payments, ['Stripe']);
  assert.deepEqual(r.map.stack.AI, ['OpenAI']);
  assert.deepEqual(r.map.routes.map((x) => x.path).sort(), ['/api/checkout', '/api/generate', '/api/projects', '/api/sync', '/api/webhooks/stripe']);
  assert.deepEqual(r.map.sql.tables.map((t) => t.name).sort(), ['projects', 'subscriptions', 'tasks', 'usage']);
  assert.equal(r.map.browserToDb.length, 3);
  assert.ok(r.map.routes.find((x) => x.path === '/api/sync').cron);
  const term = toTerminal(r);
  assert.match(term, /Browser ──▶ Supabase \(Postgres\)/);
  assert.match(term, /Stripe ──▶ Your server/);
  assert.match(term, /cron \/api\/sync \(every minute\)/);
}));

test('secret values never appear in any output', () => withDemo((dir) => {
  const r = review(dir, { noGit: true });
  const outputs = [toMarkdown(r), toTerminal(r, { color: true }), JSON.stringify(toJSON(r))];
  for (const o of outputs) for (const v of fakeValues()) assert.ok(!o.includes(v), 'a fake secret value leaked into output');
  for (const o of outputs) assert.equal(findSecrets(o).length, 0);
  // and the scan did see them
  assert.ok(r.checks.find((c) => c.id === 'hardcoded-secrets').where[0].includes('Stripe secret key'));
}));

test('solid app scores high with no blocking issues', () => {
  const r = review(SOLID, { noGit: true });
  const bad = r.checks.filter((c) => c.status !== 'pass').map((c) => c.id);
  assert.deepEqual(bad, []);
  assert.ok(r.score.overall >= 90, `score ${r.score.overall}`);
  assert.equal(r.fixes.length, 0);
  const md = toMarkdown(r);
  for (const s of SECTIONS) assert.ok(md.includes(s));
});

test('Lovable-style Vite SPA: service role key in VITE_ var and browser code', () => {
  const base = mkdtempSync(join(tmpdir(), 'ar-vite-'));
  try {
    const w = (p, t) => { mkdirSync(join(base, p, '..'), { recursive: true }); writeFileSync(join(base, p), t); };
    w('package.json', JSON.stringify({ name: 'lovable-app', dependencies: { react: '18', '@supabase/supabase-js': '2' }, devDependencies: { vite: '5', 'lovable-tagger': '1' } }));
    w('.env', 'VITE_SUPABASE_URL=https://x.supabase.co\nVITE_SUPABASE_SERVICE_ROLE_KEY=not-a-real-value\n');
    w('src/integrations/supabase/client.ts', "import { createClient } from '@supabase/supabase-js';\nexport const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY);\n");
    w('src/pages/Index.tsx', "import { supabase } from '@/integrations/supabase/client';\nexport default function Index() { supabase.from('leads').select('*'); return null; }\n");
    const r = review(base, { noGit: true });
    const st = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    assert.equal(st['public-secret-env'], 'fail');
    assert.equal(st['admin-key-in-browser'], 'fail');
    assert.equal(st.rls, 'warn'); // Supabase without migrations in the repo
    assert.equal(st['schema-as-code'], 'fail');
    assert.deepEqual(r.map.stack['Built with'], ['Lovable']);
    assert.deepEqual(r.map.stack.Frontend, ['React + Vite']);
    assert.ok(!toMarkdown(r).includes('not-a-real-value'));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('secret helpers find kinds and redact values', () => {
  const k = ['sk', 'live', 'abcdefghijklmnop1234'].join('_');
  assert.deepEqual(findSecrets(`const a = "${k}";`).map((h) => h.kind), ['Stripe secret key']);
  assert.ok(!redact(`x ${k} y`).includes(k));
  assert.equal(findSecrets('postgres://user:[YOUR-PASSWORD]@db.example.com/postgres').length, 0);
  assert.equal(findSecrets(['postgres://user', 'hunter2real@db.example.com/postgres'].join(':')).length, 1);
  assert.equal(findSecrets(FAKE.__FAKE_ANON_JWT__).length, 0, 'anon JWT is public by design');
  assert.equal(findSecrets(FAKE.__FAKE_SERVICE_JWT__).length, 1);
});

test('CLI: demo, --json, --md, --out, --fail-under, --help', async () => {
  let c = capture();
  assert.equal(await main(['demo'], c.io), 0);
  assert.match(c.get(), /Scorecard/);
  assert.doesNotMatch(c.get(), /\x1b\[/);
  c = capture();
  assert.equal(await main(['demo', '--json'], c.io), 0);
  const j = JSON.parse(c.get());
  assert.equal(j.score.grade, 'F');
  assert.ok(j.checks.length >= 20);
  c = capture();
  assert.equal(await main([SOLID, '--md', '--no-git'], c.io), 0);
  assert.match(c.get(), /^# Architecture review: solid-saas/);
  const d = mkdtempSync(join(tmpdir(), 'ar-out-'));
  try {
    const f = join(d, 'REVIEW.md');
    c = capture();
    assert.equal(await main(['demo', '--out', f], c.io), 0);
    assert.match(readFileSync(f, 'utf8'), /## Prioritized fixes/);
    assert.match(c.get(), /report written to/);
  } finally { rmSync(d, { recursive: true, force: true }); }
  c = capture();
  assert.equal(await main(['demo', '--fail-under', '60'], c.io), 1);
  assert.equal(await main([SOLID, '--fail-under', '90', '--no-git'], capture().io), 0);
  c = capture();
  assert.equal(await main(['--help'], c.io), 0);
  assert.match(c.get(), /Read-only/);
  await assert.rejects(() => main(['--bogus'], capture().io), /unknown option/);
});

test('CLI: install-skill is a dry run until --write and keeps existing AGENTS.md', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ar-skill-'));
  try {
    writeFileSync(join(d, 'AGENTS.md'), '# My rules\nBe nice.\n');
    let c = capture();
    assert.equal(await main(['install-skill', '--target', 'all', d], c.io), 0);
    assert.match(c.get(), /Dry run: nothing was written/);
    assert.ok(!existsSync(join(d, '.claude')));
    c = capture();
    assert.equal(await main(['install-skill', '--target', 'all', d, '--write'], c.io), 0);
    assert.match(readFileSync(join(d, '.claude/skills/architecture-review/SKILL.md'), 'utf8'), /^---\nname: architecture-review/);
    assert.match(readFileSync(join(d, '.cursor/rules/architecture-review.mdc'), 'utf8'), /alwaysApply: false/);
    assert.ok(existsSync(join(d, '.agents/skills/architecture-review/SKILL.md')));
    const agents = readFileSync(join(d, 'AGENTS.md'), 'utf8');
    assert.match(agents, /^# My rules\nBe nice\./);
    assert.match(agents, /arch-review:start/);
    await main(['install-skill', '--target', 'agents', d, '--write'], capture().io);
    assert.equal(readFileSync(join(d, 'AGENTS.md'), 'utf8').match(/arch-review:start/g).length, 1, 'idempotent');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('bin runs end to end and the scan never writes into the project', () => {
  const before = spawnSync('git', ['status', '--porcelain', SOLID], { encoding: 'utf8' }).stdout;
  const r = spawnSync(process.execPath, ['bin/arch-review.mjs', SOLID, '--no-git'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Overall\s+\d+\/100/);
  assert.equal(spawnSync('git', ['status', '--porcelain', SOLID], { encoding: 'utf8' }).stdout, before);
  const bad = spawnSync(process.execPath, ['bin/arch-review.mjs', '/definitely/not/here'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /not a folder/);
  const empty = mkdtempSync(join(tmpdir(), 'ar-empty-'));
  const e = spawnSync(process.execPath, ['bin/arch-review.mjs', empty], { encoding: 'utf8' });
  rmSync(empty, { recursive: true, force: true });
  assert.equal(e.status, 2);
  assert.match(e.stderr, /no source code found/);
});

test('skill file has frontmatter and the safety rules', () => {
  const s = readFileSync('skills/architecture-review/SKILL.md', 'utf8');
  assert.match(s, /^---\nname: architecture-review\ndescription: .{50,}\n---\n/);
  assert.match(s, /Never print, paste or repeat a secret value/);
  assert.match(s, /Read-only/);
});

test('no key-shaped strings are committed anywhere in this repo', async () => {
  const { scanProject } = await import('../src/scan.mjs');
  const s = scanProject(resolve('.'), { noGit: true });
  const hits = s.files.flatMap((f) => findSecrets(f.text).map((h) => `${f.path}:${h.line} ${h.kind}`));
  assert.deepEqual(hits, []);
  assert.equal(s.envFiles.filter((e) => !e.example).length, 0, 'no .env files in the repo');
});

test('demo app: HTML + SVG diagram labels the trust boundary and writes next to --out', async () => {
  const r = withDemo((dir) => review(dir, { noGit: true }));
  const html = toHtml(r);
  assert.match(html, /<svg /);
  assert.match(html, /trust boundary/i);
  assert.match(html, /keep secrets here/i);
  assert.match(html, /blitzhash-architecture-review/);
  assert.doesNotMatch(html, /sk_live_|sk_test_|service_role|BEGIN [A-Z ]*PRIVATE KEY/);
  const svg = toSvg(r.map, { name: r.name });
  assert.match(svg, /<svg /);
  assert.match(svg, /In the browser/);

  const dir = mkdtempSync(join(tmpdir(), 'arch-diagram-'));
  const mdPath = join(dir, 'report.md');
  const { io, get } = capture();
  const demoCode = await main(['demo', '--out', mdPath], io);
  assert.equal(demoCode, 0);
  assert.ok(existsSync(mdPath));
  const htmlPath = join(dir, 'report.html');
  assert.ok(existsSync(htmlPath), get());
  const written = readFileSync(htmlPath, 'utf8');
  assert.match(written, /<svg /);
  assert.match(written, /trust boundary/i);
  rmSync(dir, { recursive: true, force: true });
});
