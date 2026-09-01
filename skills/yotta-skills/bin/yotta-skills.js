#!/usr/bin/env node
/**
 * yotta-skills（元阁）—— 全家技能一键安装 CLI（YottaSkills 合集）
 *
 * 用法:
 *   npx -y @yottameta/yotta-skills --list                 # 列出全家技能 + 版本 + 说明
 *   npx -y @yottameta/yotta-skills install --agent <name> # 装全家到智能体默认用户级目录（推荐）
 *   npx -y @yottameta/yotta-skills install --dir <path>   # 装全家到指定目录
 *   npx -y @yottameta/yotta-skills install <skill> --dir <path>  # 装单个技能
 *   npx -y @yottameta/yotta-skills update --agent <name>  # 增量更新已装技能（补齐缺失/版本不一致）
 *   npx -y @yottameta/yotta-skills --dry-run              # 预览将安装清单（不联网、不改动）
 *
 * 版本策略：清单锁定 `major.x`（不锁死 patch，维护性更新随最新）；--pin 锁死精确版本。
 * 依赖：Node.js 18+；npm（pack）；系统 tar（解压）；元信 scan 可选（装了 yotta-verify 自动启用）。
 * 边界：只做「清单 + 下载 + 落位 + 汇总」；不内置任何技能本体；不 -g 污染。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PKG_ROOT = path.join(__dirname, '..');
let VERSION = '0.2.1';
try { VERSION = require(path.join(PKG_ROOT, 'package.json')).version; } catch (_) { /* keep fallback */ }

function loadManifest() {
  const file = process.env.YOTTA_SKILLS_MANIFEST || path.join(PKG_ROOT, 'skills.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    die('无法读取技能清单: ' + file + '（' + e.message + '）');
  }
  const list = Array.isArray(data) ? data : data.skills;
  if (!Array.isArray(list) || list.length === 0) die('技能清单为空: ' + file);
  for (const s of list) {
    for (const f of ['slug', 'name', 'pkg', 'version']) {
      if (!s[f]) die('技能清单字段缺失 ' + f + '：' + JSON.stringify(s));
    }
  }
  return list;
}

const MANIFEST = loadManifest();

// 智能体 -> 用户级默认技能目录（与各技能 install.js 同源；.agents/skills 并非通用目录）
const AGENT_DIRS = {
  claude:    { label: 'Claude Code',      dirs: ['.claude/skills'] },
  cursor:    { label: 'Cursor',           dirs: ['.cursor/skills', '.agents/skills'] },
  codex:     { label: 'Codex',            dirs: ['.codex/skills'] }, // 特判：$CODEX_HOME/skills
  gemini:    { label: 'Gemini CLI',       dirs: ['.gemini/skills', '.agents/skills'] },
  goose:     { label: 'Goose',            dirs: ['.config/goose/skills', '.agents/skills'] },
  amp:       { label: 'Amp',              dirs: ['.config/agents/skills', '.agents/skills'] },
  opencode:  { label: 'OpenCode',         dirs: ['.config/opencode/skills'] }, // 特判：$XDG_CONFIG_HOME
  windsurf:  { label: 'Windsurf',         dirs: ['.codeium/windsurf/skills'] },
  workbuddy: { label: 'WorkBuddy',        dirs: ['.workbuddy/skills'] },
  kiro:      { label: 'Kiro',             dirs: ['.kiro/skills'] },
  trae:      { label: 'Trae Code CLI',    dirs: ['.traecli/skills'] },
  'trae-cn': { label: 'Trae IDE（国内）',  dirs: ['.trae-cn/skills'] },
  qwen:      { label: 'Qwen Code',        dirs: ['.qwen/skills'] },
  comate:    { label: 'Comate 文心快码',   dirs: ['.comate/skills'] },
  codebuddy: { label: 'CodeBuddy Code',   dirs: ['.codebuddy/skills'] },
  kimi:      { label: 'Kimi Code CLI',    dirs: ['.kimi/skills'] },
  agents:    { label: '通用 AGENTS.md',    dirs: ['.agents/skills'] },
};

function codexUserDir() {
  const base = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(base, 'skills');
}
function opencodeUserDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'opencode', 'skills');
}
function resolveUserDir(rel) {
  if (rel === '.codex/skills') return codexUserDir();
  if (rel === '.config/opencode/skills') return opencodeUserDir();
  return path.join(os.homedir(), rel);
}

