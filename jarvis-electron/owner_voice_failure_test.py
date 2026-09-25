from pathlib import Path
import importlib.util

path=Path(__file__).with_name("windows_sapi_inproc.py")
spec=importlib.util.spec_from_file_location("jarvis_voice_overlay", path)
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
r=mod.WindowsSapiRecognizer()
events=[]
def primary(_cb): raise RuntimeError("simulated gen_py failure")
def fallback(_cb,status_cb,err):
    events.append(("fallback",str(err)))
    r._stop.set()
r._run_private_sapi=primary
r._run_system_speech=fallback
r._run(lambda *_:None,lambda s,d:events.append((s,d)))
assert any(e[0]=="fallback" for e in events), events
assert "System.Speech.Recognition.SpeechRecognitionEngine" in path.read_text(encoding="utf-8")
assert 'Where-Object { $_.Culture.Name -like "es-*"' in path.read_text(encoding="utf-8")
print("OWNER_GENPY_FAILURE_FALLBACK=PASS")
