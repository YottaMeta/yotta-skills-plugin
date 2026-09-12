# 安装器工作原理（install-flow）

> 面向想了解 yotta-skills 内部机制的开发者；日常使用请读 `SKILL.md` 或中文教程
> （`references/tutorial.md`）。

## 总体流程

对每个待装技能：

1. 读清单（`skills.json`，默认随包；`YOTTA_SKILLS_MANIFEST` 可覆盖）；
2. `npm pack <pkg>@<spec> --pack-destination <临时目录>`；
3. 系统 `tar -xzf` 解压到临时目录（产物应有 `SKILL.md`）；
4. 读取包内 `skill-manifest.json`；没有 manifest 时使用 `skills.json` 的家族默认契约；
5. 校验 slug / package / version / 权限 / 生命周期脚本路径；
6. 元信装前扫描：已有元信则直接扫描；没有则自动安装元信自身，再扫描；
7. 通过后创建旧版本快照，把新版本复制到同盘暂存目录，再原子切换到目标目录；
8. setup / doctor 阶段执行内置检查；P0-2.1 不执行自定义生命周期脚本；
9. 汇总报告：✔ 成功 / - 跳过（已是最新）/ ✘ 失败；
10. 全部成功后自动 re-index 本地技能注册表（`~/.yottaskills/registry.json`）：重扫技能根目录并增量合并，
   新装 / 更新的技能随即进入注册表（`--no-reindex` 可关闭；`--dry-run` 不触发）。

## 复制跳过规则

- 顶层跳过：`package.json` / `bin` / `node_modules` / `.git` / `__pycache__`；
- 任意层级跳过：`.pytest_cache` / `.mypy_cache` 目录、`*.pyc` / `*.pyo` 文件。

因此装进技能目录的是「技能本体」（SKILL.md / references / scripts 等），不含 npm
安装器自身、测试夹具与 Python 字节码缓存。

## manifest 与家族默认契约

每个技能包可以自带根目录 `skill-manifest.json`。有 manifest 时：

- 校验 `slug` / `package` / `version` 与包目录、`package.json`、`SKILL.md` 一致；
- 校验 `install.idempotent` 为 `true`；
- 校验 setup / doctor / rollback 路径为包内相对路径，不能包含绝对路径或 `..`。

没有 manifest 时使用家族默认契约：来源 `yottameta`、幂等安装、自动应用模式 `route`，
不声明 MCP、hook 或自定义生命周期脚本。

## re-index（装技能后自动重扫注册表）

- `install` / `update` 完成后，CLI 自动调用 `--reindex`（同一套 `lib/skills-scan.js` 扫描核心）：
  重扫技能根目录 → 增量合并进 `~/.yottaskills/registry.json`（新增 / 更新 / 消失）。
- `--no-reindex` 关闭自动重扫；`--reindex` 也可单独手动执行（会话开工 / 新装技能后）。
- 与 `--inventory` 的区别：`--inventory` 侧重「盘点展示」（文本表格 / JSON 全量），
  `--reindex` 侧重「变化合并」（增量、输出聚焦新增 / 更新 / 消失，适合钩子与脚本）。

## 幂等与版本判断

- 读取目标 `<dest>/<slug>/SKILL.md` 的 frontmatter `version`；
- 与清单 `version` 一致 → 跳过（幂等：第二次安装 22 个全部跳过）；
- `--force` 强制重装；`update` 对「缺失 / 版本不一致」的技能重装。

## 版本策略

- 默认 range：spec = `<pkg>@<major>.x`（如 `0.x`），`npm pack` 取同 major 最新 patch；
- `--pin`：spec = `<pkg>@<清单精确版本>`。

## npm 解析（Windows）

- 优先：`where.exe npm.cmd` → 读同目录 `node_modules/npm/bin/npm-cli.js` → 用 node 直接执行
  （npm.cmd 直跑在 Windows 有 EINVAL，`cmd /c` 引号脆弱；npm-cli.js 直跑无 shell 变量坑）；
- `--npm` / `YOTTA_SKILLS_NPM`：`.js` → node 执行；`.cmd/.bat` → 同样解析 npm-cli.js；
  其它 → 直接执行；
- `YOTTA_SKILLS_NPM_FLAGS` 追加到 `npm pack` 参数。

## 元信装前门禁

- 引擎查找：`--verify` → `YOTTA_SKILLS_VERIFY` → `<dest>/yotta-verify/scripts/yotta_verify.py`；
- python 查找：`--python` → `YOTTA_SKILLS_PYTHON` → `python3` / `python` / `py`（win32）；
- 执行：`python -B <engine> scan <解压目录> --json`（`-B` 禁止写 `__pycache__`，防止污染
  引擎所在目录）；
- 元信缺失时：先按 `skills.json` 安装 `yotta-verify`，并记录 `gate_mode=trusted-bootstrap`
  与 `bootstrap_scan=self`，随后用元信扫描其余家族包；
- verdict 处置：`SAFE TO INSTALL` 继续；`INSTALL WITH CAUTION` / `REVIEW REQUIRED`
  继续但显示风险并留证；`DO NOT INSTALL` 和扫描失败阻断，不替换目标；
- `--skip-scan` 只保留为人工应急路径，使用时输出 `explicit-unverified` 并写入证据；
- `update --auto` 始终执行装前门禁，不接受 `--skip-scan`。

## 快照与回滚

- 旧版本快照：`~/.yottaskills/snapshots/<slug>/<timestamp>-<version>-<随机后缀>/`；
- 新版本先落在 `<dest>/.yottaskills-staging/<slug>-<随机后缀>/`；
- 旧目标先重命名为同盘备份，再把暂存目录切到目标；切换失败时恢复备份；
- 证据写入失败会触发回滚，不把安装标记为成功；
- Windows 上对 `EPERM` / `EACCES` / `EBUSY` 做短重试，避免杀毒或索引服务造成的瞬时锁。

## 安装证据

每次安装决策写入：

```text
~/.yottaskills/install-log.jsonl
```

记录包含时间、事件、技能、包名、版本、`gate_mode`、verdict、decision
和快照路径；不记录技能内容或用户数据，只写本机。

## 退出码

| 退出码 | 含义 |
|---|---|
| 0 | 成功（含全部跳过） |
| 1 | 安装 / 更新存在失败项 |
| 2 | 用法错误（未知参数 / 未知技能 / 未收录智能体） |
| 4 | 未指定目标且当前目录未检测到项目级技能目录 |
| 5 | 装前 gate 阻断或元信不可用 |
| 6 | manifest / 身份校验失败 |

## 目标目录解析

- `--dir`：直接使用（技能落在 `<dir>/<slug>`）；
- `--agent`：查内置 17 智能体表（codex 特判 `$CODEX_HOME/skills`；opencode 特判
  `$XDG_CONFIG_HOME/opencode/skills`；其余 `~/.<agent>/skills` 或 `~/.config/...`）；
- 都未指定：检测当前目录是否存在项目级技能目录（`.claude/skills`、`.codex/skills`、
  `.agents/skills` 等 17 个），存在则用之；否则退出码 4。
