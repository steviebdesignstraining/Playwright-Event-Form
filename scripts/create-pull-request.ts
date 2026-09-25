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
  rootCause: string;
  confidence: number;
  affectedFiles: string[];
  suggestedFix: string;
  testToValidate: string;
  reasoning: string;
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

function loadBugContext(): BugContext {
  const path = join(rootDir, 'bug-context.json');
  if (!existsSync(path)) {
    console.error('bug-context.json not found.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadRootCause(): RootCauseAnalysis {
  const path = join(rootDir, 'root-cause.json');
  if (!existsSync(path)) {
    return {
      rootCause: 'Unknown',
      confidence: 0,
      affectedFiles: [],
      suggestedFix: '',
      testToValidate: '',
      reasoning: '',
    };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function getRepoInfo(): { owner: string; repo: string } {
  const ghRepo = process.env.GITHUB_REPOSITORY;
  if (ghRepo) {
    const [owner, repoName] = ghRepo.split('/');
    if (owner && repoName) {
      return { owner, repo: repoName };
    }
  }
  try {
    const remote = execSync('git config --get remote.origin.url', { cwd: rootDir, encoding: 'utf-8' }).trim();
    const match = remote.match(/(?:git@github\.com:|https:\/\/github\.com\/)([^\/\s]+)\/([^\/\s]+?)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // ignore
  }
  throw new Error('Could not determine GitHub repository.');
}

async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  title: string,
  body: string,
  base: string = 'main'
): Promise<{ number: number; url: string }> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'AI-Bug-Healer',
    },
    body: JSON.stringify({
      title,
      head: branch,
      base,
      body,
      draft: false,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API error creating PR: ${response.status} ${errorBody}`);
  }

  const pr = await response.json() as { number: number; html_url: string };
  return { number: pr.number, url: pr.html_url };
}

async function main() {
  console.log('Creating Pull Request...');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const summary = loadAiFixSummary();
  const bugContext = loadBugContext();
  const rootCause = loadRootCause();

  const { owner, repo } = getRepoInfo();
  const defaultBranch = process.env.DEFAULT_BRANCH || 'main';

  const branchName = `fix/issue-${bugContext.issueNumber}-${bugContext.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50)}`;

  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Branch: ${branchName}`);
  console.log(`Base: ${defaultBranch}`);

  const hasChanges = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf-8' }).trim();
  if (!hasChanges) {
    console.error('No changes to commit.');
    process.exit(1);
  }

  execSync('git add -A', { cwd: rootDir, stdio: 'inherit' });
  execSync(`git commit -m "fix: resolve issue #${bugContext.issueNumber}"`, { cwd: rootDir, stdio: 'inherit' });

  const pushResult = execSync(`git push origin ${branchName}`, { cwd: rootDir, encoding: 'utf-8' });
  console.log(pushResult);

  const diff = execSync('git diff HEAD~1 --stat', { cwd: rootDir, encoding: 'utf-8' });

  const prTitle = `fix: resolve issue #${bugContext.issueNumber}`;
  const prBody = `## Summary

This PR fixes issue #${bugContext.issueNumber}.

**Root Cause:**
${rootCause.rootCause}

**Fix Applied:**
${rootCause.suggestedFix}

**Files Changed:**
${summary.filesChanged.map(f => `- \`${f}\``).join('\n')}

**Changes:**
\`\`\`
${diff}
\`\`\`

**Validation:**
- Targeted Test: ${summary.targetedTest}
- Targeted Test Result: ${summary.targetedTestResult}
- Regression Result: ${summary.regressionResult}

**AI Confidence:** ${(rootCause.confidence * 100).toFixed(0)}%
**AI Attempts:** ${summary.attempt}/${summary.maxAttempts}

---

**⚠️ Human Review Required**

This PR was generated by the AI Bug Healer. Please review carefully:
1. Verify the fix addresses the root cause
2. Confirm the targeted test passes
3. Ensure no unintended side effects
4. Check that the fix follows project conventions

**Do not merge without human approval.**

Fixes #${bugContext.issueNumber}`;

  const { number, url } = await createPullRequest(token, owner, repo, branchName, prTitle, prBody, defaultBranch);

  console.log(`\n✅ Pull Request created: #${number} - ${url}`);

  summary.branch = branchName;
  summary.pullRequest = number;
  summary.pullRequestUrl = url;
  summary.reviewStatus = 'pending';
  summary.mergeStatus = 'pending';
  saveAiFixSummary(summary);

  console.log('\nPR created successfully. Waiting for human review...');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});