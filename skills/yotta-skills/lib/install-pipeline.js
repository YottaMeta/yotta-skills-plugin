'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const manifestLib = require('./manifest');
const gateLib = require('./verify-gate');
const lifecycleLib = require('./install-lifecycle');
const healthLib = require('./install-health');
const snapshotLib = require('./install-snapshot');
const hookAdapterLib = require('./hook-adapter');

function nowTag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleepSync(ms) {
  const array = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(array, 0, 0, ms);
}

function renameWithRetry(from, to, options) {
  const rename = (options && options.rename) || fs.renameSync;
  const sleep = (options && options.sleep) || sleepSync;
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return rename(from, to);
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 4) throw error;
      sleep(100 * (attempt + 1));
    }
  }
  throw lastError;
}

function isSafeTarEntry(entry) {
  const value = String(entry || '').replace(/\\/g, '/');
  if (value !== 'package' && !value.startsWith('package/')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return false;
  return !value.split('/').includes('..');
}

function copyTree(src, dst, copyDir) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  copyDir(src, dst);
}

function restoreBackup(target, backup, hadTarget) {
  if (backup && fs.existsSync(backup)) {
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    renameWithRetry(backup, target);
    return true;
  }
  if (!hadTarget && fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  }
  return false;
}

function createInstaller(deps) {
  const homeDir = deps.homeDir || os.homedir();
  const runPhase = deps.runPhase || lifecycleLib.runPhase;
  const checkInstalledSkill = deps.checkInstalledSkill || healthLib.checkInstalledSkill;
  const captureSnapshot = deps.createSnapshot || snapshotLib.createSnapshot;
  const evaluateHook = deps.evaluateHook || hookAdapterLib.evaluateHook;
  const appendHookEvidence = deps.appendHookEvidence || hookAdapterLib.appendHookEvidence;

  function record(entry) {
    return deps.appendEvidence(entry, { homeDir });
  }

  function safeRecord(entry) {
    try {
      return record(entry);
    } catch (_) {
      return null;
    }
  }

  return function installOne(skill, dest, opts) {
    const target = path.join(dest, skill.slug);
    const existingVersion = deps.readInstalledVersion(target);
    if (!opts.force && existingVersion === skill.version) {
      return { skill, status: 'skip', version: existingVersion, note: '已是最新', exitCode: 0 };
    }

    let tmp = null;
    let staged = null;
    let snapshot = null;
    let backup = null;
    const hadTarget = fs.existsSync(target);
    let manifest = null;
    let extracted = null;
    let lifecycle = { setup: null, builtin_doctor: null, doctor: null, rollback: null };
    try {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-skills-'));
      const packDir = path.join(tmp, 'pack');
      fs.mkdirSync(packDir, { recursive: true });
      const packed = deps.runNpmPack(skill, opts, packDir);
      if (packed.error) {
        safeRecord({ event: 'before_install', skill: skill.slug, decision: 'fail', error: packed.error });
        return { skill, status: 'fail', version: null, note: packed.error, exitCode: 1 };
      }

      const extractDir = path.join(tmp, 'extract');
      fs.mkdirSync(extractDir, { recursive: true });
      extracted = deps.extractTarball(packed.tarball, extractDir);
      if (extracted.error) {
        safeRecord({ event: 'before_install', skill: skill.slug, decision: 'fail', error: extracted.error });
        return { skill, status: 'fail', version: packed.resolved, note: extracted.error, exitCode: 1 };
      }

      const resolvedSkill = { ...skill, version: packed.resolved || skill.version };
      const loaded = manifestLib.loadManifest({ pkgDir: extracted.pkgDir, skill: resolvedSkill });
      if (loaded.errors.length > 0) {
        const note = loaded.errors.join('; ');
        safeRecord({ event: 'manifest', skill: skill.slug, decision: 'block', errors: loaded.errors });
        return { skill, status: 'fail', version: packed.resolved, note, exitCode: 6 };
      }
      manifest = loaded.manifest;
      if (manifest.trust !== 'yottameta') {
        safeRecord({
          event: 'manifest',
          skill: skill.slug,
          decision: 'block',
          errors: ['trust 必须为 yottameta'],
        });
        return {
          skill,
          status: 'fail',
          version: packed.resolved,
          note: 'manifest trust 必须为 yottameta',
          exitCode: 6,
        };
      }

      let gate;
      let scan;
      if (opts.skipScan) {
        gate = { ok: true, engine: null, mode: 'explicit-unverified' };
        scan = { decision: 'unverified', verdict: null, counts: null, warn: true, mode: 'explicit-unverified' };
      } else {
        gate = deps.ensureGate({ skill, extracted, dest, opts });
        if (!gate.ok) {
          safeRecord({ event: 'before_install', skill: skill.slug, decision: 'block', error: gate.error });
          return { skill, status: 'fail', version: packed.resolved, note: gate.error, exitCode: 5 };
        }
        const scanResult = deps.scanTarget(gate.engine, extracted.pkgDir);
        if (!scanResult.ok) {
          safeRecord({ event: 'before_install', skill: skill.slug, decision: 'block', error: scanResult.error });
          return { skill, status: 'fail', version: packed.resolved, note: scanResult.error, exitCode: 5 };
        }
        const verdict = gateLib.evaluateVerdict(scanResult.verdict);
        let hookEvaluation = { decision: 'allow', evidence: [], user_message: '无 hook 声明' };
        try {
          hookEvaluation = evaluateHook({
            host: opts.host || 'codex',
            event: 'before_install',
            manifest,
            capabilities: deps.hookCapabilities || hookAdapterLib.capabilitiesForHost(opts.host || 'codex'),
            context: opts.skipScan
              ? { wrapperRegistered: false, checks: {} }
              : {
                  wrapperRegistered: true,
                  checks: {
                    scan_skill: {
                      ok: !verdict.block,
                      evidence: { audit_log: 'install-log.jsonl' },
                    },
                  },
                },
          });
          for (const entry of hookEvaluation.evidence) {
            appendHookEvidence(entry, { homeDir });
          }
        } catch (error) {
          hookEvaluation = {
            decision: 'block',
            evidence: [],
            user_message: 'hook 适配器失败: ' + error.message,
          };
        }
        if (verdict.block || hookEvaluation.decision === 'block') {
          const hookReason = hookEvaluation.decision === 'block'
            ? 'before_install hook 阻断: ' + hookEvaluation.user_message
            : '元信 verdict: ' + scanResult.verdict;
          safeRecord({
            event: 'before_install',
            skill: skill.slug,
            decision: 'block',
            verdict: scanResult.verdict,
            counts: scanResult.counts,
            hook_decision: hookEvaluation.decision,
          });
          return {
            skill,
            status: 'fail',
            version: packed.resolved,
            note: hookReason,
            exitCode: 5,
          };
        }
        scan = {
          decision: verdict.decision,
          verdict: scanResult.verdict,
          counts: scanResult.counts,
          warn: verdict.warn,
        };
      }

      fs.mkdirSync(dest, { recursive: true });
      const stagingRoot = path.join(dest, '.yottaskills-staging');
      fs.mkdirSync(stagingRoot, { recursive: true });
      staged = fs.mkdtempSync(path.join(stagingRoot, skill.slug + '-'));
      copyTree(extracted.pkgDir, staged, deps.copyDir);

      if (fs.existsSync(target)) {
        const captured = captureSnapshot(target, {
          homeDir,
          slug: skill.slug,
          version: existingVersion || 'unknown',
          copyDir: deps.copyDir,
        });
        snapshot = captured.path;
        backup = path.join(dest, '.yottaskills-backup-' + skill.slug + '-' + process.pid);
        renameWithRetry(target, backup);
      }

      renameWithRetry(staged, target);
      staged = null;

      function lifecycleSummary(result) {
        if (!result) return null;
        return {
          ok: !!result.ok,
          skipped: !!result.skipped,
          error: result.error || null,
          result: result.result || null,
        };
      }

      function rollbackAfterFailure(reason, phase) {
        let restoreError = null;
        let rollbackResult = { ok: false, skipped: true, error: null, result: null };
        try {
          restoreBackup(target, backup, hadTarget);
          backup = null;
        } catch (error) {
          restoreError = error.message;
        }
        try {
          const rollbackPhase = runPhase(extracted.pkgDir, manifest, 'rollback', {
            skillDir: target,
            packageDir: extracted.pkgDir,
            dest,
            snapshot,
          });
          if (!rollbackPhase.skipped) rollbackResult = rollbackPhase;
        } catch (error) {
          rollbackResult = { ok: false, skipped: false, error: error.message, result: null };
        }
        lifecycle.rollback = lifecycleSummary(rollbackResult);
        const rollbackError = restoreError || (rollbackResult.ok || rollbackResult.skipped ? null : rollbackResult.error);
        safeRecord({
          event: 'rollback',
          skill: skill.slug,
          package: skill.pkg,
          version: packed.resolved || skill.version,
          decision: rollbackError ? 'fail' : 'ok',
          phase,
          reason,
          restore_error: restoreError,
          rollback_error: rollbackResult.ok || rollbackResult.skipped ? null : rollbackResult.error,
          snapshot,
        });
        return {
          skill,
          status: 'fail',
          version: packed.resolved || skill.version,
          note: reason + (rollbackError ? '；回滚失败: ' + rollbackError : ''),
          exitCode: 1,
          snapshot,
          lifecycle,
          rollback_reason: reason,
        };
      }

      lifecycle.setup = runPhase(extracted.pkgDir, manifest, 'setup', {
        skillDir: target,
        packageDir: extracted.pkgDir,
        dest,
        snapshot,
      });
      if (!lifecycle.setup.ok) {
        return rollbackAfterFailure('setup 失败: ' + lifecycle.setup.error, 'setup');
      }

      lifecycle.builtin_doctor = checkInstalledSkill({
        slug: skill.slug,
        target,
        expectedVersion: packed.resolved || skill.version,
        expectedPackage: skill.pkg,
      });
      if (!lifecycle.builtin_doctor.ok) {
        return rollbackAfterFailure(
          '内置 doctor 失败: ' + lifecycle.builtin_doctor.errors.join('; '),
          'builtin-doctor',
        );
      }

      lifecycle.doctor = runPhase(extracted.pkgDir, manifest, 'doctor', {
        skillDir: target,
        packageDir: extracted.pkgDir,
        dest,
        snapshot,
      });
      if (!lifecycle.doctor.ok) {
        return rollbackAfterFailure('doctor 失败: ' + lifecycle.doctor.error, 'doctor');
      }

      let evidence;
      try {
        evidence = record({
          event: 'before_install',
          skill: skill.slug,
          package: skill.pkg,
          version: packed.resolved || skill.version,
          gate_mode: gate.mode,
          bootstrap_scan: gate.mode === 'trusted-bootstrap' && skill.slug === 'yotta-verify' ? 'self' : null,
          verdict: scan.verdict,
          decision: scan.decision,
          snapshot,
        });
      } catch (error) {
        return rollbackAfterFailure('证据写入失败: ' + error.message, 'evidence');
      }

      safeRecord({
        event: 'after_install',
        skill: skill.slug,
        package: skill.pkg,
        version: packed.resolved || skill.version,
        decision: 'allow',
        snapshot,
        lifecycle: {
          setup: lifecycleSummary(lifecycle.setup),
          builtin_doctor: lifecycleSummary(lifecycle.builtin_doctor),
          doctor: lifecycleSummary(lifecycle.doctor),
        },
      });

      if (backup && fs.existsSync(backup)) {
        try {
          fs.rmSync(backup, { recursive: true, force: true });
        } catch (_) {
          // The new version is already active; a stale backup is safer than a failed install.
        }
        backup = null;
      }

      return {
        skill,
        status: 'ok',
        version: packed.resolved || skill.version,
        note: null,
        gate: { ...scan, mode: gate.mode },
        evidence,
        snapshot,
        lifecycle,
        exitCode: 0,
      };
    } catch (error) {
      restoreBackup(target, backup, hadTarget);
      backup = null;
      safeRecord({ event: 'install', skill: skill.slug, decision: 'fail', error: error.message });
      return { skill, status: 'fail', version: null, note: error.message, exitCode: 1 };
    } finally {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      if (staged) fs.rmSync(staged, { recursive: true, force: true });
    }
  };
}

module.exports = { createInstaller, renameWithRetry, isSafeTarEntry };
