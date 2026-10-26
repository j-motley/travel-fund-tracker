// ===================== importers.js — read bank exports, no network =====================
// Supported: CSV / TSV / TXT (any delimiter), OFX / QFX / QBO, QIF, Excel .xlsx

const MON_NAMES = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };
const pad2 = n => String(n).padStart(2, '0');
const isoOf = (y, m, d) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
const fixYear = y => y < 100 ? 2000 + y : y;

// ---------- dates ----------
function excelSerialToISO(n){ const ms = Math.round((n - 25569) * 86400000); const d = new Date(ms); return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
function parseDate(raw, fmt){
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim(); if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)){ const n = parseFloat(s); if (n > 20000 && n < 80000) return excelSerialToISO(n); }
  let m;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/)) && !/[\/\-.]/.test(s.slice(0, 8))) return isoOf(+m[1], +m[2], +m[3]);       // 20270105, OFX
  if ((m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) return isoOf(+m[1], +m[2], +m[3]);                      // 2027-01-05
  s = s.replace(/'/g, '/').trim();
  if ((m = s.match(/^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})/))){
    const a = +m[1], b = +m[2], y = fixYear(+m[3]);
    if (fmt === 'DMY' || (!fmt || fmt === 'auto') && a > 12) return isoOf(y, b, a);
    return isoOf(y, a, b);
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})/))){ const mo = MON_NAMES[m[1].slice(0, 4).toLowerCase()] || MON_NAMES[m[1].slice(0, 3).toLowerCase()]; return mo ? isoOf(fixYear(+m[3]), mo, +m[2]) : null; }
  if ((m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3,9})\.?[\s\-,]+(\d{2,4})/))){ const mo = MON_NAMES[m[2].slice(0, 4).toLowerCase()] || MON_NAMES[m[2].slice(0, 3).toLowerCase()]; return mo ? isoOf(fixYear(+m[3]), mo, +m[1]) : null; }
  return null;
}
// Look at sample date strings and decide month-first vs day-first.
function sniffDateFormat(samples){
  let dmy = 0, mdy = 0;
  samples.forEach(s => { const m = String(s || '').match(/^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]/); if (!m) return; if (+m[1] > 12) dmy++; if (+m[2] > 12) mdy++; });
  return dmy > mdy ? 'DMY' : 'MDY';
}

// ---------- amounts ----------
function parseAmount(raw){
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim(); if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)){ neg = true; s = s.slice(1, -1); }
  if (/\s*(DR|DB|debit)$/i.test(s)){ neg = true; s = s.replace(/\s*(DR|DB|debit)$/i, ''); }
  s = s.replace(/\s*(CR|credit)$/i, '');
  if (/-\s*$/.test(s)){ neg = !neg; s = s.replace(/-\s*$/, ''); }
  if (/^\s*[-−–]/.test(s)){ neg = !neg; s = s.replace(/^\s*[-−–]/, ''); }
  s = s.replace(/^\+/, '').replace(/[^\d.,]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,56
  else s = s.replace(/,/g, '');
  if (!s) return NaN;
  const v = parseFloat(s);
  return isNaN(v) ? NaN : (neg ? -v : v);
}

