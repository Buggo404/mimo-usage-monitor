# MiMo 用量监控

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/Buggo404.mimo-usage-monitor?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=Buggo404.mimo-usage-monitor)
[![GitHub](https://img.shields.io/github/stars/Buggo404/mimo-usage-monitor?style=social)](https://github.com/Buggo404/mimo-usage-monitor)

在 VS Code 底部状态栏实时显示 Xiaomi MiMo 平台 Token Plan 用量信息。

> 📦 [VS Code 插件市场安装](https://marketplace.visualstudio.com/items?itemName=Buggo404.mimo-usage-monitor) | 💻 [GitHub 源码](https://github.com/Buggo404/mimo-usage-monitor)

## 功能

- **状态栏实时显示**：底部状态栏显示本月用量百分比，颜色随用量变化（黄 > 75%，红 > 90%）
- **点击查看详情**：点击状态栏弹出本月/总套餐用量详情
- **自动登录**：自动打开浏览器登录，通过 CDP 协议自动获取 Cookie，无需手动复制
- **手动设置 Cookie**：支持从浏览器 Network 标签粘贴完整 Cookie
- **自动刷新**：默认每 1 分钟自动刷新，可自定义（1 分钟 ~ 24 小时）
- **退出登录**：一键清除已保存的 Cookie

## 快速开始

### 方式一：自动登录（推荐）

1. 点击底部状态栏的 `MiMo: 未配置`
2. 选择 **自动登录**
3. 在弹出的浏览器中登录你的小米账号
4. 登录成功后浏览器自动关闭，用量信息自动显示

### 方式二：手动设置 Cookie

1. 浏览器打开 https://platform.xiaomimimo.com/console/plan-manage 并登录
2. F12 → Network → 刷新页面 → 点击任意请求
3. 在 Headers 中找到 Cookie 字段，复制完整值
4. 在 VS Code 中运行命令 `MiMo: 设置 Cookie`，粘贴即可

## 命令

| 命令 | 说明 |
|------|------|
| `MiMo: 显示用量详情` | 点击状态栏触发，查看详细用量 |
| `MiMo: 刷新用量数据` | 手动刷新 |
| `MiMo: 设置 Cookie` | 手动粘贴 Cookie |
| `MiMo: 自动登录` | 打开浏览器自动获取 Cookie |
| `MiMo: 退出登录` | 清除已保存的 Cookie |
| `MiMo: 设置刷新间隔` | 设置自动刷新间隔（1 分钟 ~ 24 小时） |

## 设置项

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `mimoUsage.cookies` | `""` | 存储的 Cookie（自动登录时自动填写） |
| `mimoUsage.refreshInterval` | `1` | 自动刷新间隔（分钟） |

## 工作原理

- 插件通过 `GET /api/v1/tokenPlan/usage` 接口获取用量数据
- 自动登录时使用 Chrome DevTools Protocol (CDP) 通过 `Network.getCookies` 获取浏览器中所有 Cookie（包括 HttpOnly）
- Cookie 保存在 VS Code 全局设置中，仅本地存储

## License

MIT