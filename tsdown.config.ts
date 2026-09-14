import { defineConfig } from 'tsdown';
import { resolve } from 'node:path';

// GitHub Actions runs `dist/index.js` straight from the checked-out repo - there
// is no install step and no node_modules at runtime, so EVERYTHING (including
// @actions/*, fast-xml-parser, csv-parse) has to be bundled into that
// one CommonJS file, and the result has to be committed.
export default defineConfig({
  entry: { index: 'src/main.ts' },
  outDir: 'dist',
  format: 'cjs',
  platform: 'node',
  target: 'node24',
  // nothing may stay external - see above
  deps: { alwaysBundle: /.*/ },
  // see src/undiciShim.ts
  alias: { undici: resolve('src/undiciShim.ts') },
  nodeProtocol: 'strip',
  // action.yml points at dist/index.js
  outExtensions: () => ({ js: '.js' }),
  treeshake: true,
  // the committed bundle is generated output nobody reads, and `setFailed`
  // reports messages rather than stacks - a 4 MB sourcemap in git buys nothing
  minify: true,
  sourcemap: false,
  clean: true,
  dts: false,
});
