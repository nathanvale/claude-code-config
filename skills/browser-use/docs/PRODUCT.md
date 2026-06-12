# Product — what is our core product

Status: living definition · 2026-06-13 · grounded in the session's live N=5 proof
(`docs/research/2026-06-12-*` and `2026-06-13-*`).

---

## Part 1 — The core product (the definition)

### One sentence

**A browser-automation facade where one warm, logged-in Chrome is driven by many
independent engines through CDP — and their agreement (or disagreement) is a machine-
readable trust signal no single engine can produce.**

### The shape, in plain terms

There is exactly **one** real Google Chrome (dedicated persistent profile, logged-in
sessions, loopback CDP on :9222). It is the **shared world** — one DOM, one set of cookies,
one identity. Five interchangeable **engines** attach to that same Chrome over CDP and act
as independent **lenses** on it: chrome-devtools (MCP), playwright (MCP), agent-browser
(CLI), playwright-cli (CLI), chrome-devtools CLI.

A caller talks to **one facade** (`operate` / `observe` / `verify`) and never names an
engine. The facade routes by capability and measured cost, normalizes each engine's
vocabulary, and — when it matters — fans the same intent across multiple engines and
**diffs the results mechanically** (a Set comparison, not the LLM) to produce consensus,
confidence scores, and quorum verdicts.

### Why CDP is the keystone (verified this session)

CDP is a multi-client bus. Many independent tools can attach to one browser
simultaneously, with no coordination. So:

- **One browser, N clients** — fanning to 5 engines is near-free; there are no extra
  browsers to launch.
- **Log in once, all inherit it** — the warm authenticated session is shared by every
  engine.
- **The engines are lenses, not browsers** — they observe and drive the *same* reality,
  which is exactly why their disagreement is meaningful (different views of one truth, not
  five different page-loads).

Proven byte-for-byte: chrome-devtools-CLI, chrome-devtools-MCP, and raw CDP return the
identical tab list — they are looking at the same browser.

### The irreducible moat

**No engine can be a second opinion on itself.** Everything defensible flows from N
*independent* witnesses of one shared world — structurally impossible at N=1, no matter how
many tools a single engine has:

- **Differential oracle** — mechanical diff over N engines; the LLM consumes the verdict, it
  does not produce it.
- **Confidence-annotated perception** — every element tagged `seen_by: N/5`.
- **Quorum-gated irreversible actions + tamper-evident signed receipt** — Byzantine-fault-
  tolerant; one stale/lying engine is outvoted.
- **Reproduce-everywhere** — real-site-bug vs engine-artifact triage.
- **Graceful degradation / failover** — an engine cannot fail over to itself.
- **Cloaking detection** — different content served to different fingerprints.

Proof it bites: on Hacker News, the chrome lineage names a link `"119 comments"` while the
chromium lineage names the *same* DOM link `"3 hours ago"`. A single-engine agent told
"click 119 comments" succeeds on one lineage and fails on the other — silently, with no
signal. The fleet surfaces it as a `2/5` contested element.

### The mandatory counterpart

CDP is **root over web identity**. The same power that makes the facade work makes a
**redaction boundary non-optional** — raw snapshots leaked real authenticated tab URLs.
The thing that makes the product possible is the thing that makes the security boundary
mandatory; they are the same property.

### Who it is for

The primary consumer is an **AI agent** acting on the live web on someone's behalf — and,
behind it, the **developer/platform** shipping that agent into work where a wrong
irreversible action is a real incident (payments, account changes, procurement, regulated
ops). The end-user being protected is the silent third party the receipt exists for.

### What it is NOT

- **NOT a single-engine wrapper** and **NOT "a better chrome-devtools."** chrome-devtools
  is adapter N1 — the facade contains it, it does not compete with it.
- **NOT a "universal browser API" that fakes uniformity** (rejected by ADR 0012). The
  facade negotiates *real* per-engine capabilities and surfaces divergence loudly.
- **NOT the LLM doing the judging.** The oracle is deterministic; the model reasons on top
  of a mechanical verdict.
- **NOT a heavyweight framework.** steipete-lean: the oracle is a Set diff, the cost table
  is logged medians, receipts are a hash — thinnest mechanism that delivers the moat.

### Proven, not claimed

Cost-routing (warm playwright-cli 40ms fastest, 14× payload spread; invocation model — not
transport kind — predicts latency) · the oracle catching real divergence · 4-stage live
graceful-degradation kill test · quorum 5/5-commit-with-receipt / 0/5-refuse · three
incompatible ref-staleness contracts (one engine *silently lies about success*, forcing
post-state verification) · N5 confirmed driving warm Chrome.

---

## Part 2 — Product-trio ideation (grounded on the definition above)

Method: Teresa Torres product trio — PM, Designer, Engineer each generated 5 ideas
against the proven product; cross-ranked here to the top 5. The lenses **converged** on a
few themes (trust API, cloaking, the protocol/shared-world reframe, confidence-as-
experience), which is itself signal about where the core lives.

