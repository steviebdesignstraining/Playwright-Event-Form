import { readFileSync, writeFileSync, existsSync, join, dirname } from 'node:fs';
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
    console.error('ai-fix-summary.json not found.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function saveAiFixSummary(summary: AiFixSummary): void {
  const path = join(rootDir, 'ai-fix-summary.json');
  writeFileSync(path, JSON.stringify(summary, null, 2));
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

async function checkPrMerged(token: string, owner: string, repo: string, prNumber: number): Promise<{ merged: boolean; mergeCommitSha: string | null }> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          merged
          mergeCommit {
            oid
          }
        }
      }
    }
  `;

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'AI-Bug-Healer',
    },
    body: JSON.stringify({ query, variables: { owner, repo, number: prNumber } }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GraphQL API error: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as {
    data?: {
      repository?: {
        pullRequest?: {
          merged: boolean;
          mergeCommit: { oid: string } | null;
        } | null;
      } | null;
    } | null;
    errors?: Array<{ message: string }>;
  };

  if (data.errors && data.errors.length > 0) {
    throw new Error(`GraphQL errors: ${data.errors.map(e => e.message).join(', ')}`);
  }

  const pr = data.data?.repository?.pullRequest;
  if (!pr) {
    throw new Error(`PR #${prNumber} not found`);
  }

  return {
    merged: pr.merged,
    mergeCommitSha: pr.mergeCommit?.oid || null,
  };
}

async function main() {
  console.log('Verifying PR merge status...');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const summary = loadAiFixSummary();
  const prNumber = summary.pullRequest;

  if (!prNumber) {
    console.error('No pull request number found.');
    process.exit(1);
  }

  const { owner, repo } = getRepoInfo();
  console.log(`Repository: ${owner}/${repo}`);
  console.log(`PR: #${prNumber}`);

  const { merged, mergeCommitSha } = await checkPrMerged(token, owner, repo, prNumber);

  if (!merged) {
    console.log('PR is not yet merged.');
    process.exit(1);
  }

  console.log(`✅ PR #${prNumber} has been merged!`);
  console.log(`Merge commit: ${mergeCommitSha}`);

  summary.mergeStatus = 'merged';
  saveAiFixSummary(summary);

  const defaultBranch = process.env.DEFAULT_BRANCH || 'main';
  console.log(`\nFetching latest ${defaultBranch}...`);
  execSync(`git fetch origin ${defaultBranch}`, { cwd: rootDir, stdio: 'inherit' });
  execSync(`git checkout ${defaultBranch}`, { cwd: rootDir, stdio: 'inherit' });
  execSync(`git pull origin ${defaultBranch}`, { cwd: rootDir, stdio: 'inherit' });

  console.log(`\nRunning post-merge verification on ${defaultBranch}...`);
  try {
    execSync('npm run test:ci', { 
      cwd: rootDir, 
      stdio: 'inherit',
      timeout: 300_000,
    });
    console.log('\n✅ Post-merge regression tests PASSED');
    summary.postMergeVerification = 'passed';
    saveAiFixSummary(summary);
  } catch (error) {
    console.error('\n❌ Post-merge regression tests FAILED');
    summary.postMergeVerification = 'failed';
    saveAiFixSummary(summary);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});