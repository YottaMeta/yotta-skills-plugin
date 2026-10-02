'use strict';

/**
 * YottaSkills Hub core (standard: yotta-skills-hub/v1).
 *
 * The hub is a local canonical skill store. Host directories receive links
 * (Windows junction / POSIX symlink) to the hub entries. This module is
 * deliberately filesystem-only and zero-dependency.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const scanLib = require('./skills-scan');
const skillsCliLock = require('./skills-cli-lock');

const STANDARD_ID = 'yotta-skills-hub/v1';
const STATE_VERSION = 1;
const STATE_FILE = '.yotta-hub.json';
const LINKS_FILE = '.yotta-links.json';
const AUDIT_FILE = '.yotta-hub-audit.jsonl';
const SKILL_FILE = 'SKILL.md';

const HASH_SKIP = new Set([
  '.git', 'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.yottaskills-staging', '.yottaskills-backup',
]);

function nowIso() {
  return new Date().toISOString();
}

function resolveHubDir(opts) {
  const options = opts || {};
  const explicit = options.hub || process.env.YOTTA_SKILLS_HUB;
  if (explicit) return path.resolve(explicit);
  return path.join(options.homeDir || os.homedir(), '.yottaskills', 'hub');
}

function hubPaths(hubDir) {
  const root = path.resolve(hubDir);
  return {
    root,
    state: path.join(root, STATE_FILE),
    links: path.join(root, LINKS_FILE),
    audit: path.join(root, AUDIT_FILE),
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function readHubState(hubDir) {
  const fallback = {
    standard: STANDARD_ID,
    version: STATE_VERSION,
    updatedAt: null,
    skills: {},
  };
  const value = readJson(hubPaths(hubDir).state, fallback);
  if (!value || typeof value !== 'object') return fallback;
  if (!value.skills || typeof value.skills !== 'object') value.skills = {};
  value.standard = value.standard || STANDARD_ID;
  value.version = value.version || STATE_VERSION;
  return value;
}

function writeHubState(hubDir, state) {
  const next = {
    standard: STANDARD_ID,
    version: STATE_VERSION,
    updatedAt: nowIso(),
    skills: (state && state.skills) || {},
  };
  writeJsonAtomic(hubPaths(hubDir).state, next);
  return next;
}

function readLinkState(hubDir) {
  const fallback = {
    standard: STANDARD_ID,
    version: STATE_VERSION,
    updatedAt: null,
    links: [],
  };
  const value = readJson(hubPaths(hubDir).links, fallback);
  if (!value || typeof value !== 'object') return fallback;
  if (!Array.isArray(value.links)) value.links = [];
  value.standard = value.standard || STANDARD_ID;
  value.version = value.version || STATE_VERSION;
  return value;
}

function writeLinkState(hubDir, state) {
  const next = {
    standard: STANDARD_ID,
    version: STATE_VERSION,
    updatedAt: nowIso(),
    links: Array.isArray(state && state.links) ? state.links : [],
  };
  writeJsonAtomic(hubPaths(hubDir).links, next);
  return next;
}

function appendAudit(hubDir, entry) {
  const file = hubPaths(hubDir).audit;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ at: nowIso(), ...entry }) + '\n', 'utf8');
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
  const base = safeRealpath(root);
  const candidate = safeRealpath(target);
  const relative = path.relative(base, candidate);
  if (relative === '') return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function hashTree(dir) {
  const hash = crypto.createHash('sha256');
  const walk = (current, relative) => {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (HASH_SKIP.has(entry.name)) continue;
      if (entry.name.startsWith('.yottaskills-')) continue;
      if (/\.py[co]$/.test(entry.name)) continue;
      const full = path.join(current, entry.name);
      const rel = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isSymbolicLink()) {
        hash.update('L\0' + rel + '\0' + fs.readlinkSync(full) + '\0');
      } else if (entry.isDirectory()) {
        hash.update('D\0' + rel + '\0');
        walk(full, rel);
      } else if (entry.isFile()) {
        hash.update('F\0' + rel + '\0');
        hash.update(fs.readFileSync(full));
        hash.update('\0');
      }
    }
  };
  walk(path.resolve(dir), '');
  return hash.digest('hex');
}

function scanHubSkills(hubDir) {
  const root = path.resolve(hubDir);
  const result = [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return result;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.includes('.yottaskills-backup-') || entry.name.includes('.yottaskills-import-')) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const dir = path.join(root, entry.name);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch (_) {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(dir, SKILL_FILE), 'utf8');
    } catch (_) {
      continue;
    }
    const fm = scanLib.parseFrontmatter(text) || {};
    const slug = String(fm.name || entry.name).trim();
    result.push({
      slug,
      dir,
      dirName: entry.name,
      version: fm.version ? String(fm.version).trim() : '',
      description: fm.description ? String(fm.description).trim() : '',
      treeHash: hashTree(dir),
      slugMismatch: slug !== entry.name,
    });
  }
  return result.sort((a, b) => a.slug.localeCompare(b.slug));
}

function manifestSlugs(manifest) {
  const set = new Set();
  const list = Array.isArray(manifest) ? manifest : (manifest && manifest.skills) || [];
  for (const item of list) {
    if (item && item.slug) set.add(item.slug);
  }
  return set;
}

function syncHubState(hubDir, options) {
  const opts = options || {};
  const previous = readHubState(hubDir);
  const family = manifestSlugs(opts.manifest);
  const scanned = scanHubSkills(hubDir);
  const upstream = skillsCliLock.readLock({ homeDir: opts.homeDir, env: opts.env });
  const now = nowIso();
  const skills = {};
  const seen = new Set();

  for (const item of scanned) {
    seen.add(item.slug);
    const old = previous.skills[item.slug] || {};
    const origin = old.origin || (family.has(item.slug) ? 'yotta' : 'external');
    const upstreamEntry = upstream.available ? upstream.skills[item.slug] : null;
    skills[item.slug] = {
      slug: item.slug,
      origin,
      version: item.version || old.version || null,
      treeHash: item.treeHash,
      dir: item.dir,
      description: item.description || old.description || '',
      source: (upstreamEntry && upstreamEntry.source) || old.source || (origin === 'yotta' ? 'npm' : 'local'),
      sourceType: (upstreamEntry && upstreamEntry.sourceType) || old.sourceType || null,
      sourceUrl: (upstreamEntry && upstreamEntry.sourceUrl) || old.sourceUrl || null,
      upstreamSkillHash: (upstreamEntry && upstreamEntry.skillFolderHash) || old.upstreamSkillHash || null,
      upstreamInstalledAt: (upstreamEntry && upstreamEntry.installedAt) || old.upstreamInstalledAt || null,
      upstreamUpdatedAt: (upstreamEntry && upstreamEntry.updatedAt) || old.upstreamUpdatedAt || null,
      sourcePath: old.sourcePath || null,
      sourceAgent: old.sourceAgent || null,
      importedAt: old.importedAt || now,
      updatedAt: now,
      scanVerdict: old.scanVerdict || null,
      inPlace: Boolean(old.inPlace),
      status: 'present',
      slugMismatch: item.slugMismatch,
    };
  }
  for (const [slug, old] of Object.entries(previous.skills)) {
    if (seen.has(slug)) continue;
    skills[slug] = { ...old, status: 'missing', updatedAt: now };
  }

  const state = { skills, upstreamLock: { path: upstream.path, available: upstream.available, version: upstream.version } };
  writeHubState(hubDir, state);
  return { state: readHubState(hubDir), scanned };
}

function createDirLink(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(path.resolve(target), linkPath, type);
}

function removeDirLink(linkPath) {
  try {
    fs.unlinkSync(linkPath);
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EISDIR')) {
      fs.rmdirSync(linkPath);
      return;
    }
    throw error;
  }
}

function classifyTarget(target, hubDir) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (_) {
    return { kind: 'missing' };
  }
  if (stat.isSymbolicLink()) {
    let real = null;
    let targetExists = false;
    try {
      real = fs.realpathSync.native ? fs.realpathSync.native(target) : fs.realpathSync(target);
      targetExists = true;
    } catch (_) {
      try {
        real = fs.realpathSync(target);
        targetExists = true;
      } catch (_) { /* broken link: fall back to the recorded link value */ }
    }
    if (!real) {
      // A broken junction / symlink no longer resolves. Read the link value so
      // an unlink can still tell whether it points into the hub (fail-closed
      // cleanup path) without treating it as an arbitrary directory.
      let linkValue = null;
      try { linkValue = fs.readlinkSync(target); } catch (_) { linkValue = null; }
      real = linkValue ? path.resolve(path.dirname(path.resolve(target)), linkValue) : path.resolve(target);
    }
    return {
      kind: 'link',
      target: real,
      inHub: isInside(hubDir, real),
      targetExists,
    };
  }
  if (stat.isDirectory()) return { kind: 'directory' };
  return { kind: 'file' };
}

