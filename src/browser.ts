import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as http from 'http';
import { WebSocket } from 'ws';

const LOGIN_URL = 'https://platform.xiaomimimo.com/console/plan-manage';
const TARGET_COOKIES = ['userId', 'api-platform_slh', 'api-platform_ph'];
const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;

function findBrowserPath(): string | undefined {
  const candidates: string[] = [];

  if (process.platform === 'win32') {
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
    );
  }

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* skip */ }
  }
  return undefined;
}

class CDPConnection {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, (result: any) => void>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id != null && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
        }
      } catch { /* ignore */ }
    });
  }

  send(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);

      this.pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanupDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  } catch { /* ignore */ }
}

/** 通过 CDP HTTP API 获取 page 级别的 WebSocket 地址 */
function fetchPageWsUrl(port: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const targets: any[] = JSON.parse(data);
          // 找到 platform.xiaomimimo.com 的页面，或任意页面
          const page = targets.find(t => t.type === 'page' && t.url?.includes('platform.xiaomimimo.com'))
            ?? targets.find(t => t.type === 'page');
          resolve(page?.webSocketDebuggerUrl);
        } catch {
          resolve(undefined);
        }
      });
    });
    req.on('error', () => resolve(undefined));
    req.setTimeout(5000, () => { req.destroy(); resolve(undefined); });
  });
}

/** 带重试地获取 page WebSocket 地址 */
async function getPageWsUrl(port: number, maxRetries = 15): Promise<string | undefined> {
  for (let i = 0; i < maxRetries; i++) {
    const wsUrl = await fetchPageWsUrl(port);
    if (wsUrl) return wsUrl;
    await sleep(1000);
  }
  return undefined;
}

function parseDocumentCookie(cookieString: string): Record<string, string> {
  const found: Record<string, string> = {};
  if (!cookieString) return found;

  const parts = cookieString.split(';').map(c => c.trim());
  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    const name = part.substring(0, eqIndex).trim();
    const value = part.substring(eqIndex + 1).trim();
    if (TARGET_COOKIES.includes(name)) {
      found[name] = value;
    }
  }
  return found;
}

function buildCookieString(found: Record<string, string>): string {
  return TARGET_COOKIES
    .map(name => `${name}=${found[name]}`)
    .join('; ');
}

async function monitorCookies(pageWsUrl: string, proc: cp.ChildProcess): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(pageWsUrl);

    ws.on('open', async () => {
      const cdp = new CDPConnection(ws);

      // 启用 Network 域
      try {
        await cdp.send('Network.enable');
      } catch { /* ignore */ }

      const check = async (): Promise<boolean> => {
        if (settled) return true;
        try {
          // 获取 platform.xiaomimimo.com 域名下的所有 Cookie（含 HttpOnly）
          const result = await cdp.send('Network.getCookies', {
            urls: ['https://platform.xiaomimimo.com'],
          });
          const cookies: any[] = result.result?.cookies ?? [];

          // 检查目标 Cookie 是否已存在（判断登录成功）
          const hasAll = TARGET_COOKIES.every(name =>
            cookies.some((c: any) => c.name === name),
          );

          if (hasAll && cookies.length > 0) {
            settled = true;
            cdp.close();
            proc.kill();
            // 返回所有 Cookie，确保 API 认证完整
            const cookieStr = cookies
              .map((c: any) => `${c.name}=${c.value}`)
              .join('; ');
            resolve(cookieStr);
            return true;
          }
        } catch { /* ignore */ }
        return false;
      };

      if (await check()) return;

      const interval = setInterval(async () => {
        if (settled) { clearInterval(interval); return; }
        if (await check()) { clearInterval(interval); }
      }, POLL_INTERVAL_MS);

      proc.on('exit', () => {
        clearInterval(interval);
        cdp.close();
        if (!settled) {
          settled = true;
          reject(new Error('浏览器已关闭，未完成登录'));
        }
      });
    });

    ws.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(new Error(`连接页面失败: ${err.message}`));
      }
    });
  });
}

export async function autoLogin(): Promise<string> {
  const browserPath = findBrowserPath();
  if (!browserPath) {
    throw new Error('未找到 Chrome 或 Edge 浏览器，请手动设置 Cookie');
  }

  const tempDir = path.join(os.tmpdir(), `mimo-chrome-${Date.now()}`);
  let settled = false;

  return new Promise<string>((resolve, reject) => {
    const proc = cp.spawn(browserPath, [
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${tempDir}`,
      LOGIN_URL,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrBuf = '';
    proc.stderr?.on('data', (data: Buffer) => {
      stderrBuf += data.toString();
      // 解析端口号而非完整 WebSocket URL
      const match = stderrBuf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match && !settled) {
        const port = parseInt(match[1]);

        // 通过 HTTP API 获取 page 级别的 WebSocket 地址
        getPageWsUrl(port).then(
          (pageWsUrl) => {
            if (!pageWsUrl) {
              if (!settled) {
                settled = true;
                cleanupDir(tempDir);
                reject(new Error('无法找到浏览器页面，请确保页面已加载'));
              }
              return;
            }
            monitorCookies(pageWsUrl, proc).then(
              (cookies) => {
                if (!settled) {
                  settled = true;
                  cleanupDir(tempDir);
                  resolve(cookies);
                }
              },
              (err) => {
                if (!settled) {
                  settled = true;
                  cleanupDir(tempDir);
                  reject(err);
                }
              },
            );
          },
          (err) => {
            if (!settled) {
              settled = true;
              cleanupDir(tempDir);
              reject(err);
            }
          },
        );
      }
    });

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanupDir(tempDir);
        reject(new Error(`启动浏览器失败: ${err.message}`));
      }
    });

    proc.on('exit', () => {
      if (!settled) {
        settled = true;
        cleanupDir(tempDir);
        reject(new Error('浏览器已关闭，未完成登录'));
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        cleanupDir(tempDir);
        reject(new Error('登录超时（5 分钟）'));
      }
    }, TIMEOUT_MS);
  });
}