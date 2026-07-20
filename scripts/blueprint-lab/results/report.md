# blueprint-lab report

- total cases: 15
- parsed: 12
- unparsed: 3 (9180370f, cf9f3b59, f092ab23)
- blueprint model=sonnet effort=medium

## Acceptance table

| id | title | leafKind expected | leafKind actual | validation | file match rate |
| --- | --- | --- | --- | --- | --- |
| 079924bb | remove a subscription from the Bridge Subscribers list | feature | feature | accept | 100.0% |
| 152643e0 | unified LLM token-spend tracker + burn gauge + leak alarm | feature | feature | accept | 86.7% |
| 167d43a4 | show 5h/7d account usage in the top bar (same gauges as Zen) | feature | refactor | accept | 75.0% |
| 1d38b170 | Missions tab reuses MissionDetailPanel (scroll, hide-completed, detail) | fix | refactor | accept | 50.0% |
| 203ff9b2 | Replicate the exactly-one contract-repair retry in the blueprint-lab emit harness | feature | feature | accept | 100.0% |
| 375890db | Wire the bounded contract-underspecification repair into the blueprint node + unit test | feature | feature | accept | 50.0% |
| 5c1482ef | stop three token leaks — conductor/summary/triage re-spend on idle | fix | fix | accept | 100.0% |
| 5f3e8413 | Missions and Usage tabs in the left rail | feature | feature | accept | 60.0% |
| 74a67df5 | label the daemon toggle + make the conductor depend on the daemon | feature | feature | accept | 83.3% |
| 7f473bf8 | commit report.md + score.json from the real-model harness run | infra | infra | accept | 100.0% |
| 9180370f | skip AI triage when the conductor is on (it handles escalations) | feature | n/a | parse-null | n/a |
| 980462ae | drop the Waves + Zen groups from the node-models matrix | feature | refactor | accept | 100.0% |
| cba8df7d | interactive conductor on/off switch next to the daemon switch | feature | feature | accept | 100.0% |
| cf9f3b59 | retire the daemon summary interpret — sessions self-report (off by default) | feature | n/a | parse-null | n/a |
| f092ab23 | Add the same bounded repair pass to the blueprint-lab emit harness | feature | n/a | parse-null | n/a |

## Rejection-mode breakdown

| mode | count | percentage |
| --- | --- | --- |
| accept | 12 | 80.0% |
| parse-null | 3 | 20.0% |

## Match-rate summary

- mean file-match rate: 83.8%
- total matched: 44
- total undeclared-actual: 8
- total declared-but-untouched: 11
- leafKind mismatches: 3/15

## GATE verdict

**PASS** — acceptRate=80.0% >= 70% and meanMatchRate=83.8% >= 60%
