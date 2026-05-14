import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-red-hat-display)", "system-ui", "sans-serif"],
        heading: ["var(--font-red-hat-display)", "system-ui", "sans-serif"],
      },
    },
  },
};

export default config;
