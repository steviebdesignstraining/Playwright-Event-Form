import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

interface FailureData {
  testName: string;
  status: string;
  project: string;
  error: string;
  expected?: string;
  actual?: string;
  failureType: 'UI' | 'API' | 'Data' | 'Environment' | 'Unknown';
  branch: string;
  commit: string;
  severity?: string;
  priority?: string;
  stepsToReproduce?: string[];
  timestamp: string;
  screenshot?: string;
  trace?: string;
  video?: string;
}

interface PlaywrightJsonResult {
  config?: Record<string, unknown>;
  suites: PlaywrightSuite[];
  errors: unknown[];
  stats: Record<string, unknown>;
}

interface PlaywrightSuite {
  title?: string;
  file?: string;
  line?: number;
  column?: number;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightSpec {
  title: string;
  ok: boolean;
  line: number;
  file?: string;
  tests: PlaywrightTest[];
}

interface PlaywrightTest {
  timeout: number;
  expectedStatus: string;
  projectId: string;
  projectName: string;
  results: PlaywrightTestResult[];
}

interface PlaywrightTestResult {
  workerIndex: number;
  parallelIndex: number;
  status: string;
  duration: number;
  errors: Array<{ message: string; stack?: string; location?: { file: string; line: number; column: number } }>;
  stdout: string[];
  stderr: string[];
  retry: number;
  startTime: string;
  annotations: Array<{ type: string; location: { file: string; line: number; column: number } }>;
  attachments: Array<{ name: string; path?: string; contentType: string }>;
  error?: { message: string; stack?: string };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function getGitInfo(): { branch: string; commit: string } {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf-8' }).trim();
    const commit = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf-8' }).trim();
    return { branch, commit };
  } catch {
    return { branch: 'unknown', commit: 'unknown' };
  }
}

function determineFailureType(errorMessage: string, projectName: string): FailureData['failureType'] {
  const lower = errorMessage.toLowerCase();

  if (projectName === 'api' || lower.includes('http') || lower.includes('status') || lower.includes('response') || lower.includes('api')) {
    return 'API';
  }
  if (lower.includes('timeout') || lower.includes('connect') || lower.includes('network') || lower.includes('econn') || lower.includes('enotfound')) {
    return 'Environment';
  }
  if (lower.includes('assert') || lower.includes('expect') || lower.includes('toBe') || lower.includes('tocontain') || lower.includes('visible') || lower.includes('enabled')) {
    return 'UI';
  }
  if (lower.includes('not found') || lower.includes('no data') || lower.includes('empty') || lower.includes('null')) {
    return 'Data';
  }
  if (lower.includes('flaky') || lower.includes('retry') || lower.includes('timed out') || lower.includes('stale')) {
    return 'Environment';
  }
  return 'Unknown';
}

function extractErrorMessage(error: { message: string; stack?: string }): string {
  if (error.message) {
    const lines = error.message.split('\n');
    return lines[0] || error.message;
  }
  if (error.stack) {
    const lines = error.stack.split('\n');
    return lines.slice(0, 3).join('\n');
  }
  return 'Unknown error';
}

function classifySeverity(failureType: FailureData['failureType'], errorMsg: string): { severity: string; priority: string } {
  const criticalPatterns = ['crash', 'data loss', 'security', 'memory', 'corrupt'];
  const isCritical = criticalPatterns.some(p => errorMsg.toLowerCase().includes(p));

  if (isCritical) {
    return { severity: 'Critical', priority: 'P1' };
  }

  switch (failureType) {
    case 'API':
      return { severity: 'High', priority: 'P2' };
    case 'UI':
      return { severity: 'Medium', priority: 'P2' };
    case 'Data':
      return { severity: 'Medium', priority: 'P3' };
    case 'Environment':
      return { severity: 'Low', priority: 'P3' };
    default:
      return { severity: 'Medium', priority: 'P3' };
  }
}

function extractExpectedActual(errorStack: string | undefined): { expected?: string; actual?: string } {
  if (!errorStack) return {};

  const expectedMatch = errorStack.match(/Expected:\s*(.+)/i);
  const actualMatch = errorStack.match(/Received:\s*(.+)/i) || errorStack.match(/Actual:\s*(.+)/i);

  const result: { expected?: string; actual?: string } = {};
  if (expectedMatch) result.expected = expectedMatch[1].trim();
  if (actualMatch) result.actual = actualMatch[1].trim();
  return result;
}

function normaliseAttachmentPath(path?: string): string | undefined {
  if (!path) return undefined;

  const markers = [
    'test-results/',
    'playwright-report/',
    'allure-results/',
  ];

  for (const marker of markers) {
    const index = path.indexOf(marker);

    if (index !== -1) {
      return path.substring(index);
    }
  }

  return path;
}

function generateFailureData(): FailureData[] {
  const jsonResultPath = join(rootDir, 'test-results', 'results.json');

  if (!existsSync(jsonResultPath)) {
    console.error('No Playwright JSON results found at:', jsonResultPath);
    console.error('Run tests with --reporter=json first.');
    process.exit(1);
  }

  const raw = readFileSync(jsonResultPath, 'utf-8');
  const result: PlaywrightJsonResult = JSON.parse(raw);
  const { branch, commit } = getGitInfo();
  const failures: FailureData[] = [];

  function collectFailed(suites: PlaywrightSuite[]): void {
    for (const suite of suites) {
      if (suite.specs) {
        for (const spec of suite.specs) {
          for (const test of spec.tests) {
            for (const res of test.results) {
              if (res.status === 'failed') {
                const errorSource = res.errors?.[0] || res.error;
                const errorMessage = extractErrorMessage(errorSource);
                const { expected, actual } = extractExpectedActual(res.errors?.[0]?.stack || res.error?.stack || res.errors?.[0]?.message);
                const failureType = determineFailureType(errorMessage, test.projectName);
                const { severity, priority } = classifySeverity(failureType, errorMessage);

                const failure: FailureData = {
                  testName: spec.title,
                  status: res.status,
                  project: test.projectName,
                  error: errorMessage,
                  expected: expected || undefined,
                  actual: actual || undefined,
                  failureType,
                  branch,
                  commit,
                  severity,
                  priority: priority as 'Critical' | 'High' | 'Medium' | 'Low',
                  timestamp: new Date().toISOString(),
                  stepsToReproduce: [
                    `Run: npx playwright test --project=${test.projectName}`,
                    `Filter: "${spec.title}"`,
                    `Review trace: playwright-report/index.html`,
                  ],
                };

                if (res.attachments) {
                  for (const attachment of res.attachments) {
                    if (attachment.name === 'trace') {
                      failure.trace = normaliseAttachmentPath(
                        attachment.path || attachment.name
                      );
                    }
                    if (attachment.name === 'screenshot') {
                      failure.screenshot = normaliseAttachmentPath(
                        attachment.path || attachment.name
                      );
                    }
                    if (attachment.name === 'video') {
                      failure.video = normaliseAttachmentPath(
                        attachment.path || attachment.name
                      );
                    }
                  }
                }

                failures.push(failure);
              }
            }
          }
        }
      }
      if (suite.suites) collectFailed(suite.suites);
    }
  }

  collectFailed(result.suites);

  return failures;
}

function main() {
  console.log('Generating failure data from Playwright results...');
  const failures = generateFailureData();

  if (failures.length === 0) {
    console.log('No test failures found.');
  }

  const outputPath = join(rootDir, 'failure-data.json');
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(failures, null, 2));
  console.log(`Failure data written to: ${outputPath}`);
  console.log(`Failures found: ${failures.length}`);

  for (const f of failures) {
    console.log(`  - [${f.failureType}] ${f.testName}: ${f.error}`);
  }
}

main();
