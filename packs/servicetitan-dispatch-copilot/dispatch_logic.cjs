/**
 * ServiceTitan Dispatch & Capacity Copilot: shared logic (DRAFT v0.1.0).
 *
 * This file is the single source of truth for the Code nodes in workflow.n8n.json.
 * build_workflow.cjs copies the `@@SECTION` blocks below into the n8n Code nodes, and
 * mock_servicetitan_test.cjs runs both this module and the code extracted from the JSON.
 * Edit here, then run `node build_workflow.cjs`.
 *
 * Rules: plain JavaScript only, no require/import inside a section, no network calls,
 * no file access. Nothing here sends anything to anyone. Every number is computed from
 * the data it is given; when a metric cannot be computed the digest gets a Heads-up line.
 */

// @@SECTION common
const DEFAULTS = {
  bookingLookbackHours: 24,
  replacementAgeYears: 12,
  repeatWindowDays: 180,
  membershipOverdueDays: 30,
  estimateStaleDays: 7,
  capacityLookaheadDays: 2,
  afterHoursStartHour: 17,
  maxItemsPerSection: 10,
  historyDays: 90,
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
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return d;
}
function toBoolKnown(v) {
  if (typeof v === 'boolean') return { value: v, known: true, blank: false };
  if (isBlank(v)) return { value: null, known: false, blank: true };
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return { value: true, known: true, blank: false };
  if (['false', 'no', 'n', '0'].includes(s)) return { value: false, known: true, blank: false };
  return { value: null, known: false, blank: false };
}
// Canonical job-status vocabulary. Aliases collapse to one display value and one lowercase key.
const JOB_STATUS_CANONICAL = {
  unassigned: 'Unassigned',
  scheduled: 'Scheduled',
  pending: 'Pending',
  open: 'Open',
  dispatched: 'Dispatched',
  'in progress': 'In Progress',
  working: 'In Progress',
  'in-progress': 'In Progress',
  'on hold': 'On Hold',
  hold: 'On Hold',
  'on-hold': 'On Hold',
  completed: 'Completed',
  done: 'Completed',
  closed: 'Completed',
  canceled: 'Canceled',
  cancelled: 'Canceled',
};
const OPEN_JOB_STATUS_KEYS = ['unassigned', 'scheduled', 'pending', 'open', 'dispatched', 'in progress', 'on hold'];
const TERMINAL_JOB_STATUS_KEYS = ['completed', 'canceled'];
function normalizeJobStatus(v) {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) return { raw: '', canonical: '', key: '', known: false, blank: true };
  const lookup = lc(raw);
  if (Object.prototype.hasOwnProperty.call(JOB_STATUS_CANONICAL, lookup)) {
    const canonical = JOB_STATUS_CANONICAL[lookup];
    return { raw: raw, canonical: canonical, key: lc(canonical), known: true, blank: false };
  }
  return { raw: raw, canonical: raw, key: lookup, known: false, blank: false };
}
function parseTime(iso) {
  if (isBlank(iso)) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}
function round1(n) {
  return Math.round(n * 10) / 10;
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
function dayAdd(dateStr, n) {
  return new Date(dayMs(dateStr) + n * DAY).toISOString().slice(0, 10);
}
function cleanSpaces(s) {
  return s.replace(/[  ]/g, ' ');
}
function fmtTime(ms, tz) {
  return cleanSpaces(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms)));
}
function fmtDay(ms, tz) {
  return cleanSpaces(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms))).replace(',', '');
}
function fmtWindow(startMs, endMs, tz) {
  return fmtDay(startMs, tz) + ' ' + fmtTime(startMs, tz) + '-' + fmtTime(endMs, tz);
}
function fix1(n) {
  return Number(n).toFixed(1);
}
function fmtMoney(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}
function normAddr(a) {
  return isBlank(a) ? '' : String(a).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normPhone(p) {
  return isBlank(p) ? '' : String(p).replace(/\D/g, '');
}
function lc(v) {
  return isBlank(v) ? '' : String(v).trim().toLowerCase();
}
function plural(n, one, many) {
  return n === 1 ? one : (many || one + 's');
}

function splitIds(v) {
  if (isBlank(v)) return [];
  if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
  return String(v).split(/[,|;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function uniqueIds(list) {
  const out = [];
  const seen = new Set();
  (list || []).forEach(function (id) {
    const s = String(id || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  });
  return out;
}

function assignedTechIds(job) {
  return uniqueIds((job.techIds || []).concat(job.techId || []));
}

// @@SECTION settings
function prepareSettings(cfg, nowMs) {
  const notes = [];
  let source = lc(cfg.source);
  if (['test', 'csv', 'servicetitan'].indexOf(source) === -1) {
    notes.push('Config source "' + (cfg.source === undefined ? '' : cfg.source) + '" is not test, csv, or servicetitan. Using test instead.');
    source = 'test';
  }
  let testMode = toBool(cfg.testMode, true);
  if (source === 'test' && !testMode) {
    testMode = true;
    notes.push('source "test" uses built-in fictional data, so testMode was forced on.');
  }
  const tz = isBlank(cfg.timezone) ? 'America/Chicago' : String(cfg.timezone);
  const override = parseTime(cfg.asOfOverride);
  const asOfMs = override !== null ? override : nowMs;
  const delivery = ['email', 'slack', 'both', 'none'].indexOf(lc(cfg.delivery)) === -1 ? 'email' : lc(cfg.delivery);
  const s = {
    businessName: isBlank(cfg.businessName) ? 'Your Business Name' : String(cfg.businessName),
    timezone: tz,
    source: source,
    testMode: testMode,
    delivery: delivery,
    ownerEmail: isBlank(cfg.ownerEmail) ? '' : String(cfg.ownerEmail).trim(),
    ownerSlackChannel: isBlank(cfg.ownerSlackChannel) ? '' : String(cfg.ownerSlackChannel).trim(),
    stApiBase: isBlank(cfg.stApiBase) ? 'https://api.servicetitan.io' : String(cfg.stApiBase).replace(/\/+$/, ''),
    stTenantId: isBlank(cfg.stTenantId) ? '' : String(cfg.stTenantId).trim(),
    stAppKey: isBlank(cfg.stAppKey) ? '' : String(cfg.stAppKey).trim(),
    csvFolder: isBlank(cfg.csvFolder) ? '' : String(cfg.csvFolder).trim(),
    asOf: new Date(asOfMs).toISOString(),
    headsUp: notes,
  };
  Object.keys(DEFAULTS).forEach(function (k) {
    s[k] = toNum(cfg[k], DEFAULTS[k]);
  });
  s.historyStart = new Date(asOfMs - s.historyDays * DAY).toISOString();
  s.lookaheadEnd = new Date(asOfMs + s.capacityLookaheadDays * DAY).toISOString();
  s.callsSince = new Date(asOfMs - 36 * HOUR).toISOString();
  return s;
}

// @@SECTION csv
// CSV parsing, header-alias mapping, and the Jobs/Dispatch export normalizer.
// Real ServiceTitan report exports use human headers ("Job #", "Scheduled Start", "Required Skill").
// Everything below renames those onto the snake_case column names the fixtures use, then onto the
// internal job schema. Matching ignores case, punctuation, and spaces/underscores/hyphens.
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

const JOB_WINDOW_PAIRS = {
  scheduled_start: [['Scheduled Start Date', 'Scheduled Start Time'], ['Appointment Start Date', 'Appointment Start Time'],
    ['Start Date', 'Start Time'], ['Scheduled Date', 'Scheduled Time'], ['Appointment Date', 'Appointment Time']],
  scheduled_end: [['Scheduled End Date', 'Scheduled End Time'], ['Appointment End Date', 'Appointment End Time'],
    ['End Date', 'End Time']],
};

// key = the snake_case column the fixtures use. Priority aliases can precede it.
const JOB_COLUMNS = [
  { key: 'job_id', label: 'Job # (or Job Number / Job ID)', required: true, priority: ['Job #'], aliases: ['Job No', 'Job Num', 'Job'] },
  { key: 'status', label: 'Status (or Job Status)', required: true, priority: ['Job Status'], aliases: ['Appointment Status'] },
  { key: 'scheduled_start', label: 'Scheduled Start (or Start / Appointment Start)', required: true,
    aliases: ['Appointment Start', 'Start', 'Job Start'].concat(JOB_WINDOW_PAIRS.scheduled_start.flat()) },
  { key: 'scheduled_end', label: 'Scheduled End',
    aliases: ['Appointment End', 'End', 'Job End'].concat(JOB_WINDOW_PAIRS.scheduled_end.flat()) },
  { key: 'booked_at', label: 'Created On', aliases: ['Created On', 'Created Date', 'Booked On', 'Date Created', 'Booked At', 'Created', 'Booking Date', 'Job Created Date'] },
  { key: 'unassigned_since', label: 'Unassigned Since', aliases: ['Unassigned Since', 'Unassigned On', 'Unassigned Date', 'Unassigned At'] },
  { key: 'business_unit', label: 'Business Unit', aliases: ['Business Unit', 'Business Unit Name', 'BU'] },
  { key: 'job_type', label: 'Job Type', aliases: ['Job Type', 'Type', 'Type of Job', 'Job Type Name'] },
  { key: 'skill', label: 'Required Skill', aliases: ['Required Skill', 'Required Skills', 'Skill', 'Skills', 'Tag', 'Tags', 'Required Tag', 'Required Tags', 'Job Tag', 'Job Tags'] },
  { key: 'zone', label: 'Zone', aliases: ['Zone', 'Dispatch Zone', 'Zone Name', 'Service Zone'] },
  { key: 'tech_id', label: 'Technician ID', aliases: ['Technician ID', 'Technician Id', 'Tech ID', 'Assigned Technician ID'] },
  { key: 'tech_ids', label: 'Technician IDs', aliases: ['Technician IDs', 'Tech IDs', 'Assigned Technician IDs'] },
  { key: 'tech_name', label: 'Technician', aliases: ['Technician', 'Technicians', 'Tech', 'Assigned Technician', 'Assigned Technicians', 'Technician Name', 'Technician Names', 'Tech Name', 'Assigned Tech'] },
  { key: 'customer_name', label: 'Customer', aliases: ['Customer', 'Customer Name', 'Client'] },
  { key: 'customer_phone', label: 'Customer Phone', aliases: ['Customer Phone', 'Customer Phone Number', 'Phone', 'Phone Number', 'Contact Phone'] },
  { key: 'customer_type', label: 'Customer Type', aliases: ['Customer Type'] },
  { key: 'equipment_type', label: 'Equipment Type', aliases: ['Equipment Type', 'Equipment'] },
  { key: 'equipment_age_years', label: 'Equipment Age', aliases: ['Equipment Age', 'Equipment Age Years', 'Equipment Age (Years)'] },
  { key: 'address', label: 'Address', aliases: ['Address', 'Location', 'Service Location', 'Service Address', 'Job Address', 'Location Address'] },
  { key: 'priority', label: 'Priority', aliases: ['Priority', 'Job Priority'] },
  { key: 'summary', label: 'Summary', aliases: ['Summary', 'Job Summary', 'Description', 'Job Description'] },
  { key: 'multi_day', label: 'Multi-Day', aliases: ['Multi-Day', 'Multi Day', 'Multiday'] },
  { key: 'arrived_at', label: 'Arrived At', aliases: ['Arrived At', 'Arrived On', 'Arrival Time', 'Actual Arrival', 'On Site Time'] },
  { key: 'actual_minutes', label: 'Actual Minutes', aliases: ['Actual Minutes', 'Minutes On Site', 'On Site Minutes', 'Time On Site Minutes'] },
];
const JOB_DATE_KEYS = ['booked_at', 'unassigned_since', 'scheduled_start', 'scheduled_end', 'arrived_at'];

// Optional sibling exports (same alias rules). Only used when a shop also drops these files.
const TABLE_COLUMNS = {
  jobs: JOB_COLUMNS,
  aging_jobs: JOB_COLUMNS,
  technicians: [
    { key: 'tech_id', label: 'Technician ID', aliases: ['Technician ID', 'Tech ID', 'ID', 'Employee ID'] },
    { key: 'name', label: 'Technician Name', aliases: ['Name', 'Technician', 'Technician Name', 'Tech', 'Tech Name', 'Employee'] },
    { key: 'trade', aliases: ['Trade', 'Business Unit', 'Department'] },
    { key: 'sales_capable', aliases: ['Sales Capable', 'Can Sell', 'Sales'] },
    { key: 'shift_hours', aliases: ['Shift Hours', 'Shift Length', 'Hours'] },
  ],
  capacity: [
    { key: 'window_id', aliases: ['Window ID', 'Slot ID', 'ID'] },
    { key: 'business_unit', aliases: ['Business Unit', 'Business Unit Name', 'BU'] },
    { key: 'window_start', label: 'Window Start', required: true, aliases: ['Window Start', 'Slot Start', 'Start'] },
    { key: 'window_end', label: 'Window End', required: true, aliases: ['Window End', 'Slot End', 'End'] },
    { key: 'open_slots', label: 'Open Slots', required: true, aliases: ['Open Slots', 'Open Capacity', 'Available Slots', 'Slots Open'] },
  ],
  memberships: [
    { key: 'membership_id', label: 'Membership ID', required: true, aliases: ['Membership ID', 'Membership #', 'Membership Number', 'ID'] },
    { key: 'customer_name', aliases: ['Customer', 'Customer Name'] },
    { key: 'customer_phone', aliases: ['Customer Phone', 'Phone', 'Phone Number'] },
    { key: 'business_unit', aliases: ['Business Unit', 'Business Unit Name', 'BU'] },
    { key: 'plan', aliases: ['Plan', 'Membership Plan', 'Membership Type'] },
    { key: 'status', label: 'Membership Status', required: true, aliases: ['Membership Status', 'Status'] },
    { key: 'next_service_due', label: 'Next Service Due', required: true, aliases: ['Next Service Due', 'Next Service Date', 'Next Due', 'Next Visit Due'] },
  ],
  estimates: [
    { key: 'estimate_id', label: 'Estimate ID', required: true, aliases: ['Estimate ID', 'Estimate #', 'Estimate Number', 'ID'] },
    { key: 'customer_name', aliases: ['Customer', 'Customer Name'] },
    { key: 'customer_phone', aliases: ['Customer Phone', 'Phone', 'Phone Number'] },
    { key: 'business_unit', aliases: ['Business Unit', 'Business Unit Name', 'BU'] },
    { key: 'status', label: 'Estimate Status', required: true, aliases: ['Estimate Status', 'Status'] },
    { key: 'amount', aliases: ['Amount', 'Total', 'Estimate Total', 'Subtotal'] },
    { key: 'created_at', aliases: ['Created At', 'Created On', 'Created Date'] },
    { key: 'last_followup_at', aliases: ['Last Followup At', 'Last Follow Up', 'Last Follow-Up', 'Last Followup', 'Last Follow Up On'] },
  ],
  calls: [
    { key: 'call_id', aliases: ['Call ID', 'Call #', 'Call Number', 'ID'] },
    { key: 'received_at', label: 'Received At', required: true, aliases: ['Received At', 'Received On', 'Call Time', 'Call Date', 'Date'] },
    { key: 'caller_name', aliases: ['Caller Name', 'Caller', 'Customer Name'] },
    { key: 'caller_phone', aliases: ['Caller Phone', 'Phone', 'Phone Number', 'From'] },
    { key: 'address', aliases: ['Address', 'Location'] },
    { key: 'summary', aliases: ['Summary', 'Call Summary'] },
    { key: 'urgency', aliases: ['Urgency'] },
    { key: 'status', aliases: ['Status', 'Call Status'] },
    { key: 'handled_by', aliases: ['Handled By', 'Answered By', 'Agent'] },
    { key: 'follow_up_needed', aliases: ['Follow Up Needed', 'Follow-Up Needed', 'Needs Follow Up'] },
    { key: 'notes', aliases: ['Notes'] },
  ],
};
const TABLE_DATE_KEYS = {
  capacity: ['window_start', 'window_end'],
  estimates: ['created_at', 'last_followup_at'],
  calls: ['received_at'],
};
const TABLE_CALENDAR_KEYS = {
  memberships: ['next_service_due'],
};

function columnNames(col) {
  return (col.priority || []).concat(col.key, col.aliases || []);
}

function matchingHeaders(headers, names) {
  return Array.from(new Set(names.flatMap(function (name) {
    return headers.filter(function (h) { return headerKey(h) === headerKey(name); });
  })));
}

// Rename a table's columns onto the canonical snake_case names. Every canonical key is present on
// every output row ('' when the column was not in the export), so downstream code never sees undefined.
function canonicalizeRows(rows, columns, headersIn) {
  const list = Array.isArray(rows) ? rows : [];
  const headers = headersIn && headersIn.length ? headersIn : (list.length ? Object.keys(list[0]) : []);
  const byKey = {};
  headers.forEach(function (h) {
    const k = headerKey(h);
    if (k && !Object.prototype.hasOwnProperty.call(byKey, k)) byKey[k] = h;
  });
  const used = Object.create(null);
  const mapped = {};
  columns.forEach(function (col) {
    const names = columnNames(col);
    for (let i = 0; i < names.length; i++) {
      const h = Object.prototype.hasOwnProperty.call(byKey, headerKey(names[i])) ? byKey[headerKey(names[i])] : undefined;
      if (h !== undefined && !used[h]) { used[h] = true; mapped[col.key] = h; break; }
    }
  });
  const out = list.map(function (r) {
    const o = {};
    columns.forEach(function (col) {
      const v = mapped[col.key] === undefined ? '' : r[mapped[col.key]];
      o[col.key] = v === undefined || v === null ? '' : String(v).trim();
    });
    return o;
  });
  return {
    rows: out,
    mapped: mapped,
    headers: headers,
    missing: columns.filter(function (c) { return c.required && mapped[c.key] === undefined; }).map(function (c) { return c.label; }),
    unmapped: headers.filter(function (h) { return !used[h]; }),
  };
}

function wallClockMs(parts, h, mi) {
  const clock = new Date(0);
  clock.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  clock.setUTCHours(h, mi, 0, 0);
  return clock.getTime();
}

function validCalendarDate(y, mo, d) {
  const probe = new Date(wallClockMs([y, mo, d], 0, 0));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function localWallMs(ms, tz) {
  const p = localParts(ms, tz);
  return wallClockMs(p.date.split('-').map(Number), p.hour, p.minute);
}

function wallTimeMatches(y, mo, d, h, mi, tz) {
  const target = wallClockMs([y, mo, d], h, mi);
  // Sample offsets on both sides of a transition, then round-trip each candidate.
  const candidates = new Set([-DAY, 0, DAY].map(function (delta) {
    const sample = target + delta;
    return target + (sample - localWallMs(sample, tz));
  }));
  return Array.from(candidates).filter(function (ms) { return localWallMs(ms, tz) === target; })
    .sort(function (a, b) { return a - b; });
}

// ISO values that already carry an offset or Z are kept as-is. Everything else ("3/10/2026 9:50 AM",
// "2026-03-10 09:50") is read as shop-local wall time in `tz`. Unparseable values return bad: true.
function toIsoInZone(v, tz) {
  if (isBlank(v)) return { iso: '', bad: false };
  const raw = String(v).trim();
  const offset = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i);
  if (offset) {
    const valid = validCalendarDate(+offset[1], +offset[2], +offset[3]) &&
      +offset[4] <= 23 && +offset[5] <= 59 && +(offset[6] || 0) <= 59 && parseTime(raw) !== null;
    return { iso: valid ? raw : '', bad: !valid };
  }
  let y; let mo; let d; let h = 0; let mi = 0; let sec = 0; let ap = '';
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?)?$/);
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3];
    h = m[4] ? +m[4] : 0; mi = m[5] ? +m[5] : 0; sec = m[6] ? +m[6] : 0; ap = m[7] ? m[7].toLowerCase() : '';
  } else {
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
    if (!m) return { iso: '', bad: true };
    mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000;
    h = m[4] ? +m[4] : 0; mi = m[5] ? +m[5] : 0; sec = m[6] ? +m[6] : 0; ap = m[7] ? m[7].toLowerCase() : '';
  }
  if (ap) {
    if (h < 1 || h > 12) return { iso: '', bad: true };
    h = (h % 12) + (ap === 'pm' ? 12 : 0);
  }
  if (!validCalendarDate(y, mo, d) || h > 23 || mi > 59 || sec > 59) return { iso: '', bad: true };
  const matches = wallTimeMatches(y, mo, d, h, mi, tz || 'America/Chicago');
  if (!matches.length) return { iso: '', bad: true, gap: true };
  const result = { iso: new Date(matches[0] + sec * 1000).toISOString(), bad: false };
  // For fall-back folds, use the first occurrence unless the export provides an explicit offset.
  if (matches.length > 1) result.ambiguous = true;
  return result;
}

// Calendar dates (membership due dates, date-only cells) stay YYYY-MM-DD. US dates like 3/10/2026
// are accepted. Timestamps are reduced to the shop-local calendar date. Invalid dates are blanked.
function parseCalendarDate(v, tz) {
  if (isBlank(v)) return { date: '', bad: false };
  const raw = String(v).trim();
  let y; let mo; let d; let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  }
  if (m) {
    if (!validCalendarDate(y, mo, d)) return { date: '', bad: true };
    return { date: y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'), bad: false };
  }
  const t = toIsoInZone(raw, tz || 'America/Chicago');
  if (t.bad || !t.iso) return { date: '', bad: true, gap: t.gap };
  const ms = parseTime(t.iso);
  if (ms === null) return { date: '', bad: true };
  const result = { date: localDate(ms, tz || 'America/Chicago'), bad: false };
  if (t.ambiguous) result.ambiguous = true;
  return result;
}

const CALENDAR_DATE = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})/;
const TIME_ONLY = /^\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?$/i;

