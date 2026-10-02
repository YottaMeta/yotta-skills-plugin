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
 *   npx -y @yottameta/yotta-skills update --check         # 只读检查更新（联网对 npm 最新，不改动；退出码 0/3/1）
 *   npx -y @yottameta/yotta-skills update --check --scheduled  # 后台周检（未到期不联网，到期单次检查并写缓存）
 *   npx -y @yottameta/yotta-skills update --auto          # 检查到家族更新后自动更新（仅 yotta-* 家族，含装前扫描）
 *   npx -y @yottameta/yotta-skills hook capabilities      # 查看宿主六事件能力矩阵
 *   npx -y @yottameta/yotta-skills hook evaluate --event before_send --manifest <file>  # 评估并留证
 *   npx -y @yottameta/yotta-skills --dry-run              # 预览将安装清单（不联网、不改动）
 *
 * 版本策略：默认 `--pin` 锁死清单精确版本（可复现，不静默跟随浮动版本）；`--range` 才跟随同 major 最新 patch。
 * 依赖：Node.js 18+（必需）；npm / 系统 tar 仅作回退通道（内置拉包 / 内置解包为主）；
 *       元信 scan 需要 Python 3.8+（可 --python / YOTTA_SKILLS_PYTHON 指向宿主自带 Python）。
 * 边界：只做「清单 + 下载 + 落位 + 汇总」；不内置任何技能本体；不 -g 污染。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const http = require('http');
const https = require('https');
const evidenceLib = require('../lib/install-evidence');
const gateLib = require('../lib/verify-gate');
const trustedVerifierLib = require('../lib/trusted-verifier');
const healthLib = require('../lib/install-health');
const lifecycleLib = require('../lib/install-lifecycle');
const snapshotLib = require('../lib/install-snapshot');
const updateCheckLib = require('../lib/update-check');
const hookAdapterLib = require('../lib/hook-adapter');
const scanPolicyLib = require('../lib/scan-policy');
const npmPackLib = require('../lib/npm-pack');
const usageJournalLib = require('../lib/usage-journal');
const m1FeaturesLib = require('../lib/m1-features');
const routeFeaturesLib = require('../lib/route-features');
const routeDynamicLib = require('../lib/route-dynamic');
const depsLib = require('../lib/deps');
const untarLib = require('../lib/untar');
const registryFetchLib = require('../lib/registry-fetch');
const agentDirsLib = require('../lib/agent-dirs');
const agentDiscoveryLib = require('../lib/agent-discovery');
const hubLib = require('../lib/hub');
const hubAdoptLib = require('../lib/hub-adopt');
const hubScanLib = require('../lib/hub-scan');
const hubViewServerLib = require('../lib/hub-view-server');
const { createInstaller, isSafeTarEntry } = require('../lib/install-pipeline');
const { COPY_SKIP, copyDir } = require('../lib/copy-tree');

const PKG_ROOT = path.join(__dirname, '..');
let VERSION = '0.26.0';
try { VERSION = require(path.join(PKG_ROOT, 'package.json')).version; } catch (_) { /* keep fallback */ }

