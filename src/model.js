// ===================== model.js — pure math, no DOM =====================
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MAX_PLAN_YEARS = 25, PLAN_EXTRA = 3;
// Years to plan: loan term + 3 by default, never shorter than the loan, never longer than 25.
function planYearsOf(s){ const term = Math.max(1, Math.round(s.termYears)); const want = s.planYears === 'auto' || s.planYears === undefined || s.planYears === null ? term + PLAN_EXTRA : Math.round(s.planYears); return Math.min(MAX_PLAN_YEARS, Math.max(term, want)); }
const DEFAULTS = {
  loanAmount:55000, loanRate:6.25, termYears:5, planYears:'auto', startMonth:1, startYear:2027,
  debts:31000, monthly:1500, apy:4.25,
  firstTravelYear:2027, firstYearSpend:12000, defaultSpend:9600, cushion:2000,
  overrides:{}, trips:[]
};

// Excel PMT(rate, nper, -pv)
function PMT(rate, nper, pv){ if (nper <= 0) return 0; if (rate === 0) return pv / nper; return pv * rate / (1 - Math.pow(1 + rate, -nper)); }

function calc(s, opts){
  opts = opts || {};
  const anchor = opts.anchor || null;
  const nLoan = Math.round(s.termYears * 12);
  const H = planYearsOf(s), N_MONTHS = H * 12, N_YEARS = H + 1;
  const r = s.loanRate / 100 / 12;
  const payment = PMT(r, nLoan, s.loanAmount);
  const totalInterest = payment * nLoan - s.loanAmount;
  const seed = s.loanAmount - s.debts;
  const depLoan = s.monthly - payment, depAfter = s.monthly;
  const mRate = Math.pow(1 + s.apy / 100, 1 / 12) - 1;
  const trips = s.trips || [];

  const years = [];
  for (let k = 0; k < N_YEARS; k++){
    const y = s.startYear + k;
    const ov = s.overrides[y];
    const has = ov !== undefined && ov !== null && ov !== '' && !isNaN(ov);
    const budget = has ? Number(ov) : (y < s.firstTravelYear ? 0 : y === s.firstTravelYear ? s.firstYearSpend : s.defaultSpend);
    const tripTotal = trips.filter(t => t.year === y).reduce((a, t) => a + (Number(t.cost) || 0), 0);
    years.push({ year:y, override:has ? Number(ov) : null, budget, tripTotal, base:Math.max(0, budget - tripTotal) / 12,
                 months:0, withdrawn:0, deposits:0, interest:0, end:null, low:null });
  }
  const byYear = Object.fromEntries(years.map(r => [r.year, r]));

  const months = []; let bal = seed;
  for (let m = 1; m <= N_MONTHS; m++){
    const idx = s.startMonth - 1 + (m - 1);
    const year = s.startYear + Math.floor(idx / 12), month = idx % 12;
    const yr = byYear[year];
    const tripOut = trips.filter(t => t.year === year && t.month === month).reduce((a, t) => a + (Number(t.cost) || 0), 0);
    const baseOut = yr ? yr.base : 0;
    const withdrawal = baseOut + tripOut;
    const loanPay = m <= nLoan ? payment : 0;
    const deposit = m <= nLoan ? depLoan : depAfter;
    const interest = bal * mRate;
    bal = bal + interest + deposit - withdrawal;
    if (anchor && anchor.k === m - 1) bal = anchor.bal;   // real balance from a check-in
    months.push({ m, year, month, loanPay, deposit, baseOut, tripOut, withdrawal, interest, bal });
    if (yr){ yr.months++; yr.withdrawn += withdrawal; yr.deposits += deposit; yr.interest += interest; yr.end = bal; yr.low = yr.low === null ? bal : Math.min(yr.low, bal); }
  }
  const check = v => v === null ? '' : v < 0 ? 'Out of fuel' : v < s.cushion ? 'Turbulence' : 'On time';
  years.forEach(r => r.check = check(r.low));

  const loan = []; let lb = s.loanAmount;
  for (let m = 1; m <= nLoan; m++){
    const idx = s.startMonth - 1 + (m - 1);
    const int = lb * r, prin = payment - int; lb = Math.max(0, lb - prin);
    loan.push({ m, year:s.startYear + Math.floor(idx / 12), month:idx % 12, payment, interest:int, principal:prin, balance:lb });
  }

  const from = anchor ? Math.max(0, Math.min(N_MONTHS - 1, anchor.k)) : 0;   // with real data, judge the road ahead
  let li = from; months.forEach((r, i) => { if (i >= from && r.bal < months[li].bal) li = i; });
  const lowest = months[li];
  const finalPay = months[Math.min(nLoan, N_MONTHS) - 1];
  const firstDry = months.find((r, i) => i >= from && r.bal < 0) || null;
  const status = lowest.bal < 0 ? 'bad' : lowest.bal < s.cushion ? 'warn' : 'ok';
  return { payment, totalInterest, seed, depLoan, depAfter, mRate, nLoan, H, lowest, finalPay, firstDry, status, years, months, loan, anchor };
}

