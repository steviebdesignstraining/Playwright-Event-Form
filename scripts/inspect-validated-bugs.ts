import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

interface ValidatedBug {
  title?: string;
  test?: string;
  classification?: string;
  analysis?: { classification?: string; title?: string };
  validation?: { classification?: string };
  [key: string]: unknown;
}

function main() {
  console.log('');
  console.log('========================================');
  console.log('validated-bug.json (full contents)');
  console.log('========================================');

  let data: unknown;
  try {
    const path = join(rootDir, 'validated-bug.json');
    const raw = readFileSync(path, 'utf-8');
    console.log(raw);
    data = JSON.parse(raw);
  } catch (e) {
    console.log('No validated-bug.json found.');
    return;
  }

  const records = Array.isArray(data) ? data : [data];

  console.log('');
  console.log('========================================');
  console.log('Top-level keys per record');
  console.log('========================================');

  records.forEach((item: any, index: number) => {
    console.log(`Record ${index + 1}:`);
    console.log('Top-level keys:', Object.keys(item).join(', '));

    console.log(
      'classification:',
      item.classification ?? 'MISSING'
    );

    console.log(
      'analysis.classification:',
      item.analysis?.classification ?? 'MISSING'
    );

    console.log(
      'validation.classification:',
      item.validation?.classification ?? 'MISSING'
    );

    console.log('');
  });
}

main();