// @generated view-html:start
const VIEW_HTML = "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"robots\" content=\"noindex,nofollow\">\n<meta name=\"yotta-view-token\" content=\"__YOTTA_VIEW_TOKEN__\">\n<link rel=\"icon\" href=\"data:,\">\n<title>元阁 · 技能枢纽</title>\n<style>\n  :root{--bg:#0d1114;--bg2:#12171b;--panel:#171d22;--panel2:#1d242a;--line:rgba(148,190,170,.14);--line2:rgba(148,190,170,.28);\n    --text:#e9efe9;--muted:#9aa8a0;--faint:#6d7b74;--acc:#5fbf8f;--acc-ink:#0d1a13;--warn:#e0b263;--danger:#e07a7a;--info:#8fb4de;\n    --shadow:0 10px 28px rgba(0,0,0,.35)}\n  body.light{--bg:#f2f5f1;--bg2:#e9efea;--panel:#ffffff;--panel2:#f6f9f5;--line:rgba(24,58,44,.12);--line2:rgba(24,58,44,.24);\n    --text:#17211c;--muted:#5c6b63;--faint:#86958c;--acc:#2f7d59;--acc-ink:#ffffff;--warn:#9a6a14;--danger:#b23c3c;--info:#3c6ea5;\n    --shadow:0 8px 22px rgba(24,58,44,.08)}\n  *{box-sizing:border-box}[hidden]{display:none!important}\n  html,body{margin:0;padding:0}\n  body{background:var(--bg);color:var(--text);font:14px/1.6 \"Microsoft YaHei\",\"PingFang SC\",\"Noto Sans CJK SC\",system-ui,sans-serif;letter-spacing:0}\n  button{font:inherit;color:inherit;cursor:pointer}\n  input,textarea{font:inherit;color:var(--text);background:var(--panel2);border:1px solid var(--line2);border-radius:6px;padding:8px 11px;outline:0;width:100%}\n  input:focus,textarea:focus{border-color:var(--acc)}\n  textarea{min-height:76px;resize:vertical}\n  code,kbd{font-family:ui-monospace,Consolas,\"Courier New\",monospace;font-size:12px}\n  .sv{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}\n\n  .shell{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100vh}\n  .sidebar{background:var(--bg2);border-right:1px solid var(--line);padding:20px 14px;display:flex;flex-direction:column;gap:20px;position:sticky;top:0;height:100vh;min-width:0}\n  .brand{display:flex;align-items:center;gap:10px;padding:0 6px}\n  .brand-mark{width:34px;height:34px;border-radius:8px;background:rgba(95,191,143,.14);border:1px solid var(--line2);display:grid;place-items:center;color:var(--acc)}\n  .brand-name{font-size:15px;font-weight:600}\n  .brand-sub{font-size:11px;color:var(--faint)}\n  .nav{display:flex;flex-direction:column;gap:3px;min-width:0}\n  .nav button{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--muted);text-align:left}\n  .nav button:hover{background:var(--panel);color:var(--text)}\n  .nav button.active{background:var(--panel);color:var(--acc);border-color:var(--line)}\n  .side-foot{margin-top:auto;display:flex;flex-direction:column;gap:8px;min-width:0}\n  .privacy{display:flex;gap:8px;align-items:flex-start;padding:10px;border:1px solid var(--line);border-radius:8px;color:var(--muted);font-size:12px;background:var(--panel)}\n  .privacy .sv{color:var(--acc);margin-top:2px}\n  .ghost-btn{display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:6px;padding:8px}\n  .ghost-btn:hover{color:var(--text);border-color:var(--line2)}\n  .verline{padding:0 6px;color:var(--faint);font-size:11px}\n\n  .main{min-width:0;padding:24px 28px 70px}\n  .topbar{display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap}\n  .page-title{font-size:19px;font-weight:600;margin:0}\n  .page-sub{color:var(--faint);font-size:12px;margin-top:2px}\n  .spacer{flex:1}\n  .chip{display:flex;align-items:center;gap:7px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px;white-space:nowrap}\n  .dot{width:7px;height:7px;border-radius:50%;background:var(--acc)}\n\n  .view{display:none}.view.active{display:block}\n  .grid{display:grid;gap:12px}.g4{grid-template-columns:repeat(4,minmax(0,1fr))}.g2{grid-template-columns:repeat(2,minmax(0,1fr))}\n  .panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:15px;min-width:0}\n  .panel h3{margin:0 0 4px;font-size:14px}\n  .section{margin-top:16px}\n  .shead{display:flex;align-items:baseline;gap:10px;margin-bottom:9px;flex-wrap:wrap}\n  .shead h2{font-size:14px;margin:0}\n  .label{color:var(--muted);font-size:12px}\n  .value{font-size:25px;font-weight:600;margin:7px 0 2px}\n  .delta{font-size:12px;color:var(--muted)}\n  .mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all}\n\n  .toolbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap}\n  .search{display:flex;align-items:center;gap:8px;min-width:230px;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:7px 11px;color:var(--muted)}\n  .search input{background:transparent;border:0;padding:0;width:100%}\n  .btn{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:6px;border:1px solid var(--line2);background:transparent;color:var(--text);white-space:nowrap}\n  .btn:hover{border-color:var(--acc)}\n  .btn.primary{background:var(--acc);border-color:var(--acc);color:var(--acc-ink);font-weight:600}\n  .btn.danger{border-color:rgba(224,122,122,.5);color:var(--danger)}\n  .btn.small{padding:4px 9px;font-size:12px}\n  .btn[disabled]{opacity:.45;cursor:not-allowed}\n  .ibtn{width:29px;height:29px;display:grid;place-items:center;border:1px solid var(--line);background:transparent;border-radius:6px;color:var(--muted)}\n  .ibtn:hover{color:var(--text);border-color:var(--line2)}\n\n  table{width:100%;border-collapse:collapse}\n  th,td{text-align:left;padding:10px 9px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}\n  th{color:var(--faint);font-weight:500;font-size:12px}\n  tbody tr:hover{background:var(--panel2)}\n  .cell-main{font-weight:600}\n  .cell-sub{color:var(--faint);font-size:11px;word-break:break-all}\n\n  .list{display:flex;flex-direction:column;gap:7px;margin-top:12px}\n  .row{display:flex;align-items:center;gap:11px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);min-width:0}\n  .row-main{flex:1;min-width:0}\n  .row-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n  .row-meta{color:var(--faint);font-size:11px;margin-top:2px;word-break:break-all}\n  .row-actions{display:flex;gap:6px;flex-wrap:wrap}\n  .empty{color:var(--faint);text-align:center;padding:22px;border:1px dashed var(--line);border-radius:8px;margin-top:12px}\n\n  .badge{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--line2);color:var(--muted);background:transparent;white-space:nowrap}\n  .badge.ok{color:var(--acc);border-color:rgba(95,191,143,.45);background:rgba(95,191,143,.10)}\n  .badge.warn{color:var(--warn);border-color:rgba(224,178,99,.45);background:rgba(224,178,99,.10)}\n  .badge.danger{color:var(--danger);border-color:rgba(224,122,122,.45);background:rgba(224,122,122,.10)}\n  .badge.info{color:var(--info);border-color:rgba(143,180,222,.45);background:rgba(143,180,222,.10)}\n  .dot-mark{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;background:var(--faint)}\n  .dot-mark.ok{background:var(--acc)}.dot-mark.warn{background:var(--warn)}.dot-mark.danger{background:var(--danger)}\n\n  .banner{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border:1px solid var(--line2);border-radius:8px;background:var(--panel2)}\n  .banner.ok{border-color:rgba(95,191,143,.45)}\n  .banner.danger{border-color:rgba(224,122,122,.45)}\n  .banner .sv{margin-top:2px;color:var(--acc)}\n  .banner.danger .sv{color:var(--danger)}\n  .banner-title{font-weight:600}\n  .banner-body{color:var(--muted);font-size:12px;margin-top:2px}\n\n  .kv{display:grid;grid-template-columns:96px 1fr;gap:5px 10px;font-size:13px;margin:10px 0}\n  .kv dt{color:var(--faint)}.kv dd{margin:0;word-break:break-all}\n  .variants{border-top:1px dashed var(--line);margin-top:8px;padding-top:8px;display:flex;flex-direction:column;gap:5px}\n  .variant{display:flex;gap:9px;align-items:baseline;font-size:12px;color:var(--muted);flex-wrap:wrap}\n  .check{width:16px;height:16px;flex:none;accent-color:var(--acc)}\n  details summary{cursor:pointer;color:var(--muted);font-size:12px}\n\n  .actionbar{position:sticky;bottom:0;margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:11px 13px;border:1px solid var(--line2);border-radius:8px;background:var(--bg2);box-shadow:var(--shadow)}\n  .result-list{display:flex;flex-direction:column;gap:6px;margin-top:10px}\n  .result{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:12px}\n\n  .mask{position:fixed;inset:0;background:rgba(0,0,0,.52);display:none;place-items:center;z-index:50;padding:18px}\n  .mask.open{display:grid}\n  .modal{width:min(600px,100%);max-height:86vh;overflow:auto;background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:18px;box-shadow:var(--shadow)}\n  .modal h3{margin:0 0 10px;font-size:16px}\n  .modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}\n\n  .toasts{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;flex-direction:column;gap:7px;align-items:center;z-index:60}\n  .toast{background:var(--panel2);border:1px solid var(--line2);border-radius:999px;padding:8px 15px;box-shadow:var(--shadow);font-size:13px}\n\n  .cmd-group{margin-top:14px}\n  .cmd{display:flex;gap:10px;align-items:center;padding:9px 11px;border:1px solid var(--line);border-radius:6px;background:var(--panel2);margin-top:6px}\n  .cmd code{flex:1;min-width:0;word-break:break-all;color:var(--text)}\n  .cmd .why{color:var(--faint);font-size:11px}\n  .note{color:var(--muted);font-size:12px;margin-top:8px}\n\n  @media (max-width:980px){.g4{grid-template-columns:repeat(2,minmax(0,1fr))}}\n  @media (max-width:760px){\n    .shell{grid-template-columns:minmax(0,1fr)}\n    .sidebar{position:static;height:auto;padding:13px;gap:11px}\n    .nav{flex-direction:row;overflow-x:auto;width:100%;scrollbar-width:none;-webkit-overflow-scrolling:touch}\n    .nav::-webkit-scrollbar{display:none}\n    .nav button{white-space:nowrap;padding:7px 9px}\n    .side-foot{margin-top:0;flex-direction:row;align-items:center}\n    .privacy{display:none}\n    .ghost-btn{flex:1;white-space:nowrap}\n    .verline{white-space:nowrap;text-align:right}\n    .main{padding:16px 14px 56px}\n    .g4,.g2{grid-template-columns:minmax(0,1fr)}\n    .search{min-width:100%}\n    table{display:block;overflow-x:auto;white-space:nowrap}\n    .row{flex-wrap:wrap}\n  }\n</style>\n</head>\n<body>\n<div class=\"shell\">\n  <aside class=\"sidebar\">\n    <div class=\"brand\">\n      <div class=\"brand-mark\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><path d=\"M12 3 4 7v4c0 4.4 3.4 8.4 8 10 4.6-1.6 8-5.6 8-10V7z\"/><path d=\"M9 12l2 2 4-4\"/></svg></div>\n      <div><div class=\"brand-name\">元阁 · 技能枢纽</div><div class=\"brand-sub\">Hub 本地面板</div></div>\n    </div>\n    <nav class=\"nav\" id=\"nav\">\n      <button data-view=\"overview\" class=\"active\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><path d=\"M3 10.5 12 3l9 7.5\"/><path d=\"M5 9.5V21h14V9.5\"/></svg>概览</button>\n      <button data-view=\"hosts\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"7\" rx=\"2\"/><rect x=\"3\" y=\"13\" width=\"18\" height=\"7\" rx=\"2\"/><path d=\"M7 7.5h.01M7 16.5h.01\"/></svg>宿主矩阵</button>\n      <button data-view=\"adopt\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><path d=\"M12 3v12\"/><path d=\"m7 10 5 5 5-5\"/><path d=\"M4 21h16\"/></svg>收编向导</button>\n      <button data-view=\"links\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><path d=\"M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1L11 4.9\"/><path d=\"M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1-1\"/></svg>链接与体检</button>\n      <button data-view=\"records\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><path d=\"M3 12a9 9 0 1 0 3-6.7\"/><path d=\"M3 4v5h5\"/><path d=\"M12 8v5l3 2\"/></svg>记录与回滚</button>\n      <button data-view=\"route\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><circle cx=\"6\" cy=\"6\" r=\"2.5\"/><circle cx=\"18\" cy=\"18\" r=\"2.5\"/><path d=\"M8.5 6H15a3 3 0 0 1 0 6h-6a3 3 0 0 0 0 6h6.5\"/></svg>路由与编排</button>\n      <button data-view=\"cli\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><path d=\"m4 7 5 5-5 5\"/><path d=\"M12 19h8\"/></svg>高级 CLI</button>\n    </nav>\n    <div class=\"side-foot\">\n      <div class=\"privacy\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\"/><path d=\"m9 12 2 2 4-4\"/></svg><span>本机运行 · 零远程<br>写操作需页面令牌与确认</span></div>\n      <button class=\"ghost-btn\" id=\"themeBtn\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4\"/></svg>切换主题</button>\n      <div class=\"verline\" id=\"verLine\"></div>\n    </div>\n  </aside>\n\n  <main class=\"main\">\n    <div class=\"topbar\">\n      <div><h1 class=\"page-title\" id=\"pageTitle\">概览</h1><div class=\"page-sub\" id=\"pageSub\">Hub 里有什么、健康吗、最近做了什么</div></div>\n      <div class=\"spacer\"></div>\n      <button class=\"btn\" id=\"refreshBtn\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><path d=\"M3 12a9 9 0 1 0 3-6.7\"/><path d=\"M3 4v5h5\"/></svg>刷新</button>\n      <div class=\"chip\"><span class=\"dot\"></span>本机 · 127.0.0.1</div>\n    </div>\n\n    <section class=\"view active\" id=\"view-overview\">\n      <div class=\"grid g4\" id=\"ovCards\"></div>\n      <div class=\"section\" id=\"ovDoctor\"></div>\n      <div class=\"section grid g2\">\n        <div class=\"panel\"><h3>Hub 内容</h3><div class=\"faint\">技能真源在 Hub 目录，宿主目录通过链接分发。</div><div class=\"list\" id=\"ovSkills\"></div></div>\n        <div class=\"panel\"><h3>最近动作</h3><div class=\"faint\">收编 / 链接 / 解除都写入 Hub 审计。</div><div class=\"list\" id=\"ovAudit\"></div></div>\n      </div>\n      <div class=\"section panel\">\n        <h3>Hub 位置</h3>\n        <div class=\"mono\" id=\"ovHubDir\">-</div>\n        <div class=\"toolbar section\">\n          <button class=\"btn small\" data-goto=\"adopt\">去收编</button>\n          <button class=\"btn small\" data-goto=\"links\">去链接与体检</button>\n          <button class=\"btn small\" data-goto=\"records\">查看记录</button>\n          <button class=\"btn small\" id=\"copyHubDir\">复制路径</button>\n        </div>\n      </div>\n    </section>\n\n    <section class=\"view\" id=\"view-hosts\">\n      <div class=\"toolbar\">\n        <label class=\"search\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-3.5-3.5\"/></svg><input id=\"hostSearch\" placeholder=\"过滤宿主 / 目录\"></label>\n        <span class=\"label\" id=\"hostSummary\"></span>\n      </div>\n      <div class=\"section panel\">\n        <table><thead><tr><th>宿主</th><th>技能目录</th><th>目录技能</th><th>指向 Hub</th><th>异常</th><th>状态</th></tr></thead><tbody id=\"hostRows\"></tbody></table>\n        <div class=\"empty\" id=\"hostEmpty\" hidden>没有匹配的宿主目录。</div>\n      </div>\n      <div class=\"section panel\"><h3>已安装标记（无技能目录的宿主）</h3><div class=\"list\" id=\"hostMarks\"></div></div>\n    </section>\n\n    <section class=\"view\" id=\"view-adopt\">\n      <div class=\"grid g4\" id=\"adoptCards\"></div>\n      <div class=\"section toolbar\">\n        <label class=\"search\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-3.5-3.5\"/></svg><input id=\"adoptSearch\" placeholder=\"过滤技能 slug / 来源宿主\"></label>\n        <button class=\"btn small\" id=\"adoptAll\">全选可收编</button>\n        <button class=\"btn small\" id=\"adoptNone\">清空</button>\n        <span class=\"spacer\"></span>\n        <span class=\"label\" id=\"adoptScanInfo\"></span>\n      </div>\n      <div class=\"list\" id=\"adoptList\"></div>\n      <div class=\"empty\" id=\"adoptEmpty\" hidden>没有可收编的候选。先在宿主里安装技能，或刷新宿主矩阵。</div>\n      <div class=\"actionbar\">\n        <span class=\"label\">已选 <b id=\"adoptCount\">0</b> 项</span>\n        <span class=\"spacer\"></span>\n        <span class=\"faint\">默认复制保真、原目录保留；冲突项默认跳过；执行时逐项运行元信扫描。</span>\n        <button class=\"btn primary\" id=\"adoptApply\">收编所选</button>\n      </div>\n      <div class=\"section panel\" id=\"adoptResultsWrap\" hidden><h3>收编结果</h3><div class=\"result-list\" id=\"adoptResults\"></div></div>\n    </section>\n\n    <section class=\"view\" id=\"view-links\">\n      <div id=\"linkDoctor\"></div>\n      <div class=\"section panel\">\n        <h3>分发目标</h3>\n        <div class=\"faint\">把 Hub 技能链接到宿主目录（Windows junction / POSIX symlink）；同名真目录默认跳过，不做静默覆盖。</div>\n        <div class=\"list\" id=\"linkTargets\"></div>\n      </div>\n      <div class=\"section panel\">\n        <h3>当前链接</h3>\n        <table><thead><tr><th>技能</th><th>宿主</th><th>目标</th><th>状态</th><th></th></tr></thead><tbody id=\"linkRows\"></tbody></table>\n        <div class=\"empty\" id=\"linkEmpty\" hidden>还没有任何链接。</div>\n      </div>\n    </section>\n\n    <section class=\"view\" id=\"view-records\">\n      <div class=\"toolbar\">\n        <button class=\"btn small\" data-tab=\"snapshots\">回滚快照</button>\n        <button class=\"btn small\" data-tab=\"evidence\">安装 / 回滚证据</button>\n        <button class=\"btn small\" data-tab=\"audit\">Hub 审计</button>\n        <span class=\"spacer\"></span>\n        <span class=\"label\" id=\"recordsInfo\"></span>\n      </div>\n      <div class=\"section panel\" id=\"recSnapshots\">\n        <table><thead><tr><th>技能</th><th>版本</th><th>时间</th><th>来源目录</th><th>状态</th><th></th></tr></thead><tbody id=\"snapshotRows\"></tbody></table>\n        <div class=\"empty\" id=\"snapshotEmpty\" hidden>没有安装快照。快照由 install / update 写入。</div>\n      </div>\n      <div class=\"section panel\" id=\"recEvidence\" hidden>\n        <div class=\"list\" id=\"evidenceRows\"></div>\n        <div class=\"empty\" id=\"evidenceEmpty\" hidden>没有证据记录。</div>\n      </div>\n      <div class=\"section panel\" id=\"recAudit\" hidden>\n        <div class=\"list\" id=\"auditRows\"></div>\n        <div class=\"empty\" id=\"auditEmpty\" hidden>没有 Hub 审计记录。</div>\n      </div>\n    </section>\n\n    <section class=\"view\" id=\"view-route\">\n      <div class=\"panel\">\n        <h3>一句话需求 → 技能组合</h3>\n        <div class=\"faint\">只读调用静态 playbook（7 组）+ 动态路由块；安装建议只给命令，不在网页执行。</div>\n        <div class=\"toolbar section\">\n          <label class=\"search\" style=\"flex:1\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-3.5-3.5\"/></svg><input id=\"routeInput\" placeholder=\"例如：帮我做发布前质量检查\"></label>\n          <button class=\"btn primary\" id=\"routeBtn\">给出组合</button>\n        </div>\n      </div>\n      <div id=\"routeResult\" class=\"section\"></div>\n    </section>\n\n    <section class=\"view\" id=\"view-cli\">\n      <div class=\"banner\">\n        <svg class=\"sv\" viewBox=\"0 0 24 24\"><path d=\"m4 7 5 5-5 5\"/><path d=\"M12 19h8\"/></svg>\n        <div><div class=\"banner-title\">高级 CLI</div><div class=\"banner-body\">低频 / 长尾命令在这里复制到终端执行；网页不代替终端运行安装与更新。</div></div>\n      </div>\n      <div id=\"cliGroups\"></div>\n    </section>\n  </main>\n</div>\n\n<div class=\"mask\" id=\"mask\"><div class=\"modal\" id=\"modal\"></div></div>\n<div class=\"toasts\" id=\"toasts\"></div>\n\n<script>\n(function () {\n  var TOKEN = (document.querySelector('meta[name=\"yotta-view-token\"]') || {}).content || '';\n  var state = { view: 'overview', overview: null, hosts: null, adopt: null, selected: {}, records: null, tab: 'snapshots', hostFilter: '', adoptFilter: '' };\n\n  function $(sel) { return document.querySelector(sel); }\n  function esc(value) {\n    return String(value === null || value === undefined ? '' : value)\n      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')\n      .replace(/\"/g, '&quot;').replace(/'/g, '&#39;');\n  }\n  function fmtTime(value) {\n    var ms = typeof value === 'number' ? value : Date.parse(value);\n    if (!ms || isNaN(ms)) return value ? String(value) : '-';\n    var d = new Date(ms);\n    function p(n) { return n < 10 ? '0' + n : '' + n; }\n    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());\n  }\n  function toast(text) {\n    var el = document.createElement('div');\n    el.className = 'toast';\n    el.textContent = text;\n    $('#toasts').appendChild(el);\n    setTimeout(function () { el.remove(); }, 3200);\n  }\n  function copyText(text) {\n    if (navigator.clipboard && navigator.clipboard.writeText) {\n      navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { fallbackCopy(text); });\n    } else fallbackCopy(text);\n  }\n  function fallbackCopy(text) {\n    var ta = document.createElement('textarea');\n    ta.value = text; document.body.appendChild(ta); ta.select();\n    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，请手动选择'); }\n    ta.remove();\n  }\n  async function api(path, opts) {\n    opts = opts || {};\n    var init = { method: opts.method || 'GET', headers: {} };\n    if (opts.body !== undefined) {\n      init.method = 'POST';\n      init.headers['Content-Type'] = 'application/json';\n      init.headers['X-Yotta-View-Token'] = TOKEN;\n      init.body = JSON.stringify(opts.body);\n    }\n    var res, data = null;\n    try { res = await fetch(path, init); } catch (e) { return { error: '无法连接本地服务：' + e.message }; }\n    try { data = await res.json(); } catch (e) { data = null; }\n    if (!res.ok) return data && data.error ? data : { error: '请求失败（HTTP ' + res.status + '）' };\n    if (!data) return { error: '响应不是合法 JSON' };\n    return data;\n  }\n\n  function openModal(title, bodyHtml, opts) {\n    opts = opts || {};\n    var html = '<h3>' + esc(title) + '</h3><div id=\"modalBody\">' + bodyHtml + '</div>' +\n      '<div class=\"modal-actions\"><button class=\"btn\" data-modal=\"cancel\">' + esc(opts.cancelText || '取消') + '</button>' +\n      (opts.okText === null ? '' : '<button class=\"btn ' + (opts.danger ? 'danger' : 'primary') + '\" data-modal=\"ok\">' + esc(opts.okText || '确认') + '</button>') +\n      '</div>';\n    $('#modal').innerHTML = html;\n    $('#mask').classList.add('open');\n    var ok = $('#modal').querySelector('[data-modal=\"ok\"]');\n    $('#modal').querySelector('[data-modal=\"cancel\"]').onclick = closeModal;\n    if (ok && opts.onOk) {\n      ok.onclick = async function () {\n        ok.disabled = true;\n        try { await opts.onOk(); } finally { ok.disabled = false; }\n      };\n    }\n  }\n  function closeModal() { $('#mask').classList.remove('open'); $('#modal').innerHTML = ''; }\n  function confirmModal(title, bodyHtml, okText, danger, onOk) {\n    openModal(title, bodyHtml, { okText: okText, danger: danger, onOk: onOk });\n  }\n  $('#mask').addEventListener('click', function (e) { if (e.target === $('#mask')) closeModal(); });\n  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });\n\n  var VIEWS = {\n    overview: { title: '概览', sub: 'Hub 里有什么、健康吗、最近做了什么', load: loadOverview },\n    hosts: { title: '宿主矩阵', sub: '装了哪些宿主、技能目录在哪、Hub 技能链到了谁', load: loadHosts },\n    adopt: { title: '收编向导', sub: '有哪些可收编、哪些是重复副本、收编后会发生什么', load: loadAdopt },\n    links: { title: '链接与体检', sub: '断链 / 漂移 / 目标缺失在哪、怎么修', load: loadLinks },\n    records: { title: '记录与回滚', sub: '安装、收编、链接都做了什么，怎么退回', load: loadRecords },\n    route: { title: '路由与编排', sub: '一句话需求该用哪些技能、缺什么（只读）', load: null },\n    cli: { title: '高级 CLI', sub: '低频命令速查与复制', load: null }\n  };\n  function switchView(name) {\n    if (!VIEWS[name]) return;\n    state.view = name;\n    Array.prototype.forEach.call(document.querySelectorAll('#nav button'), function (b) { b.classList.toggle('active', b.dataset.view === name); });\n    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) { v.classList.toggle('active', v.id === 'view-' + name); });\n    $('#pageTitle').textContent = VIEWS[name].title;\n    $('#pageSub').textContent = VIEWS[name].sub;\n    if (VIEWS[name].load) VIEWS[name].load();\n  }\n  $('#nav').addEventListener('click', function (e) {\n    var b = e.target.closest('button[data-view]');\n    if (b) switchView(b.dataset.view);\n  });\n  document.addEventListener('click', function (e) {\n    var g = e.target.closest('[data-goto]');\n    if (g) switchView(g.dataset.goto);\n  });\n  $('#refreshBtn').onclick = function () { var v = VIEWS[state.view]; if (v && v.load) v.load(); else toast('已刷新'); };\n  $('#themeBtn').onclick = function () {\n    document.body.classList.toggle('light');\n    try { localStorage.setItem('yotta-hub-theme', document.body.classList.contains('light') ? 'light' : 'dark'); } catch (e) {}\n  };\n  try { if (localStorage.getItem('yotta-hub-theme') === 'light') document.body.classList.add('light'); } catch (e) {}\n\n  function statCard(label, value, delta, tone) {\n    return '<div class=\"panel\"><div class=\"label\">' + esc(label) + '</div><div class=\"value\">' + esc(value) + '</div><div class=\"delta ' + (tone ? 'badge ' + tone : '') + '\">' + esc(delta) + '</div></div>';\n  }\n  function doctorBanner(doctor) {\n    if (!doctor) return '';\n    if (doctor.ok) {\n      return '<div class=\"banner ok\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\"/><path d=\"m9 12 2 2 4-4\"/></svg><div><div class=\"banner-title\">体检通过</div><div class=\"banner-body\">警告 ' + doctor.summary.warnings + ' / 信息 ' + doctor.summary.info + '；结构性错误 0。</div></div></div>';\n    }\n    var bad = (doctor.checks || []).filter(function (c) { return !c.ok; }).slice(0, 6).map(function (c) {\n      return '<div class=\"result\"><span class=\"badge ' + (c.severity === 'error' ? 'danger' : 'warn') + '\">' + esc(c.severity === 'error' ? '错误' : '警告') + '</span><span>' + esc(c.message) + '</span>' + (c.hint ? '<span class=\"faint\">修复：' + esc(c.hint) + '</span>' : '') + '</div>';\n    }).join('');\n    return '<div class=\"banner danger\"><svg class=\"sv\" viewBox=\"0 0 24 24\"><path d=\"M12 9v4\"/><path d=\"M12 17h.01\"/><path d=\"M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z\"/></svg><div style=\"flex:1\"><div class=\"banner-title\">体检未通过（错误 ' + doctor.summary.errors + ' / 警告 ' + doctor.summary.warnings + '）</div><div class=\"result-list\">' + bad + '</div></div></div>';\n  }\n\n  async function loadOverview() {\n    var d = await api('/api/overview');\n    if (d.error) { toast(d.error); return; }\n    state.overview = d;\n    $('#ovCards').innerHTML =\n      statCard('Hub 技能', d.status.summary.skills, '外部来源 ' + d.status.summary.external, '') +\n      statCard('已链接', d.status.summary.links, '宿主目录投影', 'ok') +\n      statCard('异常链接', d.status.summary.brokenLinks, d.status.summary.brokenLinks ? '需要处理' : '全部正常', d.status.summary.brokenLinks ? 'danger' : 'ok') +\n      statCard('Doctor', d.doctor.ok ? '通过' : '未通过', '错误 ' + d.doctor.summary.errors + ' / 警告 ' + d.doctor.summary.warnings, d.doctor.ok ? 'ok' : 'danger');\n    $('#ovDoctor').innerHTML = doctorBanner(d.doctor);\n    var skills = d.status.skills || [];\n    $('#ovSkills').innerHTML = skills.length ? skills.slice(0, 8).map(function (s) {\n      return '<div class=\"row\"><div class=\"row-main\"><div class=\"row-title\">' + esc(s.slug) + '</div><div class=\"row-meta\">v' + esc(s.version || '-') + ' · ' + esc(s.origin === 'external' ? '外部来源' : '元阁家族') + ' · 链接 ' + (s.links || []).length + '</div></div><span class=\"badge ' + (s.status === 'present' ? 'ok' : 'danger') + '\">' + esc(s.status === 'present' ? '已入库' : '缺失') + '</span></div>';\n    }).join('') : '<div class=\"empty\">Hub 还是空的。先在「收编向导」把已装技能收编进来。</div>';\n    var audit = (d.audit && d.audit.recent) || [];\n    $('#ovAudit').innerHTML = audit.length ? audit.slice().reverse().map(function (a) {\n      return '<div class=\"row\"><div class=\"row-main\"><div class=\"row-title\">' + esc(a.event || '动作') + ' · ' + esc(a.slug || '') + '</div><div class=\"row-meta\">' + esc(fmtTime(a.at)) + (a.verdict ? ' · ' + esc(a.verdict) : '') + '</div></div></div>';\n    }).join('') : '<div class=\"empty\">还没有动作记录。</div>';\n    $('#ovHubDir').textContent = d.hubDir;\n    $('#copyHubDir').onclick = function () { copyText(d.hubDir); };\n  }\n\n  async function loadHosts() {\n    var d = await api('/api/hosts');\n    if (d.error) { toast(d.error); return; }\n    state.hosts = d;\n    $('#hostSummary').textContent = '目录 ' + d.summary.existing + ' / ' + d.summary.hosts + ' · 已装标记 ' + d.summary.installedMarks + ' · 链接 ' + d.summary.links;\n    renderHosts();\n    var marks = d.installed || [];\n    $('#hostMarks').innerHTML = marks.length ? marks.map(function (m) {\n      return '<div class=\"row\"><div class=\"row-main\"><div class=\"row-title\">' + esc(m.label) + '</div><div class=\"row-meta\">' + esc(m.source || '') + (m.hasSkillsDir ? ' · 技能目录：' + esc(m.skillDir || '') : ' · 未发现技能目录') + '</div></div><span class=\"badge ' + (m.hasSkillsDir ? 'ok' : 'info') + '\">' + esc(m.hasSkillsDir ? '可链接' : '仅标记') + '</span></div>';\n    }).join('') : '<div class=\"empty\">没有检测到额外宿主标记。</div>';\n  }\n  function renderHosts() {\n    var d = state.hosts; if (!d) return;\n    var q = state.hostFilter.toLowerCase();\n    var rows = (d.hosts || []).filter(function (h) {\n      if (!q) return true;\n      return String(h.label || '').toLowerCase().includes(q) || String(h.dir || '').toLowerCase().includes(q);\n    });\n    $('#hostEmpty').hidden = rows.length > 0;\n    $('#hostRows').innerHTML = rows.map(function (h) {\n      var status = !h.exists ? '<span class=\"badge\">未创建</span>' : (h.brokenLinks ? '<span class=\"badge danger\">有异常</span>' : '<span class=\"badge ok\">可用</span>');\n      return '<tr><td><div class=\"cell-main\">' + esc(h.label) + '</div><div class=\"cell-sub\">' + esc(h.agentId || (h.known ? '已知宿主' : h.detection || '自动发现')) + '</div></td>' +\n        '<td><div class=\"mono\">' + esc(h.dir) + '</div><button class=\"btn small\" data-copy=\"' + esc(h.dir) + '\">复制</button></td>' +\n        '<td>' + esc(h.skillCount || 0) + '</td><td>' + esc(h.hubLinks || 0) + '</td><td>' + esc(h.brokenLinks || 0) + '</td><td>' + status + '</td></tr>';\n    }).join('');\n  }\n  $('#hostSearch').addEventListener('input', function (e) { state.hostFilter = e.target.value; renderHosts(); });\n  $('#hostRows').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-copy]');\n    if (b) copyText(b.dataset.copy);\n  });\n\n  async function loadAdopt() {\n    var d = await api('/api/adopt/scan');\n    if (d.error) { toast(d.error); return; }\n    state.adopt = d;\n    state.selected = {};\n    $('#adoptCards').innerHTML =\n      statCard('候选技能', d.summary.candidates, '已装宿主里的技能', '') +\n      statCard('多副本冲突', d.summary.conflicts, '版本 / 哈希不一致', d.summary.conflicts ? 'warn' : 'ok') +\n      statCard('已在 Hub', d.summary.alreadyInHub, '默认跳过', 'info') +\n      statCard('扫描引擎', d.scan && d.scan.available ? '可用' : '未找到', d.scan && d.scan.available ? '收编时逐项扫描' : '可显式降级（CLI）', d.scan && d.scan.available ? 'ok' : 'warn');\n    $('#adoptScanInfo').textContent = '生成于 ' + fmtTime(d.generatedAt);\n    renderAdopt();\n  }\n  function renderAdopt() {\n    var d = state.adopt; if (!d) return;\n    var q = state.adoptFilter.toLowerCase();\n    var candidates = (d.candidates || []).filter(function (c) {\n      if (!q) return true;\n      return String(c.slug || '').toLowerCase().includes(q) || String(c.sourceHost || '').toLowerCase().includes(q);\n    });\n    $('#adoptEmpty').hidden = candidates.length > 0;\n    $('#adoptList').innerHTML = candidates.map(function (c) {\n      var variants = (c.variants || []).map(function (v) {\n        return '<div class=\"variant\"><span class=\"badge\">' + esc(v.host) + '</span><span class=\"mono\">' + esc(v.dir) + '</span><span>v' + esc(v.version || '-') + '</span></div>';\n      }).join('');\n      return '<div class=\"row\"><input class=\"check\" type=\"checkbox\" data-slug=\"' + esc(c.slug) + '\"' + (state.selected[c.slug] ? ' checked' : '') + (c.inHub ? ' disabled' : '') + '>' +\n        '<div class=\"row-main\"><div class=\"row-title\">' + esc(c.slug) + ' <span class=\"badge\">v' + esc(c.version || '-') + '</span>' +\n        (c.inHub ? ' <span class=\"badge info\">已在 Hub</span>' : '') +\n        (c.conflict ? ' <span class=\"badge warn\">多副本冲突</span>' : '') + '</div>' +\n        '<div class=\"row-meta\">来源：' + esc(c.sourceHost || '-') + ' · ' + esc(c.source || '') + '</div>' +\n        (c.variants && c.variants.length > 1 ? '<details><summary>' + c.variants.length + ' 个副本</summary><div class=\"variants\">' + variants + '</div></details>' : '') +\n        '</div></div>';\n    }).join('');\n    updateAdoptCount();\n  }\n  function updateAdoptCount() {\n    var n = Object.keys(state.selected).filter(function (k) { return state.selected[k]; }).length;\n    $('#adoptCount').textContent = String(n);\n    $('#adoptApply').disabled = n === 0;\n  }\n  $('#adoptSearch').addEventListener('input', function (e) { state.adoptFilter = e.target.value; renderAdopt(); });\n  $('#adoptList').addEventListener('change', function (e) {\n    var box = e.target.closest('input[data-slug]');\n    if (!box) return;\n    if (box.checked) state.selected[box.dataset.slug] = true; else delete state.selected[box.dataset.slug];\n    updateAdoptCount();\n  });\n  $('#adoptAll').onclick = function () {\n    ((state.adopt && state.adopt.candidates) || []).forEach(function (c) { if (!c.inHub) state.selected[c.slug] = true; });\n    renderAdopt();\n  };\n  $('#adoptNone').onclick = function () { state.selected = {}; renderAdopt(); };\n  $('#adoptApply').onclick = function () {\n    var slugs = Object.keys(state.selected).filter(function (k) { return state.selected[k]; });\n    if (!slugs.length) { toast('还没有选择技能'); return; }\n    var preview = slugs.slice(0, 24).join('、') + (slugs.length > 24 ? ' 等 ' + slugs.length + ' 项' : '');\n    confirmModal('收编 ' + slugs.length + ' 个技能到 Hub？', '<p class=\"label\">将复制到 Hub（原目录保留）；已在 Hub 或冲突项按默认策略处理；执行时逐项运行元信扫描，high / critical 会阻断。</p><div class=\"mono\">' + esc(preview) + '</div>', '开始收编', false, async function () {\n      var r = await api('/api/adopt/apply', { body: { include: slugs } });\n      if (r.error) { toast(r.error); return; }\n      closeModal();\n      var order = { imported: 0, blocked: 1, conflict: 2, skip: 3, error: 4 };\n      var results = (r.results || []).slice().sort(function (a, b) { return (order[a.status] || 9) - (order[b.status] || 9); });\n      $('#adoptResultsWrap').hidden = false;\n      $('#adoptResults').innerHTML = results.map(function (x) {\n        var tone = x.status === 'imported' ? 'ok' : x.status === 'error' || x.status === 'blocked' ? 'danger' : 'warn';\n        return '<div class=\"result\"><span class=\"badge ' + tone + '\">' + esc(x.status) + '</span><b>' + esc(x.slug) + '</b><span>' + esc(x.note || '') + '</span>' + (x.scanVerdict ? '<span class=\"faint\">verdict: ' + esc(x.scanVerdict) + '</span>' : '') + '</div>';\n      }).join('');\n      toast('收编完成：导入 ' + (r.summary ? r.summary.imported : 0) + ' / 阻断 ' + (r.summary ? r.summary.blocked : 0));\n      loadOverview();\n      loadAdopt();\n    });\n  };\n\n  async function loadLinks() {\n    var results = await Promise.all([api('/api/doctor'), api('/api/links'), api('/api/hosts')]);\n    var doctor = results[0], links = results[1], hosts = results[2];\n    if (doctor.error || links.error || hosts.error) { toast((doctor.error || links.error || hosts.error)); return; }\n    $('#linkDoctor').innerHTML = doctorBanner(doctor);\n    var existing = (hosts.hosts || []).filter(function (h) { return h.exists; });\n    $('#linkTargets').innerHTML = existing.length ? existing.map(function (h) {\n      return '<div class=\"row\"><div class=\"row-main\"><div class=\"row-title\">' + esc(h.label) + '</div><div class=\"row-meta mono\">' + esc(h.dir) + '</div><div class=\"row-meta\">目录技能 ' + esc(h.skillCount || 0) + ' · 指向 Hub ' + esc(h.hubLinks || 0) + (h.brokenLinks ? ' · 异常 ' + h.brokenLinks : '') + '</div></div><div class=\"row-actions\"><button class=\"btn small\" data-link-plan=\"' + esc(h.dir) + '\" data-label=\"' + esc(h.label) + '\">预览链接</button></div></div>';\n    }).join('') : '<div class=\"empty\">尚未发现可用的宿主技能目录。</div>';\n    var rows = links.links || [];\n    $('#linkEmpty').hidden = rows.length > 0;\n    $('#linkRows').innerHTML = rows.map(function (l) {\n      var tone = l.status === 'ok' ? 'ok' : l.status === 'broken' ? 'danger' : 'warn';\n      return '<tr><td><div class=\"cell-main\">' + esc(l.slug) + '</div><div class=\"cell-sub\">' + esc(l.label || l.agent || '-') + '</div></td>' +\n        '<td class=\"mono\">' + esc(l.dir) + '</td><td class=\"mono\">' + esc(l.target) + '</td>' +\n        '<td><span class=\"badge ' + tone + '\">' + esc(l.status) + '</span></td>' +\n        '<td><button class=\"btn small danger\" data-unlink=\"' + esc(l.target) + '\" data-dir=\"' + esc(l.dir) + '\" data-slug=\"' + esc(l.slug) + '\">解除</button></td></tr>';\n    }).join('');\n  }\n  $('#linkTargets').addEventListener('click', async function (e) {\n    var b = e.target.closest('[data-link-plan]');\n    if (!b) return;\n    var dir = b.dataset.linkPlan;\n    var plan = await api('/api/links/plan?dir=' + encodeURIComponent(dir));\n    if (plan.error) { toast(plan.error); return; }\n    var would = plan.results.filter(function (r) { return r.status === 'would-link'; });\n    var conflicts = plan.results.filter(function (r) { return r.status === 'conflict'; });\n    var body = '<p class=\"label\">目标：' + esc(plan.label || '') + ' · <span class=\"mono\">' + esc(dir) + '</span></p>' +\n      '<div class=\"result\"><span class=\"badge ok\">将建立</span><b>' + would.length + '</b><span>个链接</span></div>' +\n      (conflicts.length ? '<div class=\"result\"><span class=\"badge warn\">跳过冲突</span><b>' + conflicts.length + '</b><span>个同名目录 / 链接（默认不覆盖）</span></div>' : '') +\n      (would.length ? '<details><summary>查看明细</summary><div class=\"variants\">' + would.map(function (r) { return '<div class=\"variant\"><span class=\"mono\">' + esc(r.slug) + '</span></div>'; }).join('') + '</div></details>' : '<p class=\"faint\">没有可建立的链接。</p>');\n    openModal('链接预览', body, {\n      okText: would.length ? '执行链接' : null,\n      onOk: async function () {\n        var r = await api('/api/links/apply', { body: { targetDir: dir } });\n        if (r.error) { toast(r.error); return; }\n        closeModal();\n        var done = (r.results || []).filter(function (x) { return x.status === 'linked'; }).length;\n        toast('已建立 ' + done + ' 个链接');\n        loadLinks();\n      },\n    });\n  });\n  $('#linkRows').addEventListener('click', async function (e) {\n    var b = e.target.closest('[data-unlink]');\n    if (!b) return;\n    var target = b.dataset.unlink;\n    var dir = b.dataset.dir;\n    var slug = b.dataset.slug;\n    confirmModal('解除链接 ' + slug + '？', '<p class=\"label\">只删除宿主目录中的链接，Hub 真源保留。目标不是指向 Hub 的链接时会 fail-closed 拒绝。</p><div class=\"mono\">' + esc(target) + '</div>', '解除链接', true, async function () {\n      var r = await api('/api/links/remove', { body: { targetDir: dir, slugs: [slug], confirm: 'unlink' } });\n      if (r.error) { toast(r.error); return; }\n      closeModal();\n      toast('已解除 ' + slug);\n      loadLinks();\n    });\n  });\n\n  async function loadRecords() {\n    var d = await api('/api/records?limit=200');\n    if (d.error) { toast(d.error); return; }\n    state.records = d;\n    var valid = (d.snapshots || []).filter(function (s) { return s.valid; }).length;\n    $('#recordsInfo').textContent = '快照 ' + valid + ' / ' + (d.snapshots || []).length + ' · 证据 ' + (d.evidence.entries || []).length + ' · 审计 ' + (d.audit.entries || []).length;\n    renderSnapshots();\n    var ev = (d.evidence.entries || []).slice().reverse();\n    $('#evidenceEmpty').hidden = ev.length > 0;\n    $('#evidenceRows').innerHTML = ev.map(function (x) {\n      var tone = x.decision === 'ok' ? 'ok' : x.decision === 'fail' ? 'danger' : 'info';\n      return '<div class=\"row\"><div class=\"row-main\"><div class=\"row-title\">' + esc(x.event || 'event') + ' · ' + esc(x.skill || x.slug || '-') + '</div><div class=\"row-meta\">' + esc(fmtTime(x.ts || x.at)) + (x.version ? ' · v' + esc(x.version) : '') + (x.via ? ' · via ' + esc(x.via) : '') + '</div></div><span class=\"badge ' + tone + '\">' + esc(x.decision || '记录') + '</span></div>';\n    }).join('');\n    var aud = (d.audit.entries || []).slice().reverse();\n    $('#auditEmpty').hidden = aud.length > 0;\n    $('#auditRows').innerHTML = aud.map(function (x) {\n      return '<div class=\"row\"><div class=\"row-main\"><div class=\"row-title\">' + esc(x.event || 'audit') + ' · ' + esc(x.slug || '') + '</div><div class=\"row-meta\">' + esc(fmtTime(x.at)) + (x.verdict ? ' · ' + esc(x.verdict) : '') + (x.sourceHost ? ' · ' + esc(x.sourceHost) : '') + '</div></div></div>';\n    }).join('');\n  }\n  function renderSnapshots() {\n    var d = state.records; if (!d) return;\n    var rows = d.snapshots || [];\n    $('#snapshotEmpty').hidden = rows.length > 0;\n    $('#snapshotRows').innerHTML = rows.map(function (s) {\n      var canRollback = s.valid && s.source;\n      return '<tr><td><div class=\"cell-main\">' + esc(s.slug) + '</div><div class=\"cell-sub\">' + esc(s.name) + '</div></td>' +\n        '<td>v' + esc(s.version || '-') + '</td><td>' + esc(fmtTime(s.createdAt || s.mtime_ms)) + '</td><td class=\"mono\">' + esc(s.source || '-') + '</td>' +\n        '<td>' + (s.valid ? '<span class=\"badge ok\">可用</span>' : '<span class=\"badge danger\">不可用</span>') + (s.legacy ? ' <span class=\"badge warn\">旧格式</span>' : '') + (s.reason ? '<div class=\"cell-sub\">' + esc(s.reason) + '</div>' : '') + '</td>' +\n        '<td>' + (canRollback ? '<button class=\"btn small danger\" data-rollback=\"' + esc(s.path) + '\" data-slug=\"' + esc(s.slug) + '\" data-version=\"' + esc(s.version || '') + '\" data-source=\"' + esc(s.source || '') + '\">回滚</button>' : '<span class=\"faint\">CLI 处理</span>') + '</td></tr>';\n    }).join('');\n  }\n  document.querySelectorAll('#view-records [data-tab]').forEach(function (b) {\n    b.onclick = function () {\n      state.tab = b.dataset.tab;\n      Array.prototype.forEach.call(document.querySelectorAll('#view-records [data-tab]'), function (x) { x.classList.toggle('primary', x === b); });\n      $('#recSnapshots').hidden = state.tab !== 'snapshots';\n      $('#recEvidence').hidden = state.tab !== 'evidence';\n      $('#recAudit').hidden = state.tab !== 'audit';\n    };\n  });\n  document.querySelector('#view-records [data-tab=\"snapshots\"]').classList.add('primary');\n  $('#snapshotRows').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-rollback]');\n    if (!b) return;\n    var slug = b.dataset.slug, snap = b.dataset.rollback, source = b.dataset.source;\n    confirmModal('回滚 ' + slug + ' 到 v' + b.dataset.version + '？', '<p class=\"label\">将用快照覆盖安装来源目录；恢复后自动体检并写入证据。</p><div class=\"mono\">' + esc(source) + '</div>', '执行回滚', true, async function () {\n      var r = await api('/api/rollback/apply', { body: { slug: slug, snapshot: snap, confirm: 'rollback' } });\n      if (r.error) { toast(r.error); return; }\n      closeModal();\n      toast(r.ok ? '回滚完成（doctor 通过）' : '回滚完成，但体检未通过');\n      loadRecords();\n      loadOverview();\n    });\n  });\n\n  $('#routeBtn').onclick = runRoute;\n  $('#routeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') runRoute(); });\n  async function runRoute() {\n    var request = $('#routeInput').value.trim();\n    if (!request) { toast('先输入一句需求'); return; }\n    var d = await api('/api/route?request=' + encodeURIComponent(request));\n    if (d.error) { toast(d.error); return; }\n    var skills = (d.skills || []).map(function (s) {\n      return '<div class=\"row\"><div class=\"row-main\"><div class=\"row-title\">' + s.order + '. ' + esc(s.slug) + ' <span class=\"badge ' + (s.installed ? 'ok' : 'warn') + '\">' + esc(s.installed ? '已装' + (s.version ? ' v' + s.version : '') : '缺失') + '</span></div><div class=\"row-meta\">' + esc(s.role || '') + '</div></div></div>';\n    }).join('');\n    var missing = (d.missing_skills || []).length\n      ? '<div class=\"section panel\"><h3>缺失技能</h3><div class=\"toolbar\"><span class=\"mono\">' + esc((d.missing_skills || []).map(function (s) { return s.slug; }).join(', ')) + '</span><button class=\"btn small\" data-copy-cmd=\"' + esc(d.install_command || '') + '\">复制安装命令</button></div><div class=\"note\">安装与信任判断由你决定；元信装前扫描默认启用。</div></div>'\n      : '';\n    var others = (d.other_skill_candidates || []).length\n      ? '<div class=\"section panel\"><h3>其他已装技能候选</h3>' + d.other_skill_candidates.map(function (c) {\n        return '<div class=\"row\"><div class=\"row-main\"><div class=\"row-title\">' + esc(c.slug) + ' <span class=\"badge info\">v' + esc(c.version) + '</span></div><div class=\"row-meta\">' + esc((c.matched_terms || []).join('、')) + ' · ' + esc(c.description || '') + '</div></div></div>';\n      }).join('') + '<div class=\"note\">只读 frontmatter 机械匹配；使用前请自行确认。</div></div>'\n      : '';\n    $('#routeResult').innerHTML = '<div class=\"panel\"><div class=\"shead\"><h2>' + esc(d.playbook.name) + '</h2><span class=\"badge\">置信度 ' + esc(d.confidence) + '</span></div>' +\n      '<div class=\"label\">' + esc(d.playbook.intent) + '</div><div class=\"list\">' + skills + '</div>' +\n      '<div class=\"note\">动态路由：' + esc((d.dynamic && d.dynamic.status) || '未启用') + ' · 匹配词：' + esc((d.matched_keywords || []).join('、') || '无') + '</div></div>' + missing + others;\n  }\n  $('#routeResult').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-copy-cmd]');\n    if (b) copyText(b.dataset.copyCmd);\n  });\n\n  var CLI_GROUPS = [\n    { name: 'Hub 发现与安装', items: [\n      { cmd: 'yotta-skills hub hosts', why: '发现本机宿主与技能目录' },\n      { cmd: 'yotta-skills hub install', why: '把元阁家族装进 Hub 真源' },\n      { cmd: 'yotta-skills hub adopt --scan', why: '只读预演收编候选与冲突' },\n      { cmd: 'yotta-skills hub adopt --apply', why: '执行收编（默认复制保真）' },\n    ] },\n    { name: '链接与体检', items: [\n      { cmd: 'yotta-skills hub link --all', why: '把 Hub 技能链接到全部宿主' },\n      { cmd: 'yotta-skills hub link --agent codex', why: '只链接到一个宿主' },\n      { cmd: 'yotta-skills hub unlink --all', why: '只删链接，不动 Hub 真源' },\n      { cmd: 'yotta-skills hub status', why: '查看技能 / 来源 / 链接' },\n      { cmd: 'yotta-skills hub doctor', why: '检查断链 / 缺失 / slug 不一致' },\n    ] },\n    { name: '安装与更新', items: [\n      { cmd: 'yotta-skills update --installed-only --dir <技能目录>', why: '只维护已装元技能' },\n      { cmd: 'yotta-skills update --check', why: '只读检查更新' },\n      { cmd: 'yotta-skills rollback --list', why: '查看可回滚快照' },\n      { cmd: 'yotta-skills rollback --slug <技能> --dir <技能目录>', why: '回滚单个技能' },\n    ] },\n    { name: '路由与使用', items: [\n      { cmd: 'yotta-skills --route \"帮我做发布前质量检查\"', why: '静态编排路由 + 动态路由块' },\n      { cmd: 'yotta-skills --list', why: '列出全家技能与版本' },\n      { cmd: 'yotta-skills --inventory --json', why: '盘点本机已装技能' },\n    ] },\n  ];\n  $('#cliGroups').innerHTML = CLI_GROUPS.map(function (g) {\n    return '<div class=\"panel cmd-group\"><h3>' + esc(g.name) + '</h3>' + g.items.map(function (item) {\n      return '<div class=\"cmd\"><code>' + esc(item.cmd) + '</code><span class=\"why\">' + esc(item.why) + '</span><button class=\"btn small\" data-copy-cmd=\"' + esc(item.cmd) + '\">复制</button></div>';\n    }).join('') + '</div>';\n  }).join('');\n  document.addEventListener('click', function (e) {\n    var b = e.target.closest('#cliGroups [data-copy-cmd]');\n    if (b) copyText(b.dataset.copyCmd);\n  });\n\n  (async function boot() {\n    var s = await api('/api/status');\n    if (s && !s.error) $('#verLine').textContent = 'v' + s.version + ' · ' + (s.standard || '');\n    else $('#verLine').textContent = '未连接本地服务';\n    loadOverview();\n  })();\n})();\n</script>\n</body>\n</html>\n";
// @generated view-html:end

