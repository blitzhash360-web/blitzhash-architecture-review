// Plain-English Markdown report and a compact terminal summary.
import { dataFlow, serviceName } from './map.mjs';
import { EFFORT_LABEL } from './checks.mjs';
import { redact } from './secrets.mjs';

export const VERSION = '1.0.0';
export const NOT_COVERED = [
  'Whether backups actually exist and restore (only a test restore proves that)',
  'How the live app behaves under real traffic (load testing on staging)',
  'Your real cloud and AI bills, plans and spend caps',
  'Settings that live only in dashboards (Supabase auth settings, storage bucket rules, DNS, Cloudflare/WAF)',
  'Business logic bugs, such as wrong prices or broken edge cases in your own flows',
  'Dependency vulnerabilities (run `npm audit` or enable Dependabot) and git history (old keys)',
];

const sevIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };
const statusIcon = { pass: '✅', warn: '⚠️', fail: '❌' };
const bar = (s, n = 10) => (s == null ? '' : '█'.repeat(Math.round((s / 100) * n)) + '░'.repeat(n - Math.round((s / 100) * n)));

export function summaryLine(r) {
  const before = r.fixes.filter((f) => f.bucket === 'Fix before launch').length;
  return `Overall ${r.score.overall}/100 (${r.score.grade}). ${before ? `${before} thing${before > 1 ? 's' : ''} to fix before launch` : 'Nothing blocking launch found by this scan'}, ${r.good.length} thing${r.good.length === 1 ? '' : 's'} done right.`;
}

function stackRows(map) {
  return Object.entries(map.stack).map(([k, v]) => `| ${k} | ${v.join(', ')} |`);
}

