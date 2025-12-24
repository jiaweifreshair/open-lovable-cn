// This file contains the configuration strings for setting up the E2B sandbox environment
// It mimics the project's local configuration to ensure style consistency

// Colors from colors.json
const colors = {
  "heat-4": { "hex": "fa5d190a", "p3": "0.980392 0.364706 0.098039 / 0.039216" },
  "heat-8": { "hex": "fa5d1914", "p3": "0.980392 0.364706 0.098039 / 0.078431" },
  "heat-12": { "hex": "fa5d191f", "p3": "0.980392 0.364706 0.098039 / 0.121569" },
  "heat-16": { "hex": "fa5d1929", "p3": "0.980392 0.364706 0.098039 / 0.160784" },
  "heat-20": { "hex": "fa5d1933", "p3": "0.980392 0.364706 0.098039 / 0.200000" },
  "heat-40": { "hex": "fa5d1966", "p3": "0.980392 0.364706 0.098039 / 0.400000" },
  "heat-90": { "hex": "fa5d19e6", "p3": "0.980392 0.364706 0.098039 / 0.900000" },
  "heat-100": { "hex": "fa5d19ff", "p3": "0.980392 0.364706 0.098039 / 1.000000" },
  "accent-black": { "hex": "262626ff", "p3": "0.149020 0.149020 0.149020 / 1.000000" },
  "accent-white": { "hex": "ffffffff", "p3": "1.000000 1.000000 1.000000 / 1.000000" },
  "accent-amethyst": { "hex": "9061ffff", "p3": "0.564706 0.380392 1.000000 / 1.000000" },
  "accent-bluetron": { "hex": "2a6dfbff", "p3": "0.164706 0.427451 0.984314 / 1.000000" },
  "accent-crimson": { "hex": "eb3424ff", "p3": "0.921569 0.203922 0.141176 / 1.000000" },
  "accent-forest": { "hex": "42c366ff", "p3": "0.258824 0.764706 0.400000 / 1.000000" },
  "accent-honey": { "hex": "ecb730ff", "p3": "0.925490 0.717647 0.188235 / 1.000000" },
  "black-alpha-1": { "hex": "00000003", "p3": "0.000000 0.000000 0.000000 / 0.011765" },
  "black-alpha-2": { "hex": "00000005", "p3": "0.000000 0.000000 0.000000 / 0.019608" },
  "black-alpha-3": { "hex": "00000008", "p3": "0.000000 0.000000 0.000000 / 0.031373" },
  "black-alpha-4": { "hex": "0000000a", "p3": "0.000000 0.000000 0.000000 / 0.039216" },
  "black-alpha-5": { "hex": "0000000d", "p3": "0.000000 0.000000 0.000000 / 0.050980" },
  "black-alpha-6": { "hex": "0000000f", "p3": "0.000000 0.000000 0.000000 / 0.058824" },
  "black-alpha-7": { "hex": "00000012", "p3": "0.000000 0.000000 0.000000 / 0.070588" },
  "black-alpha-8": { "hex": "00000014", "p3": "0.000000 0.000000 0.000000 / 0.078431" },
  "black-alpha-10": { "hex": "0000001a", "p3": "0.000000 0.000000 0.000000 / 0.101961" },
  "black-alpha-12": { "hex": "0000001f", "p3": "0.000000 0.000000 0.000000 / 0.121569" },
  "black-alpha-16": { "hex": "00000029", "p3": "0.000000 0.000000 0.000000 / 0.160784" },
  "black-alpha-20": { "hex": "00000033", "p3": "0.000000 0.000000 0.000000 / 0.200000" },
  "black-alpha-24": { "hex": "0000003d", "p3": "0.000000 0.000000 0.000000 / 0.239216" },
  "black-alpha-32": { "hex": "26262652", "p3": "0.149020 0.149020 0.149020 / 0.321569" },
  "black-alpha-40": { "hex": "26262666", "p3": "0.149020 0.149020 0.149020 / 0.400000" },
  "black-alpha-48": { "hex": "2626267a", "p3": "0.149020 0.149020 0.149020 / 0.478431" },
  "black-alpha-56": { "hex": "2626268f", "p3": "0.149020 0.149020 0.149020 / 0.560784" },
  "black-alpha-64": { "hex": "262626a3", "p3": "0.149020 0.149020 0.149020 / 0.639216" },
  "black-alpha-72": { "hex": "262626b8", "p3": "0.149020 0.149020 0.149020 / 0.721569" },
  "black-alpha-88": { "hex": "262626e0", "p3": "0.149020 0.149020 0.149020 / 0.878431" },
  "white-alpha-56": { "hex": "ffffff8f", "p3": "1.000000 1.000000 1.000000 / 0.560784" },
  "white-alpha-72": { "hex": "ffffffb8", "p3": "1.000000 1.000000 1.000000 / 0.721569" },
  "border-faint": { "hex": "edededff", "p3": "0.929412 0.929412 0.929412 / 1.000000" },
  "border-muted": { "hex": "e8e8e8ff", "p3": "0.909804 0.909804 0.909804 / 1.000000" },
  "border-loud": { "hex": "e6e6e6ff", "p3": "0.901961 0.901961 0.901961 / 1.000000" },
  "illustrations-faint": { "hex": "edededff", "p3": "0.929412 0.929412 0.929412 / 1.000000" },
  "illustrations-muted": { "hex": "e6e6e6ff", "p3": "0.901961 0.901961 0.901961 / 1.000000" },
  "illustrations-default": { "hex": "dbdbdbff", "p3": "0.858824 0.858824 0.858824 / 1.000000" },
  "background-lighter": { "hex": "fbfbfbff", "p3": "0.984314 0.984314 0.984314 / 1.000000" },
  "background-base": { "hex": "f9f9f9ff", "p3": "0.976471 0.976471 0.976471 / 1.000000" }
};

