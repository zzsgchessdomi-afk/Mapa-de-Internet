from __future__ import annotations
import importlib.metadata as md
import json, re
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "bundled-agent-engine"
OUT.mkdir(parents=True, exist_ok=True)
ROOTS = {"crewai", "gpt-researcher", "fastapi", "uvicorn", "httpx"}

def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name.strip().lower())

dists = {norm((d.metadata.get("Name") or "")): d for d in md.distributions() if d.metadata.get("Name")}
selected = set()
queue = list(ROOTS)

try:
    from packaging.requirements import Requirement
except Exception:
    Requirement = None

while queue:
    name = norm(queue.pop())
    if name in selected:
        continue
    dist = dists.get(name)
    if not dist:
        continue
    selected.add(name)
    for raw in dist.requires or []:
        dep = None
        try:
            if Requirement:
                req = Requirement(raw)
                if req.marker and not req.marker.evaluate({"extra": ""}):
                    continue
                dep = norm(req.name)
            else:
                dep = norm(re.split(r"[ <>=!~;\[]", raw, 1)[0])
        except Exception:
            continue
        if dep and dep in dists and dep not in selected:
            queue.append(dep)

rows = []
for name in sorted(selected):
    dist = dists[name]
    license_files = []
    for f in dist.files or []:
        sf = str(f).replace("\\", "/")
        base = sf.rsplit("/", 1)[-1].lower()
        if base.startswith(("license", "copying", "notice", "authors")):
            try:
                src = Path(dist.locate_file(f))
                if src.is_file() and src.stat().st_size <= 2_000_000:
                    target = OUT / "licenses" / name / src.name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(src.read_bytes())
                    license_files.append(str(target.relative_to(OUT)).replace("\\", "/"))
            except Exception:
                pass
    rows.append({
        "name": dist.metadata.get("Name"),
        "normalized_name": name,
        "version": dist.version,
        "license_expression": dist.metadata.get("License-Expression"),
        "license": dist.metadata.get("License"),
        "home_page": dist.metadata.get("Home-page"),
        "project_urls": dist.metadata.get_all("Project-URL") or [],
        "license_files": sorted(set(license_files)),
    })

payload = {"roots": sorted(ROOTS),"distribution_count": len(rows),"distributions": rows}
(OUT / "THIRD_PARTY_PYTHON_LICENSES.json").write_text(
    json.dumps(payload, indent=2, ensure_ascii=False),encoding="utf-8")
print(json.dumps(payload, indent=2, ensure_ascii=False))
