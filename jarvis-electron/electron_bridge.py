from __future__ import annotations

import dataclasses
import json
import os
import re
import sys
import threading
import traceback
from enum import Enum
from pathlib import Path
from typing import Any

from jarvis_gm.runtime import build_infinity7_runtime
from jarvis_gm.core.permissions import DEFAULT_POLICY
from jarvis_gm.self_test import run_self_test


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Path):
        return str(value)
    if dataclasses.is_dataclass(value):
        return {k: _jsonable(v) for k, v in dataclasses.asdict(value).items()}
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    if hasattr(value, "as_dict"):
        try:
            return _jsonable(value.as_dict())
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        try:
            return {k: _jsonable(v) for k, v in vars(value).items() if not str(k).startswith("_")}
        except Exception:
            pass
    return str(value)


WEB_ALIASES = {
    "youtube": "https://www.youtube.com",
    "google": "https://www.google.com",
    "gmail": "https://mail.google.com",
    "drive": "https://drive.google.com",
    "google drive": "https://drive.google.com",
    "maps": "https://maps.google.com",
    "google maps": "https://maps.google.com",
    "chatgpt": "https://chatgpt.com",
    "github": "https://github.com",
    "whatsapp": "https://web.whatsapp.com",
}

CAPABILITY_LABELS = {
    "app.launch": "abrir aplicaciones",
    "browser.open": "abrir sitios web",
    "input.control": "usar teclado y ratón",
    "window.control": "controlar ventanas",
    "filesystem.read": "leer archivos",
    "filesystem.write": "crear o modificar archivos",
    "system.control": "controlar funciones del sistema",
    "autonomy.run": "ejecutar trabajo autónomo",
    "workbench.run": "ejecutar trabajos persistentes",
    "workbench.manage": "administrar trabajos persistentes",
    "research.web": "investigar en la web",
    "research.deep": "hacer investigación profunda",
    "swarm.run": "ejecutar el Cognitive Swarm",
    "reality.control": "controlar dispositivos físicos",
    "mobile.control": "controlar dispositivos móviles",
    "external.send": "enviar información fuera del equipo",
}

def _normalize_owner_goal(text: str) -> tuple[str, str | None]:
    raw = str(text or "").strip()
    low = re.sub(r"\s+", " ", raw.casefold()).strip()
    m = re.match(r"^(?:jarvis[, ]+)?(?:abre|abrir|open)\s+(?:el\s+|la\s+)?(.+?)\s*$", low)
    if m:
        target = m.group(1).strip()
        if target in WEB_ALIASES:
            return f"abre {WEB_ALIASES[target]}", target
    return raw, None

def _blocked_capability(goal) -> str | None:
    for result in getattr(goal, "results", []) or []:
        if not getattr(result, "blocked", False):
            continue
        error = str(getattr(result, "error", "") or "")
        m = re.search(r"Capability blocked by policy:\s*([A-Za-z0-9_.-]+)", error)
        if m:
            return m.group(1)
        req_name = str(getattr(result, "action", "") or "")
        return req_name or None
    return None

def _goal_message(goal, alias: str | None = None) -> str:
    state = str(getattr(getattr(goal, "state", None), "value", getattr(goal, "state", ""))).lower()
    plan = list(getattr(goal, "plan", []) or [])
    if state == "verified":
        if plan:
            req = plan[-1]
            name = str(getattr(req, "name", ""))
            args = getattr(req, "args", {}) or {}
            if name == "open_url":
                return f"Listo. Abrí {alias.title() if alias else args.get('url', 'el sitio')}."
            if name == "open_app":
                return f"Listo. Abrí {args.get('app', 'la aplicación')}."
            if name == "type_text":
                return "Listo. Escribí el texto."
            if name in {"move_cursor", "move_cursor_normalized"}:
                return "Listo. Moví el cursor."
            if name == "mouse_button":
                return "Listo. Hice clic."
            if name == "hotkey":
                return "Listo. Ejecuté el atajo."
            if name in {"maximize_window", "minimize_window", "focus_window"}:
                return "Listo. Ajusté la ventana."
        return "Listo. La orden se completó y fue verificada."
    if state == "blocked":
        capability = _blocked_capability(goal)
        if capability and capability in DEFAULT_POLICY:
            return f"Necesito tu permiso para {CAPABILITY_LABELS.get(capability, capability)}."
        return "La orden fue bloqueada por seguridad. Puedo mostrarte exactamente qué autorización necesita."
    if state == "failed":
        return f"No pude completar la orden: {getattr(goal, 'verification', '') or 'se produjo un error'}"
    return f"Estado de la orden: {state or 'desconocido'}"