function linkSkills(options) {
  const opts = options || {};
  const hubDir = path.resolve(opts.hubDir);
  const targetDir = path.resolve(opts.targetDir);
  const dryRun = Boolean(opts.dryRun);
  const force = Boolean(opts.force);
  const slugs = Array.isArray(opts.slugs) && opts.slugs.length > 0
    ? opts.slugs
    : scanHubSkills(hubDir).map((item) => item.slug);
  const hubBySlug = new Map(scanHubSkills(hubDir).map((item) => [item.slug, item]));
  const links = readLinkState(hubDir).links.slice();
  const results = [];

  for (const slug of slugs) {
    const skill = hubBySlug.get(slug);
    if (!skill) {
      results.push({ slug, status: 'missing', note: 'hub 中没有该技能' });
      continue;
    }
    const target = path.join(targetDir, slug);
    const current = classifyTarget(target, hubDir);
    let backup = null;
    if (current.kind === 'link' && current.inHub && current.targetExists !== false && samePath(current.target, skill.dir)) {
      results.push({ slug, status: 'linked', target, note: '已链接到 hub' });
      continue;
    }
    if (current.kind !== 'missing') {
      if (!force) {
        results.push({
          slug,
          status: 'conflict',
          target,
          note: current.kind === 'directory'
            ? '目标已存在真目录（默认跳过；确认后可加 --force 备份并替换）'
            : current.kind === 'link'
              ? '目标已存在其他链接（默认跳过；确认后可加 --force 替换）'
              : '目标已存在普通文件（拒绝覆盖）',
        });
        continue;
      }
      if (current.kind === 'directory') {
        if (dryRun) {
          results.push({ slug, status: 'would-backup', target, note: '将备份真目录后建立链接' });
          continue;
        }
        backup = target + '.yottaskills-backup-' + Date.now();
        fs.renameSync(target, backup);
      } else if (current.kind === 'link') {
        if (dryRun) {
          results.push({ slug, status: 'would-replace', target, note: '将替换已有链接' });
          continue;
        }
        removeDirLink(target);
      } else {
        results.push({ slug, status: 'conflict', target, note: '目标已存在普通文件（拒绝覆盖）' });
        continue;
      }
    }
    if (dryRun) {
      results.push({ slug, status: 'would-link', target, note: '将建立链接' });
      continue;
    }
    try {
      createDirLink(skill.dir, target);
      const index = links.findIndex((item) => item.slug === slug && samePath(item.dir || '', targetDir));
      const record = {
        slug,
        agent: opts.agentId || null,
        label: opts.label || null,
        dir: targetDir,
        target,
        hubDir: skill.dir,
        linkedAt: nowIso(),
        backup,
      };
      if (index >= 0) links[index] = record;
      else links.push(record);
      results.push({ slug, status: 'linked', target, note: backup ? '已备份原目录并建立链接' : '已建立链接', backup });
      appendAudit(hubDir, { event: 'link', slug, target, hubDir: skill.dir, backup });
    } catch (error) {
      results.push({
        slug,
        status: 'error',
        target,
        note: error.message + '（未静默降级为复制；请检查目录权限或改用 --dir 指定可写目录）',
      });
    }
  }
  if (!dryRun) {
    writeLinkState(hubDir, { links });
    try {
      syncHubState(hubDir, { homeDir: opts.homeDir, env: opts.env });
    } catch (_) { /* link state is already durable; state refresh is best-effort */ }
  }
  return { hubDir, targetDir, dryRun, results };
}

