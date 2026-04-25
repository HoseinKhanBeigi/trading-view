# Stopwatch component — solution map

Matrix: each row has **one** of `state`, `action`, `fn`, or `array` (mark in that column). Refs and `useState` that hold the engine are **state**; the lap list *shape* and row type are **array** (separate rows from `useState` for `laps`).


| Name / role                                 | state | action | fn  | array |
| ------------------------------------------- | ----- | ------ | --- | ----- |
| `isRunning`                                 | ●     |        |     |       |
| `setTick` / tick (re-renders while running) | ●     |        |     |       |
| `laps` (`useState<StopwatchLap[]>`)         | ●     |        |     |       |
| `copyFeedback`                              | ●     |        |     |       |
| `accumulatedMsRef`                          | ●     |        |     |       |
| `startAtRef`                                | ●     |        |     |       |
| `lastLapAtMsRef`                            | ●     |        |     |       |
| Start / Pause (one control)                 |       | ●      |     |       |
| Reset                                       |       | ●      |     |       |
| Lap                                         |       | ●      |     |       |
| Clear laps                                  |       | ●      |     |       |
| Copy time                                   |       | ●      |     |       |
| Space (toggle)                              |       | ●      |     |       |
| L / R (keyboard)                            |       | ●      |     |       |
| `laps` list (newest first, unshift)         |       |        |     | ●     |
| `StopwatchLap` row shape                    |       |        |     | ●     |
| `getElapsed`                                |       |        | ●   |       |
| `formatMs`                                  |       |        | ●   |       |
| `createLapId`                               |       |        | ●   |       |
| `setInterval` tick (~16ms)                  |       |        | ●   |       |
| Best / slowest (`min` / `max` on splits)    |       |        | ●   |       |
| `cn` + `className`                          |       |        | ●   |       |


`components/stopwatchComponent/index.tsx` — exports `Stopwatch`, `StopwatchProps`, `StopwatchLap`.


| Column | Meaning                                                  |
| ------ | -------------------------------------------------------- |
| state  | `useState` and ref-held timer/lap engine                 |
| action | User control or keyboard shortcut that invokes a handler |
| fn     | Functions, effects, and derived display logic            |
| array  | List ordering and the element type of `laps`             |


