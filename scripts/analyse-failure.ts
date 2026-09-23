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

type AnalysisEntry = {
  failure: FailureData;
  analysis: BugAnalysis;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const MODEL_FALLBACKS = ['gpt-5.6-luna', 'gpt-4o', 'gpt-4o-mini'];
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

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
  const path = join(rootDir, 'e2e', 'selectors', 'index.ts');
  if (existsSync(path)) {
    return readFileSync(path, 'utf-8');
  }
  return '';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildEvidence(failure: FailureData): string {
  const testCode = loadTestFile(failure.testName);
  const pageObjects = loadPageObjects();
  const selectors = loadSelectors();

  return `--- FAILURE EVIDENCE ---

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

--- REPRODUCTION STEPS ---
${(failure.stepsToReproduce || []).join('\n')}

--- RELEVANT TEST CODE ---
${testCode || 'Not found'}

--- PAGE OBJECTS ---
${pageObjects || 'Not found'}

--- SELECTORS ---
${selectors || 'Not found'}

--- END EVIDENCE ---`;
}

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
    relevantEvidence: { type: 'array', items: { type: 'string' }, description: 'Relevant evidence references', default: [] },
  },
  required: ['title', 'summary', 'stepsToReproduce', 'expectedResult', 'actualResult', 'failureType', 'severity', 'priority', 'classification', 'confidence', 'relevantEvidence'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are an AI QA Defect Analysis Agent.

Analyse the supplied Playwright test failure and convert the failure evidence into a structured software defect.

PRODUCT_BUG = The application behaves incorrectly. A genuine software defect.
TEST_DEFECT = The test expectation or implementation is wrong. The application may be working correctly.
TEST_INFRASTRUCTURE = CI/test environment failure (browser crash, network timeout, environment unavailable).
UNKNOWN = Insufficient evidence to classify confidently.

Use ONLY the evidence provided. Do not invent application behaviour, reproduction steps, expected results, API responses, or environment information that is not present in the evidence.

The bug title must describe the actual failure — not generic titles like "Playwright test failed" or "Automated test failure".

Reproduction steps must be based on the actual Playwright test actions.

Return valid JSON matching the provided schema.`;

async function callOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
  evidence: string
): Promise<BugAnalysis> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: prompt },
        { role: 'user', content: evidence },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'bug_analysis',
          schema: BUG_ANALYSIS_SCHEMA,
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    let errorDetail = errorBody;

    try {
      const parsed = JSON.parse(errorBody);
      errorDetail = parsed.error?.message || errorBody;
    } catch {
      // use raw error body
    }

    throw new Error(`OpenAI API error (${response.status}): ${errorDetail}`);
  }

  const body = await response.json() as {
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    output_text?: string;
    error?: { message: string };
  };

  if (body.error) {
    throw new Error(`OpenAI API error: ${body.error.message}`);
  }

  let jsonText = body.output_text || '';

  if (!jsonText) {
    for (const output of body.output || []) {
      if (output.type === 'message' || output.type === 'function_call') {
        for (const content of output.content || []) {
          if (content.type === 'output_text' && content.text) {
            jsonText = content.text;
          }
        }
      }
    }
  }

  if (!jsonText) {
    throw new Error('OpenAI Responses API returned no output text');
  }

  try {
    return JSON.parse(jsonText) as BugAnalysis;
  } catch {
    const cleaned = jsonText.trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      const extracted = cleaned.substring(firstBrace, lastBrace + 1);
      return JSON.parse(extracted) as BugAnalysis;
    }
    throw new Error(`Failed to parse OpenAI response as JSON: ${jsonText.substring(0, 200)}`);
  }
}

async function callOpenAIFallback(
  apiKey: string,
  model: string,
  systemPrompt: string,
  evidence: string
): Promise<BugAnalysis> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: evidence },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    let errorDetail = errorBody;

    try {
      const parsed = JSON.parse(errorBody);
      errorDetail = parsed.error?.message || errorBody;
    } catch {
      // use raw error body
    }

    throw new Error(`OpenAI API error (${response.status}): ${errorDetail}`);
  }

  const body = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    error?: { message: string };
  };

  if (body.error) {
    throw new Error(`OpenAI API error: ${body.error.message}`);
  }

  const aiResponse = body.choices[0]?.message?.content || '{}';

  try {
    return JSON.parse(aiResponse) as BugAnalysis;
  } catch {
    const cleaned = aiResponse.trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      const extracted = cleaned.substring(firstBrace, lastBrace + 1);
      return JSON.parse(extracted) as BugAnalysis;
    }
    throw new Error(`Failed to parse OpenAI response as JSON: ${aiResponse.substring(0, 200)}`);
  }
}

function createEvidenceOnlyFallback(failure: FailureData, aiError?: string): BugAnalysis {
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

async function analyseWithRetry(
  failure: FailureData,
  apiKey: string,
  model: string
): Promise<BugAnalysis> {
  const evidence = buildEvidence(failure);
  const modelsToTry = [model, ...MODEL_FALLBACKS.filter(m => m !== model)];
  const primaryModel = model;

  let lastError: string | undefined;
  let hitRateLimit = false;

  for (const tryModel of modelsToTry) {
    if (hitRateLimit) {
      console.warn(`  → Skipping model ${tryModel} due to earlier 429 rate limit.`);
      break;
    }

    const isFallbackModel = tryModel !== primaryModel;
    if (isFallbackModel) {
      console.log(`    Retrying with model: ${tryModel}`);
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1 && !isFallbackModel) {
          console.log(`    Retry ${attempt}/${MAX_RETRIES}...`);
          await sleep(RETRY_DELAY_MS * attempt);
        }

        const analysis = await callOpenAI(apiKey, tryModel, SYSTEM_PROMPT, evidence);
        return analysis;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.warn(`    Attempt ${attempt} with ${tryModel} failed: ${lastError}`);

        if (lastError.includes('429') || lastError.includes('no credits') || lastError.includes('insufficient')) {
          console.error('  → OpenAI API returned 429 (rate limit / no credits). Stopping retries.');
          hitRateLimit = true;
          break;
        }

        if (attempt < MAX_RETRIES && !isFallbackModel) {
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }

      if (hitRateLimit) break;
    }

    if (hitRateLimit) break;
  }

  if (hitRateLimit) {
    lastError = `OpenAI API error: 429 — rate limit or no credits remaining. ${lastError || ''}`;
  }

  console.error(`  → All AI analysis attempts failed. Using evidence-only fallback.`);
  console.error(`  → Last error: ${lastError}`);
  return createEvidenceOnlyFallback(failure, lastError);
}

function validateBugAnalysis(
  analysis: BugAnalysis,
  failure: FailureData,
  fallbackUsed = false,
  aiError?: string
): BugAnalysis {
  return {
    title: analysis.title || 'Untitled Bug',
    summary: analysis.summary || '',
    stepsToReproduce: analysis.stepsToReproduce || [],
    expectedResult: analysis.expectedResult || '',
    actualResult: analysis.actualResult || '',
    failureType: analysis.failureType || 'Unknown',
    severity: analysis.severity || 'Medium',
    priority: analysis.priority || 'P3',
    classification: analysis.classification || 'UNKNOWN',
    confidence: typeof analysis.confidence === 'number' ? analysis.confidence : 0,
    relevantEvidence: analysis.relevantEvidence || [],
    aiAnalysisSucceeded: !fallbackUsed,
    fallbackUsed,
    aiError: aiError || analysis.aiError,
    error: analysis.error,
    branch: failure.branch,
    commit: failure.commit,
    project: failure.project,
  };
}

async function main() {
  console.log('Analysing failures with OpenAI...');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

  const failures = loadFailureData();

  const uniqueFailures: FailureData[] = Array.from(
    new Map(
      failures.map(f => [`${f.testName}|${f.project}|${f.error}`, f] as const)
    ).values()
  );

  if (uniqueFailures.length < failures.length) {
    console.log(`Deduplicated ${failures.length} failures to ${uniqueFailures.length} unique.`);
  }

  if (uniqueFailures.length === 0) {
    console.log('No failures to analyse.');
  }

  console.log(`Failures available for AI analysis: ${uniqueFailures.length}`);

  const analyses: AnalysisEntry[] = [];

  for (const failure of uniqueFailures) {
    console.log(`\n  Analysing: ${failure.testName}`);

    try {
      const analysis = await analyseWithRetry(failure, apiKey, model);
      const validated = validateBugAnalysis(analysis, failure, analysis.fallbackUsed, analysis.aiError);
      analyses.push({ failure, analysis: validated });

      console.log(`  → Title: ${validated.title}`);
      console.log(`  → Classification: ${validated.classification}`);
      console.log(`  → Confidence: ${validated.confidence}`);

      if (validated.fallbackUsed) {
        console.log(`  → AI Analysis: FAILED (using fallback)`);
        console.log(`  → Error: ${validated.aiError}`);
      } else {
        console.log(`  → AI Analysis: SUCCESS`);
      }

      if (validated.error) {
        console.log(`  → Warning: ${validated.error}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  → Unexpected error: ${message}`);

      const fallback = createEvidenceOnlyFallback(failure, message);
      const validated = validateBugAnalysis(fallback, failure, true, message);
      analyses.push({ failure, analysis: validated });
    }
  }

  const outputPath = join(rootDir, 'bug-analysis.json');
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(analyses, null, 2));
  console.log(`\nAI analyses: ${analyses.length}`);
  console.log(`Analysis written to: ${outputPath}`);
}

main();
