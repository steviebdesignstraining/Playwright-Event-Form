import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface FailureData {
  testName: string;
  status: string;
  project: string;
  error: string;
  expected?: string;
  actual?: string;
  failureType: string;
  branch: string;
  commit: string;
  severity: string;
  priority: string;
  timestamp: string;
  stepsToReproduce?: string[];
  screenshot?: string;
  trace?: string;
  video?: string;
}

interface BugAnalysis {
  title: string;
  summary: string;
  stepsToReproduce: string[];
  expectedResult: string;
  actualResult: string;
  failureType: string;
  severity: string;
  priority: string;
  classification: 'PRODUCT_BUG' | 'TEST_DEFECT' | 'TEST_INFRASTRUCTURE' | 'UNKNOWN';
  confidence: number;
  relevantEvidence: string[];
  aiAnalysisSucceeded: boolean;
  fallbackUsed: boolean;
  aiError?: string;
  error?: string;
  branch?: string;
  commit?: string;
  project?: string;
}

interface AnalysisEntry {
  failure: FailureData;
  analysis: BugAnalysis;
}

class GeminiApiError extends Error {
  status: number;
  body: string;
  retryAfterMs?: number;

  constructor(status: number, body: string, retryAfterMs?: number) {
    super(`Gemini API error (${status}): ${body}`);
    this.name = 'GeminiApiError';
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Gemini answered HTTP 200 but the payload was unusable (empty, truncated, not JSON, wrong shape). */
class GeminiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiOutputError';
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== '' && Number.isFinite(parsed) ? parsed : fallback;
}

const PRIMARY_MODEL = 'gemini-3.6-flash';
// GEMINI_FALLBACK_MODEL may be a comma-separated list, tried in order after the primary model.
// Free-tier quota is tracked per model, so every extra model is an extra daily allowance.
const DEFAULT_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];

const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';

// Retry policy. Prefer waiting over hammering: free-tier quota is only ~20 requests/day/model, so an
// outage must not burn it. Worst case with two models: 3 rounds x 2 models x 2 attempts = 12 requests
// (at most 6 per model), spread over a few minutes and capped by RETRY_BUDGET_MS. A healthy run uses 1.
const ATTEMPTS_PER_MODEL = 2;
const MAX_ROUNDS = 3;
const RETRY_BASE_MS = envNumber('GEMINI_RETRY_BASE_MS', 5000);
const MAX_BACKOFF_MS = RETRY_BASE_MS * 12;
const RETRY_BUDGET_MS = envNumber('GEMINI_RETRY_BUDGET_MS', 10 * 60 * 1000);
const REQUEST_TIMEOUT_MS = envNumber('GEMINI_REQUEST_TIMEOUT_MS', 120_000);
const MAX_OUTPUT_TOKENS = 8192;


const BUG_ANALYSIS_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string', description: 'Specific title describing the affected functionality and observed failure' },
    summary: { type: 'string', description: 'Brief summary of the defect' },
    stepsToReproduce: { type: 'array', items: { type: 'string' }, description: 'Reproduction steps based on actual Playwright test actions' },
    expectedResult: { type: 'string', description: 'What the test expected to happen' },
    actualResult: { type: 'string', description: 'What actually happened (the failure)' },
    failureType: { type: 'string', enum: ['UI', 'API', 'Data', 'Environment', 'Unknown'], description: 'Classification of failure by type' },
    severity: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'], description: 'Severity of the failure' },
    priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'], description: 'Priority of the fix' },
    classification: { type: 'string', enum: ['PRODUCT_BUG', 'TEST_DEFECT', 'TEST_INFRASTRUCTURE', 'UNKNOWN'], description: 'Whether this is a product bug, test defect, test infrastructure issue, or unknown' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence level 0.0-1.0' },
    relevantEvidence: { type: 'array', items: { type: 'string' }, description: 'Relevant evidence references' },
  },
  required: ['title', 'summary', 'stepsToReproduce', 'expectedResult', 'actualResult', 'failureType', 'severity', 'priority', 'classification', 'confidence', 'relevantEvidence'],
  additionalProperties: false,
} as const;

const BATCH_ANALYSIS_SCHEMA = {
  type: 'array' as const,
  items: BUG_ANALYSIS_SCHEMA,
  minItems: 1,
} as const;

