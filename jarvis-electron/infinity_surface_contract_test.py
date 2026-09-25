from pathlib import Path
p=Path(__file__).with_name("electron_bridge.py").read_text(encoding="utf-8")
required=[
    'op == "autonomy_run"',
    'op == "autonomy_resume"',
    'op == "autonomy_list"',
    'op == "aios_sync"',
    'op == "aios_resources"',
    'op == "aios_plan"',
    'op == "aios_execute"',
    'r.autonomy_engine.run',
    'r.personal_os.execute',
]
for token in required:
    assert token in p, token
print("INFINITY_SURFACE_CONTRACT=PASS")
