from __future__ import annotations

from types import SimpleNamespace

from electron_bridge import _confirmation_mode, _normalize_owner_goal, _normalize_phrase, AssistantVoiceLoop

assert _normalize_phrase("¿Estás ahí?") == "estas ahi"
assert _confirmation_mode("Sí") == "once"
assert _confirmation_mode("permite una vez") == "once"
assert _confirmation_mode("permite siempre") == "always"
assert _confirmation_mode("cancela") == "cancel"
assert _normalize_owner_goal("ABRE YOUTUBE")[0] == "abre https://www.youtube.com"
assert _normalize_owner_goal("abre google")[0] == "abre https://www.google.com"

fake_bridge=SimpleNamespace(EVENT_TYPES={"voice.command","gesture.point","gesture.pinch_start"})
fake_runtime=SimpleNamespace(bridge=fake_bridge)
loop=AssistantVoiceLoop(fake_runtime)
loop.prepare()
assert "voice.command" not in fake_runtime.bridge.EVENT_TYPES
assert "gesture.point" in fake_runtime.bridge.EVENT_TYPES

print("VOICE_ASSISTANT_CONTRACT=PASS")
