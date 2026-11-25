# 10 Land Town Spawn B2 Worklog
plan: `draft/town-settlement.md` (land and spawn sections), follows `09-town-wealth-class-b2-worklog.md`
changed:
- `land.js`: meadow/forest/desert terrain rest pace, facility wasteland, town land claim and site quality. `settlement.js`: founding picks the best site in the gather grid.
- `settlement.test.js`: meadow vs desert founding, desert still-worker rest, founding away from mine wasteland, claim freed on removal, intent mixing (5 tests).
validation:
- L2 `node --test`: 51/51 (recorded retroactively; the work landed in `d58f84a` without a worklog).
decisions and why:
- Site = rest × (1 − claim), so towns spread out and avoid wasteland without a router choosing for them.
pitfalls:
- Claim must be rebuilt on actor removal or freed sites stay blocked.
next step suggestion:
- Add terrain build ease, water and harvesting (done in 11).
