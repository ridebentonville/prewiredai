/**
 * Prewired AI automation packs (Templates page and homepage teaser).
 *
 * Facts only. Same rules as config.ts: no testimonials, customer counts, results,
 * or client names. Do not name any employer.
 * - Prices below are DRAFT ranges from the published plan, not a live checkout.
 * - "[TBD]" means Bryce has not set the price yet. Do not replace it with a guess.
 * - Gumroad links are placeholders. `gumroadUrl` stays empty until a real listing
 *   exists; empty renders "Coming soon". Do not add live URLs before launch.
 * - Do not claim any pack is for sale, live, or tested on real customers.
 */

export interface PriceLine {
  label: string;
  value: string;
}

export interface TemplatePack {
  name: string;
  /** Short tag, e.g. "Free lead magnet". */
  tag?: string;
  summary: string;
  /** One sentence on the safety-first approach. */
  safety: string;
  prices: PriceLine[];
  /** Leave empty until a real Gumroad listing exists. Renders "Coming soon". */
  gumroadUrl?: string;
}

export const templatesPage = {
  title: "Templates — Prewired AI automation packs",
  description:
    "Draft list of Prewired AI automation packs and post-sales AI agents: lead response, booking, invoice sync, CRM cleanup, support triage, and account health. Available as downloadable template packs and done-for-you fixed-price installs. Production Guardrails are the default.",
  heading: "Prewired AI automation packs",
  intro:
    "Automation packs and post-sales AI agents for small sales and service teams. Each offer is available as a downloadable template pack and as a done-for-you fixed-price install, built so nothing reaches a real customer until you decide it should.",
  priceNote:
    "Prices are draft ranges, not a live checkout. Nothing on this page is for sale yet. [TBD] means the price is not set. [Proposed / TBD] means a range is still under review and is not an accepted list price.",
  safetyNote:
    "Production Guardrails are the core of every pack: draft-first human approval before any customer-facing send, test mode and dry-run on by default, pre-launch edge-case tests, and an owner-signed Go-Live checklist. Nothing reaches a real customer, and no CRM record is changed, until you sign off.",
};

export const templatesTeaser = {
  heading: "Templates",
  summary:
    "Prewired AI automation packs and post-sales AI agents, available as downloadable template packs and done-for-you fixed-price installs. Production Guardrails are the differentiator: draft-first approval, test mode and dry-run defaults, pre-launch tests, and an owner-signed Go-Live checklist.",
  linkLabel: "See the template packs",
};

export const templatePacks: TemplatePack[] = [
  {
    name: "Manager Digest",
    tag: "Free lead magnet",
    summary:
      "A daily or weekly digest of new leads, overdue tasks, and stale deals.",
    safety:
      "Test mode is the default, and the first live digest is a conscious go-live step.",
    prices: [{ label: "Price", value: "Free" }],
  },
  {
    name: "Speed-to-Lead (with Form-to-CRM)",
    summary:
      "A form submission or lead comes in, the CRM is updated, the owner is alerted, and the lead gets a first reply and follow-ups with consent, quiet hours, and STOP handling.",
    safety:
      "Test mode is the default, with a hard stop before the first live message to a real lead.",
    prices: [
      { label: "Template", value: "$39–59" },
      { label: "Bot-assisted", value: "$100–400" },
      { label: "Done-for-you", value: "$250–750" },
    ],
  },
  {
    name: "Booking, reminders, and no-show recovery",
    summary:
      "Booking confirmation, 24-hour and 2-hour reminders, reschedule and cancel links, no-show win-back, and owner alerts.",
    safety:
      "Test mode is the default, with a hard stop before the first live message to a real customer.",
    prices: [
      { label: "Template", value: "[TBD]" },
      { label: "Done-for-you", value: "$750–$1,500" },
    ],
  },
  {
    name: "Closed-won invoice sync",
    summary:
      "When a HubSpot deal is closed-won, a draft, unsent invoice is created in QuickBooks, Stripe, or Xero. Idempotent, with owner alerts.",
    safety:
      "Test mode is the default, invoices stay draft and unsent by default, and there is a hard stop before the first live invoice send to a real customer.",
    prices: [
      { label: "Template", value: "[TBD]" },
      { label: "Done-for-you", value: "$750–$1,500" },
    ],
  },
  {
    name: "HubSpot cleanup kit",
    summary:
      "Audit-first: a read-only report with proposed changes. An optional fix step applies only approved rows, takes a backup first, and never deletes.",
    safety:
      "A human approves every bulk change, and dry-run is the default.",
    prices: [
      { label: "Template", value: "[TBD]" },
      { label: "Done-for-you", value: "$500 floor, or $50–$90/hr" },
    ],
  },
  {
    name: "Sheets-only variants",
    summary:
      "Speed-to-Lead and Booking / no-show recovery, with the same automations running on Google Sheets only (no CRM).",
    safety:
      "Test mode is the default, with the same hard stop before the first live message.",
    prices: [
      { label: "Speed-to-Lead template", value: "$39–59" },
      { label: "Speed-to-Lead bot-assisted", value: "$100–400" },
      { label: "Speed-to-Lead done-for-you", value: "$250–750" },
      { label: "Booking / no-show template", value: "[TBD]" },
      { label: "Booking / no-show done-for-you", value: "$750–$1,500" },
    ],
  },
  {
    name: "Form-to-CRM starter",
    summary:
      "A form webhook with dedupe and upsert to HubSpot, optionally HighLevel or Sheets, plus owner and error alerts. No lead messaging.",
    safety:
      "Test mode is the default, with a hard stop before the first live CRM write to a real lead.",
    prices: [{ label: "Price", value: "[TBD]" }],
  },
  {
    name: "Jobber connector",
    summary:
      "Uses the Jobber GraphQL API via HTTP Request for new request and quote follow-up, plus job-completed invoice reminders and review requests. Optional HubSpot or Sheets sync.",
    safety:
      "Test mode is the default, with a hard stop before any live customer message or write.",
    prices: [
      { label: "Template", value: "[TBD]" },
      { label: "Done-for-you", value: "$750–$1,500" },
    ],
  },
  {
    name: "Draft-First Support & Post-Sales Triage Agent",
    tag: "Post-sales AI agent",
    summary:
      "Ingest a support ticket or email, classify and route it, pull HubSpot account context and matching knowledge-base articles, post an internal Slack summary or escalation for high-risk or VIP accounts, and hold a draft customer reply for a human to approve.",
    safety:
      "Draft-first: customer replies are never auto-sent. Test mode is the default, pre-launch edge-case tests ship with the pack, and go-live requires an owner-signed checklist.",
    prices: [
      { label: "Template pack", value: "[Proposed / TBD]" },
      { label: "Done-for-you install", value: "[Proposed / TBD]" },
    ],
  },
  {
    name: "Account Health & Onboarding QA Agent",
    tag: "Post-sales AI agent",
    summary:
      "Watch new-customer onboarding milestones and active-account activity. Flag stalled steps, missing CRM fields, and underutilization risks. Post a structured owner digest in Slack, hold draft-only check-in emails, and queue CRM hygiene updates for a dry-run, approved-rows-only apply.",
    safety:
      "Check-in emails stay draft-only. CRM updates are dry-run and approved-rows-only, with no silent overwrites or deletes. Test mode is the default, and go-live requires an owner-signed checklist.",
    prices: [
      { label: "Template pack", value: "[Proposed / TBD]" },
      { label: "Done-for-you install", value: "[Proposed / TBD]" },
    ],
  },
];
