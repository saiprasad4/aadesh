# LinkedIn cut (~300 words)

More than half of India's recurring-payment mandates never even get off the ground.

The share of NACH e-mandate registrations that get rejected has crossed 55%, up from ~28% in 2017-18. And on the execution side, 20 million+ UPI Autopay mandates are revoked every month for insufficient balance alone, against a base on the order of 120 million recurring debits a month. Every bounce carries a bank return charge... commonly ₹250 to ₹500 plus GST... and behind it, the far bigger cost: the SIP that silently stops, the EMI that slips, the subscription that lapses.

After a few years building payments infrastructure as a CTO, here is what I have come to believe: this is not really a payments problem. It is a modelling problem. Also it is the most boring/unsexy part of building payment infrastructure around mandates.

Almost nobody represents the recurring-payment mandate as what it actually is... a lifecycle. A state machine, with rules that differ across two structurally different rails (eNACH is batch, UPI Autopay is real-time), hundreds of return codes across five layers, and regulatory caps and windows that move every few circulars.

Hide all of that behind a single success/failure boolean and you get three bugs that cost real money:

... retrying a decline you should never retry (a bank marks a debit as suspected fraud, your code cheerfully re-attempts it),
... rendering a success as a failure (an unrecognised success code gets re-queued, and the customer is debited twice),
... guessing when you do not know (automating an action on top of an unverified code meaning).

Every one of these is a money-safety decision disguised as a parsing decision.

So I wrote the model down and open-sourced it: a small, zero-dependency TypeScript library that treats the mandate as a lifecycle and encodes conservative, money-safe defaults. Fraud is never auto-retried. Success is never a failure. Unknown codes are flagged, not guessed.

It is early and the data will keep moving as the circulars do. That is the point of doing it in the open.

If you work on recurring payments in India, I would love to compare notes, understand if this is a problem that you face as well and how we can make this easier for everyone in Fintech.

Link in comments.

---
**First comment (paste this):**

Full brain dump: https://psyprasad.tech/blog/mandate-lifecycle-nobody-models

aadesh is MIT-licensed and open source.
npm: https://www.npmjs.com/package/@saiprasad4/aadesh
Repo: https://github.com/saiprasad4/aadesh

---
*Sources: NACH rejection 28%→55% (FACTLY, citing NPCI data); 20M+ Autopay revocations/month (Business Standard, Sep 2025); return charges (bank fee schedules).*

*Optional hashtags: #fintech #payments #UPI #NACH #opensource #india*