function loadManifest() {
  const file = process.env.YOTTA_SKILLS_MANIFEST || path.join(PKG_ROOT, 'skills.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    die('无法读取技能清单: ' + file + '（' + e.message + '）', 2, '检查 YOTTA_SKILLS_MANIFEST 或 skills.json 是否存在且为合法 JSON。');
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

// 智能体 -> 用户级默认技能目录。单一真源在 lib/agent-dirs.js
// （兼容 Vercel Labs `skills` CLI / agentskills.io 的宿主表，MIT）。
const AGENT_DIRS = agentDirsLib.AGENT_DIRS;

function codexUserDir() {
  return agentDirsLib.resolveUserDir('.codex/skills', { homeDir: os.homedir(), env: process.env });
}
function opencodeUserDir() {
  return agentDirsLib.resolveUserDir('.config/opencode/skills', { homeDir: os.homedir(), env: process.env });
}
function resolveUserDir(rel) {
  return agentDirsLib.resolveUserDir(rel, { homeDir: os.homedir(), env: process.env });
}

// ── 工具函数 ───────────────────────────────────────────────────────────────
function die(msg, code, hint) {
  process.stderr.write('错误：' + msg + '\n');
  if (hint) process.stderr.write('修复建议：' + hint + '\n');
  process.exit(code === undefined ? 2 : code);
}
function out(s) { process.stdout.write(s + '\n'); }

function tarBin() { return 'tar'; }

/** 供依赖提示复制的「原命令」回显（尽力还原参数，仅作提示用）。 */
function currentCommand() {
  const args = process.argv.slice(2).map((a) => (/\s/.test(a) ? '"' + a + '"' : a));
  return 'yotta-skills ' + args.join(' ');
}

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
    list: false, dryRun: false, pin: true, skipScan: false, force: false,
    help: false, version: false, agent: null, dir: null, npm: null,
    python: null, verify: null, command: null, skill: null, rest: [],
    inventory: false, reindex: false, noReindex: false, json: false, project: false, route: null,
    check: false, auto: false, scheduled: false, registry: null, slug: null,
    host: null, event: null, manifest: null, context: null,
    signal: null, yes: false, explain: false, promote: false,
    only: [], domain: null, installedOnly: false,
    hub: null, all: false, inPlace: false, allowUnverified: false,
    from: null, include: [], as: null, skillsCli: null,
    scan: false, apply: false,
    port: null,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = (name) => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) die(name + ' 缺少参数值', 2, '请为该选项提供一个非空值；可用 --help 查看用法。'); i++; return v; };
    if (a === '--list' || a === '-l') opts.list = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--pin') opts.pin = true;
    else if (a === '--range') opts.pin = false;
    else if (a === '--skip-scan') opts.skipScan = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--version' || a === '-v') opts.version = true;
    else if (a === '--inventory' || a === '--inv') opts.inventory = true;
    else if (a === '--route') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) die('--route 缺少需求摘要', 2, '请提供一句需求描述，例如 --route "帮我做发布前质量检查"。');
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
    else if (a === '--slug') {
      const value = take('--slug').toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
        die('--slug 格式非法', 2, '只允许小写字母、数字和连字符，例如 yotta-memory。');
      }
      opts.slug = value;
    }
    else if (a === '--check') opts.check = true;
    else if (a === '--auto') opts.auto = true;
    else if (a === '--scheduled') opts.scheduled = true;
    else if (a === '--registry') opts.registry = take('--registry');
    else if (a === '--only') {
      const value = take('--only');
      for (const item of value.split(',')) {
        const slug = item.trim().toLowerCase();
        if (slug) opts.only.push(slug);
      }
    }
    else if (a === '--domain') opts.domain = take('--domain').toLowerCase();
    else if (a === '--installed-only') opts.installedOnly = true;
    else if (a === '--hub') opts.hub = take('--hub');
    else if (a === '--all') opts.all = true;
    else if (a === '--in-place') opts.inPlace = true;
    else if (a === '--scan') opts.scan = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--allow-unverified') opts.allowUnverified = true;
    else if (a === '--from') opts.from = take('--from');
    else if (a === '--include') {
      const value = take('--include');
      for (const item of value.split(',')) {
        const slug = item.trim().toLowerCase();
        if (slug) opts.include.push(slug);
      }
    }
    else if (a === '--as') opts.as = take('--as').toLowerCase();
    else if (a === '--skills-cli') opts.skillsCli = take('--skills-cli');
    else if (a === '--port') {
      const raw = take('--port');
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        die('--port 端口非法: ' + raw, 2, '请提供 0-65535 之间的整数；例如 --port 8789。');
      }
      opts.port = value;
    }
    else if (a === '--host') opts.host = take('--host').toLowerCase();
    else if (a === '--event') opts.event = take('--event').toLowerCase();
    else if (a === '--manifest') opts.manifest = take('--manifest');
    else if (a === '--context') opts.context = take('--context');
    else if (a === '--skill') opts.skill = take('--skill').toLowerCase();
    else if (a === '--signal') opts.signal = take('--signal').toLowerCase();
    else if (a === '--yes') opts.yes = true;
    else if (a === '--explain') opts.explain = true;
    else if (a === '--promote') opts.promote = true;
    else if (a.startsWith('-')) die('未知参数: ' + a, 2, '可用 --help 查看支持的选项。');
    else positionals.push(a);
  }
  // 命令解析：install / update / doctor / rollback，其余位置参数 = 技能 slug（可多个）
  for (const p of positionals) {
    if (opts.command === 'hub') {
      opts.rest.push(p);
      continue;
    }
    if (p === 'install' || p === 'update' || p === 'doctor' || p === 'rollback' || p === 'hook'
      || p === 'hub' || p === 'view'
      || p === 'usage' || p === 'decide-memory') {
      if (opts.command && opts.command !== p) die('命令冲突：' + opts.command + ' 与 ' + p);
      opts.command = p;
    } else {
      opts.rest.push(p);
    }
  }
  // 直接给 slug 且无命令 → 视为 install 单个/多个
  if (!opts.command && opts.rest.length > 0) opts.command = 'install';
  opts.skills = opts.rest.map(s => s.toLowerCase());
  if (opts.command === 'hub') {
    opts.hubAction = opts.skills[0] || 'status';
    opts.skills = opts.skills.slice(1);
  }
  if (opts.scheduled && (opts.command !== 'update' || !opts.check || opts.auto)) {
    die('--scheduled 只能与 update --check 一起使用', 2, '请使用 update --check --scheduled；自动更新不使用后台调度入口。');
  }
  if (opts.installedOnly && opts.command !== 'update') {
    die('--installed-only 只能与 update 一起使用', 2, '标准配方：yotta-skills update --installed-only --dir <技能目录>。');
  }
  if (opts.port !== null && opts.command !== 'view') {
    die('--port 只能与 view 一起使用', 2, '示例：yotta-skills view --port 8789。');
  }
  if ((opts.all || opts.inPlace || opts.allowUnverified || opts.from || opts.include.length || opts.as || opts.scan || opts.apply)
    && opts.command !== 'hub') {
    die('--all / --in-place / --allow-unverified / --from / --include / --as / --scan / --apply 只能与 hub 命令一起使用', 2,
      'Hub 用法：yotta-skills hub link --all 或 yotta-skills hub adopt --scan。');
  }
  if (opts.domain && !domainValues().includes(opts.domain)) {
    die('未知 domain: ' + opts.domain + '。可用: ' + domainValues().join(', '), 2, 'domain 对齐家族索引 9 类；用 yotta-skills --list 查看技能清单。');
  }
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

