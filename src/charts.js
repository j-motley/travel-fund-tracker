// ===================== charts.js — formatting + SVG drawing =====================
const usd = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 });
const usd2 = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:2 });
const mon = (y, m) => `${MONTHS[m]} ${y}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function nice(raw){ const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function short(v){ const a = Math.abs(v); return (v < 0 ? '-$' : '$') + (a >= 1000 ? (a / 1000).toFixed(a % 1000 ? 1 : 0) + 'k' : Math.round(a)); }
function shortK(v){ return v >= 1000 ? '$' + (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : usd.format(v); }
const PLANE_D = 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z';
// plane glyph pointing right, centered on 0,0
function planeGlyph(size, fill){ const k = size / 24; return `<g transform="scale(${k}) rotate(90) translate(-12,-12)"><path d="${PLANE_D}" fill="${fill}" stroke="var(--surface)" stroke-width="1.4"/></g>`; }
function stampShape(){
  return `<rect x="-13" y="-13" width="26" height="26" rx="3" fill="var(--gold-fill)" stroke="var(--surface)" stroke-width="2" stroke-dasharray="3 2"/>
    <path d="M0 9 V-1 M0 -1 C-6 -6 -9 -3 -9 -3 M0 -1 C6 -6 9 -3 9 -3 M0 -1 C-3 -8 -7 -8 -7 -8 M0 -1 C3 -8 7 -8 7 -8" stroke="#1b1300" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
}
const statusColor = (o, s) => o.lowest.bal < 0 ? 'var(--danger)' : o.lowest.bal < s.cushion ? 'var(--gold)' : 'var(--good)';

