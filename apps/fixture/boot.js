// Test hook. The fixture page (not the library) records verdicts and signals, so the
// library stays free of harness code. Avoids exposeFunction/exposeBinding on purpose.
const params = new URLSearchParams(location.search);
const run = params.get("run") || "adhoc";
const variant = params.get("variant") === "iife" ? "iife" : "esm";

window.__alVerdicts = [];

function record(kind, payload) {
  const entry = { kind, run, variant, url: location.pathname, at: Date.now(), payload };
  window.__alVerdicts.push(entry);
  const body = new Blob([JSON.stringify(entry)], { type: "text/plain;charset=UTF-8" });
  navigator.sendBeacon("/record?run=" + encodeURIComponent(run), body);
}

function start(createDetector) {
  const d = createDetector();
  d.on("verdict", (v) => record("verdict", v));
  d.on("signal", (s) => record("signal", s));
  window.__alSnapshot = () => d.snapshot();
}

if (variant === "iife") {
  const s = document.createElement("script");
  s.src = "/lib/agentlens.iife.js";
  s.onload = () => start(window.agentlens.createDetector);
  document.head.append(s);
} else {
  import("/lib/agentlens.mjs").then((m) => start(m.createDetector));
}

// Carry the run id and variant across the three pages.
for (const a of document.querySelectorAll("a[data-next]")) {
  a.href = a.getAttribute("href") + location.search;
}
