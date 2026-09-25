import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { resolveArtifactPath } from './github-project.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

interface RootCauseAnalysis {
  issueNumber: number;
  title: string;
  rootCause: string;
  confidence: number;
  affectedFiles: string[];
  suggestedFix: string;
  testToValidate: string;
  reasoning: string;
  attempt: number;
  maxAttempts: number;
}

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

const SYSTEM_PROMPT = `You are an AI Code Fix Agent.

Your task is to apply a minimal, safe fix to the source code based on the root cause analysis.

You will receive:
1. The root cause analysis (root cause, affected files, suggested fix)
2. The current content of each affected file
3. The test that should validate the fix

Your output must be a JSON object with exactly these fields:
- files: Array of objects, each containing:
  - path: File path relative to repository root
  - content: Complete new file content after the fix
- explanation: Brief explanation of what was changed and why

Rules:
- Make the SMALLEST safe change that fixes the root cause.
- Preserve test intent - do NOT modify test files.
- Do NOT delete tests, weaken assertions, increase timeouts, add retries, suppress exceptions, or disable validation.
- Do NOT modify CI configuration, secrets, environment files, or package versions without strong justification.
- Do NOT modify unrelated files.
- Maximum 10 files changed, 300 lines added, 150 lines deleted.
- If the fix requires changes exceeding these limits, return an error explaining why.`;

interface FileChange {
  path: string;
  content: string;
}

interface AiFixResponse {
  files: FileChange[];
  explanation: string;
}

function loadRootCause(): RootCauseAnalysis {
  const path = resolveArtifactPath(rootDir, 'root-cause.json');
  if (!existsSync(path)) {
    console.error('root-cause.json not found. Run analyse-bug.ts first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadBugContext(): { projectItemId: string } {
  const path = resolveArtifactPath(rootDir, 'bug-context.json');
  if (!existsSync(path)) {
    console.error('bug-context.json not found.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadAiFixSummary(): AiFixSummary {
  const path = resolveArtifactPath(rootDir, 'ai-fix-summary.json');
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
  const path = resolveArtifactPath(rootDir, 'ai-fix-summary.json');
  writeFileSync(path, JSON.stringify(summary, null, 2));
}

function loadFileContent(filePath: string): string {
  const fullPath = join(rootDir, filePath);
  if (!existsSync(fullPath)) {
    return '';
  }
  return readFileSync(fullPath, 'utf-8');
}

function buildEvidence(rootCause: RootCauseAnalysis): string {
  let evidence = `Root Cause Analysis for Issue #${rootCause.issueNumber}

Root Cause: ${rootCause.rootCause}
Confidence: ${(rootCause.confidence * 100).toFixed(0)}%
Suggested Fix: ${rootCause.suggestedFix}
Test to Validate: ${rootCause.testToValidate}
Reasoning: ${rootCause.reasoning}

Affected Files:
`;

  for (const filePath of rootCause.affectedFiles) {
    const content = loadFileContent(filePath);
    evidence += `\n--- ${filePath} ---\n${content || '[FILE NOT FOUND - will be created]'}n`;
  }

  return evidence;
}

async function callGemini(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const MAX_OUTPUT_TOKENS = 8192;
  const REQUEST_TIMEOUT_MS = 120_000;

  const response = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: GEMINI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ai_fix_response',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    content: { type: 'string' },
                  },
                  required: ['path', 'content'],
                  additionalProperties: false,
                },
              },
              explanation: { type: 'string' },
            },
            required: ['files', 'explanation'],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${responseText}`);
  }

  let body: {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    error?: { message?: string };
  };
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${responseText.substring(0, 200)}`);
  }

  if (body.error) {
    throw new Error(`Gemini error in 200 response: ${body.error.message}`);
  }

  const choice = body.choices?.[0];
  const content = choice?.message?.content || '';

  if (!content) {
    throw new Error('Gemini returned no content');
  }

  if (choice?.finish_reason === 'length') {
    throw new Error('Gemini output truncated');
  }

  return content;
}

