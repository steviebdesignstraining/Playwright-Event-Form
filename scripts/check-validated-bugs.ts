import { readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

interface ValidationInfo {
  valid: boolean;
  issues: string[];
  status: 'VALID' | 'INVALID' | 'ERROR' | 'SKIPPED';
  error?: string;
  skipped?: boolean;
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

    if (validationStatus === 'ERROR' || validationStatus === 'SKIPPED') {
      validationErrors.push(item);
      continue;
    }

    if (classification === 'PRODUCT_BUG') {
      if (validationStatus === 'VALID' && item.validation?.valid) {
        bugs.push(item);
      } else {
        nonBugs.push(item);
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

  // Records without a reliable AI classification are never turned into issues, but that is an
  // external outage (Gemini overloaded / quota), not a reason to fail the whole pipeline.
  if (aiFallback.length > 0) {
    console.warn(`WARNING: ${aiFallback.length} records used AI fallback (AI was unavailable) and will NOT get GitHub issues.`);
    for (const item of aiFallback) {
      console.warn(`  FALLBACK: ${item.title} — ${item.aiError ?? 'AI unavailable'}`);
    }
    console.warn('Re-run the workflow once Gemini is available (or fix GEMINI_API_KEY / quota) to have these analysed.');

    if (process.env.GITHUB_ACTIONS) {
      console.log(`::warning title=Issue creation skipped for ${aiFallback.length} failure(s)::Gemini analysis was unavailable, so no GitHub issues were created for them.`);
    }
  }

  if (validationErrors.length > 0) {
    console.error(`ERROR: ${validationErrors.length} records could not be validated.`);
    for (const item of validationErrors) {
      const reason = item.validation?.error || item.validation?.issues?.join(', ') || 'Validation unavailable';
      console.error(`  UNVALIDATED: ${item.title} — ${reason}`);
    }
    console.error('Deterministic validation must succeed for issues to be created.');
    process.exit(1);
  }

  if (unknown.length > 0) {
    console.error(`ERROR: ${unknown.length} validation records have UNKNOWN classification.`);
    for (const item of unknown) {
      console.error(`  UNKNOWN: ${item.title}`);
    }
    console.error('Check analyse-failure.ts and validated-bug.json schema.');
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
