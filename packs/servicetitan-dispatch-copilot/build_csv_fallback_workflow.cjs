#!/usr/bin/env node
/**
 * Generates servicetitan-csv-fallback-triage.json from dispatch_logic.cjs and the sample export.
 * Local only: reads files in this folder, writes servicetitan-csv-fallback-triage.json. No network.
 *
 *   node build_csv_fallback_workflow.cjs
 *
 * CSV-Fallback Mode (DRAFT v0.3.0) for ServiceTitan Starter / Essentials shops that have no
 * Customer-Built App Key. One Jobs/Dispatch export in (webhook upload, inbound email attachment,
 * or watch folder), the SAME Morning Triage Digest and Unassigned Aging Watch out, owner only.
 * Code nodes are assembled from the @@SECTION blocks in dispatch_logic.cjs, so nothing is forked.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logic = require('./dispatch_logic.cjs');

const HERE = __dirname;
const SOURCE = fs.readFileSync(path.join(HERE, 'dispatch_logic.cjs'), 'utf8');

function sections() {
  const out = {};
  const re = /^\/\/ @@SECTION (\w+)\n([\s\S]*?)(?=^\/\/ @@(?:SECTION|END))/gm;
  let m;
  while ((m = re.exec(SOURCE)) !== null) out[m[1]] = m[2].trim() + '\n';
  return out;
}
const SECTIONS = sections();
['common', 'settings', 'csv', 'booking_qa', 'capacity_filler', 'kpi_digest', 'handoff', 'message', 'aging'].forEach((name) => {
  if (!SECTIONS[name]) throw new Error('missing dispatch_logic.cjs section: ' + name);
});

const SAMPLE_CSV = fs.readFileSync(path.join(HERE, 'fixtures', 'sample-servicetitan-export.csv'), 'utf8');
const SAMPLE_REF = fs.readFileSync(path.join(HERE, 'fixtures', 'sample_export_reference_time.txt'), 'utf8').trim();

function codeFor(parts, body) {
  const header = '// Generated from dispatch_logic.cjs by build_csv_fallback_workflow.cjs. Edit the module, not this node.\n// DRAFT v0.3.0. No network calls and nothing is sent from this node.\n';
  return header + parts.map((p) => SECTIONS[p]).join('\n') + '\n' + body.trim() + '\n';
}

const uid = (name) => {
  const h = crypto.createHash('sha1').update('stdc-csvfb:' + name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const nodes = [];
const add = (name, type, typeVersion, position, parameters, extra) => {
  nodes.push(Object.assign({ id: uid(name), name, type, typeVersion, position, parameters }, extra || {}));
  return name;
};
const code = (name, position, parts, body) =>
  add(name, 'n8n-nodes-base.code', 2, position, { jsCode: codeFor(parts, body) });
const ifNode = (name, position, leftExpr, op, right) =>
  add(name, 'n8n-nodes-base.if', 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
      conditions: [{ id: uid(name + ':c'), leftValue: leftExpr, rightValue: right, operator: op }],
      combinator: 'and',
    },
    options: {},
  });
const note = (name, position, width, height, color, content) =>
  add(name, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color });

const PS = "$('Prepare Settings').first().json.settings";

// ---- inbound triggers (all read-only; webhook and email are disabled until the owner is ready)
const T_MANUAL = 'Manual Test Run';
const T_SCHEDULE = 'Schedule 7:00 AM: watch folder (disabled until you are ready)';
const T_WEBHOOK = 'Webhook: upload a Jobs CSV (disabled until you are ready)';
const T_GMAIL = 'Email attachment: inbound Jobs CSV (disabled until you are ready)';
add(T_MANUAL, 'n8n-nodes-base.manualTrigger', 1, [0, 520], {});
add(T_SCHEDULE, 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 720],
  { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 7 }] } }, { disabled: true });
add(T_WEBHOOK, 'n8n-nodes-base.webhook', 2, [0, 960], {
  httpMethod: 'POST', path: 'servicetitan-jobs-csv', authentication: 'headerAuth', responseMode: 'onReceived',
  options: { binaryPropertyName: 'data' },
}, {
  disabled: true, webhookId: uid('webhook-id'),
  credentials: { httpHeaderAuth: { id: 'PLACEHOLDER_WEBHOOK_HEADER_AUTH', name: 'Webhook header auth (PLACEHOLDER)' } },
});
add(T_GMAIL, 'n8n-nodes-base.gmailTrigger', 1.2, [0, 1200], {
  pollTimes: { item: [{ mode: 'everyX', value: 15, unit: 'minutes' }] },
  simple: false,
  filters: { q: 'has:attachment filename:csv from:PASTE_ALLOWED_SENDER_HERE', readStatus: 'unread' },
  options: { downloadAttachments: true },
}, { disabled: true, credentials: { gmailOAuth2: { id: 'PLACEHOLDER_GMAIL', name: 'Gmail account (PLACEHOLDER)' } } });

code('Gather Inbound CSV', [280, 1080], ['common'], [
  'const files = [];',
  'const items = $input.all();',
  'for (let i = 0; i < items.length; i++) {',
  '  const bins = items[i].binary || {};',
  '  for (const key of Object.keys(bins)) {',
  '    const b = bins[key];',
  "    const name = String((b && b.fileName) || key);",
  "    if (!(/\\.csv$/i.test(name) || /csv/i.test(String((b && b.mimeType) || '')))) continue;",
  '    const buf = await this.helpers.getBinaryDataBuffer(i, key);',
  "    files.push({ name: name, text: buf.toString('utf8') });",
  '  }',
  '  const j = items[i].json || {};',
  "  if (typeof j.csv === 'string') files.push({ name: 'upload.csv', text: j.csv });",
  "  else if (j.body && typeof j.body.csv === 'string') files.push({ name: 'upload.csv', text: j.body.csv });",
  '}',
  'return [{ json: { inbound: true, inboundFiles: files } }];',
].join('\n'));

const cfg = [
  ['businessName', 'Your Business Name', 'string'],
  ['timezone', 'America/Chicago', 'string'],
  ['source', 'test', 'string'],
  ['testMode', true, 'boolean'],
  ['delivery', 'email', 'string'],
  ['ownerEmail', 'owner@example.com', 'string'],
  ['ownerSlackChannel', '#dispatch-owner-only', 'string'],
  ['csvFolder', '/home/node/.n8n-files/dispatch-exports', 'string'],
  ['asOfOverride', '', 'string'],
  ['agingThresholdMinutes', logic.AGING_DEFAULT_THRESHOLD_MINUTES, 'number'],
  ['bookingLookbackHours', logic.DEFAULTS.bookingLookbackHours, 'number'],
  ['replacementAgeYears', logic.DEFAULTS.replacementAgeYears, 'number'],
  ['repeatWindowDays', logic.DEFAULTS.repeatWindowDays, 'number'],
  ['membershipOverdueDays', logic.DEFAULTS.membershipOverdueDays, 'number'],
  ['estimateStaleDays', logic.DEFAULTS.estimateStaleDays, 'number'],
  ['capacityLookaheadDays', logic.DEFAULTS.capacityLookaheadDays, 'number'],
  ['afterHoursStartHour', logic.DEFAULTS.afterHoursStartHour, 'number'],
  ['maxItemsPerSection', logic.DEFAULTS.maxItemsPerSection, 'number'],
  ['historyDays', logic.DEFAULTS.historyDays, 'number'],
];
add('Config', 'n8n-nodes-base.set', 3.4, [560, 520], {
  assignments: { assignments: cfg.map(([name, value, type]) => ({ id: uid('cfg:' + name), name, value, type })) },
  includeOtherFields: true,
  options: {},
});
code('Prepare Settings', [820, 520], ['common', 'settings', 'aging'], [
  'const cfg = Object.assign({}, $input.first().json);',
  'const inbound = cfg.inbound === true;',
  'const inboundFiles = Array.isArray(cfg.inboundFiles) ? cfg.inboundFiles : [];',
  'delete cfg.inboundFiles;',
  'const extra = [];',
  "if (inbound) cfg.source = 'csv';",
  "if (String(cfg.source || '').trim().toLowerCase() === 'servicetitan') {",
  "  cfg.source = 'test';",
  "  extra.push('This CSV-fallback workflow has no ServiceTitan API path (no App Key needed). source \"servicetitan\" is not available here, so test was used.');",
  '}',
  'const settings = prepareAgingSettings(cfg, Date.now());',
  'settings.headsUp = settings.headsUp.concat(extra);',
  'return [{ json: { settings: settings, inbound: inbound, inboundFiles: inboundFiles } }];',
].join('\n'));

ifNode('Source is CSV?', [1080, 520], '={{ $json.settings.source }}', { type: 'string', operation: 'equals' }, 'csv');
ifNode('Upload just arrived?', [1340, 400], '={{ $json.inbound }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
add('Read CSV Exports', 'n8n-nodes-base.readWriteFile', 1, [1600, 600],
  { operation: 'read', fileSelector: `={{ ${PS}.csvFolder }}/*.csv`, options: {} },
  { alwaysOutputData: true });
code('Parse CSV Upload', [1860, 480], ['common', 'csv', 'settings', 'aging'], [
  "const prep = $('Prepare Settings').first().json;",
  'const settings = prep.settings;',
  'const files = (prep.inboundFiles || []).slice();',
  'const items = $input.all();',
  'for (let i = 0; i < items.length; i++) {',
  '  const bins = items[i].binary || {};',
  '  for (const key of Object.keys(bins)) {',
  '    const b = bins[key];',
  "    const name = String((b && b.fileName) || key);",
  "    if (!(/\\.csv$/i.test(name) || /csv/i.test(String((b && b.mimeType) || '')))) continue;",
  '    const buf = await this.helpers.getBinaryDataBuffer(i, key);',
  "    files.push({ name: name, text: buf.toString('utf8') });",
  '  }',
  '}',
  'return [{ json: datasetFromCsvFiles(settings, files) }];',
].join('\n'));
code('Load Built-in Sample Export', [1340, 760], ['common', 'csv', 'settings', 'aging'], [
  `const SAMPLE_CSV = ${JSON.stringify(SAMPLE_CSV)};`,
  `const SAMPLE_AS_OF = ${JSON.stringify(SAMPLE_REF)};`,
  `const settings = Object.assign({}, ${PS}, { asOf: SAMPLE_AS_OF });`,
  "return [{ json: datasetFromCsvFiles(settings, [{ name: 'sample-servicetitan-export.csv', text: SAMPLE_CSV }]) }];",
].join('\n'));

const X = 2120;
code('Morning Triage Digest Logic', [X, 520],
  ['common', 'csv', 'booking_qa', 'capacity_filler', 'kpi_digest', 'handoff'], [
    'let d = $input.first().json;',
    'd = Object.assign({}, d, { bookingQa: bookingQa(d) });',
    'd = Object.assign({}, d, { capacity: capacityFiller(d) });',
    'd = Object.assign({}, d, { kpis: kpiDigest(d) });',
    'd = Object.assign({}, d, { afterHours: afterHoursHandoff(d) });',
    'return [{ json: d }];',
  ].join('\n'));
code('Unassigned Aging Watch Logic', [X + 280, 520], ['common', 'settings', 'aging'],
  'const d = $input.first().json;\nreturn [{ json: Object.assign({}, d, { agingWatch: unassignedAgingWatch(d) }) }];');
code('Assemble Owner Messages', [X + 560, 520], ['common', 'message', 'settings', 'aging'], [
  'const d = $input.first().json;',
  "const digest = Object.assign({ kind: 'morning-digest' }, renderMessage(d));",
  "const alert = Object.assign({ kind: 'aging-alert' }, renderAgingAlert(d));",
  'return [{ json: digest }, { json: alert }];',
].join('\n'));
ifNode('Send email to owner?', [X + 840, 420], '={{ $json.sendEmail }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
ifNode('Send Slack to owner?', [X + 840, 640], '={{ $json.sendSlack }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
add('Email owner (Gmail)', 'n8n-nodes-base.gmail', 2.1, [X + 1120, 420], {
  resource: 'message', operation: 'send', sendTo: '={{ $json.emailTo }}', subject: '={{ $json.subject }}',
  emailType: 'html', message: '={{ $json.html }}', options: { appendAttribution: false },
}, { credentials: { gmailOAuth2: { id: 'PLACEHOLDER_GMAIL', name: 'Gmail account (PLACEHOLDER)' } } });
add('Post to owner Slack', 'n8n-nodes-base.slack', 2.3, [X + 1120, 640], {
  resource: 'message', operation: 'post', select: 'channel',
  channelId: { __rl: true, value: "={{ $json.slackChannel.replace(/^#/, '') }}", mode: 'name' },
  messageType: 'text', text: '={{ $json.slackText }}',
  otherOptions: { includeLinkToWorkflow: false, link_names: false, mrkdwn: false, unfurl_links: false, unfurl_media: false },
}, { credentials: { slackApi: { id: 'PLACEHOLDER_SLACK', name: 'Slack account (PLACEHOLDER)' } } });

// ---- sticky notes (not counted as executable nodes)
note('Note: Start here', [-40, 80], 620, 360, 4,
  '## START HERE: ServiceTitan CSV-Fallback Triage (DRAFT v0.3.0)\nFor ServiceTitan Starter and Essentials shops. Those tiers do not get a Customer-Built App Key, so there is no API to call. Export one Jobs/Dispatch report as CSV, get it into n8n, and get the SAME Morning Triage Digest and 15-minute Unassigned Aging Watch alert, both to the OWNER only.\n\n**Test it in about 2 minutes:**\n1. Import this file (done). It is inactive. The webhook, email, and schedule triggers are switched off.\n2. Leave **source** = test and click **Execute workflow** on Manual Test Run. You get a [TEST] digest and a [TEST] aging alert from fictional sample data (fixtures/sample-servicetitan-export.csv).\n3. Compare with sample_csv_fallback_digest.md in the pack.\n4. Set source = csv, put your own export in csvFolder, run again. Still [TEST].\n5. Only then enable one trigger. See the go-live note.\n\nStatus: DRAFT. Checked as importable JSON against fictional data. NOT tested against a live ServiceTitan, Gmail, or Slack account.');
note('Note: Config guide', [600, 80], 600, 360, 5,
  '## Config fields\n- **source**: test (built-in fictional export, default) | csv (read your export). An upload that arrives by webhook or email is always treated as csv. There is no servicetitan source in this file.\n- **testMode**: ON by default. Messages are labeled [TEST]. source = test always forces it on.\n- **delivery**: email | slack | both | none. Owner only.\n- **ownerEmail / ownerSlackChannel**: YOUR address and a private channel. Never a customer.\n- **csvFolder**: watch folder for manual and scheduled runs. n8n only reads files inside its allowed folder. The Read node reads every .csv in it.\n- **asOfOverride**: ISO time to pretend it is a different moment, for an export from earlier. Blank = now.\n- **agingThresholdMinutes**: minutes a job may sit unassigned before it is flagged. Default 20.\n- The other numbers are the same digest thresholds as the main pack.\n- The scheduled run uses Config source, so set source = csv before you enable the schedule.');
note('Note: Safety defaults', [1240, 80], 540, 360, 6,
  '## Safety defaults\n- Imported **inactive**. The Schedule, Webhook, and Email-attachment triggers are all **disabled**.\n- **testMode** ON; source = **test**.\n- **Read-only**: this file never calls ServiceTitan at all. It only reads the CSV you give it.\n- **Owner-only output**: Gmail and Slack recipients come from ownerEmail / ownerSlackChannel. No SMS, no Twilio, no customer email.\n- The email trigger only READS an inbound message. It does not reply, label, or forward.\n- The webhook expects a header-auth credential (placeholder). Never expose it without one.\n- It never assigns, reassigns, or moves a job. It only flags.\n- Never invents numbers. A missing report becomes a "Heads-up" line.');
note('Note: CSV-Fallback mode', [1340, 940], 760, 420, 4,
  '## CSV-Fallback (Starter / Essentials, no API key)\n**Export:** in ServiceTitan, run your Jobs or Dispatch report and export to CSV. One file is enough: Aging Watch runs fully and the Morning Digest runs partially (it skips what a jobs export does not hold, with a Heads-up).\n**Required columns:** Job # (or Job Number / Job ID), Status, Scheduled Start. Missing ones produce a plain-language Heads-up that names them, not a crash.\n**Recognized headers (not case sensitive; spaces, underscores, hyphens treated the same):** Scheduled End, Business Unit, Job Type, Required Skill / Tag, Zone, Technician, Customer, Created On, Priority, Address, Unassigned Since, Multi-Day, and more. See the pack README for the full list. Dates like 3/10/2026 9:50 AM are read in your Config timezone.\n**Three ways in:** (1) Webhook: POST the file as multipart field "data". (2) Email attachment: a CSV from an allowed sender, set in the Gmail trigger query. (3) Watch folder: drop the file in csvFolder.\n**Optional extras:** technicians, capacity, memberships, estimates, and calls CSVs in the same upload or folder are used when present. File names do not matter.\nBad rows are skipped and counted in a Heads-up. Repeated job rows (one per technician) are merged.');
note('Note: Credentials', [X + 800, 220], 540, 160, 2,
  '## Credentials (placeholders only)\nPLACEHOLDER_GMAIL (inbound email trigger and owner email), PLACEHOLDER_SLACK, PLACEHOLDER_WEBHOOK_HEADER_AUTH (webhook). No ServiceTitan credential is used or needed. No secrets are stored in this file.');
note('Note: Go live', [X + 800, 800], 540, 250, 6,
  '## Hard stop before go-live\nDo not turn testMode off or enable a trigger until: (1) a clean [TEST] run from the sample export, (2) a clean [TEST] run from YOUR export, spot-checked by hand against ServiceTitan, (3) ownerEmail / ownerSlackChannel confirmed as owner-only, (4) the Gmail query limited to one sender you trust and the webhook behind header auth, (5) an owner has signed off in writing. Even live, this workflow only reports to the owner.');

// ---- connections
const C = {};
const link = (from, to, out = 0) => {
  C[from] = C[from] || { main: [] };
  while (C[from].main.length <= out) C[from].main.push([]);
  C[from].main[out].push({ node: to, type: 'main', index: 0 });
};
link(T_MANUAL, 'Config');
link(T_SCHEDULE, 'Config');
link(T_WEBHOOK, 'Gather Inbound CSV');
link(T_GMAIL, 'Gather Inbound CSV');
link('Gather Inbound CSV', 'Config');
link('Config', 'Prepare Settings');
link('Prepare Settings', 'Source is CSV?');
link('Source is CSV?', 'Upload just arrived?', 0);
link('Source is CSV?', 'Load Built-in Sample Export', 1);
link('Upload just arrived?', 'Parse CSV Upload', 0);
link('Upload just arrived?', 'Read CSV Exports', 1);
link('Read CSV Exports', 'Parse CSV Upload');
link('Parse CSV Upload', 'Morning Triage Digest Logic');
link('Load Built-in Sample Export', 'Morning Triage Digest Logic');
link('Morning Triage Digest Logic', 'Unassigned Aging Watch Logic');
link('Unassigned Aging Watch Logic', 'Assemble Owner Messages');
link('Assemble Owner Messages', 'Send email to owner?');
link('Assemble Owner Messages', 'Send Slack to owner?');
link('Send email to owner?', 'Email owner (Gmail)', 0);
link('Send Slack to owner?', 'Post to owner Slack', 0);

const workflow = {
  name: 'ServiceTitan CSV-Fallback Triage (DRAFT): Prewired AI',
  nodes,
  connections: C,
  active: false,
  settings: { executionOrder: 'v1', timezone: 'America/Chicago' },
};
fs.writeFileSync(path.join(HERE, 'servicetitan-csv-fallback-triage.json'), JSON.stringify(workflow, null, 2) + '\n');
const sticky = nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length;
console.log(`servicetitan-csv-fallback-triage.json written: ${nodes.length - sticky} executable nodes, ${sticky} sticky notes, ${nodes.length} total`);
