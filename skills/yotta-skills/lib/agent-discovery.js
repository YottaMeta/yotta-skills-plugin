'use strict';

/**
 * Local agent / skill-directory discovery.
 *
 * The discovery path is intentionally filesystem-first: it does not read the
 * memory registry or any YottaMeta state. It combines:
 *   1. known host mappings + documented environment overrides;
 *   2. bounded scans of common config / app-data roots;
 *   3. a lightweight installed-app marker scan for hosts that have no
 *      conventional skills directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const agentDirs = require('./agent-dirs');

const SKILL_FILE = 'SKILL.md';
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.venv', 'venv', 'site-packages', 'dist', 'build', 'out', 'coverage',
  'logs', 'log', 'tmp', 'temp', 'cache', '.cache', '.npm', '.cargo',
  '.rustup', '.nuget', '.gradle', '.m2', '.ssh',
]);
const AGENT_HINT = /(agent|claude|cursor|codex|opencode|openclaw|qclaw|trae|qwen|kimi|comate|codebuddy|workbuddy|dsh|deepseek|mimo|yotta|bionic|cherry|teleagent|dumate|cc.?switch|lmstudio|box|hermes|mavis|pi\b)/i;
const INSTALLED_NOISE = /(uninstall|updater|update|virtualbox|oracle|redistributable|runtime|driver)/i;

function envObject(options) {
  return (options && options.env) || process.env;
}

function homeDir(options) {
  return (options && options.homeDir) || os.homedir();
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (_) {
    return false;
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

function countSkills(dir) {
  let count = 0;
  for (const entry of safeReaddir(dir)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const child = path.join(dir, entry.name);
    if (!isDirectory(child)) continue;
    try {
      if (fs.statSync(path.join(child, SKILL_FILE)).isFile()) count++;
    } catch (_) { /* not a standard skill directory */ }
  }
  return count;
}

function normalizePath(dir) {
  const resolved = path.resolve(dir);
  try {
    return fs.realpathSync.native(resolved);
  } catch (_) {
    return resolved;
  }
}

function isNoisePath(dir, baseDir) {
  const resolved = path.resolve(dir);
  const base = baseDir ? path.resolve(baseDir) : null;
  const relative = base && isInsidePath(base, resolved) ? path.relative(base, resolved) : resolved;
  const parts = relative.split(/[\\/]+/).filter(Boolean).map((part) => part.toLowerCase());
  for (const part of parts) {
    if (part === 'temp' || part === 'tmp') return true;
    if (/\.bak$/.test(part)) return true;
    if (part === 'plugin-sources' || part === 'plugins' || part === 'node_modules') return true;
    if (part === 'candidate' || part.startsWith('candidate-') || part.includes('staging')) return true;
    if (part === 'memories' || part === 'connectors' || part === 'workspace') return true;
  }
  return false;
}

function isInsidePath(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function addRoot(list, seen, dir, meta) {
  if (!dir) return;
  const resolved = path.resolve(dir);
  const key = normalizePath(resolved).toLowerCase();
  if (seen.has(key)) {
    const existing = seen.get(key);
    if (meta && meta.known && existing) existing.known = true;
    if (meta && meta.agentId && !existing.agentId) existing.agentId = meta.agentId;
    if (meta && meta.label && existing.label === '自动发现目录') existing.label = meta.label;
    return;
  }
  const record = {
    dir: resolved,
    agentId: (meta && meta.agentId) || null,
    label: (meta && meta.label) || '自动发现目录',
    known: Boolean(meta && meta.known),
    env: Boolean(meta && meta.env),
    detection: (meta && meta.detection) || 'mapping',
    exists: isDirectory(resolved),
  };
  record.skillCount = record.exists ? countSkills(resolved) : 0;
  record.status = record.exists ? 'skills-dir' : 'missing';
  seen.set(key, record);
  list.push(record);
}

/**
 * Bounded recursive scan for directories named "skills".
 * Only branches that look agent-related are followed after the first level.
 */
function scanForSkillDirs(root, options) {
  const maxDepth = (options && options.maxDepth) || 3;
  const maxVisits = (options && options.maxVisits) || 6000;
  const found = [];
  const queue = [{ dir: path.resolve(root), depth: 0 }];
  let visits = 0;

  while (queue.length > 0 && visits < maxVisits) {
    const current = queue.shift();
    if (!isDirectory(current.dir)) continue;
    visits++;
    const entries = safeReaddir(current.dir);
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(current.dir, entry.name);
      if (/^skills$/i.test(entry.name)) {
        if (isDirectory(full) && !isNoisePath(full, options && options.baseDir)) found.push({ dir: full, parent: current.dir });
        continue;
      }
      if (current.depth >= maxDepth) continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (!isDirectory(full)) continue;
      const branchLooksRelevant = current.depth === 0
        || AGENT_HINT.test(entry.name)
        || AGENT_HINT.test(path.basename(current.dir));
      if (branchLooksRelevant) queue.push({ dir: full, depth: current.depth + 1 });
    }
  }
  return found;
}

