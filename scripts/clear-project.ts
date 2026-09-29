import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getProject, getRepoInfo } from './github-project.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

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

async function listProjectItems(token: string, projectId: string): Promise<Array<{ id: string; number: number; title: string; state: string }>> {
  const allItems: Array<{ id: string; number: number; title: string; state: string }> = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    const query = `
      query($projectId: ID!, $after: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              nodes {
                id
                content {
                  ... on Issue {
                    number
                    title
                    state
                  }
                  ... on PullRequest {
                    number
                    title
                    state
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `;

    const variables: Record<string, unknown> = { projectId };
    if (after) variables.after = after;

    const result = await graphqlRequest(token, query, variables) as {
      node?: {
        items?: {
          nodes: Array<{
            id: string;
            content?: { number: number; title: string; state: string } | null;
          }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    };

    const items = result?.node?.items?.nodes ?? [];
    for (const item of items) {
      if (item.content) {
        allItems.push({
          id: item.id,
          number: item.content.number,
          title: item.content.title,
          state: item.content.state,
        });
      } else {
        allItems.push({
          id: item.id,
          number: 0,
          title: '[Unknown content]',
          state: 'unknown',
        });
      }
    }

    hasNextPage = result?.node?.items?.pageInfo.hasNextPage ?? false;
    after = result?.node?.items?.pageInfo.endCursor ?? null;
  }

  return allItems;
}

async function deleteProjectItem(token: string, projectId: string, itemId: string): Promise<void> {
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!) {
      deleteProjectV2Item(input: {
        projectId: $projectId
        itemId: $itemId
      }) {
        deletedItemId
      }
    }
  `;

  await graphqlRequest(token, mutation, { projectId, itemId });
}

async function main() {
  const token = process.env.PROJECT_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('PROJECT_TOKEN or GITHUB_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const projectName = process.env.PROJECT_NAME || 'AI Bug Tracker';
  const projectNumber = parseInt(process.env.PROJECT_NUMBER || '2', 10);
  const { owner, repo } = getRepoInfo();

  console.log('Clearing all items from GitHub Project...');
  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Project: ${projectName} (#${projectNumber})`);

  const project = await getProject(token, owner, repo, projectName, projectNumber);
  if (!project) {
    console.error(`Project "${projectName}" not found.`);
    process.exit(1);
  }

  console.log(`  → Found project "${project.title}" (ID: ${project.id})`);

  const items = await listProjectItems(token, project.id);
  console.log(`  → Found ${items.length} items in the project.`);

  if (items.length === 0) {
    console.log('\nProject is already empty. Nothing to clear.');
    return;
  }

  let deleted = 0;
  let failed = 0;

  for (const item of items) {
    try {
      await deleteProjectItem(token, project.id, item.id);
      console.log(`  → Deleted: #${item.number} "${item.title}" (${item.state})`);
      deleted++;
    } catch (error) {
      console.error(`  → Failed to delete #${item.number} "${item.title}": ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }

  console.log(`\nProject cleared: ${deleted} deleted, ${failed} failed, out of ${items.length} total items.`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
