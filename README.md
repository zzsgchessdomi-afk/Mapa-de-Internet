# Internet Atlas — Production Candidate

Internet Atlas is an evidence-first research workspace for Windows and the web.

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
Windows CI builds a bundled agent engine, runs static and contract tests, builds NSIS + portable artifacts, then launches the portable build with `--smoke-test`.

## Current release status
This source tree is a production candidate. A release should not be marketed as Windows-tested until the Windows CI job and a human install/run test both pass.

## 29.1.0 release gates
- `atlas-agent-engine.exe --self-test-deep` executes a real CrewAI task through a local OpenAI-compatible test bridge and forces GPT Researcher to complete a local-document research/report cycle.
- Packaged `Internet Atlas.exe --acceptance-test` boots the real Electron renderer/preload, performs live Internet research, fetches a real public source into a SHA-256 snapshot, persists/reloads a monitor job, and runs the bundled deep agent self-test.
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
