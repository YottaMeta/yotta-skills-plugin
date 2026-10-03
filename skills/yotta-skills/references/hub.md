# Hub（本机单点安装 + 链接分发）

## 它解决什么

多智能体各自维护技能目录时，同一技能会被复制多份，升级后容易版本漂移。Hub 把
技能集中到本机一份真源，再按宿主建立链接（Windows junction / macOS·Linux
symlink），升级只改真源，已链接宿主即时生效。

## 默认位置

- Hub 真源：`~/.yottaskills/hub`
- 技能台账：`<hub>/.yotta-hub.json`
- 链接台账：`<hub>/.yotta-links.json`
- 收敛回收站：`~/.yottaskills/trash/<时间戳>/<宿主>/<技能>/`（保留 7 天，可用 `YOTTA_SKILLS_TRASH` 覆盖）
- 覆盖方式：`--hub <dir>` 或 `YOTTA_SKILLS_HUB`

## 元技能唯一性收敛（`hub link` 执行时）

元技能（清单 27 + 特殊家族 5：元开 / 元伴 / 元呈 / 元阁本体 / 元信MCP）在
`hub link`（含面板链接动作）执行时收敛唯一性，不做事后全机扫描：

1. 收集宿主目录中的同名真目录与 `yotta-X__*` 重命名副本（frontmatter `name` 相同）；
2. 版本闸门：Hub 版本 ≥ 宿主副本版本才收敛；宿主更高 → 跳过并提示先 `hub update`；
   版本无法解析 → 跳过提示（fail-safe）；
3. 旧副本移入回收站（保留 7 天、输出恢复路径）→ 建立指向 Hub 的链接；
4. 先移后链；建链失败自动尝试恢复已移动副本，恢复失败时报出回收站路径；
5. 外部技能保持原行为：同名冲突默认跳过，不自动删、不自动更新。

落地后跑一次 `hub link --all` 即可完成现存收敛。`hub doctor` 的
`single_source:*` 检查只读报告宿主中的多份副本与版本参差，不自动修改。

## 命令

```bash
# 发现本机已装智能体与技能目录（文件系统优先；不读元忆 / 注册表）
npx -y @yottameta/yotta-skills hub hosts

# 安装 / 更新 Hub 真源
# 范围 = 全家清单 27 + 特殊家族 5；特殊家族跟随各自 npm latest
# 非元技能不参与更新（来源无统一安装源，用户自行处理）
npx -y @yottameta/yotta-skills hub install
npx -y @yottameta/yotta-skills hub update

# 接管各宿主现有技能：先只读预演，再复制收编（原目录保留）
# --apply 输出明示范围与目标 Hub；--skip-scan 会显式提示跳过装前扫描
# 非元技能 frontmatter 的严格 YAML 风险只读告警，不影响使用则不处理
npx -y @yottameta/yotta-skills hub adopt --scan
npx -y @yottameta/yotta-skills hub adopt --apply

# 非元阁来源技能没有统一更新源：手动从指定目录刷新
npx -y @yottameta/yotta-skills hub refresh my-skill --from <技能目录>

# 分发到全部已发现宿主：元技能链接时收敛旧副本（回收站 7 天）；
# 外部技能同名真目录默认跳过（--force 才备份并替换）
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
- 收敛只动元技能在宿主目录中的旧副本：移入回收站（7 天）而非直删；
  不碰插件与宿主 MCP 配置；外部技能源文件绝不修改。
- Hub 仅本机使用，不对外分发技能内容。