function jobWindowValue(row, headers, pairs) {
  const values = headers.map(function (h) { return String(row[h] || '').trim(); }).filter(Boolean);
  const full = values.find(function (v) {
    const date = v.match(CALENDAR_DATE);
    return date && /^[T ,]+\d{1,2}:\d{2}/.test(v.slice(date[0].length));
  });
  if (full) return full;
  let malformedPair = '';
  for (const pair of pairs) {
    const date = String(row[pair[0]] || '').trim();
    const time = String(row[pair[1]] || '').trim();
    const matchedDate = date.match(CALENDAR_DATE);
    if (!matchedDate || matchedDate[0] !== date || !time) continue;
    const combined = date + ' ' + time;
    if (TIME_ONLY.test(time)) return combined;
    if (!malformedPair) malformedPair = combined;
  }
  // A standalone date is supported. A standalone time is passed through for a diagnostic.
  return malformedPair || values.find(function (v) { return !TIME_ONLY.test(v); }) || values[0] || '';
}

function localTimeNotice(t, location, tz) {
  if (t.gap) return location + ' is a nonexistent local time in ' + tz + ' and was left blank.';
  if (t.ambiguous) return location + ' is an ambiguous local time in ' + tz + '. The earlier occurrence was used. Include an explicit offset to select an occurrence.';
  return '';
}

function mapAgingJob(r) {
  const techIds = uniqueIds(splitIds(r.tech_ids).concat(splitIds(r.tech_id || r.techId)));
  return {
    id: String(r.job_id || r.id || ''),
    bookedAt: r.booked_at || r.bookedAt || '',
    unassignedSince: r.unassigned_since || r.unassignedSince || '',
    start: r.scheduled_start || r.start || '',
    end: r.scheduled_end || r.end || '',
    status: r.status || '',
    techId: techIds[0] || '',
    techIds: techIds,
    skill: r.skill || '',
    zone: r.zone || '',
    customerName: r.customer_name || r.customerName || '',
    customerPhone: r.customer_phone || r.customerPhone || '',
    customerType: r.customer_type || r.customerType || '',
    jobType: r.job_type || r.jobType || '',
    equipmentType: r.equipment_type || r.equipmentType || '',
    equipmentAgeYears: toNum(r.equipment_age_years || r.equipmentAgeYears, null),
    address: r.address || '',
    priority: r.priority || '',
    businessUnit: r.business_unit || r.businessUnit || '',
    summary: r.summary || '',
    multiDay: toBool(r.multi_day || r.multiDay, false),
  };
}

// The single internal job schema: aging fields plus the two fields the morning digest reads.
function mapCsvJob(r) {
  return Object.assign(mapAgingJob(r), { arrivedAt: r.arrived_at || '', actualMinutes: toNum(r.actual_minutes, null) });
}

const NO_TECH_WORDS = /^(unassigned|none|n\/a|na|null|-|—|–)$/i;
function techList(v) {
  return splitIds(v).filter(function (x) { return !NO_TECH_WORDS.test(x); });
}

