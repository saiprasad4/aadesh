# One in two recurring payments in India quietly fails. The part everyone gets wrong is the mandate lifecycle.

*Draft ... target: inoltro.ai, cross-post to Hacker News and LinkedIn. Byline: Saiprasad Shankar.*

---

Ask most engineers how recurring payments work in India and you get some version of "the customer sets up autopay once, and then money moves on schedule." Clean. Reassuring. Wrong often enough that it should worry you.

The reality is messier, and it breaks at more than one point in the lifecycle. On the setup side, the share of NACH e-mandate registrations that get rejected has climbed to around 55%, up from roughly 28% in 2017-18.[^1] On the execution side, more than 20 million UPI Autopay mandates are revoked every month for insufficient balance alone, against a base of the order of 120 million recurring debits a month.[^2] And a failed debit is not free... it carries a bank return charge, commonly ₹250 to ₹500 plus 18% GST,[^3] and behind that sits the far larger cost of involuntary churn ... the SIP that silently stops, the loan EMI that slips into a bucket, the subscription that lapses.

I have spent the last few years building payments infrastructure as a CTO, and the thing I want to argue is narrow and specific: **the failure is not really a payments problem. It is a modelling problem.** Almost nobody represents the recurring-payment mandate as what it actually is ... a lifecycle, a state machine with rails-specific rules ... and that gap is where the money leaks out.

## Why the lifecycle is invisible

If you only ever touch a payment gateway's SDK, the mandate lifecycle is invisible by design. You get a `success` or a `failure` and maybe a string. The abstraction is doing its job: it hides the machinery.

But the machinery is not simple, and when you are the one who has to reconcile the ledger against the bank at the end of the day, the abstraction stops being a convenience and starts being the thing standing between you and the truth. Under that one boolean sit:

- **Two structurally different rails.** eNACH is a batch rail. You submit, and settlement comes back T+1 or later, in files. UPI Autopay is real-time. Same business concept, completely different timing, retry, and failure semantics. A model that treats them as one rail is wrong before it does anything.
- **Hundreds of return and decline codes across five layers** ... the app, the PSP, the sponsor bank, the destination bank, and NPCI. The same two-character code can mean different things on different rails. On one rail a code is a transient bank issue you should retry. On another, the identical string is suspected fraud you must never retry.
- **Caps and windows that change by circular.** UPI Autopay allows a bounded number of debit attempts. A 24-hour pre-debit notification is mandatory before the money moves. These are not implementation preferences. They are regulatory constraints, and they move when NPCI and the RBI move them.

None of this is exotic. It is just tedious, under-documented, and spread across PDFs. So every team re-implements a fragile version of it against a moving target, and every team gets a slightly different subset wrong.

## The failures that actually cost money

Here is what "getting it wrong" looks like in practice. These are not hypotheticals ... they are the specific defects I kept finding, in my own early code and in other people's.

**Retrying a decline you should never retry.** Some declines are transient: a bank was briefly offline, funds were short this morning. Retry those and you recover real revenue. But some declines mean *stop* ... suspected fraud, a revoked mandate, a permanently closed account. If your retry logic cannot tell these apart, it will cheerfully re-attempt a debit the bank has flagged as fraud. Now you are not recovering revenue. You are generating a compliance incident, one retry at a time.

**Rendering a success as a failure.** More than one system I have seen treats an unrecognised code as a failure by default. The trouble is that some of those codes are success codes. A `00` comes back, the switch statement has no branch for it, and the debit that actually went through gets marked failed, re-queued, and in the worst case debited twice. The customer pays twice for one SIP. That is the kind of bug that does not show up in a demo and does show up in a support queue.

**Guessing when you do not know.** The tempting default for an unfamiliar code is to do *something* ... usually retry, because retrying feels safe. With money it is not safe. An unrecognised code is a code you have not verified the meaning of, and automating an action on top of an unverified meaning is how you turn one bad assumption into a thousand wrong debits. The correct default is boring: stop, flag it for a human, do not guess.

