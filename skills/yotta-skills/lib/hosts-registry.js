'use strict';
/**
 * 用户级自定义宿主注册表（0.29.0 F2）—— <root>/hosts.json。
 *
 * root = YOTTA_SKILLS_HOME 或 ~/.yottaskills（与 self.json 同根，独立于 Hub 目录）。
 * schema v1：{ version, hosts:[{ dir, label, agentId, scope:"verified", note,
 * addedAt, source:"manual", manualState? }] }
 *
 * 注册只影响发现 / 分发 / 收编范围：不创建目录、不改宿主配置；
 * 移除注册绝不删除目录。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const hubLib = require('./hub');
const agentDirsLib = require('./agent-dirs');

const HOSTS_REGISTRY_VERSION = 1;
const LABEL_MAX_LENGTH = 48;
const MANUAL_STATES = ['available', 'orphan', 'ignored'];

function nowIso() {
  return new Date().toISOString();
}

function resolveSkillsRoot(opts) {
  const options = opts || {};
  const env = options.env || process.env;
  const explicit = options.skillsRoot || env.YOTTA_SKILLS_HOME;
  if (explicit) return path.resolve(explicit);
  return path.join(options.homeDir || os.homedir(), '.yottaskills');
}

function hostsRegistryPath(opts) {
  return path.join(resolveSkillsRoot(opts), 'hosts.json');
}

function readHostsRegistry(opts) {
  try {
    const value = JSON.parse(fs.readFileSync(hostsRegistryPath(opts), 'utf8'));
    if (value && typeof value === 'object' && Array.isArray(value.hosts)) {
      return {
        version: HOSTS_REGISTRY_VERSION,
        hosts: value.hosts.filter((item) => item && typeof item.dir === 'string' && item.dir),
      };
    }
  } catch (_) { /* missing or corrupt registry falls back to empty */ }
  return { version: HOSTS_REGISTRY_VERSION, hosts: [] };
}

function writeHostsRegistry(opts, registry) {
  const file = hostsRegistryPath(opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify({
    version: HOSTS_REGISTRY_VERSION,
    hosts: registry.hosts,
  }, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

function safeRealpath(target) {
  try {
    return fs.realpathSync.native(target);
  } catch (_) {
    try {
      return fs.realpathSync(target);
    } catch (_) {
      return path.resolve(target);
    }
  }
}

function samePath(left, right) {
  const a = safeRealpath(left);
  const b = safeRealpath(right);
  if (process.platform === 'win32') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** fail-closed 校验：返回中文错误或 null。 */
function validateHostDir(dir, opts) {
  const target = path.resolve(dir);
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (_) {
    return '目录不存在：' + target;
  }
  if (!stat.isDirectory()) return '不是目录：' + target;
  const hubDir = hubLib.resolveHubDir(opts);
  if (samePath(target, hubDir) || isInside(hubDir, target)) {
    return '指向 Hub 自身或子目录，不允许注册：' + target;
  }
  if (agentDirsLib.isBridgeOnlyDir(target, opts)) {
    return '锁 / 数据桥接目录不允许注册：' + target;
  }
  return null;
}

function validateLabel(label) {
  const value = String(label || '').trim();
  if (!value) return 'label 不能为空';
  if (/[\u0000-\u001f\u007f]/.test(value)) return 'label 含控制字符';
  if (value.length > LABEL_MAX_LENGTH) return 'label 过长（最多 ' + LABEL_MAX_LENGTH + ' 字符）';
  return null;
}

/** 注册自定义宿主目录（fail-closed；不创建目录、不改宿主配置）。 */
function addHost(opts, input) {
  const options = opts || {};
  const dir = input && input.dir ? path.resolve(input.dir) : null;
  if (!dir) return { ok: false, error: '缺少目录：hub hosts add <dir>' };
  const guard = validateHostDir(dir, options);
  if (guard) return { ok: false, error: guard };
  const label = String((input && input.label) || path.basename(dir)).trim();
  const labelError = validateLabel(label);
  if (labelError) return { ok: false, error: labelError };
  const agentId = input && input.agentId ? String(input.agentId).trim().toLowerCase() : null;

  const registry = readHostsRegistry(options);
  const existing = registry.hosts.find((item) => samePath(item.dir, dir));
  if (existing) {
    return { ok: false, error: '该目录已注册：' + dir, existing };
  }
  const entry = {
    dir,
    label,
    agentId,
    scope: 'verified',
    note: (input && input.note) || null,
    addedAt: nowIso(),
    source: 'manual',
  };
  registry.hosts.push(entry);
  writeHostsRegistry(options, registry);
  return { ok: true, entry, registry };
}

/** 移除注册（只移除登记，绝不删除目录）。 */
function removeHost(opts, target) {
  const options = opts || {};
  const registry = readHostsRegistry(options);
  const index = registry.hosts.findIndex((item) =>
    (target && target.dir && samePath(item.dir, target.dir)) ||
    (target && target.id && String(item.agentId || '').toLowerCase() === String(target.id).toLowerCase()));
  if (index < 0) return { ok: false, error: '未找到注册项' };
  const removed = registry.hosts.splice(index, 1)[0];
  writeHostsRegistry(options, registry);
  return { ok: true, removed, registry };
}

/** 手动标记宿主状态（可用 / 残留 / 忽略）；条目不存在时先注册。 */
function markHost(opts, input) {
  const options = opts || {};
  const state = input && input.state ? String(input.state).toLowerCase() : null;
  if (!MANUAL_STATES.includes(state)) {
    return { ok: false, error: '未知手动状态：' + state + '（可用 available / 残留 orphan / 忽略 ignored）' };
  }
  const dir = input && input.dir ? path.resolve(input.dir) : null;
  if (!dir) return { ok: false, error: '缺少目录' };
  const registry = readHostsRegistry(options);
  let entry = registry.hosts.find((item) => samePath(item.dir, dir));
  if (!entry) {
    const added = addHost(options, { dir, label: input.label });
    if (!added.ok) return added;
    const refreshed = readHostsRegistry(options);
    entry = refreshed.hosts.find((item) => samePath(item.dir, dir));
    entry.manualState = state;
    writeHostsRegistry(options, refreshed);
    return { ok: true, entry, registry: refreshed };
  }
  entry.manualState = state;
  writeHostsRegistry(options, registry);
  return { ok: true, entry, registry };
}

module.exports = {
  HOSTS_REGISTRY_VERSION,
  MANUAL_STATES,
  LABEL_MAX_LENGTH,
  resolveSkillsRoot,
  hostsRegistryPath,
  readHostsRegistry,
  writeHostsRegistry,
  validateHostDir,
  validateLabel,
  addHost,
  removeHost,
  markHost,
};
