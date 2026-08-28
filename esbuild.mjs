import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
// Hai entry: extension chạy trong Extension Host, mcp chạy như tiến trình CON của agent
// điều phối. Tách bundle vì cái thứ hai không được phép chạm tới API vscode.
const ctx = await esbuild.context({
  entryPoints: { extension: 'src/extension.ts', mcp: 'src/orch/mcp.ts' },
  bundle: true,
  outdir: 'dist',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: !watch,
});

if (watch) { await ctx.watch(); console.log('watching...'); }
else { await ctx.rebuild(); await ctx.dispose(); }
