/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // CSS variables with fallbacks for dynamic theming
        'display': ['var(--font-heading, Inter)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        'sans': ['var(--font-body, Inter)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        'mono': ['var(--font-mono, "JetBrains Mono")', 'Fira Code', 'monospace'],
      },
      colors: {
        // Primary palette - CSS variables with fallbacks
        primary: {
          50: 'var(--color-primary-50, #EEF2FF)',
          100: 'var(--color-primary-100, #E0E7FF)',
          200: 'var(--color-primary-200, #C7D2FE)',
          300: 'var(--color-primary-300, #A5B4FC)',
          400: 'var(--color-primary-400, #818CF8)',
          500: 'var(--color-primary-500, #6366F1)',
          600: 'var(--color-primary-600, #4F46E5)',
          700: 'var(--color-primary-700, #4338CA)',
          800: 'var(--color-primary-800, #3730A3)',
          900: 'var(--color-primary-900, #312E81)',
        },
        // Accent palette - CSS variables with fallbacks
        accent: {
          50: 'var(--color-accent-50, #ECFDF5)',
          100: 'var(--color-accent-100, #D1FAE5)',
          200: 'var(--color-accent-200, #A7F3D0)',
          300: 'var(--color-accent-300, #6EE7B7)',
          400: 'var(--color-accent-400, #34D399)',
          500: 'var(--color-accent-500, #10B981)',
          600: 'var(--color-accent-600, #059669)',
          700: 'var(--color-accent-700, #047857)',
          800: 'var(--color-accent-800, #065F46)',
          900: 'var(--color-accent-900, #064E3B)',
        },
        // Success palette
        success: {
          50: 'var(--color-success-50, #F0FDF4)',
          100: 'var(--color-success-100, #DCFCE7)',
          500: 'var(--color-success-500, #22C55E)',
          600: 'var(--color-success-600, #16A34A)',
          700: 'var(--color-success-700, #15803D)',
        },
        // Warning palette
        warning: {
          50: 'var(--color-warning-50, #FFFBEB)',
          100: 'var(--color-warning-100, #FEF3C7)',
          500: 'var(--color-warning-500, #F59E0B)',
          600: 'var(--color-warning-600, #D97706)',
          700: 'var(--color-warning-700, #B45309)',
        },
        // Error palette
        error: {
          50: 'var(--color-error-50, #FEF2F2)',
          100: 'var(--color-error-100, #FEE2E2)',
          500: 'var(--color-error-500, #EF4444)',
          600: 'var(--color-error-600, #DC2626)',
          700: 'var(--color-error-700, #B91C1C)',
        },
        // Slate palette - kept as hardcoded for neutral colors
        slate: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
          950: '#020617',
        },
      },
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)',
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
        'elevated': '0 10px 40px -10px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'glow': '0 0 20px rgba(99, 102, 241, 0.3)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'scale-in': 'scaleIn 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
}
