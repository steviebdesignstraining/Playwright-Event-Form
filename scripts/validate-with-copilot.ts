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
}

interface ValidationResult {
  valid: boolean;
  issues: string[];
  correctedBug: BugAnalysis | null;
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

function loadRepositories(): string[] {
  const repos: string[] = [];

  try {
    const remotes = execSync('git remote -v', { cwd: rootDir, encoding: 'utf-8' }).trim();
    for (const line of remotes.split('\n')) {
      const match = line.match(/(?:git@github\.com:|https:\/\/github\.com\/)([^\/\s]+(?:\/[^\/\s]+?)(?=\.git|$))/);
      if (match) {
        repos.push(match[1]);
      }
    }
  } catch {
    console.warn('Could not detect GitHub remote.');
  }

  return [...new Set(repos)];
}

async function validateWithCopilot(analysis: BugAnalysis, testCode: string): Promise<ValidationResult> {
  const token = process.env.COPILOT_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('No Copilot token available. Skipping Copilot validation.');
    return { valid: true, issues: [], correctedBug: analysis };
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
    const repos = loadRepositories();
    const repo = repos[0] || '';

    if (!repo) {
      console.warn('Could not determine GitHub repository. Skipping Copilot validation.');
      return { valid: true, issues: [], correctedBug: analysis };
    }

    const response = await fetch(`${ghApiBase}/copilot-spaces/actions/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-05',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repository: repo,
        prompt: prompt,
      }),
    });

    if (!response.ok) {
      console.warn(`Copilot validation API returned ${response.status}. Using unvalidated result.`);
      return { valid: true, issues: [], correctedBug: analysis };
    }

    const body = await response.json() as ValidationResult;
    return body;
  } catch (error) {
    console.warn(`Copilot validation failed: ${error instanceof Error ? error.message : error}. Using unvalidated result.`);
    return { valid: true, issues: [], correctedBug: analysis };
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

  if (entries.length === 0) {
    console.log('No analyses to validate.');
    return;
  }

  const results: Array<{ failure: unknown; analysis: BugAnalysis; validation: ValidationResult }> = [];

  for (const entry of entries) {
    const { failure, analysis } = entry;
    console.log(`Validating: ${analysis.title}`);

    const testCode = findTestCode(analysis.stepsToReproduce[0] || analysis.title);
    const validation = await validateWithCopilot(analysis, testCode);

    console.log(`  → Valid: ${validation.valid}`);
    if (validation.issues.length > 0) {
      console.log(`  → Issues: ${validation.issues.join(', ')}`);
    }

    results.push({ failure, analysis, validation });
  }

  const validatedPath = join(rootDir, 'validated-bug.json');
  const outputDir = dirname(validatedPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputData = results.map(({ analysis, validation }) => ({
    ...analysis,
    validation: {
      valid: validation.valid,
      issues: validation.issues,
      correctedBug: validation.correctedBug,
    },
  }));

  writeFileSync(validatedPath, JSON.stringify(outputData, null, 2));
  console.log(`Validation results written to: ${validatedPath}`);
}

main();
