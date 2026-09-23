import { readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

interface ValidationInfo {
  valid: boolean;
  issues: string[];
  classification: string;
  skipped: boolean;
  status: 'VALID' | 'INVALID' | 'SKIPPED' | 'ERROR';
  error?: string;
}

interface ValidatedBug {
  title: string;
  summary: string;
  stepsToReproduce: string[];
  expectedResult: string;
  actualResult: string;
  failureType: string;
  severity: string;
  priority: string;
  classification: string;
  confidence: number;
  relevantEvidence: string[];
  aiAnalysisSucceeded: boolean;
  fallbackUsed: boolean;
  aiError?: string;
  error?: string;
  branch?: string;
  commit?: string;
  project?: string;
  validation: ValidationInfo;
}

function loadValidatedBugs(): ValidatedBug[] {
  const path = join(rootDir, 'validated-bug.json');
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  return Array.isArray(data) ? data : [data];
}

function main() {
  const records = loadValidatedBugs();

  const bugs: ValidatedBug[] = [];
  const unknown: ValidatedBug[] = [];
  const nonBugs: ValidatedBug[] = [];
  const validationErrors: ValidatedBug[] = [];
  const aiFallback: ValidatedBug[] = [];

  for (const item of records) {
    const classification = item.classification || 'UNKNOWN';
    const validationStatus = item.validation?.status || 'ERROR';
    const fallbackUsed = item.fallbackUsed ?? false;
    const aiSucceeded = item.aiAnalysisSucceeded ?? false;

    if (!aiSucceeded || fallbackUsed) {
      aiFallback.push(item);
      continue;
    }

    if (validationStatus === 'ERROR') {
      validationErrors.push(item);
      continue;
    }

    if (validationStatus === 'SKIPPED') {
      validationErrors.push(item);
      continue;
    }

    if (classification === 'PRODUCT_BUG') {
      if (validationStatus === 'VALID' && item.validation?.valid) {
        bugs.push(item);
      } else if (validationStatus === 'INVALID') {
        nonBugs.push(item);
      } else {
        unknown.push(item);
      }
    } else if (classification === 'UNKNOWN') {
      unknown.push(item);
    } else {
      nonBugs.push(item);
    }
  }

  console.log('');
  console.log('========================================');
  console.log('Validated Bug Summary');
  console.log('========================================');
  console.log(`Total records: ${records.length}`);
  console.log(`Product bugs (AI + validated): ${bugs.length}`);
  console.log(`AI fallback/unavailable: ${aiFallback.length}`);
  console.log(`Validation errors/skipped: ${validationErrors.length}`);
  console.log(`Unknown classification: ${unknown.length}`);
  console.log(`Non-bugs (TEST_DEFECT/etc): ${nonBugs.length}`);
  console.log('========================================');

  for (const bug of bugs) {
    console.log(`BUG: ${bug.title}`);
    console.log(`  Classification: PRODUCT_BUG`);
    console.log(`  Confidence: ${(bug.confidence * 100).toFixed(0)}%`);
    console.log(`  Validation: ${bug.validation?.status}`);
  }

  console.log('========================================');

  if (aiFallback.length > 0) {
    console.error('');
    console.error(`ERROR: ${aiFallback.length} records used AI fallback (AI analysis was unavailable).`);
    for (const item of aiFallback) {
      console.error(`  FALLBACK: ${item.title} — ${item.aiError ?? 'AI unavailable'}`);
    }
    console.error('');
    console.error('AI analysis must succeed for issues to be created. Fix OPENAI_API_KEY / credits and re-run.');
    process.exit(1);
  }

  if (validationErrors.length > 0) {
    console.error('');
    console.error(`ERROR: ${validationErrors.length} records could not be validated (Copilot validation unavailable).`);
    for (const item of validationErrors) {
      console.error(`  UNVALIDATED: ${item.title} — ${item.validation?.error ?? 'Validation skipped'}`);
    }
    console.error('');
    console.error('Copilot validation must succeed for issues to be created. Check COPILOT_GITHUB_TOKEN and endpoint.');
    process.exit(1);
  }

  if (unknown.length > 0) {
    console.error('');
    console.error(`ERROR: ${unknown.length} validation records have UNKNOWN classification.`);
    for (const item of unknown) {
      console.error(`  UNKNOWN: ${item.title}`);
    }
    console.error('');
    console.error('Check validate-with-copilot.ts and validated-bug.json schema.');
    process.exit(1);
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `issues_created=${bugs.length > 0 ? 'true' : 'false'}\n`
    );
  }
}

main();
