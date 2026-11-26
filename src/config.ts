/**
 * Portfolio content for Bryce Nelson.
 * Template: Ryan Fitzgerald, devportfolio (MIT)
 * https://github.com/RyanFitzgerald/devportfolio
 *
 * Facts only. Do not invent metrics, clients, testimonials, dates, or skills.
 * Missing facts stay as TODO comments in this file. Never fill them with fake data,
 * and never put TODO text in a rendered field: leave the field empty and it is hidden.
 *
 * Privacy: do not name the current employer. The public line is
 * "operations leader at a national smart-home company".
 * Do not add a phone number.
 * Do not add a reporting-automation case study.
 * Do not name d2dcopilot's pilot client or publish pilot counts. The public line is
 * "a national home security company".
 */

export interface SocialLinks {
  email?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  websiteLabel?: string;
}

export interface CaseStudyImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
  /** Optional smaller WebP for narrow screens. */
  srcSmall?: string;
  srcSmallWidth?: number;
}

export interface CaseStudy {
  name: string;
  summary: string;
  url?: string;
  urlLabel?: string;
  label: string;
  problem: string;
  approach: string;
  stack: string[];
  status: string;
  /** Hidden when empty. */
  next?: string;
  /** Shows this study as the lead proof. Use on one study only. */
  featured?: boolean;
  image?: CaseStudyImage;
}

export interface Offer {
  name: string;
  summary: string;
  includes: string[];
  /** Leave empty to show "Pricing on request". Never invent a number. */
  price?: string;
}

export interface Venture {
  name: string;
  url: string;
  urlLabel: string;
  role: string;
  summary: string;
  /** Optional note. Hidden when empty. Never put TODO text here. */
  note?: string;
}

export interface ExperienceItem {
  company: string;
  title: string;
  dateRange: string;
  bullets?: string[];
}

export interface EducationItem {
  school: string;
  degree: string;
  dateRange: string;
  achievements?: string[];
}

