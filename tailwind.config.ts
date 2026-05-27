import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper:        "var(--paper)",
        ink:          "var(--ink)",
        slate:        "var(--slate)",
        mute:         "var(--mute)",
        rule:         "var(--rule)",
        rule2:        "var(--rule-2)",
        surface:      "var(--surface)",
        vermilion:    "var(--vermilion)",
        director:     "var(--director)",
        statistician: "var(--statistician)",
        reliability:  "var(--reliability)",
        pattern:      "var(--pattern)",
        synthesis:    "var(--synthesis)",
      },
      fontFamily: {
        sans:  ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono:  ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
