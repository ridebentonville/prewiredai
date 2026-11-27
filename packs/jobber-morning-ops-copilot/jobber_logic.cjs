/**
 * Jobber Morning Ops Triage Copilot: shared logic (DRAFT v0.1.0).
 *
 * Single source of truth for the Code nodes in workflow.n8n.json and jobber-csv-fallback-triage.json.
 * build_workflow.cjs and build_csv_fallback_workflow.cjs copy the `@@SECTION` blocks below into the
 * n8n Code nodes, and mock_jobber_test.cjs runs both this module and the code extracted from the JSON.
 * Edit here, then run the build scripts.
 *
 * Rules: plain JavaScript only, no require/import inside a section, no network calls, no file access.
 * Nothing here sends anything to anyone and nothing here writes to Jobber. Every number is computed
 * from the data it is given; when a metric cannot be computed the digest gets a Heads-up line.
 *
 * Time policy (documented and tested):
 *   - Dates without an offset ("3/10/2026 9:50 AM", "2026-03-10 09:50") are shop-local wall time in
 *     Config timezone (default America/Chicago).
 *   - A wall time that does not exist (spring-forward gap, e.g. 2026-03-08 2:30 AM Chicago) is moved
 *     FORWARD by the length of the gap (2:30 AM becomes 3:30 AM CDT) and counted in a Heads-up.
 *   - A wall time that happens twice (fall-back, e.g. 2026-11-01 1:30 AM Chicago) is read as the FIRST
 *     occurrence (daylight time) and counted in a Heads-up.
 *   - Impossible calendar dates (2026-02-30, 13/45/2026) are rejected, never rolled over.
 */

// @@SECTION common
const DEFAULTS = {
  pastDueMinDays: 1,
  quoteStalledDays: 14,
  quoteMinValue: 1000,
  maxItemsPerSection: 10,
};
const HOUR = 3600000;
const DAY = 86400000;

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}
function toNum(v, d) {
  if (isBlank(v)) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function toBool(v, d) {
  if (typeof v === 'boolean') return v;
  if (isBlank(v)) return d;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].indexOf(s) !== -1) return true;
  if (['false', 'no', 'n', '0'].indexOf(s) !== -1) return false;
  return d;
}
function parseTime(iso) {
  if (isBlank(iso)) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}
function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const o = {};
  f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
  return { date: o.year + '-' + o.month + '-' + o.day, hour: Number(o.hour), minute: Number(o.minute) };
}
function localDate(ms, tz) {
  return localParts(ms, tz).date;
}
function dayMs(dateStr) {
  const p = String(dateStr).split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}
function dayDiff(fromDate, toDate) {
  return Math.round((dayMs(toDate) - dayMs(fromDate)) / DAY);
}
function cleanSpaces(s) {
  return s.replace(/[  ]/g, ' ');
}
function fmtTime(ms, tz) {
  return cleanSpaces(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms)));
}
function fmtDay(ms, tz) {
  return cleanSpaces(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms))).replace(',', '');
}
function fmtDateOnly(dateStr) {
  // dateStr is YYYY-MM-DD; formatted in UTC so the day never shifts.
  return cleanSpaces(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(dayMs(dateStr))));
}
function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return 'n/a';
  const v = Number(n);
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}
function lc(v) {
  return isBlank(v) ? '' : String(v).trim().toLowerCase();
}
function plural(n, one, many) {
  return n === 1 ? one : (many || one + 's');
}
function uniqueList(list) {
  const out = [];
  const seen = Object.create(null);
  (list || []).forEach(function (x) {
    const s = String(x === null || x === undefined ? '' : x);
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  });
  return out;
}
function statusWord(raw) {
  return String(raw === null || raw === undefined ? '' : raw).toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function jobStatusKey(raw) {
  const w = statusWord(raw);
  if (!w) return '';
  const map = {
    unscheduled: 'unscheduled', late: 'late', actionrequired: 'action_required', requiresinvoicing: 'requires_invoicing',
    active: 'active', inprogress: 'active', upcoming: 'upcoming', today: 'today', completed: 'completed', complete: 'completed',
    closed: 'completed', archived: 'archived', cancelled: 'cancelled', canceled: 'cancelled', endingwithin30days: 'active',
  };
  return Object.prototype.hasOwnProperty.call(map, w) ? map[w] : 'other';
}
function invoiceStatusKey(raw) {
  const w = statusWord(raw);
  if (!w) return '';
  const map = {
    pastdue: 'past_due', overdue: 'past_due', awaitingpayment: 'awaiting_payment', unpaid: 'awaiting_payment', sent: 'awaiting_payment',
    outstanding: 'awaiting_payment', paid: 'paid', draft: 'draft', baddebt: 'bad_debt', void: 'void', voided: 'void',
  };
  return Object.prototype.hasOwnProperty.call(map, w) ? map[w] : 'other';
}
function quoteStatusKey(raw) {
  const w = statusWord(raw);
  if (!w) return '';
  const map = {
    awaitingresponse: 'awaiting_response', draft: 'draft', drafted: 'draft',
    approved: 'approved', accepted: 'approved', won: 'approved', converted: 'converted', declined: 'declined', rejected: 'declined',
    lost: 'declined', changesrequested: 'changes_requested', archived: 'archived',
  };
  return Object.prototype.hasOwnProperty.call(map, w) ? map[w] : 'other';
}

// @@SECTION settings
function prepareSettings(cfg, nowMs) {
  const notes = [];
  let source = lc(cfg.source);
  if (['test', 'csv', 'jobber'].indexOf(source) === -1) {
    notes.push('Config source "' + (cfg.source === undefined ? '' : cfg.source) + '" is not test, csv, or jobber. Using test instead.');
    source = 'test';
  }
  let testMode = toBool(cfg.testMode, true);
  if (source === 'test' && !testMode) {
    testMode = true;
    notes.push('source "test" uses built-in fictional data, so testMode was forced on.');
  }
  const tz = isBlank(cfg.timezone) ? 'America/Chicago' : String(cfg.timezone);
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (e) { throw new Error('Config timezone "' + tz + '" is not a valid time zone name. Use a name like America/Chicago.'); }
  const override = toIsoInZone(cfg.asOfOverride, tz);
  if (override.bad) throw new Error('Config asOfOverride must be a valid date and time.');
  if (override.note) notes.push('Config asOfOverride used the shop-local daylight-saving policy (' + override.note + ').');
  const asOfMs = parseTime(override.iso) ?? nowMs;
  const delivery = ['email', 'slack', 'both', 'none'].indexOf(lc(cfg.delivery)) === -1 ? 'email' : lc(cfg.delivery);
  const s = {
    businessName: isBlank(cfg.businessName) ? 'Your Business Name' : String(cfg.businessName),
    timezone: tz,
    source: source,
    testMode: testMode,
    delivery: delivery,
    ownerEmail: isBlank(cfg.ownerEmail) ? '' : String(cfg.ownerEmail).trim(),
    ownerSlackChannel: isBlank(cfg.ownerSlackChannel) ? '' : String(cfg.ownerSlackChannel).trim(),
    jobberGraphqlVersion: isBlank(cfg.jobberGraphqlVersion) ? '' : String(cfg.jobberGraphqlVersion).trim(),
    csvFolder: isBlank(cfg.csvFolder) ? '' : String(cfg.csvFolder).trim(),
    asOf: new Date(asOfMs).toISOString(),
    headsUp: notes,
  };
  Object.keys(DEFAULTS).filter(function (k) { return k !== 'quoteStalledDays'; }).forEach(function (k) {
    let n = toNum(cfg[k], DEFAULTS[k]);
    if (n < 0) { notes.push('Config ' + k + ' cannot be negative. Using ' + DEFAULTS[k] + '.'); n = DEFAULTS[k]; }
    s[k] = n;
  });
  const quoteDays = toNum(cfg.quoteStalledDays, null);
  s.quoteStalledDays = source === 'test' ? DEFAULTS.quoteStalledDays :
    Number.isInteger(quoteDays) && quoteDays >= 1 ? quoteDays : null;
  s.pastDueMinDays = Math.max(1, Math.ceil(s.pastDueMinDays));
  s.maxItemsPerSection = Math.max(1, Math.floor(s.maxItemsPerSection));
  return s;
}

// @@SECTION csv
// CSV parsing, header-alias mapping, and the Jobs / Invoices / Quotes export normalizers.
// Header aliases come from the column names Jobber's help center lists for its reports plus common
// variants. The exact header text of a real export has NOT been checked against a live account.
function parseCsvTable(text) {
  const rows = [];
  const warnings = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let closedQuote = false;
  let record = 1;
  const malformed = function (message) {
    return { headers: rows[0] || [], rows: [], warnings: ['CSV record ' + record + ': ' + message] };
  };
  const src = String(text === null || text === undefined ? '' : text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; closedQuote = true; }
      } else { field += c; }
    } else if (closedQuote && c !== ',' && c !== '\n' && c !== '\r') {
      if (c === ' ' || c === '\t') continue;
      return malformed('Unexpected text after a closing quote.');
    } else if (c === '"') {
      if (field.trim()) return malformed('Unexpected quote inside an unquoted field.');
      field = '';
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = ''; closedQuote = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = ''; closedQuote = false;
      if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row);
      row = [];
      record++;
    } else { field += c; }
  }
  row.push(field);
  if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row);
  if (inQuotes) return malformed('A quoted field was never closed. Re-export the CSV and try again.');
  if (rows.length === 0) return { headers: [], rows: [], warnings: warnings };
  const header = rows[0].map(function (h) { return h.trim(); });
  const duplicates = header.filter(function (h, i) { return h && header.indexOf(h) !== i; });
  if (duplicates.length) {
    return { headers: header, rows: [], warnings: ['Duplicate CSV headers: ' + duplicates.join(', ') + '.'] };
  }
  const body = [];
  rows.slice(1).forEach(function (r, idx) {
    if (r.length > header.length) {
      warnings.push('CSV data record ' + (idx + 2) + ' has more columns than the header. Check for an unescaped comma.');
      return;
    }
    body.push(Object.fromEntries(header.map(function (h, i) {
      return [h, r[i] === undefined ? '' : r[i].trim()];
    })));
  });
  return { headers: header, rows: warnings.length ? [] : body, warnings: warnings };
}

