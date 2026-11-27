/**
 * Housecall Pro CSV-First Morning Ops Copilot: shared logic (DRAFT v0.1.0).
 *
 * Single source of truth for the Code nodes in workflow.n8n.json. build_workflow.cjs copies the
 * `@@SECTION` blocks below into the n8n Code nodes, and mock_hcp_test.cjs runs both this module and the
 * code extracted from the workflow JSON. Edit here, then run build_workflow.cjs.
 *
 * Rules: plain JavaScript only, no require/import inside a section, no network calls, no file access.
 * Nothing here sends anything to anyone and nothing here writes to Housecall Pro (there is no Housecall Pro
 * connection at all: the input is CSV text). Every number is computed from the data it is given; when a
 * metric cannot be computed the digest gets a Heads-up line.
 *
 * Time policy (documented and tested):
 *   - Dates without an offset ("3/10/2026 9:50 AM", "2026-03-10 09:50") are shop-local wall time in
 *     Config timezone (default America/Chicago).
 *   - A wall time that does not exist (spring-forward gap, e.g. 2026-03-08 2:30 AM Chicago) is moved
 *     FORWARD by the length of the gap (2:30 AM becomes 3:30 AM CDT) and counted in a Heads-up.
 *   - A wall time that happens twice (fall-back, e.g. 2026-11-01 1:30 AM Chicago) is read as the FIRST
 *     occurrence (daylight time) and counted in a Heads-up.
 *   - Impossible calendar dates (2026-02-30, 13/45/2026) are rejected, never rolled over.
 *
 * Status policy: Housecall Pro's literal export status text has NOT been verified against a live account.
 * The alias lists below (jobStatusKey, invoiceStatusKey, estimateStatusKey) are documented best guesses.
 * A status that is not in a list is counted in a Heads-up and never guessed into a queue.
 */

