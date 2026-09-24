import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

interface CreatedIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
}

interface BugMetadata {
  title: string;
  failureType: string;
  severity: string;
  priority: string;
  classification: string;
  confidence: number;
  project?: string;
}

interface IssueWithMetadata {
  issue: CreatedIssue;
  bug: BugMetadata;
  labels: string[];
}

interface ProjectField {
  id: string;
  name: string;
  dataType: string;
  options?: Array<{ name: string; id: string }>;
}

interface ProjectInfo {
  id: string;
  title: string;
  fields: ProjectField[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function getBrowserFromProject(project: string): string {
  const p = project.toLowerCase();
  if (p === 'chromium') return 'Chromium';
  if (p === 'firefox') return 'Firefox';
  if (p === 'webkit') return 'WebKit';
  if (p === 'api') return 'API';
  if (p.includes('chrome')) return 'Chrome';
  if (p.includes('edge')) return 'Edge';
  return 'Unknown';
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

function loadCreatedIssues(): IssueWithMetadata[] {
  const path = join(rootDir, 'created-issues.json');
  if (!existsSync(path)) {
    console.error('No created-issues.json found. Run create-github-issue.ts first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

async function graphqlRequest(
  token: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<unknown> {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'AI-QA-Bug-Reporting',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GraphQL API error: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as {
    data?: Record<string, unknown>;
    errors?: Array<{ message: string; path?: string[] }>;
  };

  if (data.errors && data.errors.length > 0) {
    const messages = data.errors.map(e => `${e.message}${e.path ? ` (at ${e.path.join('.')})` : ''}`).join(', ');
    throw new Error(`GraphQL errors: ${messages}`);
  }

  return data.data;
}

async function findProject(token: string, owner: string, repo: string, projectName: string): Promise<ProjectInfo | null> {
  const projectFieldsFragment = `
    id
    title
    number
    fields(first: 50) {
      nodes {
        ... on ProjectV2FieldCommon {
          id
          name
          dataType
        }
        ... on ProjectV2SingleSelectField {
          options {
            id
            name
          }
        }
      }
    }
  `;

  // 1. Try user-level project (personal account projects like "@steviebdesignstraining's Automation Tests")
  // Note: do NOT use the `query` parameter for projectsV2 — GitHub interprets it as a search
  // expression, so apostrophes in names (e.g. "steviebdesignstraining's") cause no matches.
  // Fetch all projects and filter by exact title in TypeScript instead.
  const userQuery = `
    query($login: String!) {
      user(login: $login) {
        projectsV2(first: 20) {
          nodes {
            ${projectFieldsFragment}
          }
        }
      }
    }
  `;

  const userResult = await graphqlRequest(token, userQuery, { login: owner }) as {
    user?: {
      projectsV2?: {
        nodes: Array<{ id: string; title: string; fields: { nodes: ProjectField[] } }>;
      };
    } | null;
  };

  const userProjects = userResult?.user?.projectsV2?.nodes ?? [];
  const userProject = userProjects.find(p => p.title === projectName);
  if (userProject) {
    console.log(`  → Found project "${projectName}" under user ${owner}`);
    return { id: userProject.id, title: userProject.title, fields: userProject.fields.nodes };
  }
  if (userProjects.length > 0) {
    console.log(`  → No exact title match under user ${owner}. Candidates: ${userProjects.map(p => `"${p.title}"`).join(', ')}`);
  }

  // 2. Try organization-level project (list all, filter by exact title)
  const orgQuery = `
    query($login: String!) {
      organization(login: $login) {
        projectsV2(first: 20) {
          nodes {
            ${projectFieldsFragment}
          }
        }
      }
    }
  `;

  let orgResult: {
    organization?: {
      projectsV2?: {
        nodes: Array<{ id: string; title: string; fields: { nodes: ProjectField[] } }>;
      };
    } | null;
  } | undefined;

  try {
    orgResult = await graphqlRequest(token, orgQuery, { login: owner }) as typeof orgResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Could not resolve to an Organization')) {
      // owner is a user account, not an organization — expected, try the next lookup
      orgResult = undefined;
    } else {
      throw error;
    }
  }

  const orgProjects = orgResult?.organization?.projectsV2?.nodes ?? [];
  const orgProject = orgProjects.find(p => p.title === projectName);
  if (orgProject) {
    console.log(`  → Found project "${projectName}" under organization ${owner}`);
    return { id: orgProject.id, title: orgProject.title, fields: orgProject.fields.nodes };
  }
  if (orgProjects.length > 0) {
    console.log(`  → No exact title match under organization ${owner}. Candidates: ${orgProjects.map(p => `"${p.title}"`).join(', ')}`);
  }

  // 3. Try repository-level project (list all, filter by exact title)
  const repoQuery = `
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        projectsV2(first: 20) {
          nodes {
            ${projectFieldsFragment}
          }
        }
      }
    }
  `;

  const repoResult = await graphqlRequest(token, repoQuery, { owner, repo }) as {
    repository?: {
      projectsV2?: {
        nodes: Array<{ id: string; title: string; fields: { nodes: ProjectField[] } }>;
      };
    } | null;
  };

  const repoProjects = repoResult?.repository?.projectsV2?.nodes ?? [];
  const repoProject = repoProjects.find(p => p.title === projectName);
  if (repoProject) {
    console.log(`  → Found project "${projectName}" under repository ${owner}/${repo}`);
    return { id: repoProject.id, title: repoProject.title, fields: repoProject.fields.nodes };
  }
  if (repoProjects.length > 0) {
    console.log(`  → No exact title match under repository ${owner}/${repo}. Candidates: ${repoProjects.map(p => `"${p.title}"`).join(', ')}`);
  }

  return null;
}

async function getIssueNodeId(token: string, owner: string, repo: string, issueNumber: number): Promise<string | null> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          id
          title
        }
      }
    }
  `;

  const result = await graphqlRequest(token, query, { owner, repo, number: issueNumber }) as {
    repository?: {
      issue?: { id: string; title: string } | null;
    } | null;
  };

  return result?.repository?.issue?.id || null;
}

async function addIssueToProject(token: string, projectId: string, issueNodeId: string): Promise<string> {
  const mutation = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {
        projectId: $projectId
        contentId: $contentId
      }) {
        item {
          id
        }
        userStatus {
          message
        }
      }
    }
  `;

  const result = await graphqlRequest(token, mutation, {
    projectId,
    contentId: issueNodeId,
  }) as {
    addProjectV2ItemById?: {
      item?: { id: string };
      userStatus?: { message: string };
    };
  };

  if (!result?.addProjectV2ItemById?.item?.id) {
    const message = result?.addProjectV2ItemById?.userStatus?.message || 'Unknown error';
    throw new Error(`Failed to add issue to project: ${message}`);
  }

  return result.addProjectV2ItemById.item.id;
}

async function setFieldValue(
  token: string,
  projectId: string,
  itemId: string,
  field: ProjectField,
  value: string
): Promise<void> {
  let variables: Record<string, unknown>;

  if (field.dataType === 'SINGLE_SELECT' && field.options) {
    const option = field.options.find(o => o.name === value);
    if (!option) {
      console.warn(`  → Option "${value}" not found for field "${field.name}"`);
      return;
    }
    variables = {
      projectId,
      itemId,
      fieldId: field.id,
      value: { optionId: option.id },
    };
  } else if (field.dataType === 'TEXT') {
    variables = {
      projectId,
      itemId,
      fieldId: field.id,
      value: { text: value },
    };
  } else if (field.dataType === 'NUMBER') {
    variables = {
      projectId,
      itemId,
      fieldId: field.id,
      value: { number: Number(value) },
    };
  } else {
    console.warn(`  → Field "${field.name}" type "${field.dataType}" is not supported`);
    return;
  }

  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: $value
      }) {
        projectV2Item {
          id
        }
      }
    }
  `;

  await graphqlRequest(token, mutation, variables);
  console.log(`  → Set ${field.name} = ${value}`);
}

async function main() {
  console.log('Adding issues to GitHub Project...');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const projectName = process.env.PROJECT_NAME || 'AI QA Bug Reporting';
  const items = loadCreatedIssues();
  const { owner, repo } = getRepoInfo();

  if (items.length === 0) {
    console.log('No issues to add to project.');
    return;
  }

  console.log(`Looking for project "${projectName}" in ${owner}/${repo}...`);

  const project = await findProject(token, owner, repo, projectName);
  if (!project) {
    console.error(`Project "${projectName}" not found.`);
    console.error('Please ensure the project exists and the token has `repo` and `project` scopes.');
    process.exit(1);
  }

  console.log(`Using project ID: ${project.id}`);
  console.log(`Found ${project.fields.length} field(s).`);

  const findField = (name: string): ProjectField | undefined =>
    project.fields.find(f => f.name === name);

  for (const item of items) {
    const { issue, bug } = item;
    console.log(`Processing issue #${issue.number}: ${issue.title}`);

    const issueNodeId = await getIssueNodeId(token, owner, repo, issue.number);
    if (!issueNodeId) {
      console.error(`  → Could not find node ID for issue #${issue.number}`);
      continue;
    }

    let itemId: string;
    try {
      itemId = await addIssueToProject(token, project.id, issueNodeId);
      console.log(`  → Added to project (item ID: ${itemId})`);
    } catch (error) {
      console.error(`  → Failed to add to project: ${error instanceof Error ? error.message : error}`);
      continue;
    }

    const fieldsToSet = [
      { field: 'Type', value: 'Bug' },
      { field: 'Severity', value: bug.severity },
      { field: 'Priority', value: bug.priority },
      { field: 'Failure Type', value: bug.failureType },
      { field: 'Automation', value: 'Playwright' },
      { field: 'Browser', value: getBrowserFromProject(bug.project || '') },
      { field: 'Environment', value: 'CI' },
    ];

    for (const { field: fieldName, value } of fieldsToSet) {
      const field = findField(fieldName);
      if (!field) {
        console.warn(`  → Field "${fieldName}" not found in project`);
        continue;
      }

      try {
        await setFieldValue(token, project.id, itemId, field, value);
      } catch (error) {
        console.error(`  → Failed to set ${fieldName}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  console.log('Done.');
}

main();