// Index the entire snapshot before resolving name-only rows so row order cannot change the match.
function resolveTechnicians(rows, headsUp) {
  const idsByName = new Map();
  const namesById = new Map();
  const nameOnly = new Map();
  const assignments = rows.map(function (r) {
    const ids = uniqueIds(techList(r.tech_id).concat(techList(r.tech_ids)));
    const names = techList(r.tech_name);
    if (!ids.length) {
      names.forEach(function (name) {
        const key = lc(name);
        if (!nameOnly.has(key) || name < nameOnly.get(key)) nameOnly.set(key, name);
      });
    } else if (names.length && names.length !== ids.length) {
      headsUp.push('Job ' + r.job_id + ' has different counts of technician names and IDs. Only the IDs were used for this row.');
    } else {
      names.forEach(function (name, i) {
        const key = lc(name);
        const id = ids[i];
        if (!idsByName.has(key)) idsByName.set(key, new Set());
        idsByName.get(key).add(id);
        if (!namesById.has(id)) namesById.set(id, new Map());
        const knownNames = namesById.get(id);
        if (!knownNames.has(key) || name < knownNames.get(key)) knownNames.set(key, name);
      });
    }
    return { ids: ids, names: names };
  });
  namesById.forEach(function (names, id) {
    if (names.size > 1) headsUp.push('Technician ID "' + id + '" has conflicting names: ' + Array.from(names.values()).join(', ') + '.');
  });
  idsByName.forEach(function (ids, key) {
    if (ids.size > 1) {
      headsUp.push('Technician name "' + key + '" matches multiple IDs (' + Array.from(ids).join(', ') + '). Name-only assignments could not be matched to an ID.');
    }
  });
  const techNames = new Map();
  const explicitIds = new Set(assignments.flatMap(function (a) { return a.ids; }));
  const nameIds = new Map();
  const unmatchedNames = new Set();
  nameOnly.forEach(function (name, key) {
    const matches = idsByName.get(key);
    const match = matches && matches.size === 1 ? matches.values().next().value : '';
    if (match && namesById.get(match).size === 1) {
      nameIds.set(key, match);
      return;
    }
    let id = name;
    if (explicitIds.has(id)) {
      headsUp.push('Name-only technician "' + name + '" also appears as an explicit ID. The assignments were kept separate.');
      do { id = 'Name: ' + id; } while (explicitIds.has(id) || techNames.has(id) || nameOnly.has(lc(id)));
    }
    nameIds.set(key, id);
    unmatchedNames.add(id);
    techNames.set(id, name);
  });
  assignments.forEach(function (a, i) {
    const ids = a.ids.length ? a.ids : uniqueIds(a.names.map(function (name) { return nameIds.get(lc(name)); }));
    ids.forEach(function (id) {
      const names = namesById.get(id);
      if (!techNames.has(id)) techNames.set(id, names && names.size === 1 ? names.values().next().value : id);
    });
    rows[i].tech_ids = ids.join(',');
    rows[i].tech_id = ids[0] || '';
    delete rows[i].tech_name;
  });
  const byJob = new Map();
  rows.forEach(function (r) {
    if (!byJob.has(r.job_id)) byJob.set(r.job_id, new Set());
    splitIds(r.tech_ids).forEach(function (id) { byJob.get(r.job_id).add(id); });
  });
  byJob.forEach(function (ids, jobId) {
    const assigned = Array.from(ids);
    if (assigned.some(function (id) { return unmatchedNames.has(id); }) &&
        assigned.some(function (id) { return explicitIds.has(id) && (!namesById.has(id) || namesById.get(id).size > 1); })) {
      headsUp.push('Job ' + jobId + ' has name-only assignments and IDs without a reliable name. The assignments could not be matched and were kept separate.');
    }
  });
  return Array.from(techNames, function (entry) { return { tech_id: entry[0], name: entry[1], trade: '' }; });
}

// Minimum for a Jobs/Dispatch export: job id, status, scheduled start. Everything else is optional and
// a blank skill / zone / technician is reported by the aging watch rather than guessed.
function prepareJobRows(rowsIn, opts) {
  const o = opts || {};
  const tz = o.timezone || 'America/Chicago';
  const label = o.label || 'Jobs export';
  const rows = Array.isArray(rowsIn) ? rowsIn : [];
  const c = canonicalizeRows(rows, JOB_COLUMNS, o.headers);
  const res = {
    ok: false, rows: [], technicians: [], headsUp: [], errors: [], missingRequired: c.missing,
    headersSeen: c.headers, mapped: c.mapped, rowCount: rows.length, importedCount: 0, skipped: [],
  };
  const seen = c.headers.length ? ' Columns found: ' + c.headers.slice(0, 25).join(', ') + (c.headers.length > 25 ? ', ...' : '') + '.' : '';
  if (c.headers.length === 0) {
    res.errors.push(label + ' is empty. Export a ServiceTitan Jobs/Dispatch report with a header row and at least one job, then try again.');
    return res;
  }
  const duplicates = c.headers.filter(function (h, i) { return h && c.headers.indexOf(h) !== i; });
  if (duplicates.length) {
    res.errors.push(label + ' has duplicate CSV headers: ' + uniqueIds(duplicates).join(', ') + '. Rename or remove duplicate columns and re-export.');
    return res;
  }
  if (c.missing.length) {
    res.errors.push(label + ' is missing required column(s): ' + c.missing.join('; ') + '.' + seen + ' Add the missing column(s) to your ServiceTitan Jobs/Dispatch report and export again.');
    return res;
  }
  if (rows.length === 0) {
    res.errors.push(label + ' has a header row but no job rows. Export a report that includes at least one job.');
    return res;
  }
  const byId = new Map();
  const validated = [];
  const identityKeys = ['job_id', 'status', 'tech_id', 'tech_ids', 'tech_name'];
  const identityColumns = JOB_COLUMNS.filter(function (col) { return identityKeys.includes(col.key); })
    .map(function (col) { return { key: col.key, headers: matchingHeaders(c.headers, columnNames(col)) }; });
  const windows = Object.keys(JOB_WINDOW_PAIRS).map(function (key) {
    const col = JOB_COLUMNS.find(function (column) { return column.key === key; });
    return {
      key: key,
      headers: matchingHeaders(c.headers, columnNames(col)),
      pairs: JOB_WINDOW_PAIRS[key].flatMap(function (pair) {
        const dates = matchingHeaders(c.headers, [pair[0]]);
        const times = matchingHeaders(c.headers, [pair[1]]);
        return dates.flatMap(function (date) { return times.map(function (time) { return [date, time]; }); });
      }),
    };
  });
  const badDates = [];
  let merged = 0;
  const earlier = function (a, b) { const x = parseTime(a); const y = parseTime(b); return x !== null && (y === null || x < y) ? a : b; };
  const later = function (a, b) { const x = parseTime(a); const y = parseTime(b); return x !== null && (y === null || x > y) ? a : b; };
  c.rows.forEach(function (r, idx) {
    const line = idx + 2; // row number counting the header as row 1; blank lines are not counted
    const raw = rows[idx];
    identityColumns.forEach(function (col) {
      const supplied = col.headers.filter(function (h) { return !isBlank(raw[h]); });
      if (!supplied.length) return;
      const value = String(raw[supplied[0]]).trim();
      r[col.key] = value;
      const compare = ['status', 'tech_name'].includes(col.key) ? lc : String;
      if (supplied.some(function (h) { return compare(String(raw[h]).trim()) !== compare(value); })) {
        res.headsUp.push('Row ' + line + ' in the ' + label + ' has conflicting ' + col.key + ' headers (' + supplied.join(', ') + '). Used "' + supplied[0] + '" = "' + value + '".');
      }
    });
    windows.forEach(function (w) { r[w.key] = jobWindowValue(raw, w.headers, w.pairs); });
    if (isBlank(r.job_id)) { res.skipped.push({ row: line, reason: 'missing job id' }); return; }
    if (/^(?:grand total|subtotal|totals?)$/i.test(r.job_id) && isBlank(r.status) && isBlank(r.scheduled_start)) {
      res.skipped.push({ row: line, reason: 'totals row' });
      return;
    }
    const rawStart = r.scheduled_start;
    JOB_DATE_KEYS.forEach(function (k) {
      const t = toIsoInZone(r[k], tz);
      const location = 'Row ' + line + ' in the ' + label + ', job ' + r.job_id + ' ' + k + ' "' + r[k] + '"';
      const notice = localTimeNotice(t, location, tz);
      if (notice) res.headsUp.push(notice);
      else if (t.bad) badDates.push('row ' + line + ', job ' + r.job_id + ' ' + k + ' "' + r[k] + '"');
      r[k] = t.iso;
    });
    const stn = normalizeJobStatus(r.status);
    if (stn.blank) {
      res.headsUp.push('Row ' + line + ' in the ' + label + ', job ' + r.job_id + ' has no status. Status-dependent metrics have partial coverage.');
    } else if (!stn.known) {
      res.headsUp.push('Row ' + line + ' in the ' + label + ', job ' + r.job_id + ' has unrecognized status "' + stn.raw + '". It was left out of aging and completed KPIs until a known status is provided.');
    } else {
      r.status = stn.canonical;
    }
    if (isBlank(r.scheduled_start)) {
      if (isBlank(rawStart)) {
        res.headsUp.push('Row ' + line + ' in the ' + label + ', job ' + r.job_id + ' has no scheduled start. The job was kept as unscheduled (partial coverage).');
      } else {
        res.headsUp.push('Row ' + line + ' in the ' + label + ', job ' + r.job_id + ' has an unreadable scheduled start "' + rawStart + '". The job was kept as unscheduled (partial coverage).');
      }
    }
    validated.push(r);
  });
  res.technicians = resolveTechnicians(validated, res.headsUp);
  validated.forEach(function (r) {
    const techs = uniqueIds(splitIds(r.tech_ids).concat(splitIds(r.tech_id)));
    const status = normalizeJobStatus(r.status);
    const unassigned = status.key === 'unassigned' || (OPEN_JOB_STATUS_KEYS.includes(status.key) && techs.length === 0);
    if (unassigned && isBlank(r.unassigned_since) && isBlank(r.booked_at)) {
      res.headsUp.push('Job ' + r.job_id + ' is unassigned but has no usable Unassigned Since or Created On timestamp, so its age could not be computed.');
    }
  });
  validated.forEach(function (r) {
    const prev = byId.get(r.job_id);
    if (!prev) { byId.set(r.job_id, r); return; }
    if (r.status && prev.status && lc(r.status) !== lc(prev.status)) {
      res.headsUp.push('Job ' + r.job_id + ' has conflicting statuses on repeated rows. Used the first status "' + prev.status + '" over "' + r.status + '".');
    }
    merged++;
    const all = uniqueIds(splitIds(prev.tech_ids).concat(splitIds(r.tech_ids)));
    prev.tech_ids = all.join(',');
    prev.tech_id = all[0] || '';
    prev.scheduled_start = earlier(prev.scheduled_start, r.scheduled_start) || '';
    prev.scheduled_end = later(prev.scheduled_end, r.scheduled_end) || '';
    if (toBool(r.multi_day, false)) prev.multi_day = r.multi_day;
    Object.keys(r).forEach(function (k) { if (isBlank(prev[k]) && !isBlank(r[k])) prev[k] = r[k]; });
  });
  res.rows = Array.from(byId.values());
  res.importedCount = res.rows.length;
  if (res.skipped.length) {
    res.headsUp.push(res.skipped.length + ' ' + plural(res.skipped.length, 'row') + ' in the ' + label + ' ' + plural(res.skipped.length, 'was', 'were') + ' skipped. First: row ' + res.skipped[0].row + ' (' + res.skipped[0].reason + ').');
  }
  if (badDates.length) {
    res.headsUp.push(badDates.length + ' date ' + plural(badDates.length, 'value') + ' in the ' + label + ' could not be read and ' + plural(badDates.length, 'was', 'were') + ' left blank (' + badDates.slice(0, 3).join('; ') + (badDates.length > 3 ? '; ...' : '') + '). Use dates like 3/10/2026 9:50 AM or 2026-03-10 09:50.');
  }
  if (merged > 0) {
    res.headsUp.push(merged + ' repeated job ' + plural(merged, 'row') + ' ' + plural(merged, 'was', 'were') + ' merged into the job with the same number (one row per technician or appointment). Technicians were combined and the earliest start and latest end were kept.');
  }
  if (res.rows.length === 0) res.errors.push('No usable job rows were found in the ' + label + '.' + seen);
  res.ok = res.errors.length === 0;
  return res;
}

// Public entry point. input = CSV text or parseCsv rows. Never throws unless opts.strict is true;
// check result.ok / result.message. result.jobs uses the internal job schema.
function normalizeJobsExport(input, opts) {
  const o = opts || {};
  let rows;
  let headers = o.headers;
  const parseWarnings = Array.isArray(o.parseWarnings) ? o.parseWarnings.slice() : [];
  if (typeof input === 'string') {
    const t = parseCsvTable(input);
    rows = t.rows;
    headers = t.headers;
    (t.warnings || []).forEach(function (w) { parseWarnings.push(w); });
  } else {
    rows = Array.isArray(input) ? input : [];
  }
  const res = prepareJobRows(rows, Object.assign({}, o, { headers: headers }));
  parseWarnings.forEach(function (w) {
    res.errors.push(w);
    res.headsUp.push(w);
  });
  if (res.errors.length) res.ok = false;
  const nameById = Object.create(null);
  res.technicians.forEach(function (t) { nameById[t.tech_id] = t.name; });
  res.jobs = res.rows.map(function (r) {
    const job = mapCsvJob(r);
    job.assignedTechNames = job.techIds.map(function (id) { return nameById[id] || id; });
    return job;
  });
  res.message = res.errors.join(' ');
  if (o.strict && !res.ok) throw new Error(res.message);
  return res;
}

