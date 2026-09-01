#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""yotta-skills-mcp.py — 元阁（yotta-skills）技能盘点 MCP server。

stdio MCP server（JSON-RPC 2.0，换行分隔），把元阁技能扫描核心暴露为 MCP 工具：
  list_installed_skills  盘点本机已装技能（读本地注册表；未生成则先扫描一次）
  describe_skill         查看单个技能详情（slug / 版本 / 功能 / 来源）
  reindex                强制重新扫描并更新注册表
  route_request          按需求摘要给出静态编排路由建议

自包含原则：扫描由元阁自带核心（bin/yotta-skills.js --inventory / --reindex）完成，
不依赖任何元技能；数据只写本机 ~/.yottaskills/registry.json，不出本机。

运行：python scripts/yotta-skills-mcp.py
MCP 客户端配置：
  {"mcpServers":{"yotta-skills":{"command":"python",
    "args":["<绝对路径>/scripts/yotta-skills-mcp.py"]}}}
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

VERSION = "0.5.0"
TOOL_NAME = "yotta-skills"
CN_NAME = "元阁"
MCP_PROTOCOL = "2025-03-26"
SERVERS = {TOOL_NAME: {"name": TOOL_NAME, "cn": CN_NAME, "version": VERSION}}

_HERE = Path(__file__).resolve().parent
BIN_JS = (_HERE.parent / "bin" / "yotta-skills.js").resolve()
REGISTRY_FILE = Path(os.path.expanduser("~/.yottaskills/registry.json"))


def _tool_error(message, extra=None):
    payload = {"error": message}
    if extra:
        payload.update(extra)
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
            "isError": True}


def _tool_spec(name, description, properties, required=None):
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            **({"required": required} if required else {}),
        },
    }


def _run_cli(args):
    """运行元阁 CLI（Node），返回 stdout 文本；失败抛 RuntimeError。"""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("未找到 node 可执行文件（元阁 CLI 依赖 Node.js 18+）")
    proc = subprocess.run(
        [node, str(BIN_JS)] + args,
        capture_output=True, text=True, encoding="utf-8",
        timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError("yotta-skills CLI 失败（exit %s）：%s" % (proc.returncode, (proc.stderr or proc.stdout).strip()[:500]))
    return proc.stdout


def _read_registry():
    if not REGISTRY_FILE.is_file():
        return None
    try:
        return json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def _ensure_registry():
    """注册表不存在时先扫描生成一次；返回注册表 dict。"""
    reg = _read_registry()
    if reg is not None:
        return reg
    _run_cli(["--inventory"])
    reg = _read_registry()
    if reg is None:
        raise RuntimeError("技能注册表生成失败（~/.yottaskills/registry.json）")
    return reg


def _skills_list(registry):
    return sorted(
        [s for s in registry.get("skills", {}).values() if s.get("status") != "gone"],
        key=lambda s: s.get("slug", ""),
    )


def _tool_list(arguments):  # noqa: ARG001
    registry = _ensure_registry()
    skills = _skills_list(registry)
    payload = {
        "count": len(skills),
        "registry": str(REGISTRY_FILE),
        "skills": skills,
    }
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
            "isError": False}


def _tool_describe(arguments):
    slug = str(arguments.get("slug") or "").strip()
    if not slug:
        return _tool_error("describe_skill 需要 slug 参数")
    registry = _ensure_registry()
    skill = registry.get("skills", {}).get(slug)
    if not skill or skill.get("status") == "gone":
        return _tool_error("未找到技能: %s" % slug)
    payload = {"skill": skill}
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
            "isError": False}


def _tool_reindex(arguments):  # noqa: ARG001
    stdout = _run_cli(["--reindex", "--json"])
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as e:
        return _tool_error("reindex 输出解析失败：%s" % e)
    payload = {
        "count": data.get("count", len(data.get("skills", []))),
        "changes": data.get("changes"),
        "errors": data.get("errors"),
        "registry": str(REGISTRY_FILE),
    }
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
            "isError": False}


def _tool_route(arguments):
    request = str(arguments.get("request") or "").strip()
    if not request:
        return _tool_error("route_request 需要 request 参数")
    stdout = _run_cli(["--route", request, "--json"])
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as e:
        return _tool_error("route_request 输出解析失败：%s" % e)
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
            "isError": False}


TOOL_HANDLERS = {
    "list_installed_skills": _tool_list,
    "describe_skill": _tool_describe,
    "reindex": _tool_reindex,
    "route_request": _tool_route,
}


def mcp_tools():
    return [
        _tool_spec(
            "list_installed_skills",
            "盘点本机已装技能：返回技能列表（slug / 版本 / 功能一句话 / 来源）。"
            "读本地注册表 ~/.yottaskills/registry.json；未生成则先扫描一次。"
            "扫描由元阁自带核心完成，不依赖任何其他技能。数据不出本机。",
            {},
            [],
        ),
        _tool_spec(
            "describe_skill",
            "查看单个技能的详情（slug / 版本 / 功能 / 来源目录）。",
            {"slug": {"type": "string", "description": "技能 slug（如 yotta-memory）"}},
            ["slug"],
        ),
        _tool_spec(
            "reindex",
            "强制重新扫描所有技能目录并更新本地注册表，返回本次变化（新增 / 更新 / 消失）；CLI 等价命令：yotta-skills --reindex。",
            {},
            [],
        ),
        _tool_spec(
            "route_request",
            "按需求摘要给出静态编排路由建议：候选组合、调用顺序、每个技能角色、置信度、依据、已装/缺失状态与安装命令。"
            "并给出其他已装技能候选（仅按 frontmatter description 本地机械匹配、标注未扫描状态，不读取全文指令、不自动调用）。"
            "只建议安装，不自动安装；数据不出本机。",
            {"request": {"type": "string", "description": "用户需求摘要"}},
            ["request"],
        ),
    ]


def handle_message(msg):
    """处理一行 JSON-RPC 消息，返回响应 dict；通知返回 None。"""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
        rid = msg.get("id") if isinstance(msg, dict) else None
        return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32600, "message": "invalid request"}}
    method = msg.get("method")
    rid = msg.get("id")
    if rid is None:  # JSON-RPC 通知（无 id）不响应
        return None
    if method is None:
        return None
    params = msg.get("params") or {}

    if method == "initialize":
        return {
            "jsonrpc": "2.0", "id": rid,
            "result": {
                "protocolVersion": MCP_PROTOCOL,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": TOOL_NAME, "version": VERSION},
            },
        }
    if method == "ping":
        return {"jsonrpc": "2.0", "id": rid, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": rid, "result": {"tools": mcp_tools()}}
    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        handler = TOOL_HANDLERS.get(name)
        if not handler:
            return {
                "jsonrpc": "2.0", "id": rid,
                "result": {"content": [{"type": "text", "text": "未知工具: %s" % name}], "isError": True},
            }
        try:
            return {"jsonrpc": "2.0", "id": rid, "result": handler(arguments)}
        except Exception as e:  # noqa: BLE001
            return {
                "jsonrpc": "2.0", "id": rid,
                "result": {"content": [{"type": "text", "text": "工具执行异常：%s" % e}], "isError": True},
            }
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "Method not found: " + str(method)}}


def main():
    """stdio 主循环：读行 -> JSON-RPC -> 响应行。"""
    try:
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            sys.stdout.write(json.dumps(
                {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}},
                ensure_ascii=False) + "\n")
            sys.stdout.flush()
            continue
        resp = handle_message(msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
