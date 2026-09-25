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

interface StatusTransitionLog {
  issueNumber: number;
  fromStatus: string;
  toStatus: string;
  success: boolean;
  timestamp: string;
  error?: string;
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
}

async function uploadHealingEvidence(): Promise<void> {
  const evidenceDir = join(rootDir, 'ai-healing-evidence');
  if (!existsSync(evidenceDir)) {
    mkdirSync(evidenceDir, { recursive: true });
  }

  const filesToCopy = [
    'bug-context.json',
    'root-cause.json',
    'ai-fix-summary.json',
    'git-diff.patch',
    'project-status-transitions.json',
  ];

  for (const file of filesToCopy) {
    const src = join(rootDir, file);
    if (existsSync(src)) {
      const dest = join(evidenceDir, file);
      writeFileSync(dest, readFileSync(src, 'utf-8'));
      console.log(`  → Copied ${file} to evidence directory`);
    }
  }

  console.log(`Evidence saved to: ${evidenceDir}`);
}

async function main() {
  console.log('Finalizing bug healing - moving to Done...');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const summary = loadAiFixSummary();

  const { issueNumber, projectItemId, initialStatus, pullRequest, mergeStatus, postMergeVerification, targetedTestResult, regressionResult, reviewStatus } = summary;

  console.log(`Issue: #${issueNumber}`);
  console.log(`PR: #${pullRequest}`);
  console.log(`Merge status: ${mergeStatus}`);
  console.log(`Post-merge verification: ${postMergeVerification}`);
  console.log(`Targeted test: ${targetedTestResult}`);
  console.log(`Regression: ${regressionResult}`);
  console.log(`Review status: ${reviewStatus}`);

  const canComplete = 
    targetedTestResult === 'passed' &&
    regressionResult === 'passed' &&
    reviewStatus === 'approved' &&
    mergeStatus === 'merged' &&
    postMergeVerification === 'passed';

  if (!canComplete) {
    console.error('\n❌ Cannot move to Done - not all conditions met:');
    console.error(`  Targeted test passed: ${targetedTestResult === 'passed'}`);
    console.error(`  Regression passed: ${regressionResult === 'passed'}`);
    console.error(`  PR approved: ${reviewStatus === 'approved'}`);
    console.error(`  PR merged: ${mergeStatus === 'merged'}`);
    console.error(`  Post-merge verification: ${postMergeVerification === 'passed'}`);
    process.exit(1);
  }

  console.log('\n✅ All conditions met. Proceeding to move Project item to Done.');

  const projectName = process.env.PROJECT_NAME || 'AI QA Bug Reporting';
  const projectNumber = process.env.PROJECT_NUMBER ? parseInt(process.env.PROJECT_NUMBER, 10) : undefined;
  const { owner, repo } = getRepoInfo();

  const project = await findProject(token, owner, repo, projectName, projectNumber);
  if (!project) {
    console.error(`Project "${projectName}" not found.`);
    const log: StatusTransitionLog = {
      issueNumber,
      fromStatus: summary.finalStatus || 'Human Review',
      toStatus: 'Done',
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
        fromStatus: summary.finalStatus || 'Human Review',
        toStatus: 'Done',
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
    console.error('Status field not found in project.');
    const log: StatusTransitionLog = {
      issueNumber,
      fromStatus: summary.finalStatus || 'Human Review',
      toStatus: 'Done',
      success: false,
      timestamp: new Date().toISOString(),
      error: 'Status field not found in project',
    };
    writeTransitionLog(log);
    process.exit(1);
  }

  const statusOptionId = getStatusOptionId(statusField, 'Done');
  if (!statusOptionId) {
    console.error('Status option "Done" not found in project.');
    const log: StatusTransitionLog = {
      issueNumber,
      fromStatus: summary.finalStatus || 'Human Review',
      toStatus: 'Done',
      success: false,
      timestamp: new Date().toISOString(),
      error: 'Status option "Done" not found in project',
    };
    writeTransitionLog(log);
    process.exit(1);
  }

  try {
    await updateItemStatus(token, project.id, itemId, statusField.id, statusOptionId);
    console.log(`Successfully updated Project status: ${summary.finalStatus || 'Human Review'} → Done`);

    const log: StatusTransitionLog = {
      issueNumber,
      fromStatus: summary.finalStatus || 'Human Review',
      toStatus: 'Done',
      success: true,
      timestamp: new Date().toISOString(),
    };
    writeTransitionLog(log);

    summary.finalStatus = 'Done';
    summary.projectCompletion = 'Done';
    saveAiFixSummary(summary);

    await uploadHealingEvidence();

    console.log('\n✅ Bug healing lifecycle complete!');
    console.log(`Issue #${issueNumber}: DONE`);
    console.log(`Project item: DONE`);
    console.log(`PR #${pullRequest}: MERGED`);
    console.log(`All validations: PASSED`);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to update Project status to Done: ${message}`);

    const log: StatusTransitionLog = {
      issueNumber,
      fromStatus: summary.finalStatus || 'Human Review',
      toStatus: 'Done',
      success: false,
      timestamp: new Date().toISOString(),
      error: message,
    };
    writeTransitionLog(log);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});