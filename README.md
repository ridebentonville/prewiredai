# prewiredai.com

Public portfolio for Bryce Nelson, an AI implementer and GTM tool builder for small and field-service teams. Based in Bella Vista, Arkansas.

This site is built from [devportfolio](https://github.com/RyanFitzgerald/devportfolio) by Ryan Fitzgerald. That template is MIT licensed. This project keeps the license and the original copyright. See [LICENSE.md](LICENSE.md).

## Develop

```bash
npm ci
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

All public copy lives in `src/config.ts`. Sections with an empty list are hidden. Do not invent metrics, clients, testimonials, dates, or skills. If a fact is missing, mark it `TODO` in that file.

## Deploy

GitHub Actions builds the site and deploys it to GitHub Pages on a push to `main`. Other branches, including pull requests, do not deploy.

The Astro site URL is `https://prewiredai.com`. `public/CNAME` contains `prewiredai.com`.

Nothing is live until `main` is updated and GitHub Pages is set to GitHub Actions. DNS records and the Pages settings are written up in the pull request that introduces this site.

## Privacy

Do not name the current employer anywhere in the site, including code comments and commit messages. The public description is "operations leader at a national smart-home company." Do not add a phone number.
