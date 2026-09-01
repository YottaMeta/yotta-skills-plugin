# 元阁 yotta-skills — Agent Plugin

The YottaMeta skill-family installer and orchestrator, packaged as an Agent Plugin with a built-in MCP server.

[English](#english) | [中文](#中文)

## English

This repository is a standalone [Agent Plugins 1.0](https://agent-plugins.org) plugin. It packages one skill and one MCP server in the standard layout (`plugin.json`, `skills/`, `mcp.json`).

### Install

#### Codex (verified)

```bash
codex plugin marketplace add YottaMeta/yotta-skills-plugin
codex plugin add yotta-skills@yotta-skills
```

#### Other compatible clients

Agent Plugins defines the package format, not a universal installer command. Use your client’s official setup instructions:

| Client | Setup instructions |
| --- | --- |
| VS Code | [Agent Plugins in VS Code](https://code.visualstudio.com/docs/agent-customization/agent-plugins) |
| Cursor | [Cursor plugins](https://cursor.com/docs/plugins) |
| GitHub Copilot | [About plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins) |
| ChatGPT & Codex | [OpenAI plugins](https://developers.openai.com/plugins) |
| Kiro | [Powers](https://kiro.dev/docs/powers/) |
| Hermes Agent | [Portable Agent Plugins v1 packages](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins#portable-agent-plugins-v1-packages) |
| OpenClaw | [Plugin bundles](https://docs.openclaw.ai/plugins/bundles) |
| Grok Bot | [Skills, routines, and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations) |
| NanoClaw | [Templates](https://github.com/nanocoai/nanoclaw/blob/main/docs/templates.md) |

Codex is verified by YottaMeta. Other clients are linked from the official Agent Plugins compatibility page and are not yet verified here.

### What you get

- **Skill** — `yotta-skills` skill instructions (`skills/yotta-skills/SKILL.md`)
- **MCP server** — started automatically by the client (stdio; requires Python 3.8+)

### Boundaries

- The MCP server runs fully local over stdio; no telemetry, no remote calls from the plugin itself.
- If the required runtime is missing, the MCP component may fail to start; the skill payload remains available.
- The skill payload is copied from the source repository release; for full documentation see [YottaMeta/yotta-skills](https://github.com/YottaMeta/yotta-skills).

### Source

Upstream skill repository: [YottaMeta/yotta-skills](https://github.com/YottaMeta/yotta-skills)
Plugin repository: [YottaMeta/yotta-skills-plugin](https://github.com/YottaMeta/yotta-skills-plugin)

### License

MIT — see `LICENSE` and the license inside the skill payload.

## 中文

本仓库是一个独立的 [Agent Plugins 1.0](https://agent-plugins.org) 插件，按标准目录结构打包一项技能和一个 MCP server（`plugin.json`、`skills/`、`mcp.json`）。

### 安装

#### Codex（已实测）

```bash
codex plugin marketplace add YottaMeta/yotta-skills-plugin
codex plugin add yotta-skills@yotta-skills
```

#### 其他兼容客户端

Agent Plugins 只定义包格式，不定义统一安装命令。请按你所用客户端的官方说明接入：

| 客户端 | 官方说明 |
| --- | --- |
| VS Code | [Agent Plugins in VS Code](https://code.visualstudio.com/docs/agent-customization/agent-plugins) |
| Cursor | [Cursor plugins](https://cursor.com/docs/plugins) |
| GitHub Copilot | [About plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins) |
| ChatGPT & Codex | [OpenAI plugins](https://developers.openai.com/plugins) |
| Kiro | [Powers](https://kiro.dev/docs/powers/) |
| Hermes Agent | [Portable Agent Plugins v1 packages](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins#portable-agent-plugins-v1-packages) |
| OpenClaw | [Plugin bundles](https://docs.openclaw.ai/plugins/bundles) |
| Grok Bot | [Skills, routines, and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations) |
| NanoClaw | [Templates](https://github.com/nanocoai/nanoclaw/blob/main/docs/templates.md) |

Codex 已由 YottaMeta 实测；其他客户端仅链接官方说明，尚未在本仓库逐项实测。

### 内容

- **技能** — `yotta-skills` 技能指令（`skills/yotta-skills/SKILL.md`）
- **MCP server** — 由客户端自动启动（stdio；需要 Python 3.8+）

### 边界

- MCP server 完全本地 stdio 运行；插件本身不做遥测、不发起远程调用。
- 若运行时缺失，MCP 组件可能启动失败；技能内容仍可使用。
- 技能内容来自源仓库发布版；完整文档见 [YottaMeta/yotta-skills](https://github.com/YottaMeta/yotta-skills)。

### 来源

上游技能仓库：[YottaMeta/yotta-skills](https://github.com/YottaMeta/yotta-skills)
插件仓库：[YottaMeta/yotta-skills-plugin](https://github.com/YottaMeta/yotta-skills-plugin)

### 许可证

MIT — 见 `LICENSE` 与技能目录内许可证。