// ── 工具函数 ───────────────────────────────────────────────────────────────
function die(msg, code) {
  process.stderr.write('错误：' + msg + '\n');
  process.exit(code === undefined ? 2 : code);
}
function out(s) { process.stdout.write(s + '\n'); }

function tarBin() { return 'tar'; }

// 解析 npm 调用方式（Windows 的 .cmd 不能直接 spawn：EINVAL；cmd /c 引号脆弱）。
// 最优：定位 npm.cmd -> 读内容 -> 提取 node_modules/npm/bin/npm-cli.js -> 用 node 直接执行。
// 兼容：--npm / YOTTA_SKILLS_NPM 可指向 .js（node 执行）、.cmd（同样解析）、或可执行文件。
// 标准 npm 安装器布局：npm-cli.js 恒在 npm.cmd 同目录 node_modules/npm/bin/ 下（不解析 cmd 脚本内容，
// 避免 %dp0% 等 cmd 变量干扰；找不到则返回 null 走 shell 回退）
function npmCliFromCmd(cmdFile) {
  try {
    const p = path.join(path.dirname(cmdFile), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return fs.existsSync(p) ? p : null;
  } catch (_) { return null; }
}
function resolveNpm(opts) {
  const custom = opts.npm || process.env.YOTTA_SKILLS_NPM;
  if (custom) {
    if (/\.js$/i.test(custom)) return { bin: process.execPath, prefix: [custom], shell: false };
    if (/\.(cmd|bat)$/i.test(custom)) {
      const cli = npmCliFromCmd(custom);
      if (cli) return { bin: process.execPath, prefix: [cli], shell: false };
      return { bin: custom, prefix: [], shell: true };
    }
    return { bin: custom, prefix: [], shell: false };
  }
  if (process.platform === 'win32') {
    try {
      const w = spawnSync('where.exe', ['npm.cmd'], { encoding: 'utf8', timeout: 15000 });
      const line = (w.stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean);
      if (line) {
        const cli = npmCliFromCmd(line);
        if (cli) return { bin: process.execPath, prefix: [cli], shell: false };
      }
    } catch (_) { /* fallthrough */ }
    return { bin: 'npm.cmd', prefix: [], shell: true };
  }
  return { bin: 'npm', prefix: [], shell: false };
}


function parseArgs(argv) {
  const opts = {
    list: false, dryRun: false, pin: false, skipScan: false, force: false,
    help: false, version: false, agent: null, dir: null, npm: null,
    python: null, verify: null, command: null, skill: null, rest: [],
    inventory: false, reindex: false, noReindex: false, json: false, project: false, route: null,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = (name) => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) die(name + ' 缺少参数值'); i++; return v; };
    if (a === '--list' || a === '-l') opts.list = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--pin') opts.pin = true;
    else if (a === '--skip-scan') opts.skipScan = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--version' || a === '-v') opts.version = true;
    else if (a === '--inventory' || a === '--inv') opts.inventory = true;
    else if (a === '--route') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) die('--route 缺少需求摘要');
      opts.route = value;
      i++;
    }
    else if (a === '--reindex' || a === '--rescan') opts.reindex = true;
    else if (a === '--no-reindex') opts.noReindex = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--project') opts.project = true;
    else if (a === '--agent') opts.agent = take('--agent').toLowerCase();
    else if (a === '--dir') opts.dir = take('--dir');
    else if (a === '--npm') opts.npm = take('--npm');
    else if (a === '--python') opts.python = take('--python');
    else if (a === '--verify') opts.verify = take('--verify');
    else if (a.startsWith('-')) die('未知参数: ' + a);
    else positionals.push(a);
  }
  // 命令解析：install / update，其余位置参数 = 技能 slug（可多个）
  for (const p of positionals) {
    if (p === 'install' || p === 'update') {
      if (opts.command && opts.command !== p) die('命令冲突：' + opts.command + ' 与 ' + p);
      opts.command = p;
    } else {
      opts.rest.push(p);
    }
  }
  // 直接给 slug 且无命令 → 视为 install 单个/多个
  if (!opts.command && opts.rest.length > 0) opts.command = 'install';
  opts.skills = opts.rest.map(s => s.toLowerCase());
  return opts;
}

