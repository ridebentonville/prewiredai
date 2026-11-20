/**
 * Portfolio content for Bryce Nelson.
 * Template: Ryan Fitzgerald, devportfolio (MIT)
 * https://github.com/RyanFitzgerald/devportfolio
 *
 * Facts only. Do not invent metrics, clients, testimonials, dates, or skills.
 * Missing facts stay as comments in this file and in TODO.md. Never render the word TODO, and never fill a gap with fake data.
 *
 * Privacy: do not name the current employer. The public line is
 * "operations leader at a national smart-home company".
 * Do not add a phone number.
 * Do not add a reporting-automation case study.
 */

export interface SocialLinks {
  email?: string;
  linkedin?: string;
  website?: string;
  websiteLabel?: string;
}

export interface CaseStudyImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
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
  /** Omit when unknown. Do not put a TODO string here. */
  next?: string;
  image?: CaseStudyImage;
}

export interface Venture {
  name: string;
  url: string;
  urlLabel: string;
  role: string;
  summary: string;
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
  title: "AI implementer and GTM tool builder",
  description:
    "Bryce Nelson builds AI tools and adoption for small and field-service go-to-market teams. Based in Bella Vista, Arkansas.",
  location: "Bella Vista, Arkansas",
  accentColor: "#1f4d3a",
  headshot: {
    src: "/images/bryce-nelson.jpg",
    alt: "Bryce Nelson",
    width: 400,
    height: 400,
  },
  roles: ["GTM engineer", "AI implementer", "RevOps"],
  social: {
    email: "brycednelson@gmail.com",
    linkedin: "https://www.linkedin.com/in/bryce-nelson-8557a364/",
    website: "https://d2dcopilot.com",
    websiteLabel: "d2dcopilot.com",
  } satisfies SocialLinks,
  heroLead:
    "AI implementer and GTM tool builder for small and field-service teams.",
  heroBody:
    "Operations leader with 13+ years of building onboarding and training for field teams.",
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
      problem:
        "Door-to-door sales teams need coaching that fits the field. d2dcopilot is an AI coaching app for those teams.",
      approach:
        "I built it with AI tools: Expo and React Native, on Firebase. Still in development.",
      stack: ["Expo", "React Native", "Firebase"],
      status: "Pilot with Brinks Home Security: 5 managers and 5 reps.",
      next: "A spring expansion is planned, with a target rollout to 100+ reps in May.",
      image: {
        src: "/images/d2dcopilot.png",
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
      // TODO: What comes next for this enablement work was not provided. Do not invent a rollout, headcount, or result. Leave `next` unset so the field stays hidden.
      // TODO: No visual was provided. Do not mock a training deck, chat log, or screenshot. Leave `image` unset.
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
      // TODO: How this table gets used next was not provided. Do not invent outreach, pipeline, or meetings booked. Leave `next` unset.
      // TODO: A visual must stay company-level. No contact names, emails, or phone numbers. Leave `image` unset.
    },
  ] satisfies CaseStudy[],
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
        "A directory helping English-speaking travelers to Japan find lodging, tattoo-friendly onsens, and experiences with English-speaking guides.",
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
  // TODO: GitHub profile URL was not provided. Do not guess a username.
  // TODO: Phone number is intentionally omitted.
  // TODO: Open Graph share image was not provided. Do not reuse the d2dcopilot screenshot as a portrait of Bryce.
};
