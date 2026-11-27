#!/usr/bin/env node
/**
 * Test harness for the Housecall Pro CSV-First Morning Ops Copilot pack (DRAFT v0.1.0).
 *
 *   node packs/housecall-pro-morning-ops-copilot/mock_hcp_test.cjs
 *
 * Local only. Reads workflow.n8n.json and fixtures/, never opens a network connection, and never talks to
 * Housecall Pro, Gmail, Slack, or anyone else. "Mock" means the fictional fixtures stand in for Housecall Pro data.
 * It:
 *   1. Checks the workflow for the safety guarantees (inactive, disabled triggers, testMode, no HTTP / write path,
 *      no customer-send nodes, owner-only delivery, no secrets, sticky-note wording).
 *   2. Tests the CSV mapper (header aliases, malformed / empty / header-only / missing-column / competing files).
 *   3. Tests dates, time zones, invalid calendar dates, and the daylight-saving policy.
 *   4. Tests the jobs queue, requires-invoicing / past-due thresholds, and stalled-estimate rules and ranking.
 *   5. Tests digest formatting, [TEST] labeling, Heads-up lines, and output hygiene.
 *   6. Checks the site copy (PRICE_PENDING only, 14-pack catalog, related lists, components).
 *   7. Runs the Code nodes pulled out of the workflow JSON end to end and compares them with the shared module.
 *   8. Overwrites sample_morning_digest.md.
 * Exit code 0 only if every assertion passes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const logic = require('./hcp_logic.cjs');

const HERE = __dirname;
const REPO = path.join(HERE, '..', '..');
const rd = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8');
const rdRepo = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
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
function report() {
  if (failures.length) {
    console.log('FAILED ' + failures.length + ' (' + passed + ' passed):');
    failures.forEach((f) => console.log(' - ' + f));
    process.exit(1);
  }
  console.log(passed + ' passed');
}

// Patterns are assembled from fragments so this file itself contains none of the banned strings.
const BANNED = new RegExp([['viv', 'int'], ['bri', 'nks'], ['\\bad', 't\\b'], ['home\\s*sec', 'urity'], ['alarm\\s+', 'company'], ['sol', 'ar-only'], ['Cedar Ridge', ' Mechanical'], ['Cedar ', '& Pine']].map((p) => p.join('')).join('|'), 'i');
const REUSED_SHOPS = new RegExp([['Blue', 'stem'], ['Summit ', 'Mechanical'], ['Cedar ', 'Ridge'], ['Cedar ', '& Pine']].map((p) => p.join('')).join('|'), 'i');
const BAD_OUTPUT = /\b(NaN|undefined|null|Infinity)\b/;
const SECRET = /xox[bap]-|sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{12,}|client_secret|-----BEGIN|AKIA[0-9A-Z]{12}|\b[0-9a-f]{32,}\b/i;
const SHOP = 'Cedar Creek Plumbing & Air';
const REF = rd('fixtures/reference_time.txt').trim();
const PRICE = new RegExp('\\$' + '(799|149)');

// ---------------------------------------------------------------- load workflow
const text = rd('workflow.n8n.json');
const wf = JSON.parse(text);
const nodes = wf.nodes;
const by = Object.fromEntries(nodes.map((n) => [n.name, n]));
const exec = nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
const cfg = Object.fromEntries(by['Config'].parameters.assignments.assignments.map((a) => [a.name, a.value]));
const COUNT = { exec: exec.length, sticky: nodes.length - exec.length, total: nodes.length };
const stickyText = nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').map((n) => n.parameters.content).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// ---------------------------------------------------------------- 1. workflow safety
check('workflow: valid JSON, named Housecall Pro DRAFT, inactive, no pinData', () => {
  assert.ok(/Housecall Pro/.test(wf.name) && /DRAFT/.test(wf.name));
  assert.strictEqual(wf.active, false);
  assert.ok(!('pinData' in wf));
});
check('workflow: Manual Test Run exists; schedule, webhook, and Gmail triggers all exist and are disabled', () => {
  assert.ok(nodes.some((n) => n.type === 'n8n-nodes-base.manualTrigger'));
  ['scheduleTrigger', 'webhook', 'gmailTrigger'].forEach((t) => assert.ok(nodes.some((n) => n.type === 'n8n-nodes-base.' + t && n.disabled === true), t));
  nodes.filter((n) => /scheduleTrigger|cron|webhook|gmailTrigger/i.test(n.type)).forEach((n) => assert.strictEqual(n.disabled, true, n.name));
});
check('workflow: the schedule is 7:00 AM on weekdays and the workflow timezone is America/Chicago', () => {
  nodes.filter((n) => /scheduleTrigger/.test(n.type)).forEach((n) => assert.deepStrictEqual(n.parameters.rule.interval[0], { field: 'cronExpression', expression: '0 7 * * 1-5' }));
  assert.strictEqual(wf.settings.timezone, 'America/Chicago');
});
check('workflow: Config defaults are testMode on, source test, owner placeholders, shop thresholds', () => {
  assert.strictEqual(cfg.testMode, true);
  assert.strictEqual(cfg.source, 'test');
  assert.strictEqual(cfg.timezone, 'America/Chicago');
  assert.strictEqual(cfg.businessName, 'Your Business Name');
  assert.strictEqual(cfg.ownerEmail, 'owner@example.com');
  assert.strictEqual(cfg.ownerSlackChannel, '');
  assert.strictEqual(cfg.delivery, 'email');
  assert.strictEqual(cfg.pastDueMinDays, 1);
  assert.strictEqual(cfg.estimateStalledDays, '');
  assert.strictEqual(cfg.estimateMinValue, 1000);
  assert.strictEqual(cfg.maxItemsPerSection, 10);
});
check('workflow: node ids and names are unique and every connection resolves', () => {
  assert.strictEqual(new Set(nodes.map((n) => n.id)).size, nodes.length);
  assert.strictEqual(new Set(nodes.map((n) => n.name)).size, nodes.length);
  Object.entries(wf.connections).forEach(([from, v]) => {
    assert.ok(by[from], 'unknown source ' + from);
    v.main.forEach((outs) => outs.forEach((o) => assert.ok(by[o.node], 'unknown target ' + o.node)));
  });
});
check('workflow: only allowed node types; no HTTP Request node at all (no Housecall Pro call of any kind)', () => {
  const allowed = new Set(['manualTrigger', 'scheduleTrigger', 'webhook', 'gmailTrigger', 'set', 'if', 'code', 'readWriteFile', 'gmail', 'slack', 'stickyNote'].map((t) => 'n8n-nodes-base.' + t));
  nodes.forEach((n) => assert.ok(allowed.has(n.type), 'unexpected type ' + n.type));
  assert.ok(!nodes.some((n) => /httpRequest/i.test(n.type)));
});
check('workflow: no customer-facing send nodes (no Twilio / SMS / similar) and exactly two owner send nodes', () => {
  nodes.forEach((n) => assert.ok(!/twilio|sms|whatsapp|messagebird|vonage|sendgrid|mailgun|telegram|emailSend/i.test(n.type + ' ' + n.name), n.name));
  assert.strictEqual(exec.filter((n) => /\.gmail$|\.slack$/.test(n.type)).length, 2);
});
check('workflow: no POST / PUT / PATCH / DELETE and no housecallpro.com URL anywhere in the workflow', () => {
  assert.ok(!/"method":\s*"(POST|PUT|PATCH|DELETE)"/i.test(text));
  assert.ok(!/housecallpro\.com/i.test(text));
  assert.ok(!/api\.housecallpro|Authorization|X-API-Key/i.test(text));
});
check('workflow: the only webhook accepts POST uploads behind header auth and the read node only reads', () => {
  const w = nodes.find((n) => /\.webhook$/.test(n.type));
  assert.strictEqual(w.parameters.authentication, 'headerAuth');
  assert.strictEqual(w.parameters.httpMethod, 'POST');
  assert.strictEqual(by['Read CSV Exports'].parameters.operation, 'read');
  assert.ok(!nodes.some((n) => n.type === 'n8n-nodes-base.readWriteFile' && n.parameters.operation !== 'read'));
});
check('workflow: Gmail trigger only reads, from a placeholder sender that matches nothing; Gmail action only sends', () => {
  const g = nodes.find((n) => /gmailTrigger/.test(n.type));
  assert.match(g.parameters.filters.q, /from:PASTE_ALLOWED_SENDER_HERE/);
  assert.ok(!exec.some((n) => /\.gmail$/.test(n.type) && n.parameters.operation !== 'send'));
});
check('workflow: email and Slack recipients come only from owner Config fields, never from input rows', () => {
  assert.strictEqual(by['Email owner (Gmail)'].parameters.sendTo, '={{ $json.emailTo }}');
  assert.ok(by['Post to owner Slack'].parameters.channelId.value.includes('$json.slackChannel'));
  const asm = by['Assemble Owner Message'].parameters.jsCode;
  assert.ok(asm.includes('emailTo: s.ownerEmail') && asm.includes('slackChannel: s.ownerSlackChannel'));
  assert.ok(!/ownerEmail\s*=\s*(row|item|r)\./.test(asm));
});
check('workflow: Slack post disables Markdown, @-mention linking, and unfurls', () => {
  const o = by['Post to owner Slack'].parameters.otherOptions;
  assert.strictEqual(o.mrkdwn, false);
  assert.strictEqual(o.link_names, false);
  assert.strictEqual(o.unfurl_links, false);
  assert.strictEqual(o.unfurl_media, false);
  assert.strictEqual(o.includeLinkToWorkflow, false);
});
check('workflow: credentials are placeholders only; no secret-looking values; no banned strings', () => {
  nodes.forEach((n) => Object.values(n.credentials || {}).forEach((c) => assert.match(c.id, /^PLACEHOLDER_[A-Z_]+$/)));
  assert.ok(!SECRET.test(text));
  assert.ok(!BANNED.test(text));
  assert.ok(!Object.keys(cfg).some((k) => /token|secret|password|apiKey|clientId|clientSecret/i.test(k)));
});
check('workflow: Code nodes are generated from hcp_logic.cjs and make no network or file calls', () => {
  nodes.filter((n) => n.type === 'n8n-nodes-base.code').forEach((n) => {
    assert.match(n.parameters.jsCode, /^\/\/ Generated from hcp_logic\.cjs/);
    assert.ok(!/fetch\(|require\(|XMLHttpRequest|helpers\.(httpRequest|request)|\$http|child_process|\bfs\./.test(n.parameters.jsCode), n.name);
  });
});
check('workflow: Code nodes embed the exact @@SECTION text from hcp_logic.cjs (in sync)', () => {
  const src = rd('hcp_logic.cjs');
  const sec = (name) => src.match(new RegExp('^// @@SECTION ' + name + '\\n([\\s\\S]*?)(?=^// @@(?:SECTION|END))', 'm'))[1].trim();
  assert.ok(by['Prepare Settings'].parameters.jsCode.includes(sec('settings')));
  assert.ok(by['Parse CSV Upload'].parameters.jsCode.includes(sec('report')));
  assert.ok(by['Morning Ops Triage Logic'].parameters.jsCode.includes(sec('triage')));
  assert.ok(by['Assemble Owner Message'].parameters.jsCode.includes(sec('message')));
});
check('workflow: sticky notes carry the required statements', () => {
  assert.ok(/imported inactive/i.test(stickyText), 'inactive');
  assert.ok(/testMode (is )?on/i.test(stickyText), 'testMode');
  assert.ok(/source\*{0,2} defaults to test, which is fictional sample/i.test(stickyText), 'fictional sample default');
  assert.ok(/CSV path is the product/i.test(stickyText), 'CSV is the product');
  assert.ok(/Open API and webhooks are MAX-only and are NOT used in v0\.1/i.test(stickyText), 'MAX-only, not used');
  assert.ok(/Hard stop before go-live/.test(stickyText), 'hard stop');
  assert.ok(/NOT tested against a live Housecall Pro/.test(stickyText), 'not tested live');
});
check('workflow: node counts are the shipped 18 executable and 6 sticky notes', () => {
  assert.strictEqual(COUNT.exec, 18);
  assert.strictEqual(COUNT.sticky, 6);
});
check('workflow: routing sends test data to the built-in branch and csv to the upload / folder branches', () => {
  assert.deepStrictEqual(wf.connections['Source is CSV?'].main.map((o) => o.map((x) => x.node)), [['Upload just arrived?'], ['Load Built-in Sample Export']]);
  assert.deepStrictEqual(wf.connections['Upload just arrived?'].main.map((o) => o.map((x) => x.node)), [['Parse CSV Upload'], ['Read CSV Exports']]);
});
check('workflow: Prepare Settings has no live Housecall Pro source and forces csv for inbound uploads', () => {
  const js = by['Prepare Settings'].parameters.jsCode;
  assert.ok(/if \(inbound\) cfg\.source = 'csv'/.test(js));
  assert.ok(!/source.*hcp|source.*housecall/i.test(js.split('function prepareSettings')[0]));
});

// ---------------------------------------------------------------- shared helpers for data tests
const FILES = ['jobs', 'invoices', 'estimates'].map((k) => ({ name: 'sample-hcp-export-' + k + '.csv', text: rd('fixtures/sample-hcp-export-' + k + '.csv') }));
const sampleFiles = () => FILES.map((f) => Object.assign({}, f));
function S(over) {
  return logic.prepareSettings(Object.assign({ source: 'csv', testMode: true, businessName: SHOP, ownerEmail: 'owner@cedarcreek.test', asOfOverride: REF, estimateStalledDays: 14 }, over || {}), 0);
}
const run = (over, files) => logic.runTriage(logic.datasetFromCsvFiles(S(over), files || sampleFiles()));
const ids = (list) => list.map((i) => i.id);
const CSV = run();
const MSG = logic.renderMessage(CSV);
const JOBS_H = 'Job #,Customer name,Job description,Job status,Scheduled start,Scheduled end,Created date,Completed date,Job total,Invoice #,Invoice status';
const INV_H = 'Invoice #,Customer name,Invoice status,Invoice date,Due date,Total,Amount due,Job #';
const EST_H = 'Estimate #,Customer name,Description,Estimate status,Sent date,Total';
const csv = (header, rows) => [header].concat(rows).join('\n') + '\n';
const one = (name, t) => [{ name, text: t }];
const text_of = (d) => logic.renderMessage(d).text;

// ---------------------------------------------------------------- 2. settings
check('settings: defaults are shop-local America/Chicago, test mode on, owner-only', () => {
  const s = logic.prepareSettings({}, 0);
  assert.strictEqual(s.timezone, 'America/Chicago');
  assert.strictEqual(s.source, 'test');
  assert.strictEqual(s.testMode, true);
  assert.strictEqual(s.pastDueMinDays, 1);
  assert.strictEqual(s.estimateMinValue, 1000);
  assert.strictEqual(s.maxItemsPerSection, 10);
});
check('settings: an unknown or API-style source falls back to test with a Heads-up (no live source exists)', () => {
  ['hcp', 'housecall', 'api', 'live', 'jobber'].forEach((v) => {
    const s = logic.prepareSettings({ source: v }, 0);
    assert.strictEqual(s.source, 'test', v);
    assert.ok(s.headsUp.some((h) => /not test or csv/.test(h)));
  });
});
check('settings: source "test" forces testMode on; csv honors testMode false', () => {
  assert.strictEqual(logic.prepareSettings({ source: 'test', testMode: false }, 0).testMode, true);
  assert.strictEqual(logic.prepareSettings({ source: 'csv', testMode: false }, 0).testMode, false);
});
check('settings: estimateStalledDays is null until a whole number >= 1 is configured, and bad values explain themselves', () => {
  assert.strictEqual(logic.prepareSettings({ source: 'csv' }, 0).estimateStalledDays, null);
  assert.strictEqual(logic.prepareSettings({ source: 'csv', estimateStalledDays: '' }, 0).estimateStalledDays, null);
  assert.strictEqual(logic.prepareSettings({ source: 'csv', estimateStalledDays: 21 }, 0).estimateStalledDays, 21);
  const bad = logic.prepareSettings({ source: 'csv', estimateStalledDays: 0 }, 0);
  assert.strictEqual(bad.estimateStalledDays, null);
  assert.ok(bad.headsUp.some((h) => /whole number of 1 or more/.test(h)));
  assert.strictEqual(logic.prepareSettings({ source: 'csv', estimateStalledDays: 2.5 }, 0).estimateStalledDays, null);
  assert.strictEqual(logic.prepareSettings({ source: 'test' }, 0).estimateStalledDays, 14);
});
check('settings: pastDueMinDays below one day uses one day; negative values are reported', () => {
  assert.strictEqual(logic.prepareSettings({ pastDueMinDays: 0 }, 0).pastDueMinDays, 1);
  assert.strictEqual(logic.prepareSettings({ pastDueMinDays: 0.2 }, 0).pastDueMinDays, 1);
  const s = logic.prepareSettings({ pastDueMinDays: -3 }, 0);
  assert.strictEqual(s.pastDueMinDays, 1);
  assert.ok(s.headsUp.some((h) => /cannot be negative/.test(h)));
});
check('settings: bad timezone and bad asOfOverride throw a plain-language error', () => {
  assert.throws(() => logic.prepareSettings({ timezone: 'Mars/Base' }, 0), /not a valid time zone/);
  assert.throws(() => logic.prepareSettings({ asOfOverride: '2026-02-30' }, 0), /valid date and time/);
});
check('settings: asOfOverride with no offset is read shop-local; blank uses now', () => {
  assert.strictEqual(logic.prepareSettings({ asOfOverride: '2026-06-09 07:00' }, 0).asOf, '2026-06-09T12:00:00.000Z');
  assert.strictEqual(logic.prepareSettings({}, Date.UTC(2026, 5, 9, 12)).asOf, '2026-06-09T12:00:00.000Z');
});
check('settings: business name is flattened to one line', () => {
  assert.strictEqual(logic.prepareSettings({ businessName: 'A\nB\u0007C' }, 0).businessName, 'A B C');
});

// ---------------------------------------------------------------- 3. CSV parsing, aliases, errors
const norm = (kind, headers, rows) => logic.normalizeReportExport(kind, csv(headers, rows), { timezone: 'America/Chicago' });
check('csv: the fixture headers map every key for Jobs, Invoices, and Estimates', () => {
  const j = logic.normalizeJobsExport(FILES[0].text);
  assert.ok(j.ok, j.message);
  ['job_id', 'status', 'customer', 'title', 'address', 'scheduled_start', 'scheduled_end', 'created_at', 'completed_at', 'total', 'assigned', 'invoice_id', 'invoice_status'].forEach((k) => assert.ok(j.mapped[k], 'jobs ' + k));
  const i = logic.normalizeInvoicesExport(FILES[1].text);
  assert.ok(i.ok, i.message);
  ['invoice_id', 'due_date', 'balance', 'status', 'customer', 'total', 'issued_at', 'job_ref'].forEach((k) => assert.ok(i.mapped[k], 'invoices ' + k));
  const e = logic.normalizeEstimatesExport(FILES[2].text);
  assert.ok(e.ok, e.message);
  ['estimate_id', 'status', 'total', 'sent_at', 'created_at', 'customer', 'title'].forEach((k) => assert.ok(e.mapped[k], 'estimates ' + k));
});
check('csv: Jobs header variants (case, punctuation, underscore, hyphen) all map', () => {
  const r = norm('jobs', 'JOB NUMBER,job_status,Customer,Description,Scheduled-Start,scheduled_end,Date Completed,Job Total,Assigned To', ['7,Scheduled,Pat,Fix,3/10/2026 9:00 AM,3/10/2026 11:00 AM,,$10.00,Tech']);
  assert.ok(r.ok, r.message);
  assert.deepStrictEqual([r.mapped.job_id, r.mapped.status, r.mapped.scheduled_start, r.mapped.scheduled_end, r.mapped.assigned], ['JOB NUMBER', 'job_status', 'Scheduled-Start', 'scheduled_end', 'Assigned To']);
  assert.strictEqual(r.items[0].total, 10);
});
check('csv: Job # / Job No / Job ID and Status / Job Status are interchangeable', () => {
  ['Job #', 'Job No', 'Job ID', 'Job Number'].forEach((h) => assert.ok(norm('jobs', h + ',Status', ['1,Scheduled']).ok, h));
  ['Status', 'Job Status', 'JOB-STATUS'].forEach((h) => assert.ok(norm('jobs', 'Job #,' + h, ['1,Scheduled']).ok, h));
});
check('csv: Invoices header variants map (Amount Due / Balance, Due On / Due date, Invoice Number)', () => {
  const r = norm('invoices', 'Invoice Number,Customer,Status,Invoice Date,Due On,Balance Due,Job Number', ['9,Pat,Open,6/1/2026,6/20/2026,$50.00,12']);
  assert.ok(r.ok, r.message);
  assert.deepStrictEqual([r.mapped.invoice_id, r.mapped.due_date, r.mapped.balance, r.mapped.job_ref], ['Invoice Number', 'Due On', 'Balance Due', 'Job Number']);
  assert.strictEqual(r.items[0].balance, 50);
  assert.strictEqual(r.items[0].jobRef, '12');
  assert.ok(norm('invoices', 'Invoice #,Status,Due date,Amount Due', ['9,Open,6/20/2026,$5']).ok);
  assert.ok(norm('invoices', 'invoice_no,Status,due,Outstanding', ['9,Open,6/20/2026,$5']).ok);
});
check('csv: Estimates header variants map (Date Sent, Estimate Status, Estimate Total)', () => {
  const r = norm('estimates', 'Estimate Number,Customer,Estimate Status,Date Sent,Estimate Total', ['5,Pat,Sent,6/1/2026,"$2,000.00"']);
  assert.ok(r.ok, r.message);
  assert.deepStrictEqual([r.mapped.estimate_id, r.mapped.status, r.mapped.sent_at, r.mapped.total], ['Estimate Number', 'Estimate Status', 'Date Sent', 'Estimate Total']);
  assert.strictEqual(r.items[0].total, 2000);
});
check('csv: a blank or non-matching Status column is not confused with Invoice status on a Jobs export', () => {
  const r = norm('jobs', 'Job #,Status,Invoice status', ['1,Complete,Draft']);
  assert.ok(r.ok);
  assert.strictEqual(r.items[0].statusRaw, 'Complete');
  assert.strictEqual(r.items[0].invoiceState, 'unsent');
});
check('csv: a Jobs export with a missing Status column is rejected with a Heads-up listing the headers seen', () => {
  const r = norm('jobs', 'Job #,Customer name', ['1,Pat']);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /missing required column\(s\): Status \(or Job Status\)/);
  assert.match(r.message, /Columns found: Job #, Customer name/);
});
check('csv: an Invoices export missing Due date and Amount due names both and lists headers', () => {
  const r = norm('invoices', 'Invoice #,Customer name,Status', ['1,Pat,Open']);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /missing required column\(s\): Due date; Balance/);
  assert.match(r.message, /Columns found: Invoice #, Customer name, Status/);
});
check('csv: an Estimates export with no Sent date column is rejected (a created date cannot stand in)', () => {
  const r = norm('estimates', 'Estimate #,Status,Total,Created date', ['1,Sent,$1000,6/1/2026']);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /missing required column\(s\): Sent date/);
});
check('csv: report type is detected by columns, so file names do not matter', () => {
  const renamed = FILES.map((f, i) => ({ name: 'export-' + (i + 1) + '.csv', text: f.text }));
  const d = logic.datasetFromCsvFiles(S(), renamed);
  assert.deepStrictEqual(d.supplied, { jobs: true, invoices: true, estimates: true });
});
check('csv: a Jobs file that has its own Invoice # column is still a Jobs file, not an Invoices file', () => {
  const t = logic.parseCsvTable(FILES[0].text);
  assert.strictEqual(logic.classifyCsvTable('export.csv', t, 3), 'jobs');
  assert.strictEqual(logic.classifyCsvTable('x.csv', logic.parseCsvTable(FILES[1].text), 3), 'invoices');
  assert.strictEqual(logic.classifyCsvTable('x.csv', logic.parseCsvTable(FILES[2].text), 3), 'estimates');
});
check('csv: unrecognized files are ignored with a Heads-up; a lone unrecognized file is treated as Jobs and rejected for its columns', () => {
  const d = logic.datasetFromCsvFiles(S(), [{ name: 'notes.csv', text: 'a,b\n1,2\n' }, FILES[0]]);
  assert.ok(d.settings.headsUp.some((h) => /not recognized as a Jobs, Invoices, or Estimates report/.test(h)));
  assert.strictEqual(d.supplied.jobs, true);
  const lone = logic.datasetFromCsvFiles(S(), one('x.csv', 'a,b\n1,2\n'));
  assert.strictEqual(lone.supplied.jobs, false);
  assert.ok(lone.settings.headsUp.some((h) => /missing required column/.test(h)));
});
check('csv: an unterminated quote is an error, the file contributes no rows, and a partial file cannot look complete', () => {
  const t = logic.parseCsvTable(JOBS_H + '\n1,"Pat,x,Scheduled\n2,Lee,y,Unscheduled\n');
  assert.deepStrictEqual(t.rows, []);
  assert.match(t.warnings[0], /never closed/);
  const d = run({}, one('jobs.csv', JOBS_H + '\n1,"Pat,x,Scheduled\n2,Lee,y,Unscheduled\n'));
  assert.strictEqual(d.supplied.jobs, false);
  assert.strictEqual(d.jobsQueue.computed, false);
  assert.match(text_of(d), /never closed/);
  assert.match(text_of(d), /Jobs needing attention: not available/);
});
check('csv: other malformed quoting is rejected (text after a closing quote, quote inside an unquoted field)', () => {
  assert.match(logic.parseCsvTable('a,b\n"x"y,2\n').warnings[0], /after a closing quote/);
  assert.match(logic.parseCsvTable('a,b\nx"y",2\n').warnings[0], /quote inside an unquoted field/);
});
check('csv: duplicate headers and a row wider than the header reject the whole file', () => {
  assert.match(logic.parseCsvTable('Job #,Status,Status\n1,a,b\n').warnings[0], /Duplicate CSV headers: Status/);
  const wide = logic.parseCsvTable('Job #,Status\n1,Scheduled\n2,Scheduled,extra\n');
  assert.deepStrictEqual(wide.rows, []);
  assert.match(wide.warnings[0], /more columns than the header/);
});
check('csv: quoted commas, doubled quotes, CRLF, BOM, and a missing final newline all parse', () => {
  const t = logic.parseCsvTable('﻿Job #,Status,Customer name\r\n1,Scheduled,"Lee, Pat ""PJ"""\r\n2,Unscheduled,Sam');
  assert.strictEqual(t.warnings.length, 0);
  assert.strictEqual(t.rows.length, 2);
  assert.strictEqual(t.rows[0]['Customer name'], 'Lee, Pat "PJ"');
  assert.strictEqual(t.headers[0], 'Job #');
});
check('csv: an empty file gives a Heads-up in the digest, not a crash', () => {
  ['', '   \n\n'].forEach((body) => {
    const d = run({}, one('jobs.csv', body));
    assert.strictEqual(d.supplied.jobs, false);
    assert.match(text_of(d), /is empty/);
  });
  assert.strictEqual(run({}, []).jobsQueue.computed, false);
  assert.match(text_of(run({}, [])), /no CSV file was received/);
});
check('csv: a header-only file gives a Heads-up, not a crash and not a clean "nothing flagged"', () => {
  const d = run({}, one('jobs.csv', JOBS_H + '\n'));
  assert.strictEqual(d.supplied.jobs, false);
  assert.match(text_of(d), /header row but no data rows/);
  assert.ok(!/Nothing flagged/.test(text_of(d)));
});
check('csv: competing same-type snapshots in one batch are skipped with a Heads-up (never merged, never picked)', () => {
  const two = [FILES[0], { name: 'jobs-older.csv', text: FILES[0].text }, FILES[1]];
  const d = run({}, two);
  assert.strictEqual(d.supplied.jobs, false);
  assert.strictEqual(d.supplied.invoices, true);
  assert.match(text_of(d), /multiple Jobs exports were received \("sample-hcp-export-jobs\.csv", "jobs-older\.csv"\)/);
  const e = run({}, [FILES[2], { name: 'estimates-2.csv', text: FILES[2].text }]);
  assert.strictEqual(e.supplied.estimates, false);
  assert.match(text_of(e), /multiple Estimates exports/);
});
check('csv: any one report is enough; a report that was not sent becomes a Heads-up', () => {
  const d = run({}, [FILES[1]]);
  assert.strictEqual(d.invoicing.pastDue.computed, true);
  assert.strictEqual(d.jobsQueue.computed, false);
  assert.match(text_of(d), /No Jobs export was supplied/);
  assert.match(text_of(d), /No Estimates export was supplied/);
});
check('csv: footer / totals rows and rows without an id are skipped and counted', () => {
  const r = norm('jobs', 'Job #,Status', ['1,Scheduled', 'Total,', ',Scheduled', '2,Unscheduled']);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.skipped.length, 2);
  assert.ok(r.headsUp.some((h) => /2 rows in the Jobs export were skipped/.test(h)));
});
check('csv: repeated job numbers (one row per visit) merge into one job; conflicting invoice numbers are omitted', () => {
  const j = norm('jobs', 'Job #,Status,Scheduled start,Scheduled end', ['9,Scheduled,6/12/2026 8:00 AM,6/12/2026 4:00 PM', '9,Scheduled,,']);
  assert.strictEqual(j.items.length, 1);
  assert.strictEqual(j.items[0].visitCount, 2);
  assert.strictEqual(j.items[0].unscheduledVisits, 1);
  const i = norm('invoices', 'Invoice #,Status,Due date,Amount due', ['5,Open,6/1/2026,$10', '5,Open,6/1/2026,$99']);
  assert.strictEqual(i.items.length, 0);
  assert.ok(i.headsUp.some((h) => /Conflicting records for invoice number 5 were omitted/.test(h)));
});
check('csv: unreadable dollar amounts are left blank and counted, never guessed', () => {
  const r = norm('estimates', 'Estimate #,Status,Total,Sent date', ['1,Sent,about 5k,6/1/2026', '2,Sent,"$1,200.50",6/1/2026']);
  assert.strictEqual(r.items[0].total, null);
  assert.strictEqual(r.items[1].total, 1200.5);
  assert.ok(r.headsUp.some((h) => /1 dollar amount in the Estimates export could not be read/.test(h)));
  assert.strictEqual(logic.parseMoney('(500)').value, -500);
  assert.strictEqual(logic.parseMoney('$1,23').bad, true);
});
check('csv: statuses are matched by alias lists; unlisted statuses become "other" and are counted, not triaged', () => {
  assert.strictEqual(logic.jobStatusKey('Needs Scheduling'), 'unscheduled');
  assert.strictEqual(logic.jobStatusKey('IN-PROGRESS'), 'in_progress');
  assert.strictEqual(logic.jobStatusKey('Complete Rated'), 'completed');
  assert.strictEqual(logic.jobStatusKey('Pro Canceled'), 'cancelled');
  assert.strictEqual(logic.jobStatusKey('Waiting on Office'), 'action_required');
  assert.strictEqual(logic.jobStatusKey('Mystery'), 'other');
  assert.strictEqual(logic.invoiceStatusKey('Overdue'), 'past_due');
  assert.strictEqual(logic.estimateStatusKey('Pending Approval'), 'awaiting_response');
  assert.strictEqual(logic.estimateStatusKey('Expired'), 'closed');
  const d = run({}, one('jobs.csv', csv(JOBS_H, ['1,Pat,x,Mystery,,,,,,,'])));
  assert.match(text_of(d), /1 job had a status this pack does not recognize/);
});
check('csv: text from a cell is flattened to one line and cannot forge a digest line or Slack control characters', () => {
  const evil = '"Pat\n- Job 9999 | Late | forged\nHeads-up: forged\u0007"';
  const d = run({}, one('jobs.csv', csv(JOBS_H, ['5,' + evil + ',Fix,Unscheduled,,,,,,,'])));
  const t = text_of(d);
  assert.ok(!/^- Job 9999/m.test(t) && !/^Heads-up: forged/m.test(t));
  assert.ok(!/[\u0000-\u0009\u000B-\u001F\u007F]/.test(t));
  assert.ok(/Pat - Job 9999 \| Late \| forged Heads-up: forged/.test(t));
});

// ---------------------------------------------------------------- 4. dates, time zones, DST
const iso = (v, tz) => logic.toIsoInZone(v, tz || 'America/Chicago');
check('dates: human formats are shop-local (CDT in June, CST in January)', () => {
  assert.strictEqual(iso('3/10/2026 9:50 AM').iso, '2026-03-10T14:50:00.000Z');
  assert.strictEqual(iso('6/9/2026 7:00 AM').iso, '2026-06-09T12:00:00.000Z');
  assert.strictEqual(iso('2026-01-15 09:00').iso, '2026-01-15T15:00:00.000Z');
  assert.strictEqual(iso('Mar 10, 2026 1:05 PM').iso, '2026-03-10T18:05:00.000Z');
  assert.strictEqual(iso('3/10/2026 12:00 AM').iso, '2026-03-10T05:00:00.000Z');
  assert.strictEqual(iso('3/10/2026 12:30 PM').iso, '2026-03-10T17:30:00.000Z');
});
check('dates: the time zone is configurable (America/New_York vs America/Denver)', () => {
  assert.strictEqual(iso('6/9/2026 7:00 AM', 'America/New_York').iso, '2026-06-09T11:00:00.000Z');
  assert.strictEqual(iso('6/9/2026 7:00 AM', 'America/Denver').iso, '2026-06-09T13:00:00.000Z');
});
check('dates: ISO values with an offset or Z are kept as given', () => {
  assert.strictEqual(iso('2026-06-09T07:00:00-05:00').iso, '2026-06-09T07:00:00-05:00');
  assert.strictEqual(iso('2026-06-09T12:00:00Z').bad, false);
});
check('dates: invalid calendar dates are rejected, not rolled over (2026-02-30, 2/29/2026, 4/31, month 13)', () => {
  ['2026-02-30', '2/29/2026', '4/31/2026', '13/1/2026', '2026-13-01', '2026-02-30 09:00', '2026-02-30T10:00:00-05:00', 'Feb 30, 2026'].forEach((v) => assert.strictEqual(iso(v).bad, true, v));
  assert.strictEqual(iso('2/29/2028').bad, false);
});
check('dates: impossible times and unreadable text are rejected', () => {
  ['3/10/2026 13:00 PM', '3/10/2026 0:30 AM', '3/10/2026 25:00', '3/10/2026 9:75 AM', 'tomorrow', '10-3-2026'].forEach((v) => assert.strictEqual(iso(v).bad, true, v));
});
check('dates: spring-forward gap (2026-03-08 2:30 AM Chicago) moves forward to 3:30 AM CDT and says so', () => {
  const r = iso('3/8/2026 2:30 AM');
  assert.strictEqual(r.note, 'gap');
  assert.strictEqual(r.iso, '2026-03-08T08:30:00.000Z');
  assert.strictEqual(iso('2026-03-08 02:00').iso, '2026-03-08T08:00:00.000Z');
  assert.strictEqual(iso('3/8/2026 1:59 AM').note, '');
  assert.strictEqual(iso('3/8/2026 3:00 AM').note, '');
});
check('dates: fall-back ambiguity (2026-11-01 1:30 AM Chicago) uses the first, daylight occurrence and says so', () => {
  const r = iso('11/1/2026 1:30 AM');
  assert.strictEqual(r.note, 'ambiguous');
  assert.strictEqual(r.iso, '2026-11-01T06:30:00.000Z');
  assert.strictEqual(iso('11/1/2026 12:59 AM').note, '');
  assert.strictEqual(iso('11/1/2026 2:00 AM').iso, '2026-11-01T08:00:00.000Z');
});
check('dates: DST handling in a CSV is counted in a Heads-up (gap and ambiguity)', () => {
  const r = norm('estimates', 'Estimate #,Status,Total,Sent date', ['1,Sent,$2000,3/8/2026 2:30 AM', '2,Sent,$2000,11/1/2026 1:30 AM', '3,Sent,$2000,6/1/2026 9:00 AM']);
  assert.ok(r.ok);
  assert.ok(r.headsUp.some((h) => /spring daylight-saving gap/.test(h)));
  assert.ok(r.headsUp.some((h) => /fall daylight-saving overlap/.test(h)));
  assert.strictEqual(r.items[0].sentAt, '2026-03-08T08:30:00.000Z');
});
check('dates: an invalid calendar date in a CSV is left blank and reported, never silently accepted', () => {
  const r = norm('estimates', 'Estimate #,Status,Total,Sent date', ['1,Sent,$2000,2026-02-30', '2,Sent,$2000,2/29/2026']);
  assert.strictEqual(r.items[0].sentAt, '');
  assert.ok(r.headsUp.some((h) => /2 date values in the Estimates export could not be read/.test(h)));
  assert.match(r.headsUp.join(' '), /2026-02-30/);
});
check('dates: due dates are whole shop-local days; a bare date stays that date', () => {
  assert.strictEqual(logic.toLocalDate('6/9/2026', 'America/Chicago').date, '2026-06-09');
  assert.strictEqual(logic.toLocalDate('2026-06-09', 'America/Chicago').date, '2026-06-09');
  assert.strictEqual(logic.toLocalDate('6/9/2026 11:30 PM', 'America/Chicago').date, '2026-06-09');
  assert.strictEqual(logic.toLocalDate('2026-02-30', 'America/Chicago').bad, true);
  assert.strictEqual(logic.dayDiff('2026-03-07', '2026-03-09'), 2);
  assert.strictEqual(logic.dayDiff('2026-03-01', '2026-04-01'), 31);
});
check('dates: "today" is the shop-local day even when the instant is the next UTC day', () => {
  const late = run({ asOfOverride: '2026-06-09T23:30:00-05:00' }, one('i.csv', csv(INV_H, ['1,Pat,Open,5/1/2026,6/9/2026,$100,$100,5', '2,Lee,Open,5/1/2026,6/8/2026,$200,$200,6'])));
  assert.deepStrictEqual(ids(late.invoicing.pastDue.items), ['2']);
});

// ---------------------------------------------------------------- 5. jobs queue
check('jobs: fixture queue has the expected jobs in order (late, office action, unscheduled)', () => {
  assert.deepStrictEqual(ids(CSV.jobsQueue.items), ['4104', '4103', '4117', '4105', '4106', '4101', '4119', '4115', '4102']);
  assert.deepStrictEqual(CSV.jobsQueue.counts, { late: 3, action_required: 2, unscheduled: 4 });
  assert.strictEqual(CSV.jobsQueue.total, 9);
});
check('jobs: clean rows are not flagged (future, in-progress-not-yet-due, finished, canceled, archived, invoiced)', () => {
  ['4107', '4108', '4118', '4109', '4110', '4111', '4112', '4113', '4114', '4116'].forEach((id) => assert.ok(!ids(CSV.jobsQueue.items).includes(id), id));
});
check('jobs: a scheduled job is late only once its scheduled end has passed (boundary: end equals now is not past)', () => {
  const mk = (end) => run({}, one('j.csv', csv(JOBS_H, ['1,Pat,x,Scheduled,6/9/2026 5:00 AM,' + end + ',6/1/2026 9:00 AM,,,,']))).jobsQueue;
  assert.strictEqual(mk('6/9/2026 6:59 AM').total, 1);
  assert.strictEqual(mk('6/9/2026 7:00 AM').total, 0);
  assert.strictEqual(mk('6/9/2026 7:01 AM').total, 0);
});
check('jobs: with no end time, a start on an earlier day is late but a start earlier today is not', () => {
  const mk = (start) => run({}, one('j.csv', csv(JOBS_H, ['1,Pat,x,Scheduled,' + start + ',,6/1/2026 9:00 AM,,,,']))).jobsQueue;
  assert.strictEqual(mk('6/8/2026 4:00 PM').total, 1);
  assert.match(mk('6/8/2026 4:00 PM').items[0].reason, /no end time in the data/);
  assert.strictEqual(mk('6/9/2026 6:00 AM').total, 0);
});
check('jobs: late jobs report how long ago the scheduled end was, and the unscheduled age counts from creation', () => {
  const byId = Object.fromEntries(CSV.jobsQueue.items.map((i) => [i.id, i]));
  assert.strictEqual(byId['4104'].ageDays, 4);
  assert.strictEqual(byId['4103'].ageDays, 1);
  assert.strictEqual(byId['4101'].ageDays, 8);
  assert.match(byId['4104'].reason, /Still in progress; scheduled to end Fri Jun 5 12:00 PM/);
});
check('jobs: unscheduled comes from the status, from a "Scheduled" job with no date, and from a merged visit with no date', () => {
  const byId = Object.fromEntries(CSV.jobsQueue.items.map((i) => [i.id, i]));
  assert.strictEqual(byId['4102'].reason, 'Unscheduled');
  assert.match(byId['4115'].reason, /Marked Scheduled but has no scheduled date/);
  assert.match(byId['4119'].reason, /1 of 2 visits has no scheduled date/);
});
check('jobs: action-required statuses are listed with the status text the export used', () => {
  const byId = Object.fromEntries(CSV.jobsQueue.items.map((i) => [i.id, i]));
  assert.match(byId['4105'].reason, /status "Needs attention"/);
  assert.match(byId['4106'].reason, /status "On hold"/);
});
check('jobs: a Jobs file with no schedule columns still triages by status and says dates are unavailable', () => {
  const d = run({}, one('j.csv', 'Job #,Status\n1,Unscheduled\n2,Scheduled\n3,Needs attention\n'));
  assert.deepStrictEqual(ids(d.jobsQueue.items), ['3', '1']);
  assert.match(text_of(d), /no start-date column/);
});
check('jobs: a job with a status the pack does not know is counted, not guessed into a queue', () => {
  const d = run({}, one('j.csv', csv(JOBS_H, ['1,Pat,x,Mystery,,,,,,,', '2,Pat,x,Scheduled,6/12/2026 8:00 AM,6/12/2026 9:00 AM,,,,,'])));
  assert.strictEqual(d.jobsQueue.unrecognized, 1);
  assert.strictEqual(d.jobsQueue.total, 0);
});

// ---------------------------------------------------------------- 6. requires invoicing and past due
const pd = (rows, over) => run(over, one('i.csv', csv(INV_H, rows))).invoicing.pastDue;
check('invoicing: fixture ready-to-invoice list is oldest first and separates "no invoice" from "not sent"', () => {
  assert.deepStrictEqual(ids(CSV.invoicing.ready.items), ['4113', '4109', '4110']);
  const reasons = Object.fromEntries(CSV.invoicing.ready.items.map((i) => [i.id, i.reason]));
  assert.strictEqual(reasons['4109'], 'No invoice yet');
  assert.strictEqual(reasons['4110'], 'Invoice created but not sent');
  assert.strictEqual(CSV.invoicing.ready.total, 2100);
  assert.strictEqual(CSV.invoicing.ready.knownTotalCount, 2);
});
check('invoicing: a finished job whose invoice appears in the Invoices export (by Job #) is not listed', () => {
  assert.ok(!ids(CSV.invoicing.ready.items).includes('4112'));
  assert.ok(!ids(CSV.invoicing.ready.items).includes('4111'));
});
check('invoicing: without an invoice column or an Invoices export, finished jobs cannot be checked and the digest says so', () => {
  const d = run({}, one('j.csv', 'Job #,Status,Completed date\n1,Complete,6/1/2026\n2,Complete,6/2/2026\n'));
  assert.strictEqual(d.invoicing.ready.count, 0);
  assert.strictEqual(d.invoicing.ready.computed, false);
  assert.match(text_of(d), /2 finished jobs could not be checked for an invoice/);
});
check('invoicing: an Invoices export with no Job # column cannot mark a job invoiced (Heads-up, not a guess)', () => {
  const d = run({}, [{ name: 'j.csv', text: 'Job #,Status,Completed date\n1,Complete,6/1/2026\n' }, { name: 'i.csv', text: 'Invoice #,Status,Due date,Amount due\n9,Open,7/1/2026,$5\n' }]);
  assert.strictEqual(d.invoicing.ready.count, 0);
  assert.match(text_of(d), /1 finished job could not be checked/);
});
check('invoicing: explicit invoice states determine readiness; blank status or an invoice number alone is insufficient', () => {
  const rows = ['1,A,x,Complete,,,6/1/2026,6/2/2026,$10,55,', '2,B,x,Complete,,,6/1/2026,6/2/2026,$10,,Sent', '3,C,x,Complete,,,6/1/2026,6/2/2026,$10,,Not invoiced', '4,D,x,Complete,,,6/1/2026,6/2/2026,$10,,', '5,E,x,Complete,,,6/1/2026,6/2/2026,$10,,Draft'];
  const d = run({}, one('j.csv', csv(JOBS_H, rows)));
  assert.deepStrictEqual(ids(d.invoicing.ready.items).sort(), ['3', '5']);
  assert.match(text_of(d), /2 finished jobs could not be checked/);
});
check('invoicing: recognized linked invoices override stale incomplete Jobs signals', () => {
  const d = run({}, [
    { name: 'jobs.csv', text: 'Job #,Job Status,Invoice #,Invoice Status\n1,Complete,9,Draft\n2,Complete,10,\n3,Complete,,Not invoiced\n4,Complete,,Mystery\n' },
    { name: 'invoices.csv', text: 'Invoice #,Invoice Status,Due date,Amount Due,Job #\n9,Paid,6/1/2026,0,1\n10,Draft,,,\n11,Mystery,,,3\n' },
  ]);
  assert.deepStrictEqual(ids(d.invoicing.ready.items), ['2']);
  assert.match(text_of(d), /2 finished jobs could not be checked/);
});
check('csv: conflicting visit statuses do not depend on row order', () => {
  const r = norm('jobs', 'Job #,Job Status', ['1,Complete', '1,Scheduled', '2,Complete', '2,Done']);
  assert.deepStrictEqual(ids(r.items), ['2']);
  assert.ok(r.headsUp.some((line) => /Conflicting records for job number 1 were omitted/.test(line)));
});
check('csv: a shorter record is rejected and a malformed competing snapshot prevents use of the other file', () => {
  const short = 'Job #,Job Status,Description\n1,Unscheduled\n';
  assert.match(logic.normalizeJobsExport(short).message, /fewer columns/);
  const d = run({}, [{ name: 'jobs.csv', text: short }, { name: 'other.csv', text: 'Job #,Job Status\n2,Unscheduled\n' }]);
  assert.strictEqual(d.supplied.jobs, false);
  assert.match(text_of(d), /multiple Jobs exports/);
});
check('csv: job reports can contain an Estimate # and can determine lateness from an end-only schedule', () => {
  const d = run({}, one('report.csv', 'Job #,Job Status,Estimate #,Scheduled End\n1,Scheduled,9,6/8/2026\n'));
  assert.deepStrictEqual(ids(d.jobsQueue.items), ['1']);
  assert.strictEqual(d.jobsQueue.items[0].kind, 'late');
});
check('csv: split date and time fields use the actual visit window', () => {
  const d = run({}, one('jobs.csv', 'Job #,Job Status,Start Date,Start Time,End Date,End Time\n1,Scheduled,6/9/2026,8:00 AM,2026-06-09,10:30 AM\n'));
  assert.strictEqual(d.jobs[0].startAt, '2026-06-09T13:00:00.000Z');
  assert.strictEqual(d.jobs[0].endAt, '2026-06-09T15:30:00.000Z');
  assert.strictEqual(d.jobsQueue.total, 0);
});
check('digest: multiline IDs and C1 controls cannot create digest lines', () => {
  const d = run({}, one('jobs.csv', 'Job #,Job Status\n"1\n## fake\u009B section",Unscheduled\n'));
  const msg = logic.renderMessage(d);
  assert.match(msg.text, /Job 1 ## fake section/);
  assert.ok(!msg.slackText.includes('\n## fake') && !msg.slackText.includes('\u009B'));
});
check('invoicing: a finished job with no usable finish date says how long it waited is unknown', () => {
  const d = run({}, one('j.csv', csv(JOBS_H, ['1,A,x,Complete,,,,,$10,,Not invoiced'])));
  assert.strictEqual(d.invoicing.ready.items[0].ageDays, null);
  assert.match(text_of(d), /wait time not in the data/);
  assert.match(text_of(d), /no usable past completed or end date/);
});
check('invoicing: unsent invoices that match no job are reported, not silently counted', () => {
  assert.match(text_of(CSV), /1 unsent invoice could not be matched to a job in the Jobs export/);
});
check('past due: fixture list is ranked by outstanding balance and excludes paid, void, draft, due-today, and future', () => {
  assert.deepStrictEqual(ids(CSV.invoicing.pastDue.items), ['7001', '7009', '7002', '7005']);
  assert.strictEqual(CSV.invoicing.pastDue.total, 4655);
  ['7003', '7004', '7006', '7007', '7008', '7010', '7011'].forEach((id) => assert.ok(!ids(CSV.invoicing.pastDue.items).includes(id), id));
});
check('past due: due today is NOT past due, even with pastDueMinDays 0 (treated as 1)', () => {
  assert.deepStrictEqual(ids(pd(['1,Pat,Open,5/1/2026,6/9/2026,$100,$100,5']).items), []);
  assert.deepStrictEqual(ids(pd(['1,Pat,Open,5/1/2026,6/9/2026,$100,$100,5'], { pastDueMinDays: 0 }).items), []);
});
check('past due: due yesterday is past due with the default cutoff (1 day, inclusive)', () => {
  const r = pd(['1,Pat,Open,5/1/2026,6/8/2026,$100,$100,5']);
  assert.deepStrictEqual(ids(r.items), ['1']);
  assert.strictEqual(r.items[0].daysPastDue, 1);
});
check('past due: a larger cutoff is inclusive at exactly N days and exclusive at N-1', () => {
  const rows = ['1,A,Open,5/1/2026,6/2/2026,$100,$100,1', '2,B,Open,5/1/2026,6/3/2026,$100,$100,2'];
  assert.deepStrictEqual(ids(pd(rows, { pastDueMinDays: 7 }).items), ['1']);
  assert.deepStrictEqual(ids(pd(rows, { pastDueMinDays: 6 }).items).sort(), ['1', '2']);
});
check('past due: Paid with a leftover balance is not overdue; zero balance is not overdue', () => {
  assert.deepStrictEqual(ids(pd(['1,A,Paid,5/1/2026,5/16/2026,$100,$40,1', '2,B,Open,5/1/2026,5/16/2026,$100,$0,2', '3,C,Open,5/1/2026,5/16/2026,$100,$100,3']).items), ['3']);
});
check('past due: draft / unsent and void invoices are never overdue', () => {
  assert.deepStrictEqual(ids(pd(['1,A,Draft,5/1/2026,5/16/2026,$100,$100,1', '2,B,Void,5/1/2026,5/16/2026,$100,$100,2', '3,C,Unsent,5/1/2026,5/16/2026,$100,$100,3']).items), []);
});
check('past due: a missing due date, balance, or unknown status is skipped with a Heads-up (never invented)', () => {
  const d = run({}, one('i.csv', csv(INV_H, ['1,A,Open,5/1/2026,,$100,$100,1', '2,B,Open,5/1/2026,5/16/2026,$100,,2', '3,C,Mystery,5/1/2026,5/16/2026,$100,$100,3'])));
  const t = text_of(d);
  assert.match(t, /1 open invoice has no due date and was skipped/);
  assert.match(t, /1 open invoice has no balance in the data and was skipped/);
  assert.match(t, /1 invoice record had no recognized status/);
  assert.strictEqual(d.invoicing.pastDue.computed, false);
});
check('past due: a "Past due" status with a future due date is not listed and is called out', () => {
  const d = run({}, one('i.csv', csv(INV_H, ['1,A,Past due,5/1/2026,6/30/2026,$100,$100,1'])));
  assert.strictEqual(d.invoicing.pastDue.count, 0);
  assert.match(text_of(d), /marked past due has a due date today or in the future/);
});
check('past due: a partially paid invoice counts only its remaining balance', () => {
  const r = pd(['1,A,Partially paid,5/1/2026,5/16/2026,"$1,000.00",$250.00,1']);
  assert.strictEqual(r.total, 250);
});

// ---------------------------------------------------------------- 7. stalled estimates
const eq = (rows, over) => run(over, one('e.csv', csv(EST_H, rows))).estimateQueue;
check('estimates: fixture queue is ranked by dollar value and lists only stalled, sent, high-value estimates', () => {
  assert.deepStrictEqual(ids(CSV.estimateQueue.items), ['8101', '8102', '8112', '8104']);
  assert.strictEqual(CSV.estimateQueue.total, 28600);
});
check('estimates: drafts, accepted, declined, expired, and estimates with no send date are ignored', () => {
  ['8106', '8107', '8108', '8109', '8110'].forEach((id) => assert.ok(!ids(CSV.estimateQueue.items).includes(id), id));
});
check('estimates: a draft is ignored even if it carries a send date; "unsent" is a draft', () => {
  assert.deepStrictEqual(ids(eq(['1,A,x,Draft,5/1/2026,$5000', '2,B,x,Unsent,5/1/2026,$5000', '3,C,x,Sent,5/1/2026,$5000']).items), ['3']);
});
check('estimates: awaiting-response style statuses (Sent, Awaiting response, Pending approval, Viewed, Open) qualify; others do not', () => {
  const rows = ['Sent', 'Awaiting response', 'Pending approval', 'Viewed', 'Open', 'Approved', 'Accepted', 'Declined', 'Expired', 'Canceled'].map((s, i) => (i + 1) + ',A,x,' + s + ',5/1/2026,$5000');
  assert.deepStrictEqual(ids(eq(rows).items), ['1', '2', '3', '4', '5']);
});
check('estimates: the cutoff is inclusive in whole shop-local calendar days (13 days no, 14 days yes)', () => {
  assert.deepStrictEqual(ids(eq(['1,A,x,Sent,5/27/2026 11:59 PM,$5000', '2,B,x,Sent,5/26/2026 12:01 AM,$5000']).items), ['2']);
  assert.deepStrictEqual(ids(eq(['1,A,x,Sent,5/27/2026,$5000'], { estimateStalledDays: 13 }).items), ['1']);
});
check('estimates: the value floor is inclusive (exactly $1,000 yes, $999.99 no)', () => {
  assert.deepStrictEqual(ids(eq(['1,A,x,Sent,5/1/2026,"$1,000.00"', '2,B,x,Sent,5/1/2026,$999.99']).items), ['1']);
  assert.deepStrictEqual(ids(eq(['1,A,x,Sent,5/1/2026,$500'], { estimateMinValue: 500 }).items), ['1']);
});
check('estimates: ranked by dollar value, ties by older send date, then by number', () => {
  const r = eq(['1,A,x,Sent,5/20/2026,$2000', '2,B,x,Sent,5/10/2026,$2000', '3,C,x,Sent,5/10/2026,$2000', '4,D,x,Sent,5/1/2026,$9000']);
  assert.deepStrictEqual(ids(r.items), ['4', '2', '3', '1']);
});
check('estimates: with no estimateStalledDays configured the queue is unavailable and says what to set (no invented default)', () => {
  const d = run({ estimateStalledDays: '' }, one('e.csv', csv(EST_H, ['1,A,x,Sent,5/1/2026,$5000'])));
  assert.strictEqual(d.estimateQueue.computed, false);
  assert.match(text_of(d), /Set estimateStalledDays/);
  assert.match(text_of(d), /Stalled estimates worth a call: not available/);
});
check('estimates: a missing total or send date is skipped with a Heads-up, and a future send date is skipped', () => {
  const d = run({}, one('e.csv', csv(EST_H, ['1,A,x,Sent,5/1/2026,', '2,B,x,Sent,,$5000', '3,C,x,Sent,6/20/2026,$5000', '4,D,x,Sent,5/1/2026,$5000'])));
  assert.deepStrictEqual(ids(d.estimateQueue.items), ['4']);
  const t = text_of(d);
  assert.match(t, /1 estimate awaiting a response has no total and was skipped/);
  assert.match(t, /1 estimate awaiting a response has no send date and was skipped/);
  assert.match(t, /1 estimate has a send date in the future and was skipped/);
});
check('estimates: an unrecognized status is counted and, if nothing else qualifies, the queue is not shown as "clean"', () => {
  const d = run({}, one('e.csv', csv(EST_H, ['1,A,x,Mystery,5/1/2026,$5000'])));
  assert.strictEqual(d.estimateQueue.computed, false);
  assert.match(text_of(d), /1 estimate record had no recognized status/);
});
check('estimates: the stalled count and total in the digest match the list (no rounding drift)', () => {
  assert.match(MSG.text, /Stalled estimates worth a call: 4 estimates worth \$28,600 \(\$1,000\+, still awaiting a response 14\+ days after sending\)/);
});

// ---------------------------------------------------------------- 8. digest formatting
check('digest: [TEST] label is on the heading, subject, banner, and footer in test mode', () => {
  assert.ok(MSG.text.startsWith('# [TEST] Morning Ops Triage Digest: ' + SHOP));
  assert.ok(MSG.subject.startsWith('[TEST] Morning Ops Triage Digest: ' + SHOP));
  assert.match(MSG.text, /> \[TEST\] Preview only\. Sent to the owner address or channel you set, never to a customer\./);
  assert.match(MSG.text, /\n\[TEST\] Draft pack, not yet tested against a live Housecall Pro/);
});
check('digest: live labeling drops [TEST] everywhere when testMode is off for a csv source', () => {
  const live = logic.renderMessage(run({ testMode: false }));
  assert.ok(!/\[TEST\]/.test(live.text) && !/\[TEST\]/.test(live.subject));
  assert.ok(live.text.startsWith('# Morning Ops Triage Digest: ' + SHOP));
  assert.strictEqual(live.testMode, false);
});
check('digest: the test source can never go live (testMode is forced on and the banner says fictional)', () => {
  const t = logic.renderMessage(run({ source: 'test', testMode: false }));
  assert.match(t.text, /Built from fictional sample data\./);
  assert.ok(t.text.includes('[TEST]'));
});
check('digest: has the three numbered sections, the at-a-glance block, and the human-call wording', () => {
  assert.match(MSG.text, /## Today at a glance/);
  assert.match(MSG.text, /## 1\. Unscheduled, late & needs-office-action jobs/);
  assert.match(MSG.text, /## 2\. Ready to invoice & past-due invoices/);
  assert.match(MSG.text, /## 3\. High-value estimates for a human call/);
  assert.match(MSG.text, /Pick up the phone or write a personal note\. This pack sends nothing to customers and does not send another automated reminder\./);
  assert.match(MSG.text, /Jobs needing attention: 9 \(3 late, 2 need office action, 4 unscheduled\)/);
  assert.match(MSG.text, /Ready to invoice: 3 jobs \(\$2,100 for the 2 with a total\)/);
  assert.match(MSG.text, /Past-due invoices: 4 invoices with \$4,655 outstanding \(1\+ day past the due date\)/);
});
check('digest: Heads-up lines are present for gaps in the sample and each is prefixed "Heads-up:"', () => {
  const lines = MSG.text.split('\n').filter((l) => l.startsWith('Heads-up: '));
  assert.ok(lines.length >= 4);
  assert.match(MSG.text, /1 ready-to-invoice job has no total, so the dollar figure covers only the others\./);
  assert.match(MSG.text, /1 estimate awaiting a response has no send date and was skipped/);
});
check('digest: no NaN / undefined / null / Infinity anywhere in the fixture digest, subject, html, or Slack text', () => {
  [MSG.text, MSG.subject, MSG.html, MSG.slackText].forEach((t) => assert.ok(!BAD_OUTPUT.test(t), t.match(BAD_OUTPUT) + ''));
});
check('digest: no NaN / undefined / null / Infinity when every report is missing, empty, or broken', () => {
  [[], one('j.csv', ''), one('j.csv', 'Job #\n'), [FILES[0]], [FILES[1]], [FILES[2]], one('j.csv', 'Job #,Status\n1,\n'), one('e.csv', EST_H + '\n1,A,x,Sent,,\n')].forEach((f, i) => {
    const t = logic.renderMessage(run({}, f));
    assert.ok(!BAD_OUTPUT.test(t.text), 'case ' + i + ': ' + t.text.match(BAD_OUTPUT));
  });
});
check('digest: sections cap at maxItemsPerSection and say how many more there are', () => {
  const t = text_of(run({ maxItemsPerSection: 2 }));
  assert.match(t, /- \.\.\.and 7 more \(see the workflow output\)/);
  assert.match(t, /- \.\.\.and 2 more/);
});
check('digest: an empty queue says so plainly instead of leaving a blank section', () => {
  const d = run({}, [{ name: 'j.csv', text: csv(JOBS_H, ['1,A,x,Scheduled,6/12/2026 8:00 AM,6/12/2026 9:00 AM,,,,,']) }, { name: 'i.csv', text: csv(INV_H, ['1,A,Open,5/1/2026,7/1/2026,$5,$5,1']) }, { name: 'e.csv', text: csv(EST_H, ['1,A,x,Sent,6/8/2026,$5000']) }]);
  const t = text_of(d);
  assert.match(t, /Nothing flagged\./);
  assert.match(t, /- None\./);
  assert.match(t, /No stalled high-value estimates\./);
});
check('digest: owner delivery flags - placeholder email is blocked, a real address sends, Slack needs a channel ID', () => {
  assert.strictEqual(logic.renderMessage(run({ ownerEmail: 'owner@example.com' })).sendEmail, false);
  assert.match(logic.renderMessage(run({ ownerEmail: 'owner@example.com' })).deliveryNotes.join(' '), /Email not sent/);
  assert.strictEqual(MSG.sendEmail, true);
  assert.strictEqual(MSG.emailTo, 'owner@cedarcreek.test');
  assert.strictEqual(logic.renderMessage(run({ delivery: 'slack', ownerSlackChannel: '' })).sendSlack, false);
  assert.strictEqual(logic.renderMessage(run({ delivery: 'slack', ownerSlackChannel: 'C0123456789' })).sendSlack, true);
  assert.strictEqual(logic.renderMessage(run({ delivery: 'slack', ownerSlackChannel: '#general' })).sendSlack, false);
  assert.strictEqual(logic.renderMessage(run({ delivery: 'none' })).sendEmail, false);
});
check('digest: Slack and HTML text escape &, <, > (no @-channel or link injection) and carry no control characters', () => {
  const d = run({ businessName: 'A & B <!channel>' }, one('j.csv', csv(JOBS_H, ['1,"<@U123> & <https://x.test|link>",x,Unscheduled,,,,,,,'])));
  const m = logic.renderMessage(d);
  assert.ok(!/<!channel>|<@U123>|<https/.test(m.slackText));
  assert.ok(/&lt;!channel&gt;/.test(m.slackText) && /&amp;/.test(m.slackText));
  assert.ok(!/<!channel>/.test(m.html.replace(/<\/?pre[^>]*>/g, '')));
  assert.ok(!/[\u0000-\u0009\u000B-\u001F\u007F]/.test(m.slackText));
});
check('digest: the footer states read-only, owner-only, and not tested live', () => {
  assert.match(MSG.text, /Read-only\. Owner-only delivery\./);
  assert.match(MSG.text, /not yet tested against a live Housecall Pro, Gmail, or Slack account/);
});
check('digest: money formatting is whole dollars when whole and cents otherwise', () => {
  assert.strictEqual(logic.fmtMoney(1480), '$1,480');
  assert.strictEqual(logic.fmtMoney(1480.5), '$1,480.50');
  assert.strictEqual(logic.fmtMoney(null), 'n/a');
  assert.strictEqual(logic.fmtMoney(NaN), 'n/a');
});
check('digest: fixture names are fictional and the shop name is Cedar Creek Plumbing & Air with no reused shop names', () => {
  assert.ok(MSG.text.includes(SHOP));
  assert.ok(!REUSED_SHOPS.test(MSG.text));
  FILES.forEach((f) => { assert.ok(!REUSED_SHOPS.test(f.text)); assert.ok(!BANNED.test(f.text)); });
  assert.ok(!/@/.test(FILES.map((f) => f.text).join('\n')), 'no emails in fixtures');
  assert.ok(!/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/.test(FILES.map((f) => f.text).join('\n')), 'no phone numbers in fixtures');
});
check('fixtures: sizes and reference time are as documented (16-25 rows total, Tuesday 7:00 AM shop-local)', () => {
  const rows = FILES.reduce((a, f) => a + logic.parseCsvTable(f.text).rows.length, 0);
  assert.ok(rows >= 16 && rows <= 60, String(rows));
  assert.strictEqual(REF, '2026-06-09T07:00:00-05:00');
  assert.strictEqual(new Date(REF).getUTCDay(), 2);
});

// ---------------------------------------------------------------- 9. site and docs
const tsText = rdRepo('src/templates.ts');
const SLUG = 'housecall-pro-morning-ops-copilot';
const entryStart = tsText.indexOf('slug: "' + SLUG + '"');
const entry = entryStart === -1 ? '' : tsText.slice(entryStart, tsText.indexOf('slug: "', entryStart + 10));
const entryOf = (slug) => { const a = tsText.indexOf('slug: "' + slug + '"'); return tsText.slice(a, tsText.indexOf('slug: "', a + 10)); };
const SITE_FILES = ['src/templates.ts', 'src/pages/templates.astro', 'src/components/TemplatesTeaser.astro', 'src/components/HousecallProLivePreview.astro', 'src/components/HousecallProRoiCalculator.astro', 'src/pages/templates/[slug].astro'];
check('site: the entry exists with version v0.1.0, field-service category, New badge, and no dollar amounts', () => {
  assert.ok(entry.length > 500, 'entry missing');
  assert.ok(entry.includes('version: "v0.1.0"') && entry.includes('category: "field-service"') && entry.includes('badge: "New"'));
  assert.ok(entry.includes('filterTags: ["reporting"]'));
  assert.ok(!/\$\s?\d/.test(entry), 'no dollar amounts in the entry');
});
check('site: pricing stays PRICE_PENDING only; no $799 / $149 anywhere on the site', () => {
  assert.ok(tsText.includes('export const PRICE_PENDING = "Pricing coming soon";'));
  assert.ok(!entry.includes('price:'));
  SITE_FILES.forEach((f) => assert.ok(!PRICE.test(rdRepo(f)), f));
  assert.ok(!PRICE.test(tsText));
});
check('site: the catalog is 14 packs and no stale "13 packs" / "Thirteen" copy remains', () => {
  assert.strictEqual((tsText.match(/^ {4}slug: "/gm) || []).length, 14);
  assert.ok(tsText.includes('Draft catalog of 14 Prewired AI automation packs'));
  assert.ok(tsText.includes('Fourteen n8n automation packs') && tsText.includes('Fourteen draft n8n automation packs'));
  assert.ok(rdRepo('src/pages/templates.astro').includes('Draft catalog · 14 packs for n8n'));
  [tsText, rdRepo('src/pages/templates.astro')].forEach((t) => assert.ok(!/13 (Prewired|packs)|Thirteen|\b12 packs/.test(t)));
});
check('site: the pack sits right after Jobber and before speed-to-lead; Jobber still sits after ServiceTitan', () => {
  const st = tsText.indexOf('slug: "servicetitan-dispatch-copilot"');
  const jb = tsText.indexOf('slug: "jobber-morning-ops-copilot"');
  const hcp = tsText.indexOf('slug: "' + SLUG + '"');
  const sp = tsText.indexOf('slug: "speed-to-lead"');
  assert.ok(st < jb && jb < hcp && hcp < sp);
});
check('site: related lists link the three field-service packs to each other', () => {
  assert.ok(/related: \["servicetitan-dispatch-copilot", "jobber-morning-ops-copilot", "manager-digest"\]/.test(entry));
  assert.ok(entryOf('servicetitan-dispatch-copilot').includes('"' + SLUG + '"'));
  assert.ok(entryOf('jobber-morning-ops-copilot').includes('"' + SLUG + '"'));
});
check('site: workflow node counts match the shipped workflow JSON', () => {
  assert.ok(entry.includes('nodes: ' + COUNT.exec + ','), 'nodes');
  assert.ok(entry.includes('totalNodes: ' + COUNT.exec + ','));
  assert.ok(entry.includes('totalNodesWithNotes: ' + COUNT.total + ','));
  assert.strictEqual((entry.match(/\n {8}name: /g) || []).length, 1, 'exactly one workflow');
});
check('site: the entry is CSV-first, says MAX-only API is not used, zero write-back, owner-only, and not tested live', () => {
  assert.ok(/CSV/.test(entry) && /MAX/.test(entry));
  assert.ok(/Zero write-back/.test(entry) && /[Oo]wner-only/.test(entry));
  assert.ok(/Not yet\. It has only been checked against fictional sample data/.test(entry));
  assert.ok(/Optional MAX API|future/i.test(entry) && !/live Housecall Pro API (path|workflow)/i.test(entry));
  assert.ok(!/gumroad|checkout\//i.test(entry));
  assert.ok(!BANNED.test(entry));
});
check('site: the entry does not claim scheduled native CSV reports, invented results, or a customer-messaging feature', () => {
  assert.ok(!/scheduled (native )?(csv|reports?) (from|in) housecall/i.test(entry));
  assert.ok(!/(saves?|saved) \d|increase|boost|testimonial|case study/i.test(entry));
  assert.ok(/will not/i.test(entry) || /willNot/.test(entry));
});
check('site: preview and calculator components exist, are keyboard-accessible tabs, and carry no price or invented stats', () => {
  const prev = rdRepo('src/components/HousecallProLivePreview.astro');
  const calc = rdRepo('src/components/HousecallProRoiCalculator.astro');
  assert.ok(/role="tablist"/.test(prev) && /role="tab"/.test(prev) && /role="tabpanel"/.test(prev));
  assert.ok(/ArrowRight/.test(prev) && /ArrowLeft/.test(prev) && /Home/.test(prev) && /End/.test(prev));
  assert.ok(/aria-selected/.test(prev) && /aria-controls/.test(prev) && /tabindex/.test(prev));
  assert.ok(prev.includes(SHOP.replace('&', '&amp;')) && /fictional/i.test(prev));
  assert.ok(!/<video/.test(prev));
  assert.ok(!PRICE.test(prev + calc));
  assert.ok(!BANNED.test(prev + calc));
  assert.ok(!REUSED_SHOPS.test(prev + calc));
});
check('site: the preview has the three tabs (digest / queues / architecture) and mentions no live Housecall Pro API', () => {
  const prev = rdRepo('src/components/HousecallProLivePreview.astro');
  assert.strictEqual((prev.match(/<button[^>]*role="tab"/g) || []).length, 3);
  assert.strictEqual((prev.match(/<div[^>]*role="tabpanel"/g) || []).length, 3);
  assert.ok(/MAX/.test(prev) && /does not use/i.test(prev));
});
check('site: the calculator starts every numeric input at 0, shows its formula, and uses no industry averages', () => {
  const calc = rdRepo('src/components/HousecallProRoiCalculator.astro');
  const block = calc.match(/const defaults = \{([\s\S]*?)\};/)[1];
  const entries = block.split(',').map((x) => x.trim()).filter(Boolean);
  assert.ok(entries.length >= 8, 'has numeric inputs');
  entries.forEach((e) => assert.ok(/:\s*0$/.test(e), 'default not zero: ' + e));
  assert.ok(/type="number"/.test(calc));
  assert.ok(/[Ff]ormula/.test(calc) && /Your math/.test(calc));
  assert.ok(!/industry average|on average|typical shop|studies show/i.test(calc));
  assert.ok(/\$0/.test(calc));
});
check('site: both components are wired into [slug].astro the same way the Jobber ones are', () => {
  const slug = rdRepo('src/pages/templates/[slug].astro');
  assert.ok(/import HousecallProLivePreview from/.test(slug) && /import HousecallProRoiCalculator from/.test(slug));
  assert.ok(new RegExp('pack\\.slug === "' + SLUG + '" && <HousecallProLivePreview />').test(slug));
  assert.ok(new RegExp('pack\\.slug === "' + SLUG + '" && <HousecallProRoiCalculator />').test(slug));
  assert.ok(/pack\.slug === "jobber-morning-ops-copilot" && <JobberLivePreview \/>/.test(slug));
});
check('docs: README states draft status, CSV-first rationale, MAX-only API, unverified headers, hard stop, deletes, safety defaults', () => {
  const r = rd('README.md');
  assert.ok(/not been tested against a live Housecall Pro/i.test(r));
  assert.ok(/CSV-first/i.test(r) && /MAX/.test(r) && /\$299/.test(r) && /\$329/.test(r));
  assert.ok(/unverified/i.test(r) && /Hard stop before go-live/.test(r) && /What it will not do/.test(r) && /Safety defaults/.test(r));
  assert.ok(/Config table/.test(r) && /Optional MAX API \/ webhook extension/.test(r) && /docs\.housecallpro\.com/.test(r));
  assert.ok(/6797101-how-to-import-export-jobs-and-customers/.test(r));
  assert.ok(/mock_hcp_test\.cjs/.test(r));
  assert.ok(/not implemented/i.test(r));
  assert.ok(!/scheduled (native )?CSV reports? (are|is) (available|supported)/i.test(r));
});
check('docs: CHANGELOG starts at v0.1.0 (draft) and says it was not tested against a live account', () => {
  const c = rd('CHANGELOG.md');
  assert.ok(/^## v0\.1\.0 \(draft\)/m.test(c));
  assert.ok(/NOT tested against a live Housecall Pro/.test(c));
  assert.ok((c.match(/^## v/gm) || []).length === 1);
});
check('docs: the draft internal price appears only in README / CHANGELOG, never in site files', () => {
  assert.ok(/\$799/.test(rd('README.md') + rd('CHANGELOG.md')) && /\$149/.test(rd('README.md') + rd('CHANGELOG.md')));
  assert.ok(/not approved for the (web)?site/i.test(rd('README.md')));
  SITE_FILES.forEach((f) => assert.ok(!PRICE.test(rdRepo(f)), f));
});
check('docs: no banned strings, no reused shop names, and no phone numbers in logic, builders, docs, or this test', () => {
  ['hcp_logic.cjs', 'build_lib.cjs', 'build_workflow.cjs', 'README.md', 'CHANGELOG.md'].forEach((f) => assert.ok(!BANNED.test(rd(f)), f));
  assert.ok(!BANNED.test(fs.readFileSync(__filename, 'utf8')), 'test file itself');
  ['README.md', 'CHANGELOG.md', 'hcp_logic.cjs'].forEach((f) => assert.ok(!REUSED_SHOPS.test(rd(f)), f));
});
check('docs: the pack does not edit ServiceTitan or Jobber logic (they only get related-link and count updates)', () => {
  assert.ok(!/housecall/i.test(rdRepo('packs/servicetitan-dispatch-copilot/dispatch_logic.cjs')));
  assert.ok(!/housecall/i.test(rdRepo('packs/jobber-morning-ops-copilot/jobber_logic.cjs')));
});
check('pack does not reuse node ids from the other field-service packs', () => {
  const other = ['servicetitan-dispatch-copilot/workflow.n8n.json', 'servicetitan-dispatch-copilot/unassigned-aging-watch.json', 'servicetitan-dispatch-copilot/servicetitan-csv-fallback-triage.json', 'jobber-morning-ops-copilot/workflow.n8n.json', 'jobber-morning-ops-copilot/jobber-csv-fallback-triage.json']
    .map((f) => path.join(REPO, 'packs', f)).filter((f) => fs.existsSync(f))
    .flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).nodes.map((n) => n.id));
  const mine = new Set(nodes.map((n) => n.id));
  other.forEach((id) => assert.ok(!mine.has(id)));
});

// ---------------------------------------------------------------- 10. run the workflow's own Code nodes
async function runNode(name, { input, named, buffers }) {
  const fn = new AsyncFunction('$input', '$', by[name].parameters.jsCode);
  const items = Array.isArray(input) ? input : [{ json: input }];
  const $input = { first: () => items[0], all: () => items };
  const $ = (n) => {
    if (!named || !(n in named)) throw new Error('node ' + n + ' not available');
    return { first: () => ({ json: named[n] }), all: () => [{ json: named[n] }] };
  };
  const ctx = { helpers: { getBinaryDataBuffer: async (i, key) => buffers[i][key] || buffers[i] } };
  return fn.call(ctx, $input, $);
}
const first = async (name, o) => (await runNode(name, o))[0].json;
const cfgFor = (over) => Object.assign({}, cfg, { businessName: SHOP, ownerEmail: 'owner@cedarcreek.test', estimateStalledDays: 14 }, over || {});
async function tail(ds) {
  const d = await first('Morning Ops Triage Logic', { input: ds });
  return { data: d, msg: await first('Assemble Owner Message', { input: d }) };
}
const bin = (name) => ({ json: {}, binary: { data: { fileName: name, mimeType: 'text/csv' } } });
const fixtureBuf = (k) => ({ data: fs.readFileSync(path.join(HERE, 'fixtures', 'sample-hcp-export-' + k + '.csv')) });

(async () => {
  let manual;
  await checkAsync('nodes: Manual Test Run path (built-in sample) runs end to end and makes a [TEST] digest', async () => {
    const prep = await first('Prepare Settings', { input: cfgFor() });
    assert.strictEqual(prep.settings.source, 'test');
    assert.strictEqual(prep.inbound, false);
    const ds = await first('Load Built-in Sample Export', { input: prep, named: { 'Prepare Settings': prep } });
    manual = await tail(ds);
    assert.ok(manual.msg.subject.startsWith('[TEST] Morning Ops Triage Digest: ' + SHOP));
    assert.strictEqual(manual.msg.sendEmail, true);
    assert.strictEqual(manual.msg.testMode, true);
    assert.ok(!BAD_OUTPUT.test(manual.msg.text));
  });
  await checkAsync('nodes: the built-in sample equals the module run on the fixture files (embedded copy is in sync)', async () => {
    const n = (t) => t.replace(/source: \w+/, 'source: X').replace(' Built from fictional sample data.', '');
    assert.strictEqual(n(manual.msg.text), n(MSG.text));
    assert.deepStrictEqual(ids(manual.data.jobsQueue.items), ids(CSV.jobsQueue.items));
    assert.deepStrictEqual(ids(manual.data.estimateQueue.items), ids(CSV.estimateQueue.items));
  });
  await checkAsync('nodes: webhook upload (binary CSVs) forces csv even if Config says test, and matches the shared module', async () => {
    const ks = ['jobs', 'invoices', 'estimates'];
    const gather = await first('Gather Inbound CSV', { input: ks.map((k) => bin('sample-hcp-export-' + k + '.csv')), buffers: ks.map(fixtureBuf) });
    assert.strictEqual(gather.inbound, true);
    assert.strictEqual(gather.inboundFiles.length, 3);
    const prep = await first('Prepare Settings', { input: Object.assign({}, cfgFor({ asOfOverride: REF }), gather) });
    assert.strictEqual(prep.settings.source, 'csv');
    assert.strictEqual(prep.inbound, true);
    const ds = await first('Parse CSV Upload', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await tail(ds);
    assert.deepStrictEqual(ids(t.data.estimateQueue.items), ids(CSV.estimateQueue.items));
    assert.deepStrictEqual(ids(t.data.invoicing.pastDue.items), ids(CSV.invoicing.pastDue.items));
    assert.match(t.msg.subject, /^\[TEST\]/);
    assert.strictEqual(t.msg.text, MSG.text);
  });
  await checkAsync('nodes: watch-folder path (Read CSV Exports binary items) parses and matches the shared module', async () => {
    const prep = await first('Prepare Settings', { input: cfgFor({ source: 'csv', asOfOverride: REF }) });
    const ks = ['jobs', 'invoices', 'estimates'];
    const ds = await first('Parse CSV Upload', { input: ks.map((k) => ({ json: {}, binary: { data: { fileName: 'sample-hcp-export-' + k + '.csv' } } })), named: { 'Prepare Settings': prep }, buffers: ks.map(fixtureBuf) });
    const t = await tail(ds);
    assert.strictEqual(t.msg.text, MSG.text);
  });
  await checkAsync('nodes: email-attachment path ignores non-CSV attachments and accepts several attachment fields', async () => {
    const item = { json: {}, binary: { attachment_0: { fileName: 'jobs.csv', mimeType: 'text/csv' }, attachment_1: { fileName: 'logo.png', mimeType: 'image/png' }, attachment_2: { fileName: 'export', mimeType: 'text/csv' } } };
    const buf = { attachment_0: fixtureBuf('jobs').data, attachment_1: Buffer.from('PNG'), attachment_2: fixtureBuf('estimates').data };
    const g = await first('Gather Inbound CSV', { input: [item], buffers: [buf] });
    assert.deepStrictEqual(g.inboundFiles.map((f) => f.name), ['jobs.csv', 'export']);
  });
  await checkAsync('nodes: an inline csv string in the webhook body is accepted', async () => {
    const g = await first('Gather Inbound CSV', { input: [{ json: { body: { csv: 'Job #,Status\n1,Unscheduled\n' } } }], buffers: [{}] });
    assert.strictEqual(g.inboundFiles.length, 1);
  });
  await checkAsync('nodes: an upload with no CSV in it gives a Heads-up and is not replaced by sample data', async () => {
    const g = await first('Gather Inbound CSV', { input: [{ json: {} }], buffers: [{}] });
    const prep = await first('Prepare Settings', { input: Object.assign({}, cfgFor(), g) });
    const ds = await first('Parse CSV Upload', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await tail(ds);
    assert.match(t.msg.text, /no CSV file was received/);
    assert.ok(!/Sample Customer/.test(t.msg.text));
  });
  await checkAsync('nodes: an empty watch folder gives a Heads-up message, not a crash', async () => {
    const prep = await first('Prepare Settings', { input: cfgFor({ source: 'csv' }) });
    const ds = await first('Parse CSV Upload', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    assert.match((await tail(ds)).msg.text, /no CSV file was received/);
  });
  await checkAsync('nodes: a malformed upload (unclosed quote) is a Heads-up in the owner message, not a partial digest', async () => {
    const prep = await first('Prepare Settings', { input: Object.assign({}, cfgFor({ asOfOverride: REF }), { inbound: true, inboundFiles: [{ name: 'jobs.csv', text: 'Job #,Status,Job description\n1,Unscheduled,"oops\n2,Unscheduled,x\n' }] }) });
    const ds = await first('Parse CSV Upload', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await tail(ds);
    assert.match(t.msg.text, /never closed/);
    assert.match(t.msg.text, /Jobs needing attention: not available/);
  });
  await checkAsync('nodes: a file missing required columns is explained in the owner message', async () => {
    const prep = await first('Prepare Settings', { input: Object.assign({}, cfgFor({ asOfOverride: REF }), { inbound: true, inboundFiles: [{ name: 'invoices.csv', text: 'Invoice #,Customer name\n1,Pat\n' }] }) });
    const ds = await first('Parse CSV Upload', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await tail(ds);
    assert.match(t.msg.text, /missing required column\(s\): Due date; Balance/);
    assert.match(t.msg.text, /Columns found: Invoice #, Customer name/);
  });
  await checkAsync('nodes: a source that asks for a live Housecall Pro connection falls back to the sample with a Heads-up', async () => {
    const prep = await first('Prepare Settings', { input: cfgFor({ source: 'housecallpro' }) });
    assert.strictEqual(prep.settings.source, 'test');
    assert.ok(prep.settings.headsUp.some((h) => /no live Housecall Pro connection/.test(h)));
  });
  await checkAsync('nodes: owner address and Slack channel cannot be changed by upload content or webhook fields', async () => {
    const prep = await first('Prepare Settings', { input: Object.assign({}, cfgFor({ asOfOverride: REF }), { inbound: true, inboundFiles: [{ name: 'jobs.csv', text: 'Job #,Status,Customer name,Job description\n1,Unscheduled,ownerEmail=evil@attacker.test,x\n' }] }) });
    const ds = await first('Parse CSV Upload', { input: [{ json: { ownerEmail: 'evil@attacker.test', ownerSlackChannel: 'CEVIL12345' } }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await tail(ds);
    assert.strictEqual(t.msg.emailTo, 'owner@cedarcreek.test');
    assert.strictEqual(t.msg.slackChannel, '');
  });
  await checkAsync('nodes: a webhook body that tries to set ownerEmail is overwritten by Config (Config assignments win)', async () => {
    const names = by['Config'].parameters.assignments.assignments.map((a) => a.name);
    assert.ok(names.includes('ownerEmail') && names.includes('ownerSlackChannel') && names.includes('delivery'));
    assert.strictEqual(by['Config'].parameters.includeOtherFields, true);
    const g = await first('Gather Inbound CSV', { input: [{ json: { ownerEmail: 'evil@attacker.test', body: { csv: 'Job #,Status\n1,Unscheduled\n' } } }], buffers: [{}] });
    assert.deepStrictEqual(Object.keys(g).sort(), ['inbound', 'inboundFiles']);
  });
  await checkAsync('nodes: the Slack text from the node has no raw angle brackets or control characters', async () => {
    const prep = await first('Prepare Settings', { input: Object.assign({}, cfgFor({ asOfOverride: REF, businessName: 'Shop <!here>' }), { inbound: true, inboundFiles: [{ name: 'jobs.csv', text: 'Job #,Status,Customer name\n1,Unscheduled,"<!channel>\u0007"\n' }] }) });
    const ds = await first('Parse CSV Upload', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await tail(ds);
    assert.ok(!/<|>/.test(t.msg.slackText.replace(/&lt;|&gt;|&amp;/g, '')));
    assert.ok(!/[\u0000-\u0009\u000B-\u001F\u007F]/.test(t.msg.slackText));
  });

  // ---- regenerate the sample digest from the workflow's own code
  await checkAsync('sample_morning_digest.md is regenerated from the workflow code and is stable across two runs', async () => {
    const out = [
      '# Sample [TEST] Morning Ops digest (generated)',
      '',
      'Generated by `mock_hcp_test.cjs` from the Code nodes in `workflow.n8n.json`, run on the fictional',
      'sample exports in `fixtures/` (a made-up shop, ' + SHOP + ') with the "now" in `fixtures/reference_time.txt`.',
      'Nothing here is real Housecall Pro data, and nothing was sent anywhere. Compare your own [TEST] run with this file.',
      '',
      '## Subject',
      '',
      manual.msg.subject,
      '',
      '## Body',
      '',
      manual.msg.text,
      '',
    ].join('\n');
    const prep = await first('Prepare Settings', { input: cfgFor() });
    const again = await tail(await first('Load Built-in Sample Export', { input: prep, named: { 'Prepare Settings': prep } }));
    assert.strictEqual(again.msg.text, manual.msg.text);
    assert.ok(!BAD_OUTPUT.test(out.replace('Generated by', '').replace(/`[^`]*`/g, '')));
    fs.writeFileSync(path.join(HERE, 'sample_morning_digest.md'), out);
    assert.ok(fs.readFileSync(path.join(HERE, 'sample_morning_digest.md'), 'utf8').includes('Estimate 8101'));
  });
  check('sample_morning_digest.md has no banned strings and is labeled fictional and [TEST]', () => {
    const t = rd('sample_morning_digest.md');
    assert.ok(!BANNED.test(t) && !REUSED_SHOPS.test(t));
    assert.match(t, /fictional/i);
    assert.match(t, /\[TEST\]/);
    assert.ok(t.includes(SHOP));
  });

  report();
})();