function skillRange(s) {
  const major = String(s.version).split('.')[0];
  return major + '.x';
}
function specOf(s, pin) {
  return s.pkg + '@' + (pin ? s.version : skillRange(s));
}
function findSkill(slug) {
  return MANIFEST.find(s => s.slug === slug || s.pkg === slug || s.pkg.replace('@yottameta/', '') === slug);
}
function selectSkills(opts) {
  if (opts.skills.length === 0) return MANIFEST;
  const picked = [];
  for (const slug of opts.skills) {
    const s = findSkill(slug);
    if (!s) die('未知技能: ' + slug + '（可用: yotta-skills --list）');
    picked.push(s);
  }
  return picked;
}

function readInstalledVersion(dir) {
  const f = path.join(dir, 'SKILL.md');
  try {
    const text = fs.readFileSync(f, 'utf8');
    const m = text.match(/^version:\s*([0-9]+\.[0-9]+\.[0-9]+)/m);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

function shouldSkip(name, isFile) {
  if (name === '__pycache__' || name === '.pytest_cache' || name === '.mypy_cache') return true;
  if (isFile && (name.endsWith('.pyc') || name.endsWith('.pyo'))) return true;
  return false;
}
function copyDir(src, dst, skip) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name) || shouldSkip(entry.name, entry.isFile())) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyDir(s, d, skip);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function resolveTargetDir(opts) {
  if (opts.dir) return path.resolve(opts.dir);
  if (opts.agent) {
    const info = AGENT_DIRS[opts.agent];
    if (!info) die('未收录智能体: ' + opts.agent + '。可用: ' + Object.keys(AGENT_DIRS).join(', ') + '；或改用 --dir <路径>。');
    return resolveUserDir(info.dirs[0]);
  }
  return null; // 未指定目标（项目级检测由调用方处理）
}

function detectProjectDir() {
  const PROJECT_DIRS = [
    '.claude/skills', '.cursor/skills', '.codex/skills', '.config/goose/skills',
    '.config/agents/skills', '.opencode/skills', '.codeium/windsurf/skills',
    '.workbuddy/skills', '.kiro/skills', '.traecli/skills', '.gemini/skills',
    '.trae-cn/skills', '.qwen/skills', '.comate/skills', '.codebuddy/skills',
    '.kimi/skills', '.agents/skills',
  ];
  for (const d of PROJECT_DIRS) if (fs.existsSync(d)) return path.resolve(d);
  return null;
}

// ── 元信 scan（若可用）─────────────────────────────────────────────────────
function findVerifyEngine(dest, opts) {
  const cands = [];
  if (opts.verify) cands.push(path.resolve(opts.verify));
  if (process.env.YOTTA_SKILLS_VERIFY) cands.push(path.resolve(process.env.YOTTA_SKILLS_VERIFY));
  if (dest) cands.push(path.join(dest, 'yotta-verify', 'scripts', 'yotta_verify.py'));
  for (const c of cands) {
    try { if (fs.statSync(c).isFile()) return c; } catch (_) { /* next */ }
  }
  return null;
}
function findPython(opts) {
  const cands = [];
  if (opts.python) cands.push(opts.python);
  if (process.env.YOTTA_SKILLS_PYTHON) cands.push(process.env.YOTTA_SKILLS_PYTHON);
  cands.push('python3', 'python');
  if (process.platform === 'win32') cands.push('py');
  for (const c of cands) {
    try {
      const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 10000 });
      if (r.status === 0) return c;
    } catch (_) { /* next */ }
  }
  return null;
}
function runScan(engine, skillDir) {
  const python = findPython({});
  if (!python) return { ok: false, note: '未找到 python（元信 scan 需要 Python 3.8+）' };
  // -B：禁止 Python 写 __pycache__（否则会在引擎所在目录（可能是已装技能）留下 .pyc 污染）
  const r = spawnSync(python, ['-B', engine, 'scan', skillDir, '--json'], { encoding: 'utf8', timeout: 60000 });
  if (r.status === null) return { ok: false, note: '元信 scan 执行失败' };
  try {
    const j = JSON.parse(r.stdout);
    const c = j.counts || {};
    return { ok: true, verdict: j.verdict, counts: c };
  } catch (_) {
    return { ok: false, note: '元信 scan 输出无法解析' };
  }
}

