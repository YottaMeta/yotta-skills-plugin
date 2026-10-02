# Hub（本机单点安装 + 链接分发）

## 它解决什么

多智能体各自维护技能目录时，同一技能会被复制多份，升级后容易版本漂移。Hub 把
技能集中到本机一份真源，再按宿主建立链接（Windows junction / macOS·Linux
symlink），升级只改真源，已链接宿主即时生效。

## 默认位置

- Hub 真源：`~/.yottaskills/hub`
- 技能台账：`<hub>/.yotta-hub.json`
- 链接台账：`<hub>/.yotta-links.json`
- 覆盖方式：`--hub <dir>` 或 `YOTTA_SKILLS_HUB`

## 命令

```bash
# 发现本机已装智能体与技能目录（文件系统优先；不读元忆 / 注册表）
npx -y @yottameta/yotta-skills hub hosts

# 安装 / 更新 Hub 真源
npx -y @yottameta/yotta-skills hub install
npx -y @yottameta/yotta-skills hub update

# 接管各宿主现有技能：先只读预演，再复制收编（原目录保留）
npx -y @yottameta/yotta-skills hub adopt --scan
npx -y @yottameta/yotta-skills hub adopt --apply

# 非元阁来源技能没有统一更新源：手动从指定目录刷新
npx -y @yottameta/yotta-skills hub refresh my-skill --from <技能目录>

# 分发到全部已发现宿主（默认不覆盖真目录；--force 才备份并替换）
npx -y @yottameta/yotta-skills hub link --all

# 只删除链接，不动 Hub 真源
npx -y @yottameta/yotta-skills hub unlink --all

# 查看来源、版本、链接宿主与异常
npx -y @yottameta/yotta-skills hub status
npx -y @yottameta/yotta-skills hub doctor
```

## 宿主发现口径

1. 已收录宿主映射（兼容 Vercel Labs `skills` CLI / SkillCat 的公开宿主表）；
2. 环境变量覆盖（`CODEX_HOME`、`XDG_CONFIG_HOME`、`DSH_HOME`、
   `OPENCLAW_STATE_DIR`、`CLAUDE_CONFIG_DIR` 等）；
3. 常见配置根启发式扫描；
4. `YOTTA_SKILLS_DISCOVERY_ROOTS` 显式补充；
5. `--dir <path>` 精确指定非标准宿主。

自动发现默认排除临时目录、`.bak`、candidate / staging、插件构建目录等噪声。

## 兼容标准

- 技能格式：`agentskills.io` Agent Skills（`SKILL.md` + `name` / `description`）。
- 通用投影：`~/.agents/skills`、`$XDG_CONFIG_HOME/agents/skills`。
- 官方锁文件：只读兼容 Vercel Labs `skills` CLI 的 `.skill-lock.json` v3
  （`$XDG_STATE_HOME/skills/` 或 `~/.agents/`）。

## 本地面板（yotta-skills view）

```bash
npx -y @yottameta/yotta-skills view
npx -y @yottameta/yotta-skills view --port 8790
```

面板只在 `127.0.0.1`（默认 8789）监听，零远程资源、零遥测，只读写 Hub
目录与台账 / 证据文件，不读元忆、不改宿主全局配置。六个视图：概览、宿主矩阵、
收编向导、链接与体检、记录与回滚、路由与编排，另附高级 CLI 页。

动作边界：收编 / 链接 / 解除 / 回滚可执行（预览 → 确认 → 执行 → 证据）；
install / update / refresh 只在高级 CLI 页给出可复制命令，不在网页执行。
写操作需要页面会话令牌，解除与回滚需要破坏性确认串；收编始终逐项运行元信
扫描，high / critical 阻断。

## 安全边界

- `unlink` 只删除 lstat 确认为链接、且 readlink 目标位于 Hub 内的路径。
- 真目录 / 非 Hub 链接一律拒绝删除；`--force` 对真目录先备份再替换。
- Hub 仅本机使用，不对外分发技能内容。
