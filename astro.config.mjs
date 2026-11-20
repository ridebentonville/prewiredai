// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
// Custom domain for GitHub Pages. Project-site base path is not used.
export default defineConfig({
  site: "https://prewiredai.com",
  vite: {
    plugins: [tailwindcss()],
  },
});
