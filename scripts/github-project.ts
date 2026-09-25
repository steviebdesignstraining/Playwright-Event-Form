import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolves an artifact file path that may live either at the repository root
 * or inside a per-artifact subdirectory created by actions/download-artifact@v4.
 *
 * GitHub's download-artifact action creates a `<artifact-name>/` subdirectory
 * when no `name` filter is supplied, so `bug-context.json` can end up at
 * `bug-context/bug-context.json`. The subfolder is named after the artifact
 * name (the filename minus its extension), so the fallback strips the
 * extension before joining.
 */
export function resolveArtifactPath(rootDir: string, filename: string): string {
  const direct = join(rootDir, filename);
  if (existsSync(direct)) return direct;

  // Fall back to the per-artifact subdirectory layout.
  // The artifact name is the filename without its extension (e.g.
  // `bug-context` for `bug-context.json`, `git-diff` for `git-diff.patch`).
  const lastDot = filename.lastIndexOf('.');
  const artifactName = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const subdir = join(rootDir, artifactName, filename);
  if (existsSync(subdir)) return subdir;

  return direct;
}

export function readArtifactJson<T>(rootDir: string, filename: string): T {
  const path = resolveArtifactPath(rootDir, filename);
  if (!existsSync(path)) {
    throw new Error(`${filename} not found at ${path}. Run the preceding step first.`);
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export interface ProjectField {
  id: string;
  name: string;
  type: string;
  options?: Array<{ name: string; id: string }>;
}

export interface ProjectInfo {
  id: string;
  title: string;
  fields: ProjectField[];
}

export interface ProjectItem {
  id: string;
  content: {
    __typename: string;
    number: number;
    title: string;
    state: string;
    url: string;
  };
  status?: string;
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
    const remote = execSync('git config --get remote.origin.url', { encoding: 'utf-8' }).trim();
    const match = remote.match(/(?:git@github\.com:|https:\/\/github\.com\/)([^\/\s]+)\/([^\/\s]+?)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // ignore
  }
  throw new Error('Could not determine GitHub repository.');
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
      'User-Agent': 'AI-Bug-Healer',
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

function normaliseTitle(s: string): string {
  return s.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function findProject(
  token: string,
  owner: string,
  repo: string,
  projectName: string,
  projectNumber?: number
): Promise<ProjectInfo | null> {
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

  if (projectNumber) {
    // This project is user-owned (/users/<owner>/projects/<number>).
    // Do not probe the organization API: the repository owner is a user,
    // and that lookup produces misleading "organization not found" errors.
    const ownerType = process.env.PROJECT_OWNER_TYPE === 'organization'
      ? 'organization'
      : 'user';

    {
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

  // Try organization-level project by listing and matching name
  // (projectV2ByName is not available on Organization in the current GraphQL schema)
  const orgListQuery = `
    query($owner: String!) {
      organization(login: $owner) {
        projectsV2(first: 100) {
          nodes {
            ${projectFieldsFragment}
          }
        }
      }
    }
  `;

  type OrgListResult = {
    organization?: {
      projectsV2?: {
        nodes: Array<{ id: string; title: string; fields: { nodes: ProjectField[] } }>;
      };
    } | null;
  };

  let orgListResult: OrgListResult | null = null;
  try {
    orgListResult = await graphqlRequest(token, orgListQuery, { owner }) as OrgListResult;
  } catch (error) {
    console.warn(`  → Organization project listing skipped: ${error instanceof Error ? error.message : error}`);
  }

  if (orgListResult?.organization?.projectsV2?.nodes) {
    const orgProjects = orgListResult.organization.projectsV2.nodes;
    const orgProject = orgProjects.find(p => normaliseTitle(p.title) === normaliseTitle(projectName));
    if (orgProject) {
      console.log(`  → Found project "${projectName}" under organization ${owner}`);
      return { id: orgProject.id, title: orgProject.title, fields: orgProject.fields.nodes };
    }
  }

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

export async function getProjectItemByIssueNumber(
  token: string,
  projectId: string,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<ProjectItem | null> {
  const query = `
    query($projectId: ID!, $owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          id
          title
          state
          url
          projectItems(first: 10) {
            nodes {
              id
              project {
                id
              }
            }
          }
        }
      }
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 50) {
            nodes {
              id
              content {
                __typename
                ... on Issue {
                  number
                  title
                  state
                  url
                }
              }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
                      }
                    }
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const result = await graphqlRequest(token, query, { projectId, owner, repo, number: issueNumber }) as {
    repository?: {
      issue?: {
        id: string;
        title: string;
        state: string;
        url: string;
        projectItems?: { nodes: Array<{ id: string; project: { id: string } }> };
      } | null;
    } | null;
    node?: {
      items?: {
        nodes: Array<{
          id: string;
          content: { __typename: string; number: number; title: string; state: string; url: string } | null;
          fieldValues: { nodes: Array<{ field?: { name: string }; name?: string }> };
        }>;
      };
    } | null;
  } | null;

  const issue = result?.repository?.issue;
  if (!issue) {
    return null;
  }

  const projectItems = result?.node?.items?.nodes ?? [];
  const matchingItem = projectItems.find(
    item => item.content && item.content.__typename === 'Issue' && item.content.number === issueNumber
  );

  if (!matchingItem) {
    return null;
  }

  let status = 'Unknown';
  for (const fv of matchingItem.fieldValues.nodes) {
    if (fv.field?.name === 'Status' && fv.name) {
      status = fv.name;
      break;
    }
  }

  return {
    id: matchingItem.id,
    content: {
      __typename: 'Issue',
      number: issue.number,
      title: issue.title,
      state: issue.state,
      url: issue.url,
    },
    status,
  };
}

export async function getIssueNodeId(token: string, owner: string, repo: string, issueNumber: number): Promise<string | null> {
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

export async function addIssueToProject(token: string, projectId: string, issueNodeId: string): Promise<string> {
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

export function getStatusField(project: ProjectInfo): ProjectField | undefined {
  return project.fields.find(f => f.name === 'Status' && f.type === 'SINGLE_SELECT');
}

export async function ensureStatusOption(
  token: string,
  projectId: string,
  statusField: ProjectField,
  statusName: string
): Promise<string | null> {
  const existing = statusField.options?.find(o => o.name === statusName);
  if (existing) {
    return existing.id;
  }

  if (statusField.type !== 'SINGLE_SELECT') {
    return null;
  }

  const existingOptions = statusField.options ?? [];
  if (existingOptions.length >= 50) {
    throw new Error('The Status field already has the maximum of 50 single-select options.');
  }

  const colours = ['GRAY', 'BLUE', 'PURPLE', 'ORANGE', 'YELLOW', 'GREEN', 'RED'] as const;
  const colour = colours[existingOptions.length % colours.length];

  const mutation = `
    mutation($fieldId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
      updateProjectV2Field(input: {
        fieldId: $fieldId
        name: $name
        singleSelectOptions: $options
      }) {
        projectV2Field {
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
            }
          }
        }
      }
    }
  `;

  const options = [
    ...existingOptions.map(option => ({
      id: option.id,
      name: option.name,
      color: 'GRAY',
      description: option.name,
    })),
    {
      name: statusName,
      color: colour,
      description: `AI Bug Healer workflow status: ${statusName}`,
    },
  ];

  const result = await graphqlRequest(token, mutation, {
    fieldId: statusField.id,
    name: statusField.name,
    options,
  }) as {
    updateProjectV2Field?: {
      projectV2Field?: {
        options?: Array<{ id: string; name: string }>;
      } | null;
    };
  };

  const updatedOptions = result?.updateProjectV2Field?.projectV2Field?.options ?? [];
  const created = updatedOptions.find(option => option.name === statusName);

  if (!created) {
    throw new Error(`GitHub Project Status option "${statusName}" could not be created.`);
  }

  console.log(`  → Created missing Project Status option "${statusName}"`);
  return created.id;
}

export async function updateItemStatus(
  token: string,
  projectId: string,
  itemId: string,
  statusFieldId: string,
  statusOptionId: string
): Promise<void> {
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
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

  await graphqlRequest(token, mutation, {
    projectId,
    itemId,
    fieldId: statusFieldId,
    value: { singleSelectOptionId: statusOptionId },
  });
  console.log(`  → Updated Project status to option ID: ${statusOptionId}`);
}

export async function setFieldValue(
  token: string,
  projectId: string,
  itemId: string,
  field: ProjectField,
  value: string
): Promise<void> {
  let variables: Record<string, unknown>;

  if (field.type === 'SINGLE_SELECT' && field.options) {
    let option = field.options.find(o => o.name === value);
    if (!option) {
      // Auto-create the missing option so the value can be set.
      // This keeps the workflow self-healing for custom option vocabularies.
      try {
        const newId = await ensureStatusOption(token, projectId, field, value);
        if (newId) {
          option = { id: newId, name: value };
          field.options.push(option);
        }
      } catch {
        // Fall through to the warn below.
      }
    }
    if (!option) {
      console.warn(`  → Option "${value}" not found for field "${field.name}"`);
      return;
    }
    variables = {
      projectId,
      itemId,
      fieldId: field.id,
      value: { singleSelectOptionId: option.id },
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
      value: { multiSelectOptionIds: [option.id] },
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
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
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

export async function getProject(
  token: string,
  owner: string,
  repo: string,
  projectName: string,
  projectNumber?: number
): Promise<ProjectInfo | null> {
  return findProject(token, owner, repo, projectName, projectNumber);
}

export { getRepoInfo };