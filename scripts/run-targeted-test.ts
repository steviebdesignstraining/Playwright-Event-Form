import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { resolveArtifactPath } from './github-project.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

interface AiFixSummary {
  issueNumber: number;
  projectItemId: string;
  initialStatus: string;
  finalStatus: string;
  branch: string;
  attempt: number;
  maxAttempts: number;
  rootCause: string;
  confidence: number;
  filesChanged: string[];
  linesAdded: number;
  linesDeleted: number;
  targetedTest: string;
  targetedTestResult: 'pending' | 'passed' | 'failed' | 'skipped';
  regressionResult: 'pending' | 'passed' | 'failed';
  pullRequest: number | null;
  pullRequestUrl: string | null;
  reviewStatus: 'pending' | 'approved' | 'changes_requested' | 'dismissed';
  mergeStatus: 'pending' | 'merged' | 'closed';
  postMergeVerification: 'pending' | 'passed' | 'failed';
  projectCompletion: string;
}

function loadAiFixSummary(): AiFixSummary {
  const path = resolveArtifactPath(rootDir, 'ai-fix-summary.json');
  if (!existsSync(path)) {
    return {
      issueNumber: 0,
      projectItemId: '',
      initialStatus: 'Todo',
      finalStatus: 'Todo',
      branch: '',
      attempt: 1,
      maxAttempts: 2,
      rootCause: '',
      confidence: 0,
      filesChanged: [],
      linesAdded: 0,
      linesDeleted: 0,
      targetedTest: '',
      targetedTestResult: 'pending',
      regressionResult: 'pending',
      pullRequest: null,
      pullRequestUrl: null,
      reviewStatus: 'pending',
      mergeStatus: 'pending',
      postMergeVerification: 'pending',
      projectCompletion: 'Todo',
    };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function saveAiFixSummary(summary: AiFixSummary): void {
  const path = resolveArtifactPath(rootDir, 'ai-fix-summary.json');
  writeFileSync(path, JSON.stringify(summary, null, 2));
}

function loadRootCause(): { testToValidate: string } {
  const path = resolveArtifactPath(rootDir, 'root-cause.json');
  if (!existsSync(path)) {
    return { testToValidate: '' };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadBugContext(): { body: string } {
  const path = resolveArtifactPath(rootDir, 'bug-context.json');
  if (!existsSync(path)) {
    return { body: '' };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadFailureData(): Array<{ testName: string; project: string }> {
  const path = resolveArtifactPath(rootDir, 'failure-data.json');
  if (!existsSync(path)) {
    return [];
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function inferProjectFromTestName(testName: string): string {
  const testFiles = [
    { file: 'e2e/tests/api.spec.ts', project: 'api' },
    { file: 'e2e/tests/browser.spec.ts', project: 'chromium' },
    { file: 'e2e/tests/usability.spec.ts', project: 'chromium' },
    { file: 'e2e/tests/accessibility.spec.ts', project: 'chromium' },
    { file: 'e2e/tests/security.spec.ts', project: 'chromium' },
  ];

  for (const { file, project } of testFiles) {
    const fullPath = join(rootDir, file);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      if (content.includes(testName)) {
        return project;
      }
    }
  }

  return 'chromium';
}

function getAllTests(): Array<{ name: string; project: string }> {
  try {
    const output = execSync('npx playwright test --list --reporter=json', {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30_000,
    });
    const json = JSON.parse(output);

    const tests: Array<{ name: string; project: string }> = [];

    function walk(suites: any[] = []) {
      for (const suite of suites) {
        for (const spec of suite.specs || []) {
          for (const test of spec.tests || []) {
            tests.push({
              name: spec.title,
              project: test.projectName || 'unknown',
            });
          }
        }
        if (suite.suites) walk(suite.suites);
      }
    }

    if (json.suites) walk(json.suites);
    return tests;
  } catch {
    return [];
  }
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) dp.push(new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

function findFuzzyTestMatch(
  testName: string,
  project: string,
  allTests: Array<{ name: string; project: string }>
): { testName: string; project: string } | null {
  const targetLower = testName.toLowerCase();
  let bestMatch: { testName: string; project: string; score: number } | null = null;

  for (const t of allTests) {
    const testLower = t.name.toLowerCase();
    let score: number;

    if (testLower === targetLower) {
      return { testName: t.name, project: t.project };
    }

    if (testLower.includes(targetLower) || targetLower.includes(testLower)) {
      score = 0.9;
    } else {
      const tokens = targetLower.split(/\s+/);
      const matched = tokens.filter(tok => tok.length > 2 && testLower.includes(tok));
      if (matched.length > 0) {
        score = (matched.length / tokens.filter(t => t.length > 2).length) * 0.8;
      } else {
        const distance = levenshtein(testLower, targetLower);
        const maxLen = Math.max(testLower.length, targetLower.length);
        score = maxLen > 0 ? 1 - distance / maxLen : 0;
      }
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { testName: t.name, project: t.project, score };
    }
  }

  if (bestMatch && bestMatch.score >= 0.5) {
    return { testName: bestMatch.testName, project: bestMatch.project };
  }

  return null;
}

function determineTestToRun(): { testName: string; project: string } | null {
  const summary = loadAiFixSummary();
  if (summary.targetedTest) {
    const failureData = loadFailureData();
    const match = failureData.find(f => f.testName === summary.targetedTest);
    if (match) {
      return { testName: match.testName, project: match.project };
    }
    return { testName: summary.targetedTest, project: inferProjectFromTestName(summary.targetedTest) };
  }

  const rootCause = loadRootCause();
  if (rootCause.testToValidate) {
    const failureData = loadFailureData();
    const match = failureData.find(f => f.testName === rootCause.testToValidate);
    if (match) {
      return { testName: match.testName, project: match.project };
    }
    return { testName: rootCause.testToValidate, project: inferProjectFromTestName(rootCause.testToValidate) };
  }

  const bugContext = loadBugContext();
  const testMatch = bugContext.body.match(/Test[:\s]+([^\n]+)/i);
  if (testMatch) {
    const testName = testMatch[1].trim();
    const failureData = loadFailureData();
    const match = failureData.find(f => f.testName === testName);
    if (match) {
      return { testName: match.testName, project: match.project };
    }
    return { testName, project: inferProjectFromTestName(testName) };
  }

  const failureData = loadFailureData();
  if (failureData.length > 0) {
    return { testName: failureData[0].testName, project: failureData[0].project };
  }

  return null;
}

async function main() {
  console.log('Running targeted test...');

  const testInfo = determineTestToRun();
  if (!testInfo) {
    console.error('Could not determine which test to run.');
    process.exit(1);
  }

  const { testName, project } = testInfo;
  console.log(`Target test: ${testName} (project: ${project})`);

  const summary = loadAiFixSummary();
  summary.targetedTest = testName;

  const workers = process.env.TEST_WORKERS || '1';
  const retries = process.env.TEST_RETRIES || '0';

  let resolvedTestName = testName;
  let resolvedProject = project;

  const escapedTestName = testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const listCmd = `npx playwright test --project=${project} -g "${escapedTestName}" --list`;
  console.log(`Checking if test exists: ${listCmd}`);

  try {
    execSync(listCmd, {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch (listError: any) {
    const listOutput = [
      listError?.stdout,
      listError?.stderr,
      listError?.message,
    ].filter(v => typeof v === 'string').join('\n');

    if (listOutput.includes('No tests found')) {
      console.warn(`\n⚠️ No test found matching "${testName}" in project "${project}".`);
      console.warn('  Attempting fuzzy match across all projects...');

      const allTests = getAllTests();
      if (allTests.length > 0) {
        const fuzzyMatch = findFuzzyTestMatch(testName, project, allTests);
        if (fuzzyMatch) {
          console.log(`  → Fuzzy match found: "${fuzzyMatch.testName}" (project: ${fuzzyMatch.project})`);
          resolvedTestName = fuzzyMatch.testName;
          resolvedProject = fuzzyMatch.project;

          const escapedName = resolvedTestName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const retryCmd = `npx playwright test --project=${resolvedProject} -g "${escapedName}" --list`;
          try {
            execSync(retryCmd, { cwd: rootDir, encoding: 'utf-8', stdio: 'pipe' });
            console.log(`  → Match verified.`);
          } catch {
            console.warn(`  → Match verification failed. Skipping.`);
            summary.targetedTestResult = 'skipped';
            saveAiFixSummary(summary);
            console.log('\n⚠️ Targeted test SKIPPED (no matching test found)');
            process.exit(0);
          }
        } else {
          console.warn('  → No fuzzy match found either.');
          summary.targetedTestResult = 'skipped';
          saveAiFixSummary(summary);
          console.log('\n⚠️ Targeted test SKIPPED (test not found)');
          process.exit(0);
        }
      } else {
        console.warn('  → Could not list available tests for matching.');
        summary.targetedTestResult = 'skipped';
        saveAiFixSummary(summary);
        console.log('\n⚠️ Targeted test SKIPPED (test not found)');
        process.exit(0);
      }
    } else {
      console.error(`\n❌ Error listing tests: ${listError}`);
      process.exit(1);
    }
  }

  const escapedFinalName = resolvedTestName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cmd = `npx playwright test --project=${resolvedProject} -g "${escapedFinalName}" --workers=${workers} --retries=${retries} --reporter=list`;
  console.log(`Running: ${cmd}`);
  
  try {
    execSync(cmd, { 
      cwd: rootDir, 
      encoding: 'utf-8', 
      stdio: 'inherit',
      timeout: 120_000,
    });

    console.log('\n✅ Targeted test PASSED');
    summary.targetedTestResult = 'passed';
    saveAiFixSummary(summary);
  } catch (error) {
    console.error('\n❌ Targeted test FAILED');
    summary.targetedTestResult = 'failed';
    saveAiFixSummary(summary);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});