// ===================== ui.js — state, rendering, interactions =====================
const STORE_KEY = 'loan-travel-fund-planner';
const K_THEME = STORE_KEY + ':theme', K_VIEW = STORE_KEY + ':view', K_TOUR = STORE_KEY + ':tour-seen', K_CSV = STORE_KEY + ':csv';
const VIEWS = ['tracker','plan','trips','log','actuals','loan'];
const SLIDERS = {
  loanAmount:{label:'Loan amount', min:10000, max:100000, step:500},
  loanRate:{label:'Interest rate (% a year)', min:3, max:15, step:0.05},
  termYears:{label:'Loan term (years)', min:1, max:25, step:1},
  debts:{label:'Debts paid off from the loan', min:0, max:100000, step:500},
  monthly:{label:'Set aside each month', min:500, max:4000, step:25},
  apy:{label:'Savings account APY (%)', min:0, max:6, step:0.05},
  firstYearSpend:{label:'Spend in the first travel year', min:0, max:30000, step:250},
  defaultSpend:{label:'Spend each year after that', min:0, max:30000, step:250},
  cushion:{label:'Reserve: never let the fund drop below', min:0, max:10000, step:250},
};
const PLAIN = ['startMonth','startYear','firstTravelYear'];
const $ = id => document.getElementById(id);
const store = { get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch(e){} } };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function load(){
  try { const raw = store.get(STORE_KEY);
    if (raw){ const o = JSON.parse(raw); return { ...DEFAULTS, ...o, overrides:{ ...(o.overrides || {}) }, trips:Array.isArray(o.trips) ? o.trips : [], actuals:normalizeActuals(o.actuals) }; } } catch(e){}
  return { ...structuredClone(DEFAULTS), actuals:emptyActuals() };
}
let state = load(), ghost = null, last = null, geo = null, oPlan = null;
let trackK = 0, trackManual = false, playing = false, lastStatusWord = '';
const save = () => store.set(STORE_KEY, JSON.stringify(state));
const today = new Date();
const todayK = () => monthIndexOf(state, today.getFullYear(), today.getMonth());
const trackMin = () => -6, trackMax = () => (last ? last.nLoan : 60) + 6;

// ---------- theme ----------
const currentTheme = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
function paintThemeBtn(){
  const dark = currentTheme() === 'dark', b = $('themeBtn');
  b.setAttribute('aria-pressed', String(dark));
  b.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  b.title = b.getAttribute('aria-label');
  b.innerHTML = `<svg class="i"><use href="#i-${dark ? 'sun' : 'moon'}"/></svg>`;
}
function setTheme(t){ document.documentElement.setAttribute('data-theme', t); store.set(K_THEME, t); paintThemeBtn(); }

// ---------- tabs ----------
let currentView = 'tracker';
function showView(v, focusTab){
  if (!VIEWS.includes(v)) v = 'tracker';
  currentView = v;
  VIEWS.forEach(name => {
    const on = name === v, tab = $('tab-' + name);
    tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1;
    $('view-' + name).hidden = !on;
  });
  if (focusTab) $('tab-' + v).focus();
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  store.set(K_VIEW, v);
  hideReadout();
  if (last) drawCharts(last);
}
function wireTabs(){
  const tabs = [...document.querySelectorAll('.tab')];
  tabs.forEach(t => t.addEventListener('click', () => { showView(t.dataset.view); window.scrollTo({ top:0 }); }));
  document.querySelector('.tabs').addEventListener('keydown', e => {
    const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    const j = { ArrowRight:(i + 1) % tabs.length, ArrowLeft:(i - 1 + tabs.length) % tabs.length, Home:0, End:tabs.length - 1 }[e.key];
    if (j !== undefined){ e.preventDefault(); showView(tabs[j].dataset.view, true); }
  });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
}

// ---------- controls ----------
function buildControls(){
  document.querySelectorAll('.ctl[data-f]').forEach(el => {
    const f = el.dataset.f, c = SLIDERS[f];
    el.innerHTML = `<label for="${f}">${c.label}</label>
      <input type="number" id="${f}" min="${c.min}" max="${c.max}" step="${c.step}" inputmode="decimal">
      <input type="range" id="${f}_r" min="${c.min}" max="${c.max}" step="${c.step}" aria-label="${c.label}">`;
    const num = $(f), rng = $(f + '_r');
    const set = v => {
      if (isNaN(v)) return;
      state[f] = f === 'termYears' ? Math.max(1, Math.min(25, Math.round(v))) : v;
      if (f === 'loanAmount' && state.debts > state.loanAmount){ state.debts = state.loanAmount; syncOne('debts'); }
      syncOne(f); if (f === 'termYears') syncPlan(); update();
    };
    num.addEventListener('input', () => set(parseFloat(num.value)));
    rng.addEventListener('input', () => set(parseFloat(rng.value)));
  });
  const setPlan = v => { if (isNaN(v)) return; state.planYears = Math.max(Math.round(state.termYears), Math.min(25, Math.round(v))); syncPlan(); update(); };
  $('planYears').addEventListener('input', e => setPlan(parseFloat(e.target.value)));
  $('planYears').addEventListener('change', e => { e.target.value = planYearsOf(state); syncPlan(); });
  $('planYears_r').addEventListener('input', e => setPlan(parseFloat(e.target.value)));
  $('planAuto').addEventListener('change', e => { state.planYears = e.target.checked ? 'auto' : planYearsOf(state); syncPlan(); update(); });
  $('startMonth').innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  PLAIN.forEach(f => $(f).addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v)){ state[f] = v; if (!trackManual) trackK = todayK(); update(); } }));
}
function syncOne(f){
  const c = SLIDERS[f], num = $(f), rng = $(f + '_r');
  const max = f === 'debts' ? state.loanAmount : c.max;
  rng.max = max; num.max = max;
  if (document.activeElement !== num) num.value = state[f];
  rng.value = state[f];
  rng.style.setProperty('--p', ((Math.min(max, Math.max(c.min, state[f])) - c.min) / ((max - c.min) || 1) * 100) + '%');
}
function syncPlan(){
  const H = planYearsOf(state), auto = state.planYears === 'auto' || state.planYears == null, term = Math.round(state.termYears);
  const num = $('planYears'), rng = $('planYears_r');
  num.min = rng.min = term; if (document.activeElement !== num) num.value = H; rng.value = H; num.disabled = rng.disabled = auto; $('planAuto').checked = auto;
  rng.style.setProperty('--p', (25 === term ? 100 : (H - term) / (25 - term) * 100) + '%');
  $('planNote').textContent = auto ? `${H} years: the ${term}-year loan plus 3 years after it's paid off.` : H === term ? `${H} years, the same as the loan. It can't be shorter than the loan.` : `${H} years: the ${term}-year loan plus ${H - term} after it's paid off.`;
}
function syncAll(){ syncPlan(); Object.keys(SLIDERS).forEach(syncOne); PLAIN.forEach(f => { if (document.activeElement !== $(f)) $(f).value = state[f]; }); }

