#!/usr/bin/env node
/**
 * Generates unassigned-aging-watch.json from dispatch_logic.cjs and the aging fixtures.
 * Local only: reads files in this folder, writes unassigned-aging-watch.json. No network.
 *
 *   node build_aging_workflow.cjs
 *
 * Companion to workflow.n8n.json (the 7:00 AM digest). This file is the 15-minute
 * Unassigned-Job Aging Watch. Code nodes are assembled from the @@SECTION blocks in
 * dispatch_logic.cjs so the tests and the n8n workflow always run the same logic.
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
['common', 'settings', 'csv', 'aging'].forEach((name) => {
  if (!SECTIONS[name]) throw new Error('missing dispatch_logic.cjs section: ' + name);
});

function readAgingTables() {
  const dir = path.join(HERE, 'fixtures');
  return {
    technicians: logic.parseCsv(fs.readFileSync(path.join(dir, 'technicians.csv'), 'utf8')),
    aging_jobs: logic.parseCsv(fs.readFileSync(path.join(dir, 'aging_jobs.csv'), 'utf8')),
  };
}
function builtinAgingDataset() {
  const settings = logic.prepareAgingSettings({ source: 'test' }, Date.parse('2026-01-01T00:00:00Z'));
  const ds = logic.datasetFromAgingTables(settings, readAgingTables());
  delete ds.settings;
  ds.referenceTime = fs.readFileSync(path.join(HERE, 'fixtures', 'aging_reference_time.txt'), 'utf8').trim();
  return ds;
}

function codeFor(parts, body) {
  const header = '// Generated from dispatch_logic.cjs by build_aging_workflow.cjs. Edit the module, not this node.\n// DRAFT v0.2.0. No network calls and nothing is sent from this node.\n';
  return header + parts.map((p) => {
    if (!SECTIONS[p]) throw new Error('unknown section ' + p);
    return SECTIONS[p];
  }).join('\n') + '\n' + body.trim() + '\n';
}

const uid = (name) => {
  const h = crypto.createHash('sha1').update('stdc-aging:' + name).digest('hex');
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

add('Manual Test Run', 'n8n-nodes-base.manualTrigger', 1, [0, 520], {});
add('Schedule every 15 minutes (disabled until you are ready)', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 720],
  { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } }, { disabled: true });

const cfg = [
  ['businessName', 'Your Business Name', 'string'],
  ['timezone', 'America/Chicago', 'string'],
  ['source', 'test', 'string'],
  ['testMode', true, 'boolean'],
  ['delivery', 'email', 'string'],
  ['ownerEmail', 'owner@example.com', 'string'],
  ['ownerSlackChannel', '#dispatch-owner-only', 'string'],
  ['stApiBase', 'https://api.servicetitan.io', 'string'],
  ['stTenantId', 'PASTE_TENANT_ID_HERE', 'string'],
  ['stAppKey', 'PASTE_APP_KEY_HERE', 'string'],
  ['csvFolder', '/home/node/.n8n-files/dispatch-exports', 'string'],
  ['asOfOverride', '', 'string'],
  ['agingThresholdMinutes', logic.AGING_DEFAULT_THRESHOLD_MINUTES, 'number'],
  ['historyDays', logic.DEFAULTS.historyDays, 'number'],
  ['capacityLookaheadDays', logic.DEFAULTS.capacityLookaheadDays, 'number'],
];
add('Config', 'n8n-nodes-base.set', 3.4, [280, 520], {
  assignments: { assignments: cfg.map(([name, value, type]) => ({ id: uid('cfg:' + name), name, value, type })) },
  includeOtherFields: false,
  options: {},
});
code('Prepare Settings', [540, 520], ['common', 'settings', 'aging'],
  'const cfg = $input.first().json;\nreturn [{ json: { settings: prepareAgingSettings(cfg, Date.now()) } }];');

ifNode('Source is ServiceTitan?', [800, 520], '={{ $json.settings.source }}', { type: 'string', operation: 'equals' }, 'servicetitan');
ifNode('Source is CSV?', [1060, 760], '={{ $json.settings.source }}', { type: 'string', operation: 'equals' }, 'csv');

const stBase = `={{ ${PS}.stApiBase }}`;
const tenant = `{{ ${PS}.stTenantId }}`;
const live = [
  ['ServiceTitan: Jobs', 'jpm/v2/tenant/' + tenant + '/jobs', [['createdOnOrAfter', `{{ ${PS}.historyStart }}`], ['pageSize', '200']]],
  ['ServiceTitan: Appointments', 'jpm/v2/tenant/' + tenant + '/appointments', [['startsOnOrAfter', `{{ ${PS}.historyStart }}`], ['startsBefore', `{{ ${PS}.lookaheadEnd }}`], ['pageSize', '200']]],
  ['ServiceTitan: Appointment Assignments', 'dispatch/v2/tenant/' + tenant + '/appointment-assignments', [['createdOnOrAfter', `{{ ${PS}.historyStart }}`], ['pageSize', '200']]],
  ['ServiceTitan: Technicians', 'settings/v2/tenant/' + tenant + '/technicians', [['active', 'True'], ['pageSize', '200']]],
];
live.forEach(([name, p, q], i) => {
  add(name, 'n8n-nodes-base.httpRequest', 4.2, [1060 + i * 240, 280], {
    method: 'GET',
    url: `${stBase}/${p}`,
    authentication: 'genericCredentialType',
    genericAuthType: 'oAuth2Api',
    sendQuery: true,
    queryParameters: { parameters: q.map(([k, v]) => ({ name: k, value: v.indexOf('{{') >= 0 ? '=' + v : v })) },
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'ST-App-Key', value: `={{ ${PS}.stAppKey }}` }] },
    options: {},
  }, {
    credentials: { oAuth2Api: { id: 'PLACEHOLDER_SERVICETITAN', name: 'ServiceTitan OAuth2 client credentials (PLACEHOLDER)' } },
    onError: 'continueRegularOutput',
  });
});
code('Normalize ServiceTitan', [1060 + live.length * 240, 280], ['common', 'settings', 'aging'],
  `const settings = ${PS};\nconst raw = {\n    jobs: $('ServiceTitan: Jobs').first().json,\n    appointments: $('ServiceTitan: Appointments').first().json,\n    assignments: $('ServiceTitan: Appointment Assignments').first().json,\n    technicians: $('ServiceTitan: Technicians').first().json,\n};\nreturn [{ json: normalizeAgingServiceTitan(settings, raw) }];`);

add('Read CSV Exports', 'n8n-nodes-base.readWriteFile', 1, [1320, 680],
  { operation: 'read', fileSelector: `={{ ${PS}.csvFolder }}/*.csv`, options: {} });
code('Parse CSV Exports', [1580, 680], ['common', 'csv', 'settings', 'aging'], [
  `const settings = ${PS};`,
  'const tables = {};',
  'const items = $input.all();',
  'for (let i = 0; i < items.length; i++) {',
  '  const bin = items[i].binary && items[i].binary.data;',
  '  if (!bin) continue;',
  "  const buf = await this.helpers.getBinaryDataBuffer(i, 'data');",
  "  const name = String(bin.fileName || '').toLowerCase().replace(/\\.csv$/, '');",
  "  tables[name] = parseCsv(buf.toString('utf8'));",
  '}',
  'return [{ json: datasetFromAgingTables(settings, tables) }];',
].join('\n'));
code('Load Built-in Test Data', [1320, 860], ['common', 'settings', 'aging'],
  `const DATASET = ${JSON.stringify(builtinAgingDataset())};\nconst settings = ${PS};\nreturn [{ json: loadAgingTestData(settings, DATASET) }];`);

const X = 2100;
code('Unassigned Aging Watch', [X, 520], ['common', 'settings', 'aging'],
  'const d = $input.first().json;\nreturn [{ json: Object.assign({}, d, { agingWatch: unassignedAgingWatch(d) }) }];');
code('Assemble Aging Alert', [X + 280, 520], ['common', 'settings', 'aging'],
  'const d = $input.first().json;\nreturn [{ json: renderAgingAlert(d) }];');
ifNode('Send email to owner?', [X + 560, 420], '={{ $json.sendEmail }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
ifNode('Send Slack to owner?', [X + 560, 640], '={{ $json.sendSlack }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
add('Email owner (Gmail)', 'n8n-nodes-base.gmail', 2.1, [X + 840, 420], {
  resource: 'message', operation: 'send', sendTo: '={{ $json.emailTo }}', subject: '={{ $json.subject }}',
  emailType: 'html', message: '={{ $json.html }}', options: { appendAttribution: false },
}, { credentials: { gmailOAuth2: { id: 'PLACEHOLDER_GMAIL', name: 'Gmail account (PLACEHOLDER)' } } });
add('Post to owner Slack', 'n8n-nodes-base.slack', 2.3, [X + 840, 640], {
  resource: 'message', operation: 'post', select: 'channel',
  channelId: { __rl: true, value: "={{ $json.slackChannel.replace(/^#/, '') }}", mode: 'name' },
  text: '={{ $json.text }}', otherOptions: { includeLinkToWorkflow: false },
}, { credentials: { slackApi: { id: 'PLACEHOLDER_SLACK', name: 'Slack account (PLACEHOLDER)' } } });

note('Note: Start here', [-40, 80], 620, 330, 4,
  '## START HERE: Unassigned-Job Aging Watch (DRAFT v0.2.0)\nA read-only 15-minute poll for HVAC, plumbing, and electrical shops. It flags jobs sitting in Unassigned past a configurable threshold (default 20 minutes), blank skill tags, missing zone assignments, and multi-tech / multi-day jobs that Dispatch Pro Auto Mode can silently drop or ping-pong. The alert goes to the OWNER only (email and/or Slack). An SMS-length summary is included in the payload for the same owner channels. Nothing is written back to the board.\n\n**Do these in order:**\n1. Import this file (done). It is inactive, and the 15-minute Schedule node is switched off.\n2. Leave **source** = test and click **Execute workflow** on Manual Test Run. The result is a [TEST] alert built from fictional sample data.\n3. Compare it with sample_aging_alert.md.\n4. Switch to **csv** (your own ServiceTitan job export) and re-run. Still [TEST].\n5. Only then think about go-live. See the Go live note.\n\nStatus: DRAFT. Designed from public ServiceTitan docs and checked as importable JSON. NOT tested against a live ServiceTitan, Gmail, or Slack account.');
note('Note: Config guide', [280, 80], 560, 330, 5,
  '## Config fields\n- **source**: test (built-in fictional data, default) | csv (read exports from csvFolder) | servicetitan (live read-only GETs). Anything else falls back to test.\n- **testMode**: ON by default. Messages are labeled [TEST]. source = test always forces it on.\n- **delivery**: email | slack | both | none. Owner only. The alert text is also short enough to paste into an owner SMS, but this draft does not include a Twilio or customer-SMS node.\n- **ownerEmail / ownerSlackChannel**: YOUR address and a private channel. Never a customer.\n- **stApiBase / stTenantId / stAppKey**: paste-here placeholders for the live path. Unused unless source = servicetitan.\n- **csvFolder**: folder with aging_jobs.csv (or jobs.csv with the same columns) and optional technicians.csv. n8n only reads files inside its allowed folder.\n- **asOfOverride**: optional ISO time to pretend it is a different moment. Blank = now.\n- **agingThresholdMinutes**: how long a job may sit in Unassigned before it is flagged. Default 20 (use 15–20 to match how your shop works).');
note('Note: Safety defaults', [880, 80], 520, 330, 6,
  '## Safety defaults\n- Imported **inactive**; 15-minute Schedule **disabled**.\n- **testMode** ON; source = **test**.\n- **Read-only / zero board write-back**: ServiceTitan nodes are GET only. No POST, PUT, PATCH, or DELETE. The dispatcher stays 100% in control.\n- **No customer messages**: there is no SMS, no Twilio, and no customer email node anywhere in this file.\n- It never assigns, reassigns, or moves a job. It only flags.\n- Never invents numbers. A metric that cannot be computed becomes a "Heads-up" line.');
note('Note: ServiceTitan v2 endpoints (UNVERIFIED)', [1040, 20], 1400, 230, 3,
  '## Live path: ServiceTitan v2 REST reads (all GET). UNVERIFIED against a real tenant.\nBase: {stApiBase}/{module}/v2/tenant/{tenantId}/... plus header ST-App-Key. Auth is an n8n OAuth2 credential (client credentials) named PLACEHOLDER_SERVICETITAN; n8n fetches the token, so this workflow never POSTs to ServiceTitan.\nJobs: jpm/v2/.../jobs | Appointments: jpm/v2/.../appointments | Appointment assignments: dispatch/v2/.../appointment-assignments | Technicians: settings/v2/.../technicians\nExact paths, query names, response fields, and skill/zone field names are from public docs and memory and must be confirmed before use. First page only (pageSize 200). If a skill or zone field is not present on the job record, it is flagged as missing rather than guessed.');
note('Note: CSV fallback', [1280, 940], 640, 200, 4,
  '## CSV export fallback (recommended first step, and the path for Starter / Essentials)\nExport your own job report to aging_jobs.csv or jobs.csv (see fixtures/aging_jobs.csv for columns, including skill, zone, tech_ids, unassigned_since, and multi_day), drop it in csvFolder, set source = csv, and set asOfOverride if the export is not from this moment. This path only READS files. Source = test uses the same fictional file, built in.');
note('Note: Credentials', [X + 520, 220], 520, 160, 2,
  '## Credentials (placeholders only)\nPLACEHOLDER_SERVICETITAN (OAuth2, live path only), PLACEHOLDER_GMAIL, PLACEHOLDER_SLACK. Attach your own. No secrets, client IDs, or tenant IDs are stored in this file. Do not paste real ones into Config and then share the workflow.');
note('Note: Go live', [X + 520, 800], 520, 250, 6,
  '## Hard stop before go-live\nDo not turn testMode off or switch the 15-minute Schedule on until: (1) a clean [TEST] run from sample data, (2) a clean [TEST] run from YOUR csv export, spot-checked by hand against ServiceTitan, (3) ownerEmail / ownerSlackChannel confirmed as owner-only, (4) an owner has signed off in writing. Even live, this workflow only reports to the owner. It will not contact customers or change ServiceTitan.');

const C = {};
const link = (from, to, out = 0) => {
  C[from] = C[from] || { main: [] };
  while (C[from].main.length <= out) C[from].main.push([]);
  C[from].main[out].push({ node: to, type: 'main', index: 0 });
};
const schedule = 'Schedule every 15 minutes (disabled until you are ready)';
link('Manual Test Run', 'Config');
link(schedule, 'Config');
link('Config', 'Prepare Settings');
link('Prepare Settings', 'Source is ServiceTitan?');
link('Source is ServiceTitan?', live[0][0], 0);
link('Source is ServiceTitan?', 'Source is CSV?', 1);
for (let i = 0; i < live.length - 1; i++) link(live[i][0], live[i + 1][0]);
link(live[live.length - 1][0], 'Normalize ServiceTitan');
link('Normalize ServiceTitan', 'Unassigned Aging Watch');
link('Source is CSV?', 'Read CSV Exports', 0);
link('Source is CSV?', 'Load Built-in Test Data', 1);
link('Read CSV Exports', 'Parse CSV Exports');
link('Parse CSV Exports', 'Unassigned Aging Watch');
link('Load Built-in Test Data', 'Unassigned Aging Watch');
link('Unassigned Aging Watch', 'Assemble Aging Alert');
link('Assemble Aging Alert', 'Send email to owner?');
link('Assemble Aging Alert', 'Send Slack to owner?');
link('Send email to owner?', 'Email owner (Gmail)', 0);
link('Send Slack to owner?', 'Post to owner Slack', 0);

const workflow = {
  name: 'ServiceTitan Unassigned-Job Aging Watch (DRAFT): Prewired AI',
  nodes,
  connections: C,
  active: false,
  settings: { executionOrder: 'v1', timezone: 'America/Chicago' },
};
fs.writeFileSync(path.join(HERE, 'unassigned-aging-watch.json'), JSON.stringify(workflow, null, 2) + '\n');
const sticky = nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length;
console.log(`unassigned-aging-watch.json written: ${nodes.length - sticky} executable nodes, ${sticky} sticky notes, ${nodes.length} total`);
