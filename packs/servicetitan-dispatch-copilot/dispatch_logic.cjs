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
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(function (x) { return x !== ''; })) rows.push(row);
      row = [];
    } else { field += c; }
  }
  row.push(field);
  if (row.some(function (x) { return x !== ''; })) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map(function (h) { return h.trim(); });
  return rows.slice(1).map(function (r) {
    const o = {};
    header.forEach(function (h, i) { o[h] = r[i] === undefined ? '' : r[i].trim(); });
    return o;
  });
}

function datasetFromTables(settings, tables) {
  const t = tables || {};
  const headsUp = [];
  ['technicians', 'jobs', 'capacity', 'memberships', 'estimates', 'calls'].forEach(function (name) {
    if (!Array.isArray(t[name])) headsUp.push('CSV export "' + name + '.csv" was not found. Anything that needs it is skipped.');
  });
  const numOrNull = function (v) { return toNum(v, null); };
  return {
    settings: Object.assign({}, settings, { headsUp: (settings.headsUp || []).concat(headsUp) }),
    technicians: (t.technicians || []).map(function (r) {
      return { id: r.tech_id, name: r.name, trade: r.trade, salesCapable: toBool(r.sales_capable, false), shiftHours: numOrNull(r.shift_hours) };
    }),
    jobs: (t.jobs || []).map(function (r) {
      return {
        id: r.job_id, bookedAt: r.booked_at, start: r.scheduled_start, end: r.scheduled_end, status: r.status,
        techId: r.tech_id, customerName: r.customer_name, customerPhone: r.customer_phone, customerType: r.customer_type,
        jobType: r.job_type, equipmentType: r.equipment_type, equipmentAgeYears: numOrNull(r.equipment_age_years),
        address: r.address, priority: r.priority, arrivedAt: r.arrived_at, actualMinutes: numOrNull(r.actual_minutes),
        businessUnit: r.business_unit, summary: r.summary || '',
      };
    }),
    capacityWindows: (t.capacity || []).map(function (r) {
      return { id: r.window_id, businessUnit: r.business_unit, start: r.window_start, end: r.window_end, openSlots: toNum(r.open_slots, 0) };
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

// @@SECTION booking_qa
function bookingQa(data) {
  const s = data.settings;
  const tz = s.timezone;
  const asOf = parseTime(s.asOf);
  const since = asOf - s.bookingLookbackHours * HOUR;
  const jobs = data.jobs || [];
  const techs = data.technicians || [];
  const techById = {};
  techs.forEach(function (t) { techById[t.id] = t; });
  const open = { scheduled: true, dispatched: true };
  const reviewed = jobs.filter(function (j) {
    const b = parseTime(j.bookedAt);
    return b !== null && b >= since && b <= asOf && open[lc(j.status)] === true;
  });
  const repeatSince = asOf - s.repeatWindowDays * DAY;
  const overlaps = function (a, b) {
    const as = parseTime(a.start), ae = parseTime(a.end), bs = parseTime(b.start), be = parseTime(b.end);
    return as !== null && ae !== null && bs !== null && be !== null && as < be && bs < ae;
  };
  const flagged = [];
  reviewed.forEach(function (job) {
    const flags = [];
    if (isBlank(job.customerType)) flags.push({ code: 'missing_customer_type', text: 'Commercial vs residential not recorded' });
    if (isBlank(job.equipmentType)) flags.push({ code: 'missing_equipment_type', text: 'Equipment type not recorded' });
    if (job.equipmentAgeYears === null || job.equipmentAgeYears === undefined) flags.push({ code: 'missing_equipment_age', text: 'Equipment age not recorded' });
    const key = normAddr(job.address);
    if (key) {
      const priors = jobs.filter(function (o) {
        const st = parseTime(o.start);
        return o.id !== job.id && normAddr(o.address) === key && lc(o.status) === 'completed' && st !== null && st >= repeatSince && st <= asOf;
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
      const assigned = techById[job.techId];
      if (assigned && assigned.salesCapable) {
        routing = { status: 'already_sales_capable', suggested: [] };
      } else {
        const free = techs.filter(function (t) {
          if (!t.salesCapable || t.id === job.techId || lc(t.trade) !== lc(job.businessUnit)) return false;
          return !jobs.some(function (o) { return o.techId === t.id && open[lc(o.status)] === true && overlaps(o, job); });
        }).map(function (t) { return { id: t.id, name: t.name }; });
        routing = { status: free.length > 0 ? 'suggested' : 'none_free', suggested: free };
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
        assignedTech: techById[job.techId] ? techById[job.techId].name : 'unassigned',
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
    return st !== null && en !== null && en > st && st >= asOf && st < horizon && w.openSlots > 0;
  }).map(function (w) {
    return { id: w.id, businessUnit: w.businessUnit, startMs: parseTime(w.start), endMs: parseTime(w.end), openSlots: w.openSlots, left: w.openSlots };
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
    const od = dayDiff(String(m.nextServiceDue).slice(0, 10), today);
    if (od < s.membershipOverdueDays) return;
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
    return st !== null && localDate(st, tz) === reportDate && lc(j.status) === 'completed';
  });
  let missingMinutes = 0;
  const perTech = techs.map(function (t) {
    const mine = onDay.filter(function (j) { return j.techId === t.id; });
    let minutes = 0;
    mine.forEach(function (j) {
      if (j.actualMinutes === null || j.actualMinutes === undefined) missingMinutes++; else minutes += j.actualMinutes;
    });
    const shiftMinutes = t.shiftHours && t.shiftHours > 0 ? t.shiftHours * 60 : null;
    return {
      id: t.id, name: t.name, trade: t.trade, jobs: mine.length, minutes: minutes, shiftHours: t.shiftHours,
      utilizationPct: shiftMinutes === null ? null : round1(minutes / shiftMinutes * 100),
    };
  });
  const counted = perTech.filter(function (p) { return p.utilizationPct !== null; });
  const shiftTotal = counted.reduce(function (a, p) { return a + p.shiftHours * 60; }, 0);
  const minutesTotal = counted.reduce(function (a, p) { return a + p.minutes; }, 0);
  const team = shiftTotal > 0 ? { pct: round1(minutesTotal / shiftTotal * 100), minutes: minutesTotal, shiftMinutes: shiftTotal } : null;
  if (techs.length === 0) headsUp.push('Technician utilization could not be computed: no technicians in the data.');
  else if (team === null) headsUp.push('Technician utilization could not be computed: no technician has shift hours.');
  perTech.filter(function (p) { return p.utilizationPct === null; }).forEach(function (p) {
    headsUp.push(p.name + ' has no shift hours in the data, so utilization is not shown for them and they are left out of the team figure.');
  });
  if (missingMinutes > 0) headsUp.push(missingMinutes + ' completed ' + plural(missingMinutes, 'job has', 'jobs have') + ' no on-site minutes recorded and ' + plural(missingMinutes, 'is', 'are') + ' not counted in utilization.');

  const urgent = jobs.filter(function (j) {
    const st = parseTime(j.start);
    return (lc(j.priority) === 'emergency' || lc(j.priority) === 'same-day') && st !== null && localDate(st, tz) === reportDate && lc(j.status) !== 'canceled';
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
    L.push('  - ' + p.name + ' (' + p.trade + '): ' + (p.utilizationPct === null ? 'n/a' : fix1(p.utilizationPct) + '%') + ', ' + p.jobs + ' completed ' + plural(p.jobs, 'job'));
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
    return { id: String(t.id), name: t.name || ('Technician ' + t.id), trade: '', salesCapable: false, shiftHours: null };
  });
  const jobs = rows(raw.jobs).map(function (j) {
    const a = apptByJob[j.id] || {};
    const asg = assignByJob[j.id] || {};
    return {
      id: String(j.jobNumber || j.id), bookedAt: j.createdOn, start: a.start, end: a.end, status: j.jobStatus || '',
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
    return { id: String(m.id), customerName: 'Customer #' + (m.customerId || m.membershipId || m.id), customerPhone: '', businessUnit: '', plan: 'membership', status: 'active', nextServiceDue: m.date || m.nextServiceDate || '' };
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
const OPEN_JOB_STATUSES = ['unassigned', 'scheduled', 'pending', 'open', 'dispatched', 'in progress', 'hold', 'on hold'];
const TERMINAL_JOB_STATUSES = ['completed', 'canceled', 'cancelled', 'closed', 'done'];

function agingThresholdMinutes(s) {
  return toNum(s && s.agingThresholdMinutes, AGING_DEFAULT_THRESHOLD_MINUTES);
}

function prepareAgingSettings(cfg, nowMs) {
  const s = prepareSettings(cfg, nowMs);
  const n = toNum(cfg && cfg.agingThresholdMinutes, AGING_DEFAULT_THRESHOLD_MINUTES);
  s.agingThresholdMinutes = n > 0 ? n : AGING_DEFAULT_THRESHOLD_MINUTES;
  return s;
}

function splitIds(v) {
  if (isBlank(v)) return [];
  if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
  return String(v).split(/[,|;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function uniqueIds(list) {
  const out = [];
  const seen = {};
  (list || []).forEach(function (id) {
    const s = String(id || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  });
  return out;
}

function jobTechIds(job) {
  const fromList = uniqueIds(job.techIds || splitIds(job.tech_ids));
  if (fromList.length) return fromList;
  return uniqueIds(splitIds(job.techId || job.tech_id));
}

function isTerminalJob(job) {
  return TERMINAL_JOB_STATUSES.indexOf(lc(job.status)) !== -1;
}

function isOpenJob(job) {
  if (isTerminalJob(job)) return false;
  const st = lc(job.status);
  if (!st) return jobTechIds(job).length === 0;
  return OPEN_JOB_STATUSES.indexOf(st) !== -1;
}

function isUnassignedJob(job) {
  if (!isOpenJob(job)) return false;
  if (lc(job.status) === 'unassigned') return true;
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

function datasetFromAgingTables(settings, tables) {
  const t = tables || {};
  const headsUp = [];
  const jobsTable = Array.isArray(t.aging_jobs) ? t.aging_jobs : (Array.isArray(t.jobs) ? t.jobs : null);
  if (!jobsTable) headsUp.push('CSV export "aging_jobs.csv" or "jobs.csv" was not found. The aging watch is skipped.');
  const technicians = (t.technicians || []).map(function (r) {
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
    if (!isOpenJob(job)) return;
    const flags = [];
    const mins = isUnassignedJob(job) ? agingMinutes(job, asOfMs) : null;
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
  parseCsv, datasetFromTables, datasetFromAgingTables, bookingQa, capacityFiller, kpiDigest,
  afterHoursHandoff, renderMessage, normalizeServiceTitan, normalizeAgingServiceTitan,
  loadTestData, loadAgingTestData, unassignedAgingWatch, renderAgingAlert,
  isUnassignedJob, isOpenJob, jobTechIds,
};
