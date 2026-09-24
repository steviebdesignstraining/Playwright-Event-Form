#!/usr/bin/env node
/**
 * Sync local secrets/variables to GitHub repository secrets and variables
 * 
 * Usage: node scripts/sync-github-secrets.mjs <command> [options]
 * 
 * Commands:
 *   push-secrets <env>    Push secrets from .venv/.venv.<env> to GitHub secrets
 *   push-vars <env>       Push variables from .venv/.venv.<env> to GitHub variables
 *   push-all <env>        Push both secrets and variables
 *   list-secrets          List GitHub repository secrets
 *   list-vars             List GitHub repository variables
 *   delete-secret <name>  Delete a GitHub secret
 *   delete-var <name>     Delete a GitHub variable
 * 
 * Prerequisites:
 *   - GitHub CLI (gh) installed and authenticated: gh auth login
 *   - Run from repository root or set GH_REPO environment variable
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const venvDir = join(projectRoot, '.venv');

/** @type {Record<string, string>} */
function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf8');
  /** @type {Record<string, string>} */
  const config = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      config[key.trim()] = valueParts.join('=').trim();
    }
  }
  return config;
}

function getRepo() {
  const repo = process.env.GH_REPO;
  if (repo) return repo;
  
  try {
    const output = execSync('gh repo view --json nameWithOwner -q .nameWithOwner', { 
      encoding: 'utf8', 
      cwd: projectRoot 
    }).trim();
    return output;
  } catch {
    console.error('Error: Could not determine repository. Set GH_REPO or run from a git repository with gh authenticated.');
    process.exit(1);
  }
}

function runGh(args, options = {}) {
  try {
    return execSync(`gh ${args}`, { 
      encoding: 'utf8', 
      cwd: projectRoot,
      stdio: options.silent ? 'pipe' : 'inherit'
    }).trim();
  } catch (error) {
    if (!options.silent) {
      console.error(`Command failed: gh ${args}`);
    }
    throw error;
  }
}

function pushEnvSecret(secretName) {
  const sourceFile = join(projectRoot, '.env.local');
  if (!existsSync(sourceFile)) {
    console.error(`Error: .env.local not found`);
    process.exit(1);
  }

  const secrets = parseEnvFile(sourceFile);
  if (!secrets[secretName]) {
    console.error(`Error: ${secretName} not found in .env.local`);
    process.exit(1);
  }

  const repo = getRepo();
  try {
    runGh(`secret set "${secretName}" --body "${secrets[secretName]}" --repo ${repo}`, { silent: true });
    console.log(`  ✓ ${secretName}`);
  } catch {
    console.error(`  ✗ ${secretName} (failed)`);
  }
}

function pushEnvVar(varName) {
  const sourceFile = join(projectRoot, '.env.local');
  if (!existsSync(sourceFile)) {
    console.error(`Error: .env.local not found`);
    process.exit(1);
  }

  const vars = parseEnvFile(sourceFile);
  if (!vars[varName]) {
    console.error(`Error: ${varName} not found in .env.local`);
    process.exit(1);
  }

  const repo = getRepo();
  try {
    runGh(`variable set "${varName}" --body "${vars[varName]}" --repo ${repo}`, { silent: true });
    console.log(`  ✓ ${varName}`);
  } catch {
    console.error(`  ✗ ${varName} (failed)`);
  }
}

function pushSecrets(env) {
  const sourceFile = join(venvDir, `.venv.${env}`);
  if (!existsSync(sourceFile)) {
    console.error(`Error: .venv.${env} not found in ${venvDir}`);
    console.error('Run "node scripts/secrets.mjs list" to see available environments');
    process.exit(1);
  }
  
  const secrets = parseEnvFile(sourceFile);
  if (Object.keys(secrets).length === 0) {
    console.log(`No secrets found in .venv.${env}`);
    return;
  }
  
  const repo = getRepo();
  console.log(`Pushing ${Object.keys(secrets).length} secrets to ${repo}...`);
  
  for (const [key, value] of Object.entries(secrets)) {
    try {
      runGh(`secret set "${key}" --body "${value}" --repo ${repo}`, { silent: true });
      console.log(`  ✓ ${key}`);
    } catch {
      console.error(`  ✗ ${key} (failed)`);
    }
  }
  
  console.log('Done!');
}

function pushVariables(env) {
  const sourceFile = join(venvDir, `.venv.${env}`);
  if (!existsSync(sourceFile)) {
    console.error(`Error: .venv.${env} not found in ${venvDir}`);
    console.error('Run "node scripts/secrets.mjs list" to see available environments');
    process.exit(1);
  }
  
  const variables = parseEnvFile(sourceFile);
  if (Object.keys(variables).length === 0) {
    console.log(`No variables found in .venv.${env}`);
    return;
  }
  
  const repo = getRepo();
  console.log(`Pushing ${Object.keys(variables).length} variables to ${repo}...`);
  
  for (const [key, value] of Object.entries(variables)) {
    try {
      runGh(`variable set "${key}" --body "${value}" --repo ${repo}`, { silent: true });
      console.log(`  ✓ ${key}`);
    } catch {
      console.error(`  ✗ ${key} (failed)`);
    }
  }
  
  console.log('Done!');
}

