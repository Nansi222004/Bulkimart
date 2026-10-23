// Run Jest without inheriting application URIs, gateway/bank/provider keys or
// deployment settings. Only OS paths needed by Node/Mongo binaries are kept.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const allowed = new Set(['systemroot', 'windir', 'comspec', 'path', 'pathext', 'temp', 'tmp',
  'userprofile', 'localappdata', 'appdata', 'homedrive', 'homepath', 'home', 'lang', 'lc_all',
  'number_of_processors', 'processor_architecture', 'os']);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
Object.assign(env, { NODE_ENV: 'test', MONGOMS_VERSION: '7.0.14' });
const child = spawn(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js',
  ...process.argv.slice(2)], { cwd: fileURLToPath(new URL('../', import.meta.url)), env,
  stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
