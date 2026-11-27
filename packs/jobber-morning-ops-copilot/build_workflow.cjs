#!/usr/bin/env node
/**
 * Generates workflow.n8n.json (Jobber GraphQL + OAuth 2.0 read-only morning digest) from jobber_logic.cjs.
 * Local only: reads files in this folder, writes workflow.n8n.json. No network.
 *
 *   node build_workflow.cjs
 *
 * The Jobber steps send GraphQL QUERIES only. GraphQL is carried over HTTP POST, so the HTTP method is POST,
 * but there is no mutation anywhere in this file: nothing is created, changed, or deleted in Jobber.
 */
'use strict';
const logic = require('./jobber_logic.cjs');
const { builder, SAMPLE_FILES_JS } = require('./build_lib.cjs');

const b = builder('jbr-main', 'build_workflow.cjs');
const { add, code, ifNode, note, link } = b;
const PS = "$('Prepare Settings').first().json.settings";
const passOn = (key, fn) => `const d = $input.first().json;\nreturn [{ json: Object.assign({}, d, { ${key}: ${fn}(d) }) }];`;

const T_SCHEDULE = 'Schedule 7:00 AM (disabled until you are ready)';
add('Manual Test Run', 'n8n-nodes-base.manualTrigger', 1, [0, 520], {});
add(T_SCHEDULE, 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 720],
  { rule: { interval: [{ field: 'cronExpression', expression: '0 7 * * 1-5' }] } }, { disabled: true });

b.config([280, 520], [
  ['businessName', 'Your Business Name', 'string'],
  ['timezone', 'America/Chicago', 'string'],
  ['source', 'test', 'string'],
  ['testMode', true, 'boolean'],
  ['delivery', 'email', 'string'],
  ['ownerEmail', 'owner@example.com', 'string'],
  ['ownerSlackChannel', '', 'string'],
  ['jobberGraphqlVersion', 'PASTE_API_VERSION_HERE', 'string'],
  ['csvFolder', '/home/node/.n8n-files/jobber-exports', 'string'],
  ['asOfOverride', '', 'string'],
  ['pastDueMinDays', logic.DEFAULTS.pastDueMinDays, 'number'],
  ['quoteStalledDays', '', 'string'],
  ['quoteMinValue', logic.DEFAULTS.quoteMinValue, 'number'],
  ['maxItemsPerSection', logic.DEFAULTS.maxItemsPerSection, 'number'],
], false);
code('Prepare Settings', [540, 520], ['common', 'dates', 'settings'],
  'const cfg = $input.first().json;\nreturn [{ json: { settings: prepareSettings(cfg, Date.now()) } }];');

ifNode('Source is Jobber?', [800, 520], '={{ $json.settings.source }}', { type: 'string', operation: 'equals' }, 'jobber');
ifNode('Source is CSV?', [1060, 760], '={{ $json.settings.source }}', { type: 'string', operation: 'equals' }, 'csv');

// ---- live Jobber reads: GraphQL QUERIES only (unreachable unless source = jobber)
const live = [
  ['Jobber: Jobs query', logic.JOBBER_QUERIES.jobs],
  ['Jobber: Invoices query', logic.JOBBER_QUERIES.invoices],
  ['Jobber: Quotes query', logic.JOBBER_QUERIES.quotes],
];
live.forEach(([name, query], i) => {
  add(name, 'n8n-nodes-base.httpRequest', 4.2, [1060 + i * 240, 280], {
    method: 'POST',
    url: logic.JOBBER_GRAPHQL_URL,
    authentication: 'genericCredentialType',
    genericAuthType: 'oAuth2Api',
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'X-JOBBER-GRAPHQL-VERSION', value: `={{ ${PS}.jobberGraphqlVersion }}` }] },
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: JSON.stringify({ query }),
    options: {},
  }, {
    credentials: { oAuth2Api: { id: 'PLACEHOLDER_JOBBER', name: 'Jobber OAuth2 authorization code (PLACEHOLDER)' } },
    onError: 'continueRegularOutput',
  });
});
code('Normalize Jobber', [1060 + live.length * 240, 280], ['common', 'csv', 'dates', 'report', 'graphql'], [
  `const settings = ${PS};`,
  'const raw = {',
  `  jobs: $('${live[0][0]}').first().json,`,
  `  invoices: $('${live[1][0]}').first().json,`,
  `  quotes: $('${live[2][0]}').first().json,`,
  '};',
  'return [{ json: normalizeJobberGraphql(settings, raw) }];',
].join('\n'));

// ---- CSV + built-in test data
add('Read CSV Exports', 'n8n-nodes-base.readWriteFile', 1, [1320, 680],
  { operation: 'read', fileSelector: `={{ ${PS}.csvFolder }}/*.csv`, options: {} }, { alwaysOutputData: true });