// @@SECTION common
const DEFAULTS = {
  pastDueMinDays: 1,
  estimateStalledDays: 14,
  estimateMinValue: 1000,
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
// Single-line, control-character-free text for anything that came from a CSV cell and ends up in a digest line.
function oneLine(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function statusWord(raw) {
  return String(raw === null || raw === undefined ? '' : raw).toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function pick(map, raw) {
  const w = statusWord(raw);
  if (!w) return '';
  return Object.prototype.hasOwnProperty.call(map, w) ? map[w] : 'other';
}
// Job status aliases. UNVERIFIED against a real export. Housecall Pro has no "Late" status as far as is
// verified, so lateness is computed from the scheduled end date instead (see jobsQueue).
const JOB_STATUS_MAP = {
  unscheduled: 'unscheduled', needsscheduling: 'unscheduled', tobescheduled: 'unscheduled', notscheduled: 'unscheduled',
  scheduled: 'scheduled', confirmed: 'scheduled', today: 'scheduled', upcoming: 'scheduled',
  inprogress: 'in_progress', started: 'in_progress', onmyway: 'in_progress', dispatched: 'in_progress', working: 'in_progress',
  needsattention: 'action_required', actionrequired: 'action_required', needsaction: 'action_required',
  needsofficeaction: 'action_required', officeactionrequired: 'action_required', waitingonoffice: 'action_required',
  waitingforoffice: 'action_required', needsfollowup: 'action_required', needsreview: 'action_required', onhold: 'action_required',
  complete: 'completed', completed: 'completed', completerated: 'completed', completeunrated: 'completed', finished: 'completed', done: 'completed',
  canceled: 'cancelled', cancelled: 'cancelled', usercanceled: 'cancelled', procanceled: 'cancelled', usercancelled: 'cancelled', procancelled: 'cancelled',
  archived: 'archived',
};
// Invoice status aliases. UNVERIFIED. 'unsent' = created but not sent to the customer.
const INVOICE_STATUS_MAP = {
  paid: 'paid', paidinfull: 'paid',
  draft: 'unsent', unsent: 'unsent', notsent: 'unsent', notyetsent: 'unsent',
  void: 'void', voided: 'void', canceled: 'void', cancelled: 'void', writtenoff: 'void',
  pastdue: 'past_due', overdue: 'past_due',
  sent: 'open', open: 'open', unpaid: 'open', outstanding: 'open', awaitingpayment: 'open', partiallypaid: 'open', partial: 'open', due: 'open', pending: 'open',
};
// Estimate status aliases. UNVERIFIED. Only 'awaiting_response' can become a stalled estimate.
const ESTIMATE_STATUS_MAP = {
  awaitingresponse: 'awaiting_response', awaitingapproval: 'awaiting_response', pendingapproval: 'awaiting_response', pending: 'awaiting_response',
  sent: 'awaiting_response', open: 'awaiting_response', viewed: 'awaiting_response', waitingonresponse: 'awaiting_response', waitingoncustomer: 'awaiting_response',
  draft: 'draft', drafted: 'draft', unsent: 'draft', notsent: 'draft', notyetsent: 'draft',
  approved: 'accepted', accepted: 'accepted', won: 'accepted', converted: 'accepted',
  declined: 'declined', rejected: 'declined', lost: 'declined', denied: 'declined',
  expired: 'closed', canceled: 'closed', cancelled: 'closed', archived: 'closed', void: 'closed', voided: 'closed',
};
// The "is this job invoiced?" column some Jobs exports carry. Blank or unrecognized text means "no signal".
const JOB_INVOICE_STATE_MAP = {
  none: 'none', no: 'none', false: 'none', notinvoiced: 'none', uninvoiced: 'none', notcreated: 'none', noinvoice: 'none',
  draft: 'unsent', unsent: 'unsent', notsent: 'unsent', notyetsent: 'unsent',
  sent: 'sent', yes: 'sent', true: 'sent', invoiced: 'sent', paid: 'sent', open: 'sent', unpaid: 'sent', pastdue: 'sent', overdue: 'sent',
  outstanding: 'sent', awaitingpayment: 'sent', partiallypaid: 'sent',
};
function jobStatusKey(raw) { return pick(JOB_STATUS_MAP, raw); }
function invoiceStatusKey(raw) { return pick(INVOICE_STATUS_MAP, raw); }
function estimateStatusKey(raw) { return pick(ESTIMATE_STATUS_MAP, raw); }
function jobInvoiceStateKey(raw) {
  const k = pick(JOB_INVOICE_STATE_MAP, raw);
  return k === 'other' ? '' : k;
}

// @@SECTION settings
function prepareSettings(cfg, nowMs) {
  const notes = [];
  let source = lc(cfg.source);
  if (['test', 'csv'].indexOf(source) === -1) {
    notes.push('Config source "' + oneLine(cfg.source) + '" is not test or csv. Using test instead. There is no live Housecall Pro connection in this pack.');
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
  const asOfMs = parseTime(override.iso);
  const delivery = ['email', 'slack', 'both', 'none'].indexOf(lc(cfg.delivery)) === -1 ? 'email' : lc(cfg.delivery);
  const s = {
    businessName: isBlank(cfg.businessName) ? 'Your Business Name' : oneLine(cfg.businessName),
    timezone: tz,
    source: source,
    testMode: testMode,
    delivery: delivery,
    ownerEmail: isBlank(cfg.ownerEmail) ? '' : String(cfg.ownerEmail).trim(),
    ownerSlackChannel: isBlank(cfg.ownerSlackChannel) ? '' : String(cfg.ownerSlackChannel).trim(),
    csvFolder: isBlank(cfg.csvFolder) ? '' : String(cfg.csvFolder).trim(),
    asOf: new Date(asOfMs === null ? nowMs : asOfMs).toISOString(),
    headsUp: notes,
  };
  Object.keys(DEFAULTS).filter(function (k) { return k !== 'estimateStalledDays'; }).forEach(function (k) {
    let n = toNum(cfg[k], DEFAULTS[k]);
    if (n < 0) { notes.push('Config ' + k + ' cannot be negative. Using ' + DEFAULTS[k] + '.'); n = DEFAULTS[k]; }
    s[k] = n;
  });
  const days = toNum(cfg.estimateStalledDays, null);
  if (source !== 'test' && !isBlank(cfg.estimateStalledDays) && !(Number.isInteger(days) && days >= 1)) {
    notes.push('Config estimateStalledDays must be a whole number of 1 or more. The estimate queue stays off until it is fixed.');
  }
  s.estimateStalledDays = source === 'test' ? DEFAULTS.estimateStalledDays :
    Number.isInteger(days) && days >= 1 ? days : null;
  s.pastDueMinDays = Math.max(1, Math.ceil(s.pastDueMinDays));
  s.maxItemsPerSection = Math.max(1, Math.floor(s.maxItemsPerSection));
  return s;
}

// @@SECTION csv
// CSV parsing, header-alias mapping, and the Jobs / Invoices / Estimates export normalizers.
// Header aliases are best guesses plus common variants. The exact header text of a real Housecall Pro export
// has NOT been checked against a live account (only the Jobs and Customers export is documented to exist).
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
      if (row.length > 1 || row[0].trim()) rows.push(row);
      row = [];
      record++;
    } else { field += c; }
  }
  row.push(field);
  if (row.length > 1 || row[0].trim()) rows.push(row);
  if (inQuotes) return malformed('A quoted field was never closed. Re-export the CSV and try again.');
  if (rows.length === 0) return { headers: [], rows: [], warnings: warnings };
  const header = rows[0].map(function (h) { return h.trim(); });
  const duplicates = header.filter(function (h, i) { return h && header.indexOf(h) !== i; });
  if (duplicates.length) {
    return { headers: header, rows: [], warnings: ['Duplicate CSV headers: ' + duplicates.join(', ') + '.'] };
  }
  const body = [];
  rows.slice(1).forEach(function (r, idx) {
    if (r.length !== header.length) {
      warnings.push('CSV data record ' + (idx + 2) + (r.length > header.length
        ? ' has more columns than the header. Check for an unescaped comma.'
        : ' has fewer columns than the header. Check for a truncated row.'));
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
  { key: 'customer', label: 'Customer name', aliases: ['Customer name', 'Customer', 'Client name', 'Client', 'Name'] },
  { key: 'title', label: 'Job description', aliases: ['Job description', 'Description', 'Title', 'Job Title', 'Service', 'Job type', 'Summary'] },
  { key: 'address', label: 'Service address', aliases: ['Service address', 'Address', 'Job address', 'Property', 'Location'] },
  { key: 'scheduled_start', label: 'Scheduled start', aliases: ['Scheduled start', 'Schedule start', 'Schedule start date', 'Start', 'Start Date', 'Start Time', 'Scheduled date', 'Appointment start'] },
  { key: 'scheduled_end', label: 'Scheduled end', aliases: ['Scheduled end', 'Schedule end', 'Schedule end date', 'End', 'End Date', 'End Time', 'Appointment end'] },
  { key: 'created_at', label: 'Created date', aliases: ['Created date', 'Created', 'Date Created', 'Created On', 'Created At'] },
  { key: 'completed_at', label: 'Completed date', aliases: ['Completed date', 'Completed', 'Date Completed', 'Completed On', 'Completed At', 'Finished', 'Closed date', 'Closed'] },
  { key: 'total', label: 'Job total ($)', aliases: ['Job total', 'Job total ($)', 'Total', 'Total ($)', 'Amount', 'Value', 'Job Revenue ($)'] },
  { key: 'assigned', label: 'Assigned to', aliases: ['Assigned to', 'Assigned', 'Assigned employees', 'Employees', 'Technician', 'Pro', 'Team Member', 'Team Members', 'Crew'] },
  { key: 'invoice_id', label: 'Invoice #', aliases: ['Invoice #', 'Invoice Number', 'Invoice No', 'Invoice'] },
  { key: 'invoice_status', label: 'Invoice status', aliases: ['Invoice status', 'Invoiced', 'Invoice sent', 'Invoice state'] },
];
const INVOICE_COLUMNS = [
  { key: 'invoice_id', label: 'Invoice # (or Invoice Number)', required: true, aliases: ['Invoice #', 'Invoice Number', 'Invoice No', 'Invoice ID', 'Invoice'] },
  { key: 'due_date', label: 'Due date', required: true, aliases: ['Due date', 'Due', 'Due On', 'Payment Due', 'Due By'] },
  { key: 'balance', label: 'Balance ($) (or Amount Due / Outstanding)', required: true, aliases: ['Balance ($)', 'Balance', 'Balance Due', 'Amount Due', 'Outstanding', 'Outstanding Balance', 'Amount Outstanding'] },
  { key: 'status', label: 'Status (or Invoice Status)', required: true, aliases: ['Invoice Status', 'Status'] },
  { key: 'customer', label: 'Customer name', aliases: ['Customer name', 'Customer', 'Client name', 'Client'] },
  { key: 'total', label: 'Total ($)', aliases: ['Total ($)', 'Total', 'Invoice Total', 'Amount'] },
  { key: 'issued_at', label: 'Invoice date (or Sent date)', aliases: ['Invoice date', 'Issued date', 'Issued', 'Date Issued', 'Sent date', 'Created date'] },
  { key: 'job_ref', label: 'Job #', aliases: ['Job #', 'Job Number', 'Job No', 'Job ID'] },
];
const ESTIMATE_COLUMNS = [
  { key: 'estimate_id', label: 'Estimate # (or Estimate Number)', required: true, aliases: ['Estimate #', 'Estimate Number', 'Estimate No', 'Estimate ID', 'Estimate'] },
  { key: 'status', label: 'Status (or Estimate Status)', required: true, aliases: ['Estimate Status', 'Status'] },
  { key: 'total', label: 'Total ($)', required: true, aliases: ['Total ($)', 'Total', 'Estimate Total', 'Amount', 'Value'] },
  { key: 'sent_at', label: 'Sent date', required: true, aliases: ['Sent date', 'Sent', 'Date Sent', 'Sent On', 'Sent At'] },
  { key: 'created_at', label: 'Created date', aliases: ['Created date', 'Drafted date', 'Created', 'Date Created', 'Created On'] },
  { key: 'customer', label: 'Customer name', aliases: ['Customer name', 'Customer', 'Client name', 'Client'] },
  { key: 'title', label: 'Description', aliases: ['Description', 'Title', 'Estimate Title', 'Job description', 'Summary'] },
];
const REPORTS = {
  jobs: { label: 'Jobs', idKey: 'job_id', columns: JOB_COLUMNS, dateKeys: ['scheduled_start', 'scheduled_end', 'created_at', 'completed_at'], dayKeys: [], moneyKeys: ['total'], idWord: 'job number', hint: 'Export Jobs from Housecall Pro (an admin can export Jobs to CSV) with a header row.' },
  invoices: { label: 'Invoices', idKey: 'invoice_id', columns: INVOICE_COLUMNS, dateKeys: ['issued_at'], dayKeys: ['due_date'], moneyKeys: ['total', 'balance'], idWord: 'invoice number', hint: 'Export an invoice list from Housecall Pro with a header row.' },
  estimates: { label: 'Estimates', idKey: 'estimate_id', columns: ESTIMATE_COLUMNS, dateKeys: ['sent_at', 'created_at'], dayKeys: [], moneyKeys: ['total'], idWord: 'estimate number', hint: 'Export an estimate list from Housecall Pro with a header row.' },
};

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
      const pairedTime = { scheduled_start: 'starttime', scheduled_end: 'endtime' }[col.key];
      if (pairedTime && values.length === 2) {
        const clock = values.find(function (name) { return headerKey(name) === pairedTime; });
        const date = values.find(function (name) { return name !== clock; });
        if (clock && /^\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?$/i.test(r[clock])) {
          const parts = parseDateParts(String(r[date]).trim());
          if (parts && !parts.bad && !parts.hasTime) {
            o[col.key] = String(r[date]).trim() + ' ' + String(r[clock]).trim();
            return;
          }
        }
      }
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
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?)?$/);
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3];
    if (m[4] !== undefined) { hasTime = true; h = +m[4]; mi = +m[5]; sec = m[6] ? +m[6] : 0; ap = m[7] ? m[7].toLowerCase() : ''; }
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

// Generic report preparer for jobs / invoices / estimates. Never throws. res.ok is true only when usable rows exist
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
  if (missing.length) {
    res.missingRequired = missing;
    res.errors.push(label + ' is missing required column(s): ' + missing.join('; ') + '.' + seen + ' Add the missing column(s) to your Housecall Pro report and export again.');
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
      if (r.status && prev.status && jobStatusKey(r.status) !== jobStatusKey(prev.status)) {
        conflictingIds.add(id);
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
    res.headsUp.push(dupes + ' repeated ' + spec.idWord + ' ' + plural(dupes, 'row') + ' in the ' + label + (kind === 'jobs' ? ' ' + plural(dupes, 'was', 'were') + ' grouped by job number (one row per visit).' : ' ' + plural(dupes, 'was', 'were') + ' consolidated by number.'));
  }
  if (conflictingIds.size) {
    res.headsUp.push('Conflicting records for ' + spec.idWord + ' ' + Array.from(conflictingIds).slice(0, 5).join(', ') +
      ' were omitted. Use a single-account report with an unambiguous record per number.');
  }
  if (res.rows.length === 0) res.errors.push('No usable rows were found in the ' + label + '.' + seen);
  if (kind === 'jobs' && c.mapped.scheduled_start === undefined && c.mapped.scheduled_end === undefined) {
    res.headsUp.push('The ' + label + ' has no start-date column or end-date column. Lateness cannot be checked and unscheduled jobs can only be identified by status.');
  }
  res.ok = res.errors.length === 0;
  return res;
}

function mapJobRow(r, flags) {
  return {
    id: String(r.job_id), title: oneLine(r.title), customer: oneLine(r.customer), address: oneLine(r.address), statusRaw: oneLine(r.status),
    status: jobStatusKey(r.status), startAt: r.scheduled_start || '', endAt: r.scheduled_end || '', createdAt: r.created_at || '',
    completedAt: r.completed_at || '', total: r.total === undefined ? null : r.total, assigned: oneLine(r.assigned),
    visitCount: r._rows || 1, unscheduledVisits: flags.startKnown && flags.endKnown ? (r._blankStart || 0) : null,
    invoiceId: oneLine(r.invoice_id), invoiceState: jobInvoiceStateKey(r.invoice_status), invoiceStatusPresent: !isBlank(r.invoice_status),
  };
}
function mapInvoiceRow(r) {
  return {
    id: String(r.invoice_id), customer: oneLine(r.customer), statusRaw: oneLine(r.status), status: invoiceStatusKey(r.status),
    total: r.total === undefined ? null : r.total, balance: r.balance === undefined ? null : r.balance,
    issuedAt: r.issued_at || '', dueDate: r.due_date || '', jobRef: oneLine(r.job_ref),
  };
}
function mapEstimateRow(r) {
  return {
    id: String(r.estimate_id), customer: oneLine(r.customer), title: oneLine(r.title), statusRaw: oneLine(r.status), status: estimateStatusKey(r.status),
    total: r.total === undefined ? null : r.total, sentAt: r.sent_at || '',
  };
}
const MAPPERS = { jobs: mapJobRow, invoices: mapInvoiceRow, estimates: mapEstimateRow };

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
  const flags = {
    endKnown: res.mapped.scheduled_end !== undefined,
    startKnown: res.mapped.scheduled_start !== undefined,
  };
  res.flags = flags;
  res.items = res.ok ? res.rows.map(function (r) { return MAPPERS[kind](r, flags); }) : [];
  res.message = res.errors.join(' ');
  if (o.strict && !res.ok) throw new Error(res.message);
  return res;
}
function normalizeJobsExport(input, opts) { return normalizeReportExport('jobs', input, opts); }
function normalizeInvoicesExport(input, opts) { return normalizeReportExport('invoices', input, opts); }
function normalizeEstimatesExport(input, opts) { return normalizeReportExport('estimates', input, opts); }