function countDiff(original: string, modified: string): { added: number; deleted: number } {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  
  let added = 0;
  let deleted = 0;
  
  const maxLen = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLen; i++) {
    const orig = origLines[i];
    const mod = modLines[i];
    
    if (orig !== mod) {
      if (orig === undefined) added++;
      else if (mod === undefined) deleted++;
      else {
        added++;
        deleted++;
      }
    }
  }
  
  return { added, deleted };
}

async function main() {
  console.log('Applying AI fix...');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const rootCause = loadRootCause();
  const bugContext = loadBugContext();
  const summary = loadAiFixSummary();

  const confidenceThreshold = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.70');
  if (rootCause.confidence < confidenceThreshold) {
    console.error(`Confidence ${(rootCause.confidence * 100).toFixed(0)}% is below threshold ${(confidenceThreshold * 100).toFixed(0)}%. Fix aborted.`);
    process.exit(1);
  }

  const maxFiles = parseInt(process.env.MAX_FILES || '10', 10);
  const maxAddedLines = parseInt(process.env.MAX_ADDED_LINES || '300', 10);
  const maxDeletedLines = parseInt(process.env.MAX_DELETED_LINES || '150', 10);

  console.log(`Issue: #${rootCause.issueNumber}`);
  console.log(`Root cause: ${rootCause.rootCause}`);
  console.log(`Confidence: ${(rootCause.confidence * 100).toFixed(0)}%`);
  console.log(`Affected files: ${rootCause.affectedFiles.join(', ')}`);

  if (rootCause.affectedFiles.length > maxFiles) {
    console.error(`Too many affected files: ${rootCause.affectedFiles.length} > ${maxFiles}`);
    process.exit(1);
  }

  const evidence = buildEvidence(rootCause);

  let aiResponse: AiFixResponse;
  try {
    const response = await callGemini(apiKey, SYSTEM_PROMPT, evidence);
    aiResponse = JSON.parse(response);
  } catch (error) {
    console.error('AI fix generation failed:', error);
    process.exit(1);
  }

  if (!aiResponse.files || aiResponse.files.length === 0) {
    console.error('AI returned no file changes.');
    process.exit(1);
  }

  if (aiResponse.files.length > maxFiles) {
    console.error(`AI proposed ${aiResponse.files.length} file changes, exceeds limit of ${maxFiles}`);
    process.exit(1);
  }

  let totalAdded = 0;
  let totalDeleted = 0;
  const changedFiles: string[] = [];

  for (const fileChange of aiResponse.files) {
    const fullPath = join(rootDir, fileChange.path);
    const originalContent = loadFileContent(fileChange.path);
    const { added, deleted } = countDiff(originalContent, fileChange.content);

    totalAdded += added;
    totalDeleted += deleted;

    if (totalAdded > maxAddedLines) {
      console.error(`Total added lines ${totalAdded} exceeds limit ${maxAddedLines}`);
      process.exit(1);
    }
    if (totalDeleted > maxDeletedLines) {
      console.error(`Total deleted lines ${totalDeleted} exceeds limit ${maxDeletedLines}`);
      process.exit(1);
    }

    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, fileChange.content);
    changedFiles.push(fileChange.path);
    console.log(`  → Updated: ${fileChange.path} (+${added}/-${deleted})`);
  }

  console.log(`\nAI Explanation: ${aiResponse.explanation}`);
  console.log(`Total changes: ${changedFiles.length} files, +${totalAdded}/-${totalDeleted} lines`);

  const diffOutput = execSync('git diff --no-color', { cwd: rootDir, encoding: 'utf-8' });
  const patchPath = join(rootDir, 'git-diff.patch');
  writeFileSync(patchPath, diffOutput);
  console.log(`Git diff saved to: ${patchPath}`);

  summary.filesChanged = changedFiles;
  summary.linesAdded = totalAdded;
  summary.linesDeleted = totalDeleted;
  summary.rootCause = rootCause.rootCause;
  summary.confidence = rootCause.confidence;
  summary.targetedTest = rootCause.testToValidate;
  summary.attempt = rootCause.attempt;
  summary.maxAttempts = rootCause.maxAttempts;

  saveAiFixSummary(summary);

  console.log('\nFix applied successfully. Ready for validation.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});