function parseCsv(text) {
  return parseCsvTable(text).rows;
}

function headerKey(h) {
  return String(h === null || h === undefined ? '' : h).toLowerCase().replace(/#/g, ' number ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');
}

// key = internal snake_case name. Aliases are tried in order after the key itself.
const JOB_COLUMNS = [
  { key: 'job_id', label: 'Job # (or Job Number / Job ID)', required: true, aliases: ['Job #', 'Job Number', 'Job No', 'Job ID', 'JobId', 'Job'] },
  { key: 'status', label: 'Status (or Job Status)', required: true, aliases: ['Job Status', 'Status'] },
  { key: 'client', label: 'Client name', aliases: ['Client name', 'Client', 'Customer', 'Customer name', 'Name'] },
  { key: 'title', label: 'Title', aliases: ['Title', 'Job Title', 'Description', 'Job Description', 'Summary', 'Service'] },
  { key: 'address', label: 'Property', aliases: ['Property', 'Property Address', 'Service Address', 'Address', 'Location'] },
  { key: 'scheduled_start', label: 'Schedule start date', aliases: ['Schedule start date', 'Scheduled Start', 'Schedule Start', 'Start', 'Start Date', 'Start Time', 'Next Visit', 'Next Visit Date', 'Visit Date'] },
  { key: 'scheduled_end', label: 'Schedule end date', aliases: ['Schedule end date', 'Scheduled End', 'Schedule End', 'End', 'End Date', 'End Time'] },
  { key: 'created_at', label: 'Created date', aliases: ['Created date', 'Created', 'Date Created', 'Created On', 'Created At'] },
  { key: 'completed_at', label: 'Closed date', aliases: ['Closed date', 'Completed date', 'Completed', 'Date Completed', 'Completed On', 'Completed At', 'Closed'] },
  { key: 'total', label: 'Total ($)', aliases: ['Total ($)', 'Total', 'Job Total', 'Job Revenue ($)', 'Amount', 'Value'] },
  { key: 'assigned', label: 'Assigned to', aliases: ['Assigned To', 'Assigned', 'Crew', 'Team Member', 'Team Members', 'Technician'] },
];
const INVOICE_COLUMNS = [
  { key: 'invoice_id', label: 'Invoice # (or Invoice Number)', required: true, aliases: ['Invoice #', 'Invoice Number', 'Invoice No', 'Invoice ID', 'Invoice'] },
  { key: 'due_date', label: 'Due date', required: true, aliases: ['Due date', 'Due', 'Due On', 'Payment Due', 'Due By'] },
  { key: 'balance', label: 'Balance ($) (or Balance Due / Outstanding)', required: true, aliases: ['Balance ($)', 'Balance', 'Balance Due', 'Outstanding', 'Outstanding Balance', 'Amount Due', 'Amount Outstanding'] },
  { key: 'status', label: 'Status', required: true, aliases: ['Invoice Status', 'Status'] },
  { key: 'client', label: 'Client name', aliases: ['Client name', 'Client', 'Customer', 'Customer name'] },
  { key: 'total', label: 'Total ($)', aliases: ['Total ($)', 'Total', 'Invoice Total', 'Amount'] },
  { key: 'issued_at', label: 'Issued date', aliases: ['Issued date', 'Issued', 'Date Issued', 'Sent date', 'Created date'] },
  { key: 'job_ref', label: 'Job #', aliases: ['Job #', 'Job Number', 'Job No'] },
];
const QUOTE_COLUMNS = [
  { key: 'quote_id', label: 'Quote # (or Quote Number)', required: true, aliases: ['Quote #', 'Quote Number', 'Quote No', 'Quote ID', 'Quote'] },
  { key: 'status', label: 'Status (or Quote Status)', required: true, aliases: ['Quote Status', 'Status'] },
  { key: 'total', label: 'Total ($)', required: true, aliases: ['Total ($)', 'Total', 'Quote Total', 'Amount', 'Value'] },
  { key: 'sent_at', label: 'Sent date', aliases: ['Sent date', 'Sent', 'Date Sent', 'Sent On', 'Sent At'] },
  { key: 'created_at', label: 'Drafted date (or Created date)', aliases: ['Drafted date', 'Created date', 'Created', 'Date Created', 'Created On'] },
  { key: 'client', label: 'Client name', aliases: ['Client name', 'Client', 'Customer', 'Customer name'] },
  { key: 'title', label: 'Title', aliases: ['Title', 'Quote Title', 'Description', 'Summary'] },
];
const REPORTS = {
  jobs: { label: 'Jobs', idKey: 'job_id', columns: JOB_COLUMNS, dateKeys: ['scheduled_start', 'scheduled_end', 'created_at', 'completed_at'], dayKeys: [], moneyKeys: ['total'], idWord: 'job number', hint: 'Export Jobs from Jobber (Insights > Reports > One-off jobs) with a header row.' },
  invoices: { label: 'Invoices', idKey: 'invoice_id', columns: INVOICE_COLUMNS, dateKeys: ['issued_at'], dayKeys: ['due_date'], moneyKeys: ['total', 'balance'], idWord: 'invoice number', hint: 'Export the Invoices report from Jobber with a header row.' },
  quotes: { label: 'Quotes', idKey: 'quote_id', columns: QUOTE_COLUMNS, dateKeys: ['sent_at', 'created_at'], dayKeys: [], moneyKeys: ['total'], idWord: 'quote number', hint: 'Export the Quotes report from Jobber with a header row.' },
};

// Rename a table's columns onto the internal names. Every key is present on every output row ('' when the
// column was not in the export), so downstream code never sees undefined.
function canonicalizeRows(rows, columns, headersIn) {
  const list = Array.isArray(rows) ? rows : [];
  const headers = headersIn && headersIn.length ? headersIn : (list.length ? Object.keys(list[0]) : []);
  const used = new Set();
  const conflicts = [];
  const candidates = {};
  const mapped = {};
  columns.forEach(function (col) {
    const names = col.key === 'status' ? col.aliases : [col.key].concat(col.aliases || []);
    const matching = Array.from(new Set(names.flatMap(function (name) {
      return headers.filter(function (h) { return headerKey(h) === headerKey(name) && !used.has(h); });
    })));
    if (matching.length) mapped[col.key] = matching[0];
    candidates[col.key] = matching;
    matching.forEach(function (h) { used.add(h); });
  });
  const out = list.map(function (r, idx) {
    const o = {};
    columns.forEach(function (col) {
      const values = candidates[col.key].filter(function (h) { return !isBlank(r[h]); });
      const h = values[0];
      o[col.key] = h === undefined ? '' : String(r[h]).trim();
      if (values.some(function (other) { return lc(r[other]) !== lc(o[col.key]); })) {
        conflicts.push('Row ' + (idx + 2) + ' has conflicting ' + col.key + ' columns. Used "' + h + '".');
      }
    });
    return o;
  });
  return {
    rows: out,
    mapped: mapped,
    headers: headers,
    missing: columns.filter(function (c) { return c.required && mapped[c.key] === undefined; }).map(function (c) { return c.label; }),
    conflicts: conflicts,
    unmapped: headers.filter(function (h) { return !used.has(h); }),
  };
}

// @@SECTION dates
// Offset of `tz` at instant `ms`, in ms (local wall clock minus UTC), minute precision.
function zoneOffsetMs(ms, tz) {
  const floor = Math.floor(ms / 60000) * 60000;
  const p = localParts(floor, tz);
  const dp = p.date.split('-').map(Number);
  return Date.UTC(dp[0], dp[1] - 1, dp[2], p.hour, p.minute) - floor;
}

// Resolve a wall-clock time in `tz` to an instant. kind is 'ok', 'gap' (time does not exist; moved forward
// by the gap), or 'ambiguous' (time occurs twice; the first, daylight-time occurrence is used).
function resolveWall(y, mo, d, h, mi, tz) {
  const target = Date.UTC(y, mo - 1, d, h, mi);
  const before = zoneOffsetMs(target - DAY, tz);
  const after = zoneOffsetMs(target + DAY, tz);
  const cands = uniqueList([before, after]).map(Number);
  const valid = cands.map(function (o) { return target - o; }).filter(function (u, i) { return zoneOffsetMs(u, tz) === cands[i]; }).sort(function (a, b) { return a - b; });
  if (valid.length === 0) return { ms: target - before, kind: 'gap' };
  if (valid.length === 1) return { ms: valid[0], kind: 'ok' };
  return { ms: valid[0], kind: 'ambiguous' };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// Split a human date/time into parts. Returns null when the shape is not recognized, or { bad: true }
// when it is recognized but impossible (2026-02-30, month 13, hour 25).
function parseDateParts(raw) {
  let y; let mo; let d; let h = 0; let mi = 0; let sec = 0; let ap = ''; let hasTime = false;
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/);
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3];
    if (m[4] !== undefined) { hasTime = true; h = +m[4]; mi = +m[5]; sec = m[6] ? +m[6] : 0; }
  } else {
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
    if (m) {
      mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000;
      if (m[4] !== undefined) { hasTime = true; h = +m[4]; mi = +m[5]; sec = m[6] ? +m[6] : 0; ap = m[7] ? m[7].toLowerCase() : ''; }
    } else {
      m = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[ T,]+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
      if (!m || !MONTHS[m[1].toLowerCase()]) return null;
      mo = MONTHS[m[1].toLowerCase()]; d = +m[2]; y = +m[3];
      if (m[4] !== undefined) { hasTime = true; h = +m[4]; mi = +m[5]; sec = m[6] ? +m[6] : 0; ap = m[7] ? m[7].toLowerCase() : ''; }
    }
  }
  if (ap) {
    if (h < 1 || h > 12) return { bad: true };
    h = (h % 12) + (ap === 'pm' ? 12 : 0);
  }
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (mo < 1 || mo > 12 || d < 1 || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59 || sec > 59) return { bad: true };
  return { y: y, mo: mo, d: d, h: h, mi: mi, sec: sec, hasTime: hasTime };
}

