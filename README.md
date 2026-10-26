# Loan & Travel Fund Planner — source

The app ships as one self-contained file, `loan-travel-fund-planner.html`. It is built from the parts in `src/`.

## Build

```
python3 build.py
```

Needs only Python 3. It joins the parts in this order and writes `loan-travel-fund-planner.html` next to this README:

1. A fixed head, with the script that picks the theme before the page paints
2. `src/styles.css`, wrapped in `<style>`
3. `src/body.html`, the markup for every tab
4. Every script, in one `<script>`: model, importers, actuals, charts, ui, actuals-ui, boot

After the build, open the HTML file in a browser to check it. Nothing else is needed: no npm, no server, no internet.

## Files

| File | What's in it |
| --- | --- |
| `src/model.js` | The plan math: loan payment, monthly fund projection, years to plan, Find my max, CSV dataset builders, the zip writer |
| `src/importers.js` | Reads bank files: CSV/TSV/TXT, OFX/QFX/QBO, QIF, Excel .xlsx. Parses dates and amounts, guesses columns, builds duplicate keys |
| `src/actuals.js` | Real transactions: types, default categories, best-guess categories, rules, summaries, actual loan progress, check-in reconciliation |
| `src/charts.js` | Number formatting and the SVG drawings: fuel chart, small preview charts, loan split, flight-path arc |
| `src/ui.js` | State, saving, tabs, sliders, tracker, Trips, Flight log, Loan schedule, admin menu, CSV/PDF export, guided tour |
| `src/actuals-ui.js` | The Actuals tab: import wizard, Customs, add by hand, check-ins, categories and rules |
| `src/boot.js` | Starts the app once everything above is loaded |
| `src/body.html` | Markup for the header, tabs, every view, and the icon sprite |
| `src/styles.css` | Light and dark themes, layout, responsive rules, print/PDF report styles |
| `build.py` | Assembles the single HTML file |
| `samples/` | Test bank exports, one per format |

`model.js`, `importers.js` and `actuals.js` don't touch the page, so they also load in Node for quick checks, for example `node -e "const M=require('./src/model.js'); console.log(M.calc(M.DEFAULTS).payment)"`.

## Data

Everything the app saves lives in the browser's localStorage under keys starting with `loan-travel-fund-planner`. It's tied to the browser and the file location, so opening the file in a different browser, or from a different folder, starts fresh. Use the gear menu's CSV export to keep a copy.
