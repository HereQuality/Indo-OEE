// tailwind.config.js
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          800: '#162032',
          900: '#111C2E',
          950: '#0B1220',
        },
        brand: {
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
        },
        stock: {
          in:       '#16A34A',  // compliant / in stock
          low:      '#D97706',  // OFI / low stock
          critical: '#DC2626',  // NC / critical
        },
      },
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        glow:   '0 0 40px -10px rgba(37, 99, 235, 0.5)',
        card:   '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)',
        'card-hover': '0 10px 25px -5px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
      },
      keyframes: {
        floatSlow: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-8px)' },
        },
        fillbar: {
          from: { width: '0%' },
          to:   { width: 'var(--fill)' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        pulse2: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
      },
      animation: {
        floatSlow: 'floatSlow 6s ease-in-out infinite',
        fillbar:   'fillbar 1s ease-out forwards',
        fadeIn:    'fadeIn 0.4s ease-out both',
        slideUp:   'slideUp 0.5s ease-out both',
        pulse2:    'pulse2 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}