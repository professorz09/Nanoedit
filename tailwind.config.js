/** @type {import('tailwindcss').Config} */
export default {
  // Scan every source file so JIT keeps only the classes actually used.
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './contexts/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './types.ts',
  ],
  theme: {
    extend: {
      colors: {
        nano: {
          bg: '#0c0c12', // matches studio charcoal (was flat #0f0f11)
          card: '#1a1a24',
          accent: '#ff3355', // PodcastFlux red — unified brand accent
          accentHover: '#e01840',
          text: '#f5f5f8',
          muted: '#8a8a99',
        },
        // Thumbnail Studio (premium dark / red) theme — richer, cooler charcoal
        thumb: {
          bg: '#0c0c12', // page (deep cool charcoal, not muddy black)
          soft: '#16161f', // inset areas: tab track, inputs
          card: '#1d1d29', // raised cards, active pills (lightest surface)
          ink: '#f5f5f8', // primary text
          sub: '#a2a2b4', // muted text (a touch brighter)
          line: '#2e2e3c', // hairline borders
          red: '#ff3355', // accent — juicier, pops on dark
          redDark: '#e01840',
          redSoft: '#2c1320', // dark maroon chip background
          green: '#2ee6a6', // secondary accent (success / verified)
          greenDark: '#12b981',
          greenSoft: '#0d2a22', // dark mint chip background
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
