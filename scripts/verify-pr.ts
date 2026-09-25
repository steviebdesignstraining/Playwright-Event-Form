import { readFileSync, writeFileSync, existsSync, join } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function getPrStatus(token: string, owner: string, repo: string, prNumber: number): Promise<{ state: string; reviewDecision: string; mergeable: string; merged: boolean }> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          state
          reviewDecision
          mergeable
          merged
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
          state: string;
          reviewDecision: string;
          mergeable: string;
          merged: boolean;
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
    state: pr.state,
    reviewDecision: pr.reviewDecision,
    mergeable: pr.mergeable,
    merged: pr.merged,
  };
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
    const { execSync } = require('node:child_process');
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

async function main() {
  console.log('Waiting for human review and merge...');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const summary = loadAiFixSummary();
  const prNumber = summary.pullRequest;

  if (!prNumber) {
    console.error('No pull request number found in ai-fix-summary.json');
    process.exit(1);
  }

  const { owner, repo } = getRepoInfo();
  console.log(`Repository: ${owner}/${repo}`);
  console.log(`PR: #${prNumber}`);
  console.log(`PR URL: ${summary.pullRequestUrl}`);

  const maxWaitMinutes = parseInt(process.env.MAX_WAIT_MINUTES || '60', 10);
  const pollIntervalSeconds = parseInt(process.env.POLL_INTERVAL_SECONDS || '30', 10);
  const maxAttempts = Math.floor((maxWaitMinutes * 60) / pollIntervalSeconds);

  console.log(`Waiting up to ${maxWaitMinutes} minutes for human review and merge...`);
  console.log(`Polling every ${pollIntervalSeconds} seconds.`);

  let finalStatus = 'timeout';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`\nCheck ${attempt}/${maxAttempts}...`);

    try {
      const status = await getPrStatus(token, owner, repo, prNumber);
      console.log(`  State: ${status.state}`);
      console.log(`  Review Decision: ${status.reviewDecision}`);
      console.log(`  Mergeable: ${status.mergeable}`);
      console.log(`  Merged: ${status.merged}`);

      if (status.merged) {
        console.log('\n✅ PR has been merged!');
        summary.mergeStatus = 'merged';
        summary.reviewStatus = 'approved';
        saveAiFixSummary(summary);
        finalStatus = 'merged';
        break;
      }

      if (status.state === 'CLOSED') {
        console.log('\n❌ PR was closed without merging.');
        summary.mergeStatus = 'closed';
        summary.reviewStatus = 'dismissed';
        saveAiFixSummary(summary);
        finalStatus = 'closed';
        break;
      }

      if (status.reviewDecision === 'CHANGES_REQUESTED') {
        console.log('\n⚠️ Changes requested on PR.');
        summary.reviewStatus = 'changes_requested';
        saveAiFixSummary(summary);
        finalStatus = 'changes_requested';
        break;
      }

      if (status.reviewDecision === 'APPROVED') {
        console.log('\n✅ PR approved! Waiting for human to merge...');
        summary.reviewStatus = 'approved';
        saveAiFixSummary(summary);
      }

    } catch (error) {
      console.error(`  Error checking PR status: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
    }
  }

  if (finalStatus === 'timeout') {
    console.log('\n⏱️ Timeout waiting for human review and merge.');
    console.log('The PR is still open and awaiting review/merge.');
  }

  // Always exit 0 - the check-review step reads the summary file to determine outcome
  console.log(`\nFinal status: ${finalStatus}`);
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});