function solveMax(s, opts){
  const ok = v => calc({ ...s, defaultSpend:v }, opts).lowest.bal >= s.cushion;
  if (!ok(0)) return null;
  let lo = 0, hi = 100000;
  for (let i = 0; i < 40; i++){ const mid = (lo + hi) / 2; ok(mid) ? lo = mid : hi = mid; }
  return Math.floor(lo / 50) * 50;
}

// Where is the "flight" (the loan) at relative month k? k = 0 is the first payment month.
function trackerAt(o, s, k){
  const paid = Math.max(0, Math.min(o.nLoan, k + 1));
  const leftToPay = paid === 0 ? s.loanAmount : o.loan[paid - 1].balance;
  const paidSoFar = paid * o.payment;
  const interestSoFar = o.loan.slice(0, paid).reduce((a, p) => a + p.interest, 0);
  const fuel = k < 0 ? o.seed : o.months[Math.min(o.months.length - 1, k)].bal;
  const phase = k < 0 ? 'gate' : paid >= o.nLoan ? 'landed' : 'flying';
  const idx = s.startMonth - 1 + k;
  const year = s.startYear + Math.floor(idx / 12), month = ((idx % 12) + 12) % 12;
  return { k, paid, leftToPay, paidSoFar, interestSoFar, fuel, phase, progress:paid / o.nLoan, year, month };
}
function monthIndexOf(s, year, month){ return (year - s.startYear) * 12 + (month - (s.startMonth - 1)); }