const KNOWN_DOMAINS = ['security', 'quality', 'memory', 'writing', 'workflow', 'entry', 'compliance', 'education', 'distribution'];

function domainValues() {
  const values = new Set(KNOWN_DOMAINS);
  for (const s of MANIFEST) if (s.domain) values.add(s.domain);
  return [...values].sort();
}

function selectSkills(opts) {
  const picked = [];
  const seen = new Set();
  const push = (s) => {
    if (!seen.has(s.slug)) {
      seen.add(s.slug);
      picked.push(s);
    }
  };
  for (const slug of opts.skills) {
    const s = findSkill(slug);
    if (!s) die('未知技能: ' + slug + '（可用: yotta-skills --list）', 2, '请先运行 --list 查看技能名，或检查拼写。');
    push(s);
  }
  for (const slug of opts.only || []) {
    const s = findSkill(slug);
    if (!s) die('未知技能（--only）: ' + slug + '（可用: yotta-skills --list）', 2, '请先运行 --list 查看技能名，或检查拼写。');
    push(s);
  }
  let list = picked.length > 0 ? picked : MANIFEST.slice();
  if (opts.domain) {
    list = list.filter((s) => s.domain === opts.domain);
  }
  return list;
}

function readInstalledVersion(dir) {
  const f = path.join(dir, 'SKILL.md');
  try {
    const text = fs.readFileSync(f, 'utf8');
    const m = text.match(/^version:\s*([0-9]+\.[0-9]+\.[0-9]+)/m);
    return m ? m[1] : null;
  } catch (_) { return null; }
}


// ── 更新检查（只读）与自动更新 ─────────────────────────────────────────────
function registryUrl(pkg, registry) {
  var base = (registry || process.env.YOTTA_SKILLS_REGISTRY || 'https://registry.npmjs.org/').replace(/\/$/, '');
  return base + '/' + pkg.replace(/\//g, '%2f');
}

function fetchRegistryLatest(pkg, opts) {
  return new Promise(function (resolve) {
    var url = registryUrl(pkg, opts.registry);
    var client = url.startsWith('https:') ? https : http;
    var req = client.get(url, { timeout: 15000, headers: { 'accept': 'application/json', 'user-agent': 'yotta-skills-check' } }, function (res) {
      var data = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try {
          var j = JSON.parse(data);
          var latest = j && j['dist-tags'] && j['dist-tags'].latest;
          if (!latest) { resolve({ ok: false, error: '响应缺少 dist-tags.latest（' + pkg + '）' }); return; }
          resolve({ ok: true, version: latest });
        } catch (e) {
          resolve({ ok: false, error: '解析 registry 响应失败: ' + e.message });
        }
      });
    });
    req.on('error', function (e) { resolve({ ok: false, error: '网络错误: ' + (e && e.message ? e.message : e) }); });
    req.on('timeout', function () { req.destroy(); resolve({ ok: false, error: '网络超时（15s）' }); });
  });
}

function readInstalledMeta(dir) {
  var f = path.join(dir, 'SKILL.md');
  try {
    var text = fs.readFileSync(f, 'utf8');
    var name = (text.match(/^name:\s*(.+)$/m) || [])[1];
    var version = (text.match(/^version:\s*([0-9]+\.[0-9]+\.[0-9]+)/m) || [])[1];
    return { name: name ? name.trim() : null, version: version || null };
  } catch (e) { return { name: null, version: null }; }
}

function familySkillFor(slug) {
  var m = findSkill(slug);
  if (m) return m;
  if (/^yotta-/.test(slug)) {
    return { slug: slug, name: slug.replace(/^yotta-/, ''), pkg: '@yottameta/' + slug, version: null, desc: '推断的家族技能（不在 skills.json 清单）' };
  }
  return null;
}

function scanInstalledSlugs(dest) {
  var list = [];
  var entries;
  try { entries = fs.readdirSync(dest, { withFileTypes: true }); } catch (e) { return list; }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e.isDirectory()) continue;
    var meta = readInstalledMeta(path.join(dest, e.name));
    if (meta.name) list.push({ slug: e.name, name: meta.name, version: meta.version });
  }
  return list;
}

