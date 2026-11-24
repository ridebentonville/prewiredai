# CLAUDE.md

Guidance for working on Bryce Nelson's public portfolio (prewiredai.com).

## Project

Static site based on Ryan Fitzgerald's devportfolio (MIT): Astro and Tailwind CSS v4. Content is config-driven from `src/config.ts`.

## Commands

```bash
npm run dev       # Local server
npm run build     # Production build
npm run preview   # Preview the production build
```

## Rules for content

- Use only facts already in `src/config.ts` or explicitly supplied for this site.
- Do not invent metrics, clients, testimonials, dates, employers, or skills.
- Mark gaps as `TODO` code comments and leave the field empty so it is hidden. Never render TODO text. Do not fill gaps with plausible placeholder copy.
- Do not name d2dcopilot's pilot client or publish pilot counts or rollout targets. Say "a national home security company."
- Offer prices stay empty ("Pricing on request") until Bryce sets them.
- Do not name the current employer. Say "operations leader at a national smart-home company."
- Do not add a phone number.
- Do not add Salesforce, Figma, or formal UX to the skills.
- Do not add a reporting-automation case study.
- Keep the MIT license and the credit to Ryan Fitzgerald.

## Layout

- Components in `src/components/` read `siteConfig` and hide themselves when their list is empty.
- `src/pages/index.astro` is the only page.
- Accent color is `siteConfig.accentColor`.
- Tailwind v4 is loaded with `@tailwindcss/vite`. There is no `tailwind.config.js`.