// ISO values that already carry an offset or Z are kept (after a calendar check). Everything else is read as
// shop-local wall time in `tz`. Returns { iso, bad, note } where note is 'gap' or 'ambiguous' when the DST policy applied.
function toIsoInZone(v, tz) {
  if (isBlank(v)) return { iso: '', bad: false, note: '' };
  const raw = String(v).trim();
  const withOffset = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i);
  if (withOffset) {
    const probe = new Date(Date.UTC(+withOffset[1], +withOffset[2] - 1, +withOffset[3]));
    if (probe.getUTCMonth() !== +withOffset[2] - 1 || probe.getUTCDate() !== +withOffset[3] || +withOffset[4] > 23 || +withOffset[5] > 59) return { iso: '', bad: true, note: '' };
    const t = parseTime(raw.replace(' ', 'T'));
    return t === null ? { iso: '', bad: true, note: '' } : { iso: raw, bad: false, note: '' };
  }
  const p = parseDateParts(raw);
  if (!p || p.bad) return { iso: '', bad: true, note: '' };
  const r = resolveWall(p.y, p.mo, p.d, p.h, p.mi, tz || 'America/Chicago');
  return { iso: new Date(r.ms + p.sec * 1000).toISOString(), bad: false, note: r.kind === 'ok' ? '' : r.kind };
}

// Calendar day (YYYY-MM-DD) for due dates and similar. A bare date stays that date; a date with a time is
// converted to its shop-local day.
function toLocalDate(v, tz) {
  if (isBlank(v)) return { date: '', bad: false };
  const raw = String(v).trim();
  const p = parseDateParts(raw);
  if (p && !p.bad) {
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return { date: p.y + '-' + pad(p.mo) + '-' + pad(p.d), bad: false };
  }
  const t = toIsoInZone(raw, tz);
  if (t.bad) return { date: '', bad: true };
  const ms = parseTime(t.iso);
  return ms === null ? { date: '', bad: true } : { date: localDate(ms, tz || 'America/Chicago'), bad: false };
}

// @@SECTION report
// "$1,234.50", "1234", "(500)" -> number. Anything else is bad (null), never guessed.
function parseMoney(v) {
  if (isBlank(v)) return { value: null, bad: false };
  const raw = String(v).trim();
  const accounting = /^\(.*\)$/.test(raw);
  const s = accounting ? raw.slice(1, -1).trim() : raw;
  if ((accounting && s.startsWith('-')) || !/^-?\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) {
    return { value: null, bad: true };
  }
  const n = Number(s.replace(/[$,]/g, '')) * (accounting ? -1 : 1);
  return Number.isFinite(n) ? { value: n, bad: false } : { value: null, bad: true };
}

const SUBTOTAL_ID = /^(total|totals|subtotal|grand total|sum)$/i;

