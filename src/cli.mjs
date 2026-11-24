import { resolve, join, dirname } from 'node:path';
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { review, toJSON } from './review.mjs';
import { toMarkdown, toTerminal, VERSION } from './report.mjs';
import { toHtml } from './diagram.mjs';
import { makeDemoApp } from './demo.mjs';
import { containsSecret } from './secrets.mjs';

const HELP = `arch-review v${VERSION}: plain-English architecture review of an AI-built app (BlitzHash)

Usage
  arch-review [dir]                      scorecard + top fixes in the terminal
  arch-review [dir] --out <file.md>      also write the full plain-English report
  arch-review [dir] --diagram <file.html> also write a founder-friendly HTML + SVG picture
  arch-review [dir] --md                 print the full report as Markdown
  arch-review [dir] --json               machine-readable result
  arch-review demo [--out <file.md>]     review a built-in fake Next.js + Supabase + Stripe app
  arch-review install-skill --target <claude|cursor|agents|all> [dir] [--write]

Options
  --fail-under <N>   exit 1 if the overall score is below N (for CI)
  --top <N>          how many fixes to list in the terminal (default 6)
  --ignore <a,b>     skip these folders (relative paths, comma-separated)
  --no-git           don't call git (skips the "is .env committed?" check)
  --no-color         plain output (NO_COLOR / FORCE_COLOR are respected)
  --diagram <file>   write a self-contained HTML + SVG architecture picture
                     (also written automatically next to --out, as .html)

Read-only: it reads files, never changes your code, never uses the network,
and never prints secret values (only what kind of key was found and where).`;

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'architecture-review');

function opt(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`);
  args.splice(i, 2);
  return v;
}

export function installSkill(target, dir, write, out) {
  const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const body = skill.replace(/^---[\s\S]*?---\n/, '');
  const desc = /description:\s*(.+)/.exec(skill)[1].trim();
  const plan = [];
  const targets = target === 'all' ? ['claude', 'cursor', 'agents'] : target.split(',');
  for (const t of targets) {
    if (t === 'claude') plan.push({ file: '.claude/skills/architecture-review/SKILL.md', content: skill });
    else if (t === 'cursor') plan.push({ file: '.cursor/rules/architecture-review.mdc', content: `---\ndescription: ${desc}\nalwaysApply: false\n---\n${body}` });
    else if (t === 'agents') {
      plan.push({ file: '.agents/skills/architecture-review/SKILL.md', content: skill });
      const p = join(dir, 'AGENTS.md');
      const block = '<!-- arch-review:start -->\n## Architecture review\nWhen asked to review the architecture, check launch readiness, or "is my app ready for real users", follow `.agents/skills/architecture-review/SKILL.md`. It is read-only and never prints secret values.\n<!-- arch-review:end -->\n';
      const cur = existsSync(p) ? readFileSync(p, 'utf8') : '';
      const next = /<!-- arch-review:start -->[\s\S]*?<!-- arch-review:end -->\n?/.test(cur) ? cur.replace(/<!-- arch-review:start -->[\s\S]*?<!-- arch-review:end -->\n?/, block) : `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${cur ? '\n' : ''}${block}`;
      plan.push({ file: 'AGENTS.md', content: next, note: cur ? 'adds/updates a marked block, keeps the rest' : 'new file' });
    } else throw new Error(`unknown target "${t}" (use claude, cursor, agents or all)`);
  }
  for (const p of plan) {
    const abs = join(dir, p.file);
    const status = existsSync(abs) ? (readFileSync(abs, 'utf8') === p.content ? 'unchanged' : 'update') : 'create';
    out(`  ${write ? (status === 'unchanged' ? 'unchanged' : 'wrote    ') : status.padEnd(9)} ${p.file}${p.note ? `  (${p.note})` : ''}`);
    if (write && status !== 'unchanged') { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, p.content); }
  }
  out(write ? '\nDone. Ask your agent: "Review the architecture of this app."' : '\nDry run: nothing was written. Add --write to install.');
  return 0;
}

export async function main(argv, io = {}) {
  const out = io.out || ((s) => process.stdout.write(`${s}\n`));
  const isTTY = io.isTTY ?? process.stdout.isTTY;
  const args = [...argv];
  if (args.includes('-h') || args.includes('--help')) { out(HELP); return 0; }
  if (args.includes('-v') || args.includes('--version')) { out(VERSION); return 0; }
  const fc = process.env.FORCE_COLOR;
  const color = !args.includes('--no-color') && (fc !== undefined && fc !== '' ? fc !== '0' && fc !== 'false' : !process.env.NO_COLOR && !!isTTY);
  const outFile = opt(args, '--out');
  const diagramFile = opt(args, '--diagram');
  const failUnder = opt(args, '--fail-under');
  const top = opt(args, '--top');
  const target = opt(args, '--target');
  const ignore = opt(args, '--ignore');
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const pos = args.filter((a) => !a.startsWith('--'));
  for (const f of flags) if (!['--md', '--json', '--no-git', '--no-color', '--write'].includes(f)) throw new Error(`unknown option ${f}`);

  if (pos[0] === 'install-skill') {
    if (!target) throw new Error('install-skill needs --target claude|cursor|agents|all');
    return installSkill(target, resolve(pos[1] || '.'), flags.has('--write'), out);
  }
  let dir; let cleanup = null; let name;
  if (pos[0] === 'demo') { const d = makeDemoApp(); dir = d.dir; cleanup = d.base; name = 'taskpilot-demo (fake demo app)'; }
  else dir = resolve(pos[0] || '.');
  try {
    const r = review(dir, { ignore: ignore ? ignore.split(',').map((x) => x.trim()).filter(Boolean) : [], noGit: flags.has('--no-git') || !!cleanup, name, top: top ? Number(top) : undefined });
    const md = toMarkdown(r);
    if (containsSecret(md)) throw new Error('refusing to write: report output matched a secret pattern');
    if (outFile) { const p = resolve(outFile); writeFileSync(p, md); r.outFile = outFile; }
    let writtenHtml = null;
    if (diagramFile || outFile) {
      const dest = diagramFile
        ? resolve(diagramFile)
        : resolve(outFile.endsWith('.md') ? outFile.slice(0, -3) + '.html' : `${outFile}.html`);
      const html = toHtml(r);
      writeFileSync(dest, html);
      writtenHtml = dest;
      r.diagramFile = dest;
    }
    if (writtenHtml && !flags.has('--json') && !flags.has('--md')) out(`Architecture picture written to ${writtenHtml}`);
    if (flags.has('--json')) out(JSON.stringify(toJSON(r), null, 2));
    else if (flags.has('--md')) out(md);
    else out(toTerminal(r, { color }));
    if (failUnder != null) {
      const n = Number(failUnder);
      if (Number.isNaN(n)) throw new Error('--fail-under needs a number');
      if (r.score.overall < n) { if (!flags.has('--json')) out(`\nScore ${r.score.overall} is below --fail-under ${n}.`); return 1; }
    }
    return 0;
  } finally { if (cleanup) rmSync(cleanup, { recursive: true, force: true }); }
}
