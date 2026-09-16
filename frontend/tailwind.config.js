/** @type {import('tailwindcss').Config} */
const v = name => `rgb(var(--${name}) / <alpha-value>)`
const tint = (name, alpha) => `rgb(var(--${name}) / ${alpha})`

// A status scale: soft fills for 50/100, tinted lines for 200/300, solid ink from 400 up.
const signal = name => ({
  50: v(`${name}-soft`), 100: v(`${name}-soft`),
  200: tint(name, .35), 300: tint(name, .55),
  400: v(name), 500: v(name), 600: v(name), 700: v(name), 800: v(name), 900: v(name),
})

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
        arabic: 'var(--font-arabic)',
      },
      colors: {
        // Semantic surfaces and text
        canvas: v('canvas'),
        surface: v('surface'),
        raised: v('raised'),
        overlay: v('overlay'),
        ink: v('ink'),
        muted: v('muted'),
        faint: v('faint'),
        border: v('border'),
        'border-strong': v('border-strong'),

        // Brand
        accent: v('accent'),
        'accent-strong': v('accent-strong'),
        'accent-soft': v('accent-soft'),
        'on-accent': v('on-accent'),
        glow: v('glow'),
        gold: { DEFAULT: v('gold'), 50: v('gold-soft'), 100: v('gold-soft'), 200: tint('gold', .35), 300: v('gold'), 400: v('gold'), 500: v('gold'), 600: v('gold') },
        'on-gold': '#1a1508',
        highlight: '#E4C46E',
        forest: v('forest'),
        'forest-hover': v('forest-hover'),
        brand: '#236B4F',
        'nav-active': '#E4C46E',
        'text-primary': v('ink'),
        'text-secondary': v('muted'),
        cream: v('canvas'),

        // Status and AI scales — theme aware, so dark mode never shows a white badge.
        red: signal('danger'),
        rose: signal('danger'),
        amber: signal('warning'),
        orange: signal('warning'),
        yellow: signal('warning'),
        emerald: signal('success'),
        green: signal('success'),
        blue: signal('info'),
        sky: signal('info'),
        violet: { ...signal('ai'), 200: v('ai-line'), 300: v('ai-line'), 600: v('ai-solid'), 700: v('ai-solid'), 800: v('ai-strong'), 900: v('ai-strong') },
        purple: signal('ai'),

        // Legacy aliases kept while old class names remain in pages.
        sand: {
          50: v('surface'), 100: v('raised'), 200: v('border'), 300: v('faint'), 400: v('muted'),
          500: v('muted'), 600: v('muted'), 700: v('ink'), 800: v('ink'), 900: v('ink'),
        },
        teal: {
          50: v('accent-soft'), 100: v('accent-soft'), 200: tint('accent', .35), 300: tint('accent', .55),
          400: v('accent'), 500: v('accent'), 600: v('forest'), 700: v('forest-hover'), 800: v('forest-hover'), 900: v('forest-hover'), 950: v('forest-hover'),
        },
        sage: signal('success'),
        terra: { 100: v('danger-soft'), 300: tint('danger', .55), 400: v('danger'), 500: v('danger') },
        slate: { 500: v('muted') },
      },
      borderRadius: {
        card: 'var(--radius-card)',
        control: 'var(--radius-control)',
      },
      boxShadow: {
        card: 'var(--shadow)',
        float: 'var(--shadow-float)',
        glow: '0 0 0 1px rgb(var(--glow) / .35), 0 0 24px rgb(var(--glow) / .25)',
      },
      transitionTimingFunction: { out: 'var(--ease-out)' },
    },
  },
  plugins: [],
}
