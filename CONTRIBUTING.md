# Contributing to aadesh

Thanks for helping make Indian recurring-payment tooling more accurate. The
**error-code dataset is the crown jewel**... corrections and additions backed by
authoritative sources are the most valuable contributions.

## Ground rules

- **Every code needs a source.** No entry lands without a citation. Prefer a
  primary NPCI/RBI source; a reputable aggregator (Decentro, TaxGuru) is
  acceptable as a second corroborating source, not as the sole basis for
  `verified: true`.
- **Accuracy over coverage.** A wrong code is worse than a missing one... this
  library informs money decisions. When unsure, open an issue rather than a PR.
- **Handling is category-driven.** Don't add per-code retry/terminal logic; map
  the code to the right `ErrorCategory` and let `CATEGORY_HANDLING` decide. If a
  code doesn't fit any category cleanly, that's a discussion worth having.

## Dataset entry format

Each entry in `src/codes/data.ts` is:

```jsonc
{
  "code": "AP02",              // raw code exactly as emitted
  "rail": "enach",            // "enach" | "upi_autopay"
  "layer": "destination_bank", // npci | sponsor_bank | destination_bank | psp | app
  "reason": "Account closed",  // official description
  "category": "account_closed",
  "verified": true,            // true only if corroborated by an authoritative source
  "source": "https://...",    // the source URL
  "note": "..."               // optional: caveats, domestic overrides, ambiguity
}
```

When adding/correcting a code, include in your PR: the rail, the raw code, the
official meaning, and **the source URL** for both the code and its category.

## Development

```bash
npm install
npm run check   # typecheck + lint (Biome) + test + build
```

All four must pass. Add a test for any behaviour change... especially anything
touching retry/terminal decisions.

## Reporting inaccuracies

Found a code mapped to the wrong category, or a rail rule that contradicts a
current NPCI/RBI circular? Open an issue with the source. If it could cause a
wrong money decision (e.g. auto-retrying a permanent/fraud decline), please
follow [SECURITY.md](./SECURITY.md) instead.