function unlinkSkills(options) {
  const opts = options || {};
  const hubDir = path.resolve(opts.hubDir);
  const targetDir = path.resolve(opts.targetDir);
  const dryRun = Boolean(opts.dryRun);
  const slugs = Array.isArray(opts.slugs) && opts.slugs.length > 0
    ? opts.slugs
    : readLinkState(hubDir).links
      .filter((item) => samePath(item.dir || '', targetDir))
      .map((item) => item.slug);
  const unique = [...new Set(slugs)];
  const links = readLinkState(hubDir).links.slice();
  const results = [];

  for (const slug of unique) {
    const target = path.join(targetDir, slug);
    const current = classifyTarget(target, hubDir);
    if (current.kind === 'missing') {
      results.push({ slug, status: 'missing', target, note: '目标不存在' });
      continue;
    }
    if (current.kind !== 'link') {
      results.push({ slug, status: 'refused', target, note: '目标不是链接；fail-closed，拒绝删除' });
      continue;
    }
    if (!current.inHub) {
      results.push({ slug, status: 'refused', target, note: '链接目标不在 hub 内；fail-closed，拒绝删除' });
      continue;
    }
    if (dryRun) {
      results.push({ slug, status: 'would-unlink', target, note: '将删除链接（不动 hub 真源）' });
      continue;
    }
    try {
      removeDirLink(target);
      for (let i = links.length - 1; i >= 0; i--) {
        if (links[i].slug === slug && samePath(links[i].dir || '', targetDir)) links.splice(i, 1);
      }
      results.push({ slug, status: 'unlinked', target, note: '已删除链接（hub 真源保留）' });
      appendAudit(hubDir, { event: 'unlink', slug, target });
    } catch (error) {
      results.push({ slug, status: 'error', target, note: error.message });
    }
  }
  if (!dryRun) writeLinkState(hubDir, { links });
  return { hubDir, targetDir, dryRun, results };
}