// Tailwind Config Template
export const TAILWIND_CONFIG = `
import defaultTheme from 'tailwindcss/defaultTheme';

const colorsJson = ${JSON.stringify(colors, null, 2)};

const colors = Object.keys(colorsJson).reduce(
  (acc, key) => {
    acc[key] = "var(--" + key + ")";
    return acc;
  },
  {}
);

const sizes = Array.from({ length: 1000 }, (_, i) => i).reduce(
  (acc, curr) => {
    acc[curr] = curr + "px";
    return acc;
  },
  {
    max: "max-content",
    unset: "unset",
    full: "100%",
    inherit: "inherit",
    "1/2": "50%",
    "1/3": "33.3%",
    "2/3": "66.6%",
    "1/4": "25%",
    "1/6": "16.6%",
    "2/6": "33.3%",
    "3/6": "50%",
    "4/6": "66.6%",
    "5/6": "83.3%"
  }
);

const opacities = Array.from({ length: 100 }, (_, i) => i).reduce(
  (acc, curr) => {
    acc[curr] = curr / 100 + "";
    return acc;
  },
  {}
);

const transitionDurations = Array.from({ length: 60 }, (_, i) => i).reduce(
  (acc, curr) => {
    acc[curr] = curr * 50 + "";
    return acc;
  },
  {}
);

export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "var(--font-inter)", ...defaultTheme.fontFamily.sans],
        mono: ["var(--font-geist-mono)", ...defaultTheme.fontFamily.mono],
        ascii: ["var(--font-roboto-mono)", ...defaultTheme.fontFamily.mono]
      },
      fontSize: {
        "title-h1": ["60px", { "lineHeight": "64px", "letterSpacing": "-0.3px", "fontWeight": "500" }],
        "title-h2": ["52px", { "lineHeight": "56px", "letterSpacing": "-0.52px", "fontWeight": "500" }],
        "title-h3": ["40px", { "lineHeight": "44px", "letterSpacing": "-0.4px", "fontWeight": "500" }],
        "title-h4": ["32px", { "lineHeight": "36px", "letterSpacing": "-0.32px", "fontWeight": "500" }],
        "title-h5": ["24px", { "lineHeight": "32px", "letterSpacing": "-0.24px", "fontWeight": "500" }],
        "body-x-large": ["20px", { "lineHeight": "28px", "letterSpacing": "-0.1px", "fontWeight": "400" }],
        "body-large": ["16px", { "lineHeight": "24px", "letterSpacing": "0px", "fontWeight": "400" }],
        "body-medium": ["14px", { "lineHeight": "20px", "letterSpacing": "0.14px", "fontWeight": "400" }],
        "body-small": ["13px", { "lineHeight": "20px", "letterSpacing": "0px", "fontWeight": "400" }],
        "body-input": ["15px", { "lineHeight": "24px", "letterSpacing": "0px", "fontWeight": "400" }],
        "label-x-large": ["20px", { "lineHeight": "28px", "letterSpacing": "-0.1px", "fontWeight": "450" }],
        "label-large": ["16px", { "lineHeight": "24px", "letterSpacing": "0px", "fontWeight": "450" }],
        "label-medium": ["14px", { "lineHeight": "20px", "letterSpacing": "0px", "fontWeight": "450" }],
        "label-small": ["13px", { "lineHeight": "20px", "letterSpacing": "0px", "fontWeight": "450" }],
        "label-x-small": ["12px", { "lineHeight": "20px", "letterSpacing": "0px", "fontWeight": "450" }],
        "mono-medium": ["14px", { "lineHeight": "22px", "letterSpacing": "0px", "fontWeight": "400" }],
        "mono-small": ["13px", { "lineHeight": "20px", "letterSpacing": "0px", "fontWeight": "500" }],
        "mono-x-small": ["12px", { "lineHeight": "16px", "letterSpacing": "0px", "fontWeight": "400" }],
        "title-blog": ["28px", { "lineHeight": "36px", "letterSpacing": "-0.28px", "fontWeight": "500" }]
      },
      colors: {
        transparent: "transparent",
        current: "currentColor",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        ...colors
      },
      screens: {
        xs: { min: "390px" },
        "xs-max": { max: "389px" },
        sm: { min: "576px" },
        "sm-max": { max: "575px" },
        md: { min: "768px" },
        "md-max": { max: "767px" },
        lg: { min: "996px" },
        "lg-max": { max: "995px" },
        xl: { min: "1200px" },
        "xl-max": { max: "1199px" }
      },
      opacity: opacities,
      spacing: { ...sizes, 'root': 'var(--root-padding)' },
      width: sizes,
      maxWidth: sizes,
      height: sizes,
      inset: sizes,
      borderWidth: sizes,
      backdropBlur: Array.from({ length: 20 }, (_, i) => i).reduce(
        (acc, curr) => {
          acc[curr] = curr + "px";
          return acc;
        },
        {}
      ),
      transitionTimingFunction: { DEFAULT: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
      transitionDuration: { DEFAULT: "200ms", ...transitionDurations },
      transitionDelay: { ...transitionDurations },
      borderRadius: (() => {
        const radius = {
          full: "999px",
          inherit: "inherit",
          0: "0px",
          lg: "var(--radius)",
          md: "calc(var(--radius) - 2px)",
          sm: "calc(var(--radius) - 4px)",
        };
        for (let i = 1; i <= 32; i += 1) {
          radius[i] = i + "px";
        }
        return radius;
      })()
    }
  },
  plugins: [
    require("@tailwindcss/typography"),
  ]
}
`;

