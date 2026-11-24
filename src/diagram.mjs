// Self-contained HTML + SVG architecture picture a non-engineer can follow.
// Original BlitzHash drawing (no third-party diagram code). Mermaid remains in the Markdown report.
import { dataFlow, serviceName } from './map.mjs';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unique(list) {
  const out = [];
  for (const x of list) if (x && !out.includes(x)) out.push(x);
  return out;
}

function groupsFromMap(map) {
  const browser = unique([
    ...(map.stack.Frontend || []),
    map.pages ? `${map.pages} page${map.pages === 1 ? '' : 's'} in the browser` : null,
  ]);
  const server = unique([
    ...(map.stack.Backend || []),
    map.routes.length ? `${map.routes.length} API route${map.routes.length === 1 ? '' : 's'}` : null,
    ...(map.stack.Hosting || []),
  ]);
  const auth = unique(map.stack.Auth || []);
  const data = unique([
    ...(map.stack.Database || []),
    map.sql?.tables?.length ? `${map.sql.tables.length} table${map.sql.tables.length === 1 ? '' : 's'}` : null,
    ...(map.stack.Files || []),
  ]);
  const vendors = unique([
    ...(map.stack.Payments || []),
    ...(map.stack.AI || []),
    ...(map.stack.Email || []),
    ...(map.stack.Monitoring || []),
  ]);
  return {
    browser: browser.length ? browser : ['The user’s browser'],
    server: server.length ? server : ['Your server / hosting'],
    auth: auth.length ? auth : ['Auth (not clearly detected)'],
    data: data.length ? data : ['Database (not clearly detected)'],
    vendors: vendors.length ? vendors : ['Third-party APIs (none clearly detected)'],
  };
}

function box(x, y, w, h, title, items, tone) {
  const fill = { browser: '#e8f4fc', server: '#e8f8ef', auth: '#fff4e0', data: '#f3e8ff', vendors: '#fdecea' }[tone] || '#f4f4f5';
  const stroke = { browser: '#1d4f7a', server: '#1b6b45', auth: '#8a5a00', data: '#5b2d8a', vendors: '#8a1f1f' }[tone] || '#333';
  const lines = items.slice(0, 5).map((t, i) => `<text x="${x + 14}" y="${y + 44 + i * 16}" font-size="12" fill="#1a1a1a">${esc(t)}</text>`).join('');
  const more = items.length > 5 ? `<text x="${x + 14}" y="${y + 44 + 5 * 16}" font-size="11" fill="#555">+ ${items.length - 5} more</text>` : '';
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
  <text x="${x + 14}" y="${y + 22}" font-size="13" font-weight="700" fill="${stroke}">${esc(title)}</text>
  ${lines}${more}`;
}

function arrow(x1, y1, x2, y2, label) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 6;
  return `
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#334155" stroke-width="1.5" marker-end="url(#arrow)"/>
  ${label ? `<text x="${mx}" y="${my}" font-size="10" fill="#334155" text-anchor="middle">${esc(label)}</text>` : ''}`;
}

export function toSvg(map, { name = 'your app' } = {}) {
  const g = groupsFromMap(map);
  const flow = dataFlow(map);
  const captions = flow.lines.slice(0, 6).map((l) => {
    const warn = l.warn ? ` Warning: ${l.warn}` : '';
    return `${l.from} → ${l.to}${l.then?.length ? ` → ${l.then.join(', ')}` : ''}: ${l.via}.${warn}`;
  });

  const W = 960;
  const H = 520;
  const parts = [];
  parts.push(box(40, 80, 260, 140, '1. In the browser', g.browser, 'browser'));
  parts.push(box(350, 40, 260, 120, '2. Sign-in / identity', g.auth, 'auth'));
  parts.push(box(350, 180, 260, 150, '3. Your server (keep secrets here)', g.server, 'server'));
  parts.push(box(660, 40, 260, 140, '4. Your database and files', g.data, 'data'));
  parts.push(box(660, 200, 260, 130, '5. Outside services', g.vendors, 'vendors'));
  parts.push(arrow(300, 150, 350, 100, ''));
  parts.push(arrow(300, 160, 350, 240, ''));
  parts.push(arrow(610, 100, 660, 100, ''));
  parts.push(arrow(610, 250, 660, 250, ''));

  const secretNote = 'Secrets, admin keys and webhook signing secrets should only live in box 3 (your server). Anything in box 1 is visible to a curious visitor.';
  const authNote = 'The line between box 1 and boxes 3–5 is the trust boundary. The browser is never trusted on its own.';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Architecture diagram of ${esc(name)}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155"/>
    </marker>
  </defs>
  <rect width="${W}" height="${H}" fill="#f8fafc"/>
  <text x="40" y="32" font-size="20" font-weight="700" fill="#0a1628">How ${esc(name)} is put together</text>
  <text x="40" y="54" font-size="13" fill="#334155">A picture for founders: what runs in the visitor’s browser, what stays on your server, and which outside services you call.</text>
  ${parts.join('\n')}
  <text x="40" y="370" font-size="13" font-weight="700" fill="#0a1628">How to read this</text>
  <text x="40" y="392" font-size="12" fill="#1a1a1a">${esc(authNote)}</text>
  <text x="40" y="412" font-size="12" fill="#1a1a1a">${esc(secretNote)}</text>
</svg>`;
}