code('Parse CSV Exports', [1580, 680], ['common', 'csv', 'dates', 'report'], [
  `const settings = ${PS};`,
  'const files = [];',
  'const items = $input.all();',
  'for (let i = 0; i < items.length; i++) {',
  '  const bins = items[i].binary || {};',
  '  for (const key of Object.keys(bins)) {',
  '    const bin = bins[key];',
  "    const name = String((bin && bin.fileName) || key);",
  "    if (!/\\.csv$/i.test(name)) continue;",
  '    const buf = await this.helpers.getBinaryDataBuffer(i, key);',
  "    files.push({ name: name, text: buf.toString('utf8') });",
  '  }',
  '}',
  'return [{ json: datasetFromCsvFiles(settings, files) }];',
].join('\n'));
code('Load Built-in Test Data', [1320, 860], ['common', 'csv', 'dates', 'report'], [
  SAMPLE_FILES_JS,
  `const settings = Object.assign({}, ${PS}, { asOf: SAMPLE_AS_OF });`,
  'return [{ json: datasetFromCsvFiles(settings, SAMPLE_FILES) }];',
].join('\n'));

// ---- the three morning queues
const X = 2100;
code('1. Unscheduled, Late & Action Required Jobs', [X, 520], ['common', 'triage'], passOn('jobsQueue', 'jobsQueue'));
code('2. Requires Invoicing & Past-Due Invoices', [X + 280, 520], ['common', 'triage'], passOn('invoicing', 'invoicingQueue'));
code('3. Stalled High-Value Quotes', [X + 560, 520], ['common', 'triage'], passOn('quoteQueue', 'quoteQueue'));

// ---- owner-only delivery
code('Assemble Owner Message', [X + 840, 520], ['common', 'triage', 'message'],
  'const d = $input.first().json;\nreturn [{ json: renderMessage(d) }];');