// ---------- fuel chart (main) ----------
// opts: { W, interactive, trackK, ghost }
function drawFuel(o, s, svg, opts){
  const W = Math.max(300, Math.round(opts.W)), narrow = W < 560;
  const L = narrow ? 46 : 64, R = 14, T = 28, PH = Math.round(Math.min(320, Math.max(190, W * 0.34))), gap = 30, BH = narrow ? 64 : 90;
  const H = T + PH + gap + BH + 18;
  const n = o.months.length, plotW = W - L - R, x = i => L + (i + 0.5) / n * plotW;
  const vals = o.months.map(r => r.bal).concat(opts.ghost || [], opts.planLine || [], (opts.actualPts || []).map(p => p.bal));
  let lo = Math.min(0, ...vals), hi = Math.max(...vals, s.cushion);
  const step = nice((hi - lo) / (narrow ? 3 : 4)); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi * 1.05 / step) * step;
  const y = v => T + (hi - v) / (hi - lo) * PH;
  const by = T + PH + gap;
  const bmax = Math.max(15000, ...o.years.map(r => Math.max(r.budget, r.tripTotal))) * 1.18;
  const bh = v => v / bmax * BH;
  let g = '';
  for (let v = lo; v <= hi + 1e-6; v += step){
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(${v === 0 ? '--muted' : '--grid'})" stroke-width="${v === 0 ? 1.5 : 1}"/>`;
    g += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" class="num">${short(v)}</text>`;
  }
  const yearW = plotW / (n / 12), stride = Math.max(1, Math.ceil(30 / yearW));   // label every Nth year when they get tight
  o.years.forEach((r, yi) => {
    const idx = o.months.findIndex(m => m.year === r.year); if (idx < 0) return;
    const x0 = L + idx / n * plotW, x1 = L + (idx + r.months) / n * plotW, yw = x1 - x0;
    if (stride === 1 || yi % stride === 0) g += `<line x1="${x0}" x2="${x0}" y1="${T}" y2="${by + BH}" stroke="var(--grid)"/>`;
    const showLabel = stride === 1 ? yw > 16 : yi % stride === 0 && r.months >= 6;
    if (showLabel) g += `<text x="${(x0 + x1) / 2}" y="${by - 10}" text-anchor="middle" font-size="11" fill="var(--muted)" font-weight="600">${yw < 44 || r.months < 4 ? "'" + String(r.year).slice(2) : r.year}</text>`;
    const bw = Math.max(2, yw - (yw < 20 ? 2 : narrow ? 4 : 10)), bx = (x0 + x1) / 2 - bw / 2;
    const spend = Math.max(r.budget, r.tripTotal), col = r.override !== null ? 'var(--danger)' : 'var(--primary)';
    g += `<g class="bar" data-year="${r.year}"${opts.interactive ? ` tabindex="0" role="slider" aria-label="${r.year} travel budget" aria-valuetext="${usd.format(r.budget)}" aria-valuenow="${Math.round(r.budget)}" aria-valuemin="0" aria-valuemax="60000"` : ''}>`;
    g += `<rect x="${bx - 2}" y="${by}" width="${bw + 4}" height="${BH}" fill="transparent"/>`;
    g += `<rect class="body" x="${bx}" y="${by + BH - bh(spend)}" width="${bw}" height="${Math.max(0, bh(spend))}" rx="4" fill="${col}" fill-opacity="${r.override !== null ? .85 : .5}"/>`;
    if (r.tripTotal > 0) g += `<rect x="${bx}" y="${by + BH - bh(r.tripTotal)}" width="${bw}" height="${bh(r.tripTotal)}" rx="4" fill="var(--gold-fill)"/>`;
    if (opts.interactive && bw >= 20) g += `<rect x="${bx + bw / 2 - 9}" y="${by + BH - bh(spend) - 3}" width="18" height="4" rx="2" fill="${col}"/>`;
    if (bw >= 30 && r.months >= 4) g += `<text x="${bx + bw / 2}" y="${by + BH - bh(spend) - 8}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink)" class="num">${shortK(spend)}</text>`;
    g += `<title>${r.year}: ${usd.format(spend)} for travel${r.tripTotal ? ` (${usd.format(r.tripTotal)} in trips)` : ''}${opts.interactive ? '. Drag to change, double-click to reset.' : ''}</title></g>`;
  });
  g += `<text x="${L - 8}" y="${by + BH / 2 + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${narrow ? 'Trips' : 'Travel'}</text>`;
  if (!narrow) g += `<text x="${L - 8}" y="${by + BH / 2 + 18}" text-anchor="end" font-size="11" fill="var(--muted)">budget</text>`;
  // reserve
  g += `<line x1="${L}" x2="${W - R}" y1="${y(s.cushion)}" y2="${y(s.cushion)}" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="5 5"/>`;
  g += `<text x="${W - R}" y="${y(s.cushion) - 6}" text-anchor="end" font-size="11" fill="var(--gold)" font-weight="700">Reserve ${usd.format(s.cushion)}</text>`;
  // landing
  if (o.nLoan < n){
    const px = L + o.nLoan / n * plotW;
    g += `<line x1="${px}" x2="${px}" y1="${T}" y2="${T + PH}" stroke="var(--muted)" stroke-dasharray="3 4"/>`;
    const lbl = W < 760 ? 'Debt-free' : `Debt-free: ${usd.format(s.monthly)}/mo now all goes to the fund`, room = W - R - px;
    const flip = room < lbl.length * 5.6 + 12;   // not enough room on the right: put the label on the left of the line
    g += `<text x="${flip ? px - 6 : px + 6}" y="${T + 11}" text-anchor="${flip ? 'end' : 'start'}" font-size="11" fill="var(--muted)">${lbl}</text>`;
  }
  if (o.lowest.bal < 0) g += `<rect x="${L}" y="${y(0)}" width="${plotW}" height="${T + PH - y(0)}" fill="var(--danger-soft)" opacity=".75"/>`;
  if (opts.ghost) g += `<path d="${opts.ghost.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round"/>`;
  if (opts.planLine) g += `<path d="${opts.planLine.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}" fill="none" stroke="var(--primary)" stroke-opacity=".45" stroke-width="2" stroke-dasharray="7 5"/>`;
  const pts = o.months.map((r, i) => `${x(i).toFixed(1)},${y(r.bal).toFixed(1)}`);
  g += `<path d="M${x(0)},${y(Math.max(lo, 0))} L${pts.join(' L')} L${x(n - 1)},${y(Math.max(lo, 0))} Z" fill="var(--primary)" fill-opacity=".09"/>`;
  g += `<path d="M${pts.join(' L')}" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
  // lowest point
  const lc = statusColor(o, s), lx = x(o.lowest.m - 1), ly = y(o.lowest.bal), anc = lx > W - 170 ? 'end' : 'start';
  g += `<circle cx="${lx}" cy="${ly}" r="6" fill="var(--surface)" stroke="${lc}" stroke-width="3"/>`;
  g += `<text x="${lx + (anc === 'end' ? -10 : 10)}" y="${ly + (ly > T + PH - 30 ? -12 : 18)}" text-anchor="${anc}" font-size="12" font-weight="700" fill="${lc}">Lowest ${usd.format(o.lowest.bal)}</text>`;
  // actual balances from check-ins
  const ap = opts.actualPts || [];
  if (ap.length){
    if (ap.length > 1) g += `<polyline points="${ap.map(p => `${x(p.k).toFixed(1)},${y(p.bal).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>`;
    ap.forEach(p => { g += `<circle cx="${x(p.k)}" cy="${y(p.bal)}" r="5" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"><title>Actual balance, ${mon(+p.ym.slice(0, 4), +p.ym.slice(5) - 1)}: ${usd.format(p.bal)}</title></circle>`; });
    const lp = ap.at(-1), la = x(lp.k) > W - 140 ? 'end' : 'start';
    g += `<text x="${x(lp.k) + (la === 'end' ? -9 : 9)}" y="${y(lp.bal) - 9}" text-anchor="${la}" font-size="11" font-weight="700" fill="var(--ink)">Actual ${usd.format(lp.bal)}</text>`;
  }
  // trip stamps
  (s.trips || []).forEach(t => {
    const i = o.months.findIndex(m => m.year === t.year && m.month === t.month); if (i < 0) return;
    g += `<g class="stamp" data-id="${t.id}" transform="translate(${x(i)},${y(o.months[i].bal)})">
      <line x1="0" y1="0" x2="0" y2="-26" stroke="var(--gold-fill)" stroke-width="2"/>
      <g transform="translate(0,-38) scale(${narrow ? .8 : .95})">${stampShape()}</g>
      <title>${esc(t.name || 'Trip')}: ${usd.format(t.cost || 0)} in ${mon(t.year, t.month)}.${opts.interactive ? ' Drag sideways to move it.' : ''}</title></g>`;
  });
  // the plane = where the trip (loan) is right now
  const tk = opts.trackK;
  if (tk !== undefined && tk !== null && tk >= 0){
    const i = Math.max(0, Math.min(n - 1, tk)), a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const ang = Math.atan2(y(o.months[b].bal) - y(o.months[a].bal), x(b) - x(a)) * 180 / Math.PI;
    g += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${T + PH}" stroke="var(--primary)" stroke-opacity=".35" stroke-width="1.5"/>`;
    g += `<g transform="translate(${x(i)},${y(o.months[i].bal)}) rotate(${ang})">${planeGlyph(narrow ? 22 : 28, 'var(--primary)')}</g>`;
  }
  if (opts.interactive){
    g += `<g id="hover" opacity="0"><line id="hoverLine" y1="${T}" y2="${T + PH}" stroke="var(--ink)" stroke-opacity=".3"/><circle id="hoverDot" r="5" fill="var(--ink)"/></g>`;
    g += `<rect id="hit" x="${L}" y="${T}" width="${plotW}" height="${PH}" fill="transparent" style="cursor:crosshair"/>`;
  }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g;
  if (opts.interactive) svg.querySelectorAll('.stamp').forEach(el => svg.appendChild(el));
  return { x, y, n, L, R, T, PH, W, by, BH, bmax };
}

