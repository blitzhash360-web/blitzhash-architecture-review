// Secret detection. We only ever report the KIND of secret and where it is, never the value.

const PATTERNS = [
  { kind: 'Stripe secret key', re: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}/g },
  { kind: 'Stripe webhook signing secret', re: /\bwhsec_[0-9A-Za-z]{16,}/g },
  { kind: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-)?(?!ant-)[A-Za-z0-9_-]{32,}/g },
  { kind: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { kind: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'Private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { kind: 'Database URL with password', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s'"`/]+:([^@\s'"`]+)@/g, check: (m) => !/^(\[.*\]|<.*>|\$\{.*\}|password|your[-_]?password|pass|postgres|xxx+|\*+)$/i.test(m[1]) },
  { kind: 'Supabase service_role key', re: /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g, check: (m) => jwtRole(m[1]) === 'service_role' },
];

function jwtRole(payload) {
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role; } catch { return null; }
}

/** Returns [{ kind, line }] for each secret-looking value in text. Values are never returned. */
export function findSecrets(text) {
  const hits = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text))) {
      if (p.check && !p.check(m)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      hits.push({ kind: p.kind, line });
    }
  }
  return hits;
}

/** Replace anything secret-looking with a label. Used on every string we print or write. */
export function redact(text) {
  let out = String(text);
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    out = out.replace(p.re, (...args) => {
      const m = args.slice(0, -2); m.index = args[args.length - 2];
      return p.check && !p.check(m) ? args[0] : `[redacted ${p.kind}]`;
    });
  }
  return out;
}

export const containsSecret = (text) => findSecrets(String(text)).length > 0;