ifNode('Send email to owner?', [X + 1120, 420], '={{ $json.sendEmail }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
ifNode('Send Slack to owner?', [X + 1120, 640], '={{ $json.sendSlack }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
b.ownerDelivery(X + 1120, 520);

// ---- sticky notes (not counted as executable nodes)
note('Note: Start here', [-40, 80], 640, 380, 4,
  '## START HERE: Jobber Morning Ops Triage Copilot (DRAFT v0.1.0)\nA read-only weekday-morning digest for the OWNER only: (1) Unscheduled / Late / Action Required jobs, (2) Requires Invoicing jobs and past-due invoices, (3) high-value quotes still awaiting a response after your configured follow-up cutoff, ranked by dollar value for a human call.\n\n**Do these in order:**\n1. Import this file (done). It is imported inactive, and the Schedule node is switched off.\n2. testMode is on and **source** defaults to test, which is fictional sample data. Click **Execute workflow** on Manual Test Run. The result is a [TEST] message.\n3. Compare it with sample_morning_digest.md in the pack.\n4. The CSV path is the recommended way to start: export your own Jobs, Invoices, and Quotes reports from Jobber, set source = csv, and re-run. Still [TEST].\n5. The live GraphQL path comes last, and only after a live Jobber test (see the UNVERIFIED note).\n\nStatus: DRAFT. Workflow JSON and Code nodes checked locally with fictional data. NOT tested against a live Jobber, Gmail, or Slack account.');
note('Note: Config guide', [640, 80], 560, 380, 5,
  '## Config fields\n- **source**: test (built-in fictional sample, default) | csv (read exports from csvFolder) | jobber (live read-only GraphQL queries). Anything else falls back to test.\n- **testMode**: ON by default. Messages are labeled [TEST]. source = test always forces it on.\n- **delivery**: email | slack | both | none. Owner only.\n- **ownerEmail / ownerSlackChannel**: YOUR address and a private channel. Never a customer. They come only from this Config node, never from an input row.\n- **jobberGraphqlVersion**: paste-here placeholder for the X-JOBBER-GRAPHQL-VERSION header. Live path only.\n- **csvFolder**: folder with your Jobs, Invoices, and Quotes CSV exports. File names do not matter. n8n only reads files inside its allowed folder.\n- **asOfOverride**: ISO time to pretend it is a different moment (to run an older export). Blank = now.\n- **pastDueMinDays** (1): an invoice is listed once it is this many days past its due date. Due today is not past due.\n- **quoteStalledDays** (blank until configured) and **quoteMinValue** (1000): a quote awaiting a response is listed once it is this old and worth at least this much. Set them just past your own Jobber follow-up schedule. Starting points, not industry standards.');
note('Note: Safety defaults', [1240, 80], 540, 380, 6,
  '## Safety defaults\n- Imported **inactive**; Schedule **disabled**.\n- **testMode** ON; source = **test** (fictional sample).\n- **Zero Jobber write-back**: the Jobber steps send GraphQL **queries** only. GraphQL travels over HTTP POST, so the method shows POST, but there is no mutation in this file and nothing is created, changed, or deleted in Jobber.\n- **No customer messages**: no SMS, no Twilio, no customer email, no review request, no On-My-Way text, no quote or invoice reminder. The only sends are one email and one Slack post to the owner.\n- The stalled-quote list is for a **human** call or personal note, not another automated blast.\n- Never invents numbers. A metric that cannot be computed becomes a "Heads-up" line.');
note('Note: Jobber GraphQL (UNVERIFIED)', [1040, 20], 1700, 250, 3,
  '## Live path: Jobber GraphQL + OAuth 2.0 (read-only queries). UNVERIFIED against a live Jobber account.\nEndpoint: https://api.getjobber.com/api/graphql with header X-JOBBER-GRAPHQL-VERSION and an n8n OAuth2 credential (authorization code) named PLACEHOLDER_JOBBER. Three queries: jobs (with visits), invoices, quotes. First page only (up to 50 per connection); a Heads-up appears when more exists.\nJobber documents the core object fields including quote sentAt. Root queries, connection and amount subfields, status enums, and the selected API version still require a live read-only test. The quote queue requires an actual send date and shop-specific cutoff. Whether a Core-tier account can authorize a Draft app is not confirmed. A Draft app is limited to 5 paying accounts until Jobber approves it.');
note('Note: CSV fallback', [1280, 940], 700, 240, 4,
  '## CSV export (recommended first step, works on every Jobber tier)\nExport your Jobs, Invoices, and Quotes reports from Jobber as CSV, drop them in csvFolder, set source = csv, and set asOfOverride if the export is not from today. This path only READS files. Headers are matched loosely (case, punctuation, spaces/underscores/hyphens ignored). Any one of the three reports is enough; a missing one becomes a Heads-up. See the pack README for the full header list. source = test uses the same kind of fictional files, built in.');
note('Note: Credentials', [X + 1100, 220], 540, 160, 2,
  '## Credentials (placeholders only)\nPLACEHOLDER_JOBBER (OAuth2, live path only), PLACEHOLDER_GMAIL, PLACEHOLDER_SLACK. Attach your own. No secrets, client IDs, or tokens are stored in this file. Do not paste real ones into Config and then share the workflow.');
note('Note: Go live', [X + 1100, 800], 540, 260, 6,
  '## Hard stop before go-live\nDo not turn testMode off or switch the Schedule on until: (1) a clean [TEST] run from the sample data, (2) a clean [TEST] run from YOUR csv export, spot-checked by hand against Jobber, (3) ownerEmail / ownerSlackChannel confirmed as owner-only, (4) an owner has signed off in writing. Even live, this workflow only reports to the owner. It will not contact customers or change Jobber.');

// ---- connections
link('Manual Test Run', 'Config');
link(T_SCHEDULE, 'Config');
link('Config', 'Prepare Settings');
link('Prepare Settings', 'Source is Jobber?');
link('Source is Jobber?', live[0][0], 0);
link('Source is Jobber?', 'Source is CSV?', 1);
for (let i = 0; i < live.length - 1; i++) link(live[i][0], live[i + 1][0]);
link(live[live.length - 1][0], 'Normalize Jobber');
link('Normalize Jobber', '1. Unscheduled, Late & Action Required Jobs');
link('Source is CSV?', 'Read CSV Exports', 0);
link('Source is CSV?', 'Load Built-in Test Data', 1);
link('Read CSV Exports', 'Parse CSV Exports');
link('Parse CSV Exports', '1. Unscheduled, Late & Action Required Jobs');
link('Load Built-in Test Data', '1. Unscheduled, Late & Action Required Jobs');
link('1. Unscheduled, Late & Action Required Jobs', '2. Requires Invoicing & Past-Due Invoices');
link('2. Requires Invoicing & Past-Due Invoices', '3. Stalled High-Value Quotes');
link('3. Stalled High-Value Quotes', 'Assemble Owner Message');
link('Assemble Owner Message', 'Send email to owner?');
link('Assemble Owner Message', 'Send Slack to owner?');
link('Send email to owner?', 'Email owner (Gmail)', 0);
link('Send Slack to owner?', 'Post to owner Slack', 0);

b.write('workflow.n8n.json', 'Jobber Morning Ops Triage Copilot (DRAFT): Prewired AI');