// ---------- mini chart ----------
function drawMini(o, s, svg, W, ghost, actualPts){
  W = Math.max(280, Math.round(W)); const H = 200, L = 46, R = 10, T = 14, B = 24, n = o.months.length;
  const vals = o.months.map(r => r.bal).concat(ghost || [], (actualPts || []).map(p => p.bal));
  let lo = Math.min(0, ...vals), hi = Math.max(...vals, s.cushion);
  const step = nice((hi - lo) / 3); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi * 1.05 / step) * step;
  const x = i => L + i / (n - 1) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  let g = '';
  for (let v = lo; v <= hi + 1e-6; v += step){
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(${v === 0 ? '--muted' : '--grid'})"/>`;
    g += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${short(v)}</text>`;
  }
  const every = Math.max(1, Math.ceil(34 / ((W - L - R) / (n / 12))));
  o.months.forEach((r, i) => { if (r.month === 0 && i > 0 && (r.year % every === 0)) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">'${String(r.year).slice(2)}</text>`; });
  g += `<line x1="${L}" x2="${W - R}" y1="${y(s.cushion)}" y2="${y(s.cushion)}" stroke="var(--gold)" stroke-dasharray="4 4"/>`;
  if (o.lowest.bal < 0) g += `<rect x="${L}" y="${y(0)}" width="${W - L - R}" height="${H - B - y(0)}" fill="var(--danger-soft)" opacity=".75"/>`;
  if (ghost) g += `<polyline points="${ghost.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="2 5"/>`;
  g += `<polyline points="${o.months.map((r, i) => `${x(i).toFixed(1)},${y(r.bal).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round"/>`;
  (s.trips || []).forEach(t => {
    const i = o.months.findIndex(m => m.year === t.year && m.month === t.month); if (i < 0) return;
    g += `<g transform="translate(${x(i)},${y(o.months[i].bal) - 16}) scale(.55)">${stampShape()}<title>${esc(t.name || 'Trip')}, ${mon(t.year, t.month)}</title></g>`;
  });
  (actualPts || []).forEach(p => { g += `<circle cx="${x(p.k)}" cy="${y(p.bal)}" r="4" fill="var(--ink)"><title>Actual ${usd.format(p.bal)}</title></circle>`; });
  g += `<circle cx="${x(o.lowest.m - 1)}" cy="${y(o.lowest.bal)}" r="5" fill="var(--surface)" stroke="${statusColor(o, s)}" stroke-width="2.5"/>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g;
}

// ---------- loan split ----------
function drawSplit(o, s, svg, W){
  W = Math.max(280, Math.round(W)); const H = 112, total = Math.max(1, s.loanAmount), debt = Math.min(s.debts, total), fund = Math.max(0, total - debt);
  const w1 = debt / total * W;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `<rect x="0" y="6" width="${Math.max(0, w1 - 2)}" height="40" rx="8" fill="var(--muted)" fill-opacity=".4"/>
    <rect x="${w1 + 2}" y="6" width="${Math.max(0, W - w1 - 2)}" height="40" rx="8" fill="var(--primary)"/>
    <text x="2" y="72" font-size="12" fill="var(--muted)">Pays off debts</text>
    <text x="2" y="96" font-size="18" font-weight="700" fill="var(--ink)" class="num">${usd.format(debt)}</text>
    <text x="${W - 2}" y="72" text-anchor="end" font-size="12" fill="var(--primary)">Fills the travel fund tank</text>
    <text x="${W - 2}" y="96" text-anchor="end" font-size="18" font-weight="700" fill="var(--ink)" class="num">${usd.format(fund)}</text>`;
}

// ---------- flight tracker arc ----------
const ARC = { W:1000, H:250, p0:[70,212], c:[500,-20], p1:[930,212] };
ARC.table = (() => {
  const pts = [], N = 240; let len = 0;
  for (let i = 0; i <= N; i++){
    const t = i / N, u = 1 - t;
    const p = [u * u * ARC.p0[0] + 2 * u * t * ARC.c[0] + t * t * ARC.p1[0], u * u * ARC.p0[1] + 2 * u * t * ARC.c[1] + t * t * ARC.p1[1]];
    if (i) len += Math.hypot(p[0] - pts[i - 1].p[0], p[1] - pts[i - 1].p[1]);
    pts.push({ t, p, len });
  }
  pts.forEach(q => q.f = q.len / len);
  return pts;
})();
function arcPoint(f){
  f = Math.max(0, Math.min(1, f)); const tb = ARC.table;
  let i = tb.findIndex(q => q.f >= f); if (i <= 0) i = 1;
  const a = tb[i - 1], b = tb[i], k = (f - a.f) / ((b.f - a.f) || 1);
  return { x:a.p[0] + (b.p[0] - a.p[0]) * k, y:a.p[1] + (b.p[1] - a.p[1]) * k, ang:Math.atan2(b.p[1] - a.p[1], b.p[0] - a.p[0]) * 180 / Math.PI };
}
function drawArc(svg, o, s, f, showLabels, big){
  const sw = big ? 2 : 1;
  const tb = ARC.table, upto = tb.filter(q => q.f <= f).map(q => q.p);
  const pl = arcPoint(f); upto.push([pl.x, pl.y]);
  const all = tb.map(q => q.p.map(v => v.toFixed(1)).join(',')).join(' ');
  let g = '';
  // stars (dark theme only via css var)
  g += `<g class="stars">${[[60,30],[140,70],[230,24],[330,58],[420,18],[610,40],[700,16],[780,62],[870,28],[960,54],[520,78],[180,120],[820,110]].map(([a, b], i) => `<circle cx="${a}" cy="${b}" r="${i % 3 ? 1.4 : 2}" fill="#fff" opacity=".8"/>`).join('')}</g>`;
  // clouds
  const cloud = (cx, cy, k) => `<g transform="translate(${cx},${cy}) scale(${k})" fill="var(--cloud)" opacity=".9"><ellipse cx="0" cy="0" rx="46" ry="16"/><ellipse cx="-20" cy="-10" rx="22" ry="16"/><ellipse cx="14" cy="-14" rx="26" ry="20"/></g>`;
  g += cloud(190, 150, 1) + cloud(800, 120, .8) + cloud(520, 200, .7) + cloud(360, 70, .55);
  // year waypoints
  const wpStep = Math.max(1, Math.ceil(o.nLoan / 12 / 7));   // at most about 7 waypoints along the route
  for (let m = 12 - (s.startMonth - 1), wi = 0; m < o.nLoan; m += 12, wi++){
    if (wi % wpStep) continue;
    const q = arcPoint(m / o.nLoan), yr = s.startYear + Math.floor((s.startMonth - 1 + m) / 12);
    g += `<circle cx="${q.x}" cy="${q.y}" r="${5 * sw}" fill="var(--surface)" stroke="var(--muted)" stroke-width="${2 * sw}"/>`;
    if (showLabels) g += `<text x="${q.x}" y="${q.y - 14}" text-anchor="middle" font-size="16" font-weight="600" fill="var(--muted)">${yr}</text>`;
  }
  g += `<polyline points="${all}" fill="none" stroke="var(--muted)" stroke-opacity=".6" stroke-width="${3 * sw}" stroke-dasharray="${2 * sw} ${10 * sw}" stroke-linecap="round"/>`;
  if (upto.length > 1) g += `<polyline points="${upto.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--primary)" stroke-width="${5 * sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
  // airports
  g += `<circle cx="${ARC.p0[0]}" cy="${ARC.p0[1]}" r="${11 * sw}" fill="var(--primary)"/><circle cx="${ARC.p0[0]}" cy="${ARC.p0[1]}" r="${4.5 * sw}" fill="var(--surface)"/>`;
  g += `<circle cx="${ARC.p1[0]}" cy="${ARC.p1[1]}" r="${11 * sw}" fill="${f >= 1 ? 'var(--good)' : 'var(--surface)'}" stroke="var(--good)" stroke-width="3"/>`;
  g += `<path d="M${ARC.p1[0] - 5 * sw} ${ARC.p1[1]}l${3.5 * sw} ${3.5 * sw} ${6.5 * sw}-${7 * sw}" stroke="${f >= 1 ? 'var(--surface)' : 'var(--good)'}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  // plane with a soft shadow
  g += `<g id="arcPlane" transform="translate(${pl.x},${pl.y}) rotate(${pl.ang})">${planeGlyph(big ? 96 : 48, 'var(--primary)')}</g>`;
  svg.innerHTML = g;
}