// Work out which report a file is. Strong header signatures first (an estimate number; an invoice number with a
// due date or balance), then the file name, then a bare job or invoice number, then "the only file is the jobs file".
// A Jobs export may carry its own "Invoice #" column, so an invoice number alone does not make a file an invoice list.
function classifyCsvTable(fileName, table, fileCount) {
  const has = function (kind, key) { return canonicalizeRows([], REPORTS[kind].columns, table.headers).mapped[key] !== undefined; };
  if (has('jobs', 'job_id') && table.headers.some(function (h) { return headerKey(h) === 'jobstatus'; })) return 'jobs';
  if (has('estimates', 'estimate_id') && (has('estimates', 'sent_at') || !has('jobs', 'job_id'))) return 'estimates';
  if (has('invoices', 'invoice_id') && (has('invoices', 'due_date') || has('invoices', 'balance'))) return 'invoices';
  const n = String(fileName || '').toLowerCase();
  if (/invoice/.test(n)) return 'invoices';
  if (/estimate/.test(n)) return 'estimates';
  if (/job|visit/.test(n)) return 'jobs';
  if (has('jobs', 'job_id')) return 'jobs';
  if (has('invoices', 'invoice_id')) return 'invoices';
  return fileCount === 1 ? 'jobs' : null;
}

