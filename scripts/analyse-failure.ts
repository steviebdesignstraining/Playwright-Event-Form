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
  classification: 'PRODUCT_BUG' | 'TEST_BUG' | 'FLAKY_TEST' | 'ENVIRONMENT_FAILURE' | 'DATA_FAILURE' | 'UNKNOWN';
  confidence: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

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

async function analyseWithOpenAI(failure: FailureData): Promise<BugAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const testCode = loadTestFile(failure.testName);
  const pageObjects = loadPageObjects();
  const selectors = loadSelectors();

  const prompt = `You are an AI QA Defect Analysis Agent.

Analyse the supplied Playwright test failure.

Your job is to convert the failure evidence into a structured software defect.

Use ONLY the evidence provided.
Do not invent:
- application behaviour
- reproduction steps
- expected results
- API responses
- environment information

The bug title must describe the actual failure.
Do not use generic titles such as:
"Playwright test failed"
"Automated test failure"
"Test failed"

The title should describe the affected functionality and observed failure.

Reproduction steps must be based on the actual Playwright test actions.

Return valid JSON only.

Required structure:
{
  "title": "",
  "summary": "",
  "stepsToReproduce": [],
  "expectedResult": "",
  "actualResult": "",
  "failureType": "",
  "severity": "",
  "priority": "",
  "classification": "PRODUCT_BUG|TEST_BUG|FLAKY_TEST|ENVIRONMENT_FAILURE|DATA_FAILURE|UNKNOWN",
  "confidence": 0.0-1.0,
  "relevantEvidence": []
}`;

  const evidence = `--- FAILURE EVIDENCE ---

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

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: evidence },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorBody}`);
  }

  const body = await response.json() as { choices: Array<{ message: { content: string } }> };
  const aiResponse = body.choices[0]?.message?.content || '{}';

  try {
    const parsed: BugAnalysis = JSON.parse(aiResponse);
    return parsed;
  } catch (parseError) {
    console.error('Failed to parse OpenAI response as JSON:', aiResponse);
    throw new Error('OpenAI returned invalid JSON');
  }
}

async function main() {
  console.log('Analysing failures with OpenAI...');
  const failures = loadFailureData();

  if (failures.length === 0) {
    console.log('No failures to analyse.');
    return;
  }

  const analyses: Array<{ failure: FailureData; analysis: BugAnalysis }> = [];

  for (const failure of failures) {
    console.log(`Analysing: ${failure.testName}`);
    try {
      const analysis = await analyseWithOpenAI(failure);
      analyses.push({ failure, analysis });
      console.log(`  → Title: ${analysis.title}`);
      console.log(`  → Classification: ${analysis.classification}`);
      console.log(`  → Confidence: ${analysis.confidence}`);
    } catch (error) {
      console.error(`  → Failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  const outputPath = join(rootDir, 'bug-analysis.json');
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(analyses, null, 2));
  console.log(`Analysis written to: ${outputPath}`);
}

main();
