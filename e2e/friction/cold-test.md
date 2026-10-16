# Loam cold test: 15 minutes, one person at a time

A task script to hand to 2–3 people who have never used Loam. It covers the same jobs as the
Playwright friction flows, so what people do can be set against the measured baseline.

## Before the session (facilitator, 5 minutes, once)

```sh
npm run build
LOAM_COLD_TEST_DIR=$HOME/loam-cold-test xvfb-run -a npx playwright test -c e2e/friction/playwright.config.ts prepare
```

This makes `~/loam-cold-test/` with:

- `empty/`: an empty library for task 1.
- `library/`: 2,000 notes in 25 folders, including a plumber's quote and a note
  with an older version to bring back.
- `Old vault/`: three Markdown notes and a `.docx` file to import. Put a copy on the
  tester's Desktop.

Start Loam for task 1 with `LOAM_DATA_DIR=$HOME/loam-cold-test/empty npm --prefix apps/desktop start`.
Start it for tasks 2–8 with `LOAM_DATA_DIR=$HOME/loam-cold-test/library …`. Make a fresh copy of
`library/` for each tester.

Record the screen and the tester's voice. Have a stopwatch and this sheet.

## Rules for the facilitator

- Read each task aloud exactly as written, then hand over the card. Don't name buttons or
  shortcuts.
- Ask the tester to think aloud. If they go quiet for 10 seconds, ask "What are you looking
  for?" Say nothing else.
- Don't help. When a task runs past its time cap, say "Let's move on" and mark it **failed**.
  If the tester is stuck for 60 seconds you may give one hint: "Try right-clicking." Mark the
  task **hinted**.
- After each task, ask: "On a scale of 1 (very hard) to 7 (very easy), how was that?"

## Tasks

| #   | Read aloud                                                                                                                                   | Cap  | Done when                                                | Maps to flow                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | _(empty library)_ "You've just thought of a birthday present for your sister: a pottery class. Get that into Loam."                          | 2:00 | A note holds the text                                    | states / first launch to first note                             |
| —   | _Facilitator: quit Loam, start it on `library/`, open "Budget: roof 0"._                                                                     | 0:30 |                                                          |                                                                 |
| 2   | "You're reading this note and remember you have to call the dentist on Monday. Note that down, then come back to the note you were reading." | 2:00 | A dentist note exists and "Budget: roof 0" is open again | capture / new note, app open + find / back to the previous note |
| 3   | "A while ago you saved a plumber's quote for the bathroom. How much was it?"                                                                 | 1:30 | Says "420"                                               | find / by title word                                            |
| 4   | "In 'Budget: roof 0', add a link to that plumber's quote."                                                                                   | 2:00 | The link is in the note                                  | rework / link to a note while writing                           |
| 5   | "The plumber's quote belongs with your money things. Put it in the Money folder."                                                            | 1:30 | Note is in Money                                         | rework / move open note to a folder                             |
| 6   | "Delete the note 'Trip: climbing 5'." _(once done)_ "Oh, sorry, you still needed that. Get it back."                                         | 1:30 | Note is back                                             | recover / undo a delete straight away                           |
| 7   | "Someone overwrote the first line of 'Budget: roof 0' this morning. It used to say what the roofer charged. Get the old text back."          | 2:00 | Text reads 9,400 again                                   | recover / bring back overwritten text                           |
| 8   | "Your old notes are in the 'Old vault' folder on the Desktop. Bring them into Loam, then open 'Compost'."                                    | 2:00 | "Compost" is open                                        | transfer / import a Markdown folder                             |

Debrief, 1 minute: "What was the most annoying moment? What did you expect to be there that
wasn't?"

## What to record per task

| #   | Time (m:ss) | Result: done / hinted / failed | Ease 1–7 | Wrong turns (each click or key that led nowhere) | Where they stopped to think, in their words |
| --- | ----------- | ------------------------------ | -------- | ------------------------------------------------ | ------------------------------------------- |
| 1   |             |                                |          |                                                  |                                             |
| 2   |             |                                |          |                                                  |                                             |
| 3   |             |                                |          |                                                  |                                             |
| 4   |             |                                |          |                                                  |                                             |
| 5   |             |                                |          |                                                  |                                             |
| 6   |             |                                |          |                                                  |                                             |
| 7   |             |                                |          |                                                  |                                             |
| 8   |             |                                |          |                                                  |                                             |

## What to watch for

These are the friction points the scripted baseline found. Tick any you see:

- [ ] Pressed Enter or Tab after typing a title, expecting to be in the body (task 1, 2).
- [ ] Unsure which of the three "New note" buttons to use, or what the unlabelled icons do (task 1).
- [ ] Looked for Back, a recent list or Alt+← to get to the previous note (task 2).
- [ ] Typed `[[` to link before finding `@` (task 4).
- [ ] Looked for Move on the note's page or in a menu bar before right-clicking the sidebar (task 5).
- [ ] Pressed Ctrl+Z after deleting and nothing happened; missed the toast (task 6).
- [ ] Looked for history on the note's page, not on the sidebar's right-click menu (task 7).
- [ ] Looked for Import in a menu bar or the sidebar before Settings (task 8).
- [ ] Couldn't tell where the imported notes went (task 8).

Compare each tester's times with the flow's "Overhead s" in the baseline. A gap of more than
10 seconds means the script is missing a step real people take.
