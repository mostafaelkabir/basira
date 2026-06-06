/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // New design system tokens
        cream: '#F2EDE4',
        forest: '#1B3A2D',
        accent: '#2D7A6B',
        'nav-active': '#E8C334',
        'text-primary': '#1A1A1A',
        'text-secondary': '#6B6B6B',
        border: '#E8E3DB',
        // Legacy tokens — kept for backward compatibility
        sand: {
          50:  '#faf6f0',
          100: '#F2EDE4',  // mapped to cream
          200: '#E8E3DB',  // mapped to border
          300: '#d4c5b0',
          400: '#b5a08a',
          500: '#9e8c78',
          600: '#6b5a48',
          700: '#4a3c2c',
          800: '#2c2018',
          900: '#1a1208',
        },
        teal: {
          50:  '#e8f4f3',
          100: '#cde9e7',
          200: '#9dd3d0',
          300: '#6dbdba',
          400: '#3aa7a3',
          500: '#2D7A6B',  // mapped to accent
          600: '#1B3A2D',  // mapped to forest
          700: '#164d4b',
          800: '#103836',
          900: '#0a2524',
          950: '#051e1d',
        },
        gold: {
          50:  '#fdf9e8',
          100: '#faf3c0',
          200: '#f5e680',
          300: '#E8C334',  // mapped to nav-active
          400: '#c49a3c',
          500: '#a07a20',
          600: '#7d5e0f',
        },
        sage: {
          50:  '#eef5f0',
          100: '#d5e8d9',
          200: '#acd1b3',
          300: '#7db88a',
          400: '#4a9e64',
          500: '#3a8050',
          600: '#2d6340',
        },
        terra: {
          100: '#f5d5d0',
          300: '#e0917f',
          400: '#E85A4F',
          500: '#9b3a2f',
        },
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
      },
    },
  },
  plugins: [],
}
