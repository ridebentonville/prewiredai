'use strict';
/**
 * Shared helpers for build_workflow.cjs and build_csv_fallback_workflow.cjs.
 * Local only: reads files in this folder. No network.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const SOURCE = fs.readFileSync(path.join(HERE, 'jobber_logic.cjs'), 'utf8');

function sections() {
  const out = {};
  const re = /^\/\/ @@SECTION (\w+)\n([\s\S]*?)(?=^\/\/ @@(?:SECTION|END))/gm;
  let m;
  while ((m = re.exec(SOURCE)) !== null) out[m[1]] = m[2].trim() + '\n';
  return out;
}
const SECTIONS = sections();
['common', 'settings', 'csv', 'graphql', 'triage', 'message'].forEach((name) => {
  if (!SECTIONS[name]) throw new Error('missing jobber_logic.cjs section: ' + name);
});

function builder(prefix, builtBy) {
  const nodes = [];
  const uid = (name) => {
    const h = crypto.createHash('sha1').update(prefix + ':' + name).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  const add = (name, type, typeVersion, position, parameters, extra) => {
    nodes.push(Object.assign({ id: uid(name), name, type, typeVersion, position, parameters }, extra || {}));
    return name;
  };
  const codeFor = (parts, body) => {
    const header = `// Generated from jobber_logic.cjs by ${builtBy}. Edit the module, not this node.\n// DRAFT v0.1.0. No network calls and nothing is sent from this node.\n`;
    return header + parts.map((p) => SECTIONS[p]).join('\n') + '\n' + body.trim() + '\n';
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
  const config = (position, fields, includeOther) =>
    add('Config', 'n8n-nodes-base.set', 3.4, position, {
      assignments: { assignments: fields.map(([name, value, type]) => ({ id: uid('cfg:' + name), name, value, type })) },
      includeOtherFields: includeOther,
      options: {},
    });
  const C = {};
  const link = (from, to, out = 0) => {
    C[from] = C[from] || { main: [] };
    while (C[from].main.length <= out) C[from].main.push([]);
    C[from].main[out].push({ node: to, type: 'main', index: 0 });
  };
  const ownerDelivery = (X, y) => {
    add('Email owner (Gmail)', 'n8n-nodes-base.gmail', 2.1, [X + 280, y - 100], {
      resource: 'message', operation: 'send', sendTo: '={{ $json.emailTo }}', subject: '={{ $json.subject }}',
      emailType: 'html', message: '={{ $json.html }}', options: { appendAttribution: false },
    }, { credentials: { gmailOAuth2: { id: 'PLACEHOLDER_GMAIL', name: 'Gmail account (PLACEHOLDER)' } } });
    add('Post to owner Slack', 'n8n-nodes-base.slack', 2.3, [X + 280, y + 120], {
      resource: 'message', operation: 'post', select: 'channel',
      channelId: { __rl: true, value: '={{ $json.slackChannel }}', mode: 'id' },
      messageType: 'text', text: '={{ $json.slackText }}',
      otherOptions: { includeLinkToWorkflow: false, link_names: false, mrkdwn: false, unfurl_links: false, unfurl_media: false },
    }, { credentials: { slackApi: { id: 'PLACEHOLDER_SLACK', name: 'Slack account (PLACEHOLDER)' } } });
  };
  const write = (file, name) => {
    const workflow = { name, nodes, connections: C, active: false, settings: { executionOrder: 'v1', timezone: 'America/Chicago' } };
    fs.writeFileSync(path.join(HERE, file), JSON.stringify(workflow, null, 2) + '\n');
    const sticky = nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length;
    console.log(`${file} written: ${nodes.length - sticky} executable nodes, ${sticky} sticky notes, ${nodes.length} total`);
  };
  return { nodes, uid, add, code, ifNode, note, config, link, ownerDelivery, write };
}

const read = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8');
const SAMPLE = {
  jobs: read('fixtures/sample-jobber-export-jobs.csv'),
  invoices: read('fixtures/sample-jobber-export-invoices.csv'),
  quotes: read('fixtures/sample-jobber-export-quotes.csv'),
  asOf: read('fixtures/reference_time.txt').trim(),
};
const SAMPLE_FILES_JS = [
  `const SAMPLE_FILES = [`,
  `  { name: 'sample-jobber-export-jobs.csv', text: ${JSON.stringify(SAMPLE.jobs)} },`,
  `  { name: 'sample-jobber-export-invoices.csv', text: ${JSON.stringify(SAMPLE.invoices)} },`,
  `  { name: 'sample-jobber-export-quotes.csv', text: ${JSON.stringify(SAMPLE.quotes)} },`,
  `];`,
  `const SAMPLE_AS_OF = ${JSON.stringify(SAMPLE.asOf)};`,
].join('\n');

module.exports = { HERE, SECTIONS, builder, SAMPLE, SAMPLE_FILES_JS };
