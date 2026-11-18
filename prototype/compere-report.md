## Main finding comparing  prototype/economy-demand-product-diffusion/a/ with /b/ (main)

The main-branch
prototype/economy-demand-product-diffusion/b/index.html
prototype **does respond to stock**, but it looks only at coal **inside the settlement cell**. Coal queued immediately outside it does not directly reduce the settlement’s demand.

This prototype measures coal across the settlement’s whole catchment. That makes a buildup around the settlement visible to its demand signal, which is likely an important reason its stock feedback feels better.

In a 60-second run of the main prototype’s default layout with resource pressure enabled, settlement demand remained around **0.89–0.94**. That is one scenario, not a universal result, but it illustrates how little the signal can change during normal operation.

## Why main may feel slow

It is not simply that its response constant is slower: the main settlement signal actually has a faster nominal response than this prototype. The difference is more likely the combination of:

- **A narrow feedback range.** Main’s target stays between 0.5 and 1 with pressure enabled, or 0.65 and 1 without it. This prototype can reduce its target further as nearby stock grows.
- **A small intake queue.** Main admits only a short service window of coal to the settlement cell. Excess remains upstream, where the settlement does not count it.
- **The starting view is already 12 seconds into the simulation.** Much of the initial demand formation is hidden.
- Different grid sizes, rates and field rules make a direct speed comparison misleading.

## Worth bringing from main to this prototype

1. **Animated arrows showing actual transfers**, not just the theoretical demand gradient. This would make movement and congestion much easier to diagnose.
2. **Demand contours and linked cell inspection.** They reveal subtle gradients that a heatmap alone can hide.
3. **Place and remove mines and settlements.** This is especially useful for testing how demand adapts after a change.
4. **Diagonal routing and smoothed steering**, while retaining the conservative-transfer tests. Main also gates movement against the current uphill direction, which helps avoid crossing peaks.
5. **Throughput graphs and a balance ledger.** Our balance error is useful; main’s history would show oscillation and delayed feedback.

I would bring these over selectively rather than replace the current model or its simple standalone setup.

## Worth bringing from this prototype to main

1. **Catchment-based stock feedback** as an optional mode alongside main’s existing queue-only model.
2. **A stronger, tunable stock-to-demand curve**, with an explicit response time and stock threshold.
3. **A fixed-demand comparison mode and reproducible replay**, so the effect of feedback can be isolated.
4. **Tests for feedback and adaptation:** add stock near—not just inside—a settlement, verify its demand falls, then remove stock and verify recovery.

I would **not blindly copy the consumption rule**. Main’s intake queue preserves a visible arrival/service delay; this prototype consumes proportionally from the whole catchment. Both are useful experiments, with different gameplay implications.

Likewise, the no-settlement behavior is a design choice: main spreads stock at a zero-demand floor, while this prototype creates an ambient demand baseline that coal depresses. Both work, but they produce different fields.

**Recommendation:** keep this prototype’s stock-feedback behavior as the reference, add main’s inspection and flow visualization first, then compare the two intake models under the same controlled layouts before combining them. No files were changed in this comparison.