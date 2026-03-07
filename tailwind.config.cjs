/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["selector", "class"],
  theme: {
    extend: {
      colors: {
        /* ── TOKENICODE semantic tokens ── */
        /* Usage: bg-bg-primary, text-text-primary, border-border-subtle, etc. */
        'bg': {
          'primary':    'var(--color-bg-primary)',
          'secondary':  'var(--color-bg-secondary)',
          'tertiary':   'var(--color-bg-tertiary)',
          'sidebar':    'var(--color-bg-sidebar)',
          'card':       'var(--color-bg-card)',
          'input':      'var(--color-bg-input)',
        },
        'text': {
          'primary':    'var(--color-text-primary)',
          'secondary':  'var(--color-text-secondary)',
          'tertiary':   'var(--color-text-tertiary)',
          'muted':      'var(--color-text-muted)',
          'inverse':    'var(--color-text-inverse)',
        },
        'border': {
          'DEFAULT':    'var(--color-border)',
          'subtle':     'var(--color-border-subtle)',
          'focus':      'var(--color-border-focus)',
        },
        'accent': {
          'DEFAULT':    'var(--color-accent)',
          'hover':      'var(--color-accent-hover)',
          'glow':       'var(--color-accent-glow)',
        },
        'status': {
          'success':    'var(--color-success)',
          'error':      'var(--color-error)',
          'warning':    'var(--color-warning)',
        },

        /* ── Legacy Shadcn token names (keep for Radix UI components) ── */
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        card: {
          DEFAULT:      'hsl(var(--card))',
          foreground:   'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT:      'hsl(var(--popover))',
          foreground:   'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT:      'hsl(var(--primary))',
          foreground:   'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:      'hsl(var(--secondary))',
          foreground:   'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT:      'hsl(var(--muted))',
          foreground:   'hsl(var(--muted-foreground))',
        },
        destructive: {
          DEFAULT:      'hsl(var(--destructive))',
          foreground:   'hsl(var(--destructive-foreground))',
        },
        input:       'hsl(var(--input))',
        ring:        'hsl(var(--ring))',

        /* ── Literal colors ── */
        blue: {
          400: "#409CFF",
          500: "#0A84FF",
          600: "#0060DF",
        },
        gray: {
          50:  "#fafafa",
          100: "#f4f4f5",
          200: "#e4e4e7",
          300: "#d4d4d8",
          400: "#a1a1aa",
          500: "#71717a",
          600: "#636366",
          700: "#48484A",
          800: "#3A3A3C",
          900: "#2C2C2E",
          950: "#1C1C1E",
        },
        green:  { 100: "#d1fae5", 500: "#10b981" },
        red:    { 100: "#fee2e2", 500: "#ef4444" },
        amber:  { 100: "#fef3c7", 500: "#f59e0b" },
      },
      boxShadow: {
        sm:  "var(--shadow-sm)",
        md:  "var(--shadow-md)",
        lg:  "var(--shadow-lg)",
      },
      borderRadius: {
        sm: "0.375rem",
        md: "0.5rem",
        lg: "0.75rem",
        xl: "0.875rem",
      },
      fontFamily: {
        sans: [
          "'Inter'",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          '"SF Mono"',
          "Consolas",
          '"Liberation Mono"',
          "Menlo",
          "monospace",
        ],
      },
      animation: {
        "fade-in":       "fadeIn 0.5s ease-out",
        "slide-up":      "slideUp 0.5s ease-out",
        "slide-down":    "slideDown 0.3s ease-out",
        "slide-in-right":"slideInRight 0.3s ease-out",
        "pulse-slow":    "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "accordion-down":"accordion-down 0.2s ease-out",
        "accordion-up":  "accordion-up 0.2s ease-out",
      },
      keyframes: {
        fadeIn:       { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp:      { "0%": { transform: "translateY(20px)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
        slideDown:    { "0%": { transform: "translateY(-100%)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
        slideInRight: { "0%": { transform: "translateX(100%)", opacity: "0" }, "100%": { transform: "translateX(0)", opacity: "1" } },
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up":   { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
    },
  },
  plugins: [],
};