// Index CSS Template (inlined content from styles/design-system/*)
export const INDEX_CSS = `/* Fire Design System - Sandbox Inlined Version */

/* --- design-system/base/reset.css --- */
*, *::before, *::after { box-sizing: border-box; }
body, h1, h2, h3, h4, h5, h6, p, figure, blockquote, dl, dd { margin: 0; }
ul[role='list'], ol[role='list'] { list-style: none; padding: 0; margin: 0; }
html:focus-within { scroll-behavior: smooth; }
body { min-height: 100vh; text-rendering: optimizeSpeed; line-height: 1.5; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
a:not([class]) { text-decoration-skip-ink: auto; }
img, picture, video, canvas, svg { display: block; max-width: 100%; }
input, button, textarea, select { font: inherit; }
button { background: none; border: none; padding: 0; cursor: pointer; text-align: inherit; color: inherit; }
:focus { outline: none; }

/* --- design-system/colors.css --- */
:root {
  --white: #ffffff;
  --black: #000000;
  --heat-4: rgba(250, 93, 25, 0.039);
  --heat-8: rgba(250, 93, 25, 0.078);
  --heat-12: rgba(250, 93, 25, 0.122);
  --heat-16: rgba(250, 93, 25, 0.161);
  --heat-20: rgba(250, 93, 25, 0.200);
  --heat-40: rgba(250, 93, 25, 0.400);
  --heat-100: #fa5d19;
  --heat-200: #ff6600;
  --accent-black: #262626;
  --accent-white: #ffffff;
  --accent-amethyst: #9061ff;
  --accent-bluetron: #2a6dfb;
  --accent-crimson: #eb3424;
  --black-alpha-1: rgba(0, 0, 0, 0.012);
  --black-alpha-2: rgba(0, 0, 0, 0.020);
  --black-alpha-4: rgba(0, 0, 0, 0.039);
  --black-alpha-10: rgba(0, 0, 0, 0.102);
  --black-alpha-32: rgba(38, 38, 38, 0.322);
  --black-alpha-64: rgba(38, 38, 38, 0.639);
  --white-alpha-56: rgba(255, 255, 255, 0.561);
  --white-alpha-72: rgba(255, 255, 255, 0.722);
  --border-faint: #ededed;
  --border-muted: #e8e8e8;
  --border-loud: #e6e6e6;
  --background-lighter: #fbfbfb;
  --background-base: #f9f9f9;
  --foreground: #262626;
  
  /* Additional Tailwind Base Colors */
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --secondary: 240 4.8% 95.9%;
  --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --ring: 240 10% 3.9%;
  --radius: 0.5rem;
}

/* --- design-system/typography.css --- */
/* Font Faces skipped for sandbox - relying on system fonts or CDN if needed */
:root {
  --font-sans: 'SuisseIntl', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Roboto Mono', Consolas, monospace;
}

.title-h1 { font-size: 4rem; line-height: 1.1; letter-spacing: -0.02em; font-weight: 600; }
.title-h2 { font-size: 2.25rem; line-height: 1.2; letter-spacing: -0.02em; font-weight: 500; }
.title-h3 { font-size: 1.875rem; line-height: 1.25; letter-spacing: -0.02em; font-weight: 500; }
.title-h4 { font-size: 1.375rem; line-height: 1.3; letter-spacing: -0.01em; font-weight: 500; }
.body-large { font-size: 1.125rem; line-height: 1.6; font-weight: 400; }
.body-medium { font-size: 1rem; line-height: 1.5; font-weight: 400; }

/* --- design-system/utilities.css --- */
.gradient-fire { background: linear-gradient(135deg, var(--heat-100) 0%, var(--accent-crimson) 100%); }
.gradient-ocean { background: linear-gradient(135deg, var(--accent-bluetron) 0%, var(--accent-amethyst) 100%); }
.text-gradient { background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-color: var(--heat-100); }
.heat-glow { box-shadow: 0 0 40px rgba(250, 93, 25, 0.3); animation: heat-glow 3s ease-in-out infinite; }
@keyframes heat-glow { 0%, 100% { box-shadow: 0 0 20px rgba(250, 93, 25, 0.2); } 50% { box-shadow: 0 0 40px rgba(250, 93, 25, 0.4); } }

/* Tailwind Directives */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* --- design-system/base/body.css --- */
body {
  font-family: var(--font-sans);
  font-size: 1rem;
  line-height: 1.5;
  color: var(--accent-black);
  background-color: var(--background-base);
}

a { color: inherit; text-decoration: none; transition: color 0.2s ease; }
a:hover { color: var(--heat-100); }
`;

// Vite Config Template
export const VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 49999,
  },
});
`;

// Utils.js Template
export const UTILS_JS = `import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
`;