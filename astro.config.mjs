// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
// Custom domain for GitHub Pages. Project-site base path is not used.
export default defineConfig({
  site: "https://prewiredai.com",
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
