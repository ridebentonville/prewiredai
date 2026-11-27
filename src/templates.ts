/**
 * Prewired AI automation packs: /templates catalog, /templates/<slug> pages,
 * and the homepage teaser.
 *
 * Facts only. Sources: PACK-FACTS.md (node counts, versions, categories) and the
 * pack listings in prewired-templates/listings/. Same rules as config.ts:
 * - No testimonials, customer counts, results, time saved, ROI, or accuracy claims.
 * - Do not name any employer or client.
 * - Manager Digest is Free. Every other price is "Pricing coming soon" until Bryce
 *   approves list prices. Do NOT add the draft dollar ranges from older listing or
 *   README copy; they are under review and must not appear on the site.
 * - Nothing here is for sale. No checkout or Gumroad URLs. CTAs are the email waitlist plus the site scheduling URL, when set.
 * - Node counts are executable nodes from the shipped n8n JSON, excluding sticky notes.
 *
 * TODO: Setup time is not known for most packs (listings say [TBD] until a live
 * test). Those FAQ entries are omitted rather than rendered as [TBD].
 * TODO: There is no public Setup Agent playbook URL yet. Do not link one.
 */

export const PRICE_PENDING = "Pricing coming soon";

export type CategoryId =
  | "free"
  | "lead-response"
  | "booking-service"
  | "billing"
  | "crm-hygiene"
  | "field-service"
  | "ai-agents"
  | "reporting"
  | "lead-capture";

export interface Category {
  id: CategoryId;
  label: string;
}

/** Filter chips on /templates, in display order (after "All"). */
export const categories: Category[] = [
  { id: "free", label: "Free" },
  { id: "lead-response", label: "Lead response" },
  { id: "booking-service", label: "Booking & service" },
  { id: "billing", label: "Billing" },
  { id: "crm-hygiene", label: "CRM hygiene" },
  { id: "field-service", label: "Field service" },
  { id: "ai-agents", label: "AI agents" },
  { id: "reporting", label: "Reporting" },
];

/** Form to CRM's primary category ("Lead capture") is grouped under the Lead response chip. */
const categoryLabels: Record<CategoryId, string> = {
  free: "Free",
  "lead-response": "Lead response",
  "booking-service": "Booking & service",
  billing: "Billing",
  "crm-hygiene": "CRM hygiene",
  "field-service": "Field service",
  "ai-agents": "AI agents",
  reporting: "Reporting",
  "lead-capture": "Lead capture",
};

export function categoryLabel(id: CategoryId): string {
  return categoryLabels[id];
}

export interface Tier {
  id: "solo" | "team" | "dfy";
  label: string;
  description: string;
}

/** AppSumo-style framing. Which tiers exist per pack, and prices, are not decided. */
export const tiers: Tier[] = [
  {
    id: "solo",
    label: "Solo (template)",
    description:
      "The downloadable pack. You import it into your own n8n, connect your own accounts, and follow the README and checklist.",
  },
  {
    id: "team",
    label: "Team (done-with-you setup)",
    description:
      "Bot-assisted, done-with-you setup. We work through the Setup Agent playbook together, and a Prewired AI reviewer checks your test output before go-live.",
  },
  {
    id: "dfy",
    label: "Done-for-you install",
    description:
      "A fixed-price install. Prewired AI sets it up in your accounts and reviews the test run. You still sign the go-live checklist.",
  },
];

export interface Faq {
  q: string;
  a: string;
}

export interface WorkflowFile {
  name: string;
  /** Executable nodes, excluding sticky notes. */
  nodes: number;
  description: string;
}

/** Optional positioning callout rendered on a pack page, after the hero. */
export interface PackCallout {
  title: string;
  body: string;
  items?: { heading: string; body: string }[];
}

export interface TemplatePack {
  slug: string;
  name: string;
  version: string;
  /** Primary category shown on the card. */
  category: CategoryId;
  /** Filter chips this pack appears under (primary is added automatically). */
  filterTags: CategoryId[];
  free?: boolean;
  /** Optional small pill on the card and pack page, e.g. "New". */
  badge?: string;
  /** Problem solved, from the listing headline. */
  headline: string;
  /** Short card summary. */
  summary: string;
  /** One sentence on safety for the card. */
  safety: string;
  whoFor: string;
  whatItDoes: string[];
  workflows: WorkflowFile[];
  /** Total executable nodes across the pack's n8n workflows. */
  totalNodes: number;
  /** Total including canvas sticky notes. */
  totalNodesWithNotes: number;
  /** Optional note when the pack is more than n8n workflows. */
  kitNote?: string;
  /** What test mode / dry-run do by default. */
  defaults: string[];
  /** Whether anything is still written while test mode is on. */
  testModeWrites: string;
  /** Key included files, at a high level. */
  included: string[];
  /** Pack-specific guardrails. */
  guardrails: string[];
  hardStop: string;
  willNot: string[];
  faq: Faq[];
  /** Optional factual footnote on live testing. Never phrase as a customer result. */
  testingNote: string;
  /** True for packs with an interactive diagram at /diagrams/<slug>.html. */
  diagram?: boolean;
  related?: string[];
  /** Optional positioning callouts rendered on the pack page, after the hero. */
  callouts?: PackCallout[];
}

export const templatesPage = {
  title: "Templates | Prewired AI automation packs for n8n",
  description:
    "Draft catalog of 13 Prewired AI automation packs for n8n: lead response, booking reminders, invoice sync, CRM cleanup, Jobber follow-ups, ServiceTitan dispatch and Jobber morning-ops field-service reporting, and draft-first AI agents. Test mode on by default. Manager Digest is free. Not for sale yet.",
  heading: "Prewired AI automation packs",
  intro:
    "Thirteen n8n automation packs and post-sales AI agents for small sales and service teams, including dispatch and morning-ops reporting for field-service shops. Each one imports inactive with test mode on, so nothing reaches a real customer until you test it and sign off.",
  notForSale:
    "Nothing on this page is for sale yet. Every pack is a draft, there is no checkout, and paid prices are coming soon. Manager Digest will be free. Join the waitlist by email and you will hear when a pack is ready.",
  sampleDataNote: "Every pack ships with fictional sample data only.",
};

export const templatesTeaser = {
  heading: "Templates",
  summary:
    "Thirteen draft n8n automation packs and post-sales AI agents, including ServiceTitan and Jobber reporting for field-service shops. Every pack imports inactive with test mode on and a hard stop before the first live action. Not for sale yet; Manager Digest will be free.",
  linkLabel: "See the template packs",
};

/** Shared Production Guardrails (every pack). */
export const sharedGuardrails: { title: string; body: string }[] = [
  {
    title: "Your own accounts",
    body: "You connect your own accounts. Workflow files contain no passwords, keys, tokens, or client IDs.",
  },
  {
    title: "Imported inactive",
    body: "Nothing listens, sends, or writes until you click Active.",
  },
  {
    title: "Test mode on by default",
    body: "Test mode (and dry-run where a pack has it) is on by default. You get [TEST] previews and customers receive nothing. Each pack page says whether anything is still written in test mode.",
  },
  {
    title: "Hard stop before the first live action",
    body: "No first live customer message, invoice, CRM write, or digest until a clean test and an owner-signed checklist.",
  },
  {
    title: "Approved rows only",
    body: "Where a pack can change records (Cleanup Kit fix, Account Health hygiene apply), it acts only on rows a person approved.",
  },
  {
    title: "Draft-first",
    body: "Where a pack could contact customers on its own, it holds drafts instead. Support Triage and Account Health never send by themselves.",
  },
  {
    title: "Separate workflows for separate risks",
    body: "Read-only work and write or send work live in different workflow files.",
  },
  {
    title: "Human STOP points",
    body: "The Setup Agent never ticks a checklist box, approves a row, or turns on a live flag.",
  },
  {
    title: "Owner sign-off",
    body: "Go-live needs an owner signature with name and date.",
  },
  {
    title: "Not legal, tax, or accounting advice",
    body: "Consent, opt-out, quiet hours, A2P 10DLC registration, sales tax, and privacy are your responsibility.",
  },
  {
    title: "Fictional sample data",
    body: "Sample data in every pack is made up.",
  },
];

export const setupAgentNote =
  "Every pack has a Setup Agent playbook. The Setup Agent is the installer, not a separate product: it walks you through connecting accounts and running the test, and stops at every human step. It never approves a row, ticks a checklist box, or turns on a live flag for you.";

const draftNote = (services: string) =>
  `Draft. Not yet tested against live ${services} accounts.`;

const stlFormNote =
  "Draft. HubSpot contact and deal writes and owner assignment were checked against a HubSpot developer test portal on 2026-11-25. Gmail, Slack, Twilio, Google Sheets, and GoHighLevel in this pack are not yet live-tested.";

