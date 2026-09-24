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
  type: string;
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

// Normalise titles so curly vs straight apostrophes, casing and stray spaces don't break matching
function normaliseTitle(s: string): string {
  return s.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

async function findProject(
  token: string,
  owner: string,
  repo: string,
  projectName: string,
  projectNumber?: number
): Promise<ProjectInfo | null> {
  // NOTE: `fields.nodes` is a union (ProjectV2FieldConfiguration), so nothing can be selected on it
  // directly. Common attributes come from the ProjectV2FieldCommon interface, and options only exist
  // on ProjectV2SingleSelectField. `dataType` is aliased to `type` so the rest of the script keeps working.
  const projectFieldsFragment = `
    id
    title
    number
    fields(first: 50) {
      nodes {
        __typename
        ... on ProjectV2FieldCommon {
          id
          name
          type: dataType
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

  // 0. Most reliable: look the project up by its number (the N in /users/<owner>/projects/N)
  if (projectNumber) {
    for (const ownerType of ['user', 'organization'] as const) {
      try {
        const numberQuery = `
          query($login: String!, $number: Int!) {
            ${ownerType}(login: $login) {
              projectV2(number: $number) {
                ${projectFieldsFragment}
              }
            }
          }
        `;
        const r = await graphqlRequest(token, numberQuery, { login: owner, number: projectNumber }) as Record<
          string,
          { projectV2?: { id: string; title: string; fields: { nodes: ProjectField[] } } | null } | null
        >;
        const p = r?.[ownerType]?.projectV2;
        if (p) {
          console.log(`  → Found project #${projectNumber} ("${p.title}") under ${ownerType} ${owner}`);
          return { id: p.id, title: p.title, fields: p.fields.nodes };
        }
      } catch (error) {
        console.warn(`  → Lookup by number as ${ownerType} failed: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  // 1. Try user-level project (personal account projects like "@steviebdesignstraining's Automation Tests")
  //    No `query:` filter: search syntax chokes on "@" and apostrophes, so list and match locally.
  const userQuery = `
    query($login: String!) {
      user(login: $login) {
        projectsV2(first: 100) {
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
  const userProject = userProjects.find(p => normaliseTitle(p.title) === normaliseTitle(projectName));
  if (userProject) {
    console.log(`  → Found project "${projectName}" under user ${owner}`);
    return { id: userProject.id, title: userProject.title, fields: userProject.fields.nodes };
  }

  // 2. Try organization-level project (using projectV2ByName)
  const orgQuery = `
    query($owner: String!, $projectName: String!) {
      organization(login: $owner) {
        projectV2ByName(name: $projectName) {
          ${projectFieldsFragment}
        }
      }
    }
  `;

  type OrgResult = {
    organization?: {
      projectV2ByName?: {
        id: string;
        title: string;
        fields: { nodes: ProjectField[] };
      } | null;
    } | null;
  };

  let orgResult: OrgResult | null = null;
  try {
    orgResult = await graphqlRequest(token, orgQuery, { owner, projectName }) as OrgResult;
  } catch (error) {
    console.warn(`  → Organization lookup skipped: ${error instanceof Error ? error.message : error}`);
  }

  if (orgResult?.organization?.projectV2ByName) {
    const project = orgResult.organization.projectV2ByName;
    console.log(`  → Found project "${projectName}" under organization ${owner}`);
    return { id: project.id, title: project.title, fields: project.fields.nodes };
  }

  // 3. Try repository-level project (Repository does not have projectV2ByName, use projectsV2 + title filter)
  const repoQuery = `
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        projectsV2(first: 50) {
          nodes {
            ${projectFieldsFragment}
          }
        }
      }
    }
  `;

  type RepoResult = {
    repository?: {
      projectsV2?: {
        nodes: Array<{ id: string; title: string; fields: { nodes: ProjectField[] } }>;
      };
    } | null;
  };

  let repoResult: RepoResult | null = null;
  try {
    repoResult = await graphqlRequest(token, repoQuery, { owner, repo }) as RepoResult;
  } catch (error) {
    console.warn(`  → Repository lookup skipped: ${error instanceof Error ? error.message : error}`);
  }

  const repoProjects = repoResult?.repository?.projectsV2?.nodes ?? [];
  const repoProject = repoProjects.find(p => normaliseTitle(p.title) === normaliseTitle(projectName));
  if (repoProject) {
    console.log(`  → Found project "${projectName}" under repository ${owner}/${repo}`);
    return { id: repoProject.id, title: repoProject.title, fields: repoProject.fields.nodes };
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
      }
    }
  `;

  const result = await graphqlRequest(token, mutation, {
    projectId,
    contentId: issueNodeId,
  }) as {
    addProjectV2ItemById?: {
      item?: { id: string };
    };
  };

  if (!result?.addProjectV2ItemById?.item?.id) {
    throw new Error('Failed to add issue to project: no item returned');
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

  if (field.type === 'SINGLE_SELECT' && field.options) {
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
  } else if (field.type === 'MULTI_SELECT' && field.options) {
    const option = field.options.find(o => o.name === value);
    if (!option) {
      console.warn(`  → Option "${value}" not found for field "${field.name}"`);
      return;
    }
    variables = {
      projectId,
      itemId,
      fieldId: field.id,
      value: { optionIds: [option.id] },
    };
  } else if (field.type === 'TEXT') {
    variables = {
      projectId,
      itemId,
      fieldId: field.id,
      value: { text: value },
    };
  } else if (field.type === 'NUMBER') {
    variables = {
      projectId,
      itemId,
      fieldId: field.id,
      value: { number: value },
    };
  } else {
    console.warn(`  → Field "${field.name}" type "${field.type}" is not supported`);
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
  const projectNumber = process.env.PROJECT_NUMBER ? parseInt(process.env.PROJECT_NUMBER, 10) : undefined;
  const items = loadCreatedIssues();
  const { owner, repo } = getRepoInfo();

  if (items.length === 0) {
    console.log('No issues to add to project.');
    return;
  }

  console.log(`Looking for project "${projectName}" in ${owner}/${repo}...`);

  const project = await findProject(token, owner, repo, projectName, projectNumber);
  if (!project) {
    console.error(`Project "${projectName}" not found.`);
    console.error('Please ensure the project exists and the token has `repo` and `project` scopes.');
    console.error('Note: the default GITHUB_TOKEN cannot see user-owned (personal) Projects v2 - set a PROJECT_PAT secret.');
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