function linkStatus(hubDir) {
  const state = readLinkState(hubDir);
  return state.links.map((item) => {
    const current = classifyTarget(item.target, hubDir);
    return {
      ...item,
      status: current.kind === 'link'
        ? (!current.inHub ? 'drift' : (current.targetExists === false ? 'broken' : 'ok'))
        : current.kind === 'missing' ? 'broken' : 'drift',
      actual: current,
    };
  });
}

function status(options) {
  const opts = options || {};
  const hubDir = path.resolve(opts.hubDir);
  const synced = syncHubState(hubDir, { manifest: opts.manifest, homeDir: opts.homeDir, env: opts.env });
  const links = linkStatus(hubDir);
  const skills = Object.values(synced.state.skills)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((skill) => ({
      ...skill,
      links: links.filter((link) => link.slug === skill.slug),
    }));
  return {
    standard: STANDARD_ID,
    hubDir,
    skills,
    links,
    summary: {
      skills: skills.filter((skill) => skill.status === 'present').length,
      external: skills.filter((skill) => skill.origin === 'external').length,
      links: links.length,
      brokenLinks: links.filter((link) => link.status !== 'ok').length,
    },
  };
}

function doctor(options) {
  const opts = options || {};
  const hubDir = path.resolve(opts.hubDir);
  const checks = [];
  const add = (id, ok, severity, message, hint) => {
    checks.push({ id, ok: Boolean(ok), severity, message, hint: hint || null });
  };

  add('hub_dir', fs.existsSync(hubDir), 'error',
    fs.existsSync(hubDir) ? 'Hub 目录存在' : 'Hub 目录不存在',
    fs.existsSync(hubDir) ? null : '先运行 yotta-skills hub install 或 hub adopt --apply');
  if (fs.existsSync(hubDir)) {
    try {
      fs.accessSync(hubDir, fs.constants.W_OK);
      add('hub_writable', true, 'error', 'Hub 目录可写');
    } catch (_) {
      add('hub_writable', false, 'error', 'Hub 目录不可写', '检查目录权限后重试');
    }
  }

  const synced = syncHubState(hubDir, {
    manifest: opts.manifest,
    homeDir: opts.homeDir,
    env: opts.env,
  });
  const stateSkills = Object.values(synced.state.skills || {});
  if (fs.existsSync(hubDir) && stateSkills.length === 0) {
    add('hub_nonempty', false, 'error', 'Hub 目录存在但没有任何技能',
      '先运行 yotta-skills hub install 或 hub adopt --apply');
  }
  for (const skill of stateSkills) {
    add('skill_present:' + skill.slug, skill.status === 'present', 'error',
      skill.status === 'present' ? skill.slug + ' 目标存在' : skill.slug + ' 目标缺失',
      skill.status === 'present' ? null : '重新收编 / 重装该技能，或删除对应链接');
    if (skill.slugMismatch) {
      add('slug_match:' + skill.slug, false, 'warning',
        skill.slug + ' 的 frontmatter name 与目录名不一致',
        '把目录名改为 frontmatter name，或修正 SKILL.md');
    }
  }

  const links = linkStatus(hubDir);
  for (const link of links) {
    add('link:' + link.slug + ':' + link.dir, link.status === 'ok', link.status === 'ok' ? 'info' : 'error',
      link.status === 'ok' ? '链接正常: ' + link.slug : '链接异常（' + link.status + '）: ' + link.slug,
      link.status === 'ok' ? null : '运行 hub link --all 重建，或 hub unlink 清理断链');
  }

  const errors = checks.filter((check) => !check.ok && check.severity === 'error');
  const warnings = checks.filter((check) => !check.ok && check.severity === 'warning');
  return {
    ok: errors.length === 0,
    hubDir,
    checks,
    summary: {
      errors: errors.length,
      warnings: warnings.length,
      info: checks.filter((check) => check.severity === 'info').length,
    },
  };
}

module.exports = {
  STANDARD_ID,
  STATE_FILE,
  LINKS_FILE,
  AUDIT_FILE,
  resolveHubDir,
  hubPaths,
  readHubState,
  writeHubState,
  readLinkState,
  writeLinkState,
  appendAudit,
  hashTree,
  scanHubSkills,
  syncHubState,
  createDirLink,
  removeDirLink,
  classifyTarget,
  linkSkills,
  unlinkSkills,
  linkStatus,
  status,
  doctor,
};
