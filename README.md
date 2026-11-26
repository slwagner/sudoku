# Sudoku

A Sudoku that works offline and has no ads. One HTML file, nothing loaded from other sites. Puzzles are generated on the device and each has exactly one solution.

- `sudoku.html`: the whole game.
- `build.js`: wraps it into `pwa/` with a manifest and a service worker so it can be added to a phone's home screen and opened with no connection.
- `test.js`: Playwright checks (puzzle quality, play, no outside requests, offline). `node build.js && node test.js`.

The `gh-pages` branch holds the built files.
