/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        ink: '#0A0C10',
        panel: '#12151C',
        panel2: '#171B24',
        line: '#232936',
        fog: '#E8EAF0',
        muted: '#8A93A6',
        accent: '#34D399',
        danger: '#F87171',
        warn: '#FBBF24',
      },
      fontFamily: {
        mono: ['Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
