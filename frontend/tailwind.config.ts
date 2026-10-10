import type { Config } from "tailwindcss";

/**
 * Parlo1 theme scales. Every value here resolves to a CSS variable defined in
 * src/index.css (see GUI.md and gui/themes/parlo1.md). The default Tailwind
 * palette, type scale, weights, radii and shadows are intentionally replaced so
 * that only theme vocabulary exists as utilities.
 */

const neutrals = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => i + 1).flatMap((n) => [
    [`${n}`, `var(--neutral-${n})`],
    [`${n}-transparent`, `var(--neutral-${n}-transparent)`],
  ]),
);

const palette = Object.fromEntries(
  [1, 2, 3, 4].flatMap((n) => [
    [`${n}`, `var(--color-${n})`],
    [`${n}-transparent`, `var(--color-${n}-transparent)`],
  ]),
);

const spacingTokens = {
  zero: "var(--space-zero)",
  xxs: "var(--space-xxs)",
  xs: "var(--space-xs)",
  s: "var(--space-s)",
  m: "var(--space-m)",
  l: "var(--space-l)",
  xl: "var(--space-xl)",
  xxl: "var(--space-xxl)",
};

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "var(--space-xl)",
      screens: {
        "2xl": "1400px",
      },
    },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",

      // Theme vocabulary
      neutral: neutrals,
      color: palette,
      success: "var(--success)",
      "success-transparent": "var(--success-transparent)",
      warning: "var(--warning)",
      "warning-transparent": "var(--warning-transparent)",
      error: "var(--error)",
      "error-transparent": "var(--error-transparent)",

      // App roles (shadcn aliases, resolved in index.css)
      background: "var(--background)",
      foreground: "var(--foreground)",
      border: "var(--border)",
      input: "var(--input)",
      ring: "var(--ring)",
      primary: {
        DEFAULT: "var(--primary)",
        foreground: "var(--primary-foreground)",
      },
      secondary: {
        DEFAULT: "var(--secondary)",
        foreground: "var(--secondary-foreground)",
      },
      destructive: {
        DEFAULT: "var(--destructive)",
        foreground: "var(--destructive-foreground)",
      },
      muted: {
        DEFAULT: "var(--muted)",
        foreground: "var(--muted-foreground)",
      },
      accent: {
        DEFAULT: "var(--accent)",
        foreground: "var(--accent-foreground)",
      },
      popover: {
        DEFAULT: "var(--popover)",
        foreground: "var(--popover-foreground)",
      },
      card: {
        DEFAULT: "var(--card)",
        foreground: "var(--card-foreground)",
      },
      "nav-active": {
        DEFAULT: "var(--navigation-active-background)",
        foreground: "var(--navigation-active-foreground)",
      },
      badge: {
        DEFAULT: "var(--option-badge-background)",
        foreground: "var(--option-badge-foreground)",
      },

      // Third-party brand colour (see index.css)
      linkedin: "var(--brand-linkedin)",
    },
    fontFamily: {
      ui: "var(--font-ui)",
      brand: "var(--font-brand)",
      editorial: "var(--font-editorial)",
      data: "var(--font-data)",
    },
    fontSize: {
      xxs: ["var(--size-xxs)", { lineHeight: "var(--line-xxs)", letterSpacing: "var(--letter-spacing-xxs)" }],
      xs: ["var(--size-xs)", { lineHeight: "var(--line-xs)", letterSpacing: "var(--letter-spacing-xs)" }],
      s: ["var(--size-s)", { lineHeight: "var(--line-s)", letterSpacing: "var(--letter-spacing-s)" }],
      m: ["var(--size-m)", { lineHeight: "var(--line-m)", letterSpacing: "var(--letter-spacing-m)" }],
      l: ["var(--size-l)", { lineHeight: "var(--line-l)", letterSpacing: "var(--letter-spacing-l)" }],
      xl: ["var(--size-xl)", { lineHeight: "var(--line-xl)", letterSpacing: "var(--letter-spacing-xl)" }],
      xxl: ["var(--size-xxl)", { lineHeight: "var(--line-xxl)", letterSpacing: "var(--letter-spacing-xxl)" }],
    },
    fontWeight: {
      regular: "var(--weight-ui-regular)",
      medium: "var(--weight-ui-medium)",
      heavy: "var(--weight-ui-heavy)",
    },
    lineHeight: {
      none: "1",
      xxs: "var(--line-xxs)",
      xs: "var(--line-xs)",
      s: "var(--line-s)",
      m: "var(--line-m)",
      l: "var(--line-l)",
      xl: "var(--line-xl)",
      xxl: "var(--line-xxl)",
    },
    letterSpacing: {
      xs: "var(--tracking-xs)",
      s: "var(--tracking-s)",
      m: "var(--tracking-m)",
      l: "var(--tracking-l)",
      xl: "var(--tracking-xl)",
    },
    borderRadius: {
      none: "var(--radius-zero)",
      xs: "var(--radius-xs)",
      s: "var(--radius-s)",
      m: "var(--radius-m)",
      l: "var(--radius-l)",
      xl: "var(--radius-xl)",
      full: "var(--radius-full)",
    },
    borderWidth: {
      DEFAULT: "var(--border-s)",
      0: "0px",
      s: "var(--border-s)",
      m: "var(--border-m)",
      l: "var(--border-l)",
    },
    boxShadow: {
      none: "none",
      s: "var(--shadow-s)",
      m: "var(--shadow-m)",
      l: "var(--shadow-l)",
      // Edges are drawn as inset shadows (native border width is zero).
      edge: "inset 0 0 0 1px var(--neutral-4)",
      "edge-t": "inset 0 1px 0 0 var(--neutral-4)",
      "edge-b": "inset 0 -1px 0 0 var(--neutral-4)",
      "edge-l": "inset 1px 0 0 0 var(--neutral-4)",
      "edge-r": "inset -1px 0 0 0 var(--neutral-4)",
      "edge-accent": "inset 0 0 0 1px var(--color-1)",
      "edge-transparent": "inset 0 0 0 1px var(--neutral-4-transparent)",
    },
    transitionDuration: {
      DEFAULT: "var(--motion-duration)",
      large: "var(--motion-large-duration)",
      0: "0ms",
    },
    transitionTimingFunction: {
      DEFAULT: "var(--motion-easing)",
      large: "var(--motion-large-easing)",
      linear: "linear",
    },
    extend: {
      spacing: spacingTokens,
      // Control geometry (checkbox / switch / tracks) resolves controlSize
      // names through the spacing scale, which shares the same key names.
      height: spacingTokens,
      width: spacingTokens,
      size: spacingTokens,
      minHeight: spacingTokens,
      minWidth: spacingTokens,
      scale: {
        popup: "var(--motion-popup-scale)",
      },
      translate: {
        press: "var(--motion-press-distance)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
