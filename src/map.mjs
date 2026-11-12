// Turn scan facts into a plain-English map: stack, routes, tables, and who talks to whom.

const any = (deps, list) => list.some((d) => (d.endsWith('/') ? [...deps].some((x) => x.startsWith(d)) : deps.has(d)));

const STACK = [
  // [group, label, test(scan)]
  ['Frontend', 'Next.js', (s) => s.deps.has('next')],
  ['Frontend', 'Remix', (s) => any(s.deps, ['@remix-run/react', '@remix-run/node'])],
  ['Frontend', 'SvelteKit', (s) => s.deps.has('@sveltejs/kit')],
  ['Frontend', 'Nuxt', (s) => s.deps.has('nuxt')],
  ['Frontend', 'Astro', (s) => s.deps.has('astro')],
  ['Frontend', 'Expo / React Native', (s) => any(s.deps, ['expo', 'react-native'])],
  ['Frontend', 'React + Vite', (s) => s.deps.has('vite') && s.deps.has('react') && !s.deps.has('next')],
  ['Frontend', 'Vue + Vite', (s) => s.deps.has('vite') && s.deps.has('vue') && !s.deps.has('nuxt')],
  ['Backend', 'Express', (s) => s.deps.has('express')],
  ['Backend', 'Fastify', (s) => s.deps.has('fastify')],
  ['Backend', 'Hono', (s) => s.deps.has('hono')],
  ['Backend', 'NestJS', (s) => s.deps.has('@nestjs/core')],
  ['Backend', 'FastAPI', (s) => /\bfastapi\b/.test(s.py)],
  ['Backend', 'Django', (s) => /\bdjango\b/.test(s.py)],
  ['Backend', 'Flask', (s) => /\bflask\b/.test(s.py)],
  ['Database', 'Supabase (Postgres)', (s) => any(s.deps, ['@supabase/supabase-js', '@supabase/ssr', '@supabase/auth-helpers-nextjs']) || s.paths.some((p) => p.startsWith('supabase/'))],
  ['Database', 'Firebase / Firestore', (s) => any(s.deps, ['firebase', 'firebase-admin'])],
  ['Database', 'Prisma ORM', (s) => any(s.deps, ['prisma', '@prisma/client'])],
  ['Database', 'Drizzle ORM', (s) => s.deps.has('drizzle-orm')],
  ['Database', 'MongoDB', (s) => any(s.deps, ['mongodb', 'mongoose'])],
  ['Database', 'Convex', (s) => s.deps.has('convex')],
  ['Database', 'Postgres (direct)', (s) => any(s.deps, ['pg', 'postgres', '@neondatabase/serverless', '@vercel/postgres'])],
  ['Auth', 'Supabase Auth', (s) => s.files.some((f) => f.code && /\.auth\.(getUser|getSession|signIn|signUp|onAuthStateChange)/.test(f.text))],
  ['Auth', 'Clerk', (s) => s.deps.has('@clerk/nextjs') || s.deps.has('@clerk/clerk-react') || any(s.deps, ['@clerk/'])],
  ['Auth', 'Auth.js / NextAuth', (s) => any(s.deps, ['next-auth', '@auth/core'])],
  ['Auth', 'Firebase Auth', (s) => s.files.some((f) => f.code && /firebase\/auth/.test(f.text))],
  ['Auth', 'Better Auth', (s) => s.deps.has('better-auth')],
  ['Payments', 'Stripe', (s) => any(s.deps, ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js'])],
  ['Payments', 'Lemon Squeezy', (s) => any(s.deps, ['@lemonsqueezy/lemonsqueezy.js'])],
  ['Payments', 'Paddle', (s) => any(s.deps, ['@paddle/paddle-js', '@paddle/paddle-node-sdk'])],
  ['AI', 'OpenAI', (s) => any(s.deps, ['openai', '@ai-sdk/openai'])],
  ['AI', 'Anthropic', (s) => any(s.deps, ['@anthropic-ai/sdk', '@ai-sdk/anthropic'])],
  ['AI', 'Google Gemini', (s) => any(s.deps, ['@google/generative-ai', '@google/genai', '@ai-sdk/google'])],
  ['AI', 'Vercel AI SDK', (s) => s.deps.has('ai')],
  ['Email', 'Resend', (s) => s.deps.has('resend')],
  ['Email', 'SendGrid', (s) => s.deps.has('@sendgrid/mail')],
  ['Email', 'Postmark', (s) => s.deps.has('postmark')],
  ['Email', 'Nodemailer (SMTP)', (s) => s.deps.has('nodemailer')],
  ['Files', 'Supabase Storage', (s) => s.files.some((f) => f.code && /\.storage\s*\.from\(/.test(f.text))],
  ['Files', 'AWS S3', (s) => any(s.deps, ['@aws-sdk/client-s3', 'aws-sdk'])],
  ['Files', 'UploadThing', (s) => s.deps.has('uploadthing')],
  ['Files', 'Cloudinary', (s) => s.deps.has('cloudinary')],
  ['Hosting', 'Vercel', (s) => s.has('vercel.json') || s.deps.has('@vercel/analytics')],
  ['Hosting', 'Netlify', (s) => s.has('netlify.toml')],
  ['Hosting', 'Cloudflare', (s) => s.paths.some((p) => /^wrangler\.(toml|jsonc?)$/.test(p))],
  ['Hosting', 'Docker', (s) => s.paths.some((p) => /(^|\/)Dockerfile$/.test(p))],
  ['Hosting', 'Railway', (s) => s.has('railway.json') || s.has('railway.toml')],
  ['Hosting', 'Render', (s) => s.has('render.yaml')],
  ['Hosting', 'Fly.io', (s) => s.has('fly.toml')],
  ['Monitoring', 'Sentry', (s) => any(s.deps, ['@sentry/'])],
  ['Monitoring', 'PostHog', (s) => any(s.deps, ['posthog-js', 'posthog-node'])],
  ['Monitoring', 'LogRocket', (s) => s.deps.has('logrocket')],
  ['Built with', 'Lovable', (s) => s.deps.has('lovable-tagger')],
  ['Built with', 'Bolt', (s) => s.paths.some((p) => p.startsWith('.bolt/'))],
  ['Built with', 'Replit', (s) => s.has('.replit')],
];

const SERVICE_CALLS = [
  ['Database', /\.from\(\s*['"`][\w.-]+['"`]\s*\)|\.rpc\(|prisma\.\w+\.|db\.(select|insert|update|delete|query)\b|\.collection\(|getDocs?\(|sql`/],
  ['Stripe', /\bstripe\.(checkout|customers|subscriptions|paymentIntents|webhooks|prices|billingPortal|invoices)|new Stripe\(|loadStripe\(/],
  ['AI', /chat\.completions\.create|responses\.create|messages\.create|generateText\(|streamText\(|generateContent\(|generateObject\(/],
  ['Email', /resend\.emails\.send|sgMail\.send|sendMail\(|postmark/i],
  ['File storage', /\.storage\s*\.from\(|PutObjectCommand|cloudinary\.uploader/],
];

export function isClientFile(scan, path, text) {
  if (/(^|\/)(supabase\/functions|netlify\/functions|functions|server|api|backend|scripts|migrations)\//.test(path) && !/(^|\/)app\//.test(path)) return false;
  if (/^\s*['"]use server['"]/m.test(text)) return false;
  if (/^\s*['"]use client['"]/m.test(text)) return true;
  if (/(^|\/)app\/(.*\/)?(route|layout|page|loading|error|not-found|middleware)\.[jt]sx?$/.test(path)) {
    return false; // App Router server components by default (page.tsx without 'use client' renders on the server)
  }
  if (/(^|\/)pages\/api\//.test(path)) return false;
  if (/(^|\/)middleware\.[jt]s$/.test(path)) return false;
  if (/\.(vue|svelte)$/.test(path)) return true;
  if (/(^|\/)(components|hooks|pages|views|screens|contexts?)\//.test(path)) return true;
  const spa = !scan.deps.has('next') && (scan.deps.has('vite') || scan.deps.has('react-scripts') || scan.deps.has('expo'));
  if (spa && /^src\//.test(path) && !/^src\/(server|api)\//.test(path)) return true;
  return false;
}

function routePath(path) {
  let m = /(?:^|\/)app\/(.*?)\/?route\.[jt]sx?$/.exec(path);
  if (m) return '/' + m[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/');
  m = /(?:^|\/)pages\/(api\/.*?)(?:\/index)?\.[jt]sx?$/.exec(path);
  if (m) return '/' + m[1];
  m = /(?:^|\/)supabase\/functions\/([\w-]+)\/index\.[jt]s$/.exec(path);
  if (m) return `edge function: ${m[1]}`;
  m = /(?:^|\/)netlify\/functions\/([\w-]+)\.[jt]s$/.exec(path);
  if (m) return `function: ${m[1]}`;
  m = /^api\/(.*)\.[jt]s$/.exec(path);
  if (m) return '/api/' + m[1];
  return null;
}

function pageCount(scan) {
  return scan.files.filter((f) => /(^|\/)app\/(.*\/)?page\.[jt]sx?$/.test(f.path)
    || (/(^|\/)pages\/(?!api\/|_app|_document)[^/].*\.[jt]sx?$/.test(f.path))
    || (/\.(vue|svelte)$/.test(f.path) && /(^|\/)(pages|routes)\//.test(f.path))).length;
}

export function parseSql(scan) {
  const sqlFiles = scan.files.filter((f) => /\.sql$/i.test(f.path));
  const norm = (t) => t.replace(/"/g, '').replace(/^public\./i, '').toLowerCase();
  const tables = new Map(); // name -> { file, line, rls:false, fks:[{col}], indexed:Set, policies:[] }
  for (const f of sqlFiles) {
    const text = f.text.replace(/--[^\n]*/g, (c) => ' '.repeat(c.length));
    const ct = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
    let m;
    while ((m = ct.exec(text))) {
      const name = norm(m[1]);
      if (name.includes('.') && !name.startsWith('public.')) { if (/^(auth|storage|extensions)\./.test(name)) continue; }
      const t = tables.get(name) || { name, file: f.path, line: text.slice(0, m.index).split('\n').length, rls: false, fks: [], indexed: new Set(), policies: [] };
      for (const colLine of m[2].split('\n')) {
        const c = /^\s*"?(\w+)"?\s+[^,]*?\breferences\b/i.exec(colLine);
        if (c && !/^(constraint|foreign|primary|unique|check)$/i.test(c[1]) && !t.fks.includes(c[1].toLowerCase())) t.fks.push(c[1].toLowerCase());
        const pk = /^\s*"?(\w+)"?\s+[^,]*primary key/i.exec(colLine);
        const tpk = /^\s*(?:constraint\s+\w+\s+)?primary key\s*\(\s*"?(\w+)"?/i.exec(colLine);
        if (tpk) t.indexed.add(tpk[1].toLowerCase());
        if (pk) t.indexed.add(pk[1].toLowerCase());
        const uq = /^\s*"?(\w+)"?\s+[^,]*\bunique\b/i.exec(colLine);
        if (uq) t.indexed.add(uq[1].toLowerCase());
      }
      tables.set(name, t);
    }
  }
  for (const f of sqlFiles) {
    const text = f.text.replace(/--[^\n]*/g, '');
    let m;
    const rls = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."]+)\s+enable\s+row\s+level\s+security/gi;
    while ((m = rls.exec(text))) { const t = tables.get(norm(m[1])); if (t) t.rls = true; }
    const idx = /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[\w."]*\s+on\s+(?:only\s+)?([\w."]+)\s*(?:using\s+\w+\s*)?\(\s*"?(\w+)"?/gi;
    while ((m = idx.exec(text))) { const t = tables.get(norm(m[1])); if (t) t.indexed.add(m[2].toLowerCase()); }
    const pol = /create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w."]+)([\s\S]*?);/gi;
    while ((m = pol.exec(text))) {
      const t = tables.get(norm(m[2])); if (!t) continue;
      const body = m[3];
      const cmd = (/\bfor\s+(all|select|insert|update|delete)\b/i.exec(body)?.[1] || 'all').toLowerCase();
      const open = /(using|with\s+check)\s*\(\s*true\s*\)/i.test(body);
      t.policies.push({ name: m[1].replace(/"/g, ''), cmd, open, file: f.path, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return { sqlFiles: sqlFiles.map((f) => f.path), tables: [...tables.values()] };
}

export function buildMap(scan) {
  const stack = {};
  for (const [group, label, test] of STACK) {
    try { if (test(scan)) (stack[group] ||= []).push(label); } catch { /* ignore */ }
  }
  if (stack.Frontend?.includes('Next.js')) {
    const appRouter = scan.paths.some((p) => /(^|\/)app\/(.*\/)?(page|layout)\.[jt]sx?$/.test(p));
    stack.Frontend[stack.Frontend.indexOf('Next.js')] = appRouter ? 'Next.js (App Router)' : 'Next.js';
  }
  const routes = [];
  const clientFiles = [];
  const serverFiles = [];
  for (const f of scan.files) {
    if (!f.code) continue;
    const services = SERVICE_CALLS.filter(([, re]) => re.test(f.text)).map(([n]) => n);
    const rp = routePath(f.path);
    if (rp) routes.push({ path: rp, file: f.path, services, webhook: /webhook/i.test(rp), cron: false });
    else if (isClientFile(scan, f.path, f.text)) clientFiles.push({ file: f.path, services });
    else serverFiles.push({ file: f.path, services });
  }
  const sql = parseSql(scan);
  const crons = [];
  const vj = scan.byPath.get('vercel.json');
  if (vj) { try { for (const c of JSON.parse(vj.text).crons || []) crons.push({ path: c.path, schedule: c.schedule }); } catch { /* bad json */ } }
  for (const r of routes) if (crons.some((c) => c.path && r.path === c.path.split('?')[0])) r.cron = true;

  const browserToDb = clientFiles.filter((c) => c.services.includes('Database'));
  return { stack, routes, clientFiles, serverFiles, browserToDb, pages: pageCount(scan), sql, crons };
}

export function describeSchedule(s) {
  if (!s) return '';
  if (/^\*\s+\*\s+\*\s+\*\s+\*$/.test(s.trim()) || /^\*\/1\s/.test(s.trim())) return 'every minute';
  const m = /^\*\/(\d+)\s+\*/.exec(s.trim());
  if (m) return `every ${m[1]} minutes`;
  return `schedule "${s}"`;
}

export function serviceName(map, s) {
  const named = { Database: map.stack.Database?.[0] || 'Database', AI: map.stack.AI?.[0] || 'AI provider', Email: map.stack.Email?.[0] || 'Email provider', 'File storage': map.stack.Files?.[0] || 'File storage' };
  return named[s] || s;
}

/** Plain-English data-flow lines + a Mermaid diagram. */
export function dataFlow(map) {
  const lines = [];
  const services = (list) => [...new Set(list.flatMap((x) => x.services))];
  const dbName = map.stack.Database?.[0] || 'your database';
  const nm = (s) => (s === 'Database' ? dbName : serviceName(map, s));
  const tableNames = map.sql.tables.map((t) => t.name);
  if (map.browserToDb.length) lines.push({ from: 'Browser', to: dbName, via: `${map.browserToDb.length} front-end file${map.browserToDb.length > 1 ? 's' : ''} read/write data directly${tableNames.length ? ` (tables: ${tableNames.slice(0, 4).join(', ')}${tableNames.length > 4 ? ', ...' : ''})` : ''}`, warn: 'database access rules are the only lock' });
  const apis = map.routes.filter((r) => !r.webhook && !r.cron);
  if (apis.length) {
    const svc = services(apis).map(nm);
    lines.push({ from: 'Browser', to: 'Your server', via: `${apis.length} API route${apis.length > 1 ? 's' : ''} (${apis.slice(0, 5).map((r) => r.path).join(', ')}${apis.length > 5 ? ', ...' : ''})`, then: svc });
  }
  const srv = map.serverFiles.filter((x) => x.services.length);
  if (srv.length) lines.push({ from: 'Browser', to: 'Your server', via: `${srv.length} server-rendered page${srv.length > 1 ? 's' : ''} or server module${srv.length > 1 ? 's' : ''} (${srv.slice(0, 3).map((x) => x.file).join(', ')}${srv.length > 3 ? ', ...' : ''})`, then: services(srv).map(nm) });
  for (const r of map.routes.filter((x) => x.webhook)) {
    const src = /stripe/i.test(r.path) || r.services.includes('Stripe') ? 'Stripe' : 'Outside service';
    lines.push({ from: src, to: 'Your server', via: `webhook ${r.path}`, then: r.services.filter((s) => s !== 'Stripe').map(nm) });
  }
  for (const c of map.crons) lines.push({ from: 'Scheduler', to: 'Your server', via: `cron ${c.path} (${describeSchedule(c.schedule)})`, then: services(map.routes.filter((r) => r.path === c.path)).map(nm) });
  const clientOther = services(map.clientFiles).filter((s) => s !== 'Database').map(nm);
  if (clientOther.length) lines.push({ from: 'Browser', to: clientOther.join(', '), via: 'called straight from front-end code' });

  const id = (s) => s.replace(/[^A-Za-z0-9]/g, '') || 'X';
  const mer = ['flowchart LR'];
  const nodes = new Set();
  const node = (n) => { if (!nodes.has(n)) { nodes.add(n); mer.push(`  ${id(n)}["${n.replace(/"/g, "'")}"]`); } return id(n); };
  for (const l of lines) {
    const a = node(l.from); const b = node(l.to);
    mer.push(`  ${a} -->|"${l.via.split(' (tables')[0].replace(/"/g, "'").slice(0, 70)}"| ${b}`);
    for (const t of l.then || []) { const e = `  ${b} --> ${node(t)}`; if (!mer.includes(e)) mer.push(e); }
  }
  return { lines, mermaid: mer.join('\n') };
}
