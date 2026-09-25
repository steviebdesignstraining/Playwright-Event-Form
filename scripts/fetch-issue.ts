import { writeFileSync, existsSync, mkdirSync, join } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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

async function fetchIssueDetails(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<{ title: string; body: string; labels: string[]; state: string; url: string } | null> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          title
          body
          state
          url
          labels(first: 20) {
            nodes {
              name
            }
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
    body: JSON.stringify({ query, variables: { owner, repo, number: issueNumber } }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GraphQL API error: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as {
    data?: {
      repository?: {
        issue?: {
          title: string;
          body: string;
          state: string;
          url: string;
          labels: { nodes: Array<{ name: string }> };
        } | null;
      } | null;
    } | null;
    errors?: Array<{ message: string }>;
  };

  if (data.errors && data.errors.length > 0) {
    throw new Error(`GraphQL errors: ${data.errors.map(e => e.message).join(', ')}`);
  }

  const issue = data.data?.repository?.issue;
  if (!issue) {
    return null;
  }

  return {
    title: issue.title,
    body: issue.body || '',
    labels: issue.labels.nodes.map(l => l.name),
    state: issue.state,
    url: issue.url,
  };
}

async function main() {
  console.log('Fetching bug context from GitHub Issue...');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const issueNumberStr = process.env.ISSUE_NUMBER;
  if (!issueNumberStr) {
    console.error('ISSUE_NUMBER environment variable is not set.');
    process.exit(1);
  }

  const issueNumber = parseInt(issueNumberStr, 10);
  if (isNaN(issueNumber)) {
    console.error('ISSUE_NUMBER must be a valid integer.');
    process.exit(1);
  }

  const projectItemId = process.env.PROJECT_ITEM_ID || '';
  const projectStatus = process.env.PROJECT_STATUS || 'Unknown';

  const { owner, repo } = getRepoInfo();
  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Issue: #${issueNumber}`);

  const issue = await fetchIssueDetails(token, owner, repo, issueNumber);
  if (!issue) {
    console.error(`Issue #${issueNumber} not found in ${owner}/${repo}.`);
    process.exit(1);
  }

  if (issue.state !== 'OPEN') {
    console.error(`Issue #${issueNumber} is not open (state: ${issue.state}).`);
    process.exit(1);
  }

  const isBug = issue.labels.some(l => l.toLowerCase().includes('bug') || l.toLowerCase().includes('product'));
  if (!isBug) {
    console.warn(`Issue #${issueNumber} does not appear to be a bug (labels: ${issue.labels.join(', ')}).`);
  }

  const bugContext: BugContext = {
    issueNumber,
    title: issue.title,
    body: issue.body,
    url: issue.url,
    labels: issue.labels,
    projectItemId,
    projectStatus,
    state: issue.state,
  };

  const outputPath = join(rootDir, 'bug-context.json');
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(bugContext, null, 2));
  console.log(`Bug context written to: ${outputPath}`);
  console.log(`Issue: #${issueNumber} - ${issue.title}`);
  console.log(`Project Item ID: ${projectItemId || 'Not provided'}`);
  console.log(`Project Status: ${projectStatus}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});