function emptyDataset(settings, notes) {
  return {
    settings: Object.assign({}, settings, { headsUp: (settings.headsUp || []).concat(notes || []) }),
    jobs: [], invoices: [], estimates: [], supplied: { jobs: false, invoices: false, estimates: false },
  };
}

// files = [{ name, text }] in any order and with any file names. Any one of the three reports is enough.
// Duplicate report types require an operator to select one snapshot.
function datasetFromCsvFiles(settings, files) {
  const list = Array.isArray(files) ? files : [];
  const notes = [];
  const byKind = { jobs: [], invoices: [], estimates: [] };
  list.forEach(function (f) {
    const name = String((f && f.name) || 'upload.csv');
    const t = parseCsvTable(f && f.text);
    const kind = classifyCsvTable(name, t, list.length);
    t.warnings.forEach(function (w) { notes.push('CSV import: file "' + name + '": ' + w); });
    if (t.warnings.length && !kind) return;
    if (t.headers.length === 0) {
      notes.push('CSV import: file "' + name + '" is empty. Export the report again with a header row and at least one row.');
      return;
    }
    if (!kind) {
      notes.push('CSV import: file "' + name + '" was not recognized as a Jobs, Invoices, or Estimates report and was ignored.');
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
  if (list.length === 0) notes.push('CSV import: no CSV file was received. Send or drop a Housecall Pro Jobs, Invoices, or Estimates report export.');
  ['jobs', 'invoices', 'estimates'].forEach(function (kind) {
    if (!ds.supplied[kind] && byKind[kind].length === 0 && list.length > 0) notes.push('CSV import: no ' + REPORTS[kind].label + ' export was supplied, so that part of the digest is skipped.');
  });
  ds.settings = Object.assign({}, settings, { headsUp: (settings.headsUp || []).concat(uniqueList(notes)) });
  return ds;
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
function byIdText(a, b) {
  return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
}

// Queue 1: unscheduled jobs, late jobs, and jobs waiting on an office action.
// "Late" is computed, not read from a status: an open (scheduled / in progress) job whose scheduled end has passed,
// or, when there is no end time, whose scheduled start was on an earlier shop-local day.
function jobsQueue(data) {
  const ctx = triageNow(data);
  const out = { computed: false, items: [], counts: { late: 0, action_required: 0, unscheduled: 0 }, total: 0, unrecognized: 0, headsUp: [] };
  if (!data.supplied || !data.supplied.jobs) { out.headsUp.push(missingReport('Jobs')); return out; }
  out.computed = true;
  const order = { late: 0, action_required: 1, unscheduled: 2 };
  let noDates = 0;
  (data.jobs || []).forEach(function (j) {
    const st = j.status;
    if (['completed', 'archived', 'cancelled'].indexOf(st) !== -1) return;
    if (st === 'other' || !st) { out.unrecognized++; return; }
    let kind = '';
    let reason = '';
    let age = null;
    if (st === 'action_required') {
      kind = 'action_required';
      reason = 'Needs office action' + (j.statusRaw ? ' (status "' + j.statusRaw + '")' : '');
    } else if (st === 'unscheduled') {
      kind = 'unscheduled';
      reason = 'Unscheduled';
      age = ageDaysFromIso(j.createdAt, ctx);
    } else if (j.unscheduledVisits > 0) {
      kind = 'unscheduled';
      reason = j.unscheduledVisits === j.visitCount
        ? (j.visitCount === 1 ? 'Marked ' + j.statusRaw + ' but has no scheduled date' : 'All ' + j.visitCount + ' visits have no scheduled date')
        : j.unscheduledVisits + ' of ' + j.visitCount + ' visits ' + plural(j.unscheduledVisits, 'has', 'have') + ' no scheduled date';
      age = ageDaysFromIso(j.createdAt, ctx);
    } else {
      const endMs = parseTime(j.endAt);
      const startMs = parseTime(j.startAt);
      if (endMs !== null) {
        if (endMs < ctx.asOf) {
          kind = 'late';
          reason = (st === 'in_progress' ? 'Late. Still in progress; scheduled to end ' : 'Late. Scheduled to end ') + fmtDay(endMs, ctx.tz) + ' ' + fmtTime(endMs, ctx.tz);
          age = ageDaysFromIso(j.endAt, ctx);
        }
      } else if (startMs !== null) {
        if (dayDiff(localDate(startMs, ctx.tz), ctx.today) >= 1) {
          kind = 'late';
          reason = 'Late. Scheduled to start ' + fmtDay(startMs, ctx.tz) + ' ' + fmtTime(startMs, ctx.tz) + ' (no end time in the data)';
          age = ageDaysFromIso(j.startAt, ctx);
        }
      } else {
        noDates++;
      }
    }
    if (!kind) return;
    out.counts[kind]++;
    out.items.push({ id: j.id, kind: kind, reason: reason, customer: j.customer || 'customer not in the data', title: j.title, ageDays: age, total: j.total, assigned: j.assigned });
  });
  out.items.sort(function (a, b) {
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
    const x = a.ageDays === null ? -1 : a.ageDays;
    const y = b.ageDays === null ? -1 : b.ageDays;
    if (x !== y) return y - x;
    return byIdText(a, b);
  });
  out.total = out.items.length;
  if (out.total === 0 && (out.unrecognized || noDates)) out.computed = false;
  if (out.unrecognized > 0) out.headsUp.push(out.unrecognized + ' ' + plural(out.unrecognized, 'job') + ' had a status this pack does not recognize and ' + plural(out.unrecognized, 'was', 'were') + ' not triaged. Add the status to the alias list or tell the pack author.');
  if (noDates > 0) out.headsUp.push(noDates + ' open ' + plural(noDates, 'job') + ' ' + plural(noDates, 'has', 'have') + ' no scheduled start or end in the data, so lateness could not be checked.');
  return out;
}

// For one finished job, decide: 'no_invoice', 'not_sent', 'invoiced', or 'unknown' (the data cannot say).
function invoiceStateForJob(j, invByJob, invById) {
  const list = (invByJob.get(j.id) || []).slice();
  const linked = invById.get(j.invoiceId);
  if (linked && (!linked.jobRef || linked.jobRef === j.id) && !list.includes(linked)) list.push(linked);
  if (j.invoiceState === 'sent' || list.some(function (i) { return ['paid', 'open', 'past_due'].includes(i.status); })) return 'invoiced';
  if (list.some(function (i) { return !i.status || i.status === 'other'; })) return 'unknown';
  if (j.invoiceState === 'unsent' || list.some(function (i) { return i.status === 'unsent'; })) return 'not_sent';
  if (j.invoiceId || j.invoiceStatusPresent && !j.invoiceState) return 'unknown';
  return j.invoiceState === 'none' ? 'no_invoice' : 'unknown';
}

// Queue 2: finished jobs with no invoice (or an invoice that was never sent), and past-due invoices.
function invoicingQueue(data) {
  const ctx = triageNow(data);
  const s = ctx.s;
  const out = {
    ready: { computed: false, items: [], count: 0, total: null, knownTotalCount: 0 },
    pastDue: { computed: false, items: [], count: 0, total: 0 },
    headsUp: [],
  };
  const invoicesSupplied = !!(data.supplied && data.supplied.invoices);
  const invByJob = new Map();
  const invById = new Map();
  (data.invoices || []).forEach(function (i) {
    if (i.status === 'void') return;
    invById.set(i.id, i);
    if (!i.jobRef) return;
    if (!invByJob.has(i.jobRef)) invByJob.set(i.jobRef, []);
    invByJob.get(i.jobRef).push(i);
  });
  if (!data.supplied || !data.supplied.jobs) {
    out.headsUp.push('Finished jobs that still need an invoice come from a Jobs export, which was not supplied. That list is skipped.');
  } else {
    out.ready.computed = true;
    let noDate = 0; let unknown = 0; let finished = 0;
    (data.jobs || []).forEach(function (j) {
      if (j.status !== 'completed') return;
      finished++;
      const state = invoiceStateForJob(j, invByJob, invById);
      if (state === 'unknown') { unknown++; return; }
      if (state === 'invoiced') return;
      const since = j.completedAt || j.endAt || '';
      const ageDays = ageDaysFromIso(since, ctx);
      if (ageDays === null) noDate++;
      out.ready.items.push({ id: j.id, customer: j.customer || 'customer not in the data', title: j.title, ageDays: ageDays, total: j.total, reason: state === 'not_sent' ? 'Invoice created but not sent' : 'No invoice yet' });
    });
    out.ready.items.sort(function (a, b) {
      const x = a.ageDays === null ? -1 : a.ageDays;
      const y = b.ageDays === null ? -1 : b.ageDays;
      if (x !== y) return y - x;
      return byIdText(a, b);
    });
    out.ready.count = out.ready.items.length;
    const known = out.ready.items.filter(function (i) { return i.total !== null && i.total !== undefined; });
    out.ready.knownTotalCount = known.length;
    out.ready.total = known.length ? known.reduce(function (a, i) { return a + i.total; }, 0) : null;
    if (unknown > 0) {
      out.headsUp.push(unknown + ' finished ' + plural(unknown, 'job') + ' could not be checked for an invoice. Provide a recognized Invoice status on the Jobs row or a matching Invoices row with a recognized status.');
      if (out.ready.count === 0) out.ready.computed = false;
    }
    if (noDate > 0) out.headsUp.push(noDate + ' ready-to-invoice ' + plural(noDate, 'job') + ' ' + plural(noDate, 'has', 'have') + ' no usable past completed or end date, so how long ' + plural(noDate, 'it has', 'they have') + ' waited cannot be shown.');
    if (known.length < out.ready.count) out.headsUp.push((out.ready.count - known.length) + ' ready-to-invoice ' + plural(out.ready.count - known.length, 'job') + ' ' + plural(out.ready.count - known.length, 'has', 'have') + ' no total, so the dollar figure covers only the others.');
    if (invoicesSupplied) {
      const jobIds = new Set((data.jobs || []).map(function (j) { return j.id; }));
      const loose = (data.invoices || []).filter(function (i) { return i.status === 'unsent' && !jobIds.has(i.jobRef); }).length;
      if (loose > 0) out.headsUp.push(loose + ' unsent ' + plural(loose, 'invoice') + ' could not be matched to a job in the Jobs export, so ' + plural(loose, 'it was', 'they were') + ' not counted as ready to invoice.');
    }
    if (finished === 0 && (data.jobs || []).some(function (j) { return !j.status || j.status === 'other'; })) out.ready.computed = false;
  }
  if (!invoicesSupplied) {
    out.headsUp.push(missingReport('Invoices'));
  } else {
    out.pastDue.computed = true;
    let noBalance = 0; let noDue = 0; let conflicts = 0; let unknownStatus = 0;
    (data.invoices || []).forEach(function (inv) {
      if (['paid', 'unsent', 'void'].indexOf(inv.status) !== -1) return;
      if (inv.status !== 'past_due' && inv.status !== 'open') { unknownStatus++; return; }
      if (inv.balance === null || inv.balance === undefined) { noBalance++; return; }
      if (!(inv.balance > 0)) return;
      if (!inv.dueDate) { noDue++; return; }
      const days = dayDiff(inv.dueDate, ctx.today);
      if (!Number.isFinite(days)) { noDue++; return; }
      if (inv.status === 'past_due' && days <= 0) conflicts++;
      if (days < Math.max(1, s.pastDueMinDays)) return;
      out.pastDue.items.push({ id: inv.id, customer: inv.customer || 'customer not in the data', balance: inv.balance, total: inv.total, dueDate: inv.dueDate, daysPastDue: days });
    });
    out.pastDue.items.sort(function (a, b) {
      if (a.balance !== b.balance) return b.balance - a.balance;
      if (a.daysPastDue !== b.daysPastDue) return b.daysPastDue - a.daysPastDue;
      return byIdText(a, b);
    });
    out.pastDue.count = out.pastDue.items.length;
    out.pastDue.total = out.pastDue.items.reduce(function (a, i) { return a + i.balance; }, 0);
    if (out.pastDue.count === 0 && (noBalance || noDue || unknownStatus)) out.pastDue.computed = false;
    if (unknownStatus) out.headsUp.push(unknownStatus + ' invoice ' + plural(unknownStatus, 'record') + ' had no recognized status and ' + plural(unknownStatus, 'was', 'were') + ' skipped.');
    if (noBalance > 0) out.headsUp.push(noBalance + ' open ' + plural(noBalance, 'invoice') + ' ' + plural(noBalance, 'has', 'have') + ' no balance in the data and ' + plural(noBalance, 'was', 'were') + ' skipped.');
    if (noDue > 0) out.headsUp.push(noDue + ' open ' + plural(noDue, 'invoice') + ' ' + plural(noDue, 'has', 'have') + ' no due date and ' + plural(noDue, 'was', 'were') + ' skipped because the age threshold cannot be checked.');
    if (conflicts > 0) out.headsUp.push(conflicts + ' ' + plural(conflicts, 'invoice') + ' marked past due ' + plural(conflicts, 'has', 'have') + ' a due date today or in the future. The due date was used, so ' + plural(conflicts, 'it was', 'they were') + ' not listed.');
  }
  return out;
}

// Queue 3: high-value estimates still awaiting a response well after the shop's own native follow-up would have gone out.
// A person calls these. Nothing here sends anything.
function estimateQueue(data) {
  const ctx = triageNow(data);
  const s = ctx.s;
  const out = { computed: false, items: [], count: 0, total: 0, notYetStalled: 0, belowValue: 0, headsUp: [] };
  if (!data.supplied || !data.supplied.estimates) { out.headsUp.push(missingReport('Estimates')); return out; }
  if (s.estimateStalledDays === null || s.estimateStalledDays === undefined) {
    out.headsUp.push('Set estimateStalledDays to a shop-local day cutoff after the last follow-up your shop sends on its own. Until then, the estimate queue is unavailable.');
    return out;
  }
  out.computed = true;
  let noTotal = 0; let noDate = 0; let future = 0; let unknownStatus = 0;
  (data.estimates || []).forEach(function (q) {
    if (!q.status || q.status === 'other') unknownStatus++;
    if (q.status !== 'awaiting_response') return; // drafts, accepted, declined, expired, canceled: not stalled
    if (q.total === null || q.total === undefined) { noTotal++; return; }
    const sentMs = parseTime(q.sentAt);
    if (sentMs === null) { noDate++; return; }
    if (sentMs > ctx.asOf) { future++; return; }
    const age = dayDiff(localDate(sentMs, ctx.tz), ctx.today);
    if (q.total < s.estimateMinValue) { out.belowValue++; return; }
    if (age < s.estimateStalledDays) { out.notYetStalled++; return; }
    out.items.push({ id: q.id, customer: q.customer || 'customer not in the data', title: q.title, total: q.total, ageDays: age, sentLabel: fmtDay(sentMs, ctx.tz) });
  });
  out.items.sort(function (a, b) {
    if (a.total !== b.total) return b.total - a.total;
    if (a.ageDays !== b.ageDays) return b.ageDays - a.ageDays;
    return byIdText(a, b);
  });
  out.count = out.items.length;
  out.total = out.items.reduce(function (a, i) { return a + i.total; }, 0);
  if (noTotal > 0) out.headsUp.push(noTotal + ' ' + plural(noTotal, 'estimate') + ' awaiting a response ' + plural(noTotal, 'has', 'have') + ' no total and ' + plural(noTotal, 'was', 'were') + ' skipped.');
  if (noDate > 0) out.headsUp.push(noDate + ' ' + plural(noDate, 'estimate') + ' awaiting a response ' + plural(noDate, 'has', 'have') + ' no send date and ' + plural(noDate, 'was', 'were') + ' skipped. A created date cannot show how long the customer has had it.');
  if (future > 0) out.headsUp.push(future + ' ' + plural(future, 'estimate') + ' ' + plural(future, 'has', 'have') + ' a send date in the future and ' + plural(future, 'was', 'were') + ' skipped.');
  if (out.items.length === 0 && (noDate || noTotal || unknownStatus)) out.computed = false;
  if (unknownStatus) out.headsUp.push(unknownStatus + ' ' + plural(unknownStatus, 'estimate record') + ' had no recognized status and ' + plural(unknownStatus, 'was', 'were') + ' skipped.');
  return out;
}

function runTriage(data) {
  return Object.assign({}, data, { jobsQueue: jobsQueue(data), invoicing: invoicingQueue(data), estimateQueue: estimateQueue(data) });
}

// @@SECTION message
function renderMessage(data) {
  const s = data.settings;
  const tz = s.timezone;
  const asOf = parseTime(s.asOf);
  const max = s.maxItemsPerSection;
  const jq = data.jobsQueue;
  const inv = data.invoicing;
  const eq = data.estimateQueue;
  const tag = s.testMode ? '[TEST] ' : '';
  const L = [];
  const more = function (arr) { return arr.length > max ? ['- ...and ' + (arr.length - max) + ' more (see the workflow output)'] : []; };
  const kindLabel = { late: 'Late', action_required: 'Needs office action', unscheduled: 'Unscheduled' };

  L.push('# ' + tag + 'Morning Ops Triage Digest: ' + s.businessName);
  L.push('');
  L.push(fmtDay(asOf, tz) + ' ' + fmtTime(asOf, tz) + ' ' + tz + ' | source: ' + s.source + ' | Housecall Pro CSV exports');
  if (s.testMode) {
    L.push('');
    L.push('> [TEST] Preview only. Sent to the owner address or channel you set, never to a customer.' + (s.source === 'test' ? ' Built from fictional sample data.' : ''));
  }
  L.push('');
  L.push('## Today at a glance');
  L.push('');
  L.push(jq.computed ? '- Jobs needing attention: ' + jq.total + ' (' + jq.counts.late + ' late, ' + jq.counts.action_required + ' need office action, ' + jq.counts.unscheduled + ' unscheduled)' : '- Jobs needing attention: not available (see Heads-up)');
  L.push(inv.ready.computed ? '- Ready to invoice: ' + inv.ready.count + ' ' + plural(inv.ready.count, 'job') + (inv.ready.total === null ? '' : ' (' + fmtMoney(inv.ready.total) + (inv.ready.knownTotalCount < inv.ready.count ? ' for the ' + inv.ready.knownTotalCount + ' with a total' : '') + ')') : '- Ready to invoice: not available (see Heads-up)');
  L.push(inv.pastDue.computed ? '- Past-due invoices: ' + inv.pastDue.count + ' ' + plural(inv.pastDue.count, 'invoice') + ' with ' + fmtMoney(inv.pastDue.total) + ' outstanding (' + s.pastDueMinDays + '+ ' + plural(s.pastDueMinDays, 'day') + ' past the due date)' : '- Past-due invoices: not available (see Heads-up)');
  L.push(eq.computed ? '- Stalled estimates worth a call: ' + eq.count + ' ' + plural(eq.count, 'estimate') + ' worth ' + fmtMoney(eq.total) + ' (' + fmtMoney(s.estimateMinValue) + '+, still awaiting a response ' + s.estimateStalledDays + '+ days after sending)' : '- Stalled estimates worth a call: not available (see Heads-up)');

  L.push('');
  L.push('## 1. Unscheduled, late & needs-office-action jobs');
  L.push('');
  if (jq.computed) {
    jq.items.slice(0, max).forEach(function (i) {
      L.push('- Job ' + oneLine(i.id) + ' | ' + kindLabel[i.kind] + ' | ' + i.customer + (i.title ? ' | ' + i.title : '') + (i.ageDays === null ? '' : ' | ' + ageLabel(i.ageDays, i.kind === 'late' ? 'late' : 'old')));
      L.push('  - ' + i.reason + (i.assigned ? ' | assigned: ' + i.assigned : ''));
    });
    more(jq.items).forEach(function (x) { L.push(x); });
    if (jq.items.length === 0) L.push('- Nothing flagged.');
  } else {
    L.push('Not available (see Heads-up).');
  }

  L.push('');
  L.push('## 2. Ready to invoice & past-due invoices');
  L.push('');
  L.push('Finished jobs with no invoice, or an invoice that was never sent:');
  if (inv.ready.computed) {
    inv.ready.items.slice(0, max).forEach(function (i) {
      L.push('- Job ' + oneLine(i.id) + ' | ' + i.customer + (i.title ? ' | ' + i.title : '') + ' | ' + i.reason + ' | ' + (i.total === null || i.total === undefined ? 'total not in the data' : fmtMoney(i.total)) + ' | ' + (i.ageDays === null ? 'wait time not in the data' : 'finished ' + ageLabel(i.ageDays, 'ago')));
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
      L.push('- Invoice ' + oneLine(i.id) + ' | ' + i.customer + ' | ' + fmtMoney(i.balance) + ' outstanding | ' + (i.daysPastDue + ' ' + plural(i.daysPastDue, 'day') + ' past due (due ' + fmtDateOnly(i.dueDate) + ')'));
    });
    more(inv.pastDue.items).forEach(function (x) { L.push(x); });
    if (inv.pastDue.items.length === 0) L.push('- None.');
  } else {
    L.push('- Not available (see Heads-up).');
  }

  L.push('');
  L.push('## 3. High-value estimates for a human call');
  L.push('');
  L.push('These estimates were sent and are still awaiting a response beyond the configured send-date cutoff. Pick up the phone or write a personal note. This pack sends nothing to customers and does not send another automated reminder.');
  L.push('');
  if (eq.computed) {
    eq.items.slice(0, max).forEach(function (i, n) {
      L.push((n + 1) + '. Estimate ' + oneLine(i.id) + ' | ' + fmtMoney(i.total) + ' | ' + i.customer + (i.title ? ' | ' + i.title : '') + ' | sent ' + i.sentLabel + ' (' + i.ageDays + ' ' + plural(i.ageDays, 'day') + ' ago)');
    });
    more(eq.items).forEach(function (x) { L.push(x); });
    if (eq.items.length === 0) L.push('- No stalled high-value estimates.');
  } else {
    L.push('Not available (see Heads-up).');
  }

  const hu = uniqueList((s.headsUp || []).concat(jq.headsUp, inv.headsUp, eq.headsUp, data.headsUp || []).map(oneLine));
  if (hu.length > 0) {
    L.push('');
    L.push('## Heads-up');
    L.push('');
    hu.forEach(function (h) { L.push('Heads-up: ' + h); });
  }
  L.push('');
  L.push('---');
  L.push(tag + 'Draft pack, not yet tested against a live Housecall Pro, Gmail, or Slack account. Read-only. Owner-only delivery.');
  // Control characters (other than newlines in this template) are replaced before anything leaves this node.
  const text = L.join('\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, ' ');
  const esc = function (x) { return x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const placeholderEmail = !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(s.ownerEmail) || /@example\.(com|org|net)$/i.test(s.ownerEmail);
  const wantsEmail = s.delivery === 'email' || s.delivery === 'both';
  const wantsSlack = s.delivery === 'slack' || s.delivery === 'both';
  const out = {
    subject: oneLine(tag + 'Morning Ops Triage Digest: ' + s.businessName + ' (' + fmtDay(asOf, tz) + ')'),
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
module.exports = {
  DEFAULTS, REPORTS, JOB_COLUMNS, INVOICE_COLUMNS, ESTIMATE_COLUMNS, JOB_STATUS_MAP, INVOICE_STATUS_MAP, ESTIMATE_STATUS_MAP,
  isBlank, parseTime, localDate, dayDiff, fmtMoney, oneLine, headerKey, jobStatusKey, invoiceStatusKey, estimateStatusKey, jobInvoiceStateKey,
  prepareSettings, parseCsvTable, parseCsv, canonicalizeRows, resolveWall, toIsoInZone, toLocalDate, parseMoney,
  prepareReport, normalizeReportExport, normalizeJobsExport, normalizeInvoicesExport, normalizeEstimatesExport,
  classifyCsvTable, datasetFromCsvFiles,
  jobsQueue, invoicingQueue, estimateQueue, runTriage, renderMessage,
};
