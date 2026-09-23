import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function main() {
  const analysisPath = join(rootDir, 'bug-analysis.json');
  const validatedPath = join(rootDir, 'validated-bug.json');

  if (!existsSync(analysisPath)) {
    console.error('ERROR: bug-analysis.json was not generated.');
    process.exit(1);
  }

  if (!existsSync(validatedPath)) {
    console.error('ERROR: validated-bug.json was not generated.');
    process.exit(1);
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'complete=true\n');
  }

  const analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
  const validated = JSON.parse(readFileSync(validatedPath, 'utf-8'));

  const analyses = Array.isArray(analysis) ? analysis : [analysis];
  const records = Array.isArray(validated) ? validated : [validated];

  let aiFailed = 0;
  let aiSucceeded = 0;
  let validationErrored = 0;
  let validationValid = 0;
  let validationSkipped = 0;

  for (const entry of analyses) {
    const a = entry.analysis;
    if (a?.fallbackUsed || a?.aiAnalysisSucceeded === false) {
      aiFailed++;
    } else {
      aiSucceeded++;
    }
  }

  for (const item of records) {
    const status = item.validation?.status || 'UNKNOWN';
    if (status === 'ERROR') {
      validationErrored++;
    } else if (status === 'SKIPPED') {
      validationSkipped++;
    } else if (status === 'VALID') {
      validationValid++;
    }
  }

  console.log('');
  console.log('========================================');
  console.log('AI Analysis Health Check');
  console.log('========================================');
  console.log(`AI analyses succeeded: ${aiSucceeded}`);
  console.log(`AI analyses failed (fallback): ${aiFailed}`);
  console.log(`Validation: VALID=${validationValid}, ERROR=${validationErrored}, SKIPPED=${validationSkipped}`);
  console.log('========================================');

  if (aiFailed > 0) {
    console.error(`WARNING: ${aiFailed} analyses used fallback (AI was unavailable).`);
    console.error('Issues will NOT be created for fallback analyses.');
  }

  if (validationErrored > 0) {
    console.error(`WARNING: ${validationErrored} validations could not complete (service error).`);
    console.error('Issues will NOT be created for unvalidated bugs.');
  }

  if (validationSkipped > 0) {
    console.error(`WARNING: ${validationSkipped} validations were skipped.`);
  }
}

main();
