from pathlib import Path
p=Path(__file__).with_name("electron_bridge.py").read_text(encoding="utf-8")
for token in ['op == "voice_probe"', 'op == "voice_restart"', "sounddevice", "sapi_audio_inputs"]:
    assert token in p, token
print("VOICE_DIAGNOSTIC_CONTRACT=PASS")