function commonRoots(options) {
  const env = envObject(options);
  const home = homeDir(options);
  const roots = [];
  const add = (dir, depth) => {
    if (!dir) return;
    roots.push({ dir: path.resolve(dir), maxDepth: depth });
  };

  add(home, 2);
  add(env.APPDATA, 3);
  add(env.LOCALAPPDATA, 3);
  add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), 3);
  add(env.ProgramFiles, 2);
  add(env['ProgramFiles(x86)'], 2);
  add(env.XDG_CONFIG_HOME, 3);
  add(env.XDG_STATE_HOME, 3);
  add(env.XDG_DATA_HOME, 3);
  add(env.DSH_HOME, 3);
  add(env.DSH_AGENTS_HOME, 3);
  add(env.OPENCLAW_STATE_DIR, 2);
  add(env.CLAUDE_CONFIG_DIR, 2);
  add(env.CODEX_HOME, 2);
  add(env.YOTTACODE_HOME, 2);

  // A portable agent install often lives beside the current workspace. The
  // scanner only follows agent-looking branches, so this stays bounded.
  if (!options || (options.includeCwd !== false && String(env.YOTTA_SKILLS_DISCOVERY_NO_CWD || '') !== '1')) {
    let current = path.resolve(process.cwd());
    for (let depth = 0; depth < 3; depth++) {
      add(current, 2);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return roots;
}

function collectMarkerNames(root, depth, output, maxEntries) {
  if (!root || depth < 0 || output.size >= maxEntries) return;
  for (const entry of safeReaddir(root)) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (/\.lnk$/i.test(entry.name)) {
      output.add(entry.name.replace(/\.lnk$/i, '').trim());
      continue;
    }
    if (entry.isDirectory() && depth > 0) {
      collectMarkerNames(path.join(root, entry.name), depth - 1, output, maxEntries);
    }
  }
}

function installedMarkers(options) {
  const env = envObject(options);
  const names = new Set();
  const roots = [
    env.APPDATA && path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    env.ProgramData && path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    env.APPDATA,
    env.LOCALAPPDATA,
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
  ];
  for (const root of roots) collectMarkerNames(root, 2, names, 800);
  return [...names].filter((name) => AGENT_HINT.test(name) && !INSTALLED_NOISE.test(name));
}

function knownLabelMatches(name) {
  const normalized = String(name || '').toLowerCase();
  for (const info of Object.values(agentDirs.AGENT_DIRS)) {
    if (normalized.includes(String(info.label).toLowerCase())) return true;
  }
  return false;
}

/**
 * Discover hosts and their skill directories.
 *
 * Returns:
 *   hosts    - all candidate skill roots (existing and missing known mappings)
 *   installed - installed app markers, including hosts without a skills dir
 *   errors   - non-fatal discovery errors
 */
function discoverHosts(options) {
  const roots = [];
  const seen = new Map();
  const errors = [];

  for (const root of agentDirs.knownRoots(options)) {
    addRoot(roots, seen, root.dir, { ...root, detection: 'mapping' });
  }
  for (const root of agentDirs.envRoots(options)) {
    addRoot(roots, seen, root.dir, { ...root, detection: root.env ? 'env' : 'workspace' });
  }
  for (const root of commonRoots(options)) {
    for (const found of scanForSkillDirs(root.dir, {
      maxDepth: root.maxDepth,
      baseDir: options.homeDir || os.homedir(),
    })) {
      addRoot(roots, seen, found.dir, {
        detection: 'discovered',
        label: '自动发现：' + path.basename(found.parent),
      });
    }
  }

  const installed = [];
  const installedSeen = new Set();
  const addInstalled = (name, source) => {
    const label = String(name || '').trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (installedSeen.has(key)) return;
    installedSeen.add(key);
    installed.push({ label, source, hasSkillsDir: false });
  };
  for (const name of installedMarkers(options)) {
    if (knownLabelMatches(name) || AGENT_HINT.test(name)) addInstalled(name, '应用标记');
  }
  for (const host of roots) {
    if (!host.exists) continue;
    addInstalled(host.label, host.known ? '已知宿主' : '自动发现');
    const item = installed.find((entry) => entry.label.toLowerCase() === String(host.label).toLowerCase());
    if (item) {
      item.hasSkillsDir = true;
      item.skillDir = host.dir;
      item.skillCount = host.skillCount;
      item.agentId = host.agentId;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    hosts: roots,
    installed,
    errors,
  };
}

module.exports = {
  AGENT_HINT,
  discoverHosts,
  scanForSkillDirs,
  countSkills,
};
