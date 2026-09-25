from pathlib import Path
p=Path(__file__).with_name("windows_sapi_inproc.py").read_text(encoding="utf-8")
for token in [
    "win32com.client.dynamic.Dispatch",
    "System.Speech.Recognition.SpeechRecognitionEngine",
    "CREATE_NO_WINDOW",
    "Switching to hidden Windows System.Speech fallback",
    "JARVIS_ERROR",
]:
    assert token in p, token
assert 'Dispatch("SAPI.SpSharedRecognizer")' not in p
print("RESILIENT_WINDOWS_VOICE_CONTRACT=PASS")
