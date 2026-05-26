import * as vscode from 'vscode';
import { fetchUsage, formatTokens, UsageData } from './api';
import { autoLogin as browserAutoLogin } from './browser';

let statusBarItem: vscode.StatusBarItem;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let lastData: UsageData | undefined;

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('mimoUsage');
  return {
    cookies: cfg.get<string>('cookies', ''),
    refreshInterval: cfg.get<number>('refreshInterval', 1),
  };
}

function getCookieSourceHint(): string {
  return [
    '获取步骤：',
    '1. 浏览器打开 https://platform.xiaomimimo.com/console/plan-manage 并登录',
    '2. F12 → Network → 刷新页面 → 点击任意请求',
    '3. 在 Headers 中找到 Cookie 字段，复制完整值',
  ].join('\n');
}

async function refreshUsage(showError = false): Promise<void> {
  const { cookies } = getConfig();

  if (!cookies) {
    statusBarItem.text = '$(warning) MiMo: 未配置';
    statusBarItem.tooltip = '点击设置 Cookie 或自动登录\n\n' + getCookieSourceHint();
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    return;
  }

  try {
    const data = await fetchUsage(cookies);
    lastData = data;

    const pct = (data.monthPercent * 100).toFixed(1);
    statusBarItem.text = `$(pulse) MiMo: ${pct}%`;
    statusBarItem.tooltip = buildTooltip(data);
    statusBarItem.backgroundColor = data.monthPercent >= 0.9
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : data.monthPercent >= 0.75
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
  } catch (err: any) {
    statusBarItem.text = '$(error) MiMo: 获取失败';
    statusBarItem.tooltip = `错误: ${err.message}\n\n可能 Cookie 已过期，请重新设置\n\n${getCookieSourceHint()}`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    if (showError) {
      vscode.window.showErrorMessage(`MiMo 用量获取失败: ${err.message}`);
    }
  }
}

function buildTooltip(data: UsageData): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.appendMarkdown('**MiMo Token Plan 用量详情**\n\n');
  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(`**本月用量**\n\n`);
  md.appendMarkdown(`- 已使用: **${formatTokens(data.monthUsed)}** / ${formatTokens(data.monthLimit)}\n`);
  md.appendMarkdown(`- 百分比: **${(data.monthPercent * 100).toFixed(1)}%**\n\n`);
  md.appendMarkdown(`**总套餐用量**\n\n`);
  md.appendMarkdown(`- 已使用: **${formatTokens(data.used)}** / ${formatTokens(data.limit)}\n`);
  md.appendMarkdown(`- 百分比: **${(data.percent * 100).toFixed(1)}%**\n\n`);
  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(`[打开控制台](https://platform.xiaomimimo.com/console/plan-manage)`);
  return md;
}

async function showDetail(): Promise<void> {
  const { cookies } = getConfig();
  if (!cookies) {
    // 未配置时弹出选择：自动登录 or 手动设置
    const pick = await vscode.window.showQuickPick(
      [
        { label: '$(browser) 自动登录', description: '打开浏览器登录，自动获取 Cookie', id: 'auto' },
        { label: '$(edit) 手动设置 Cookie', description: '粘贴浏览器中的 Cookie', id: 'manual' },
      ],
      { placeHolder: 'MiMo 未配置，请选择登录方式' },
    );
    if (pick?.id === 'auto') {
      await doAutoLogin();
    } else if (pick?.id === 'manual') {
      await setCookies();
    }
    return;
  }
  if (!lastData) {
    await refreshUsage(true);
    if (!lastData) {
      // 刷新失败时，提供重新登录或退出选项
      const failPick = await vscode.window.showQuickPick(
        [
          { label: '$(browser) 重新自动登录', id: 'auto' },
          { label: '$(edit) 重新设置 Cookie', id: 'manual' },
          { label: '$(sign-out) 退出登录', id: 'logout' },
        ],
        { placeHolder: 'MiMo 用量获取失败，请选择操作' },
      );
      if (failPick?.id === 'auto') {
        await doAutoLogin();
      } else if (failPick?.id === 'manual') {
        await setCookies();
      } else if (failPick?.id === 'logout') {
        await logout();
      }
      return;
    }
  }
  const d = lastData!;
  const { refreshInterval } = getConfig();
  const items = [
    `本月: ${formatTokens(d.monthUsed)} / ${formatTokens(d.monthLimit)} (${(d.monthPercent * 100).toFixed(1)}%)`,
    `总套餐: ${formatTokens(d.used)} / ${formatTokens(d.limit)} (${(d.percent * 100).toFixed(1)}%)`,
    `---`,
    `$(refresh) 手动刷新`,
    `$(clock) 刷新间隔: ${refreshInterval} 分钟（点击修改）`,
    `$(globe) 打开浏览器控制台`,
    `$(sign-out) 退出登录`,
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'MiMo Token Plan 用量详情',
    canPickMany: false,
  });
  if (picked === items[3]) {
    await refreshUsage(true);
  } else if (picked === items[4]) {
    await setRefreshInterval();
  } else if (picked === items[5]) {
    vscode.env.openExternal(vscode.Uri.parse('https://platform.xiaomimimo.com/console/plan-manage'));
  } else if (picked === items[6]) {
    await logout();
  }
}

