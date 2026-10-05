'use strict';

/**
 * Hub adoption (S2): scan host directories, import external skills into the
 * local Hub, and refresh a Hub entry from an explicit source path.
 */

const fs = require('fs');
const path = require('path');
const scanLib = require('./skills-scan');
const hubLib = require('./hub');
const { copyDir } = require('./copy-tree');

function compareVersions(left, right) {
  const a = String(left || '').split('.').map((part) => parseInt(part, 10) || 0);
  const b = String(right || '').split('.').map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function selectedVariant(variants) {
  return variants.slice().sort((a, b) => {
    const byVersion = compareVersions(b.version, a.version);
    if (byVersion) return byVersion;
    return String(a.host || '').localeCompare(String(b.host || ''));
  })[0] || null;
}

/**
 * 只读扫描用哈希：候选目录不可读（坏链 / 扫描途中被删除）时返回 ok:false，
 * 不抛错——收编预演是只读操作，不应因单个候选异常整体失败。
 */
function safeHashTree(dir) {
  try {
    return { ok: true, hash: hubLib.hashTree(dir), error: null };
  } catch (error) {
    return {
      ok: false,
      hash: null,
      error: error && error.message ? error.message : String(error),
    };
  }
}

function scanCandidates(options) {
  const opts = options || {};
  const hubDir = path.resolve(opts.hubDir);
  const discovery = opts.discovery || { hosts: [] };
  const existing = new Map(hubLib.scanHubSkills(hubDir).map((item) => [item.slug, item]));
  const family = hubLib.familySlugSet(opts.manifest);
  const groups = new Map();
  const skipped = [];

  for (const host of discovery.hosts) {
    if (!host.exists) continue;
    for (const skill of scanLib.scanSkillDir(host.dir)) {
      const hashed = safeHashTree(skill.source_dir);
      if (!hashed.ok) {
        skipped.push({
          slug: skill.slug,
          dir: skill.source_dir,
          host: host.label,
          reason: hashed.error,
        });
        continue;
      }
      const variant = {
        slug: skill.slug,
        version: skill.version || '',
        description: skill.description || '',
        dir: skill.source_dir,
        host: host.label,
        hostDir: host.dir,
        treeHash: hashed.hash,
      };
      const group = groups.get(skill.slug);
      if (group) {
        group.variants.push(variant);
      } else {
        groups.set(skill.slug, {
          slug: skill.slug,
          variants: [variant],
          inHub: existing.has(skill.slug),
        });
      }
    }
  }

  const candidates = [];
  for (const group of groups.values()) {
    const selected = selectedVariant(group.variants);
    const hashes = new Set(group.variants.map((item) => item.treeHash));
    const versions = new Set(group.variants.map((item) => item.version).filter(Boolean));
    candidates.push({
      slug: group.slug,
      version: selected ? selected.version : '',
      description: selected ? selected.description : '',
      source: selected ? selected.dir : null,
      sourceHost: selected ? selected.host : null,
      sourceHostDir: selected ? selected.hostDir : null,
      treeHash: selected ? selected.treeHash : null,
      variants: group.variants,
      inHub: group.inHub,
      conflict: hashes.size > 1 || versions.size > 1,
      standardWarnings: externalStandardWarnings(group.slug, selected, family),
    });
  }
  candidates.sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    generatedAt: new Date().toISOString(),
    hubDir,
    candidates,
    skipped,
    summary: {
      candidates: candidates.length,
      conflicts: candidates.filter((item) => item.conflict).length,
      alreadyInHub: candidates.filter((item) => item.inHub).length,
      skipped: skipped.length,
    },
  };
}

/**
 * 非元技能标准合规只读告警（不影响使用则不处理、不改源文件）。
 * 家族技能不告警（同类问题已由生成器批次修复并受门禁保护）。
 */
function externalStandardWarnings(slug, selected, family) {
  if (!selected || !selected.dir || family.has(slug)) return [];
  try {
    const text = fs.readFileSync(path.join(selected.dir, 'SKILL.md'), 'utf8');
    return scanLib.strictFrontmatterWarnings(text);
  } catch (_) {
    return [];
  }
}

function includeMatch(slug, include) {
  if (!Array.isArray(include) || include.length === 0) return true;
  return include.includes(slug);
}

function replaceWithBackup(target, options) {
  const opts = options || {};
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    hubLib.removeDirLink(target);
    return null;
  }
  if (!opts.force) throw new Error('目标已存在真目录；如需替换请显式加 --force');
  const backup = target + '.yottaskills-backup-' + Date.now();
  fs.renameSync(target, backup);
  return backup;
}

function copyFidelity(sourceDir, targetDir) {
  const tmp = targetDir + '.yottaskills-import-' + process.pid + '-' + Date.now();
  fs.mkdirSync(tmp, { recursive: true });
  copyDir(sourceDir, tmp, new Set(), true);
  if (!fs.existsSync(path.join(tmp, 'SKILL.md'))) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error('来源目录缺少 SKILL.md');
  }
  return tmp;
}

function persistImportMeta(hubDir, slug, meta) {
  const state = hubLib.readHubState(hubDir);
  const record = state.skills[slug];
  if (!record) return;
  Object.assign(record, meta, { updatedAt: new Date().toISOString() });
  hubLib.writeHubState(hubDir, state);
}

