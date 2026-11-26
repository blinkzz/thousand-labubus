import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: { entry: { index: './app.ts' } },
  html: { template: './index.html' },
  output: { assetPrefix: 'auto' },
  server: { host: '127.0.0.1' },
});
