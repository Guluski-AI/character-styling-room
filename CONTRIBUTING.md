# 贡献指南

感谢你关注角色造型室。项目目前以本地优先的 Electron 应用为主，欢迎通过 issue 和 pull request 一起改进。

## 开始之前

1. 使用 Node.js `>=22.13.0`。
2. 执行 `npm install` 安装依赖。
3. 执行 `npm run test:local` 和 `npm run build` 确认本地环境正常。
4. 涉及真实 Codex 请求的测试不要提交角色图片、生成结果或个人配置。

## 提交变更

- 从 `main` 创建主题分支，例如 `feat/saved-plans` 或 `fix/wardrobe-scroll`。
- 保持一个 pull request 聚焦一个主题。
- UI 变更请在描述中附上截图或录屏，并说明验证方式。
- 不要提交 `node_modules/`、`dist/`、`desktop-dist/`、`local-data/`、`outputs/`、`.env` 或本机账号配置。
- 不要把安装包直接提交到 Git；请使用 GitHub Releases。

## 提交前检查

```bash
npm run test:local
npm run build
```

提交信息可以使用简短的动词开头，例如 `修复衣柜滚动区域高度`、`增加方案分页`。