// Generic report preparer for jobs / invoices / quotes. Never throws. res.ok is true only when usable rows exist
// and nothing in the file looks truncated.
function prepareReport(kind, rowsIn, opts) {
  const spec = REPORTS[kind];
  const o = opts || {};
  const tz = o.timezone || 'America/Chicago';
  const label = o.label || spec.label + ' export';
  const rows = Array.isArray(rowsIn) ? rowsIn : [];
  const c = canonicalizeRows(rows, spec.columns, o.headers);
  const res = { kind: kind, ok: false, rows: [], headsUp: [], errors: [], missingRequired: c.missing.slice(), headersSeen: c.headers, mapped: c.mapped, rowCount: rows.length, skipped: [] };
  const seen = c.headers.length ? ' Columns found: ' + c.headers.slice(0, 25).join(', ') + (c.headers.length > 25 ? ', ...' : '') + '.' : '';
  if (c.headers.length === 0) {
    res.errors.push(label + ' is empty. ' + spec.hint);
    return res;
  }
  const missing = c.missing.slice();
  if (kind === 'quotes' && c.mapped.sent_at === undefined) missing.push('Sent date');
  if (missing.length) {
    res.missingRequired = missing;
    res.errors.push(label + ' is missing required column(s): ' + missing.join('; ') + '.' + seen + ' Add the missing column(s) to your Jobber report and export again.');
    return res;
  }
  if (rows.length === 0) {
    res.errors.push(label + ' has a header row but no data rows. Export a report that includes at least one row.');
    return res;
  }
  const byId = new Map();
  const conflictingIds = new Set();
  res.headsUp.push(...c.conflicts);
  const badDates = [];
  const badMoney = [];
  let gaps = 0; let ambiguous = 0; let dupes = 0;
  let firstDst = '';
  c.rows.forEach(function (r, idx) {
    const line = idx + 2; // the header is row 1; blank lines are not counted
    const id = r[spec.idKey];
    if (isBlank(id)) { res.skipped.push({ row: line, reason: 'no ' + spec.idWord + ' (footer or subtotal row?)' }); return; }
    if (SUBTOTAL_ID.test(String(id).trim())) { res.skipped.push({ row: line, reason: 'a totals row' }); return; }
    if (kind === 'jobs') r._blankStart = isBlank(r.scheduled_start) && isBlank(r.scheduled_end) ? 1 : 0;
    spec.dateKeys.forEach(function (k) {
      const t = toIsoInZone(r[k], tz);
      if (t.bad) { badDates.push(spec.idWord + ' ' + id + ' ' + k + ' "' + r[k] + '"'); r[k] = ''; return; }
      if (t.note === 'gap') { gaps++; if (!firstDst) firstDst = id + ' ' + k + ' "' + r[k] + '"'; }
      if (t.note === 'ambiguous') { ambiguous++; if (!firstDst) firstDst = id + ' ' + k + ' "' + r[k] + '"'; }
      r[k] = t.iso;
    });
    spec.dayKeys.forEach(function (k) {
      const t = toLocalDate(r[k], tz);
      if (t.bad) { badDates.push(spec.idWord + ' ' + id + ' ' + k + ' "' + r[k] + '"'); r[k] = ''; } else { r[k] = t.date; }
    });
    spec.moneyKeys.forEach(function (k) {
      const m = parseMoney(r[k]);
      if (m.bad) badMoney.push(spec.idWord + ' ' + id + ' ' + k + ' "' + r[k] + '"');
      r[k] = m.value;
    });
    const prev = byId.get(id);
    if (!prev) { r._rows = 1; byId.set(id, r); return; }
    dupes++;
    if (kind === 'jobs') {
      // one row per visit: merge. Earliest start, latest end; blank fields are filled from later rows.
      prev._rows++;
      prev._blankStart += r._blankStart;
      if (r.status && prev.status && lc(r.status) !== lc(prev.status)) {
        res.headsUp.push('Job ' + id + ' has conflicting statuses on repeated rows. The first status was used.');
      }
      const e = function (a, b) { const x = parseTime(a); const y = parseTime(b); return x !== null && (y === null || x < y) ? a : b; };
      const l = function (a, b) { const x = parseTime(a); const y = parseTime(b); return x !== null && (y === null || x > y) ? a : b; };
      prev.scheduled_start = e(prev.scheduled_start, r.scheduled_start) || '';
      prev.scheduled_end = l(prev.scheduled_end, r.scheduled_end) || '';
      Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_' && isBlank(prev[k]) && !isBlank(r[k])) prev[k] = r[k]; });
    } else if (Object.keys(r).some(function (k) { return r[k] !== prev[k]; })) {
      conflictingIds.add(id);
    }
  });
  conflictingIds.forEach(function (id) { byId.delete(id); });
  res.rows = Array.from(byId.values());
  if (res.skipped.length) {
    res.headsUp.push(res.skipped.length + ' ' + plural(res.skipped.length, 'row') + ' in the ' + label + ' ' + plural(res.skipped.length, 'was', 'were') + ' skipped. First: row ' + res.skipped[0].row + ' (' + res.skipped[0].reason + ').');
  }
  if (badDates.length) {
    res.headsUp.push(badDates.length + ' date ' + plural(badDates.length, 'value') + ' in the ' + label + ' could not be read and ' + plural(badDates.length, 'was', 'were') + ' left blank (' + badDates.slice(0, 3).join('; ') + (badDates.length > 3 ? '; ...' : '') + '). Use dates like 3/10/2026 9:50 AM or 2026-03-10.');
  }
  if (badMoney.length) {
    res.headsUp.push(badMoney.length + ' dollar ' + plural(badMoney.length, 'amount') + ' in the ' + label + ' could not be read and ' + plural(badMoney.length, 'was', 'were') + ' left blank (' + badMoney.slice(0, 3).join('; ') + (badMoney.length > 3 ? '; ...' : '') + ').');
  }
  if (gaps > 0) {
    res.headsUp.push(gaps + ' ' + plural(gaps, 'time') + ' in the ' + label + ' fell in the spring daylight-saving gap (a clock time that does not exist) and ' + plural(gaps, 'was', 'were') + ' moved forward by the gap, e.g. ' + firstDst + '.');
  }
  if (ambiguous > 0) {
    res.headsUp.push(ambiguous + ' ' + plural(ambiguous, 'time') + ' in the ' + label + ' fell in the fall daylight-saving overlap (a clock time that happens twice) and the first occurrence was used, e.g. ' + firstDst + '.');
  }
  if (dupes > 0) {
    res.headsUp.push(dupes + ' repeated ' + spec.idWord + ' ' + plural(dupes, 'row') + ' in the ' + label + (kind === 'jobs' ? ' ' + plural(dupes, 'was', 'were') + ' merged into the job with the same number (one row per visit).' : ' ' + plural(dupes, 'was', 'were') + ' consolidated by number.'));
  }
  if (conflictingIds.size) {
    res.headsUp.push('Conflicting records for ' + spec.idWord + ' ' + Array.from(conflictingIds).slice(0, 5).join(', ') +
      ' were omitted. Use a single-account report with an unambiguous record per number.');
  }
  if (res.rows.length === 0) res.errors.push('No usable rows were found in the ' + label + '.' + seen);
  if (kind === 'jobs' && c.mapped.scheduled_start === undefined) {
    res.headsUp.push('The ' + label + ' has no start-date column (for example "Schedule start date"), so jobs with no scheduled visit can only be found from the Status column.');
  }
  res.ok = res.errors.length === 0;
  return res;
}

function mapJobRow(r, startKnown) {
  return {
    id: String(r.job_id), title: r.title || '', client: r.client || '', address: r.address || '', statusRaw: r.status || '',
    status: jobStatusKey(r.status), startAt: r.scheduled_start || '', endAt: r.scheduled_end || '', createdAt: r.created_at || '',
    completedAt: r.completed_at || '', total: r.total === undefined ? null : r.total, assigned: r.assigned || '',
    visitCount: r._rows || 1, unscheduledVisits: startKnown ? (r._blankStart || 0) : null, startKnown: startKnown,
  };
}
function mapInvoiceRow(r) {
  return {
    id: String(r.invoice_id), client: r.client || '', statusRaw: r.status || '', status: invoiceStatusKey(r.status),
    total: r.total === undefined ? null : r.total, balance: r.balance === undefined ? null : r.balance,
    issuedAt: r.issued_at || '', dueDate: r.due_date || '', jobRef: r.job_ref || '',
  };
}
function mapQuoteRow(r) {
  return {
    id: String(r.quote_id), client: r.client || '', title: r.title || '', statusRaw: r.status || '', status: quoteStatusKey(r.status),
    total: r.total === undefined ? null : r.total, sentAt: r.sent_at || '',
  };
}
const MAPPERS = { jobs: mapJobRow, invoices: mapInvoiceRow, quotes: mapQuoteRow };

// Public entry point for one report. input = CSV text or parseCsv rows. Never throws unless opts.strict is true;
// check result.ok / result.message. result.items uses the internal schema.
function normalizeReportExport(kind, input, opts) {
  const o = opts || {};
  let rows;
  let headers = o.headers;
  const warnings = Array.isArray(o.parseWarnings) ? o.parseWarnings.slice() : [];
  if (typeof input === 'string') {
    const t = parseCsvTable(input);
    rows = t.rows; headers = t.headers;
    (t.warnings || []).forEach(function (w) { warnings.push(w); });
  } else {
    rows = Array.isArray(input) ? input : [];
  }
  const res = warnings.length
    ? { kind: kind, ok: false, rows: [], headsUp: [], errors: [], missingRequired: [], headersSeen: headers || [], mapped: {}, rowCount: rows.length, skipped: [] }
    : prepareReport(kind, rows, Object.assign({}, o, { headers: headers }));
  warnings.forEach(function (w) { res.errors.push(w); res.headsUp.push(w); });
  if (res.errors.length) res.ok = false;
  const startKnown = res.mapped.scheduled_start !== undefined;
  res.items = res.ok ? res.rows.map(function (r) { return MAPPERS[kind](r, startKnown); }) : [];
  res.message = res.errors.join(' ');
  if (o.strict && !res.ok) throw new Error(res.message);
  return res;
}
function normalizeJobsExport(input, opts) { return normalizeReportExport('jobs', input, opts); }
function normalizeInvoicesExport(input, opts) { return normalizeReportExport('invoices', input, opts); }
function normalizeQuotesExport(input, opts) { return normalizeReportExport('quotes', input, opts); }