export const templatePacks: TemplatePack[] = [
  {
    slug: "manager-digest",
    name: "Manager Digest",
    version: "v0.1.2",
    category: "reporting",
    filterTags: ["free"],
    free: true,
    headline:
      "Stop opening the CRM just to find out what slipped. One short message tells you which leads are new, which tasks are overdue, which deals have gone quiet, and where your pipeline stands.",
    summary:
      "A daily or weekly \"what needs attention\" message: new leads (unowned first), overdue tasks, stale deals, and a pipeline snapshot.",
    safety:
      "Read-only. Test mode is the default, and the first live digest is a conscious go-live step.",
    whoFor:
      "Managers and owners of appointment-based businesses who use HubSpot, or track leads in a Google Sheet, and want a morning \"what needs attention\" message.",
    whatItDoes: [
      "New leads from the last day or week, with any that have no owner listed first.",
      "Overdue tasks, oldest first.",
      "Stale deals: open deals with no activity for a number of days you choose.",
      "Pipeline snapshot: how many open deals sit in each stage, and their dollar value.",
      "Optionally, a short plain-English AI briefing at the top (off by default).",
    ],
    workflows: [
      {
        name: "Manager Digest",
        nodes: 27,
        description: "Reads HubSpot and/or a Google Sheet and sends one digest.",
      },
    ],
    totalNodes: 27,
    totalNodesWithNotes: 35,
    defaults: [
      "testMode on: the digest is labeled TEST and goes only to the email or Slack channel you set.",
      "Imported inactive, and the Schedule node is switched off on import.",
      "AI briefing off by default.",
    ],
    testModeWrites:
      "Nothing is written in any mode. The digest is read-only and never changes CRM records or your sheet.",
    included: [
      "One importable n8n workflow (saved inactive)",
      "Plain-English README with a field-by-field Config table, troubleshooting, and privacy notes",
      "Fictional sample leads, deals, tasks, and an example digest",
      "Setup Agent playbook and changelog",
    ],
    guardrails: [
      "Read-only: it does not change CRM records, email or text your clients, or book appointments.",
      "Never invents numbers. If something cannot be read, the digest shows a \"Heads-up\" line instead.",
      "If you turn the AI briefing on and the AI step fails, your normal digest still sends.",
    ],
    hardStop:
      "Run the TEST digest first, compare it with the sample digest, and spot-check a few numbers against HubSpot or your sheet. Going live is your decision: turn test mode off, switch the Schedule on, and set the workflow Active.",
    willNot: [
      "Write to HubSpot or your sheet.",
      "Contact a client.",
      "Invent numbers.",
    ],
    faq: [
      {
        q: "Does it change my CRM or contact my clients?",
        a: "No. It is read-only and only reports to the address or channel you set.",
      },
      {
        q: "Do I need HubSpot?",
        a: "No. You can use a Google Sheet laid out like the samples instead, or both.",
      },
      {
        q: "Does it need an AI account?",
        a: "No. The AI briefing is optional and off by default.",
      },
      {
        q: "Will I get a message just because I imported it?",
        a: "No. The workflow is inactive and the Schedule node is off until you switch them on.",
      },
      {
        q: "How long does setup take?",
        a: "Roughly 30 to 60 minutes if your accounts are ready. That is an estimate, not a guarantee, and it will be confirmed after a live test.",
      },
      {
        q: "What HubSpot permissions does it need?",
        a: "Read access to deals, contacts, owners, and tasks. Exact permission names change over time, so confirm them in HubSpot's current docs.",
      },
      {
        q: "What happens to my data?",
        a: "The digest reads names, stages, owners, dates, and deal amounts and sends them to the address or channel you set. If you turn on the AI briefing, a short summary goes to the AI provider you chose.",
      },
      {
        q: "Has it been tested live?",
        a: "Not yet. It has not been tested against a live HubSpot, Gmail, Slack, or Google account.",
      },
    ],
    testingNote: draftNote("HubSpot, Gmail, Slack, or Google"),
    diagram: true,
    related: ["account-health-onboarding-qa", "hubspot-cleanup-kit"],
  },
  {
    slug: "servicetitan-dispatch-copilot",
    name: "ServiceTitan Dispatch & Capacity Copilot",
    version: "v0.3.0",
    category: "field-service",
    filterTags: ["reporting"],
    badge: "New",
    headline:
      "Read-only dispatch reports for HVAC, plumbing, and electrical shops: which new bookings are missing details, who to call to fill open schedule time, yesterday's dispatch numbers, what happened overnight, and a 15-minute alert when jobs sit in Unassigned or are missing skill or zone tags. Sent to you, never to a customer. Zero board write-back.",
    summary:
      "Booking QA and skill-tier routing flags, a draft callback queue for open capacity, a morning Dispatch KPI digest, an after-hours handoff brief, and an Unassigned-Job Aging Watch for the Operations Manager.",
    safety:
      "Zero board write-back: your dispatcher stays in control. Read-only and owner-only. The callback queue is a draft list for dispatchers, and nothing is ever sent to a customer. Test mode and sample data are the default.",
    whoFor:
      "Operations Managers and owners of HVAC, plumbing, and electrical shops that dispatch in ServiceTitan and want a daily read on thin bookings, open schedule time, and overnight calls.",
    whatItDoes: [
      "Booking QA and skill-tier routing: reviews jobs booked in the last 24 hours and flags missing equipment age or type, commercial vs residential not recorded, repeat addresses, and repair calls on old equipment that may be replacement opportunities. It can suggest a free sales-capable tech. It never reassigns a job.",
      "Open-capacity and unsold-estimate filler: finds open schedule windows and pairs them with customers whose maintenance agreement is overdue or whose estimate has no activity. The result is a draft callback queue for dispatchers.",
      "Morning Dispatch KPI digest: technician utilization, response time on emergency and same-day jobs, open capacity, and unworked estimates for the previous day. If a number cannot be computed, you get a Heads-up line.",
      "After-hours handoff summary: overnight emergency calls in one brief for the 7:00 AM morning shift, with calls that still need action first.",
      "CSV-Fallback Mode for Starter and Essentials: no App Key needed. Email, drop in a folder, or upload one Jobs/Dispatch report and get the same morning digest and aging alert. Common ServiceTitan column headers are matched for you, and anything a single report cannot supply becomes a Heads-up line.",
      "Unassigned-Job Aging Watch: a 15-minute read-only poll that flags jobs sitting in Unassigned past a configurable threshold (default 20 minutes), blank skill tags, missing zone assignments, and multi-tech or multi-day jobs that Dispatch Pro Auto Mode can silently drop or ping-pong. It never writes back to the board.",
    ],
    workflows: [
      {
        name: "ServiceTitan Dispatch & Capacity Copilot",
        nodes: 27,
        description:
          "Reads sample data, a CSV export, or ServiceTitan (read-only), runs the four dispatch workflows, and sends one message to the owner.",
      },
      {
        name: "Unassigned-Job Aging Watch",
        nodes: 20,
        description:
          "A 15-minute read-only poll that alerts the owner about aged Unassigned jobs, blank skill or zone tags, and Auto Mode exclusion risks. Zero board write-back.",
      },
      {
        name: "ServiceTitan CSV-Fallback Triage",
        nodes: 19,
        description:
          "For Starter and Essentials shops with no App Key. Takes one Jobs/Dispatch CSV by email attachment, watch folder, or upload, and sends the owner the same digest and aging alert.",
      },
    ],
    totalNodes: 66,
    totalNodesWithNotes: 86,
    defaults: [
      "testMode on: every message is labeled [TEST] and goes only to the owner email or Slack channel you set.",
      "Source defaults to built-in fictional sample data, so the ServiceTitan steps are skipped.",
      "Imported inactive, and every Schedule, webhook, and email trigger is switched off on import.",
    ],
    testModeWrites:
      "Nothing is written to ServiceTitan in any mode. In test mode the only output is a [TEST] message to the owner address or channel you set.",
    included: [
      "Three importable n8n workflows (saved inactive): the 7:00 AM digest, the 15-minute Unassigned-Job Aging Watch, and the CSV-Fallback Triage for Starter and Essentials",
      "Plain-English README with a field-by-field Config table",
      "Fictional HVAC, plumbing, and electrical sample data (CSV), including a sample Jobs/Dispatch export with ServiceTitan-style headers, plus a sample [TEST] digest and [TEST] aging alert",
      "A test script that checks all three workflows' safety settings and runs their logic against the sample data",
      "Changelog",
    ],
    guardrails: [
      "Zero board write-back: the ServiceTitan steps are GET requests only. It does not create, change, assign, or delete anything in ServiceTitan. Your dispatcher stays in control.",
      "No customer messages: the workflow has no SMS, Twilio, or customer-email step.",
      "The callback queue is draft-only. A dispatcher decides who to call.",
      "Routing is a suggestion. It never reassigns a job.",
      "Never invents numbers. If something cannot be computed, the digest shows a \"Heads-up\" line instead.",
      "The ServiceTitan endpoint paths and field mapping are unverified. The CSV export path is the recommended way to start.",
    ],
    hardStop:
      "Run the [TEST] digest on the sample data, then on your own CSV export, and spot-check several numbers by hand against ServiceTitan. Going live is the owner's decision: turn test mode off, switch the Schedule on, and set the workflow Active, after a written sign-off.",
    willNot: [
      "Text, call, or email a customer.",
      "Create, change, assign, or delete anything in ServiceTitan.",
      "Reassign a job or book a callback for you.",
      "Invent numbers.",
    ],
    faq: [
      {
        q: "Does it contact my customers?",
        a: "No. It has no step that can message a customer. The callback queue is an internal list for your dispatchers, and the only things it sends are one message to your own email and/or Slack.",
      },
      {
        q: "Does it change anything in ServiceTitan?",
        a: "No. It only reads. The live path uses GET requests, and the CSV path only reads files.",
      },
      {
        q: "Do I need ServiceTitan API access?",
        a: "Not to start, and not on every plan. Shops on The Works or Enterprise can connect live with GET-only Customer-Built App Keys (nothing is written back). Starter and Essentials shops use CSV-Fallback Mode instead: no App Key, just email or upload a Jobs/Dispatch report export and get the same digest and aging alert. The live endpoint paths and field mapping are still unverified, so the CSV path is the recommended way to start.",
      },
      {
        q: "Will I get a message just because I imported it?",
        a: "No. The workflow is inactive and the Schedule node is off until you switch them on.",
      },
      {
        q: "Is there a pilot?",
        a: "A 10-Day Founding Client Pilot is planned for this pack. Use the Book a 15-min ops audit button on this page to talk it through. Pricing coming soon.",
      },
      {
        q: "Has it been tested live?",
        a: "Not yet. It has only been checked against fictional sample data. It has not been tested against a live ServiceTitan, Gmail, or Slack account.",
      },
    ],
    testingNote: draftNote("ServiceTitan, Gmail, Slack, or a CSV export"),
    diagram: true,
    related: ["manager-digest", "jobber-connector", "jobber-morning-ops-copilot"],
    callouts: [
      {
        title: "Why Read-Only (Zero Board Write-Back)",
        body: "Your dispatcher stays 100% in control. This copilot only reads the board and sends you alerts and digests. It never creates, moves, or deletes a job. That is the opposite of Dispatch Pro Auto Mode, which can reshuffle the board every 10 minutes and ping-pong jobs, and of autonomous voice and booking tools that write jobs onto the board for you.",
      },
      {
        title: "Works on Every ServiceTitan Tier",
        body: "You do not need a Marketplace app to start. Pick the path that matches your ServiceTitan plan.",
        items: [
          {
            heading: "The Works / Enterprise",
            body: "Live, GET-only connection with your Customer-Built App Keys. Nothing is written back to the board.",
          },
          {
            heading: "Starter / Essentials",
            body: "CSV-Fallback Mode: email, upload, or drop in a folder one Jobs/Dispatch report export and get the same digest and aging alert. No API key required, and common ServiceTitan column headers are matched for you.",
          },
        ],
      },
    ],
  },
  {
    slug: "jobber-morning-ops-copilot",
    name: "Jobber Morning Ops Triage Copilot",
    version: "v0.1.0",
    category: "field-service",
    filterTags: ["reporting"],
    badge: "New",
    headline:
      "One read-only morning digest for lawn, landscaping, cleaning, pest, handyman, pressure washing, HVAC, plumbing, and electrical shops that run on Jobber: which jobs are unscheduled, late, or need action, which finished jobs still need an invoice, which invoices are past due, and which big quotes are still waiting on an answer past your configured Jobber follow-up cutoff. Sent to you, never to a customer. Zero write-back.",
    summary:
      "Unscheduled, Late, and Action Required jobs, Requires Invoicing jobs and past-due invoices, and high-value quotes still awaiting a response, ranked by dollar value for a human call. A weekday-morning digest for the owner or office manager, with a CSV fallback using the reports available on your Jobber plan.",
    safety:
      "Zero write-back: nothing is created, changed, or sent in Jobber. Read-only and owner-only. The stalled-quote list is for a person to call, and nothing is ever sent to a customer. Test mode and sample data are the default.",
    whoFor:
      "Owners and office managers of home-service shops that schedule and invoice in Jobber and spend the first part of the day hunting through separate reports for what needs attention.",
    whatItDoes: [
      "Unscheduled, Late, and Action Required jobs: one list of the jobs Jobber already marks with those statuses, plus jobs that have a visit with no date. Late jobs show how long ago the visit was due to end. Nothing is rescheduled.",
      "Requires Invoicing and past-due invoices: finished jobs that still need an invoice, oldest first, and invoices that are past their due date, largest balance first. You set how many days past due counts.",
      "Stalled high-value quotes: quotes still awaiting a response past the cutoff you set after your last Jobber follow-up, using the actual send date, ranked by dollar value. It is a list for a human call or a personal note. It never sends another automated reminder.",
      "CSV-Fallback: email, drop in a folder, or upload your Jobs, Invoices, and Quotes report exports and get the same digest. No OAuth and no App Review. Common Jobber column names are matched for you, and anything a report cannot supply becomes a Heads-up line.",
      "Heads-up lines instead of guesses: if a total, due date, or send date is missing, or a report was not supplied, the digest says so. It does not estimate.",
    ],
    workflows: [
      {
        name: "Jobber Morning Ops Triage Copilot",
        nodes: 21,
        description:
          "Reads sample data, a CSV export, or Jobber (read-only GraphQL queries), builds the three morning queues, and sends one message to the owner.",
      },
      {
        name: "Jobber CSV-Fallback Triage",
        nodes: 18,
        description:
          "Uses CSV exports without OAuth. Takes your Jobs, Invoices, and Quotes CSV reports by email attachment, watch folder, or upload, and sends the owner the same digest.",
      },
    ],
    totalNodes: 39,
    totalNodesWithNotes: 52,
    defaults: [
      "testMode on: every message is labeled [TEST] and goes only to the owner email or Slack channel you set.",
      "Source defaults to built-in fictional sample data, so the Jobber steps are skipped.",
      "Imported inactive, and every Schedule, webhook, and email trigger is switched off on import.",
    ],
    testModeWrites:
      "Nothing is written to Jobber in any mode. In test mode the only output is a [TEST] message to the owner address or channel you set.",
    included: [
      "Two importable n8n workflows (saved inactive): the 7:00 AM Jobber digest and the CSV-Fallback Triage",
      "Plain-English README with a field-by-field Config table and a list of which Jobber fields are unverified",
      "Fictional lawn, HVAC, and plumbing sample data: sample Jobs, Invoices, and Quotes CSV exports with Jobber-style headers, a mock GraphQL response, and a sample [TEST] digest",
      "A test script that checks both workflows' safety settings and runs their logic against the sample data",
      "Changelog",
    ],
    guardrails: [
      "Zero write-back: the Jobber steps send read-only GraphQL queries and nothing else. GraphQL travels over HTTP POST, but there is no mutation in the workflow, so nothing is created, changed, or deleted in Jobber.",
      "No customer messages: the workflow has no SMS, Twilio, or customer-email step. It does not send quote reminders, invoice reminders, review requests, or On-My-Way texts.",
      "The stalled-quote list is for a human. A person decides who to call.",
      "Owner-only: the email address and Slack channel come from the Config node, never from a row in a file you upload.",
      "Never invents numbers. If something cannot be computed, the digest shows a \"Heads-up\" line instead.",
      "The complete Jobber GraphQL queries still need verification against a live account. The CSV export path is the recommended way to start.",
    ],
    hardStop:
      "Run the [TEST] digest on the sample data, then on your own CSV exports, and spot-check several numbers by hand against Jobber. Going live is the owner's decision: turn test mode off, switch the Schedule on, and set the workflow Active, after a written sign-off.",
    willNot: [
      "Text, call, or email a customer.",
      "Create, change, schedule, or delete anything in Jobber.",
      "Send quote or invoice reminders, review requests, or On-My-Way texts.",
      "Invent numbers.",
    ],
    faq: [
      {
        q: "Does it contact my customers?",
        a: "No. It has no step that can message a customer. The quote list is an internal list for you or your office manager to call from, and the only things it sends are one message to your own email and/or Slack.",
      },
      {
        q: "Does it change anything in Jobber?",
        a: "No. The live path sends read-only GraphQL queries, and the CSV path only reads files.",
      },
      {
        q: "How is this different from Jobber's own quote and invoice follow-ups?",
        a: "On supported plans, Jobber can send up to two quote follow-ups. This owner digest ranks quotes still awaiting a response past the cutoff you set.",
      },
      {
        q: "Is this the same pack as Jobber Connector?",
        a: "No. Jobber Connector drafts follow-ups for you to approve. This pack is a read-only morning digest and drafts nothing for customers.",
      },
      {
        q: "Do I need a particular Jobber plan or API access?",
        a: "Not to start. The CSV-Fallback path uses Jobber report exports without OAuth or App Review. Available reports and columns depend on your plan and permissions. The live GraphQL path needs your own Jobber developer app, and a Draft app can connect to at most 5 paying accounts until Jobber approves it. The complete GraphQL queries still need a live Jobber test, so the CSV path is the recommended way to start.",
      },
      {
        q: "Will I get a message just because I imported it?",
        a: "No. The workflow is inactive and the Schedule node is off until you switch them on.",
      },
      {
        q: "Is there a pilot?",
        a: "A pilot is planned for this pack. Use the Book a 15-min ops audit button on this page to talk it through. Pricing coming soon.",
      },
      {
        q: "Has it been tested live?",
        a: "Not yet. It has only been checked against fictional sample data. It has not been tested against a live Jobber, Gmail, or Slack account.",
      },
    ],
    testingNote: draftNote("Jobber, Gmail, Slack, or a CSV export"),
    related: ["servicetitan-dispatch-copilot", "jobber-connector", "manager-digest"],
    callouts: [
      {
        title: "Why Read-Only",
        body: "Your dispatcher stays in control. This copilot only reads your Jobber reports and sends you a digest. It never schedules, reschedules, or deletes a job, and it never messages a customer. It ranks unanswered quotes past your configured follow-up cutoff so a person can call.",
      },
      {
        title: "Choose How to Connect Jobber",
        body: "Start with the reports and columns available on your plan.",
        items: [
          {
            heading: "OAuth Draft app / App Review",
            body: "A live, read-only connection through Jobber's GraphQL API with your own developer app. A Draft app can connect to up to 5 paying accounts until Jobber approves it. The complete GraphQL queries still need a live Jobber test.",
          },
          {
            heading: "CSV fallback (recommended start)",
            body: "Email, upload, or drop in a folder your Jobs, Invoices, and Quotes report exports and get the same digest. This path uses CSV exports without OAuth or App Review. Common Jobber column names are matched for you.",
          },
        ],
      },
    ],
  },
  {
    slug: "speed-to-lead",
    name: "Speed to Lead (with Form-to-CRM)",
    version: "v0.1.3",
    category: "lead-response",
    filterTags: [],
    headline:
      "A new lead fills out your form. It is saved once in your CRM, you are alerted, and the lead can get a short first reply, with follow-ups that stop the moment they answer or opt out.",
    summary:
      "Form or lead in, CRM upsert, owner alert, and a fast first reply with follow-ups that respect consent, quiet hours, and STOP.",
    safety:
      "Test mode is the default, with a hard stop before the first live message to a real lead.",
    whoFor:
      "Managers and owners of appointment-based businesses who use HubSpot (or GoHighLevel, or Google Sheets) and want fast, consistent first contact.",
    whatItDoes: [
      "Cleans up and checks the lead (name, email, phone, source, message, consent).",
      "Saves one contact: finds an existing HubSpot contact by email, then phone, and updates it, or creates it. Optionally one deal for a new contact, a Google Sheets row, and/or a GoHighLevel contact.",
      "Optionally assigns a HubSpot owner. An existing owner is never overwritten.",
      "Alerts you by email and/or Slack.",
      "Replies to the lead by email, text, or both, when you allow it.",
      "Follows up up to three times (default 1 hour, 24 hours, 72 hours). Each follow-up stops if the lead replied or opted out.",
    ],
    workflows: [
      {
        name: "Speed to Lead",
        nodes: 59,
        description: "One workflow with the Form-to-CRM module and the reply module.",
      },
    ],
    totalNodes: 59,
    totalNodesWithNotes: 69,
    defaults: [
      "testMode on: the lead is never messaged. You get a [TEST] New lead alert and a [TEST] Held reply preview.",
      "Send nodes refuse a second time as a guard.",
      "Imported inactive.",
    ],
    testModeWrites:
      "Yes: in test mode the CRM write is real. One new or updated contact is still saved, so use your own test contact, not a customer.",
    included: [
      "One importable n8n workflow (saved inactive)",
      "Plain-English README with a field-by-field Config table",
      "Fictional sample leads, example messages, and an example sheet",
      "Setup Agent playbook and changelog",
    ],
    guardrails: [
      "Consent check: no text unless the form says the lead agreed. A blocked send alerts you.",
      "Opt-out handling: STOP, UNSUBSCRIBE, QUIT, CANCEL, or END stops texts and the follow-up sequence for that number.",
      "Quiet hours (default 21:00 to 08:00): lead messages are held until they end, not skipped.",
      "One contact per lead. Re-running the same email updates; it does not duplicate.",
      "If a required field is missing, nothing is written, you get an error alert, and the lead is not messaged.",
    ],
    hardStop:
      "No real lead receives a real email or text until you have a clean test in test mode, a reviewer check on done-with-you installs, and a staged live test with your own email and phone (real message, follow-up timing, a reply stopping the sequence, and STOP).",
    willNot: [
      "Edit your CRM in bulk, update existing deals, or delete anything.",
      "Register your texting campaign. Texting US mobile numbers needs your own A2P 10DLC registration.",
      "Give legal advice. Consent, opt-out wording, email footer, quiet hours, and registration are yours.",
      "Message a lead while test mode is on.",
    ],
    faq: [
      {
        q: "Will it text or email leads the moment I import it?",
        a: "No. It imports inactive with test mode on, so leads are never messaged until you turn it off.",
      },
      {
        q: "Does it need a CRM?",
        a: "No. HubSpot, GoHighLevel, and Google Sheets are options. For a sheet-only version with no CRM at all, see the Sheets-only variants.",
      },
      {
        q: "Can it message people who did not agree?",
        a: "Not by default. Texts need consent from the form, and STOP stops the sequence. Your own consent policy and legal obligations remain yours.",
      },
      {
        q: "Do I need Twilio?",
        a: "Only if you want to text. Email-only works without it. Texting US numbers needs your own A2P 10DLC registration.",
      },
      {
        q: "Does n8n need to stay running?",
        a: "Yes. Follow-up waits only fire while the workflow is Active on a running n8n, so use n8n Cloud or a self-hosted n8n that runs all the time.",
      },
      {
        q: "Has it been tested?",
        a: "HubSpot contact and deal writes and owner assignment were tested against a HubSpot developer test portal on 2026-11-25. Gmail, Slack, Twilio, Google Sheets, and GoHighLevel have not been live-tested.",
      },
      {
        q: "Does it promise more booked jobs?",
        a: "No. No results, testimonials, or customer counts are claimed.",
      },
    ],
    testingNote: stlFormNote,
    diagram: true,
    related: ["form-to-crm", "sheets-variants"],
  },
  {
    slug: "booking-no-show",
    name: "Booking, Reminders and No-Show Recovery",
    version: "v0.1.0",
    category: "booking-service",
    filterTags: [],
    headline:
      "Confirm bookings, remind customers, and follow up once on a missed appointment, with everything stopping the moment a customer cancels, reschedules, or opts out.",
    summary:
      "Booking confirmation, 24-hour and 2-hour reminders, reschedule and cancel links, one no-show win-back, and owner alerts.",
    safety:
      "Test mode is the default, with a hard stop before the first live message to a real customer.",
    whoFor:
      "Managers and owners of appointment-based businesses who take bookings online (Calendly by default, or Google Calendar).",
    whatItDoes: [
      "Cleans up the booking. If something required is missing, you get an error alert and the customer is not messaged.",
      "Optionally logs one HubSpot contact and/or one Google Sheets row per event (off by default).",
      "Alerts you by email and/or Slack.",
      "Confirms to the customer by email, text, or both, when you allow it.",
      "Sends reminders (default 24 hours and 2 hours before). Each stops if the booking was canceled or rescheduled, marked showed or no-show, or the customer texted STOP.",
      "Records a no-show (marked by you by default) and sends one win-back message with a reschedule link.",
      "Handles cancels: alerts you, skips remaining reminders, sends no win-back.",
    ],
    workflows: [
      {
        name: "Booking, Reminders and No-Show Recovery",
        nodes: 62,
        description: "Confirmation, reminders, no-show win-back, and cancel handling.",
      },
    ],
    totalNodes: 62,
    totalNodesWithNotes: 72,
    defaults: [
      "testMode on: the customer is never messaged. You get a [TEST] New booking alert and [TEST] held message previews.",
      "Imported inactive. Importing does not open your webhooks to live traffic.",
      "No-shows are marked by you by default.",
    ],
    testModeWrites:
      "Only if you turn on logging: the HubSpot contact or sheet row is written even in test mode. Use a test contact.",
    included: [
      "One importable n8n workflow (saved inactive)",
      "Plain-English README with a field-by-field Config table",
      "Fictional sample bookings, example messages, and an example sheet",
      "Setup Agent playbook and changelog",
    ],
    guardrails: [
      "Consent check: no text unless the booking carries SMS consent. With no consent question on your booking form, no texts go out.",
      "Opt-out handling: STOP and similar replies stop texts and that customer's remaining reminders and win-back.",
      "Quiet hours (default 21:00 to 08:00): customer messages are held until they end, not skipped.",
      "Duplicate deliveries of the same booking are ignored in Active runs.",
      "The no-show / showed call needs a token you set, and webhook paths ship ending in CHANGE-ME for you to replace.",
    ],
    hardStop:
      "No first live email or text to a real customer until a clean test in test mode, a reviewer check on done-with-you installs, and a staged live test with a booking of your own (real confirmation, reminder timing, a cancel stopping the reminders, and STOP).",
    willNot: [
      "Edit your CRM in bulk (one contact and/or one sheet row per event).",
      "Register your texting campaign. US texting needs your own A2P 10DLC registration.",
      "Give legal advice. Consent, opt-out wording, footer, quiet hours, and registration are yours.",
      "Take inbound calls, or message a customer while test mode is on.",
    ],
    faq: [
      {
        q: "Does it know when someone no-shows?",
        a: "Not on its own. By default you mark a no-show. An optional automatic mode exists, but it can send win-back messages to people who did show up if you do not mark attendance.",
      },
      {
        q: "What happens if the customer cancels or reschedules?",
        a: "Remaining reminders stop. A rescheduled booking arrives as a new booking and gets its own confirmation and reminders.",
      },
      {
        q: "Can I use email only?",
        a: "Yes. Twilio is optional.",
      },
      {
        q: "Will it text customers who haven't agreed?",
        a: "Not by default. Without a consent question on your booking form, no texts go out.",
      },
      {
        q: "Do I need HubSpot?",
        a: "No. Logging to HubSpot or a sheet is optional and off by default.",
      },
      {
        q: "Has it been tested live?",
        a: "No. It has not been tested against a live Calendly, Google Calendar, Gmail, Slack, Twilio, HubSpot, or Google Sheets account.",
      },
    ],
    testingNote: draftNote(
      "Calendly, Google Calendar, Gmail, Slack, Twilio, HubSpot, or Google Sheets",
    ),
    diagram: true,
    related: ["sheets-variants", "speed-to-lead"],
  },
  {
    slug: "invoice-sync",
    name: "Closed-Won Invoice Sync",
    version: "v0.1.0",
    category: "billing",
    filterTags: [],
    headline:
      "When a HubSpot deal is marked Closed Won, the invoice is prepared for you in QuickBooks, Stripe, or Xero: one deal, one invoice, unsent, with the details written back to the deal.",
    summary:
      "HubSpot closed-won deal to a draft, unsent invoice in QuickBooks Online, Stripe, or Xero. Idempotent, with owner alerts.",
    safety:
      "Test mode is the default, invoices stay draft and unsent, and there is a hard stop before the first live invoice send.",
    whoFor:
      "Managers and owners who invoice from closed-won deals in HubSpot and keep their books in QuickBooks Online (the default), Stripe, or Xero.",
    whatItDoes: [
      "Cleans up the deal. If the amount is missing or zero, or there is no customer email and no name, you get an error alert and no invoice is created.",
      "Checks the deal was not already invoiced, in HubSpot and in your accounting system. If the check itself fails, no invoice is created.",
      "Finds or creates the one customer in your accounting system.",
      "Creates the invoice unsent: a draft in Stripe, DRAFT status in Xero, created but not emailed in QuickBooks Online.",
      "Writes the invoice id, number, status, and link back to that one HubSpot deal.",
      "Alerts you by email and/or Slack on success, \"already invoiced\", and errors.",
    ],
    workflows: [
      {
        name: "Closed-Won Invoice Sync",
        nodes: 70,
        description: "Deal cleanup, duplicate check, customer and invoice creation, write-back, and alerts.",
      },
    ],
    totalNodes: 70,
    totalNodesWithNotes: 80,
    defaults: [
      "testMode on: no invoice created, none emailed, HubSpot not written. You get a [TEST] Invoice Sync PREVIEW.",
      "sendInvoiceToCustomer off: turning test mode off does not send anything to customers.",
      "Imported inactive, with the HubSpot trigger and webhook fallback saved disabled.",
    ],
    testModeWrites:
      "No. In test mode the workflow only reads HubSpot and your accounting system.",
    included: [
      "One importable n8n workflow (saved inactive, triggers disabled)",
      "Plain-English README with Config table, known gaps, and troubleshooting",
      "Fictional closed-won deals in seven scenarios, and the messages to expect",
      "Setup Agent playbook and changelog",
    ],
    guardrails: [
      "Three separate gates (create, send, HubSpot write-back) each re-check test mode. Sample deals are blocked from live actions even if test mode is off.",
      "One deal, one invoice. No bulk edits. Stripe requests carry an idempotency key.",
      "Only the owner is emailed by default. Customer emails come only from nodes named SEND, behind their own gate.",
      "If something fails, the alert says what was and was not written. It does not retry creating an invoice on its own.",
      "Unfinished settings create nothing: anything still unset is listed in the preview, and a live run creates nothing until it is filled in.",
    ],
    hardStop:
      "Never send the first live invoice to a real customer until a clean test, a reviewer check on done-with-you installs, and a staged live test in a sandbox (QuickBooks sandbox, Stripe test mode, Xero demo company) with sending still off. Then send to one known customer first.",
    willNot: [
      "Email an invoice by default, or touch anything while test mode is on.",
      "Change your CRM or books in bulk.",
      "Give tax, legal, or accounting advice. Sales tax and invoice requirements are yours; check with your accountant.",
      "Send Xero invoices. They stay DRAFT and you approve and send them in Xero yourself.",
    ],
    faq: [
      {
        q: "Will it email my customers an invoice?",
        a: "Not unless you turn on sendInvoiceToCustomer yourself. It defaults to off, and turning test mode off alone does not send.",
      },
      {
        q: "Which accounting tools does it support?",
        a: "QuickBooks Online (default), Stripe, or Xero. Pick one.",
      },
      {
        q: "Can one deal create two invoices?",
        a: "The pack checks the deal and your accounting system first and creates nothing if it finds one. If the check itself fails, it creates nothing.",
      },
      {
        q: "What if my deal has no amount?",
        a: "You get an error alert and no invoice is created.",
      },
      {
        q: "Does it work with taxes?",
        a: "It can pass an optional tax code you provide, but gives no tax advice.",
      },
      {
        q: "Has it been tested live?",
        a: "No. It was checked as importable JSON and by running its logic locally on fictional sample deals.",
      },
    ],
    testingNote: draftNote("HubSpot, QuickBooks, Stripe, Xero, Gmail, or Slack"),
    diagram: true,
  },
  {
    slug: "hubspot-cleanup-kit",
    name: "HubSpot Cleanup Kit",
    version: "v0.1.0",
    category: "crm-hygiene",
    filterTags: [],
    headline:
      "See the mess before you touch it. A read-only audit tells you what is wrong in HubSpot; a separate, locked fix workflow changes only the rows you approve, a few at a time, after a backup.",
    summary:
      "Audit first: a read-only report and a proposed-changes file. An optional fix applies only approved rows, backs up first, and never deletes.",
    safety:
      "A human approves every change, and dry-run is the default.",
    whoFor:
      "Managers and owners with a messy HubSpot who want to see the problems first and fix a little at a time under their own control.",
    whatItDoes: [
      "Audit (read-only) finds duplicate contacts and companies, missing key fields, bad emails, phones and states, orphans, stale and ownerless deals, and lifecycle mismatches.",
      "Gives you a plain-English review and a proposed-changes file, one row per suggestion.",
      "Optional fix workflow (separate file) applies only rows you marked approved: locked, dry-run first, backup before any write, one record at a time.",
    ],
    workflows: [
      {
        name: "Audit",
        nodes: 27,
        description: "Read-only. Contains no create, update, merge, archive, or delete step.",
      },
      {
        name: "Fix",
        nodes: 38,
        description: "Optional. Locked and dry-run by default; approved rows only.",
      },
    ],
    totalNodes: 65,
    totalNodesWithNotes: 81,
    defaults: [
      "Audit starts with testMode on and the fictional sample as its data source: HubSpot is never contacted.",
      "Fix starts locked: testMode on, dryRun on, applyApprovedChanges off, sample input. Sample rows can never write.",
      "Both workflows import inactive; the audit's optional schedule is saved disabled.",
    ],
    testModeWrites:
      "No. The audit cannot write in any mode, and the fix writes nothing until every live switch is set and a backup is saved.",
    included: [
      "Two importable n8n workflows: read-only audit and optional fix",
      "Printable buyer checklist",
      "Plain-English README with Config tables for both workflows",
      "Fictional contacts, companies, deals, a sample audit report, sample proposed changes, and a sample backup",
      "Setup Agent playbook and changelog",
    ],
    guardrails: [
      "Approved rows only: the approved column starts blank, and only yes or true is acted on. Nothing is approved for you.",
      "Backup first: no write until the affected records are read from HubSpot and saved to your Google Sheet.",
      "Capped runs: at most 25 approved rows per run by default, with a pause between writes. Failed rows are recorded, never retried automatically.",
      "Allow-listed fields: updates can only touch the properties listed in Config.",
      "Treat every merge as permanent. Archive moves to HubSpot's recycling bin; it is not a permanent delete.",
    ],
    hardStop:
      "A live apply needs all of: test mode off, dry-run off, apply switch on, input from your sheet, at least one approved valid row, and a saved backup. You flip these yourself. Start with one or two rows, then stop and look at HubSpot.",
    willNot: [
      "Delete anything. There is no delete step, and a row that asks for one is refused.",
      "Change HubSpot from the audit, in any mode.",
      "Apply a row nobody approved, or run a bulk change on its own.",
      "Give legal advice.",
    ],
    faq: [
      {
        q: "Can the audit break anything?",
        a: "No. The audit workflow has no step that can change HubSpot.",
      },
      {
        q: "Does it delete records?",
        a: "No. There is no delete step. The fix can archive (recycling bin) or merge only if you approve that row.",
      },
      {
        q: "Can I undo a merge?",
        a: "Treat merges as permanent. Confirm HubSpot's current rules for reversing a merge before you approve one.",
      },
      {
        q: "Do I have to use the fix workflow?",
        a: "No. The audit and its review are useful on their own, and many findings are review-only.",
      },
      {
        q: "Why a Google Sheet?",
        a: "It is where you approve rows and where the backup is saved. A live apply requires the backup to be saved there.",
      },
      {
        q: "Has it been tested live?",
        a: "No. It was checked as importable JSON and with fictional records and mocked responses.",
      },
    ],
    testingNote: draftNote("HubSpot, Gmail, Slack, or Google Sheets"),
    related: ["crm-migration-kit", "account-health-onboarding-qa"],
  },
  {
    slug: "sheets-variants",
    name: "Google Sheets-only Variants",
    version: "v0.1.0",
    category: "lead-response",
    filterTags: ["booking-service"],
    headline:
      "Fast replies to new leads, and reminders for appointments, with a Google Sheet as your record and no CRM to buy or learn.",
    summary:
      "Speed to Lead and Booking / No-Show running on Google Sheets only. No HubSpot, no GoHighLevel, no other CRM.",
    safety:
      "Test mode is the default, with a hard stop before the first live message.",
    whoFor:
      "Managers and owners who keep leads or bookings in a Google Sheet, do not use a CRM, and are happy to review rows by eye.",
    whatItDoes: [
      "Speed to Lead (Sheets): matches a new lead by email, then phone, updates or adds one row, alerts you, and sends a first reply and up to three follow-ups that stop on reply or STOP.",
      "Booking / No-Show (Sheets): one row per booking, confirmation, 24-hour and 2-hour reminders, reschedule and cancel links, one no-show win-back, and owner alerts.",
      "Customer-message behavior (consent, quiet hours, STOP, reminders, win-back) matches the CRM packs; only where the record is kept differs.",
    ],
    workflows: [
      {
        name: "Speed to Lead, Sheets-only",
        nodes: 50,
        description: "Lead in, sheet row updated or added, owner alert, first reply and follow-ups.",
      },
      {
        name: "Booking / No-Show, Sheets-only",
        nodes: 61,
        description: "Confirmation, reminders, no-show win-back, one sheet row per booking.",
      },
    ],
    totalNodes: 111,
    totalNodesWithNotes: 131,
    kitNote:
      "Two separate workflows with separate sheets. Install one at a time.",
    defaults: [
      "testMode on: the lead or customer is never messaged, and long waits are not entered. You get [TEST] previews.",
      "Send nodes refuse a second time as a guard.",
      "Imported inactive.",
    ],
    testModeWrites:
      "Yes: the Google Sheet is still written in test mode (the test_mode column says TRUE). Always use a test copy of your sheet first.",
    included: [
      "Two importable n8n workflows (saved inactive)",
      "A README for each with the exact sheet header row and Config table",
      "Fictional sample leads, bookings, messages, and example sheets",
      "A shared README on which to pick, a Setup Agent playbook (Part A and Part B), and changelog",
    ],
    guardrails: [
      "Consent check, STOP / opt-out handling, and quiet hours (held until they end, not skipped), same as the CRM packs.",
      "If the lead sheet cannot be read or saved, the lead is not messaged and no follow-ups start; you get an alert.",
      "Booking variant: webhook paths ship ending in CHANGE-ME, and the no-show / showed call needs a token you set.",
    ],
    hardStop:
      "No first live email or text to a real lead or customer until a clean test, a reviewer check on done-with-you installs, and a staged live test with your own email, phone, and consent. Then you set test mode off yourself and sign the go-live checklist.",
    willNot: [
      "Talk to any CRM, edit your sheet in bulk, or delete rows.",
      "Register your texting campaign. US texting needs your own A2P 10DLC registration.",
      "Give legal advice. Consent, opt-out wording, email footer, quiet hours, and registration are yours.",
      "Take inbound calls, or message anyone while test mode is on.",
    ],
    faq: [
      {
        q: "Do I need a CRM?",
        a: "No. That is the point of these variants. Your Google Sheet is the record.",
      },
      {
        q: "Which one should I pick?",
        a: "Pick a Sheets-only variant if your leads or bookings live in a spreadsheet today and you do not use a CRM. Pick the CRM packs (Speed to Lead, Booking / No-Show) if you already use HubSpot and want contacts created or updated there.",
      },
      {
        q: "Can I use both variants?",
        a: "They are separate workflows with separate sheets. Install one at a time.",
      },
      {
        q: "Does test mode write to my sheet?",
        a: "Yes. The sheet is written in test mode (test_mode = TRUE), so use a test copy.",
      },
      {
        q: "Will it text leads who did not agree?",
        a: "Not by default. Texts need consent, and STOP stops the sequence. Your own consent policy remains yours.",
      },
      {
        q: "Do I need Twilio?",
        a: "Only for texting. Email-only works without it.",
      },
      {
        q: "Does it know about no-shows?",
        a: "The booking variant relies on you marking a no-show by default. An optional automatic mode can message people who did show up if you do not mark attendance.",
      },
      {
        q: "Has it been tested live?",
        a: "No, for either variant.",
      },
    ],
    testingNote: draftNote(
      "Gmail, Slack, Twilio, Calendly, Google Calendar, or Google Sheets",
    ),
    related: ["speed-to-lead", "booking-no-show"],
  },
  {
    slug: "form-to-crm",
    name: "Form to CRM",
    version: "v0.1.3",
    category: "lead-capture",
    filterTags: ["lead-response"],
    headline:
      "Every web-form lead lands in your CRM exactly once, with no duplicates, and you are told when something is missing or a save fails. It never contacts the lead.",
    summary:
      "Form webhook, dedupe and upsert to HubSpot (optionally GoHighLevel or Sheets), plus owner and error alerts. No lead messaging.",
    safety:
      "Test mode is the default, with a hard stop before the first live CRM write to a real lead.",
    whoFor:
      "Managers and owners who want web-form leads logged cleanly and want to be told when something goes wrong.",
    whatItDoes: [
      "Cleans up the name, email, phone, source, message, and consent box.",
      "Checks required fields. If something is missing, nothing is written and you get an error alert.",
      "Finds or creates one contact in HubSpot (email, then phone). Optionally one deal for a new contact, a GoHighLevel contact, and/or a Google Sheet row.",
      "Optionally assigns a HubSpot owner. An existing different owner is kept, never overwritten.",
      "Alerts you by email and/or Slack when a lead is saved, and again if a CRM write fails.",
    ],
    workflows: [
      {
        name: "Form to CRM",
        nodes: 36,
        description: "Form webhook, field checks, dedupe and upsert, owner assignment, alerts.",
      },
    ],
    totalNodes: 36,
    totalNodesWithNotes: 42,
    defaults: [
      "testMode on and liveWriteApproved off: a live write needs both flipped. Otherwise you get a [TEST] write preview only.",
      "A second guard in each write step repeats the test mode check.",
      "Imported inactive.",
    ],
    testModeWrites:
      "No. In test mode nothing appears in HubSpot, GoHighLevel, or your sheet.",
    included: [
      "One importable n8n workflow (saved inactive)",
      "Plain-English README with a field-by-field Config table",
      "Fictional sample leads, example owner alerts, and an example sheet",
      "Setup Agent playbook and changelog",
    ],
    guardrails: [
      "Two switches for any write, plus a second guard inside each write step.",
      "One contact per lead. Re-running the same lead updates it; it does not duplicate.",
      "Never messages the lead. First replies and follow-ups live in the separate Speed to Lead pack.",
    ],
    hardStop:
      "No first live write to a real lead until a clean test-mode run, a staged test against a TEST HubSpot portal or TEST sheet, and a reviewer check on done-with-you installs. Pointing the workflow at your real CRM and real form is your decision.",
    willNot: [
      "Message the lead, in any mode.",
      "Edit your CRM in bulk, delete anything, merge contacts, or touch existing deals.",
      "Retry a failed write automatically.",
      "Give legal advice. Follow your own privacy policy for the data it handles.",
    ],
    faq: [
      {
        q: "Does it email or text my leads?",
        a: "No. This pack never messages the lead. For a fast first reply and follow-ups, see Speed to Lead.",
      },
      {
        q: "Will it create duplicates?",
        a: "It searches by email, then phone, and updates the match. Re-running the same lead updates it.",
      },
      {
        q: "Do I need HubSpot?",
        a: "No. GoHighLevel and a Google Sheet are options, but HubSpot is the default and the part that has been tested on a test portal.",
      },
      {
        q: "What happens if a field is missing?",
        a: "Nothing is written and you get a missing-required-info alert.",
      },
      {
        q: "Has it been tested live?",
        a: "HubSpot contact and deal writes and owner assignment were tested on a developer test portal on 2026-11-25. Gmail, Slack, Google Sheets, and GoHighLevel were not.",
      },
    ],
    testingNote: stlFormNote,
    related: ["speed-to-lead", "sheets-variants"],
  },
  {
    slug: "jobber-connector",
    name: "Jobber Connector",
    version: "v0.1.0",
    category: "field-service",
    filterTags: [],
    headline:
      "Follow up on every new Jobber request and quote, and close the loop on finished jobs with a drafted invoice reminder for you to approve.",
    summary:
      "New request and quote follow-up, plus job-completed invoice reminder and optional review request. Jobber GraphQL via HTTP Request; optional HubSpot or Sheets log.",
    safety:
      "Test mode is the default, with a hard stop before any live customer message or write.",
    whoFor:
      "Managers at home-services businesses that schedule and invoice in Jobber and use n8n.",
    whatItDoes: [
      "New request follow-up: checks the request, optionally logs it, alerts you, and prepares a follow-up to the customer after a delay (default 24 hours).",
      "Job completed follow-up: checks the job, optionally logs it, alerts you, drafts an unpaid-invoice reminder for you, and can send a review request later if you switch it on.",
      "If a required field is missing you get an alert and the customer gets nothing.",
    ],
    workflows: [
      {
        name: "New request follow-up",
        nodes: 37,
        description: "New Jobber request or quote to owner alert and a held follow-up.",
      },
      {
        name: "Job completed follow-up",
        nodes: 35,
        description: "Completed job to owner alert, drafted invoice reminder, optional review request.",
      },
    ],
    totalNodes: 72,
    totalNodesWithNotes: 87,
    kitNote:
      "n8n has no official Jobber node, so the pack uses the HTTP Request node against Jobber's GraphQL API. Jobber's API details must be verified with your own Jobber test account.",
    defaults: [
      "testMode on: no customer messages, no live writes, no long waits. You get [TEST] owner previews.",
      "Extra live switches all off by default: liveSendApproved, allowLiveWrites, sendInvoiceReminder, sendReviewRequest.",
      "Imported inactive.",
    ],
    testModeWrites:
      "No. In test mode nothing is written; the owner alert says what would be.",
    included: [
      "Two importable n8n workflows (saved inactive, test mode on)",
      "Plain-English README, Config table, and the list of Jobber API details still to verify",
      "Fictional sample requests, jobs, messages, and a log sheet layout",
      "Setup Agent playbook and changelog",
    ],
    guardrails: [
      "Invoice reminder only when sure: the invoice is known unpaid, the customer has email consent, and the reminder switch is on. Otherwise you get a draft.",
      "Consent required for email and SMS by default.",
      "Quiet hours (default 21 to 8) and a doNotContact list for emails and numbers that must never be messaged.",
      "Remembers handled request and job ids so it will not send twice for the same one (Active runs only).",
      "Optional log writes never delete: one HubSpot contact or one sheet row.",
    ],
    hardStop:
      "No first live customer message or write until a clean test, a reviewer check, and a staged test with your own test client in Jobber, with the message going only to an address you control. Then turn on live switches one at a time.",
    willNot: [
      "Send anything to a customer while test mode is on.",
      "Change anything in Jobber.",
      "Send the invoice reminder by default, even when live.",
      "Handle inbound text replies. There is no inbound STOP handler, so add opt-outs to doNotContact and keep your SMS provider's opt-out handling on.",
      "Register your texting campaign (A2P 10DLC) or give legal advice.",
    ],
    faq: [
      {
        q: "Will it send a customer anything on its own?",
        a: "Not while test mode is on, and even when live it needs liveSendApproved. The invoice reminder stays a draft to you unless you also turn on sendInvoiceReminder.",
      },
      {
        q: "Does it connect to Jobber out of the box?",
        a: "No. Jobber's API details have not been verified and must be checked with your own Jobber test account. This is why the pack is not yet live-tested.",
      },
      {
        q: "Does it handle STOP replies?",
        a: "No inbound text handler is included. Add opt-outs to doNotContact and keep your SMS provider's opt-out handling on.",
      },
      {
        q: "Can it change my Jobber data?",
        a: "No. It does not change anything in Jobber.",
      },
      {
        q: "Do I need HubSpot or Google Sheets?",
        a: "No. The log is optional and off by default.",
      },
      {
        q: "Has it been tested live?",
        a: "No.",
      },
    ],
    testingNote: draftNote(
      "Jobber, HubSpot, Gmail, Slack, Twilio, or Google Sheets",
    ),
  },
  {
    slug: "crm-migration-kit",
    name: "CRM Migration Kit",
    version: "v0.1.0",
    category: "crm-hygiene",
    filterTags: [],
    headline:
      "Move customers, companies, and deals out of messy spreadsheets and into HubSpot the careful way: map every column, check the data offline, rehearse the load, back up, get sign-off, and only then load.",
    summary:
      "Mapping workbook, offline pre-flight check, and dry-run importer for moving spreadsheets into HubSpot. The live load is a human step.",
    safety:
      "Dry-run first, never deletes, backup before any live write. The kit itself never writes to HubSpot.",
    whoFor:
      "Managers and owners moving a spreadsheet or unsupported export into HubSpot. Not for moves where HubSpot's own Smart Transfer already fits, or a Salesforce, monday, or Zoho custom importer.",
    whatItDoes: [
      "Intake: a questionnaire a named decision maker approves before mapping starts.",
      "Mapping: every column you care about, plus owners and pipelines/stages, in the mapping workbook.",
      "Offline pre-flight: finds duplicates, missing keys, bad emails, phones and states, unknown owners and stages, and orphaned deals.",
      "Offline dry run: shows exactly what would be created, updated, skipped, or held back, with a report, error file, planned rollback log, and reconciliation.",
      "Backup, review, sign-off. Then a person runs HubSpot's own import tool or Imports API.",
    ],
    workflows: [
      {
        name: "Dry-run importer",
        nodes: 9,
        description: "The same pre-flight and plan as an n8n workflow. Inactive, with no HubSpot node.",
      },
    ],
    totalNodes: 9,
    totalNodesWithNotes: 13,
    kitNote:
      "This is a kit, not a single messaging workflow: a mapping workbook, an offline Python pre-flight check, an offline Python dry-run importer, and the n8n dry-run workflow above. The Python scripts need Python 3.9+, no packages, and no network.",
    defaults: [
      "dryRun and testMode on; live-write switches off.",
      "The live load is a human step using HubSpot's official import, run by a HubSpot Super Admin after every gate is signed.",
    ],
    testModeWrites:
      "No. Nothing in the kit performs a live HubSpot write, in any mode.",
    included: [
      "Intake questionnaire, pre-flight checklist, and gate-by-gate cutover checklist",
      "Mapping workbook (CSV and xlsx) with owners and pipelines/stages maps",
      "Offline pre-flight script and offline dry-run importer (Python)",
      "n8n dry-run workflow (inactive, no HubSpot node)",
      "Deliberately messy fictional sample files and sample reports",
      "Setup Agent playbook, README, and changelog",
    ],
    guardrails: [
      "Never deletes. No \"wipe and reload\".",
      "Never overwrites an existing HubSpot value unless the mapping row says so and a named person approved that row.",
      "Backup before any live write. If the backup fails, stop.",
      "Traceable: records upserted by unique key, stamped with a migration batch ID, with a rollback log.",
      "Human approval at every gate. No keys or passwords are asked for anywhere in the kit.",
    ],
    hardStop:
      "No live write until the mapping is approved, pre-flight is clean or remaining risk is accepted in writing, a human has read the dry-run report, the backup is done and checked, and on done-with-you jobs Prewired AI has reviewed in writing. Load order: companies, contacts, deals, associations, with a stop and spot check after each.",
    willNot: [
      "Write to HubSpot, delete records, or \"fix\" data in HubSpot.",
      "Approve a gate for you or tell you to run a live write early.",
      "Give legal advice. Privacy, consent, and data-handling questions go to your own policy and counsel.",
    ],
    faq: [
      {
        q: "Does the kit load my data into HubSpot?",
        a: "No. The kit prepares, checks, and rehearses. A person runs HubSpot's own import after every gate is signed.",
      },
      {
        q: "Can it delete or overwrite my existing HubSpot data?",
        a: "No. It never deletes, and it never overwrites an existing value unless a person approved that mapping row.",
      },
      {
        q: "Can I undo a migration?",
        a: "Only within HubSpot's own restore windows, and deleting records an import created does not undo values it overwrote. Confirm the current windows in HubSpot's help pages before you load. Nothing is promised after those windows.",
      },
      {
        q: "Do I need to be a developer?",
        a: "The scripts run from a command line with Python 3.9+, so you may want someone comfortable with that. The n8n dry-run workflow is an alternative.",
      },
      {
        q: "Can it move data from Salesforce, monday, or Zoho?",
        a: "Not as a custom importer. It is for spreadsheets and CSV exports.",
      },
      {
        q: "Has it been tested live?",
        a: "No. It has been verified only on fictional sample files.",
      },
    ],
    testingNote: "Draft. Not yet tested against a live HubSpot account. Verified only on fictional sample files.",
    related: ["hubspot-cleanup-kit"],
  },
  {
    slug: "support-triage-agent",
    name: "Draft-First Support & Post-Sales Triage Agent",
    version: "v0.1.0",
    category: "ai-agents",
    filterTags: [],
    headline:
      "Your support agent never sends a customer reply on its own. It labels tickets, adds CRM context, and holds a draft reply for you.",
    summary:
      "Ingest a ticket or email, classify and route it, pull HubSpot context and matching help articles, post an internal summary, and hold a draft for a person to approve.",
    safety:
      "Draft-first: the triage workflow has no send node. The optional send workflow is locked and approved-rows only.",
    whoFor:
      "Owners and support leads at appointment-based service businesses who take tickets or support email and keep customers in HubSpot.",
    whatItDoes: [
      "Takes in a ticket from a generic helpdesk or email webhook, a Zendesk-shaped webhook, or a built-in fictional sample.",
      "Labels it by urgency and topic. Plain keyword rules always run; an optional AI step can add to them but never overrides them on risky topics.",
      "Looks up the requester in HubSpot, read only.",
      "Finds matching help articles in your knowledge base by keyword search.",
      "Posts an internal summary for your team and flags high-risk and VIP tickets for escalation.",
      "Holds a draft reply in your pending-approvals sheet and/or as a Gmail draft (never sent), and writes a run log.",
    ],
    workflows: [
      {
        name: "Triage",
        nodes: 57,
        description: "Labels, HubSpot context, help articles, internal summary, held draft. No send node.",
      },
      {
        name: "Send approved (optional)",
        nodes: 28,
        description: "Locked by default. Sends only rows a person approved.",
      },
    ],
    totalNodes: 85,
    totalNodesWithNotes: 99,
    defaults: [
      "Shipped Config runs a demo that cannot reach HubSpot, Gmail, Slack, Sheets, or a knowledge base: testMode on, sample source, AI off, alerts off.",
      "Send workflow starts locked: testMode on, dryRun on, sendApprovedReplies off. By default it only prints a \"would send\" report.",
      "Both workflows import inactive.",
    ],
    testModeWrites:
      "No. In test mode nothing is written anywhere (no sheet row, no Gmail draft, no log row). Output starts with [TEST].",
    included: [
      "Two importable n8n workflows: triage (no send node) and optional locked send",
      "17 fictional ticket fixtures, a sample knowledge base, a sample HubSpot account, and sample outputs",
      "Eval checklist with 17 test cases and expected answers",
      "Printable buyer checklist, README, and changelog",
      "Setup Agent playbook",
    ],
    guardrails: [
      "Every held draft is marked HELD DRAFT (NOT SENT). A person reads, edits, and approves it.",
      "Approval is a person typing yes and their name. The Setup Agent and this pack never approve for you, and approving a row does not send it.",
      "Cancellation, refund, legal, threat, data-deletion, and pasted-credential tickets always escalate and never get an AI draft.",
      "Secrets in a ticket are redacted before any prompt, draft, Slack message, or log sees them.",
      "No invented policy: an AI draft is thrown away if it promises an outcome, mentions an amount or time not in the ticket or article, or cites an article that was not retrieved.",
      "Rollback switch: turn agentEnabled off and set the workflow Inactive. Drafting stops at once; nothing is deleted.",
    ],
    hardStop:
      "The first live send is one approved row to your own staged address, then one real ticket you chose. Before any live use, run the eval checklist on all fixtures, read every held draft, and have the named person sign the go-live checklist. Most buyers can send approved replies by hand and never import the send workflow.",
    willNot: [
      "Send anything to a customer from the triage workflow.",
      "Close, merge, or delete tickets, contacts, or deals, or change anything in HubSpot.",
      "Auto-send, auto-close, or auto-refund.",
      "Give legal, tax, or medical advice, or invent policy.",
      "Train on your tickets.",
    ],
    faq: [
      {
        q: "Will it ever reply to a customer by itself?",
        a: "No. The triage workflow has no send node. The optional send workflow is locked and sends only rows a person approved.",
      },
      {
        q: "Do I need a helpdesk, HubSpot, or an AI account to try it?",
        a: "No. The demo runs on fictional data with no accounts.",
      },
      {
        q: "Is AI required?",
        a: "No. It is off by default, and the rules-based labels and template drafts work without it.",
      },
      {
        q: "What about angry customers, refunds, and cancellations?",
        a: "Those escalate and get extra-careful template drafts, never an AI draft. A person decides.",
      },
      {
        q: "Does it change my CRM?",
        a: "No. HubSpot is read only.",
      },
      {
        q: "Is it accurate?",
        a: "No accuracy claim is made. The pack ships 17 fictional test cases with expected answers so you can check it on your own setup, and a person still reads every draft.",
      },
      {
        q: "Has it been tested live?",
        a: "No. It was logic-checked offline against the 17 fixtures. Treat the first import as a test.",
      },
    ],
    testingNote: draftNote(
      "Zendesk, HubSpot, Gmail, Slack, Google Sheets, or chat-model",
    ),
    diagram: true,
    related: ["account-health-onboarding-qa"],
  },
  {
    slug: "account-health-onboarding-qa",
    name: "Account Health & Onboarding QA Agent",
    version: "v0.1.0",
    category: "ai-agents",
    filterTags: [],
    headline:
      "See which new customers are stuck, which accounts have gone quiet, and which have no owner, in one plain digest, with check-ins held as drafts. It never sends to a customer, and the monitor cannot change HubSpot.",
    summary:
      "Watch onboarding milestones and account activity, flag stalled steps, missing fields, and ownerless accounts, post an owner digest, and hold draft-only check-ins.",
    safety:
      "The monitor has no HubSpot write node and no customer send node. Hygiene apply is locked, dry-run, approved rows only, backup first.",
    whoFor:
      "Owners and customer-success leads who onboard new customers in HubSpot at appointment-based service businesses. It complements the Manager Digest and the HubSpot Cleanup Kit.",
    whatItDoes: [
      "Reads HubSpot (or a Google Sheet, or a built-in sample) and gives each account labeled flags, not a score: stalled step, missing field, no activity, ownerless.",
      "Underutilization is flagged only if you map a volume property; otherwise the digest says the rule was skipped. It never guesses volume.",
      "Posts an owner digest by Slack and/or email, including the on-track count.",
      "Holds draft-only check-in previews and writes a proposed hygiene file with the approved column always blank.",
      "No churn percentage and no prediction.",
    ],
    workflows: [
      {
        name: "Monitor",
        nodes: 46,
        description: "Read-only. No HubSpot write node and no customer send node.",
      },
      {
        name: "Hygiene apply",
        nodes: 33,
        description: "Locked by default. Applies approved rows one field at a time.",
      },
    ],
    totalNodes: 79,
    totalNodesWithNotes: 97,
    kitNote:
      "v0.1 ships no \"send approved check-ins\" workflow. You open each draft, edit it, and press Send yourself.",
    defaults: [
      "Shipped Config runs the sample: testMode on, sample source, no delivery. The sample path never calls HubSpot, Gmail, Slack, or Sheets.",
      "Hygiene apply starts locked: testMode on, dryRun on, applyApprovedChanges off.",
      "Customer-addressed Gmail drafts are a separate switch, off by default.",
      "Both workflows import inactive.",
    ],
    testModeWrites:
      "No. The sample path never writes to a sheet, even if you connect one, and the monitor cannot write to HubSpot in any mode.",
    included: [
      "Two importable n8n workflows: read-only monitor and locked hygiene apply",
      "Fictional contacts, companies, deals, activities, milestones, and sample outputs",
      "Eval checklist with 12 checks and expected results",
      "Printable buyer checklist with three separate signatures",
      "Setup Agent playbook, README, and changelog",
    ],
    guardrails: [
      "Two separate workflows, never merged. Clicking Active on the monitor cannot change your CRM or email a customer.",
      "Check-ins are drafts, not sends. Accounts tagged cancellation-sensitive get no draft.",
      "Hygiene apply does only one-field updates, with a pause between writes. Rows with a blank proposed value are skipped.",
      "Backup first: affected records are saved to a dated tab before any write. No backup, no write.",
      "Rollback switch: turn agentEnabled off and set the workflow Inactive.",
    ],
    hardStop:
      "Three separate signatures: the first live digest (after a TEST-labeled run on your data), the first customer-addressed draft (may be never), and the first hygiene apply (one or two approved rows, a matching dry-run report, and a backup you opened and checked).",
    willNot: [
      "Send a check-in or win-back email to a customer.",
      "Write to HubSpot from the monitor.",
      "Delete, merge, or archive a record.",
      "Mark a row approved for you.",
      "Invent utilization, revenue, or churn numbers.",
      "Give legal advice. Email wording, consent, and opt-out obligations are your own.",
    ],
    faq: [
      {
        q: "Will it email my customers?",
        a: "No. Check-ins are held as drafts for you to review and send by hand. This version ships no send workflow.",
      },
      {
        q: "Can it change my CRM?",
        a: "The monitor cannot. The optional hygiene workflow can change one field at a time on rows you approved, after a dry run and a backup, and never deletes, merges, or archives.",
      },
      {
        q: "Does it predict churn?",
        a: "No. It shows labeled flags from plain rules, and it does not guess volume or invent numbers.",
      },
      {
        q: "What if I don't track usage volume?",
        a: "The underuse rule is skipped and the digest says so.",
      },
      {
        q: "Do I need a HubSpot account to try it?",
        a: "No. The sample run needs none.",
      },
      {
        q: "Has it been tested live?",
        a: "No.",
      },
    ],
    testingNote: draftNote("HubSpot, Gmail, Slack, or Google Sheets"),
    related: ["manager-digest", "hubspot-cleanup-kit", "support-triage-agent"],
  },
];

