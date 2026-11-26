import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: { entry: { index: './src/app.ts' } },
  html: { template: './src/index.html' },
  output: { assetPrefix: 'auto' },
  server: { host: '127.0.0.1' },
  tools: {
    rspack: {
      module: {
        rules: [
          {
            test: /\.(?:glsl|vert|frag)$/i,
            resourceQuery: /[?&]raw(?:&|=|$)/,
            type: 'asset/source',
          },
        ],
      },
    },
  },
});
