# Atlanex Public Reproducibility Benchmark

This benchmark is intentionally deterministic and offline. It does **not** claim to measure general intelligence or compare LLM quality.

It verifies Atlanex's reproducibility layer with public, auditable pass/fail checks:

1. payload tampering is detected by canonical SHA-256 integrity;
2. ES256 signatures verify with the trusted key;
3. signatures are rejected with the wrong trusted key;
4. advanced replay diff detects a newly introduced incident;
5. evidence hash changes and additions are detected;
6. the incident minimizer produces a smaller valid Capsule;
7. generated regression testcases execute successfully;
8. a mutated testcase is rejected.

Run it with:

```bash
npm run benchmark:capsule
```

Write the machine-readable result to a file with:

```bash
node benchmarks/capsule-benchmark.mjs --out benchmark-results.json
```

## What this benchmark proves

It proves that the checked Atlanex build satisfies these deterministic evidence/replay properties on the included fixtures.

## What it does not prove

It does not prove that one model is smarter than another, that all web research is factually correct, or that replay across every external provider is deterministic. Those require separate datasets and controlled provider-specific experiments.
