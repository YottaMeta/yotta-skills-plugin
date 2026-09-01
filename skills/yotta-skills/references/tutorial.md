# 元阁中文教程（新手全流程）

> 配套技能：元阁 yotta-skills（全家技能一键安装 CLI，依赖 Node.js 18+ / npm / 系统 tar）。
> 目标：把元阁已发布的 22 个 `yotta-*` 技能一次装进指定智能体或目录，并学会预览、更新、
> 锁版本与常见排查。

## 1. 教程目标与前置

- 学会 `--list` / `install` / `update` / `--dry-run` / `--pin` / `--force` 的用法；
- 理解版本策略（range 与 --pin）与幂等行为；
- 掌握元信装前摘要的开关与配置；
- 前置：Node.js 18+、npm、系统 tar（Windows 10+ 自带）；网络可访问 npm 注册表
  （国内可配置镜像或代理）。

## 2. 查看全家清单

```bash
npx -y @yottameta/yotta-skills --list
```

输出 22 个技能：slug / 中文名 / 包名与版本范围 / 清单版本 / 一句话说明。
确认某个技能在不在清单里，可加技能名过滤：

```bash
npx -y @yottameta/yotta-skills --list yotta-memory
```

## 3. 安装全家到智能体

推荐用 `--agent` 装到指定智能体默认用户级目录（如 Codex）：

```bash
npx -y @yottameta/yotta-skills install --agent codex
```

支持 17 个智能体键名：`claude` / `cursor` / `codex` / `gemini` / `goose` / `amp` /
`opencode` / `windsurf` / `workbuddy` / `kiro` / `trae` / `trae-cn` / `qwen` / `comate` /
`codebuddy` / `kimi` / `agents`。未收录的智能体用 `--dir` 指到它的技能目录。

## 4. 安装到任意目录

```bash
npx -y @yottameta/yotta-skills install --dir ~/my-skills
```

每个技能落在 `<dir>/<slug>`（如 `~/my-skills/yotta-memory/`）。
只装个别技能：

```bash
npx -y @yottameta/yotta-skills install yotta-memory yotta-verify --dir ~/my-skills
```

## 5. 更新已装技能

```bash
npx -y @yottameta/yotta-skills update --agent codex
```

- 缺失的技能 → 补装；版本不一致的技能 → 按当前版本策略重装；
- 已是最新的技能显示「已是最新」并跳过（幂等）。

## 6. 安装前预览

```bash
npx -y @yottameta/yotta-skills --dry-run
```

dry-run 只打印将要执行的清单（含目标与版本策略），不联网、不写任何文件。

## 7. 版本策略：range 与 --pin

- 默认 range：按同 major 最新 patch（如 `0.x`），维护性更新随最新；
- 想完全可复现 → 加 `--pin` 锁死清单精确版本：

```bash
npx -y @yottameta/yotta-skills install --agent codex --pin
```

## 8. 强制重装与跳过元信摘要

```bash
npx -y @yottameta/yotta-skills install --agent codex --force     # 已是最新也重装
npx -y @yottameta/yotta-skills install --agent codex --skip-scan # 跳过装前摘要
```

元信（yotta-verify）已安装时默认会对每个待装技能输出装前摘要（verdict + 计数），仅提示
不拦截；verdict 为 DO NOT INSTALL 时会提示人工复核。

## 9. 验证安装结果

- 看安装汇总：成功 N / 跳过 N / 失败 N；
- 抽查技能目录：`ls ~/.codex/skills/yotta-memory/SKILL.md`；
- 复核版本：每个技能 SKILL.md 的 frontmatter `version` 应与 `--list` 一致（这也是幂等
  判断的依据）。

## 10. 常见问题

- **npmmirror 全新包 404**：镜像同步有延迟。设置环境变量 `YOTTA_SKILLS_NPM_FLAGS` 为
  `--registry=https://registry.npmjs.org/`（国内需代理）再执行，或等待镜像缓存后重试。
- **`--agent` 报未收录**：改用 `--dir` 指到该智能体的技能目录（`.agents/skills` 不是
  通用目录）。
- **某技能安装失败**：汇总报告给出失败原因；可单装该技能排查：
  `install <slug> --dir <path>`。
- **目标未指定**：当前目录没有项目级技能目录时报错（退出码 4），加 `--agent` 或
  `--dir`。
- **已有旧版本**：默认按 range 覆盖升级到最新 patch；`--pin` 则锁定清单版本。

## 11. 盘点已装技能与 re-index（新装技能自动被发现）

```bash
# 盘点本机已装技能（文本表格）
npx -y @yottameta/yotta-skills --inventory

# 重扫注册表（会话开工 / 新装技能后，增量合并变化）
npx -y @yottameta/yotta-skills --reindex
```

- `install` / `update` 完成后会自动重扫注册表（`~/.yottaskills/registry.json`），新装 / 更新的
  技能随即出现在 `--inventory` / `--reindex` 里；`--no-reindex` 可关闭自动重扫。
- 建议每会话开工先跑一次 `--reindex`（快速增量，只合并变化），让后装的技能自动被看见。

## 编排路由（--route）

当你不知道「这个需求该用哪几个技能」，可以先把需求摘要交给元阁：

```bash
npx -y @yottameta/yotta-skills --route "检查代码质量，别糊弄"
```

输出会告诉你命中哪个组合、按什么顺序调用、每个技能负责什么、哪些已装、哪些缺失，以及缺失技能的安装命令。元阁只给建议，不会自动安装；安装前请先做装前安全扫描，并由用户确认。
- `--json` 输出机器可读结果（含新增 / 更新 / 消失），适合脚本与钩子。
- 如果本机还装了非元阁家族技能，`--route` 会额外列出「其他已装技能候选」：只按 frontmatter description 与需求文本做本地机械匹配，标注来源、得分、命中词项与扫描状态（默认未扫描），不读取全文指令、不自动调用；使用/安装前请先做装前安全扫描。
