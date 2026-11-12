import { basename } from 'node:path';
import { scanProject } from './scan.mjs';
import { buildMap } from './map.mjs';
import { runChecks, score, priorities } from './checks.mjs';

/** Run the full review of a folder. Read-only. */
export function review(dir, opts = {}) {
  const scan = scanProject(dir, opts);
  if (!scan.files.some((f) => f.code)) throw new Error(`no source code found in ${dir}. Run it from your project's root folder (where package.json is).`);
  const map = buildMap(scan);
  const checks = runChecks(scan, map);
  const sc = score(checks);
  const fixes = priorities(checks);
  return {
    name: opts.name || scan.name || basename(dir),
    date: opts.date || new Date().toLocaleDateString('en-CA'),
    fileCount: scan.files.length,
    map, checks, score: sc, fixes, good: [...checks.filter((c) => c.status === 'pass'), ...checks.filter((c) => c.status !== 'pass' && c.alsoGood).map((c) => ({ ...c, good: c.alsoGood }))],
    top: opts.top || 6,
  };
}

/** JSON-safe view (no file contents). */
export function toJSON(r) {
  return {
    name: r.name, date: r.date, files: r.fileCount,
    stack: r.map.stack,
    counts: { pages: r.map.pages, routes: r.map.routes.length, tables: r.map.sql.tables.length },
    routes: r.map.routes.map(({ path, file, services, webhook, cron }) => ({ path, file, services, webhook, cron })),
    tables: r.map.sql.tables.map((t) => ({ name: t.name, rls: t.rls, policies: t.policies.length })),
    score: { overall: r.score.overall, grade: r.score.grade, categories: Object.fromEntries(r.score.categories.map((c) => [c.id, { score: c.score, grade: c.grade }])) },
    checks: r.checks.map(({ category, id, title, status, severity, effort, found, why, fix, ask, where, good }) => ({ category, id, title, status, severity, effort, found, why, fix, ask, where, good })),
  };
}
