---
title: "Why We Put an Approval Gate on Every Campaign"
description: "The case for a mandatory Pending → Approved workflow on outreach sends, and why teams need it more than solo senders do."
date: "2026-01-20"
tags: ["governance", "teams"]
---

Most outreach tools optimize for one thing: getting a send button in front of the user as fast as possible. That's fine if the person building the campaign is also the one accountable for the domain it's sent from. It falls apart the moment those two people are different — which is the normal situation at any team running outreach together.

## The gap generic tools miss

A junior team member building a campaign shouldn't need to become an expert in warm-up pacing, suppression lists, and daily send caps to avoid burning the company's domain reputation. But if the tool lets them hit "send" the moment a campaign is built, that's exactly the position they're in.

## What an approval gate actually changes

In GrapMe, every sensitive action — launching a campaign, changing a schedule, adding a follow-up step, importing a contact list, or changing SMTP credentials — enters a `Pending` state. It stays there until a super admin, or a sub-admin with the right permission, reviews and approves it. Two things follow from that:

1. **Users can build without fear.** Drafting and testing a campaign has no downside, because nothing goes live without a second look.
2. **One person (or a small delegated group) owns deliverability risk.** The approver is checking not just "is this copy fine" but "does this schedule respect the daily cap," "is this contact list deduplicated," "did the SMTP change get tested."

## Delegation without losing control

This isn't the same as forcing every approval through one admin forever. Sub-admins can be granted approval permission scoped to specific users or campaigns — so a team lead can approve for their own accounts without ever seeing another team's queue, and without needing super-admin access.

## The audit trail that comes for free

Because every approval is a recorded decision — who approved what, and when — the approval queue doubles as a compliance record. If someone asks "who signed off on this send," there's a direct answer instead of a Slack thread to reconstruct.

If your team is still relying on "please don't send until I say so" as a policy rather than a system control, [get in touch](/contact) — this is the specific gap GrapMe is built to close.
