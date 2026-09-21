#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const envLocalPath = join(projectRoot, '.env.local');
const SECRET_NAME = 'DOTENVX_KEY';

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const config = {};
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key) config[key.trim()] = valueParts.join('=').trim();
  }
  return config;
}

function getRepo() {
  const envRepo = process.env.GH_REPO;
  if (envRepo) return envRepo;
  return execFileSync(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
    { encoding: 'utf8', cwd: projectRoot }
  ).trim();
}

function gh(args, options = {}) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    cwd: projectRoot,
    stdio: options.silent ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    input: options.input,
  });
}

const envConfig = parseEnvFile(envLocalPath);
let key = process.env.DOTENVX_KEY || envConfig.DOTENVX_KEY;

if (!key) {
  console.log('DOTENVX_KEY not found locally. Generating a secure random key...');
  key = randomBytes(32).toString('hex');
  writeFileSync(envLocalPath, `${SECRET_NAME}=${key}\n`);
  console.log(`Local record persisted to ${envLocalPath} (gitignored).`);
} else {
  console.log(`Loaded existing ${SECRET_NAME} from local environment.`);
}

const repo = getRepo();
console.log(`Syncing ${SECRET_NAME} to GitHub repository secret on ${repo}...`);

// Pass the value via stdin so it never appears in the process argv (avoids
// exposure via `ps`, shell history, or CI logs).
execFileSync('gh', ['secret', 'set', SECRET_NAME, '--repo', repo], {
  input: key,
  encoding: 'utf8',
  cwd: projectRoot,
  stdio: 'pipe',
});

console.log(`Set repository secret: ${SECRET_NAME}`);

// Verify presence (secret list does not disclose values).
const listing = gh(['secret', 'list', '--repo', repo, '--json', 'name'], { silent: true });
const secrets = JSON.parse(listing);
if (secrets.some((s) => s.name === SECRET_NAME)) {
  console.log(`Verified: ${SECRET_NAME} is present in repository secrets.`);
} else {
  console.error(`Verification failed: ${SECRET_NAME} not found in repository secrets.`);
  process.exit(1);
}
