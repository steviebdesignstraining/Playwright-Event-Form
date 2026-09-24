import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function classifyAiError(error: string): string {
  const lower = error.toLowerCase();

  if (['400', '401', '403'].some(c => error.includes(c)) ||
      lower.includes('invalid auth') ||
      lower.includes('invalid key') ||
      lower.includes('unauthorized') ||
      lower.includes('forbidden') ||
      lower.includes('permission denied')) {
    return 'AUTHENTICATION_FAILURE';
  }

  if (lower.includes('429') ||
      lower.includes('quota') ||
      lower.includes('rate limit')) {
    return 'QUOTA_EXHAUSTED';
  }

  if (lower.includes('503') ||
      lower.includes('service_unavailable') ||
      lower.includes('unavailable') ||
      lower.includes('500') ||
      lower.includes('internal server error')) {
    return 'SERVICE_UNAVAILABLE';
  }

  if (lower.includes('no credits') || lower.includes('insufficient')) {
    return 'NO_CREDITS';
  }

  return 'UNKNOWN_ERROR';
}

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
  let firstAiError = '';
  let firstAiErrorType = '';
  let fallbackUsed = false;

  for (const entry of analyses) {
    const a = entry.analysis;
    if (a?.fallbackUsed || a?.aiAnalysisSucceeded === false) {
      aiFailed++;
      fallbackUsed = true;
      if (!firstAiError && (a?.aiError || a?.error)) {
        firstAiError = a.aiError || a.error || '';
      }
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
    firstAiErrorType = classifyAiError(firstAiError);

    console.error('========================================');
    console.error('AI SERVICE STATUS: UNAVAILABLE');
    console.error('========================================');
    console.error(`Error type: ${firstAiErrorType}`);
    console.error(`Error detail: ${firstAiError}`);
    console.error('');

    if (firstAiErrorType === 'AUTHENTICATION_FAILURE') {
      console.error('The GEMINI_API_KEY is invalid or lacks permissions.');
      console.error('Fix: Create a new authorization key at https://aistudio.google.com/apikey');
    } else if (firstAiErrorType === 'QUOTA_EXHAUSTED' || firstAiErrorType === 'NO_CREDITS') {
      console.error('The Gemini API quota has been exhausted.');
      console.error('Fix: Wait for quota reset or upgrade to paid tier at https://aistudio.google.com');
    } else if (firstAiErrorType === 'SERVICE_UNAVAILABLE') {
      console.error('Gemini generation service is temporarily unavailable (HTTP 503).');
      console.error('Fix: Re-run the workflow. The service should recover automatically.');
    } else {
      console.error('Gemini API encountered an unexpected error.');
      console.error('Fix: Check the error message and retry the workflow.');
    }

    console.error('');
    if (firstAiErrorType === 'SERVICE_UNAVAILABLE') {
      console.error('Generation request failed due to service unavailability.');
    } else {
      console.error('The API key was verified during authentication, but the');
      console.error('generation request failed. No GitHub issues will be created.');
    }
    console.error('STATUS: FAILED');
    process.exit(1);
  }

  if (validationErrored > 0) {
    console.error(`ERROR: ${validationErrored} records have validation errors.`);
    console.error('STATUS: FAILED');
    process.exit(1);
  }

  if (validationValid === 0) {
    console.error('WARNING: No records passed validation.');
    console.error('STATUS: FAILED');
    process.exit(1);
  }

  console.log('STATUS: HEALTHY');
}

main();