// ---------- CSV ----------
function csvCell(v){ if (v === null || v === undefined) return ''; const t = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
function toCSV(header, rows){ return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
const ymLabel = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;

const DATASETS = {
  settings:{ label:'Plan settings', file:'plan-settings.csv', build:(s, o) => toCSV(['Section','Setting','Value','Unit','Kind'], [
    ['The loan','Loan amount',s.loanAmount,'USD','input'],
    ['The loan','Interest rate',s.loanRate,'% a year','input'],
    ['The loan','Term',s.termYears,'years','input'],
    ['Plan length','Years to plan',planYearsOf(s),'years',s.planYears === 'auto' || s.planYears == null ? 'input (loan term + 3)' : 'input'],
    ['The loan','First payment',ymLabel(s.startYear, s.startMonth - 1),'year-month','input'],
    ['The loan','Debts paid off from the loan',s.debts,'USD','input'],
    ['Money in','Set aside each month',s.monthly,'USD','input'],
    ['Money in','Savings account APY',s.apy,'%','input'],
    ['Money out for travel','First travel year',s.firstTravelYear,'year','input'],
    ['Money out for travel','Spend in the first travel year',s.firstYearSpend,'USD','input'],
    ['Money out for travel','Spend each year after that',s.defaultSpend,'USD','input'],
    ['Money out for travel','Reserve (never drop below)',s.cushion,'USD','input'],
    ...Object.keys(s.overrides).sort().map(y => ['Budget changes', `Travel budget for ${y}`, s.overrides[y], 'USD', 'input']),
    ['Calculated','Monthly loan payment',o.payment,'USD','calculated'],
    ['Calculated','Total interest',o.totalInterest,'USD','calculated'],
    ['Calculated','Final payment',ymLabel(o.finalPay.year, o.finalPay.month),'year-month','calculated'],
    ['Calculated','Travel fund starting balance',o.seed,'USD','calculated'],
    ['Calculated','Into the fund each month during the loan',o.depLoan,'USD','calculated'],
    ['Calculated','Into the fund each month after the loan',o.depAfter,'USD','calculated'],
    ['Calculated','Lowest fund balance',o.lowest.bal,'USD','calculated'],
    ['Calculated','Month of lowest balance',ymLabel(o.lowest.year, o.lowest.month),'year-month','calculated'],
  ]) },
  years:{ label:'Year-by-year summary', file:'year-by-year.csv', build:(s, o) => toCSV(
    ['Year','Months modeled','Travel budget','Trips','Spent','Deposits','Interest earned','Year-end balance','Lowest balance','Status'],
    o.years.filter(r => r.months).map(r => [r.year, r.months, r.budget, r.tripTotal, r.withdrawn, r.deposits, r.interest, r.end, r.low, r.check])) },
  cashflow:{ label:'Projected cash flow (monthly)', file:'projected-cash-flow.csv', build:(s, o) => toCSV(
    ['Month #','Month','Loan payment','Into the fund','Everyday travel spending','Trip spending','Interest earned','Fund balance'],
    o.months.map(r => [r.m, ymLabel(r.year, r.month), r.loanPay, r.deposit, r.baseOut, r.tripOut, r.interest, r.bal])) },
  amortization:{ label:'Loan amortization', file:'loan-amortization.csv', build:(s, o) => toCSV(
    ['Payment #','Month','Payment','Interest','Principal','Balance left'],
    o.loan.map(p => [p.m, ymLabel(p.year, p.month), p.payment, p.interest, p.principal, p.balance])) },
  transactions:{ label:'Actual transactions', file:'actual-transactions.csv', build:(s, o) => {
    const catName = id => { const c = s.actuals.cats.find(c => c.id === id); return c ? c.name : ''; };
    const subName = (cid, id) => { const c = s.actuals.cats.find(c => c.id === cid); const x = c && c.subs.find(x => x.id === id); return x ? x.name : ''; };
    const tripName = id => id === 'general' ? 'General travel' : ((s.trips.find(t => t.id === id) || {}).name || (id ? 'Trip' : ''));
    return toCSV(['Date','Description','Account','Amount','Declared as','Trip','Category','Subcategory','Counts toward plan','Sorted by'],
      [...s.actuals.txns].sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, t.desc, accountLabel(t.account), t.amount, typeLabel(t.type), t.type === 'travel' ? tripName(t.trip) : '', catName(t.cat), subName(t.cat, t.sub), actualValue(t), t.how === 'you' ? 'You' : t.how === 'rule' ? 'Rule' : t.how === 'guess' ? 'Best guess' : '']));
  } },
  travelByCategory:{ label:'Travel spending by trip and category', file:'travel-spending.csv', build:(s, o) => {
    const rows = [], tripName = id => id === 'general' ? 'General travel' : ((s.trips.find(t => t.id === id) || {}).name || 'Trip');
    const key = {}; s.actuals.txns.filter(t => t.type === 'travel').forEach(t => { const k = `${t.trip || 'general'}|${t.cat || ''}|${t.sub || ''}`; key[k] = (key[k] || 0) + actualValue(t); });
    Object.entries(key).forEach(([k, v]) => { const [tr, c, sb] = k.split('|'); const C = s.actuals.cats.find(x => x.id === c); const S = C && C.subs.find(x => x.id === sb); rows.push([tripName(tr), C ? C.name : 'Uncategorized', S ? S.name : '', v]); });
    rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
    return toCSV(['Trip','Category','Subcategory','Spent'], rows);
  } },
  checkins:{ label:'Balance check-ins', file:'balance-check-ins.csv', build:(s, o) => toCSV(['Month','Travel fund balance','Loan balance'],
    [...s.actuals.checkins].sort((a, b) => a.ym.localeCompare(b.ym)).map(c => [c.ym, c.fund === '' ? null : c.fund, c.loan === '' ? null : c.loan])) },
  trips:{ label:'Trips', file:'trips.csv', build:(s, o) => toCSV(['Trip','Month','Cost'],
    [...s.trips].sort((a, b) => a.year - b.year || a.month - b.month).map(t => [t.name || 'Trip', ymLabel(t.year, t.month), Number(t.cost) || 0])) },
};

// ---------- tiny store-only ZIP writer ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes){ let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files){
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  files.forEach(f => {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + data.length;
  });
  const cdSize = central.reduce((a, p) => a + (p.byteLength || p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type:'application/zip' });
}

if (typeof module !== 'undefined') module.exports = { planYearsOf, calc, solveMax, trackerAt, monthIndexOf, DATASETS, makeZip, crc32, DEFAULTS, PMT };