### Top 5 (cross-lens)

#### 1. TrustLayer — the verification API for agents acting on the live web
*The product as a trust gate, not just an automator.* An agent-facing surface that returns
confidence-annotated perception and an N-engine quorum verdict (+ signed receipt) on every
high-stakes observation and irreversible action.
- **Why chosen:** strongest strategic fit + moat-pure. The blocker on production agentic
  web work is *trust*, not capability, and quorum/receipt is structurally impossible for any
  single-engine competitor. Converged across all three lenses (PM TrustLayer, Designer
  quorum-affidavit, Engineer receipt-ledger).
- **Key assumption to validate:** buyers experience enough costly wrong-irreversible-action
  events that quorum's latency/$ tax clears their ROI bar.

#### 2. Reframe — the core product is a Verifiable-Action Trust Protocol (browser is substrate #1)
*Premise challenge.* The deepest moat artifacts (quorum, signed receipts, `seen_by: N/5`,
the redaction boundary) are not browser-specific — they answer "how does a human/auditor
trust an autonomous agent did the right irreversible thing?"
- **Why chosen:** it's the highest-leverage strategic question and surfaced independently
  from PM and Engineer lenses. Deciding this sets the product's identity and ceiling.
- **Key assumption to validate (and the risk):** does the moat survive *outside* the
  browser? Today it is physically real because CDP gives N independent lenses for free.
  Discovery must find one non-browser substrate where N independent verifiers are as
  near-free — otherwise the moat is specifically *CDP-as-a-multi-client-bus*, and
  generalizing dilutes it. **Resolve this before repositioning.**

#### 3. Cloak-Catcher — adversarial content-integrity monitoring
*Detect when a site serves different content to different fingerprints* (cloaking, price/geo
discrimination, ad fraud, bot-targeted misinformation) by diffing what N distinct lenses see
on one shared session.
- **Why chosen:** moat-pure (impossible at N=1) and a *different buyer* than TrustLayer
  (trust-and-safety, ad verification, brand protection, fairness/regulatory testing) — so it
  de-risks the product by not betting everything on one market. PM + Engineer converged.
- **Key assumption to validate:** the 5 lenses present *meaningfully distinct, controllable*
  fingerprints (not near-identical Chrome signatures) — else they witness the same cloak and
  the diff is empty. This is the make-or-break technical unknown.

#### 4. Confidence-as-experience — tiers, interrupts, and agent proprioception
*Make the unique signal usable, not noise.* Collapse `seen_by: 0–5` into three actionable
tiers (consensus / contested / phantom) that ride the element being acted on; fire divergence
as an **interrupt only when it intersects the planned action**; give the agent
**proprioception** — which lens served it and that lens's known failure contract (e.g.
"served by agent-browser, which silently no-ops on stale refs — verify post-state").
- **Why chosen:** the oracle's data is worthless if it drowns the agent; this is what turns
  the moat into a product an agent can actually consume. Converged across Designer ideas.
- **Key assumption to validate:** agents actually gate behavior on the tier / proprioception
  metadata rather than ignoring it and acting on the highest-salience match.

#### 5. The Flake Oracle — "is it the site or is it your engine?"
*Differential-diagnosis for QA/RPA.* Reproduce a failing/divergent run across N engines on
the same warm DOM and mechanically classify it: real site regression vs engine artifact.
- **Why chosen:** clearest near-term, low-friction wedge with an existing budget (QA/RPA
  teams already burn hours on flake triage and *cannot* separate site-vs-engine with one
  lens). PM + Engineer converged; lowest assumption-risk of the five.
- **Key assumption to validate:** engine-vs-site ambiguity costs teams enough real time today
  that reproduce-everywhere reduces triage time enough to switch from their incumbent runner.

### The strategic throughline

Three of the five (TrustLayer, the protocol reframe, the receipt ledger) say the **core
product is a trust/verification layer for agent actions**, with the browser as the first —
and currently the only *physically free* — substrate for N independent witnesses. Cloak-
Catcher and the Flake Oracle are the two strongest *adjacent markets* that exercise the same
moat for different buyers. The single most important discovery question is **#2's
assumption**: is the moat the protocol, or is it CDP? The answer decides whether this is a
browser product that happens to be trustworthy, or a trust product that happens to start in
the browser.

### Not selected (captured, folded)

NeverDown reliability runtime (real, but an infra framing of graceful degradation — folds
into TrustLayer's SLA story) · drive-observe / payload tiering (conveniences, not moat —
per the moat audit) · Warm-Chrome-as-shared-world multi-tenant substrate (the boldest
engineering bet, but its core risk *is* assumption #2 and the redaction boundary holding
under multi-tenant CDP-root — revisit once #2 is answered).

---

## Next discovery step

Validate assumption **#2** (is the moat the protocol or CDP?) and assumption **#3's**
fingerprint-distinctness unknown — both are make-or-break and both are cheap to probe. They
gate which of the two product identities (browser-trust tool vs agent-trust protocol) the
roadmap commits to.
