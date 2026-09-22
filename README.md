# Atlanex — Production Candidate

Atlanex is an evidence-first research workspace for Windows and the web.

## Core
- broad discovery backend: generic web search plus Wikipedia, Wikidata, GitHub, Stack Overflow, Hacker News, npm, OpenAlex, Crossref, arXiv and Public API catalogs
- safe source inspection with SSRF protection and robots.txt handling
- readable source snapshots with SHA-256 provenance
- exact-quote verification: a claim is verified only when the quote exists in the stored snapshot
- IA Machine: bounded autonomous loop that measures gaps, deep-inspects sources, runs gap-specific searches and stops on measurable criteria
- optional CrewAI + GPT Researcher escalation in Desktop
- Replay, forks, run comparison, Case File and proof bundle export
- Windows persistent monitor with tray mode, source-hash checks and optional start-with-Windows

## Build
Windows CI validates the no-localhost architecture, builds the bundled agent engine, produces NSIS + portable executables, acceptance-tests both portable and installed builds, then generates SHA-256 checksums.

## Current release status
This source tree is a production candidate. A release should not be marketed as Windows-tested until the Windows CI job and a human install/run test both pass.

## 29.1.0 release gates
- `atlas-agent-engine.exe --self-test-deep` executes an offline CrewAI runtime task and validates the packaged GPT Researcher + Google GenAI adapter without opening a local web server.
- Packaged `Atlanex.exe --acceptance-test` boots the real Electron renderer/preload, performs live Internet research, fetches a real public source into a SHA-256 snapshot, persists/reloads a monitor job, and runs the bundled deep agent self-test.
- Windows CI runs the acceptance test on the portable EXE, silently installs the NSIS build, runs the same acceptance test from the installed application, then silently uninstalls it.
- A release fails if any of those checks fail.

## AI Capsule 0.1
- export the active research run, replay timeline and Case File evidence as a portable `.aicapsule` JSON file
- redact common credential/token patterns before export
- canonical SHA-256 integrity verification that detects post-export tampering
- open and verify capsules directly from Atlanex Case File
- verify from the terminal/CI with `npm run capsule:verify -- path/to/file.aicapsule`
- independent contract test with `npm run test:capsule`
- interoperability draft in `AICAPSULE_SPEC.md`

### Replay / Viewer / Minimizer
- advanced Capsule comparison reports timeline additions/removals, duration deltas, stage-count changes, new incident events and evidence hash changes
- `tools/capsule-viewer.html` opens Capsules independently of the main workspace and supports integrity/signature verification, A→B diff, minimal reproduction export and testcase export
- the incident minimizer selects a deterministic replay window around the first failure/conflict/mismatch-style event and carries only the evidence needed for that window
- regression testcases embed the minimized fixture plus required stages/evidence hashes and can be executed with `npm run capsule:run-testcase -- file.testcase.json`
- Capsule CI now runs the desktop app preparation step and asserts that both `lib/capsule-core.js` and the Viewer are actually present in the packaged app payload

## Public reproducibility benchmark
Atlanex includes an offline, deterministic benchmark for the Capsule evidence/replay layer. It checks tamper detection, ES256 trust verification, wrong-key rejection, replay incident detection, evidence deltas, minimization and generated regression testcases.

Run `npm run benchmark:capsule`. The GitHub workflow also publishes the JSON result as the `atlanex-public-benchmark` artifact.

## Desktop transport
- the Electron renderer loads from packaged local files; it does not run a localhost web server
- renderer ↔ Electron uses Electron IPC
- Electron ↔ Python Agent Engine uses stdin/stdout JSON-RPC
- CrewAI and GPT Researcher use Gemini cloud directly over HTTPS when the user configures a Gemini API key
- the Gemini key is stored with Electron `safeStorage` instead of project files or AI Capsules
