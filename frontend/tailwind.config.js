/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // All color tokens reference CSS custom properties defined in index.css.
        // Switching html.dark class changes all values instantly — no component changes needed.
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          active: 'var(--color-primary-active)',
          container: 'var(--color-primary-container)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          hover: 'var(--color-secondary-hover)',
        },
        surface: {
          DEFAULT: 'var(--color-surface)',
          variant: 'var(--color-surface-variant)',
          elevated: 'var(--color-surface-elevated)',
        },
        background: 'var(--color-background)',
        on: {
          surface: 'var(--color-on-surface)',
          primary: 'var(--color-on-primary)',
          'primary-container': 'var(--color-on-primary-container)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          disabled: 'var(--color-text-disabled)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          disabled: 'var(--color-border-disabled)',
        },
        error: {
          DEFAULT: 'var(--color-error)',
          hover: 'var(--color-error-hover)',
          container: 'var(--color-error-container)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          container: 'var(--color-success-container)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          container: 'var(--color-warning-container)',
          on: 'var(--color-warning-on)',
        },
        info: {
          DEFAULT: 'var(--color-info)',
          container: 'var(--color-info-container)',
          on: 'var(--color-info-on)',
        },
        // Column accent colors
        col: {
          todo: 'var(--color-col-todo)',
          'in-progress': 'var(--color-col-in-progress)',
          done: 'var(--color-col-done)',
          'in-progress-pill': 'var(--color-col-in-progress-pill)',
          'done-pill': 'var(--color-col-done-pill)',
        },
        // Badge colors — CSS vars so they switch with theme
        badge: {
          'task-text': 'var(--color-badge-task-text)',
          'research-text': 'var(--color-badge-research-text)',
          'done-text': 'var(--color-badge-done-text)',
        },
        // Terminal colors — always dark, NOT overridden in html.dark block
        terminal: {
          bg: '#0D0D0F',
          text: '#E0E0E0',
          'input-bg': 'rgba(255,255,255,0.06)',
          stderr: '#FF6961',
          prompt: '#0A84FF',
        },
        // OPTCG card search theme — T-007 (ADR-1 §3.7)
        optcg: {
          red: 'var(--color-optcg-red)',
          blue: 'var(--color-optcg-blue)',
          green: 'var(--color-optcg-green)',
          yellow: 'var(--color-optcg-yellow)',
          purple: 'var(--color-optcg-purple)',
          black: 'var(--color-optcg-black)',
          gold: 'var(--color-optcg-gold)',
          navy: 'var(--color-optcg-navy)',
          'navy-light': 'var(--color-optcg-navy-light)',
          'card-bg': 'var(--color-optcg-card-bg)',
          'card-border': 'var(--color-optcg-card-border)',
        },
      },
      borderRadius: {
        xs: '6px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        card: '14px',
        modal: '20px',
        full: '9999px',
      },
      boxShadow: {
        // Dark mode uses layered rgba shadows + white inner ring.
        // Light mode values are defined in the light palette (lower opacity, no white rings).
        // Shadow tokens reference CSS custom properties for the color parts that change between modes.
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        modal: 'var(--shadow-modal)',
        // OPTCG card shadows — T-007 (ADR-1 §3.7)
        'optcg-card': 'var(--shadow-optcg-card)',
        'optcg-card-hover': 'var(--shadow-optcg-card-hover)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ["'JetBrains Mono'", 'Menlo', 'Consolas', "'DejaVu Sans Mono'", "'Courier New'", 'monospace'],
        // T-020: slab serif for OPTCG page headers only
        slab: ["'Roboto Slab'", 'Georgia', 'serif'],
      },
      height: {
        header: '64px',
      },
      width: {
        terminal: '420px',
        column: '300px',
      },
      transitionTimingFunction: {
        // Apple-standard easing for all transitions
        apple: 'cubic-bezier(0.4, 0, 0.2, 1)',
        // Spring easing for scale/press animations
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-bottom': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // ADR-1 (task-detail-edit): right-side panel entry animation ≤ 200ms.
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        'scale-in': 'scale-in 250ms cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-in-bottom': 'slide-in-bottom 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        // ADR-1 (task-detail-edit): NFR-1 — open/close ≤ 200 ms.
        'slide-in-right': 'slide-in-right 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