def _goal_response(goal, *, original: str, normalized: str, alias: str | None = None) -> dict[str, Any]:
    capability = _blocked_capability(goal)
    plan = [_jsonable(x) for x in (getattr(goal, "plan", []) or [])]
    results = [_jsonable(x) for x in (getattr(goal, "results", []) or [])]
    state = str(getattr(getattr(goal, "state", None), "value", getattr(goal, "state", "")))
    return {
        "text": original,
        "state": state,
        "message": _goal_message(goal, alias=alias),
        "needs_permission": bool(state == "blocked" and capability in DEFAULT_POLICY),
        "capability": capability if capability in DEFAULT_POLICY else None,
        "capability_label": CAPABILITY_LABELS.get(capability, capability) if capability else None,
        "normalized": normalized if normalized != original else None,
        "goal_id": str(getattr(goal, "id", "")),
        "plan": plan,
        "results": results,
        "verification": getattr(goal, "verification", None),
    }


class Bridge:
    def __init__(self) -> None:
        self.runtime = build_infinity7_runtime()
        self._lock = threading.RLock()
        try:
            self.runtime.start_bridge()
        except Exception:
            pass

    def close(self) -> None:
        try:
            self.runtime.clean_shutdown()
        except Exception:
            pass

    def _status(self) -> dict[str, Any]:
        r = self.runtime
        try:
            perception = r.perception.status()
        except Exception as exc:
            perception = {"error": str(exc)}
        try:
            project = r.memory_manager.active_project
            project = _jsonable(project) if project else None
        except Exception:
            project = None
        try:
            health = r.health.sample(r).as_dict()
        except Exception as exc:
            health = {"error": str(exc)}
        try:
            mobile = r.mobile.summary()
        except Exception as exc:
            mobile = {"error": str(exc)}
        try:
            reality = r.reality.status()
        except Exception as exc:
            reality = {"error": str(exc)}
        try:
            world = r.world_model.store.stats()
        except Exception as exc:
            world = {"error": str(exc)}
        return {
            "version": "1.7.0rc1",
            "mode": "Infinity 7 / Electron",
            "stop_engaged": bool(r.kill_switch.engaged),
            "provider": getattr(r.providers, "active_name", "unknown"),
            "permissions": dict(r.policy.rules),
            "perception": _jsonable(perception),
            "project": project,
            "health": _jsonable(health),
            "mobile": _jsonable(mobile),
            "reality": _jsonable(reality),
            "world": _jsonable(world),
            "workbench": _jsonable(r.workbench.store.stats()),
            "swarm": _jsonable(r.swarm.store.stats()),
            "evolution": _jsonable(r.evolution.store.stats()),
        }

    def handle(self, req: dict[str, Any]) -> dict[str, Any]:
        op = str(req.get("op", "")).strip()
        args = req.get("args") or {}
        r = self.runtime
        with self._lock:
            if op == "ping":
                return {"ok": True, "result": {"name": "JARVIS GM", "version": "1.7.0rc1", "bridge": "electron-stdio"}}
            if op == "status":
                return {"ok": True, "result": self._status()}
            if op == "run_goal":
                text = str(args.get("text", "")).strip()
                if not text:
                    raise ValueError("La orden está vacía")
                normalized, alias = _normalize_owner_goal(text)
                goal = r.orchestrator.run(normalized)
                return {"ok": True, "result": _goal_response(goal, original=text, normalized=normalized, alias=alias)}
            if op == "run_goal_authorized":
                text = str(args.get("text", "")).strip()
                capability = str(args.get("capability", "")).strip()
                mode = str(args.get("mode", "once")).strip().lower()
                if not text:
                    raise ValueError("La orden está vacía")
                if capability not in DEFAULT_POLICY:
                    raise ValueError(f"Permiso desconocido: {capability}")
                if mode not in {"once", "always"}:
                    raise ValueError("mode debe ser once o always")
                original_allowed = r.policy.is_allowed(capability)
                normalized, alias = _normalize_owner_goal(text)
                try:
                    r.policy.set(capability, True)
                    try:
                        r.guardian.grant_capability(capability, ttl_s=90.0, uses=3)
                    except Exception:
                        pass
                    goal = r.orchestrator.run(normalized)
                finally:
                    if mode == "once":
                        r.policy.set(capability, original_allowed)
                payload = _goal_response(goal, original=text, normalized=normalized, alias=alias)
                payload["permission_mode"] = mode
                payload["permission_persisted"] = bool(mode == "always")
                return {"ok": True, "result": payload}
            if op == "stop":
                r.emergency_release_inputs()
                r.kill_switch.engage()
                try: r.guardian.revoke_all()
                except Exception: pass
                try: r.sentinel.stop()
                except Exception: pass
                try: r.reality.stop_monitor()
                except Exception: pass
                try: r.perception.stop_all()
                except Exception: pass
                return {"ok": True, "result": {"stop_engaged": True}}
            if op == "reset_stop":
                r.kill_switch.reset()
                try: r.ensure_health_monitor()
                except Exception: pass
                return {"ok": True, "result": {"stop_engaged": False}}
            if op == "permissions":
                return {"ok": True, "result": dict(r.policy.rules)}
            if op == "set_permission":
                capability = str(args.get("capability", "")).strip()
                if capability not in DEFAULT_POLICY:
                    raise ValueError(f"Permiso desconocido: {capability}")
                allowed = bool(args.get("allowed", False))
                r.policy.set(capability, allowed)
                return {"ok": True, "result": {"capability": capability, "allowed": allowed}}
            if op == "guardian_grant":
                capability = str(args.get("capability", "")).strip()
                ttl = float(args.get("ttl_s", 120))
                uses = int(args.get("uses", 1))
                lease = r.guardian.grant_capability(capability, ttl_s=ttl, uses=uses)
                return {"ok": True, "result": {"lease": lease, "capability": capability, "ttl_s": ttl, "uses": uses}}
            if op == "provider_get":
                p = r.providers.active
                return {"ok": True, "result": {"active": r.providers.active_name, "model": getattr(p, "model", r.provider_settings.gemini_model), "has_key": bool(getattr(p, "api_key", None))}}
            if op == "provider_set":
                p = r.providers.active
                model = str(args.get("model", "")).strip()
                key = str(args.get("api_key", "")).strip()
                if model:
                    r.provider_settings.gemini_model = model
                    if hasattr(p, "model"): p.model = model
                r.provider_settings.active = r.providers.active_name
                r.provider_settings.save()
                if key:
                    if hasattr(p, "api_key"): p.api_key = key
                    if r.credentials.available:
                        r.credentials.set("GEMINI_API_KEY", key)
                return {"ok": True, "result": {"active": r.providers.active_name, "model": getattr(p, "model", model), "has_key": bool(getattr(p, "api_key", None))}}
            if op == "voice_start":
                r.perception.start_voice(); return {"ok": True, "result": r.perception.status()}
            if op == "voice_stop":
                r.perception.stop_voice(); return {"ok": True, "result": r.perception.status()}
            if op == "vision_start":
                r.perception.start_vision(); return {"ok": True, "result": r.perception.status()}
            if op == "vision_stop":
                r.perception.stop_vision(); return {"ok": True, "result": r.perception.status()}
            if op == "sentinel_start":
                r.sentinel.start(); return {"ok": True, "result": {"running": r.sentinel.running}}
            if op == "sentinel_stop":
                r.sentinel.stop(); return {"ok": True, "result": {"running": r.sentinel.running}}
            if op == "speak":
                text = str(args.get("text", "")); r.perception.speak(text); return {"ok": True, "result": {"spoken": True}}
            if op == "screen_snapshot":
                snap = r.screen.snapshot(include_image=False)
                return {"ok": True, "result": _jsonable(snap.compact(limit=int(args.get("limit", 120))))}
            if op == "memory_resume":
                return {"ok": True, "result": _jsonable(r.memory_manager.resume(str(args.get("query", ""))))}
            if op == "memory_search":
                return {"ok": True, "result": _jsonable(r.memory_manager.retrieve(str(args.get("query", "")), limit=int(args.get("limit", 8))))}
            if op == "memory_remember":
                return {"ok": True, "result": _jsonable(r.memory_manager.remember(str(args.get("content", "")), title=str(args.get("title", ""))))}
            if op == "projects":
                return {"ok": True, "result": _jsonable(r.memory_manager.store.list_projects())}
            if op == "research_run":
                report = r.research_corps.run(str(args.get("question", "")), depth=str(args.get("depth", "standard")))
                return {"ok": True, "result": _jsonable(report)}
            if op == "research_list":
                return {"ok": True, "result": _jsonable(r.research_corps.list(int(args.get("limit", 25))))}
            if op == "workbench_list":
                return {"ok": True, "result": _jsonable(r.workbench.store.list(limit=int(args.get("limit", 100))))}
            if op == "workbench_create":
                item = r.workbench.create(str(args.get("goal", "")), priority=int(args.get("priority", 50)), step_budget=int(args.get("step_budget", 30)))
                return {"ok": True, "result": _jsonable(item)}
            if op == "workbench_cycle":
                return {"ok": True, "result": _jsonable(r.workbench.run_cycle(max_jobs=args.get("max_jobs")))}
            if op == "swarm_run":
                return {"ok": True, "result": _jsonable(r.swarm.run(str(args.get("goal", ""))))}
            if op == "swarm_list":
                return {"ok": True, "result": _jsonable(r.swarm.store.list(limit=int(args.get("limit", 50))))}
            if op == "skills_list":
                return {"ok": True, "result": _jsonable(r.skill_store.list())}
            if op == "evolution_scan":
                return {"ok": True, "result": _jsonable(r.evolution.scan())}
            if op == "evolution_list":
                return {"ok": True, "result": _jsonable(r.evolution.store.list(limit=int(args.get("limit", 50))))}
            if op == "mobile_summary":
                return {"ok": True, "result": _jsonable(r.mobile.summary())}
            if op == "reality_status":
                return {"ok": True, "result": _jsonable(r.reality.status())}
            if op == "reality_list":
                return {"ok": True, "result": _jsonable(r.reality.list_devices())}
            if op == "world_snapshot":
                r.world_model.sync()
                return {"ok": True, "result": {"stats": r.world_model.store.stats(), "entities": r.world_model.store.entities(limit=int(args.get("limit", 60))), "relations": r.world_model.store.relations(limit=int(args.get("limit", 80))), "observations": r.world_model.store.recent_observations(limit=int(args.get("observations", 30)))}}
            if op == "diagnostics":
                return {"ok": True, "result": _jsonable(r.diagnostics.run(r))}
            if op == "release_gate":
                return {"ok": True, "result": _jsonable(r.release_gate.evaluate(r))}
            if op == "self_test":
                ok, checks = run_self_test()
                return {"ok": bool(ok), "result": {"ok": bool(ok), "checks": _jsonable(checks)}}
            if op == "shutdown":
                self.close(); return {"ok": True, "result": {"shutdown": True}}
            raise ValueError(f"Operación Electron desconocida: {op}")


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    bridge: Bridge | None = None
    try:
        bridge = Bridge()
        _emit({"event": "ready", "version": "1.7.0rc1"})
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            req_id = None
            try:
                req = json.loads(line)
                req_id = req.get("id")
                result = bridge.handle(req)
                result["id"] = req_id
                _emit(result)
                if req.get("op") == "shutdown":
                    break
            except Exception as exc:
                _emit({"id": req_id, "ok": False, "error": str(exc), "type": type(exc).__name__, "trace": traceback.format_exc(limit=8)})
        return 0
    except Exception as exc:
        _emit({"event": "fatal", "ok": False, "error": str(exc), "type": type(exc).__name__, "trace": traceback.format_exc(limit=12)})
        return 2
    finally:
        if bridge is not None:
            bridge.close()


if __name__ == "__main__":
    raise SystemExit(main())
