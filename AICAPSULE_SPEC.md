# AI Capsule 0.1 — Atlanex interoperability draft

AI Capsule is a portable JSON incident/evidence container for AI-agent and research runs.

## Goals

- move a captured run between tools without depending on one model vendor;
- preserve the ordered timeline, evidence references and run metadata;
- redact common credentials before export;
- detect post-export tampering with a canonical SHA-256 digest;
- remain readable with ordinary JSON tooling.

The filename extension is `.aicapsule`. The contents are UTF-8 JSON.

## Required top-level fields

```json
{
  "format": "aicapsule",
  "specVersion": "0.1.0",
  "createdAt": "ISO-8601 timestamp",
  "producer": {"name": "Atlanex"},
  "project": {},
  "incident": {},
  "run": {},
  "timeline": [],
  "evidence": [],
  "artifacts": {},
  "metadata": {},
  "integrity": {
    "algorithm": "SHA-256",
    "canonicalization": "sorted-json-v1",
    "payloadSha256": "64 lowercase hex characters",
    "redactions": 0
  }
}
```

## Canonical integrity

The digest is calculated over every top-level field except `integrity`. Object keys are recursively sorted before JSON serialization. Arrays retain order. Undefined/non-JSON values are normalized before hashing.

Any change to the captured payload must make verification fail.

## Secret redaction

The reference implementation redacts credential-shaped keys such as API keys, authorization headers, tokens, passwords, cookies, sessions and private keys. It also redacts common bearer/API-key patterns inside strings and URLs.

Redaction is a safety layer, not a proof that a capsule contains no sensitive information. Producers should avoid capturing unnecessary private data.

## Timeline

`timeline` contains ordered events. Atlanex currently uses fields such as:

```json
{"t": 1250, "stage": "evidence", "label": "Snapshot captured", "detail": "..."}
```

`t` is milliseconds from the start of the run when available.

## Evidence

An evidence entry may contain:

```json
{
  "entity": "Example",
  "criterion": "Commercial API",
  "quote": "Exact text captured from the source",
  "sourceUrl": "https://example.com/",
  "sha256": "<snapshot SHA-256>",
  "fetchedAt": "ISO-8601 timestamp",
  "verification": "exact-source-snapshot"
}
```

A snapshot hash records provenance of the source material. Capsule integrity protects the evidence record itself; verifying a source snapshot requires the corresponding snapshot bytes/text.

## Compatibility

0.1 intentionally does not prescribe a particular LLM, agent framework, trace backend or UI. Future revisions may add embedded snapshots, richer replay instructions and provider adapters while preserving this portable core.

## Optional ES256 signature

A Capsule may include an optional signature inside `integrity.signature`:

```json
{
  "algorithm": "ES256",
  "keyId": "sha256:<fingerprint>",
  "publicKey": {"kty":"EC","crv":"P-256","x":"...","y":"..."},
  "value": "<base64url signature>"
}
```

The signature is calculated over the lowercase hexadecimal `integrity.payloadSha256` value using ECDSA P-256 with SHA-256. The signature lives inside `integrity`, which is excluded from the payload digest, so signing does not alter the captured payload hash.

`keyId` is the SHA-256 fingerprint of the canonical public-key material `{crv,kty,x,y}`. A signature verified only with the public key embedded in the Capsule proves self-consistency: the Capsule was signed by the holder of the corresponding private key. It does **not** by itself establish the real-world identity of that holder. For identity/trust, verifiers should supply a public JWK obtained through an independent trusted channel and compare its fingerprint.

Private signing keys must never be stored inside a Capsule.

## Machine-readable schema

The 0.1 format has a JSON Schema at `schemas/aicapsule-0.1.schema.json`. Implementations may add fields for forward-compatible extensions; required 0.1 fields retain their documented meanings.

## Reference implementations

- Browser/global implementation: `lib/capsule-core.js`
- JavaScript/Node SDK entrypoint: `sdk/javascript/index.mjs`
- CLI: `scripts/capsule_cli.mjs`
- GitHub Action: `.github/actions/verify-aicapsule/action.yml`

The GitHub Action always verifies payload integrity. It can additionally require a valid ES256 signature and can verify that signature with an independently supplied trusted public JWK.
