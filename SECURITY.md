# Security Policy

## Scope & data handling

`aadesh` is a **zero-dependency, pure-computation library**. It:

- makes **no network calls** and opens no sockets;
- reads and writes **no files**, environment, or storage;
- holds **no secrets** and processes **no payment credentials**.

You pass it codes/states/amounts; it returns decisions. Payment data never leaves your process.

## Correctness is a security property

Because this library informs money-movement decisions (whether to retry a debit, whether a mandate is dead), a **wrong classification is a security-relevant defect**. If you find a code mapped to the wrong category, a retry decision that could double-charge or auto-retry a fraud/permanent decline, or a rail rule that contradicts the current NPCI/RBI position, please report it as a security issue, not just a bug.

## Reporting a vulnerability

Please report privately via [GitHub Security Advisories](https://github.com/saiprasad4/aadesh/security/advisories/new), or email **saiprasad.shankar@gmail.com** with the subject `aadesh security`.

Please include the affected version, a minimal reproduction, and the expected vs. actual behaviour with a source for the correct value where relevant. We aim to acknowledge within 72 hours.

## Supported versions

`aadesh` is pre-1.0. Security fixes are applied to the latest `0.x` release only.
