# Sudoku

A Sudoku that works offline and has no ads. One HTML file, nothing loaded from other sites. Puzzles are generated on the device and each has exactly one solution.

- `game.html`: the game. `solver/solver.js`: a step-by-step solver that works the way a person does; it grades puzzles into six levels and drives the nudges. `sudoku.html` is the two built into one file.
- `build.js`: wraps it into `pwa/` with a manifest and a service worker so it can be added to a phone's home screen and opened with no connection.
- `test.js`: Playwright checks (puzzle quality, play, nudges, no outside requests, offline). `node build.js && node test.js`. `node solver/test.js` checks the solver never makes a wrong deduction.

The `gh-pages` branch holds the built files.
