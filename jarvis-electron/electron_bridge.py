from __future__ import annotations

import dataclasses
import glob
import json
import os
import queue
import re
import shutil
import sys
import threading
import time
import unicodedata
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


def _voice_probe(runtime) -> dict[str, Any]:
    out: dict[str, Any] = {"platform": sys.platform}
    try:
        out["perception"] = _jsonable(runtime.perception.status())
    except Exception as exc:
        out["perception_error"] = str(exc)
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        default_in = sd.default.device[0] if isinstance(sd.default.device, (tuple, list)) else sd.default.device
        out["audio"] = {
            "default_input_index": int(default_in) if default_in is not None else None,
            "inputs": [
                {"index": i, "name": str(d.get("name", "")), "channels": int(d.get("max_input_channels", 0))}
                for i, d in enumerate(devices) if int(d.get("max_input_channels", 0)) > 0
            ][:20],
        }
    except Exception as exc:
        out["audio_error"] = str(exc)
    if os.name == "nt":
        try:
            import win32com.client.dynamic
            cat = win32com.client.dynamic.Dispatch("SAPI.SpObjectTokenCategory")
            cat.SetId(r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\AudioInput")
            toks = cat.EnumerateTokens()
            names = []
            for i in range(int(toks.Count)):
                token = toks.Item(i)
                try:
                    names.append(str(token.GetDescription()))
                except Exception:
                    names.append(str(token.Id))
            out["sapi_audio_inputs"] = names
        except Exception as exc:
            out["sapi_probe_error"] = str(exc)
    return out


def _normalize_phrase(text: str) -> str:
    raw = unicodedata.normalize("NFKD", str(text or "").casefold())
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = re.sub(r"[^a-z0-9áéíóúüñ ]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def _confirmation_mode(text: str) -> str | None:
    low = _normalize_phrase(text)
    if low in {"no", "cancela", "cancelar", "no lo hagas", "detente", "olvidalo", "olvídalo"}:
        return "cancel"
    if low in {"siempre", "permite siempre", "permitir siempre", "autoriza siempre", "autorizalo siempre", "autorízalo siempre"}:
        return "always"
    if low in {"si", "sí", "dale", "hazlo", "adelante", "confirma", "confirmo", "autoriza", "autorizar", "permite", "permitir", "permite una vez", "autoriza una vez"}:
        return "once"
    return None


class AssistantVoiceLoop:
    """Voice-first owner interaction for Infinity 7.

    The original IntentControlBridge remains responsible for gestures. Voice commands
    are removed from that bridge and handled here so wake, spoken replies and owner
    permission confirmation form one closed loop.
    """

    def __init__(self, runtime) -> None:
        self.runtime = runtime
        self._token = None
        self._queue: queue.Queue[Any | None] = queue.Queue(maxsize=256)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._pending: dict[str, Any] | None = None
        self._mute_until = 0.0
        self.autostart_attempted = False
        self.last_voice_error: str | None = None

    def prepare(self) -> None:
        # Do not let the legacy bridge execute voice.command in parallel.
        try:
            self.runtime.bridge.EVENT_TYPES = set(self.runtime.bridge.EVENT_TYPES) - {"voice.command"}
        except Exception:
            pass

    def start(self) -> None:
        if self._token is None:
            self._token = self.runtime.perception.bus.subscribe(self._enqueue)
        if self._thread is None or not self._thread.is_alive():
            self._stop.clear()
            self._thread = threading.Thread(target=self._worker, name="jarvis-assistant-voice", daemon=True)
            self._thread.start()
        self.autostart_attempted = True
        try:
            self.runtime.perception.start_voice()
        except Exception as exc:
            self.last_voice_error = str(exc)
            _emit({"event": "voice-status", "status": "error", "detail": str(exc)})

    def stop(self) -> None:
        if self._token is not None:
            try:
                self.runtime.perception.bus.unsubscribe(self._token)
            except Exception:
                pass
            self._token = None
        self._stop.set()
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass
        if self._thread and self._thread.is_alive() and threading.current_thread() is not self._thread:
            self._thread.join(timeout=1.5)
        self._thread = None

    def status(self) -> dict[str, Any]:
        return {
            "voice_first": True,
            "autostart_attempted": self.autostart_attempted,
            "pending_permission": bool(self._pending),
            "last_voice_error": self.last_voice_error,
        }

    def _enqueue(self, event) -> None:
        if event.type not in {"voice.transcript", "voice.wake", "voice.command", "sensor.voice"}:
            return
        try:
            self._queue.put_nowait(event)
        except queue.Full:
            try:
                self._queue.get_nowait()
                self._queue.put_nowait(event)
            except queue.Empty:
                pass

    def _worker(self) -> None:
        while not self._stop.is_set():
            try:
                event = self._queue.get(timeout=0.25)
            except queue.Empty:
                continue
            if event is None:
                break
            try:
                self._handle_event(event)
            except Exception as exc:
                self.last_voice_error = str(exc)
                _emit({"event": "assistant", "kind": "error", "text": f"Tuve un problema con la voz: {exc}"})

    def _speak(self, text: str, *, kind: str = "assistant") -> None:
        clean = str(text or "").strip()
        if not clean:
            return
        # Prevent the recognizer from treating JARVIS' own TTS as a new command.
        self._mute_until = time.time() + max(1.4, min(8.0, len(clean) / 13.0))
        _emit({"event": "assistant", "kind": kind, "text": clean})
        try:
            self.runtime.perception.speak(clean)
        except Exception as exc:
            self.last_voice_error = str(exc)
            _emit({"event": "voice-status", "status": "tts-error", "detail": str(exc)})

    def _handle_event(self, event) -> None:
        if event.type == "sensor.voice":
            _emit({
                "event": "voice-status",
                "status": str(event.payload.get("status", "")),
                "detail": str(event.payload.get("detail", "")),
            })
            return

        if event.type == "voice.transcript":
            if time.time() < self._mute_until:
                return
            text = str(event.payload.get("text", "")).strip()
            low = _normalize_phrase(text)
            if low in {"estas ahi", "jarvis estas ahi", "sigues ahi", "jarvis sigues ahi"}:
                self._speak("Sí, aquí estoy.")
            return

        if time.time() < self._mute_until:
            return

        if event.type == "voice.wake":
            _emit({"event": "voice-wake"})
            try:
                self.runtime.perception.wake._awake_until = time.time() + 12.0
            except Exception:
                pass
            self._speak("Sí, aquí estoy.", kind="wake")
            return

        if event.type == "voice.command":
            text = str(event.payload.get("text", "")).strip()
            if not text:
                return
            _emit({"event": "voice-command", "text": text})
            self._handle_command(text)

    def _handle_command(self, text: str) -> None:
        low = _normalize_phrase(text)

        if low in {"estas ahi", "sigues ahi"}:
            self._speak("Sí, aquí estoy.")
            return

        if self._pending is not None:
            mode = _confirmation_mode(text)
            if mode == "cancel":
                self._pending = None
                _emit({"event": "voice-permission-cleared"})
                self._speak("Entendido. No haré esa acción.")
                return
            if mode in {"once", "always"}:
                self.confirm_pending(mode)
                return

        normalized, alias = _normalize_owner_goal(text)
        goal = self.runtime.orchestrator.run(normalized)
        payload = _goal_response(goal, original=text, normalized=normalized, alias=alias)
        self._announce_goal(payload)

    def _announce_goal(self, payload: dict[str, Any]) -> None:
        state = str(payload.get("state", "")).lower()
        if state == "blocked" and payload.get("capability"):
            capability = str(payload["capability"])
            self._pending = {
                "text": str(payload.get("text", "")),
                "capability": capability,
            }
            label = payload.get("capability_label") or capability
            prompt = f"Necesito tu autorización para {label}. Di permite una vez, permite siempre o cancela."
            try:
                self.runtime.perception.wake._awake_until = time.time() + 24.0
            except Exception:
                pass
            _emit({
                "event": "voice-permission",
                "text": self._pending["text"],
                "capability": capability,
                "capability_label": label,
                "prompt": prompt,
            })
            self._speak(prompt, kind="permission")
            return

        self._pending = None
        _emit({"event": "voice-permission-cleared"})
        self._speak(str(payload.get("message") or "Orden procesada."), kind=state or "assistant")

    def confirm_pending(self, mode: str) -> dict[str, Any]:
        mode = str(mode or "").strip().lower()
        if mode == "cancel":
            self._pending = None
            _emit({"event": "voice-permission-cleared"})
            self._speak("Entendido. No haré esa acción.")
            return {"cancelled": True}
        if mode not in {"once", "always"}:
            raise ValueError("mode debe ser once, always o cancel")
        if not self._pending:
            self._speak("No tengo ninguna autorización pendiente.")
            return {"pending": False}

        pending = dict(self._pending)
        capability = str(pending["capability"])
        text = str(pending["text"])
        original_allowed = self.runtime.policy.is_allowed(capability)
        normalized, alias = _normalize_owner_goal(text)
        try:
            self.runtime.policy.set(capability, True)
            # A one-use lease is harmless for medium-risk actions and required for high-risk ones.
            try:
                self.runtime.guardian.grant_capability(capability, ttl_s=90.0, uses=1)
            except Exception:
                pass
            goal = self.runtime.orchestrator.run(normalized)
        finally:
            if mode == "once":
                self.runtime.policy.set(capability, original_allowed)

        if mode == "always":
            self.runtime.policy.set(capability, True)

        payload = _goal_response(goal, original=text, normalized=normalized, alias=alias)
        payload["permission_mode"] = mode
        payload["permission_persisted"] = bool(mode == "always")
        self._announce_goal(payload)
        return payload



def _first_existing(candidates: list[str]) -> str | None:
    for candidate in candidates:
        if not candidate:
            continue
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
        expanded = os.path.expandvars(candidate)
        if "*" in expanded or "?" in expanded:
            hits = sorted((Path(x) for x in glob.glob(expanded)), key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)
            for hit in hits:
                if hit.is_file():
                    return str(hit)
            continue
        p = Path(expanded).expanduser()
        if p.is_file():
            return str(p)
    return None


def _register_owner_apps(runtime) -> dict[str, str]:
    """Register common desktop apps only when they actually exist on this PC."""
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    pfx86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    local = os.environ.get("LOCALAPPDATA", "")
    roaming = os.environ.get("APPDATA", "")
    catalog = {
        "chrome": ["chrome.exe", rf"{pf}\Google\Chrome\Application\chrome.exe", rf"{pfx86}\Google\Chrome\Application\chrome.exe", rf"{local}\Google\Chrome\Application\chrome.exe"],
        "edge": ["msedge.exe", rf"{pf}\Microsoft\Edge\Application\msedge.exe", rf"{pfx86}\Microsoft\Edge\Application\msedge.exe"],
        "firefox": ["firefox.exe", rf"{pf}\Mozilla Firefox\firefox.exe", rf"{pfx86}\Mozilla Firefox\firefox.exe"],
        "vscode": ["code.exe", rf"{local}\Programs\Microsoft VS Code\Code.exe", rf"{pf}\Microsoft VS Code\Code.exe"],
        "spotify": ["Spotify.exe", rf"{roaming}\Spotify\Spotify.exe"],
        "discord": ["Discord.exe", rf"{local}\Discord\app-*\Discord.exe"],
        "wps": ["wps.exe", rf"{local}\Kingsoft\WPS Office\ksolaunch.exe"],
    }
    aliases = {
        "google chrome": "chrome", "navegador chrome": "chrome",
        "microsoft edge": "edge", "navegador edge": "edge",
        "mozilla firefox": "firefox", "visual studio code": "vscode", "vs code": "vscode",
    }
    found: dict[str, str] = {}
    for alias, candidates in catalog.items():
        executable = _first_existing(candidates)
        if not executable:
            continue
        try:
            runtime.apps.register(alias, executable)
            found[alias] = executable
        except Exception:
            continue
    for alias, target in aliases.items():
        if target in found:
            try:
                runtime.apps.register(alias, found[target])
            except Exception:
                pass
    browser = found.get("chrome") or found.get("edge") or found.get("firefox")
    if browser:
        for alias in ("navegador", "browser", "internet"):
            try:
                runtime.apps.register(alias, browser)
            except Exception:
                pass
    return found


class Bridge:
    def __init__(self) -> None:
        self.runtime = build_infinity7_runtime()
        self.owner_apps = _register_owner_apps(self.runtime)
        self._lock = threading.RLock()
        self.voice_loop = AssistantVoiceLoop(self.runtime)
        self.voice_loop.prepare()
        try:
            self.runtime.start_bridge()
        except Exception:
            pass
        # Voice is the primary interface. Text remains only a fallback.
        self.voice_loop.start()

    def close(self) -> None:
        try:
            self.voice_loop.stop()
        except Exception:
            pass
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
            "assistant": self.voice_loop.status(),
            "owner_apps": sorted(self.owner_apps),
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
                try: r.perception.start_voice()
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
            if op == "voice_restart":
                r.perception.stop_voice()
                time.sleep(0.25)
                r.perception.start_voice()
                return {"ok": True, "result": r.perception.status()}
            if op == "voice_probe":
                return {"ok": True, "result": _voice_probe(r)}
            if op == "voice_stop":
                r.perception.stop_voice(); return {"ok": True, "result": r.perception.status()}
            if op == "voice_permission":
                return {"ok": True, "result": self.voice_loop.confirm_pending(str(args.get("mode", "once")))}
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
            if op == "autonomy_list":
                return {"ok": True, "result": _jsonable(r.autonomy_store.list(limit=int(args.get("limit", 50))))}
            if op == "autonomy_run":
                goal = str(args.get("goal", "")).strip()
                if not goal:
                    raise ValueError("Mission goal cannot be empty")
                criteria = args.get("success_criteria") or []
                if isinstance(criteria, str):
                    criteria = [x.strip() for x in criteria.split(";") if x.strip()]
                mission = r.autonomy_engine.run(goal, success_criteria=list(criteria), max_steps=int(args.get("max_steps", 10)))
                return {"ok": True, "result": _jsonable(mission)}
            if op == "autonomy_resume":
                mission_id = str(args.get("mission_id", "")).strip()
                if not mission_id:
                    raise ValueError("mission_id is required")
                mission = r.autonomy_engine.resume(mission_id, max_steps=int(args.get("max_steps", 10)))
                return {"ok": True, "result": _jsonable(mission)}
            if op == "aios_sync":
                return {"ok": True, "result": _jsonable(r.personal_os.sync())}
            if op == "aios_resources":
                kind = args.get("kind")
                return {"ok": True, "result": _jsonable(r.personal_os.resources(kind=str(kind) if kind else None, limit=int(args.get("limit", 100))))}
            if op == "aios_plan":
                payload = args.get("payload") or {}
                return {"ok": True, "result": _jsonable(r.personal_os.plan(
                    str(args.get("operation", "")),
                    resource_ref=args.get("resource_ref"),
                    destination_ref=args.get("destination_ref"),
                    payload=payload,
                ))}
            if op == "aios_execute":
                payload = args.get("payload") or {}
                return {"ok": True, "result": _jsonable(r.personal_os.execute(
                    str(args.get("operation", "")),
                    resource_ref=args.get("resource_ref"),
                    destination_ref=args.get("destination_ref"),
                    payload=payload,
                ))}
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