async function runUpdateCheck(opts, dest) {
  var lines = [];
  var quiet = !!opts.json;
  function say(s) { if (!quiet) lines.push(s); }
  var scheduled = !!opts.scheduled;
  var cache = updateCheckLib.readCache();
  var target = cache.targets[updateCheckLib.targetKey(dest)] || null;
  var due = updateCheckLib.isDue(target, Date.now());
  if (!scheduled) {
    say('yotta-skills（元阁）v' + VERSION + ' —— 检查更新（只读，不改动） -> ' + dest);
    say('版本源: ' + (opts.registry || process.env.YOTTA_SKILLS_REGISTRY || 'https://registry.npmjs.org/'));
    say('');
  }
  if (scheduled && !due) {
    var cachedRows = (target && target.last_result && target.last_result.rows) || [];
    var cachedPayload = {
      dest: dest,
      scheduled: true,
      due: false,
      checked: false,
      updatable: cachedRows.filter(function (x) { return x.hasUpdate; }),
      updates: (target && target.last_result && target.last_result.updates) || 0,
      latest: (target && target.last_result && target.last_result.latest) || 0,
      failed: 0,
      nonFamily: (target && target.last_result && target.last_result.nonFamily) || 0,
      cache: target,
      error: null,
    };
    if (opts.json) out(JSON.stringify(cachedPayload, null, 2));
    return {
      code: 0,
      scheduled: true,
      due: false,
      checked: false,
      rows: cachedRows,
      updates: cachedPayload.updates,
      latest: cachedPayload.latest,
      failed: 0,
      nonFamily: cachedPayload.nonFamily,
    };
  }
  var installed = scanInstalledSlugs(dest);
  if (installed.length === 0) {
    var emptyResult = { updates: 0, latest: 0, failed: 0, nonFamily: 0, rows: [], errors: [] };
    var emptyCacheRecord = null;
    try {
      emptyCacheRecord = updateCheckLib.recordCheck(os.homedir(), dest, { result: emptyResult, error: null });
    } catch (_) { /* 缓存是后台优化的 best-effort，不阻断检查结果 */ }
    if (!scheduled) {
      say('（' + dest + ' 下未发现已装技能目录）');
      for (var emptyIndex = 0; emptyIndex < lines.length; emptyIndex++) out(lines[emptyIndex]);
    }
    return {
      code: 0,
      scheduled: scheduled,
      due: true,
      checked: true,
      rows: [],
      updates: 0,
      latest: 0,
      failed: 0,
      nonFamily: 0,
      cache: emptyCacheRecord,
    };
  }
  var rows = [];
  var failures = [];
  var updates = 0, latest = 0, failed = 0, nonFamily = 0;
  for (var i = 0; i < installed.length; i++) {
    var it = installed[i];
    var fam = familySkillFor(it.slug);
    if (!fam) {
      nonFamily++;
      say('  - ' + it.slug.padEnd(22) + '非元阁家族，跳过');
      continue;
    }
    var res = await fetchRegistryLatest(fam.pkg, opts);
    if (!res.ok) {
      failed++;
      failures.push({ slug: it.slug, error: res.error });
      say('  ✘ ' + it.slug.padEnd(22) + '检查失败: ' + res.error);
      continue;
    }
    var current = res.version;
    var cur = it.version || null;
    var isUp = (cur === current);
    if (isUp) {
      latest++;
      say('  ✔ ' + it.slug.padEnd(22) + '已最新（本地 v' + cur + '）');
    } else {
      updates++;
      say('  ➤ ' + it.slug.padEnd(22) + '有更新：本地 v' + (cur || '未知') + ' -> 最新 v' + current);
      if (fam.version && fam.version !== current) {
        say('       ⚠ 清单 skills.json 记为 v' + fam.version + '，与 npm 最新 v' + current + ' 不一致（需同步清单）');
      }
    }
    rows.push({ slug: it.slug, installed: cur, latest: current, pkg: fam.pkg, hasUpdate: !isUp, family: fam });
  }
  var result = {
    updates: updates,
    latest: latest,
    failed: failed,
    nonFamily: nonFamily,
    rows: rows,
    errors: failures,
  };
  var lastError = failures.length > 0
    ? failures.map(function (x) { return x.slug + ': ' + x.error; }).join('; ')
    : null;
  var cacheRecord = null;
  try {
    cacheRecord = updateCheckLib.recordCheck(os.homedir(), dest, { result: result, error: lastError });
  } catch (_) { /* 缓存是后台优化的 best-effort，不阻断检查结果 */ }
  var code = (failed > 0) ? 1 : (updates > 0 ? 3 : 0);
  var updatable = rows.filter(function (x) { return x.hasUpdate; });
  if (scheduled) {
    if (updates > 0) {
      for (var j = 0; j < updatable.length; j++) {
        out('  ' + updatable[j].slug + '：本地 v' + (updatable[j].installed || '未知') + ' -> 最新 v' + updatable[j].latest);
      }
    }
    if (opts.json) {
      out(JSON.stringify({
        dest: dest,
        scheduled: true,
        due: true,
        checked: true,
        updatable: updatable,
        updates: updates,
        latest: latest,
        failed: failed,
        nonFamily: nonFamily,
        cache: cacheRecord,
        error: lastError,
      }, null, 2));
    }
    return { code: 0, scheduled: true, due: true, checked: true, rows: rows, updates: updates, latest: latest, failed: failed, nonFamily: nonFamily };
  }
  say('汇总: 有更新 ' + updates + ' / 已最新 ' + latest + ' / 检查失败 ' + failed + ' / 非家族跳过 ' + nonFamily);
  for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) out(lines[lineIndex]);
  if (opts.json) {
    out(JSON.stringify({
      dest: dest,
      updatable: updatable,
      updates: updates,
      latest: latest,
      failed: failed,
      nonFamily: nonFamily,
      cache: cacheRecord,
      error: lastError,
    }, null, 2));
  }
  return { code: code, scheduled: false, due: true, checked: true, rows: rows, updates: updates, latest: latest, failed: failed, nonFamily: nonFamily };
}

async function runUpdateAuto(opts, dest) {
  out('yotta-skills（元阁）v' + VERSION + ' —— 检查并自动更新（仅 yotta-* 家族） -> ' + dest);
  var r = await runUpdateCheck(Object.assign({}, opts, { json: false }), dest);
  if (r.failed > 0) {
    out('检查未完成（' + r.failed + ' 个失败），未自动更新；可先排查网络后重试。');
    return { code: 1 };
  }
  if (r.updates === 0) {
    out('全部已最新，无需更新。');
    return { code: 0 };
  }
  out('');
  out('检测到 ' + r.updates + ' 个家族技能可更新，开始自动更新（安装管线，含装前安全扫描）：');
  var ok = 0, failed2 = 0, autoExitCode = 0;
  for (var i = 0; i < r.rows.length; i++) {
    var row = r.rows[i];
    if (!row.hasUpdate) continue;
    var res = installOne(
      Object.assign({}, row.family, { version: row.latest }),
      dest,
      Object.assign({}, opts, { force: true, pin: true, skipScan: false }),
    );
    if (res.status === 'ok') ok++;
    else if (res.status === 'skip') ok++;
    else {
      failed2++;
      autoExitCode = Math.max(autoExitCode, res.exitCode || 1);
      out('  ✘ ' + row.slug + '  失败: ' + res.note);
    }
  }
  out('');
  out('自动更新汇总: 成功 ' + ok + ' / 失败 ' + failed2);
  if (failed2 === 0) maybeAutoReindex(opts, dest);
  return { code: failed2 > 0 ? autoExitCode : 0 };
}

// 复制原语（顶层跳过口径 / 缓存清理）统一在 lib/copy-tree.js，此处不再保留第二份实现。

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

// ── 元信 scan 与安装门禁 ──────────────────────────────────────────────────
function findVerifyEngine(dest, opts) {
  // v0.19.13：不再用注册表（身份来自被扫描技能自己的 frontmatter）发现校验器，
  // 只认安装管线写入的受信记录（路径 + 摘要双绑定）。
  return hubScanLib.findVerifyEngine(dest, opts);
}

/** 安装 / 更新元信成功后写入受信记录（身份 + 摘要），后续门禁只认这份记录。 */
function recordTrustedVerifier(dest) {
  const engine = path.join(dest, 'yotta-verify', 'scripts', 'yotta_verify.py');
  const check = trustedVerifierLib.verifyEngine(engine, { requireRecord: false });
  if (!check.ok) return null;
  const record = {
    slug: check.info.slug,
    package: check.info.package,
    version: check.info.version,
    path: check.path,
    sha256: check.info.sha256,
    recordedAt: new Date().toISOString(),
  };
  trustedVerifierLib.saveRecord(record);
  return record;
}

function findPython(opts) {
  return hubScanLib.findPython(opts);
}

function runScan(engine, skillDir, opts) {
  return hubScanLib.runScan(engine, skillDir, opts);
}

function scanTarget(engine, skillDir, context) {
  const ctx = context || {};
  const scan = runScan(engine, skillDir, ctx.opts);
  if (!scan.ok) {
    out('  元信 scan: ' + scan.error);
    return scan;
  }
  const reviewed = scanPolicyLib.applyScanPolicy(scan, {
    slug: ctx.slug,
    version: ctx.version,
    pkgDir: skillDir,
    policy: scanPolicyLib.loadPolicy(path.join(PKG_ROOT, 'scan-policy.json')),
  });
  const counts = scan.counts || {};
  const line = 'critical ' + (counts.critical || 0) + ' / high ' + (counts.high || 0) +
    ' / medium ' + (counts.medium || 0) + ' / low ' + (counts.low || 0) +
    ' / info ' + (counts.info || 0);
  out('  元信 scan: ' + scan.verdict + '（' + line + '）');
  if (reviewed.policy && reviewed.policy.applied && reviewed.policy.excluded > 0) {
    out('  ↳ scanPolicy 复核：豁免 ' + reviewed.policy.excluded +
      ' 条已审查发现（检测规则 / 文档说明，treeHash 绑定）→ ' + reviewed.verdict);
  }
  if (reviewed.verdict === gateLib.BLOCK) out('  ⚠ 元信 verdict 为 DO NOT INSTALL，已阻断安装。');
  else if (reviewed.verdict === gateLib.CAUTION || reviewed.verdict === gateLib.REVIEW) {
    out('  ⚠ 元信 verdict 为 ' + reviewed.verdict + '，继续安装并保留风险证据。');
  }
  return reviewed;
}

/** doctor 依赖自检（只告警不失败）：node / npm / python / tar 四项。 */
function probeDependencies(opts) {
  const npm = resolveNpm(opts);
  const npmProbe = spawnSync(npm.bin, [...npm.prefix, '--version'], {
    encoding: 'utf8',
    timeout: 15000,
    shell: npm.shell,
  });
  const python = findPython(opts);
  const pythonProbe = python
    ? spawnSync(python, ['--version'], { encoding: 'utf8', timeout: 15000 })
    : null;
  const tarProbe = spawnSync(tarBin(), ['--version'], { encoding: 'utf8', timeout: 15000 });
  return depsLib.dependencyReport({
    node: depsLib.nodeCheck(),
    npm: { found: !!(npmProbe && npmProbe.status === 0), version: depsLib.versionLine(npmProbe) },
    python: { found: !!python, version: depsLib.versionLine(pythonProbe), path: python || null },
    tar: { found: !!(tarProbe && tarProbe.status === 0), version: depsLib.versionLine(tarProbe) },
  });
}

// ── 安装 ───────────────────────────────────────────────────────────────────
const runNpmPackBase = npmPackLib.createPackRunner({ spawnSync, specOf, resolveNpm });

function fetchMode() {
  const raw = String(process.env.YOTTA_SKILLS_FETCH || 'auto').trim().toLowerCase();
  return raw === 'builtin' || raw === 'npm' ? raw : 'auto';
}

function extractMode() {
  const raw = String(process.env.YOTTA_SKILLS_EXTRACT || 'auto').trim().toLowerCase();
  return raw === 'builtin' || raw === 'tar' ? raw : 'auto';
}

/**
 * 拉包：默认内置通道（Node 内置 https，零 npm），失败回退 npm pack。
 * YOTTA_SKILLS_FETCH=builtin 禁用回退；=npm 直接走 npm（显式选择 / 离线测试）。
 */
function runNpmPack(skill, opts, packDir) {
  const mode = fetchMode();
  let builtin = null;
  if (mode !== 'npm') {
    builtin = registryFetchLib.fetchPackageSync(skill, opts, packDir);
    if (!builtin.error) return builtin;
  }
  if (mode === 'builtin') {
    return { error: '内置拉包失败（YOTTA_SKILLS_FETCH=builtin 已禁用 npm 回退）: ' + builtin.error };
  }
  const packed = runNpmPackBase(skill, opts, packDir);
  if (packed.error) {
    const detail = packed.detail || packed.error;
    let message = '拉包失败（内置 + npm 双通道）: 内置=' + (builtin ? builtin.error : '未启用') + '；npm=' + packed.error;
    if (depsLib.isNpmMissing(detail)) {
      message += '\n' + depsLib.describe('npm', { command: currentCommand(), missing: true });
    }
    return { error: message, detail };
  }
  packed.channel = 'npm';
  if (builtin) {
    packed.fallbackFrom = builtin.error;
    out('  ↳ 拉包通道：内置失败（' + builtin.error + '）→ npm 回退成功');
  }
  if (packed.registryFallback) {
    out('  ↳ npm 默认源 404，已用官方源重试成功（' + npmPackLib.OFFICIAL_REGISTRY + '）');
  }
  return packed;
}

