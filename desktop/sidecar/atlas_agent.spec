# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all
packs=['crewai','gpt_researcher','litellm','langchain','langchain_core','langchain_community','langchain_openai']
datas=[]; binaries=[]; hidden=[]
for p in packs:
    try:
        d,b,h=collect_all(p);datas+=d;binaries+=b;hidden+=h
    except Exception: pass

a=Analysis(['server.py'],pathex=[],binaries=binaries,datas=datas+[('gptr_config.json','.')],hiddenimports=hidden,hookspath=[],hooksconfig={},runtime_hooks=[],excludes=[],noarchive=False,optimize=0)
pyz=PYZ(a.pure)
exe=EXE(pyz,a.scripts,[],exclude_binaries=True,name='atlas-agent-engine',debug=False,bootloader_ignore_signals=False,strip=False,upx=False,console=False)
coll=COLLECT(exe,a.binaries,a.datas,strip=False,upx=False,name='atlas-agent-engine')
