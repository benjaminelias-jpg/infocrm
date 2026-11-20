/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        superficie: 'var(--surface-1)',
        gris: 'var(--surface-2)',
        'gris-2': 'var(--surface-3)',
        lavanda: 'var(--tint)',
        ink: 'var(--ink)',
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
        sans: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
      // Redondeos más suaves y parejos (estilo Kunfupay). Las "pastillas"
      // (rounded-full) quedan solo para círculos: avatares, puntos, interruptores.
      borderRadius: {
        md: '8px',
        lg: '10px',
        xl: '14px',
        '2xl': '20px',
        '3xl': '26px',
      },
    },
  },
  plugins: [],
};
