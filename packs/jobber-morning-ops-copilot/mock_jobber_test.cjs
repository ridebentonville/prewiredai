#!/usr/bin/env node
/**
 * Test harness for the Jobber Morning Ops Triage Copilot pack (DRAFT v0.1.0).
 *
 *   node packs/jobber-morning-ops-copilot/mock_jobber_test.cjs
 *
 * Local only. Reads the two workflow JSON files and fixtures/, never opens a network connection, and never
 * talks to Jobber, Gmail, Slack, or anyone else. "Mock" means the fictional fixtures stand in for Jobber data.
 * It:
 *   1. Checks both workflow files for the safety guarantees (inactive, disabled triggers, testMode, query-only
 *      Jobber reads, no customer-send nodes, owner-only delivery, no secrets, sticky-note wording).
 *   2. Tests the CSV mapper (header aliases, malformed / empty / header-only / missing-column input).
 *   3. Tests dates, time zones, invalid calendar dates, and the daylight-saving policy.
 *   4. Tests past-due thresholds, stalled-quote rules and ranking, and the jobs queue.
 *   5. Tests GraphQL normalization (including null startAt unscheduled visits).
 *   6. Runs the Code nodes pulled out of the workflow JSON end to end and compares them with the shared module.
 *   7. Overwrites sample_morning_digest.md.
 * Exit code 0 only if every assertion passes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const logic = require('./jobber_logic.cjs');

const HERE = __dirname;
const REPO = path.join(HERE, '..', '..');
const rd = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8');
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

// Pattern is assembled from fragments so this file itself contains none of the banned strings.
const BANNED = new RegExp([['viv', 'int'], ['bri', 'nks'], ['\\bad', 't\\b'], ['home\\s*sec', 'urity'], ['alarm\\s+', 'company'], ['sol', 'ar-only'], ['Cedar Ridge', ' Mechanical'], ['Cedar ', '& Pine']].map((p) => p.join('')).join('|'), 'i');
const BAD_OUTPUT = /\b(NaN|undefined|null|Infinity)\b/;
const SECRET = /xox[bap]-|sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{12,}|client_secret|-----BEGIN|AKIA[0-9A-Z]{12}|\b[0-9a-f]{32,}\b/i;

// ---------------------------------------------------------------- load workflows
function load(file) {
  const text = rd(file);
  const wf = JSON.parse(text);
  const nodes = wf.nodes;
  const by = Object.fromEntries(nodes.map((n) => [n.name, n]));
  const exec = nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
  const cfg = Object.fromEntries(by['Config'].parameters.assignments.assignments.map((a) => [a.name, a.value]));
  return { file, text, wf, nodes, by, exec, cfg, count: { exec: exec.length, sticky: nodes.length - exec.length, total: nodes.length } };
}
const W = load('workflow.n8n.json');
const F = load('jobber-csv-fallback-triage.json');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// ---------------------------------------------------------------- 1. workflow safety (both files)
[['live digest', W], ['csv fallback', F]].forEach(([label, w]) => {
  check(label + ': valid JSON, named, inactive', () => {
    assert.ok(/Jobber/.test(w.wf.name) && /DRAFT/.test(w.wf.name));
    assert.strictEqual(w.wf.active, false);
    assert.ok(!('pinData' in w.wf));
  });
  check(label + ': Manual Test Run exists; every schedule / webhook / Gmail trigger is disabled', () => {
    assert.ok(w.nodes.some((n) => n.type === 'n8n-nodes-base.manualTrigger'));
    const trig = w.nodes.filter((n) => /scheduleTrigger|cron|webhook|gmailTrigger/i.test(n.type));
    assert.ok(trig.length >= 1);
    trig.forEach((n) => assert.strictEqual(n.disabled, true, n.name));
    w.nodes.filter((n) => /scheduleTrigger/.test(n.type)).forEach((n) => assert.deepStrictEqual(n.parameters.rule.interval[0], { field: 'cronExpression', expression: '0 7 * * 1-5' }));
  });
  check(label + ': Config defaults are testMode on, source test, owner placeholders, shop thresholds', () => {
    assert.strictEqual(w.cfg.testMode, true);
    assert.strictEqual(w.cfg.source, 'test');
    assert.strictEqual(w.cfg.timezone, 'America/Chicago');
    assert.strictEqual(w.cfg.businessName, 'Your Business Name');
    assert.strictEqual(w.cfg.ownerEmail, 'owner@example.com');
    assert.strictEqual(w.cfg.ownerSlackChannel, '');
    assert.strictEqual(w.cfg.pastDueMinDays, 1);
    assert.strictEqual(w.cfg.quoteStalledDays, '');
    assert.strictEqual(w.cfg.quoteMinValue, 1000);
  });
  check(label + ': node ids and names are unique and every connection resolves', () => {
    assert.strictEqual(new Set(w.nodes.map((n) => n.id)).size, w.nodes.length);
    assert.strictEqual(new Set(w.nodes.map((n) => n.name)).size, w.nodes.length);
    Object.entries(w.wf.connections).forEach(([from, v]) => {
      assert.ok(w.by[from], 'unknown source ' + from);
      v.main.forEach((outs) => outs.forEach((o) => assert.ok(w.by[o.node], 'unknown target ' + o.node)));
    });
  });
  check(label + ': only allowed node types, and no customer-facing send nodes (no Twilio / SMS / similar)', () => {
    const allowed = new Set(['manualTrigger', 'scheduleTrigger', 'webhook', 'gmailTrigger', 'set', 'if', 'code', 'httpRequest', 'readWriteFile', 'gmail', 'slack', 'stickyNote'].map((t) => 'n8n-nodes-base.' + t));
    w.nodes.forEach((n) => {
      assert.ok(allowed.has(n.type), 'unexpected type ' + n.type);
      assert.ok(!/twilio|sms|whatsapp|messagebird|vonage|sendgrid|mailgun|telegram|emailSend/i.test(n.type + ' ' + n.name), n.name);
    });
    assert.strictEqual(w.exec.filter((n) => /\.gmail$|\.slack$/.test(n.type)).length, 2);
  });
  check(label + ': email and Slack recipients come only from owner Config fields, never from input rows', () => {
    assert.strictEqual(w.by['Email owner (Gmail)'].parameters.sendTo, '={{ $json.emailTo }}');
    assert.ok(w.by['Post to owner Slack'].parameters.channelId.value.includes('$json.slackChannel'));
    const asm = w.by['Assemble Owner Message'].parameters.jsCode;
    assert.ok(asm.includes('emailTo: s.ownerEmail') && asm.includes('slackChannel: s.ownerSlackChannel'));
    assert.ok(!/ownerEmail\s*=\s*(row|item|r)\./.test(asm));
  });
  check(label + ': credentials are placeholders only', () => {
    w.nodes.forEach((n) => Object.values(n.credentials || {}).forEach((c) => assert.match(c.id, /^PLACEHOLDER_[A-Z_]+$/)));
  });
  check(label + ': no secret-looking values and no banned strings', () => {
    assert.ok(!SECRET.test(w.text));
    assert.ok(!BANNED.test(w.text));
  });
  check(label + ': Code nodes are generated from jobber_logic.cjs and make no network or file calls', () => {
    w.nodes.filter((n) => n.type === 'n8n-nodes-base.code').forEach((n) => {
      assert.match(n.parameters.jsCode, /^\/\/ Generated from jobber_logic\.cjs/);
      assert.ok(!/fetch\(|require\(|XMLHttpRequest|helpers\.(httpRequest|request)|\$http|child_process|\bfs\./.test(n.parameters.jsCode), n.name);
    });
  });
  check(label + ': Code nodes embed the exact @@SECTION text from jobber_logic.cjs (in sync)', () => {
    const src = rd('jobber_logic.cjs');
    const sec = (name) => src.match(new RegExp('^// @@SECTION ' + name + '\\n([\\s\\S]*?)(?=^// @@(?:SECTION|END))', 'm'))[1].trim();
    assert.ok(w.by['Prepare Settings'].parameters.jsCode.includes(sec('settings')));
    assert.ok(w.by['Assemble Owner Message'].parameters.jsCode.includes(sec('message')));
    assert.ok(w.by['Assemble Owner Message'].parameters.jsCode.includes(sec('triage')));
  });
  check(label + ': sticky notes say inactive, testMode on, fictional sample default, unverified until live test, CSV recommended, hard stop', () => {
    const notes = w.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').map((n) => n.parameters.content).join('\n');
    assert.ok(/imported inactive/i.test(notes), 'inactive');
    assert.ok(/testMode (is )?on/i.test(notes), 'testMode');
    assert.ok(/source\*{0,2} defaults to test, which is fictional sample|fictional sample/i.test(notes), 'fictional sample default');
    assert.ok(/unverified/i.test(notes) && /live Jobber test/i.test(notes), 'unverified until live test');
    assert.ok(/CSV/.test(notes) && /recommended (way to start|first step)/i.test(notes), 'CSV recommended');
    assert.ok(/Hard stop before go-live/.test(notes), 'hard stop');
    assert.ok(/NOT tested against a live Jobber/.test(notes), 'not tested live');
  });
  check(label + ': read file node only reads', () => {
    assert.strictEqual(w.by['Read CSV Exports'].parameters.operation, 'read');
    assert.ok(!w.nodes.some((n) => n.type === 'n8n-nodes-base.readWriteFile' && n.parameters.operation !== 'read'));
  });
});

check('live digest: Config has Jobber paste-here placeholder, and no csv-fallback-only fields', () => {
  assert.match(W.cfg.jobberGraphqlVersion, /^PASTE_.*_HERE$/);
  assert.ok(!Object.keys(W.cfg).some((k) => /token|secret|password|clientId|clientSecret/i.test(k)));
});
check('live digest: exactly three Jobber HTTP nodes, all POST to the one fixed GraphQL URL', () => {
  const http = W.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.strictEqual(http.length, 3);
  http.forEach((n) => {
    assert.strictEqual(n.parameters.method, 'POST', n.name);
    assert.strictEqual(n.parameters.url, 'https://api.getjobber.com/api/graphql');
    assert.strictEqual(n.credentials.oAuth2Api.id, 'PLACEHOLDER_JOBBER');
    assert.ok(n.parameters.headerParameters.parameters.some((h) => h.name === 'X-JOBBER-GRAPHQL-VERSION'));
  });
});
check('live digest: every Jobber request body is one GraphQL query with no mutation or subscription', () => {
  W.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest').forEach((n) => {
    const body = JSON.parse(n.parameters.jsonBody);
    assert.deepStrictEqual(Object.keys(body), ['query']);
    assert.match(body.query, /^query \w+ \{/);
    assert.ok(!/\b(mutation|subscription)\b/i.test(body.query), n.name);
  });
});
check('live digest: no PUT / PATCH / DELETE anywhere, and no GraphQL mutation in either workflow or the logic', () => {
  [W, F].forEach((w) => assert.ok(!/"method":\s*"(PUT|PATCH|DELETE)"/i.test(w.text)));
  const gqlMutation = /\bmutation\s*(\{|\w+\s*[({])/i;
  assert.ok(!gqlMutation.test(W.text) && !gqlMutation.test(F.text) && !gqlMutation.test(rd('jobber_logic.cjs')));
  assert.ok(!F.nodes.some((n) => n.type === 'n8n-nodes-base.httpRequest'), 'csv fallback has no HTTP Request node');
});
check('live digest: the Jobber HTTP branch is unreachable in the default config', () => {
  const gate = W.by['Source is Jobber?'].parameters.conditions.conditions[0];
  assert.strictEqual(gate.rightValue, 'jobber');
  assert.deepStrictEqual(W.wf.connections['Source is Jobber?'].main[0].map((o) => o.node), ['Jobber: Jobs query']);
  assert.notStrictEqual(logic.prepareSettings(W.cfg, Date.now()).source, 'jobber');
  const httpNames = new Set(W.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest').map((n) => n.name));
  Object.entries(W.wf.connections).forEach(([from, v]) => v.main.forEach((outs, idx) => outs.forEach((o) => {
    if (httpNames.has(o.node) && !httpNames.has(from)) assert.ok(from === 'Source is Jobber?' && idx === 0, from + ' -> ' + o.node);
  })));
});
check('live digest: sticky notes name the endpoint and the Draft-app limit as unverified', () => {
  const notes = W.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').map((n) => n.parameters.content).join('\n');
  assert.ok(/Jobber GraphQL \+ OAuth 2\.0/.test(notes) && /api\.getjobber\.com\/api\/graphql/.test(notes) && /5 paying accounts/.test(notes));
  assert.ok(/no mutation/i.test(notes));
});
check('csv fallback: has schedule, webhook (header auth), and Gmail triggers, all disabled; Gmail only reads, from a placeholder sender', () => {
  ['scheduleTrigger', 'webhook', 'gmailTrigger'].forEach((t) => assert.ok(F.nodes.some((n) => n.type === 'n8n-nodes-base.' + t && n.disabled === true), t));
  assert.strictEqual(F.nodes.find((n) => /\.webhook$/.test(n.type)).parameters.authentication, 'headerAuth');
  const g = F.nodes.find((n) => /gmailTrigger/.test(n.type));
  assert.match(g.parameters.filters.q, /from:PASTE_ALLOWED_SENDER_HERE/);
  assert.ok(!F.exec.some((n) => /\.gmail$/.test(n.type) && n.parameters.operation !== 'send'));
});
check('csv fallback: source "jobber" is not offered (no API gate) and notes say no OAuth', () => {
  assert.ok(!F.nodes.some((n) => n.name === 'Source is Jobber?'));
  assert.ok(F.by['Prepare Settings'].parameters.jsCode.includes('no Jobber API path'));
});
check('pack does not reuse ServiceTitan node ids', () => {
  const st = ['workflow.n8n.json', 'unassigned-aging-watch.json', 'servicetitan-csv-fallback-triage.json']
    .map((f) => path.join(REPO, 'packs', 'servicetitan-dispatch-copilot', f)).filter((f) => fs.existsSync(f))
    .flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).nodes.map((n) => n.id));
  const mine = new Set(W.nodes.concat(F.nodes).map((n) => n.id));
  st.forEach((id) => assert.ok(!mine.has(id)));
});

// ---------------------------------------------------------------- 2. settings
check('settings: unknown source falls back to test; test forces testMode; jobber is allowed', () => {
  assert.strictEqual(logic.prepareSettings({ source: 'live' }, 0).source, 'test');
  assert.ok(logic.prepareSettings({ source: 'live' }, 0).headsUp.length >= 1);
  assert.strictEqual(logic.prepareSettings({ source: 'test', testMode: false }, 0).testMode, true);
  assert.strictEqual(logic.prepareSettings({ source: ' Jobber ', testMode: 'false' }, 0).testMode, false);
  assert.strictEqual(logic.prepareSettings({ source: 'csv' }, 0).testMode, true);
});
check('settings: thresholds default, accept overrides, and reject negatives with a note', () => {
  const d = logic.prepareSettings({}, 0);
  assert.deepStrictEqual([d.pastDueMinDays, d.quoteStalledDays, d.quoteMinValue, d.maxItemsPerSection], [1, 14, 1000, 10]);
  const o = logic.prepareSettings({ source: 'csv', quoteStalledDays: '21', quoteMinValue: 2500 }, 0);
  assert.strictEqual(o.quoteStalledDays, 21);
  assert.strictEqual(o.quoteMinValue, 2500);
  const n = logic.prepareSettings({ pastDueMinDays: -3 }, 0);
  assert.strictEqual(n.pastDueMinDays, 1);
  assert.ok(n.headsUp.some((h) => /cannot be negative/.test(h)));
});
check('settings: invalid time zone is a clear error, and asOfOverride wins over now', () => {
  assert.throws(() => logic.prepareSettings({ timezone: 'Mars/Olympus' }, 0), /not a valid time zone/);
  assert.strictEqual(logic.prepareSettings({ asOfOverride: '2026-03-10T07:00:00-05:00' }, 0).asOf, '2026-03-10T12:00:00.000Z');
});

// ---------------------------------------------------------------- 3. CSV parsing, aliases, errors
const TZ = 'America/Chicago';
const noRaw = (items) => items.map((i) => Object.assign({}, i, { statusRaw: '' }));
check('csv: header keys ignore case, punctuation, and space / underscore / hyphen', () => {
  assert.strictEqual(logic.headerKey('Job #'), logic.headerKey('job_number'));
  assert.strictEqual(logic.headerKey('Balance ($)'), logic.headerKey('BALANCE'));
  assert.strictEqual(logic.headerKey('Schedule start date'), logic.headerKey('schedule-start-date'));
});
check('csv: Jobs report alias variants map to the same fields', () => {
  const a = logic.normalizeJobsExport('Job #,Status,Client name,Title,Schedule start date\n7,Late,Pat Sample,Mow,3/9/2026 8:00 AM\n', { timezone: TZ });
  const b2 = logic.normalizeJobsExport('JOB_NUMBER,job-status,Customer Name,job title,Start Date\n7,Late,Pat Sample,Mow,3/9/2026 8:00 AM\n', { timezone: TZ });
  assert.ok(a.ok && b2.ok, a.message + b2.message);
  assert.deepStrictEqual(a.items, b2.items);
  assert.strictEqual(a.items[0].client, 'Pat Sample');
  assert.strictEqual(a.items[0].status, 'late');
});
check('csv: Invoices report alias variants map to the same fields', () => {
  const a = logic.normalizeInvoicesExport('Invoice #,Status,Due date,Balance ($)\n9,Past due,2/14/2026,"$1,200.50"\n', { timezone: TZ });
  const b2 = logic.normalizeInvoicesExport('Invoice Number,Invoice Status,Due,Outstanding\n9,past_due,2026-02-14,1200.5\n', { timezone: TZ });
  assert.ok(a.ok && b2.ok, a.message + b2.message);
  assert.deepStrictEqual(noRaw(a.items), noRaw(b2.items));
  assert.strictEqual(a.items[0].balance, 1200.5);
  assert.strictEqual(a.items[0].dueDate, '2026-02-14');
});
check('csv: Quotes report alias variants map to the same fields', () => {
  const a = logic.normalizeQuotesExport('Quote #,Status,Total ($),Sent date\n4,Awaiting response,"$2,000",2/10/2026\n', { timezone: TZ });
  const b2 = logic.normalizeQuotesExport('Quote Number,Quote Status,Amount,Date Sent\n4,awaiting_response,2000,2026-02-10\n', { timezone: TZ });
  assert.ok(a.ok && b2.ok, a.message + b2.message);
  assert.deepStrictEqual(noRaw(a.items), noRaw(b2.items));
  assert.strictEqual(a.items[0].status, 'awaiting_response');
  assert.strictEqual(a.items[0].total, 2000);
});
check('csv: unterminated quote is an error and the whole file is not used (a partial file cannot look complete)', () => {
  const r = logic.normalizeJobsExport('Job #,Status,Title\n1,Late,"Unclosed title\n2,Unscheduled,Fine\n', { timezone: TZ });
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /never closed/);
  assert.strictEqual(r.items.length, 0);
});
check('csv: unterminated quote through datasetFromCsvFiles becomes a Heads-up and that report is skipped', () => {
  const ds = logic.datasetFromCsvFiles(logic.prepareSettings({ source: 'csv' }, 0), [{ name: 'jobs.csv', text: 'Job #,Status\n1,"Late\n' }]);
  assert.strictEqual(ds.supplied.jobs, false);
  assert.ok(ds.settings.headsUp.some((h) => /never closed/.test(h)));
});
check('csv: quoted commas, doubled quotes, CRLF, and a BOM parse correctly', () => {
  const t = logic.parseCsvTable('﻿Job #,Status,Title\r\n1,Late,"Mow, edge ""front"" lawn"\r\n');
  assert.deepStrictEqual(t.headers, ['Job #', 'Status', 'Title']);
  assert.strictEqual(t.rows[0].Title, 'Mow, edge "front" lawn');
  assert.deepStrictEqual(t.warnings, []);
});
check('csv: a row with extra columns is reported', () => {
  const t = logic.parseCsvTable('A,B\n1,2,3\n');
  assert.ok(t.warnings.some((w) => /more columns/.test(w)));
});
check('csv: empty file gives a Heads-up, not a crash', () => {
  const r = logic.normalizeJobsExport('', { timezone: TZ });
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /is empty/);
  const ds = logic.datasetFromCsvFiles(logic.prepareSettings({ source: 'csv' }, 0), [{ name: 'a.csv', text: '' }]);
  assert.ok(ds.settings.headsUp.some((h) => /is empty/.test(h)));
});
check('csv: header-only file gives a Heads-up, not a crash', () => {
  ['jobs', 'invoices', 'quotes'].forEach((k) => {
    const head = { jobs: 'Job #,Status\n', invoices: 'Invoice #,Status,Due date,Balance ($)\n', quotes: 'Quote #,Status,Total ($),Sent date\n' }[k];
    const r = logic.normalizeReportExport(k, head, { timezone: TZ });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /header row but no data rows/);
  });
});
check('csv: missing required columns name the missing ones and list the headers seen', () => {
  const r = logic.normalizeInvoicesExport('Invoice #,Client name\n1,Pat\n', { timezone: TZ });
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /missing required column\(s\): Due date; Balance/);
  assert.match(r.message, /Columns found: Invoice #, Client name/);
  const q = logic.normalizeQuotesExport('Quote #,Status,Total ($)\n1,Draft,5\n', { timezone: TZ });
  assert.match(q.message, /Sent date/);
  const j = logic.normalizeJobsExport('Title,Client name\nMow,Pat\n', { timezone: TZ });
  assert.match(j.message, /Job # .*; Status/);
});
check('csv: missing start-date column is optional but explained; quotes with only a drafted date are rejected', () => {
  const j = logic.normalizeJobsExport('Job #,Status\n1,Unscheduled\n', { timezone: TZ });
  assert.ok(j.ok);
  assert.ok(j.headsUp.some((h) => /no start-date column/.test(h)));
  assert.strictEqual(j.items[0].startKnown, false);
  const q = logic.normalizeQuotesExport('Quote #,Status,Total ($),Drafted date\n1,Awaiting response,5000,2/1/2026\n', { timezone: TZ });
  assert.strictEqual(q.ok, false);
  assert.match(q.message, /missing required column.*Sent date/);
});
check('csv: footer / total rows and rows with no id are skipped and counted', () => {
  const r = logic.normalizeInvoicesExport('Invoice #,Status,Due date,Balance ($)\n1,Awaiting payment,2/14/2026,100\n,,\nTotal,,100\n,2/1/2026,5\n', { timezone: TZ });
  assert.strictEqual(r.items.length, 1);
  assert.ok(r.headsUp.some((h) => /2 rows .* skipped/.test(h)), r.headsUp.join('|'));
});
check('csv: unreadable money and dates are blanked and counted, never guessed', () => {
  const r = logic.normalizeInvoicesExport('Invoice #,Status,Due date,Balance ($)\n1,Awaiting payment,2026-02-30,abc\n2,Awaiting payment,2/14/2026,$50\n', { timezone: TZ });
  assert.strictEqual(r.items[0].dueDate, '');
  assert.strictEqual(r.items[0].balance, null);
  assert.ok(r.headsUp.some((h) => /1 date value/.test(h)) && r.headsUp.some((h) => /1 dollar amount/.test(h)));
});
check('csv: repeated job rows (one per visit) merge; conflicting repeated invoice rows are omitted', () => {
  const j = logic.normalizeJobsExport('Job #,Status,Schedule start date\n5,Active,3/11/2026 8:00 AM\n5,Active,\n', { timezone: TZ });
  assert.strictEqual(j.items.length, 1);
  assert.strictEqual(j.items[0].visitCount, 2);
  assert.strictEqual(j.items[0].unscheduledVisits, 1);
  const i = logic.normalizeInvoicesExport('Invoice #,Status,Due date,Balance ($)\n5,Awaiting payment,2/14/2026,100\n5,Awaiting payment,2/14/2026,999\n', { timezone: TZ });
  assert.strictEqual(i.items.length, 0);
  assert.match(i.headsUp.join(' '), /Conflicting records for invoice number 5/);
});
check('csv: money formats parse ($, commas, parentheses) and reject junk', () => {
  assert.strictEqual(logic.parseMoney('$1,234.50').value, 1234.5);
  assert.strictEqual(logic.parseMoney('(75)').value, -75);
  assert.strictEqual(logic.parseMoney('').value, null);
  assert.strictEqual(logic.parseMoney('').bad, false);
  assert.strictEqual(logic.parseMoney('12abc').bad, true);
});
check('csv: files are recognized by header signature in any order and with any name', () => {
  const files = ['quotes', 'jobs', 'invoices'].map((k) => ({ name: 'report-' + (k === 'jobs' ? 'x' : 'y') + '.csv', text: rd('fixtures/sample-jobber-export-' + k + '.csv') }));
  const ds = logic.datasetFromCsvFiles(logic.prepareSettings({ source: 'csv' }, 0), files);
  assert.deepStrictEqual(ds.supplied, { jobs: true, invoices: true, quotes: true });
  assert.deepStrictEqual([ds.jobs.length, ds.invoices.length, ds.quotes.length], [14, 8, 9]);
});
check('csv: an unrecognized file is ignored with a Heads-up; no files at all is a Heads-up', () => {
  const s = logic.prepareSettings({ source: 'csv' }, 0);
  const a = logic.datasetFromCsvFiles(s, [{ name: 'misc.csv', text: 'Foo,Bar\n1,2\n' }, { name: 'jobs.csv', text: rd('fixtures/sample-jobber-export-jobs.csv') }]);
  assert.ok(a.settings.headsUp.some((h) => /not recognized/.test(h)));
  const b2 = logic.datasetFromCsvFiles(s, []);
  assert.ok(b2.settings.headsUp.some((h) => /no CSV file was received/.test(h)));
});
check('csv: two exports of the same report require an explicit snapshot', () => {
  const s = logic.prepareSettings({ source: 'csv' }, 0);
  const ds = logic.datasetFromCsvFiles(s, [
    { name: 'old-invoices.csv', text: 'Invoice #,Status,Due date,Balance ($)\n1,Awaiting payment,2/1/2026,10\n' },
    { name: 'new-invoices.csv', text: 'Invoice #,Status,Due date,Balance ($)\n2,Awaiting payment,2/2/2026,20\n' },
  ]);
  assert.deepStrictEqual(ds.invoices, []);
  assert.ok(ds.settings.headsUp.some((h) => /Supply one snapshot/.test(h)));
});
check('csv: a single file with unrecognized headers is treated as the Jobs file and gets a clear missing-column Heads-up', () => {
  const ds = logic.datasetFromCsvFiles(logic.prepareSettings({ source: 'csv' }, 0), [{ name: 'export.csv', text: 'Foo,Bar\n1,2\n' }]);
  assert.strictEqual(ds.supplied.jobs, false);
  assert.ok(ds.settings.headsUp.some((h) => /missing required column\(s\): Job #/.test(h) && /Columns found: Foo, Bar/.test(h)));
});

// ---------------------------------------------------------------- 4. dates, time zones, DST
const iso = (v, tz) => logic.toIsoInZone(v, tz || TZ);
check('dates: 3/10/2026 9:50 AM is shop-local (CDT, UTC-5)', () => assert.strictEqual(iso('3/10/2026 9:50 AM').iso, '2026-03-10T14:50:00.000Z'));
check('dates: winter time uses CST (UTC-6) and summer uses CDT (UTC-5)', () => {
  assert.strictEqual(iso('1/15/2026 9:00 AM').iso, '2026-01-15T15:00:00.000Z');
  assert.strictEqual(iso('7/15/2026 9:00 AM').iso, '2026-07-15T14:00:00.000Z');
});
check('dates: 12 AM / 12 PM / 24-hour / ISO local / month-name formats', () => {
  assert.strictEqual(iso('3/10/2026 12:00 AM').iso, '2026-03-10T05:00:00.000Z');
  assert.strictEqual(iso('3/10/2026 12:30 PM').iso, '2026-03-10T17:30:00.000Z');
  assert.strictEqual(iso('2026-03-10 13:05').iso, '2026-03-10T18:05:00.000Z');
  assert.strictEqual(iso('Mar 10, 2026 9:50 AM').iso, '2026-03-10T14:50:00.000Z');
  assert.strictEqual(iso('March 10, 2026').iso, '2026-03-10T05:00:00.000Z');
});
check('dates: ISO with an offset or Z is kept as given', () => {
  assert.strictEqual(iso('2026-03-10T07:00:00-05:00').iso, '2026-03-10T07:00:00-05:00');
  assert.strictEqual(iso('2026-03-10T12:00:00Z').iso, '2026-03-10T12:00:00Z');
});
check('dates: another time zone is honored', () => {
  assert.strictEqual(iso('3/10/2026 9:50 AM', 'America/Los_Angeles').iso, '2026-03-10T16:50:00.000Z');
  assert.strictEqual(iso('3/10/2026 9:50 AM', 'UTC').iso, '2026-03-10T09:50:00.000Z');
});
check('dates: invalid calendar dates are rejected, not rolled over (2026-02-30, 2/29/2026, 4/31, month 13)', () => {
  ['2026-02-30', '2/29/2026', '4/31/2026', '13/1/2026', '2026-13-01', '2026-02-30 09:00', '2026-02-30T10:00:00-05:00', 'Feb 30, 2026'].forEach((v) => assert.strictEqual(iso(v).bad, true, v));
  assert.strictEqual(iso('2/29/2028').bad, false, 'leap day is valid');
});
check('dates: impossible times and nonsense are rejected', () => {
  ['3/10/2026 13:00 PM', '3/10/2026 0:30 AM', '3/10/2026 25:00', '3/10/2026 9:75 AM', 'tomorrow', '10-3-2026'].forEach((v) => assert.strictEqual(iso(v).bad, true, v));
  assert.deepStrictEqual(iso(''), { iso: '', bad: false, note: '' });
});
check('DST policy: spring-forward gap time (2026-03-08 2:30 AM Chicago does not exist) moves forward to 3:30 AM CDT and is noted', () => {
  const r = iso('3/8/2026 2:30 AM');
  assert.strictEqual(r.iso, '2026-03-08T08:30:00.000Z');
  assert.strictEqual(r.note, 'gap');
  assert.strictEqual(iso('3/8/2026 2:30 AM').iso, iso('3/8/2026 3:30 AM').iso);
});
check('DST policy: times just outside the gap are normal (1:59 AM CST, 3:00 AM CDT)', () => {
  assert.strictEqual(iso('3/8/2026 1:59 AM').iso, '2026-03-08T07:59:00.000Z');
  assert.strictEqual(iso('3/8/2026 1:59 AM').note, '');
  assert.strictEqual(iso('3/8/2026 3:00 AM').iso, '2026-03-08T08:00:00.000Z');
});
check('DST policy: fall-back ambiguous time (2026-11-01 1:30 AM happens twice) uses the FIRST occurrence (CDT) and is noted', () => {
  const r = iso('11/1/2026 1:30 AM');
  assert.strictEqual(r.iso, '2026-11-01T06:30:00.000Z');
  assert.strictEqual(r.note, 'ambiguous');
});
check('DST policy: times just outside the overlap are normal (12:59 AM CDT, 2:00 AM CST)', () => {
  assert.strictEqual(iso('11/1/2026 12:59 AM').iso, '2026-11-01T05:59:00.000Z');
  assert.strictEqual(iso('11/1/2026 12:59 AM').note, '');
  assert.strictEqual(iso('11/1/2026 2:00 AM').iso, '2026-11-01T08:00:00.000Z');
});
check('DST policy: a zone with no DST has no gap or overlap', () => {
  assert.strictEqual(iso('3/8/2026 2:30 AM', 'America/Phoenix').note, '');
  assert.strictEqual(iso('11/1/2026 1:30 AM', 'America/Phoenix').note, '');
});
check('DST policy: gap and ambiguous times in an export become Heads-up lines', () => {
  const r = logic.normalizeJobsExport('Job #,Status,Schedule start date\n1,Active,3/8/2026 2:30 AM\n2,Active,11/1/2026 1:30 AM\n', { timezone: TZ });
  assert.ok(r.ok);
  assert.ok(r.headsUp.some((h) => /spring daylight-saving gap/.test(h)));
  assert.ok(r.headsUp.some((h) => /fall daylight-saving overlap/.test(h)));
});
check('dates: due dates are bare calendar days; a due datetime becomes its shop-local day', () => {
  assert.strictEqual(logic.toLocalDate('3/10/2026', TZ).date, '2026-03-10');
  assert.strictEqual(logic.toLocalDate('2026-03-10', TZ).date, '2026-03-10');
  assert.strictEqual(logic.toLocalDate('2026-03-11T03:30:00Z', TZ).date, '2026-03-10');
  assert.strictEqual(logic.toLocalDate('2026-02-30', TZ).bad, true);
  assert.strictEqual(logic.toLocalDate('', TZ).date, '');
});
check('dates: "today" is the shop-local day, not the UTC day', () => {
  // 04:30 UTC on Mar 11 is still 11:30 PM on Mar 10 in Chicago
  const s = logic.prepareSettings({ asOfOverride: '2026-03-11T04:30:00Z' }, 0);
  const ds = { settings: s, supplied: { jobs: false, invoices: true, quotes: false }, jobs: [], quotes: [], invoices: [{ id: 'I', client: 'c', status: 'awaiting_payment', balance: 50, total: 50, dueDate: '2026-03-10' }] };
  assert.strictEqual(logic.invoicingQueue(ds).pastDue.count, 0, 'due Mar 10 is not past due at 11:30 PM Mar 10');
  const utc = Object.assign({}, ds, { settings: logic.prepareSettings({ asOfOverride: '2026-03-11T04:30:00Z', timezone: 'UTC' }, 0) });
  assert.strictEqual(logic.invoicingQueue(utc).pastDue.count, 1);
});

// ---------------------------------------------------------------- fixtures through the shared module
const REF = rd('fixtures/reference_time.txt').trim();
const SHOP = 'Bluestem Home Services (fictional sample)';
const csvSettings = (over) => logic.prepareSettings(Object.assign({ source: 'csv', businessName: SHOP, asOfOverride: REF, ownerEmail: 'owner@bluestem.test', ownerSlackChannel: 'C0123456789', quoteStalledDays: 14, delivery: 'both' }, over || {}), 0);
const sampleFiles = () => ['jobs', 'invoices', 'quotes'].map((k) => ({ name: 'sample-jobber-export-' + k + '.csv', text: rd('fixtures/sample-jobber-export-' + k + '.csv') }));
const ids = (a) => a.map((i) => i.id);
const csvData = (over) => logic.runTriage(logic.datasetFromCsvFiles(csvSettings(over), sampleFiles()));
const withSettings = (d, over) => Object.assign({}, d, { settings: csvSettings(over) });
const CSV = csvData();

check('fixtures: reference time is a shop-local ISO timestamp with an offset', () => assert.match(REF, /^2026-03-10T07:00:00-05:00$/));
check('fixtures: sample CSVs total 31 rows across Jobs, Invoices, Quotes and contain Jobber-style human headers', () => {
  assert.match(rd('fixtures/sample-jobber-export-jobs.csv').split('\n')[0], /^Job #,Status,Client name/);
  assert.match(rd('fixtures/sample-jobber-export-invoices.csv').split('\n')[0], /^Invoice #,Client name,Status/);
  assert.match(rd('fixtures/sample-jobber-export-quotes.csv').split('\n')[0], /^Quote #,Client name,Title,Status/);
  const n = ['jobs', 'invoices', 'quotes'].reduce((a, k) => a + logic.parseCsv(rd('fixtures/sample-jobber-export-' + k + '.csv')).length, 0);
  assert.strictEqual(n, 32);
});
check('fixtures: fictional shop only, and no banned or reused names in fixtures', () => {
  fs.readdirSync(path.join(HERE, 'fixtures')).forEach((f) => assert.ok(!BANNED.test(rd('fixtures/' + f)), f));
  assert.ok(/sample/i.test(rd('fixtures/sample-jobber-graphql.json')));
});

// ---------------------------------------------------------------- 5. jobs queue
check('jobs: seven jobs flagged (2 late, 1 action required, 4 unscheduled); clean rows are not', () => {
  assert.deepStrictEqual(CSV.jobsQueue.counts, { late: 2, action_required: 1, unscheduled: 4 });
  assert.strictEqual(CSV.jobsQueue.total, 7);
  ['1009', '1010', '1011', '1013', '1006', '1007', '1008'].forEach((id) => assert.ok(!ids(CSV.jobsQueue.items).includes(id), id));
});
check('jobs: order is late, then action required, then unscheduled; oldest first within a group', () => {
  assert.deepStrictEqual(ids(CSV.jobsQueue.items), ['1002', '1001', '1003', '1004', '1012', '1014', '1005']);
});
check('jobs: late age is days since the visit was due to end; unscheduled age is days since created', () => {
  const by = Object.fromEntries(CSV.jobsQueue.items.map((i) => [i.id, i]));
  assert.strictEqual(by['1002'].ageDays, 4);
  assert.strictEqual(by['1001'].ageDays, 1);
  assert.strictEqual(by['1004'].ageDays, 8);
  assert.strictEqual(by['1005'].ageDays, 1);
  assert.strictEqual(by['1003'].ageDays, null);
});
check('jobs: an Active job with no scheduled visit and a job with only some visits dated are caught', () => {
  const by = Object.fromEntries(CSV.jobsQueue.items.map((i) => [i.id, i]));
  assert.match(by['1012'].reason, /no date/);
  assert.match(by['1014'].reason, /1 of 2 visits has no date/);
});
check('jobs: completed, archived, and cancelled jobs are never flagged, even with no start date', () => {
  const s = csvSettings();
  const d = { settings: s, supplied: { jobs: true, invoices: false, quotes: false }, invoices: [], quotes: [], jobs: ['completed', 'archived', 'cancelled'].map((st, i) => ({ id: 'x' + i, status: st, startAt: '', endAt: '', startKnown: true, visitCount: 1, unscheduledVisits: 1 })) };
  assert.strictEqual(logic.jobsQueue(d).total, 0);
});
check('jobs: blank status cannot establish that a job is still open or late', () => {
  const r = logic.datasetFromCsvFiles(csvSettings(), [{ name: 'jobs.csv', text: 'Job #,Status,Schedule end date\n1,,3/9/2026 10:00 AM\n2,,3/11/2026 10:00 AM\n' }]);
  const q = logic.jobsQueue(r);
  assert.deepStrictEqual(q.items, []);
  assert.strictEqual(q.unrecognized, 2);
});
check('jobs: an unrecognized status is counted in a Heads-up and not triaged', () => {
  const r = logic.datasetFromCsvFiles(csvSettings(), [{ name: 'jobs.csv', text: 'Job #,Status\n1,Mystery\n2,Late\n' }]);
  const q = logic.jobsQueue(r);
  assert.strictEqual(q.unrecognized, 1);
  assert.ok(q.headsUp.some((h) => /status this pack does not recognize/.test(h)));
});
check('jobs: no Jobs export means a Heads-up, not zero flagged', () => {
  const d = logic.runTriage(logic.datasetFromCsvFiles(csvSettings(), sampleFiles().filter((f) => !/jobs/.test(f.name))));
  assert.strictEqual(d.jobsQueue.computed, false);
  assert.ok(d.jobsQueue.headsUp[0].includes('No Jobs export'));
  assert.ok(d.invoicing.headsUp.some((h) => /Requires Invoicing jobs need a Jobs export/.test(h)));
});

// ---------------------------------------------------------------- 6. requires invoicing and past due
check('invoicing: three Requires Invoicing jobs, oldest wait first, with a total only for the two that have one', () => {
  assert.deepStrictEqual(ids(CSV.invoicing.ready.items), ['1008', '1006', '1007']);
  assert.strictEqual(CSV.invoicing.ready.count, 3);
  assert.strictEqual(CSV.invoicing.ready.total, 435);
  assert.strictEqual(CSV.invoicing.ready.knownTotalCount, 2);
  assert.deepStrictEqual(CSV.invoicing.ready.items.map((i) => i.ageDays), [8, 5, 1]);
  assert.ok(CSV.invoicing.headsUp.some((h) => /1 Requires Invoicing job has no total/.test(h)));
});
check('past due: three invoices, largest balance first, with the outstanding balance (not the total) summed', () => {
  assert.deepStrictEqual(ids(CSV.invoicing.pastDue.items), ['2001', '2003', '2002']);
  assert.strictEqual(CSV.invoicing.pastDue.total, 4305);
  assert.deepStrictEqual(CSV.invoicing.pastDue.items.map((i) => i.daysPastDue), [24, 1, 8]);
});
check('past due: paid, draft, and bad-debt invoices and not-yet-due invoices are never listed', () => {
  ['2004', '2005', '2006', '2007', '2008'].forEach((id) => assert.ok(!ids(CSV.invoicing.pastDue.items).includes(id), id));
});
check('past due boundary: due today is NOT past due at the default (min 1 day); due yesterday IS (inclusive)', () => {
  assert.ok(!ids(CSV.invoicing.pastDue.items).includes('2004'));
  assert.ok(ids(CSV.invoicing.pastDue.items).includes('2003'));
});
check('past due boundary: pastDueMinDays = 0 still excludes due-today; = 2 drops the 1-day-late invoice; = 8 keeps exactly-8-days (inclusive)', () => {
  const at = (n) => ids(logic.invoicingQueue(withSettings(CSV, { pastDueMinDays: n })).pastDue.items);
  assert.ok(!at(0).includes('2004'));
  assert.deepStrictEqual(at(2), ['2001', '2002']);
  assert.deepStrictEqual(at(8), ['2001', '2002']);
  assert.deepStrictEqual(at(9), ['2001']);
  assert.deepStrictEqual(at(25), []);
});
check('past due: a zero balance is not past due; a negative balance is not past due', () => {
  const s = csvSettings();
  const mk = (id, bal) => ({ id, client: 'c', status: 'past_due', balance: bal, total: 10, dueDate: '2026-01-01' });
  const d = { settings: s, supplied: { jobs: false, invoices: true, quotes: false }, jobs: [], quotes: [], invoices: [mk('a', 0), mk('b', -5), mk('c2', 5)] };
  assert.deepStrictEqual(ids(logic.invoicingQueue(d).pastDue.items), ['c2']);
});
check('past due: missing balance, missing due date, and a past-due status with a future due date are explained', () => {
  const s = csvSettings();
  const d = { settings: s, supplied: { jobs: false, invoices: true, quotes: false }, jobs: [], quotes: [], invoices: [
    { id: 'nb', client: 'c', status: 'past_due', balance: null, total: 10, dueDate: '2026-01-01' },
    { id: 'nd1', client: 'c', status: 'past_due', balance: 40, total: 40, dueDate: '' },
    { id: 'nd2', client: 'c', status: 'awaiting_payment', balance: 40, total: 40, dueDate: '' },
    { id: 'fut', client: 'c', status: 'past_due', balance: 40, total: 40, dueDate: '2026-04-01' },
  ] };
  const q = logic.invoicingQueue(d);
  assert.deepStrictEqual(q.pastDue.items, []);
  assert.strictEqual(q.pastDue.computed, false);
  assert.ok(q.headsUp.some((h) => /no balance/.test(h)) && q.headsUp.some((h) => /no due date/.test(h)) && q.headsUp.some((h) => /due date today or in the future/.test(h)));
});
check('past due: invoice status is required to distinguish paid or draft balances from open invoices', () => {
  const missing = logic.normalizeInvoicesExport('Invoice #,Due date,Balance ($)\n1,3/1/2026,100\n');
  assert.match(missing.message, /missing required column.*Status/);
  const data = logic.datasetFromCsvFiles(csvSettings(), [{ name: 'invoices.csv',
    text: 'Invoice #,Invoice Status,Due date,Balance ($)\n1,,3/1/2026,100\n2,Paid,3/1/2026,50\n3,Awaiting payment,3/1/2026,10\n' }]);
  const invoices = logic.invoicingQueue(data);
  assert.deepStrictEqual(ids(invoices.pastDue.items), ['3']);
  assert.match(invoices.headsUp.join(' '), /no recognized status/);
});
check('past due: no Invoices export is a Heads-up, and Requires Invoicing still works from Jobs', () => {
  const d = logic.runTriage(logic.datasetFromCsvFiles(csvSettings(), sampleFiles().filter((f) => !/invoices/.test(f.name))));
  assert.strictEqual(d.invoicing.pastDue.computed, false);
  assert.strictEqual(d.invoicing.ready.count, 3);
  assert.ok(d.invoicing.headsUp.some((h) => /No Invoices export/.test(h)));
});

// ---------------------------------------------------------------- 7. stalled quotes
check('quotes: four stalled high-value quotes, ranked by dollar value', () => {
  assert.deepStrictEqual(ids(CSV.quoteQueue.items), ['3001', '3002', '3009', '3004']);
  assert.deepStrictEqual(CSV.quoteQueue.items.map((q) => q.total), [14800, 6200, 3300, 1000]);
  assert.strictEqual(CSV.quoteQueue.total, 25300);
});
check('quotes: approved, drafted, and changes-requested quotes are ignored', () => {
  ['3006', '3007', '3008'].forEach((id) => assert.ok(!ids(CSV.quoteQueue.items).includes(id), id));
});
check('quotes: a quote 13 days old is not yet stalled; exactly 14 days is stalled (inclusive)', () => {
  assert.ok(!ids(CSV.quoteQueue.items).includes('3003'));
  assert.ok(ids(CSV.quoteQueue.items).includes('3002'));
  assert.strictEqual(CSV.quoteQueue.items.find((q) => q.id === '3002').ageDays, 14);
  assert.strictEqual(CSV.quoteQueue.notYetStalled, 1);
});
check('quotes: a $950 quote is below the value floor; exactly $1,000 is included (inclusive)', () => {
  assert.ok(!ids(CSV.quoteQueue.items).includes('3005'));
  assert.ok(ids(CSV.quoteQueue.items).includes('3004'));
  assert.strictEqual(CSV.quoteQueue.belowValue, 1);
});
check('quotes: thresholds from Config move the boundaries', () => {
  const at = (over) => ids(logic.quoteQueue(withSettings(CSV, over)).items);
  assert.ok(at({ quoteStalledDays: 13 }).includes('3003'));
  assert.ok(!at({ quoteStalledDays: 15 }).includes('3002'));
  assert.ok(at({ quoteMinValue: 950 }).includes('3005'));
  assert.ok(!at({ quoteMinValue: 1001 }).includes('3004'));
  assert.deepStrictEqual(at({ quoteMinValue: 20000 }), []);
});
check('quotes: ties on value rank the older quote first, then by number', () => {
  const s = csvSettings();
  const mk = (id, age) => ({ id, client: 'c', status: 'awaiting_response', total: 5000, sentAt: new Date(Date.parse(REF) - age * 86400000).toISOString() });
  const d = { settings: s, supplied: { jobs: false, invoices: false, quotes: true }, jobs: [], invoices: [], quotes: [mk('b', 20), mk('a', 20), mk('c', 30)] };
  assert.deepStrictEqual(ids(logic.quoteQueue(d).items), ['c', 'a', 'b']);
});
check('quotes: missing total, missing send date, and a future send date are skipped with Heads-up lines', () => {
  const s = csvSettings();
  const base = { status: 'awaiting_response', client: 'c' };
  const d = { settings: s, supplied: { jobs: false, invoices: false, quotes: true }, jobs: [], invoices: [], quotes: [
    Object.assign({ id: 'nt', total: null, sentAt: '2026-01-01T00:00:00Z' }, base),
    Object.assign({ id: 'nd', total: 5000, sentAt: '' }, base),
    Object.assign({ id: 'fu', total: 5000, sentAt: '2026-05-01T00:00:00Z' }, base),
  ] };
  const q = logic.quoteQueue(d);
  assert.strictEqual(q.count, 0);
  assert.strictEqual(q.headsUp.length, 3);
});
check('quotes: no Quotes export is a Heads-up', () => {
  const d = logic.runTriage(logic.datasetFromCsvFiles(csvSettings(), sampleFiles().filter((f) => !/quotes/.test(f.name))));
  assert.strictEqual(d.quoteQueue.computed, false);
  assert.ok(d.quoteQueue.headsUp[0].includes('No Quotes export'));
});
check('quotes: status words (Awaiting response, Sent, Accepted, Declined, Converted, Archived) normalize', () => {
  assert.strictEqual(logic.quoteStatusKey('Awaiting response'), 'awaiting_response');
  assert.strictEqual(logic.quoteStatusKey('AWAITING_RESPONSE'), 'awaiting_response');
  assert.strictEqual(logic.quoteStatusKey('Accepted'), 'approved');
  assert.strictEqual(logic.quoteStatusKey('Declined'), 'declined');
  assert.strictEqual(logic.quoteStatusKey('Converted'), 'converted');
  assert.strictEqual(logic.quoteStatusKey('Archived'), 'archived');
  assert.strictEqual(logic.quoteStatusKey('Changes Requested'), 'changes_requested');
  assert.strictEqual(logic.quoteStatusKey(''), '');
  assert.strictEqual(logic.jobStatusKey('Requires Invoicing'), 'requires_invoicing');
  assert.strictEqual(logic.jobStatusKey('action_required'), 'action_required');
  assert.strictEqual(logic.invoiceStatusKey('Past due'), 'past_due');
  assert.strictEqual(logic.invoiceStatusKey('Bad debt'), 'bad_debt');
});


check('CSV: malformed quoting and duplicate headers reject the report', () => {
  for (const csv of ['Job #,Status\n1,"Late"x\n', 'Job #,Status\n1,L"ate"\n', 'Job #,Status,Status\n1,Late,Active\n']) {
    assert.strictEqual(logic.normalizeJobsExport(csv).ok, false);
    assert.deepStrictEqual(logic.parseCsv(csv), []);
  }
  const valid = logic.parseCsv('Job #,Status,Title\r\n1,Late,"First\r\nSecond"\r\n');
  assert.strictEqual(valid[0].Title, 'First\r\nSecond');
});
check('CSV: job-specific status wins competing aliases and reserved object names remain valid IDs', () => {
  const r = logic.normalizeJobsExport('Job #,Status,Job Status,job-status\nconstructor,Completed,Late,Today\n');
  assert.deepStrictEqual(r.items.map((job) => [job.id, job.status]), [['constructor', 'late']]);
  assert.match(r.headsUp.join(' '), /conflicting status columns/);
});
check('CSV: an invoice missing financial columns is never classified as a Jobs report', () => {
  const ds = logic.datasetFromCsvFiles(csvSettings(), [{ name: 'report.csv', text: 'Invoice #,Job #,Status\n1,2,Past Due\n' }]);
  assert.strictEqual(ds.supplied.jobs, false);
  assert.match(ds.settings.headsUp.join(' '), /Invoices export.*Due date; Balance/);
});
check('Dates and money: invalid override, invalid visit date and malformed grouping are rejected', () => {
  assert.throws(() => logic.prepareSettings({ asOfOverride: '2026-02-30T09:00:00Z' }, 0), /valid date and time/);
  const ds = logic.datasetFromCsvFiles(csvSettings(), [{ name: 'jobs.csv', text: 'Job #,Status,Schedule start date\n1,Active,2026-02-30\n' }]);
  assert.strictEqual(logic.jobsQueue(ds).total, 0);
  for (const value of ['1,20', '1 2', '(-50)', '1$2']) assert.strictEqual(logic.parseMoney(value).bad, true);
});
check('quotes: require a configured real cutoff, an actual send date and Awaiting response', () => {
  const data = { settings: csvSettings({ quoteStalledDays: '' }), supplied: { quotes: true }, quotes: [
    { id: 'exact', status: 'awaiting_response', total: 1500, sentAt: '2026-02-24T15:00:00Z' },
    { id: 'inside', status: 'awaiting_response', total: 3000, sentAt: '2026-02-25T15:00:00Z' },
    ...['Accepted', 'Declined', 'Draft', 'Sent', 'Pending'].map((status) => ({ id: status, status: logic.quoteStatusKey(status), total: 4000, sentAt: '2026-01-01T15:00:00Z' })),
  ] };
  assert.strictEqual(logic.quoteQueue(data).computed, false);
  assert.deepStrictEqual(ids(logic.quoteQueue(withSettings(data, { quoteStalledDays: 14 })).items), ['exact']);
  assert.match(logic.JOBBER_QUERIES.quotes, /quoteStatus sentAt amounts/);
});
check('GraphQL: absent or malformed visit dates do not mean an explicit unscheduled visit', () => {
  const ds = logic.normalizeJobberGraphql(csvSettings({ source: 'jobber' }), { data: { jobs: { nodes: [
    { id: 'bad', jobStatus: 'Active', visits: { nodes: [{ startAt: '2026-02-30', endAt: null }] } },
    { id: 'missing', jobStatus: 'Active', visits: { nodes: [{}] } },
    { id: 'truncated', jobStatus: 'Active', visits: { nodes: [{ startAt: null, endAt: null }], pageInfo: { hasNextPage: true } } },
  ] } } });
  assert.strictEqual(logic.jobsQueue(ds).total, 0);
  assert.match(ds.settings.headsUp.join(' '), /additional visit pages/);
  assert.match(ds.settings.headsUp.join(' '), /could not be read/);
});
check('Delivery: malformed recipient lists and Slack names are blocked and Slack commands are escaped', () => {
  const input = logic.runTriage(logic.datasetFromCsvFiles(csvSettings(), [{ name: 'jobs.csv', text: 'Job #,Status,Title\n1,Late,<!channel>\n' }]));
  for (const ownerEmail of ['owner,test@domain.test', 'owner@domain.test,archive.test', 'owner@domain.test;alias.test']) {
    assert.strictEqual(logic.renderMessage(withSettings(input, { ownerEmail })).sendEmail, false);
  }
  assert.strictEqual(logic.renderMessage(withSettings(input, { ownerSlackChannel: '#ops-owner-only' })).sendSlack, false);
  assert.match(logic.renderMessage(input).slackText, /&lt;!channel&gt;/);
  for (const w of [W, F]) {
    const slack = w.by['Post to owner Slack'].parameters;
    assert.strictEqual(slack.channelId.mode, 'id');
    assert.strictEqual(slack.otherOptions.unfurl_media, false);
    assert.strictEqual(slack.otherOptions.link_names, false);
  }
});

// ---------------------------------------------------------------- 8. GraphQL normalization
const GQL = JSON.parse(rd('fixtures/sample-jobber-graphql.json'));
const gqlSettings = () => csvSettings({ source: 'jobber' });
const G = logic.runTriage(logic.normalizeJobberGraphql(gqlSettings(), GQL));
check('graphql: jobs, invoices, and quotes normalize (14 / 8 / 9) and are marked supplied', () => {
  assert.deepStrictEqual([G.jobs.length, G.invoices.length, G.quotes.length], [14, 8, 9]);
  assert.deepStrictEqual(G.supplied, { jobs: true, invoices: true, quotes: true });
});
check('graphql: unscheduled visits with null startAt and endAt are detected', () => {
  const j = G.jobs.find((x) => x.id === '1004');
  assert.strictEqual(j.startAt, '');
  assert.strictEqual(j.unscheduledVisits, 1);
  assert.strictEqual(j.visitCount, 1);
  assert.ok(ids(G.jobsQueue.items).includes('1004'));
});
check('graphql: a job with one dated and one null visit is flagged; a job with zero visits is "no scheduled visit"', () => {
  const j = G.jobs.find((x) => x.id === '1014');
  assert.strictEqual(j.unscheduledVisits, 1);
  assert.strictEqual(j.visitCount, 2);
  assert.strictEqual(j.startAt, '2026-03-11T08:00:00-05:00');
  assert.match(G.jobsQueue.items.find((i) => i.id === '1012').reason, /No scheduled visit/);
});
check('graphql: statuses in enum style (late, action_required, requires_invoicing) map to the same queues as the CSV', () => {
  assert.deepStrictEqual(ids(G.jobsQueue.items), ids(CSV.jobsQueue.items));
  assert.deepStrictEqual(ids(G.invoicing.ready.items), ids(CSV.invoicing.ready.items));
});
check('graphql: invoice balance comes from amounts.invoiceBalance and due date stays a bare day', () => {
  const i = G.invoices.find((x) => x.id === '2003');
  assert.strictEqual(i.balance, 625);
  assert.strictEqual(i.total, 1250);
  assert.strictEqual(i.dueDate, '2026-03-09');
  assert.deepStrictEqual(ids(G.invoicing.pastDue.items), ids(CSV.invoicing.pastDue.items));
  assert.strictEqual(G.invoicing.pastDue.total, CSV.invoicing.pastDue.total);
});
check('graphql: the quote queue matches the CSV result when both sources provide a send date', () => {
  assert.deepStrictEqual(ids(G.quoteQueue.items), ids(CSV.quoteQueue.items));
  assert.strictEqual(G.quoteQueue.total, CSV.quoteQueue.total);
});
check('graphql: always carries the unverified-mapping Heads-up', () => {
  assert.ok(G.settings.headsUp.some((h) => /unverified first draft/.test(h) && /CSV export path is the recommended way to start/.test(h)));
});
check('graphql: errors, missing data, and more pages become Heads-up lines, not crashes', () => {
  const resp = {
    jobs: { errors: [{ message: 'Field "jobStatus" does not exist' }] },
    invoices: { error: 'HTTP 401' },
    quotes: { data: { quotes: { nodes: [{ id: 'q1', quoteNumber: 1, quoteStatus: 'awaiting_response', createdAt: '2026-01-01T00:00:00-06:00', amounts: { total: 2000 }, client: { name: 'A' } }], pageInfo: { hasNextPage: true } } } },
  };
  const d = logic.normalizeJobberGraphql(gqlSettings(), resp);
  const h = d.settings.headsUp.join('\n');
  assert.match(h, /error for "jobs": Field "jobStatus" does not exist/);
  assert.match(h, /"invoices" read returned no usable data/);
  assert.match(h, /"quotes" has more pages/);
  assert.deepStrictEqual(d.supplied, { jobs: false, invoices: false, quotes: true });
  const t = logic.runTriage(d);
  assert.strictEqual(t.jobsQueue.computed, false);
  assert.strictEqual(t.quoteQueue.count, 0);
  assert.match(t.quoteQueue.headsUp.join(' '), /no send date/);
});
check('graphql: a single combined response ({data:{jobs,invoices,quotes}}) is accepted; garbage input does not throw', () => {
  const one = logic.normalizeJobberGraphql(gqlSettings(), { data: { jobs: GQL.jobs.data.jobs, invoices: GQL.invoices.data.invoices, quotes: GQL.quotes.data.quotes } });
  assert.deepStrictEqual([one.jobs.length, one.invoices.length, one.quotes.length], [14, 8, 9]);
  [null, undefined, 5, 'x', []].forEach((g) => assert.doesNotThrow(() => logic.normalizeJobberGraphql(gqlSettings(), g)));
});
check('graphql: client name falls back to first + last name; money may be a string or an object; edges are accepted', () => {
  const d = logic.normalizeJobberGraphql(gqlSettings(), { quotes: { data: { quotes: { edges: [{ node: { id: 'z', quoteNumber: 5, quoteStatus: 'AWAITING_RESPONSE', createdAt: '2026-01-01T00:00:00-06:00', amounts: { total: { amount: '1,500.25' } }, client: { firstName: 'Pat', lastName: 'Sample' } } }] } } } });
  assert.strictEqual(d.quotes[0].client, 'Pat Sample');
  assert.strictEqual(d.quotes[0].total, 1500.25);
  assert.strictEqual(d.quotes[0].status, 'awaiting_response');
});
check('graphql: queries are read-only documents', () => {
  Object.values(logic.JOBBER_QUERIES).forEach((q) => { assert.match(q, /^query /); assert.ok(!/mutation/i.test(q)); });
  assert.strictEqual(logic.JOBBER_GRAPHQL_URL, 'https://api.getjobber.com/api/graphql');
});

// ---------------------------------------------------------------- 9. digest formatting
const MSG = logic.renderMessage(CSV);
check('digest: [TEST] label on subject, title, banner, and footer when testMode is on', () => {
  assert.ok(MSG.subject.startsWith('[TEST] Morning Ops Triage Digest: ' + SHOP));
  assert.ok(MSG.text.startsWith('# [TEST] Morning Ops Triage Digest'));
  assert.match(MSG.text, /> \[TEST\] Preview only/);
  assert.match(MSG.text, /\[TEST\] Draft pack, not yet tested against a live Jobber account/);
  assert.strictEqual(MSG.testMode, true);
});
check('digest: live labeling has no [TEST] anywhere when testMode is off', () => {
  const live = logic.renderMessage(withSettings(CSV, { testMode: false }));
  assert.ok(!/\[TEST\]/.test(live.text + live.subject));
  assert.ok(live.subject.startsWith('Morning Ops Triage Digest: '));
  assert.strictEqual(live.testMode, false);
});
check('digest: source test forces [TEST] even if testMode is off', () => {
  const t = logic.renderMessage(withSettings(CSV, { source: 'test', testMode: false }));
  assert.match(t.text, /\[TEST\]/);
  assert.match(t.text, /Built from fictional sample data/);
});
check('digest: at-a-glance counts and totals are right', () => {
  assert.match(MSG.text, /Jobs needing attention: 7 \(2 late, 1 action required, 4 unscheduled\)/);
  assert.match(MSG.text, /Ready to invoice: 3 jobs \(\$435 for the 2 with a total\)/);
  assert.match(MSG.text, /Past-due invoices: 3 invoices with \$4,305 outstanding/);
  assert.match(MSG.text, /Stalled quotes worth a call: 4 quotes worth \$25,300/);
});
check('digest: the quote section is framed as a human call, never another automated blast', () => {
  assert.match(MSG.text, /Pick up the phone or write a personal note/);
  assert.match(MSG.text, /sends nothing to customers and does not send another automated reminder/);
  assert.ok(MSG.text.indexOf('Quote 3001') < MSG.text.indexOf('Quote 3002') && MSG.text.indexOf('Quote 3002') < MSG.text.indexOf('Quote 3009'));
});
check('digest: Heads-up lines are listed once each, prefixed, and an unknown total says "not in the data"', () => {
  const lines = MSG.text.split('\n').filter((l) => l.startsWith('Heads-up: '));
  assert.ok(lines.length >= 2);
  assert.strictEqual(new Set(lines).size, lines.length);
  assert.match(MSG.text, /total not in the data/);
});
check('digest: no NaN, undefined, null, or Infinity in the digest, subject, or html (csv and graphql)', () => {
  [MSG, logic.renderMessage(G), logic.renderMessage(withSettings(CSV, { testMode: false }))].forEach((m) => {
    assert.ok(!BAD_OUTPUT.test(m.text), (m.text.match(BAD_OUTPUT) || [])[0]);
    assert.ok(!BAD_OUTPUT.test(m.subject) && !BAD_OUTPUT.test(m.html));
  });
});
check('digest: with nothing at all (no files) it still renders, with Heads-up lines and no bad values', () => {
  const m = logic.renderMessage(logic.runTriage(logic.datasetFromCsvFiles(csvSettings(), [])));
  assert.ok(!BAD_OUTPUT.test(m.text));
  assert.match(m.text, /not available \(see Heads-up\)/);
  assert.match(m.text, /Heads-up: CSV import: no CSV file was received/);
});
check('digest: a clean shop gets "Nothing flagged / None / No stalled" instead of empty sections', () => {
  const clean = logic.runTriage(logic.datasetFromCsvFiles(csvSettings(), [
    { name: 'jobs.csv', text: 'Job #,Status,Schedule start date\n1,Active,3/10/2026 10:00 AM\n' },
    { name: 'inv.csv', text: 'Invoice #,Status,Due date,Balance ($)\n1,Awaiting payment,3/30/2026,100\n' },
    { name: 'quotes.csv', text: 'Quote #,Status,Total ($),Sent date\n1,Awaiting response,5000,3/9/2026\n' },
  ]));
  const t = logic.renderMessage(clean).text;
  assert.match(t, /Nothing flagged/);
  assert.match(t, /Past-due invoices, largest balance first:\n- None\./);
  assert.match(t, /No stalled high-value quotes/);
  assert.match(t, /Jobs needing attention: 0/);
});
check('digest: lists are capped at maxItemsPerSection with an "...and N more" line', () => {
  const m = logic.renderMessage(withSettings(CSV, { maxItemsPerSection: 2 }));
  assert.match(m.text, /\.\.\.and 5 more/);
  assert.match(m.text, /\.\.\.and 1 more/);
});
check('digest: singular and plural wording (1 day, 1 job, 1 invoice)', () => {
  assert.match(MSG.text, /1 day late/);
  assert.match(MSG.text, /waiting 1 day so far/);
  assert.match(MSG.text, /1 day past due/);
  const one = logic.runTriage(logic.datasetFromCsvFiles(csvSettings(), [{ name: 'inv.csv', text: 'Invoice #,Status,Due date,Balance ($)\n1,Awaiting payment,3/1/2026,100\n' }]));
  assert.match(logic.renderMessage(one).text, /1 invoice with \$100 outstanding/);
});
check('digest: fractional dollars keep cents; whole dollars do not', () => {
  assert.strictEqual(logic.fmtMoney(1234.5), '$1,234.50');
  assert.strictEqual(logic.fmtMoney(1234), '$1,234');
  assert.strictEqual(logic.fmtMoney(null), 'n/a');
  assert.strictEqual(logic.fmtMoney(NaN), 'n/a');
});
check('digest: owner-only delivery flags honor delivery, placeholder email, and blank Slack', () => {
  assert.strictEqual(MSG.sendEmail, true);
  assert.strictEqual(MSG.sendSlack, true);
  assert.strictEqual(MSG.emailTo, 'owner@bluestem.test');
  const ph = logic.renderMessage(withSettings(CSV, { ownerEmail: 'owner@example.com' }));
  assert.strictEqual(ph.sendEmail, false);
  assert.ok(ph.deliveryNotes.some((n) => /placeholder/.test(n)));
  assert.strictEqual(logic.renderMessage(withSettings(CSV, { delivery: 'none' })).sendEmail, false);
  assert.strictEqual(logic.renderMessage(withSettings(CSV, { delivery: 'slack', ownerSlackChannel: '' })).sendSlack, false);
});
check('digest: html is escaped text only', () => {
  const evil = logic.runTriage(logic.datasetFromCsvFiles(csvSettings(), [{ name: 'jobs.csv', text: 'Job #,Status,Client name\n1,Late,<script>alert(1)</script>\n' }]));
  const m = logic.renderMessage(evil);
  assert.ok(!/<script>/.test(m.html) && /&lt;script&gt;/.test(m.html));
});
check('digest: the live-path (GraphQL) queues equal the CSV queues: same ids, order, counts, totals, and money lines', () => {
  assert.deepStrictEqual(ids(G.jobsQueue.items), ids(CSV.jobsQueue.items));
  assert.deepStrictEqual(G.jobsQueue.items.map((i) => [i.kind, i.ageDays]), CSV.jobsQueue.items.map((i) => [i.kind, i.ageDays]));
  assert.deepStrictEqual([G.invoicing.ready.total, G.invoicing.pastDue.total, G.quoteQueue.total], [CSV.invoicing.ready.total, CSV.invoicing.pastDue.total, CSV.quoteQueue.total]);
  const glance = (t) => t.split('## 1.')[0].replace(/source: \w+/, '');
  assert.strictEqual(glance(logic.renderMessage(G).text), glance(MSG.text));
});
check('digest: invalid / hostile cell text never changes who receives the message', () => {
  const r = logic.renderMessage(logic.runTriage(logic.datasetFromCsvFiles(csvSettings(), [{ name: 'jobs.csv', text: 'Job #,Status,Client name,Title\n1,Late,evil@attacker.test,ownerEmail=evil@attacker.test\n' }])));
  assert.strictEqual(r.emailTo, 'owner@bluestem.test');
});

// ---------------------------------------------------------------- 10. site and docs
const tsText = fs.readFileSync(path.join(REPO, 'src', 'templates.ts'), 'utf8');
const entryStart = tsText.indexOf('slug: "jobber-morning-ops-copilot"');
const entry = entryStart === -1 ? '' : tsText.slice(entryStart, tsText.indexOf('slug: "', entryStart + 10));
check('templates.ts: the Jobber Morning Ops entry exists with version, category, badge, and PRICE_PENDING-only pricing', () => {
  assert.ok(entry.length > 500, 'entry missing');
  assert.ok(entry.includes('version: "v0.1.0"') && entry.includes('category: "field-service"') && entry.includes('badge: "New"'));
  assert.ok(!/\$\s?\d/.test(entry), 'no dollar amounts in the entry');
  assert.ok(!/\$799/.test(tsText) && !/\$149/.test(tsText));
});
check('templates.ts: related list matches the spec and the ServiceTitan pack links back', () => {
  assert.ok(entry.includes('related: ["servicetitan-dispatch-copilot", "housecall-pro-morning-ops-copilot", "jobber-connector", "manager-digest"]'));
  const st = tsText.slice(tsText.indexOf('slug: "servicetitan-dispatch-copilot"'), tsText.indexOf('slug: "speed-to-lead"'));
  assert.ok(/related: \["manager-digest", "jobber-connector", "jobber-morning-ops-copilot", "housecall-pro-morning-ops-copilot"\]/.test(st));
});
check('templates.ts: node counts match the shipped workflow JSON', () => {
  assert.ok(entry.includes('nodes: ' + W.count.exec + ','), 'digest nodes');
  assert.ok(entry.includes('nodes: ' + F.count.exec + ','), 'csv nodes');
  assert.ok(entry.includes('totalNodes: ' + (W.count.exec + F.count.exec) + ','));
  assert.ok(entry.includes('totalNodesWithNotes: ' + (W.count.total + F.count.total) + ','));
});
check('templates.ts: the entry says CSV is the recommended start, GraphQL is unverified, and it has not been tested live; no checkout words', () => {
  assert.ok(/unverified/i.test(entry) && /recommended way to start/i.test(entry));
  assert.ok(/Not yet\. It has only been checked against fictional sample data/.test(entry));
  assert.ok(!/gumroad|checkout\//i.test(entry));
  assert.ok(!BANNED.test(entry));
});
check('templates.ts: the Jobber entry sits right after the ServiceTitan entry (top of the catalog)', () => {
  const a = tsText.indexOf('slug: "servicetitan-dispatch-copilot"');
  const b2 = tsText.indexOf('slug: "jobber-morning-ops-copilot"');
  const c = tsText.indexOf('slug: "speed-to-lead"');
  assert.ok(a < b2 && b2 < c);
});
check('site: the preview and calculator components exist, are wired in [slug].astro, and carry no price or invented stats', () => {
  const prev = fs.readFileSync(path.join(REPO, 'src', 'components', 'JobberLivePreview.astro'), 'utf8');
  const calc = fs.readFileSync(path.join(REPO, 'src', 'components', 'JobberRoiCalculator.astro'), 'utf8');
  const slug = fs.readFileSync(path.join(REPO, 'src', 'pages', 'templates', '[slug].astro'), 'utf8');
  assert.ok(/pack\.slug === "jobber-morning-ops-copilot" && <JobberLivePreview \/>/.test(slug));
  assert.ok(/pack\.slug === "jobber-morning-ops-copilot" && <JobberRoiCalculator \/>/.test(slug));
  assert.ok(/role="tablist"/.test(prev) && /role="tab"/.test(prev) && /role="tabpanel"/.test(prev) && /ArrowRight/.test(prev));
  assert.ok(!/\$799|\$149/.test(prev + calc));
  assert.ok(!/<video/.test(prev) || /existsSync/.test(prev), 'no video unless a real file exists');
  assert.ok(!BANNED.test(prev + calc));
});
check('docs: README and CHANGELOG state draft status, not tested live, unverified fields, hard stop, deletes, and the Jobber Connector difference', () => {
  const r = rd('README.md');
  const c = rd('CHANGELOG.md');
  assert.ok(/not been tested against a live Jobber/i.test(r) && /NOT tested against a live Jobber/.test(c));
  assert.ok(/unverified/i.test(r) && /Hard stop before go-live/.test(r) && /What it will not do/.test(r));
  assert.ok(/Jobber Connector/.test(r) && /different pack/i.test(r));
  assert.ok(/^## v0\.1\.0 \(draft\)/m.test(c));
  assert.ok(!BANNED.test(r + c));
});
check('docs: the draft internal price appears only in README / CHANGELOG, never in site files', () => {
  assert.ok(/\$799/.test(rd('README.md') + rd('CHANGELOG.md')));
  ['src/templates.ts', 'src/pages/templates.astro', 'src/components/TemplatesTeaser.astro', 'src/components/JobberLivePreview.astro', 'src/components/JobberRoiCalculator.astro', 'src/pages/templates/[slug].astro'].forEach((f) => {
    assert.ok(!/\$799/.test(fs.readFileSync(path.join(REPO, f), 'utf8')), f);
  });
});
check('docs: no banned strings in logic, builders, or this test', () => {
  ['jobber_logic.cjs', 'build_lib.cjs', 'build_workflow.cjs', 'build_csv_fallback_workflow.cjs'].forEach((f) => assert.ok(!BANNED.test(rd(f)), f));
  assert.ok(!BANNED.test(fs.readFileSync(__filename, 'utf8')), 'test file itself');
});
check('docs: the pack does not edit the ServiceTitan pack files it only cross-links', () => {
  assert.ok(!/jobber/i.test(fs.readFileSync(path.join(REPO, 'packs', 'servicetitan-dispatch-copilot', 'dispatch_logic.cjs'), 'utf8')));
});

// ---------------------------------------------------------------- 11. run the workflows' own Code nodes
async function runNode(w, name, { input, named, buffers }) {
  const fn = new AsyncFunction('$input', '$', w.by[name].parameters.jsCode);
  const items = Array.isArray(input) ? input : [{ json: input }];
  const $input = { first: () => items[0], all: () => items };
  const $ = (n) => {
    if (!named || !(n in named)) throw new Error('node ' + n + ' not available');
    return { first: () => ({ json: named[n] }), all: () => [{ json: named[n] }] };
  };
  const ctx = { helpers: { getBinaryDataBuffer: async (i, key) => buffers[i][key] || buffers[i] } };
  return fn.call(ctx, $input, $);
}
const first = async (w, name, o) => (await runNode(w, name, o))[0].json;

(async () => {
  const cfgFor = (w, over) => Object.assign({}, w.cfg, { businessName: SHOP, ownerEmail: 'owner@bluestem.test', quoteStalledDays: 14 }, over || {});
  const QUEUE_NODES = ['1. Unscheduled, Late & Action Required Jobs', '2. Requires Invoicing & Past-Due Invoices', '3. Stalled High-Value Quotes'];
  async function mainTail(ds) {
    let d = ds;
    for (const n of QUEUE_NODES) d = await first(W, n, { input: d });
    return { data: d, msg: await first(W, 'Assemble Owner Message', { input: d }) };
  }
  let wTest; let wCsv;
  await checkAsync('live digest: Manual Test Run path (built-in sample) runs end to end and makes one [TEST] message', async () => {
    const prep = await first(W, 'Prepare Settings', { input: cfgFor(W) });
    assert.strictEqual(prep.settings.source, 'test');
    const ds = await first(W, 'Load Built-in Test Data', { input: prep, named: { 'Prepare Settings': prep } });
    wTest = await mainTail(ds);
    assert.ok(wTest.msg.subject.startsWith('[TEST] Morning Ops Triage Digest: ' + SHOP));
    assert.strictEqual(wTest.msg.sendEmail, true);
    assert.ok(!BAD_OUTPUT.test(wTest.msg.text));
  });
  await checkAsync('live digest: csv-folder path reads the files and matches the shared module', async () => {
    const prep = await first(W, 'Prepare Settings', { input: cfgFor(W, { source: 'csv', asOfOverride: REF }) });
    const files = ['jobs', 'invoices', 'quotes'];
    const items = files.map((k) => ({ json: {}, binary: { data: { fileName: 'sample-jobber-export-' + k + '.csv' } } }));
    const buffers = files.map((k) => ({ data: fs.readFileSync(path.join(HERE, 'fixtures', 'sample-jobber-export-' + k + '.csv')) }));
    const ds = await first(W, 'Parse CSV Exports', { input: items, named: { 'Prepare Settings': prep }, buffers });
    wCsv = await mainTail(ds);
    assert.deepStrictEqual(ids(wCsv.data.jobsQueue.items), ids(CSV.jobsQueue.items));
    assert.deepStrictEqual(ids(wCsv.data.invoicing.pastDue.items), ids(CSV.invoicing.pastDue.items));
    assert.deepStrictEqual(ids(wCsv.data.quoteQueue.items), ids(CSV.quoteQueue.items));
  });
  await checkAsync('live digest: csv-path message equals the shared module message for the same data', async () => {
    const direct = logic.renderMessage(logic.runTriage(logic.datasetFromCsvFiles(logic.prepareSettings(cfgFor(W, { source: 'csv', asOfOverride: REF }), 0), sampleFiles())));
    assert.strictEqual(wCsv.msg.text, direct.text);
  });
  await checkAsync('live digest: built-in sample equals the sample CSV files (embedded copy is in sync) apart from the source label', async () => {
    const norm = (t) => t.replace(/source: \w+/, 'source: X').replace(' Built from fictional sample data.', '');
    assert.strictEqual(norm(wTest.msg.text), norm(wCsv.msg.text));
  });
  await checkAsync('live digest: an empty watch folder gives a Heads-up message, not a crash', async () => {
    const prep = await first(W, 'Prepare Settings', { input: cfgFor(W, { source: 'csv' }) });
    const ds = await first(W, 'Parse CSV Exports', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await mainTail(ds);
    assert.match(t.msg.text, /no CSV file was received/);
  });
  await checkAsync('live digest: Normalize Jobber runs on mocked GraphQL responses and the digest matches the shared module', async () => {
    const prep = await first(W, 'Prepare Settings', { input: cfgFor(W, { source: 'jobber', asOfOverride: REF }) });
    const named = { 'Prepare Settings': prep, 'Jobber: Jobs query': GQL.jobs, 'Jobber: Invoices query': GQL.invoices, 'Jobber: Quotes query': GQL.quotes };
    const ds = await first(W, 'Normalize Jobber', { input: prep, named });
    const t = await mainTail(ds);
    assert.deepStrictEqual(ids(t.data.quoteQueue.items), ['3001', '3002', '3009', '3004']);
    assert.match(t.msg.text, /source: jobber/);
    assert.match(t.msg.text, /unverified first draft/);
  });
  await checkAsync('live digest: a failed Jobber call (HTTP error output) becomes a Heads-up, not a crash', async () => {
    const prep = await first(W, 'Prepare Settings', { input: cfgFor(W, { source: 'jobber', asOfOverride: REF }) });
    const named = { 'Prepare Settings': prep, 'Jobber: Jobs query': { error: { message: '401' } }, 'Jobber: Invoices query': { error: { message: '401' } }, 'Jobber: Quotes query': { error: { message: '401' } } };
    const ds = await first(W, 'Normalize Jobber', { input: prep, named });
    const t = await mainTail(ds);
    assert.match(t.msg.text, /read returned no usable data/);
    assert.ok(!BAD_OUTPUT.test(t.msg.text));
  });

  // ---- CSV fallback workflow
  const cfgF = (over) => cfgFor(F, over);
  async function fbTail(ds) {
    let d = await first(F, 'Morning Ops Triage Logic', { input: ds });
    return { data: d, msg: await first(F, 'Assemble Owner Message', { input: d }) };
  }
  const bin = (name) => ({ json: {}, binary: { data: { fileName: name, mimeType: 'text/csv' } } });
  let fbManual;
  await checkAsync('csv fallback: Manual Test Run path (built-in sample) runs end to end and makes a [TEST] digest', async () => {
    const prep = await first(F, 'Prepare Settings', { input: cfgF() });
    assert.strictEqual(prep.settings.source, 'test');
    assert.strictEqual(prep.inbound, false);
    const ds = await first(F, 'Load Built-in Sample Export', { input: prep, named: { 'Prepare Settings': prep } });
    fbManual = await fbTail(ds);
    assert.ok(fbManual.msg.subject.startsWith('[TEST] Morning Ops Triage Digest: ' + SHOP));
    assert.strictEqual(fbManual.msg.sendEmail, true);
    assert.strictEqual(fbManual.msg.testMode, true);
  });
  await checkAsync('csv fallback: the built-in sample matches the module run on the sample files and the main workflow', async () => {
    const norm = (t) => t.replace(/source: \w+/, 'source: X').replace(' Built from fictional sample data.', '');
    assert.strictEqual(norm(fbManual.msg.text), norm(MSG.text));
    assert.strictEqual(norm(fbManual.msg.text), norm(wTest.msg.text));
  });
  await checkAsync('csv fallback: webhook upload (binary CSVs) forces csv, even if Config says test, and matches the shared module', async () => {
    const gather = await first(F, 'Gather Inbound CSV', { input: ['jobs', 'invoices', 'quotes'].map((k) => bin('sample-jobber-export-' + k + '.csv')), buffers: ['jobs', 'invoices', 'quotes'].map((k) => ({ data: fs.readFileSync(path.join(HERE, 'fixtures', 'sample-jobber-export-' + k + '.csv')) })) });
    assert.strictEqual(gather.inbound, true);
    assert.strictEqual(gather.inboundFiles.length, 3);
    const prep = await first(F, 'Prepare Settings', { input: Object.assign({}, cfgF({ asOfOverride: REF }), gather) });
    assert.strictEqual(prep.settings.source, 'csv');
    assert.strictEqual(prep.inbound, true);
    const ds = await first(F, 'Parse CSV Upload', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await fbTail(ds);
    assert.deepStrictEqual(ids(t.data.quoteQueue.items), ids(CSV.quoteQueue.items));
    assert.match(t.msg.subject, /^\[TEST\]/);
    assert.strictEqual(t.msg.text, logic.renderMessage(logic.runTriage(logic.datasetFromCsvFiles(logic.prepareSettings(Object.assign(cfgF({ asOfOverride: REF }), { source: 'csv' }), 0), sampleFiles()))).text);
  });
  await checkAsync('csv fallback: email-attachment path ignores non-CSV attachments and accepts several attachment fields', async () => {
    const item = { json: {}, binary: { attachment_0: { fileName: 'jobs.csv', mimeType: 'text/csv' }, attachment_1: { fileName: 'logo.png', mimeType: 'image/png' }, attachment_2: { fileName: 'export', mimeType: 'text/csv' } } };
    const buf = { attachment_0: fs.readFileSync(path.join(HERE, 'fixtures', 'sample-jobber-export-jobs.csv')), attachment_1: Buffer.from('PNG'), attachment_2: fs.readFileSync(path.join(HERE, 'fixtures', 'sample-jobber-export-quotes.csv')) };
    const g = await first(F, 'Gather Inbound CSV', { input: [item], buffers: [buf] });
    assert.deepStrictEqual(g.inboundFiles.map((f) => f.name), ['jobs.csv', 'export']);
  });
  await checkAsync('csv fallback: an inline csv string in the webhook body is accepted', async () => {
    const g = await first(F, 'Gather Inbound CSV', { input: [{ json: { body: { csv: 'Job #,Status\n1,Late\n' } } }], buffers: [{}] });
    assert.strictEqual(g.inboundFiles.length, 1);
  });
  await checkAsync('csv fallback: an upload with no CSV in it gives a Heads-up and is not replaced by sample data', async () => {
    const g = await first(F, 'Gather Inbound CSV', { input: [{ json: {} }], buffers: [{}] });
    const prep = await first(F, 'Prepare Settings', { input: Object.assign({}, cfgF(), g) });
    const ds = await first(F, 'Parse CSV Upload', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await fbTail(ds);
    assert.match(t.msg.text, /no CSV file was received/);
    assert.ok(!/Sample Household/.test(t.msg.text));
  });
  await checkAsync('csv fallback: a malformed upload (unclosed quote) becomes a Heads-up in the owner message, not a partial digest', async () => {
    const prep = await first(F, 'Prepare Settings', { input: Object.assign({}, cfgF({ asOfOverride: REF }), { inbound: true, inboundFiles: [{ name: 'jobs.csv', text: 'Job #,Status,Title\n1,Late,"oops\n2,Unscheduled,x\n' }] }) });
    const ds = await first(F, 'Parse CSV Upload', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await fbTail(ds);
    assert.match(t.msg.text, /never closed/);
    assert.match(t.msg.text, /Jobs needing attention: not available/);
  });
  await checkAsync('csv fallback: a file missing required columns is explained in the owner message', async () => {
    const prep = await first(F, 'Prepare Settings', { input: Object.assign({}, cfgF({ asOfOverride: REF }), { inbound: true, inboundFiles: [{ name: 'invoices.csv', text: 'Invoice #,Client name\n1,Pat\n' }] }) });
    const ds = await first(F, 'Parse CSV Upload', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await fbTail(ds);
    assert.match(t.msg.text, /missing required column\(s\): Due date; Balance/);
    assert.match(t.msg.text, /Columns found: Invoice #, Client name/);
  });
  await checkAsync('csv fallback: source "jobber" is refused and falls back to the sample with a Heads-up', async () => {
    const prep = await first(F, 'Prepare Settings', { input: cfgF({ source: 'jobber' }) });
    assert.strictEqual(prep.settings.source, 'test');
    assert.ok(prep.settings.headsUp.some((h) => /no Jobber API path/.test(h)));
  });
  await checkAsync('csv fallback: owner address cannot be changed by upload content', async () => {
    const prep = await first(F, 'Prepare Settings', { input: Object.assign({}, cfgF({ asOfOverride: REF }), { inbound: true, inboundFiles: [{ name: 'jobs.csv', text: 'Job #,Status,Client name,Title\n1,Late,ownerEmail=evil@attacker.test,x\n' }] }) });
    const ds = await first(F, 'Parse CSV Upload', { input: [{ json: {} }], named: { 'Prepare Settings': prep }, buffers: [{}] });
    const t = await fbTail(ds);
    assert.strictEqual(t.msg.emailTo, 'owner@bluestem.test');
  });
  await checkAsync('csv fallback: routing sends test data to the built-in branch and csv to the upload / folder branches', async () => {
    assert.deepStrictEqual(F.wf.connections['Source is CSV?'].main.map((o) => o.map((x) => x.node)), [['Upload just arrived?'], ['Load Built-in Sample Export']]);
    assert.deepStrictEqual(F.wf.connections['Upload just arrived?'].main.map((o) => o.map((x) => x.node)), [['Parse CSV Upload'], ['Read CSV Exports']]);
  });

  // ---- regenerate the sample digest from the workflow's own code
  await checkAsync('sample_morning_digest.md is regenerated from the workflow code and is stable across two runs', async () => {
    const out = [
      '# Sample [TEST] Morning Ops digest (generated)',
      '',
      'Generated by `mock_jobber_test.cjs` from the Code nodes in `jobber-csv-fallback-triage.json`, run on the fictional',
      'sample exports in `fixtures/` with the "now" in `fixtures/reference_time.txt`. Nothing here is real Jobber data, and',
      'nothing was sent anywhere. Compare your own [TEST] run with this file.',
      '',
      '## Subject',
      '',
      fbManual.msg.subject,
      '',
      '## Body',
      '',
      fbManual.msg.text,
      '',
    ].join('\n');
    const prep = await first(F, 'Prepare Settings', { input: cfgF() });
    const again = await fbTail(await first(F, 'Load Built-in Sample Export', { input: prep, named: { 'Prepare Settings': prep } }));
    assert.strictEqual(again.msg.text, fbManual.msg.text);
    assert.ok(!BAD_OUTPUT.test(out.replace('Generated by', '').replace(/`[^`]*`/g, '')));
    fs.writeFileSync(path.join(HERE, 'sample_morning_digest.md'), out);
    assert.ok(fs.readFileSync(path.join(HERE, 'sample_morning_digest.md'), 'utf8').includes('Quote 3001'));
  });
  check('sample_morning_digest.md has no banned strings and is labeled fictional', () => {
    const t = rd('sample_morning_digest.md');
    assert.ok(!BANNED.test(t));
    assert.match(t, /fictional/i);
    assert.match(t, /\[TEST\]/);
  });

  report();
})();
