# Changelog

## 0.2.1

- 默认刷新间隔改为 1 分钟
- 支持自定义刷新间隔（1 分钟 ~ 24 小时）
- 详情菜单新增手动刷新和设置刷新间隔选项

## 0.2.0

- 手动设置 Cookie 改为粘贴完整 Cookie 请求头
- 更新提示文案

## 0.1.9

- 改用 `Network.getCookies` 获取所有 Cookie（含 HttpOnly），修复 401 认证问题

## 0.1.8

- 修复 HttpOnly Cookie 无法获取导致 401 的问题

## 0.1.7

- 获取失败时支持退出登录

## 0.1.6

- 修复 CDP 连接改为 page 级别，解决自动登录无法检测 Cookie 的问题

## 0.1.5

- 改用 `Runtime.evaluate('document.cookie')` 获取 Cookie

## 0.1.4

- 已登录状态下详情菜单增加退出登录选项

## 0.1.3

- 新增自动登录功能（CDP 协议自动获取 Cookie）
- 新增退出登录功能
- 构建工具切换为 esbuild

## 0.1.2

- 未配置时点击状态栏自动弹出设置 Cookie 输入框

## 0.1.1

- 修复 `activationEvents` 为空导致插件不激活的问题

## 0.1.0

- 初始版本
- 状态栏显示用量百分比
- 点击查看详情
- 手动设置 Cookie