// ---------- wording ----------
const flightNo = () => `LT${String(state.startYear).slice(2)}${String(state.startMonth).padStart(2, '0')}`;
const statusWord = o => o.status === 'ok' ? 'ON TIME' : o.status === 'warn' ? 'TURBULENCE' : 'OUT OF FUEL';
function verdictText(o){
  const low = `${usd.format(o.lowest.bal)} in ${mon(o.lowest.year, o.lowest.month)}`, res = usd.format(state.cushion);
  if (o.status === 'bad') return { head:`Out of fuel in ${mon(o.firstDry.year, o.firstDry.month)}`, sub:`Fuel bottoms out at ${low}. Lower a year's budget, move a trip later, or try Find my max on the Flight plan tab.` };
  if (o.status === 'warn') return { head:'Turbulence: you dip into your reserve', sub:`Fuel drops to ${low}, under your ${res} reserve. Trim a year's budget or move a trip later.` };
  return { head:`Lands with ${usd.format(o.finalPay.bal)} in the tank`, sub:`The tightest point is ${low}, and your ${res} reserve stays intact. After landing, all ${usd.format(state.monthly)} a month goes into the fund.` };
}

// ---------- render ----------
// The plan as set, and (when a check-in exists) the forecast restarted from the latest real balance.
function calcNow(){ const anchor = latestAnchor(state); oPlan = calc(state); return anchor ? calc(state, { anchor }) : oPlan; }
function update(opts){ save(); render(calcNow(), opts); }
const useActualTrack = () => A().trackBy === 'actual' || (A().trackBy !== 'plan' && hasLoanActuals(state));
function trackerFor(o, k){
  const t = trackerAt(o, state, k);
  const pt = fundPoints(state).find(p => p.k === k); if (pt) t.fuel = pt.bal;
  if (!useActualTrack()) return t;
  const la = loanActual(state, o, k, todayK());
  t.actual = true; t.paid = Math.round(la.paidEq); t.paidSoFar = la.paidAmt; t.leftToPay = la.bal; t.progress = Math.min(1, la.paidEq / o.nLoan);
  t.phase = la.bal <= 0.5 ? 'landed' : (k < 0 && la.paidAmt === 0) ? 'gate' : 'flying';
  return t;
}
function render(o, opts){
  last = o;
  // departure board
  $('bFlight').textContent = flightNo();
  $('bDep').textContent = mon(state.startYear, state.startMonth - 1);
  $('bArr').textContent = mon(o.finalPay.year, o.finalPay.month);
  $('bLow').textContent = `${usd.format(o.lowest.bal)} ${MONTHS[o.lowest.month]} ${o.lowest.year}`;
  const word = statusWord(o), fl = $('bFlaps');
  fl.className = 'flaps ' + o.status;
  if (word !== lastStatusWord){
    fl.innerHTML = [...word].map((ch, i) => `<span class="flap${lastStatusWord && !reduced() ? ' flip' : ''}" style="animation-delay:${i * 35}ms">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
    fl.setAttribute('aria-label', word.toLowerCase()); lastStatusWord = word;
  }
  // boarding pass
  const vt = verdictText(o);
  $('pFlight').textContent = flightNo();
  const v = $('verdict'); v.className = 'verdict ' + o.status; v.textContent = vt.head; $('verdictSub').textContent = vt.sub;
  $('kPay').textContent = usd2.format(o.payment) + '/mo';
  $('kInt').textContent = usd.format(o.totalInterest);
  $('kDep').textContent = usd2.format(o.depLoan) + '/mo'; $('kDep').className = 'v ' + (o.depLoan < 0 ? 'neg' : '');
  $('kDep2').textContent = usd2.format(o.depAfter) + '/mo';
  $('kLow').textContent = usd.format(o.lowest.bal); $('kLow').className = 'v ' + (o.lowest.bal < 0 ? 'neg' : '');
  $('kEnd').textContent = usd.format(o.months.at(-1).bal);
  $('kEndLbl').textContent = `Fuel in ${o.H} years`;
  $('fuelTitle').textContent = `Fuel over ${o.H} years`;
  $('miniSub').textContent = `Fuel over ${o.H} years with these settings.`;
  // calculated (locked) values
  const rows = [
    ['Monthly loan payment', usd2.format(o.payment)],
    ['Total interest over the loan', usd.format(o.totalInterest)],
    ['Final payment (landing)', mon(o.finalPay.year, o.finalPay.month)],
    ['Travel fund starting balance', usd.format(o.seed), 'Loan amount minus debts paid off'],
    ['Into the fund each month during the loan', usd2.format(o.depLoan), 'Set aside minus the loan payment'],
    ['Into the fund each month after the loan', usd2.format(o.depAfter)],
    ['Lowest fuel', `${usd.format(o.lowest.bal)}, ${mon(o.lowest.year, o.lowest.month)}`],
    ['Plan covers', `${mon(state.startYear, state.startMonth - 1)} to ${mon(o.months.at(-1).year, o.months.at(-1).month)} (${o.H} years)`],
  ];
  $('calcList').innerHTML = rows.map(([k, val, why]) => `<div class="calc-row"${why ? ` title="${why}"` : ''}><span><svg class="i"><use href="#i-lock"/></svg>${k}</span><b class="${val.startsWith('-') ? 'neg' : ''}">${val}</b></div>`).join('');
  $('legend').innerHTML = `<span><i style="background:var(--primary)"></i>Fuel (travel fund)</span><span><i style="background:var(--gold-fill)"></i>Reserve and trips</span><span><i style="background:var(--danger)"></i>Year you changed</span>${ghost ? '<span><i style="background:repeating-linear-gradient(90deg,var(--muted) 0 3px,transparent 3px 7px)"></i>Pinned plan</span>' : ''}${fundPoints(state).length ? '<span><i style="background:var(--ink);height:8px;width:8px;border-radius:50%"></i>Actual balance (check-ins)</span>' : ''}${o.anchor ? '<span><i style="background:repeating-linear-gradient(90deg,var(--primary) 0 6px,transparent 6px 10px);opacity:.5"></i>Original plan</span>' : ''}`;
  const tc = $('tripCount'); tc.hidden = !state.trips.length; tc.textContent = state.trips.length;
  $('splitTitle').textContent = `Where the ${usd.format(state.loanAmount)} goes`;
  // tracker range
  const tr = $('trackRange'); tr.min = trackMin(); tr.max = trackMax();
  if (!trackManual) trackK = todayK();
  trackK = Math.max(trackMin(), Math.min(trackMax(), trackK));
  renderTracker(o);
  drawCharts(o);
  renderTrips(o); renderYears(o); renderLoan(o);
  renderActuals(o, opts);
}

function renderTracker(o, fOverride){
  const t = trackerFor(o, trackK), tr = $('trackRange');
  const fw = $('followWrap'); fw.hidden = !hasLoanActuals(state); $('followSel').value = useActualTrack() ? 'actual' : 'plan';
  tr.value = trackK;
  tr.style.setProperty('--p', ((trackK - trackMin()) / (trackMax() - trackMin()) * 100) + '%');
  $('trackWhen').textContent = mon(t.year, t.month);
  $('todayBtn').disabled = trackK === todayK() ;
  const ph = $('phase'); ph.className = 'phase ' + (t.phase === 'gate' ? 'gate' : t.phase === 'landed' ? 'landed' : '');
  const isToday = trackK === todayK();
  const when = isToday ? '' : ` (as of ${mon(t.year, t.month)})`;
  $('phaseText').textContent = t.phase === 'gate' ? `At the gate. Departs in ${-t.k} month${t.k === -1 ? '' : 's'}${when}`
    : t.phase === 'landed' ? `Landed debt-free in ${mon(o.finalPay.year, o.finalPay.month)}`
    : `In flight, ${Math.round(t.progress * 100)}% of the way${when}${t.actual ? ', from your actual payments' : ''}`;
  $('portDep').textContent = mon(state.startYear, state.startMonth - 1);
  $('portArr').textContent = mon(o.finalPay.year, o.finalPay.month);
  $('mPaid').textContent = `${t.paid} of ${o.nLoan}`;
  $('mPaidAmt').textContent = usd.format(t.paidSoFar);
  $('mLeft').textContent = usd.format(t.leftToPay);
  $('mFuel').textContent = usd.format(t.fuel); $('mFuel').className = 'v ' + (t.fuel < 0 ? 'neg' : '');
  const cap = Math.max(o.seed, t.fuel, ...o.months.slice(0, o.nLoan).map(r => r.bal), state.cushion * 1.5, 1);
  const gi = $('mGauge').querySelector('i'), gb = $('mGauge').querySelector('b');
  gi.style.width = Math.max(0, Math.min(100, t.fuel / cap * 100)) + '%';
  gi.className = t.fuel < 0 ? 'empty' : t.fuel < state.cushion ? 'low' : '';
  gb.style.left = Math.min(100, state.cushion / cap * 100) + '%';
  const arc = $('arc');
  const aw = arc.clientWidth || 1000;
  drawArc(arc, o, state, fOverride !== undefined ? fOverride : t.progress, aw > 560, aw < 560);
}

function drawCharts(o){
  const box = $('chartBox');
  if (box && box.clientWidth){
    geo = drawFuel(o, state, $('chart'), { W:box.clientWidth, interactive:true, trackK, ghost, actualPts:fundPoints(state), planLine:o.anchor ? oPlan.months.map(r => r.bal) : null });
  }
  document.querySelectorAll('svg[data-mini]').forEach(svg => { const w = svg.parentElement.clientWidth; if (w) drawMini(o, state, svg, w, ghost, fundPoints(state)); });
  const sp = $('splitChart'); if (sp.parentElement.clientWidth) drawSplit(o, state, sp, sp.parentElement.clientWidth);
}

function renderYears(o){
  const tb = $('yearRows'), rows = o.years.filter(r => r.months), act = summarizeActuals(state).byYear;
  const aSpent = y => act[y] ? act[y].travel : 0, aIn = y => act[y] ? act[y].deposit + act[y].interest : 0, has = Object.keys(act).length > 0;
  document.querySelectorAll('#logCard th.act').forEach(th => th.hidden = !has);
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.oyear : null;
  const tag = c => `<span class="tag ${c === 'On time' ? 'ok' : c === 'Turbulence' ? 'warn' : 'bad'}">${c}</span>`;
  tb.innerHTML = rows.map(r => `<tr>
    <td>${r.year}${r.months < 12 ? ` <span class="lbl">(${r.months} mo)</span>` : ''}</td>
    <td><input type="number" min="0" step="250" data-oyear="${r.year}" value="${r.override === null ? '' : r.override}" placeholder="—" aria-label="Change the ${r.year} budget"></td>
    <td>${usd.format(r.budget)}</td><td>${r.tripTotal ? usd.format(r.tripTotal) : '—'}</td>
    <td>${usd.format(r.withdrawn)}</td>${has ? `<td class="act">${act[r.year] ? usd.format(aSpent(r.year)) : '—'}</td>` : ''}<td>${usd.format(r.deposits)}</td>${has ? `<td class="act">${act[r.year] ? usd.format(aIn(r.year)) : '—'}</td>` : ''}<td>${usd.format(r.interest)}</td>
    <td class="${r.end < 0 ? 'neg' : ''}">${usd.format(r.end)}</td><td class="${r.low < 0 ? 'neg' : ''}">${usd.format(r.low)}</td>
    <td>${tag(r.check)}</td></tr>`).join('');
  if (focused){ const el = tb.querySelector(`input[data-oyear="${focused}"]`); if (el){ el.focus(); const v = el.value; el.value = ''; el.value = v; } }
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  $('yearFoot').innerHTML = `<tr><td>${o.H} years</td><td></td><td></td><td>${usd.format(sum('tripTotal'))}</td><td>${usd.format(sum('withdrawn'))}</td>${has ? `<td class="act">${usd.format(rows.reduce((a, r) => a + aSpent(r.year), 0))}</td>` : ''}<td>${usd.format(sum('deposits'))}</td>${has ? `<td class="act">${usd.format(rows.reduce((a, r) => a + aIn(r.year), 0))}</td>` : ''}<td>${usd.format(sum('interest'))}</td><td>${usd.format(o.months.at(-1).bal)}</td><td>${usd.format(o.lowest.bal)}</td><td></td></tr>`;
}
function loanByYear(o){
  const byY = {}; o.loan.forEach(p => { const b = byY[p.year] || (byY[p.year] = { paid:0, int:0, prin:0, bal:0 }); b.paid += p.payment; b.int += p.interest; b.prin += p.principal; b.bal = p.balance; });
  return Object.entries(byY);
}
function renderLoan(o){
  $('loanSub').textContent = `${o.nLoan} payments of ${usd2.format(o.payment)} at ${state.loanRate}%, from ${mon(state.startYear, state.startMonth - 1)} to ${mon(o.finalPay.year, o.finalPay.month)}. Total interest ${usd.format(o.totalInterest)}.`;
  let html = '', cur = null;
  o.loan.forEach(p => {
    if (p.year !== cur){ cur = p.year; html += `<tr class="yr"><td colspan="6">${p.year}</td></tr>`; }
    html += `<tr><td>${p.m}</td><td>${MONTHS[p.month]}</td><td>${usd2.format(p.payment)}</td><td>${usd2.format(p.interest)}</td><td>${usd2.format(p.principal)}</td><td>${usd2.format(p.balance)}</td></tr>`;
  });
  $('loanRows').innerHTML = html;
  $('loanYears').innerHTML = loanByYear(o).map(([y, b]) => `<tr><td>${y}</td><td>${usd.format(b.paid)}</td><td>${usd.format(b.int)}</td><td>${usd.format(b.prin)}</td><td>${usd.format(b.bal)}</td></tr>`).join('');
}

// ---------- trips / passport ----------
const STAMP_COLORS = ['var(--primary)','var(--danger)','var(--gold)','var(--good)'];
const hash = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
function passportHTML(trips){
  if (!trips.length) return `<p class="empty-note">No stamps yet. Add a trip below, or click the fuel line on the Flight tracker tab.</p>`;
  return [...trips].sort((a, b) => a.year - b.year || a.month - b.month).map((t, i) => {
    const h = hash(t.id), col = STAMP_COLORS[h % 4], rot = (h % 15) - 7, round = h % 3 === 0;
    return `<span class="pstamp${round ? ' round' : ''}" style="color:${col};--rot:${rot}deg">${esc((t.name || 'Trip').toUpperCase())}<small>${MONTHS[t.month].toUpperCase()} ${t.year}<br>${usd.format(t.cost || 0)}</small></span>`;
  }).join('');
}
function renderTrips(o){
  $('passport').innerHTML = passportHTML(state.trips);
  const ul = $('trips');
  const active = document.activeElement && document.activeElement.closest && document.activeElement.closest('.trip');
  if (!(active && ul.contains(active))){
    ul.innerHTML = [...state.trips].sort((a, b) => a.year - b.year || a.month - b.month).map(t => `<li class="trip" data-id="${t.id}">
      <svg class="pin" viewBox="-14 -14 28 28" aria-hidden="true">${stampShape()}</svg>
      <input aria-label="Trip name" data-k="name" value="${esc(t.name)}" placeholder="Where to?">
      <input aria-label="Month" data-k="when" type="month" value="${t.year}-${String(t.month + 1).padStart(2, '0')}">
      <input aria-label="Cost" data-k="cost" class="cost" type="number" min="0" step="50" value="${t.cost}">
      <button data-act="del" aria-label="Remove ${esc(t.name || 'trip')}">Remove</button></li>`).join('');
  }
  const total = state.trips.reduce((a, t) => a + (Number(t.cost) || 0), 0);
  const over = o.years.filter(r => r.tripTotal > r.budget && r.months);
  $('tripSum').innerHTML = state.trips.length
    ? `${state.trips.length} trip${state.trips.length > 1 ? 's' : ''} planned, ${usd.format(total)} in all.` + (over.length ? ` <span class="neg">Trips go over the budget in ${over.map(r => r.year).join(', ')}, so those years spend more.</span>` : '')
    : '';
}
function addTrip(year, month, focus){
  const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  state.trips.push({ id, name:'', year, month, cost:1500 });
  update();
  if (focus){ const inp = document.querySelector(`.trip[data-id="${id}"] input[data-k="name"]`); if (inp) inp.focus(); }
  toast(`Trip added for ${mon(year, month)}. Name it and set the cost on the Trips tab.`);
}
function wireTrips(){
  const ul = $('trips');
  ul.addEventListener('input', e => {
    const li = e.target.closest('.trip'); if (!li) return;
    const t = state.trips.find(t => t.id === li.dataset.id); if (!t) return;
    const k = e.target.dataset.k;
    if (k === 'name') t.name = e.target.value;
    if (k === 'cost') t.cost = Math.max(0, parseFloat(e.target.value) || 0);
    if (k === 'when' && e.target.value){ const [y, m] = e.target.value.split('-').map(Number); t.year = y; t.month = m - 1; }
    update();
  });
  ul.addEventListener('focusout', () => setTimeout(() => { if (!ul.contains(document.activeElement)) renderTrips(last); }, 0));
  ul.addEventListener('click', e => {
    const b = e.target.closest('button[data-act="del"]'); if (!b) return;
    const id = b.closest('.trip').dataset.id, t = state.trips.find(t => t.id === id);
    state.trips = state.trips.filter(t => t.id !== id); update(); toast(`Removed ${t && t.name ? t.name : 'the trip'}.`);
  });
  $('addTrip').addEventListener('click', () => {
    const r = last.months.find(m => m.year >= state.firstTravelYear) || last.months[0];
    addTrip(r.year, Math.min(11, r.month + 5), true);
  });
}

// ---------- fuel chart interactions ----------
function svgPoint(evt){ const svg = $('chart'); const p = svg.createSVGPoint(); p.x = evt.clientX; p.y = evt.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
function idxAt(px){ return Math.max(0, Math.min(geo.n - 1, Math.round((px - geo.L) / (geo.W - geo.L - geo.R) * geo.n - 0.5))); }
function showReadout(i){
  const r = last.months[i], hv = $('hover'); if (!hv) return;
  hv.setAttribute('opacity', 1);
  $('hoverLine').setAttribute('x1', geo.x(i)); $('hoverLine').setAttribute('x2', geo.x(i));
  $('hoverDot').setAttribute('cx', geo.x(i)); $('hoverDot').setAttribute('cy', geo.y(r.bal));
  const box = $('chartBox').getBoundingClientRect(), k = box.width / geo.W, rd = $('readout');
  const trip = state.trips.filter(t => t.year === r.year && t.month === r.month);
  rd.innerHTML = `${mon(r.year, r.month)}<br><b>${usd.format(r.bal)}</b>${trip.length ? `<br>${trip.map(t => esc(t.name || 'Trip')).join(', ')}` : ''}`;
  rd.style.left = Math.max(70, Math.min(box.width - 70, geo.x(i) * k)) + 'px';
  rd.style.top = (geo.y(r.bal) * k) + 'px';
  rd.classList.add('show');
}
function hideReadout(){ const rd = $('readout'); if (rd) rd.classList.remove('show'); const hv = $('hover'); if (hv) hv.setAttribute('opacity', 0); }
function wireChart(){
  const svg = $('chart'); let drag = null;
  const onMove = e => {
    if (!geo) return;
    const p = svgPoint(e);
    if (drag && drag.kind === 'bar'){
      state.overrides[drag.year] = Math.min(60000, Math.max(0, Math.round(((geo.by + geo.BH - p.y) / geo.BH * geo.bmax) / 250) * 250)); update(); return;
    }
    if (drag && drag.kind === 'stamp'){
      const t = state.trips.find(t => t.id === drag.id), i = idxAt(p.x), r = last.months[i];
      if (t && (t.year !== r.year || t.month !== r.month)){ t.year = r.year; t.month = r.month; update(); }
      showReadout(i); return;
    }
    if (p.x >= geo.L && p.x <= geo.W - geo.R && p.y >= geo.T && p.y <= geo.T + geo.PH) showReadout(idxAt(p.x));
    else if (!drag) hideReadout();
  };
  svg.addEventListener('pointerdown', e => {
    const bar = e.target.closest('.bar'), stamp = e.target.closest('.stamp');
    if (bar) drag = { kind:'bar', year:+bar.dataset.year };
    else if (stamp) drag = { kind:'stamp', id:stamp.dataset.id };
    else if (e.target.id === 'hit') drag = { kind:'click', x:e.clientX, y:e.clientY };
    if (drag && drag.kind !== 'click'){ svg.setPointerCapture(e.pointerId); e.preventDefault(); }
    if (drag) onMove(e);
  });
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', () => { if (!drag) hideReadout(); });
  svg.addEventListener('pointerup', e => {
    if (drag && drag.kind === 'click' && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6){ const r = last.months[idxAt(svgPoint(e).x)]; addTrip(r.year, r.month, false); }
    if (drag && drag.kind === 'bar') toast(`${drag.year} budget set to ${usd.format(state.overrides[drag.year])}. Double-click the bar to undo.`);
    drag = null;
  });
  svg.addEventListener('pointercancel', () => { drag = null; });
  svg.addEventListener('dblclick', e => {
    const bar = e.target.closest('.bar'); if (!bar) return;
    delete state.overrides[bar.dataset.year]; update(); toast(`${bar.dataset.year} is back to the default budget.`);
  });
  svg.addEventListener('keydown', e => {
    const bar = e.target.closest('.bar'); if (!bar) return;
    const yr = +bar.dataset.year, cur = last.years.find(r => r.year === yr).budget;
    const d = { ArrowUp:250, ArrowDown:-250, PageUp:1000, PageDown:-1000 }[e.key] || 0;
    if (e.key === 'Delete' || e.key === 'Backspace') delete state.overrides[yr];
    else if (d) state.overrides[yr] = Math.max(0, cur + d); else return;
    e.preventDefault(); update();
    const again = svg.querySelector(`.bar[data-year="${yr}"]`); if (again) again.focus();
  });
}

// ---------- tracker controls ----------
function setTrack(k, manual){ trackK = k; trackManual = manual; renderTracker(last); drawCharts(last); }
function wireTracker(){
  $('followSel').addEventListener('change', e => { A().trackBy = e.target.value; update(); });
  $('trackRange').addEventListener('input', e => { stopPlay(); setTrack(parseInt(e.target.value, 10), true); });
  $('todayBtn').addEventListener('click', () => { stopPlay(); setTrack(todayK(), false); });
  $('playBtn').addEventListener('click', () => playing ? stopPlay() : startPlay());
}
function startPlay(){
  playing = true; $('playBtn').innerHTML = '<svg class="i"><use href="#i-pause"/></svg>'; $('playBtn').setAttribute('aria-label', 'Pause');
  if (trackK >= last.nLoan) trackK = -1;
  let t0 = performance.now();
  const step = now => {
    if (!playing) return;
    if (now - t0 > (reduced() ? 160 : Math.max(16, 4500 / last.nLoan))){ t0 = now; trackK++; trackManual = true; renderTracker(last); if (trackK % 3 === 0 || trackK >= last.nLoan) drawCharts(last); }
    if (trackK >= last.nLoan){ stopPlay(); toast(`Landed debt-free in ${mon(last.finalPay.year, last.finalPay.month)}.`); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function stopPlay(){ playing = false; $('playBtn').innerHTML = '<svg class="i"><use href="#i-play"/></svg>'; $('playBtn').setAttribute('aria-label', 'Play the flight'); }
function takeoff(){
  if (reduced() || currentView !== 'tracker') return;
  const target = trackerAt(last, state, trackK).progress; if (target <= 0) return;
  const t0 = performance.now(), dur = 1500;
  const tick = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); renderTracker(last, target * e); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

// ---------- tools ----------
function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 3800); }
function animateTo(field, target){
  const from = state[field], t0 = performance.now(), dur = 700;
  if (reduced()){ state[field] = target; syncOne(field); update(); return; }
  const tick = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    state[field] = k < 1 ? Math.round((from + (target - from) * e) / 50) * 50 : target;
    syncOne(field); update(); if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function wireTools(){
  $('maxBtn').addEventListener('click', () => {
    const m = solveMax(state, { anchor:latestAnchor(state) });
    if (m === null){ toast('Even $0 a year dips under your reserve. Try a smaller first-year budget, fewer trips, or a lower reserve.'); return; }
    animateTo('defaultSpend', m);
    toast(`You can spend up to ${usd.format(m)} a year (about ${usd.format(m / 12)} a month) and keep your ${usd.format(state.cushion)} reserve.`);
  });
  $('pinBtn').addEventListener('click', () => { ghost = last.months.map(r => r.bal); $('unpinBtn').hidden = false; render(last); toast('Plan pinned. Change anything and compare against the dotted line.'); });
  $('unpinBtn').addEventListener('click', () => { ghost = null; $('unpinBtn').hidden = true; render(last); });
  $('themeBtn').addEventListener('click', () => { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); });
}

// ---------- admin menu ----------
function openMenu(open){
  const m = $('adminMenu'), b = $('adminBtn');
  m.hidden = !open; b.setAttribute('aria-expanded', String(open));
  if (open){ $('guideHint').hidden = true; const f = m.querySelector('input,button'); if (f) f.focus(); }
}
function wireAdmin(){
  let saved = {}; try { saved = JSON.parse(store.get(K_CSV) || '{}'); } catch(e){}
  $('csvChecks').innerHTML = Object.entries(DATASETS).map(([k, d]) => `<label class="chk"><input type="checkbox" value="${k}" ${saved[k] === false ? '' : 'checked'}> ${d.label}</label>`).join('');
  $('csvChecks').addEventListener('change', () => { const o = {}; $('csvChecks').querySelectorAll('input').forEach(i => o[i.value] = i.checked); store.set(K_CSV, JSON.stringify(o)); });
  $('adminBtn').addEventListener('click', e => { e.stopPropagation(); openMenu($('adminMenu').hidden); });
  document.addEventListener('click', e => { if (e.isTrusted && !$('adminMenu').hidden && !$('adminMenu').contains(e.target) && e.target !== $('adminBtn')) openMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('adminMenu').hidden){ openMenu(false); $('adminBtn').focus(); } });
  $('csvBtn').addEventListener('click', exportCSV);
  $('pdfBtn').addEventListener('click', () => { openMenu(false); exportPDF(); });
  $('copyBtn').addEventListener('click', copySummary);
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Start over? This clears your trips and changed years and goes back to the original plan.')) return;
    state = { ...structuredClone(DEFAULTS), actuals:state.actuals }; ghost = null; $('unpinBtn').hidden = true; trackManual = false; syncAll(); update(); openMenu(false); toast('Back to the original plan. Your actuals were kept.');
  });
  $('clearActBtn').addEventListener('click', () => {
    if (!confirm('Clear all actuals? This removes every imported and hand-added transaction, check-in and rule. Your categories and the plan stay.')) return;
    const cats = state.actuals.cats; state.actuals = { ...emptyActuals(), cats }; selected.clear(); update(); openMenu(false); toast('Actuals cleared.');
  });
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function download(blob, name){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function exportCSV(){
  const picked = [...$('csvChecks').querySelectorAll('input:checked')].map(i => i.value);
  if (!picked.length){ toast('Tick at least one dataset to export.'); return; }
  const o = calcNow();
  const files = picked.map(k => ({ name:DATASETS[k].file, text:DATASETS[k].build(state, o) }));
  if (files.length === 1) download(new Blob(['﻿' + files[0].text], { type:'text/csv;charset=utf-8' }), files[0].name.replace('.csv', `-${stamp()}.csv`));
  else download(makeZip(files.map(f => ({ name:f.name, text:'﻿' + f.text }))), `loan-travel-fund-data-${stamp()}.zip`);
  toast(files.length === 1 ? `Downloaded ${files[0].name}.` : `Downloaded ${files.length} CSV files in one .zip.`);
}
async function copySummary(){
  const o = calcNow(), vt = verdictText(o);
  const lines = [
    'Loan & Travel Fund Planner', `Flight ${flightNo()}: ${vt.head}.`,
    `Plan: ${o.H} years. Loan: ${usd.format(state.loanAmount)} at ${state.loanRate}% for ${state.termYears} years, ${mon(state.startYear, state.startMonth - 1)} to ${mon(o.finalPay.year, o.finalPay.month)}`,
    `Loan payment ${usd2.format(o.payment)}/mo, total interest ${usd.format(o.totalInterest)}`,
    `Fund starts at ${usd.format(o.seed)}; ${usd2.format(o.depLoan)}/mo goes in during the loan, ${usd2.format(o.depAfter)}/mo after, at ${state.apy}% APY`,
    `Lowest balance ${usd.format(o.lowest.bal)} in ${mon(o.lowest.year, o.lowest.month)}; reserve ${usd.format(state.cushion)}`,
    '', 'Year   Travel     Year-end   Lowest',
    ...o.years.filter(r => r.months).map(r => `${r.year}   ${usd.format(Math.max(r.budget, r.tripTotal)).padEnd(10)} ${usd.format(r.end).padEnd(10)} ${usd.format(r.low).padEnd(10)} ${r.check}`),
    ...(state.trips.length ? ['', 'Trips:', ...[...state.trips].sort((a, b) => a.year - b.year || a.month - b.month).map(t => `  ${mon(t.year, t.month)}  ${t.name || 'Trip'}  ${usd.format(t.cost)}`)] : [])
  ];
  const text = lines.join('\n');
  try { await navigator.clipboard.writeText(text); }
  catch(e){ const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch(_){} ta.remove(); }
  toast('Summary copied. Paste it anywhere.');
}

// ---------- PDF report (static snapshot for print / Save as PDF) ----------
function buildReport(){
  const o = calcNow(), vt = verdictText(o), t = trackerFor(o, trackK);
  const kv = rows => `<table class="kv-table"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table>`;
  const groups = [
    ['The loan', [['Loan amount', usd.format(state.loanAmount)], ['Interest rate', state.loanRate + '% a year'], ['Term', state.termYears + ' years'], ['Years to plan', planYearsOf(state) + ' years' + (state.planYears === 'auto' || state.planYears == null ? ' (loan term + 3)' : '')], ['First payment', mon(state.startYear, state.startMonth - 1)], ['Debts paid off from the loan', usd.format(state.debts)]]],
    ['Money in', [['Set aside each month', usd.format(state.monthly)], ['Savings account APY', state.apy + '%']]],
    ['Money out for travel', [['First travel year', state.firstTravelYear], ['Spend in the first travel year', usd.format(state.firstYearSpend)], ['Spend each year after that', usd.format(state.defaultSpend)], ['Reserve (never drop below)', usd.format(state.cushion)],
      ...Object.keys(state.overrides).sort().map(y => [`Budget changed for ${y}`, usd.format(state.overrides[y])])]],
    ['Calculated from these settings', [['Monthly loan payment', usd2.format(o.payment)], ['Total interest', usd.format(o.totalInterest)], ['Final payment', mon(o.finalPay.year, o.finalPay.month)], ['Travel fund starting balance', usd.format(o.seed)], ['Into the fund during the loan', usd2.format(o.depLoan) + '/mo'], ['Into the fund after the loan', usd2.format(o.depAfter) + '/mo'], ['Lowest fuel', `${usd.format(o.lowest.bal)}, ${mon(o.lowest.year, o.lowest.month)}`]]],
  ];
  const yrs = o.years.filter(r => r.months);
  const rp = $('report');
  rp.innerHTML = `
    <div class="rp-head"><div><h1 style="margin:0">Loan &amp; Travel Fund Planner</h1><div>Flight ${flightNo()}: ${mon(state.startYear, state.startMonth - 1)} to ${mon(o.finalPay.year, o.finalPay.month)}</div></div><div>Prepared ${today.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}</div></div>
    <div class="rp-status"><b style="color:${o.status === 'ok' ? '#18834f' : o.status === 'warn' ? '#a8730a' : '#c92c43'}">${vt.head}</b><div>${vt.sub}</div></div>
    <div class="rp-sec"><h2>Flight plan settings</h2><div class="rp-settings">${groups.map(([h, rows]) => `<div class="rp-group"><h3>${h}</h3>${kv(rows)}</div>`).join('')}</div></div>
    <div class="rp-sec"><h2>Flight tracker, ${mon(t.year, t.month)}</h2>
      <svg id="rpArc" viewBox="0 0 1000 250" style="background:linear-gradient(180deg,#cfe9f0,#f3fafb);border-radius:8pt"></svg>
      <table><tbody><tr><td>Status</td><td>${$('phaseText').textContent}</td></tr><tr><td>Payments made</td><td>${t.paid} of ${o.nLoan}</td></tr><tr><td>Paid so far</td><td>${usd.format(t.paidSoFar)}</td></tr><tr><td>Left to pay</td><td>${usd.format(t.leftToPay)}</td></tr><tr><td>Fuel in the tank</td><td>${usd.format(t.fuel)}</td></tr></tbody></table></div>
    <div class="rp-sec"><h2>Fuel over ${o.H} years</h2><svg id="rpFuel"></svg></div>
    ${state.trips.length ? `<div class="rp-sec"><h2>Trips</h2><table><thead><tr><th>Trip</th><th>Month</th><th>Cost</th></tr></thead><tbody>${[...state.trips].sort((a, b) => a.year - b.year || a.month - b.month).map(t => `<tr><td>${esc(t.name || 'Trip')}</td><td>${mon(t.year, t.month)}</td><td>${usd.format(t.cost)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="rp-sec"><h2>Flight log</h2><table><thead><tr><th>Year</th><th>Budget</th><th>Trips</th><th>Spent</th><th>Fuel added</th><th>Interest</th><th>Year-end</th><th>Lowest</th><th>Status</th></tr></thead><tbody>
      ${yrs.map(r => `<tr><td>${r.year}</td><td>${usd.format(r.budget)}</td><td>${r.tripTotal ? usd.format(r.tripTotal) : '—'}</td><td>${usd.format(r.withdrawn)}</td><td>${usd.format(r.deposits)}</td><td>${usd.format(r.interest)}</td><td>${usd.format(r.end)}</td><td>${usd.format(r.low)}</td><td>${r.check}</td></tr>`).join('')}</tbody></table></div>
    ${actualsReport()}
    <div class="rp-sec"><h2>Loan by year</h2><table><thead><tr><th>Year</th><th>Paid</th><th>Interest</th><th>Principal</th><th>Balance left</th></tr></thead><tbody>
      ${loanByYear(o).map(([y, b]) => `<tr><td>${y}</td><td>${usd.format(b.paid)}</td><td>${usd.format(b.int)}</td><td>${usd.format(b.prin)}</td><td>${usd.format(b.bal)}</td></tr>`).join('')}</tbody></table></div>
    <div class="rp-foot">Made with the Loan &amp; Travel Fund Planner. Projections assume deposits and everyday travel spending are spread evenly each month and the savings rate stays at ${state.apy}% APY.</div>`;
  drawArc($('rpArc'), o, state, t.progress, true, false);
  drawFuel(o, state, $('rpFuel'), { W:1000, interactive:false, trackK, ghost, actualPts:fundPoints(state), planLine:o.anchor ? oPlan.months.map(r => r.bal) : null });
}
function actualsReport(){
  if (!A().txns.length && !A().checkins.length) return '';
  const sm = summarizeActuals(state);
  const cats = Object.entries(sm.byCat).sort((a, b) => b[1].total - a[1].total);
  const trips = [...state.trips].sort((a, b) => a.year - b.year || a.month - b.month);
  return `<div class="rp-sec"><h2>Actuals so far</h2><table><tbody>
      <tr><td>Loan payments</td><td>${usd.format(sm.loan)} (${sm.loanCount} logged)</td></tr><tr><td>Into the fund</td><td>${usd.format(sm.deposit)}</td></tr>
      <tr><td>Interest earned</td><td>${usd.format(sm.interest)}</td></tr><tr><td>Travel spent</td><td>${usd.format(sm.travel)}</td></tr>
      ${sm.unsorted ? `<tr><td>Not declared yet</td><td>${sm.unsorted} transactions</td></tr>` : ''}</tbody></table></div>
    ${cats.length ? `<div class="rp-sec"><h2>Travel spending by category</h2><table><thead><tr><th>Category</th><th>Subcategory</th><th>Spent</th></tr></thead><tbody>
      ${cats.map(([cid, c]) => Object.entries(c.bySub).sort((a, b) => b[1] - a[1]).map(([sid, v], i) => `<tr><td>${i ? '' : esc(catName(cid))}</td><td>${esc(subName(cid, sid))}</td><td>${usd.format(v)}</td></tr>`).join('') + `<tr><td></td><td><b>${esc(catName(cid))} total</b></td><td><b>${usd.format(c.total)}</b></td></tr>`).join('')}</tbody></table></div>` : ''}
    ${trips.length ? `<div class="rp-sec"><h2>Trips: budget vs actual</h2><table><thead><tr><th>Trip</th><th>Month</th><th>Budget</th><th>Actual</th><th>Difference</th></tr></thead><tbody>
      ${trips.map(t => { const a = (sm.byTrip[t.id] || {}).total || 0, b = Number(t.cost) || 0; return `<tr><td>${esc(t.name || 'Trip')}</td><td>${mon(t.year, t.month)}</td><td>${usd.format(b)}</td><td>${usd.format(a)}</td><td>${a > b ? '+' : ''}${usd.format(a - b)}</td></tr>`; }).join('')}
      ${sm.byTrip.general ? `<tr><td>General travel</td><td></td><td></td><td>${usd.format(sm.byTrip.general.total)}</td><td></td></tr>` : ''}</tbody></table></div>` : ''}
    ${A().checkins.length ? `<div class="rp-sec"><h2>Balance check-ins</h2><table><thead><tr><th>Month</th><th>Fund balance</th><th>Plan said</th><th>Loan balance</th></tr></thead><tbody>
      ${reconcile(state, oPlan).map(r => `<tr><td>${mon(+r.ym.slice(0, 4), +r.ym.slice(5) - 1)}</td><td>${r.fund === '' ? '—' : usd2.format(r.fund)}</td><td>${r.planned === null ? '—' : usd.format(r.planned)}</td><td>${r.loan === '' ? '—' : usd2.format(r.loan)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}
function exportPDF(){
  buildReport();
  const oldTitle = document.title;
  document.title = `Loan and Travel Fund Plan ${stamp()}`;
  document.body.classList.add('print-report');
  const done = () => { document.body.classList.remove('print-report'); document.title = oldTitle; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 500); }, 50);
}

// ---------- guided tour ----------
const TOUR = [
  { view:'tracker', sel:'#trackerCard', title:'Welcome aboard', text:"I'm your captain for this trip. Your loan is the flight: it leaves with your first payment and lands the month you're debt-free. The plane shows how far along you are today." },
  { view:'tracker', sel:'.scrubber', title:'Fly through time', text:'Drag the slider to check any month, or press play to fly the whole route. Today snaps back to the current month.' },
  { view:'tracker', sel:'#board', title:'The departure board', text:'This stays at the top on every tab. On time means the travel fund lasts. Turbulence means it dips into your reserve. Out of fuel means it runs dry.' },
  { view:'tracker', sel:'#pass', title:'Your boarding pass', text:'The verdict in plain words, plus the numbers that matter most.' },
  { view:'tracker', sel:'#fuelCard', title:'Fuel over the plan', text:"The travel fund is your fuel. Hover to read a month, click the line to plan a trip there, or drag a bar to change one year's budget." },
  { view:'plan', sel:'#settingsCard', title:'Your flight plan', text:'These are the only numbers you set: the loan, how many years to plan, what you put aside, and what you plan to spend on travel. The plan runs the loan term plus 3 years unless you change it, up to 25.' },
  { view:'plan', sel:'#calcCard', title:'Calculated for you', text:'These are locked. They come from your plan, like the loan payment and how much goes into the fund each month.' },
  { view:'plan', sel:'#quickCard', title:'Quick moves', text:'Find my max works out the biggest yearly budget that keeps your reserve. Pin a plan to compare it against your changes.' },
  { view:'trips', sel:'#tripsCard', title:'Your passport', text:"Add the trips you have in mind. Each one gets a stamp and comes out of that year's budget in the month you go." },
  { view:'log', sel:'#logCard', title:'Flight log', text:'Every year at a glance. Type a different budget for a single year right in the table.' },
  { view:'actuals', sel:'#actHead', title:'Actuals: what really happened', text:"Import exports from your bank or card (CSV, Excel, OFX, QFX or QIF), then declare each transaction in Customs: fund deposit, loan payment, or a trip expense with its category. Your real numbers feed the tracker and the forecast." },
  { view:null, sel:'#adminBtn', title:'Exports and admin', text:'Download your data as CSV files, export the plan as a PDF, or start over. It all lives under this gear.' },
  { view:null, sel:'#themeBtn', title:'Day flight or night flight', text:'Switch between the light and dark themes any time. Enjoy the trip.' },
];
let tour = null;
function startTour(){
  if (tour) return;
  $('guideHint').hidden = true; openMenu(false);
  const catchEl = document.createElement('div'); catchEl.className = 'tour-catch';
  const spot = document.createElement('div'); spot.className = 'tour-spot';
  const pop = document.createElement('div'); pop.className = 'tour-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-labelledby', 'tourTitle');
  document.body.append(catchEl, spot, pop);
  tour = { i:0, catchEl, spot, pop, back:currentView };
  catchEl.addEventListener('click', () => endTour());
  pop.addEventListener('click', e => { const a = e.target.closest('[data-tour]'); if (!a) return; const act = a.dataset.tour; act === 'next' ? tourGo(tour.i + 1) : act === 'back' ? tourGo(tour.i - 1) : endTour(); });
  document.addEventListener('keydown', tourKeys);
  window.addEventListener('resize', placeTour);
  window.addEventListener('scroll', placeTour, { passive:true });
  tourGo(0);
}
function tourKeys(e){ if (!tour) return; if (e.key === 'Escape') endTour(); if (e.key === 'ArrowRight') tourGo(tour.i + 1); if (e.key === 'ArrowLeft') tourGo(tour.i - 1); }
function tourGo(i){
  if (i < 0) return; if (i >= TOUR.length) return endTour(true);
  tour.i = i; const st = TOUR[i];
  if (st.view && st.view !== currentView) showView(st.view);
  const el = document.querySelector(st.sel);
  if (el){
    const r = el.getBoundingClientRect(), appbar = document.querySelector('.appbar').getBoundingClientRect().height;
    if (r.top < appbar + 10 || r.bottom > innerHeight - 10){
      window.scrollTo({ top:Math.max(0, scrollY + r.top - appbar - 16 - Math.max(0, (innerHeight - appbar - r.height) / 2 - 40)), behavior:'auto' });
    }
  }
  const isLast = i === TOUR.length - 1;
  tour.pop.innerHTML = `<div class="who"><svg><use href="#i-captain"/></svg><div><h3 id="tourTitle">${st.title}</h3><div class="step">Stop ${i + 1} of ${TOUR.length}</div></div></div>
    <p>${st.text}</p>
    <div class="nav"><div class="tour-dots" aria-hidden="true">${TOUR.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
      <button data-tour="end" class="quiet">${isLast ? "Close" : "Skip tour"}</button>
      <span class="btns">${i ? '<button data-tour="back">Back</button>' : ''}<button data-tour="next" class="go">${isLast ? "Finish" : "Next"}</button></span></div>`;
  requestAnimationFrame(() => { placeTour(); tour.pop.querySelector('[data-tour="next"]').focus({ preventScroll:true }); });
}
function placeTour(){
  if (!tour) return;
  const el = document.querySelector(TOUR[tour.i].sel); if (!el) return;
  const r = el.getBoundingClientRect(), pad = 8;
  const top = Math.max(4, r.top - pad), bottom = Math.min(innerHeight - 4, r.bottom + pad);
  Object.assign(tour.spot.style, { left:(r.left - pad) + 'px', top:top + 'px', width:(r.width + pad * 2) + 'px', height:Math.max(20, bottom - top) + 'px' });
  const pop = tour.pop, ph = pop.offsetHeight, pw = pop.offsetWidth, m = 12;
  const bottomBar = innerWidth <= 640 ? 80 : 0;
  let y;
  if (r.bottom + pad + m + ph < innerHeight - bottomBar) y = r.bottom + pad + m;
  else if (r.top - pad - m - ph > 0) y = r.top - pad - m - ph;
  else y = innerHeight - bottomBar - ph - m;
  const x = Math.max(m, Math.min(innerWidth - pw - m, r.left + Math.min(24, r.width / 4)));
  pop.style.left = x + 'px'; pop.style.top = Math.max(m, y) + 'px';
}
function endTour(finished){
  if (!tour) return;
  tour.catchEl.remove(); tour.spot.remove(); tour.pop.remove();
  document.removeEventListener('keydown', tourKeys); window.removeEventListener('resize', placeTour); window.removeEventListener('scroll', placeTour);
  const back = tour.back; tour = null; store.set(K_TOUR, '1');
  showView(finished ? 'tracker' : back); window.scrollTo({ top:0 });
  $('guideBtn').focus();
  if (finished) toast('Tour complete. Tap the captain any time to see it again.');
}
function wireGuide(){
  $('guideBtn').addEventListener('click', startTour);
  $('hintGo').addEventListener('click', e => { e.stopPropagation(); startTour(); });
  $('hintNo').addEventListener('click', e => { e.stopPropagation(); $('guideHint').hidden = true; store.set(K_TOUR, '1'); });
  if (!store.get(K_TOUR)) setTimeout(() => { if (!tour) $('guideHint').hidden = false; }, 1200);
}

