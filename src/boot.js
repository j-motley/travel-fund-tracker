// ---------- boot ----------
buildControls(); wireTabs(); wireChart(); wireTrips(); wireTools(); wireTracker(); wireAdmin(); wireGuide(); wireActuals();
$('yearRows').addEventListener('input', e => {
  const yr = e.target.dataset.oyear; if (!yr) return;
  if (e.target.value === '') delete state.overrides[yr]; else state.overrides[yr] = Math.max(0, parseFloat(e.target.value) || 0);
  update();
});
paintThemeBtn(); syncAll();
let startView = location.hash.slice(1);
if (!VIEWS.includes(startView)) startView = store.get(K_VIEW) || 'tracker';
VIEWS.forEach(n => $('view-' + n).hidden = n !== startView); currentView = startView;
update(); showView(startView);
takeoff();
let rzRaf = 0, lastW = 0;
new ResizeObserver(() => { const w = document.documentElement.clientWidth; if (w === lastW) return; lastW = w; cancelAnimationFrame(rzRaf); rzRaf = requestAnimationFrame(() => { hideReadout(); renderTracker(last); drawCharts(last); }); }).observe(document.body);
