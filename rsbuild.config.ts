import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: { entry: { index: './app.ts' } },
  html: { template: './index.html' },
  server: { host: '127.0.0.1' },
  tools: {
    rspack(config) {
      config.resolve ??= {};
      config.resolve.extensionAlias = {
        ...config.resolve.extensionAlias,
        '.js': ['.js', '.ts'],
      };
    },
  },
});