// Work out which report a file is. Header signature first, then the file name, then "the only file is the jobs file".
function classifyCsvTable(fileName, table, fileCount) {
  const has = function (kind, key) { return canonicalizeRows([], REPORTS[kind].columns, table.headers).mapped[key] !== undefined; };
  if (has('invoices', 'invoice_id')) return 'invoices';
  if (has('quotes', 'quote_id')) return 'quotes';
  if (has('jobs', 'job_id')) return 'jobs';
  const n = String(fileName || '').toLowerCase();
  if (/invoice/.test(n)) return 'invoices';
  if (/quote|estimate/.test(n)) return 'quotes';
  if (/job|visit/.test(n)) return 'jobs';
  return fileCount === 1 ? 'jobs' : null;
}

function emptyDataset(settings, notes) {
  return {
    settings: Object.assign({}, settings, { headsUp: (settings.headsUp || []).concat(notes || []) }),
    jobs: [], invoices: [], quotes: [], supplied: { jobs: false, invoices: false, quotes: false },
  };
}

// files = [{ name, text }] in any order and with any file names. Any one of the three reports is enough.
// Duplicate report types require an operator to select one snapshot.
function datasetFromCsvFiles(settings, files) {
  const list = Array.isArray(files) ? files : [];
  const notes = [];
  const byKind = { jobs: [], invoices: [], quotes: [] };
  list.forEach(function (f) {
    const name = String((f && f.name) || 'upload.csv');
    const t = parseCsvTable(f && f.text);
    if (t.warnings.length) {
      t.warnings.forEach(function (w) { notes.push('CSV import: file "' + name + '": ' + w); });
      return;
    }
    const kind = classifyCsvTable(name, t, list.length);
    if (t.headers.length === 0) {
      notes.push('CSV import: file "' + name + '" is empty. Export the report again with a header row and at least one row.');
      return;
    }
    if (!kind) {
      notes.push('CSV import: file "' + name + '" was not recognized as a Jobs, Invoices, or Quotes report and was ignored.');
      return;
    }
    byKind[kind].push({ name: name, table: t });
  });
  const ds = emptyDataset(settings, notes);
  Object.keys(byKind).forEach(function (kind) {
    const files2 = byKind[kind];
    if (files2.length === 0) return;
    if (files2.length > 1) {
      notes.push('CSV import: multiple ' + REPORTS[kind].label + ' exports were received (' + files2.map(function (f) {
        return '"' + f.name + '"';
      }).join(', ') + '). Supply one snapshot per report type.');
      return;
    }
    const chosen = files2[0];
    const label = REPORTS[kind].label + ' export "' + chosen.name + '"';
    const r = normalizeReportExport(kind, chosen.table.rows, { timezone: settings.timezone, label: label, headers: chosen.table.headers, parseWarnings: chosen.table.warnings });
    // parse warnings are already inside r.errors / r.headsUp; show each message once
    uniqueList(r.errors.concat(r.headsUp)).forEach(function (m) { notes.push('CSV import: ' + m); });
    if (r.ok) { ds[kind] = r.items; ds.supplied[kind] = true; }
  });
  if (list.length === 0) notes.push('CSV import: no CSV file was received. Send or drop a Jobber Jobs, Invoices, or Quotes report export.');
  ['jobs', 'invoices', 'quotes'].forEach(function (kind) {
    if (!ds.supplied[kind] && byKind[kind].length === 0 && list.length > 0) notes.push('CSV import: no ' + REPORTS[kind].label + ' export was supplied, so that part of the digest is skipped.');
  });
  ds.settings = Object.assign({}, settings, { headsUp: (settings.headsUp || []).concat(uniqueList(notes)) });
  return ds;
}

// @@SECTION graphql
// DRAFT, UNVERIFIED mapping. Field names follow Jobber's public GraphQL API as remembered and have NOT been
// checked against a live account (the Developer Center could not be read while this was written). The one
// documented fact used: an unscheduled visit has both startAt and endAt null. Anything a record does not carry
// stays blank so the digest says so instead of guessing.
function gqlNodes(resp, key) {
  if (!resp || typeof resp !== 'object') return null;
  const d = resp.data && typeof resp.data === 'object' ? resp.data : resp;
  const c = d[key];
  if (!c) return null;
  if (Array.isArray(c)) return c;
  if (Array.isArray(c.nodes)) return c.nodes;
  if (Array.isArray(c.edges)) return c.edges.map(function (e) { return e && e.node; }).filter(Boolean);
  return null;
}
function gqlMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') return gqlMoney(v.amount !== undefined ? v.amount : v.value);
  const m = parseMoney(v);
  return m.bad ? null : m.value;
}
function gqlClient(n) {
  const c = n && n.client;
  if (!c) return '';
  if (typeof c === 'string') return c;
  const full = [c.firstName, c.lastName].filter(function (x) { return !isBlank(x); }).join(' ');
  return String(c.name || full || c.companyName || '');
}
function gqlAddress(n) {
  const p = n && n.property;
  const a = p && (p.address || p);
  if (!a) return '';
  if (typeof a === 'string') return a;
  return [a.street, a.street1, a.city].filter(function (x) { return !isBlank(x); }).join(', ');
}
function gqlIso(v, tz, notes, label, dst) {
  if (isBlank(v)) return '';
  const t = toIsoInZone(v, tz);
  if (t.note && dst) dst.push(label + ' used the shop-local daylight-saving policy (' + t.note + ').');
  if (t.bad) { notes.push(label + ' "' + v + '"'); return ''; }
  return t.iso;
}