function extractWithSystemTar(tarball, extractDir) {
  const packDir = path.dirname(tarball);
  const tarballName = path.basename(tarball);
  fs.mkdirSync(extractDir, { recursive: true });
  // 传相对文件名给 tar，避免 Windows 盘符被 MSYS tar 当成远端 host。
  const listed = spawnSync(tarBin(), ['-tzf', tarballName], { cwd: packDir, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (listed.status !== 0) {
    return { error: (listed.stderr || listed.stdout || 'tar 列表读取失败').trim().split('\n').pop() };
  }
  const entries = String(listed.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const unsafe = entries.find((entry) => !isSafeTarEntry(entry));
  if (unsafe) return { error: '压缩包包含不安全路径: ' + unsafe };
  const relativeTarball = path.relative(extractDir, tarball).replace(/\\/g, '/');
  const r = spawnSync(tarBin(), ['-xzf', relativeTarball], { cwd: extractDir, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || 'tar 解压失败').trim().split('\n').pop() };
  const pkgDir = path.join(extractDir, 'package');
  if (!fs.existsSync(path.join(pkgDir, 'SKILL.md'))) return { error: '解压产物缺少 SKILL.md（' + tarball + '）' };
  return { pkgDir };
}

/**
 * 解包：默认内置（zlib + tar 解析），失败回退系统 tar；
 * YOTTA_SKILLS_EXTRACT=builtin 禁用回退；=tar 直接走系统 tar。
 */
function extractTarball(tarball, extractDir) {
  const mode = extractMode();
  let builtin = null;
  if (mode !== 'tar') {
    builtin = untarLib.extractTarballBuiltin(tarball, extractDir);
    if (!builtin.error) return builtin;
  }
  if (mode === 'builtin') {
    return { error: '内置解包失败（YOTTA_SKILLS_EXTRACT=builtin 已禁用 tar 回退）: ' + builtin.error };
  }
  const fallback = extractWithSystemTar(tarball, extractDir);
  if (fallback.error) {
    const message = '解包失败（内置 + 系统 tar 双通道）: 内置=' + (builtin ? builtin.error : '未启用') + '；tar=' + fallback.error +
      '\n' + depsLib.describe('tar', { command: currentCommand(), missing: true });
    return { error: message };
  }
  if (builtin) {
    out('  ↳ 解包通道：内置失败（' + builtin.error + '）→ 系统 tar 回退成功');
    fallback.fallbackFrom = builtin.error;
  }
  fallback.channel = 'tar';
  return fallback;
}

function ensureGate(context) {
  const { skill, extracted, dest, opts } = context;
  const current = findVerifyEngine(dest, opts);
  if (current) {
    return {
      ok: true,
      engine: current,
      mode: opts.bootstrap ? 'trusted-bootstrap' : 'installed',
    };
  }
  if (skill.slug === 'yotta-verify') {
    const engine = path.join(extracted.pkgDir, 'scripts', 'yotta_verify.py');
    if (!fs.existsSync(engine)) return { ok: false, error: '元信包内缺少 scripts/yotta_verify.py' };
    return { ok: true, engine, mode: 'trusted-bootstrap' };
  }

  const verifier = findSkill('yotta-verify');
  if (!verifier) return { ok: false, error: 'skills.json 缺少 yotta-verify' };
  let tmp;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-verify-bootstrap-'));
    const packDir = path.join(tmp, 'pack');
    fs.mkdirSync(packDir, { recursive: true });
    const packed = runNpmPack(verifier, opts, packDir);
    if (packed.error) return { ok: false, error: '元信自举下载失败: ' + packed.error };
    const extractDir = path.join(tmp, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });
    const extractedVerifier = extractTarball(packed.tarball, extractDir);
    if (extractedVerifier.error) return { ok: false, error: '元信自举解包失败: ' + extractedVerifier.error };
    const engine = path.join(extractedVerifier.pkgDir, 'scripts', 'yotta_verify.py');
    if (!fs.existsSync(engine)) return { ok: false, error: '元信包内缺少 scripts/yotta_verify.py' };

    out('  元信未安装，使用可信源包自举并先自扫。');
    const result = installOne(verifier, dest, {
      ...opts,
      force: true,
      skipScan: false,
      bootstrap: true,
      verify: engine,
    });
    if (result.status !== 'ok') return { ok: false, error: '元信自举失败: ' + result.note };
    const installedEngine = path.join(dest, 'yotta-verify', 'scripts', 'yotta_verify.py');
    if (!fs.existsSync(installedEngine)) return { ok: false, error: '元信自举后未找到安装引擎' };
    if (!recordTrustedVerifier(dest)) {
      return { ok: false, error: '元信自举后身份 / 摘要校验未通过（fail-closed，不执行该引擎）' };
    }
    return { ok: true, engine: installedEngine, mode: 'trusted-bootstrap' };
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const installOne = createInstaller({
  runNpmPack,
  extractTarball,
  copyDir: (src, dst) => copyDir(src, dst, COPY_SKIP, true),
  readInstalledVersion,
  ensureGate,
  scanTarget,
  appendEvidence: evidenceLib.appendEvidence,
});

function runInstall(opts, dest) {
  const skills = selectSkills(opts);
  if (skills.length === 0) {
    out('过滤后没有匹配的技能（--only / --domain），未执行任何操作。');
    process.exitCode = 2;
    return { failed: 1, exitCode: 2 };
  }
  out('yotta-skills（元阁）v' + VERSION + ' —— 安装 ' + skills.length + ' 个技能 -> ' + dest);
  out('版本策略: ' + (opts.pin ? 'pin（锁死清单精确版本，默认）' : 'range（' + skillRange(skills[0]) + '，跟随最新 patch）'));
  const results = [];
  let failed = 0;
  let exitCode = 0;
  for (const s of skills) {
    const r = installOne(s, dest, opts);
    results.push(r);
    if (r.status === 'ok') {
      if (r.gate && r.gate.mode === 'explicit-unverified') {
        out('  ⚠ ' + s.slug.padEnd(22) + '未执行装前扫描（explicit-unverified）');
      }
      if (s.slug === 'yotta-verify') recordTrustedVerifier(dest);
      out('  ✔ ' + s.slug.padEnd(22) + s.name + '  -> ' + (r.version || '?'));
    }
    else if (r.status === 'skip') out('  - ' + s.slug.padEnd(22) + s.name + '  （' + r.note + '，v' + r.version + '）');
    else {
      failed++;
      exitCode = Math.max(exitCode, r.exitCode || 1);
      out('  ✘ ' + s.slug.padEnd(22) + s.name + '  失败: ' + r.note);
    }
  }
  const ok = results.filter(r => r.status === 'ok').length;
  const skip = results.filter(r => r.status === 'skip').length;
  out('');
  out('汇总: 成功 ' + ok + ' / 跳过(已是最新) ' + skip + ' / 失败 ' + failed + '（共 ' + results.length + '）');
  if (failed > 0) process.exitCode = exitCode || 1;
  return { failed, exitCode };
}

function runUpdate(opts, dest) {
  let skills = selectSkills(opts);
  out('yotta-skills（元阁）v' + VERSION + ' —— 增量更新 -> ' + dest);
  if (opts.installedOnly) {
    const candidates = skills.length;
    skills = skills.filter((s) => readInstalledVersion(path.join(dest, s.slug)) !== null);
    out('范围: 仅已安装技能（--installed-only；候选 ' + candidates + ' / 已装 ' + skills.length + '）');
    if (skills.length === 0) {
      out('目标目录未发现已安装的元阁家族技能，无动作（退出码 0）。');
      return { failed: 0, exitCode: 0 };
    }
  } else if (skills.length === 0) {
    out('过滤后没有匹配的技能（--only / --domain），未执行任何操作。');
    process.exitCode = 2;
    return { failed: 1, exitCode: 2 };
  }
  const results = [];
  let failed = 0;
  let exitCode = 0;
  for (const s of skills) {
    const existing = readInstalledVersion(path.join(dest, s.slug));
    if (existing === s.version) {
      out('  - ' + s.slug.padEnd(22) + s.name + '  （已是最新，v' + existing + '）');
      results.push({ skill: s, status: 'skip', version: existing });
      continue;
    }
    const r = installOne(s, dest, opts);
    results.push(r);
    if (r.status === 'ok') {
      if (r.gate && r.gate.mode === 'explicit-unverified') {
        out('  ⚠ ' + s.slug.padEnd(22) + '未执行装前扫描（explicit-unverified）');
      }
      if (s.slug === 'yotta-verify') recordTrustedVerifier(dest);
      out('  ✔ ' + s.slug.padEnd(22) + s.name + '  -> ' + (r.version || '?') + (existing ? '（原 v' + existing + '）' : '（新装）'));
    }
    else if (r.status === 'skip') out('  - ' + s.slug.padEnd(22) + s.name + '  （' + r.note + '）');
    else {
      failed++;
      exitCode = Math.max(exitCode, r.exitCode || 1);
      out('  ✘ ' + s.slug.padEnd(22) + s.name + '  失败: ' + r.note);
    }
  }
  const ok = results.filter(r => r.status === 'ok').length;
  const skip = results.filter(r => r.status === 'skip').length;
  out('');
  out('汇总: 更新 ' + ok + ' / 已是最新 ' + skip + ' / 失败 ' + failed);
  if (failed > 0) process.exitCode = exitCode || 1;
  return { failed, exitCode };
}

// ── doctor / rollback ─────────────────────────────────────────────────────
function readInstalledManifest(target) {
  const file = path.join(target, 'skill-manifest.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function runCustomDoctor(skillDir, dest) {
  const manifest = readInstalledManifest(skillDir);
  if (!manifest || !manifest.install || !manifest.install.doctor) {
    return { ok: true, skipped: true, error: null, result: null };
  }
  if (manifest.trust !== 'yottameta') {
    return {
      ok: false,
      skipped: false,
      error: 'manifest trust 不是 yottameta，拒绝执行自定义 doctor',
      result: null,
    };
  }
  return lifecycleLib.runPhase(skillDir, manifest, 'doctor', {
    skillDir,
    packageDir: skillDir,
    dest,
  });
}

function withDoctorTarget(skill, target) {
  return Object.assign({}, skill, { target });
}

function selfDoctorTarget(dest) {
  const meta = readInstalledMeta(dest);
  const manifest = readInstalledManifest(dest);
  const candidates = [
    manifest && manifest.slug,
    meta.name,
    path.basename(dest),
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  for (const slug of candidates) {
    const skill = familySkillFor(slug);
    if (skill) return withDoctorTarget(skill, dest);
  }
  return null;
}

function doctorTargets(opts, dest) {
  const self = selfDoctorTarget(dest);
  if (opts.slug) {
    if (self && self.slug === opts.slug) return [self];
    const skill = familySkillFor(opts.slug);
    return skill ? [withDoctorTarget(skill, path.join(dest, skill.slug))] : [];
  }
  if (opts.skills.length) {
    const targets = [];
    for (const slug of opts.skills) {
      if (self && self.slug === slug) {
        targets.push(self);
        continue;
      }
      const skill = familySkillFor(slug);
      if (skill) targets.push(withDoctorTarget(skill, path.join(dest, skill.slug)));
    }
    return targets;
  }
  const found = [];
  let entries;
  try { entries = fs.readdirSync(dest, { withFileTypes: true }); } catch (_) { return self ? [self] : found; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^yotta-/.test(entry.name)) continue;
    const skill = familySkillFor(entry.name);
    if (skill) found.push(withDoctorTarget(skill, path.join(dest, skill.slug)));
  }
  if (found.length === 0 && self) return [self];
  return found;
}

function doctorExitCode(payload) {
  if (payload.ok) return 0;
  if (payload.checked === 0) return 4;
  const manifestFailure = payload.results.some((result) =>
    (result.checks || []).some((check) =>
      (check.id === 'manifest' || check.id === 'manifest_trust') && !check.ok));
  return manifestFailure ? 6 : 1;
}

function runDoctor(opts, dest) {
  const scan = require('../lib/skills-scan');
  const registry = scan.readRegistry();
  const targets = doctorTargets(opts, dest);
  const results = [];
  const errors = [];
  const warnings = [];
  const fixes = [];

  if (targets.length === 0) {
    errors.push(opts.slug ? '未找到技能: ' + opts.slug : '目标目录下没有可检查的元阁家族技能');
  }

  for (const skill of targets) {
    const target = skill.target || path.join(dest, skill.slug);
    const result = healthLib.checkInstalledSkill({
      slug: skill.slug,
      target,
      expectedVersion: skill.version || null,
      expectedPackage: skill.pkg || null,
      registry,
    });
    const custom = runCustomDoctor(target, dest);
    result.custom_doctor = {
      ok: !!custom.ok,
      skipped: !!custom.skipped,
      error: custom.error || null,
      result: custom.result || null,
    };
    if (!custom.ok) {
      result.ok = false;
      result.errors.push('自定义 doctor 失败: ' + (custom.error || '未知错误'));
      result.checks.push({
        id: 'custom_doctor',
        ok: false,
        severity: 'error',
        message: '自定义 doctor 失败: ' + (custom.error || '未知错误'),
        hint: '修复技能包内的 doctor 脚本后重试',
      });
    } else if (!custom.skipped) {
      result.checks.push({
        id: 'custom_doctor',
        ok: true,
        severity: 'info',
        message: '自定义 doctor 通过',
        hint: null,
      });
    }
    results.push(result);
    errors.push.apply(errors, result.errors);
    warnings.push.apply(warnings, result.warnings);
    fixes.push.apply(fixes, result.fixes);
  }

  const dependencies = probeDependencies(opts);
  const payload = {
    ok: errors.length === 0,
    dir: dest,
    checked: results.length,
    results,
    errors,
    warnings,
    fixes: Array.from(new Set(fixes)),
    dependencies,
  };
  const code = doctorExitCode(payload);
  if (opts.json) {
    out(JSON.stringify(payload, null, 2));
  } else {
    out('yotta-skills（元阁）v' + VERSION + ' —— doctor');
    out('目标: ' + dest);
    for (const result of results) {
      out('');
      out((result.ok ? '✔ ' : '✘ ') + result.slug + ' v' + (result.version || '未知'));
      for (const check of result.checks) {
        out('  ' + (check.ok ? '✔' : '✘') + ' ' + check.message + (check.hint ? '（修复: ' + check.hint + '）' : ''));
      }
    }
    out('');
    out('依赖自检（只告警不失败）:');
    for (const dep of dependencies) {
      const mark = dep.ok ? '✔' : (dep.optional ? '△' : '✘');
      out('  ' + mark + ' ' + dep.name + (dep.version ? ' ' + dep.version : '') +
        '（需要 ' + dep.need + (dep.optional ? '；回退通道，可选' : '') + '）' +
        (dep.ok ? '' : ' —— 影响：' + dep.why));
      if (!dep.ok && dep.fix) out('      修复：' + dep.fix);
    }
    for (const item of warnings) out('[警告] ' + item);
    for (const item of fixes) out('[建议] ' + item);
    if (!payload.ok) out('doctor 未通过：请按上面的修复建议处理后重试。');
  }
  process.exitCode = code;
  return payload;
}

function latestRollbackTarget(home) {
  const file = path.join(home, '.yottaskills', 'install-log.jsonl');
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean); } catch (_) { return null; }
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch (_) { continue; }
    if (!entry.skill || !entry.snapshot) continue;
    if (!fs.existsSync(entry.snapshot)) continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.skill)) continue;
    const expectedRoot = path.resolve(snapshotLib.snapshotRoot(home, entry.skill)) + path.sep;
    if (!path.resolve(entry.snapshot).startsWith(expectedRoot)) continue;
    const validation = snapshotLib.validateSnapshot(entry.snapshot);
    if (validation.ok) return { slug: entry.skill, snapshot: entry.snapshot };
  }
  return null;
}

function runRollback(opts, dest) {
  const home = os.homedir();
  const requestedSlug = opts.slug || (opts.skills.length ? opts.skills[0] : null);

  if (opts.list) {
    const rows = snapshotLib.listSnapshots(home, requestedSlug);
    const payload = {
      ok: true,
      dir: dest || null,
      slug: requestedSlug || null,
      count: rows.filter((row) => row.valid).length,
      snapshots: rows,
    };
    if (opts.json) out(JSON.stringify(payload, null, 2));
    else {
      out('yotta-skills（元阁）v' + VERSION + ' —— rollback 快照');
      for (const row of rows) {
        out('  ' + (row.valid ? '✔' : '✘') + ' ' + row.slug + ' v' + (row.version || '未知') + '  ' + row.path + (row.reason ? '（' + row.reason + '）' : ''));
      }
      out('可用快照: ' + payload.count + ' / ' + rows.length);
    }
    return payload;
  }

  let slug = requestedSlug;
  let selected = null;
  if (slug) {
    const rows = snapshotLib.listSnapshots(home, slug);
    selected = rows.find((row) => row.valid) || rows[0] || null;
  } else {
    const latest = latestRollbackTarget(home);
    if (latest) {
      slug = latest.slug;
      selected = snapshotLib.listSnapshots(home, slug).find((row) => row.path === latest.snapshot && row.valid) || null;
    }
  }

  if (!slug) {
    const payload = { ok: false, dir: dest, slug: null, errors: ['安装记录中没有可回滚的技能快照'] };
    if (opts.json) out(JSON.stringify(payload, null, 2));
    else out('回滚失败：安装记录中没有可回滚的技能快照。');
    process.exitCode = 1;
    return payload;
  }
  if (!selected || !selected.valid) {
    const payload = {
      ok: false,
      dir: dest,
      slug,
      errors: [selected && selected.reason ? '选中的快照不可用: ' + selected.reason : '没有可用快照'],
    };
    if (opts.json) out(JSON.stringify(payload, null, 2));
    else out('回滚失败：' + payload.errors[0]);
    process.exitCode = 1;
    return payload;
  }

  const target = path.join(dest, slug);
  const restored = snapshotLib.restoreSnapshot(selected.path, target);
  if (!restored.ok) {
    const payload = { ok: false, dir: dest, slug, snapshot: selected.path, errors: [restored.error] };
    if (opts.json) out(JSON.stringify(payload, null, 2));
    else out('回滚失败：' + restored.error);
    process.exitCode = 1;
    return payload;
  }

  const family = familySkillFor(slug);
  const scan = require('../lib/skills-scan');
  const doctor = healthLib.checkInstalledSkill({
    slug,
    target,
    expectedVersion: restored.version && restored.version !== 'unknown' ? restored.version : null,
    expectedPackage: family ? family.pkg : null,
    registry: scan.readRegistry(),
  });
  const custom = runCustomDoctor(target, dest);
  if (!custom.ok) {
    doctor.ok = false;
    doctor.errors.push('自定义 doctor 失败: ' + (custom.error || '未知错误'));
  }

  const payload = {
    ok: doctor.ok,
    dir: dest,
    slug,
    snapshot: selected.path,
    version: restored.version,
    doctor,
    errors: doctor.errors,
    warnings: doctor.warnings,
    fixes: doctor.fixes,
    reindexed: false,
  };
  try {
    evidenceLib.appendEvidence({
      event: 'rollback',
      skill: slug,
      package: family ? family.pkg : null,
      version: restored.version,
      decision: doctor.ok ? 'ok' : 'fail',
      snapshot: selected.path,
    }, { homeDir: home });
  } catch (error) {
    payload.ok = false;
    payload.errors.push('回滚证据写入失败: ' + error.message);
  }
  if (payload.ok && !opts.noReindex) {
    try {
      reindexRegistry({ ...opts, dir: dest });
      payload.reindexed = true;
    } catch (error) {
      payload.warnings.push('回滚完成，但注册表重扫失败: ' + error.message);
    }
  }

  if (opts.json) {
    out(JSON.stringify(payload, null, 2));
  } else {
    out('yotta-skills（元阁）v' + VERSION + ' —— rollback');
    out('技能: ' + slug);
    out('快照: ' + selected.path);
    out('结果: ' + (payload.ok ? '✔ 已恢复 v' + (restored.version || '未知') : '✘ 恢复后 doctor 未通过'));
    if (payload.errors.length) out('错误: ' + payload.errors.join('; '));
    if (payload.warnings.length) out('警告: ' + payload.warnings.join('; '));
    if (payload.reindexed) out('已重扫本地技能注册表。');
  }
  process.exitCode = payload.ok ? 0 : 1;
  return payload;
}

