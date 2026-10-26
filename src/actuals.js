// ===================== actuals.js — real transactions, pure logic =====================
const ACCOUNTS = [
  { id:'card', label:'Travel credit card' },
  { id:'fund', label:'Travel fund savings account' },
  { id:'loan', label:'Loan account' },
  { id:'checking', label:'Checking account' },
  { id:'other', label:'Other account' },
];
const TYPES = [
  { id:'unsorted', label:'Not declared yet' },
  { id:'travel', label:'Travel expense' },
  { id:'deposit', label:'Fund deposit' },
  { id:'seed', label:'Starting money from the loan' },
  { id:'loan', label:'Loan payment' },
  { id:'interest', label:'Interest earned' },
  { id:'transfer', label:"Transfer or card payment (don't count)" },
  { id:'ignore', label:'Not related (ignore)' },
];
const typeLabel = id => (TYPES.find(t => t.id === id) || TYPES[0]).label;
const accountLabel = id => id === 'manual' ? 'Added by hand' : (ACCOUNTS.find(a => a.id === id) || { label:'Other' }).label;

const DEFAULT_CATS = [
  { id:'lodging', name:'Lodging', subs:[['hotels','Hotels'],['rentals','Vacation rentals'],['hostels','Hostels'],['resort','Resort fees']] },
  { id:'food', name:'Food', subs:[['restaurants','Restaurants'],['groceries','Groceries'],['coffee','Coffee and snacks'],['drinks','Drinks']] },
  { id:'transport', name:'Transportation', subs:[['flights','Flights'],['trains','Trains'],['car','Car rental'],['rideshare','Rideshare and taxis'],['gas','Gas and parking'],['transit','Public transit'],['bags','Baggage fees']] },
  { id:'fun', name:'Entertainment', subs:[['museums','Museums'],['shows','Shows and concerts'],['parks','Parks and attractions'],['tours','Tours'],['events','Events and sports']] },
  { id:'other', name:'Other', subs:[['shopping','Shopping and souvenirs'],['insurance','Travel insurance'],['fees','Fees and visas']] },
].map(c => ({ id:c.id, name:c.name, subs:c.subs.map(([id, name]) => ({ id, name })) }));

// keyword guesses for travel expenses -> [category, subcategory]
const GUESSES = [
  [/hotel|inn\b|marriott|hilton|hyatt|sheraton|westin|holiday inn|best western|ritz|motel|lodge|resort|gracery/, 'lodging', 'hotels'],
  [/airbnb|vrbo|homeaway|booking\.com|expedia.*rental/, 'lodging', 'rentals'],
  [/hostel|hostelworld/, 'lodging', 'hostels'],
  [/air ?lines?|airways|\bair\b|delta|united|american air|jetblue|southwest|spirit|frontier|alaska air|ryanair|easyjet|lufthansa|klm|tap air|emirates|qatar|japan airlines|\bjal\b|\bana\b/, 'transport', 'flights'],
  [/baggage|bag fee/, 'transport', 'bags'],
  [/amtrak|rail|\bjr\b|eurostar|trenitalia|sncf|\bdb\b bahn|train/, 'transport', 'trains'],
  [/hertz|avis|enterprise rent|budget rent|sixt|national car|alamo|thrifty|rent-a-car|car rental/, 'transport', 'car'],
  [/uber|lyft|taxi|cab\b|bolt\b|grab\b/, 'transport', 'rideshare'],
  [/shell|exxon|mobil|chevron|\bbp\b|texaco|sunoco|parking|park ?mobile|gas station|fuel/, 'transport', 'gas'],
  [/metro|transit|\bmta\b|subway|suica|pasmo|oyster|bus\b|ferry/, 'transport', 'transit'],
  [/museum|museu|museo|musée|gallery|louvre|smithsonian/, 'fun', 'museums'],
  [/theat|broadway|telecharge|ticketmaster|concert|opera|symphony|show\b|live nation|stubhub/, 'fun', 'shows'],
  [/\bpark\b|zoo|aquarium|disney|universal|six flags|national park|teamlab|attraction/, 'fun', 'parks'],
  [/tour|viator|getyourguide|trolley|excursion|klook/, 'fun', 'tours'],
  [/stadium|tickets|arena|match|game\b/, 'fun', 'events'],
  [/insurance|allianz|travel guard/, 'other', 'insurance'],
  [/visa\b|passport|esta|e-visa/, 'other', 'fees'],
  [/souvenir|gift shop|duty free/, 'other', 'shopping'],
  [/time out market|food hall|food court/, 'food', 'restaurants'],
  [/grocery|market\b|supermarket|whole foods|trader joe|carrefour|tesco|aldi|lidl|7-eleven|konbini|lawson|familymart/, 'food', 'groceries'],
  [/coffee|cafe|café|starbucks|bakery|pastel|pasteis|pastry|patisserie|donut|gelato|dunkin/, 'food', 'coffee'],
  [/\bbar\b|pub\b|brewery|wine|tavern|cocktail/, 'food', 'drinks'],
  [/restaurant|grill|bistro|kitchen|diner|pizza|ramen|sushi|taco|burger|bbq|trattoria|brasserie|house\b|eatery|time out market|food/, 'food', 'restaurants'],
];
function guessCategory(desc){
  const d = String(desc || '').toLowerCase();
  for (const [re, cat, sub] of GUESSES) if (re.test(d)) return { cat, sub };
  return { cat:null, sub:null };
}