function normalizeJobberGraphql(settings, raw) {
  const tz = settings.timezone;
  const headsUp = (settings.headsUp || []).concat([
    'Jobber live mapping is an unverified first draft: GraphQL field names, status values, and paging have not been checked against a live Jobber account. The CSV export path is the recommended way to start.',
  ]);
  const input = raw && typeof raw === 'object' ? raw : {};
  const single = input.data && typeof input.data === 'object' && !input.jobs && !input.invoices && !input.quotes;
  const resp = function (k) { return single ? input : input[k]; };
  const bad = [];
  let truncatedVisits = 0;
  const dst = [];
  const out = { jobs: [], invoices: [], quotes: [], supplied: { jobs: false, invoices: false, quotes: false } };
  ['jobs', 'invoices', 'quotes'].forEach(function (k) {
    const r = resp(k);
    if (r && Array.isArray(r.errors) && r.errors.length) {
      headsUp.push('Jobber returned an error for "' + k + '": ' + String((r.errors[0] && r.errors[0].message) || 'unknown error') + '. That part of the digest is skipped.');
      return;
    }
    const nodes = gqlNodes(r, k);
    if (nodes === null) {
      headsUp.push('Jobber "' + k + '" read returned no usable data.');
      return;
    }
    out.supplied[k] = true;
    const d = r && r.data ? r.data : r;
    const pi = d && d[k] && d[k].pageInfo;
    if (pi && pi.hasNextPage === true) headsUp.push('Jobber "' + k + '" has more pages than this draft reads (first ' + nodes.length + '). Counts and totals may be incomplete.');
    const seen = new Set();
    let skipped = 0;
    nodes.forEach(function (n) {
      if (!n || isBlank(n.id) || seen.has(String(n.id))) { skipped++; return; }
      seen.add(String(n.id));
      if (k === 'jobs') {
        const visits = n.visits && Array.isArray(n.visits.nodes) ? n.visits.nodes : (Array.isArray(n.visits) ? n.visits : null);
        const moreVisits = n.visits && n.visits.pageInfo && n.visits.pageInfo.hasNextPage === true;
        if (moreVisits) truncatedVisits++;
        const starts = []; const ends = [];
        let unsched = 0;
        (visits || []).forEach(function (v) {
          const s = gqlIso(v && v.startAt, tz, bad, 'job ' + (n.jobNumber || n.id) + ' visit startAt', dst);
          const e = gqlIso(v && v.endAt, tz, bad, 'job ' + (n.jobNumber || n.id) + ' visit endAt', dst);
          if (v && v.startAt === null && v.endAt === null) unsched++;
          if (s) starts.push(s);
          if (e) ends.push(e);
        });
        const ts = function (x) { return parseTime(x); };
        starts.sort(function (a, b) { return ts(a) - ts(b); });
        ends.sort(function (a, b) { return ts(a) - ts(b); });
        const st = n.jobStatus !== undefined ? n.jobStatus : n.status;
        out.jobs.push({
          id: String(n.jobNumber !== undefined && n.jobNumber !== null ? n.jobNumber : n.id), title: String(n.title || ''), client: gqlClient(n), address: gqlAddress(n),
          statusRaw: String(st || ''), status: jobStatusKey(st), startAt: starts[0] || '', endAt: ends.length ? ends[ends.length - 1] : '',
          createdAt: gqlIso(n.createdAt, tz, bad, 'job ' + n.id + ' createdAt', dst), completedAt: gqlIso(n.completedAt, tz, bad, 'job ' + n.id + ' completedAt', dst),
          total: gqlMoney(n.total !== undefined ? n.total : (n.amounts && n.amounts.total)), assigned: '',
          visitCount: visits && !moreVisits ? visits.length : null, unscheduledVisits: visits && !moreVisits ? unsched : null, startKnown: visits !== null && !moreVisits,
        });
      } else if (k === 'invoices') {
        const st = n.invoiceStatus !== undefined ? n.invoiceStatus : n.status;
        const amt = n.amounts || {};
        const due = toLocalDate(n.dueDate, tz);
        if (due.bad) bad.push('invoice ' + (n.invoiceNumber || n.id) + ' dueDate "' + n.dueDate + '"');
        out.invoices.push({
          id: String(n.invoiceNumber !== undefined && n.invoiceNumber !== null ? n.invoiceNumber : n.id), client: gqlClient(n), statusRaw: String(st || ''), status: invoiceStatusKey(st),
          total: gqlMoney(amt.total !== undefined ? amt.total : n.total), balance: gqlMoney(amt.invoiceBalance !== undefined ? amt.invoiceBalance : (amt.balance !== undefined ? amt.balance : n.balance)),
          issuedAt: gqlIso(n.issuedDate, tz, bad, 'invoice ' + n.id + ' issuedDate', dst), dueDate: due.date, jobRef: '',
        });
      } else {
        const st = n.quoteStatus !== undefined ? n.quoteStatus : n.status;
        const amt = n.amounts || {};
        const sent = gqlIso(n.sentAt, tz, bad, 'quote ' + n.id + ' sentAt', dst);
        out.quotes.push({
          id: String(n.quoteNumber !== undefined && n.quoteNumber !== null ? n.quoteNumber : n.id), client: gqlClient(n), title: String(n.title || ''), statusRaw: String(st || ''), status: quoteStatusKey(st),
          total: gqlMoney(amt.total !== undefined ? amt.total : n.total), sentAt: sent,
        });
      }
    });
    if (skipped) headsUp.push('Jobber "' + k + '" omitted ' + skipped + ' rows without a unique record ID.');
    if (nodes.length && !out[k].length) out.supplied[k] = false;
  });
  if (truncatedVisits) headsUp.push(truncatedVisits + ' Jobber jobs have additional visit pages. Visit-derived flags for those jobs are unavailable.');
  headsUp.push(...dst);
  if (bad.length) headsUp.push(bad.length + ' date ' + plural(bad.length, 'value') + ' from Jobber could not be read and ' + plural(bad.length, 'was', 'were') + ' left blank (' + bad.slice(0, 3).join('; ') + (bad.length > 3 ? '; ...' : '') + ').');
  return Object.assign(out, { settings: Object.assign({}, settings, { headsUp: uniqueList(headsUp) }) });
}

// @@SECTION triage
// The three morning queues. Read-only: these functions only look at the data they are given.
function triageNow(data) {
  const s = data.settings;
  const asOf = parseTime(s.asOf);
  return { s: s, tz: s.timezone, asOf: asOf, today: localDate(asOf, s.timezone) };
}
function ageDaysFromIso(iso, ctx) {
  const t = parseTime(iso);
  if (t === null || t > ctx.asOf) return null;
  return dayDiff(localDate(t, ctx.tz), ctx.today);
}
function ageLabel(days, suffix) {
  if (days === null || days === undefined) return 'age not in the data';
  if (days === 0) return 'today';
  return days + ' ' + plural(days, 'day') + ' ' + suffix;
}
function missingReport(label) {
  return 'No ' + label + ' export was supplied, so that part of the digest is skipped. Nothing is estimated.';
}

// Queue 1: Unscheduled, Late, Action Required.
function jobsQueue(data) {
  const ctx = triageNow(data);
  const out = { computed: false, items: [], counts: { late: 0, action_required: 0, unscheduled: 0 }, total: 0, unrecognized: 0, headsUp: [] };
  if (!data.supplied || !data.supplied.jobs) { out.headsUp.push(missingReport('Jobs')); return out; }
  out.computed = true;
  const order = { late: 0, action_required: 1, unscheduled: 2 };
  let noEnd = 0;
  let futureEnd = 0;
  (data.jobs || []).forEach(function (j) {
    const st = j.status;
    if (['completed', 'archived', 'cancelled', 'requires_invoicing'].indexOf(st) !== -1) return;
    if (st === 'other' || !st) { out.unrecognized++; return; }
    let kind = '';
    let reason = '';
    let age = null;
    const endMs = parseTime(j.endAt);
    if (st === 'late') {
      kind = 'late';
      if (endMs === null) {
        noEnd++;
        reason = 'Late (no end time in the data)';
      } else if (endMs > ctx.asOf) {
        futureEnd++;
        reason = 'Late in Jobber (recorded end is in the future)';
      } else {
        reason = 'Late. Visit was due to end ' + fmtDay(endMs, ctx.tz) + ' ' + fmtTime(endMs, ctx.tz);
        age = ageDaysFromIso(j.endAt, ctx);
      }
    } else if (st === 'action_required') {
      kind = 'action_required';
      reason = 'Action Required in Jobber';
    } else if (st === 'unscheduled') {
      kind = 'unscheduled';
      reason = 'Unscheduled';
      age = ageDaysFromIso(j.createdAt, ctx);
    } else if (j.unscheduledVisits > 0) {
      kind = 'unscheduled';
      reason = j.unscheduledVisits === j.visitCount
        ? (j.visitCount === 1 ? 'The visit has no date' : 'All ' + j.visitCount + ' visits have no date')
        : j.unscheduledVisits + ' of ' + j.visitCount + ' visits ' + plural(j.unscheduledVisits, 'has', 'have') + ' no date';
      age = ageDaysFromIso(j.createdAt, ctx);
    } else if (j.startKnown && ['active', 'upcoming', 'today'].indexOf(st) !== -1 && j.visitCount === 0) {
      kind = 'unscheduled';
      reason = 'No scheduled visit';
      age = ageDaysFromIso(j.createdAt, ctx);
    }
    if (!kind) return;
    out.counts[kind]++;
    out.items.push({ id: j.id, kind: kind, reason: reason, client: j.client || 'client not in the data', title: j.title, ageDays: age, total: j.total, assigned: j.assigned });
  });
  out.items.sort(function (a, b) {
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
    const x = a.ageDays === null ? -1 : a.ageDays;
    const y = b.ageDays === null ? -1 : b.ageDays;
    if (x !== y) return y - x;
    return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
  });
  out.total = out.items.length;
  if (out.total === 0 && out.unrecognized) out.computed = false;
  if (out.unrecognized > 0) out.headsUp.push(out.unrecognized + ' ' + plural(out.unrecognized, 'job') + ' had a status this pack does not recognize and ' + plural(out.unrecognized, 'was', 'were') + ' not triaged.');
  if (noEnd > 0) out.headsUp.push(noEnd + ' Late ' + plural(noEnd, 'job') + ' ' + plural(noEnd, 'has', 'have') + ' no end time, so how late cannot be shown.');
  if (futureEnd) out.headsUp.push(futureEnd + ' Late job records have a future end time, so lateness cannot be calculated.');
  return out;
}

