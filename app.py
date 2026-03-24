import os
import time
from pathlib import Path
from typing import Any

import requests
from flask import Flask, Response, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "www"

UPSTREAM_BASE = os.environ.get("UPSTREAM_BASE", "").rstrip("/")
UPSTREAM_JWT = os.environ.get("UPSTREAM_JWT", "")
CPA_BASE_URL = os.environ.get("CPA_BASE_URL", "").rstrip("/")
CPA_TOKEN = os.environ.get("CPA_TOKEN", "")
CPA_TARGET_TYPE = os.environ.get("CPA_TARGET_TYPE", "codex")
CPA_MIN_CANDIDATES = int(os.environ.get("CPA_MIN_CANDIDATES", "800") or 800)
REQUEST_TIMEOUT = int(os.environ.get("REQUEST_TIMEOUT", "15") or 15)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")


def _auth_headers(token: str) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _proxy_json(method: str, path: str, *, token: str | None = None, json_body: Any = None, params: dict[str, Any] | None = None):
    if not UPSTREAM_BASE:
        return jsonify({"success": False, "error": "UPSTREAM_BASE 未配置"}), 500

    response = requests.request(
        method=method,
        url=f"{UPSTREAM_BASE}{path}",
        headers=_auth_headers(token or UPSTREAM_JWT),
        json=json_body,
        params=params,
        timeout=REQUEST_TIMEOUT,
    )

    content_type = response.headers.get("Content-Type", "application/json")
    return Response(response.content, status=response.status_code, content_type=content_type)


def _get_item_type(item: dict[str, Any]) -> str:
    return str(item.get("type") or item.get("typo") or "")


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/proxy/model-status/config")
def proxy_model_status_config():
    return _proxy_json("GET", "/api/model-status/config/selected")


@app.get("/proxy/model-status/models")
def proxy_model_status_models():
    return _proxy_json("GET", "/api/model-status/models")


@app.post("/proxy/model-status/status")
def proxy_model_status_batch():
    window = request.args.get("window", "6h")
    if window not in {"1h", "6h", "24h", "7d"}:
        return jsonify({"success": False, "error": "非法 window 参数"}), 400

    payload = request.get_json(silent=True)
    if not isinstance(payload, list):
        return jsonify({"success": False, "error": "请求体必须是模型数组"}), 400

    return _proxy_json(
        "POST",
        "/api/model-status/status/batch",
        json_body=payload,
        params={"window": window, "no_cache": "true"},
    )


@app.get("/proxy/system/warmup")
def proxy_system_warmup():
    return _proxy_json("GET", "/api/system/warmup-status")


@app.get("/proxy/health/db")
def proxy_health_db():
    return _proxy_json("GET", "/api/health/db", token="")


@app.get("/proxy/cpa/pool-status")
def proxy_cpa_pool_status():
    if not CPA_BASE_URL or not CPA_TOKEN:
        return jsonify({"configured": False, "error": "CPA 未配置"}), 200

    try:
        resp = requests.get(
            f"{CPA_BASE_URL}/v0/management/auth-files",
            headers=_auth_headers(CPA_TOKEN),
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        raw = resp.json()
        data = raw if isinstance(raw, dict) else {}
        files = data.get("files", [])
        files = files if isinstance(files, list) else []

        target_type = CPA_TARGET_TYPE.lower()
        candidates = [item for item in files if _get_item_type(item).lower() == target_type]
        total = len(files)
        cand_count = len(candidates)
        threshold = CPA_MIN_CANDIDATES

        return jsonify(
            {
                "configured": True,
                "target_type": CPA_TARGET_TYPE,
                "total": total,
                "candidates": cand_count,
                "error_count": max(0, total - cand_count),
                "threshold": threshold,
                "healthy": cand_count >= threshold,
                "percent": round(cand_count / threshold * 100, 1) if threshold > 0 else 100,
                "last_checked": time.strftime("%Y-%m-%d %H:%M:%S"),
                "error": None,
            }
        )
    except Exception as exc:
        return jsonify(
            {
                "configured": True,
                "target_type": CPA_TARGET_TYPE,
                "total": 0,
                "candidates": 0,
                "error_count": 0,
                "threshold": CPA_MIN_CANDIDATES,
                "healthy": False,
                "percent": 0,
                "last_checked": time.strftime("%Y-%m-%d %H:%M:%S"),
                "error": str(exc),
            }
        ), 502


@app.get("/<path:path>")
def static_proxy(path: str):
    target = STATIC_DIR / path
    if target.is_file():
        return send_from_directory(STATIC_DIR, path)
    return send_from_directory(STATIC_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80)
