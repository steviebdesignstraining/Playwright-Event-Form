import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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

const FORBIDDEN_PATTERNS = [
  { pattern: /describe\.skip|test\.skip|it\.skip|xit\.skip/, description: 'Skipped tests' },
  { pattern: /\.only\(/, description: 'Focused tests (.only)' },
  { pattern: /expect\.not\.toBe\(/, description: 'Weakened assertions (not.toBe)' },
  { pattern: /expect\(.*\)\.toBe\(true\)/, description: 'Generic truthy assertions' },
  { pattern: /setTimeout\(|setInterval\(/, description: 'Arbitrary timeouts/intervals' },
  { pattern: /process\.env\.(NODE_ENV|CI|GITHUB_ACTIONS)\s*=\s*/, description: 'Environment variable manipulation' },
  { pattern: /console\.(log|error|warn)\s*\(/, description: 'Console logging in production code' },
  { pattern: /catch\s*\([^)]*\)\s*\{\s*\}/, description: 'Empty catch blocks' },
  { pattern: /TODO|FIXME|HACK/, description: 'TODO/FIXME/HACK comments in fix' },
];

const ALLOWED_TEST_FILES = ['e2e/tests/', 'e2e/fixtures/', 'e2e/pages/', 'e2e/selectors/'];

function loadAiFixSummary(): AiFixSummary {
  const path = join(rootDir, 'ai-fix-summary.json');
  if (!existsSync(path)) {
    return {
      issueNumber: 0,
      projectItemId: '',
      initialStatus: 'Todo',
      finalStatus: 'Todo',
      branch: '',
      attempt: 1,
      maxAttempts: 2,
      rootCause: '',
      confidence: 0,
      filesChanged: [],
      linesAdded: 0,
      linesDeleted: 0,
      targetedTest: '',
      targetedTestResult: 'pending',
      regressionResult: 'pending',
      pullRequest: null,
      pullRequestUrl: null,
      reviewStatus: 'pending',
      mergeStatus: 'pending',
      postMergeVerification: 'pending',
      projectCompletion: 'Todo',
    };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function saveAiFixSummary(summary: AiFixSummary): void {
  const path = join(rootDir, 'ai-fix-summary.json');
  writeFileSync(path, JSON.stringify(summary, null, 2));
}

function checkForbiddenPatterns(files: string[]): Array<{ file: string; pattern: string; description: string; line: number }> {
  const violations: Array<{ file: string; pattern: string; description: string; line: number }> = [];

  for (const filePath of files) {
    const fullPath = join(rootDir, filePath);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    for (const { pattern, description } of FORBIDDEN_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          const isTestFile = ALLOWED_TEST_FILES.some(p => filePath.startsWith(p));
          if (isTestFile && (description.includes('Skipped') || description.includes('Focused'))) {
            continue;
          }
          violations.push({
            file: filePath,
            pattern: pattern.toString(),
            description,
            line: i + 1,
          });
        }
      }
    }
  }

  return violations;
}

function checkSyntax(files: string[]): Array<{ file: string; error: string }> {
  const errors: Array<{ file: string; error: string }> = [];

  for (const filePath of files) {
    const fullPath = join(rootDir, filePath);
    if (!existsSync(fullPath)) continue;

    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      try {
        execSync(`npx tsc --noEmit --skipLibCheck "${fullPath}"`, { cwd: rootDir, encoding: 'utf-8', stdio: 'pipe' });
      } catch (error) {
        const output = error instanceof Error ? error.message : String(error);
        errors.push({ file: filePath, error: output });
      }
    } else if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
      try {
        execSync(`node --check "${fullPath}"`, { cwd: rootDir, encoding: 'utf-8', stdio: 'pipe' });
      } catch (error) {
        const output = error instanceof Error ? error.message : String(error);
        errors.push({ file: filePath, error: output });
      }
    }
  }

  return errors;
}

function checkDiffLimits(): { ok: boolean; message: string } {
  try {
    const diff = execSync('git diff --numstat', { cwd: rootDir, encoding: 'utf-8' });
    const lines = diff.trim().split('\n').filter(l => l);
    
    let totalAdded = 0;
    let totalDeleted = 0;
    let fileCount = 0;

    for (const line of lines) {
      const [added, deleted] = line.split('\t');
      if (added && deleted) {
        totalAdded += parseInt(added, 10) || 0;
        totalDeleted += parseInt(deleted, 10) || 0;
        fileCount++;
      }
    }

    const maxFiles = parseInt(process.env.MAX_FILES || '10', 10);
    const maxAdded = parseInt(process.env.MAX_ADDED_LINES || '300', 10);
    const maxDeleted = parseInt(process.env.MAX_DELETED_LINES || '150', 10);

    if (fileCount > maxFiles) {
      return { ok: false, message: `Too many files changed: ${fileCount} > ${maxFiles}` };
    }
    if (totalAdded > maxAdded) {
      return { ok: false, message: `Too many lines added: ${totalAdded} > ${maxAdded}` };
    }
    if (totalDeleted > maxDeleted) {
      return { ok: false, message: `Too many lines deleted: ${totalDeleted} > ${maxDeleted}` };
    }

    return { ok: true, message: `Files: ${fileCount}, Added: ${totalAdded}, Deleted: ${totalDeleted}` };
  } catch (error) {
    return { ok: false, message: `Failed to check diff: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function main() {
  console.log('Validating AI patch...');

  const summary = loadAiFixSummary();
  const filesChanged = summary.filesChanged;

  if (filesChanged.length === 0) {
    console.error('No files changed to validate.');
    process.exit(1);
  }

  console.log(`Validating ${filesChanged.length} changed file(s)...`);

  const diffCheck = checkDiffLimits();
  console.log(`Diff limits: ${diffCheck.message}`);
  if (!diffCheck.ok) {
    console.error(`Diff limit exceeded: ${diffCheck.message}`);
    process.exit(1);
  }

  const syntaxErrors = checkSyntax(filesChanged);
  if (syntaxErrors.length > 0) {
    console.error('Syntax errors found:');
    for (const err of syntaxErrors) {
      console.error(`  ${err.file}: ${err.error}`);
    }
    process.exit(1);
  }
  console.log('Syntax check: PASSED');

  const forbiddenViolations = checkForbiddenPatterns(filesChanged);
  if (forbiddenViolations.length > 0) {
    console.error('Forbidden patterns detected:');
    for (const v of forbiddenViolations) {
      console.error(`  ${v.file}:${v.line} - ${v.description} (${v.pattern})`);
    }
    process.exit(1);
  }
  console.log('Forbidden patterns check: PASSED');

  console.log('\nAll patch validation checks passed.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});