// Queue 2: Requires Invoicing jobs and past-due invoices.
function invoicingQueue(data) {
  const ctx = triageNow(data);
  const s = ctx.s;
  const out = {
    ready: { computed: false, items: [], count: 0, total: null, knownTotalCount: 0 },
    pastDue: { computed: false, items: [], count: 0, total: 0 },
    headsUp: [],
  };
  if (!data.supplied || !data.supplied.jobs) {
    out.headsUp.push('Requires Invoicing jobs need a Jobs export, which was not supplied. That list is skipped.');
  } else {
    out.ready.computed = true;
    let noDate = 0;
    (data.jobs || []).forEach(function (j) {
      if (j.status !== 'requires_invoicing') return;
      const since = j.completedAt || j.endAt || '';
      const ageDays = ageDaysFromIso(since, ctx);
      if (ageDays === null) noDate++;
      out.ready.items.push({ id: j.id, client: j.client || 'client not in the data', title: j.title, ageDays: ageDays, total: j.total });
    });
    out.ready.items.sort(function (a, b) {
      const x = a.ageDays === null ? -1 : a.ageDays;
      const y = b.ageDays === null ? -1 : b.ageDays;
      if (x !== y) return y - x;
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    });
    out.ready.count = out.ready.items.length;
    const known = out.ready.items.filter(function (i) { return i.total !== null && i.total !== undefined; });
    out.ready.knownTotalCount = known.length;
    out.ready.total = known.length ? known.reduce(function (a, i) { return a + i.total; }, 0) : null;
    if (noDate > 0) out.headsUp.push(noDate + ' Requires Invoicing ' + plural(noDate, 'job') + ' ' + plural(noDate, 'has', 'have') + ' no usable past completed or end date, so how long ' + plural(noDate, 'it has', 'they have') + ' waited cannot be shown.');
    if (known.length < out.ready.count) out.headsUp.push((out.ready.count - known.length) + ' Requires Invoicing ' + plural(out.ready.count - known.length, 'job') + ' ' + plural(out.ready.count - known.length, 'has', 'have') + ' no total, so the dollar figure covers only the others.');
  }
  if (!data.supplied || !data.supplied.invoices) {
    out.headsUp.push(missingReport('Invoices'));
  } else {
    out.pastDue.computed = true;
    let noBalance = 0; let noDue = 0; let conflicts = 0; let unknownStatus = 0;
    (data.invoices || []).forEach(function (inv) {
      if (['paid', 'draft', 'void', 'bad_debt'].indexOf(inv.status) !== -1) return;
      if (inv.status !== 'past_due' && inv.status !== 'awaiting_payment') { unknownStatus++; return; }
      if (inv.balance === null || inv.balance === undefined) { noBalance++; return; }
      if (!(inv.balance > 0)) return;
      if (!inv.dueDate) { noDue++; return; }
      const days = dayDiff(inv.dueDate, ctx.today);
      if (inv.status === 'past_due' && days <= 0) conflicts++;
      if (days < Math.max(1, s.pastDueMinDays)) return;
      out.pastDue.items.push({ id: inv.id, client: inv.client || 'client not in the data', balance: inv.balance, total: inv.total, dueDate: inv.dueDate, daysPastDue: days });
    });
    out.pastDue.items.sort(function (a, b) {
      if (a.balance !== b.balance) return b.balance - a.balance;
      const x = a.daysPastDue;
      const y = b.daysPastDue;
      if (x !== y) return y - x;
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    });
    out.pastDue.count = out.pastDue.items.length;
    out.pastDue.total = out.pastDue.items.reduce(function (a, i) { return a + i.balance; }, 0);
    if (out.pastDue.count === 0 && (noBalance || noDue || unknownStatus)) out.pastDue.computed = false;
    if (unknownStatus) out.headsUp.push(unknownStatus + ' invoice records had no recognized status and were skipped.');
    if (noBalance > 0) out.headsUp.push(noBalance + ' open ' + plural(noBalance, 'invoice') + ' ' + plural(noBalance, 'has', 'have') + ' no balance in the data and ' + plural(noBalance, 'was', 'were') + ' skipped.');
    if (noDue > 0) out.headsUp.push(noDue + ' open ' + plural(noDue, 'invoice') + ' ' + plural(noDue, 'has', 'have') + ' no due date and were skipped because the age threshold cannot be checked.');
    if (conflicts > 0) out.headsUp.push(conflicts + ' ' + plural(conflicts, 'invoice') + ' marked past due ' + plural(conflicts, 'has', 'have') + ' a due date today or in the future. The due date was used, so ' + plural(conflicts, 'it was', 'they were') + ' not listed.');
  }
  return out;
}

// Queue 3: high-value quotes still awaiting a response well after Jobber's own follow-ups (max two) would have gone out.
function quoteQueue(data) {
  const ctx = triageNow(data);
  const s = ctx.s;
  const out = { computed: false, items: [], count: 0, total: 0, notYetStalled: 0, belowValue: 0, headsUp: [] };
  if (!data.supplied || !data.supplied.quotes) { out.headsUp.push(missingReport('Quotes')); return out; }
  if (s.quoteStalledDays === null || s.quoteStalledDays === undefined) {
    out.headsUp.push('Set quoteStalledDays to a shop-local day cutoff after the last configured Jobber follow-up. Until then, the quote queue is unavailable.');
    return out;
  }
  out.computed = true;
  let noTotal = 0; let noDate = 0; let future = 0; let unknownStatus = 0;
  (data.quotes || []).forEach(function (q) {
    if (!q.status || q.status === 'other') unknownStatus++;
    if (q.status !== 'awaiting_response') return; // drafts, approved, converted, declined, archived, changes requested: not stalled
    if (q.total === null || q.total === undefined) { noTotal++; return; }
    const sentMs = parseTime(q.sentAt);
    if (sentMs === null) { noDate++; return; }
    const age = dayDiff(localDate(sentMs, ctx.tz), ctx.today);
    if (sentMs > ctx.asOf) { future++; return; }
    if (q.total < s.quoteMinValue) { out.belowValue++; return; }
    if (age < s.quoteStalledDays) { out.notYetStalled++; return; }
    out.items.push({ id: q.id, client: q.client || 'client not in the data', title: q.title, total: q.total, ageDays: age, sentLabel: fmtDay(sentMs, ctx.tz) });
  });
  out.items.sort(function (a, b) {
    if (a.total !== b.total) return b.total - a.total;
    if (a.ageDays !== b.ageDays) return b.ageDays - a.ageDays;
    return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
  });
  out.count = out.items.length;
  out.total = out.items.reduce(function (a, i) { return a + i.total; }, 0);
  if (noTotal > 0) out.headsUp.push(noTotal + ' quote' + (noTotal === 1 ? '' : 's') + ' awaiting a response ' + plural(noTotal, 'has', 'have') + ' no total and ' + plural(noTotal, 'was', 'were') + ' skipped.');
  if (noDate > 0) out.headsUp.push(noDate + ' quote' + (noDate === 1 ? '' : 's') + ' awaiting a response ' + plural(noDate, 'has', 'have') + ' no send date and ' + plural(noDate, 'was', 'were') + ' skipped.');
  if (future > 0) out.headsUp.push(future + ' quote' + (future === 1 ? '' : 's') + ' ' + plural(future, 'has', 'have') + ' a send date in the future and ' + plural(future, 'was', 'were') + ' skipped.');
  if (out.items.length === 0 && (noDate || noTotal || unknownStatus)) out.computed = false;
  if (unknownStatus) out.headsUp.push(unknownStatus + ' quote records had no recognized status and were skipped.');
  return out;
}

function runTriage(data) {
  return Object.assign({}, data, { jobsQueue: jobsQueue(data), invoicing: invoicingQueue(data), quoteQueue: quoteQueue(data) });
}

