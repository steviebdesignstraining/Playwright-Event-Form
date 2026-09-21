#!/usr/bin/env node
/**
 * Secrets Manager for venv environments
 * Usage: node scripts/secrets.mjs <command> [options]
 * 
 * Commands:
 *   push <env>     Push secrets to .venv.<env> file
 *   pull <env>     Load secrets from .venv.<env> to .env.local
 *   list           List available venv environments
 *   init           Initialize venv structure
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function stringifyEnv(config) {
  return Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function ensureVenvDir() {
  if (!existsSync(venvDir)) {
    mkdirSync(venvDir, { recursive: true });
    writeFileSync(join(venvDir, '.gitkeep'), '');
    console.log(`Created .venv directory at ${venvDir}`);
  }
}

function pushSecrets(env) {
  ensureVenvDir();
  
  const sourceFile = join(projectRoot, '.env.local');
  if (!existsSync(sourceFile)) {
    console.error('Error: .env.local not found. Create it first with your secrets.');
    process.exit(1);
  }
  
  const secrets = parseEnvFile(sourceFile);
  const targetFile = join(venvDir, `.venv.${env}`);
  writeFileSync(targetFile, stringifyEnv(secrets));
  console.log(`Pushed secrets to ${targetFile}`);
}

function pullSecrets(env) {
  const sourceFile = join(venvDir, `.venv.${env}`);
  if (!existsSync(sourceFile)) {
    console.error(`Error: .venv.${env} not found in ${venvDir}`);
    process.exit(1);
  }
  
  const secrets = parseEnvFile(sourceFile);
  const targetFile = join(projectRoot, '.env.local');
  writeFileSync(targetFile, stringifyEnv(secrets));
  console.log(`Pulled secrets from ${sourceFile} to .env.local`);
}

function listEnvs() {
  ensureVenvDir();
  const files = readdirSync(venvDir)
    .filter(f => f.startsWith('.venv.') && f !== '.gitkeep')
    .map(f => f.replace('.venv.', ''));
  
  if (files.length === 0) {
    console.log('No venv environments found. Run "init" to create structure.');
    return;
  }
  
  console.log('Available venv environments:');
  for (const env of files) {
    console.log(`  - ${env}`);
  }
}

function initVenv() {
  ensureVenvDir();
  
  // Create example venv files
  const exampleEnvs = ['local', 'staging', 'production'];
  for (const env of exampleEnvs) {
    const file = join(venvDir, `.venv.${env}`);
    if (!existsSync(file)) {
      writeFileSync(file, `# ${env} environment secrets\n# Add your ${env} secrets here\n`);
    }
  }
  
  console.log('Initialized venv structure:');
  console.log(`  ${venvDir}/.venv.local`);
  console.log(`  ${venvDir}/.venv.staging`);
  console.log(`  ${venvDir}/.venv.production`);
  console.log('\nEdit these files with your environment-specific secrets.');
}

function showHelp() {
  console.log(`
Secrets Manager for venv environments

Usage: node scripts/secrets.mjs <command> [options]

Commands:
  push <env>     Push secrets from .env.local to .venv/.venv.<env>
  pull <env>     Pull secrets from .venv/.venv.<env> to .env.local
  list           List available venv environments
  init           Initialize venv structure with example environments

Examples:
  node scripts/secrets.mjs init
  node scripts/secrets.mjs push local
  node scripts/secrets.mjs pull staging
  node scripts/secrets.mjs list
`);
}

const args = process.argv.slice(2);
const command = args[0];
const env = args[1];

switch (command) {
  case 'push':
    if (!env) { console.error('Error: environment required'); process.exit(1); }
    pushSecrets(env);
    break;
  case 'pull':
    if (!env) { console.error('Error: environment required'); process.exit(1); }
    pullSecrets(env);
    break;
  case 'list':
    listEnvs();
    break;
  case 'init':
    initVenv();
    break;
  default:
    showHelp();
    process.exit(1);
}