const emptyActuals = () => ({ txns:[], batches:[], checkins:[], rules:[], cats:structuredClone(DEFAULT_CATS), mappings:{}, useAnchor:true, trackBy:'auto' });
function normalizeActuals(a){
  const d = emptyActuals();
  if (!a || typeof a !== 'object') return d;
  return { ...d, ...a, txns:Array.isArray(a.txns) ? a.txns : [], batches:Array.isArray(a.batches) ? a.batches : [], checkins:Array.isArray(a.checkins) ? a.checkins : [],
           rules:Array.isArray(a.rules) ? a.rules : [], cats:Array.isArray(a.cats) && a.cats.length ? a.cats : d.cats, mappings:a.mappings || {} };
}
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ymOf = date => ({ year:+date.slice(0, 4), month:+date.slice(5, 7) - 1 });

// Which trip does a travel expense belong to? The trip planned for that month, else general travel.
function tripForDate(trips, date){
  const { year, month } = ymOf(date);
  const t = (trips || []).find(t => t.year === year && t.month === month);
  return t ? t.id : 'general';
}

// First pass on an imported transaction: your rules, then sensible defaults for the account.
function autoDeclare(t, actuals, trips){
  const d = String(t.desc || '').toLowerCase();
  for (const r of actuals.rules){
    if (r.match && d.includes(r.match.toLowerCase()) && (r.account === 'any' || r.account === t.account)){
      const out = { type:r.type, trip:null, cat:null, sub:null, how:'rule' };
      if (r.type === 'travel'){ out.trip = r.trip && r.trip !== 'auto' ? r.trip : tripForDate(trips, t.date); out.cat = r.cat || null; out.sub = r.sub || null; }
      return out;
    }
  }
  const travel = () => { const g = guessCategory(t.desc); return { type:'travel', trip:tripForDate(trips, t.date), cat:g.cat, sub:g.sub, how:'guess' }; };
  const looksPayment = /payment|thank you|autopay|pymt|transfer/.test(d);
  if (t.account === 'card') return t.amount > 0 && looksPayment ? { type:'transfer', how:'guess' } : travel();
  if (t.account === 'fund'){
    if (t.amount > 0) return /interest|dividend|int paid|apy/.test(d) ? { type:'interest', how:'guess' } : /loan proceeds|proceeds|opening deposit|initial deposit/.test(d) ? { type:'seed', how:'guess' } : { type:'deposit', how:'guess' };
    return { type:'transfer', how:'guess' };
  }
  if (t.account === 'loan') return t.amount > 0 ? { type:'loan', how:'guess' } : { type:'ignore', how:'guess' };
  return { type:'unsorted', how:null };
}

// Positive numbers for display: what each transaction means for the plan.
function actualValue(t){
  if (t.type === 'travel') return -t.amount;          // charges are negative; refunds reduce spend
  if (t.type === 'loan' || t.type === 'deposit' || t.type === 'interest' || t.type === 'seed') return Math.abs(t.amount);
  return 0;
}

function summarizeActuals(s){
  const a = s.actuals, sum = { loan:0, loanCount:0, deposit:0, interest:0, travel:0, seed:0, unsorted:0, byYear:{}, byTrip:{}, byCat:{}, byMonth:{}, count:a.txns.length };
  a.txns.forEach(t => {
    if (t.type === 'unsorted'){ sum.unsorted++; return; }
    const v = actualValue(t); if (!v) return;
    const y = +t.date.slice(0, 4), ym = t.date.slice(0, 7);
    const Y = sum.byYear[y] || (sum.byYear[y] = { travel:0, deposit:0, loan:0, interest:0, seed:0 });
    const M = sum.byMonth[ym] || (sum.byMonth[ym] = { travel:0, deposit:0, loan:0, interest:0, seed:0 });
    Y[t.type] += v; M[t.type] += v; sum[t.type] += v;
    if (t.type === 'loan') sum.loanCount++;
    if (t.type === 'travel'){
      const tripId = t.trip || 'general', cat = t.cat || 'none', sub = t.sub || 'none';
      const T = sum.byTrip[tripId] || (sum.byTrip[tripId] = { total:0, byCat:{} });
      T.total += v; T.byCat[cat] = (T.byCat[cat] || 0) + v;
      const C = sum.byCat[cat] || (sum.byCat[cat] = { total:0, bySub:{} });
      C.total += v; C.bySub[sub] = (C.bySub[sub] || 0) + v;
    }
  });
  return sum;
}

// Monthly index helpers relative to the plan's first payment month (k = 0).
const kOfDate = (s, date) => { const { year, month } = ymOf(date); return monthIndexOf(s, year, month); };
const kOfYM = (s, ym) => kOfDate(s, ym + '-01');

