# 元阁常见问题

## 速查索引

- **安装目标**：未指定目标怎么办 · 支持哪些智能体 · 装完为什么看不到
- **网络与源**：国内访问慢 · 镜像延迟 · 网络失败
- **更新**：`update --check` 退出码 · 自动更新边界 · 幂等
- **版本**：`--pin` 与默认策略 · 清单漂移 · 单技能安装
- **安全**：装前扫描 · 目标目录校验 · 失败恢复

---

## 1. 安装时提示「未指定目标」怎么办？

这表示当前目录没有检测到项目级技能目录。两种解决方式：

```bash
npx -y @yottameta/yotta-skills --agent codex
npx -y @yottameta/yotta-skills --dir /path/to/skills
```

`--agent` 使用内置智能体默认目录；`--dir` 适合自定义目录或未收录智能体。

## 2. 支持哪些智能体？

内置 17 个键名：`claude`、`cursor`、`codex`、`gemini`、`goose`、`amp`、`opencode`、`windsurf`、`workbuddy`、`kiro`、`trae`、`trae-cn`、`qwen`、`comate`、`codebuddy`、`kimi`、`agents`。未收录的智能体用 `--dir` 指定目录。

## 3. 国内访问 npm 慢或失败怎么办？

可用 `YOTTA_SKILLS_NPM_FLAGS` 追加 registry 参数：

```bash
YOTTA_SKILLS_NPM_FLAGS="--registry=https://registry.npmmirror.com" npx -y @yottameta/yotta-skills --agent codex
```

新版本发布后镜像可能有延迟；如需立即获取，可临时改回 npm 官方源并配置代理。

## 4. `update --check` 的退出码是什么意思？

- `0`：全部最新
- `3`：存在可更新技能
- `1`：检查失败（网络或 registry 异常）

该命令只读，不修改文件。

## 5. `update --auto` 会更新所有技能吗？

只自动更新元阁家族内技能（`yotta-*` 且在清单中）。其他已装技能只提示，不自动改动。

## 6. 重复安装会重复占空间吗？

不会。默认按清单版本判断，已一致的技能跳过；需要强制覆盖时加 `--force`。

## 7. `--pin` 和默认版本策略怎么选？

默认策略是同 major 跟随最新 patch，适合日常使用；`--pin` 锁定清单精确版本，适合可复现部署。

## 8. 为什么清单和文档版本会不一致？

人工文档可能滞后。机器权威源是 `skills.json`，人工可读副本是 `references/skill-list.md`；当前版本已加入自动测试，两者不一致会导致测试失败。

## 9. 如何只安装部分技能？

```bash
npx -y @yottameta/yotta-skills install yotta-memory yotta-workflow --agent codex
```

也可以先用 `--route` 查看建议组合，再按需安装。

## 10. 安装前安全扫描怎么用？

默认会查找可用的元信引擎并输出摘要；可用 `--verify <path>` 指定引擎，或 `--skip-scan` 关闭。扫描结果仅提示，不替代人工判断。

## 11. 安装失败后如何恢复？

查看汇总中的失败原因，先修复目录权限或网络，再单独安装失败技能：

```bash
npx -y @yottameta/yotta-skills install <slug> --dir /path/to/skills
```

## 12. 装完为什么智能体里看不到？

确认安装目录与智能体实际读取目录一致；安装后通常需要重启会话或重新加载技能列表。