// ── 展示 ───────────────────────────────────────────────────────────────────
function printList(opts) {
  const skills = opts.skills.length ? selectSkills(opts) : MANIFEST;
  out('yotta-skills（元阁）v' + VERSION + ' —— 全家技能清单（' + skills.length + ' 个）');
  out('版本策略: ' + (opts.pin ? 'pin（精确锁定，默认）' : 'range（' + skillRange(skills[0]) + ' 起，跟随最新 patch）'));
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
  out('  yotta-skills update --installed-only --dir <path>  只维护已装技能（接管现有元技能的标准配方）');
  out('  yotta-skills update --check         只读联网检查更新（退出码 0/3/1）');
  out('  yotta-skills update --check --scheduled  后台周检（未到期不联网；到期单次检查并写缓存）');
  out('  yotta-skills doctor --dir <path>    只读自检技能目录（可加 --slug / --json）');
  out('  yotta-skills rollback --dir <path>  回滚最近一次技能安装或更新（--list 查看快照）');
  out('  yotta-skills --dry-run              预览将安装清单（不联网、不改动）');
  out('  yotta-skills --inventory            盘点本机已装技能（自研扫描，不依赖任何元技能）');
  out('  yotta-skills --reindex              重扫注册表（手动触发；install / update 完成后 CLI 自动重扫）');
  out('  yotta-skills --route "<需求摘要>"   给出场景组合、调用顺序、缺失技能安装建议');
  out('  yotta-skills usage status            查看本地使用记录开关与计数');
  out('  yotta-skills usage enable|disable    开启 / 关闭 --route 的结构化使用记录');
  out('  yotta-skills usage mark --skill <slug> --signal used|named|accepted');
  out('  yotta-skills hook capabilities       查看宿主六事件能力矩阵');
  out('  yotta-skills hook evaluate --event <event> --manifest <file>  评估 hook 声明并留证');
  out('  yotta-skills hook bind --manifest <file>  注册 hook 声明（幂等）');
  out('  yotta-skills hook unbind <binding-id>  反注册 hook 声明');
  out('  yotta-skills hub hosts              发现本机已装智能体与技能目录（不读元忆）');
  out('  yotta-skills hub install [skill...]  把元技能装进本机 Hub（单点真源）');
  out('  yotta-skills hub adopt --scan        只读预演：扫描各宿主现有技能，输出收编候选与冲突');
  out('  yotta-skills hub adopt --apply       把选中技能复制进 Hub（默认保留原目录；--in-place 原地登记）');
  out('  yotta-skills hub refresh <slug> --from <path>  手动同步非元阁技能（无统一更新源）');
  out('  yotta-skills hub link --all          把 Hub 技能链接到全部已发现宿主（junction / symlink）');
  out('  yotta-skills hub link --agent <id>   只链接到一个宿主（未知宿主用 --dir）');
  out('  yotta-skills hub unlink --all        只删除链接，不动 Hub 真源（fail-closed）');
  out('  yotta-skills hub status              查看 Hub 技能 / 来源 / 链接 / 宿主');
  out('  yotta-skills hub doctor              检查断链 / 目标缺失 / slug 不一致 / 目录权限');
  out('  yotta-skills view                    启动本机技能枢纽面板（127.0.0.1:8789）');
  out('  yotta-skills view --port <端口>       指定面板端口（仅本机监听）');
  out('');
  out('选项:');
  out('  --agent <name>   智能体键名（--list 可查看；未知智能体请用 --dir）');
  out('  --dir <path>     目标技能目录（技能会装到 <path>/<slug>）');
  out('  --pin            锁死清单精确版本（默认）');
  out('  --range          跟随同 major 最新 patch（非默认：显式指定后才浮动跟随）');
  out('  --force          已是最新也重装');
  out('  --skip-scan      跳过元信装前 scan（装了 yotta-verify 自动启用）');
  out('  --only <a,b>     install / update 只处理指定技能（与位置参数技能列表合并去重）');
  out('  --domain <name>  install / update 只处理指定家族（security / quality / memory / writing / workflow / entry / compliance / education / distribution）');
  out('  --installed-only update 只维护目标目录已安装的技能（不补装缺失；无匹配时退出码 0）');
  out('  --npm <path>     指定 npm 可执行文件（默认 npm / npm.cmd）');
  out('  --python <path>  指定 python 可执行文件（元信 scan 用）');
  out('  --verify <path>  指定 yotta_verify.py 路径（默认找目标目录已装的元信）');
  out('  --json            inventory / reindex / route / doctor / rollback 时输出 JSON');
  out('  --slug <slug>     doctor / rollback 时只处理指定技能');
  out('  --route <需求>    静态编排路由（输出组合 / 顺序 / 依据 / 缺失技能建议）');
  out('  --check            update 时仅只读检查更新（联网对 npm 最新版本，不改动；退出码 0/3/1）');
  out('  --scheduled        与 update --check 合用：后台周检入口（未到期不联网；到期单次检查并写缓存）');
  out('  --auto             update 时检查到家族更新后自动更新（仅 yotta-* 家族，含装前扫描）');
  out('  --registry <url>  npm registry 地址（默认 https://registry.npmjs.org/；YOTTA_SKILLS_REGISTRY 覆盖）');
  out('  --host <name>     hook 适配宿主名（默认 generic；当前已实测 codex）');
  out('  --event <event>   hook 六事件之一（before_start / before_tool / before_install / before_publish / after_milestone / before_send）');
  out('  --manifest <file> hook evaluate / bind 使用的 skill-manifest.json 路径');
  out('  --context <json>  hook evaluate 的检查结果 JSON（checks / wrapperRegistered / evidence）');
  out('  --skill <slug>    usage mark 的技能 slug');
  out('  --signal <name>   usage mark 的信号：used / named / accepted');
  out('  --yes             usage reset 确认清空');
  out('  --explain         decide-memory 文本报告追加信号明细');
  out('  --promote         decide-memory 只写本地建议文件（不写元忆）');
  out('  --hub <path>      Hub 目录（默认 ~/.yottaskills/hub；YOTTA_SKILLS_HUB 覆盖）');
  out('  --port <n>        view 面板端口（默认 8789；仅 127.0.0.1 监听）');
  out('  --all             hub link / unlink 时作用于全部已发现宿主');
  out('  --scan            hub adopt 只读预演（默认行为）');
  out('  --apply           hub adopt 执行收编');
  out('  --in-place        hub adopt 原地登记，不复制（原目录删除即断链）');
  out('  --allow-unverified 显式允许未扫描导入（默认 high / critical 阻断）');
  out('  --project         inventory / reindex 时附加扫描当前项目 .agents/skills / .codex/skills');
  out('  --no-reindex      安装 / 更新后不自动重扫注册表');
  out('  -h, --help       帮助');
  out('  -v, --version    版本');
  out('');
  out('支持智能体: ' + Object.keys(AGENT_DIRS).length + ' 个已收录映射（本机实际发现用 yotta-skills hub hosts）');
  out('依赖: Node.js 18+（必需）；npm 与系统 tar 为回退通道（内置拉包 / 内置解包为主）；元信 scan 需要 Python 3.8+（--python / YOTTA_SKILLS_PYTHON 可指向宿主自带 Python）。');
  out('环境变量: YOTTA_SKILLS_FETCH（builtin|npm）/ YOTTA_SKILLS_EXTRACT（builtin|tar）/ YOTTA_SKILLS_NPM / YOTTA_SKILLS_PYTHON / YOTTA_SKILLS_VERIFY / YOTTA_SKILLS_NPM_FLAGS / YOTTA_SKILLS_REGISTRY / YOTTA_SKILLS_REGISTRY_FILE / YOTTA_SKILLS_MANIFEST 可覆盖。');
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

/** --reindex：重扫 + 增量合并，变化聚焦输出（手动触发 / 供钩子或脚本调用）。 */
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

/**
 * o1.route 动态扩展口：静态结果先算必算；provider 只允许在已装注册表白名单内增补 / 重排，
 * 任何失败都回静态结果（fail-open）。协议见 references/provider-protocol.md。
 */
function applyDynamicRoute(result, registry, opts) {
  const provider = require('../lib/provider');
  const { PLAYBOOKS } = require('../lib/route');
  const usage = usageJournalLib.readUsage();
  const payload = routeFeaturesLib.buildRouteFeatures({
    request: String(opts.route || ''),
    registry,
    staticResult: result,
    usage,
    playbooks: PLAYBOOKS,
  });
  let run;
  try {
    run = provider.runCapability('o1.route', payload);
  } catch (e) {
    return routeDynamicLib.dynamicBlock('error', '', '动态路由装载失败：' + e.message);
  }
  const block = routeDynamicLib.dynamicBlock(run.status, run.provider_id, run.note || run.message || '');
  if (run.status !== 'active' || !run.data || typeof run.data !== 'object') return block;
  return routeDynamicLib.applyDynamicData(result, run.data, registry, {
    providerId: run.provider_id,
  });
}

function dynamicRouteText(block) {
  if (!block) return '';
  if (block.status === 'active') {
    const who = block.provider_id ? '提供方 ' + block.provider_id : '提供方';
    const confidence = block.confidence ? '；置信度 ' + block.confidence : '';
    return '已应用（' + who + confidence + '；新增 ' + block.added.length + ' / 丢弃 ' + block.dropped.length + '）';
  }
  if (block.status === 'license_required') return '需授权（该能力需要授权后使用；静态路由不受影响）';
  if (block.status === 'timeout') return '未生效（提供方超时，已回落静态路由）';
  if (block.status === 'invalid_output') return '未生效（提供方输出无效，已回落静态路由）';
  if (block.status === 'error') return '未生效（提供方异常，已回落静态路由）';
  return block.status;
}

/** --route：静态编排路由，输出组合、顺序、角色、缺失技能建议与其他已装技能候选。 */
function runRoute(opts) {
  const { routeRequest, defaultYottaSlugs } = require('../lib/route');
  const { registry } = reindexRegistry(opts);
  const yottaSlugs = new Set([...defaultYottaSlugs(), ...MANIFEST.map((s) => s.slug)]);
  const result = routeRequest(opts.route, { registry, yottaSlugs });
  result.dynamic = applyDynamicRoute(result, registry, opts);
  try {
    usageJournalLib.recordRoute({
      playbook: result.playbook.id,
      confidence: result.confidence,
      skills: result.skills.map((skill) => skill.slug),
    });
  } catch (_) {
    // 使用记录失败不阻断路由
  }
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
    const status = skill.installed
      ? '已装' + (skill.version ? ' v' + skill.version : '')
      : '缺失';
    const conflictHint = skill.conflicts && skill.conflicts.length
      ? '（其他副本: ' + skill.conflicts
        .map((item) => (item.source || '其他') + ' v' + (item.version || '?'))
        .join('、') + '）'
      : '';
    out('  ' + skill.order + '. ' + skill.slug + ' [' + status + '] - ' + skill.role + conflictHint);
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
  if (result.dynamic.status !== 'not_installed') {
    out('');
    out('动态路由: ' + dynamicRouteText(result.dynamic));
    if (result.dynamic.status === 'active' && opts.explain) {
      if (result.dynamic.summary) out('动态摘要: ' + result.dynamic.summary);
      for (const reason of result.dynamic.reasons || []) out('  - ' + reason);
    }
  }
  out('');
  out('应用模式: 显式调用（可经用户确认后切换为按场景自动调用）');
  out('说明: ' + result.disclaimer);
}

function runUsage(opts) {
  const action = opts.rest[0] || 'status';
  if (action === 'status') {
    const state = usageJournalLib.readUsage();
    if (opts.json) {
      out(JSON.stringify(state, null, 2));
      return;
    }
    out('元阁本地使用记录：' + (state.enabled ? '已开启' : '已关闭'));
    out('文件: ' + usageJournalLib.usageFilePath());
    const skills = Object.keys(state.skills || {}).sort();
    if (!skills.length) {
      out('暂无记录。');
      return;
    }
    for (const slug of skills) {
      const item = state.skills[slug];
      out('  ' + slug + '  used=' + item.used + ' named=' + item.named
        + ' accepted=' + item.accepted + ' route_hits=' + item.route_hits
        + ' pairs=' + Object.keys(item.pairs || {}).length);
    }
    return;
  }
  if (action === 'enable' || action === 'disable') {
    const state = usageJournalLib.setEnabled(action === 'enable');
    if (opts.json) {
      out(JSON.stringify(state, null, 2));
      return;
    }
    out('元阁本地使用记录已' + (state.enabled ? '开启' : '关闭') + '。');
    out('文件: ' + usageJournalLib.usageFilePath());
    return;
  }
  if (action === 'mark') {
    if (!opts.skill) die('usage mark 缺少 --skill', 2, '例如 --skill yotta-memory。');
    if (!opts.signal) die('usage mark 缺少 --signal', 2, '可用 used / named / accepted。');
    let state;
    try {
      state = usageJournalLib.markUsage(opts.skill, opts.signal);
    } catch (error) {
      die(error.message, 2, '请检查 --skill 与 --signal。');
    }
    if (opts.json) {
      out(JSON.stringify(state, null, 2));
      return;
    }
    out('已记录：' + opts.skill + ' / ' + opts.signal);
    return;
  }
  if (action === 'reset') {
    if (!opts.yes) die('usage reset 需要 --yes 确认', 2, '该操作会清空本地使用记录。');
    const file = usageJournalLib.resetUsage();
    if (opts.json) {
      out(JSON.stringify({ reset: true, file }, null, 2));
      return;
    }
    out('已清空本地使用记录：' + file);
    return;
  }
  die('未知 usage 子命令: ' + action, 2, '支持 status / enable / disable / mark / reset。');
}

function m1StatusText(block) {
  if (!block) return '';
  if (block.status === 'active') {
    return '已应用（提供方 ' + (block.provider_id || '-') + '；建议 '
      + block.decisions.length + ' 条）';
  }
  if (block.status === 'license_required') return '需授权（该能力需要授权后使用）';
  if (block.status === 'timeout') return '未生效（提供方超时）';
  if (block.status === 'invalid_output') return '未生效（提供方输出无效）';
  if (block.status === 'error') return '未生效（提供方异常）';
  return block.status;
}

function runDecideMemory(opts) {
  if (opts.dryRun && opts.promote) {
    die('--dry-run 与 --promote 不能同时使用', 2, '默认就是只读；需要写建议文件时只加 --promote。');
  }
  const { registry } = reindexRegistry(opts);
  const usage = usageJournalLib.readUsage();
  const snapshot = m1FeaturesLib.buildFeatureSnapshot(registry, usage);
  const provider = require('../lib/provider');
  let run;
  try {
    run = provider.runCapability('m1.adjudicate', snapshot);
  } catch (error) {
    run = { status: 'error', provider_id: '', note: 'M1 装载失败：' + error.message };
  }
  const block = {
    status: run.status || 'error',
    provider_id: run.provider_id || '',
    applied: false,
    mode: opts.promote ? 'recommendation' : 'dry-run',
    decisions: [],
    summary: { promote: 0, hold: 0, demote: 0 },
    dropped: [],
    note: run.note || run.message || '',
  };
  if (run.status === 'active' && run.data && typeof run.data === 'object') {
    const allowed = new Set(Object.keys(registry.skills || {}));
    const verdicts = new Set(['promote', 'hold', 'demote']);
    const requested = Array.isArray(run.data.decisions) ? run.data.decisions : [];
    for (const raw of requested) {
      const slug = raw && typeof raw === 'object' ? String(raw.slug || '') : '';
      const score = raw && Number(raw.score);
      const verdict = raw && String(raw.verdict || '');
      if (!slug || !allowed.has(slug) || !verdicts.has(verdict) || !Number.isFinite(score) || score < 0 || score > 100) {
        if (slug) block.dropped.push(slug);
        continue;
      }
      const reasons = Array.isArray(raw.reasons)
        ? raw.reasons.filter((item) => typeof item === 'string').slice(0, 20)
        : [];
      block.decisions.push({
        slug,
        verdict,
        score: Math.round(score),
        reasons,
        signals: raw.signals && typeof raw.signals === 'object' && !Array.isArray(raw.signals)
          ? raw.signals
          : {},
      });
    }
    block.decisions.sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug));
    for (const decision of block.decisions) {
      if (block.summary[decision.verdict] !== undefined) block.summary[decision.verdict] += 1;
    }
    block.applied = block.decisions.length > 0;
  }

  let reportFile = null;
  if (opts.promote && block.status === 'active') {
    const report = {
      schema: 1,
      generated_at: snapshot.generated_at,
      provider_id: block.provider_id,
      mode: 'recommendation',
      decisions: block.decisions,
      memory_candidates: m1FeaturesLib.buildMemoryCandidates(block.decisions, registry),
      note: '只写本地建议文件；不写元忆、不删除任何内容。',
    };
    try {
      reportFile = m1FeaturesLib.writeAdjudication(report);
      block.report_file = reportFile;
    } catch (error) {
      die('M1 建议文件写入失败: ' + error.message, 1, '请检查 ~/.yottaskills 目录权限。');
    }
  }

  if (opts.json) {
    out(JSON.stringify({ schema: 1, generated_at: snapshot.generated_at, m1: block }, null, 2));
    return;
  }
  out('元阁记忆裁决（M1）');
  out('状态: ' + m1StatusText(block));
  if (block.status === 'active') {
    out('建议汇总: promote ' + block.summary.promote + ' / hold ' + block.summary.hold
      + ' / demote ' + block.summary.demote + '；丢弃 ' + block.dropped.length);
    for (const decision of block.decisions) {
      out('  [' + decision.verdict + '] ' + decision.slug + '  ' + decision.score
        + (decision.reasons.length ? '  - ' + decision.reasons.join('；') : ''));
      if (opts.explain) {
        const signals = decision.signals || {};
        out('    信号: used=' + (signals.used || 0) + ' named=' + (signals.named || 0)
          + ' accepted=' + (signals.accepted || 0) + ' route_hits=' + (signals.route_hits || 0)
          + ' distinct_pairs=' + (signals.distinct_pairs || 0)
          + ' description_quality=' + (signals.description_quality || 0)
          + ' recency=' + (signals.recency || 0));
      }
    }
    if (reportFile) out('建议文件: ' + reportFile);
  } else if (block.note) {
    out('说明: ' + block.note);
  }
  out('边界: 只建议不删除；不自动写元忆；数据不出本机。');
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

// ── 运行时 hook 适配层（P0-3） ───────────────────────────────────────────────
function readJsonFile(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    die(label + ' 读取失败: ' + error.message, 2, '请确认文件存在且为合法 JSON。');
  }
}

function runHook(opts) {
  const action = opts.rest[0] || 'capabilities';
  const host = opts.host || 'generic';
  const adapter = hookAdapterLib.createHookAdapter({ host });

  if (action === 'capabilities') {
    const payload = { host, capabilities: adapter.capabilities() };
    if (opts.json) out(JSON.stringify(payload, null, 2));
    else {
      out('yotta-skills（元阁）v' + VERSION + ' —— hook capabilities');
      out('宿主: ' + host);
      hookAdapterLib.EVENTS.forEach((event) => out('  ' + event.padEnd(18) + payload.capabilities[event]));
    }
    return;
  }

  if (action === 'evaluate') {
    if (!opts.event) die('hook evaluate 缺少 --event', 2, '请提供六个统一事件之一。');
    if (!opts.manifest) die('hook evaluate 缺少 --manifest', 2, '请提供 skill-manifest.json 路径。');
    const manifest = readJsonFile(opts.manifest, 'manifest');
    let context = {};
    if (opts.context) {
      try {
        context = JSON.parse(opts.context);
      } catch (error) {
        die('--context 不是合法 JSON: ' + error.message, 2, '请传入 JSON 对象。');
      }
    }
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      die('--context 必须是 JSON 对象', 2);
    }
    const result = adapter.evaluate(opts.event, manifest, context);
    const entries = result.results.length > 0
      ? result.results
      : [{ event: opts.event, skill: manifest.slug, action: null, decision: result.decision, evidence: {}, capability: adapter.capabilities()[opts.event] || 'unsupported', reason: result.user_message }];
    for (const entry of entries) {
      hookAdapterLib.appendHookEvidence({
        event: entry.event,
        skill: entry.skill,
        action: entry.action,
        result: entry.decision,
        capability: entry.capability,
        evidence: entry.evidence,
        reason: entry.reason,
      }, { homeDir: os.homedir() });
    }
    if (opts.json) out(JSON.stringify({ host, event: opts.event, ...result }, null, 2));
    else {
      out('yotta-skills（元阁）v' + VERSION + ' —— hook evaluate');
      out('宿主: ' + host + ' / 事件: ' + opts.event);
      out('决策: ' + result.decision + ' / verified: ' + result.verified);
      out(result.user_message);
      for (const entry of result.results) out('  ' + entry.action + ': ' + entry.decision + '（' + entry.capability + '）');
    }
    process.exitCode = result.decision === 'block' ? 3 : 0;
    return;
  }

  if (action === 'bind') {
    if (!opts.manifest) die('hook bind 缺少 --manifest', 2, '请提供 skill-manifest.json 路径。');
    const manifest = readJsonFile(opts.manifest, 'manifest');
    const bindings = adapter.bind(manifest, opts.event || null);
    if (opts.json) out(JSON.stringify({ host, bindings }, null, 2));
    else {
      out('yotta-skills（元阁）v' + VERSION + ' —— hook bind');
      out('宿主: ' + host + ' / 绑定 ' + bindings.length + ' 项');
      for (const binding of bindings) out('  ' + binding.id + '  ' + binding.event + '  ' + binding.action + '  ' + binding.capability);
    }
    return;
  }

  if (action === 'unbind') {
    const id = opts.rest[1];
    if (!id) die('hook unbind 缺少 binding id', 2, '先用 hook bind / list 获取 id。');
    const removed = adapter.unbind(id);
    if (opts.json) out(JSON.stringify({ host, id, removed }, null, 2));
    else out(removed ? '已解除绑定: ' + id : '未找到绑定: ' + id);
    process.exitCode = removed ? 0 : 1;
    return;
  }

  die('未知 hook 子命令: ' + action, 2, '支持 capabilities / evaluate / bind / unbind。');
}

// ── Hub（本机单点安装 + 链接分发） ─────────────────────────────────────────
function universalSkillDirs() {
  const home = os.homedir();
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    { dir: path.join(xdg, 'agents', 'skills'), agentId: 'universal', label: 'Universal .agents' },
    { dir: path.join(home, '.agents', 'skills'), agentId: 'agents', label: '通用 AGENTS.md' },
  ];
}