export function toHtml(review) {
  const map = review.map;
  const name = review.name || 'your app';
  const flow = dataFlow(map);
  const svg = toSvg(map, { name });
  const bullets = flow.lines.length
    ? flow.lines.map((l) => `<li><strong>${esc(l.from)} → ${esc(l.to)}</strong>: ${esc(l.via)}${l.then?.length ? `, then ${esc(l.then.join(', '))}` : ''}${l.warn ? ` <em>(${esc(l.warn)})</em>` : ''}</li>`).join('\n')
    : '<li>No API routes or direct database calls were found, so there is no data flow to list yet.</li>';
  const stack = Object.entries(map.stack).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v.join(', '))}</td></tr>`).join('\n');
  const routes = (map.routes || []).slice(0, 24).map((rt) => `<tr><td><code>${esc(rt.path)}</code></td><td><code>${esc(rt.file)}</code></td><td>${esc((rt.services || []).map((x) => serviceName(map, x)).join(', ') || '—')}</td></tr>`).join('\n');
  const score = review.score ? `${review.score.overall}/100 (${review.score.grade})` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Architecture diagram: ${esc(name)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; color: #0a1628; background: #fff; }
    main { max-width: 980px; margin: 0 auto; padding: 24px 20px 64px; }
    h1 { font-size: 1.6rem; margin: 0 0 8px; }
    .lede { color: #334155; margin: 0 0 24px; }
    .frame { border: 1px solid #dbe3ee; border-radius: 16px; overflow: hidden; background: #f8fafc; }
    h2 { font-size: 1.15rem; margin: 32px 0 8px; }
    table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    th { width: 30%; color: #334155; font-weight: 600; }
    footer { margin-top: 40px; font-size: 0.85rem; color: #64748b; }
    a { color: #0f766e; }
  </style>
</head>
<body>
  <main>
    <h1>Architecture diagram: ${esc(name)}</h1>
    <p class="lede">A self-contained picture of this app for a non-engineer. Nothing was changed, nothing was sent anywhere, and no secret values are shown.${score ? ` Review score: ${esc(score)}.` : ''}</p>
    <div class="frame">${svg}</div>
    <h2>How data moves, in words</h2>
    <ul>${bullets}</ul>
    <h2>What we think the app is built with</h2>
    <table>${stack || '<tr><td>Stack not recognised from package files.</td></tr>'}</table>
    ${routes ? `<h2>API routes and functions</h2><table><thead><tr><th>Route</th><th>File</th><th>Talks to</th></tr></thead><tbody>${routes}</tbody></table>` : ''}
    <footer>
      <p>Generated by <a href="https://github.com/blitzhash360-web/blitzhash-architecture-review">blitzhash-architecture-review</a> v1.1.0. The SVG is original BlitzHash work. The idea of a founder-friendly architecture picture was inspired by <a href="https://github.com/cathrynlavery/diagram-design">cathrynlavery/diagram-design</a> (MIT); no code from that project is included.</p>
      <p>Built by <a href="https://blitzhash.com">BlitzHash</a>.</p>
    </footer>
  </main>
</body>
</html>
`;
}
