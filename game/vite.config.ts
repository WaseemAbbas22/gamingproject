import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 8080,
    host: '127.0.0.1'
  },
  build: {
    outDir: '../app/src/main/assets',
    emptyOutDir: false,
    assetsDir: 'pc',
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        name: 'ForzaLegends',
        inlineDynamicImports: true
      }
    }
  },
  plugins: [
    {
      name: 'webview-file-protocol',
      // Only rewrite scripts for Android WebView APK builds.
      // Browser/dev must keep type="module" or CSS/JS never load.
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          if (ctx.server) return html;
          return html
            .replace(/\s+crossorigin(="[^"]*")?/g, '')
            .replace(/<script type="module" src=/g, '<script defer src=')
            .replace(/<script src=/g, '<script defer src=');
        }
      }
    }
  ]
});
