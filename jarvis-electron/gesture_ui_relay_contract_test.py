from pathlib import Path
p=Path(__file__).with_name("electron_bridge.py").read_text(encoding="utf-8")
for token in [
    "class PerceptionUiRelay",
    '"gesture.armed"', '"gesture.point"', '"gesture.pinch_start"',
    '"gesture.transform"', '"intent.execution_result"',
    '"event": "perception-ui"',
    "1.0 / 15.0",
]:
    assert token in p, token
print("GESTURE_UI_RELAY_CONTRACT=PASS")
