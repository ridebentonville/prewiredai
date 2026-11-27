#!/usr/bin/env node
/**
 * Test harness for the ServiceTitan Dispatch & Capacity Copilot pack (DRAFT v0.3.0).
 *
 *   node packs/servicetitan-dispatch-copilot/mock_servicetitan_test.cjs
 *
 * Local only. Reads workflow.n8n.json and fixtures/, never opens a network connection,
 * and never talks to ServiceTitan, Gmail, Slack, or anyone else. "Mock" here means the fictional
 * fixtures stand in for ServiceTitan data. It:
 *   1. Checks workflow.n8n.json for the safety guarantees (inactive, disabled schedules, testMode,
 *      read-only, no customer-send nodes, no secrets).
 *   2. Runs the 4 workflows two ways: the shared module, AND the JavaScript pulled out of the
 *      workflow's Code nodes (so the JSON is not just trusted), and asserts they agree.
 *   3. Asserts specific flags and KPI values derived from the fixtures.
 *   4. Overwrites sample_test_digest.md with the [TEST] digest produced by the workflow code.
 *   5. Checks unassigned-aging-watch.json the same way, runs the aging Code nodes, and
 *      overwrites sample_aging_alert.md.
 *   6. v0.3 CSV-Fallback Mode: tests the Jobs/Dispatch column mapper (human ServiceTitan headers,
 *      aliases, dates, malformed and empty input, missing required columns), checks
 *      servicetitan-csv-fallback-triage.json, runs its Code nodes on fixtures/sample-servicetitan-export.csv,
 *      and overwrites sample_csv_fallback_digest.md.
 * Exit code 0 only if every assertion passes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const logic = require('./dispatch_logic.cjs');

const HERE = __dirname;
const wfText = fs.readFileSync(path.join(HERE, 'workflow.n8n.json'), 'utf8');
let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('returned false');
    passed++;
  } catch (e) {
    failures.push(name + ': ' + (e && e.message ? e.message.split('\n')[0] : e));
  }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; } catch (e) { failures.push(name + ': ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

// ---------------------------------------------------------------- 1. workflow safety
let wf;
check('workflow.n8n.json is valid JSON', () => { wf = JSON.parse(wfText); return !!wf; });
if (!wf) { console.log('FATAL: workflow.n8n.json did not parse'); process.exit(1); }
const nodes = wf.nodes;
const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
const exec = nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
const cfgNode = byName['Config'];
const cfgVals = Object.fromEntries(cfgNode.parameters.assignments.assignments.map((a) => [a.name, a.value]));

check('workflow is inactive (active === false)', () => assert.strictEqual(wf.active, false));
check('has a Manual Test Run trigger', () => assert.ok(nodes.some((n) => n.type === 'n8n-nodes-base.manualTrigger')));
check('has at least one Schedule trigger, and every Schedule/cron trigger is disabled', () => {
  const s = nodes.filter((n) => /scheduleTrigger|cron/i.test(n.type));
  assert.ok(s.length >= 1);
  assert.ok(s.every((n) => n.disabled === true));
});
check('schedule fires at 7:00', () => {
  const s = nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  assert.strictEqual(s.parameters.rule.interval[0].triggerAtHour, 7);
});
check('Config testMode defaults to true', () => assert.strictEqual(cfgVals.testMode, true));
check('Config source defaults to test (never servicetitan) and is a known value', () => {
  assert.ok(['test', 'csv'].includes(cfgVals.source));
  assert.ok(['test', 'csv', 'servicetitan'].includes(cfgVals.source));
});
check('Config timezone and businessName placeholder', () => {
  assert.strictEqual(cfgVals.timezone, 'America/Chicago');
  assert.strictEqual(cfgVals.businessName, 'Your Business Name');
});
check('Config has owner-only delivery fields and ServiceTitan paste-here placeholders', () => {
  assert.ok('ownerEmail' in cfgVals && 'ownerSlackChannel' in cfgVals && 'delivery' in cfgVals);
  assert.match(cfgVals.stTenantId, /^PASTE_.*_HERE$/);
  assert.match(cfgVals.stAppKey, /^PASTE_.*_HERE$/);
});
check('Config has sensible thresholds', () => {
  assert.strictEqual(cfgVals.digestHour, 7);
  assert.strictEqual(cfgVals.membershipOverdueDays, 30);
  assert.strictEqual(cfgVals.estimateStaleDays, 7);
  assert.strictEqual(cfgVals.replacementAgeYears, 12);
});
check('settings.executionOrder is v1 and settings.timezone is America/Chicago', () => {
  assert.strictEqual(wf.settings.executionOrder, 'v1');
  assert.strictEqual(wf.settings.timezone, 'America/Chicago');
});
check('node ids and names are unique', () => {
  assert.strictEqual(new Set(nodes.map((n) => n.id)).size, nodes.length);
  assert.strictEqual(new Set(nodes.map((n) => n.name)).size, nodes.length);
});
check('every connection source and target exists', () => {
  Object.entries(wf.connections).forEach(([from, v]) => {
    assert.ok(byName[from], 'missing source ' + from);
    v.main.forEach((outs) => outs.forEach((o) => assert.ok(byName[o.node], 'missing target ' + o.node)));
  });
});
check('only real n8n node types from the allowed set', () => {
  const allowed = new Set(['manualTrigger', 'scheduleTrigger', 'set', 'if', 'code', 'httpRequest', 'readWriteFile', 'gmail', 'slack', 'stickyNote'].map((t) => 'n8n-nodes-base.' + t));
  nodes.forEach((n) => assert.ok(allowed.has(n.type), 'unexpected type ' + n.type));
});
check('no customer-facing send nodes (no Twilio, SMS, or similar)', () => {
  nodes.forEach((n) => {
    assert.ok(!/twilio|sms|whatsapp|messagebird|vonage|sendgrid|mailgun|telegram/i.test(n.type + ' ' + n.name), n.name);
  });
  const senders = exec.filter((n) => /gmail|slack|emailSend/.test(n.type));
  assert.strictEqual(senders.length, 2);
});
check('email and Slack recipients come only from the owner Config fields', () => {
  assert.strictEqual(byName['Email owner (Gmail)'].parameters.sendTo, '={{ $json.emailTo }}');
  assert.ok(byName['Post to owner Slack'].parameters.channelId.value.includes('$json.slackChannel'));
  const asm = byName['Assemble Owner Message'].parameters.jsCode;
  assert.ok(asm.includes('emailTo: s.ownerEmail') && asm.includes('slackChannel: s.ownerSlackChannel'));
});
check('every HTTP Request node is a GET (no POST/PUT/PATCH/DELETE to ServiceTitan)', () => {
  const http = nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.ok(http.length >= 6);
  http.forEach((n) => assert.strictEqual(n.parameters.method, 'GET', n.name));
  assert.ok(!/"method":\s*"(POST|PUT|PATCH|DELETE)"/i.test(wfText));
});
check('Code nodes make no network or file calls', () => {
  nodes.filter((n) => n.type === 'n8n-nodes-base.code').forEach((n) => {
    assert.ok(!/fetch\(|require\(|XMLHttpRequest|helpers\.(httpRequest|request)|\$http|child_process|\bfs\./.test(n.parameters.jsCode), n.name);
  });
});
check('ServiceTitan HTTP branch is unreachable in the default config', () => {
  const gate = byName['Source is ServiceTitan?'].parameters.conditions.conditions[0];
  assert.strictEqual(gate.rightValue, 'servicetitan');
  assert.strictEqual(gate.operator.operation, 'equals');
  const truthy = wf.connections['Source is ServiceTitan?'].main[0].map((o) => o.node);
  assert.deepStrictEqual(truthy, ['ServiceTitan: Jobs']);
  const s = logic.prepareSettings(cfgVals, Date.now());
  assert.notStrictEqual(s.source, 'servicetitan');
  // nothing but the gate's true output leads to an HTTP node
  const httpNames = new Set(nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest').map((n) => n.name));
  Object.entries(wf.connections).forEach(([from, v]) => v.main.forEach((outs, idx) => outs.forEach((o) => {
    if (httpNames.has(o.node) && !httpNames.has(from)) assert.ok(from === 'Source is ServiceTitan?' && idx === 0, from + ' -> ' + o.node);
  })));
});
check('unknown or tricky source values fall back to test, and source "test" forces testMode', () => {
  assert.strictEqual(logic.prepareSettings({ source: 'live' }, 0).source, 'test');
  assert.strictEqual(logic.prepareSettings({ source: '' }, 0).source, 'test');
  const s = logic.prepareSettings({ source: 'test', testMode: false }, 0);
  assert.strictEqual(s.testMode, true);
  assert.ok(s.headsUp.length >= 1);
  assert.strictEqual(logic.prepareSettings({ source: ' ServiceTitan ', testMode: 'false' }, 0).testMode, false);
});
check('credentials are placeholders only; no pinData', () => {
  nodes.forEach((n) => Object.values(n.credentials || {}).forEach((c) => assert.match(c.id, /^PLACEHOLDER_[A-Z_]+$/)));
  const ids = new Set(nodes.flatMap((n) => Object.values(n.credentials || {}).map((c) => c.id)));
  ['PLACEHOLDER_SERVICETITAN', 'PLACEHOLDER_GMAIL', 'PLACEHOLDER_SLACK'].forEach((id) => assert.ok(ids.has(id), id));
  assert.ok(!('pinData' in wf));
});
check('no secret-looking values in the workflow', () => {
  assert.ok(!/xox[bap]-|sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{12,}|client_secret|-----BEGIN|AKIA[0-9A-Z]{12}|\b[0-9a-f]{32,}\b/i.test(wfText));
});
// Pattern is assembled from fragments so this file itself contains none of the banned strings.
const BANNED = new RegExp([['viv', 'int'], ['bri', 'nks'], ['home\\s*sec', 'urity'], ['smart[-\\s]?', 'home'], ['alarm\\s+', 'company']].map((p) => p.join('')).join('|'), 'i');
check('no banned brand or category strings in workflow, logic, fixtures, or this test', () => {
  const files = ['workflow.n8n.json', 'unassigned-aging-watch.json', 'dispatch_logic.cjs', 'build_workflow.cjs', 'build_aging_workflow.cjs', 'build_csv_fallback_workflow.cjs', 'servicetitan-csv-fallback-triage.json', 'README.md', 'CHANGELOG.md']
    .concat(fs.readdirSync(path.join(HERE, 'fixtures')).map((f) => path.join('fixtures', f)));
  files.forEach((f) => {
    const t = fs.readFileSync(path.join(HERE, f), 'utf8');
    assert.ok(!BANNED.test(t), f);
  });
  assert.ok(!BANNED.test(fs.readFileSync(__filename, 'utf8')), 'test file itself');
});
check('sticky notes exist and explain config, safety, and CSV fallback', () => {
  const notes = nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').map((n) => n.parameters.content).join('\n');
  assert.ok(/Config fields/.test(notes) && /Safety defaults/.test(notes) && /CSV export fallback/.test(notes) && /UNVERIFIED/.test(notes));
});
check('Code nodes are generated from dispatch_logic.cjs', () => {
  nodes.filter((n) => n.type === 'n8n-nodes-base.code').forEach((n) => assert.match(n.parameters.jsCode, /^\/\/ Generated from dispatch_logic\.cjs/));
});
const nodeCount = { exec: exec.length, sticky: nodes.length - exec.length, total: nodes.length };
let aging = { nodeCount: null };


// ---------------------------------------------------------------- 2. run the workflow's own code
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function runNode(name, { input, named, buffers }) {
  const fn = new AsyncFunction('$input', '$', byName[name].parameters.jsCode);
  const items = Array.isArray(input) ? input : [{ json: input }];
  const $input = { first: () => items[0], all: () => items };
  const $ = (n) => {
    if (!(n in (named || {}))) throw new Error('node ' + n + ' not available');
    return { first: () => ({ json: named[n] }), all: () => [{ json: named[n] }] };
  };
  const ctx = { helpers: { getBinaryDataBuffer: async (i) => buffers[i] } };
  const out = await fn.call(ctx, $input, $);
  return out[0].json;
}
const REF = '2026-03-10T07:00:00-05:00';
async function runChain(cfgOverrides, loader) {
  const cfg = Object.assign({}, cfgVals, { businessName: 'Cedar Ridge Mechanical (fictional sample)' }, cfgOverrides);
  const prep = await runNode('Prepare Settings', { input: cfg });
  let d = await loader(prep);
  d = await runNode('1. Booking QA & Skill-Tier Routing', { input: d });
  d = await runNode('2. Open-Capacity & Unsold-Estimate Filler', { input: d });
  d = await runNode('3. Morning Dispatch KPI Digest', { input: d });
  d = await runNode('4. After-Hours Handoff Summary', { input: d });
  const msg = await runNode('Assemble Owner Message', { input: d });
  return { data: d, msg };
}
const loadBuiltin = (prep) => runNode('Load Built-in Test Data', { input: prep, named: { 'Prepare Settings': prep } });
const fixtureDir = path.join(HERE, 'fixtures');
const csvFiles = ['technicians', 'jobs', 'capacity', 'memberships', 'estimates', 'calls'];
const loadCsv = (prep) => runNode('Parse CSV Exports', {
  input: csvFiles.map((n) => ({ json: {}, binary: { data: { fileName: n + '.csv' } } })),
  named: { 'Prepare Settings': prep },
  buffers: csvFiles.map((n) => fs.readFileSync(path.join(fixtureDir, n + '.csv'))),
});

(async () => {
  let wfRun, csvRun;
  await checkAsync('workflow Code nodes run end to end on the built-in test data', async () => { wfRun = await runChain({}, loadBuiltin); assert.ok(wfRun.msg.text.length > 500); });
  await checkAsync('workflow Code nodes run end to end on the CSV fixtures (csv source)', async () => {
    csvRun = await runChain({ source: 'csv', asOfOverride: REF }, loadCsv);
    assert.ok(csvRun.msg.text.length > 500);
  });
  if (!wfRun || !csvRun) { report(); return; }
  const d = wfRun.data;

  check('built-in test data equals the CSV fixtures (embedded copy is in sync)', () => {
    assert.deepStrictEqual(
      { t: d.technicians, j: d.jobs, c: d.capacityWindows, m: d.memberships, e: d.estimates, k: d.calls },
      { t: csvRun.data.technicians, j: csvRun.data.jobs, c: csvRun.data.capacityWindows, m: csvRun.data.memberships, e: csvRun.data.estimates, k: csvRun.data.calls });
  });
  check('csv source and test source produce the same digest, apart from the source label and sample-data banner', () => {
    const norm = (t) => t.replace('source: csv', 'source: X').replace('source: test', 'source: X').replace(' Built from fictional sample data.', '');
    assert.strictEqual(norm(csvRun.msg.text), norm(wfRun.msg.text));
    assert.deepStrictEqual(csvRun.data.kpis, wfRun.data.kpis);
    assert.deepStrictEqual(csvRun.data.capacity, wfRun.data.capacity);
  });
  check('workflow code output matches the shared module output', () => {
    assert.deepStrictEqual(d.bookingQa, logic.bookingQa(d));
    assert.deepStrictEqual(d.capacity, logic.capacityFiller(d));
    assert.deepStrictEqual(d.kpis, logic.kpiDigest(d));
    assert.deepStrictEqual(d.afterHours, logic.afterHoursHandoff(d));
  });

  // ---------------- 3. fixture-derived expectations
  const qa = d.bookingQa, cap = d.capacity, k = d.kpis, ah = d.afterHours;
  const flagOf = (id) => qa.flagged.find((f) => f.jobId === id);
  const codes = (id) => flagOf(id).flags.map((f) => f.code);

  // Workflow 1: Booking QA
  check('QA: 7 newly booked open jobs reviewed (completed, canceled, and older bookings excluded)', () => assert.strictEqual(qa.reviewedCount, 7));
  check('QA: 5 jobs flagged, in this order', () => assert.deepStrictEqual(qa.flagged.map((f) => f.jobId), ['J1102', 'J1103', 'J1104', 'J1108', 'J1109']));
  check('QA: J1102 flagged only for missing equipment age', () => assert.deepStrictEqual(codes('J1102'), ['missing_equipment_age']));
  check('QA: J1108 flagged for missing customer type, equipment type, and equipment age', () =>
    assert.deepStrictEqual(codes('J1108'), ['missing_customer_type', 'missing_equipment_type', 'missing_equipment_age']));
  check('QA: J1109 flagged as repeat address with 2 priors (the 2025 visit is outside the window)', () => {
    assert.deepStrictEqual(codes('J1109'), ['repeat_address']);
    assert.match(flagOf('J1109').flags[0].text, /2 completed visits/);
    assert.match(flagOf('J1109').flags[0].text, /Thu Feb 12/);
  });
  check('QA: J1103 (17-year-old condenser, non-sales tech) is a replacement opportunity routed to Dana Whitfield', () => {
    assert.deepStrictEqual(codes('J1103'), ['replacement_opportunity']);
    assert.strictEqual(flagOf('J1103').routing.status, 'suggested');
    assert.deepStrictEqual(flagOf('J1103').routing.suggested.map((t) => t.name), ['Dana Whitfield']);
  });
  check('QA: J1104 (14-year-old water heater) is an opportunity but the sales-capable plumber is busy', () => {
    assert.deepStrictEqual(codes('J1104'), ['replacement_opportunity']);
    assert.strictEqual(flagOf('J1104').routing.status, 'none_free');
  });
  check('QA: clean jobs and out-of-scope jobs are not flagged (J1101, J1107, J1106 older booking, J1110 canceled)', () =>
    ['J1101', 'J1107', 'J1106', 'J1110'].forEach((id) => assert.ok(!flagOf(id), id)));
  check('QA: routing is a suggestion only (the output has no reassignment field and jobs keep their techs)', () => {
    const fromCsv = logic.datasetFromTables(d.settings, Object.fromEntries(csvFiles.map((n) => [n, logic.parseCsv(fs.readFileSync(path.join(fixtureDir, n + '.csv'), 'utf8'))])));
    d.jobs.forEach((j) => assert.strictEqual(j.techId, fromCsv.jobs.find((o) => o.id === j.id).techId));
    qa.flagged.forEach((f) => assert.ok(!('newTechId' in f) && !('reassignTo' in f)));
  });

  // Workflow 2: capacity filler
  check('Capacity: 4 open windows, 5 slots, 10.0 hours (past and out-of-range windows excluded)', () => {
    assert.strictEqual(cap.openWindowCount, 4);
    assert.strictEqual(cap.openSlots, 5);
    assert.strictEqual(cap.openHours, 10);
    assert.deepStrictEqual(cap.windows.map((w) => w.id), ['W01', 'W02', 'W03', 'W04']);
  });
  check('Capacity: 4 overdue memberships (cancelled, not-yet-due, and under-30-day plans excluded)', () => assert.strictEqual(cap.overdueMembershipCount, 4));
  check('Capacity: 5 open estimates, 3 unworked worth $21,450', () => {
    assert.strictEqual(cap.openEstimateCount, 5);
    assert.strictEqual(cap.unworkedEstimates.count, 3);
    assert.strictEqual(cap.unworkedEstimates.total, 21450);
    assert.deepStrictEqual(cap.unworkedEstimates.items.map((i) => i.id), ['E01', 'E02', 'E04']);
  });
  check('Capacity: callback queue is 5 customers in window order; Ramon Keller does not fit', () => {
    assert.deepStrictEqual(cap.queue.map((q) => q.customerName), ['Tamsin Okoye', 'Wendell Pruitt', 'Fiona Achterberg', 'Dov Ashgrove', 'Odette Marsh']);
    assert.deepStrictEqual(cap.queue.map((q) => q.windowId), ['W01', 'W01', 'W02', 'W03', 'W04']);
    assert.deepStrictEqual(cap.overflow.map((o) => o.customerName), ['Ramon Keller']);
  });
  check('Capacity: a customer with an unsold estimate AND an overdue membership appears once with both reasons', () => {
    const w = cap.queue.filter((q) => q.customerName === 'Wendell Pruitt');
    assert.strictEqual(w.length, 1);
    assert.strictEqual(w[0].reasons.length, 2);
    assert.match(w[0].reasons.join(' '), /overdue 49 days/);
  });
  check('Capacity: every queue row is labeled DRAFT and the queue has no send fields', () => {
    cap.queue.forEach((q) => { assert.match(q.note, /^DRAFT/); assert.ok(!('sent' in q) && !('message' in q)); });
  });

  // Workflow 3: KPIs
  check('KPI: report day is the previous local day (2026-03-09)', () => assert.strictEqual(k.reportDate, '2026-03-09'));
  check('KPI: team utilization 61.0% (1464 of 2400 shift minutes)', () => {
    assert.strictEqual(k.utilization.team.pct, 61);
    assert.strictEqual(k.utilization.team.minutes, 1464);
    assert.strictEqual(k.utilization.team.shiftMinutes, 2400);
  });
  check('KPI: per-tech utilization 62.5 / 75 / 50 / 87.5 / 30 and n/a for the tech with no shift hours', () => {
    assert.deepStrictEqual(k.utilization.perTech.map((p) => p.utilizationPct), [62.5, 75, 50, 87.5, 30, null]);
  });
  check('KPI: response time averages 55.0 min, max 90, over 3 jobs, 1 job missing an arrival', () => {
    assert.deepStrictEqual(k.responseTime, { count: 3, avgMinutes: 55, maxMinutes: 90, missing: 1 });
  });
  check('KPI: open capacity and unworked estimates come from workflow 2; QA counts from workflow 1', () => {
    assert.deepStrictEqual(k.openCapacity, { hours: 10, slots: 5, windows: 4, lookaheadDays: 2 });
    assert.deepStrictEqual(k.unworkedEstimates, { count: 3, total: 21450 });
    assert.deepStrictEqual(k.bookingQa, { reviewed: 7, flagged: 5 });
  });
  check('KPI: exactly two Heads-up lines (no shift hours; missing arrival time), nothing invented', () => {
    assert.strictEqual(k.headsUp.length, 2);
    assert.match(k.headsUp[0], /Gil Ramsey has no shift hours/);
    assert.match(k.headsUp[1], /1 emergency or same-day job on 2026-03-09 has no usable arrival time/);
  });
  check('KPI: a metric that cannot be computed becomes a Heads-up, not a number (empty data)', () => {
    const empty = { settings: logic.prepareSettings({ source: 'test' }, Date.parse(REF)), technicians: [], jobs: [], capacityWindows: [], memberships: [], estimates: [], calls: null };
    const e = Object.assign({}, empty);
    e.bookingQa = logic.bookingQa(e); e.capacity = logic.capacityFiller(e);
    e.kpis = logic.kpiDigest(e); e.afterHours = logic.afterHoursHandoff(e);
    assert.strictEqual(e.kpis.utilization.team, null);
    assert.strictEqual(e.kpis.responseTime, null);
    assert.ok(e.kpis.headsUp.length >= 2);
    assert.strictEqual(e.afterHours.computed, false);
    const m = logic.renderMessage(e);
    assert.ok(!/NaN|undefined|null|Infinity/.test(m.text), 'bad token in message');
    assert.ok(/Heads-up:/.test(m.text));
  });

  // Workflow 4: after-hours handoff
  check('Handoff: window runs 5:00 PM yesterday to 7:00 AM', () => assert.strictEqual(ah.windowLabel, 'Mon Mar 9 5:00 PM to Tue Mar 10 7:00 AM'));
  check('Handoff: 4 overnight emergencies (2 need action, 2 resolved), 1 non-emergency, daytime call excluded', () => {
    assert.strictEqual(ah.emergencyCount, 4);
    assert.strictEqual(ah.needsActionCount, 2);
    assert.strictEqual(ah.resolvedCount, 2);
    assert.strictEqual(ah.nonEmergencyCount, 1);
    assert.ok(!ah.calls.some((c) => c.id === 'C05'));
  });
  check('Handoff: needs-action calls come first, then resolved, each in time order', () =>
    assert.deepStrictEqual(ah.calls.map((c) => c.id), ['C02', 'C03', 'C01', 'C06']));
  check('Handoff: handled-by names are resolved; an unhandled call says so', () => {
    assert.strictEqual(ah.calls[0].handledBy, 'Luis Brandt');
    assert.strictEqual(ah.calls[1].handledBy, 'nobody recorded');
  });

  // Message and delivery
  const msg = wfRun.msg;
  check('Message is labeled [TEST] in subject, heading, and banner (testMode default)', () => {
    assert.match(msg.subject, /^\[TEST\] /);
    assert.match(msg.text, /^# \[TEST\] Morning Dispatch KPI Digest/);
    assert.match(msg.text, /> \[TEST\] Preview only/);
    assert.strictEqual(msg.testMode, true);
  });
  check('Message contains all four sections and the draft-only language', () => {
    ['## Dispatch KPIs', '## Booking QA & skill-tier routing', '## Dispatcher callback queue (DRAFT, nothing is sent)', '## After-hours handoff for the morning shift']
      .forEach((h) => assert.ok(msg.text.includes(h), h));
    assert.match(msg.text, /never texts or emails customers/);
  });
  await checkAsync('testMode off on the csv source drops the [TEST] label, still owner-only', async () => {
    const r = await runChain({ source: 'csv', asOfOverride: REF, testMode: false, ownerEmail: 'owner@cedarridge-sample.test' }, loadCsv);
    assert.ok(!/\[TEST\]/.test(r.msg.subject) && !/\[TEST\]/.test(r.msg.text));
    assert.strictEqual(r.msg.emailTo, 'owner@cedarridge-sample.test');
    assert.strictEqual(r.msg.sendEmail, true);
  });
  check('Placeholder owner address blocks the email send; Slack needs a channel', () => {
    assert.strictEqual(msg.sendEmail, false);
    assert.match(msg.deliveryNotes.join(' '), /example\.com placeholder/);
    assert.strictEqual(logic.renderMessage(Object.assign({}, d, { settings: Object.assign({}, d.settings, { delivery: 'none' }) })).sendEmail, false);
  });
  check('Message never contains the app key, tenant id, or any customer-send field', () => {
    assert.ok(!msg.text.includes('PASTE_APP_KEY_HERE') && !msg.text.includes('PASTE_TENANT_ID_HERE'));
    assert.deepStrictEqual(Object.keys(msg).sort(), ['deliveryNotes', 'emailTo', 'html', 'sendEmail', 'sendSlack', 'slackChannel', 'slackText', 'subject', 'testMode', 'text']);
  });

  // ---------------- parser + live-path mapper (synthetic data, no network)
  check('CSV parser handles quoted commas, quotes, CRLF, BOM, and blank trailing cells', () => {
    const rows = logic.parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""",\r\n\r\n1,2,3\r\n');
    assert.deepStrictEqual(rows, [{ a: 'x, y', b: 'he said "hi"', c: '' }, { a: '1', b: '2', c: '3' }]);
  });
  check('Missing CSV files become Heads-up lines, not crashes', () => {
    const ds = logic.datasetFromTables(logic.prepareSettings({ source: 'csv' }, 0), { jobs: [] });
    assert.ok(ds.settings.headsUp.length >= 5);
    assert.strictEqual(ds.calls, null);
  });
  await checkAsync('ServiceTitan mapper: synthetic API-shaped data becomes a dataset; capacity is derived; gaps stay blank', async () => {
    const raw = {
      jobs: { data: [{ id: 1, jobNumber: 'S-1', createdOn: '2026-03-09T20:00:00Z', jobStatus: 'Scheduled', customerId: 7, businessUnitId: 3 }], hasMore: true },
      appointments: { data: [{ id: 11, jobId: 1, start: '2026-03-10T15:00:00Z', end: '2026-03-10T17:00:00Z' }] },
      assignments: { data: [{ appointmentId: 11, jobId: 1, technicianId: 5 }] },
      technicians: { data: [{ id: 5, name: 'Synthetic Tech' }] },
      shifts: { data: [{ technicianId: 5, start: '2026-03-10T14:00:00Z', end: '2026-03-10T22:00:00Z' }] },
      estimates: { data: [] },
      memberships: { data: [] },
      calls: { error: 'boom' },
    };
    const ds = await runNode('Normalize ServiceTitan', { input: {}, named: Object.fromEntries([['Prepare Settings', { settings: logic.prepareSettings({ source: 'servicetitan' }, Date.parse(REF)) }]]
      .concat(Object.entries({ 'ServiceTitan: Jobs': raw.jobs, 'ServiceTitan: Appointments': raw.appointments, 'ServiceTitan: Appointment Assignments': raw.assignments, 'ServiceTitan: Technicians': raw.technicians, 'ServiceTitan: Technician Shifts': raw.shifts, 'ServiceTitan: Estimates': raw.estimates, 'ServiceTitan: Recurring Service Events': raw.memberships, 'ServiceTitan: Calls': raw.calls }))) });
    assert.strictEqual(ds.jobs[0].techId, '5');
    assert.strictEqual(ds.jobs[0].start, '2026-03-10T15:00:00Z');
    assert.strictEqual(ds.jobs[0].equipmentAgeYears, null);
    assert.deepStrictEqual(ds.capacityWindows.map((w) => [w.start, w.end]), [['2026-03-10T14:00:00.000Z', '2026-03-10T15:00:00.000Z'], ['2026-03-10T17:00:00.000Z', '2026-03-10T22:00:00.000Z']]);
    const hu = ds.settings.headsUp.join(' | ');
    assert.match(hu, /unverified first draft/);
    assert.match(hu, /"jobs" has more pages/);
    assert.match(hu, /"calls" read returned no usable data/);
  });
  check('Fixtures are fictional: sample names only, 555-01xx phones, "Sample" / "Fixture" addresses', () => {
    const calls = fs.readFileSync(path.join(fixtureDir, 'calls.csv'), 'utf8') + fs.readFileSync(path.join(fixtureDir, 'jobs.csv'), 'utf8');
    (calls.match(/\(\d{3}\) \d{3}-\d{4}/g) || []).forEach((p) => assert.match(p, /^\(555\) 010-/));
    assert.ok(!/\bLLC\b|\bInc\b|\.com\b/.test(calls));
  });

  // ---------------- 4. sample digest
  const header = '<!-- Generated by mock_servicetitan_test.cjs from the fixtures in fixtures/. Do not hand-edit; re-run the test to regenerate. -->\n\n';
  fs.writeFileSync(path.join(HERE, 'sample_test_digest.md'), header + msg.text + '\n');
  check('sample_test_digest.md was written and is labeled [TEST]', () => {
    const t = fs.readFileSync(path.join(HERE, 'sample_test_digest.md'), 'utf8');
    assert.ok(t.includes('# [TEST] Morning Dispatch KPI Digest') && t.includes('Booking QA') && t.includes('callback queue') && t.includes('After-hours handoff'));
    assert.ok(!BANNED.test(t));
  });

  // ---------------- 5. Unassigned-Job Aging Watch companion workflow
  const agingText = fs.readFileSync(path.join(HERE, 'unassigned-aging-watch.json'), 'utf8');
  let agingWf;
  check('unassigned-aging-watch.json is valid JSON', () => { agingWf = JSON.parse(agingText); return !!agingWf; });
  aging = { wf: agingWf, nodes: agingWf ? agingWf.nodes : [], byName: {}, exec: [], nodeCount: { exec: 0, sticky: 0, total: 0 } };
  if (agingWf) {
    aging.nodes = agingWf.nodes;
    aging.byName = Object.fromEntries(aging.nodes.map((n) => [n.name, n]));
    aging.exec = aging.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
    aging.nodeCount = { exec: aging.exec.length, sticky: aging.nodes.length - aging.exec.length, total: aging.nodes.length };
  }
  const agingCfgNode = aging.byName['Config'];
  const agingCfgVals = agingCfgNode
    ? Object.fromEntries(agingCfgNode.parameters.assignments.assignments.map((a) => [a.name, a.value]))
    : {};

  check('aging workflow is inactive (active === false)', () => assert.strictEqual(aging.wf.active, false));
  check('aging workflow has a Manual Test Run trigger', () => assert.ok(aging.nodes.some((n) => n.type === 'n8n-nodes-base.manualTrigger')));
  check('aging schedule is a disabled 15-minute interval', () => {
    const s = aging.nodes.filter((n) => /scheduleTrigger|cron/i.test(n.type));
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].disabled, true);
    assert.strictEqual(s[0].parameters.rule.interval[0].field, 'minutes');
    assert.strictEqual(s[0].parameters.rule.interval[0].minutesInterval, 15);
  });
  check('aging Config defaults: testMode on, source test, 20-minute threshold, paste-here placeholders', () => {
    assert.strictEqual(agingCfgVals.testMode, true);
    assert.ok(['test', 'csv'].includes(agingCfgVals.source));
    assert.strictEqual(agingCfgVals.agingThresholdMinutes, 20);
    assert.strictEqual(agingCfgVals.timezone, 'America/Chicago');
    assert.match(agingCfgVals.stTenantId, /^PASTE_.*_HERE$/);
    assert.match(agingCfgVals.stAppKey, /^PASTE_.*_HERE$/);
  });
  check('aging settings.executionOrder is v1 and timezone is America/Chicago', () => {
    assert.strictEqual(aging.wf.settings.executionOrder, 'v1');
    assert.strictEqual(aging.wf.settings.timezone, 'America/Chicago');
  });
  check('aging node ids and names are unique', () => {
    assert.strictEqual(new Set(aging.nodes.map((n) => n.id)).size, aging.nodes.length);
    assert.strictEqual(new Set(aging.nodes.map((n) => n.name)).size, aging.nodes.length);
  });
  check('aging every connection source and target exists', () => {
    Object.entries(aging.wf.connections).forEach(([from, v]) => {
      assert.ok(aging.byName[from], 'missing source ' + from);
      v.main.forEach((outs) => outs.forEach((o) => assert.ok(aging.byName[o.node], 'missing target ' + o.node)));
    });
  });
  check('aging only real n8n node types from the allowed set', () => {
    const allowed = new Set(['manualTrigger', 'scheduleTrigger', 'set', 'if', 'code', 'httpRequest', 'readWriteFile', 'gmail', 'slack', 'stickyNote'].map((t) => 'n8n-nodes-base.' + t));
    aging.nodes.forEach((n) => assert.ok(allowed.has(n.type), 'unexpected type ' + n.type));
  });
  check('aging has no customer-facing send nodes (no Twilio, SMS, or similar)', () => {
    aging.nodes.forEach((n) => {
      assert.ok(!/twilio|sms|whatsapp|messagebird|vonage|sendgrid|mailgun|telegram/i.test(n.type + ' ' + n.name), n.name);
    });
    const senders = aging.exec.filter((n) => /gmail|slack|emailSend/.test(n.type));
    assert.strictEqual(senders.length, 2);
  });
  check('aging email and Slack recipients come only from the owner Config fields', () => {
    assert.strictEqual(aging.byName['Email owner (Gmail)'].parameters.sendTo, '={{ $json.emailTo }}');
    assert.ok(aging.byName['Post to owner Slack'].parameters.channelId.value.includes('$json.slackChannel'));
    const asm = aging.byName['Assemble Aging Alert'].parameters.jsCode;
    assert.ok(asm.includes('renderAgingAlert'));
  });
  check('aging every HTTP Request node is a GET (read-only, zero board write-back)', () => {
    const http = aging.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
    assert.ok(http.length >= 4);
    http.forEach((n) => assert.strictEqual(n.parameters.method, 'GET', n.name));
    assert.ok(!/"method":\s*"(POST|PUT|PATCH|DELETE)"/i.test(agingText));
  });
  check('aging Code nodes make no network or file calls', () => {
    aging.nodes.filter((n) => n.type === 'n8n-nodes-base.code').forEach((n) => {
      assert.ok(!/fetch\(|require\(|XMLHttpRequest|helpers\.(httpRequest|request)|\$http|child_process|\bfs\./.test(n.parameters.jsCode), n.name);
    });
  });
  check('aging ServiceTitan HTTP branch is unreachable in the default config', () => {
    const gate = aging.byName['Source is ServiceTitan?'].parameters.conditions.conditions[0];
    assert.strictEqual(gate.rightValue, 'servicetitan');
    assert.strictEqual(gate.operator.operation, 'equals');
    const s = logic.prepareAgingSettings(agingCfgVals, Date.now());
    assert.notStrictEqual(s.source, 'servicetitan');
    const httpNames = new Set(aging.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest').map((n) => n.name));
    Object.entries(aging.wf.connections).forEach(([from, v]) => v.main.forEach((outs, idx) => outs.forEach((o) => {
      if (httpNames.has(o.node) && !httpNames.has(from)) assert.ok(from === 'Source is ServiceTitan?' && idx === 0, from + ' -> ' + o.node);
    })));
  });
  check('aging credentials are placeholders only; no pinData', () => {
    aging.nodes.forEach((n) => Object.values(n.credentials || {}).forEach((c) => assert.match(c.id, /^PLACEHOLDER_[A-Z_]+$/)));
    const ids = new Set(aging.nodes.flatMap((n) => Object.values(n.credentials || {}).map((c) => c.id)));
    ['PLACEHOLDER_SERVICETITAN', 'PLACEHOLDER_GMAIL', 'PLACEHOLDER_SLACK'].forEach((id) => assert.ok(ids.has(id), id));
    assert.ok(!('pinData' in aging.wf));
  });
  check('aging workflow has no secret-looking values', () => {
    assert.ok(!/xox[bap]-|sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{12,}|client_secret|-----BEGIN|AKIA[0-9A-Z]{12}|\b[0-9a-f]{32,}\b/i.test(agingText));
  });
  check('aging Code nodes are generated from dispatch_logic.cjs', () => {
    aging.nodes.filter((n) => n.type === 'n8n-nodes-base.code').forEach((n) => assert.match(n.parameters.jsCode, /^\/\/ Generated from dispatch_logic\.cjs/));
  });
  check('aging sticky notes explain config, safety, CSV fallback, and zero write-back', () => {
    const notes = aging.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').map((n) => n.parameters.content).join('\n');
    assert.ok(/Config fields/.test(notes) && /Safety defaults/.test(notes) && /CSV export fallback/.test(notes) && /UNVERIFIED/.test(notes));
    assert.ok(/zero board write-back/i.test(notes) && /agingThresholdMinutes/.test(notes));
  });

  async function runAgingNode(name, { input, named, buffers }) {
    const fn = new AsyncFunction('$input', '$', aging.byName[name].parameters.jsCode);
    const items = Array.isArray(input) ? input : [{ json: input }];
    const $input = { first: () => items[0], all: () => items };
    const $ = (n) => {
      if (!(n in (named || {}))) throw new Error('node ' + n + ' not available');
      return { first: () => ({ json: named[n] }), all: () => [{ json: named[n] }] };
    };
    const ctx = { helpers: { getBinaryDataBuffer: async (i) => buffers[i] } };
    const out = await fn.call(ctx, $input, $);
    return out[0].json;
  }
  const AGING_REF = fs.readFileSync(path.join(fixtureDir, 'aging_reference_time.txt'), 'utf8').trim();
  const loadAgingBuiltin = (prep) => runAgingNode('Load Built-in Test Data', { input: prep, named: { 'Prepare Settings': prep } });
  const loadAgingCsv = (prep) => runAgingNode('Parse CSV Exports', {
    input: [
      { json: {}, binary: { data: { fileName: 'technicians.csv' } } },
      { json: {}, binary: { data: { fileName: 'aging_jobs.csv' } } },
    ],
    named: { 'Prepare Settings': prep },
    buffers: [
      fs.readFileSync(path.join(fixtureDir, 'technicians.csv')),
      fs.readFileSync(path.join(fixtureDir, 'aging_jobs.csv')),
    ],
  });
  async function runAgingChain(cfgOverrides, loader) {
    const cfg = Object.assign({}, agingCfgVals, { businessName: 'Cedar Ridge Mechanical (fictional sample)' }, cfgOverrides);
    const prep = await runAgingNode('Prepare Settings', { input: cfg });
    let d = await loader(prep);
    d = await runAgingNode('Unassigned Aging Watch', { input: d });
    const msg = await runAgingNode('Assemble Aging Alert', { input: d });
    return { data: d, msg };
  }

  let agingRun, agingCsvRun;
  await checkAsync('aging Code nodes run end to end on the built-in test data', async () => {
    agingRun = await runAgingChain({}, loadAgingBuiltin);
    assert.ok(agingRun.msg.text.includes('[TEST] Unassigned Aging Alert'));
  });
  await checkAsync('aging Code nodes run end to end on the CSV fixtures (csv source)', async () => {
    agingCsvRun = await runAgingChain({ source: 'csv', asOfOverride: AGING_REF }, loadAgingCsv);
    assert.ok(agingCsvRun.msg.text.length > 400);
  });
  if (!agingRun || !agingCsvRun) { report(); return; }

  check('aging built-in test data equals the CSV fixtures (embedded copy is in sync)', () => {
    assert.deepStrictEqual(
      { t: agingRun.data.technicians, j: agingRun.data.jobs },
      { t: agingCsvRun.data.technicians, j: agingCsvRun.data.jobs });
  });
  check('aging csv source and test source produce the same alert, apart from the source label and sample-data banner', () => {
    const norm = (t) => t.replace('source: csv', 'source: X').replace('source: test', 'source: X').replace(' Built from fictional sample data.', '');
    assert.strictEqual(norm(agingCsvRun.msg.text), norm(agingRun.msg.text));
    assert.deepStrictEqual(agingCsvRun.data.agingWatch.agedUnassigned, agingRun.data.agingWatch.agedUnassigned);
  });
  check('aging workflow code output matches the shared module output', () => {
    assert.deepStrictEqual(agingRun.data.agingWatch, logic.unassignedAgingWatch(agingRun.data));
  });

  const aw = agingRun.data.agingWatch;
  const agingIds = (rows) => rows.map((r) => r.jobId);
  check('aging: default threshold is 20 minutes and 8 open jobs are reviewed (canceled and completed excluded)', () => {
    assert.strictEqual(aw.thresholdMinutes, 20);
    assert.strictEqual(aw.reviewedCount, 8);
    assert.strictEqual(aw.flaggedJobCount, 7);
  });
  check('aging: jobs sitting in Unassigned for 20+ minutes are flagged, under-threshold and terminal jobs are not', () => {
    assert.deepStrictEqual(agingIds(aw.agedUnassigned), ['J2008', 'J2001', 'J2002']);
    assert.deepStrictEqual(aw.agedUnassigned.map((r) => r.unassignedMinutes), [41, 32, 25]);
    assert.ok(!agingIds(aw.agedUnassigned).includes('J2003')); // 8 minutes, under threshold
    assert.ok(!agingIds(aw.agedUnassigned).includes('J2009')); // canceled
    assert.ok(!agingIds(aw.agedUnassigned).includes('J2010')); // completed
  });
  check('aging: raising the threshold to 30 minutes drops the 25-minute job and keeps the older two', () => {
    const w = logic.unassignedAgingWatch(Object.assign({}, agingRun.data, {
      settings: Object.assign({}, agingRun.data.settings, { agingThresholdMinutes: 30 }),
    }));
    assert.deepStrictEqual(agingIds(w.agedUnassigned), ['J2008', 'J2001']);
    assert.ok(!agingIds(w.agedUnassigned).includes('J2002'));
  });
  check('aging: lowering the threshold to 5 minutes also flags the 8-minute unassigned job', () => {
    const w = logic.unassignedAgingWatch(Object.assign({}, agingRun.data, {
      settings: Object.assign({}, agingRun.data.settings, { agingThresholdMinutes: 5 }),
    }));
    assert.deepStrictEqual(agingIds(w.agedUnassigned), ['J2008', 'J2001', 'J2002', 'J2003']);
  });
  check('aging: blank skill tags are flagged on open jobs only', () => {
    assert.deepStrictEqual(agingIds(aw.blankSkill), ['J2002', 'J2004', 'J2008']);
    assert.ok(!agingIds(aw.blankSkill).includes('J2010')); // completed, even with a blank skill
    assert.ok(aw.blankSkill.every((r) => r.flags.some((f) => f.code === 'blank_skill')));
  });
  check('aging: missing zone assignments are flagged on open jobs only', () => {
    assert.deepStrictEqual(agingIds(aw.missingZone), ['J2005', 'J2008']);
    assert.ok(aw.missingZone.every((r) => r.flags.some((f) => f.code === 'missing_zone')));
  });
  check('aging: multi-tech and multi-day jobs are flagged as Auto Mode exclusion risks', () => {
    assert.deepStrictEqual(agingIds(aw.autoModeExclusionRisk), ['J2006', 'J2007']);
    const kinds = Object.fromEntries(aw.autoModeExclusionRisk.map((r) => [r.jobId, r.flags.find((f) => f.code === 'automode_exclusion').kind]));
    assert.strictEqual(kinds.J2006, 'multi-tech');
    assert.strictEqual(kinds.J2007, 'multi-day');
    assert.match(aw.autoModeExclusionRisk.find((r) => r.jobId === 'J2007').label, /Wed Mar 11/);
  });
  check('aging: a fully tagged, under-threshold unassigned job is not flagged', () => {
    const flagged = new Set([].concat(agingIds(aw.agedUnassigned), agingIds(aw.blankSkill), agingIds(aw.missingZone), agingIds(aw.autoModeExclusionRisk)));
    assert.ok(!flagged.has('J2003'));
  });
  check('aging: [TEST] mode tags the subject, body, and SMS-length text; placeholder owner email is not sent', () => {
    assert.ok(agingRun.msg.subject.startsWith('[TEST] Unassigned Aging Alert:'));
    assert.ok(agingRun.msg.text.includes('# [TEST] Unassigned Aging Alert:'));
    assert.ok(agingRun.msg.smsText.startsWith('[TEST]'));
    assert.ok(agingRun.msg.smsText.includes('Zero write-back'));
    assert.strictEqual(agingRun.msg.testMode, true);
    assert.strictEqual(agingRun.msg.sendEmail, false);
    assert.ok(agingRun.msg.deliveryNotes.some((n) => /ownerEmail/.test(n)));
  });
  check('aging: testMode is forced on when source is test, even if Config tries to turn it off', () => {
    const s = logic.prepareAgingSettings({ source: 'test', testMode: false, agingThresholdMinutes: 20 }, 0);
    assert.strictEqual(s.testMode, true);
    assert.strictEqual(s.agingThresholdMinutes, 20);
  });
  check('aging: read-only enforcement — no write methods and no board-mutating language in the shipped JSON', () => {
    assert.ok(!/"method":\s*"(POST|PUT|PATCH|DELETE)"/i.test(agingText));
    assert.ok(/Zero board write-back/i.test(agingRun.msg.text));
    assert.ok(!/assign the job|reassign|write back to the board|PATCH the job/i.test(aging.byName['Unassigned Aging Watch'].parameters.jsCode));
  });

  const agingHeader = '<!-- Generated by mock_servicetitan_test.cjs from the fixtures in fixtures/. Do not hand-edit; re-run the test to regenerate. -->\n\n';
  fs.writeFileSync(path.join(HERE, 'sample_aging_alert.md'), agingHeader + agingRun.msg.text + '\n');
  check('sample_aging_alert.md was written and is labeled [TEST]', () => {
    const t = fs.readFileSync(path.join(HERE, 'sample_aging_alert.md'), 'utf8');
    assert.ok(t.includes('# [TEST] Unassigned Aging Alert') && t.includes('Aged Unassigned') && t.includes('Zero board write-back'));
    assert.ok(!BANNED.test(t));
  });

  // ---------------- 5b. v0.3 CSV-Fallback: column mapper / normalizer
  const TZ = 'America/Chicago';
  const sampleCsvText = fs.readFileSync(path.join(fixtureDir, 'sample-servicetitan-export.csv'), 'utf8');
  const SAMPLE_REF = fs.readFileSync(path.join(fixtureDir, 'sample_export_reference_time.txt'), 'utf8').trim();
  const sampleNorm = logic.normalizeJobsExport(sampleCsvText, { timezone: TZ });
  const jobOf = (id) => sampleNorm.jobs.find((j) => j.id === id);

  check('csv v0.3: sample export parses cleanly (16 data rows, all imported, nothing skipped, no Heads-up)', () => {
    assert.strictEqual(sampleNorm.ok, true);
    assert.strictEqual(sampleNorm.rowCount, 16);
    assert.strictEqual(sampleNorm.importedCount, 16);
    assert.strictEqual(sampleNorm.jobs.length, 16);
    assert.deepStrictEqual(sampleNorm.skipped, []);
    assert.deepStrictEqual(sampleNorm.headsUp, []);
    assert.deepStrictEqual(sampleNorm.missingRequired, []);
    assert.strictEqual(logic.parseCsv(sampleCsvText).length, 16);
    assert.strictEqual(logic.parseCsvTable(sampleCsvText).headers.length, 22);
  });
  check('csv v0.3: every sample header maps to an internal field (nothing unmapped)', () => {
    assert.strictEqual(Object.keys(sampleNorm.mapped).length, 22);
    assert.strictEqual(sampleNorm.mapped.job_id, 'Job #');
    assert.strictEqual(sampleNorm.mapped.skill, 'Required Skill');
    assert.strictEqual(sampleNorm.mapped.booked_at, 'Created On');
    assert.strictEqual(sampleNorm.mapped.tech_name, 'Technician');
  });
  check('csv v0.3: mapped fields land on the exact internal job schema', () => {
    const j = jobOf('S3012');
    assert.deepStrictEqual(Object.keys(j).sort(), Object.keys(logic.mapCsvJob({})).concat(['assignedTechNames']).sort());
    assert.strictEqual(j.status, 'Scheduled');
    assert.strictEqual(j.start, '2026-03-12T18:00:00.000Z'); // 1:00 PM CDT
    assert.strictEqual(j.end, '2026-03-12T20:00:00.000Z');
    assert.strictEqual(j.bookedAt, '2026-03-12T11:20:00.000Z'); // 6:20 AM CDT
    assert.strictEqual(j.unassignedSince, '2026-03-12T11:20:00.000Z');
    assert.strictEqual(j.skill, 'Residential HVAC');
    assert.strictEqual(j.zone, 'North');
    assert.strictEqual(j.businessUnit, 'HVAC');
    assert.strictEqual(j.jobType, 'Repair');
    assert.strictEqual(j.customerName, 'Sample Household 3012');
    assert.strictEqual(j.customerPhone, '(555) 010-3012');
    assert.strictEqual(j.customerType, 'residential');
    assert.strictEqual(j.equipmentType, 'furnace');
    assert.strictEqual(j.equipmentAgeYears, 12);
    assert.strictEqual(j.priority, 'same-day');
    assert.match(j.address, /^36 Sample Cedar Ct/);
    assert.strictEqual(j.multiDay, false);
    assert.strictEqual(jobOf('S3017').multiDay, true);
    assert.strictEqual(jobOf('S3001').arrivedAt, '2026-03-11T13:05:00.000Z');
    assert.strictEqual(jobOf('S3001').actualMinutes, 105);
    assert.strictEqual(jobOf('S3010').equipmentAgeYears, null);
  });
  check('csv v0.3: technicians are derived from the Technician column (multi-tech split, "Unassigned" text is not a tech)', () => {
    assert.deepStrictEqual(sampleNorm.technicians.map((t) => t.name).sort(), ['Dana Whitfield', 'Marcus Hale', 'Priya Raman']);
    assert.deepStrictEqual(jobOf('S3016').techIds, ['Dana Whitfield', 'Marcus Hale']);
    assert.deepStrictEqual(jobOf('S3016').assignedTechNames, ['Dana Whitfield', 'Marcus Hale']);
    assert.deepStrictEqual(jobOf('S3015').techIds, []);
    assert.deepStrictEqual(jobOf('S3012').techIds, []);
    assert.strictEqual(jobOf('S3010').techId, 'Dana Whitfield');
  });
  check('csv v0.3: "Working" status is read as In Progress so an in-flight job counts as open', () => {
    assert.strictEqual(jobOf('S3020').status, 'In Progress');
    assert.ok(logic.isOpenJob(jobOf('S3020')));
  });
  check('csv v0.3: header aliases map to the right internal field', () => {
    const table = {
      job_id: ['Job #', 'Job Number', 'Job No', 'Job ID', 'JobId', 'job_id'],
      status: ['Status', 'Job Status', 'job_status'],
      scheduled_start: ['Scheduled Start', 'Start', 'Appointment Start', 'scheduled_start'],
      scheduled_end: ['Scheduled End', 'End', 'Appointment End', 'scheduled_end'],
      business_unit: ['Business Unit', 'Business Unit Name', 'BU', 'business_unit'],
      job_type: ['Job Type', 'Type', 'Type of Job', 'job_type'],
      skill: ['Required Skill', 'Skill', 'Tag', 'Required Tag', 'Job Tag', 'skill'],
      zone: ['Zone', 'Dispatch Zone', 'Zone Name', 'zone'],
      tech_name: ['Technician', 'Tech', 'Assigned Technician', 'Technician Name'],
      tech_id: ['Technician ID', 'tech_id'],
      tech_ids: ['tech_ids'],
      customer_name: ['Customer', 'Customer Name', 'customer_name'],
      booked_at: ['Created On', 'Booked On', 'Date Created', 'Booked At', 'booked_at'],
      priority: ['Priority'],
      address: ['Address', 'Location', 'Service Location', 'Service Address'],
      unassigned_since: ['Unassigned Since', 'Unassigned On', 'unassigned_since'],
      multi_day: ['Multi-Day', 'Multi Day', 'multi_day'],
      customer_phone: ['Customer Phone', 'Phone'],
      customer_type: ['Customer Type'],
      equipment_type: ['Equipment Type'],
      equipment_age_years: ['Equipment Age'],
      summary: ['Summary', 'Job Summary'],
      arrived_at: ['Arrived At', 'Arrival Time'],
      actual_minutes: ['Actual Minutes', 'Minutes On Site'],
    };
    Object.entries(table).forEach(([key, aliases]) => aliases.forEach((a) => {
      assert.strictEqual(logic.canonicalizeRows([], logic.JOB_COLUMNS, [a]).mapped[key], a, a + ' -> ' + key);
    }));
  });
  check('csv v0.3: header matching ignores case, whitespace, punctuation, and space/underscore/hyphen differences', () => {
    ['scheduled start', 'SCHEDULED START', '  Scheduled   Start ', 'scheduled_start', 'Scheduled-Start', 'scheduled.start'].forEach((h) => {
      assert.strictEqual(logic.canonicalizeRows([], logic.JOB_COLUMNS, [h]).mapped.scheduled_start, h, h);
    });
    ['Job #', 'job number', 'JOB_NUMBER', 'job-number', 'Job#'].forEach((h) => {
      assert.strictEqual(logic.canonicalizeRows([], logic.JOB_COLUMNS, [h]).mapped.job_id, h, h);
    });
    assert.strictEqual(logic.headerKey('Job #'), logic.headerKey('Job Number'));
    assert.strictEqual(logic.headerKey('Multi-Day'), logic.headerKey('multi_day'));
    assert.strictEqual(logic.headerKey('Multi Day'), logic.headerKey('MULTI-DAY'));
  });
  check('csv v0.3: Required Skill wins over Tag when both columns exist, and Technician ID wins for ids while Technician supplies names', () => {
    const r = logic.normalizeJobsExport('Job #,Status,Scheduled Start,Tag,Required Skill,Technician,Technician ID\nA1,Scheduled,3/12/2026 9:00 AM,tag-x,skill-y,Dana W,T01\n', { timezone: TZ });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.jobs[0].skill, 'skill-y');
    assert.deepStrictEqual(r.jobs[0].techIds, ['T01']);
    assert.deepStrictEqual(r.jobs[0].assignedTechNames, ['Dana W']);
    assert.deepStrictEqual(r.technicians, [{ tech_id: 'T01', name: 'Dana W', trade: '' }]);
  });
  check('csv v0.3: parser handles a BOM, CRLF line endings, quoted commas, and doubled quotes', () => {
    const txt = '﻿Job #,Status,Scheduled Start,Customer,Address\r\nB1,Scheduled,"3/12/2026 9:00 AM","Smith, ""Bob""","1 Sample Way, Testville"\r\n';
    const t = logic.parseCsvTable(txt);
    assert.deepStrictEqual(t.headers, ['Job #', 'Status', 'Scheduled Start', 'Customer', 'Address']);
    assert.strictEqual(t.rows[0].Customer, 'Smith, "Bob"');
    assert.strictEqual(t.rows[0].Address, '1 Sample Way, Testville');
    assert.strictEqual(logic.normalizeJobsExport(txt, { timezone: TZ }).jobs[0].customerName, 'Smith, "Bob"');
  });
  check('csv v0.3: date parsing is shop-local, DST-aware, and keeps ISO values with an offset untouched', () => {
    const z = (v) => logic.toIsoInZone(v, TZ);
    assert.strictEqual(z('3/10/2026 9:50 AM').iso, '2026-03-10T14:50:00.000Z'); // CDT
    assert.strictEqual(z('2026-03-10 09:50').iso, '2026-03-10T14:50:00.000Z');
    assert.strictEqual(z('3/7/2026 9:00 AM').iso, '2026-03-07T15:00:00.000Z'); // still CST the day before the change
    assert.strictEqual(z('3/8/2026 9:00 AM').iso, '2026-03-08T14:00:00.000Z'); // CDT starts Mar 8
    assert.strictEqual(z('3/10/2026 12:00 AM').iso, '2026-03-10T05:00:00.000Z');
    assert.strictEqual(z('3/10/2026 12:30 PM').iso, '2026-03-10T17:30:00.000Z');
    assert.strictEqual(z('3/10/2026').iso, '2026-03-10T05:00:00.000Z');
    assert.strictEqual(z('2026-03-10T09:50:00-05:00').iso, '2026-03-10T09:50:00-05:00');
    assert.strictEqual(z('2026-03-10T09:50:00Z').iso, '2026-03-10T09:50:00Z');
    assert.strictEqual(z('').iso, '');
    assert.strictEqual(logic.toIsoInZone('3/10/2026 9:50 AM', 'America/Denver').iso, '2026-03-10T15:50:00.000Z');
    ['13/45/2026 9:00 AM', 'tomorrow morning', '2/30/2026 9:00 AM', '3/10/2026 13:00 PM'].forEach((bad) => assert.strictEqual(z(bad).bad, true, bad));
  });
  check('CSV hardening: explicit Job Status wins in the reproduced split-start row', () => {
    const r = logic.normalizeJobsExport('Job #,Status,Job Status,Start Date,Start Time\nA1,Done,Scheduled,3/10/2026,9:50 AM', { timezone: TZ });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.jobs[0].status, 'Scheduled');
    assert.strictEqual(r.jobs[0].start, '2026-03-10T14:50:00.000Z');
    assert.ok(r.headsUp.some((h) => /Row 2.*conflicting status headers.*Used "Job Status"/.test(h)));
  });
  check('CSV hardening: complete starts win and incomplete starts fall back to their split date and time', () => {
    const r = logic.normalizeJobsExport([
      'Job #,Status,Scheduled Start,Appointment Start,Scheduled Date,Scheduled Time,End Date,End Time',
      'A1,Scheduled,9:00 AM,3/10/2026 11:00 AM,3/10/2026,9:50 AM,3/10/2026,2:00 PM',
      'A2,Scheduled,2026-03-10,,2026-03-10,9:50 AM,2026-03-10,2:00 PM',
      'A3,Scheduled,,,3/10/2026,bad clock,,',
    ].join('\n'), { timezone: TZ });
    assert.deepStrictEqual(r.jobs.map((j) => [j.start, j.end]), [
      ['2026-03-10T16:00:00.000Z', '2026-03-10T19:00:00.000Z'],
      ['2026-03-10T14:50:00.000Z', '2026-03-10T19:00:00.000Z'],
      ['', ''],
    ]);
    assert.ok(r.headsUp.some((h) => /row 4, job A3.*3\/10\/2026 bad clock/.test(h)));
  });
  check('CSV hardening: explicit job identity wins and competing identity or status headers surface conflicts', () => {
    const r = logic.normalizeJobsExport([
      'Invoice #,Job Number,Job #,Job ID,Status,Job-Status,JOB_STATUS,Scheduled Start',
      'I01,A1,A2,ST1,Done,Scheduled,Dispatched,3/10/2026 9:50 AM',
    ].join('\n'), { timezone: TZ });
    assert.strictEqual(r.jobs[0].id, 'A1');
    assert.strictEqual(r.jobs[0].status, 'Scheduled');
    assert.ok(r.headsUp.some((h) => /conflicting job_id headers.*Job Number.*Job #.*Job ID/.test(h)));
    assert.ok(r.headsUp.some((h) => /conflicting status headers.*Job-Status.*JOB_STATUS.*Status/.test(h)));
  });
  check('CSV hardening: exact duplicate headers reject the snapshot before values can overwrite', () => {
    const text = 'Job #,Status,Status,Scheduled Start\nA1,Done,Scheduled,3/10/2026 9:50 AM';
    const r = logic.normalizeJobsExport(text);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.jobs, []);
    assert.match(r.message, /duplicate CSV headers.*Status/i);
    const ds = logic.datasetFromCsvFiles(logic.prepareSettings({ source: 'csv' }, 0), [{ name: 'jobs.csv', text }]);
    assert.deepStrictEqual(ds.jobs, []);
    assert.ok(ds.settings.headsUp.some((h) => /duplicate CSV headers.*Status/i.test(h)));
  });
  check('CSV hardening: invoice numbers cannot key Jobs rows or mask a Jobs snapshot in a batch', () => {
    const invoice = 'Invoice Number,Status,Scheduled Start\nI01,Open,3/10/2026 9:50 AM';
    const r = logic.normalizeJobsExport(invoice);
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /missing required column.*Job #/);
    const ds = logic.datasetFromCsvFiles(logic.prepareSettings({ source: 'csv' }, 0), [
      { name: 'board.csv', text: 'Job #,Status,Scheduled Start\nA1,Scheduled,3/10/2026 9:50 AM' },
      { name: 'jobs-invoice.csv', text: invoice },
      { name: 'invoice-with-job-reference.csv', text: 'Invoice ID,Job Number,Status\nI02,A1,Open' },
    ]);
    assert.deepStrictEqual(ds.jobs.map((j) => j.id), ['A1']);
    assert.ok(ds.settings.headsUp.some((h) => /jobs-invoice\.csv.*was not recognized/.test(h)));
  });
  check('CSV hardening: a related Job Number in an invoice report does not replace the board', () => {
    const settings = logic.prepareSettings({ source: 'csv' }, 0);
    const ds = logic.datasetFromCsvFiles(settings, [{ name: 'report.csv', text: 'Invoice #,Job Number,Status\nI02,A1,Open' }]);
    assert.deepStrictEqual(ds.jobs, []);
    assert.match(ds.settings.headsUp.join(' '), /was not recognized/);
  });
  check('CSV hardening: DST gap is blanked and fold uses the earlier occurrence with a row Heads-up', () => {
    const ds = logic.datasetFromCsvFiles(logic.prepareSettings({ source: 'csv', timezone: TZ }, 0), [{
      name: 'board.csv',
      text: [
        'Job #,Status,Start Date,Start Time,Scheduled End',
        'Gap,Scheduled,3/8/2026,2:30 AM,',
        'Fold,Scheduled,11/1/2026,1:30 AM,2026-11-01T01:45:00-06:00',
      ].join('\n'),
    }]);
    assert.strictEqual(ds.jobs[0].start, '');
    assert.strictEqual(ds.jobs[1].start, '2026-11-01T06:30:00.000Z');
    assert.strictEqual(ds.jobs[1].end, '2026-11-01T01:45:00-06:00');
    assert.ok(ds.settings.headsUp.some((h) => /Row 2.*Gap.*3\/8\/2026 2:30 AM.*nonexistent.*left blank/.test(h)));
    assert.ok(ds.settings.headsUp.some((h) => /Row 3.*Fold.*11\/1\/2026 1:30 AM.*ambiguous.*earlier occurrence/.test(h)));
  });
  check('CSV hardening: offset timestamps are calendar-validated before parsing', () => {
    const r = logic.normalizeJobsExport('Job #,Status,Scheduled Start\nA1,Scheduled,2026-02-30T09:00:00Z');
    assert.strictEqual(r.jobs[0].start, '');
    assert.ok(r.headsUp.some((h) => /row 2, job A1.*2026-02-30T09:00:00Z/.test(h)));
    assert.strictEqual(logic.toIsoInZone('2026-02-29T09:00:00-06:00', TZ).bad, true);
    assert.strictEqual(logic.toIsoInZone('2028-02-29T09:00:00Z', TZ).iso, '2028-02-29T09:00:00Z');
  });
  check('CSV hardening: QA sees a sales-capable co-assignee and excludes a second assignee on overlapping work', () => {
    const settings = logic.prepareSettings({ source: 'csv', timezone: TZ, asOfOverride: '2026-03-11T07:00:00-05:00' }, 0);
    const ds = logic.datasetFromCsvFiles(settings, [
      { name: 'jobs.csv', text: [
        'Job #,Job Status,Scheduled Start,Scheduled End,Created On,Technician ID,Job Type,Equipment Age,Business Unit',
        'Covered,Scheduled,3/11/2026 9:00 AM,3/11/2026 11:00 AM,3/11/2026 6:00 AM,T1,Repair,15,HVAC',
        'Covered,Scheduled,3/11/2026 9:00 AM,3/11/2026 11:00 AM,3/11/2026 6:00 AM,T2,Repair,15,HVAC',
        'NeedsSales,Scheduled,3/11/2026 10:00 AM,3/11/2026 11:00 AM,3/11/2026 6:00 AM,T1,Repair,15,HVAC',
        'Busy,Working,3/11/2026 9:00 AM,3/11/2026 12:00 PM,,T1,Maintenance,,HVAC',
        'Busy,Working,3/11/2026 9:00 AM,3/11/2026 12:00 PM,,T3,Maintenance,,HVAC',
      ].join('\n') },
      { name: 'technicians.csv', text: [
        'Technician ID,Name,Trade,Shift Hours,Sales Capable',
        'T1,Dana,HVAC,8,No', 'T2,Avery,HVAC,8,Yes', 'T3,Ren,HVAC,8,Yes', 'T4,Sol,HVAC,8,Yes',
      ].join('\n') },
    ]);
    const flagged = logic.bookingQa(ds).flagged;
    assert.strictEqual(flagged.find((j) => j.jobId === 'Covered').routing.status, 'already_sales_capable');
    assert.deepStrictEqual(flagged.find((j) => j.jobId === 'NeedsSales').routing.suggested.map((t) => t.id), ['T4']);
  });
  check('CSV hardening: utilization excludes multi-tech job-level minutes in either row order', () => {
    const settings = logic.prepareSettings({ source: 'csv', timezone: TZ, asOfOverride: '2026-03-11T07:00:00-05:00' }, 0);
    const shared = [
      'Shared,Completed,3/10/2026 9:00 AM,T1,90',
      'Shared,Completed,3/10/2026 9:00 AM,T2,90',
    ];
    for (const rows of [shared, shared.slice().reverse()]) {
      const ds = logic.datasetFromCsvFiles(settings, [
        { name: 'jobs.csv', text: ['Job #,Status,Scheduled Start,Technician ID,Actual Minutes',
          ...rows, 'Solo,Completed,3/10/2026 9:00 AM,T3,60'].join('\n') },
        { name: 'techs.csv', text: 'Technician ID,Name,Trade,Shift Hours\nT1,Dana,Plumbing,8\nT2,Avery,Plumbing,8\nT3,Ren,Plumbing,8' },
      ]);
      const kpis = logic.kpiDigest(ds);
      assert.deepStrictEqual(kpis.utilization.perTech.map((p) => [p.jobs, p.minutes, p.utilizationPct]),
        [[1, 0, null], [1, 0, null], [1, 60, 12.5]]);
      assert.deepStrictEqual(kpis.utilization.team, { pct: 12.5, minutes: 60, shiftMinutes: 480 });
      assert.ok(kpis.headsUp.some((h) => /Shared.*job-level.*multiple technicians.*left out/.test(h)));
    }
  });
  check('CSV hardening: explicit multi-day Yes and case-insensitive name-to-ID matching survive either row order', () => {
    const rows = ['A1,Scheduled,3/10/2026 9:00 AM,Dana Whitfield,,No', 'A1,Scheduled,3/10/2026 9:00 AM,DANA WHITFIELD,T1,Yes'];
    for (const pair of [rows, rows.slice().reverse()]) {
      const r = logic.normalizeJobsExport(['Job #,Status,Scheduled Start,Technician,Technician ID,Multi-Day',
        ...pair, 'A2,Scheduled,3/10/2026 10:00 AM,dana whitfield,,'].join('\n'));
      assert.deepStrictEqual(r.jobs.map((j) => j.techIds), [['T1'], ['T1']]);
      assert.strictEqual(r.jobs[0].multiDay, true);
      assert.deepStrictEqual(r.technicians, [{ tech_id: 'T1', name: 'DANA WHITFIELD', trade: '' }]);
    }
  });
  check('CSV hardening: an ambiguous technician name is flagged without choosing either ID', () => {
    const r = logic.normalizeJobsExport([
      'Job #,Status,Scheduled Start,Technician,Technician ID',
      'A1,Scheduled,3/10/2026 9:00 AM,Dana,T1',
      'A2,Scheduled,3/10/2026 9:00 AM,Dana,T2',
      'A3,Scheduled,3/10/2026 9:00 AM,Dana,',
    ].join('\n'));
    assert.deepStrictEqual(r.jobs.map((j) => j.techIds), [['T1'], ['T2'], ['Dana']]);
    assert.ok(r.headsUp.some((h) => /dana.*matches multiple IDs.*T1.*T2/.test(h)));
  });
  check('CSV hardening: name-only and unlabeled ID-only assignments on the same job surface uncertainty', () => {
    const r = logic.normalizeJobsExport([
      'Job #,Status,Scheduled Start,Technician,Technician ID',
      'A1,Scheduled,3/10/2026 9:00 AM,Dana,',
      'A1,Scheduled,3/10/2026 9:00 AM,,T1',
    ].join('\n'));
    assert.deepStrictEqual(r.jobs[0].techIds, ['Dana', 'T1']);
    assert.ok(r.headsUp.some((h) => /Job A1.*name-only.*IDs without a reliable name.*could not be matched/.test(h)));
  });
  check('csv v0.3: malformed rows are skipped or blanked and counted in a Heads-up, never thrown', () => {
    const txt = [
      'Job #,Status,Scheduled Start,Scheduled End,Zone',
      'M1,Scheduled,3/12/2026 9:00 AM,3/12/2026 11:00 AM,North',
      ',Scheduled,3/12/2026 9:00 AM,3/12/2026 11:00 AM,North',
      ',,,,',
      'Total,,,,',
      'M2,Scheduled,not a date,3/12/2026 11:00 AM,South',
      'M3,Scheduled,3/12/2026 9:00 AM',
    ].join('\n');
    let r;
    assert.doesNotThrow(() => { r = logic.normalizeJobsExport(txt, { timezone: TZ }); });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.jobs.map((j) => j.id), ['M1', 'M2', 'M3']);
    assert.deepStrictEqual(r.skipped.map((s) => s.row), [3, 4]); // blank lines are not counted
    assert.strictEqual(r.jobs[1].start, ''); // unreadable date left blank
    assert.strictEqual(r.jobs[2].zone, ''); // short row padded
    assert.ok(r.headsUp.some((h) => /2 rows .* were skipped.*row 3 \(missing job id\)/.test(h)), r.headsUp.join('|'));
    assert.ok(r.headsUp.some((h) => /1 date value .* could not be read/.test(h) && /not a date/.test(h)), r.headsUp.join('|'));
  });
  check('csv v0.3: an unterminated quote is flagged and does not look like a complete successful import', () => {
    const txt = [
      'Job #,Status,Scheduled Start,Summary',
      'Q1,Scheduled,3/12/2026 9:00 AM,"unclosed summary',
      'Q2,Unassigned,3/12/2026 10:00 AM,ok',
    ].join('\n');
    let r;
    assert.doesNotThrow(() => { r = logic.normalizeJobsExport(txt, { timezone: TZ }); });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /never closed|swallowed/i);
    assert.ok(r.headsUp.some((h) => /never closed|swallowed/i.test(h)), r.headsUp.join('|'));
    assert.ok(r.jobs.length < 2, 'Q2 must not be silently imported as a second complete job after a broken quote');
    const t = logic.parseCsvTable(txt);
    assert.ok(t.warnings.some((w) => /never closed|swallowed/i.test(w)), t.warnings.join('|'));
  });
  check('CSV hardening: competing Jobs snapshots do not produce a board in either input order', () => {
    const files = [
      { name: 'older.csv', text: 'Job #,Status,Scheduled Start,Technician\nJ1,Completed,3/10/2026 9:00 AM,Avery\n' },
      { name: 'newer.csv', text: 'Job #,Status,Scheduled Start,Technician\nJ1,Unassigned,3/12/2026 9:00 AM,\n' },
    ];
    const s = logic.prepareAgingSettings({ source: 'csv', asOfOverride: '2026-03-12T07:00:00-05:00' }, 0);
    for (const batch of [files, files.slice().reverse()]) {
      const ds = logic.datasetFromCsvFiles(s, batch);
      assert.ok(!ds.jobs || ds.jobs.length === 0);
      assert.match(ds.settings.headsUp.join(' '), /Supply one Jobs\/Dispatch snapshot/);
    }
  });
  check('CSV hardening: malformed quoting or record widths reject the whole Jobs snapshot', () => {
    for (const record of ['1,Scheduled,2026-03-11,a"b"', '1,Scheduled,2026-03-11,"a"b',
      '1,Scheduled,2026-03-11,"unclosed', '1,Scheduled,2026-03-11,a,b']) {
      const csv = 'Job #,Status,Scheduled Start,Summary\n2,Scheduled,2026-03-11,ok\n' + record;
      const ds = logic.datasetFromCsvFiles({ timezone: TZ, headsUp: [] }, [{ name: 'jobs.csv', text: csv }]);
      assert.ok(!ds.jobs || ds.jobs.length === 0);
      assert.match(ds.settings.headsUp.join(' '), /CSV (?:data )?record 3/i);
    }
  });
  check('csv v0.3: repeated job rows (one per technician or appointment) merge into one job', () => {
    const txt = [
      'Job Number,Job Status,Appointment Start,Appointment End,Technician,Zone',
      'D1,Scheduled,3/12/2026 9:00 AM,3/12/2026 5:00 PM,Dana Whitfield,North',
      'D1,Scheduled,3/12/2026 9:00 AM,3/13/2026 10:00 AM,Marcus Hale,',
    ].join('\n');
    const r = logic.normalizeJobsExport(txt, { timezone: TZ });
    assert.strictEqual(r.jobs.length, 1);
    assert.deepStrictEqual(r.jobs[0].techIds, ['Dana Whitfield', 'Marcus Hale']);
    assert.strictEqual(r.jobs[0].zone, 'North');
    assert.strictEqual(r.jobs[0].end, '2026-03-13T15:00:00.000Z');
    assert.ok(r.headsUp.some((h) => /1 repeated job row was merged/.test(h)));
    const w = logic.unassignedAgingWatch({ settings: logic.prepareAgingSettings({ source: 'csv', asOfOverride: SAMPLE_REF }, 0), jobs: r.jobs });
    assert.strictEqual(w.autoModeExclusionRisk[0].flags.find((f) => f.code === 'automode_exclusion').kind, 'multi-tech-multi-day');
  });
  check('csv v0.3: empty input (empty string, whitespace, null, no rows array) gives a clear error and no crash', () => {
    ['', '   \n  ', null, undefined, []].forEach((x) => {
      let r;
      assert.doesNotThrow(() => { r = logic.normalizeJobsExport(x, { timezone: TZ }); });
      assert.strictEqual(r.ok, false);
      assert.deepStrictEqual(r.jobs, []);
      assert.match(r.message, /is empty/);
    });
  });
  check('csv v0.3: headers-only CSV gives a clear "no job rows" error', () => {
    const r = logic.normalizeJobsExport('Job #,Status,Scheduled Start\n', { timezone: TZ });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /header row but no job rows/);
    assert.deepStrictEqual(r.jobs, []);
  });
  check('csv v0.3: missing required columns name each missing field and list the headers that were seen', () => {
    const r = logic.normalizeJobsExport('Job #,Zone,Customer\nX1,North,Sample\n', { timezone: TZ });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.missingRequired.length, 2);
    assert.match(r.message, /missing required column\(s\): Status.*; Scheduled Start/);
    assert.match(r.message, /Columns found: Job #, Zone, Customer/);
    assert.deepStrictEqual(r.headersSeen, ['Job #', 'Zone', 'Customer']);
    assert.ok(!/\bat\s.*\.cjs:\d+/.test(r.message), 'no stack trace in a buyer-facing message');
    const none = logic.normalizeJobsExport('Foo,Bar\n1,2\n', { timezone: TZ });
    assert.strictEqual(none.missingRequired.length, 3);
    assert.throws(() => logic.normalizeJobsExport('Foo,Bar\n1,2\n', { timezone: TZ, strict: true }), /missing required column/);
  });
  check('csv v0.3: already-parsed rows (parseCsv output) are accepted and give the same result as the raw text', () => {
    const fromRows = logic.normalizeJobsExport(logic.parseCsv(sampleCsvText), { timezone: TZ });
    assert.deepStrictEqual(fromRows.jobs, sampleNorm.jobs);
  });
  check('csv v0.3: a bad Jobs export becomes a Heads-up in the dataset, the aging watch still runs, and the alert shows the reason', () => {
    const s = logic.prepareAgingSettings({ source: 'csv', asOfOverride: SAMPLE_REF }, 0);
    const ds = logic.datasetFromCsvFiles(s, [{ name: 'export.csv', text: 'Foo,Bar\n1,2\n' }]);
    assert.deepStrictEqual(ds.jobs, []);
    assert.ok(ds.settings.headsUp.some((h) => /missing required column/.test(h)));
    const alert = logic.renderAgingAlert(Object.assign({}, ds, { agingWatch: logic.unassignedAgingWatch(ds) }));
    assert.match(alert.text, /Heads-up: CSV import: .*missing required column/);
    const none = logic.datasetFromCsvFiles(s, []);
    assert.ok(none.settings.headsUp.some((h) => /no CSV file was received/.test(h)));
    assert.doesNotThrow(() => logic.renderMessage(Object.assign({}, none, { bookingQa: logic.bookingQa(none), capacity: logic.capacityFiller(none), kpis: logic.kpiDigest(none), afterHours: logic.afterHoursHandoff(none) })));
  });

  // ---------------- 5c. aliased headers still produce the existing results
  const fixtureFiles = ['technicians', 'jobs', 'capacity', 'memberships', 'estimates', 'calls'];
  const fixtureText = Object.fromEntries(fixtureFiles.concat(['aging_jobs']).map((n) => [n, fs.readFileSync(path.join(fixtureDir, n + '.csv'), 'utf8')]));
  const digestOf = (ds) => {
    let x = ds;
    x = Object.assign({}, x, { bookingQa: logic.bookingQa(x) });
    x = Object.assign({}, x, { capacity: logic.capacityFiller(x) });
    x = Object.assign({}, x, { kpis: logic.kpiDigest(x) });
    x = Object.assign({}, x, { afterHours: logic.afterHoursHandoff(x) });
    return { data: x, msg: logic.renderMessage(x) };
  };
  check('csv v0.3: snake_case fixture files (any file names) give the identical digest as before', () => {
    const files = fixtureFiles.map((n, i) => ({ name: 'export-' + i + '.csv', text: fixtureText[n] }));
    const viaFiles = digestOf(logic.datasetFromCsvFiles(csvRun.data.settings, files));
    assert.strictEqual(viaFiles.msg.text, csvRun.msg.text);
    assert.deepStrictEqual(viaFiles.data.bookingQa, csvRun.data.bookingQa);
    assert.deepStrictEqual(viaFiles.data.kpis, csvRun.data.kpis);
    assert.deepStrictEqual(viaFiles.data.capacity, csvRun.data.capacity);
    assert.deepStrictEqual(viaFiles.data.afterHours, csvRun.data.afterHours);
  });
  check('csv v0.3: the jobs fixture rewritten with human ServiceTitan headers gives the identical digest', () => {
    const rename = { job_id: 'Job #', booked_at: 'Created On', scheduled_start: 'Scheduled Start', scheduled_end: 'Scheduled End', status: 'Job Status', tech_id: 'Technician ID', customer_name: 'Customer', customer_phone: 'Phone', customer_type: 'Customer Type', job_type: 'Job Type', equipment_type: 'Equipment Type', equipment_age_years: 'Equipment Age', address: 'Service Address', priority: 'Priority', arrived_at: 'Arrived At', actual_minutes: 'Actual Minutes', business_unit: 'Business Unit', summary: 'Summary' };
    const lines = fixtureText.jobs.split('\n');
    lines[0] = lines[0].split(',').map((h) => rename[h.trim()]).join(',');
    assert.ok(!lines[0].includes('undefined'));
    const tables = {};
    fixtureFiles.forEach((n) => { tables[n] = logic.parseCsv(fixtureText[n]); });
    tables.jobs = logic.parseCsv(lines.join('\n'));
    const viaAlias = digestOf(logic.datasetFromTables(csvRun.data.settings, tables));
    assert.strictEqual(viaAlias.msg.text, csvRun.msg.text);
    assert.deepStrictEqual(viaAlias.data.kpis, csvRun.data.kpis);
    assert.deepStrictEqual(viaAlias.data.bookingQa, csvRun.data.bookingQa);
  });
  check('csv v0.3: aging fixture through the new file loader gives the same flags as before', () => {
    const files = [{ name: 'dispatch board.csv', text: fixtureText.aging_jobs }, { name: 'techs.csv', text: fixtureText.technicians }];
    const ds = logic.datasetFromCsvFiles(agingRun.data.settings, files);
    const w = logic.unassignedAgingWatch(ds);
    const pick = (x) => ({ a: x.agedUnassigned, b: x.blankSkill, z: x.missingZone, m: x.autoModeExclusionRisk, n: x.reviewedCount, f: x.flaggedJobCount });
    assert.deepStrictEqual(pick(w), pick(agingRun.data.agingWatch));
  });
  check('csv v0.3: optional sibling files with human headers are recognized by their columns, not their names', () => {
    const techs = 'Technician ID,Name,Trade,Shift Hours,Sales Capable\nDana Whitfield,Dana Whitfield,HVAC,8,Yes\nMarcus Hale,Marcus Hale,Plumbing,8,No\n';
    const caps = 'Window ID,Business Unit,Window Start,Window End,Open Slots\nW1,HVAC,3/12/2026 1:00 PM,3/12/2026 5:00 PM,2\n';
    const ds = logic.datasetFromCsvFiles(logic.prepareAgingSettings({ source: 'csv', asOfOverride: SAMPLE_REF }, 0), [
      { name: 'a.csv', text: sampleCsvText }, { name: 'b.csv', text: caps },
      { name: 'staff.csv', text: techs },
    ]);
    assert.strictEqual(ds.capacityWindows.length, 1);
    assert.strictEqual(ds.capacityWindows[0].openSlots, 2);
    assert.strictEqual(ds.capacityWindows[0].start, '2026-03-12T18:00:00.000Z');
    assert.deepStrictEqual(ds.technicians.map((t) => t.name), ['Dana Whitfield', 'Marcus Hale']);
    assert.strictEqual(ds.technicians[0].shiftHours, 8);
    assert.strictEqual(ds.technicians[0].salesCapable, true);
    assert.ok(!ds.settings.headsUp.some((h) => /"capacity.csv" was not found|technician list was built/.test(h)));
    assert.ok(ds.settings.headsUp.some((h) => /"memberships.csv" was not found/.test(h)));
  });

  // ---------------- 5d. aging + digest from the sample export
  const sampleSettings = logic.prepareAgingSettings({ source: 'csv', businessName: 'Summit Mechanical (fictional sample)', asOfOverride: SAMPLE_REF }, 0);
  const sampleDs = logic.datasetFromCsvFiles(sampleSettings, [{ name: 'sample-servicetitan-export.csv', text: sampleCsvText }]);
  const sw = logic.unassignedAgingWatch(sampleDs);
  const sids = (rows) => rows.map((r) => r.jobId);
  check('csv aging: sample export reviews 11 open jobs and flags 8 (completed and canceled excluded)', () => {
    assert.strictEqual(sw.reviewedCount, 11);
    assert.strictEqual(sw.flaggedJobCount, 8);
    assert.strictEqual(sw.thresholdMinutes, 20);
  });
  check('csv aging: unassigned jobs past the 20-minute default flag, newest-under-threshold and assigned jobs do not', () => {
    assert.deepStrictEqual(sids(sw.agedUnassigned), ['S3019', 'S3013', 'S3012', 'S3015']);
    assert.deepStrictEqual(sw.agedUnassigned.map((r) => r.unassignedMinutes), [2325, 75, 40, 25]);
    assert.ok(!sids(sw.agedUnassigned).includes('S3014')); // 10 minutes, under threshold
    assert.ok(!sids(sw.agedUnassigned).includes('S3010')); // assigned
    assert.ok(!sids(sw.agedUnassigned).includes('S3004')); // canceled
  });
  check('csv aging: Unassigned Since is used when present, Created On otherwise', () => {
    // S3012 has both (6:20 AM, 40 min). S3015 has only Created On 6:35 AM (25 min).
    assert.strictEqual(sw.agedUnassigned.find((r) => r.jobId === 'S3012').unassignedMinutes, 40);
    assert.strictEqual(sw.agedUnassigned.find((r) => r.jobId === 'S3015').unassignedMinutes, 25);
  });
  check('csv aging: moving the threshold moves the flags (30 drops the 25-minute job, 5 adds the 10-minute job)', () => {
    const at = (n) => logic.unassignedAgingWatch(Object.assign({}, sampleDs, { settings: Object.assign({}, sampleDs.settings, { agingThresholdMinutes: n }) }));
    assert.deepStrictEqual(sids(at(30).agedUnassigned), ['S3019', 'S3013', 'S3012']);
    assert.deepStrictEqual(sids(at(5).agedUnassigned), ['S3019', 'S3013', 'S3012', 'S3015', 'S3014']);
  });
  check('csv aging: blank skill, missing zone, multi-tech, and multi-day are all detected from the human headers', () => {
    assert.deepStrictEqual(sids(sw.blankSkill), ['S3013']);
    assert.deepStrictEqual(sids(sw.missingZone), ['S3014', 'S3018']);
    assert.deepStrictEqual(sids(sw.autoModeExclusionRisk), ['S3016', 'S3017']);
    const kinds = Object.fromEntries(sw.autoModeExclusionRisk.map((r) => [r.jobId, r.flags.find((f) => f.code === 'automode_exclusion').kind]));
    assert.strictEqual(kinds.S3016, 'multi-tech');
    assert.strictEqual(kinds.S3017, 'multi-day');
    assert.ok(!sids(sw.missingZone).includes('S3021')); // canceled
  });
  const sampleDigest = digestOf(sampleDs);
  check('csv digest: the sample export produces a non-empty [TEST] Morning Triage Digest with Heads-up for missing reports', () => {
    const t = sampleDigest.msg.text;
    assert.ok(t.startsWith('# [TEST] Morning Dispatch KPI Digest: Summit Mechanical (fictional sample)'));
    assert.match(t, /Newly booked jobs reviewed \(last 24 hours\): 9\. Flagged: 5\./);
    ['capacity', 'memberships', 'estimates', 'calls'].forEach((n) => assert.ok(t.includes('Heads-up: CSV export "' + n + '.csv" was not found'), n));
    assert.match(t, /technician list was built from the Technician column/);
    assert.match(t, /Job S3010 .*Repeat address: 1 completed visit/s);
    assert.match(t, /Response time, emergency and same-day jobs \(booked to arrival\): average 100\.0 min/);
    assert.ok(!/\(\)/.test(t), 'empty trade must not render as ()');
    assert.ok(sampleDigest.msg.subject.startsWith('[TEST] Dispatch KPI Digest'));
  });
  check('csv digest: nothing is invented when reports are missing (no capacity hours, no estimates, no after-hours numbers)', () => {
    const t = sampleDigest.msg.text;
    assert.match(t, /Open capacity, next 2 days: 0\.0 hours in 0 open slots/);
    assert.match(t, /Unworked estimates: 0 open estimates/);
    assert.match(t, /After-hours handoff for the morning shift\n\nNot available \(see Heads-up\)\./);
    assert.match(t, /Technician utilization: not available/);
  });
  check('csv digest: the 3 derived technicians each show the one completed job from the report day', () => {
    assert.deepStrictEqual(sampleDigest.data.kpis.utilization.perTech.map((p) => [p.name, p.jobs]), [['Dana Whitfield', 1], ['Marcus Hale', 1], ['Priya Raman', 1]]);
  });

  // ---------------- 5e. companion workflow servicetitan-csv-fallback-triage.json
  const csvWfText = fs.readFileSync(path.join(HERE, 'servicetitan-csv-fallback-triage.json'), 'utf8');
  let cw;
  check('csv-fallback workflow: valid JSON, named, and inactive', () => {
    cw = JSON.parse(csvWfText);
    assert.strictEqual(cw.active, false);
    assert.match(cw.name, /CSV-Fallback/);
  });
  if (!cw) { report(); return; }
  cw.by = Object.fromEntries(cw.nodes.map((n) => [n.name, n]));
  cw.exec = cw.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
  cw.nodeCount = { exec: cw.exec.length, sticky: cw.nodes.length - cw.exec.length, total: cw.nodes.length };
  const cwCfg = Object.fromEntries(cw.by['Config'].parameters.assignments.assignments.map((a) => [a.name, a.value]));
  check('csv-fallback workflow: has Manual Test Run plus schedule, webhook, and email-attachment triggers', () => {
    assert.ok(cw.nodes.some((n) => n.type === 'n8n-nodes-base.manualTrigger'));
    assert.strictEqual(cw.nodes.filter((n) => n.type === 'n8n-nodes-base.scheduleTrigger').length, 1);
    assert.strictEqual(cw.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook').length, 1);
    assert.strictEqual(cw.nodes.filter((n) => n.type === 'n8n-nodes-base.gmailTrigger').length, 1);
    assert.ok(cw.nodes.some((n) => n.type === 'n8n-nodes-base.readWriteFile'));
  });
  check('csv-fallback workflow: every schedule, webhook, and inbound email trigger is disabled', () => {
    const inbound = cw.nodes.filter((n) => /scheduleTrigger|cron|webhook|gmailTrigger|emailReadImap|formTrigger/i.test(n.type));
    assert.strictEqual(inbound.length, 3);
    inbound.forEach((n) => assert.strictEqual(n.disabled, true, n.name));
    assert.ok(!cw.by['Manual Test Run'].disabled);
  });
  check('csv-fallback workflow: Config defaults are testMode on, source test, owner placeholders, 20-minute threshold, and no ServiceTitan keys', () => {
    assert.strictEqual(cwCfg.testMode, true);
    assert.strictEqual(cwCfg.source, 'test');
    assert.strictEqual(cwCfg.agingThresholdMinutes, 20);
    assert.strictEqual(cwCfg.ownerEmail, 'owner@example.com');
    assert.strictEqual(cwCfg.timezone, 'America/Chicago');
    assert.ok(!('stAppKey' in cwCfg) && !('stTenantId' in cwCfg) && !('stApiBase' in cwCfg));
    assert.strictEqual(cw.by['Config'].parameters.includeOtherFields, true);
  });
  check('csv-fallback workflow: node ids/names unique and every connection resolves', () => {
    assert.strictEqual(new Set(cw.nodes.map((n) => n.id)).size, cw.nodes.length);
    assert.strictEqual(new Set(cw.nodes.map((n) => n.name)).size, cw.nodes.length);
    const allIds = new Set([].concat(nodes, aging.nodes).map((n) => n.id));
    cw.nodes.forEach((n) => assert.ok(!allIds.has(n.id), 'id reused from another workflow: ' + n.name));
    Object.entries(cw.connections).forEach(([from, v]) => {
      assert.ok(cw.by[from], 'missing source ' + from);
      v.main.forEach((outs) => outs.forEach((o) => assert.ok(cw.by[o.node], 'missing target ' + o.node)));
    });
  });
  check('csv-fallback workflow: only allowed node types, and no HTTP Request node at all (it never calls ServiceTitan)', () => {
    const allowed = new Set(['manualTrigger', 'scheduleTrigger', 'webhook', 'gmailTrigger', 'set', 'if', 'code', 'readWriteFile', 'gmail', 'slack', 'stickyNote'].map((t) => 'n8n-nodes-base.' + t));
    cw.nodes.forEach((n) => assert.ok(allowed.has(n.type), 'unexpected type ' + n.type));
    assert.ok(!cw.nodes.some((n) => n.type === 'n8n-nodes-base.httpRequest'));
    assert.ok(!/"method":\s*"(POST|PUT|PATCH|DELETE)"/i.test(csvWfText));
    assert.ok(!/ST-App-Key/i.test(csvWfText));
    cw.nodes.filter((n) => n.type !== 'n8n-nodes-base.code').forEach((n) => assert.ok(!/servicetitan\.io/i.test(JSON.stringify(n.parameters)), n.name));
    assert.strictEqual(cw.by['Webhook: upload a Jobs CSV (disabled until you are ready)'].parameters.httpMethod, 'POST'); // inbound only
  });
  check('csv-fallback workflow: file read is read-only (readWriteFile operation is read)', () => {
    cw.nodes.filter((n) => n.type === 'n8n-nodes-base.readWriteFile').forEach((n) => assert.strictEqual(n.parameters.operation, 'read'));
  });
  check('csv-fallback workflow: no customer-facing send nodes; exactly one Gmail send and one Slack post, both fed by owner fields', () => {
    cw.nodes.forEach((n) => assert.ok(!/twilio|sms|whatsapp|messagebird|vonage|sendgrid|mailgun|telegram/i.test(n.type + ' ' + n.name), n.name));
    const senders = cw.exec.filter((n) => /\.gmail$|\.slack$|emailSend/.test(n.type));
    assert.strictEqual(senders.length, 2);
    assert.strictEqual(cw.by['Email owner (Gmail)'].parameters.operation, 'send');
    assert.strictEqual(cw.by['Email owner (Gmail)'].parameters.sendTo, '={{ $json.emailTo }}');
    assert.ok(cw.by['Post to owner Slack'].parameters.channelId.value.includes('$json.slackChannel'));
    const asm = cw.by['Assemble Owner Messages'].parameters.jsCode;
    assert.ok(asm.includes('emailTo: s.ownerEmail') && asm.includes('slackChannel: s.ownerSlackChannel'));
    assert.ok(asm.includes('renderMessage(d)') && asm.includes('renderAgingAlert(d)'));
  });
  check('csv-fallback workflow: the Gmail trigger only reads (no reply/label/forward) and is limited by a placeholder sender', () => {
    const g = cw.nodes.find((n) => n.type === 'n8n-nodes-base.gmailTrigger');
    assert.match(g.parameters.filters.q, /from:PASTE_ALLOWED_SENDER_HERE/);
    assert.strictEqual(g.parameters.options.downloadAttachments, true);
    assert.strictEqual(cw.nodes.filter((n) => n.type === 'n8n-nodes-base.gmail').length, 1);
  });
  check('csv-fallback workflow: Code nodes are generated from dispatch_logic.cjs and make no network or file calls', () => {
    const codeNodes = cw.nodes.filter((n) => n.type === 'n8n-nodes-base.code');
    assert.ok(codeNodes.length >= 6);
    codeNodes.forEach((n) => {
      assert.match(n.parameters.jsCode, /^\/\/ Generated from dispatch_logic\.cjs/);
      assert.ok(!/fetch\(|require\(|XMLHttpRequest|helpers\.(httpRequest|request)|\$http|child_process|\bfs\./.test(n.parameters.jsCode), n.name);
    });
  });
  check('csv-fallback workflow: credentials are placeholders only, no pinData, no secrets', () => {
    cw.nodes.forEach((n) => Object.values(n.credentials || {}).forEach((c) => assert.match(c.id, /^PLACEHOLDER_[A-Z_]+$/)));
    const ids = new Set(cw.nodes.flatMap((n) => Object.values(n.credentials || {}).map((c) => c.id)));
    ['PLACEHOLDER_GMAIL', 'PLACEHOLDER_SLACK', 'PLACEHOLDER_WEBHOOK_HEADER_AUTH'].forEach((id) => assert.ok(ids.has(id), id));
    assert.ok(!('pinData' in cw));
    assert.strictEqual(cw.by['Webhook: upload a Jobs CSV (disabled until you are ready)'].parameters.authentication, 'headerAuth');
    assert.ok(!/xox[bap]-|sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{12,}|client_secret|-----BEGIN|AKIA[0-9A-Z]{12}|\b[0-9a-f]{32,}\b/i.test(csvWfText));
  });
  check('csv-fallback workflow: sticky notes cover Start here, Config, Safety, CSV-Fallback (Starter/Essentials, no API key), and the go-live hard stop', () => {
    const n = cw.nodes.filter((x) => x.type === 'n8n-nodes-base.stickyNote').map((x) => x.parameters.content).join('\n');
    assert.ok(/START HERE/.test(n) && /Config fields/.test(n) && /Safety defaults/.test(n) && /Hard stop before go-live/.test(n));
    assert.ok(/CSV-Fallback \(Starter \/ Essentials, no API key\)/.test(n));
    assert.ok(/Required columns/.test(n) && /Webhook/.test(n) && /Email attachment/.test(n) && /Watch folder/.test(n));
    assert.ok(!/\$\s?\d/.test(n), 'no dollar amounts');
  });
  check('csv-fallback workflow: no banned strings in the JSON, builder, fixtures, README, or generated sample', () => {
    ['servicetitan-csv-fallback-triage.json', 'build_csv_fallback_workflow.cjs', 'fixtures/sample-servicetitan-export.csv', 'fixtures/sample_export_reference_time.txt', 'README.md', 'CHANGELOG.md'].forEach((f) => {
      assert.ok(!BANNED.test(fs.readFileSync(path.join(HERE, f), 'utf8')), f);
    });
  });

  // run the companion workflow's own Code nodes
  async function runCw(name, { input, named, binaryBuffers, all }) {
    const fn = new AsyncFunction('$input', '$', cw.by[name].parameters.jsCode);
    const items = Array.isArray(input) ? input : [{ json: input }];
    const $input = { first: () => items[0], all: () => items };
    const $ = (n) => {
      if (!(n in (named || {}))) throw new Error('node ' + n + ' not available');
      return { first: () => ({ json: named[n] }), all: () => [{ json: named[n] }] };
    };
    const ctx = { helpers: { getBinaryDataBuffer: async (i, key) => binaryBuffers[i][key] } };
    const out = await fn.call(ctx, $input, $);
    return all ? out.map((o) => o.json) : out[0].json;
  }
  const cwCfgFull = Object.assign({}, cwCfg, { businessName: 'Summit Mechanical (fictional sample)' });
  async function runCwTail(dataset) {
    let d = await runCw('Morning Triage Digest Logic', { input: dataset });
    d = await runCw('Unassigned Aging Watch Logic', { input: d });
    const msgs = await runCw('Assemble Owner Messages', { input: d, all: true });
    return { data: d, msgs };
  }
  const csvBin = (name, text) => ({ json: {}, binary: { data: { fileName: name, mimeType: 'text/csv' } } });
  let cwManual, cwInbound, cwFolder;
  await checkAsync('csv-fallback workflow: Manual Test Run path (built-in sample export) runs end to end and produces two [TEST] messages', async () => {
    const prep = await runCw('Prepare Settings', { input: cwCfgFull });
    assert.strictEqual(prep.settings.source, 'test');
    assert.strictEqual(prep.inbound, false);
    const ds = await runCw('Load Built-in Sample Export', { input: prep, named: { 'Prepare Settings': prep } });
    cwManual = await runCwTail(ds);
    assert.strictEqual(cwManual.msgs.length, 2);
    assert.deepStrictEqual(cwManual.msgs.map((m) => m.kind), ['morning-digest', 'aging-alert']);
    assert.ok(cwManual.msgs[0].subject.startsWith('[TEST] Dispatch KPI Digest: Summit Mechanical'));
    assert.ok(cwManual.msgs[1].subject.startsWith('[TEST] Unassigned Aging Alert: Summit Mechanical'));
    cwManual.msgs.forEach((m) => { assert.strictEqual(m.testMode, true); assert.strictEqual(m.sendEmail, false); });
  });
  await checkAsync('csv-fallback workflow: webhook upload path (binary CSV) runs end to end, forces csv, and matches the shared module', async () => {
    const gathered = await runCw('Gather Inbound CSV', {
      input: [{ json: { headers: {}, body: {} }, binary: { data: { fileName: 'Jobs Dispatch Report.csv', mimeType: 'text/csv' } } }],
      binaryBuffers: [{ data: Buffer.from(sampleCsvText, 'utf8') }],
    });
    assert.strictEqual(gathered.inbound, true);
    assert.strictEqual(gathered.inboundFiles.length, 1);
    assert.strictEqual(gathered.inboundFiles[0].name, 'Jobs Dispatch Report.csv');
    // Config (Set node with includeOtherFields) merges its values over the inbound item
    const prep = await runCw('Prepare Settings', { input: Object.assign({}, cwCfgFull, gathered, { asOfOverride: SAMPLE_REF }) });
    assert.strictEqual(prep.settings.source, 'csv'); // upload forces csv even though Config says test
    assert.strictEqual(prep.settings.testMode, true);
    assert.strictEqual(prep.inbound, true);
    const ds = await runCw('Parse CSV Upload', { input: prep, named: { 'Prepare Settings': prep } });
    assert.strictEqual(ds.jobs.length, 16);
    cwInbound = await runCwTail(ds);
    assert.deepStrictEqual(cwInbound.data.agingWatch, logic.unassignedAgingWatch(cwInbound.data));
    assert.deepStrictEqual(cwInbound.data.kpis, logic.kpiDigest(cwInbound.data));
    assert.deepStrictEqual(cwInbound.data.bookingQa, logic.bookingQa(cwInbound.data));
    assert.strictEqual(cwInbound.msgs[0].text, logic.renderMessage(cwInbound.data).text);
    assert.strictEqual(cwInbound.msgs[1].text, logic.renderAgingAlert(cwInbound.data).text);
    assert.deepStrictEqual(sids(cwInbound.data.agingWatch.agedUnassigned), ['S3019', 'S3013', 'S3012', 'S3015']);
  });
  await checkAsync('csv-fallback workflow: email-attachment path ignores non-CSV attachments and accepts several attachment fields', async () => {
    const gathered = await runCw('Gather Inbound CSV', {
      input: [{ json: { subject: 'Daily export' }, binary: {
        attachment_0: { fileName: 'notes.pdf', mimeType: 'application/pdf' },
        attachment_1: { fileName: 'export.CSV', mimeType: 'application/octet-stream' },
        attachment_2: { fileName: 'blob', mimeType: 'text/csv' },
      } }],
      binaryBuffers: [{ attachment_0: Buffer.from('%PDF'), attachment_1: Buffer.from(sampleCsvText), attachment_2: Buffer.from(fixtureText.technicians) }],
    });
    assert.deepStrictEqual(gathered.inboundFiles.map((f) => f.name), ['export.CSV', 'blob']);
    const raw = await runCw('Gather Inbound CSV', { input: [{ json: { csv: 'Job #,Status,Scheduled Start\nR1,Scheduled,3/12/2026 9:00 AM\n' } }], binaryBuffers: [{}] });
    assert.strictEqual(raw.inboundFiles.length, 1);
  });
  await checkAsync('csv-fallback workflow: an email or upload with no CSV still produces a clear Heads-up, not a [TEST] sample or a crash', async () => {
    const gathered = await runCw('Gather Inbound CSV', { input: [{ json: {}, binary: { attachment_0: { fileName: 'photo.png', mimeType: 'image/png' } } }], binaryBuffers: [{ attachment_0: Buffer.from('x') }] });
    assert.deepStrictEqual(gathered, { inbound: true, inboundFiles: [] });
    const prep = await runCw('Prepare Settings', { input: Object.assign({}, cwCfgFull, gathered) });
    assert.strictEqual(prep.settings.source, 'csv');
    const ds = await runCw('Parse CSV Upload', { input: prep, named: { 'Prepare Settings': prep } });
    const tail = await runCwTail(ds);
    assert.match(tail.msgs[1].text, /Heads-up: CSV import: no CSV file was received/);
    assert.ok(tail.msgs[1].text.includes('source: csv.'));
    assert.ok(!tail.msgs[1].text.includes('Built from fictional sample data'));
  });
  await checkAsync('csv-fallback workflow: a malformed upload becomes a Heads-up in both owner messages', async () => {
    const prep = await runCw('Prepare Settings', { input: Object.assign({}, cwCfgFull, { inbound: true, inboundFiles: [{ name: 'bad.csv', text: 'Foo,Bar\n1,2\n' }] }) });
    const ds = await runCw('Parse CSV Upload', { input: prep, named: { 'Prepare Settings': prep } });
    const tail = await runCwTail(ds);
    tail.msgs.forEach((m) => assert.match(m.text, /Heads-up: CSV import: .*missing required column\(s\): Job #/));
  });
  await checkAsync('csv-fallback workflow: watch-folder path reads files of any name and merges optional siblings', async () => {
    const prep = await runCw('Prepare Settings', { input: Object.assign({}, cwCfgFull, { source: 'csv', asOfOverride: SAMPLE_REF }) });
    assert.strictEqual(prep.inbound, false);
    const ds = await runCw('Parse CSV Upload', {
      input: [csvBin('Dispatch export 2026-03-12.csv'), csvBin('capacity-report.csv')],
      named: { 'Prepare Settings': prep },
      binaryBuffers: [{ data: Buffer.from(sampleCsvText) }, { data: Buffer.from('window_id,business_unit,window_start,window_end,open_slots\nW1,HVAC,2026-03-12T13:00:00-05:00,2026-03-12T17:00:00-05:00,2\n') }],
    });
    assert.strictEqual(ds.jobs.length, 16);
    assert.strictEqual(ds.capacityWindows.length, 1);
    cwFolder = await runCwTail(ds);
    assert.ok(cwFolder.msgs[0].text.includes('source: csv'));
    assert.ok(!cwFolder.msgs[0].text.includes('"capacity.csv" was not found'));
  });
  await checkAsync('csv-fallback workflow: source servicetitan is refused (falls back to test with a Heads-up) because there is no API path', async () => {
    const prep = await runCw('Prepare Settings', { input: Object.assign({}, cwCfgFull, { source: 'servicetitan', testMode: false }) });
    assert.strictEqual(prep.settings.source, 'test');
    assert.strictEqual(prep.settings.testMode, true);
    assert.ok(prep.settings.headsUp.some((h) => /no ServiceTitan API path/.test(h)));
  });
  await checkAsync('csv-fallback workflow: routing sends test data down the built-in branch and csv down the upload/folder branches', async () => {
    const gate = cw.by['Source is CSV?'].parameters.conditions.conditions[0];
    assert.strictEqual(gate.rightValue, 'csv');
    assert.deepStrictEqual(cw.connections['Source is CSV?'].main[1].map((o) => o.node), ['Load Built-in Sample Export']);
    assert.deepStrictEqual(cw.connections['Source is CSV?'].main[0].map((o) => o.node), ['Upload just arrived?']);
    assert.deepStrictEqual(cw.connections['Upload just arrived?'].main[0].map((o) => o.node), ['Parse CSV Upload']);
    assert.deepStrictEqual(cw.connections['Upload just arrived?'].main[1].map((o) => o.node), ['Read CSV Exports']);
    ['Webhook: upload a Jobs CSV (disabled until you are ready)', 'Email attachment: inbound Jobs CSV (disabled until you are ready)'].forEach((t) => {
      assert.deepStrictEqual(cw.connections[t].main[0].map((o) => o.node), ['Gather Inbound CSV']);
    });
  });
  if (!cwManual || !cwInbound) { report(); return; }
  check('csv-fallback workflow: built-in sample run equals the module run on the sample file (embedded copy in sync)', () => {
    assert.deepStrictEqual(cwManual.data.jobs, sampleDs.jobs);
    assert.deepStrictEqual(cwManual.data.technicians, sampleDs.technicians);
    assert.strictEqual(cwManual.data.settings.asOf, SAMPLE_REF);
    const strip = (t) => t.replace('source: test', 'source: X').replace('source: csv', 'source: X').replace(' Built from fictional sample data.', '');
    assert.strictEqual(strip(cwManual.msgs[0].text), strip(cwInbound.msgs[0].text));
    assert.strictEqual(strip(cwManual.msgs[1].text), strip(cwInbound.msgs[1].text));
  });
  check('csv-fallback workflow: the morning digest message is the same text the main digest pack produces for the same data', () => {
    assert.strictEqual(cwInbound.msgs[0].text, sampleDigest.msg.text);
    assert.strictEqual(cwInbound.msgs[0].subject, sampleDigest.msg.subject);
    assert.strictEqual(cwInbound.msgs[1].text, logic.renderAgingAlert(Object.assign({}, sampleDs, { agingWatch: sw })).text);
  });

  check('owner Slack payload escapes Slack control text in both renderers', () => {
    for (const message of [sampleDigest.msg, cwInbound.msgs[1]]) {
      const escaped = message.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      assert.strictEqual(message.slackText, escaped);
    }
  });

  // existing workflows now accept human headers in the csv path too
  await checkAsync('legacy CSV workflows surface malformed file diagnostics from their Code nodes', async () => {
    for (const [run, config] of [[runNode, cfgVals], [runAgingNode, agingCfgVals]]) {
      const prep = await run('Prepare Settings', { input: Object.assign({}, config, { source: 'csv', asOfOverride: SAMPLE_REF }) });
      const ds = await run('Parse CSV Exports', {
        input: [{ json: {}, binary: { data: { fileName: 'jobs.csv' } } }],
        named: { 'Prepare Settings': prep },
        buffers: [Buffer.from('Job #,Status,Scheduled Start,Summary\n1,Scheduled,2026-03-11,"unclosed')],
      });
      assert.match(ds.settings.headsUp.join(' '), /jobs\.csv.*never closed/);
    }
  });
  await checkAsync('existing aging workflow Parse CSV Exports now accepts a human-header Jobs export', async () => {
    const prep = await runAgingNode('Prepare Settings', { input: Object.assign({}, agingCfgVals, { source: 'csv', asOfOverride: SAMPLE_REF }) });
    const ds = await runAgingNode('Parse CSV Exports', {
      input: [{ json: {}, binary: { data: { fileName: 'jobs.csv' } } }],
      named: { 'Prepare Settings': prep },
      buffers: [Buffer.from(sampleCsvText)],
    });
    assert.strictEqual(ds.jobs.length, 16);
    const w = logic.unassignedAgingWatch(ds);
    assert.deepStrictEqual(sids(w.agedUnassigned), ['S3019', 'S3013', 'S3012', 'S3015']);
  });
  await checkAsync('existing digest workflow Parse CSV Exports now accepts a human-header Jobs export (other files become Heads-up lines)', async () => {
    const prep = await runNode('Prepare Settings', { input: Object.assign({}, cfgVals, { source: 'csv', asOfOverride: SAMPLE_REF }) });
    const ds = await runNode('Parse CSV Exports', {
      input: [{ json: {}, binary: { data: { fileName: 'jobs.csv' } } }],
      named: { 'Prepare Settings': prep },
      buffers: [Buffer.from(sampleCsvText)],
    });
    assert.strictEqual(ds.jobs.length, 16);
    assert.ok(ds.settings.headsUp.some((h) => /"calls.csv" was not found/.test(h)));
  });

  // sample output for buyers (regenerated on every run)
  const csvSampleHeader = '<!-- Generated by mock_servicetitan_test.cjs from fixtures/sample-servicetitan-export.csv. Do not hand-edit; re-run the test to regenerate. -->\n\n';
  fs.writeFileSync(path.join(HERE, 'sample_csv_fallback_digest.md'), csvSampleHeader + cwInbound.msgs[0].text + '\n\n\n' + cwInbound.msgs[1].text + '\n');
  check('sample_csv_fallback_digest.md was written with both [TEST] messages and no banned strings', () => {
    const t = fs.readFileSync(path.join(HERE, 'sample_csv_fallback_digest.md'), 'utf8');
    assert.ok(t.includes('# [TEST] Morning Dispatch KPI Digest') && t.includes('# [TEST] Unassigned Aging Alert') && t.includes('Summit Mechanical (fictional sample)'));
    assert.ok(!BANNED.test(t));
  });

  // ---------------- 6. diagram + site entry stay in sync with the shipped pack
  const repo = path.resolve(HERE, '..', '..');
  const diagram = fs.readFileSync(path.join(repo, 'public', 'diagrams', 'servicetitan-dispatch-copilot.html'), 'utf8');
  const sample = fs.readFileSync(path.join(HERE, 'sample_test_digest.md'), 'utf8');
  check('diagram: states the real executable node count and is labeled an architecture diagram, not a screenshot', () => {
    assert.ok(diagram.includes(nodeCount.exec + ' executable nodes'));
    assert.match(diagram, /Architecture diagram of the draft pack, not a live product screenshot/);
  });
  check('diagram: reuses the Manager Digest height reporter, reduced-motion rule, prev/next, and risk badges', () => {
    ['prewired-diagram-height', 'prefers-reduced-motion', 'prev-stage-btn', 'next-stage-btn', 'badge--readonly', 'badge--gated', 'badge--approval'].forEach((x) => assert.ok(diagram.includes(x), x));
  });
  check('diagram: shows the four workflow stages', () => {
    ['Booking QA &amp; skill-tier routing', 'Open-capacity &amp; unsold-estimate filler', 'Morning Dispatch KPI digest', 'After-hours handoff summary'].forEach((x) => assert.ok(diagram.includes(x), x));
  });
  check('diagram: [TEST] digest preview is hidden until clicked and labeled sample / architecture preview', () => {
    assert.match(diagram, /id="digest-preview"[^>]*hidden/);
    assert.match(diagram, /sample \/ architecture preview/);
    assert.match(diagram, /Show sample \[TEST\] digest/);
  });
  check('diagram: every preview line is text from sample_test_digest.md (no invented numbers)', () => {
    const unesc = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const lines = [...diagram.matchAll(/<(?:p class="pv-line[^"]*"|h3 class="pv-title")>([^<]+)</g)].map((m) => unesc(m[1]).trim());
    assert.ok(lines.length >= 30, 'only ' + lines.length + ' preview lines');
    const digestLines = sample.split('\n');
    lines.forEach((l) => assert.ok(digestLines.some((dl) => dl.includes(l)), 'not in sample: ' + l));
  });
  check('diagram: no banned strings and no dollar price other than fixture estimate values', () => {
    assert.ok(!BANNED.test(diagram));
  });
  const tsText = fs.readFileSync(path.join(repo, 'src', 'templates.ts'), 'utf8');
  const entry = tsText.slice(tsText.indexOf('slug: "servicetitan-dispatch-copilot"'), tsText.indexOf('slug: "speed-to-lead"'));
  check('templates.ts entry: node counts match the shipped digest, aging, and CSV-fallback workflow JSON', () => {
    const agingExec = aging.nodeCount.exec;
    const agingTotal = aging.nodeCount.total;
    assert.ok(entry.includes('nodes: ' + nodeCount.exec + ','), 'digest workflow node count');
    assert.ok(entry.includes('nodes: ' + agingExec + ','), 'aging workflow node count');
    assert.ok(entry.includes('nodes: ' + cw.nodeCount.exec + ','), 'csv-fallback workflow node count');
    assert.ok(entry.includes('totalNodes: ' + (nodeCount.exec + agingExec + cw.nodeCount.exec) + ','), 'pack executable total');
    assert.ok(entry.includes('totalNodesWithNotes: ' + (nodeCount.total + agingTotal + cw.nodeCount.total) + ','), 'pack total with notes');
  });
  check('templates.ts entry: v0.3.0 and CSV-Fallback Mode copy for Starter / Essentials (no API key, no pricing)', () => {
    assert.ok(entry.includes('version: "v0.3.0"'));
    assert.ok(/CSV-Fallback/.test(entry) && /Starter/.test(entry) && /Essentials/.test(entry));
    assert.ok(/no (API|App) ?[Kk]ey|without (an )?(API|App) ?[Kk]ey/i.test(entry));
    assert.ok(entry.includes('name: "ServiceTitan CSV-Fallback Triage"'));
    assert.ok(/Pricing/i.test(entry) && !/\$\s?\d/.test(entry));
  });
  check('README and CHANGELOG describe v0.3.0 CSV-Fallback Mode without claiming live verification', () => {
    const readme = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');
    const changelog = fs.readFileSync(path.join(HERE, 'CHANGELOG.md'), 'utf8');
    assert.ok(/v0\.3\.0/.test(readme) && /v0\.3\.0/.test(changelog));
    ['CSV-Fallback', 'Starter', 'Essentials', 'servicetitan-csv-fallback-triage.json', 'sample-servicetitan-export.csv', 'Job #', 'Scheduled Start', 'Required Skill', 'Heads-up'].forEach((x) => assert.ok(readme.includes(x), 'README missing ' + x));
    assert.ok(/NOT tested against a live|not (yet )?tested against a live|unverified/i.test(readme));
    assert.ok(!/verified against a live|tested against a live (ServiceTitan|account) and/i.test(readme.replace(/not (yet )?tested against a live/gi, '').replace(/NOT tested against a live/g, '')));
  });
  check('templates.ts entry: paid-pending, New badge, diagram on, no price, no banned strings', () => {
    assert.ok(!/free:\s*true/.test(entry));
    assert.ok(/badge: "New"/.test(entry) && /diagram: true/.test(entry) && /category: "field-service"/.test(entry));
    assert.ok(!/\$\s?\d/.test(entry), 'dollar amount in site copy');
    assert.ok(!BANNED.test(entry));
    assert.ok(entry.includes('draftNote("ServiceTitan, Gmail, Slack, or a CSV export")'));
  });
  check('templates.ts: no stale 12-pack copy', () => {
    assert.ok(!/Eleven|11 Prewired|11 packs|Twelve|12 Prewired|12 packs/.test(tsText));
    assert.strictEqual((tsText.match(/^    slug: "/gm) || []).length, 13);
  });
  report();
})();

function report() {
  const failed = failures.length;
  if (failed) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  FAIL ' + f)); }
  console.log(`\nDigest workflow nodes: ${nodeCount.exec} executable, ${nodeCount.sticky} sticky notes, ${nodeCount.total} total`);
  if (aging && aging.nodeCount) {
    console.log(`Aging workflow nodes: ${aging.nodeCount.exec} executable, ${aging.nodeCount.sticky} sticky notes, ${aging.nodeCount.total} total`);
  }
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
