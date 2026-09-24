import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function githubAnnotation(level: 'notice' | 'warning' | 'error', title: string, message: string): void {
  if (!process.env.GITHUB_ACTIONS) return;
  const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::${level} title=${escape(title)}::${escape(message)}`);
}

function writeOutput(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function classifyAiError(error: string): string {
  const lower = error.toLowerCase();
  // aiError strings written by analyse-failure.ts look like "... HTTP 503 UNAVAILABLE: ..."
  const status = error.match(/HTTP (\d{3})/)?.[1] ?? '';

  if (['400', '401', '403'].includes(status) ||
      lower.includes('api_key_invalid') ||
      lower.includes('invalid auth') ||
      lower.includes('invalid key') ||
      lower.includes('unauthorized') ||
      lower.includes('forbidden') ||
      lower.includes('permission denied')) {
    return 'AUTHENTICATION_FAILURE';
  }

  if (lower.includes('daily_quota') ||
      status === '429' ||
      lower.includes('quota') ||
      lower.includes('rate limit')) {
    return 'QUOTA_EXHAUSTED';
  }

  if (['500', '502', '503', '504'].includes(status) ||
      lower.includes('service_unavailable') ||
      lower.includes('unavailable') ||
      lower.includes('internal server error') ||
      lower.includes('timeout')) {
    return 'SERVICE_UNAVAILABLE';
  }

  if (lower.includes('no credits') || lower.includes('insufficient')) {
    return 'NO_CREDITS';
  }

  return 'UNKNOWN_ERROR';
}

function adviceFor(errorType: string): string {
  switch (errorType) {
    case 'AUTHENTICATION_FAILURE':
      return 'GEMINI_API_KEY is invalid or lacks permissions. Create a new key at https://aistudio.google.com/apikey and update the repository secret.';
    case 'QUOTA_EXHAUSTED':
    case 'NO_CREDITS':
      return 'Gemini quota is exhausted (free tier is limited per model per day). Wait for the daily reset, enable billing, or add more models to the GEMINI_FALLBACK_MODEL repository variable (comma-separated).';
    case 'SERVICE_UNAVAILABLE':
      return 'Gemini was overloaded (HTTP 503) for the whole retry window. Re-run the workflow later, or add more models to the GEMINI_FALLBACK_MODEL repository variable (comma-separated).';
    default:
      return 'Gemini returned an unexpected error. Check the error detail above and re-run the workflow.';
  }
}

function writeStepSummary(markdown: string): void {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
  }
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

  for (const entry of analyses) {
    const a = entry.analysis;
    if (a?.fallbackUsed || a?.aiAnalysisSucceeded === false) {
      aiFailed++;
      if (!firstAiError && (a?.aiError || a?.error)) {
        firstAiError = a.aiError || a.error || '';
      }
    } else {
      aiSucceeded++;
    }
  }

  // Records produced by the evidence-only fallback are expected to be INVALID; they must not
  // count against the validation health of records the AI actually analysed.
  let aiRecordsValid = 0;
  for (const item of records) {
    const status = item.validation?.status || 'ERROR';
    const isFallback = item.fallbackUsed || item.aiAnalysisSucceeded === false;

    if (status === 'VALID') {
      validationValid++;
      if (!isFallback) aiRecordsValid++;
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

  const aiDegraded = aiFailed > 0;
  writeOutput('ai_degraded', aiDegraded ? 'true' : 'false');

  // A Gemini outage is an external condition, not a defect in this repository: report it loudly
  // (log, annotation, job summary) but let the pipeline finish. Issues are never created from
  // fallback records (see check-validated-bugs.ts / create-github-issue.ts).
  if (aiDegraded) {
    const errorType = classifyAiError(firstAiError);
    const advice = adviceFor(errorType);

    console.warn('========================================');
    console.warn('AI SERVICE STATUS: DEGRADED');
    console.warn('========================================');
    console.warn(`Error type: ${errorType}`);
    console.warn(`Error detail: ${firstAiError}`);
    console.warn(`Records without AI analysis: ${aiFailed} of ${analyses.length}`);
    console.warn(`Advice: ${advice}`);
    console.warn('No GitHub issues will be created for records without AI analysis.');
    console.warn('========================================');

    githubAnnotation(
      'warning',
      `Gemini analysis unavailable for ${aiFailed}/${analyses.length} failures (${errorType})`,
      `${advice}\n${firstAiError}`
    );

    writeStepSummary([
      '### ⚠️ AI analysis degraded',
      '',
      `${aiFailed} of ${analyses.length} failures could not be analysed by Gemini, so **no GitHub issues will be created for them**.`,
      '',
      `- **Error type:** ${errorType}`,
      `- **Detail:** \`${firstAiError.replace(/`/g, "'")}\``,
      `- **What to do:** ${advice}`,
      '',
      'The raw failure evidence is still available in the `playwright-evidence` and `ai-analysis` artifacts and in the Allure report.',
    ].join('\n'));
  }

  if (validationErrored > 0) {
    console.error(`ERROR: ${validationErrored} records have validation errors.`);
    console.error('STATUS: FAILED');
    process.exit(1);
  }

   if (aiSucceeded > 0 && aiRecordsValid === 0) {
    console.warn('WARNING: No AI-analysed records passed validation.');
    console.warn('Records without AI analysis are expected to be INVALID; they must not count against validation health.');
    console.warn('STATUS: DEGRADED (pipeline continues, but no issues will be created)');
    writeOutput('complete', 'true');
  }

  writeOutput('complete', 'true');
  console.log(aiDegraded ? 'STATUS: DEGRADED (pipeline continues, AI unavailable)' : 'STATUS: HEALTHY');
}

main();
