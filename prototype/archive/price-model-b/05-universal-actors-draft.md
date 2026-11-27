# 05 · Universal profit-adapting actors and living tax

Factories, mines and towns share one profit-seeking price mechanism over diffused fields:

- **Never pause conversion or sell stocked output at a loss.** Owned input book cost (`cost[i]`) transfers into produced stock during `stepFirm`. Each seller sets a local cost-basis ask floor `sell[i] = unitCost * (1 + SELL_MARGIN)` that gates outbound shipments in `planOutflow` without injecting seller floors into buyer demand fields.
- **Universal input-bid optimization.** `ActorOptimizer.firmBids` splits expected output value across recipe inputs (`coal`, `labor`) within a joint margin cap (`JOINT_BUDGET_SHARE = 0.78`), cooling bids on stock and debt while keeping a profit-backed wage floor so staffed profitable firms do not collapse worker pay.
- **Profit expands output; losses contract.** Profitable firms raise wage bids and expand `scale[i]`; losing or overstocked firms cut worker pay and scale back. Profitable, supplied towns lower `taxMult[i]` to project higher `priceHome` appeal and grow population; losing or undersupplied towns raise `taxMult[i]`, shedding `depleted` workforce up the `priceHome` gradient toward healthier cities.