// The real loan: actual payments up to month `uptoK`, scheduled payments after `asOfK`.
function loanActual(s, o, uptoK, asOfK){
  const r = s.loanRate / 100 / 12, pays = {};
  s.actuals.txns.filter(t => t.type === 'loan').forEach(t => { const k = Math.max(0, kOfDate(s, t.date)); pays[k] = (pays[k] || 0) + Math.abs(t.amount); });
  const loanChecks = s.actuals.checkins.filter(c => c.loan !== null && c.loan !== undefined && c.loan !== '').map(c => ({ k:kOfYM(s, c.ym), bal:+c.loan })).sort((a, b) => a.k - b.k);
  let bal = s.loanAmount, paidAmt = 0, count = 0;
  for (let k = 0; k <= uptoK && bal > 0.005; k++){
    bal *= 1 + r;
    const p = k <= asOfK ? (pays[k] || 0) : Math.min(o.payment, bal);
    bal -= p; paidAmt += p; if (p > 0) count++;
    const chk = loanChecks.find(c => c.k === k && k <= asOfK); if (chk) bal = chk.bal;
  }
  bal = Math.max(0, bal);
  // progress measured by where the balance sits on the planned schedule (extra payments move you ahead)
  const ahead = bal <= 0.005 ? o.nLoan : o.loan.filter(p => p.balance >= bal - 0.01).length;
  return { bal, paidAmt, count, paidEq:Math.min(o.nLoan, Math.max(ahead, 0)) };
}
const hasLoanActuals = s => s.actuals.txns.some(t => t.type === 'loan') || s.actuals.checkins.some(c => c.loan !== null && c.loan !== undefined && c.loan !== '');

// Fund check-ins as points on the fuel chart; the latest one re-anchors the forecast.
function fundPoints(s){
  return s.actuals.checkins.filter(c => c.fund !== null && c.fund !== undefined && c.fund !== '').map(c => ({ k:kOfYM(s, c.ym), bal:+c.fund, ym:c.ym })).filter(p => p.k >= 0 && p.k < planYearsOf(s) * 12).sort((a, b) => a.k - b.k);
}
function latestAnchor(s){ if (!s.actuals.useAnchor) return null; const pts = fundPoints(s); return pts.length ? pts.at(-1) : null; }

// Reconcile each pair of check-ins against the transactions between them.
function reconcile(s, oPlan){
  const pts = [...s.actuals.checkins].sort((a, b) => a.ym.localeCompare(b.ym));
  return pts.map((c, i) => {
    const k = kOfYM(s, c.ym), planned = k >= 0 && k < oPlan.months.length ? oPlan.months[k].bal : null;
    const plannedLoan = k >= 0 && k < oPlan.nLoan ? oPlan.loan[k].balance : (k >= oPlan.nLoan ? 0 : s.loanAmount);
    let expected = null;
    const prev = pts.slice(0, i).reverse().find(p => p.fund !== '' && p.fund !== null && p.fund !== undefined);
    if (prev && c.fund !== '' && c.fund !== null){
      const inRange = t => t.date.slice(0, 7) > prev.ym && t.date.slice(0, 7) <= c.ym;
      const flows = s.actuals.txns.filter(inRange).reduce((a, t) => a + (t.type === 'deposit' || t.type === 'interest' || t.type === 'seed' ? Math.abs(t.amount) : t.type === 'travel' ? t.amount : 0), 0);
      expected = +prev.fund + flows;
    }
    return { ...c, k, planned, plannedLoan, expected };
  });
}

// Apply a declaration to a transaction (keeps the rest).
function declare(t, d){
  t.type = d.type;
  if (d.type === 'travel'){ t.trip = d.trip !== undefined ? d.trip : (t.trip || 'general'); t.cat = d.cat !== undefined ? d.cat : t.cat || null; t.sub = d.sub !== undefined ? d.sub : t.sub || null; }
  else { t.trip = null; t.cat = null; t.sub = null; }
  t.how = d.how || 'you';
  return t;
}
// A short, reusable "contains" phrase for a rule: the first two meaningful words.
function rulePhrase(desc){
  const d = String(desc || '');
  const words = d.split(/[\s*#]+/).filter(w => w.length > 1 && !/^\d+$/.test(w) && !/^(the|of|and|de|da|do|la|le|el|du|del|di|pos|purchase|debit|card|sq|tst)$/i.test(w));
  if (!words.length) return d.trim().slice(0, 12);
  const two = words.slice(0, 2).join(' ');
  return words.length > 1 && d.toLowerCase().includes(two.toLowerCase()) ? two : words[0];   // only phrases that really appear in the text
}

if (typeof module !== 'undefined') module.exports = { ACCOUNTS, TYPES, DEFAULT_CATS, guessCategory, emptyActuals, normalizeActuals, autoDeclare, actualValue, summarizeActuals, loanActual, fundPoints, latestAnchor, reconcile, declare, rulePhrase, tripForDate, hasLoanActuals };