export const siteConfig = {
  name: "Bryce Nelson",
  title: "GTM engineer and AI implementer",
  description:
    "Bryce Nelson builds AI workflows and tools that make sales and field teams faster, and teaches non-technical teams to use them. Based in Bella Vista, Arkansas.",
  location: "Bella Vista, Arkansas",
  accentColor: "#1f4d3a",
  headshot: {
    src: "/images/bryce-nelson.jpg",
    srcSmall: "/images/bryce-nelson-256.webp",
    alt: "Bryce Nelson",
    width: 400,
    height: 400,
  },
  openTo:
    "Open to GTM engineering, RevOps and FDE roles, plus fixed-price builds.",
  /**
   * TODO: Scheduling link (for example a Cal.com or Calendly URL) was not provided.
   * Leave empty and the "Book a call" button is hidden. Do not guess a URL.
   */
  schedulingUrl: "",
  social: {
    email: "brycednelson@gmail.com",
    linkedin: "https://www.linkedin.com/in/bryce-nelson-8557a364/",
    github: "https://github.com/ridebentonville",
    website: "https://d2dcopilot.com",
    websiteLabel: "d2dcopilot.com",
  } satisfies SocialLinks,
  heroHeadline:
    "I build the AI workflows that make sales and field teams faster.",
  heroLead:
    "GTM engineer and AI implementer with 13+ years building onboarding and training for field teams. Now I ship the tools: d2dcopilot (AI sales coaching, in pilot), Clay targeting tables, and agent workflows.",
  aboutMe:
    "I am an operations leader at a national smart-home company. I build AI tools for small and field-service go-to-market teams, and I teach non-technical teams to use them.",
  skills: [
    "Cursor",
    "MCP connectors",
    "AI agents and routines",
    "Clay",
    "Expo/React Native",
    "Firebase",
    "Workflow automation",
    "Sales enablement",
    "Field team training and onboarding",
  ],
  caseStudies: [
    {
      name: "d2dcopilot",
      summary: "An AI coaching app for door-to-door sales teams.",
      url: "https://d2dcopilot.com",
      urlLabel: "d2dcopilot.com",
      label: "Pilot",
      featured: true,
      problem:
        "Door-to-door sales teams need coaching that fits the field. d2dcopilot is an AI coaching app for those teams.",
      approach:
        "I built it with AI tools: Expo and React Native, on Firebase. It is still in development.",
      stack: ["Expo", "React Native", "Firebase"],
      status:
        "In a pilot with the door-to-door sales team of a national home security company. The app is still in development, and the pilot is not a finished rollout.",
      // Do not add pilot counts, rollout targets, or the client's name.
      image: {
        src: "/images/d2dcopilot.webp",
        srcSmall: "/images/d2dcopilot-720.webp",
        srcSmallWidth: 720,
        alt: "Screenshot of the public d2dcopilot.com landing page. The headline reads: Door-to-door reps get a better next line before the next knock.",
        width: 1440,
        height: 900,
        caption:
          "Public landing page at d2dcopilot.com. Figures inside the product preview are part of that page, not results from the pilot.",
      },
    },
    {
      name: "Teaching a field team to use AI",
      summary:
        "Enablement and adoption for a non-technical field team.",
      label: "Enablement",
      problem:
        "Non-technical field teams still have to troubleshoot issues on the job and keep recurring work from slipping.",
      approach:
        "I taught my field team to use AI tools to troubleshoot field issues, and to use AI agents to automate recurring tasks so they stay organized. The point is enablement and adoption: the team can do the work.",
      stack: ["AI tools", "AI agents"],
      status:
        "In use with the field team I lead at a national smart-home company. This is a practice, not a shipped product.",
      // TODO: What comes next for this enablement work was not provided. Do not invent a rollout, headcount, or result.
      // TODO: No visual was provided. Do not mock a training deck, chat log, or screenshot.
    },
    {
      name: "Door-to-door market signal table",
      summary: "Company-level GTM targeting. No contacts.",
      label: "Research",
      problem:
        "Choosing door-to-door companies to target needs a read on hiring and growth, at the company level.",
      approach:
        "A Clay table of 34 door-to-door-heavy companies in home security, solar, pest, roofing, and fiber. Companies are scored on hiring and growth signals for GTM targeting. Company-level only. No contacts.",
      stack: ["Clay"],
      status:
        "The table covers 34 companies. Company names and scores are not published on this site.",
      // TODO: How this table gets used next was not provided. Do not invent outreach, pipeline, or meetings booked.
      // TODO: A company-level visual of the Clay table was not provided. No contact names, emails, or phone numbers.
    },
  ] satisfies CaseStudy[],
  // Fixed-scope offers. Prices stay empty ("Pricing on request") until Bryce sets them.
  offers: [
    {
      name: "GTM workflow build",
      summary:
        "One AI workflow for a sales or operations team, scoped up front and built to a fixed scope.",
      includes: [
        "Scoping call and written scope",
        "Build in your tools (for example Clay, MCP connectors, AI agents)",
        "Handoff notes so your team can run it",
      ],
    },
    {
      name: "AI enablement for field teams",
      summary:
        "Training and adoption so a non-technical field team actually uses AI tools on the job.",
      includes: [
        "Use cases picked from the team's real work",
        "Hands-on training for reps and managers",
        "Simple guides the team keeps",
      ],
    },
    {
      name: "GTM tooling retainer",
      summary:
        "Ongoing help building and maintaining AI tools and workflows for a go-to-market team.",
      includes: [
        "A standing monthly scope",
        "New workflows and fixes as needs change",
        "Regular check-ins",
      ],
    },
    {
      name: "Draft-First Support & Post-Sales Triage Agent",
      summary:
        "A done-for-you fixed-price install of the post-sales triage agent, also available as a downloadable template pack. Incoming tickets are classified, enriched with HubSpot and knowledge-base context, and turned into an internal Slack summary plus a draft customer reply held for your approval.",
      includes: [
        "Scoping, connector setup, and knowledge-base wiring",
        "Production Guardrails: draft-first approval, test mode on by default, pre-launch edge-case tests, and an owner-signed Go-Live checklist",
        "Handoff notes and a rollback switch so the agent can be paused without deleting the workflow",
      ],
      price: "[Proposed / TBD] — custom quote",
    },
    {
      name: "Account Health & Onboarding QA Agent",
      summary:
        "A done-for-you fixed-price install of the account-health agent, also available as a downloadable template pack. It watches onboarding milestones and underused accounts, posts a structured Slack digest, holds draft check-in emails, and queues CRM hygiene updates for dry-run, approved-rows-only apply.",
      includes: [
        "Scoping and a written onboarding-milestone map in your CRM",
        "Production Guardrails: test mode and dry-run defaults, draft-only check-ins, approved-rows-only CRM updates, and an owner-signed Go-Live checklist",
        "Handoff notes and a rollback switch; no silent overwrites or deletes",
      ],
      price: "[Proposed / TBD] — custom quote",
    },
  ] satisfies Offer[],
  ventures: [
    {
      name: "JAPANIMA",
      url: "https://japanima.com",
      urlLabel: "japanima.com",
      role: "Founder",
      summary:
        "JAPANIMA brings international adventure travelers to rural Japan, starting with premium e-mountain bike journeys.",
    },
    {
      name: "ridesoakstay.com",
      url: "https://ridesoakstay.com",
      urlLabel: "ridesoakstay.com",
      role: "Founder",
      summary:
        "A directory that helps English-speaking travelers to Japan find lodging, tattoo-friendly onsens, and experiences with English-speaking guides.",
    },
  ] satisfies Venture[],
  experience: [
    {
      company: "A national smart-home company",
      title: "Operations leader",
      dateRange: "Aug 2017 – Present",
      bullets: [
        "Operations leader for field teams, including onboarding and training.",
        "Taught the field team to use AI tools to troubleshoot field issues, and AI agents to automate recurring tasks.",
      ],
    },
    {
      company: "Protection 1",
      title: "Residential Operations Manager",
      dateRange: "May 2014 – Aug 2017",
      // TODO: Day-to-day bullets were not provided. Do not invent scope, headcount, or results.
    },
    {
      company: "Protection 1",
      title: "Residential Installer",
      dateRange: "May 2013 – May 2014",
      // TODO: Day-to-day bullets were not provided. Do not invent scope or results.
    },
  ] satisfies ExperienceItem[],
  // TODO: No school, degree, or dates were provided. Leave this empty so the section stays hidden. Do not invent education.
  education: [] as EducationItem[],
  // Phone number is intentionally omitted.
  // The Open Graph share image is a text card at /og-image.png. Do not swap in the d2dcopilot screenshot.
  ogImage: {
    src: "/og-image.png",
    alt: "Bryce Nelson: I build the AI workflows that make sales and field teams faster.",
    width: 1200,
    height: 630,
  },
};
