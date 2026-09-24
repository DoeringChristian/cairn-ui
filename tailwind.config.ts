import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./embed.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      colors: {
        // Semantic palette through the RGB-triplet tokens in src/index.css, so
        // opacity modifiers like `bg-bg-elevated/90` work.
        bg: {
          DEFAULT: "rgb(var(--color-bg-rgb) / <alpha-value>)",
          elevated: "rgb(var(--color-bg-elevated-rgb) / <alpha-value>)",
          hover: "rgb(var(--color-bg-hover-rgb) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--color-fg-rgb) / <alpha-value>)",
          muted: "rgb(var(--color-fg-muted-rgb) / <alpha-value>)",
          subtle: "rgb(var(--color-fg-subtle-rgb) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--color-border-rgb) / <alpha-value>)",
          subtle: "rgb(var(--color-border-subtle-rgb) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--color-accent-rgb) / <alpha-value>)",
          hover: "rgb(var(--color-accent-hover-rgb) / <alpha-value>)",
        },
        status: {
          running: "#bf8700",
          completed: "#1a7f37",
          failed: "#cf222e",
          killed: "#8b949e",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
