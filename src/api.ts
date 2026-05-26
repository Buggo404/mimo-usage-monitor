import * as https from 'https';

const BASE_URL = 'https://platform.xiaomimimo.com';

export interface UsageItem {
  name: string;
  used: number;
  limit: number;
  percent: number;
}

export interface UsageData {
  percent: number;
  used: number;
  limit: number;
  monthPercent: number;
  monthUsed: number;
  monthLimit: number;
}

function parseCookies(raw: string): string {
  // 用户输入格式: "userId=xxx; api-platform_slh=xxx; api-platform_ph=xxx"
  // 去掉可能存在的引号包裹
  return raw
    .split(';')
    .map(c => c.trim())
    .filter(c => c.length > 0)
    .join('; ');
}

function request(path: string, cookies: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Cookie': parseCookies(cookies),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'VSCode-MiMo-Usage-Monitor/0.1.0',
        'x-timezone': Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

export async function fetchUsage(cookies: string): Promise<UsageData> {
  const body = await request('/api/v1/tokenPlan/usage', cookies);
  const json = JSON.parse(body);

  if (json.code !== 0) {
    throw new Error(`API error: ${json.message || 'unknown'}`);
  }

  const monthItems: UsageItem[] = json.data?.monthUsage?.items ?? [];
  const planItems: UsageItem[] = json.data?.usage?.items ?? [];

  const monthTotal = monthItems.find(i => i.name === 'month_total_token');
  const planTotal = planItems.find(i => i.name === 'plan_total_token');

  return {
    percent: planTotal?.percent ?? json.data?.usage?.percent ?? 0,
    used: planTotal?.used ?? 0,
    limit: planTotal?.limit ?? 0,
    monthPercent: monthTotal?.percent ?? json.data?.monthUsage?.percent ?? 0,
    monthUsed: monthTotal?.used ?? 0,
    monthLimit: monthTotal?.limit ?? 0,
  };
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}