function applyCandidates(options) {
  const opts = options || {};
  const hubDir = path.resolve(opts.hubDir);
  const candidates = opts.candidates || [];
  const include = opts.include || [];
  const results = [];
  fs.mkdirSync(hubDir, { recursive: true });

  for (const candidate of candidates) {
    if (!includeMatch(candidate.slug, include)) continue;
    if (candidate.inHub && !opts.force) {
      results.push({ slug: candidate.slug, status: 'skip', note: 'Hub 已存在；如需覆盖请显式加 --force' });
      continue;
    }
    if (candidate.conflict && !opts.force) {
      results.push({
        slug: candidate.slug,
        status: 'conflict',
        note: '多宿主副本版本 / 哈希不一致；请先人工确认或用 --force 选定代表副本',
      });
      continue;
    }
    if (!candidate.source) {
      results.push({ slug: candidate.slug, status: 'error', note: '没有可收编的来源目录' });
      continue;
    }
    const target = path.join(hubDir, candidate.slug);
    let scan = { ok: true, verdict: 'explicit-unverified', counts: null };
    if (!opts.skipScan) {
      if (typeof opts.scan !== 'function') {
        results.push({ slug: candidate.slug, status: 'blocked', note: '未提供元信扫描通道；如确认可加 --allow-unverified' });
        continue;
      }
      scan = opts.scan(candidate.source, candidate);
      if (!scan.ok) {
        results.push({ slug: candidate.slug, status: 'blocked', note: scan.error || '扫描失败' });
        continue;
      }
      if (scan.block && !opts.allowUnverified) {
        results.push({ slug: candidate.slug, status: 'blocked', note: '元信 verdict: ' + scan.verdict });
        continue;
      }
    }
    let backup = null;
    let tmp = null;
    try {
      backup = replaceWithBackup(target, { force: opts.force });
      if (opts.inPlace) {
        hubLib.createDirLink(candidate.source, target);
      } else {
        tmp = copyFidelity(candidate.source, target);
        fs.renameSync(tmp, target);
        tmp = null;
      }
      results.push({
        slug: candidate.slug,
        status: 'imported',
        note: opts.inPlace ? '已原地登记并链接到 Hub' : '已复制到 Hub',
        backup,
        scanVerdict: scan.verdict,
        sourcePath: candidate.source,
        sourceAgent: candidate.sourceHost,
      });
      hubLib.appendAudit(hubDir, {
        event: 'adopt',
        slug: candidate.slug,
        source: candidate.source,
        sourceHost: candidate.sourceHost,
        inPlace: Boolean(opts.inPlace),
        verdict: scan.verdict,
        backup,
      });
    } catch (error) {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      results.push({ slug: candidate.slug, status: 'error', note: error.message });
    }
  }
  const synced = hubLib.syncHubState(hubDir, { manifest: opts.manifest, homeDir: opts.homeDir, env: opts.env });
  for (const item of results) {
    if (item.status !== 'imported') continue;
    persistImportMeta(hubDir, item.slug, {
      origin: 'external',
      sourcePath: item.sourcePath,
      sourceAgent: item.sourceAgent,
      scanVerdict: item.scanVerdict,
      inPlace: Boolean(opts.inPlace),
    });
  }
  return { hubDir, results, state: synced.state };
}

function refreshFrom(options) {
  const opts = options || {};
  const hubDir = path.resolve(opts.hubDir);
  const slug = opts.slug;
  const source = path.resolve(opts.from);
  const target = path.join(hubDir, slug);
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) {
    return { ok: false, slug, error: '来源目录缺少 SKILL.md: ' + source };
  }
  let scan = { ok: true, verdict: 'explicit-unverified', counts: null };
  if (!opts.skipScan) {
    if (typeof opts.scan !== 'function') {
      return { ok: false, slug, error: '未提供元信扫描通道；如确认可加 --allow-unverified' };
    }
    scan = opts.scan(source, { slug });
    if (!scan.ok) return { ok: false, slug, error: scan.error || '扫描失败' };
    if (scan.block && !opts.allowUnverified) return { ok: false, slug, error: '元信 verdict: ' + scan.verdict };
  }
  let backup = null;
  let tmp = null;
  try {
    backup = replaceWithBackup(target, { force: true });
    tmp = copyFidelity(source, target);
    fs.renameSync(tmp, target);
    tmp = null;
    hubLib.syncHubState(hubDir, { manifest: opts.manifest, homeDir: opts.homeDir, env: opts.env });
    persistImportMeta(hubDir, slug, {
      sourcePath: source,
      scanVerdict: scan.verdict,
      updatedAt: new Date().toISOString(),
    });
    hubLib.appendAudit(hubDir, { event: 'refresh', slug, source, verdict: scan.verdict, backup });
    return { ok: true, slug, source, backup, verdict: scan.verdict, scanPolicy: scan.policy || null };
  } catch (error) {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: false, slug, error: error.message };
  }
}

module.exports = {
  compareVersions,
  safeHashTree,
  scanCandidates,
  applyCandidates,
  refreshFrom,
};
