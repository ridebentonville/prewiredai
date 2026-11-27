#!/usr/bin/env node
/**
 * Test harness for the ServiceTitan Dispatch & Capacity Copilot pack (DRAFT v0.1.0).
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
  const files = ['workflow.n8n.json', 'dispatch_logic.cjs', 'build_workflow.cjs', 'README.md', 'CHANGELOG.md']
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
    assert.deepStrictEqual(Object.keys(msg).sort(), ['deliveryNotes', 'emailTo', 'html', 'sendEmail', 'sendSlack', 'slackChannel', 'subject', 'testMode', 'text']);
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

  // ---------------- 5. diagram + site entry stay in sync with the shipped pack
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
  check('templates.ts entry: node counts match the shipped workflow JSON', () => {
    assert.ok(entry.includes('totalNodes: ' + nodeCount.exec + ','));
    assert.ok(entry.includes('totalNodesWithNotes: ' + nodeCount.total + ','));
    assert.ok(entry.includes('nodes: ' + nodeCount.exec + ','));
  });
  check('templates.ts entry: paid-pending, New badge, diagram on, no price, no banned strings', () => {
    assert.ok(!/free:\s*true/.test(entry));
    assert.ok(/badge: "New"/.test(entry) && /diagram: true/.test(entry) && /category: "field-service"/.test(entry));
    assert.ok(!/\$\s?\d/.test(entry), 'dollar amount in site copy');
    assert.ok(!BANNED.test(entry));
    assert.ok(entry.includes('draftNote("ServiceTitan, Gmail, Slack, or a CSV export")'));
  });
  check('templates.ts: no stale 11-pack copy', () => {
    assert.ok(!/Eleven|11 Prewired|11 packs/.test(tsText));
    assert.strictEqual((tsText.match(/^    slug: "/gm) || []).length, 12);
  });
  report();
})();

function report() {
  const failed = failures.length;
  if (failed) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  FAIL ' + f)); }
  console.log(`\nWorkflow nodes: ${nodeCount.exec} executable, ${nodeCount.sticky} sticky notes, ${nodeCount.total} total`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
