// Builds dist/index.html: one file with the stylesheet, the engine, the client
// and the compressed word list inside it. That is the whole deliverable — it
// opens from disk, and it is what GitHub Pages serves.
import { build, context } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js', // never written: write is false, the path only names the output
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'firefox115', 'safari16'],
  loader: { '.txt': 'text', '.gz': 'binary' },
  minify: !watch,
  sourcemap: false,
  write: false,
  logLevel: 'info',
  legalComments: 'none',
};

async function assemble(result) {
  const script = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
  if (!script) throw new Error('esbuild produced no script');
  if (script.includes('</script')) throw new Error('the bundle contains a closing script tag');
  const style = await readFile('src/ui/style.css', 'utf8');
  const template = await readFile('src/index.html', 'utf8');
  const page = template.replace('/*STYLE*/', () => style).replace('/*SCRIPT*/', () => script);
  await mkdir('dist', { recursive: true });
  await writeFile('dist/index.html', page);
  // Pages serves the directory as it is; this keeps Jekyll out of it.
  await writeFile('dist/.nojekyll', '');
  // The word lists that are not baked in: fetched when their language is
  // picked. English is inside the page so it opens from disk.
  await mkdir('dist/lang', { recursive: true });
  await copyFile('src/data/uk/Words.lex.gz', 'dist/lang/uk.lex.gz');
  console.log(`dist/index.html: ${(page.length / 1024).toFixed(0)} KB, plus dist/lang/uk.lex.gz`);
}

if (watch) {
  const ctx = await context({
    ...options,
    plugins: [{
      name: 'assemble',
      setup(pluginBuild) {
        pluginBuild.onEnd(async (result) => {
          if (result.errors.length === 0) await assemble(result);
        });
      },
    }],
  });
  await ctx.watch();
  console.log('watching src/ — open dist/index.html and reload after a change');
} else {
  await assemble(await build(options));
}
