#!/usr/bin/env node
/**
 * Generates workflow.n8n.json from hcp_logic.cjs and the sample exports.
 * Local only: reads files in this folder, writes workflow.n8n.json. No network.
 *
 *   node build_workflow.cjs
 *
 * CSV-first: Jobs / Invoices / Estimates CSV exports in (webhook upload, inbound email attachment, or watch
 * folder), the Morning Ops digest out, owner only. There is no HTTP Request node in this file: it never calls
 * Housecall Pro at all. The Housecall Pro Open API and webhooks are MAX-only and are not used in v0.1.
 */
'use strict';
const logic = require('./hcp_logic.cjs');
const { builder, SAMPLE_FILES_JS } = require('./build_lib.cjs');

const b = builder('hcp-csv', 'build_workflow.cjs');
const { add, code, ifNode, note, link } = b;
const PS = "$('Prepare Settings').first().json.settings";

const T_MANUAL = 'Manual Test Run';
const T_SCHEDULE = 'Schedule 7:00 AM: watch folder (disabled until you are ready)';
const T_WEBHOOK = 'Webhook: upload a Housecall Pro CSV (disabled until you are ready)';
const T_GMAIL = 'Email attachment: inbound Housecall Pro CSV (disabled until you are ready)';
add(T_MANUAL, 'n8n-nodes-base.manualTrigger', 1, [0, 520], {});
add(T_SCHEDULE, 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 720],
  { rule: { interval: [{ field: 'cronExpression', expression: '0 7 * * 1-5' }] } }, { disabled: true });
add(T_WEBHOOK, 'n8n-nodes-base.webhook', 2, [0, 960], {
  httpMethod: 'POST', path: 'hcp-exports-csv', authentication: 'headerAuth', responseMode: 'onReceived',
  options: { binaryPropertyName: 'data' },
}, {
  disabled: true, webhookId: b.uid('webhook-id'),
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
  '    const bin = bins[key];',
  "    const name = String((bin && bin.fileName) || key);",
  "    if (!(/\\.csv$/i.test(name) || /csv/i.test(String((bin && bin.mimeType) || '')))) continue;",
  '    const buf = await this.helpers.getBinaryDataBuffer(i, key);',
  "    files.push({ name: name, text: buf.toString('utf8') });",
  '  }',
  '  const j = items[i].json || {};',
  "  if (typeof j.csv === 'string') files.push({ name: 'upload.csv', text: j.csv });",
  "  else if (j.body && typeof j.body.csv === 'string') files.push({ name: 'upload.csv', text: j.body.csv });",
  '}',
  'return [{ json: { inbound: true, inboundFiles: files } }];',
].join('\n'));

b.config([560, 520], [
  ['businessName', 'Your Business Name', 'string'],
  ['timezone', 'America/Chicago', 'string'],
  ['source', 'test', 'string'],
  ['testMode', true, 'boolean'],
  ['delivery', 'email', 'string'],
  ['ownerEmail', 'owner@example.com', 'string'],
  ['ownerSlackChannel', '', 'string'],
  ['csvFolder', '/home/node/.n8n-files/hcp-exports', 'string'],
  ['asOfOverride', '', 'string'],
  ['pastDueMinDays', logic.DEFAULTS.pastDueMinDays, 'number'],
  ['estimateStalledDays', '', 'string'],
  ['estimateMinValue', logic.DEFAULTS.estimateMinValue, 'number'],
  ['maxItemsPerSection', logic.DEFAULTS.maxItemsPerSection, 'number'],
], true);
code('Prepare Settings', [820, 520], ['common', 'dates', 'settings'], [
  'const cfg = Object.assign({}, $input.first().json);',
  'const inbound = cfg.inbound === true;',
  'const inboundFiles = Array.isArray(cfg.inboundFiles) ? cfg.inboundFiles : [];',
  'delete cfg.inboundFiles;',
  'delete cfg.inbound;',
  "if (inbound) cfg.source = 'csv';",
  'const settings = prepareSettings(cfg, Date.now());',
  'return [{ json: { settings: settings, inbound: inbound, inboundFiles: inboundFiles } }];',
].join('\n'));

