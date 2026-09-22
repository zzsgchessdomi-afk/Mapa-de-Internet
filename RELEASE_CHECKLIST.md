# Atlanex 29.1.0 — Release Gate

This file separates what is proven in the current environment from what still requires a real Windows release run.

## Passed here

- [x] Root JavaScript syntax checks
- [x] Desktop main/preload syntax checks
- [x] Python sidecar/build-helper syntax checks
- [x] GitHub Actions YAML parses
- [x] Root/Desktop parity for UI, research API, inspect API, scanner, manifest and service worker
- [x] 11-provider deterministic research contract
- [x] Release audit passes
- [x] Deterministic UI E2E: IA Machine, exact negative/positive evidence, qualified-candidate logic, snapshot browser, Case File, local document ingestion and persistent-monitor bridge
- [x] Mobile/restricted-origin rendering: splash visible, research completes, graph renders without horizontal node overflow
- [x] Old service-worker cache invalidation
- [x] Stable project state key with legacy migration
- [x] Third-party notice + exact-build Python license inventory workflow

## Enforced by Windows CI

- [ ] No-localhost architecture gate passes (Electron IPC + stdio JSON-RPC)
- [ ] Renderer loads from packaged files without an HTTP loopback server
- [ ] Install all Desktop dependencies on Windows
- [ ] Build the PyInstaller CrewAI/GPT Researcher + Gemini adapter engine and pass `--self-test-deep`
- [ ] Run bundled agent-engine `--self-test`
- [ ] Generate runtime dependency license inventory
- [ ] Build x64 NSIS installer
- [ ] Build x64 portable executable
- [ ] Launch the packaged portable EXE with `--acceptance-test` (renderer/preload + live research + snapshot + monitor + deep agents)
- [ ] Execute the real Electron renderer + preload inside that packaged EXE
- [ ] Confirm bundled Agent Engine and license inventory exist inside packaged resources
- [ ] Silently install the NSIS build, run `--acceptance-test` from the installed app, and silently uninstall it
- [ ] Generate SHA256SUMS for release executables

## Human release acceptance still required

- [ ] Install on a clean Windows machine
- [ ] Run one live web mission end-to-end
- [ ] Configure a real Gemini API key and run one CrewAI/GPT Researcher mission end-to-end
- [ ] Add a PDF and confirm its evidence/snapshot in the installed build
- [ ] Close the window, confirm tray monitor stays alive, then reopen
- [ ] Enable start-with-Windows and test after login/reboot
- [ ] Test uninstall; confirm user project data behavior is intentional
- [ ] Review GPT Researcher license metadata discrepancy for the exact bundled distribution
- [ ] Code-sign the installer if commercial release requires Windows reputation/trust

Do not market the Windows build as fully validated until every unchecked release/human gate above has passed.
