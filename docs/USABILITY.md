# Usability task script

No person has run this yet, so no participant data exists. The heuristic review below is not user research.

## Timed task

You need a frontend engineer who has not seen Frame, 30 minutes and the receipt app in `examples/receipt-app`.

Read this aloud: "This panel opens with a spring. If someone closes it halfway, it should leave quickly. Make that happen, and get it running in the app."

| Step | Done when | Record |
|---|---|---|
| 1. Start Frame on the receipt | The receipt is on screen | Time, help needed |
| 2. Open it, then close it before it settles | Two markers on the ribbon | Time, attempts |
| 3. Find what happened at the interruption | They read out the speed at that moment | Time, wrong turns |
| 4. Add a rule with its own spring for that close | The ribbon changes | Time, help needed |
| 5. Save the project and reopen it | The same take is back | Time |
| 6. Export it and run it in the app | The new close works in the browser | Time, errors |

Afterwards ask: "What did you expect a marker to do?" and "When did you lose track of whether the component was live?"

Report completion per step, median times with the number of participants, and every moment help was needed. Leave results blank until people have taken part.

## Heuristic review

| Heuristic | Finding |
|---|---|
| Visibility of status | Live, Inspecting and Playing back are always shown. Unsaved changes are always shown. |
| Error prevention | Out of range numbers never reach the project. A bad file changes nothing. |
| Recovery | Undo covers edits, drafts cover a closed tab, and a bad import keeps the working project. |
| Match to the task | Ribbon markers use your command names, not coordinates. |
| Reviewed and changed | Inspect mode froze the component with no note on it, so a note now sits above the component. |
| Reviewed and changed | The ghost path was unlabeled, so the ribbon now names the command it leaves out. |
| Known weakness | Undo also steps through recorded commands, which may surprise someone. |
