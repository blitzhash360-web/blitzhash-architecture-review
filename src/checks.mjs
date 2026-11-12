// The review checks. Each returns plain-English findings for a non-technical founder.
import { findSecrets, redact } from './secrets.mjs';
import { isEnvExample } from './scan.mjs';
import { describeSchedule } from './map.mjs';

export const CATEGORIES = [
  { id: 'security', label: 'Security', weight: 0.35, covers: 'keys, database access rules, logins on API routes, payment webhooks, rate limits, headers' },
  { id: 'scaling', label: 'Scaling & speed', weight: 0.2, covers: 'unbounded queries, missing indexes, queries in loops, connection pooling' },
  { id: 'cost', label: 'Cost', weight: 0.15, covers: 'open AI endpoints, AI token caps, polling, cron frequency, function settings' },
  { id: 'backups', label: 'Backups & recovery', weight: 0.15, covers: 'schema in code, restore runbook, rebuildable settings' },
  { id: 'tests', label: 'Tests & reliability', weight: 0.15, covers: 'tests, CI, error monitoring, type safety, lockfile' },
];
export const SEVERITY_POINTS = { critical: 40, high: 25, medium: 12, low: 6 };

const AUTH_RE = /\.auth\.(getUser|getSession|getClaims)\(|\bauth\(\)|currentUser\(|getServerSession\(|getAuth\(|verifyIdToken\(|requireAuth|withAuth|requireUser|getToken\(|jwtVerify\(|clerkClient|validateRequest\(|lucia|CRON_SECRET|headers\.get\(\s*['"]authorization['"]\)|req\.headers\.authorization|isAuthenticated/;
const VALIDATE_RE = /\bz\.object\(|\.safeParse\(|\.parse\(\s*(await\s+)?(req|request|body|json)|\byup\.|\bv\.object\(|\bJoi\.|\bvalibot\b|@sinclair\/typebox|ajv/;
const BODY_RE = /(req|request)\.json\(\)|req\.body\b|request\.formData\(\)|await\s+req\.text\(\)/;
const DB_WRITE_RE = /\.(insert|update|upsert|delete)\(|prisma\.\w+\.(create|update|upsert|delete)|\.(set|add)Doc\(/;
const AI_CALL_RE = /chat\.completions\.create|responses\.create|messages\.create|generateText\(|streamText\(|generateContent\(|generateObject\(|streamObject\(/;
const MAXTOK_RE = /max_tokens|maxTokens|max_output_tokens|maxOutputTokens|max_completion_tokens|maxCompletionTokens/;
const PUBLIC_PREFIX = /^(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_|PUBLIC_|NUXT_PUBLIC_|GATSBY_)/;
const SECRETY = /(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|PASSWD|_TOKEN|API_KEY|ACCESS_KEY|OPENAI|ANTHROPIC|STRIPE_SK|WEBHOOK)/;
const NOT_SECRET = /(ANON|PUBLISHABLE|PUBLIC_KEY|_PK\b|_PK_|SITE_KEY|MEASUREMENT|DSN|POSTHOG|FIREBASE_API_KEY|MAPBOX|URL$|_ID$)/;

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
const loc = (file, line) => (line ? `${file}:${line}` : file);
const firstLine = (text, re) => { const m = re.exec(text); return m ? lineOf(text, m.index) : null; };
const plural = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;

function mk(category, id, title, base) { return { category, id, title, status: 'pass', severity: 'medium', effort: 'hours', where: [], ...base }; }

export function runChecks(scan, map) {
  const out = [];
  const code = scan.files.filter((f) => f.code);
  const usesDb = !!map.stack.Database;
  const supabase = (map.stack.Database || []).some((d) => d.startsWith('Supabase'));
  const apiRoutes = map.routes;
  const routeFile = (r) => scan.byPath.get(r.file);

  // ---------- SECURITY ----------
  {
    const hits = [];
    for (const f of scan.files) {
      if (isEnvExample(f.path) || /(^|\/)(test|tests|__tests__|fixtures?)\//.test(f.path) || /\.(test|spec)\.[jt]sx?$/.test(f.path) || /\.md$/.test(f.path)) continue;
      for (const h of findSecrets(f.text)) hits.push({ ...h, file: f.path });
    }
    out.push(mk('security', 'hardcoded-secrets', 'Secret keys are written into the code', hits.length ? {
      status: 'fail', severity: 'critical', effort: 'quick',
      found: `${plural(hits.length, 'secret key')} written directly in code: ${[...new Set(hits.map((h) => h.kind))].join(', ')}. (Values not shown.)`,
      why: 'Anyone who sees the code, the git history or the browser bundle can use these keys to take money, read data or run up your bills.',
      fix: 'Rotate (replace) each key in the provider dashboard today, then load the new one from an environment variable on the server only.',
      ask: 'Move every hardcoded API key in this project into server-only environment variables, read them with process.env, and list which keys I must rotate in each provider dashboard.',
      where: hits.map((h) => `${loc(h.file, h.line)} (${h.kind})`),
    } : { good: 'No secret keys are written directly into the code.' }));
  }
  {
    const names = new Set([...scan.envFiles.flatMap((e) => e.names), ...scan.envRefs.keys()]);
    const bad = [...names].filter((n) => PUBLIC_PREFIX.test(n) && SECRETY.test(n.replace(PUBLIC_PREFIX, '')) && !NOT_SECRET.test(n));
    out.push(mk('security', 'public-secret-env', 'Secrets are exposed to the browser', bad.length ? {
      status: 'fail', severity: 'critical', effort: 'quick',
      found: `${bad.join(', ')} ${bad.length === 1 ? 'has' : 'have'} a public prefix, so the value is copied into the JavaScript every visitor downloads.`,
      why: 'Public prefixes (NEXT_PUBLIC_, VITE_ and similar) mean "ship this to the browser". A secret there is a secret on the internet.',
      fix: 'Rename it without the prefix, use it only in server code (API routes, server actions, edge functions), and rotate the old value.',
      ask: `These env vars are secrets but have a public prefix: ${bad.join(', ')}. Move their usage to server-only code, rename them without the prefix, and tell me which keys to rotate.`,
      where: bad.map((n) => `${n}${scan.envRefs.get(n) ? ` (used in ${scan.envRefs.get(n).slice(0, 3).join(', ')})` : ''}`),
    } : { good: 'No secret-looking settings are exposed to the browser through public prefixes.' }));
  }
  {
    const leaks = map.clientFiles.map((c) => scan.byPath.get(c.file)).filter((f) => f && /service_role|SERVICE_ROLE|serviceRole|firebase-admin|SECRET_KEY/.test(f.text))
      .map((f) => loc(f.path, firstLine(f.text, /service_role|SERVICE_ROLE|serviceRole|firebase-admin|SECRET_KEY/)));
    out.push(mk('security', 'admin-key-in-browser', 'Admin database key is used in front-end code', leaks.length ? {
      status: 'fail', severity: 'critical', effort: 'hours',
      found: `Front-end code refers to an admin/service key in ${plural(leaks.length, 'file')}.`,
      why: 'The service role (admin) key skips every access rule. If it reaches the browser, any visitor can read, change or delete all data.',
      fix: 'Use the admin key only in server code. In the browser, use the public anon key plus database access rules (RLS).',
      ask: 'Find every place the Supabase service_role / admin key is used in browser code. Move that logic into a server route or edge function that checks the logged-in user, and use the anon key on the client.',
      where: leaks,
    } : { good: 'Admin database keys are not referenced from front-end code.' }));
  }
  {
    const envPresent = scan.envFiles.filter((e) => !e.example).map((e) => e.path);
    const gi = scan.byPath.get('.gitignore')?.text || '';
    const ignored = /^\s*\/?\.env(\*|\.\*|\.local)?\s*$/m.test(gi) || /^\s*\.env\*?\s*$/m.test(gi) || /^\s*\*\.env\s*$/m.test(gi);
    const tracked = scan.gitTracked ? scan.gitTracked.filter((p) => /(^|\/)\.env(\.[\w-]+)?$/.test(p) && !isEnvExample(p)) : [];
    let base;
    if (tracked.length) base = { status: 'fail', severity: 'critical', effort: 'quick', found: `${tracked.join(', ')} ${tracked.length === 1 ? 'is' : 'are'} committed to git.`, why: 'Everything in git history is shared with every collaborator, and with the world if the repo is ever made public.', fix: 'Remove the file from git, add .env to .gitignore, and rotate every key it contained (deleting the file does not remove it from history).', ask: 'Remove committed .env files from git tracking, add .env* (except .env.example) to .gitignore, and list the keys I need to rotate.', where: tracked };
    else if (envPresent.length && !ignored) base = { status: 'fail', severity: 'high', effort: 'quick', found: `${envPresent.join(', ')} exists but .gitignore does not exclude .env files.`, why: 'One "commit all" and your keys are in git history for good.', fix: 'Add `.env*` and `!.env.example` to .gitignore before the next commit.', ask: 'Update .gitignore so .env files are never committed, keeping .env.example.', where: ['.gitignore'] };
    else base = { good: envPresent.length ? '.env files are kept out of git.' : 'No .env file with real values sits in the project folder.' };
    out.push(mk('security', 'env-in-git', '.env file is not protected from git', base));
  }
  if (supabase || map.sql.tables.length) {
    const noRls = map.sql.tables.filter((t) => !t.rls);
    const open = map.sql.tables.flatMap((t) => t.policies.filter((p) => p.open && p.cmd !== 'select').map((p) => ({ t, p })));
    const direct = map.browserToDb.length > 0;
    if (!map.sql.tables.length) {
      out.push(mk('security', 'rls', 'Database tables are missing access rules (RLS)', { status: 'warn', severity: 'high', effort: 'hours', found: 'The app uses Supabase but there are no SQL migrations in the repo, so access rules cannot be checked.', why: 'With Supabase, the browser talks to the database directly. Row Level Security is what stops one user reading another user\'s data.', fix: 'Pull your schema into the repo (`supabase db pull`) and make sure every table has RLS on with real policies.', ask: 'Help me run supabase db pull, then check that every table has row level security enabled with policies tied to auth.uid().' }));
    } else {
      const issues = [...noRls.map((t) => `${t.name}: RLS is off (${loc(t.file, t.line)})`), ...open.map(({ t, p }) => `${t.name}: policy "${p.name}" lets anyone ${p.cmd === 'all' ? 'do anything' : p.cmd} (${loc(p.file, p.line)})`)];
      out.push(mk('security', 'rls', 'Database tables are missing access rules (RLS)', issues.length ? {
        status: 'fail', severity: noRls.length && direct ? 'critical' : 'high', effort: 'hours',
        found: `${plural(noRls.length, 'table')} without Row Level Security${open.length ? ` and ${plural(open.length, 'policy', 'policies')} open to everyone` : ''}${direct ? '. The browser queries the database directly.' : '.'}`,
        why: 'Your public anon key is in every visitor\'s browser. Without RLS (or with "true" policies), anyone can use it to read or change those tables.',
        fix: 'Turn RLS on for every table and write policies that compare the row owner to auth.uid().',
        ask: `Write a Supabase migration that enables row level security on ${noRls.length ? `these tables: ${noRls.map((t) => t.name).join(', ')}` : 'every table'}, and replace any USING (true) policies with owner-based policies using auth.uid().`,
        where: issues,
        alsoGood: map.sql.tables.some((t) => t.rls && !t.policies.some((p) => p.open)) ? `Row Level Security is on with owner-based rules for ${map.sql.tables.filter((t) => t.rls && !t.policies.some((p) => p.open)).map((t) => t.name).join(', ')}.` : null,
      } : { good: `All ${plural(map.sql.tables.length, 'table')} have Row Level Security on with no wide-open write policies.` }));
    }
  }
  {
    const hooks = apiRoutes.filter((r) => r.webhook);
    if (hooks.length) {
      const bad = hooks.filter((r) => {
        const t = routeFile(r)?.text || '';
        if (/stripe/i.test(r.path + t)) return !/constructEvent(Async)?\s*\(|verifyHeader|validateWebhook/.test(t);
        return !/signature|verify|hmac|timingSafeEqual|svix/i.test(t);
      });
      out.push(mk('security', 'webhook-signature', 'Payment webhook accepts unsigned (fake) events', bad.length ? {
        status: 'fail', severity: 'critical', effort: 'quick',
        found: `${plural(bad.length, 'webhook')} accept${bad.length === 1 ? 's' : ''} events without checking the signature: ${bad.map((r) => r.path).join(', ')}.`,
        why: 'Anyone who finds the URL can send a fake "payment succeeded" event and unlock paid features for free.',
        fix: 'Verify every event with the provider\'s signing secret (for Stripe: stripe.webhooks.constructEvent with the raw body and STRIPE_WEBHOOK_SECRET).',
        ask: 'Update my Stripe webhook route to read the raw request body and verify it with stripe.webhooks.constructEvent and STRIPE_WEBHOOK_SECRET, returning 400 on failure.',
        where: bad.map((r) => r.file),
      } : { good: `${plural(hooks.length, 'webhook')} verif${hooks.length === 1 ? 'ies' : 'y'} the sender's signature.` }));
    }
  }
  {
    const candidates = apiRoutes.filter((r) => !r.webhook);
    if (candidates.length) {
      // Login, sign-up and OAuth callback routes are public by design.
      const AUTH_FLOW = /(^|\/)(auth|login|logout|signin|sign-in|signup|sign-up|register|callback|oauth|reset[-_]?password|forgot[-_]?password|verify|confirm|health|status|og)(\/|$|\[)/i;
      const open = candidates.filter((r) => !AUTH_FLOW.test(r.path) && !AUTH_RE.test(routeFile(r)?.text || ''));
      const risky = open.filter((r) => { const t = routeFile(r)?.text || ''; return DB_WRITE_RE.test(t) || AI_CALL_RE.test(t) || r.services.includes('Stripe') || r.cron; });
      out.push(mk('security', 'api-auth', 'API routes don\'t check who is calling', open.length ? {
        status: risky.length ? 'fail' : 'warn', severity: risky.length ? 'high' : 'medium', effort: 'hours',
        found: `${open.length} of ${plural(candidates.length, 'API route')} never check${open.length === 1 ? 's' : ''} for a logged-in user or secret${risky.length ? `, ${risky.length} of them change data, charge money, call AI or run as a cron job` : ''}.`,
        why: 'Your API routes are public URLs. Without a login (or cron secret) check, anyone can call them, as often as they like.',
        fix: 'At the top of each route, get the current user and return 401 if there is none. Cron routes should require a secret header (e.g. CRON_SECRET).',
        ask: `Add an authentication check to these API routes: ${open.map((r) => r.path).join(', ')}. Return 401 when there is no logged-in user; for cron routes, require the CRON_SECRET bearer token.`,
        where: open.map((r) => `${r.path} (${r.file})`),
        alsoGood: (() => { const ok = candidates.filter((r) => !open.includes(r) && !AUTH_FLOW.test(r.path)); return ok.length ? `${plural(ok.length, 'API route')} (${ok.map((r) => r.path).slice(0, 3).join(', ')}) check${ok.length === 1 ? 's' : ''} the logged-in user.` : null; })(),
      } : { good: candidates.some((r) => AUTH_FLOW.test(r.path)) ? `API routes check who is calling (login and callback routes are public by design).` : `All ${plural(candidates.length, 'API route')} check who is calling.` }));
      const bodies = candidates.filter((r) => BODY_RE.test(routeFile(r)?.text || ''));
      if (bodies.length) {
        const noVal = bodies.filter((r) => !VALIDATE_RE.test(routeFile(r)?.text || ''));
        out.push(mk('security', 'input-validation', 'Incoming data is not validated', noVal.length ? {
          status: 'warn', severity: 'medium', effort: 'hours',
          found: `${plural(noVal.length, 'route')} use${noVal.length === 1 ? 's' : ''} request data without validating it: ${noVal.map((r) => r.path).join(', ')}.`,
          why: 'Unchecked input is how bad data, crashes and injection bugs get in. AI-written routes often trust whatever the browser sends.',
          fix: 'Describe the expected shape with a schema library like Zod and reject anything else with a 400.',
          ask: `Add Zod validation to the request body of ${noVal.map((r) => r.path).join(', ')} and return 400 with a clear message on invalid input.`,
          where: noVal.map((r) => r.file),
          alsoGood: noVal.length < bodies.length ? `${plural(bodies.length - noVal.length, 'route')} validate${bodies.length - noVal.length === 1 ? 's' : ''} incoming data with a schema.` : null,
        } : { good: 'Routes that accept data validate it with a schema.' }));
      }
    }
  }
  if (apiRoutes.length || map.stack.Auth) {
    const rl = scan.files.some((f) => /ratelimit|rate-limit|rateLimit|rate_limit|express-rate-limit|@arcjet|limiter|throttle/i.test(f.text) && f.code)
      || [...scan.deps].some((d) => /ratelimit|rate-limit|arcjet|limiter/.test(d));
    out.push(mk('security', 'rate-limits', 'No rate limits on public endpoints', !rl ? {
      status: 'warn', severity: map.stack.AI ? 'high' : 'medium', effort: 'hours',
      found: 'No rate limiting found in the code or dependencies.',
      why: `Bots can hammer login, sign-up${map.stack.AI ? ', AI' : ''} and other endpoints thousands of times a minute, which leads to account takeovers, spam and surprise bills.`,
      fix: 'Add a per-IP and per-user limit to auth, AI and write endpoints (e.g. Upstash Ratelimit, Arcjet, or your host\'s firewall rules).',
      ask: 'Add rate limiting to my API routes (especially auth, AI and anything that writes data) using @upstash/ratelimit, keyed by user id or IP, returning 429 when exceeded.',
    } : { good: 'Rate limiting is in place.' }));
  }
  if (map.stack.Frontend || map.pages) {
    const headerFiles = scan.files.filter((f) => /(^|\/)(next\.config\.[mc]?[jt]s|vercel\.json|netlify\.toml|_headers|middleware\.[jt]s|nuxt\.config\.[jt]s|svelte\.config\.js|server\.[jt]s|app\.[jt]s)$/.test(f.path));
    const ok = headerFiles.some((f) => /Content-Security-Policy|X-Frame-Options|frame-ancestors|Strict-Transport-Security|helmet\(/i.test(f.text)) || scan.deps.has('helmet');
    out.push(mk('security', 'headers', 'No security headers', !ok ? {
      status: 'warn', severity: 'low', effort: 'quick',
      found: 'No security headers (Content-Security-Policy, X-Frame-Options, HSTS) are set in the app or host config.',
      why: 'Headers are a cheap extra lock against clickjacking and injected scripts. Security reviews and enterprise customers check for them.',
      fix: 'Add a headers block in next.config / vercel.json / netlify.toml (or helmet for Express).',
      ask: 'Add security headers (Strict-Transport-Security, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, and a starter Content-Security-Policy) to this app\'s config.',
    } : { good: 'Security headers are configured.' }));
  }

  // ---------- SCALING ----------
  {
    const hits = [];
    for (const f of code) {
      const lines = f.text.split('\n');
      lines.forEach((l, i) => {
        if (/\.select\(\s*(['"`]\*['"`])?\s*\)/.test(l) || /\.select\(\s*['"`][^'"`]*['"`]\s*\)/.test(l) && /\.from\(/.test(lines.slice(Math.max(0, i - 2), i + 1).join(' '))) {
          const chain = lines.slice(i, i + 5).join(' ').split(';')[0];
          if (!/\.(limit|range|single|maybeSingle|eq\(\s*['"]id['"])\(?/.test(chain) && !/\{\s*count:\s*['"]exact['"],\s*head:\s*true/.test(chain)) hits.push(loc(f.path, i + 1));
        }
        if (/\.findMany\(\s*\)/.test(l) || (/\.findMany\(\{/.test(l) && !/\btake\s*:/.test(lines.slice(i, i + 8).join(' ')))) hits.push(loc(f.path, i + 1));
      });
    }
    if (usesDb) out.push(mk('scaling', 'unbounded-queries', 'Queries fetch every row (no pagination)', hits.length ? {
      status: 'warn', severity: 'medium', effort: 'hours',
      found: `${plural(hits.length, 'query', 'queries')} fetch every matching row with no limit.`,
      why: 'Fine with 50 rows, slow and expensive with 50,000. Pages get slower every week as data grows, and database egress costs rise.',
      fix: 'Add .limit()/.range() (or take/skip) and paginate lists. Select only the columns you show.',
      ask: 'Find database queries with no limit and add pagination (.range for Supabase, take/skip for Prisma), selecting only the columns the UI uses.',
      where: hits.slice(0, 10),
    } : { good: 'Database queries are limited or paginated.' }));
  }
  {
    const hits = [];
    for (const f of code) {
      const lines = f.text.split('\n');
      lines.forEach((l, i) => {
        if (/\bfor\s*\(|\.forEach\(|\.map\(\s*async|\bwhile\s*\(/.test(l)) {
          const body = lines.slice(i + 1, i + 7);
          const j = body.findIndex((b) => /await\b/.test(b) && /\.from\(|prisma\.|\.collection\(|getDoc|db\.|fetch\(/.test(b));
          if (j >= 0) hits.push(loc(f.path, i + 2 + j));
        }
      });
    }
    if (usesDb) out.push(mk('scaling', 'queries-in-loops', 'Database calls inside loops', hits.length ? {
      status: 'warn', severity: 'medium', effort: 'hours',
      found: `${plural(hits.length, 'place')} run a database or network call once per item inside a loop.`,
      why: '20 items means 21 round trips. Pages that feel fine today get slower in step with your data, and connection limits are hit sooner.',
      fix: 'Fetch everything in one query (a join, `.in(\'id\', ids)`, or include/select relations) instead of one per item.',
      ask: 'Find database calls inside loops in this project and rewrite them as a single batched query (joins or .in()), keeping the same result.',
      where: hits.slice(0, 10),
    } : { good: 'No database calls inside loops were found.' }));
  }
  if (map.sql.tables.length) {
    const missing = [...new Set(map.sql.tables.flatMap((t) => t.fks.filter((c) => !t.indexed.has(c)).map((c) => `${t.name}.${c} (${t.file})`)))];
    out.push(mk('scaling', 'fk-indexes', 'Missing indexes on linked columns', missing.length ? {
      status: 'warn', severity: 'medium', effort: 'quick',
      found: `${plural(missing.length, 'link column')} between tables ha${missing.length === 1 ? 's' : 've'} no index.`,
      why: 'Postgres does not index foreign keys for you. Every "show my items" query scans the whole table, and RLS policies on these columns get slow fast.',
      fix: 'Add an index on each column listed (one line of SQL each).',
      ask: `Write a migration adding indexes on these foreign key columns: ${missing.map((m) => m.split(' ')[0]).join(', ')}.`,
      where: missing,
    } : { good: 'Columns that link tables together are indexed.' }));
  }
  if ((map.stack.Database || []).some((d) => /Prisma|Drizzle|Postgres \(direct\)/.test(d)) && (map.stack.Hosting || []).some((h) => /Vercel|Netlify|Cloudflare/.test(h))) {
    const pooled = scan.envFiles.some((e) => e.poolerHint) || scan.files.some((f) => /pgbouncer|pooler|@neondatabase\/serverless|@prisma\/adapter|accelerate/i.test(f.text));
    out.push(mk('scaling', 'pooling', 'No database connection pooling', !pooled ? {
      status: 'warn', severity: 'medium', effort: 'quick',
      found: 'Serverless functions connect to Postgres with no sign of a connection pooler.',
      why: 'Each serverless function opens its own connection. A traffic spike runs out of connections and the app throws errors for everyone.',
      fix: 'Use your provider\'s pooled connection string (Supabase port 6543 / Neon pooler) for the app, and the direct URL only for migrations.',
      ask: 'Configure this project to use a pooled Postgres connection string for runtime queries and a direct URL for migrations, and update .env.example.',
    } : { good: 'Database connections go through a pooler.' }));
  }

  // ---------- COST ----------
  {
    const aiRoutes = apiRoutes.filter((r) => AI_CALL_RE.test(routeFile(r)?.text || ''));
    const aiClient = map.clientFiles.filter((c) => AI_CALL_RE.test(scan.byPath.get(c.file)?.text || ''));
    if (aiRoutes.length || aiClient.length) {
      const open = [...aiRoutes.filter((r) => !AUTH_RE.test(routeFile(r)?.text || '')).map((r) => `${r.path} (${r.file})`), ...aiClient.map((c) => `${c.file} (browser)`)];
      out.push(mk('cost', 'open-ai-endpoint', 'Anyone can spend your AI credits', open.length ? {
        status: 'fail', severity: 'high', effort: 'hours',
        found: `${plural(open.length, 'AI endpoint')} can be called by anyone, with no login check.`,
        why: 'Strangers (and bots) can use your AI credits for their own work. This is one of the most common surprise bills for AI-built apps.',
        fix: 'Require login on AI routes, add a per-user daily limit, and set a hard monthly spend cap in the AI provider dashboard.',
        ask: 'Protect my AI routes: require a logged-in user, add a per-user daily request limit, and return 429 when it is reached.',
        where: open,
      } : { good: 'AI endpoints require a logged-in user.' }));
      const files = [...aiRoutes.map((r) => r.file), ...aiClient.map((c) => c.file), ...map.serverFiles.filter((s) => AI_CALL_RE.test(scan.byPath.get(s.file)?.text || '')).map((s) => s.file)];
      const noCap = [...new Set(files)].filter((p) => !MAXTOK_RE.test(scan.byPath.get(p)?.text || ''));
      out.push(mk('cost', 'ai-token-cap', 'AI responses have no length cap', noCap.length ? {
        status: 'warn', severity: 'medium', effort: 'quick',
        found: `${plural(noCap.length, 'file')} call an AI model with no maximum output length.`,
        why: 'You pay per token. Without a cap, one long answer or a looping prompt costs many times what you planned.',
        fix: 'Set max_tokens / maxOutputTokens on every call and pick the smallest model that does the job.',
        ask: 'Add a sensible max output token limit to every AI model call in this project and tell me where a cheaper model would do.',
        where: noCap.map((p) => loc(p, firstLine(scan.byPath.get(p).text, AI_CALL_RE))),
      } : { good: 'AI calls set a maximum output length.' }));
    }
  }
  {
    const hits = [];
    for (const c of map.clientFiles) {
      const f = scan.byPath.get(c.file); if (!f) continue;
      const re = /setInterval\(([\s\S]{0,400}?)\},?\s*(\d[\d_]*)\s*\)/g; let m;
      while ((m = re.exec(f.text))) {
        const ms = Number(m[2].replace(/_/g, ''));
        if (ms < 15000 && /fetch\(|\.from\(|axios|refetch|\.rpc\(/.test(m[1])) hits.push(`${loc(f.path, lineOf(f.text, m.index))} (every ${ms / 1000}s)`);
      }
    }
    out.push(mk('cost', 'polling', 'Browser polls the server every few seconds', hits.length ? {
      status: 'warn', severity: 'medium', effort: 'hours',
      found: `The browser re-fetches data on a short timer in ${plural(hits.length, 'place')}.`,
      why: 'Every open tab calls your server or database every few seconds, even when nothing changed. 100 users polling every 2s is about 4 million requests a day.',
      fix: 'Use realtime subscriptions or webhooks, poll only while the tab is visible, or poll much less often.',
      ask: 'Replace the setInterval polling in my front end with Supabase realtime (or poll only when the tab is visible, at most every 30 seconds).',
      where: hits,
    } : { good: 'No tight polling loops in the front end.' }));
  }
  if (map.crons.length) {
    const hot = map.crons.filter((c) => /minute/.test(describeSchedule(c.schedule)) && !/\d{2,} minutes/.test(describeSchedule(c.schedule)));
    out.push(mk('cost', 'cron-frequency', 'Cron job runs every minute', hot.length ? {
      status: 'warn', severity: 'low', effort: 'quick',
      found: `${hot.map((c) => `${c.path} runs ${describeSchedule(c.schedule)}`).join('; ')}.`,
      why: 'A job every minute is about 43,000 runs a month, each one a billable function call and usually a database query.',
      fix: 'Run it hourly or daily if that is enough, or trigger it from an event (webhook, database trigger) instead.',
      ask: 'Review my cron jobs in vercel.json and suggest the slowest schedule that still works, or an event-driven alternative.',
      where: ['vercel.json'],
    } : { good: 'Scheduled jobs run at a sensible rate.' }));
  }
  {
    const vj = scan.byPath.get('vercel.json');
    let heavy = [];
    if (vj) { try { heavy = Object.entries(JSON.parse(vj.text).functions || {}).filter(([, v]) => (v.maxDuration || 0) >= 60 || (v.memory || 0) >= 2048).map(([k, v]) => `${k} (${v.maxDuration ? `${v.maxDuration}s` : ''}${v.memory ? ` ${v.memory}MB` : ''})`); } catch { /* ignore */ } }
    if (heavy.length) out.push(mk('cost', 'function-size', 'Oversized serverless function settings', { status: 'warn', severity: 'low', effort: 'quick', found: `Functions configured with long timeouts or large memory: ${heavy.join(', ')}.`, why: 'Serverless is billed by memory x time. Oversized settings multiply the cost of every call, including failed ones.', fix: 'Use defaults unless a function truly needs more, and move long jobs to a queue or background worker.', ask: 'Check the functions config in vercel.json and right-size maxDuration and memory for each function.', where: ['vercel.json'] }));
  }

  // ---------- BACKUPS ----------
  if (usesDb) {
    const migr = scan.paths.some((p) => /(^|\/)(supabase\/migrations|prisma\/migrations|drizzle|migrations|db\/migrate|alembic)\//.test(p) || /(^|\/)schema\.prisma$/.test(p) || /(^|\/)firestore\.rules$/.test(p));
    out.push(mk('backups', 'schema-as-code', 'Database structure is not saved in the repo', !migr ? {
      status: 'fail', severity: 'high', effort: 'hours',
      found: 'The app uses a database, but its structure (tables, rules, functions) is not saved in the code.',
      why: 'If the project is deleted or someone changes a table in the dashboard, there is no record of how to rebuild it.',
      fix: 'Save the schema as migrations in the repo (Supabase: `supabase db pull`; Prisma: `prisma migrate`).',
      ask: 'Set up database migrations for this project so the full schema, access rules and functions live in the repo.',
    } : { good: 'The database structure is saved in the repo as migrations or a schema file.' }));
    const runbook = scan.paths.some((p) => /(^|\/)(BACKUPS?|RUNBOOK|RESTORE|DISASTER[-_]?RECOVERY)[\w-]*\.md$/i.test(p) || /(^|\/)docs\/.*(backup|restore|runbook)/i.test(p))
      || scan.files.some((f) => (/\.(sh|ya?ml|json|m?js|ts)$/.test(f.path) && /pg_dump|supabase db dump|pg_basebackup|mongodump/.test(f.text)) || (/README\.md$/i.test(f.path) && /^#+ .*(backup|restore)/im.test(f.text)));
    out.push(mk('backups', 'restore-plan', 'No written backup and restore plan', !runbook ? {
      status: 'warn', severity: 'high', effort: 'hours',
      found: 'No backup script or written restore steps were found.',
      why: 'Backups you have never restored are a guess. When data is deleted by mistake (often by an AI agent), the clock is ticking and nobody knows the steps.',
      fix: 'Write down where backups live, how to restore one, and do a test restore into a spare project once. Add an off-site copy (e.g. a nightly pg_dump to storage you control).',
      ask: 'Write a BACKUPS.md for this project: where database backups are, step-by-step restore instructions, and a nightly pg_dump GitHub Action that uploads to storage I control.',
    } : { good: 'A backup script or written restore plan exists.' }));
  }
  {
    const used = [...scan.envRefs.keys()];
    if (used.length) {
      const ex = scan.envFiles.filter((e) => e.example);
      const exNames = new Set(ex.flatMap((e) => e.names));
      const missing = used.filter((n) => !exNames.has(n));
      out.push(mk('backups', 'env-documented', 'Settings are not fully listed in .env.example', !ex.length ? {
        status: 'warn', severity: 'medium', effort: 'quick',
        found: `The code reads ${plural(used.length, 'setting')} from the environment but there is no .env.example listing them.`,
        why: 'If your laptop dies or a developer joins, nobody knows which keys the app needs to run.',
        fix: 'Add a .env.example with every variable name and a placeholder value (never the real value).',
        ask: 'Create a .env.example listing every environment variable this project reads, with placeholder values and a one-line comment each.',
      } : missing.length ? {
        status: 'warn', severity: 'low', effort: 'quick',
        found: `${plural(missing.length, 'setting')} used in code ${missing.length === 1 ? 'is' : 'are'} missing from .env.example: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}.`,
        why: 'A fresh deploy or a new developer will hit confusing errors for settings nobody wrote down.',
        fix: 'Add the missing names to .env.example with placeholder values.',
        ask: `Add these variables to .env.example with placeholders and comments: ${missing.join(', ')}.`,
        where: missing.map((n) => `${n} (${scan.envRefs.get(n).slice(0, 2).join(', ')})`),
      } : { good: 'Every setting the code reads is listed in .env.example.' }));
    }
  }

  // ---------- TESTS & RELIABILITY ----------
  {
    const testFiles = scan.paths.filter((p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)(__tests__|tests?|e2e|cypress|playwright)\/.*\.[cm]?[jt]sx?$/.test(p) || /(^|\/)test_\w+\.py$/.test(p));
    const script = scan.rootPkg?.scripts?.test || '';
    const placeholder = /no test specified/.test(script);
    out.push(mk('tests', 'tests-exist', 'No automated tests run', !testFiles.length || placeholder ? {
      status: 'fail', severity: 'high', effort: 'day',
      found: testFiles.length ? 'Test files exist but `npm test` is the default placeholder, so they never run.' : 'No automated tests were found.',
      why: 'Every AI edit can silently break sign-up, checkout or permissions. Tests are how you find out before customers do.',
      fix: 'Start with 3 to 5 tests for the money paths: sign up, log in, pay, and "user A cannot see user B\'s data".',
      ask: 'Add a test setup (Vitest or Playwright) and write tests for sign-up, login, checkout and one test proving a user cannot read another user\'s data.',
    } : { good: `${plural(testFiles.length, 'test file')} found${script ? ' and `npm test` runs them' : ''}.` }));
    const ciFiles = scan.files.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f.path) || /^(\.gitlab-ci\.yml|\.circleci\/config\.yml|bitbucket-pipelines\.yml|azure-pipelines\.yml)$/.test(f.path));
    const runsChecks = ciFiles.some((f) => /\b(test|lint|typecheck|build|check)\b/.test(f.text));
    out.push(mk('tests', 'ci', 'No automatic checks (CI) on new code', !ciFiles.length || !runsChecks ? {
      status: 'warn', severity: 'medium', effort: 'quick',
      found: ciFiles.length ? 'A CI workflow exists but does not run tests, lint or a build.' : 'No CI workflow (e.g. GitHub Actions) runs checks on new code.',
      why: 'Without CI, broken code reaches production as soon as someone (or some AI) pushes it.',
      fix: 'Add a GitHub Actions workflow that installs, builds and runs tests on every push and pull request.',
      ask: 'Create a GitHub Actions workflow that installs dependencies, runs lint, typecheck, build and tests on every push and pull request.',
    } : { good: 'CI runs checks on every change.' }));
    const mon = (map.stack.Monitoring || []).length || [...scan.deps].some((d) => /sentry|bugsnag|honeybadger|rollbar|highlight|datadog|newrelic|axiom|logtail|betterstack/.test(d));
    out.push(mk('tests', 'monitoring', 'Nobody is alerted when production breaks', !mon ? {
      status: 'warn', severity: 'medium', effort: 'quick',
      found: 'No error monitoring tool (Sentry, PostHog, Bugsnag, Better Stack...) is installed.',
      why: 'When checkout breaks at 2 AM, you only find out when a customer complains, or quietly leaves.',
      fix: 'Add an error tracker (most have a free tier) and an uptime check on your main pages.',
      ask: 'Add Sentry (or a similar free-tier error tracker) to this app for both front end and server routes, with environment variables documented in .env.example.',
    } : { good: 'Error monitoring is installed.' }));
    const ts = scan.byPath.get('tsconfig.json');
    if (ts) {
      const strict = /"strict"\s*:\s*true/.test(ts.text);
      out.push(mk('tests', 'ts-strict', 'TypeScript strict mode is off', !strict ? {
        status: 'warn', severity: 'low', effort: 'hours',
        found: 'tsconfig.json does not turn on "strict" mode.',
        why: 'Strict mode catches missing values and wrong types before they become runtime crashes. AI tools often turn it off to make errors go away.',
        fix: 'Set "strict": true and fix the errors it reports, a folder at a time.',
        ask: 'Turn on TypeScript strict mode in tsconfig.json and fix the resulting type errors without using any or ts-ignore.',
        where: ['tsconfig.json'],
      } : { good: 'TypeScript strict mode is on.' }));
    }
    if (scan.rootPkg) {
      out.push(mk('tests', 'lockfile', 'Dependency versions are not locked', !scan.lockfile ? {
        status: 'warn', severity: 'low', effort: 'quick',
        found: 'package.json has no lockfile next to it (package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lock).',
        why: 'Without a lockfile, every deploy can install slightly different package versions, so "it worked yesterday" bugs appear out of nowhere.',
        fix: 'Run your package manager\'s install once and commit the lockfile.',
        ask: 'Generate and commit a lockfile for this project and make CI install with it (npm ci / pnpm install --frozen-lockfile).',
      } : { good: `Dependency versions are locked (${scan.lockfile}).` }));
    }
  }

  // Never let a secret value slip into any text we produce.
  for (const c of out) for (const k of ['found', 'why', 'fix', 'ask', 'good', 'alsoGood']) if (c[k]) c[k] = redact(c[k]);
  for (const c of out) c.where = (c.where || []).map((w) => redact(w));
  return out;
}

export function score(checks) {
  const cats = CATEGORIES.map((cat) => {
    const list = checks.filter((c) => c.category === cat.id);
    if (!list.length) return { ...cat, score: null, grade: 'n/a', checks: list };
    let pts = 0;
    for (const c of list) if (c.status === 'fail') pts += SEVERITY_POINTS[c.severity]; else if (c.status === 'warn') pts += Math.round(SEVERITY_POINTS[c.severity] * 0.6);
    const s = Math.max(0, 100 - pts);
    return { ...cat, score: s, grade: grade(s), checks: list };
  });
  const scored = cats.filter((c) => c.score != null);
  const wsum = scored.reduce((a, c) => a + c.weight, 0) || 1;
  let overall = Math.round(scored.reduce((a, c) => a + c.score * c.weight, 0) / wsum);
  // A critical problem caps the overall score: one open door matters more than many tidy rooms.
  const crit = checks.filter((c) => c.status === 'fail' && c.severity === 'critical').length;
  if (crit) overall = Math.min(overall, 49 - Math.min(crit - 1, 4) * 5);
  return { categories: cats, overall, grade: grade(overall), critical: crit };
}

export function grade(s) { return s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : s >= 40 ? 'D' : 'F'; }

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const EFFORT_RANK = { quick: 0, hours: 1, day: 2 };
export const EFFORT_LABEL = { quick: 'under an hour', hours: 'a few hours', day: 'about a day' };
export function priorities(checks) {
  return checks.filter((c) => c.status === 'fail' || c.status === 'warn')
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1) || EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort])
    .map((c) => ({ ...c, bucket: c.severity === 'critical' || c.severity === 'high' ? 'Fix before launch' : c.severity === 'medium' ? 'Fix this month' : 'Nice to have' }));
}