// ---------- delimited text ----------
function sniffDelimiter(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 12);
  let best = ',', score = -1;
  [',', ';', '\t', '|'].forEach(d => {
    const counts = lines.map(l => { let n = 0, q = false; for (const ch of l){ if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; });
    const top = Math.max(...counts), common = counts.filter(c => c === top).length;
    const sc = top ? top * common : 0;
    if (sc > score){ score = sc; best = d; }
  });
  return best;
}
function parseDelimited(text, delim){
  text = text.replace(/^﻿/, '');
  delim = delim || sniffDelimiter(text);
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){
      if (ch === '"'){ if (text[i + 1] === '"'){ cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim){ row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r'){ if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length){ row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''));
}

// ---------- header + column guessing for tabular files ----------
const HEAD = {
  date:/(^|\b)(trans(action)?\.?\s*date|posted\s*date|post\s*date|posting\s*date|date)(\b|$)/i,
  desc:/(desc|payee|merchant|name|memo|details|narrative|reference|transaction$|^transaction\b(?!.*date))/i,
  amount:/^(amount|amt|value|transaction amount|amount \(usd\)|net amount)$/i,
  debit:/(debit|withdraw|charge|money out|outflow|paid out|spent|payment amount)/i,
  credit:/(credit|deposit|money in|inflow|paid in|received)/i,
  skip:/(balance|running|category|type|status|check|card no|account)/i,
};
function findHeaderRow(rows){
  for (let i = 0; i < Math.min(rows.length, 25); i++){
    const r = rows[i];
    if (r.length >= 2 && r.some(c => /date/i.test(c)) && r.some(c => /(amount|debit|credit|desc|payee|merchant|name|memo|withdraw|deposit)/i.test(c))) return i;
  }
  // no header words: if the first row already holds a date, there is no header
  return rows.length && rows[0].some(c => parseDate(c)) ? -1 : 0;
}
function guessColumns(headers, sample){
  const n = headers.length, g = { date:-1, desc:-1, amount:-1, debit:-1, credit:-1 };
  const used = new Set();
  const pick = (role, test) => { if (g[role] >= 0) return; for (let i = 0; i < n; i++){ if (!used.has(i) && test(headers[i] || '', i)){ g[role] = i; used.add(i); return; } } };
  pick('date', h => HEAD.date.test(h));
  pick('amount', h => HEAD.amount.test(h.trim()));
  pick('debit', h => HEAD.debit.test(h) && !HEAD.skip.test(h));
  pick('credit', h => HEAD.credit.test(h) && !/card/i.test(h) && !HEAD.skip.test(h));
  pick('desc', h => HEAD.desc.test(h) && !HEAD.date.test(h));
  // fall back on the data itself
  const colVals = i => sample.map(r => r[i]);
  if (g.date < 0) pick('date', (h, i) => colVals(i).filter(v => parseDate(v)).length >= Math.max(1, sample.length * .6));
  if (g.amount < 0 && g.debit < 0 && g.credit < 0) pick('amount', (h, i) => !HEAD.skip.test(h) && colVals(i).filter(v => v !== '' && !isNaN(parseAmount(v)) && !parseDate(v)).length >= Math.max(1, sample.length * .6));
  if (g.desc < 0){
    let best = -1, len = 0;
    for (let i = 0; i < n; i++){ if (used.has(i)) continue; const L = colVals(i).reduce((a, v) => a + (isNaN(parseAmount(v)) ? String(v || '').length : 0), 0); if (L > len){ len = L; best = i; } }
    if (best >= 0){ g.desc = best; used.add(best); }
  }
  return g;
}
// Turn mapped rows into transactions. map = {date, desc, amount, debit, credit, dateFmt, invert}
function rowsToTxns(rows, map){
  const fmt = map.dateFmt && map.dateFmt !== 'auto' ? map.dateFmt : sniffDateFormat(rows.map(r => r[map.date]));
  const out = [], bad = [];
  rows.forEach((r, idx) => {
    const date = parseDate(r[map.date], fmt);
    let amount;
    if (map.amount >= 0) amount = parseAmount(r[map.amount]);
    else {
      const d = map.debit >= 0 ? parseAmount(r[map.debit]) : NaN, c = map.credit >= 0 ? parseAmount(r[map.credit]) : NaN;
      amount = (isNaN(c) ? 0 : Math.abs(c)) - (isNaN(d) ? 0 : Math.abs(d));
      if (isNaN(d) && isNaN(c)) amount = NaN;
    }
    if (map.invert && !isNaN(amount)) amount = -amount;
    const desc = map.desc >= 0 ? String(r[map.desc] || '').replace(/\s+/g, ' ').trim() : '';
    if (!date || isNaN(amount) || amount === 0){ bad.push(idx); return; }
    out.push({ date, desc:desc || '(no description)', amount:Math.round(amount * 100) / 100 });
  });
  return { txns:out, skipped:bad.length, dateFmt:fmt };
}

// ---------- OFX / QFX / QBO (SGML or XML) ----------
function parseOFX(text){
  const body = text.slice(Math.max(0, text.search(/<OFX>/i)));
  const tag = (blk, name) => { const m = blk.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i')); return m ? m[1].trim() : ''; };
  const ents = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
  const blocks = body.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>/i)[0]);
  const txns = blocks.map(b => {
    const name = ents(tag(b, 'NAME')), memo = ents(tag(b, 'MEMO'));
    const desc = [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' — ') || tag(b, 'TRNTYPE');
    return { date:parseDate(tag(b, 'DTPOSTED').slice(0, 8)), amount:Math.round(parseAmount(tag(b, 'TRNAMT')) * 100) / 100, desc, fitid:tag(b, 'FITID') };
  }).filter(t => t.date && !isNaN(t.amount) && t.amount !== 0);
  let hint = 'other';
  if (/<CCACCTFROM>/i.test(body)) hint = 'card';
  else if (/<ACCTTYPE>\s*SAVINGS/i.test(body) || /<ACCTTYPE>\s*MONEYMRKT/i.test(body)) hint = 'fund';
  else if (/<ACCTTYPE>\s*CHECKING/i.test(body)) hint = 'checking';
  else if (/<LOANACCTFROM>|<ACCTTYPE>\s*CREDITLINE/i.test(body)) hint = 'loan';
  return { txns, hint, skipped:blocks.length - txns.length };
}

// ---------- QIF ----------
function parseQIF(text){
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let hint = 'other', cur = {}; const raw = [];
  lines.forEach(l => {
    if (/^!Type:CCard/i.test(l)) hint = 'card'; else if (/^!Type:Bank/i.test(l)) hint = 'checking'; else if (/^!Type:Oth L/i.test(l)) hint = 'loan';
    if (!l || l[0] === '!') return;
    const k = l[0], v = l.slice(1).trim();
    if (k === '^'){ if (Object.keys(cur).length) raw.push(cur); cur = {}; return; }
    if (k === 'D') cur.d = v; else if (k === 'T' || k === 'U') cur.t = v; else if (k === 'P') cur.p = v; else if (k === 'M') cur.m = v; else if (k === 'N') cur.n = v;
  });
  if (Object.keys(cur).length) raw.push(cur);
  const fmt = sniffDateFormat(raw.map(r => (r.d || '').replace(/'/g, '/')));
  const txns = raw.map(r => ({ date:parseDate(r.d, fmt), amount:Math.round(parseAmount(r.t) * 100) / 100, desc:[r.p, r.m && r.m !== r.p ? r.m : ''].filter(Boolean).join(' — ') || '(no description)' }))
    .filter(t => t.date && !isNaN(t.amount) && t.amount !== 0);
  return { txns, hint, skipped:raw.length - txns.length };
}

// ---------- XLSX (first sheet) ----------
async function inflateRaw(bytes){
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzipEntries(buf, wanted){
  const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--){ if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
  if (eocd < 0) throw new Error('This file is not a valid .xlsx workbook.');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let e = 0; e < count; e++){
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!wanted(name)) continue;
    const ds = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    const data = u8.subarray(ds, ds + csize);
    out[name] = dec.decode(method === 0 ? data : await inflateRaw(data));
  }
  return out;
}
const xmlText = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
async function parseXLSX(buf){
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files. Save the sheet as CSV and import that instead.');
  const files = await unzipEntries(buf, n => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = [];
  (files['xl/sharedStrings.xml'] || '').replace(/<si>([\s\S]*?)<\/si>/g, (_, si) => { shared.push(xmlText((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).join(''))); });
  // first sheet in workbook order
  let sheetPath = Object.keys(files).filter(n => n.startsWith('xl/worksheets/')).sort()[0];
  const wb = files['xl/workbook.xml'], rels = files['xl/_rels/workbook.xml.rels'];
  if (wb && rels){
    const rid = (wb.match(/<sheet\b[^>]*r:id="([^"]+)"/) || [])[1];
    const tgt = rid && (rels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${rid}"`)) || [])[1];
    if (tgt){ const pth = 'xl/' + tgt.replace(/^\/?xl\//, '').replace(/^\.\//, ''); if (files[pth]) sheetPath = pth; }
  }
  if (!sheetPath) throw new Error('No worksheet found in this workbook.');
  const xml = files[sheetPath], rows = [];
  const colIdx = ref => { const L = ref.replace(/\d+/g, ''); let n = 0; for (const ch of L) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  (xml.match(/<row\b[\s\S]*?<\/row>/g) || []).forEach(rx => {
    const r = [];
    (rx.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach(cx => {
      const ref = (cx.match(/\br="([A-Z]+\d+)"/) || [])[1], t = (cx.match(/\bt="([^"]+)"/) || [])[1];
      const v = (cx.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 's') val = shared[+v] || '';
      else if (t === 'inlineStr') val = xmlText((cx.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || '');
      else if (v !== undefined) val = xmlText(v);
      const i = ref ? colIdx(ref) : r.length;
      while (r.length < i) r.push('');
      r[i] = String(val).trim();
    });
    if (r.some(c => c !== '')) rows.push(r);
  });
  return rows;
}

// ---------- detect + read any supported file ----------
function sniffKind(name, bytes){
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (bytes[0] === 0x50 && bytes[1] === 0x4B) return 'xlsx';
  if (bytes[0] === 0xD0 && bytes[1] === 0xCF) return 'xls';
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  const head = new TextDecoder().decode(bytes.subarray(0, 4000));
  if (/OFXHEADER|<OFX>/i.test(head) || ['ofx','qfx','qbo'].includes(ext)) return 'ofx';
  if (/^﻿?!Type:/im.test(head) || ext === 'qif') return 'qif';
  return 'table';
}
// Returns {kind, rows?} for tables (needs column mapping) or {kind, txns, hint, skipped} for OFX/QIF.
async function readBankFile(name, buf){
  const bytes = new Uint8Array(buf), kind = sniffKind(name, bytes);
  if (kind === 'xls') throw new Error('Old .xls workbooks are not supported. Open it and save as .xlsx or CSV, then import again.');
  if (kind === 'pdf') throw new Error('PDF statements cannot be read. Download the CSV, OFX/QFX or QIF export from your bank instead.');
  if (kind === 'xlsx') return { kind:'table', rows:await parseXLSX(buf), source:'Excel' };
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes);
  if (kind === 'ofx') return { kind:'ofx', ...parseOFX(text), source:'OFX' };
  if (kind === 'qif') return { kind:'qif', ...parseQIF(text), source:'QIF' };
  const rows = parseDelimited(text);
  if (!rows.length) throw new Error('That file looks empty.');
  return { kind:'table', rows, source:'CSV' };
}

// ---------- duplicate keys ----------
const normDesc = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function baseKey(account, t){ return t.fitid ? `fit|${account}|${t.fitid}` : `${account}|${t.date}|${t.amount.toFixed(2)}|${normDesc(t.desc)}`; }
// Same coffee twice in one day is legitimate: number repeats within a file.
function keyTxns(account, txns){ const seen = {}; return txns.map(t => { const b = baseKey(account, t); seen[b] = (seen[b] || 0) + 1; return { ...t, key:`${b}#${seen[b]}` }; }); }

if (typeof module !== 'undefined') module.exports = { parseDate, parseAmount, parseDelimited, sniffDelimiter, findHeaderRow, guessColumns, rowsToTxns, parseOFX, parseQIF, parseXLSX, readBankFile, keyTxns, normDesc, sniffDateFormat };
