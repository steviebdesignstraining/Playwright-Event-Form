import { readFileSync, writeFileSync, existsSync, mkdirSync, join } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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
  targetedTestResult: 'pending' | 'passed' | 'failed';
  regressionResult: 'pending' | 'passed' | 'failed';
  pullRequest: number | null;
  pullRequestUrl: string | null;
  reviewStatus: 'pending' | 'approved' | 'changes_requested' | 'dismissed';
  mergeStatus: 'pending' | 'merged' | 'closed';
  postMergeVerification: 'pending' | 'passed' | 'failed';
  projectCompletion: string;
}

function loadAiFixSummary(): AiFixSummary {
  const path = join(rootDir, 'ai-fix-summary.json');
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
  const path = join(rootDir, 'ai-fix-summary.json');
  writeFileSync(path, JSON.stringify(summary, null, 2));
}

function loadRootCause(): { testToValidate: string } {
  const path = join(rootDir, 'root-cause.json');
  if (!existsSync(path)) {
    return { testToValidate: '' };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadBugContext(): { body: string } {
  const path = join(rootDir, 'bug-context.json');
  if (!existsSync(path)) {
    return { body: '' };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadFailureData(): Array<{ testName: string; project: string }> {
  const path = join(rootDir, 'failure-data.json');
  if (!existsSync(path)) {
    return [];
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function determineTestToRun(): { testName: string; project: string } | null {
  const summary = loadAiFixSummary();
  if (summary.targetedTest) {
    const failureData = loadFailureData();
    const match = failureData.find(f => f.testName === summary.targetedTest);
    if (match) {
      return { testName: match.testName, project: match.project };
    }
  }

  const rootCause = loadRootCause();
  if (rootCause.testToValidate) {
    const failureData = loadFailureData();
    const match = failureData.find(f => f.testName === rootCause.testToValidate);
    if (match) {
      return { testName: match.testName, project: match.project };
    }
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

  try {
    const cmd = `npx playwright test --project=${project} -g "${testName}" --workers=${workers} --retries=${retries} --reporter=list`;
    console.log(`Running: ${cmd}`);
    
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