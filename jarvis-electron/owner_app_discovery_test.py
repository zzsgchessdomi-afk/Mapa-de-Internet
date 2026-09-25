from pathlib import Path
p=Path(__file__).with_name("electron_bridge.py").read_text(encoding="utf-8")
for token in ["_register_owner_apps", '"chrome"', '"edge"', '"vscode"', "runtime.apps.register"]:
    assert token in p, token
print("OWNER_APP_DISCOVERY_CONTRACT=PASS")