function siblingSchemaGaps(kind, canonical) {
  const columns = TABLE_COLUMNS[kind] || [];
  const missing = columns.filter(function (col) { return col.required && canonical.mapped[col.key] === undefined; });
  if (kind === 'technicians' && canonical.mapped.tech_id === undefined && canonical.mapped.name === undefined) {
    missing.push({ key: 'tech_id', label: 'Technician ID or Name' });
  }
  return missing;
}

function siblingSchemaMessage(kind, missing) {
  return kind + '.csv is missing required column(s): ' + missing.map(function (col) { return col.label || col.key; }).join('; ') + '. Rows in this file were not used for metrics.';
}

// Canonicalize every table that was supplied. Jobs tables go through prepareJobRows (required-column
// check, date normalization, duplicate merge). Idempotent for the snake_case fixture files.
function prepareCsvTables(settings, tables) {
  const tz = (settings && settings.timezone) || 'America/Chicago';
  const out = {};
  const headsUp = [];
  let technicians = [];
  Object.keys(tables || {}).forEach(function (name) {
    const rows = tables[name];
    if (!Array.isArray(rows)) return;
    if (name === 'jobs' || name === 'aging_jobs') {
      const r = prepareJobRows(rows, { timezone: tz, label: name + '.csv' });
      r.errors.concat(r.headsUp).forEach(function (m) { headsUp.push('CSV import: ' + m); });
      out[name] = r.rows;
      if (!technicians.length) technicians = r.technicians;
    } else if (TABLE_COLUMNS[name]) {
      const columns = TABLE_COLUMNS[name];
      const c = canonicalizeRows(rows, columns);
      const missingRequired = siblingSchemaGaps(name, c);
      if (missingRequired.length) {
        headsUp.push('CSV import: ' + siblingSchemaMessage(name, missingRequired));
        out[name] = [];
        return;
      }
      const kept = [];
      c.rows.forEach(function (r, idx) {
        const line = idx + 2;
        let skip = false;
        (TABLE_DATE_KEYS[name] || []).forEach(function (k) {
          const raw = r[k];
          if (isBlank(raw)) return;
          const t = toIsoInZone(raw, tz);
          const location = 'Row ' + line + ' in ' + name + '.csv, ' + k + ' "' + raw + '"';
          const notice = localTimeNotice(t, location, tz);
          if (notice) headsUp.push('CSV import: ' + notice);
          else if (t.bad) headsUp.push('CSV import: ' + location + ' could not be read and was left blank.');
          r[k] = t.iso;
        });
        (TABLE_CALENDAR_KEYS[name] || []).forEach(function (k) {
          const raw = r[k];
          if (isBlank(raw)) return;
          const d = parseCalendarDate(raw, tz);
          if (d.ambiguous) headsUp.push('CSV import: Row ' + line + ' in ' + name + '.csv, ' + k + ' "' + raw + '" is an ambiguous local time in ' + tz + '. The earlier occurrence was used.');
          if (d.bad) {
            headsUp.push('CSV import: Row ' + line + ' in ' + name + '.csv, ' + k + ' "' + raw + '" is not a usable calendar date and this row was skipped.');
            r[k] = '';
            skip = true;
          } else r[k] = d.date;
        });
        if (name === 'capacity') {
          const slots = toNum(r.open_slots, null);
          if (!Number.isInteger(slots) || slots < 0 || parseTime(r.window_start) === null || parseTime(r.window_end) === null || parseTime(r.window_end) <= parseTime(r.window_start)) {
            headsUp.push('CSV import: Row ' + line + ' in capacity.csv is missing a usable window start, end, or open-slot count and was skipped. Missing slot counts are not treated as zero.');
            skip = true;
          } else r.open_slots = String(slots);
        }
        if (name === 'memberships' && (isBlank(r.membership_id) || isBlank(r.next_service_due) || isBlank(r.status))) {
          headsUp.push('CSV import: Row ' + line + ' in memberships.csv is missing a membership id or a usable next service due date or status and was skipped.');
          skip = true;
        }
        if (name === 'estimates' && (isBlank(r.estimate_id) || isBlank(r.status))) {
          headsUp.push('CSV import: Row ' + line + ' in estimates.csv is missing an estimate id or status and was skipped.');
          skip = true;
        }
        if (name === 'calls' && isBlank(r.received_at)) {
          headsUp.push('CSV import: Row ' + line + ' in calls.csv has no usable received time and was skipped.');
          skip = true;
        }
        if (name === 'technicians') {
          if (isBlank(r.tech_id) && isBlank(r.name)) {
            headsUp.push('CSV import: Row ' + line + ' in technicians.csv has no technician id or name and was skipped.');
            skip = true;
          } else {
            const sales = toBoolKnown(r.sales_capable);
            if (!sales.known) {
              headsUp.push('CSV import: ' + (r.name || r.tech_id || ('Row ' + line)) + ' has no usable sales-capability value, so sales routing will not assume yes or no.');
              r.sales_capable = '';
            }
            if (!isBlank(r.shift_hours) && toNum(r.shift_hours, null) === null) {
              headsUp.push('CSV import: ' + (r.name || r.tech_id || ('Row ' + line)) + ' has an unreadable shift-hours value and it was left blank.');
              r.shift_hours = '';
            }
          }
        }
        if (!skip) kept.push(r);
      });
      out[name] = kept;
    } else {
      out[name] = rows;
    }
  });
  return { tables: out, headsUp: headsUp, technicians: technicians };
}

function datasetFromTables(settings, tables) {
  const prep = prepareCsvTables(settings, tables || {});
  const t = prep.tables;
  const headsUp = prep.headsUp.slice();
  if (!Array.isArray(t.technicians) && prep.technicians.length) {
    t.technicians = prep.technicians;
    headsUp.push('No technicians export was supplied, so the technician list was built from the Technician column in the jobs export. Shift hours and sales capability are not in a jobs export.');
  }
  ['technicians', 'jobs', 'capacity', 'memberships', 'estimates', 'calls'].forEach(function (name) {
    if (!Array.isArray(t[name])) headsUp.push('CSV export "' + name + '.csv" was not found. Anything that needs it is skipped.');
  });
  const numOrNull = function (v) { return toNum(v, null); };
  return {
    settings: Object.assign({}, settings, { headsUp: (settings.headsUp || []).concat(headsUp) }),
    technicians: (t.technicians || []).map(function (r) {
      const sales = toBoolKnown(r.sales_capable);
      return { id: r.tech_id, name: r.name, trade: r.trade, salesCapable: sales.known ? sales.value : null, shiftHours: numOrNull(r.shift_hours) };
    }),
    jobs: (t.jobs || []).map(function (r) {
      const techIds = splitIds(r.tech_ids);
      return Object.assign({
        id: r.job_id, bookedAt: r.booked_at, start: r.scheduled_start, end: r.scheduled_end, status: r.status,
        techId: r.tech_id, customerName: r.customer_name, customerPhone: r.customer_phone, customerType: r.customer_type,
        jobType: r.job_type, equipmentType: r.equipment_type, equipmentAgeYears: numOrNull(r.equipment_age_years),
        address: r.address, priority: r.priority, arrivedAt: r.arrived_at, actualMinutes: numOrNull(r.actual_minutes),
        businessUnit: r.business_unit, summary: r.summary || '',
      }, techIds.length > 1 ? { techIds: techIds } : {});
    }),
    capacityWindows: (t.capacity || []).map(function (r) {
      return { id: r.window_id, businessUnit: r.business_unit, start: r.window_start, end: r.window_end, openSlots: toNum(r.open_slots, null) };
    }),
    memberships: (t.memberships || []).map(function (r) {
      return {
        id: r.membership_id, customerName: r.customer_name, customerPhone: r.customer_phone, businessUnit: r.business_unit,
        plan: r.plan, status: r.status, nextServiceDue: r.next_service_due,
      };
    }),
    estimates: (t.estimates || []).map(function (r) {
      return {
        id: r.estimate_id, customerName: r.customer_name, customerPhone: r.customer_phone, businessUnit: r.business_unit,
        status: r.status, amount: numOrNull(r.amount), createdAt: r.created_at, lastFollowupAt: r.last_followup_at,
      };
    }),
    calls: Array.isArray(t.calls) ? t.calls.map(function (r) {
      return {
        id: r.call_id, receivedAt: r.received_at, callerName: r.caller_name, callerPhone: r.caller_phone, address: r.address,
        summary: r.summary, urgency: r.urgency, status: r.status, handledBy: r.handled_by,
        followUpNeeded: toBool(r.follow_up_needed, false), notes: r.notes || '',
      };
    }) : null,
  };
}

// Work out which export a file is. Header signature first (a Jobs export is the one with a job id column),
// then the file name, then "the only file is the jobs file" so a bad Jobs export still gets a clear error.
function classifyCsvTable(fileName, table, fileCount) {
  const has = function (name, key) { return canonicalizeRows([], TABLE_COLUMNS[name], table.headers).mapped[key] !== undefined; };
  if (has('jobs', 'job_id') && has('jobs', 'status') && has('jobs', 'scheduled_start')) return 'jobs';
  if (has('calls', 'call_id') || has('calls', 'received_at')) return 'calls';
  if (has('memberships', 'membership_id') || has('memberships', 'next_service_due')) return 'memberships';
  if (has('estimates', 'estimate_id') || has('estimates', 'last_followup_at')) return 'estimates';
  if (has('capacity', 'window_start') && has('capacity', 'open_slots')) return 'capacity';
  if (has('technicians', 'tech_id') && has('technicians', 'name')) return 'technicians';
  const n = String(fileName || '').toLowerCase();
  const hasInvoice = table.headers.some(function (h) { return ['invoicenumber', 'invoiceid'].includes(headerKey(h)); });
  if (hasInvoice) return null;
  if (/job|dispatch|appointment/.test(n) || has('jobs', 'job_id')) return 'jobs';
  if (/tech/.test(n)) return 'technicians';
  if (/capacity/.test(n)) return 'capacity';
  if (/member/.test(n)) return 'memberships';
  if (/estimate/.test(n)) return 'estimates';
  if (/call/.test(n)) return 'calls';
  return fileCount === 1 ? 'jobs' : null;
}

// files = [{ name, text }] in any order and with any file names. One Jobs/Dispatch export is enough.
// Returns the digest dataset (jobs use the internal schema that both the digest and the aging watch read).
function datasetFromCsvFiles(settings, files) {
  const list = Array.isArray(files) ? files : [];
  const tables = {};
  const notes = [];
  const jobFiles = [];
  list.forEach(function (f) {
    const name = String((f && f.name) || 'upload.csv');
    const t = parseCsvTable(f && f.text);
    (t.warnings || []).forEach(function (w) { notes.push('CSV import: file "' + name + '": ' + w); });
    const kind = classifyCsvTable(name, t, list.length);
    if (!kind) {
      notes.push('CSV import: file "' + name + '" was not recognized as a jobs, technicians, capacity, memberships, estimates, or calls export and was ignored.');
    } else if (kind === 'jobs') {
      jobFiles.push({ name: name, table: t });
    } else {
      const c = canonicalizeRows(t.rows, TABLE_COLUMNS[kind], t.headers);
      const missingRequired = siblingSchemaGaps(kind, c);
      if (missingRequired.length) {
        notes.push('CSV import: ' + siblingSchemaMessage(kind, missingRequired));
      } else {
        tables[kind] = (tables[kind] || []).concat(c.rows);
      }
    }
  });
  // One Jobs/Dispatch snapshot per batch. Merging two exports of the same job number
  // (an older Completed row plus a newer Unassigned row) can hide today's board.
  // Repeated rows inside a single file are still merged (one row per technician or appointment).
  let jobRows = [];
  let derived = [];
  if (jobFiles.length > 1) {
    notes.push('CSV import: multiple Jobs/Dispatch exports were received (' + jobFiles.map(function (f) {
      return '"' + f.name + '"';
    }).join(', ') + '). Supply one Jobs/Dispatch snapshot.');
  } else if (jobFiles.length === 1) {
    const chosen = jobFiles[0];
    const r = prepareJobRows(chosen.table.rows, { timezone: settings.timezone, label: 'Jobs export "' + chosen.name + '"', headers: chosen.table.headers });
    r.errors.concat(r.headsUp).forEach(function (m) { notes.push('CSV import: ' + m); });
    jobRows = r.rows;
    derived = r.technicians;
  }
  if (list.length === 0) notes.push('CSV import: no CSV file was received. Send or drop a ServiceTitan Jobs/Dispatch export.');
  if (jobRows.length) tables.jobs = jobRows;
  const ds = datasetFromTables(Object.assign({}, settings, { headsUp: (settings.headsUp || []).concat(notes) }), tables);
  if (jobRows.length) {
    const derivedNames = new Map(derived.map(function (t) { return [t.tech_id, t.name]; }));
    const nameById = Object.create(null);
    ds.technicians.forEach(function (t) {
      if (!tables.technicians && derivedNames.has(t.id)) t.name = derivedNames.get(t.id);
      nameById[t.id] = t.name;
    });
    ds.jobs = jobRows.map(function (r) {
      const j = mapCsvJob(r);
      j.assignedTechNames = j.techIds.map(function (id) { return nameById[id] || id; });
      return j;
    });
  }
  return ds;
}

