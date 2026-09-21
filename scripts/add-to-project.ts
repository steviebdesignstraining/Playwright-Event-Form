import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface CreatedIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
}

interface IssueWithMetadata {
  issue: CreatedIssue;
  bug: {
    title: string;
    failureType: string;
    severity: string;
    priority: string;
    classification: string;
    confidence: number;
  };
}

interface ProjectFields {
  id: string;
  name: string;
  options?: Array<{ name: string; id: string }>;
}

interface ProjectV2 {
  id: string;
  title: string;
  fields: ProjectFields[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function getRepoInfo(): { owner: string; repo: string } {
  const { execSync } = require('node:child_process');
  try {
    const remote = execSync('git config --get remote.origin.url', { cwd: rootDir, encoding: 'utf-8' }).trim();
    const match = remote.match(/(?:git@github\.com:|https:\/\/github\.com\/)([^\/\s]+)\/([^\/\s]+?)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // ignore
  }
  throw new Error('Could not determine GitHub repository from git remote.');
}

function loadCreatedIssues(): IssueWithMetadata[] {
  const path = join(rootDir, 'created-issues.json');
  if (!existsSync(path)) {
    console.error('No created-issues.json found. Run create-github-issue.ts first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

async function getProjectId(owner: string, repo: string, token: string, projectName: string): Promise<string | null> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/projects`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-05',
    },
  });

  if (!response.ok) {
    console.warn(`Could not fetch projects: ${response.status}`);
    return null;
  }

  const projects: ProjectV2[] = await response.json();
  const project = projects.find(p => p.title === projectName);
  return project?.id || null;
}

async function getProjectFields(owner: string, repo: string, token: string, projectId: string): Promise<ProjectFields[]> {
  const response = await fetch(`https://api.github.com/projects/${projectId}/fields`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-05',
    },
  });

  if (!response.ok) {
    console.warn(`Could not fetch project fields: ${response.status}`);
    return [];
  }

  const fields: ProjectFields[] = await response.json();
  return fields;
}

async function addToProject(owner: string, repo: string, token: string, projectId: string, issueNumber: number) {
  const response = await fetch(`https://api.github.com/projects/items`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-05',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectId,
      contentId: issueNumber,
      contentTypeId: 'Issue',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to add to project: ${response.status} ${body}`);
  }

  console.log(`  → Added issue #${issueNumber} to project ${projectId}`);
}

async function setProjectField(owner: string, repo: string, token: string, projectId: string, itemId: string, fieldName: string, value: string) {
  const fields = await getProjectFields(owner, repo, token, projectId);
  const field = fields.find(f => f.name === fieldName);
  if (!field) {
    console.warn(`  → Field "${fieldName}" not found in project`);
    return;
  }

  const option = field.options?.find(o => o.name === value);
  if (!option) {
    console.warn(`  → Option "${value}" not found for field "${fieldName}"`);
    return;
  }

  await fetch(`https://api.github.com/projects/fields/${field.id}/items/${itemId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-05',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      optionId: option.id,
    }),
  });

  console.log(`  → Set ${fieldName} = ${value}`);
}

async function main() {
  console.log('Adding issues to GitHub Project...');

  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const projectName = process.env.PROJECT_NAME || 'AI QA Bug Reporting';
  const items = loadCreatedIssues();
  const { owner, repo } = getRepoInfo();

  const projectId = await getProjectId(owner, repo, token, projectName);
  if (!projectId) {
    console.error(`Project "${projectName}" not found.`);
    process.exit(1);
  }

  console.log(`Using project ID: ${projectId}`);

  for (const item of items) {
    const { issue, bug } = item;
    console.log(`Processing issue #${issue.number}: ${issue.title}`);

    try {
      await addToProject(owner, repo, token, projectId, issue.number);
    } catch (error) {
      console.error(`  → Failed to add to project: ${error instanceof Error ? error.message : error}`);
      continue;
    }

    const itemNumber = issue.number;

    const fieldsToSet = [
      { field: 'Type', value: 'Bug' },
      { field: 'Severity', value: bug.severity },
      { field: 'Priority', value: bug.priority },
      { field: 'Failure Type', value: bug.failureType },
      { field: 'Automation', value: 'Playwright' },
      { field: 'Browser', value: 'Chromium' },
      { field: 'Environment', value: 'CI' },
    ];

    for (const { field, value } of fieldsToSet) {
      try {
        await setProjectField(owner, repo, token, projectId, String(itemNumber), field, value);
      } catch (error) {
        console.error(`  → Failed to set ${field}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  console.log('Done.');
}

main();