// ── 安装 ───────────────────────────────────────────────────────────────────
function runNpmPack(skill, opts, packDir) {
  const spec = specOf(skill, opts.pin);
  const args = ['pack', spec, '--pack-destination', packDir];
  const flags = (process.env.YOTTA_SKILLS_NPM_FLAGS || '').trim();
  if (flags) args.push(...flags.split(/\s+/));
  const npm = resolveNpm(opts);
  const r = spawnSync(npm.bin, [...npm.prefix, ...args], { encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024, shell: npm.shell });
  if (r.status !== 0) {
    const raw = (r.stderr || r.stdout || 'npm pack 失败').trim();
    const ll = raw.split(/\r?\n/).filter(Boolean);
    const brief = ll.slice(-4).join(' | ');
    return { error: brief || 'npm pack 失败', detail: raw };
  }
  const lines = (r.stdout || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let tarball = null;
  for (const l of lines) if (/\.tgz$/.test(l)) tarball = l;
  if (!tarball) {
    try {
      const found = fs.readdirSync(packDir).filter(f => f.endsWith('.tgz'));
      if (found.length === 1) tarball = found[0];
    } catch (_) { /* ignore */ }
  }
  if (!tarball) return { error: '未找到 npm pack 产物（' + spec + '）' };
  const vm = String(tarball).match(/-([0-9]+\.[0-9]+\.[0-9]+)\.tgz$/);
  return { tarball: path.join(packDir, tarball), resolved: vm ? vm[1] : null, spec };
}

function extractTarball(tarball, extractDir) {
  const r = spawnSync(tarBin(), ['-xzf', tarball, '-C', extractDir], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || 'tar 解压失败').trim().split('\n').pop() };
  const pkgDir = path.join(extractDir, 'package');
  if (!fs.existsSync(path.join(pkgDir, 'SKILL.md'))) return { error: '解压产物缺少 SKILL.md（' + tarball + '）' };
  return { pkgDir };
}

const COPY_SKIP = new Set(['package.json', 'bin', 'node_modules', '.git', '__pycache__']);

