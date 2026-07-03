# LinkedIn Outreach — Architecture, Risk & Roadmap

A plan for adding **LinkedIn** as a second outreach channel in GRAPOUT, alongside
email. Advisory only — no code yet.

## 1. The reality (read first)

- **Automating LinkedIn breaks LinkedIn's User Agreement.** LinkedIn actively
  detects automation and can **restrict or ban** accounts. This is *risk
  management*, not "safe like email." Every competitor (Dripify, Expandi,
  HeyReach, Waalaxy, LinkedHelper) lives in this grey zone.
- **No official API** exists for connections/messaging. Automation always drives
  a real logged-in session (extension, headless browser, or a provider that does
  this for you).
- **The account, not the message, is the asset at risk.** Design around
  protecting each LinkedIn account: low volumes, human pacing, warm-up.

## 2. Recommended approach (phased)

**Start with a third-party LinkedIn API provider (e.g. Unipile), not our own
browser automation.** Rationale:

| | 3rd-party API (Unipile/HeyReach) | Own Chrome extension | Cloud headless + proxies |
|---|---|---|---|
| Time to build | **Low** (REST calls) | High | Very high |
| Ban risk owner | **Provider** | Us + client | Us |
| Infra to run | None | Backend + extension | Browsers + residential proxies |
| Ongoing maintenance | Low | High (LinkedIn UI changes) | High |
| Cost | ~$40–100 / account / mo | Dev time | Proxies + dev time |

Ship value fast on a provider API, keep the GRAPOUT-side model **provider-agnostic**
(an `LinkedInDriver` interface), and only consider building our own execution
layer later if volume/margins justify owning it.

## 3. How it maps onto GRAPOUT (reuse ~80%)

LinkedIn becomes **another channel** on the existing engine. Reused as-is:

- **Clients / cohorts / enrollments** — a cohort can run LinkedIn steps.
- **Sequence engine** — same drip/business-day/jitter logic, new step types.
- **Reporting, approvals, activity log, per-client scoping, dashboards.**

New pieces needed:

- **`LinkedInAccount`** entity (the equivalent of a mailbox): provider account
  id, owner client, daily limits, status, warm-up state.
- **Channel-aware steps**: `SequenceStep.channel = EMAIL | LINKEDIN` and step
  `kind = CONNECT | MESSAGE | VISIT | INMAIL`.
- **`LinkedInDriver`** service wrapping the provider (connect, message, fetch
  replies, connection status) so the provider can be swapped.
- **Reply ingestion** — poll the provider for accepted invites + replies, mirror
  into the existing reply/enrollment flow (stop sequence on reply).
- **Prospect fields** — a LinkedIn profile URL on the contact.

## 4. Safe-sending rules (bake into the engine)

- **Daily caps per account:** ~20–25 connection requests, ~50–80 messages,
  ramped up over a 2–3 week **warm-up** (start ~5/day).
- **Human pacing:** randomized delays, working hours + weekdays only (already in
  the engine), no burst sending.
- **One account = one real session/geo** (provider handles proxy pinning).
- **Stop on reply / on connection-accepted → move to message step.**
- **Per-account health signals** surfaced like the deliverability badges.

## 5. Cost (rough, per active LinkedIn account)

- Provider API: **~$40–100/account/month** (varies by provider/volume).
- Plus normal server cost (the engine work is light — API calls + polling).
- Bill it into the client plan the same way mailboxes are (an add-on channel).

## 6. Phased roadmap

- **Phase 1 — Foundations (channel model).** Add `channel` to steps, the
  `LinkedInAccount` entity + admin CRUD, and the `LinkedInDriver` interface with
  a stub. No live sending yet. *(Low risk, no external dependency.)*
- **Phase 2 — Connect + message via provider.** Wire one provider (Unipile),
  connect an account, send connection requests + a message sequence with caps +
  warm-up. Manual "run now" first.
- **Phase 3 — Replies + reporting.** Poll accepted invites/replies, stop
  sequences, add LinkedIn columns to cohort/client reports and the dashboard.
- **Phase 4 — Multi-channel cohorts.** Let a single cohort mix email + LinkedIn
  touches (e.g. email → LinkedIn connect → email), unified reporting.

## 7. Legal / compliance note

- Respect LinkedIn's terms is impossible *and* automate — so treat this as a
  **client-owned-risk** feature: the client connects **their own** LinkedIn
  account and accepts the ToS/ban risk (make this explicit in the UI + terms).
- Keep GDPR/consent hygiene (people can opt out; don't scrape/store beyond need).
- Recommend clients use **their own account**, not a burner, and keep volumes low.

## 8. Open decisions before Phase 1

1. Provider choice (Unipile vs HeyReach API vs others) — affects the driver.
2. Whether LinkedIn is its own cohort type first, or multi-channel from day one
   (recommend: single-channel first, multi-channel in Phase 4).
3. Pricing/packaging for clients (per-account add-on).
