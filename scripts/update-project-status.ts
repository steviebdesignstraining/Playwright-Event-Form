import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findProject,
  getProjectItemByIssueNumber,
  getStatusField,
  getStatusOptionId,
  updateItemStatus,
  getRepoInfo,
} from './github-project.js';

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

interface StatusTransitionLog {
  issueNumber: number;
  fromStatus: string;
  toStatus: string;
  success: boolean;
  timestamp: string;
  error?: string;
}

const VALID_STATUSES = [
  'Todo',
  'AI Investigating',
  'AI Fixing',
  'Testing',
  'Human Review',
  'Done',
  'AI Fix Failed',
];

async function main() {
  console.log('Updating GitHub Project status...');

  const token = process.env.PROJECT_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('PROJECT_TOKEN or GITHUB_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const targetStatus = process.env.TARGET_STATUS;
  if (!targetStatus) {
    console.error('TARGET_STATUS environment variable is not set.');
    process.exit(1);
  }

  if (!VALID_STATUSES.includes(targetStatus)) {
    console.error(`Invalid target status: "${targetStatus}". Valid statuses: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  const bugContextPath = join(rootDir, 'bug-context.json');
  if (!existsSync(bugContextPath)) {
    console.error('bug-context.json not found. Run fetch-issue.ts first.');
    process.exit(1);
  }

  const bugContext: BugContext = JSON.parse(readFileSync(bugContextPath, 'utf-8'));
  const { issueNumber, projectItemId, projectStatus: currentStatus } = bugContext;

  const projectName = process.env.PROJECT_NAME || 'AI QA Bug Reporting';
  const projectNumber = process.env.PROJECT_NUMBER ? parseInt(process.env.PROJECT_NUMBER, 10) : undefined;
  const { owner, repo } = getRepoInfo();

  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Issue: #${issueNumber}`);
  console.log(`Project: ${projectName}`);
  console.log(`Current status: ${currentStatus}`);
  console.log(`Target status: ${targetStatus}`);

  if (currentStatus === targetStatus) {
    console.log(`Status is already "${targetStatus}". No update needed.`);
    const log: StatusTransitionLog = {
      issueNumber,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      success: true,
      timestamp: new Date().toISOString(),
    };
    writeTransitionLog(log);
    process.exit(0);
  }

  const project = await findProject(token, owner, repo, projectName, projectNumber);
  if (!project) {
    console.error(`Project "${projectName}" not found.`);
    const log: StatusTransitionLog = {
      issueNumber,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      success: false,
      timestamp: new Date().toISOString(),
      error: `Project "${projectName}" not found`,
    };
    writeTransitionLog(log);
    process.exit(1);
  }

  console.log(`Using project ID: ${project.id}`);

  let itemId = projectItemId;
  if (!itemId) {
    console.log('Project item ID not provided, looking up by issue number...');
    const projectItem = await getProjectItemByIssueNumber(token, project.id, owner, repo, issueNumber);
    if (!projectItem) {
      console.error(`No project item found for issue #${issueNumber}.`);
      const log: StatusTransitionLog = {
        issueNumber,
        fromStatus: currentStatus,
        toStatus: targetStatus,
        success: false,
        timestamp: new Date().toISOString(),
        error: `No project item found for issue #${issueNumber}`,
      };
      writeTransitionLog(log);
      process.exit(1);
    }
    itemId = projectItem.id;
    console.log(`Found project item ID: ${itemId}`);
  }

  const statusField = getStatusField(project);
  if (!statusField) {
    console.error('Status field not found in project. Ensure the project has a "Status" single-select field.');
    const log: StatusTransitionLog = {
      issueNumber,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      success: false,
      timestamp: new Date().toISOString(),
      error: 'Status field not found in project',
    };
    writeTransitionLog(log);
    process.exit(1);
  }

  console.log(`Status field ID: ${statusField.id}`);

  const statusOptionId = getStatusOptionId(statusField, targetStatus);
  if (!statusOptionId) {
    console.error(`Status option "${targetStatus}" not found in project. Available options: ${statusField.options?.map(o => o.name).join(', ') || 'none'}`);
    const log: StatusTransitionLog = {
      issueNumber,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      success: false,
      timestamp: new Date().toISOString(),
      error: `Status option "${targetStatus}" not found in project`,
    };
    writeTransitionLog(log);
    process.exit(1);
  }

  console.log(`Target status option ID: ${statusOptionId}`);

  try {
    await updateItemStatus(token, project.id, itemId, statusField.id, statusOptionId);
    console.log(`Successfully updated Project status: ${currentStatus} → ${targetStatus}`);

    const updatedContext: BugContext = {
      ...bugContext,
      projectItemId: itemId,
      projectStatus: targetStatus,
    };
    writeFileSync(bugContextPath, JSON.stringify(updatedContext, null, 2));

    const log: StatusTransitionLog = {
      issueNumber,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      success: true,
      timestamp: new Date().toISOString(),
    };
    writeTransitionLog(log);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to update Project status: ${message}`);

    const log: StatusTransitionLog = {
      issueNumber,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      success: false,
      timestamp: new Date().toISOString(),
      error: message,
    };
    writeTransitionLog(log);
    process.exit(1);
  }
}

function writeTransitionLog(log: StatusTransitionLog): void {
  const logPath = join(rootDir, 'project-status-transitions.json');
  let logs: StatusTransitionLog[] = [];

  if (existsSync(logPath)) {
    try {
      logs = JSON.parse(readFileSync(logPath, 'utf-8'));
    } catch {
      logs = [];
    }
  }

  logs.push(log);
  writeFileSync(logPath, JSON.stringify(logs, null, 2));
  console.log(`Transition logged to: ${logPath}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});