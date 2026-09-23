import { readFileSync, appendFileSync } from 'node:fs';
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
}

function loadValidatedBugs(): ValidatedBug[] {
  const path = join(rootDir, 'validated-bug.json');
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  return Array.isArray(data) ? data : [data];
}

function getClassification(item: ValidatedBug): string {
  return (
    item.classification ??
    item.analysis?.classification ??
    item.validation?.classification ??
    'UNKNOWN'
  );
}

function main() {
  const records = loadValidatedBugs();

  const bugs: ValidatedBug[] = [];
  const unknown: ValidatedBug[] = [];
  const nonBugs: ValidatedBug[] = [];

  for (const item of records) {
    const classification = getClassification(item);
    const title = item.title ?? item.test ?? item.analysis?.title ?? 'Unknown test';

    if (classification === 'PRODUCT_BUG') {
      bugs.push(item);
    } else if (classification === 'UNKNOWN') {
      unknown.push({ ...item, classification });
    } else {
      nonBugs.push({ ...item, classification });
    }
  }

  console.log('');
  console.log('========================================');
  console.log('Validated Bug Summary');
  console.log('========================================');
  console.log(`Total records: ${records.length}`);
  console.log(`Product bugs: ${bugs.length}`);
  console.log(`Unknown: ${unknown.length}`);
  console.log(`Non-bugs: ${nonBugs.length}`);
  console.log('========================================');

  for (const bug of bugs) {
    const title = bug.title ?? bug.test ?? bug.analysis?.title ?? 'Unknown test';
    console.log(`BUG: ${title}`);
    console.log('Classification: PRODUCT_BUG');
  }

  if (unknown.length > 0) {
    console.error('');
    console.error('ERROR: Some validation records have no classification.');
    for (const item of unknown) {
      const title = item.title ?? item.test ?? item.analysis?.title ?? 'Unknown test';
      console.error(`UNKNOWN: ${title}`);
    }
    console.error('');
    console.error('Check validate-with-copilot.ts and validated-bug.json schema.');
    console.error('');

    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, 'issues_created=false\n');
    }

    process.exit(1);
  }

  console.log('========================================');

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `issues_created=${bugs.length > 0 ? 'true' : 'false'}\n`
    );
  }
}

main();