async function doAutoLogin(): Promise<void> {
  statusBarItem.text = '$(loading~spin) MiMo: 登录中...';
  statusBarItem.tooltip = '正在等待浏览器登录...';
  statusBarItem.backgroundColor = undefined;

  try {
    const cookies = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'MiMo 自动登录',
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: '正在打开浏览器，请在浏览器中完成登录...' });

        // 支持取消
        return new Promise<string>((resolve, reject) => {
          token.onCancellationRequested(() => {
            reject(new Error('用户取消'));
          });
          browserAutoLogin().then(resolve, reject);
        });
      },
    );

    await vscode.workspace.getConfiguration('mimoUsage').update('cookies', cookies, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('MiMo 登录成功！Cookie 已自动保存。');
    refreshUsage(true);
  } catch (err: any) {
    if (err.message === '用户取消') {
      vscode.window.showWarningMessage('MiMo 自动登录已取消');
    } else {
      vscode.window.showErrorMessage(`MiMo 自动登录失败: ${err.message}`);
    }
    statusBarItem.text = '$(warning) MiMo: 未配置';
    statusBarItem.tooltip = '点击设置 Cookie 或自动登录';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}

async function logout(): Promise<void> {
  await vscode.workspace.getConfiguration('mimoUsage').update('cookies', '', vscode.ConfigurationTarget.Global);
  lastData = undefined;
  statusBarItem.text = '$(warning) MiMo: 未配置';
  statusBarItem.tooltip = '点击设置 Cookie 或自动登录';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  vscode.window.showInformationMessage('MiMo 已退出登录');
}

async function setCookies(): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: '粘贴浏览器中 platform.xiaomimimo.com 的完整 Cookie（从 Network 标签复制 Cookie 请求头）',
    placeHolder: '从 DevTools → Network → 任意请求 → Headers → Cookie 复制完整值',
    ignoreFocusOut: true,
    validateInput: (v) => {
      if (!v.trim()) return '不能为空';
      if (!v.includes('userId')) return '缺少 userId';
      return undefined;
    },
  });
  if (input) {
    await vscode.workspace.getConfiguration('mimoUsage').update('cookies', input, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('MiMo Cookie 已保存，正在刷新...');
    refreshUsage(true);
  }
}

async function setRefreshInterval(): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: '设置自动刷新间隔（分钟）',
    placeHolder: '1 - 1440（1 分钟 ~ 24 小时）',
    ignoreFocusOut: true,
    validateInput: (v) => {
      const n = Number(v);
      if (!v.trim() || isNaN(n)) return '请输入数字';
      if (n < 1) return '最小 1 分钟';
      if (n > 1440) return '最大 1440 分钟（24 小时）';
      return undefined;
    },
  });
  if (input) {
    const minutes = Math.min(Math.max(Math.round(Number(input)), 1), 1440);
    await vscode.workspace.getConfiguration('mimoUsage').update('refreshInterval', minutes, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`MiMo 刷新间隔已设为 ${minutes} 分钟`);
  }
}

function startAutoRefresh(): void {
  stopAutoRefresh();
  const { refreshInterval } = getConfig();
  const clamped = Math.min(Math.max(Math.round(refreshInterval), 1), 1440);
  const ms = clamped * 60 * 1000;
  refreshTimer = setInterval(() => refreshUsage(false), ms);
}

function stopAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'mimoUsage.showDetail';
  statusBarItem.text = '$(pulse) MiMo: --';
  statusBarItem.tooltip = '正在加载用量数据...';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('mimoUsage.refresh', () => refreshUsage(true)),
    vscode.commands.registerCommand('mimoUsage.setCookies', setCookies),
    vscode.commands.registerCommand('mimoUsage.showDetail', showDetail),
    vscode.commands.registerCommand('mimoUsage.logout', logout),
    vscode.commands.registerCommand('mimoUsage.autoLogin', doAutoLogin),
    vscode.commands.registerCommand('mimoUsage.setRefreshInterval', setRefreshInterval),
  );

  // 监听配置变更
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mimoUsage')) {
        refreshUsage(false);
        startAutoRefresh();
      }
    }),
  );

  // 首次加载 + 定时刷新
  refreshUsage(false);
  startAutoRefresh();
}

export function deactivate(): void {
  stopAutoRefresh();
}