// @@SECTION booking_qa
function bookingQa(data) {
  const s = data.settings;
  const tz = s.timezone;
  const asOf = parseTime(s.asOf);
  const since = asOf - s.bookingLookbackHours * HOUR;
  const jobs = data.jobs || [];
  const techs = data.technicians || [];
  const techById = Object.create(null);
  techs.forEach(function (t) { techById[t.id] = t; });
  const open = { scheduled: true, dispatched: true };
  const statusKey = function (job) { return normalizeJobStatus(job.status).key; };
  const busy = function (job) { return open[statusKey(job)] === true || statusKey(job) === 'in progress'; };
  const reviewed = jobs.filter(function (j) {
    const b = parseTime(j.bookedAt);
    return b !== null && b >= since && b <= asOf && open[statusKey(j)] === true;
  });
  const repeatSince = asOf - s.repeatWindowDays * DAY;
  const overlaps = function (a, b) {
    const as = parseTime(a.start), ae = parseTime(a.end), bs = parseTime(b.start), be = parseTime(b.end);
    return as !== null && ae !== null && bs !== null && be !== null && as < be && bs < ae;
  };
  const flagged = [];
  reviewed.forEach(function (job) {
    const flags = [];
    const assignedIds = assignedTechIds(job);
    if (isBlank(job.customerType)) flags.push({ code: 'missing_customer_type', text: 'Commercial vs residential not recorded' });
    if (isBlank(job.equipmentType)) flags.push({ code: 'missing_equipment_type', text: 'Equipment type not recorded' });
    if (job.equipmentAgeYears === null || job.equipmentAgeYears === undefined) flags.push({ code: 'missing_equipment_age', text: 'Equipment age not recorded' });
    const key = normAddr(job.address);
    if (key) {
      const priors = jobs.filter(function (o) {
        const st = parseTime(o.start);
        return o.id !== job.id && normAddr(o.address) === key && normalizeJobStatus(o.status).key === 'completed' && st !== null && st >= repeatSince && st <= asOf;
      });
      if (priors.length > 0) {
        const last = Math.max.apply(null, priors.map(function (o) { return parseTime(o.start); }));
        flags.push({
          code: 'repeat_address',
          text: 'Repeat address: ' + priors.length + ' completed ' + plural(priors.length, 'visit') + ' in the last ' + s.repeatWindowDays + ' days (latest ' + fmtDay(last, tz) + ')',
        });
      }
    }
    let routing = null;
    const isRepair = lc(job.jobType) === 'repair' || lc(job.jobType) === 'diagnostic';
    if (isRepair && job.equipmentAgeYears !== null && job.equipmentAgeYears !== undefined && job.equipmentAgeYears >= s.replacementAgeYears) {
      flags.push({
        code: 'replacement_opportunity',
        text: 'Possible replacement opportunity: ' + (job.equipmentType || 'equipment') + ' is ' + job.equipmentAgeYears + ' years old (threshold ' + s.replacementAgeYears + ')',
      });
      if (assignedIds.some(function (id) { return techById[id] && techById[id].salesCapable === true; })) {
        routing = { status: 'already_sales_capable', suggested: [] };
      } else {
        const available = techs.filter(function (t) {
          if (assignedIds.includes(t.id) || lc(t.trade) !== lc(job.businessUnit)) return false;
          return !jobs.some(function (o) { return busy(o) && overlaps(o, job) && assignedTechIds(o).includes(t.id); });
        });
        const free = available.filter(function (t) { return t.salesCapable === true; }).map(function (t) { return { id: t.id, name: t.name }; });
        const unknown = assignedIds.some(function (id) { return !techById[id] || techById[id].salesCapable == null; }) ||
          available.some(function (t) { return t.salesCapable == null; });
        routing = { status: free.length > 0 ? 'suggested' : unknown ? 'capability_unknown' : 'none_free', suggested: free };
      }
    }
    if (flags.length > 0) {
      const st = parseTime(job.start), en = parseTime(job.end);
      flagged.push({
        jobId: job.id,
        window: st !== null && en !== null ? fmtWindow(st, en, tz) : 'time not set',
        customerName: job.customerName,
        businessUnit: job.businessUnit,
        customerType: isBlank(job.customerType) ? 'unknown' : job.customerType,
        assignedTech: assignedIds.map(function (id) { return techById[id] ? techById[id].name : id; }).join(', ') || 'unassigned',
        address: job.address,
        flags: flags,
        routing: routing,
      });
    }
  });
  return { lookbackHours: s.bookingLookbackHours, reviewedCount: reviewed.length, flaggedCount: flagged.length, flagged: flagged };
}

// @@SECTION capacity_filler
function capacityFiller(data) {
  const s = data.settings;
  const tz = s.timezone;
  const asOf = parseTime(s.asOf);
  const horizon = asOf + s.capacityLookaheadDays * DAY;
  const today = localDate(asOf, tz);
  const windows = (data.capacityWindows || []).filter(function (w) {
    const st = parseTime(w.start), en = parseTime(w.end);
    const slots = toNum(w.openSlots, null);
    return st !== null && en !== null && en > st && st >= asOf && st < horizon && slots !== null && slots > 0;
  }).map(function (w) {
    return { id: w.id, businessUnit: w.businessUnit, startMs: parseTime(w.start), endMs: parseTime(w.end), openSlots: Number(w.openSlots), left: Number(w.openSlots) };
  }).sort(function (a, b) { return a.startMs - b.startMs; });
  let openHours = 0, openSlots = 0;
  windows.forEach(function (w) {
    openHours += w.openSlots * (w.endMs - w.startMs) / HOUR;
    openSlots += w.openSlots;
  });

  // Unworked estimates: open, and no follow-up (or creation) in estimateStaleDays or more.
  const unworked = [];
  let openEstimateCount = 0;
  (data.estimates || []).forEach(function (e) {
    if (lc(e.status) !== 'open') return;
    openEstimateCount++;
    const touch = Math.max(parseTime(e.createdAt) || 0, parseTime(e.lastFollowupAt) || 0);
    if (touch === 0) return;
    const idle = dayDiff(localDate(touch, tz), today);
    if (idle >= s.estimateStaleDays) unworked.push({ estimate: e, idleDays: idle });
  });
  const unworkedTotal = unworked.reduce(function (sum, u) { return sum + (u.estimate.amount || 0); }, 0);

  // Callback candidates, one per customer + business unit.
  const cands = {};
  const keyOf = function (x) { return (normPhone(x.customerPhone) || lc(x.customerName)) + '|' + lc(x.businessUnit); };
  unworked.forEach(function (u) {
    const e = u.estimate;
    const k = keyOf(e);
    cands[k] = cands[k] || { customerName: e.customerName, customerPhone: e.customerPhone, businessUnit: e.businessUnit, reasons: [], estimateAmount: 0, overdueDays: 0 };
    cands[k].reasons.push('Unsold estimate ' + e.id + ' (' + fmtMoney(e.amount || 0) + ', no activity for ' + u.idleDays + ' days)');
    cands[k].estimateAmount += e.amount || 0;
  });
  let overdueCount = 0;
  (data.memberships || []).forEach(function (m) {
    if (lc(m.status) !== 'active' || isBlank(m.nextServiceDue)) return;
    const due = parseCalendarDate(m.nextServiceDue, tz);
    if (due.bad || !due.date) return;
    const od = dayDiff(due.date, today);
    if (!Number.isFinite(od) || od < s.membershipOverdueDays) return;
    overdueCount++;
    const k = keyOf(m);
    cands[k] = cands[k] || { customerName: m.customerName, customerPhone: m.customerPhone, businessUnit: m.businessUnit, reasons: [], estimateAmount: 0, overdueDays: 0 };
    cands[k].reasons.push('Maintenance agreement ' + m.id + ' overdue ' + od + ' days (' + (m.plan || 'plan') + ')');
    cands[k].overdueDays = Math.max(cands[k].overdueDays, od);
  });
  const ranked = Object.keys(cands).map(function (k) { return cands[k]; }).sort(function (a, b) {
    return (b.estimateAmount - a.estimateAmount) || (b.overdueDays - a.overdueDays) || String(a.customerName).localeCompare(String(b.customerName));
  });
  const queue = [];
  const overflow = [];
  ranked.forEach(function (c) {
    const w = windows.find(function (x) {
      return x.left > 0 && (lc(x.businessUnit) === lc(c.businessUnit) || isBlank(x.businessUnit) || isBlank(c.businessUnit));
    });
    if (!w) { overflow.push(c); return; }
    w.left--;
    queue.push({
      customerName: c.customerName, customerPhone: c.customerPhone, businessUnit: c.businessUnit, reasons: c.reasons,
      windowId: w.id, windowStartMs: w.startMs, windowLabel: fmtWindow(w.startMs, w.endMs, tz),
      note: 'DRAFT for dispatcher review. Nothing has been sent to this customer.',
    });
  });
  queue.sort(function (a, b) { return a.windowStartMs - b.windowStartMs; });
  return {
    lookaheadDays: s.capacityLookaheadDays,
    openWindowCount: windows.length,
    openSlots: openSlots,
    openHours: round1(openHours),
    windows: windows.map(function (w) { return { id: w.id, businessUnit: w.businessUnit, label: fmtWindow(w.startMs, w.endMs, tz), openSlots: w.openSlots }; }),
    overdueMembershipCount: overdueCount,
    openEstimateCount: openEstimateCount,
    unworkedEstimates: {
      count: unworked.length,
      total: unworkedTotal,
      items: unworked.map(function (u) { return { id: u.estimate.id, customerName: u.estimate.customerName, amount: u.estimate.amount, idleDays: u.idleDays }; }),
    },
    queue: queue,
    overflow: overflow.map(function (c) { return { customerName: c.customerName, businessUnit: c.businessUnit, reasons: c.reasons }; }),
  };
}

