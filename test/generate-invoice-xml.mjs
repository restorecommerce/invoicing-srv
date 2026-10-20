import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'output', 'e-invoice');
mkdirSync(output, { recursive: true });
const bundle = join(output, 'generate-fixture.cjs');
const xmlFile = join(output, 'fixture-invoice.xml');
await build({
  stdin: {
    contents: `
      import { writeFileSync } from 'node:fs';
      import { createEInvoiceFixture } from './test/fixtures/e-invoice.ts';
      import { generateInvoiceXml } from './src/e-invoice.ts';
      const { invoice, records } = createEInvoiceFixture();
      generateInvoiceXml(invoice, records).then(xml => writeFileSync(process.argv[2], xml))
        .catch(error => { console.error(error); process.exitCode = 1; });
    `,
    resolveDir: root,
    sourcefile: 'generate-fixture.ts',
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  logLevel: 'silent',
});
const result = spawnSync(process.execPath, [bundle, xmlFile], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Generated invoice XML: ' + xmlFile);