function hubTargetDirs(opts, discovery) {
  const targets = [];
  const seen = new Set();
  const add = (dir, agentId, label) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ dir: resolved, agentId: agentId || null, label: label || '指定目录' });
  };

  if (opts.dir) {
    add(opts.dir, null, '指定目录');
    return targets;
  }
  if (opts.agent) {
    const info = AGENT_DIRS[opts.agent];
    if (!info) {
      die('未收录智能体: ' + opts.agent + '。可用: ' + Object.keys(AGENT_DIRS).join(', ') + '；或改用 --dir <路径>。',
        2, '先运行 yotta-skills hub hosts 查看本机实际技能目录。');
    }
    add(resolveUserDir(info.dirs[0]), opts.agent, info.label);
    return targets;
  }
  if (!opts.all) {
    die('hub link / unlink 需要 --agent <id>、--dir <path> 或 --all', 2,
      '示例：yotta-skills hub link --all；或 yotta-skills hub link --agent codex。');
  }

  for (const item of universalSkillDirs()) add(item.dir, item.agentId, item.label);
  for (const host of discovery.hosts) {
    if (!host.exists) continue;
    add(host.dir, host.agentId, host.label);
  }
  return targets;
}

function hubHostLines(discovery) {
  const lines = [];
  const existing = discovery.hosts.filter((host) => host.exists);
  const missing = discovery.hosts.filter((host) => !host.exists);
  for (const host of existing) {
    lines.push('  ' + (host.known ? '✔' : '?') + ' ' +
      String(host.label).padEnd(28) + host.dir.padEnd(64) +
      String(host.skillCount).padStart(3) + ' 个技能' +
      (host.known ? '  [已收录]' : '  [自动发现]'));
  }
  const noSkillDir = discovery.installed.filter((item) => !item.hasSkillsDir);
  for (const item of noSkillDir) {
    lines.push('  △ ' + String(item.label).padEnd(28) + '已安装，未发现技能目录  [不适用]');
  }
  return { lines, existing, missing, noSkillDir };
}

function printHubHosts(discovery, json) {
  if (json) {
    out(JSON.stringify(discovery, null, 2));
    return;
  }
  const view = hubHostLines(discovery);
  out('yotta-skills（元阁）v' + VERSION + ' —— Hub 宿主发现（文件系统优先，不读元忆）');
  out('本机发现技能目录 ' + view.existing.length + ' 个 / 已装应用标记 ' + discovery.installed.length +
    ' 个 / 未发现技能目录 ' + view.noSkillDir.length + ' 个');
  for (const line of view.lines) out(line);
  if (view.missing.length > 0) {
    out('');
    out('未安装 / 未发现目录 ' + view.missing.length + ' 个（已收录映射，等安装后自动出现）。');
  }
}

function printHubStatus(payload, discovery, json) {
  if (json) {
    out(JSON.stringify({ ...payload, discovery }, null, 2));
    return;
  }
  out('yotta-skills（元阁）v' + VERSION + ' —— Hub 状态');
  out('标准: ' + payload.standard);
  out('Hub: ' + payload.hubDir);
  out('技能: ' + payload.summary.skills + ' / 非元阁技能: ' + payload.summary.external +
    ' / 链接: ' + payload.summary.links + ' / 异常链接: ' + payload.summary.brokenLinks);
  out('');
  for (const skill of payload.skills) {
    const origin = skill.origin === 'yotta' ? '元技能' : '非元阁技能（无更新源）';
    const links = skill.links.length > 0 ? skill.links.map((link) => link.label || link.agent || '链接').join(', ') : '-';
    out('  ' + skill.slug.padEnd(26) + 'v' + String(skill.version || '-').padEnd(10) +
      origin.padEnd(22) + '链接: ' + links +
      (skill.status === 'missing' ? '  [目标缺失]' : ''));
  }
  if (payload.skills.length === 0) out('  （Hub 为空；先运行 yotta-skills hub install）');
  const broken = payload.links.filter((link) => link.status !== 'ok');
  if (broken.length > 0) {
    out('');
    out('异常链接:');
    for (const link of broken) out('  ✘ ' + link.slug + '  ' + link.target + '（' + link.status + '）');
  }
  out('');
  printHubHosts(discovery, false);
}

function hubScanEngine(hubDir, discovery, opts) {
  return hubScanLib.scanEngineForHub(hubDir, discovery, opts);
}

function hubScanSkill(hubDir, discovery, opts, skillDir) {
  return hubScanLib.hubScanSkill(hubDir, discovery, opts, skillDir);
}

function printAdoptScan(payload, json) {
  if (json) {
    out(JSON.stringify(payload, null, 2));
    return;
  }
  out('yotta-skills（元阁）v' + VERSION + ' —— Hub 收编预演（只读）');
  out('Hub: ' + payload.hubDir);
  out('候选 ' + payload.summary.candidates + ' / 冲突 ' + payload.summary.conflicts +
    ' / 已在 Hub ' + payload.summary.alreadyInHub);
  out('');
  for (const item of payload.candidates) {
    const mark = item.conflict ? '△' : item.inHub ? '·' : '✔';
    out('  ' + mark + ' ' + item.slug.padEnd(26) + 'v' + String(item.version || '-').padEnd(10) +
      (item.sourceHost || '-') + '  ' + (item.source || ''));
    if (item.conflict) {
      out('      冲突副本: ' + item.variants.map((variant) =>
        (variant.host || '?') + ' v' + (variant.version || '?')).join(', '));
    }
  }
  if (payload.candidates.length === 0) out('  （没有发现可收编技能）');
}

function printAdoptApply(payload, json) {
  if (json) {
    out(JSON.stringify(payload, null, 2));
    return;
  }
  out('yotta-skills（元阁）v' + VERSION + ' —— Hub 收编');
  out('Hub: ' + payload.hubDir);
  for (const item of payload.results) {
    const mark = item.status === 'imported' ? '✔' : item.status === 'skip' ? '·' : item.status === 'conflict' ? '△' : '✘';
    out('  ' + mark + ' ' + item.slug.padEnd(26) + item.note);
  }
  out('汇总: 收编 ' + payload.results.filter((item) => item.status === 'imported').length +
    ' / 跳过 ' + payload.results.filter((item) => item.status === 'skip').length +
    ' / 冲突 ' + payload.results.filter((item) => item.status === 'conflict').length +
    ' / 失败 ' + payload.results.filter((item) => !['imported', 'skip', 'conflict'].includes(item.status)).length);
}

function printHubDoctor(payload, json) {
  if (json) {
    out(JSON.stringify(payload, null, 2));
    return;
  }
  out('yotta-skills（元阁）v' + VERSION + ' —— Hub doctor');
  out('Hub: ' + payload.hubDir);
  for (const check of payload.checks) {
    if (check.ok && check.severity !== 'info') continue;
    const mark = check.ok ? '✔' : check.severity === 'warning' ? '△' : '✘';
    out('  ' + mark + ' ' + check.message + (check.hint ? '（修复: ' + check.hint + '）' : ''));
  }
  out('汇总: 错误 ' + payload.summary.errors + ' / 警告 ' + payload.summary.warnings);
  if (!payload.ok) out('Hub doctor 未通过：请按上面的修复建议处理后重试。');
}

function runHub(opts) {
  const hubDir = hubLib.resolveHubDir(opts);
  const action = opts.hubAction || 'status';
  const discovery = agentDiscoveryLib.discoverHosts({ homeDir: os.homedir(), env: process.env });

  if (action === 'hosts' || action === 'discover') {
    printHubHosts(discovery, opts.json);
    return;
  }

  if (action === 'install' || action === 'update') {
    out('Hub: ' + hubDir);
    const result = action === 'install' ? runInstall(opts, hubDir) : runUpdate(opts, hubDir);
    const synced = hubLib.syncHubState(hubDir, { manifest: MANIFEST });
    const count = Object.values(synced.state.skills).filter((item) => item.status === 'present').length;
    out('');
    out('Hub 台账已更新: ' + count + ' 个技能；标准 ' + hubLib.STANDARD_ID);
    if (result.failed > 0) process.exitCode = result.exitCode || 1;
    return;
  }

  if (action === 'adopt') {
    if (opts.as) {
      die('hub adopt --as 暂未启用', 2, '先收编原 slug；改名 / 冲突改写放到后续里程碑，避免静默改技能身份。');
    }
    const scan = hubAdoptLib.scanCandidates({ hubDir, discovery });
    if (!opts.apply) {
      printAdoptScan(scan, opts.json);
      return;
    }
    const payload = hubAdoptLib.applyCandidates({
      hubDir,
      candidates: scan.candidates,
      include: opts.include,
      force: opts.force,
      inPlace: opts.inPlace,
      skipScan: opts.skipScan,
      allowUnverified: opts.allowUnverified,
      manifest: MANIFEST,
      homeDir: os.homedir(),
      env: process.env,
      scan: (skillDir) => hubScanSkill(hubDir, discovery, opts, skillDir),
    });
    printAdoptApply(payload, opts.json);
    if (payload.results.some((item) => !['imported', 'skip', 'conflict'].includes(item.status))) process.exitCode = 1;
    return;
  }

  if (action === 'refresh') {
    if (!opts.from) die('hub refresh 缺少 --from <path>', 2, '示例：yotta-skills hub refresh my-skill --from <技能目录>。');
    if (opts.skills.length !== 1) die('hub refresh 需要一个且仅一个技能 slug', 2, '示例：yotta-skills hub refresh my-skill --from <技能目录>。');
    const result = hubAdoptLib.refreshFrom({
      hubDir,
      slug: opts.skills[0],
      from: opts.from,
      skipScan: opts.skipScan,
      allowUnverified: opts.allowUnverified,
      manifest: MANIFEST,
      homeDir: os.homedir(),
      env: process.env,
      scan: (skillDir) => hubScanSkill(hubDir, discovery, opts, skillDir),
    });
    if (opts.json) out(JSON.stringify(result, null, 2));
    else if (result.ok) out('已刷新: ' + result.slug + '（来源 ' + result.source + '）');
    else out('刷新失败: ' + result.error);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (action === 'link') {
    const targets = hubTargetDirs(opts, discovery);
    let failed = 0;
    const targetPayloads = [];
    for (const target of targets) {
      if (path.resolve(target.dir) === path.resolve(hubDir)) {
        targetPayloads.push({ dir: target.dir, label: target.label, skipped: true, results: [] });
        if (!opts.json) out('跳过 Hub 自身: ' + target.dir);
        continue;
      }
      const result = hubLib.linkSkills({
        hubDir,
        targetDir: target.dir,
        agentId: target.agentId,
        label: target.label,
        slugs: opts.skills,
        force: opts.force,
        dryRun: opts.dryRun,
      });
      targetPayloads.push({ dir: target.dir, label: target.label, results: result.results });
      if (!opts.json) {
        out('');
        out('目标: ' + target.dir + '（' + target.label + '）');
        for (const item of result.results) {
          const mark = item.status === 'linked' ? '✔' : item.status === 'conflict' ? '△' : item.status === 'error' ? '✘' : '·';
          out('  ' + mark + ' ' + item.slug.padEnd(26) + item.note);
          if (item.status === 'error') failed++;
        }
      } else {
        failed += result.results.filter((item) => item.status === 'error').length;
      }
    }
    if (opts.json) out(JSON.stringify({ hubDir, targets: targetPayloads, failed }, null, 2));
    if (failed > 0) process.exitCode = 1;
    return;
  }

  if (action === 'unlink') {
    const targets = hubTargetDirs(opts, discovery);
    let failed = 0;
    const targetPayloads = [];
    for (const target of targets) {
      const result = hubLib.unlinkSkills({
        hubDir,
        targetDir: target.dir,
        slugs: opts.skills,
        dryRun: opts.dryRun,
      });
      targetPayloads.push({ dir: target.dir, label: target.label, results: result.results });
      if (!opts.json) {
        out('');
        out('目标: ' + target.dir + '（' + target.label + '）');
        for (const item of result.results) {
          const mark = item.status === 'unlinked' ? '✔' : item.status === 'refused' ? '△' : item.status === 'error' ? '✘' : '·';
          out('  ' + mark + ' ' + item.slug.padEnd(26) + item.note);
          if (item.status === 'error') failed++;
        }
      } else {
        failed += result.results.filter((item) => item.status === 'error').length;
      }
    }
    if (opts.json) out(JSON.stringify({ hubDir, targets: targetPayloads, failed }, null, 2));
    if (failed > 0) process.exitCode = 1;
    return;
  }

  if (action === 'status') {
    const payload = hubLib.status({ hubDir, manifest: MANIFEST });
    printHubStatus(payload, discovery, opts.json);
    return;
  }

  if (action === 'doctor') {
    const payload = hubLib.doctor({
      hubDir,
      manifest: MANIFEST,
      homeDir: os.homedir(),
      env: process.env,
    });
    printHubDoctor(payload, opts.json);
    if (!payload.ok) process.exitCode = 1;
    return;
  }

  die('未知 hub 子命令: ' + action, 2,
    '支持 install / update / adopt / refresh / link / unlink / status / hosts / doctor。');
}

// ── view：本机技能枢纽面板（127.0.0.1，只读 API + 预览确认动作） ───────────
function runView(opts) {
  const home = os.homedir();
  const hubDir = hubLib.resolveHubDir(opts);
  const port = opts.port === null || opts.port === undefined ? hubViewServerLib.DEFAULT_PORT : opts.port;
  const view = hubViewServerLib.createHubViewServer({
    hubDir,
    homeDir: home,
    env: process.env,
    manifest: MANIFEST,
    version: VERSION,
    port,
    html: VIEW_HTML,
    python: opts.python,
    verify: opts.verify,
    scanSkill: (skillDir, found, scanOpts) => hubScanSkill(hubDir, found, {
      python: opts.python,
      verify: opts.verify,
      skipScan: Boolean(scanOpts && scanOpts.skipScan),
    }, skillDir),
    onError: (error) => {
      if (error && error.code === 'EADDRINUSE') {
        die('端口 ' + port + ' 已被占用（yotta-skills view 未启动）', 2,
          '换一个端口：yotta-skills view --port ' + (port + 1 < 65535 ? port + 1 : 8789) + '；或先关闭占用该端口的进程。');
      }
      die('yotta-skills view 启动失败: ' + (error && error.message ? error.message : String(error)), 2,
        '检查端口占用与目录权限后重试。');
    },
  });
  view.listen(port, '127.0.0.1', () => {
    const address = view.server.address();
    const actual = address && typeof address === 'object' ? address.port : port;
    out('yotta-skills（元阁）v' + VERSION + ' —— 技能枢纽面板已启动');
    out('URL: http://127.0.0.1:' + actual + '（仅本机；按 Ctrl+C 停止）');
    out('Hub: ' + hubDir + (fs.existsSync(hubDir) ? '' : '（尚未初始化：面板会给出引导）'));
    out('边界: 零遥测 / 零远程资源；写操作需页面会话令牌，破坏性动作需二次确认。');
  });
}

// ── main ───────────────────────────────────────────────────────────────────
function main() {
  const node = depsLib.nodeCheck();
  if (!node.ok) {
    die('需要 Node 18+（用途：运行元阁 CLI 本体；当前 v' + node.version + '）', 4,
      depsLib.fixFor('node') + '；装好后重跑：' + currentCommand());
  }
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }
  if (opts.version) { out('yotta-skills v' + VERSION); return; }
  if (opts.list && !opts.command) { printList(opts); return; }
  if (opts.inventory && !opts.command) { runInventory(opts); return; }
  if (opts.reindex && !opts.command) { runReindex(opts); return; }
  if (opts.route && !opts.command) { runRoute(opts); return; }

  const command = opts.command || 'install';
  if (command === 'usage') {
    runUsage(opts);
    return;
  }
  if (command === 'decide-memory') {
    runDecideMemory(opts);
    return;
  }
  if (command === 'hook') {
    runHook(opts);
    return;
  }
  if (command === 'view') {
    runView(opts);
    return;
  }
  if (command === 'hub') {
    runHub(opts);
    return;
  }
  if (command === 'rollback' && opts.list) {
    runRollback(opts, null);
    return;
  }
  let dest = resolveTargetDir(opts);
  if (!dest && !opts.dryRun) dest = detectProjectDir();
  if (!dest && (command === 'install' || command === 'doctor' || command === 'rollback') && !opts.dryRun) {
    die('未指定目标：请用 --agent <name> 或 --dir <path>（当前目录未检测到项目级技能目录）。', 4, '未收录智能体也可用 --dir 指定其技能目录。');
  }

  if (opts.dryRun) {
    let skills = selectSkills(opts);
    if (command === 'update' && opts.installedOnly && dest) {
      skills = skills.filter((s) => readInstalledVersion(path.join(dest, s.slug)) !== null);
    }
    if (skills.length === 0) {
      out(opts.installedOnly
        ? 'dry-run：目标目录没有可维护的已安装家族技能（无动作）。'
        : 'dry-run：过滤后没有匹配的技能（--only / --domain）。');
      process.exitCode = opts.installedOnly ? 0 : 2;
      return;
    }
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

  if (command === 'doctor') {
    runDoctor(opts, dest);
  } else if (command === 'rollback') {
    runRollback(opts, dest);
  } else if (command === 'update') {
    if (opts.check || opts.auto) {
      var runFn = opts.auto ? runUpdateAuto : runUpdateCheck;
      runFn(opts, dest).then(function (r) {
        process.exitCode = r.code;
      });
    } else {
      const result = runUpdate(opts, dest);
      if (!result.failed) maybeAutoReindex(opts, dest);
    }
  } else {
    const result = runInstall(opts, dest);
    if (!result.failed) maybeAutoReindex(opts, dest);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write('错误：' + (err && err.message ? err.message : String(err)) + '\n');
  process.stderr.write('修复建议：检查目标目录权限、npm 可用性与网络；可用 --help 查看用法。\n');
  process.exitCode = 1;
}