function listSecrets() {
  const repo = getRepo();
  console.log(`Secrets in ${repo}:`);
  try {
    const output = runGh(`secret list --repo ${repo} --json name,updatedAt`, { silent: true });
    const secrets = JSON.parse(output);
    if (secrets.length === 0) {
      console.log('  (none)');
      return;
    }
    for (const secret of secrets) {
      console.log(`  - ${secret.name} (updated: ${secret.updatedAt})`);
    }
  } catch {
    console.error('  Failed to list secrets');
  }
}

function listVariables() {
  const repo = getRepo();
  console.log(`Variables in ${repo}:`);
  try {
    const output = runGh(`variable list --repo ${repo} --json name,value,updatedAt`, { silent: true });
    const variables = JSON.parse(output);
    if (variables.length === 0) {
      console.log('  (none)');
      return;
    }
    for (const variable of variables) {
      console.log(`  - ${variable.name} = ${variable.value} (updated: ${variable.updatedAt})`);
    }
  } catch {
    console.error('  Failed to list variables');
  }
}

function deleteSecret(name) {
  const repo = getRepo();
  try {
    runGh(`secret delete "${name}" --repo ${repo}`);
    console.log(`Deleted secret: ${name}`);
  } catch {
    console.error(`Failed to delete secret: ${name}`);
  }
}

function deleteVariable(name) {
  const repo = getRepo();
  try {
    runGh(`variable delete "${name}" --repo ${repo}`);
    console.log(`Deleted variable: ${name}`);
  } catch {
    console.error(`Failed to delete variable: ${name}`);
  }
}

function listEnvs() {
  if (!existsSync(venvDir)) {
    console.log('No .venv directory found. Run "node scripts/secrets.mjs init" to create it.');
    return;
  }
  
  const files = readdirSync(venvDir)
    .filter(f => f.startsWith('.venv.') && f !== '.gitkeep')
    .map(f => f.replace('.venv.', ''));
  
  if (files.length === 0) {
    console.log('No venv environments found. Run "node scripts/secrets.mjs init" to create structure.');
    return;
  }
  
  console.log('Available venv environments:');
  for (const env of files) {
    console.log(`  - ${env}`);
  }
}

function showHelp() {
  console.log(`
Sync Local Secrets/Variables to GitHub

Usage: node scripts/sync-github-secrets.mjs <command> [options]

Commands:
   push-secrets <env>    Push secrets from .venv/.venv.<env> to GitHub secrets
   push-vars <env>       Push variables from .venv/.venv.<env> to GitHub variables
   push-all <env>        Push both secrets and variables
   list-secrets          List GitHub repository secrets
   list-vars             List GitHub repository variables
   delete-secret <name>  Delete a GitHub secret
   delete-var <name>     Delete a GitHub variable
   list-envs             List available local venv environments
   push-env-secret <name>        Push a single secret from .env.local to GitHub secrets
   push-env-var <name>           Push a single variable from .env.local to GitHub variables

Prerequisites:
  - GitHub CLI (gh) installed: https://cli.github.com/
  - Authenticated: gh auth login
  - Repository permissions: admin or write access

Examples:
  node scripts/sync-github-secrets.mjs push-all local
  node scripts/sync-github-secrets.mjs push-secrets staging
  node scripts/sync-github-secrets.mjs push-vars production
  node scripts/sync-github-secrets.mjs push-env-secret GEMINI_API_KEY
  node scripts/sync-github-secrets.mjs push-env-var GEMINI_MODEL
  node scripts/sync-github-secrets.mjs list-secrets
  node scripts/sync-github-secrets.mjs list-vars
  node scripts/sync-github-secrets.mjs delete-secret OLD_API_KEY
  node scripts/sync-github-secrets.mjs list-envs

Environment Variables:
  GH_REPO              Override repository (format: owner/repo)
`);
}

const args = process.argv.slice(2);
const command = args[0];
const arg1 = args[1];

switch (command) {
  case 'push-secrets':
    if (!arg1) { console.error('Error: environment required'); process.exit(1); }
    pushSecrets(arg1);
    break;
  case 'push-vars':
    if (!arg1) { console.error('Error: environment required'); process.exit(1); }
    pushVariables(arg1);
    break;
  case 'push-all':
    if (!arg1) { console.error('Error: environment required'); process.exit(1); }
    pushSecrets(arg1);
    pushVariables(arg1);
    break;
  case 'list-secrets':
    listSecrets();
    break;
  case 'list-vars':
    listVariables();
    break;
  case 'delete-secret':
    if (!arg1) { console.error('Error: secret name required'); process.exit(1); }
    deleteSecret(arg1);
    break;
  case 'delete-var':
    if (!arg1) { console.error('Error: variable name required'); process.exit(1); }
    deleteVariable(arg1);
    break;
  case 'list-envs':
    listEnvs();
    break;
  case 'push-env-secret':
    if (!arg1) { console.error('Error: secret name required'); process.exit(1); }
    pushEnvSecret(arg1);
    break;
  case 'push-env-var':
    if (!arg1) { console.error('Error: variable name required'); process.exit(1); }
    pushEnvVar(arg1);
    break;
  default:
    showHelp();
    process.exit(1);
}