function installOne(skill, dest, opts) {
  const target = path.join(dest, skill.slug);
  const existing = readInstalledVersion(target);
  if (!opts.force && existing === skill.version) {
    return { skill, status: 'skip', version: existing, note: '已是最新' };
  }
  let tmp;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-skills-'));
    const packDir = path.join(tmp, 'pack');
    fs.mkdirSync(packDir, { recursive: true });
    const packed = runNpmPack(skill, opts, packDir);
    if (packed.error) {
      if (packed.detail) out('    ' + packed.detail.split(/\r?\n/).filter(Boolean).slice(-12).join('\n    '));
      return { skill, status: 'fail', version: null, note: packed.error };
    }
    const extractDir = path.join(tmp, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });
    const extracted = extractTarball(packed.tarball, extractDir);
    if (extracted.error) return { skill, status: 'fail', version: packed.resolved, note: extracted.error };

    // 元信 scan（若可用）：装前摘要，不拦截
    if (!opts.skipScan) {
      const engine = findVerifyEngine(dest, opts);
      if (engine) {
        const scan = runScan(engine, extracted.pkgDir);
        if (scan.ok) {
          const c = scan.counts;
          const line = 'critical ' + (c.critical || 0) + ' / high ' + (c.high || 0) + ' / medium ' + (c.medium || 0) +
                       ' / low ' + (c.low || 0) + ' / info ' + (c.info || 0);
          out('  元信 scan: ' + scan.verdict + '（' + line + '）');
          if (scan.verdict && /DO NOT INSTALL/.test(scan.verdict)) out('  ⚠ 元信 verdict 为 DO NOT INSTALL，请人工复核后再使用。');
        } else {
          out('  元信 scan: ' + scan.note);
        }
      }
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    copyDir(extracted.pkgDir, target, COPY_SKIP);
    return { skill, status: 'ok', version: packed.resolved || skill.version, note: null };
  } catch (e) {
    return { skill, status: 'fail', version: null, note: e.message };
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function runInstall(opts, dest) {
  const skills = selectSkills(opts);
  out('yotta-skills（元阁）v' + VERSION + ' —— 安装 ' + skills.length + ' 个技能 -> ' + dest);
  out('版本策略: ' + (opts.pin ? 'pin（锁死清单精确版本）' : 'range（' + skillRange(skills[0]) + '，跟随最新 patch；--pin 锁死）'));
  const results = [];
  let failed = 0;
  for (const s of skills) {
    const r = installOne(s, dest, opts);
    results.push(r);
    if (r.status === 'ok') out('  ✔ ' + s.slug.padEnd(22) + s.name + '  -> ' + (r.version || '?'));
    else if (r.status === 'skip') out('  - ' + s.slug.padEnd(22) + s.name + '  （' + r.note + '，v' + r.version + '）');
    else { failed++; out('  ✘ ' + s.slug.padEnd(22) + s.name + '  失败: ' + r.note); }
  }
  const ok = results.filter(r => r.status === 'ok').length;
  const skip = results.filter(r => r.status === 'skip').length;
  out('');
  out('汇总: 成功 ' + ok + ' / 跳过(已是最新) ' + skip + ' / 失败 ' + failed + '（共 ' + results.length + '）');
  if (failed > 0) process.exitCode = 1;
}

function runUpdate(opts, dest) {
  const skills = selectSkills(opts);
  out('yotta-skills（元阁）v' + VERSION + ' —— 增量更新 -> ' + dest);
  const results = [];
  let failed = 0;
  for (const s of skills) {
    const existing = readInstalledVersion(path.join(dest, s.slug));
    if (existing === s.version) {
      out('  - ' + s.slug.padEnd(22) + s.name + '  （已是最新，v' + existing + '）');
      results.push({ skill: s, status: 'skip', version: existing });
      continue;
    }
    const r = installOne(s, dest, opts);
    results.push(r);
    if (r.status === 'ok') out('  ✔ ' + s.slug.padEnd(22) + s.name + '  -> ' + (r.version || '?') + (existing ? '（原 v' + existing + '）' : '（新装）'));
    else if (r.status === 'skip') out('  - ' + s.slug.padEnd(22) + s.name + '  （' + r.note + '）');
    else { failed++; out('  ✘ ' + s.slug.padEnd(22) + s.name + '  失败: ' + r.note); }
  }
  const ok = results.filter(r => r.status === 'ok').length;
  const skip = results.filter(r => r.status === 'skip').length;
  out('');
  out('汇总: 更新 ' + ok + ' / 已是最新 ' + skip + ' / 失败 ' + failed);
  if (failed > 0) process.exitCode = 1;
}

// ── 展示 ───────────────────────────────────────────────────────────────────
function printList(opts) {
  const skills = opts.skills.length ? selectSkills(opts) : MANIFEST;
  out('yotta-skills（元阁）v' + VERSION + ' —— 全家技能清单（' + skills.length + ' 个）');
  out('版本策略: ' + (opts.pin ? 'pin（精确锁定）' : 'range（' + skillRange(skills[0]) + ' 起，跟随最新 patch；--pin 锁死）'));
  out('');
  for (const s of skills) {
    out('  ' + s.slug.padEnd(22) + s.name.padEnd(5) + ' ' + specOf(s, opts.pin).padEnd(52) + ' ' + s.version + '  ' + s.desc);
  }
  out('');
  out('安装: yotta-skills install --agent <name> 或 --dir <path>；预览: --dry-run；更新: update。');
}

function printHelp() {
  out('yotta-skills（元阁）v' + VERSION + ' —— npx 一次装齐全家技能');
  out('');
  out('用法:');
  out('  yotta-skills --list                 列出全家技能 + 版本 + 说明');
  out('  yotta-skills install --agent <name> 装全家到智能体默认用户级目录（推荐）');
  out('  yotta-skills install --dir <path>   装全家到指定目录');
  out('  yotta-skills install <skill> --dir <path>  装单个技能（可多个）');
  out('  yotta-skills update --agent <name>  增量更新已装技能（补齐缺失 / 版本不一致）');
  out('  yotta-skills --dry-run              预览将安装清单（不联网、不改动）');
  out('  yotta-skills --inventory            盘点本机已装技能（自研扫描，不依赖任何元技能）');
  out('  yotta-skills --reindex              重扫注册表（会话开工 / 装技能后自动调用；增量合并）');
  out('  yotta-skills --route "<需求摘要>"   给出场景组合、调用顺序、缺失技能安装建议');
  out('');
  out('选项:');
  out('  --agent <name>   智能体键名（--list 可查看；未知智能体请用 --dir）');
  out('  --dir <path>     目标技能目录（技能会装到 <path>/<slug>）');
  out('  --pin            锁死清单精确版本（默认 range：跟随同 major 最新 patch）');
  out('  --force          已是最新也重装');
  out('  --skip-scan      跳过元信装前 scan（装了 yotta-verify 自动启用）');
  out('  --npm <path>     指定 npm 可执行文件（默认 npm / npm.cmd）');
  out('  --python <path>  指定 python 可执行文件（元信 scan 用）');
  out('  --verify <path>  指定 yotta_verify.py 路径（默认找目标目录已装的元信）');
  out('  --json            inventory / reindex / route 时输出 JSON');
  out('  --route <需求>    静态编排路由（输出组合 / 顺序 / 依据 / 缺失技能建议）');
  out('  --project         inventory / reindex 时附加扫描当前项目 .agents/skills / .codex/skills');
  out('  --no-reindex      安装 / 更新后不自动重扫注册表');
  out('  -h, --help       帮助');
  out('  -v, --version    版本');
  out('');
  out('支持智能体: ' + Object.keys(AGENT_DIRS).join(', '));
  out('依赖: Node.js 18+ / npm / 系统 tar；环境变量 YOTTA_SKILLS_NPM / YOTTA_SKILLS_PYTHON / YOTTA_SKILLS_VERIFY / YOTTA_SKILLS_NPM_FLAGS 可覆盖。');
}



// ── 技能盘点 / re-index（自研零依赖扫描核心） ────────────────────────────────
/** 重扫所有技能根目录并增量合并进注册表；返回 { result, registry, changes }。 */
function reindexRegistry(opts) {
  const scan = require('../lib/skills-scan');
  const extraDirs = opts.dir ? [opts.dir] : [];
  const roots = scan.defaultRoots({ extraDirs: extraDirs, project: opts.project });
  const result = scan.scanRoots(roots);
  const prev = scan.readRegistry();
  const { registry, changes } = scan.mergeRegistry(result, prev);
  scan.saveRegistry(registry);
  return { result, registry, changes };
}

function runInventory(opts) {
  const scan = require('../lib/skills-scan');
  const { result, registry, changes } = reindexRegistry(opts);
  if (opts.json) {
    out(JSON.stringify({
      generated_at: registry.updated,
      note: registry.note,
      scanned: result.scanned,
      errors: result.errors,
      changes: changes,
      skills: Object.values(registry.skills).sort((a, b) => a.slug.localeCompare(b.slug)),
    }, null, 2));
    return;
  }
  out(scan.formatInventory(registry));
  out('');
  out('本次变化: 新增 ' + changes.added.length + ' / 更新 ' + changes.updated.length + ' / 消失 ' + changes.gone.length);
  if (result.errors.length) {
    out('跳过不存在目录 ' + result.errors.length + ' 个: ' + result.errors.map((e) => e.dir).join('; '));
  }
}

/** --reindex：重扫 + 增量合并，变化聚焦输出（供会话开工 / 钩子使用）。 */
function runReindex(opts) {
  const scan = require('../lib/skills-scan');
  const { result, registry, changes } = reindexRegistry(opts);
  if (opts.json) {
    out(JSON.stringify({
      reindexed_at: registry.updated,
      note: registry.note,
      count: Object.values(registry.skills).filter((s) => s.status !== 'gone').length,
      changes: changes,
      errors: result.errors,
      scanned: result.scanned,
    }, null, 2));
    return;
  }
  out('re-index 完成: 新增 ' + changes.added.length + ' / 更新 ' + changes.updated.length + ' / 消失 ' + changes.gone.length);
  for (const slug of changes.added) out('  + ' + slug);
  for (const slug of changes.updated) out('  ~ ' + slug);
  for (const slug of changes.gone) out('  - ' + slug);
  if (result.errors.length) {
    out('跳过不存在目录 ' + result.errors.length + ' 个');
  }
  out('注册表: ' + scan.registryPath());
}

/** --route：静态编排路由，输出组合、顺序、角色、缺失技能建议与其他已装技能候选。 */
function runRoute(opts) {
  const { routeRequest, defaultYottaSlugs } = require('../lib/route');
  const { registry } = reindexRegistry(opts);
  const yottaSlugs = new Set([...defaultYottaSlugs(), ...MANIFEST.map((s) => s.slug)]);
  const result = routeRequest(opts.route, { registry, yottaSlugs });
  if (opts.json) {
    out(JSON.stringify(result, null, 2));
    return;
  }
  out('路由结果: ' + result.playbook.name + '（置信度: ' + result.confidence + '）');
  out('适配意图: ' + result.playbook.intent);
  out('依据: ' + (result.matched_keywords.length ? result.matched_keywords.join('、') : '无明确匹配，回退到入口澄清'));
  out('');
  out('调用顺序:');
  for (const skill of result.skills) {
    out('  ' + skill.order + '. ' + skill.slug + ' [' + (skill.installed ? '已装' : '缺失') + '] - ' + skill.role);
  }
  if (result.missing_skills.length) {
    out('');
    out('缺失技能: ' + result.missing_skills.map((skill) => skill.slug).join(', '));
    out('安装命令: ' + result.install_command);
    out('安全提示: 安装前请先执行装前安全扫描；本命令不会自动安装。');
  }
  if (result.other_skill_candidates.length) {
    out('');
    out('其他已装技能候选（非元阁家族，仅本地机械匹配 frontmatter description）:');
    for (const c of result.other_skill_candidates) {
      out('  - ' + c.slug + ' v' + c.version + ' [' + (c.sources || []).join(',') + ']');
      out('    匹配: ' + c.matched_terms.join('、') + '（得分 ' + c.score + '）· 扫描状态: ' + (c.scan_status === 'not_scanned' ? '未扫描' : c.scan_status));
      out('    ' + (c.description || ''));
    }
    out('安全提示: 其他已装技能只读 frontmatter description 做机械匹配，不读取全文指令、不自动调用；使用/安装前请先执行装前安全扫描，决定权在用户。');
  }
  out('');
  out('应用模式: 显式调用（可经用户确认后切换为按场景自动调用）');
  out('说明: ' + result.disclaimer);
}

/** 装技能后自动 re-index（--no-reindex 关闭）：把本次落位结果反映进注册表。best-effort：失败不阻断安装。 */
function maybeAutoReindex(opts, dest) {
  if (opts.noReindex || opts.dryRun || !dest) return;
  const scan = require('../lib/skills-scan');
  try {
    const { changes } = reindexRegistry({ ...opts, dir: dest });
    out('');
    out('已自动 re-index 注册表（新增 ' + changes.added.length + ' / 更新 ' + changes.updated.length + ' / 消失 ' + changes.gone.length + '；注册表: ' + scan.registryPath() + '）');
  } catch (e) {
    out('');
    out('提示: 自动 re-index 跳过（' + e.message + '）；稍后可手动 --reindex 重扫');
  }
}

// ── main ───────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }
  if (opts.version) { out('yotta-skills v' + VERSION); return; }
  if (opts.list) { printList(opts); return; }
  if (opts.inventory && !opts.command) { runInventory(opts); return; }
  if (opts.reindex && !opts.command) { runReindex(opts); return; }
  if (opts.route && !opts.command) { runRoute(opts); return; }

  const command = opts.command || 'install';
  let dest = resolveTargetDir(opts);
  if (!dest && !opts.dryRun) dest = detectProjectDir();
  if (!dest && command === 'install' && !opts.dryRun) {
    die('未指定目标：请用 --agent <name> 或 --dir <path>（当前目录未检测到项目级技能目录）。', 4);
  }

  if (opts.dryRun) {
    const skills = selectSkills(opts);
    out('yotta-skills（元阁）v' + VERSION + ' —— dry-run（' + command + '，' + skills.length + ' 个技能）');
    out('目标: ' + (dest || '未指定（将检测项目级目录）'));
    out('版本策略: ' + (opts.pin ? 'pin（锁死）' : 'range（' + skillRange(skills[0]) + '）'));
    out('');
    for (const s of skills) {
      const tag = command === 'update' ? '将检查/更新' : '将安装';
      out('  [' + tag + '] ' + s.slug.padEnd(22) + s.name.padEnd(5) + ' ' + specOf(s, opts.pin).padEnd(52) + ' ' + s.version + '  ' + s.desc);
    }
    out('');
    out('（dry-run 未执行任何下载/写入）');
    return;
  }

  if (command === 'update') runUpdate(opts, dest);
  else runInstall(opts, dest);
  maybeAutoReindex(opts, dest);
}

main();
