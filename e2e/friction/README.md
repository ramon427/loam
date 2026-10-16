# Friction baseline

Each `*.friction.ts` flow does one core job in the real app the way a person would today, on
the fastest path the app offers. It records what the job costs:

| Measure    | Meaning                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keys       | Discrete key presses; a chord such as Ctrl+Shift+F counts once                                                                                                                                                                                   |
| Typed      | Characters of content: a title, a search word                                                                                                                                                                                                    |
| Clicks     | Pointer clicks                                                                                                                                                                                                                                   |
| Decisions  | Points where a person has to stop and choose or remember something                                                                                                                                                                               |
| Mouse-only | Steps that no key reaches                                                                                                                                                                                                                        |
| Waits ms   | Time spent waiting on the app (measured)                                                                                                                                                                                                         |
| Overhead s | Keystroke-Level Model estimate of the person's time, without typing the content: K 0.28 s per key, P 1.1 s to point, B 0.1 s per button press, H 0.4 s to move a hand between keyboard and mouse, M 1.35 s per decision, plus the measured waits |
| Per week   | How often a typical person does the job (an assumption, set in each flow)                                                                                                                                                                        |
| s/week     | Per week × overhead: what the ranking uses                                                                                                                                                                                                       |

## Run it

```sh
xvfb-run -a npm run friction              # build, run every flow, print the table against baseline.json
node e2e/friction/report.ts --save        # after an intended change: make the last run the baseline
```

The flows run one at a time and seed their own libraries (`library.ts`: 200 or 2,000 notes in
25 folders). Results go to `tmp/friction/`; `report.md` there is the table.

Across three runs on one build, overhead moved by ±0.2 s per flow. Two flows move more: a cold
start's launch wait (up to +0.6 s), and finding a note among near-identical titles, where
search ranking ties change how many ↓ presses or "Show more" pages are needed. Treat smaller
changes as noise.

Another process rebuilding the app mid-run changes what's measured. To pin a build, copy
`apps/desktop` somewhere after building and set `LOAM_E2E_APP_DIRECTORY` to the copy (see
`e2e/app.ts`).

When a change removes a step, change the flow to take the new path, then rerun. The flow's
numbers should drop, and the comment that explained the old detour should go.

`cold-test.md` is the matching 15-minute script for people.
