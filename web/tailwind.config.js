/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        superficie: 'var(--surface-1)',
        plano: 'var(--page-plane)',
        tinta: 'var(--text-primary)',
        'tinta-2': 'var(--text-secondary)',
        apagado: 'var(--text-muted)',
        linea: 'var(--border-hairline)',
        rejilla: 'var(--gridline)',
        s1: 'var(--series-1)',
        s2: 'var(--series-2)',
        s3: 'var(--series-3)',
        bien: 'var(--status-good)',
        aviso: 'var(--status-warning)',
        serio: 'var(--status-serious)',
        critico: 'var(--status-critical)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