export function toMarkdown(r) {
  const { map, score } = r;
  const flow = dataFlow(map);
  const L = [];
  L.push(`# Architecture review: ${r.name}`, '');
  L.push(`> **${summaryLine(r)}**`, '>', `> A read-only review of the code in this folder, written for founders. Nothing was changed, nothing was sent anywhere, and no secret values are shown.`, '');
  L.push('## Scorecard', '', '| Area | Score | Grade | What we looked at |', '|---|---|---|---|');
  for (const c of score.categories) L.push(`| ${c.label} | ${c.score == null ? 'n/a' : `${c.score}/100`} | ${c.grade} | ${c.covers} |`);
  L.push(`| **Overall** | **${score.overall}/100** | **${score.grade}** | ${score.critical ? `capped below 50 because of ${score.critical} critical issue${score.critical > 1 ? 's' : ''}` : 'weighted: security counts most'} |`, '');

  L.push('## What your app is built with', '');
  const rows = stackRows(map);
  if (rows.length) L.push('| Part | What we found |', '|---|---|', ...rows, '');
  else L.push('We could not recognise the stack from package files. The checks below still ran on the code.', '');
  const nums = [`${r.fileCount} files reviewed`, `${map.pages} page${map.pages === 1 ? '' : 's'}`, `${map.routes.length} API route${map.routes.length === 1 ? '' : 's'}/functions`, `${map.sql.tables.length} database table${map.sql.tables.length === 1 ? '' : 's'} in migrations`];
  L.push(nums.join(' · '), '');

  L.push('## How data moves through your app', '');
  if (flow.lines.length) {
    for (const l of flow.lines) L.push(`- **${l.from} → ${l.to}**: ${l.via}${l.then?.length ? `, then ${l.then.join(', ')}` : ''}${l.warn ? `. ⚠️ ${l.warn}` : ''}`);
    L.push('', '```mermaid', flow.mermaid, '```', '');
  } else L.push('No API routes or direct database calls were found, so there is no data flow to map yet.', '');
  if (map.routes.length) {
    L.push('<details><summary>All API routes and functions</summary>', '', '| Route | File | Talks to |', '|---|---|---|');
    for (const rt of map.routes) L.push(`| \`${rt.path}\` | \`${rt.file}\` | ${rt.services.map((x) => serviceName(map, x)).join(', ') || '-'} |`);
    L.push('', '</details>', '');
  }

  L.push(`## What's right (${r.good.length})`, '');
  L.push(...(r.good.length ? r.good.map((c) => `- ✅ ${c.good}`) : ['- Nothing passed yet. That is normal for a first prototype; start with the fixes below.']), '');

  L.push(`## What's risky (${r.fixes.length})`, '');
  if (!r.fixes.length) L.push('No risks found by this scan. See "What this review can\'t see" below.', '');
  for (const cat of score.categories) {
    const list = r.fixes.filter((f) => f.category === cat.id);
    if (!list.length) continue;
    L.push(`### ${cat.label}`, '');
    for (const f of list) {
      L.push(`#### ${sevIcon[f.severity]} ${f.title} (${f.severity})`, '');
      L.push(`- **What we found:** ${f.found}`, `- **Why it matters:** ${f.why}`, `- **How to fix:** ${f.fix} *(effort: ${EFFORT_LABEL[f.effort]})*`);
      if (f.where.length) L.push(`- **Where:** ${f.where.slice(0, 8).map((w) => `\`${w}\``).join(', ')}${f.where.length > 8 ? ` and ${f.where.length - 8} more` : ''}`);
      L.push(`- **Ask your AI tool:** "${f.ask}"`, '');
    }
  }

  L.push('## Prioritized fixes', '');
  if (!r.fixes.length) L.push('Nothing to do from this scan.', '');
  for (const b of ['Fix before launch', 'Fix this month', 'Nice to have']) {
    const list = r.fixes.filter((f) => f.bucket === b);
    if (!list.length) continue;
    L.push(`**${b}**`, '');
    list.forEach((f) => L.push(`${r.fixes.indexOf(f) + 1}. **${f.title}.** ${f.fix} *(${EFFORT_LABEL[f.effort]})*`));
    L.push('');
  }

  L.push("## What this review can't see", '', 'This is a static review of the code. It does not log in, call your APIs or read your dashboards, so it cannot check:', '', ...NOT_COVERED.map((n) => `- ${n}`), '');
  L.push('## Going to production?', '', 'A senior engineer would also load-test the paths that matter, test a real restore, review dashboard-only settings and right-size your plans before real users and real money arrive. **BlitzHash does this for AI-built apps. [Get a free assessment](https://blitzhash.com).**', '');
  L.push('---', `<sub>Generated by [blitzhash-architecture-review](https://github.com/blitzhash360-web/blitzhash-architecture-review) v${VERSION} on ${r.date}. Read-only static review; checks are heuristics, so confirm each finding before acting on it.</sub>`, '');
  return redact(L.join('\n'));
}

export function toTerminal(r, { color = false } = {}) {
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const B = (s) => c('1', s); const D = (s) => c('2', s);
  const gcol = (g) => ({ A: '32', B: '32', C: '33', D: '33', F: '31' }[g] || '2');
  const scol = { critical: '31', high: '31', medium: '33', low: '2' };
  const { map, score } = r;
  const flow = dataFlow(map);
  const L = [];
  L.push(`${B('BlitzHash Architecture Review')} ${D('·')} ${r.name}`, '');
  const stack = Object.entries(map.stack).filter(([k]) => k !== 'Built with').map(([, v]) => v.join(' + '));
  L.push(B('What it is'));
  L.push(`  ${stack.join(D(' · ')) || 'Stack not recognised from package files'}${map.stack['Built with'] ? D(` (built with ${map.stack['Built with'].join(', ')})`) : ''}`);
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  L.push(D(`  ${pl(r.fileCount, 'file')} · ${pl(map.pages, 'page')} · ${pl(map.routes.length, 'API route')} · ${pl(map.sql.tables.length, 'table')}`), '');
  if (flow.lines.length) {
    L.push(B('How data flows'));
    for (const l of flow.lines.slice(0, 6)) {
      const head = `${l.from} ${c('36', '──▶')} ${l.to}${l.then?.length ? ` ${c('36', '──▶')} ${l.then.join(', ')}` : ''}`;
      L.push(`  ${head}${l.warn ? `  ${c('33', `⚠ ${l.warn}`)}` : ''}`);
      L.push(D(`      ${l.via.length > 90 ? `${l.via.slice(0, 87)}...` : l.via}`));
    }
    L.push('');
  }
  L.push(B('Scorecard'));
  for (const k of score.categories) L.push(`  ${k.label.padEnd(20)} ${k.score == null ? D('n/a'.padStart(7)) : `${String(k.score).padStart(3)}/100`}  ${c(gcol(k.grade), k.grade.padEnd(3))} ${c(gcol(k.grade), bar(k.score))}`);
  L.push(`  ${B('Overall'.padEnd(20))} ${B(`${String(score.overall).padStart(3)}/100`)}  ${c(gcol(score.grade), B(score.grade.padEnd(3)))} ${c(gcol(score.grade), bar(score.overall))}`, '');
  if (r.good.length) {
    L.push(B(`What's right (${r.good.length})`));
    for (const g of r.good.slice(0, 5)) L.push(`  ${c('32', '✓')} ${g.good}`);
    if (r.good.length > 5) L.push(D(`  + ${r.good.length - 5} more in the report`));
    L.push('');
  }
  if (r.fixes.length) {
    L.push(B(`Top fixes (${r.fixes.length} total)`));
    r.fixes.slice(0, r.top).forEach((f, i) => {
      const where = f.where[0] ? D(`  ${f.where[0].split(' (')[0]}`) : '';
      L.push(`  ${String(i + 1).padStart(2)}. ${c(scol[f.severity], f.severity.toUpperCase().padEnd(8))} ${f.title}${where}`);
    });
    if (r.fixes.length > r.top) L.push(D(`      + ${r.fixes.length - r.top} more in the report`));
    L.push('');
  }
  L.push(`${summaryLine(r)}`);
  L.push(D(r.outFile ? `Plain-English report written to ${r.outFile}` : 'Full plain-English report: add --out ARCHITECTURE-REVIEW.md'));
  L.push(D('Read-only. No code or secret values left this machine. Going to production? Free assessment: https://blitzhash.com'));
  return redact(L.join('\n'));
}
