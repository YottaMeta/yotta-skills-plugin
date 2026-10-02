'use strict';

/**
 * YottaSkills Hub local panel server (yotta-skills view).
 *
 * Loopback-only HTTP server that wraps the existing Hub libraries. No parallel
 * state: every payload comes from hub / hub-adopt / snapshots / evidence and
 * every write goes through the same functions the CLI uses, so the panel and
 * the CLI share one ledger.
 *
 * Security shell: Host + Origin validation, strict CSP, no-store, noindex,
 * session token required for write requests, body-size cap, serialized writes,
 * destructive confirm strings.
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const hubLib = require('./hub');
const hubAdoptLib = require('./hub-adopt');
const hubScanLib = require('./hub-scan');
const discoveryLib = require('./agent-discovery');
const snapshotLib = require('./install-snapshot');
const evidenceLib = require('./install-evidence');
const healthLib = require('./install-health');
const scanLib = require('./skills-scan');
const routeLib = require('./route');
const routeFeaturesLib = require('./route-features');
const routeDynamicLib = require('./route-dynamic');
const providerLib = require('./provider');
const usageLib = require('./usage-journal');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8789;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_JSONL_BYTES = 2 * 1024 * 1024;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const TOKEN_HEADER = 'x-yotta-view-token';
const TOKEN_PLACEHOLDER = '__YOTTA_VIEW_TOKEN__';
const CONFIRM = { unlink: 'unlink', rollback: 'rollback' };
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function nowIso() {
  return new Date().toISOString();
}

function normalizeDir(dir) {
  const resolved = path.resolve(dir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameDir(left, right) {
  return normalizeDir(left) === normalizeDir(right);
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function viewHostName(req) {
  const raw = String(req.headers.host || '').trim();
  if (!raw) return '';
  try {
    return new URL('http://' + raw).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch (_) {
    return '';
  }
}

function viewHostAllowed(req, bindHost) {
  const name = viewHostName(req);
  if (!name) return false;
  const bind = String(bindHost || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (bind !== '127.0.0.1' && bind !== 'localhost' && bind !== '::1') return true;
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

function viewOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let originHost = '';
  try {
    originHost = new URL(String(origin)).host.toLowerCase();
  } catch (_) {
    return false;
  }
  const requestHost = String(req.headers.host || '').trim().toLowerCase();
  return Boolean(requestHost) && originHost === requestHost;
}

function viewFetchSiteAllowed(req) {
  const site = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
  if (!site) return true;
  return site === 'same-origin' || site === 'none';
}

function readJsonlTail(file, limit) {
  const maxItems = Math.max(1, Math.min(MAX_LIMIT, limit || DEFAULT_LIMIT));
  const result = { path: file, entries: [], invalid: 0, truncated: false };
  let text = '';
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - MAX_JSONL_BYTES);
    result.truncated = start > 0;
    const fd = fs.openSync(file, 'r');
    try {
      const length = stat.size - start;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      text = buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return result;
  }
  if (result.truncated) {
    const firstBreak = text.indexOf('\n');
    text = firstBreak >= 0 ? text.slice(firstBreak + 1) : '';
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  for (const line of lines) {
    try {
      result.entries.push(JSON.parse(line));
    } catch (_) {
      result.invalid += 1;
    }
  }
  if (result.entries.length > maxItems) {
    result.entries = result.entries.slice(result.entries.length - maxItems);
  }
  return result;
}

function hubAuditPath(hubDir) {
  return hubLib.hubPaths(hubDir).audit;
}

function discovery(ctx) {
  return discoveryLib.discoverHosts({ homeDir: ctx.homeDir, env: ctx.env });
}

function scanEngineInfo(ctx, found) {
  const engine = hubScanLib.scanEngineForHub(ctx.hubDir, found, { python: ctx.python, verify: ctx.verify });
  if (!engine) return { available: false, path: null };
  return { available: true, path: engine.path || engine.engine || null };
}

function overviewPayload(ctx) {
  const status = hubLib.status({ hubDir: ctx.hubDir, manifest: ctx.manifest, homeDir: ctx.homeDir, env: ctx.env });
  const doctor = hubLib.doctor({ hubDir: ctx.hubDir, manifest: ctx.manifest, homeDir: ctx.homeDir, env: ctx.env });
  const audit = readJsonlTail(hubAuditPath(ctx.hubDir), 8);
  return {
    version: ctx.version,
    hubDir: ctx.hubDir,
    standard: hubLib.STANDARD_ID,
    generatedAt: nowIso(),
    status: {
      summary: status.summary,
      skills: status.skills.map((skill) => ({
        slug: skill.slug,
        version: skill.version,
        origin: skill.origin,
        status: skill.status,
        source: skill.source,
        sourceType: skill.sourceType,
        scanVerdict: skill.scanVerdict,
        links: skill.links.map((link) => ({ dir: link.dir, label: link.label, status: link.status })),
      })),
    },
    doctor: { ok: doctor.ok, summary: doctor.summary, checks: doctor.checks },
    audit: { count: audit.entries.length, recent: audit.entries, invalid: audit.invalid },
  };
}

function hostsPayload(ctx) {
  const found = discovery(ctx);
  const links = hubLib.linkStatus(ctx.hubDir);
  const hubSkills = hubLib.scanHubSkills(ctx.hubDir).map((skill) => ({
    slug: skill.slug,
    version: skill.version,
    description: skill.description,
    slugMismatch: skill.slugMismatch,
  }));
  const hosts = found.hosts.map((host) => {
    const hostLinks = links.filter((link) => sameDir(link.dir, host.dir));
    return {
      ...host,
      hubLinks: hostLinks.filter((link) => link.status === 'ok').length,
      brokenLinks: hostLinks.filter((link) => link.status !== 'ok').length,
    };
  });
  return {
    generatedAt: found.generatedAt,
    hubDir: ctx.hubDir,
    standard: hubLib.STANDARD_ID,
    hosts,
    installed: found.installed,
    links,
    hubSkills,
    summary: {
      hosts: hosts.length,
      existing: hosts.filter((host) => host.exists).length,
      installedMarks: found.installed.length,
      links: links.length,
      brokenLinks: links.filter((link) => link.status !== 'ok').length,
    },
  };
}

function adoptScanPayload(ctx) {
  const found = discovery(ctx);
  const scan = hubAdoptLib.scanCandidates({ hubDir: ctx.hubDir, discovery: found });
  return { ...scan, scan: scanEngineInfo(ctx, found) };
}

function linksPayload(ctx) {
  const links = hubLib.linkStatus(ctx.hubDir);
  return {
    hubDir: ctx.hubDir,
    standard: hubLib.STANDARD_ID,
    links,
    summary: {
      links: links.length,
      ok: links.filter((link) => link.status === 'ok').length,
      broken: links.filter((link) => link.status !== 'ok').length,
    },
  };
}

function linkPlanPayload(ctx, targetDir) {
  const found = discovery(ctx);
  const host = found.hosts.find((item) => sameDir(item.dir, targetDir));
  if (!host) {
    return { error: '目标目录不在已发现的宿主目录中；请先在宿主矩阵中确认该目录。', code: 400 };
  }
  const result = hubLib.linkSkills({ hubDir: ctx.hubDir, targetDir: host.dir, dryRun: true });
  return { hubDir: ctx.hubDir, label: host.label, targetDir: host.dir, results: result.results };
}

function recordsPayload(ctx, limit) {
  const evidencePath = evidenceLib.evidencePath({ homeDir: ctx.homeDir });
  const auditPath = hubAuditPath(ctx.hubDir);
  const snapshots = snapshotLib.listSnapshots(ctx.homeDir);
  const maxItems = Math.max(1, Math.min(MAX_LIMIT, limit || DEFAULT_LIMIT));
  return {
    hubDir: ctx.hubDir,
    evidence: readJsonlTail(evidencePath, maxItems),
    audit: readJsonlTail(auditPath, maxItems),
    snapshots: snapshots.slice(0, maxItems),
  };
}

function rollbackListPayload(ctx, limit) {
  const snapshots = snapshotLib.listSnapshots(ctx.homeDir);
  const maxItems = Math.max(1, Math.min(MAX_LIMIT, limit || DEFAULT_LIMIT));
  return {
    ok: true,
    count: snapshots.filter((row) => row.valid).length,
    snapshots: snapshots.slice(0, maxItems),
  };
}

function routePayload(ctx, request) {
  const registry = scanLib.readRegistry();
  const yottaSlugs = new Set([...routeLib.defaultYottaSlugs(), ...(ctx.manifest || []).map((s) => s.slug)]);
  const result = routeLib.routeRequest(request, { registry, yottaSlugs });
  try {
    const usage = usageLib.readUsage();
    const payload = routeFeaturesLib.buildRouteFeatures({
      request,
      registry,
      staticResult: result,
      usage,
      playbooks: routeLib.PLAYBOOKS,
    });
    const run = providerLib.runCapability('o1.route', payload);
    result.dynamic = (run.status === 'active' && run.data && typeof run.data === 'object')
      ? routeDynamicLib.applyDynamicData(result, run.data, registry, { providerId: run.provider_id })
      : routeDynamicLib.dynamicBlock(run.status, run.provider_id, run.note || run.message || '');
  } catch (error) {
    result.dynamic = routeDynamicLib.dynamicBlock('error', '', '动态路由装载失败：' + error.message);
  }
  return result;
}

function slugList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const slug = String(item || '').trim().toLowerCase();
    if (!slug) continue;
    if (!SLUG_RE.test(slug)) return { error: '技能 slug 非法: ' + slug };
    if (!out.includes(slug)) out.push(slug);
  }
  return out;
}

function restoreFromSnapshot(ctx, slug, snapshotPath) {
  const root = snapshotLib.snapshotRoot(ctx.homeDir, slug);
  if (!isInside(root, snapshotPath)) {
    return { error: '快照路径不在该技能的快照目录内，已拒绝。', code: 400 };
  }
  const validation = snapshotLib.validateSnapshot(snapshotPath);
  if (!validation.ok) return { error: '快照不可用: ' + (validation.reason || '未知原因'), code: 400 };
  const source = validation.source;
  if (!source || !path.isAbsolute(source)) {
    return { error: '快照缺少安装来源路径（旧版快照），请改用 CLI rollback --dir <技能目录>。', code: 400 };
  }
  if (isInside(path.join(ctx.homeDir, '.yottaskills', 'snapshots'), source)) {
    return { error: '快照记录的来源路径异常（指向快照区），已拒绝。', code: 400 };
  }
  const restored = snapshotLib.restoreSnapshot(snapshotPath, source);
  if (!restored.ok) return { error: restored.error || '恢复失败', code: 500 };
  const family = (ctx.manifest || []).find((item) => item.slug === slug) || null;
  let doctor = null;
  try {
    doctor = healthLib.checkInstalledSkill({
      slug,
      target: source,
      expectedVersion: restored.version && restored.version !== 'unknown' ? restored.version : null,
      expectedPackage: family ? family.pkg : null,
      registry: scanLib.readRegistry(),
    });
  } catch (error) {
    doctor = { ok: false, errors: ['恢复后体检失败: ' + error.message], warnings: [], fixes: [] };
  }
  try {
    evidenceLib.appendEvidence({
      event: 'rollback',
      skill: slug,
      package: family ? family.pkg : null,
      version: restored.version,
      decision: doctor && doctor.ok ? 'ok' : 'fail',
      snapshot: snapshotPath,
      source,
      via: 'view',
    }, { homeDir: ctx.homeDir });
  } catch (error) {
    doctor = Object.assign({}, doctor || {}, { ok: false });
    doctor.errors = (doctor.errors || []).concat('回滚证据写入失败: ' + error.message);
  }
  return {
    ok: Boolean(doctor && doctor.ok),
    slug,
    version: restored.version,
    snapshot: snapshotPath,
    source,
    doctor,
  };
}

function writeAdopt(ctx, body) {
  if (body.skipScan || body.allowUnverified) {
    return {
      code: 400,
      payload: { error: '面板不提供跳过 / 降级元信扫描；如已确认风险，请使用 CLI：yotta-skills hub adopt --apply --include <slug> --skip-scan（或 --allow-unverified）' },
    };
  }
  const found = discovery(ctx);
  const include = slugList(body.include);
  if (include.error) return { code: 400, payload: { error: include.error } };
  const scanResult = hubAdoptLib.scanCandidates({ hubDir: ctx.hubDir, discovery: found });
  const payload = hubAdoptLib.applyCandidates({
    hubDir: ctx.hubDir,
    candidates: scanResult.candidates,
    include,
    force: Boolean(body.force),
    inPlace: Boolean(body.inPlace),
    skipScan: false,
    allowUnverified: false,
    manifest: ctx.manifest,
    homeDir: ctx.homeDir,
    env: ctx.env,
    scan: (skillDir) => (typeof ctx.scanSkill === 'function'
      ? ctx.scanSkill(skillDir, found, { skipScan: false })
      : hubScanLib.hubScanSkill(ctx.hubDir, found, { python: ctx.python, verify: ctx.verify }, skillDir)),
  });
  const summary = {
    imported: payload.results.filter((item) => item.status === 'imported').length,
    blocked: payload.results.filter((item) => item.status === 'blocked').length,
    conflict: payload.results.filter((item) => item.status === 'conflict').length,
    skipped: payload.results.filter((item) => item.status === 'skip').length,
    error: payload.results.filter((item) => item.status === 'error').length,
  };
  return { code: 200, payload: { ...payload, summary } };
}

function writeLink(ctx, body) {
  const found = discovery(ctx);
  const targetDir = String(body.targetDir || '');
  const host = found.hosts.find((item) => sameDir(item.dir, targetDir));
  if (!host) return { code: 400, payload: { error: '目标目录不在已发现的宿主目录中。' } };
  if (body.force) {
    return {
      code: 400,
      payload: { error: '面板 v1 不执行强制覆盖（--force）；如需备份并替换同名真目录，请使用 CLI：yotta-skills hub link --dir <目录> --force' },
    };
  }
  const slugs = slugList(body.slugs);
  if (slugs.error) return { code: 400, payload: { error: slugs.error } };
  const result = hubLib.linkSkills({
    hubDir: ctx.hubDir,
    targetDir: host.dir,
    agentId: host.agentId,
    label: host.label,
    slugs,
    dryRun: false,
    force: false,
  });
  const failed = result.results.filter((item) => item.status === 'error').length;
  return { code: failed ? 500 : 200, payload: { ...result, label: host.label, failed } };
}

function writeUnlink(ctx, body) {
  if (String(body.confirm || '') !== CONFIRM.unlink) {
    return { code: 400, payload: { error: '破坏性操作确认不匹配；请确认后再执行。' } };
  }
  const found = discovery(ctx);
  const targetDir = String(body.targetDir || '');
  const host = found.hosts.find((item) => sameDir(item.dir, targetDir));
  if (!host) return { code: 400, payload: { error: '目标目录不在已发现的宿主目录中。' } };
  const slugs = slugList(body.slugs);
  if (slugs.error) return { code: 400, payload: { error: slugs.error } };
  const result = hubLib.unlinkSkills({ hubDir: ctx.hubDir, targetDir: host.dir, slugs, dryRun: false });
  const failed = result.results.filter((item) => item.status === 'error').length;
  return { code: failed ? 500 : 200, payload: { ...result, label: host.label, failed } };
}

function writeRollback(ctx, body) {
  if (String(body.confirm || '') !== CONFIRM.rollback) {
    return { code: 400, payload: { error: '破坏性操作确认不匹配；请确认后再执行。' } };
  }
  const slug = String(body.slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return { code: 400, payload: { error: '技能 slug 非法。' } };
  const snapshot = String(body.snapshot || '').trim();
  if (!snapshot) return { code: 400, payload: { error: '缺少快照路径。' } };
  const result = restoreFromSnapshot(ctx, slug, snapshot);
  return { code: result.error ? (result.code || 400) : 200, payload: result };
}

function json(res, code, value) {
  if (res.writableEnded) return;
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(value));
}

function text(res, code, value) {
  if (res.writableEnded) return;
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(value);
}

function htmlResponse(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  res.end(html);
}

function renderHtml(source, token) {
  const html = String(source || '');
  const meta = '<meta name="yotta-view-token" content="' + token + '">';
  if (html.includes(TOKEN_PLACEHOLDER)) return html.split(TOKEN_PLACEHOLDER).join(token);
  if (html.includes('</head>')) return html.replace('</head>', meta + '</head>');
  return meta + html;
}

function tokenAllowed(req, token) {
  const provided = String(req.headers[TOKEN_HEADER] || '');
  if (!provided || !token) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req, cb) {
  let size = 0;
  let tooLarge = false;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooLarge) return cb({ tooLarge: true });
    let parsed = {};
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch (_) {
      return cb({ invalid: true });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return cb({ invalid: true });
    cb({ body: parsed });
  });
  req.on('error', () => cb({ invalid: true }));
}

function queryLimit(url) {
  const raw = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, raw);
}

function handleGet(ctx, pathname, url, res) {
  if (pathname === '/api/status') {
    return json(res, 200, {
      ok: true,
      version: ctx.version,
      hubDir: ctx.hubDir,
      standard: hubLib.STANDARD_ID,
      host: ctx.bindHost,
    });
  }
  if (pathname === '/api/overview') return json(res, 200, overviewPayload(ctx));
  if (pathname === '/api/hosts') return json(res, 200, hostsPayload(ctx));
  if (pathname === '/api/adopt/scan') return json(res, 200, adoptScanPayload(ctx));
  if (pathname === '/api/links') return json(res, 200, linksPayload(ctx));
  if (pathname === '/api/links/plan') {
    const target = url.searchParams.get('dir') || '';
    if (!target) return json(res, 400, { error: '缺少 dir 参数（目标宿主目录）。' });
    const payload = linkPlanPayload(ctx, target);
    return json(res, payload.error ? payload.code || 400 : 200, payload);
  }
  if (pathname === '/api/doctor') {
    return json(res, 200, hubLib.doctor({ hubDir: ctx.hubDir, manifest: ctx.manifest, homeDir: ctx.homeDir, env: ctx.env }));
  }
  if (pathname === '/api/records') return json(res, 200, recordsPayload(ctx, queryLimit(url)));
  if (pathname === '/api/rollback/list') return json(res, 200, rollbackListPayload(ctx, queryLimit(url)));
  if (pathname === '/api/route') {
    const request = String(url.searchParams.get('request') || '').trim();
    if (!request) return json(res, 400, { error: '缺少 request 参数（需求摘要）。' });
    return json(res, 200, routePayload(ctx, request));
  }
  return json(res, 404, { error: 'not found' });
}

function handlePost(ctx, pathname, req, res) {
  return readBody(req, (parsed) => {
    if (parsed.tooLarge) return json(res, 413, { error: '请求体过大。' });
    if (parsed.invalid) return json(res, 400, { error: '请求体必须是 JSON 对象。' });
    const body = parsed.body || {};
    const run = () => {
      if (pathname === '/api/adopt/apply') return writeAdopt(ctx, body);
      if (pathname === '/api/links/apply') return writeLink(ctx, body);
      if (pathname === '/api/links/remove') return writeUnlink(ctx, body);
      if (pathname === '/api/rollback/apply') return writeRollback(ctx, body);
      return { code: 404, payload: { error: 'not found' } };
    };
    ctx.queue(run)
      .then((result) => json(res, result.code || 200, result.payload))
      .catch((error) => json(res, 500, { error: error && error.message ? error.message : String(error) }));
  });
}

function createHubViewServer(options) {
  const opts = options || {};
  const bindHost = opts.host || DEFAULT_HOST;
  const requestedToken = opts.token || crypto.randomBytes(24).toString('base64url');
  const token = /^[A-Za-z0-9_-]{8,128}$/.test(requestedToken) ? requestedToken : crypto.randomBytes(24).toString('base64url');
  const html = renderHtml(opts.html, token);
  let chain = Promise.resolve();
  const ctx = {
    hubDir: path.resolve(opts.hubDir || hubLib.resolveHubDir({})),
    homeDir: opts.homeDir || os.homedir(),
    env: opts.env || process.env,
    manifest: opts.manifest || [],
    version: opts.version || '',
    python: opts.python || null,
    verify: opts.verify || null,
    scanSkill: opts.scanSkill || null,
    bindHost,
    queue(task) {
      const run = chain.then(task, task);
      chain = run.catch(() => {});
      return run;
    },
  };
  const server = http.createServer((req, res) => {
    if (!viewHostAllowed(req, bindHost) || !viewOriginAllowed(req) || !viewFetchSiteAllowed(req)) {
      return text(res, 403, 'forbidden');
    }
    let url;
    try {
      url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    } catch (_) {
      return text(res, 400, 'bad request');
    }
    const pathname = url.pathname;
    if (req.method === 'GET' && pathname === '/') return htmlResponse(res, html);
    if (pathname.startsWith('/api/')) {
      if (req.method === 'GET') {
        try {
          return handleGet(ctx, pathname, url, res);
        } catch (error) {
          return json(res, 500, { error: error && error.message ? error.message : String(error) });
        }
      }
      if (req.method === 'POST') {
        if (!tokenAllowed(req, token)) return json(res, 403, { error: '写操作需要有效的本机会话令牌；请从 yotta-skills view 页面操作。' });
        return handlePost(ctx, pathname, req, res);
      }
      return json(res, 405, { error: 'method not allowed' });
    }
    return text(res, 404, 'not found');
  });
  server.on('error', (error) => {
    if (typeof opts.onError === 'function') {
      opts.onError(error);
      return;
    }
    const message = 'yotta-skills view 启动失败: ' + (error && error.message ? error.message : String(error));
    console.error(message);
  });
  return {
    server,
    token,
    host: bindHost,
    hubDir: ctx.hubDir,
    listen(port, host, cb) {
      const targetHost = host || bindHost;
      const targetPort = port === undefined || port === null ? (opts.port || DEFAULT_PORT) : port;
      return server.listen(targetPort, targetHost, cb);
    },
    close() {
      return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      });
    },
  };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  TOKEN_HEADER,
  TOKEN_PLACEHOLDER,
  CONFIRM,
  createHubViewServer,
  readJsonlTail,
  viewHostAllowed,
  viewOriginAllowed,
};
