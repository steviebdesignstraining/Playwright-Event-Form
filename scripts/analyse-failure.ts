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

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const GEMINI_MODEL = 'gemini-3.8-flash';
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];

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

const FAILURE_SCHEMA = {
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
  items: FAILURE_SCHEMA,
  minItems: 1,
} as const;

const SYSTEM_PROMPT = `You are an AI QA Defect Analysis Agent.

Analyse the supplied Playwright test failures and convert each into a structured software defect.

PRODUCT_BUG = The application behaves incorrectly. A genuine software defect.
TEST_DEFECT = The test expectation or implementation is wrong. The application may be working correctly.
TEST_INFRASTRUCTURE = CI/test environment failure (browser crash, network timeout, environment unavailable).
UNKNOWN = Insufficient evidence to classify confidently.

Use ONLY the evidence provided. Do not invent application behaviour, reproduction steps, expected results, API responses, or environment information that is not present in the evidence.

The bug title must describe the actual failure — not generic titles like "Playwright test failed" or "Automated test failure".

Reproduction steps must be based on the actual Playwright test actions.

Return a JSON array of bug analysis objects, one per failure, matching the provided schema.`;

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

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  evidence: string
): Promise<BugAnalysis[]> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: evidence },
      ],
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

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    let errorDetail = errorBody;
    let retryDelay: string | undefined;

    try {
      const parsed = JSON.parse(errorBody);
      errorDetail = parsed.error?.message || parsed.message || errorBody;
      const details = parsed.error?.details || [];
      for (const d of details) {
        if (d.metadata?.retryDelay) {
          retryDelay = d.metadata.retryDelay;
        }
      }
    } catch {
      // use raw error body
    }

    const err = new Error(`Gemini API error (${response.status}): ${errorDetail}`);
    if (retryDelay) {
      (err as { retryDelay?: string }).retryDelay = retryDelay;
    }
    throw err;
  }

  const body = await response.json() as {
    choices?: Array<{ message: { content: string } }>;
    error?: { message: string };
  };

  if (body.error) {
    throw new Error(`Gemini API error: ${body.error.message}`);
  }

  const aiResponse = body.choices?.[0]?.message?.content || '';

  if (!aiResponse) {
    throw new Error('Gemini API returned no content');
  }

  try {
    return JSON.parse(aiResponse) as BugAnalysis[];
  } catch {
    const cleaned = aiResponse.trim();
    const firstBrace = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBrace !== -1 && lastBracket !== -1) {
      const extracted = cleaned.substring(firstBrace, lastBracket + 1);
      return JSON.parse(extracted) as BugAnalysis[];
    }
    throw new Error(`Failed to parse Gemini response as JSON: ${aiResponse.substring(0, 200)}`);
  }
}

function parseRetryDelay(delay: string): number {
  const match = delay.match(/(\d+)([smh]?)/);
  if (!match) return 60000;
  const num = parseInt(match[1], 10);
  const unit = match[2] || 's';
  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 3600 * 1000;
    default: return num * 1000;
  }
}

async function analyseWithRetry(
  failures: FailureData[],
  apiKey: string,
  model: string
): Promise<BugAnalysis[]> {
  const evidence = buildEvidence(failures);

  let lastError: string | undefined;
  let retryDelayMs: number | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`  Attempt ${attempt}/${MAX_ATTEMPTS} with ${model}...`);
      const analyses = await callGemini(apiKey, model, SYSTEM_PROMPT, evidence);
      return analyses;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      const errWithDelay = error as { retryDelay?: string; httpStatus?: number };
      retryDelayMs = errWithDelay.retryDelay ? parseRetryDelay(errWithDelay.retryDelay) : undefined;

      console.warn(`    Attempt ${attempt} failed: ${lastError}`);

      const lowerErr = lastError.toLowerCase();

      const isAuthError =
        ['400', '401', '403'].some(c => lastError.includes(c)) ||
        lowerErr.includes('invalid auth') ||
        lowerErr.includes('invalid key') ||
        lowerErr.includes('unauthorized') ||
        lowerErr.includes('forbidden') ||
        lowerErr.includes('permission denied');

      if (isAuthError) {
        console.error('  → Gemini API authentication/permission error. Stopping retries.');
        break;
      }

      const isQuotaError =
        lastError.includes('429') ||
        lowerErr.includes('quota') ||
        lowerErr.includes('rate limit exceeded');

      if (isQuotaError) {
        console.error('  → Gemini API quota/rate limit exceeded. Stopping retries immediately.');
        break;
      }

      const is5xx =
        lastError.includes('503') ||
        lastError.includes('500') ||
        lowerErr.includes('service_unavailable') ||
        lowerErr.includes('internal server error') ||
        lowerErr.includes('unavailable');

      if (!is5xx && !isQuotaError) {
        console.error('  → Non-retryable error. Stopping.');
        break;
      }

      if (attempt === MAX_ATTEMPTS) {
        console.error('  → Max retry attempts reached.');
        break;
      }

      let delay = RETRY_DELAYS_MS[attempt - 1];
      if (retryDelayMs) {
        delay = Math.max(retryDelayMs, delay);
        console.log(`    Respecting server retry delay: ${retryDelayMs / 1000}s`);
      }
      console.log(`    Waiting ${delay / 1000}s before retry...`);
      await sleep(delay);
    }
  }

  console.error('  → All Gemini analysis attempts failed.');
  console.error(`  → Last error: ${lastError}`);
  return failures.map(f => createIndividualFallback(f, lastError));
}

async function main() {
  console.log('Analysing failures with Gemini...');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const model = process.env.GEMINI_MODEL || GEMINI_MODEL;

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

  const analyses = await analyseWithRetry(uniqueFailures, apiKey, model);

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
