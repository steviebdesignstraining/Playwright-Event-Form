#!/usr/bin/env node
import { execSync } from 'node:child_process';

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('GITHUB_TOKEN environment variable is not set.');
  process.exit(1);
}
const OWNER = 'steviebdesignstraining';
const REPO = 'Playwright-Event-Form';
const API = 'https://api.github.com';

function ghGet(path: string): any {
  const result = execSync(`curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github+json" "${API}${path}"`, {
    encoding: 'utf-8',
  });
  return JSON.parse(result);
}

function ghDelete(path: string): void {
  execSync(`curl -s -X DELETE -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github+json" "${API}${path}"`, {
    encoding: 'utf-8',
  });
}

async function main() {
  console.log('Fetching all issues...');

  // Fetch all issues (state=all to get closed ones too)
  let allIssues: Array<{ number: number; title: string; state: string }> = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const issues = ghGet(`/repos/${OWNER}/${REPO}/issues?state=all&per_page=${perPage}&page=${page}`);
    if (issues.length === 0) break;
    
    allIssues = allIssues.concat(
      issues
        .filter((i: any) => !i.pull_request)
        .map((i: any) => ({ number: i.number, title: i.title, state: i.state }))
    );
    console.log(`  Page ${page}: ${issues.filter((i: any) => !i.pull_request).length} issues`);

    if (issues.length < perPage) break;
    page++;
  }

  console.log(`\nTotal issues to delete: ${allIssues.length}`);

  let deleted = 0;
  let failed = 0;

  for (const issue of allIssues) {
    try {
      ghDelete(`/repos/${OWNER}/${REPO}/issues/${issue.number}`);
      console.log(`  Deleted #${issue.number}: "${issue.title}" (${issue.state})`);
      deleted++;
    } catch (error) {
      console.error(`  Failed #${issue.number}: "${issue.issue.title}" - ${error}`);
      failed++;
    }
  }

  console.log(`\nDone: ${deleted} deleted, ${failed} failed.`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
