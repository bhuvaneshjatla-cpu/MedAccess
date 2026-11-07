'use strict';
// Shared helpers for the real-browser tests: finds a Chromium-family browser, launches it headless and exposes a minimal
// Chrome DevTools Protocol client over Node's built-in WebSocket (no dependencies).
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    process.env.MEDACCESS_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

const KEYS = {
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
};

class Page {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; this.errors = []; this.serverErrors = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
      else if (m.method) for (const h of this.handlers) h(m);
    });
    this.handlers.push((m) => {
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 500) this.serverErrors.push(`${m.params.response.status} ${m.params.response.url}`);
    });
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }
  async waitFor(expression, what, ms = 10000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (await this.eval(expression)) return; } catch { /* page still loading */ } await sleep(60); }
    const text = await this.eval('document.body ? document.body.innerText.slice(0, 400) : "(no body)"').catch(() => '(unavailable)');
    throw new Error(`Timed out waiting for ${what}. Page says: ${JSON.stringify(text)}`);
  }
  async goto(url) { await this.send('Page.navigate', { url }); await sleep(80); }
  /** a real keyboard key press (keyDown + keyUp), optionally with Shift */
  async press(name, { shift = false } = {}) {
    const k = KEYS[name]; const modifiers = shift ? 8 : 0;
    await this.send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', modifiers, ...k });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
    await sleep(30);
  }
  /** type text into whatever has focus */
  async type(text) { await this.send('Input.insertText', { text }); }
  async scheme(value) { await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }); }
  async viewport(width, height = 812) { await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 }); }
  async resetViewport() { await this.send('Emulation.clearDeviceMetricsOverride'); }
}

/** Launches the browser with a throw-away profile inside `dir`; returns { page, close }. */
async function launchBrowser(dir) {
  const exe = findBrowser();
  const profile = path.join(dir, 'profile');
  const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !fs.existsSync(portFile); i += 1) await sleep(50);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  let target;
  for (let i = 0; i < 100 && !target; i += 1) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not ready */ }
    if (!target) await sleep(50);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  const page = new Page(ws);
  for (const d of ['Page', 'Runtime', 'Network']) await page.send(`${d}.enable`);

  async function close() {
    // 1) ask the browser to close itself (stops every helper process), 2) kill the process tree, 3) sweep anything still using our profile
    try { await Promise.race([page.send('Browser.close'), sleep(2000)]); } catch { /* connection closes as the browser exits */ }
    try { ws.close(); } catch { /* ignore */ }
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      else proc.kill();
    } catch { /* ignore */ }
    if (process.platform === 'win32') {
      const p = profile.replace(/'/g, "''");
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${p}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
    }
    await sleep(300);
  }
  return { page, close };
}

module.exports = { findBrowser, launchBrowser, Page, sleep };
