'use strict';
const fs = require('fs');
const path = require('path');
const trusted = require('./trusted-verifier');

const SAFE = 'SAFE TO INSTALL';
const CAUTION = 'INSTALL WITH CAUTION';
const REVIEW = 'REVIEW REQUIRED';
const BLOCK = 'DO NOT INSTALL';

/** 用户显式指定的引擎（人工可信，不做身份判定）。 */
function explicitCandidates(opts) {
  const candidates = [];
  if (opts && opts.verify) candidates.push(path.resolve(opts.verify));
  if (process.env.YOTTA_SKILLS_VERIFY) candidates.push(path.resolve(process.env.YOTTA_SKILLS_VERIFY));
  return candidates;
}

/**
 * 定位元信扫描引擎（v0.19.13 收紧）。
 *
 * 旧实现会读本地注册表里 slug=yotta-verify 的 source_dirs，而注册表身份来自被扫描技能
 * 自己 SKILL.md frontmatter 的 name —— 伪造目录即可劫持校验器（执行任意代码 + 伪造
 * SAFE 结论）。现只认两类来源：
 *   ① 用户显式指定：--verify / YOTTA_SKILLS_VERIFY；
 *   ② 安装管线写入的受信记录：包身份（slug / package / trust / 版本）+ 路径 realpath
 *      + 引擎 SHA-256 与记录一致。
 * 其余一律返回 null（fail-closed），由上层走自举安装。
 */
function findVerifier(context) {
  const ctx = context || {};
  for (const candidate of explicitCandidates(ctx.opts || {})) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_) {
      // Try the next candidate.
    }
  }
  const record = ctx.trustedVerifier;
  if (record && record.path) {
    const check = trusted.verifyEngine(record.path, { record });
    if (check.ok) return check.path;
  }
  return null;
}

function parseScanOutput(stdout) {
  try {
    const value = JSON.parse(String(stdout || ''));
    if (!value || typeof value.verdict !== 'string') {
      return { ok: false, verdict: null, counts: null, error: '扫描输出缺少 verdict' };
    }
    return { ok: true, verdict: value.verdict, counts: value.counts || {}, error: null };
  } catch (error) {
    return { ok: false, verdict: null, counts: null, error: error.message };
  }
}

function evaluateVerdict(verdict) {
  if (verdict === SAFE) return { decision: 'allow', block: false, warn: false };
  if (verdict === CAUTION || verdict === REVIEW) return { decision: 'warn', block: false, warn: true };
  return { decision: 'block', block: true, warn: true };
}

function runVerifier(engine, target, options) {
  const result = options.spawnSync(options.python, ['-B', engine, 'scan', target, '--json'], {
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result && result.error) {
    return { ok: false, verdict: null, counts: null, error: result.error.message, exitCode: null };
  }
  if (!result || result.status === null) {
    return { ok: false, verdict: null, counts: null, error: '元信 scan 执行失败', exitCode: null };
  }
  const parsed = parseScanOutput(result.stdout);
  if (!parsed.ok) {
    return { ok: false, verdict: null, counts: null, error: parsed.error, exitCode: result.status };
  }
  return { ok: true, verdict: parsed.verdict, counts: parsed.counts, error: null, exitCode: result.status };
}

module.exports = {
  SAFE,
  CAUTION,
  REVIEW,
  BLOCK,
  explicitCandidates,
  findVerifier,
  parseScanOutput,
  evaluateVerdict,
  runVerifier,
};
