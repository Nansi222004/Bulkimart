// Fresh Node/backend/replica-set/Chrome fixture for every combination and width.
// The child retains all HTTP, database, provider-call and UI assertions.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'test-artifacts/pending-payment-recovery');
await mkdir(output, { recursive: true });
const combinations = [['grocery'], ['ecommerce'], ['wholesale'], ['grocery','ecommerce'], ['grocery','wholesale'], ['ecommerce','wholesale'], ['grocery','ecommerce','wholesale']];
const results = [];
for (const width of [1280,390]) for (const channels of combinations) {
  const name = channels.join('-') + '-' + width;
  const child = spawn(process.execPath, [join(import.meta.dirname, 'verifyPendingPaymentRecoveryBrowser.mjs'), '--channels='+channels.join('+'), '--width='+width], { cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  await writeFile(join(output, 'isolated-'+name+'.log'), log);
  let evidence;
  try { evidence = JSON.parse(await readFile(join(output, 'isolated', name, 'browser.json'), 'utf8')); } catch { /* Child log records setup/browser failures. */ }
  const result = { width, channels, passed: code === 0 && evidence?.passed === true && evidence.journeys?.length === 1,
    exitCode: code, evidence: 'isolated/'+name+'/browser.json', journey: evidence?.journeys?.[0],
    browserInitializationRequests: evidence?.apiCalls?.filter(row => row.method === 'POST' && row.path === '/api/payments/initiate').length };
  if (result.passed && result.browserInitializationRequests !== 1) result.passed = false;
  results.push(result); console.log(JSON.stringify({width,channels,passed:result.passed,exitCode:code}));
  await writeFile(join(output, 'browser-isolated-matrix.json'), JSON.stringify({passed:results.length===14&&results.every(row=>row.passed),completed:results.length,results},null,2));
}
if (results.length !== 14 || results.some(row=>!row.passed)) process.exitCode = 1;
