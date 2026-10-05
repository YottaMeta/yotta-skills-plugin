'use strict';
/**
 * Hub 迁移（0.29.2 U4）—— `hub config set --hub <new> --move` 的两段式实现。
 *
 * 1) stageHubCopy({ from, to })：复制旧 Hub → 逐技能 treeHash 校验；失败
 *    fail-closed（清理暂存副本、旧 Hub 不动、配置不切换）。
 * 2) relinkAndRetireOldHub({ from, to, targets })：`hub link` 以新 Hub 为源、
 *    --force 重链各宿主 → 全部成功才把旧 Hub 移入回收站（7 天）；有失败则
 *    保留旧 Hub 供重试（此时新旧内容一致，链接混合指向两个 Hub 均可用）。
 *
 * 配置切换（config.json 写入）由调用方在两段之间执行；写入失败时调用
 * discardStagedCopy() 清理暂存副本。
 */
const fs = require('fs');
const path = require('path');
const hubLib = require('./hub');

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
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

function listEntries(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
}

/** 清理暂存副本（仅在 stage 阶段失败或配置写入失败时调用）。 */
function discardStagedCopy(options) {
  const opts = options || {};
  const to = path.resolve(opts.to);
  try {
    if (opts.existed) {
      for (const name of listEntries(to)) fs.rmSync(path.join(to, name), { recursive: true, force: true });
    } else {
      fs.rmSync(to, { recursive: true, force: true });
    }
  } catch (_) { /* 保留现场供排查 */ }
}

/** 复制 + 校验（不切配置）。返回 { ok, error?, from, to, existed, verifiedSkills }。 */
function stageHubCopy(options) {
  const opts = options || {};
  const from = path.resolve(opts.from);
  const to = path.resolve(opts.to);
  if (samePath(from, to)) return { ok: false, error: '新旧 Hub 路径相同：' + from };
  if (isInside(from, to) || isInside(to, from)) return { ok: false, error: '新旧 Hub 不能互相嵌套：' + from + ' / ' + to };
  let stat = null;
  try {
    stat = fs.statSync(from);
  } catch (_) { /* handled below */ }
  if (!stat || !stat.isDirectory()) return { ok: false, error: '旧 Hub 不存在或不是目录：' + from };
  const existed = fs.existsSync(to);
  if (existed && listEntries(to).length > 0) {
    return { ok: false, error: '新 Hub 目录非空（fail-closed，不合并）：' + to };
  }

  try {
    fs.mkdirSync(to, { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  } catch (error) {
    discardStagedCopy({ to, existed });
    return { ok: false, error: '复制失败：' + error.message };
  }

  const mismatches = [];
  for (const name of listEntries(from)) {
    if (!fs.existsSync(path.join(to, name))) mismatches.push('entry:' + name);
  }
  const skills = hubLib.scanHubSkills(from);
  for (const skill of skills) {
    let sourceStat = null;
    try {
      sourceStat = fs.lstatSync(skill.dir);
    } catch (_) {
      continue;
    }
    // in-place / 外部链接条目：随链接原样复制，不做内容校验。
    if (sourceStat.isSymbolicLink() || !isInside(from, skill.dir)) continue;
    const copied = path.join(to, path.relative(from, skill.dir));
    let copiedStat = null;
    try {
      copiedStat = fs.lstatSync(copied);
    } catch (_) { /* mismatch below */ }
    if (!copiedStat || !copiedStat.isDirectory()) {
      mismatches.push(skill.slug);
      continue;
    }
    try {
      if (hubLib.hashTree(skill.dir) !== hubLib.hashTree(copied)) mismatches.push(skill.slug);
    } catch (_) {
      mismatches.push(skill.slug);
    }
  }
  if (mismatches.length > 0) {
    discardStagedCopy({ to, existed });
    return {
      ok: false,
      error: '迁移校验失败（未切换配置；已清理暂存副本）：' + mismatches.slice(0, 8).join(', ') +
        (mismatches.length > 8 ? ' 等 ' + mismatches.length + ' 项' : ''),
    };
  }
  return { ok: true, from, to, existed, verifiedSkills: skills.length };
}

/** 重链（新 Hub 为源）+ 旧 Hub 入回收站（仅当重链无失败）。 */
function relinkAndRetireOldHub(options) {
  const opts = options || {};
  const from = path.resolve(opts.from);
  const to = path.resolve(opts.to);
  const targets = Array.isArray(opts.targets) ? opts.targets : [];
  const relink = [];
  let incomplete = 0;
  for (const target of targets) {
    if (!target || !target.dir) continue;
    if (samePath(target.dir, from) || samePath(target.dir, to)) continue;
    const result = hubLib.linkSkills({
      hubDir: to,
      targetDir: target.dir,
      agentId: target.agentId,
      label: target.label,
      force: true,
      manifest: opts.manifest,
      homeDir: opts.homeDir,
      env: opts.env,
    });
    const notLinked = result.results.filter((item) => item.status !== 'linked' && item.status !== 'missing');
    incomplete += notLinked.length;
    relink.push({
      dir: target.dir,
      label: target.label,
      linked: result.results.filter((item) => item.status === 'linked').length,
      incomplete: notLinked.map((item) => item.slug + ': ' + item.note),
    });
  }

  let trashedTo = null;
  let trashError = null;
  if (incomplete === 0) {
    try {
      const trashRoot = hubLib.resolveTrashRoot(from, { env: opts.env });
      const dest = path.join(trashRoot, 'hub-migrate-' + nowStamp(), path.basename(from));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      hubLib.moveEntryAcrossDevices(from, dest);
      trashedTo = dest;
    } catch (error) {
      trashError = error.message;
    }
  }
  return { ok: incomplete === 0, from, to, relink, incomplete, trashedTo, trashError };
}

module.exports = {
  discardStagedCopy,
  stageHubCopy,
  relinkAndRetireOldHub,
};
