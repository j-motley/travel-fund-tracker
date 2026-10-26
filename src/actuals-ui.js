// ===================== actuals-ui.js — the Actuals tab =====================
const K_ACTSEC = STORE_KEY + ':actsec', K_LASTACCT = STORE_KEY + ':last-account';
const SECS = ['overview','import','customs','checkins','setup'];
let actSec = SECS.includes(store.get(K_ACTSEC)) ? store.get(K_ACTSEC) : 'overview';
let custFilter = 'wait', custQuery = '', custLimit = 150, ruleFor = null, pending = null, lastResult = null;
const selected = new Set();
const A = () => state.actuals;
const ROLE_LABELS = { skip:'Skip', date:'Date', desc:'Description', amount:'Amount', debit:'Money out', credit:'Money in' };
const CAT_COLORS = ['var(--primary)','var(--gold-fill)','var(--danger)','var(--good)','var(--muted)','#7c5cd6','#d0679b','#3c8dde'];

// ---------- small helpers ----------
const fmtDate = d => { const [y, m, dd] = d.split('-'); return `${MONTHS[+m - 1]} ${+dd}, ${y}`; };
const tripName = id => id === 'general' ? 'General travel' : ((state.trips.find(t => t.id === id) || {}).name || 'Unnamed trip');
const catOf = id => A().cats.find(c => c.id === id);
const catName = id => id === 'none' || !id ? 'Not categorized' : (catOf(id) || { name:'Removed category' }).name;
const subName = (cid, sid) => { if (!sid || sid === 'none') return 'Unspecified'; const c = catOf(cid); const s = c && c.subs.find(x => x.id === sid); return s ? s.name : 'Removed subcategory'; };
const opt = (v, label, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(label)}</option>`;
const typeOpts = sel => TYPES.map(t => opt(t.id, t.label, sel)).join('');
const tripOpts = (sel, withAuto) => (withAuto ? opt('auto', 'Trip by date', sel) : '') + opt('general', 'General travel', sel) +
  [...state.trips].sort((a, b) => a.year - b.year || a.month - b.month).map(t => opt(t.id, `${t.name || 'Unnamed trip'} (${MONTHS[t.month]} ${t.year})`, sel)).join('');
const catOpts = sel => opt('', 'Category', sel || '') + A().cats.map(c => opt(c.id, c.name, sel)).join('');
const subOpts = (cid, sel) => { const c = catOf(cid); return opt('', c ? 'Subcategory' : '—', sel || '') + (c ? c.subs.map(s => opt(s.id, s.name, sel)).join('') : ''); };
const acctOpts = sel => ACCOUNTS.map(a => opt(a.id, a.label, sel)).join('');
const howBadge = t => t.type === 'unsorted' ? '' : t.how === 'you' ? '<span class="how you">yours</span>' : t.how === 'rule' ? '<span class="how rule">rule</span>' : t.how === 'guess' ? '<span class="how">best guess</span>' : '';

// ---------- render entry point (called by ui.js render) ----------
function renderActuals(o, opts){
  opts = opts || {};
  const sum = summarizeActuals(state);
  const wc = $('waitCount'), cc = $('custCount');
  wc.hidden = cc.hidden = !sum.unsorted; wc.textContent = cc.textContent = sum.unsorted;
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sec === actSec)));
  document.querySelectorAll('.sec').forEach(s => s.hidden = s.dataset.sec !== actSec);
  renderOverview(sum);
  document.querySelectorAll('[data-trip-actuals]').forEach(el => el.innerHTML = tripActualsHTML(sum));
  if (currentView !== 'actuals') return;
  if (actSec === 'import'){ renderMapper(); renderBatches(); refreshManual(); }
  if (actSec === 'customs' && !opts.skipCustoms) renderCustoms();
  if (actSec === 'checkins') renderCheckins();
  if (actSec === 'setup' && !opts.skipSetup) renderSetup();
}
function showSec(sec){ actSec = sec; store.set(K_ACTSEC, sec); renderActuals(last); }

// ---------- overview ----------
function renderOverview(sum){
  const tiles = $('actTiles');
  if (!A().txns.length && !A().checkins.length){
    tiles.style.display = 'block';
    tiles.innerHTML = `<div class="card empty-state"><h2>No actuals yet</h2><p>Export transactions from your travel card, the travel fund savings account and the loan, then import them here. Or add a few by hand to get started.</p>
      <div class="tools" style="justify-content:center"><button class="go" data-go="import">Import a file</button><button data-go="checkins">Add a balance check-in</button></div></div>`;
  } else {
    tiles.style.display = '';
    tiles.innerHTML = [
      ['Loan payments', usd.format(sum.loan), `${sum.loanCount} payment${sum.loanCount === 1 ? '' : 's'} logged`],
      ['Into the fund', usd.format(sum.deposit), sum.seed ? `Plus ${usd.format(sum.seed)} starting money` : 'Fund deposits'],
      ['Interest earned', usd.format(sum.interest), 'Paid by the savings account'],
      ['Travel spent', usd.format(sum.travel), `Across ${Object.keys(sum.byTrip).length || 0} trip${Object.keys(sum.byTrip).length === 1 ? '' : 's'}`],
    ].map(([l, v, n]) => `<div class="tile"><div class="lbl">${l}</div><div class="v">${v}</div><div class="lbl">${n}</div></div>`).join('') +
      (sum.unsorted ? `<div class="tile cta"><div class="lbl">Waiting in Customs</div><div class="v">${sum.unsorted}</div><button class="go" data-go="customs">Declare them</button></div>`
                    : `<div class="tile"><div class="lbl">Waiting in Customs</div><div class="v">0</div><div class="lbl">All declared</div></div>`);
  }
  const cats = Object.entries(sum.byCat).sort((a, b) => b[1].total - a[1].total);
  $('catBars').innerHTML = !cats.length ? `<p class="sub">Declared travel expenses will show up here.</p>` : cats.map(([cid, c], ci) => {
    const col = CAT_COLORS[Math.max(0, A().cats.findIndex(x => x.id === cid)) % CAT_COLORS.length];
    const subs = Object.entries(c.bySub).sort((a, b) => b[1] - a[1]);
    return `<div class="catbar"><div class="row1"><span>${esc(catName(cid))}</span><b>${usd.format(c.total)} <span class="lbl">${Math.round(c.total / (sum.travel || 1) * 100)}%</span></b></div>
      <div class="stackbar" role="img" aria-label="${esc(catName(cid))}: ${usd.format(c.total)}" style="width:${Math.max(4, c.total / cats[0][1].total * 100)}%">${subs.map(([sid, v], i) => `<i style="width:${v / c.total * 100}%;background:${col};opacity:${Math.max(.35, 1 - i * .18)}" title="${esc(subName(cid, sid))}: ${usd.format(v)}"></i>`).join('')}</div>
      <div class="subs">${subs.map(([sid, v]) => `<span>${esc(subName(cid, sid))} <b>${usd.format(v)}</b></span>`).join('')}</div></div>`;
  }).join('');
}
function tripActualsHTML(sum){
  const trips = [...state.trips].sort((a, b) => a.year - b.year || a.month - b.month);
  const rows = trips.map(t => ({ id:t.id, name:t.name || 'Unnamed trip', when:mon(t.year, t.month), budget:Number(t.cost) || 0, actual:(sum.byTrip[t.id] || {}).total || 0 }));
  if (sum.byTrip.general) rows.push({ id:'general', name:'General travel', when:'Not tied to a trip', budget:null, actual:sum.byTrip.general.total });
  if (!rows.length) return `<p class="sub">Add trips on the Trips tab, then declare their expenses in Customs.</p>`;
  return rows.map(r => {
    const max = Math.max(r.budget || 0, r.actual, 1) * 1.08, over = r.budget !== null && r.actual > r.budget;
    const note = r.budget === null ? `${usd.format(r.actual)} spent` : !r.actual ? 'Nothing declared yet' : over ? `<span class="neg">Over budget by ${usd.format(r.actual - r.budget)}</span>` : `${usd.format(r.budget - r.actual)} left in the budget`;
    return `<div class="ta-row"><div class="row1"><span>${esc(r.name)} <span class="lbl">${r.when}</span></span><b>${usd.format(r.actual)}${r.budget !== null ? ` <span class="lbl">of ${usd.format(r.budget)}</span>` : ''}</b></div>
      <div class="ta-meter"><i class="${over ? 'over' : ''}" style="width:${r.actual / max * 100}%"></i>${r.budget !== null ? `<b style="left:${r.budget / max * 100}%" title="Budget"></b>` : ''}</div><div class="note">${note}</div></div>`;
  }).join('');
}

// ---------- import ----------
function wireImport(){
  const drop = $('drop'), inp = $('fileIn');
  inp.addEventListener('change', () => { if (inp.files[0]) handleFile(inp.files[0]); inp.value = ''; });
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  $('mapper').addEventListener('change', onMapperChange);
  $('mapper').addEventListener('click', e => {
    const b = e.target.closest('button[data-imp]'); if (!b) return;
    if (b.dataset.imp === 'go') doImport(); else { pending = null; renderMapper(); }
  });
  $('importResult').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) showSec(b.dataset.go); });
}
async function handleFile(file){
  lastResult = null; $('importResult').innerHTML = '';
  try {
    const buf = await file.arrayBuffer(), r = await readBankFile(file.name, buf);
    const lastAcct = store.get(K_LASTACCT) || 'card';
    if (r.kind === 'table'){
      const h = findHeaderRow(r.rows);
      const headers = h >= 0 ? r.rows[h].map((c, i) => c || `Column ${i + 1}`) : r.rows[0].map((_, i) => `Column ${i + 1}`);
      const data = r.rows.slice(h >= 0 ? h + 1 : 0).filter(row => row.length > 1 || (row[0] || '').trim());
      const sig = headers.map(x => x.toLowerCase().trim()).join('|');
      const saved = A().mappings[sig];
      const map = saved ? { ...saved } : { ...guessColumns(headers, data.slice(0, 12)), dateFmt:'auto', invert:false };
      const account = saved ? saved.account : lastAcct;
      pending = { file:file.name, kind:'table', source:r.source, headers, data, sig, map, account, remembered:!!saved };
      if (!saved) pending.map.invert = suggestInvert(pending);
    } else {
      pending = { file:file.name, kind:r.kind, source:r.source, txns:r.txns, skipped:r.skipped, account:r.hint !== 'other' ? r.hint : lastAcct, hinted:r.hint !== 'other' };
    }
    renderMapper();
  } catch(err){
    pending = null; renderMapper();
    $('importResult').innerHTML = `<div class="result err"><h3>That file didn't import</h3><p>${esc(err.message || String(err))}</p></div>`;
  }
}
// Card exports that list charges as positive numbers need their signs flipped.
function suggestInvert(p){
  if (p.account !== 'card' || p.map.amount < 0) return false;
  const vals = p.data.slice(0, 40).map(r => parseAmount(r[p.map.amount])).filter(v => !isNaN(v) && v !== 0);
  return vals.length > 0 && vals.filter(v => v > 0).length / vals.length > .6;
}
function pendingTxns(){
  if (!pending) return { txns:[], skipped:0 };
  if (pending.kind === 'table'){
    const m = pending.map;
    if (m.date < 0 || (m.amount < 0 && m.debit < 0 && m.credit < 0)) return { txns:[], skipped:pending.data.length, missing:true };
    return rowsToTxns(pending.data, m);
  }
  return { txns:pending.txns, skipped:pending.skipped };
}
function renderMapper(){
  const el = $('mapper');
  if (!pending){ el.innerHTML = ''; return; }
  const res = pendingTxns(), p = pending;
  const roleOf = i => Object.keys(ROLE_LABELS).find(r => r !== 'skip' && p.map && p.map[r] === i) || 'skip';
  const table = p.kind === 'table' ? `
    <p class="sub" style="margin:10px 0 6px">${p.remembered ? 'Using the column setup you saved for files like this. ' : 'Check what each column holds. '}Only Date and an amount column are required.</p>
    <div class="table-scroll"><table class="map-table"><thead><tr>${p.headers.map((h, i) => `<th><select data-col="${i}" aria-label="Column ${i + 1}: ${esc(h)}">${Object.entries(ROLE_LABELS).map(([r, l]) => opt(r, l, roleOf(i))).join('')}</select></th>`).join('')}</tr></thead>
      <tbody><tr class="hdr">${p.headers.map(h => `<td title="${esc(h)}">${esc(h)}</td>`).join('')}</tr>${p.data.slice(0, 5).map(r => `<tr>${p.headers.map((_, i) => `<td title="${esc(r[i] || '')}">${esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  const ctl = `<div class="map-ctl">
      <label>This file is from<select data-m="account">${acctOpts(p.account)}</select></label>
      ${p.kind === 'table' ? `<label>Dates are written<select data-m="dateFmt">${opt('auto', `Detect (looks like ${res.dateFmt === 'DMY' ? 'day first' : 'month first'})`, p.map.dateFmt)}${opt('MDY', 'Month first (01/31/2027)', p.map.dateFmt)}${opt('DMY', 'Day first (31/01/2027)', p.map.dateFmt)}</select></label>` : ''}
    </div>
    ${p.kind === 'table' && p.map.amount >= 0 ? `<label class="chk inline"><input type="checkbox" data-m="invert"${p.map.invert ? ' checked' : ''}> Charges show as positive numbers (flip the signs)</label>` : ''}`;
  const prev = res.txns.slice(0, 6).map(t => `<div><span>${fmtDate(t.date)}</span><span title="${esc(t.desc)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.desc)}</span><span class="${t.amount > 0 ? 'amt-in' : 'amt-out'}">${usd2.format(t.amount)}</span></div>`).join('');
  el.innerHTML = `<div class="mapper">
    <h3>${esc(p.file)} <span class="lbl">${p.source}</span></h3>
    ${ctl}${table}
    <h3 style="margin-top:12px">Preview</h3>
    ${res.missing ? `<p class="neg">Pick which column has the date and which has the amount.</p>` : `<p class="sub" style="margin:0">${res.txns.length} transaction${res.txns.length === 1 ? '' : 's'} ready${res.skipped ? `, ${res.skipped} row${res.skipped === 1 ? '' : 's'} without a date or amount will be left out` : ''}. Money out shows as negative.</p>`}
    <div class="preview">${prev}</div>
    <div class="tools"><button class="go" data-imp="go"${res.txns.length ? '' : ' disabled'}>Import ${res.txns.length} transaction${res.txns.length === 1 ? '' : 's'}</button><button data-imp="cancel" class="quiet">Cancel</button></div>
  </div>`;
}
function onMapperChange(e){
  if (!pending) return;
  const t = e.target;
  if (t.dataset.col !== undefined){
    const col = +t.dataset.col, role = t.value;
    ['date','desc','amount','debit','credit'].forEach(r => { if (pending.map[r] === col) pending.map[r] = -1; });
    if (role !== 'skip') pending.map[role] = col;
  }
  if (t.dataset.m === 'account'){ pending.account = t.value; if (pending.kind === 'table' && !pending.remembered) pending.map.invert = suggestInvert(pending); }
  if (t.dataset.m === 'dateFmt') pending.map.dateFmt = t.value;
  if (t.dataset.m === 'invert') pending.map.invert = t.checked;
  renderMapper();
}
function doImport(){
  const res = pendingTxns(); if (!res.txns.length) return;
  const p = pending, acct = p.account, keyed = keyTxns(acct, res.txns), have = new Set(A().txns.map(t => t.key));
  const fresh = keyed.filter(t => !have.has(t.key));
  const batch = { id:uid('b'), file:p.file, at:new Date().toISOString(), count:fresh.length, account:acct, source:p.source };
  let auto = 0, waiting = 0;
  fresh.forEach(t => {
    const x = { id:uid('x'), key:t.key, date:t.date, desc:t.desc, amount:t.amount, account:acct, batch:batch.id, src:'import', type:'unsorted', trip:null, cat:null, sub:null, how:null };
    if (t.fitid) x.fitid = t.fitid;
    const d = autoDeclare(x, A(), state.trips);
    x.type = d.type; x.trip = d.trip || null; x.cat = d.cat || null; x.sub = d.sub || null; x.how = d.how || null;
    if (x.type === 'unsorted') waiting++; else auto++;
    A().txns.push(x);
  });
  if (fresh.length) A().batches.push(batch);
  if (p.kind === 'table') A().mappings[p.sig] = { ...p.map, account:acct };
  store.set(K_LASTACCT, acct);
  lastResult = { file:p.file, added:fresh.length, dup:keyed.length - fresh.length, skipped:res.skipped, auto, waiting };
  pending = null;
  update();
  $('importResult').innerHTML = `<div class="result"><h3>${lastResult.added ? `Imported ${lastResult.added} transaction${lastResult.added === 1 ? '' : 's'}` : 'Nothing new in that file'}</h3>
    <p>${[lastResult.dup ? `${lastResult.dup} already here, skipped` : '', lastResult.skipped ? `${lastResult.skipped} rows without a date or amount left out` : '', lastResult.auto ? `${lastResult.auto} declared with your rules or best guesses` : '', lastResult.waiting ? `${lastResult.waiting} waiting for you in Customs` : ''].filter(Boolean).join('. ') || 'All set.'}.</p>
    <div class="tools"><button class="go" data-go="customs">Review in Customs</button></div></div>`;
  toast(lastResult.added ? `Imported ${lastResult.added} from ${p.file}.` : 'No new transactions in that file.');
}
function renderBatches(){
  const b = [...A().batches].reverse();
  $('batches').innerHTML = !b.length ? `<p class="sub" style="margin:0">No imports yet.</p>` : b.map(x => `<div class="batch"><div>${esc(x.file)}<small>${new Date(x.at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}, ${x.count} transaction${x.count === 1 ? '' : 's'}, ${esc(accountLabel(x.account))}</small></div><button data-undo="${x.id}">Undo import</button></div>`).join('');
}
function wireBatches(){
  $('batches').addEventListener('click', e => {
    const b = e.target.closest('[data-undo]'); if (!b) return;
    const x = A().batches.find(y => y.id === b.dataset.undo); if (!x) return;
    if (!confirm(`Remove the ${x.count} transactions imported from ${x.file}?`)) return;
    A().txns = A().txns.filter(t => t.batch !== x.id); A().batches = A().batches.filter(y => y.id !== x.id);
    update(); toast(`Removed the import from ${x.file}.`);
  });
}

// ---------- manual add ----------
function buildManual(){
  $('manualForm').innerHTML = `
    <label>Date<input type="date" id="mDate"></label>
    <label>Amount<input type="number" id="mAmt" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label>
    <label class="wide">Description<input id="mDesc" placeholder="e.g. Taxi to the airport"></label>
    <label class="wide">Declared as<select id="mType">${TYPES.filter(t => t.id !== 'unsorted').map(t => opt(t.id, t.label, 'travel')).join('')}</select></label>
    <label>Trip<select id="mTrip"></select></label>
    <label>Category<select id="mCat"></select></label>
    <label class="wide">Subcategory<select id="mSub"></select></label>
    <div class="wide"><button class="go" id="mAdd">Add transaction</button></div>`;
  $('mDate').value = new Date().toISOString().slice(0, 10);
  $('manualForm').addEventListener('change', e => { if (e.target.id === 'mCat'){ $('mSub').innerHTML = subOpts($('mCat').value, ''); } if (e.target.id === 'mType' || e.target.id === 'mDate') refreshManual(true); });
  $('mAdd').addEventListener('click', () => {
    const date = $('mDate').value, amt = Math.abs(parseFloat($('mAmt').value)), type = $('mType').value;
    if (!date || !amt){ toast('Add a date and an amount first.'); return; }
    const t = { id:uid('x'), key:'manual|' + uid('k'), date, desc:$('mDesc').value.trim() || typeLabel(type), amount:type === 'travel' ? -amt : amt, account:'manual', batch:null, src:'manual' };
    declare(t, { type, trip:type === 'travel' ? $('mTrip').value : null, cat:$('mCat').value || null, sub:$('mSub').value || null, how:'you' });
    A().txns.push(t); $('mAmt').value = ''; $('mDesc').value = '';
    update(); toast(`Added ${usd2.format(amt)} as ${typeLabel(type).toLowerCase()}.`);
  });
  refreshManual(true);
}
function refreshManual(force){
  if (!$('mTrip')) return;
  const travel = $('mType').value === 'travel';
  ['mTrip','mCat','mSub'].forEach(id => { $(id).disabled = !travel; });
  const tv = $('mTrip').value || (force && $('mDate').value ? tripForDate(state.trips, $('mDate').value) : 'general'), cv = $('mCat').value, sv = $('mSub').value;
  $('mTrip').innerHTML = tripOpts(force && $('mDate').value ? tripForDate(state.trips, $('mDate').value) : tv);
  $('mCat').innerHTML = catOpts(cv); $('mSub').innerHTML = subOpts(cv, sv);
}

// ---------- customs ----------
const FILTERS = [['wait','Waiting'],['all','All'],['travel','Travel'],['deposit','Deposits'],['loan','Loan'],['other','Other']];
function filtered(){
  const q = custQuery.toLowerCase();
  return A().txns.filter(t => {
    if (custFilter === 'wait' && t.type !== 'unsorted') return false;
    if (['travel','deposit','loan'].includes(custFilter) && t.type !== custFilter) return false;
    if (custFilter === 'other' && !['interest','transfer','ignore'].includes(t.type)) return false;
    return !q || t.desc.toLowerCase().includes(q) || String(Math.abs(t.amount)).includes(q);
  }).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
function custRow(t){
  const travel = t.type === 'travel';
  const fields = travel
    ? `<select data-f="trip" aria-label="Trip">${tripOpts(t.trip || 'general')}</select><select data-f="cat" aria-label="Category">${catOpts(t.cat)}</select><select data-f="sub" aria-label="Subcategory">${subOpts(t.cat, t.sub)}</select>`
    : '<span class="blank"></span><span class="blank"></span><span class="blank"></span>';
  return `<div class="cust${t.type === 'unsorted' ? ' wait' : ''}" data-id="${t.id}">
    <input type="checkbox" data-sel${selected.has(t.id) ? ' checked' : ''} aria-label="Select ${esc(t.desc)}">
    <div class="c-date">${fmtDate(t.date)}</div>
    <div class="c-desc" title="${esc(t.desc)}">${esc(t.desc)}<small>${esc(accountLabel(t.account))}${howBadge(t)}</small></div>
    <div class="c-amt ${t.amount > 0 ? 'amt-in' : ''}">${usd2.format(t.amount)}</div>
    <div class="c-fields"><select data-f="type" aria-label="Declared as">${typeOpts(t.type)}</select>${fields}<button data-act="rule" title="Make a rule for transactions like this">Always</button></div>
    ${ruleFor === t.id ? rulePopHTML(t) : ''}</div>`;
}
function rulePopHTML(t){
  const what = t.type === 'travel' ? `travel expense${t.cat ? `, ${catName(t.cat)}${t.sub ? ' / ' + subName(t.cat, t.sub) : ''}` : ''}, trip by date` : typeLabel(t.type).toLowerCase();
  return `<div class="rule-pop">When the description contains <input data-r="match" value="${esc(rulePhrase(t.desc))}" aria-label="Words to match">
    from <select data-r="account">${opt(t.account, 'this account', t.account)}${opt('any', 'any account', '')}</select>
    declare it as <b>${esc(what)}</b>. <button class="go" data-act="rule-save">Save rule</button><button class="quiet" data-act="rule-cancel">Cancel</button></div>`;
}
function renderCustoms(){
  const counts = { wait:0, all:A().txns.length, travel:0, deposit:0, loan:0, other:0 };
  A().txns.forEach(t => { if (t.type === 'unsorted') counts.wait++; else if (counts[t.type] !== undefined) counts[t.type]++; else counts.other++; });
  $('custFilter').innerHTML = FILTERS.map(([k, l]) => `<button data-filter="${k}" aria-pressed="${custFilter === k}">${l} ${counts[k]}</button>`).join('');
  const list = filtered(), shown = list.slice(0, custLimit);
  $('custList').innerHTML = shown.length ? shown.map(custRow).join('')
    : `<div class="empty-state"><p>${A().txns.length ? (custFilter === 'wait' ? 'Nothing waiting. Every transaction has been declared.' : 'No transactions match.') : 'Import a file to see transactions here.'}</p>${A().txns.length ? '' : '<button class="go" data-go="import">Import a file</button>'}</div>`;
  $('custMore').innerHTML = list.length > custLimit ? `<div class="more-row"><button data-more>Show ${Math.min(150, list.length - custLimit)} more of ${list.length - custLimit}</button></div>` : '';
  renderBulk();
}
function replaceRow(id){ const el = $('custList').querySelector(`.cust[data-id="${id}"]`), t = A().txns.find(x => x.id === id); if (el && t) el.outerHTML = custRow(t); }
function renderBulk(){
  const b = $('bulk'), n = [...selected].filter(id => A().txns.some(t => t.id === id)).length;
  b.hidden = !n; if (!n) return;
  b.style.setProperty('--appbar-h', document.querySelector('.appbar').offsetHeight + 'px');
  const ty = b.querySelector('[data-b="type"]'), cur = { type:ty ? ty.value : 'travel', trip:(b.querySelector('[data-b="trip"]') || {}).value || 'auto', cat:(b.querySelector('[data-b="cat"]') || {}).value || '', sub:(b.querySelector('[data-b="sub"]') || {}).value || '' };
  b.innerHTML = `<b>${n} selected</b><select data-b="type" aria-label="Declare selected as">${TYPES.filter(t => t.id !== 'unsorted').map(t => opt(t.id, t.label, cur.type)).join('')}${opt('unsorted', 'Not declared yet', cur.type)}</select>
    ${cur.type === 'travel' ? `<select data-b="trip" aria-label="Trip">${tripOpts(cur.trip, true)}</select><select data-b="cat" aria-label="Category">${catOpts(cur.cat)}</select><select data-b="sub" aria-label="Subcategory">${subOpts(cur.cat, cur.sub)}</select>` : ''}
    <button class="go" data-bulk="apply">Apply</button><button data-bulk="all">Select all ${filtered().length}</button><button class="quiet" style="color:inherit" data-bulk="clear">Clear</button>`;
}
function wireCustoms(){
  const list = $('custList');
  $('custFilter').addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (!b) return; custFilter = b.dataset.filter; custLimit = 150; renderCustoms(); });
  $('custSearch').addEventListener('input', e => { custQuery = e.target.value; custLimit = 150; renderCustoms(); });
  $('custMore').addEventListener('click', e => { if (e.target.closest('[data-more]')){ custLimit += 150; renderCustoms(); } });
  list.addEventListener('change', e => {
    const row = e.target.closest('.cust'); if (!row) return;
    const t = A().txns.find(x => x.id === row.dataset.id); if (!t) return;
    if (e.target.matches('[data-sel]')){ e.target.checked ? selected.add(t.id) : selected.delete(t.id); renderBulk(); return; }
    const f = e.target.dataset.f; if (!f) return;
    if (f === 'type'){
      const ty = e.target.value;
      if (ty === 'travel' && t.type !== 'travel'){ const g = guessCategory(t.desc); declare(t, { type:'travel', trip:tripForDate(state.trips, t.date), cat:t.cat || g.cat, sub:t.sub || g.sub, how:'you' }); }
      else declare(t, { type:ty, how:'you' });
      if (ty === 'unsorted') t.how = null;
    }
    if (f === 'trip'){ t.trip = e.target.value; t.how = 'you'; }
    if (f === 'cat'){ t.cat = e.target.value || null; t.sub = null; t.how = 'you'; }
    if (f === 'sub'){ t.sub = e.target.value || null; t.how = 'you'; }
    update({ skipCustoms:true }); replaceRow(t.id);
    const again = list.querySelector(`.cust[data-id="${t.id}"] [data-f="${f}"]`); if (again) again.focus();
  });
  list.addEventListener('click', e => {
    const go = e.target.closest('[data-go]'); if (go){ showSec(go.dataset.go); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const row = b.closest('.cust'), t = A().txns.find(x => x.id === row.dataset.id); if (!t) return;
    if (b.dataset.act === 'rule'){
      if (t.type === 'unsorted'){ toast('Declare this one first, then make it a rule.'); return; }
      const prev = ruleFor; ruleFor = ruleFor === t.id ? null : t.id; if (prev && prev !== t.id) replaceRow(prev); replaceRow(t.id);
      const inp = list.querySelector(`.cust[data-id="${t.id}"] [data-r="match"]`); if (inp) inp.focus();
    }
    if (b.dataset.act === 'rule-cancel'){ ruleFor = null; replaceRow(t.id); }
    if (b.dataset.act === 'rule-save'){
      const match = row.querySelector('[data-r="match"]').value.trim(), account = row.querySelector('[data-r="account"]').value;
      if (match.length < 2){ toast('Use at least two letters to match.'); return; }
      const rule = { id:uid('r'), match, account, type:t.type, trip:'auto', cat:t.type === 'travel' ? t.cat : null, sub:t.type === 'travel' ? t.sub : null };
      A().rules.push(rule); ruleFor = null;
      let n = 0;
      A().txns.forEach(x => { if (x.how !== 'you' && x.desc.toLowerCase().includes(match.toLowerCase()) && (account === 'any' || x.account === account)){ declare(x, { type:rule.type, trip:rule.type === 'travel' ? tripForDate(state.trips, x.date) : null, cat:rule.cat, sub:rule.sub, how:'rule' }); n++; } });
      update(); toast(`Rule saved. ${n} transaction${n === 1 ? '' : 's'} updated.`);
    }
  });
  $('bulk').addEventListener('change', e => { if (e.target.dataset.b === 'type' || e.target.dataset.b === 'cat') renderBulk(); });
  $('bulk').addEventListener('click', e => {
    const b = e.target.closest('[data-bulk]'); if (!b) return;
    if (b.dataset.bulk === 'clear'){ selected.clear(); renderCustoms(); return; }
    if (b.dataset.bulk === 'all'){ filtered().forEach(t => selected.add(t.id)); renderCustoms(); return; }
    const bar = $('bulk'), type = bar.querySelector('[data-b="type"]').value;
    const trip = (bar.querySelector('[data-b="trip"]') || {}).value, cat = (bar.querySelector('[data-b="cat"]') || {}).value || null, sub = (bar.querySelector('[data-b="sub"]') || {}).value || null;
    let n = 0;
    A().txns.forEach(t => { if (!selected.has(t.id)) return; n++;
      if (type === 'travel') declare(t, { type, trip:trip === 'auto' || !trip ? tripForDate(state.trips, t.date) : trip, cat:cat || t.cat, sub:cat ? sub : t.sub, how:'you' });
      else { declare(t, { type, how:'you' }); if (type === 'unsorted') t.how = null; } });
    selected.clear(); update(); toast(`Declared ${n} transaction${n === 1 ? '' : 's'} as ${typeLabel(type).toLowerCase()}.`);
  });
}

// ---------- check-ins ----------
function buildCheckinForm(){
  const now = new Date();
  $('ciForm').innerHTML = `<label>Statement month<input type="month" id="ciMonth" value="${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}"></label>
    <label>Travel fund balance<input type="number" id="ciFund" step="0.01" inputmode="decimal" placeholder="e.g. 18250.00"></label>
    <label>Loan balance (optional)<input type="number" id="ciLoan" step="0.01" inputmode="decimal" placeholder="e.g. 48120.55"></label>
    <div><button class="go" id="ciSave">Save check-in</button></div>`;
  $('ciSave').addEventListener('click', () => {
    const ym = $('ciMonth').value, fund = $('ciFund').value, loan = $('ciLoan').value;
    if (!ym || (fund === '' && loan === '')){ toast('Pick a month and enter at least one balance.'); return; }
    A().checkins = A().checkins.filter(c => c.ym !== ym);
    A().checkins.push({ id:uid('c'), ym, fund:fund === '' ? '' : +fund, loan:loan === '' ? '' : +loan });
    $('ciFund').value = ''; $('ciLoan').value = '';
    update(); toast(`Check-in saved for ${mon(+ym.slice(0, 4), +ym.slice(5) - 1)}.`);
  });
  $('useAnchor').addEventListener('change', e => { A().useAnchor = e.target.checked; update(); });
  $('ciRows').addEventListener('click', e => { const b = e.target.closest('[data-ci]'); if (!b) return; A().checkins = A().checkins.filter(c => c.id !== b.dataset.ci); update(); });
}
function renderCheckins(){
  $('useAnchor').checked = !!A().useAnchor;
  const rows = reconcile(state, oPlan).reverse(), num = v => v === '' || v === null || v === undefined ? null : +v;
  const diff = (a, b) => a === null || b === null ? '—' : `<span class="${a - b < 0 ? 'neg' : ''}">${a - b >= 0 ? '+' : ''}${usd.format(a - b)}</span>`;
  $('ciRows').innerHTML = !rows.length ? `<tr><td colspan="8" style="text-align:left;color:var(--muted);font-family:var(--body)">No check-ins yet. Add the ending balances from your latest statements above.</td></tr>` : rows.map(r => {
    const f = num(r.fund), l = num(r.loan);
    return `<tr><td>${mon(+r.ym.slice(0, 4), +r.ym.slice(5) - 1)}</td><td>${f === null ? '—' : usd2.format(f)}</td><td>${r.planned === null ? '—' : usd.format(r.planned)}</td><td>${diff(f, r.planned)}</td>
      <td title="Previous check-in plus deposits and interest, minus travel spending">${r.expected === null ? '—' : `${usd.format(r.expected)} ${f !== null && Math.abs(f - r.expected) >= 1 ? `<span class="tag warn">off by ${usd.format(Math.abs(f - r.expected))}</span>` : f !== null ? '<span class="tag ok">matches</span>' : ''}`}</td>
      <td>${l === null ? '—' : usd2.format(l)}</td><td>${usd.format(r.plannedLoan)}</td><td><button class="icon-x" data-ci="${r.id}" aria-label="Remove this check-in"><svg class="i"><use href="#i-x"/></svg></button></td></tr>`;
  }).join('');
}

// ---------- categories and rules ----------
function renderSetup(){
  $('catEditor').innerHTML = A().cats.map(c => `<div class="cat-ed" data-cat="${c.id}">
      <div class="top"><input value="${esc(c.name)}" data-e="cat-name" aria-label="Category name"><button class="icon-x" data-e="cat-del" aria-label="Remove ${esc(c.name)}" title="Remove category"><svg class="i"><use href="#i-x"/></svg></button></div>
      <div class="subs">${c.subs.map(s => `<span class="sub" data-sub="${s.id}"><input value="${esc(s.name)}" data-e="sub-name" size="${Math.max(6, s.name.length)}" aria-label="Subcategory name"><button class="icon-x" data-e="sub-del" aria-label="Remove ${esc(s.name)}"><svg class="i"><use href="#i-x"/></svg></button></span>`).join('')}
        <button data-e="sub-add" style="padding:6px 10px;font-size:12px">Add subcategory</button></div></div>`).join('') +
    `<div class="tools"><button data-e="cat-add">Add a category</button><button class="quiet" data-e="cat-defaults">Restore default categories</button></div>`;
  $('ruleList').innerHTML = (A().rules.length ? A().rules.map(r => `<div class="rule-row"><div>Contains "<b>${esc(r.match)}</b>"<small>${r.account === 'any' ? 'Any account' : esc(accountLabel(r.account))}: ${esc(typeLabel(r.type))}${r.type === 'travel' && r.cat ? `, ${esc(catName(r.cat))}${r.sub ? ' / ' + esc(subName(r.cat, r.sub)) : ''}` : ''}</small></div><button class="icon-x" data-rule-del="${r.id}" aria-label="Delete rule"><svg class="i"><use href="#i-x"/></svg></button></div>`).join('')
    : `<p class="sub" style="margin:0">No rules yet.</p>`) + `<div class="tools" style="margin-top:12px"><button data-rule-run>Run rules on waiting transactions</button></div>`;
}
function wireSetup(){
  const ed = $('catEditor');
  ed.addEventListener('input', e => {
    const c = A().cats.find(x => x.id === (e.target.closest('[data-cat]') || {}).dataset?.cat); if (!c) return;
    if (e.target.dataset.e === 'cat-name') c.name = e.target.value;
    if (e.target.dataset.e === 'sub-name'){ const s = c.subs.find(x => x.id === e.target.closest('[data-sub]').dataset.sub); if (s){ s.name = e.target.value; e.target.size = Math.max(6, s.name.length); } }
    update({ skipSetup:true });
  });
  ed.addEventListener('click', e => {
    const b = e.target.closest('[data-e]'); if (!b) return;
    const act = b.dataset.e, box = b.closest('[data-cat]'), c = box && A().cats.find(x => x.id === box.dataset.cat);
    if (act === 'sub-add' && c){ const id = uid('s'); c.subs.push({ id, name:'New subcategory' }); update(); const inp = ed.querySelector(`[data-sub="${id}"] input`); if (inp){ inp.focus(); inp.select(); } }
    if (act === 'sub-del' && c){ const sid = b.closest('[data-sub]').dataset.sub; c.subs = c.subs.filter(s => s.id !== sid); A().txns.forEach(t => { if (t.cat === c.id && t.sub === sid) t.sub = null; }); update(); }
    if (act === 'cat-del' && c){ const used = A().txns.filter(t => t.cat === c.id).length; if (used && !confirm(`${used} transaction${used === 1 ? ' uses' : 's use'} ${c.name}. Remove it and leave them uncategorized?`)) return;
      A().cats = A().cats.filter(x => x.id !== c.id); A().txns.forEach(t => { if (t.cat === c.id){ t.cat = null; t.sub = null; } }); update(); }
    if (act === 'cat-add'){ const id = uid('c'); A().cats.push({ id, name:'New category', subs:[] }); update(); const inp = ed.querySelector(`[data-cat="${id}"] input`); if (inp){ inp.focus(); inp.select(); } }
    if (act === 'cat-defaults'){
      DEFAULT_CATS.forEach(d => { let c2 = A().cats.find(x => x.id === d.id); if (!c2){ A().cats.push(structuredClone(d)); return; } d.subs.forEach(s => { if (!c2.subs.some(x => x.id === s.id)) c2.subs.push({ ...s }); }); });
      update(); toast('Default categories are back. Your own categories were kept.');
    }
  });
  $('ruleList').addEventListener('click', e => {
    const del = e.target.closest('[data-rule-del]');
    if (del){ A().rules = A().rules.filter(r => r.id !== del.dataset.ruleDel); update(); return; }
    if (e.target.closest('[data-rule-run]')){
      let n = 0;
      A().txns.forEach(t => { if (t.type !== 'unsorted') return; const d = autoDeclare(t, { ...A(), rules:A().rules }, state.trips); if (d.how === 'rule'){ t.type = d.type; t.trip = d.trip || null; t.cat = d.cat || null; t.sub = d.sub || null; t.how = 'rule'; n++; } });
      update(); toast(n ? `Rules declared ${n} transaction${n === 1 ? '' : 's'}.` : 'No waiting transactions matched a rule.');
    }
  });
}

function wireActuals(){
  document.querySelector('.seg').addEventListener('click', e => { const b = e.target.closest('[data-sec]'); if (b) showSec(b.dataset.sec); });
  $('actTiles').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) showSec(b.dataset.go); });
  wireImport(); wireBatches(); buildManual(); wireCustoms(); buildCheckinForm(); wireSetup();
}
