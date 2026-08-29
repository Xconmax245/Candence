import type { Config } from "tailwindcss";

/**
 * Cadence design system (DIRECTIVE §11) — tokens mirrored into Tailwind so both
 * utility classes and the CSS custom properties in globals.css stay in lockstep.
 * Hex values, radii, and the spacing scale are reused VERBATIM per §11.10.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: "#09090b",
        graphite: "#18181b",
        slate: "#27272a",
        iron: "#3f3f46",
        steel: "#52525b",
        fog: "#71717a",
        ash: "#a1a1aa",
        mist: "#d4d4d8",
        cloud: "#ececee",
        paper: "#f4f4f5",
        snow: "#ffffff",
        // accent — Cadence keeps the reference's role structure, distinct hue.
        ember: "#ff5a00",
        "ember-soft": "#fff1e9",
      },
      fontFamily: {
        sans: ['"DM Sans"', "ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "Roboto", "sans-serif"],
        mono: ['"DM Mono"', "ui-monospace", '"SF Mono"', "Menlo", "Consolas", "monospace"],
      },
      borderRadius: {
        card: "32px",
        ctrl: "14px",
        badge: "12px",
        pill: "999px",
      },
      maxWidth: {
        shell: "1320px",
      },
      spacing: {
        section: "80px",
        "pad-card": "28px",
      },
    },
  },
  plugins: [],
};
export default config;
