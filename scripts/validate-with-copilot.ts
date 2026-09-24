import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  relevantEvidence: string[];
  aiAnalysisSucceeded: boolean;
  fallbackUsed: boolean;
  aiError?: string;
  error?: string;
  branch?: string;
  commit?: string;
  project?: string;
  failure?: {
    testName: string;
    project: string;
    error: string;
  };
}

interface ValidationResult {
  valid: boolean;
  issues: string[];
  status: 'VALID' | 'INVALID' | 'ERROR';
  error?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const MIN_CONFIDENCE = 0.3;
const GENERIC_TITLE_PATTERNS = [
  /test failed/i,
  /automated test failure/i,
  /playwright test failure/i,
  /^untitled/i,
  /generic/i,
];

function loadBugAnalysis(): Array<{ failure: unknown; analysis: BugAnalysis }> {
  const path = join(rootDir, 'bug-analysis.json');
  if (!existsSync(path)) {
    console.error('No bug-analysis.json found. Run analyse-failure.ts first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function validateBug(analysis: BugAnalysis): ValidationResult {
  const issues: string[] = [];

  if (analysis.fallbackUsed) {
    issues.push('AI analysis used fallback — classification unreliable');
  }

  if (!analysis.aiAnalysisSucceeded) {
    issues.push('AI analysis did not complete successfully');
  }

  if (analysis.confidence < MIN_CONFIDENCE) {
    issues.push(`Confidence ${analysis.confidence} is below minimum threshold ${MIN_CONFIDENCE}`);
  }

  if (!analysis.title || analysis.title.length < 5) {
    issues.push('Bug title is missing or too short');
  }

  if (GENERIC_TITLE_PATTERNS.some(p => p.test(analysis.title))) {
    issues.push(`Bug title "${analysis.title}" is generic and does not describe the specific failure`);
  }

  if (!analysis.summary || analysis.summary.length < 10) {
    issues.push('Bug summary is missing or too short');
  }

  if (!analysis.stepsToReproduce || analysis.stepsToReproduce.length === 0) {
    issues.push('No reproduction steps provided');
  }

  if (!analysis.expectedResult) {
    issues.push('Expected result is missing');
  }

  if (!analysis.actualResult) {
    issues.push('Actual result is missing');
  }

  if (!analysis.classification || analysis.classification === 'UNKNOWN') {
    issues.push('Classification is UNKNOWN or missing');
  }

  const validClassification = ['PRODUCT_BUG', 'TEST_DEFECT', 'TEST_INFRASTRUCTURE', 'UNKNOWN'];
  if (analysis.classification && !validClassification.includes(analysis.classification)) {
    issues.push(`Unexpected classification: ${analysis.classification}`);
  }

  if (issues.length > 0) {
    return {
      valid: false,
      issues,
      status: 'INVALID',
    };
  }

  if (analysis.classification !== 'PRODUCT_BUG') {
    return {
      valid: true,
      issues: [`Classification is ${analysis.classification} — not a product bug`],
      status: 'VALID',
    };
  }

  return {
    valid: true,
    issues: [],
    status: 'VALID',
  };
}

async function main() {
  console.log('Validating bug analyses...');
  const entries = loadBugAnalysis();

  console.log(`Analyses to validate: ${entries.length}`);

  const results: Array<{ failure: unknown; analysis: BugAnalysis; validation: ValidationResult }> = [];

  for (const entry of entries) {
    const { failure, analysis } = entry;
    console.log(`Validating: ${analysis.title}`);

    const validation = validateBug(analysis);

    console.log(`  → Valid: ${validation.valid}`);
    console.log(`  → Status: ${validation.status}`);
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

  const outputData = results.map(({ analysis, validation }) => {
    return {
      ...analysis,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
        status: validation.status,
        error: validation.error,
        skipped: validation.status === 'SKIPPED',
      },
    };
  });

  writeFileSync(validatedPath, JSON.stringify(outputData, null, 2));
  console.log(`Validated bugs written to: ${validatedPath}`);

  const validCount = results.filter(r => r.validation.status === 'VALID').length;
  const invalidCount = results.filter(r => r.validation.status === 'INVALID').length;
  const errorCount = results.filter(r => r.validation.status === 'ERROR').length;

  console.log(`\nValidation summary: VALID=${validCount}, INVALID=${invalidCount}, ERROR=${errorCount}`);
}

main();
