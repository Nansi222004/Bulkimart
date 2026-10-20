// Read-only PM2 audit. Never print jlist output: it contains credentials.
import '../config/environment.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditJwtProcesses } from '../services/jwtDeploymentAudit.service.js';

const name = process.argv.find(arg => arg.startsWith('--process='))?.slice(10);
const result = spawnSync('pm2', ['jlist'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (result.error || result.status !== 0) {
  console.error('PM2 inspection unavailable. Run this on the backend host as its PM2 owner.');
  process.exit(1);
}
let processes;
try { processes = JSON.parse(result.stdout); } catch {
  console.error('PM2 returned an unreadable process list. No raw output was logged.'); process.exit(1);
}
if (!name) {
  console.log(JSON.stringify(processes.map(p => ({ name: p.name, id: p.pm_id, status: p.pm2_env?.status,
    script: p.pm2_env?.pm_exec_path, cwd: p.pm2_env?.pm_cwd })), null, 2));
  console.error('Repeat with --process=<the backend process name>.');
  process.exit(1);
}
const workers = processes.filter(p => p.name === name);
const expectedScript = fileURLToPath(new URL('../index.js', import.meta.url));
const report = auditJwtProcesses(workers, { script: expectedScript, secret: process.env.JWT_SECRET, expiry: process.env.JWT_EXPIRES_IN || '30d' });
console.log(JSON.stringify({ process: name, algorithm: 'HS256', ...report,
  next: 'Restart all named workers, then verify a fresh production login against /api/auth/me and /api/notifications/tokens.' }, null, 2));
if (!report.launchConfigurationConsistent) process.exitCode = 1;
