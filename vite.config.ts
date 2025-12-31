import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig(({ mode }) => {
  // Fix: Cast process to any to avoid 'Property cwd does not exist on type Process' error
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          { src: 'sw.js', dest: '' },
          { src: 'manifest.json', dest: '' }
        ]
      })
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    },
    build: {
      outDir: 'dist',
      sourcemap: true
    }
  };
});