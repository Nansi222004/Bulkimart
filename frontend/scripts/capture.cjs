const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function capture(url, outPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-cap-'));
  const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${path.join(tmp, 'profile')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });

  let port;
  for (let i = 0; i < 60 && !port; i++) {
    try {
      port = Number(fs.readFileSync(path.join(tmp, 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  if (!port) {
    proc.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    throw new Error('Failed to obtain DevToolsActivePort');
  }

  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  const page = list.find(t => t.type === 'page');
  const WebSocket = require('D:/Appzeto_Projects/Bulkimart1/frontend/node_modules/ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let id = 1;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const curId = id++;
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === curId) {
        ws.off('message', handler);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });

  try {
    await send('Page.enable');
    await send('Page.navigate', { url });

    // Wait until .unified-header-container is rendered and .customer-splash is gone
    for (let i = 0; i < 80; i++) {
      const evalRes = await send('Runtime.evaluate', {
        expression: '!!document.querySelector(".unified-header-container") && !document.querySelector(".customer-splash")',
        returnByValue: true
      });
      if (evalRes?.result?.value) break;
      await new Promise(r => setTimeout(r, 150));
    }

    await new Promise(r => setTimeout(r, 500));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
    console.log(`Saved screenshot to ${outPath}`);
  } finally {
    try { ws.close(); } catch {}
    try { proc.kill(); } catch {}
    await new Promise(r => setTimeout(r, 600));
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}

const url = process.argv[2] || 'http://localhost:4173/coupons';
const out = process.argv[3] || 'C:/Users/nansi.KHUSHI/.gemini/antigravity/brain/23de7785-1f8b-4530-9602-cfe22e20d094/header_current.png';
capture(url, out).catch(e => { console.error(e); process.exit(1); });