The through-line is that **every one of these is a money-safety decision disguised as a parsing decision.** Once you see the mandate as a lifecycle with conservative defaults, the right answers fall out. As long as you see it as a boolean with a string attached, you will keep rediscovering these the expensive way.

## Why this is getting more urgent, not less

For a long time you could ignore all of this by fully outsourcing to a gateway that bundled retries, reconciliation, and compliance. Many teams still do, and for many that is the right call.

What is changing is the number of teams that can no longer stay fully abstracted. The RBI's tightening of digital-lending rules is pushing lenders toward direct, auditable control of the repayment rail rather than routing everything through a single gateway. Regulated entities increasingly need to *own* the mandate lifecycle ... to show a regulator exactly why a debit was attempted, retried, or stopped, across multiple sponsor banks. You cannot produce that answer from behind a boolean. The moment "why did this debit fail, and were we right to retry it" becomes a question you must answer precisely, the lifecycle stops being someone else's problem.

## So I modelled it, in the open

I could keep this as a war story, but war stories do not compile. So I wrote the model down and open-sourced it, as a small, zero-dependency TypeScript library called **aadesh** (आदेश ... "mandate" or "directive").

It is deliberately unglamorous. It does not move money and it makes no network calls. It models the lifecycle and encodes the judgment:

- A dictionary of around 298 eNACH and UPI Autopay error codes, each normalised to a category with **conservative, money-safe handling** ... fraud and permanent declines are terminal and never auto-retried, success codes are never treated as failures, and unrecognised codes are flagged for review rather than guessed at.
- The mandate and single-debit **state machines**, with the 24-hour pre-debit notice enforced structurally ... a debit simply cannot execute without first passing through the notified state.
- A **retry policy** that encodes each rail's attempt caps and spacing under the NPCI and RBI rules, and refuses to authorise an attempt it cannot justify.

Everything is checked against primary sources ... NPCI's UPI error and response codes, the NACH return-reason circulars, and the RBI e-mandate framework ... and where a code's meaning is sourced from an aggregator rather than a primary circular, it is flagged as unverified rather than dressed up as fact. That last part matters more than any feature. In payments, the honest "we have not verified this yet" is worth more than a confident guess.

It is early, and the dataset will keep moving as the circulars do. That is fine. The point was never a finished artifact. The point is that the mandate lifecycle is model-able, that modelling it correctly is mostly a matter of taking money-safety seriously as a default, and that this knowledge should live in the open instead of being re-learned, expensively, one bounced debit at a time.

If you work on recurring payments in India and your mental model is still "set it up once and money moves" ... the gap between that sentence and the more-than-half rejection number is the most interesting problem in Indian fintech infrastructure right now. It is worth modelling. I would love to compare notes.

---

*aadesh is MIT-licensed and on npm. Repository and error-code dataset are public. If you spot a code we have categorised wrong, that is exactly the kind of issue I want to see filed.*

[^1]: Share of rejected NACH e-mandates rose from ~28% in 2017-18 to ~55% in 2025-26 (as of Nov 2025), per NPCI data. FACTLY, "NACH E-Mandates Scale Up, But Rejections Rise." https://factly.in/nach-e-mandates-scale-up-but-rejections-rise/
[^2]: More than 20 million UPI Autopay mandates revoked monthly over low customer balances. Business Standard, 7 Sep 2025, "UPI autopay revocations hit 20 mn per month on low customer balance." https://www.business-standard.com/finance/news/upi-autopay-revocations-hit-20-mn-monthly-over-low-customer-balances-125090700500_1.html . Recurring-execution base on the order of ~120 million/month per NPCI (early 2026).
[^3]: Bank NACH/ECS return charges typically ₹250 to ₹500 plus 18% GST, varying by bank (e.g. SBI ₹250 + GST = ₹295 all-in; Axis ₹500/₹550). Bank fee schedules; GoPocket, "ECS/NACH Return Charges" (2025). https://www.gopocket.in/blog/ecs-nach-return-charges-what-they-are-and-how-to-avoid-penalties-in-2025
