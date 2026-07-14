# Peerlist cut (~260 words, build-in-public / launch tone)

Just shipped something I have wanted to exist for years: an open-source model of the Indian recurring-payment mandate lifecycle.

The problem, in one number: more than half of NACH e-mandate registrations in India now get rejected (55%, up from ~28% in 2017-18). And on the execution side, 20M+ UPI Autopay mandates are revoked every month for low balance, against a base on the order of 120M recurring debits a month. Every bounce is a real charge plus churn.

Having built payments infra as a CTO, I kept hitting the same thing... teams treat the mandate as a success/failure boolean, when it is actually a lifecycle. Two structurally different rails (eNACH batch vs UPI Autopay real-time), hundreds of return codes across five layers, regulatory caps and pre-debit windows that shift by circular. Collapse all of that into one boolean and you get money bugs: retrying a fraud decline, marking a success as a failure and double-debiting, guessing on codes you have not verified.

So I built **aadesh** (आदेश ... "mandate"):

... ~298 eNACH + UPI Autopay error codes, normalised to conservative, money-safe handling
... mandate + single-debit state machines, with the 24h pre-debit notice enforced structurally
... a retry policy that encodes NPCI/RBI caps and refuses to authorise an attempt it cannot justify
... zero dependencies, typed, ESM + CJS, published to npm with build provenance signed by GitHub Actions

It is deliberately boring. It moves no money and makes no network calls. It just models the lifecycle correctly, in the open, with sources cited (and honestly flagged as unverified where they are not primary). This comes from a place of genuine pain points that I faced while building payment and investment systems using mandates.

Early days, and the dataset will keep moving as the circulars do. Contributions... especially corrections backed by a primary NPCI/RBI source... very welcome.

Would love feedback from anyone in Indian fintech.

Full brain dump: https://psyprasad.tech/blog/mandate-lifecycle-nobody-models
npm: https://www.npmjs.com/package/@saiprasad4/aadesh
Repo: https://github.com/saiprasad4/aadesh

---
*Sources: NACH rejection 28%→55% (FACTLY, citing NPCI data); 20M+ Autopay revocations/month (Business Standard, Sep 2025).*
