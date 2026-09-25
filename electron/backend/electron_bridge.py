from __future__ import annotations

import json
import os
import sys
import traceback
from dataclasses import asdict, is_dataclass
from enum import Enum
from pathlib import Path
from typing import Any

# When bundled by PyInstaller this import path is resolved from the packaged jarvis_gm package.
from jarvis_gm.runtime import build_infinity7_runtime, default_data_dir
from jarvis_gm.core.models import ActionRequest
from jarvis_gm.self_test import run_self_test


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return {k: _jsonable(v) for k, v in asdict(value).items()}
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "as_dict"):
        try:
            return _jsonable(value.as_dict())
        except Exception:
            pass
    return str(value)


def _write(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(_jsonable(payload), ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


class Bridge:
    def __init__(self) -> None:
        self.runtime = None
        self.data_dir = default_data_dir()

    def boot(self) -> dict[str, Any]:
        if self.runtime is None:
            self.runtime = build_infinity7_runtime(self.data_dir)
        return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        rt = self.runtime
        if rt is None:
            return {"ready": False, "version": "1.7.0rc1", "data_dir": str(self.data_dir)}
        action_map = rt.orchestrator.executor.actions
        return {
            "ready": True,
            "version": "1.7.0rc1",
            "phase": "Infinity-7",
            "data_dir": str(rt.data_dir),
            "provider": {
                "name": rt.providers.active_name,
                "available": bool(rt.providers.active.available),
                "model": getattr(rt.providers.active, "model", None),
            },
            "kill_switch": bool(rt.kill_switch.engaged),
            "safe_mode": bool(rt.recovery_state.safe_mode),
            "permissions": dict(rt.policy.rules),
            "actions": [
                {"name": name, "capability": action.capability}
                for name, action in sorted(action_map.items())
            ],
            "modules": self.modules(),
        }

    def modules(self) -> list[dict[str, Any]]:
        rt = self.runtime
        def yes(attr: str) -> bool:
            return bool(rt is not None and hasattr(rt, attr))
        return [
            {"id":"core","name":"Intent Core + Orchestrator","ready":yes("orchestrator")},
            {"id":"guardian","name":"Guardian","ready":yes("guardian")},
            {"id":"world","name":"World Model","ready":yes("world_model")},
            {"id":"voice","name":"Voice / Wake Gate","ready":yes("perception")},
            {"id":"vision","name":"Vision / Gestures","ready":yes("perception")},
            {"id":"screen","name":"Screen Grounding","ready":yes("screen")},
            {"id":"memory","name":"Persistent Memory","ready":yes("memory_manager")},
            {"id":"skills","name":"Skill Forge / Skill Lab","ready":yes("skill_forge")},
            {"id":"research","name":"Research Corps","ready":yes("research_corps")},
            {"id":"autopilot","name":"Mission Autopilot","ready":yes("autonomy_engine")},
            {"id":"aios","name":"Personal AI OS","ready":yes("personal_os")},
            {"id":"workbench","name":"Autonomous Workbench","ready":yes("workbench")},
            {"id":"swarm","name":"Cognitive Swarm","ready":yes("swarm")},
            {"id":"evolution","name":"Self-Evolution Engine","ready":yes("evolution")},
            {"id":"mobile","name":"Mobile Sovereign Bridge","ready":yes("mobile")},
            {"id":"reality","name":"Reality Bridge","ready":yes("reality")},
            {"id":"health","name":"Health Supervisor","ready":yes("health")},
            {"id":"backup","name":"Backup / Recovery","ready":yes("backup")},
            {"id":"release","name":"Release Gate","ready":yes("release_gate")},
        ]

    def _ensure(self):
        if self.runtime is None:
            self.boot()
        return self.runtime

    def _invoke(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        rt = self._ensure()
        action = rt.orchestrator.executor.actions.get(name)
        if action is None:
            raise KeyError(f"Unknown action: {name}")
        req = ActionRequest(name=name, args=dict(args or {}), capability=action.capability)
        result = rt.orchestrator.executor.execute(req)
        verified, detail = rt.orchestrator.verifier.verify(req, result)
        return {"result": result, "verified": bool(verified), "verification": detail}

    def handle(self, op: str, payload: dict[str, Any]) -> Any:
        if op == "ping":
            return {"pong": True, "pid": os.getpid(), "version": "1.7.0rc1"}
        if op == "boot":
            return self.boot()
        if op == "snapshot":
            return self.snapshot()
        if op == "modules":
            return self.modules()

        rt = self._ensure()

        if op == "diagnostics":
            return rt.diagnostics.run(rt)
        if op == "self_test":
            ok, checks = run_self_test()
            return {"ok": bool(ok), "checks": checks, "count": len(checks)}
        if op == "actions":
            return [
                {"name": n, "capability": a.capability}
                for n, a in sorted(rt.orchestrator.executor.actions.items())
            ]
        if op == "permissions":
            return dict(rt.policy.rules)
        if op == "set_permission":
            capability = str(payload["capability"])
            allowed = bool(payload["allowed"])
            rt.policy.set(capability, allowed)
            if capability == "health.monitor":
                if allowed:
                    rt.ensure_health_monitor()
                else:
                    rt.health.stop()
            return {"capability": capability, "allowed": allowed}
        if op == "stop":
            rt.kill_switch.engage()
            rt.stop_all()
            return {"engaged": True}
        if op == "rearm":
            rt.kill_switch.reset()
            rt.ensure_health_monitor()
            return {"engaged": False}
        if op == "start_perception":
            rt.start_bridge()
            return {"started": True, "status": rt.perception.status()}
        if op == "start_sentinel":
            rt.start_sentinel()
            return {"started": True, "status": rt.perception.status()}
        if op == "stop_perception":
            rt.stop_all()
            return {"stopped": True}
        if op == "command":
            text = str(payload.get("text") or "").strip()
            if not text:
                raise ValueError("Command text is empty")
            return rt.orchestrator.run(text)
        if op == "invoke":
            return self._invoke(str(payload.get("name") or ""), dict(payload.get("args") or {}))
        if op == "provider_status":
            p = rt.providers.active
            return {"name": rt.providers.active_name, "available": bool(p.available), "model": getattr(p, "model", None)}
        if op == "provider_config":
            key = str(payload.get("api_key") or "").strip()
            model = str(payload.get("model") or "").strip()
            if key:
                rt.credentials.set("GEMINI_API_KEY", key)
                rt.providers.active.api_key = key
            if model:
                rt.provider_settings.gemini_model = model
                rt.provider_settings.save()
                rt.providers.active.model = model
            return {"name": rt.providers.active_name, "available": bool(rt.providers.active.available), "model": getattr(rt.providers.active, "model", None), "credential_store": rt.credentials.available}
        if op == "provider_clear_key":
            rt.credentials.delete("GEMINI_API_KEY")
            rt.providers.active.api_key = None
            return {"available": False}
        if op == "acceptance_report":
            return rt.acceptance.report()
        if op == "acceptance_set":
            return rt.acceptance.set_owner_result(str(payload["name"]), str(payload["status"]), str(payload.get("note") or ""))
        if op == "backup_create":
            destination = Path(str(payload.get("destination") or "")).expanduser()
            if not str(destination):
                raise ValueError("Backup destination required")
            return {"path": rt.backup.create(destination)}
        if op == "backup_validate":
            source = Path(str(payload.get("source") or "")).expanduser()
            return rt.backup.validate(source)
        if op == "backup_stage_restore":
            source = Path(str(payload.get("source") or "")).expanduser()
            return {"path": rt.backup.stage_restore(source), "restart_required": True}
        if op == "release_gate":
            diag = rt.diagnostics.run(rt)
            return rt.release_gate.evaluate_from_diagnostics(diag, rt)
        if op == "world_stats":
            return rt.world_model.store.stats()
        if op == "mobile_summary":
            return rt.mobile.summary()
        if op == "reality_status":
            return rt.reality.status()
        if op == "workbench_stats":
            return rt.workbench.store.stats()
        if op == "swarm_stats":
            return rt.swarm.store.stats()
        if op == "evolution_stats":
            return rt.evolution.store.stats()
        if op == "shutdown":
            try:
                rt.clean_shutdown()
            finally:
                self.runtime = None
            return {"shutdown": True}
        raise KeyError(f"Unknown bridge operation: {op}")


def main() -> int:
    bridge = Bridge()
    if "--smoke" in sys.argv:
        try:
            snap = bridge.boot()
            ok, checks = run_self_test()
            if not ok:
                raise RuntimeError(f"self-test failed: {checks}")
            sys.stdout.write(json.dumps({"ok": True, "snapshot": _jsonable(snap), "checks": len(checks)}, ensure_ascii=False) + "\n")
            sys.stdout.flush()
            bridge.runtime.clean_shutdown()
            bridge.runtime = None
            return 0
        except Exception as exc:
            sys.stderr.write(f"SMOKE_FAIL: {exc}\n")
            traceback.print_exc(file=sys.stderr)
            return 2
    _write({"event":"bridge.ready","version":"1.7.0rc1","pid":os.getpid()})
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        req_id = None
        try:
            req = json.loads(raw)
            req_id = req.get("id")
            op = str(req.get("op") or "")
            payload = req.get("payload") or {}
            result = bridge.handle(op, payload)
            _write({"id":req_id,"ok":True,"result":result})
            if op == "shutdown":
                break
        except Exception as exc:
            _write({
                "id":req_id,
                "ok":False,
                "error":str(exc),
                "type":type(exc).__name__,
                "trace":traceback.format_exc(limit=8),
            })
    if bridge.runtime is not None:
        try:
            bridge.runtime.clean_shutdown()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())