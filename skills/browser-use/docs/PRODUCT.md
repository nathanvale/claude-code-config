# Product — what is our core product

Status: living definition · 2026-06-13 · grounded in the session's live N=5 proof
(`docs/research/2026-06-12-*` and `2026-06-13-*`).

---

## Part 1 — The core product (the definition)

### One sentence

**A browser-automation facade where one warm, logged-in Chrome is driven by many
independent engines through CDP — and their agreement (or disagreement) is a machine-
readable trust signal no single engine can produce.**

> *Pattern vocabulary (pressure-tested — see
> `docs/decisions/2026-06-13-001-gof-pattern-naming-decision-log.md`):* "facade" names the
> action surface (`operate`/`observe`/`verify`) that hides the engines. The **moat** —
> the differential oracle — is **N-version programming** (independent implementations voted
> mechanically), which is the *opposite* of a facade: it SURFACES divergence rather than
> hiding it. Each engine is an **Adapter** (fully earned — the two-axis mapping layer). The
> Router is **evidence-first selection**, not Strategy.

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
- **Key assumption — RESOLVED (verdict: B, the moat is CDP-specific).** The discovery
  experiment tested 9 non-browser substrates (filesystem, DB, API, OS/process, k8s, LLM
  N-version, git, documents, cloud infra) against the four criteria. **None clears all four
  for free.** They fail the same way: each ships with ONE canonical interpreter (one query
  planner, one git spec, one API server), so the "N clients" are thin transports over a
  single brain — cheap fan-out buys *correlated echoes, not independent second opinions*.
  The browser is the rare exception because it exposes its one live state through several
  independent abstraction layers (pixels / DOM / a11y / network / JS), each with its own
  implementation and blind spots — so uncorrelated observer error is a *free byproduct of
  the architecture*, not something you engineer. **Do NOT reposition as a general
  "agent-trust protocol" — that overclaims.** The defensible identity is below.
  (Experiment: `docs/research/2026-06-13-protocol-vs-cdp-experiment.md`.)

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

## Part 3 — Who, against what, measured how

### Primary user & jobs-to-be-done

The product has a **primary actor** (who calls it) and a **protected party** (who the
trust is for). Keeping them distinct is what keeps the value proposition honest.

| Actor | The job they hire us for | The pain today (N=1 world) |
|---|---|---|
| **AI agent** (primary caller) | "Act on the live web and *know when I might be wrong* before I commit." | One lens; trusts its only view; clicks the wrong element / fires on a stale ref and reports success. |
| **Developer / platform team** (buyer) | "Ship an agent into high-stakes web work without a wrong irreversible action becoming an incident." | No way to gate or audit an autonomous click; can't prove what the agent saw before it acted. |
| **QA / RPA engineer** (adjacent buyer) | "Tell me whether this flaky run is the site or my engine." | One runner can't separate site regression from engine artifact; manual bisection. |
| **Trust-and-safety / verification analyst** (adjacent buyer) | "Catch when a site serves different content to different observers." | Brittle multi-proxy farms; impossible to hold the session constant while varying the observer. |
| **End-user / auditor** (protected party) | "Prove the agent did the right irreversible thing on my behalf." | A single engine's log is self-attested; no independent witness. |

The **core JTBD** that unifies them: *make an autonomous agent's web actions trustworthy
enough to commit and auditable after the fact.* Capability is solved; trust is the gap.

### Competitive landscape — why not the alternatives

The framing question is always "why not just X?" The honest answer is the same each time:
**X is a single witness; it cannot be a second opinion on itself.**

| Alternative | What it does well | Why it can't do our core |
|---|---|---|
| **chrome-devtools (alone)** | 44 native tools, deep debug surface | One a11y pipeline; cannot disagree with itself → no consensus, quorum, or repro. (It is our adapter N1, not our competitor.) |
| **Playwright / Selenium** | Robust automation, auto-wait, huge ecosystem | Single engine; same blind spot. Drives well, can't witness itself. |
| **Browserbase / hosted-browser infra** | Managed browsers at scale | Provides *a* browser, not N *independent witnesses of one* browser. Scale ≠ consensus. |
| **Computer-use models (vision-driving)** | No DOM dependency, general | One model's perception; no independent cross-check; the model judges itself. |
| **A human in the loop** | Real judgment | Doesn't scale; not mechanical; not auditable as a signed artifact. |

The moat is not "we automate better." It is **N independent witnesses of one shared world,
made near-free by CDP-as-a-multi-client-bus** — a property none of the above have, and one
that is structurally additive (more engines = more confidence) rather than a feature race.