// @@SECTION kpi_digest
function kpiDigest(data) {
  const s = data.settings;
  const tz = s.timezone;
  const asOf = parseTime(s.asOf);
  const reportDate = dayAdd(localDate(asOf, tz), -1);
  const techs = data.technicians || [];
  const jobs = data.jobs || [];
  const headsUp = (s.headsUp || []).slice();
  const onDay = jobs.filter(function (j) {
    const st = parseTime(j.start);
    return st !== null && localDate(st, tz) === reportDate && normalizeJobStatus(j.status).key === 'completed';
  });
  let missingMinutes = 0;
  const completedByTech = new Map();
  const knownTechIds = new Set(techs.map(function (t) { return t.id; }));
  onDay.forEach(function (j) {
    const ids = assignedTechIds(j);
    const hasMinutes = j.actualMinutes !== null && j.actualMinutes !== undefined;
    const ambiguousMinutes = hasMinutes && ids.length > 1;
    if (ambiguousMinutes) {
      headsUp.push('Completed job ' + j.id + ' has job-level on-site minutes and multiple technicians. The minutes were left out of per-technician utilization.');
    }
    ids.forEach(function (id) {
      if (!completedByTech.has(id)) completedByTech.set(id, { jobs: 0, minutes: 0, ambiguous: false });
      const totals = completedByTech.get(id);
      totals.jobs++;
      if (ambiguousMinutes) totals.ambiguous = true;
      else if (hasMinutes) totals.minutes += j.actualMinutes;
    });
    if (!hasMinutes && ids.some(function (id) { return knownTechIds.has(id); })) missingMinutes++;
  });
  const perTech = techs.map(function (t) {
    const totals = completedByTech.get(t.id) || { jobs: 0, minutes: 0, ambiguous: false };
    const shiftMinutes = t.shiftHours && t.shiftHours > 0 ? t.shiftHours * 60 : null;
    return {
      id: t.id, name: t.name, trade: t.trade, jobs: totals.jobs, minutes: totals.minutes, shiftHours: t.shiftHours,
      utilizationPct: shiftMinutes === null || totals.ambiguous ? null : round1(totals.minutes / shiftMinutes * 100),
    };
  });
  const counted = perTech.filter(function (p) { return p.utilizationPct !== null; });
  const shiftTotal = counted.reduce(function (a, p) { return a + p.shiftHours * 60; }, 0);
  const minutesTotal = counted.reduce(function (a, p) { return a + p.minutes; }, 0);
  const team = shiftTotal > 0 ? { pct: round1(minutesTotal / shiftTotal * 100), minutes: minutesTotal, shiftMinutes: shiftTotal } : null;
  if (techs.length === 0) headsUp.push('Technician utilization could not be computed: no technicians in the data.');
  else if (!techs.some(function (t) { return t.shiftHours > 0; })) headsUp.push('Technician utilization could not be computed: no technician has shift hours.');
  else if (perTech.some(function (p) { return p.shiftHours > 0 && p.utilizationPct === null; })) {
    headsUp.push('Technicians with ambiguous on-site minutes are left out of the team utilization figure.');
  }
  perTech.filter(function (p) { return !(p.shiftHours > 0); }).forEach(function (p) {
    headsUp.push(p.name + ' has no shift hours in the data, so utilization is not shown for them and they are left out of the team figure.');
  });
  if (missingMinutes > 0) headsUp.push(missingMinutes + ' completed ' + plural(missingMinutes, 'job has', 'jobs have') + ' no on-site minutes recorded and ' + plural(missingMinutes, 'is', 'are') + ' not counted in utilization.');

  const urgent = jobs.filter(function (j) {
    const st = parseTime(j.start);
    const stKey = normalizeJobStatus(j.status).key;
    return (lc(j.priority) === 'emergency' || lc(j.priority) === 'same-day') && st !== null && localDate(st, tz) === reportDate && stKey !== 'canceled';
  });
  const times = [];
  let missingArrival = 0;
  urgent.forEach(function (j) {
    const b = parseTime(j.bookedAt), a = parseTime(j.arrivedAt);
    if (b === null || a === null || a < b) { missingArrival++; return; }
    times.push((a - b) / 60000);
  });
  const responseTime = times.length > 0
    ? { count: times.length, avgMinutes: round1(times.reduce(function (x, y) { return x + y; }, 0) / times.length), maxMinutes: Math.round(Math.max.apply(null, times)), missing: missingArrival }
    : null;
  if (responseTime === null) headsUp.push('Response time could not be computed: no emergency or same-day job on ' + reportDate + ' has both a booked time and an arrival time.');
  else if (missingArrival > 0) headsUp.push(missingArrival + ' emergency or same-day ' + plural(missingArrival, 'job') + ' on ' + reportDate + ' ' + plural(missingArrival, 'has', 'have') + ' no usable arrival time and ' + plural(missingArrival, 'is', 'are') + ' left out of response time.');

  const cap = data.capacity;
  const qa = data.bookingQa;
  if (!cap) headsUp.push('Open capacity and unworked estimates could not be computed: the capacity step did not run.');
  return {
    reportDate: reportDate,
    utilization: { team: team, perTech: perTech },
    responseTime: responseTime,
    openCapacity: cap ? { hours: cap.openHours, slots: cap.openSlots, windows: cap.openWindowCount, lookaheadDays: cap.lookaheadDays } : null,
    unworkedEstimates: cap ? { count: cap.unworkedEstimates.count, total: cap.unworkedEstimates.total } : null,
    bookingQa: qa ? { reviewed: qa.reviewedCount, flagged: qa.flaggedCount } : null,
    headsUp: headsUp,
  };
}

// @@SECTION handoff
function afterHoursHandoff(data) {
  const s = data.settings;
  const tz = s.timezone;
  const asOf = parseTime(s.asOf);
  if (!Array.isArray(data.calls)) {
    return { computed: false, headsUp: 'After-hours handoff could not be computed: no call data was supplied.' };
  }
  let t = Math.floor(asOf / 900000) * 900000;
  for (let i = 0; i < 120; i++) {
    const p = localParts(t, tz);
    if (p.hour === s.afterHoursStartHour && p.minute === 0) break;
    t -= 900000;
  }
  const windowStart = t;
  const techById = {};
  (data.technicians || []).forEach(function (x) { techById[x.id] = x; });
  const inWindow = data.calls.filter(function (c) {
    const r = parseTime(c.receivedAt);
    return r !== null && r >= windowStart && r <= asOf;
  });
  const urgencyOf = function (c) { return lc(c.urgency) === 'emergency' ? 'emergency' : (isBlank(c.urgency) ? 'unclassified' : 'non-emergency'); };
  const needsAction = function (c) { return lc(c.status) !== 'resolved' || c.followUpNeeded === true; };
  const emergencies = inWindow.filter(function (c) { return urgencyOf(c) === 'emergency'; });
  const unclassified = inWindow.filter(function (c) { return urgencyOf(c) === 'unclassified'; });
  const nonEmergency = inWindow.filter(function (c) { return urgencyOf(c) === 'non-emergency'; });
  const listed = emergencies.concat(unclassified).map(function (c) {
    const h = techById[c.handledBy];
    return {
      id: c.id, time: fmtDay(parseTime(c.receivedAt), tz) + ' ' + fmtTime(parseTime(c.receivedAt), tz), receivedMs: parseTime(c.receivedAt),
      urgency: urgencyOf(c), callerName: c.callerName, callerPhone: c.callerPhone, address: c.address, summary: c.summary,
      status: lc(c.status) || 'unknown', handledBy: h ? h.name : (isBlank(c.handledBy) ? 'nobody recorded' : c.handledBy),
      followUpNeeded: c.followUpNeeded === true, notes: c.notes, needsAction: needsAction(c),
    };
  }).sort(function (a, b) { return (Number(b.needsAction) - Number(a.needsAction)) || (a.receivedMs - b.receivedMs); });
  return {
    computed: true,
    windowLabel: fmtDay(windowStart, tz) + ' ' + fmtTime(windowStart, tz) + ' to ' + fmtDay(asOf, tz) + ' ' + fmtTime(asOf, tz),
    emergencyCount: emergencies.length,
    unclassifiedCount: unclassified.length,
    nonEmergencyCount: nonEmergency.length,
    needsActionCount: listed.filter(function (c) { return c.needsAction; }).length,
    resolvedCount: listed.filter(function (c) { return !c.needsAction; }).length,
    calls: listed,
  };
}

// @@SECTION message
function renderMessage(data) {
  const s = data.settings;
  const tz = s.timezone;
  const asOf = parseTime(s.asOf);
  const max = s.maxItemsPerSection;
  const k = data.kpis;
  const qa = data.bookingQa;
  const cap = data.capacity;
  const ah = data.afterHours;
  const tag = s.testMode ? '[TEST] ' : '';
  const L = [];
  const more = function (arr) { return arr.length > max ? ['- ...and ' + (arr.length - max) + ' more (see the workflow output)'] : []; };

  L.push('# ' + tag + 'Morning Dispatch KPI Digest: ' + s.businessName);
  L.push('');
  L.push(fmtDay(asOf, tz) + ' ' + fmtTime(asOf, tz) + ' ' + tz + ' | KPIs are for ' + k.reportDate + ' | source: ' + s.source);
  if (s.testMode) {
    L.push('');
    L.push('> [TEST] Preview only. Sent to the owner address or channel you set, never to a customer.' + (s.source === 'test' ? ' Built from fictional sample data.' : ''));
  }
  L.push('');
  L.push('## Dispatch KPIs');
  L.push('');
  const u = k.utilization;
  L.push(u.team ? '- Technician utilization (team): ' + fix1(u.team.pct) + '% (' + u.team.minutes + ' on-site minutes of ' + u.team.shiftMinutes + ' shift minutes)' : '- Technician utilization: not available (see Heads-up)');
  u.perTech.forEach(function (p) {
    L.push('  - ' + p.name + (isBlank(p.trade) ? '' : ' (' + p.trade + ')') + ': ' + (p.utilizationPct === null ? 'n/a' : fix1(p.utilizationPct) + '%') + ', ' + p.jobs + ' completed ' + plural(p.jobs, 'job'));
  });
  L.push(k.responseTime
    ? '- Response time, emergency and same-day jobs (booked to arrival): average ' + fix1(k.responseTime.avgMinutes) + ' min, longest ' + k.responseTime.maxMinutes + ' min, across ' + k.responseTime.count + ' ' + plural(k.responseTime.count, 'job')
    : '- Response time: not available (see Heads-up)');
  L.push(k.openCapacity
    ? '- Open capacity, next ' + k.openCapacity.lookaheadDays + ' days: ' + fix1(k.openCapacity.hours) + ' hours in ' + k.openCapacity.slots + ' open ' + plural(k.openCapacity.slots, 'slot') + ' across ' + k.openCapacity.windows + ' ' + plural(k.openCapacity.windows, 'window')
    : '- Open capacity: not available (see Heads-up)');
  L.push(k.unworkedEstimates
    ? '- Unworked estimates: ' + k.unworkedEstimates.count + ' open ' + plural(k.unworkedEstimates.count, 'estimate') + ' worth ' + fmtMoney(k.unworkedEstimates.total) + ' with no activity for ' + s.estimateStaleDays + '+ days'
    : '- Unworked estimates: not available (see Heads-up)');
  L.push('- Utilization counts on-site job minutes only. Drive time and non-job time are not in the data.');
  const hu = k.headsUp.concat(ah && ah.computed === false ? [ah.headsUp] : []);
  if (hu.length > 0) {
    L.push('');
    hu.forEach(function (h) { L.push('Heads-up: ' + h); });
  }

  L.push('');
  L.push('## Booking QA & skill-tier routing');
  L.push('');
  L.push('Newly booked jobs reviewed (last ' + qa.lookbackHours + ' hours): ' + qa.reviewedCount + '. Flagged: ' + qa.flaggedCount + '. Routing lines are suggestions; nothing is reassigned automatically.');
  L.push('');
  qa.flagged.slice(0, max).forEach(function (f) {
    L.push('- Job ' + f.jobId + ' | ' + f.window + ' | ' + f.businessUnit + ', ' + f.customerType + ' | ' + f.customerName + ' | tech: ' + f.assignedTech);
    f.flags.forEach(function (x) { L.push('  - ' + x.text); });
    if (f.routing) {
      if (f.routing.status === 'suggested') L.push('  - Suggested: ask dispatch to consider ' + f.routing.suggested.map(function (x) { return x.name; }).join(' or ') + ' (sales-capable, no overlapping job)');
      else if (f.routing.status === 'none_free') L.push('  - No sales-capable ' + f.businessUnit + ' tech is free in that window. Dispatcher decides.');
      else if (f.routing.status === 'capability_unknown') L.push('  - Heads-up: sales capability is missing for an assigned or available tech. Dispatcher verifies availability and capability.');
      else L.push('  - Already assigned to a sales-capable tech.');
    }
  });
  more(qa.flagged).forEach(function (x) { L.push(x); });
  if (qa.flagged.length === 0) L.push('- No flags.');

  L.push('');
  L.push('## Dispatcher callback queue (DRAFT, nothing is sent)');
  L.push('');
  L.push('Internal list for dispatchers only. Each row pairs a customer with an open window. The workflow never texts or emails customers.');
  L.push('');
  cap.queue.slice(0, max).forEach(function (q, i) {
    L.push((i + 1) + '. ' + q.customerName + ', ' + q.customerPhone + ' | ' + q.businessUnit + ' | window ' + q.windowLabel);
    q.reasons.forEach(function (r) { L.push('   - ' + r); });
  });
  more(cap.queue).forEach(function (x) { L.push(x); });
  if (cap.queue.length === 0) L.push('- No callbacks queued.');
  if (cap.overflow.length > 0) {
    L.push('');
    L.push('Not placed (no open window left for that business unit): ' + cap.overflow.map(function (o) { return o.customerName + ' (' + o.businessUnit + ')'; }).join('; '));
  }

  L.push('');
  L.push('## After-hours handoff for the morning shift');
  L.push('');
  if (ah && ah.computed) {
    L.push('Window: ' + ah.windowLabel + '. Emergency calls: ' + ah.emergencyCount + ' (' + ah.needsActionCount + ' need action, ' + ah.resolvedCount + ' resolved). Non-emergency messages: ' + ah.nonEmergencyCount + '.' + (ah.unclassifiedCount > 0 ? ' Calls with no urgency recorded: ' + ah.unclassifiedCount + '.' : ''));
    L.push('');
    ah.calls.slice(0, max).forEach(function (c) {
      L.push('- ' + (c.needsAction ? 'NEEDS ACTION' : 'Resolved') + ' | ' + c.time + ' | ' + c.callerName + ', ' + c.callerPhone + ' | ' + c.address);
      L.push('  - ' + c.summary + ' | status: ' + c.status + ' | handled by: ' + c.handledBy + (c.notes ? ' | ' + c.notes : ''));
    });
    more(ah.calls).forEach(function (x) { L.push(x); });
    if (ah.calls.length === 0) L.push('- No emergency calls recorded overnight.');
  } else {
    L.push('Not available (see Heads-up).');
  }
  L.push('');
  L.push('---');
  L.push(tag + 'Draft pack, not yet tested against a live ServiceTitan account. Read-only. Owner-only delivery.');
  const text = L.join('\n');
  const esc = function (x) { return x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const placeholderEmail = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.ownerEmail) || /@example\.(com|org|net)$/i.test(s.ownerEmail);
  const wantsEmail = s.delivery === 'email' || s.delivery === 'both';
  const wantsSlack = s.delivery === 'slack' || s.delivery === 'both';
  const out = {
    subject: tag + 'Dispatch KPI Digest: ' + s.businessName + ' (' + fmtDay(asOf, tz) + ')',
    text: text,
    html: '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;white-space:pre-wrap">' + esc(text) + '</pre>',
    slackText: esc(text),
    emailTo: s.ownerEmail,
    slackChannel: s.ownerSlackChannel,
    sendEmail: wantsEmail && !placeholderEmail,
    sendSlack: wantsSlack && !isBlank(s.ownerSlackChannel),
    testMode: s.testMode,
    deliveryNotes: [],
  };
  if (wantsEmail && placeholderEmail) out.deliveryNotes.push('Email not sent: ownerEmail is blank, invalid, or still the example.com placeholder.');
  if (wantsSlack && isBlank(s.ownerSlackChannel)) out.deliveryNotes.push('Slack not sent: ownerSlackChannel is blank.');
  return out;
}

