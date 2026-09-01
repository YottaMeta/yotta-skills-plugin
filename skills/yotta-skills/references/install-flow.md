# 安装器工作原理（install-flow）

> 面向想了解 yotta-skills 内部机制的开发者；日常使用请读 `SKILL.md` 或中文教程
> （`references/tutorial.md`）。

## 总体流程

对每个待装技能：

1. 读清单（`skills.json`，默认随包；`YOTTA_SKILLS_MANIFEST` 可覆盖）；
2. `npm pack <pkg>@<spec> --pack-destination <临时目录>`；
3. 系统 `tar -xzf` 解压到临时目录（产物应有 `SKILL.md`）；
4. 元信装前摘要（若引擎可用；`--skip-scan` 关闭）；
5. 删除目标 `<dest>/<slug>` 后重新复制（跳过规则见下）；
6. 汇总报告：✔ 成功 / - 跳过（已是最新）/ ✘ 失败；有失败项时退出码 1。
7. 全部完成后自动 re-index 本地技能注册表（`~/.yottaskills/registry.json`）：重扫技能根目录并增量合并，
   新装 / 更新的技能随即进入注册表（`--no-reindex` 可关闭；`--dry-run` 不触发）。

## 复制跳过规则

- 顶层跳过：`package.json` / `bin` / `node_modules` / `.git` / `__pycache__`；
- 任意层级跳过：`.pytest_cache` / `.mypy_cache` 目录、`*.pyc` / `*.pyo` 文件。

因此装进技能目录的是「技能本体」（SKILL.md / references / scripts 等），不含 npm
安装器自身、测试夹具与 Python 字节码缓存。

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

## 元信装前摘要

- 引擎查找：`--verify` → `YOTTA_SKILLS_VERIFY` → `<dest>/yotta-verify/scripts/yotta_verify.py`；
- python 查找：`--python` → `YOTTA_SKILLS_PYTHON` → `python3` / `python` / `py`（win32）；
- 执行：`python -B <engine> scan <解压目录> --json`（`-B` 禁止写 `__pycache__`，防止污染
  引擎所在目录）；
- 输出 verdict + counts（critical / high / medium / low / info）；DO NOT INSTALL 额外提示
  人工复核；仅摘要、不拦截。

## 退出码

| 退出码 | 含义 |
|---|---|
| 0 | 成功（含全部跳过） |
| 1 | 安装 / 更新存在失败项 |
| 2 | 用法错误（未知参数 / 未知技能 / 未收录智能体） |
| 4 | 未指定目标且当前目录未检测到项目级技能目录 |

## 目标目录解析

- `--dir`：直接使用（技能落在 `<dir>/<slug>`）；
- `--agent`：查内置 17 智能体表（codex 特判 `$CODEX_HOME/skills`；opencode 特判
  `$XDG_CONFIG_HOME/opencode/skills`；其余 `~/.<agent>/skills` 或 `~/.config/...`）；
- 都未指定：检测当前目录是否存在项目级技能目录（`.claude/skills`、`.codex/skills`、
  `.agents/skills` 等 17 个），存在则用之；否则退出码 4。