### Success metrics (what discovery should move)

Outcome metrics (per the Opportunity Solution Tree — measure the outcome, not the output):

- **Trust outcome:** rate of *caught* wrong-irreversible-actions per 1k agent commits
  (quorum refusals that prevented a bad click) — the headline value.
- **Silent-failure outcome:** rate of silent no-ops *detected by post-state verify* that a
  single engine would have reported as success (directly from the ref-staleness finding).
- **Triage outcome:** mean-time-to-classify a failing run as site-vs-engine (Flake Oracle).
- **Cost discipline:** % of operations served by the cheapest capable lens; consensus spend
  as a fraction of total (the stakes dial working).
- **Adoption signal:** agents that gate behavior on `seen_by` tiers vs ignore them (proves
  the confidence signal is *consumed*, not just emitted).

Anti-metric to watch: **alarm fatigue** — divergence interrupts per session. If consensus is
near-universal on clean pages (it is — 297/298 on Wikipedia), interrupts must stay rare or
the signal gets ignored.

### Opportunity Solution Tree (compressed)

```
OUTCOME: agent web-actions are trustworthy enough to commit + auditable after
│
├─ OPPORTUNITY: "I can't tell when my one engine is wrong"
│   └─ SOLUTION: confidence-annotated perception (seen_by: N/5)  [PROVEN]
│       └─ EXPERIMENT: do agents gate behavior on the tier? (Part 2 #4 assumption)
│
├─ OPPORTUNITY: "I can't safely commit an irreversible action"
│   └─ SOLUTION: quorum gate + signed receipt  [PROVEN]
│       └─ EXPERIMENT: does quorum's $/latency tax clear buyer ROI? (Part 2 #1)
│
├─ OPPORTUNITY: "I can't tell if it's the site or my engine"
│   └─ SOLUTION: reproduce-everywhere triage  [PROVEN]
│       └─ EXPERIMENT: does it cut triage time enough to switch runners? (Part 2 #5)
│
├─ OPPORTUNITY: "the site is lying to my client"
│   └─ SOLUTION: cloaking detection  [moat, not yet run]
│       └─ EXPERIMENT: are the 5 lenses' fingerprints distinct enough? (Part 2 #3 — make-or-break)
│
└─ OPPORTUNITY (meta): "is this even a browser product?"
    └─ SOLUTION: reframe as a trust protocol  [premise challenge]
        └─ EXPERIMENT: find ONE non-browser substrate where N independent
           verifiers are near-free (Part 2 #2 — gates the product identity)
```

---

## Settled identity (assumption #1 resolved)

The protocol-vs-CDP experiment is **done — verdict B.** The product identity is therefore
settled:

> **A browser-trust tool, not a general agent-trust protocol.** The core product is
> *CDP-as-a-multi-client-bus: the browser is one world that honestly disagrees with itself,
> giving uncorrelated second opinions for free.* The trust *pattern* (independent
> re-derivations of one shared mutable instance, Set-diffed for consensus) is real and
> intellectually general — but the *economics that make it free are browser-specific*, so the
> defensible claim stays narrow and is stronger for it.

What this rules in/out:
- **In:** lean hard into the browser. Every dividend that exploits multi-layer browser
  legibility (DOM vs a11y vs pixels vs network) is moat-pure. TrustLayer, Flake Oracle,
  Cloak-Catcher, confidence-as-experience all stay.
- **Out:** do not chase non-browser substrates as a near-term moat. The one possible future
  "substrate #2" is OS/process introspection (the only other place with genuinely
  independent observers — fails on cost/diffability, not independence), and it would have to
  be *engineered*, not inherited. Park it; don't market it.

## Next discovery step

One make-or-break assumption remains, cheap to probe:

- **Are the 5 lenses' fingerprints meaningfully distinct?** (Part 2 #3 / Cloak-Catcher).
  Point them at a known-cloaking / A-B site and check whether the diff is non-empty. If the
  lenses share a near-identical Chrome signature, Cloak-Catcher is dead on arrival; if
  distinct, it's a second moat-pure market. Note the experiment refined this: the 5 engines'
  *observer independence* (different a11y pipelines) is proven, but *fingerprint* distinctness
  (what the site sees) is a separate property still unverified.

Everything else in Part 2 (TrustLayer, Flake Oracle, confidence-as-experience) builds on
already-proven mechanisms and is sequencing/packaging work, not an open question — that's
`ce-plan` territory now that the identity is settled.