// @@SECTION servicetitan_normalize
// DRAFT, UNVERIFIED mapping. Field names below follow ServiceTitan's public v2 docs as remembered
// and have NOT been checked against a real tenant. Fields that a record does not carry stay blank so
// Booking QA flags them instead of guessing.
function normalizeServiceTitan(settings, raw) {
  const rows = function (r) { return r && Array.isArray(r.data) ? r.data : []; };
  const headsUp = (settings.headsUp || []).concat([
    'ServiceTitan live mapping is an unverified first draft. Customer names, phone numbers, business-unit names, equipment type and age, and customer type are not read, so Booking QA will flag them as missing. The CSV export path is the recommended way to start.',
  ]);
  Object.keys(raw).forEach(function (name) {
    const r = raw[name];
    if (!r || r.error || (r.data === undefined && !Array.isArray(r))) headsUp.push('ServiceTitan "' + name + '" read returned no usable data.');
    else if (r.hasMore === true) headsUp.push('ServiceTitan "' + name + '" has more pages than this draft reads. Totals may be incomplete.');
  });
  const appts = rows(raw.appointments);
  const apptById = {};
  appts.forEach(function (a) { apptById[a.id] = a; });
  const assignByJob = {};
  rows(raw.assignments).forEach(function (a) { if (!assignByJob[a.jobId]) assignByJob[a.jobId] = a; });
  const apptByJob = {};
  appts.forEach(function (a) { if (!apptByJob[a.jobId]) apptByJob[a.jobId] = a; });
  const technicians = rows(raw.technicians).map(function (t) {
    return { id: String(t.id), name: t.name || ('Technician ' + t.id), trade: '', salesCapable: null, shiftHours: null };
  });
  const jobs = rows(raw.jobs).map(function (j) {
    const a = apptByJob[j.id] || {};
    const asg = assignByJob[j.id] || {};
    return {
      id: String(j.jobNumber || j.id), bookedAt: j.createdOn, start: a.start, end: a.end, status: normalizeJobStatus(j.jobStatus || '').canonical || (j.jobStatus || ''),
      techId: asg.technicianId !== undefined ? String(asg.technicianId) : '', customerName: 'Customer #' + j.customerId, customerPhone: '',
      customerType: '', jobType: '', equipmentType: '', equipmentAgeYears: null, address: j.locationId ? 'Location #' + j.locationId : '',
      priority: j.priority || '', arrivedAt: '', actualMinutes: null, businessUnit: j.businessUnitId ? String(j.businessUnitId) : '', summary: j.summary || '',
    };
  });
  // Open windows are derived as shift time minus booked appointment time, because the Dispatch capacity
  // query endpoint is a POST and this pack never writes. Gaps under 60 minutes are ignored.
  const capacityWindows = [];
  rows(raw.shifts).forEach(function (sh) {
    const s0 = parseTime(sh.start), e0 = parseTime(sh.end);
    if (s0 === null || e0 === null) return;
    const busy = rows(raw.assignments).filter(function (a) { return String(a.technicianId) === String(sh.technicianId); })
      .map(function (a) { return apptById[a.appointmentId]; }).filter(Boolean)
      .map(function (a) { return [parseTime(a.start), parseTime(a.end)]; })
      .filter(function (p) { return p[0] !== null && p[1] !== null; })
      .sort(function (x, y) { return x[0] - y[0]; });
    let cursor = s0;
    const gaps = [];
    busy.forEach(function (p) {
      if (p[0] > cursor) gaps.push([cursor, Math.min(p[0], e0)]);
      cursor = Math.max(cursor, p[1]);
    });
    if (cursor < e0) gaps.push([cursor, e0]);
    gaps.forEach(function (g, i) {
      if (g[1] - g[0] >= HOUR) capacityWindows.push({ id: 'ST-' + sh.technicianId + '-' + i + '-' + g[0], businessUnit: '', start: new Date(g[0]).toISOString(), end: new Date(g[1]).toISOString(), openSlots: 1 });
    });
  });
  const memberships = rows(raw.memberships).map(function (m) {
    return { id: String(m.id), customerName: 'Customer #' + (m.customerId || m.membershipId || m.id), customerPhone: '', businessUnit: '', plan: 'membership', status: 'active', nextServiceDue: (function () { const d = parseCalendarDate(m.date || m.nextServiceDate || '', settings.timezone); return d.date; })() };
  });
  const estimates = rows(raw.estimates).map(function (e) {
    return {
      id: String(e.id), customerName: 'Customer #' + e.customerId, customerPhone: '', businessUnit: e.businessUnitId ? String(e.businessUnitId) : '',
      status: (e.status && e.status.name ? e.status.name : String(e.status || '')), amount: toNum(e.total !== undefined ? e.total : e.subtotal, null),
      createdAt: e.createdOn, lastFollowupAt: '',
    };
  });
  const calls = rows(raw.calls).map(function (c) {
    return {
      id: String(c.id), receivedAt: c.receivedOn || c.createdOn, callerName: c.from ? String(c.from) : 'Unknown caller', callerPhone: c.from ? String(c.from) : '',
      address: '', summary: c.reason ? String(c.reason) : 'Call recorded', urgency: '', status: c.callType ? String(c.callType) : 'unknown', handledBy: '', followUpNeeded: false, notes: '',
    };
  });
  return {
    settings: Object.assign({}, settings, { headsUp: headsUp }),
    technicians: technicians, jobs: jobs, capacityWindows: capacityWindows, memberships: memberships, estimates: estimates, calls: calls,
  };
}

// @@SECTION testdata
function loadTestData(settings, dataset) {
  return Object.assign({}, dataset, {
    settings: Object.assign({}, settings, { asOf: dataset.referenceTime }),
  });
}

// @@SECTION aging
const AGING_DEFAULT_THRESHOLD_MINUTES = 20;
const OPEN_JOB_STATUSES = OPEN_JOB_STATUS_KEYS;
const TERMINAL_JOB_STATUSES = TERMINAL_JOB_STATUS_KEYS;

function agingThresholdMinutes(s) {
  return toNum(s && s.agingThresholdMinutes, AGING_DEFAULT_THRESHOLD_MINUTES);
}

function prepareAgingSettings(cfg, nowMs) {
  const s = prepareSettings(cfg, nowMs);
  const n = toNum(cfg && cfg.agingThresholdMinutes, AGING_DEFAULT_THRESHOLD_MINUTES);
  s.agingThresholdMinutes = n > 0 ? n : AGING_DEFAULT_THRESHOLD_MINUTES;
  return s;
}

function jobTechIds(job) {
  const fromList = uniqueIds(job.techIds || splitIds(job.tech_ids));
  if (fromList.length) return fromList;
  return uniqueIds(splitIds(job.techId || job.tech_id));
}

function isTerminalJob(job) {
  return TERMINAL_JOB_STATUS_KEYS.indexOf(normalizeJobStatus(job.status).key) !== -1;
}

function isOpenJob(job) {
  if (isTerminalJob(job)) return false;
  const n = normalizeJobStatus(job.status);
  return OPEN_JOB_STATUS_KEYS.indexOf(n.key) !== -1;
}

function isUnassignedJob(job) {
  if (!isOpenJob(job)) return false;
  if (normalizeJobStatus(job.status).key === 'unassigned') return true;
  return jobTechIds(job).length === 0;
}

function jobSpansMultipleLocalDays(job, tz) {
  if (toBool(job.multiDay, false)) return true;
  const start = parseTime(job.start);
  const end = parseTime(job.end);
  if (start === null || end === null) return false;
  return localDate(start, tz) !== localDate(end, tz);
}

function unassignedClock(job) {
  const t = parseTime(job.unassignedSince);
  if (t !== null) return t;
  return parseTime(job.bookedAt);
}

function agingMinutes(job, asOfMs) {
  const clock = unassignedClock(job);
  if (clock === null || asOfMs === null) return null;
  return Math.floor((asOfMs - clock) / 60000);
}

function datasetFromAgingTables(settings, tables) {
  const prep = prepareCsvTables(settings, tables || {});
  const t = prep.tables;
  const headsUp = prep.headsUp.slice();
  const jobsTable = Array.isArray(t.aging_jobs) ? t.aging_jobs : (Array.isArray(t.jobs) ? t.jobs : null);
  if (!jobsTable) headsUp.push('CSV export "aging_jobs.csv" or "jobs.csv" was not found. The aging watch is skipped.');
  const techRows = Array.isArray(t.technicians) ? t.technicians : prep.technicians;
  const technicians = techRows.map(function (r) {
    return { id: String(r.tech_id || r.id || ''), name: r.name || ('Technician ' + (r.tech_id || r.id || '')), trade: r.trade || '' };
  });
  const techName = {};
  technicians.forEach(function (tech) { techName[tech.id] = tech.name; });
  const jobs = (jobsTable || []).map(function (r) {
    const job = mapAgingJob(r);
    job.assignedTechNames = job.techIds.map(function (id) { return techName[id] || id; });
    return job;
  });
  return {
    settings: Object.assign({}, settings, { headsUp: (settings.headsUp || []).concat(headsUp) }),
    technicians: technicians,
    jobs: jobs,
  };
}

function normalizeAgingServiceTitan(settings, raw) {
  const rows = function (r) { return r && Array.isArray(r.data) ? r.data : (Array.isArray(r) ? r : []); };
  const headsUp = (settings.headsUp || []).concat([
    'ServiceTitan live mapping for the Unassigned Aging Watch is an unverified first draft. Skill tags and zone assignments are not always present on the job record, so a missing field is flagged rather than guessed. The CSV export path is the recommended way to start.',
  ]);
  Object.keys(raw || {}).forEach(function (name) {
    const r = raw[name];
    if (!r || r.error || (r.data === undefined && !Array.isArray(r))) headsUp.push('ServiceTitan "' + name + '" read returned no usable data.');
    else if (r.hasMore === true) headsUp.push('ServiceTitan "' + name + '" has more pages than this draft reads. Totals may be incomplete.');
  });
  const techName = {};
  rows(raw.technicians).forEach(function (t) { techName[String(t.id)] = t.name || ('Technician ' + t.id); });
  const assignByJob = {};
  rows(raw.assignments).forEach(function (a) {
    const jobId = String(a.jobId || a.jobID || '');
    if (!jobId) return;
    if (!assignByJob[jobId]) assignByJob[jobId] = [];
    if (a.technicianId !== undefined && a.technicianId !== null && String(a.technicianId).trim() !== '') {
      assignByJob[jobId].push(String(a.technicianId));
    }
  });
  const apptByJob = {};
  rows(raw.appointments).forEach(function (a) {
    const jobId = String(a.jobId || a.jobID || '');
    if (!jobId) return;
    if (!apptByJob[jobId]) apptByJob[jobId] = a;
  });
  const jobs = rows(raw.jobs).map(function (j) {
    const id = String(j.jobNumber || j.id);
    const a = apptByJob[j.id] || apptByJob[id] || {};
    const techIds = uniqueIds(assignByJob[j.id] || assignByJob[id] || []);
    const skill = j.skill || (j.skills && j.skills[0] && (j.skills[0].name || j.skills[0])) || (j.jobType && j.jobType.name) || '';
    const zone = j.zone || j.zoneName || (j.territory && (j.territory.name || j.territory)) || j.businessUnitLocation || '';
    return {
      id: id,
      bookedAt: j.createdOn || j.bookedOn || '',
      unassignedSince: j.unassignedOn || j.unassignedSince || '',
      start: a.start || j.scheduledStart || '',
      end: a.end || j.scheduledEnd || '',
      status: j.jobStatus || j.status || '',
      techId: techIds[0] || '',
      techIds: techIds,
      skill: skill ? String(skill) : '',
      zone: zone ? String(zone) : '',
      customerName: j.customerId ? 'Customer #' + j.customerId : '',
      customerPhone: '',
      customerType: '',
      jobType: (j.jobType && j.jobType.name) ? j.jobType.name : String(j.type || ''),
      equipmentType: '',
      equipmentAgeYears: null,
      address: j.locationId ? 'Location #' + j.locationId : '',
      priority: j.priority || '',
      businessUnit: j.businessUnitId ? String(j.businessUnitId) : (j.businessUnit && j.businessUnit.name ? j.businessUnit.name : ''),
      summary: j.summary || '',
      multiDay: false,
      assignedTechNames: techIds.map(function (tid) { return techName[tid] || tid; }),
    };
  });
  const technicians = rows(raw.technicians).map(function (t) {
    return { id: String(t.id), name: t.name || ('Technician ' + t.id), trade: '' };
  });
  return {
    settings: Object.assign({}, settings, { headsUp: headsUp }),
    technicians: technicians,
    jobs: jobs,
  };
}

