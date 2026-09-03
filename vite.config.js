import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  base: '/vex-cad/',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1400
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'node_modules/@sunbox/occt-import-js/dist/occt-import-js.js', dest: 'occt' },
        { src: 'node_modules/@sunbox/occt-import-js/dist/occt-import-js.wasm', dest: 'occt' }
      ]
    })
  ]
});
