import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f1224',
        ink2: '#171a30',
        paper: '#ffffff',
        // cream/cream2 kept as token names but cooled to subtle blue-grays
        cream: '#f3f6fd',
        cream2: '#eaf0fc',
        mist: '#f3f6fd',
        line: '#e5e8f2',
        lineDark: 'rgba(255,255,255,0.10)',
        muted: '#5b607a',
        faint: '#9498ab',
        brand: {
          50: '#eef1ff',
          100: '#dee3ff',
          400: '#5b6bff',
          DEFAULT: '#4f46e5',
          600: '#4038d1',
          700: '#322bb0',
        },
        teal: {
          DEFAULT: '#0fb894',
          light: '#e3faf3',
        },
        amber: {
          DEFAULT: '#f59e0b',
          light: '#fff3e0',
        },
        danger: '#e0453f',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        grotesk: ['var(--font-grotesk)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-manrope)', 'system-ui', '-apple-system', 'sans-serif'],
      },
      letterSpacing: {
        tightest: '-0.035em',
      },
      // Type scale (guidelines for sizes) — a fixed modular ramp
      fontSize: {
        eyebrow: ['0.8125rem', { lineHeight: '1', letterSpacing: '0.16em' }],
        display1: ['clamp(2.9rem, 6.2vw, 5.2rem)', { lineHeight: '1.02', letterSpacing: '-0.025em' }],
        display2: ['clamp(2.2rem, 4.6vw, 3.6rem)', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        display3: ['clamp(1.9rem, 3.4vw, 2.7rem)', { lineHeight: '1.08', letterSpacing: '-0.015em' }],
      },
      // Spacing guidelines — tight section rhythm
      spacing: {
        section: '4rem',
        'section-lg': '5.5rem',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(120deg, #5b6bff 0%, #4f46e5 100%)',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,18,36,.04), 0 12px 32px -12px rgba(15,18,36,.10)',
        card: '0 1px 2px rgba(15,18,36,.04), 0 22px 44px -20px rgba(15,18,36,.16)',
        glow: '0 0 0 1px rgba(255,255,255,.06), 0 30px 80px -24px rgba(79,70,229,.45)',
      },
      borderRadius: {
        xl2: '1.4rem',
      },
    },
  },
  plugins: [],
};

export default config;