const SYSTEM_PROMPT = `You are an AI QA Defect Analysis Agent.

Analyse the supplied Playwright test failures and convert each into a structured software defect.

PRODUCT_BUG = The application behaves incorrectly. A genuine software defect.
TEST_DEFECT = The test expectation or implementation is wrong. The application may be working correctly.
TEST_INFRASTRUCTURE = CI/test environment failure (browser crash, network timeout, environment unavailable).
UNKNOWN = Insufficient evidence to classify confidently.

Use ONLY the evidence provided. Do not invent application behaviour, reproduction steps, expected results, API responses, or environment information.

The bug title must describe the actual failure.
Reproduction steps must be based on actual Playwright test actions.

OUTPUT RULES:
- Return exactly one JSON array of objects, one per failure.
- Do not return Markdown. Do not use code fences. Do not add commentary.
- Keep every string concise.
- Return only the fields defined by the schema.
- If evidence is insufficient, set classification to "UNKNOWN" and confidence to 0.1.`;

function loadFailureData(): FailureData[] {
  const path = join(rootDir, 'failure-data.json');
  if (!existsSync(path)) {
    console.error('No failure-data.json found. Run generate-failure-data.ts first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadTestFile(testName: string): string {
  const possiblePaths = [
    join(rootDir, 'e2e', 'tests', 'browser.spec.ts'),
    join(rootDir, 'e2e', 'tests', 'api.spec.ts'),
    join(rootDir, 'e2e', 'tests', 'usability.spec.ts'),
  ];

  for (const path of possiblePaths) {
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf-8');
    if (content.includes(testName)) {
      return content;
    }
  }
  return '';
}

function loadPageObjects(): string {
  const paths = [
    join(rootDir, 'e2e', 'pages', 'index.page.ts'),
    join(rootDir, 'e2e', 'pages', 'api.pages.ts'),
  ];
  let result = '';
  for (const path of paths) {
    if (existsSync(path)) {
      result += readFileSync(path, 'utf-8') + '\n';
    }
  }
  return result;
}

function loadSelectors(): string {
  const selectorPath = join(rootDir, 'e2e', 'selectors', 'index.ts');
  if (existsSync(selectorPath)) {
    return readFileSync(selectorPath, 'utf-8');
  }
  return '';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function githubAnnotation(level: 'notice' | 'warning' | 'error', title: string, message: string): void {
  if (!process.env.GITHUB_ACTIONS) return;
  const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::${level} title=${escape(title)}::${escape(message)}`);
}

type ErrorKind =
  | 'auth'              // bad/forbidden API key: retrying can never help
  | 'daily_quota'       // per-day quota for this model is used up: skip the model for this run
  | 'model_unavailable' // model name unknown / rejected: skip the model for this run
  | 'rate_limited'      // per-minute limit: wait for the server-provided delay and retry
  | 'transient'         // 5xx, timeouts, network errors, unusable output: back off and retry
  | 'fatal';            // anything else (programming error): do not keep hammering the API

interface ClassifiedError {
  kind: ErrorKind;
  retryAfterMs?: number;
}

function parseRetryDelayMs(body: string): number | undefined {
  const match = body.match(/"retryDelay":\s*"([\d.]+)s"/) ?? body.match(/retry in ([\d.]+)s/i);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : undefined;
}

function parseRetryAfterHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : undefined;
}

function classifyError(error: unknown): ClassifiedError {
  if (error instanceof GeminiApiError) {
    const { status, body } = error;

    if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(body)) {
      return { kind: 'auth' };
    }
    if (status === 400 || status === 404) {
      return { kind: 'model_unavailable' };
    }
    if (status === 429) {
      // The free tier reports RPD (per-day) exhaustion with a misleading short retryDelay,
      // so the quota id decides whether waiting is pointless.
      if (/PerDay|per day/i.test(body)) {
        return { kind: 'daily_quota' };
      }
      return { kind: 'rate_limited', retryAfterMs: error.retryAfterMs ?? parseRetryDelayMs(body) };
    }
    if (status === 408 || status >= 500) {
      return { kind: 'transient', retryAfterMs: error.retryAfterMs };
    }
    return { kind: 'fatal' };
  }

  if (error instanceof GeminiOutputError) {
    return { kind: 'transient' };
  }

  // fetch() rejects with TypeError on network failures; AbortSignal.timeout() raises TimeoutError.
  const name = error instanceof Error ? error.name : '';
  if (name === 'TypeError' || name === 'TimeoutError' || name === 'AbortError') {
    return { kind: 'transient' };
  }

  return { kind: 'fatal' };
}

/** One-line, human-readable error text (the raw Gemini body is a multi-line JSON blob). */
function describeError(error: unknown): string {
  if (error instanceof GeminiApiError) {
    let detail = error.body;
    try {
      const parsed = JSON.parse(error.body);
      const apiError = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
      if (apiError) {
        detail = `${apiError.status ?? ''}: ${apiError.message ?? ''}`.trim();
      }
    } catch {
      // body was not JSON; use it as-is
    }
    return `HTTP ${error.status} ${detail.split('\n')[0]}`.slice(0, 300);
  }

  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.split('\n')[0].slice(0, 300);
}

function extractAnalysisArray(aiResponse: string): BugAnalysis[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(aiResponse);
  } catch {
    const cleaned = aiResponse.trim();
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket === -1 || lastBracket === -1) {
      throw new GeminiOutputError(`Failed to parse Gemini response as JSON: ${aiResponse.substring(0, 200)}`);
    }
    try {
      parsed = JSON.parse(cleaned.substring(firstBracket, lastBracket + 1));
    } catch {
      throw new GeminiOutputError(`Failed to parse Gemini response as JSON: ${aiResponse.substring(0, 200)}`);
    }
  }

  // Some models wrap the array in an object ({"analyses": [...]}); accept that too.
  if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
    parsed = Object.values(parsed as Record<string, unknown>).find(Array.isArray);
  }

  if (!Array.isArray(parsed)) {
    throw new GeminiOutputError('Gemini response was JSON but not an array of analyses');
  }

  return parsed as BugAnalysis[];
}

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  evidence: string
): Promise<BugAnalysis[]> {
  const response = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: evidence },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'batch_analysis',
          strict: true,
          schema: BATCH_ANALYSIS_SCHEMA,
        },
      },
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new GeminiApiError(response.status, responseText, parseRetryAfterHeader(response.headers.get('retry-after')));
  }

  let body: {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    error?: { message?: string };
  };
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new GeminiOutputError(`Gemini returned a non-JSON body: ${responseText.substring(0, 200)}`);
  }

  if (body.error) {
    throw new GeminiOutputError(`Gemini reported an error in a 200 response: ${body.error.message ?? 'unknown'}`);
  }

  const choice = body.choices?.[0];
  const aiResponse = choice?.message?.content || '';

  if (!aiResponse) {
    throw new GeminiOutputError('Gemini API returned no content');
  }

  if (choice?.finish_reason === 'length') {
    throw new GeminiOutputError('Gemini output was truncated (finish_reason=length)');
  }

  return extractAnalysisArray(aiResponse);
}


function buildEvidence(failures: FailureData[]): string {
  const testCodeSamples = new Map<string, string>();
  const pageObjects = loadPageObjects();
  const selectors = loadSelectors();

  for (const f of failures) {
    if (!testCodeSamples.has(f.testName)) {
      testCodeSamples.set(f.testName, loadTestFile(f.testName));
    }
  }

  let codeSection = '';
  for (const [name, code] of testCodeSamples) {
    codeSection += `--- TEST: ${name} ---\n${code || 'Not found'}\n\n`;
  }

  const failuresSection = failures.map((failure, i) => {
    return `FAILURE ${i + 1}:

Test Name: ${failure.testName}
Status: ${failure.status}
Project: ${failure.project}
Failure Type: ${failure.failureType}
Error: ${failure.error}
Expected: ${failure.expected || 'N/A'}
Actual: ${failure.actual || 'N/A'}
Severity: ${failure.severity}
Priority: ${failure.priority}
Branch: ${failure.branch}
Commit: ${failure.commit}
Timestamp: ${failure.timestamp}

Reproduction Steps:
${(failure.stepsToReproduce || []).join('\n')}

Screenshot: ${failure.screenshot || 'none'}
Trace: ${failure.trace || 'none'}
Video: ${failure.video || 'none'}
`;
  }).join('\n\n');

  return `--- FAILURE EVIDENCE (${failures.length} failures) ---

${failuresSection}

--- RELEVANT TEST CODE ---
${codeSection}

--- PAGE OBJECTS ---
${pageObjects || 'Not found'}

--- SELECTORS ---
${selectors || 'Not found'}

--- END EVIDENCE ---`;
}

function createIndividualFallback(failure: FailureData, aiError?: string): BugAnalysis {
  const title = `${failure.testName} — ${failure.project} project`;

  return {
    title,
    summary: `Test failed with error: ${failure.error.split('\n')[0] || failure.error}`,
    stepsToReproduce: failure.stepsToReproduce || [`Run: npx playwright test --project=${failure.project}`, `Filter: "${failure.testName}"`],
    expectedResult: failure.expected || 'Not specified in failure data',
    actualResult: failure.actual || failure.error,
    failureType: failure.failureType,
    severity: failure.severity,
    priority: failure.priority,
    classification: 'UNKNOWN',
    confidence: 0.1,
    relevantEvidence: [],
    aiAnalysisSucceeded: false,
    fallbackUsed: true,
    aiError: aiError ? `AI analysis failed: ${aiError}` : 'Evidence-only fallback (AI analysis unavailable)',
    error: aiError ? `AI analysis failed: ${aiError}. Fallback based on evidence only.` : 'Evidence-only fallback (AI analysis unavailable)',
    branch: failure.branch,
    commit: failure.commit,
    project: failure.project,
  };
}

function resolveModelChain(): string[] {
  const primary = process.env.GEMINI_MODEL || PRIMARY_MODEL;
  const fallbacks = (process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODELS.join(','))
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

/**
 * Sends the batch to Gemini, moving through the model chain until one succeeds.
 *
 *  - transient errors (503/500/timeouts/bad output) -> exponential backoff, then next model
 *  - per-minute 429                                 -> wait the server-provided delay
 *  - per-day 429 / unknown model                    -> skip that model immediately (waiting cannot help)
 *  - auth errors                                    -> stop immediately
 *
 * If every model fails the chain is retried after a longer pause, until RETRY_BUDGET_MS is spent.
 * Throws only after all of that; the caller turns the error into evidence-only fallback records.
 */
async function analyseWithResilience(
  failures: FailureData[],
  apiKey: string,
  models: string[]
): Promise<BugAnalysis[]> {
  const evidence = buildEvidence(failures);
  const deadline = Date.now() + RETRY_BUDGET_MS;
  const skipped = new Map<string, ErrorKind>();
  let lastError: unknown;

  console.log(`Model chain: ${models.join(' -> ')}`);

  rounds:
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const candidates = models.filter(m => !skipped.has(m));
    if (candidates.length === 0) break;

    if (round > 1) {
      const pause = RETRY_BASE_MS * 6 * (round - 1);
      if (Date.now() + pause >= deadline) {
        console.warn('  → Retry budget exhausted. Giving up.');
        break;
      }
      console.log(`  Every available model failed in round ${round - 1}. Pausing ${Math.round(pause / 1000)}s before round ${round}/${MAX_ROUNDS}...`);
      await sleep(pause);
    }

    for (const model of candidates) {
      for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
        console.log(`  [round ${round}/${MAX_ROUNDS}] ${model} attempt ${attempt}/${ATTEMPTS_PER_MODEL}...`);

        try {
          const analyses = await callGemini(apiKey, model, SYSTEM_PROMPT, evidence);
          console.log(`  ✓ Analysis succeeded with ${model}`);
          return analyses;
        } catch (error) {
          lastError = error;
          const { kind, retryAfterMs } = classifyError(error);
          console.warn(`    ✗ ${describeError(error)} [${kind}]`);

          if (kind === 'auth' || kind === 'fatal') {
            console.error('  → Error cannot be fixed by retrying. Stopping.');
            break rounds;
          }

          if (kind === 'daily_quota' || kind === 'model_unavailable') {
            console.warn(`  → ${model} is unusable for this run (${kind}). Moving to the next model.`);
            skipped.set(model, kind);
            break;
          }

          if (attempt === ATTEMPTS_PER_MODEL) {
            console.warn(`  → ${model} still failing after ${ATTEMPTS_PER_MODEL} attempts. Moving to the next model.`);
            break;
          }

          const backoff = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
          const jitter = Math.floor(Math.random() * Math.min(1000, RETRY_BASE_MS));
          const delay = Math.min((retryAfterMs ?? backoff) + jitter, MAX_BACKOFF_MS * 1.5);

          if (Date.now() + delay >= deadline) {
            console.warn('  → Retry budget exhausted. Giving up.');
            break rounds;
          }

          console.log(`    Retrying ${model} in ${Math.round(delay / 1000)}s...`);
          await sleep(delay);
        }
      }
    }
  }

  const tried = models.map(m => (skipped.has(m) ? `${m} (${skipped.get(m)})` : m)).join(', ');
  throw new Error(`All Gemini models failed [${tried}]. Last error: ${describeError(lastError)}`);
}

async function main() {
  console.log('Analysing failures with Gemini...');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const models = resolveModelChain();

  const failures = loadFailureData();

  if (failures.length === 0) {
    console.log('No failures to analyse.');
    writeFileSync(join(rootDir, 'bug-analysis.json'), '[]');
    return;
  }

  const uniqueFailures: FailureData[] = Array.from(
    new Map(
      failures.map(f => [`${f.testName}|${f.project}|${f.error}`, f] as const)
    ).values()
  );

  if (uniqueFailures.length < failures.length) {
    console.log(`Deduplicated ${failures.length} failures to ${uniqueFailures.length} unique.`);
  }

  console.log(`Failures available for AI analysis: ${uniqueFailures.length}`);
  console.log(`Sending batched request for all ${uniqueFailures.length} failures in a single API call.`);

  let analyses: BugAnalysis[];
  try {
    analyses = await analyseWithResilience(uniqueFailures, apiKey, models);
  } catch (error) {
    // Never crash the job on a Gemini outage: record evidence-only fallbacks instead. The health
    // check and issue-creation steps see fallbackUsed=true, skip issue creation and report why.
    const reason = error instanceof Error ? error.message : String(error);
    console.error('  → Gemini analysis unavailable. Writing evidence-only fallback records so the pipeline can finish.');
    console.error(`  → ${reason}`);
    githubAnnotation('warning', 'Gemini analysis unavailable', reason);
    analyses = uniqueFailures.map(f => createIndividualFallback(f, reason));
  }

  if (analyses.length !== uniqueFailures.length) {
    console.warn(`  → Gemini returned ${analyses.length} analyses for ${uniqueFailures.length} failures. Using fallback for missing ones.`);
  }


  const entries: AnalysisEntry[] = uniqueFailures.map((failure, i) => {
    let analysis = analyses[i];

    if (!analysis) {
      analysis = createIndividualFallback(failure, 'Missing analysis in batch response');
    }

    const fullAnalysis: BugAnalysis = {
      title: analysis.title || `${failure.testName} — ${failure.project}`,
      summary: analysis.summary || '',
      stepsToReproduce: analysis.stepsToReproduce || [],
      expectedResult: analysis.expectedResult || '',
      actualResult: analysis.actualResult || '',
      failureType: analysis.failureType || failure.failureType,
      severity: analysis.severity || failure.severity,
      priority: analysis.priority || failure.priority,
      classification: analysis.classification || 'UNKNOWN',
      confidence: typeof analysis.confidence === 'number' ? analysis.confidence : 0,
      relevantEvidence: analysis.relevantEvidence || [],
      aiAnalysisSucceeded: !analysis.fallbackUsed,
      fallbackUsed: analysis.fallbackUsed || false,
      aiError: analysis.aiError,
      error: analysis.error,
      branch: failure.branch,
      commit: failure.commit,
      project: failure.project,
    };

    if (fullAnalysis.fallbackUsed) {
      console.log(`  → FALLBACK: ${fullAnalysis.title}`);
      console.log(`  → Error: ${fullAnalysis.aiError}`);
    } else {
      console.log(`  → Title: ${fullAnalysis.title}`);
      console.log(`  → Classification: ${fullAnalysis.classification}`);
      console.log(`  → Confidence: ${fullAnalysis.confidence}`);
    }

    return { failure, analysis: fullAnalysis };
  });

  const outputPath = join(rootDir, 'bug-analysis.json');
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(entries, null, 2));
  console.log(`\nAI analyses: ${entries.length}`);
  console.log(`Analysis written to: ${outputPath}`);
}

main();