ifNode('Source is CSV?', [1080, 520], '={{ $json.settings.source }}', { type: 'string', operation: 'equals' }, 'csv');
ifNode('Upload just arrived?', [1340, 400], '={{ $json.inbound }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
add('Read CSV Exports', 'n8n-nodes-base.readWriteFile', 1, [1600, 600],
  { operation: 'read', fileSelector: `={{ ${PS}.csvFolder }}/*.csv`, options: {} }, { alwaysOutputData: true });
code('Parse CSV Upload', [1860, 480], ['common', 'csv', 'dates', 'report'], [
  "const prep = $('Prepare Settings').first().json;",
  'const settings = prep.settings;',
  'const files = (prep.inboundFiles || []).slice();',
  'const items = $input.all();',
  'for (let i = 0; i < items.length; i++) {',
  '  const bins = items[i].binary || {};',
  '  for (const key of Object.keys(bins)) {',
  '    const bin = bins[key];',
  "    const name = String((bin && bin.fileName) || key);",
  "    if (!(/\\.csv$/i.test(name) || /csv/i.test(String((bin && bin.mimeType) || '')))) continue;",
  '    const buf = await this.helpers.getBinaryDataBuffer(i, key);',
  "    files.push({ name: name, text: buf.toString('utf8') });",
  '  }',
  '}',
  'return [{ json: datasetFromCsvFiles(settings, files) }];',
].join('\n'));
code('Load Built-in Sample Export', [1340, 760], ['common', 'csv', 'dates', 'report'], [
  SAMPLE_FILES_JS,
  `const settings = Object.assign({}, ${PS}, { asOf: SAMPLE_AS_OF });`,
  'return [{ json: datasetFromCsvFiles(settings, SAMPLE_FILES) }];',
].join('\n'));

const X = 2120;
code('Morning Ops Triage Logic', [X, 520], ['common', 'triage'], [
  'let d = $input.first().json;',
  'd = Object.assign({}, d, { jobsQueue: jobsQueue(d) });',
  'd = Object.assign({}, d, { invoicing: invoicingQueue(d) });',
  'd = Object.assign({}, d, { estimateQueue: estimateQueue(d) });',
  'return [{ json: d }];',
].join('\n'));
code('Assemble Owner Message', [X + 280, 520], ['common', 'triage', 'message'],
  'const d = $input.first().json;\nreturn [{ json: renderMessage(d) }];');
ifNode('Send email to owner?', [X + 560, 420], '={{ $json.sendEmail }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
ifNode('Send Slack to owner?', [X + 560, 640], '={{ $json.sendSlack }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
b.ownerDelivery(X + 560, 520);

note('Note: Start here', [-40, 80], 640, 420, 4,
  '## START HERE: Housecall Pro CSV-First Morning Ops Copilot (DRAFT v0.1.0)\nThe CSV path is the product. Export your Jobs (and, if you can, Invoices and Estimates) from Housecall Pro as CSV, get them into n8n, and get one Morning Ops digest (unscheduled / late / needs-office-action jobs, ready-to-invoice and past-due, stalled high-value estimates) to the OWNER only.\n\n**Housecall Pro Open API and webhooks are MAX-only and are NOT used in v0.1.** A Basic or Essentials shop needs no plan upgrade for this workflow.\n\n**Test it in about 2 minutes:**\n1. Imported inactive. The webhook, email, and schedule triggers are switched off.\n2. testMode is on and **source** defaults to test, which is fictional sample data for Cedar Creek Plumbing & Air (fixtures/sample-hcp-export-*.csv). Click **Execute workflow** on Manual Test Run. You get a [TEST] digest.\n3. Compare with sample_morning_digest.md in the pack.\n4. Set source = csv, put your own exports in csvFolder, run again. Still [TEST].\n5. Only then enable one trigger. See the go-live note.\n\nStatus: DRAFT. Workflow JSON and Code nodes checked locally with fictional data. NOT tested against a live Housecall Pro, Gmail, or Slack account.');
note('Note: Config guide', [640, 80], 600, 400, 5,
  '## Config fields\n- **source**: test (built-in fictional sample, default) | csv (read your exports). An upload that arrives by webhook or email is always treated as csv. There is no live Housecall Pro source in this file.\n- **testMode**: ON by default. Messages are labeled [TEST]. source = test always forces it on.\n- **delivery**: email | slack | both | none. Owner only.\n- **ownerEmail / ownerSlackChannel**: YOUR address and a private channel. Never a customer. Read from this Config node only, never from an uploaded row or email header.\n- **csvFolder**: watch folder for manual and scheduled runs. n8n only reads files inside its allowed folder. The Read node reads every .csv in it.\n- **asOfOverride**: ISO time to pretend it is a different moment, for an export from earlier. Blank = now.\n- **pastDueMinDays** (1), **estimateStalledDays** (blank until configured; set it after the last follow-up your shop sends on its own), **estimateMinValue** (1000): starting points, not industry standards.\n- The scheduled run uses Config source, so set source = csv before you enable the schedule.');
note('Note: Safety defaults', [1260, 80], 560, 400, 6,
  '## Safety defaults\n- Imported **inactive**. The Schedule, Webhook, and Email-attachment triggers are all **disabled**.\n- **testMode** ON; source = **test** (fictional sample).\n- **Zero Housecall Pro write-back**: this file never calls Housecall Pro at all. It only reads the CSV you give it. There is no HTTP Request node.\n- **Owner-only output**: Gmail and Slack recipients come from ownerEmail / ownerSlackChannel. No SMS, no Twilio, no customer email, no review request, no reminder blast.\n- The email trigger only READS an inbound message. It does not reply, label, or forward.\n- The webhook expects a header-auth credential (placeholder). Never expose it without one.\n- The stalled-estimate list is for a human call or personal note.\n- Never invents numbers. A missing report or column becomes a "Heads-up" line.');
note('Note: CSV intake', [1340, 940], 800, 460, 4,
  '## CSV intake (every Housecall Pro plan, no API key, no MAX)\n**Export:** a Housecall Pro admin can export Jobs to CSV; the file is emailed to the admin. That manual Jobs export is the verified part. Whether Invoices and Estimates exports exist on your plan, and the exact column names, have NOT been verified; the pack matches common names loosely. Any one report is enough; a missing one becomes a Heads-up.\n**Required columns:** Jobs: Job #, Status. Invoices: Invoice #, Status, Due date, Amount due (or Balance). Estimates: Estimate #, Status, Total, Sent date. A missing one produces a plain-language Heads-up that names it and lists the headers seen, not a crash.\n**Finished jobs need an invoice check:** provide an explicit Invoice status on the Jobs row or a matching Invoices row with a recognized status.\n**Dates** like 3/10/2026 9:50 AM are shop-local in the Config timezone. Impossible dates (2026-02-30) and unclosed quotes are reported, never silently accepted.\n**Three ways in:** (1) Webhook: POST the file(s) as multipart field "data". (2) Email attachment from an allowed sender set in the Gmail trigger query. (3) Watch folder: drop the files in csvFolder.\nHousecall Pro Open API and webhooks are MAX-only and are not used in v0.1.');
note('Note: Credentials', [X + 520, 220], 560, 170, 2,
  '## Credentials (placeholders only)\nPLACEHOLDER_GMAIL (inbound email trigger and owner email), PLACEHOLDER_SLACK, PLACEHOLDER_WEBHOOK_HEADER_AUTH (webhook). No Housecall Pro credential is used or needed. No secrets are stored in this file.');
note('Note: Go live', [X + 520, 800], 560, 280, 6,
  '## Hard stop before go-live\nDo not turn testMode off or enable a trigger until: (1) a clean [TEST] run from the sample export, (2) a clean [TEST] run from YOUR exports, spot-checked by hand against Housecall Pro, (3) ownerEmail / ownerSlackChannel confirmed as owner-only, (4) the Gmail query limited to one sender you trust and the webhook behind header auth, (5) an owner has signed off in writing. Even live, this workflow only reports to the owner. Not tested against a live Housecall Pro, Gmail, or Slack account.');

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
link('Parse CSV Upload', 'Morning Ops Triage Logic');
link('Load Built-in Sample Export', 'Morning Ops Triage Logic');
link('Morning Ops Triage Logic', 'Assemble Owner Message');
link('Assemble Owner Message', 'Send email to owner?');
link('Assemble Owner Message', 'Send Slack to owner?');
link('Send email to owner?', 'Email owner (Gmail)', 0);
link('Send Slack to owner?', 'Post to owner Slack', 0);

b.write('workflow.n8n.json', 'Housecall Pro CSV-First Morning Ops Copilot (DRAFT): Prewired AI');