// @@SECTION message
function renderMessage(data) {
  const s = data.settings;
  const tz = s.timezone;
  const asOf = parseTime(s.asOf);
  const max = s.maxItemsPerSection;
  const jq = data.jobsQueue;
  const inv = data.invoicing;
  const qq = data.quoteQueue;
  const tag = s.testMode ? '[TEST] ' : '';
  const L = [];
  const more = function (arr) { return arr.length > max ? ['- ...and ' + (arr.length - max) + ' more (see the workflow output)'] : []; };
  const kindLabel = { late: 'Late', action_required: 'Action Required', unscheduled: 'Unscheduled' };

  L.push('# ' + tag + 'Morning Ops Triage Digest: ' + s.businessName);
  L.push('');
  L.push(fmtDay(asOf, tz) + ' ' + fmtTime(asOf, tz) + ' ' + tz + ' | source: ' + s.source);
  if (s.testMode) {
    L.push('');
    L.push('> [TEST] Preview only. Sent to the owner address or channel you set, never to a customer.' + (s.source === 'test' ? ' Built from fictional sample data.' : ''));
  }
  L.push('');
  L.push('## Today at a glance');
  L.push('');
  L.push(jq.computed ? '- Jobs needing attention: ' + jq.total + ' (' + jq.counts.late + ' late, ' + jq.counts.action_required + ' action required, ' + jq.counts.unscheduled + ' unscheduled)' : '- Jobs needing attention: not available (see Heads-up)');
  L.push(inv.ready.computed ? '- Ready to invoice: ' + inv.ready.count + ' ' + plural(inv.ready.count, 'job') + (inv.ready.total === null ? '' : ' (' + fmtMoney(inv.ready.total) + (inv.ready.knownTotalCount < inv.ready.count ? ' for the ' + inv.ready.knownTotalCount + ' with a total' : '') + ')') : '- Ready to invoice: not available (see Heads-up)');
  L.push(inv.pastDue.computed ? '- Past-due invoices: ' + inv.pastDue.count + ' ' + plural(inv.pastDue.count, 'invoice') + ' with ' + fmtMoney(inv.pastDue.total) + ' outstanding (' + s.pastDueMinDays + '+ ' + plural(s.pastDueMinDays, 'day') + ' past the due date)' : '- Past-due invoices: not available (see Heads-up)');
  L.push(qq.computed ? '- Stalled quotes worth a call: ' + qq.count + ' ' + plural(qq.count, 'quote') + ' worth ' + fmtMoney(qq.total) + ' (' + fmtMoney(s.quoteMinValue) + '+, still awaiting a response ' + s.quoteStalledDays + '+ days after sending)' : '- Stalled quotes worth a call: not available (see Heads-up)');

  L.push('');
  L.push('## 1. Unscheduled, Late & Action Required jobs');
  L.push('');
  if (jq.computed) {
    jq.items.slice(0, max).forEach(function (i) {
      L.push('- Job ' + i.id + ' | ' + kindLabel[i.kind] + ' | ' + i.client + (i.title ? ' | ' + i.title : '') + (i.ageDays === null ? '' : ' | ' + ageLabel(i.ageDays, i.kind === 'late' ? 'late' : 'old')));
      L.push('  - ' + i.reason + (i.assigned ? ' | assigned: ' + i.assigned : ''));
    });
    more(jq.items).forEach(function (x) { L.push(x); });
    if (jq.items.length === 0) L.push('- Nothing flagged.');
  } else {
    L.push('Not available (see Heads-up).');
  }

  L.push('');
  L.push('## 2. Requires Invoicing & past-due invoices');
  L.push('');
  L.push('Jobs marked Requires Invoicing:');
  if (inv.ready.computed) {
    inv.ready.items.slice(0, max).forEach(function (i) {
      L.push('- Job ' + i.id + ' | ' + i.client + (i.title ? ' | ' + i.title : '') + ' | ' + (i.total === null || i.total === undefined ? 'total not in the data' : fmtMoney(i.total)) + ' | ' + (i.ageDays === null ? 'wait time not in the data' : 'waiting ' + ageLabel(i.ageDays, 'so far')));
    });
    more(inv.ready.items).forEach(function (x) { L.push(x); });
    if (inv.ready.items.length === 0) L.push('- None.');
  } else {
    L.push('- Not available (see Heads-up).');
  }
  L.push('');
  L.push('Past-due invoices, largest balance first:');
  if (inv.pastDue.computed) {
    inv.pastDue.items.slice(0, max).forEach(function (i) {
      L.push('- Invoice ' + i.id + ' | ' + i.client + ' | ' + fmtMoney(i.balance) + ' outstanding | ' + (i.daysPastDue + ' ' + plural(i.daysPastDue, 'day') + ' past due (due ' + fmtDateOnly(i.dueDate) + ')'));
    });
    more(inv.pastDue.items).forEach(function (x) { L.push(x); });
    if (inv.pastDue.items.length === 0) L.push('- None.');
  } else {
    L.push('- Not available (see Heads-up).');
  }

  L.push('');
  L.push('## 3. High-value quotes for a human call');
  L.push('');
  L.push('These quotes are still awaiting a response beyond the configured send-date cutoff. Pick up the phone or write a personal note. This pack sends nothing to customers and does not send another automated reminder.');
  L.push('');
  if (qq.computed) {
    qq.items.slice(0, max).forEach(function (i, n) {
      L.push((n + 1) + '. Quote ' + i.id + ' | ' + fmtMoney(i.total) + ' | ' + i.client + (i.title ? ' | ' + i.title : '') + ' | sent ' + i.sentLabel + ' (' + i.ageDays + ' ' + plural(i.ageDays, 'day') + ' ago)');
    });
    more(qq.items).forEach(function (x) { L.push(x); });
    if (qq.items.length === 0) L.push('- No stalled high-value quotes.');
  } else {
    L.push('Not available (see Heads-up).');
  }

  const hu = uniqueList((s.headsUp || []).concat(jq.headsUp, inv.headsUp, qq.headsUp, data.headsUp || []));
  if (hu.length > 0) {
    L.push('');
    L.push('## Heads-up');
    L.push('');
    hu.forEach(function (h) { L.push('Heads-up: ' + h); });
  }
  L.push('');
  L.push('---');
  L.push(tag + 'Draft pack, not yet tested against a live Jobber account. Read-only. Owner-only delivery.');
  const text = L.join('\n');
  const esc = function (x) { return x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const placeholderEmail = !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(s.ownerEmail) || /@example\.(com|org|net)$/i.test(s.ownerEmail);
  const wantsEmail = s.delivery === 'email' || s.delivery === 'both';
  const wantsSlack = s.delivery === 'slack' || s.delivery === 'both';
  const out = {
    subject: tag + 'Morning Ops Triage Digest: ' + s.businessName + ' (' + fmtDay(asOf, tz) + ')',
    text: text,
    html: '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;white-space:pre-wrap">' + esc(text) + '</pre>',
    emailTo: s.ownerEmail,
    slackChannel: s.ownerSlackChannel,
    sendEmail: wantsEmail && !placeholderEmail,
    sendSlack: wantsSlack && /^[CG][A-Z0-9]{8,}$/.test(s.ownerSlackChannel),
    slackText: esc(text),
    testMode: s.testMode,
    deliveryNotes: [],
  };
  if (wantsEmail && placeholderEmail) out.deliveryNotes.push('Email not sent: ownerEmail is blank, invalid, or still the example.com placeholder.');
  if (wantsSlack && !out.sendSlack) out.deliveryNotes.push('Slack not sent: ownerSlackChannel must be a configured channel ID.');
  return out;
}

// @@END
// GraphQL documents used by workflow.n8n.json. Queries only (no mutations). UNVERIFIED field names; see README.
const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
const JOBBER_QUERIES = {
  jobs: 'query MorningOpsJobs { jobs(first: 50) { nodes { id jobNumber title jobStatus createdAt completedAt total client { name } visits(first: 20) { nodes { id startAt endAt } } } pageInfo { hasNextPage endCursor } } }',
  invoices: 'query MorningOpsInvoices { invoices(first: 50) { nodes { id invoiceNumber invoiceStatus issuedDate dueDate amounts { total invoiceBalance } client { name } } pageInfo { hasNextPage endCursor } } }',
  quotes: 'query MorningOpsQuotes { quotes(first: 50) { nodes { id quoteNumber title quoteStatus sentAt amounts { total } client { name } } pageInfo { hasNextPage endCursor } } }',
};

module.exports = {
  DEFAULTS, JOBBER_GRAPHQL_URL, JOBBER_QUERIES, REPORTS, JOB_COLUMNS, INVOICE_COLUMNS, QUOTE_COLUMNS,
  isBlank, parseTime, localDate, dayDiff, fmtMoney, headerKey, jobStatusKey, invoiceStatusKey, quoteStatusKey,
  prepareSettings, parseCsvTable, parseCsv, canonicalizeRows, resolveWall, toIsoInZone, toLocalDate, parseMoney,
  prepareReport, normalizeReportExport, normalizeJobsExport, normalizeInvoicesExport, normalizeQuotesExport,
  classifyCsvTable, datasetFromCsvFiles, normalizeJobberGraphql,
  jobsQueue, invoicingQueue, quoteQueue, runTriage, renderMessage,
};
