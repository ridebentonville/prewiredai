#!/usr/bin/env node
/**
 * Generates workflow.n8n.json from dispatch_logic.cjs and the CSV fixtures.
 * Local only: reads files in this folder, writes workflow.n8n.json. No network.
 *
 *   node build_workflow.cjs
 *
 * The Code nodes are assembled from the `@@SECTION` blocks in dispatch_logic.cjs, so the tests
 * (mock_servicetitan_test.cjs) and the n8n workflow always run the same logic.
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

function readTables() {
  const dir = path.join(HERE, 'fixtures');
  const t = {};
  ['technicians', 'jobs', 'capacity', 'memberships', 'estimates', 'calls'].forEach((n) => {
    t[n] = logic.parseCsv(fs.readFileSync(path.join(dir, n + '.csv'), 'utf8'));
  });
  return t;
}
function builtinDataset() {
  const settings = logic.prepareSettings({ source: 'test' }, Date.parse('2026-01-01T00:00:00Z'));
  const ds = logic.datasetFromTables(settings, readTables());
  delete ds.settings;
  ds.referenceTime = fs.readFileSync(path.join(HERE, 'fixtures', 'reference_time.txt'), 'utf8').trim();
  return ds;
}

function codeFor(parts, body) {
  const header = '// Generated from dispatch_logic.cjs by build_workflow.cjs. Edit the module, not this node.\n// DRAFT v0.1.0. No network calls and nothing is sent from this node.\n';
  return header + parts.map((p) => SECTIONS[p]).join('\n') + '\n' + body.trim() + '\n';
}

const uid = (name) => {
  const h = crypto.createHash('sha1').update('stdc:' + name).digest('hex');
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
const passOn = (key, fn) => `const d = $input.first().json;\nreturn [{ json: Object.assign({}, d, { ${key}: ${fn}(d) }) }];`;

// ---- triggers + config
add('Manual Test Run', 'n8n-nodes-base.manualTrigger', 1, [0, 520], {});
add('Schedule 7:00 AM (disabled until you are ready)', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 720],
  { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 7 }] } }, { disabled: true });

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
  ['digestHour', 7, 'number'],
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
add('Config', 'n8n-nodes-base.set', 3.4, [280, 520], {
  assignments: { assignments: cfg.map(([name, value, type]) => ({ id: uid('cfg:' + name), name, value, type })) },
  includeOtherFields: false,
  options: {},
});
code('Prepare Settings', [540, 520], ['common', 'settings'],
  'const cfg = $input.first().json;\nreturn [{ json: { settings: prepareSettings(cfg, Date.now()) } }];');

// ---- source routing
ifNode('Source is ServiceTitan?', [800, 520], '={{ $json.settings.source }}', { type: 'string', operation: 'equals' }, 'servicetitan');
ifNode('Source is CSV?', [1060, 760], '={{ $json.settings.source }}', { type: 'string', operation: 'equals' }, 'csv');

// ---- live ServiceTitan reads (GET only, unreachable unless source = servicetitan)
const stBase = `={{ ${PS}.stApiBase }}`;
const tenant = `{{ ${PS}.stTenantId }}`;
const live = [
  ['ServiceTitan: Jobs', 'jpm/v2/tenant/' + tenant + '/jobs', [['createdOnOrAfter', `{{ ${PS}.historyStart }}`], ['pageSize', '200']]],
  ['ServiceTitan: Appointments', 'jpm/v2/tenant/' + tenant + '/appointments', [['startsOnOrAfter', `{{ ${PS}.historyStart }}`], ['startsBefore', `{{ ${PS}.lookaheadEnd }}`], ['pageSize', '200']]],
  ['ServiceTitan: Appointment Assignments', 'dispatch/v2/tenant/' + tenant + '/appointment-assignments', [['createdOnOrAfter', `{{ ${PS}.historyStart }}`], ['pageSize', '200']]],
  ['ServiceTitan: Technicians', 'settings/v2/tenant/' + tenant + '/technicians', [['active', 'True'], ['pageSize', '200']]],
  ['ServiceTitan: Technician Shifts', 'dispatch/v2/tenant/' + tenant + '/technician-shifts', [['startsOnOrAfter', `{{ ${PS}.asOf }}`], ['endsOnOrBefore', `{{ ${PS}.lookaheadEnd }}`], ['pageSize', '200']]],
  ['ServiceTitan: Estimates', 'sales/v2/tenant/' + tenant + '/estimates', [['createdOnOrAfter', `{{ ${PS}.historyStart }}`], ['pageSize', '200']]],
  ['ServiceTitan: Recurring Service Events', 'memberships/v2/tenant/' + tenant + '/recurring-service-events', [['dateBefore', `{{ ${PS}.asOf }}`], ['pageSize', '200']]],
  ['ServiceTitan: Calls', 'telecom/v3/tenant/' + tenant + '/calls', [['createdOnOrAfter', `{{ ${PS}.callsSince }}`], ['pageSize', '200']]],
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
const rawKeys = ['jobs', 'appointments', 'assignments', 'technicians', 'shifts', 'estimates', 'memberships', 'calls'];
const rawBody = rawKeys.map((k, i) => `    ${k}: $('${live[i][0]}').first().json`).join(',\n');
code('Normalize ServiceTitan', [1060 + live.length * 240, 280], ['common', 'servicetitan_normalize'],
  `const settings = ${PS};\nconst raw = {\n${rawBody},\n};\nreturn [{ json: normalizeServiceTitan(settings, raw) }];`);

// ---- CSV + built-in test data
add('Read CSV Exports', 'n8n-nodes-base.readWriteFile', 1, [1320, 680],
  { operation: 'read', fileSelector: `={{ ${PS}.csvFolder }}/*.csv`, options: {} }, { alwaysOutputData: true });
code('Parse CSV Exports', [1580, 680], ['common', 'csv'], [
  `const settings = ${PS};`,
  'const tables = {};',
  'const notes = [];',
  'const items = $input.all();',
  'for (let i = 0; i < items.length; i++) {',
  '  const bin = items[i].binary && items[i].binary.data;',
  '  if (!bin) continue;',
  "  const buf = await this.helpers.getBinaryDataBuffer(i, 'data');",
  "  const name = String(bin.fileName || '').toLowerCase().replace(/\\.csv$/, '');",
  "  const table = parseCsvTable(buf.toString('utf8'));",
  "  for (const warning of table.warnings) notes.push('CSV import: ' + bin.fileName + ': ' + warning);",
  "  if (!table.warnings.length) tables[name] = table.rows;",
  '}',
  'return [{ json: datasetFromTables(Object.assign({}, settings, { headsUp: (settings.headsUp || []).concat(notes) }), tables) }];',
].join('\n'));
code('Load Built-in Test Data', [1320, 860], ['common', 'testdata'],
  `const DATASET = ${JSON.stringify(builtinDataset())};\nconst settings = ${PS};\nreturn [{ json: loadTestData(settings, DATASET) }];`);

// ---- the four workflows
const X = 2100;
code('1. Booking QA & Skill-Tier Routing', [X, 520], ['common', 'booking_qa'], passOn('bookingQa', 'bookingQa'));
code('2. Open-Capacity & Unsold-Estimate Filler', [X + 280, 520], ['common', 'capacity_filler'], passOn('capacity', 'capacityFiller'));
code('3. Morning Dispatch KPI Digest', [X + 560, 520], ['common', 'kpi_digest'], passOn('kpis', 'kpiDigest'));
code('4. After-Hours Handoff Summary', [X + 840, 520], ['common', 'handoff'], passOn('afterHours', 'afterHoursHandoff'));

// ---- owner-only delivery
code('Assemble Owner Message', [X + 1120, 520], ['common', 'message'],
  'const d = $input.first().json;\nreturn [{ json: renderMessage(d) }];');
ifNode('Send email to owner?', [X + 1400, 420], '={{ $json.sendEmail }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
ifNode('Send Slack to owner?', [X + 1400, 640], '={{ $json.sendSlack }}', { type: 'boolean', operation: 'true', singleValue: true }, '');
add('Email owner (Gmail)', 'n8n-nodes-base.gmail', 2.1, [X + 1680, 420], {
  resource: 'message', operation: 'send', sendTo: '={{ $json.emailTo }}', subject: '={{ $json.subject }}',
  emailType: 'html', message: '={{ $json.html }}', options: { appendAttribution: false },
}, { credentials: { gmailOAuth2: { id: 'PLACEHOLDER_GMAIL', name: 'Gmail account (PLACEHOLDER)' } } });
add('Post to owner Slack', 'n8n-nodes-base.slack', 2.3, [X + 1680, 640], {
  resource: 'message', operation: 'post', select: 'channel',
  channelId: { __rl: true, value: "={{ $json.slackChannel.replace(/^#/, '') }}", mode: 'name' },
  messageType: 'text', text: '={{ $json.slackText }}',
  otherOptions: { includeLinkToWorkflow: false, link_names: false, mrkdwn: false, unfurl_links: false, unfurl_media: false },
}, { credentials: { slackApi: { id: 'PLACEHOLDER_SLACK', name: 'Slack account (PLACEHOLDER)' } } });

// ---- sticky notes (not counted as executable nodes)
note('Note: Start here', [-40, 80], 620, 330, 4,
  '## START HERE: ServiceTitan Dispatch & Capacity Copilot (DRAFT v0.1.0)\nFour read-only dispatch reports for an Operations Manager, delivered to the OWNER only: (1) Booking QA & skill-tier routing, (2) open-capacity & unsold-estimate callback queue, (3) Morning Dispatch KPI digest, (4) after-hours handoff.\n\n**Do these in order:**\n1. Import this file (done). It is inactive, and the Schedule node is switched off.\n2. Leave **source** = test and click **Execute workflow** on Manual Test Run. The result is a [TEST] message built from fictional HVAC / plumbing / electrical sample data.\n3. Compare it with sample_test_digest.md.\n4. Switch to **csv** (your own ServiceTitan report exports) and re-run. Still [TEST].\n5. Only then think about go-live. See the Go live note.\n\nStatus: DRAFT. Designed from public ServiceTitan docs and checked as importable JSON. NOT tested against a live ServiceTitan, Gmail, or Slack account.');
note('Note: Config guide', [280, 80], 560, 330, 5,
  '## Config fields\n- **source**: test (built-in fictional data, default) | csv (read exports from csvFolder) | servicetitan (live read-only GETs). Anything else falls back to test.\n- **testMode**: ON by default. Messages are labeled [TEST]. source = test always forces it on.\n- **delivery**: email | slack | both | none. Owner only.\n- **ownerEmail / ownerSlackChannel**: YOUR address and a private channel. Never a customer.\n- **stApiBase / stTenantId / stAppKey**: paste-here placeholders for the live path. Unused unless source = servicetitan.\n- **csvFolder**: folder with technicians.csv, jobs.csv, capacity.csv, memberships.csv, estimates.csv, calls.csv. n8n only reads files inside its allowed folder.\n- **asOfOverride**: optional ISO time to pretend it is a different moment (needed to run old exports). Blank = now.\n- Thresholds: replacementAgeYears, membershipOverdueDays, estimateStaleDays, bookingLookbackHours, repeatWindowDays, capacityLookaheadDays, afterHoursStartHour (17 = 5 PM), maxItemsPerSection, historyDays. digestHour is informational; the Schedule node sets the real time (7:00 AM).');
note('Note: Safety defaults', [880, 80], 520, 330, 6,
  '## Safety defaults\n- Imported **inactive**; Schedule **disabled**.\n- **testMode** ON; source = **test**.\n- **Read-only**: ServiceTitan nodes are GET only. No POST, PUT, PATCH, or DELETE.\n- **No customer messages**: there is no SMS, no Twilio, and no customer email node anywhere in this file.\n- The callback queue is a **draft list for dispatchers**. A person decides who to call.\n- Booking QA **suggests** routing. It never reassigns a job.\n- Never invents numbers. A metric that cannot be computed becomes a "Heads-up" line.');
note('Note: ServiceTitan v2 endpoints (UNVERIFIED)', [1040, 20], 1900, 230, 3,
  '## Live path: ServiceTitan v2 REST reads (all GET). UNVERIFIED against a real tenant.\nBase: {stApiBase}/{module}/v2/tenant/{tenantId}/... plus header ST-App-Key. Auth is an n8n OAuth2 credential (client credentials) named PLACEHOLDER_SERVICETITAN; n8n fetches the token, so this workflow never POSTs to ServiceTitan.\nJobs: jpm/v2/.../jobs | Appointments: jpm/v2/.../appointments | Appointment assignments: dispatch/v2/.../appointment-assignments | Technicians: settings/v2/.../technicians | Technician shifts: dispatch/v2/.../technician-shifts | Estimates: sales/v2/.../estimates | Recurring service events (membership due dates): memberships/v2/.../recurring-service-events | Calls: telecom/v3/.../calls\nThe Dispatch capacity query is a POST, so it is NOT used. Open windows are derived as shift time minus booked appointments. Exact paths, query names, response fields, and API-version numbers are from public docs and memory and must be confirmed before use. Customer names, phones, equipment, and customer type need extra lookups this draft does not make. First page only (pageSize 200).');
note('Note: CSV fallback', [1280, 940], 640, 200, 4,
  '## CSV export fallback (recommended first step)\nExport your own reports to the six CSV files named in the Config note, drop them in csvFolder, set source = csv, and set asOfOverride if the export is not from today. This path only READS files. See fixtures/ in the pack for the exact columns. Source = test uses the same fictional files, built in.');
note('Note: Credentials', [X + 1360, 220], 520, 160, 2,
  '## Credentials (placeholders only)\nPLACEHOLDER_SERVICETITAN (OAuth2, live path only), PLACEHOLDER_GMAIL, PLACEHOLDER_SLACK. Attach your own. No secrets, client IDs, or tenant IDs are stored in this file. Do not paste real ones into Config and then share the workflow.');
note('Note: Go live', [X + 1360, 800], 520, 250, 6,
  '## Hard stop before go-live\nDo not turn testMode off or switch the Schedule on until: (1) a clean [TEST] run from sample data, (2) a clean [TEST] run from YOUR csv export, spot-checked by hand against ServiceTitan, (3) ownerEmail / ownerSlackChannel confirmed as owner-only, (4) an owner has signed off in writing. Even live, this workflow only reports to the owner. It will not contact customers or change ServiceTitan.');

// ---- connections
const C = {};
const link = (from, to, out = 0) => {
  C[from] = C[from] || { main: [] };
  while (C[from].main.length <= out) C[from].main.push([]);
  C[from].main[out].push({ node: to, type: 'main', index: 0 });
};
const schedule = 'Schedule 7:00 AM (disabled until you are ready)';
link('Manual Test Run', 'Config');
link(schedule, 'Config');
link('Config', 'Prepare Settings');
link('Prepare Settings', 'Source is ServiceTitan?');
link('Source is ServiceTitan?', live[0][0], 0);
link('Source is ServiceTitan?', 'Source is CSV?', 1);
for (let i = 0; i < live.length - 1; i++) link(live[i][0], live[i + 1][0]);
link(live[live.length - 1][0], 'Normalize ServiceTitan');
link('Normalize ServiceTitan', '1. Booking QA & Skill-Tier Routing');
link('Source is CSV?', 'Read CSV Exports', 0);
link('Source is CSV?', 'Load Built-in Test Data', 1);
link('Read CSV Exports', 'Parse CSV Exports');
link('Parse CSV Exports', '1. Booking QA & Skill-Tier Routing');
link('Load Built-in Test Data', '1. Booking QA & Skill-Tier Routing');
link('1. Booking QA & Skill-Tier Routing', '2. Open-Capacity & Unsold-Estimate Filler');
link('2. Open-Capacity & Unsold-Estimate Filler', '3. Morning Dispatch KPI Digest');
link('3. Morning Dispatch KPI Digest', '4. After-Hours Handoff Summary');
link('4. After-Hours Handoff Summary', 'Assemble Owner Message');
link('Assemble Owner Message', 'Send email to owner?');
link('Assemble Owner Message', 'Send Slack to owner?');
link('Send email to owner?', 'Email owner (Gmail)', 0);
link('Send Slack to owner?', 'Post to owner Slack', 0);

const workflow = {
  name: 'ServiceTitan Dispatch & Capacity Copilot (DRAFT): Prewired AI',
  nodes,
  connections: C,
  active: false,
  settings: { executionOrder: 'v1', timezone: 'America/Chicago' },
};
fs.writeFileSync(path.join(HERE, 'workflow.n8n.json'), JSON.stringify(workflow, null, 2) + '\n');
const sticky = nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length;
console.log(`workflow.n8n.json written: ${nodes.length - sticky} executable nodes, ${sticky} sticky notes, ${nodes.length} total`);
