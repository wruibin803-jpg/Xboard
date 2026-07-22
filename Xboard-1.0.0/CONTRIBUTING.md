# Contributing to Xboard

感谢你帮助改进 Xboard。项目优先接受范围清楚、容易验证的小改动。

## 开始开发

```bash
npm install
npm run dev
```

将项目根目录生成的 `main.js`、`manifest.json`、`styles.css` 放入测试 Vault 的 `.obsidian/plugins/agent-dashboard/`，然后在 Obsidian 中重新加载插件。

## 提交改动前

```bash
npm run build
npm run lint
```

请同时测试：

- 空 Vault 和包含大量笔记的 Vault。
- 未配置目录、目录不存在和目录有效三种状态。
- 浅色与深色主题。
- 键盘导航和主要按钮的可访问名称。
- 桌面端；涉及布局时也请测试移动端。

## 范围原则

- 优先使用 Obsidian 官方公开 API。
- 不提交 API 密钥、Vault 路径或私人数据。
- 不在未讨论前增加遥测、云同步或外部网络请求。
- 不为未来功能提前建立复杂插件系统。
- UI 卡片只保留标题、必要数据、状态和操作。

Bug 报告请包含 Obsidian 版本、操作系统、复现步骤和错误信息。功能建议请说明真实使用场景，而不只是实现方式。
