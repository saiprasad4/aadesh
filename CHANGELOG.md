# Changelog

All notable changes to `aadesh` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0 stability:** while on `0.x`, the API **and the error-code dataset**
> may change between minor versions as rules are re-verified against NPCI/RBI
> circulars. Pin an exact version (`@saiprasad4/aadesh@0.1.0`) if you need stability, and
> read this changelog before upgrading... dataset/rule changes are called out.

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-07-06

Initial release. Models the Indian recurring-payment mandate lifecycle
(eNACH + UPI Autopay): error-code normalization, mandate/debit state machines,
and a conservative retry policy. PSP webhook adapters (Razorpay/Cashfree) are
planned for `0.2.0` once each provider's webhook schema is verified.

### Added
- Mandate + single-debit state machines (`MandateMachine`, `DebitMachine`) with exported transition tables.
- Category-driven error-code dictionary (~298 eNACH + UPI Autopay codes) with conservative, money-safe handling.
- `decideRetry` retry policy encoding rail attempt caps, spacing, and safety rules.
- Rail profiles (`getRailProfile`) for UPI Autopay and eNACH.
- Published as `@saiprasad4/aadesh` with npm build provenance signed by GitHub Actions.
