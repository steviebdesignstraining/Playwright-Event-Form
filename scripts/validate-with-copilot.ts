import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

interface BugAnalysis {
  title: string;
  summary: string;
  stepsToReproduce: string[];
  expectedResult: string;
  actualResult: string;
  failureType: string;
  severity: string;
  priority: string;
  classification: string;
  confidence: number;
  relevantEvidence?: string[];
  aiAnalysisSucceeded?: boolean;
  fallbackUsed?: boolean;
  aiError?: string;
  error?: string;
  branch?: string;
  commit?: string;
  project?: string;
}

interface ValidationResult {
  valid: boolean;
  issues: string[];
  correctedBug: BugAnalysis | null;
  validationStatus: 'VALID' | 'INVALID' | 'SKIPPED' | 'ERROR';
  validationError?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function loadBugAnalysis(): Array<{ failure: unknown; analysis: BugAnalysis }> {
  const path = join(rootDir, 'bug-analysis.json');
  if (!existsSync(path)) {
    console.error('No bug-analysis.json found. Run analyse-failure.ts first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function getRepoInfo(): { owner: string; repo: string } | null {
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
    console.warn('Could not detect GitHub remote via git.');
  }

  return null;
}

async function validateWithCopilot(analysis: BugAnalysis, testCode: string, repo: string | null): Promise<ValidationResult> {
  const token = process.env.COPILOT_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('No Copilot token available. Skipping Copilot validation.');
    return {
      valid: false,
      issues: ['No Copilot token available — validation skipped'],
      correctedBug: null,
      validationStatus: 'SKIPPED',
      validationError: 'No Copilot token available',
    };
  }

  if (!repo) {
    console.warn('Could not determine GitHub repository. Skipping Copilot validation.');
    return {
      valid: false,
      issues: ['Could not determine repository — validation skipped'],
      correctedBug: null,
      validationStatus: 'SKIPPED',
      validationError: 'Could not determine GitHub repository',
    };
  }

  const prompt = `Review the generated QA bug report against the Playwright repository.

Check the following:

1. Does the test actually perform the listed reproduction steps?
2. Does the expected result match the test assertion?
3. Does the actual result match the recorded failure?
4. Is the failure type reasonable?
5. Is any information invented?
6. Is the bug title specific to the failure (not generic like "Test failed")?
7. Do the selectors and page objects referenced in the test support the reproduction steps?

Bug under review:
${JSON.stringify(analysis, null, 2)}

Relevant test code:
${testCode}

Return valid JSON only with this structure:
{
  "valid": true,
  "issues": ["issue description if any"],
  "correctedBug": {
    "title": "",
    "summary": "",
    "stepsToReproduce": [],
    "expectedResult": "",
    "actualResult": "",
    "failureType": "",
    "severity": "",
    "priority": "",
    "classification": "",
    "confidence": 0.0
  }
}`;

  try {
    const ghApiBase = 'https://api.github.com';
    const ownerRepo = `${repo}`;

    const response = await fetch(`${ghApiBase}/copilot-spaces/actions/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repository: ownerRepo,
        prompt: prompt,
      }),
    });

    if (!response.ok) {
      console.warn(`Copilot validation API returned ${response.status}. Using unvalidated result.`);
      return {
        valid: false,
        issues: [`Copilot API error ${response.status}`],
        correctedBug: null,
        validationStatus: 'ERROR',
        validationError: `HTTP ${response.status} from Copilot API`,
      };
    }

    const body = await response.json() as ValidationResult;
    return {
      ...body,
      validationStatus: body.valid ? 'VALID' : 'INVALID',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`Copilot validation failed: ${errorMsg}. Using unvalidated result.`);
    return {
      valid: false,
      issues: [`Copilot validation exception: ${errorMsg}`],
      correctedBug: null,
      validationStatus: 'ERROR',
      validationError: errorMsg,
    };
  }
}

function findTestCode(testName: string): string {
  const possiblePaths = [
    join(rootDir, 'e2e', 'tests', 'browser.spec.ts'),
    join(rootDir, 'e2e', 'tests', 'api.spec.ts'),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      if (content.includes(testName)) {
        return content;
      }
    }
  }
  return '';
}

async function main() {
  console.log('Validating bug analyses with Copilot...');
  const entries = loadBugAnalysis();

  console.log(`Analyses to validate: ${entries.length}`);

  const repoInfo = getRepoInfo();
  const repo = repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : null;
  if (repo) {
    console.log(`Using repository: ${repo}`);
  } else {
    console.warn('Repository not available — Copilot validation will be skipped.');
  }

  const results: Array<{ failure: unknown; analysis: BugAnalysis; validation: ValidationResult }> = [];

  for (const entry of entries) {
    const { failure, analysis } = entry;
    console.log(`Validating: ${analysis.title}`);

    const testCode = findTestCode(analysis.stepsToReproduce[0] || analysis.title);
    const validation = await validateWithCopilot(analysis, testCode, repo);

    console.log(`  → Valid: ${validation.valid}`);
    console.log(`  → Status: ${validation.validationStatus}`);
    if (validation.issues.length > 0) {
      console.log(`  → Issues: ${validation.issues.join(', ')}`);
    }
    if (validation.validationError) {
      console.log(`  → Error: ${validation.validationError}`);
    }

    results.push({ failure, analysis, validation });
  }

  const validatedPath = join(rootDir, 'validated-bug.json');
  const outputDir = dirname(validatedPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputData = results.map(({ analysis, validation }) => {
    const base = validation.correctedBug ?? analysis;
    const finalClassification = (base.classification || analysis.classification || 'UNKNOWN') as string;
    const finalConfidence = typeof base.confidence === 'number' ? base.confidence : (analysis.confidence ?? 0);
    const finalError = base.error ?? analysis.error;

    const validationSkipped = validation.validationStatus === 'SKIPPED';
    const validationErrored = validation.validationStatus === 'ERROR';

    return {
      title: base.title || analysis.title,
      summary: base.summary || '',
      stepsToReproduce: base.stepsToReproduce || [],
      expectedResult: base.expectedResult || '',
      actualResult: base.actualResult || '',
      failureType: base.failureType || 'Unknown',
      severity: base.severity || 'Medium',
      priority: base.priority || 'P3',
      classification: finalClassification,
      confidence: finalConfidence,
      relevantEvidence: base.relevantEvidence || [],
      aiAnalysisSucceeded: analysis.aiAnalysisSucceeded ?? false,
      fallbackUsed: analysis.fallbackUsed ?? false,
      aiError: analysis.aiError ?? base.aiError,
      error: finalError,
      branch: base.branch ?? analysis.branch,
      commit: base.commit ?? analysis.commit,
      project: base.project ?? analysis.project,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
        classification: finalClassification,
        skipped: validationSkipped,
        status: validation.validationStatus,
        error: validation.validationError,
        correctedBug: validation.correctedBug,
      },
    };
  });

  writeFileSync(validatedPath, JSON.stringify(outputData, null, 2));
  console.log(`Validated bugs written to: ${validatedPath}`);
}

main();
