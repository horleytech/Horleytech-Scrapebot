import { defineConfig } from 'vite';
// vite.config.js
import react from '@vitejs/plugin-react';
import postcss from 'postcss';
import flowbitePlugin from 'flowbite/plugin';
import tailwindcssPlugin from 'tailwindcss/plugin';

export default defineConfig({
  plugins: [
    react(),
    {
      ...postcss(),
      apply: 'build', // or 'serve' if you want PostCSS to process styles during development
    },
    flowbitePlugin({
      // Your flowbite plugin options here
    }),
    tailwindcssPlugin(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});