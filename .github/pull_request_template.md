<!-- Thanks for contributing to aadesh. Please fill this in. -->

## What does this change?

<!-- One or two sentences. -->

## Type

- [ ] Error-code addition / correction (dataset)
- [ ] Rail rule / handling change
- [ ] Bug fix
- [ ] Docs / tooling

## For dataset or rule changes... accuracy checklist

- [ ] Every added/changed code has a `source` URL
- [ ] `verified: true` is backed by an authoritative NPCI/RBI/NACH source (ideally corroborated by a second)
- [ ] Category mapping reviewed against the code's official meaning
- [ ] No code that could invert a money decision is left auto-retriable (fraud / permanent declines → `suspected_fraud` / `not_permitted`)

## Checks

- [ ] `npm run check` passes (typecheck + lint + test + build)
- [ ] Added/updated a test for the behaviour change
