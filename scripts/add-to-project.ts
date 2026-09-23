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
  fields: ProjectField[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

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
      'X-GitHub-Api-Version': '2022-11-05',
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
  // Try repository-level project first
  const repoQuery = `
    query($owner: String!, $repo: String!, $projectName: String!) {
      repository(owner: $owner, name: $repo) {
        projectV2ByName(name: $projectName) {
          id
          title
          fields(first: 50) {
            nodes {
              id
              name
              type
              ... on ProjectV2SingleSelectField {
                options {
                  id
                  name
                }
              }
              ... on ProjectV2MultiSelectField {
                options {
                  id
                  name
                }
              }
              ... on ProjectV2FieldConfiguration {
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `;

  const repoResult = await graphqlRequest(token, repoQuery, { owner, repo, projectName }) as {
    repository?: {
      projectV2ByName?: {
        id: string;
        title: string;
        fields: { nodes: ProjectField[] };
      } | null;
    } | null;
  };

  if (repoResult?.repository?.projectV2ByName) {
    const project = repoResult.repository.projectV2ByName;
    return { id: project.id, title: project.title, fields: project.fields.nodes };
  }

  // Try organization-level project
  const orgQuery = `
    query($owner: String!, $projectName: String!) {
      organization(login: $owner) {
        projectV2ByName(name: $projectName) {
          id
          title
          fields(first: 50) {
            nodes {
              id
              name
              type
              ... on ProjectV2SingleSelectField {
                options {
                  id
                  name
                }
              }
              ... on ProjectV2MultiSelectField {
                options {
                  id
                  name
                }
              }
              ... on ProjectV2FieldConfiguration {
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `;

  const orgResult = await graphqlRequest(token, orgQuery, { owner, projectName }) as {
    organization?: {
      projectV2ByName?: {
        id: string;
        title: string;
        fields: { nodes: ProjectField[] };
      } | null;
    } | null;
  };

  if (orgResult?.organization?.projectV2ByName) {
    const project = orgResult.organization.projectV2ByName;
    return { id: project.id, title: project.title, fields: project.fields.nodes };
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
      { field: 'Browser', value: 'Chromium' },
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
