import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveArtifactPath } from './github-project.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

interface BugContext {
  issueNumber: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  projectItemId: string;
  projectStatus: string;
  state: string;
}

interface RootCauseAnalysis {
  issueNumber: number;
  title: string;
  rootCause: string;
  confidence: number;
  affectedFiles: string[];
  suggestedFix: string;
  testToValidate: string;
  reasoning: string;
  attempt: number;
  maxAttempts: number;
}

const SYSTEM_PROMPT = `You are an AI Bug Investigation Agent.

Your task is to analyse a GitHub Issue representing a test failure and identify the root cause.

You will receive:
1. The GitHub Issue details (title, body, labels)
2. The failing test code (if available)
3. Relevant application source code

Your output must be a JSON object with exactly these fields:
- rootCause: Clear description of the root cause
- confidence: Number 0.0-1.0 indicating your confidence in the root cause
- affectedFiles: Array of file paths that need to be modified to fix the bug
- suggestedFix: Description of the minimal fix to apply
- testToValidate: The specific test name that should pass after the fix
- reasoning: Step-by-step reasoning for your analysis

Rules:
- ONLY use the evidence provided. Do not invent application behaviour.
- The fix must be minimal and safe.
- Do not suggest deleting tests, weakening assertions, increasing timeouts, or adding retries.
- Preserve architecture and avoid unrelated refactoring.
- If confidence is below 0.70, indicate this clearly - the fix should not proceed.
- Identify the EXACT test that validates the fix.`;

interface BugAnalysisSchema {
  type: 'object';
  properties: {
    rootCause: { type: 'string' };
    confidence: { type: 'number'; minimum: 0; maximum: 1 };
    affectedFiles: { type: 'array'; items: { type: 'string' } };
    suggestedFix: { type: 'string' };
    testToValidate: { type: 'string' };
    reasoning: { type: 'string' };
  };
  required: ['rootCause', 'confidence', 'affectedFiles', 'suggestedFix', 'testToValidate', 'reasoning'];
  additionalProperties: false;
}

const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MAX_OUTPUT_TOKENS = 8192;
const REQUEST_TIMEOUT_MS = 120_000;

async function callGemini(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: GEMINI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'root_cause_analysis',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              rootCause: { type: 'string' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              affectedFiles: { type: 'array', items: { type: 'string' } },
              suggestedFix: { type: 'string' },
              testToValidate: { type: 'string' },
              reasoning: { type: 'string' },
            },
            required: ['rootCause', 'confidence', 'affectedFiles', 'suggestedFix', 'testToValidate', 'reasoning'],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${responseText}`);
  }

  let body: {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    error?: { message?: string };
  };
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${responseText.substring(0, 200)}`);
  }

  if (body.error) {
    throw new Error(`Gemini error in 200 response: ${body.error.message}`);
  }

  const choice = body.choices?.[0];
  const content = choice?.message?.content || '';

  if (!content) {
    throw new Error('Gemini returned no content');
  }

  if (choice?.finish_reason === 'length') {
    throw new Error('Gemini output truncated');
  }

  return content;
}

