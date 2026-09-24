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
  let validationInvalid = 0;

  for (const entry of analyses) {
    const a = entry.analysis;
    if (a?.fallbackUsed || a?.aiAnalysisSucceeded === false) {
      aiFailed++;
    } else {
      aiSucceeded++;
    }
  }

  for (const item of records) {
    const status = item.validation?.status || 'ERROR';
    if (status === 'VALID') {
      validationValid++;
    } else if (status === 'INVALID') {
      validationInvalid++;
    } else {
      validationErrored++;
    }
  }

  console.log('');
  console.log('========================================');
  console.log('AI Analysis Health Check');
  console.log('========================================');
  console.log(`Failures analysed: ${analyses.length}`);
  console.log(`AI analyses succeeded: ${aiSucceeded}`);
  console.log(`AI analyses failed (fallback): ${aiFailed}`);
  console.log(`Validation: VALID=${validationValid}, INVALID=${validationInvalid}, ERROR=${validationErrored}`);
  console.log('========================================');

  if (aiFailed > 0) {
    console.error(`ERROR: ${aiFailed} analyses used fallback (AI was unavailable).`);
    console.error('Gemini API key may be invalid or quota exceeded.');
    console.error('Fix GEMINI_API_KEY and re-run.');
    console.error('STATUS: FAILED');
    process.exit(1);
  }

  if (validationErrored > 0) {
    console.error(`ERROR: ${validationErrored} records have validation errors.`);
    console.error('STATUS: FAILED');
    process.exit(1);
  }

  if (validationValid === 0 && validationInvalid === 0) {
    console.error('ERROR: No valid or invalid records found.');
    console.error('STATUS: FAILED');
    process.exit(1);
  }

  console.log(`STATUS: HEALTHY`);
}

main();
