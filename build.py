#!/usr/bin/env python3
"""Assemble src/ parts into one self-contained, offline HTML file."""
from pathlib import Path
root = Path(__file__).parent
src = root / "src"
head = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Loan &amp; Travel Fund Planner</title>
<script>
(function(){var t=null;try{t=localStorage.getItem('loan-travel-fund-planner:theme');}catch(e){}
if(t!=='light'&&t!=='dark'){t=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
document.documentElement.setAttribute('data-theme',t);})();
</script>
"""
css = (src / "styles.css").read_text()
body = (src / "body.html").read_text()
js = "\n".join((src / f).read_text() for f in ["model.js", "importers.js", "actuals.js", "charts.js", "ui.js", "actuals-ui.js", "boot.js"])
js = js.replace("if (typeof module !== 'undefined') module.exports", "if (false) module.exports")
out = f"{head}<style>\n{css}\n</style>\n</head>\n<body>\n{body}\n<script>\n{js}\n</script>\n</body>\n</html>\n"
dest = root / "loan-travel-fund-planner.html"
dest.write_text(out)
print(f"built {dest} ({len(out.splitlines())} lines, {len(out)//1024} KB)")
