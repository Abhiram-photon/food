/**
 * Server build: bundles the TypeScript sources into `dist/` with esbuild.
 *
 * Why esbuild instead of `tsc` emit? Node ESM requires explicit file extensions
 * in relative imports, which makes the shared-schema alias awkward and forces
 * `.js` suffixes that Vite then has to resolve back to `.ts`. Bundling sidesteps
 * the whole question: relative imports are inlined, dependencies stay external.
 * `npm run typecheck` still runs the full TypeScript compiler over the sources.
 */
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

const entries = ['src/index.ts', 'src/seed.ts'];

await rm('dist', { recursive: true, force: true });

const result = await build({
  entryPoints: entries,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

if (result.errors.length > 0) process.exit(1);
console.log('[build] server bundled to dist/');