function fmtAgingWindow(startMs, endMs, tz) {
  if (startMs === null || endMs === null) return 'no window';
  if (localDate(startMs, tz) === localDate(endMs, tz)) return fmtWindow(startMs, endMs, tz);
  return fmtDay(startMs, tz) + ' ' + fmtTime(startMs, tz) + '-' + fmtDay(endMs, tz) + ' ' + fmtTime(endMs, tz);
}

function agingJobLabel(job, tz) {
  const techs = (job.assignedTechNames && job.assignedTechNames.length)
    ? job.assignedTechNames.join(', ')
    : (jobTechIds(job).length ? jobTechIds(job).join(', ') : 'no tech');
  const bu = isBlank(job.businessUnit) ? 'trade n/a' : job.businessUnit;
  const who = isBlank(job.customerName) ? 'customer n/a' : job.customerName;
  const window = fmtAgingWindow(parseTime(job.start), parseTime(job.end), tz);
  return 'Job ' + job.id + ' | ' + window + ' | ' + bu + ' | ' + who + ' | tech: ' + techs;
}

function unassignedAgingWatch(data) {
  const s = data.settings || {};
  const tz = s.timezone || 'America/Chicago';
  const asOfMs = parseTime(s.asOf);
  const threshold = agingThresholdMinutes(s);
  const hu = (s.headsUp || []).slice();
  if (asOfMs === null) hu.push('asOf time is missing, so unassigned age could not be computed.');
  const agedUnassigned = [];
  const blankSkill = [];
  const missingZone = [];
  const autoModeExclusionRisk = [];
  (data.jobs || []).forEach(function (job) {
    const stn = normalizeJobStatus(job.status);
    if (stn.blank) {
      hu.push('Job ' + job.id + ' has no status and was left out of the aging watch.');
    } else if (!stn.known) {
      hu.push('Job ' + job.id + ' has unrecognized status "' + stn.raw + '" and was left out of the aging watch.');
    }
    if (!isOpenJob(job)) return;
    const flags = [];
    const mins = isUnassignedJob(job) ? agingMinutes(job, asOfMs) : null;
    if (isUnassignedJob(job) && mins === null) {
      hu.push('Job ' + job.id + ' is unassigned but has no usable Unassigned Since or Created On timestamp, so its age could not be computed.');
    }
    if (isUnassignedJob(job) && mins !== null && mins >= threshold) {
      flags.push({ code: 'aged_unassigned', minutes: mins, text: 'Sitting in Unassigned for ' + mins + ' min (threshold ' + threshold + ' min).' });
    }
    if (isBlank(job.skill)) {
      flags.push({ code: 'blank_skill', text: 'Blank skill tag. Dispatch Pro Auto Mode can silently drop or ping-pong this job when it reshuffles.' });
    }
    if (isBlank(job.zone)) {
      flags.push({ code: 'missing_zone', text: 'Missing zone assignment. Auto Mode can exclude this job when it reshuffles.' });
    }
    const techs = jobTechIds(job);
    const multiTech = techs.length > 1;
    const multiDay = jobSpansMultipleLocalDays(job, tz);
    if (multiTech || multiDay) {
      const why = [];
      if (multiTech) why.push('multi-tech (' + techs.length + ' technicians)');
      if (multiDay) why.push('multi-day');
      flags.push({ code: 'automode_exclusion', kind: multiTech && multiDay ? 'multi-tech-multi-day' : (multiTech ? 'multi-tech' : 'multi-day'), text: 'Auto Mode exclusion risk: ' + why.join(' and ') + '. Dispatch Pro can silently leave this in Unassigned or ping-pong it on each 10-minute reshuffle.' });
    }
    if (flags.length === 0) return;
    const row = {
      jobId: job.id,
      status: job.status || '',
      businessUnit: job.businessUnit || '',
      customerName: job.customerName || '',
      customerPhone: job.customerPhone || '',
      address: job.address || '',
      skill: job.skill || '',
      zone: job.zone || '',
      assignedTech: techs.length ? techs.join(', ') : '',
      unassignedMinutes: mins,
      label: agingJobLabel(job, tz),
      flags: flags,
    };
    if (flags.some(function (f) { return f.code === 'aged_unassigned'; })) agedUnassigned.push(row);
    if (flags.some(function (f) { return f.code === 'blank_skill'; })) blankSkill.push(row);
    if (flags.some(function (f) { return f.code === 'missing_zone'; })) missingZone.push(row);
    if (flags.some(function (f) { return f.code === 'automode_exclusion'; })) autoModeExclusionRisk.push(row);
  });
  const sortAged = function (a, b) { return (b.unassignedMinutes || 0) - (a.unassignedMinutes || 0); };
  const sortId = function (a, b) { return String(a.jobId).localeCompare(String(b.jobId)); };
  agedUnassigned.sort(sortAged);
  blankSkill.sort(sortId);
  missingZone.sort(sortId);
  autoModeExclusionRisk.sort(sortId);
  const flaggedIds = {};
  agedUnassigned.concat(blankSkill, missingZone, autoModeExclusionRisk).forEach(function (r) { flaggedIds[r.jobId] = true; });
  return {
    computed: asOfMs !== null,
    thresholdMinutes: threshold,
    reviewedCount: (data.jobs || []).filter(isOpenJob).length,
    agedCount: agedUnassigned.length,
    blankSkillCount: blankSkill.length,
    missingZoneCount: missingZone.length,
    autoModeExclusionCount: autoModeExclusionRisk.length,
    flaggedJobCount: Object.keys(flaggedIds).length,
    agedUnassigned: agedUnassigned,
    blankSkill: blankSkill,
    missingZone: missingZone,
    autoModeExclusionRisk: autoModeExclusionRisk,
    headsUp: hu,
  };
}

function renderAgingAlert(data) {
  const s = data.settings;
  const watch = data.agingWatch || unassignedAgingWatch(data);
  const tz = s.timezone;
  const asOf = parseTime(s.asOf);
  const tag = s.testMode ? '[TEST] ' : '';
  const L = [];
  L.push('# ' + tag + 'Unassigned Aging Alert: ' + s.businessName);
  L.push('');
  L.push((asOf !== null ? fmtDay(asOf, tz) + ' ' + fmtTime(asOf, tz) : 'time n/a') + ' ' + tz + '. source: ' + s.source + '.' + (s.source === 'test' ? ' Built from fictional sample data.' : ''));
  L.push('Read-only. Zero board write-back. Owner-only delivery. Nothing is assigned, moved, or deleted in ServiceTitan.');
  L.push('');
  L.push('Threshold: jobs sitting in Unassigned for ' + watch.thresholdMinutes + '+ minutes. Open jobs reviewed: ' + watch.reviewedCount + '. Flagged jobs: ' + watch.flaggedJobCount + '.');
  L.push('- Aged Unassigned: ' + watch.agedCount);
  L.push('- Blank skill tags: ' + watch.blankSkillCount);
  L.push('- Missing zone assignments: ' + watch.missingZoneCount);
  L.push('- Auto Mode exclusion risk (multi-tech / multi-day): ' + watch.autoModeExclusionCount);
  if (watch.headsUp && watch.headsUp.length) {
    L.push('');
    watch.headsUp.forEach(function (h) { L.push('Heads-up: ' + h); });
  }
  const section = function (title, rows, empty) {
    L.push('');
    L.push('## ' + title);
    L.push('');
    if (!rows.length) {
      L.push('- ' + empty);
      return;
    }
    rows.forEach(function (r) {
      L.push('- ' + r.label);
      r.flags.forEach(function (f) { L.push('  - ' + f.text); });
    });
  };
  section('Aged Unassigned', watch.agedUnassigned, 'No jobs have been sitting in Unassigned past the threshold.');
  section('Blank skill tags', watch.blankSkill, 'No open jobs are missing a skill tag.');
  section('Missing zone assignments', watch.missingZone, 'No open jobs are missing a zone assignment.');
  section('Auto Mode exclusion risk (multi-tech / multi-day)', watch.autoModeExclusionRisk, 'No open multi-tech or multi-day jobs were found.');
  L.push('');
  L.push('---');
  L.push(tag + 'Draft pack, not yet tested against a live ServiceTitan account. Read-only. Zero board write-back. Owner-only delivery.');
  const text = L.join('\n');
  const esc = function (x) { return x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const placeholderEmail = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.ownerEmail) || /@example\.(com|org|net)$/i.test(s.ownerEmail);
  const wantsEmail = s.delivery === 'email' || s.delivery === 'both';
  const wantsSlack = s.delivery === 'slack' || s.delivery === 'both';
  const smsParts = [
    tag.trim() + (s.testMode ? ' ' : '') + 'Aging alert: ' + watch.agedCount + ' unassigned ' + plural(watch.agedCount, 'job', 'jobs') + ' past ' + watch.thresholdMinutes + ' min',
    watch.blankSkillCount + ' blank skill, ' + watch.missingZoneCount + ' missing zone, ' + watch.autoModeExclusionCount + ' Auto Mode exclusion ' + plural(watch.autoModeExclusionCount, 'risk', 'risks'),
  ];
  if (watch.agedUnassigned.length) {
    smsParts.push(watch.agedUnassigned.slice(0, 2).map(function (r) { return r.jobId + ' (' + r.unassignedMinutes + 'm)'; }).join(', '));
  }
  const smsText = smsParts.join('. ') + '. Zero write-back.';
  const out = {
    subject: tag + 'Unassigned Aging Alert: ' + s.businessName + (asOf !== null ? ' (' + fmtDay(asOf, tz) + ' ' + fmtTime(asOf, tz) + ')' : ''),
    text: text,
    smsText: smsText,
    html: '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;white-space:pre-wrap">' + esc(text) + '</pre>',
    slackText: esc(text),
    emailTo: s.ownerEmail,
    slackChannel: s.ownerSlackChannel,
    sendEmail: wantsEmail && !placeholderEmail,
    sendSlack: wantsSlack && !isBlank(s.ownerSlackChannel),
    testMode: s.testMode,
    deliveryNotes: [],
  };
  if (wantsEmail && placeholderEmail) out.deliveryNotes.push('Email not sent: ownerEmail is blank, invalid, or still the example.com placeholder.');
  if (wantsSlack && isBlank(s.ownerSlackChannel)) out.deliveryNotes.push('Slack not sent: ownerSlackChannel is blank.');
  return out;
}

function loadAgingTestData(settings, dataset) {
  return Object.assign({}, dataset, {
    settings: Object.assign({}, settings, { asOf: dataset.referenceTime }),
  });
}

// @@END
module.exports = {
  DEFAULTS, AGING_DEFAULT_THRESHOLD_MINUTES, prepareSettings, prepareAgingSettings,
  parseCsv, parseCsvTable, headerKey, canonicalizeRows, toIsoInZone, parseCalendarDate, normalizeJobStatus,
  JOB_COLUMNS, TABLE_COLUMNS, JOB_STATUS_CANONICAL, mapAgingJob, mapCsvJob,
  normalizeJobsExport, datasetFromCsvFiles, datasetFromTables, datasetFromAgingTables, bookingQa, capacityFiller, kpiDigest,
  afterHoursHandoff, renderMessage, normalizeServiceTitan, normalizeAgingServiceTitan,
  loadTestData, loadAgingTestData, unassignedAgingWatch, renderAgingAlert,
  isUnassignedJob, isOpenJob, jobTechIds,
};
