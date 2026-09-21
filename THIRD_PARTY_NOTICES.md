# Third-party notices

Internet Atlas uses and/or bundles third-party open-source software. This file is a notice, not legal advice.

## Direct JavaScript dependency

- `pdf-parse` 2.4.5 — Apache License 2.0.
  Used to extract text from PDF research files in the safe source scanner and Desktop document importer.

## Python agent engine

The Windows release workflow pins and bundles:

- CrewAI 1.15.22.
- GPT Researcher 0.15.1.
- FastAPI, Uvicorn, HTTPX, and their transitive Python dependencies.

CrewAI's upstream repository identifies the project as MIT licensed.

GPT Researcher 0.15.1 requires special release review because public metadata is inconsistent:
- the upstream repository contains an Apache License 2.0 LICENSE file;
- PyPI metadata for 0.15.1 has reported MIT.

Internet Atlas therefore does **not** simplify GPT Researcher's license to one label in this notice. The Windows release workflow generates a machine-readable inventory from the exact installed distributions so the release can preserve the metadata and license files that actually shipped.

## Release requirement

Before a commercial release:
1. Keep this notice in the product.
2. Keep the generated `THIRD_PARTY_PYTHON_LICENSES.json` and collected license files with the bundled agent engine.
3. Review any package whose installed metadata and upstream repository license disagree.
4. Do not remove copyright/license notices from bundled dependencies.

Internet Atlas does not rename CrewAI or GPT Researcher as its own technology. Product UI and diagnostics identify them as third-party components when used.
