from __future__ import annotations

from pathlib import Path

overlay = Path(__file__).with_name("windows_sapi_inproc.py").read_text(encoding="utf-8")
assert 'SAPI.SpInprocRecognizer' in overlay
assert 'SAPI.SpSharedRecognizer' not in overlay
assert 'recognizer.AudioInput = audio_token' in overlay
assert 'win32com.client.dynamic.Dispatch' in overlay
assert 'System.Speech.Recognition.SpeechRecognitionEngine' in overlay
assert 'CREATE_NO_WINDOW' in overlay
print("PRIVATE_SAPI_CONTRACT=PASS")