function loadBugContext(): BugContext {
  const path = resolveArtifactPath(rootDir, 'bug-context.json');
  if (!existsSync(path)) {
    console.error('bug-context.json not found. Run fetch-issue.ts first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadFailureData(): unknown {
  const path = resolveArtifactPath(rootDir, 'failure-data.json');
  if (!existsSync(path)) {
    return null;
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

function loadApplicationCode(): string {
  const paths = [
    join(rootDir, 'src', 'server', 'index.ts'),
    join(rootDir, 'src', 'server', 'store.ts'),
    join(rootDir, 'src', 'server', 'types.ts'),
    join(rootDir, 'src', 'client', 'app.ts'),
  ];
  let result = '';
  for (const path of paths) {
    if (existsSync(path)) {
      result += `\n--- ${path} ---\n`;
      result += readFileSync(path, 'utf-8');
    }
  }
  return result;
}

function loadPageObjects(): string {
  const paths = [
    join(rootDir, 'e2e', 'pages', 'index.page.ts'),
    join(rootDir, 'e2e', 'pages', 'api.pages.ts'),
  ];
  let result = '';
  for (const path of paths) {
    if (existsSync(path)) {
      result += `\n--- ${path} ---\n`;
      result += readFileSync(path, 'utf-8');
    }
  }
  return result;
}

function buildEvidence(bugContext: BugContext, failureData: unknown): string {
  let evidence = `GitHub Issue #${bugContext.issueNumber}
Title: ${bugContext.title}
URL: ${bugContext.url}
Labels: ${bugContext.labels.join(', ')}

Issue Body:
${bugContext.body}

`;

  if (failureData && Array.isArray(failureData) && failureData.length > 0) {
    evidence += '\n--- Failure Data ---\n';
    for (const failure of failureData as Array<Record<string, unknown>>) {
      evidence += `
Test: ${failure.testName}
Project: ${failure.project}
Error: ${failure.error}
Expected: ${failure.expected || 'N/A'}
Actual: ${failure.actual || 'N/A'}
Failure Type: ${failure.failureType}
Severity: ${failure.severity}
Priority: ${failure.priority}
`;
    }
  }

  const testName = bugContext.body.match(/Test[:\s]+([^\n]+)/i)?.[1] || 
                   bugContext.body.match(/test[:\s]+([^\n]+)/i)?.[1] ||
                   '';
  
  if (testName) {
    const testCode = loadTestFile(testName.trim());
    if (testCode) {
      evidence += `\n--- Failing Test Code ---\n${testCode}\n`;
    }
  }

  evidence += `\n--- Application Source Code ---\n${loadApplicationCode()}\n`;
  evidence += `\n--- Page Objects ---\n${loadPageObjects()}\n`;

  return evidence;
}

async function main() {
  console.log('Running AI Bug Investigation...');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const bugContext = loadBugContext();
  const failureData = loadFailureData();
  const attempt = parseInt(process.env.ATTEMPT_NUMBER || '1', 10);
  const maxAttempts = parseInt(process.env.MAX_ATTEMPTS || '2', 10);

  console.log(`Issue: #${bugContext.issueNumber} - ${bugContext.title}`);
  console.log(`Attempt: ${attempt}/${maxAttempts}`);

  const evidence = buildEvidence(bugContext, failureData);

  let analysis: RootCauseAnalysis;
  try {
    const response = await callGemini(apiKey, SYSTEM_PROMPT, evidence);
    const parsed = JSON.parse(response);

    analysis = {
      issueNumber: bugContext.issueNumber,
      title: bugContext.title,
      rootCause: parsed.rootCause,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      affectedFiles: Array.isArray(parsed.affectedFiles) ? parsed.affectedFiles : [],
      suggestedFix: parsed.suggestedFix || '',
      testToValidate: parsed.testToValidate || '',
      reasoning: parsed.reasoning || '',
      attempt,
      maxAttempts,
    };
  } catch (error) {
    console.error('AI investigation failed:', error);
    analysis = {
      issueNumber: bugContext.issueNumber,
      title: bugContext.title,
      rootCause: 'AI investigation failed',
      confidence: 0,
      affectedFiles: [],
      suggestedFix: '',
      testToValidate: '',
      reasoning: `Error: ${error instanceof Error ? error.message : String(error)}`,
      attempt,
      maxAttempts,
    };
  }

  console.log('\n--- AI Investigation Result ---');
  console.log(`Root Cause: ${analysis.rootCause}`);
  console.log(`Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
  console.log(`Affected Files: ${analysis.affectedFiles.join(', ') || 'none'}`);
  console.log(`Suggested Fix: ${analysis.suggestedFix}`);
  console.log(`Test to Validate: ${analysis.testToValidate}`);

  const confidenceThreshold = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.70');
  if (analysis.confidence < confidenceThreshold) {
    console.warn(`\n⚠️ Confidence ${(analysis.confidence * 100).toFixed(0)}% is below threshold ${(confidenceThreshold * 100).toFixed(0)}%`);
    console.warn('Fix will not proceed. Consider manual investigation.');
  }

  const outputPath = join(rootDir, 'root-cause.json');
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(analysis, null, 2));
  console.log(`\nRoot cause analysis written to: ${outputPath}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});