/** All filter chips a pack appears under (primary category mapped to its chip). */
export function packFilters(pack: TemplatePack): CategoryId[] {
  const chip: CategoryId =
    pack.category === "lead-capture" ? "lead-response" : pack.category;
  return Array.from(new Set<CategoryId>([chip, ...pack.filterTags]));
}

export function getPack(slug: string): TemplatePack | undefined {
  return templatePacks.find((p) => p.slug === slug);
}

/** Price shown for a tier on a pack. Manager Digest's Solo tier is Free. */
export function tierPrice(pack: TemplatePack, tier: Tier["id"]): string {
  if (pack.free && tier === "solo") return "Free";
  return PRICE_PENDING;
}

/** Email waitlist link. No checkout exists. */
export function waitlistHref(email: string, pack?: TemplatePack): string {
  const subject = pack
    ? `Waitlist: ${pack.name}`
    : "Waitlist: Prewired AI template packs";
  const body = pack
    ? `Please add me to the waitlist for ${pack.name}. I understand it is not for sale yet.\n\nTier I'm interested in (Solo / Team / Done-for-you):\nCRM or tools I use:\n`
    : "Please add me to the Prewired AI template packs waitlist. I understand nothing is for sale yet.\n\nPacks I'm interested in:\nCRM or tools I use:\n";
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
