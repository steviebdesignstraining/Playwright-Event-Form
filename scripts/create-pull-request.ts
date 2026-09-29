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

function loadBugContext(): BugContext {
  const path = resolveArtifactPath(rootDir, 'bug-context.json');
  if (!existsSync(path)) {
    console.error('bug-context.json not found.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadRootCause(): RootCauseAnalysis {
  const path = resolveArtifactPath(rootDir, 'root-cause.json');
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

    if (response.status === 403 && errorBody.includes('not permitted to create or approve pull requests')) {
      console.error('ERROR: The GitHub token cannot create pull requests.');
      console.error('The built-in GITHUB_TOKEN cannot create PRs in this context.');
      console.error('Solution: Set the PR_TOKEN repository secret to a Personal Access Token');
      console.error('  with `repo` and `pull-requests: write` scopes.');
      console.error('See: https://docs.github.com/en/actions/security-for-github-actions');
      console.error('  /security-guides/automating-with-personal-access-tokens');
      throw new Error(`GitHub API error creating PR: ${response.status} ${errorBody}`);
    }

    throw new Error(`GitHub API error creating PR: ${response.status} ${errorBody}`);
  }

  const pr = await response.json() as { number: number; html_url: string };
  return { number: pr.number, url: pr.html_url };
}

async function createPullRequestViaCli(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  title: string,
  body: string,
  base: string = 'main'
): Promise<{ number: number; url: string }> {
  const tmpFile = join(rootDir, '.pr-body.md');
  writeFileSync(tmpFile, body);

  const cmd = [
    'gh pr create',
    `--title "${title.replace(/"/g, '\\"')}"`,
    `--body-file "${tmpFile}"`,
    `--head "${branch}"`,
    `--base "${base}"`,
    '--repo', `${owner}/${repo}`,
  ].join(' ');

  console.log(`Fallback: creating PR via gh CLI: ${cmd}`);
  execSync(cmd, {
    cwd: rootDir,
    encoding: 'utf-8',
    stdio: 'pipe',
    env: { ...process.env, GH_TOKEN: token },
  });

  const prListOutput = execSync('gh pr list --state open --json number,url --jq ".[0]"', {
    cwd: rootDir,
    encoding: 'utf-8',
    env: { ...process.env, GH_TOKEN: token },
    stdio: 'pipe',
  });

  const pr = JSON.parse(prListOutput) as { number: number; url: string };
  return { number: pr.number, url: pr.url };
}

async function main() {
  console.log('Creating Pull Request...');

  const token = process.env.PR_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const summary = loadAiFixSummary();
  const bugContext = loadBugContext();
  const rootCause = loadRootCause();

  const { owner, repo } = getRepoInfo();
  const defaultBranch = process.env.DEFAULT_BRANCH || 'main';

  const branchName = summary.branch || `fix/issue-${bugContext.issueNumber}-${bugContext.title
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

  let prNumber: number;
  let prUrl: string;

  try {
    const result = await createPullRequest(token, owner, repo, branchName, prTitle, prBody, defaultBranch);
    prNumber = result.number;
    prUrl = result.url;
  } catch (apiError) {
    if (apiError instanceof Error && apiError.message.includes('403') && apiError.message.includes('not permitted to create or approve pull requests')) {
      console.error('⚠️ Direct API call failed with 403. Trying gh CLI fallback...');

      try {
        const result = await createPullRequestViaCli(token, owner, repo, branchName, prTitle, prBody, defaultBranch);
        prNumber = result.number;
        prUrl = result.url;
        console.log('✅ PR created via gh CLI fallback.');
      } catch (cliError) {
        console.error('❌ gh CLI fallback also failed.');
        console.error('The built-in GITHUB_TOKEN cannot create PRs in this context.');
        console.error('Solution: Set the PR_TOKEN repository secret to a Personal Access Token');
        console.error('  with `repo` and `pull-requests: write` scopes.');
        throw cliError;
      }
    } else {
      throw apiError;
    }
  }

  console.log(`\n✅ Pull Request created: #${prNumber} - ${prUrl}`);

  summary.branch = branchName;
  summary.pullRequest = prNumber;
  summary.pullRequestUrl = prUrl;
  summary.reviewStatus = 'pending';
  summary.mergeStatus = 'pending';
  saveAiFixSummary(summary);

  console.log('\nPR created successfully. Waiting for human review...');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});