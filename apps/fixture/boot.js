// Test hook. The fixture page (not the library) records verdicts and signals, so the
// library stays free of harness code. Avoids exposeFunction/exposeBinding on purpose.
const params = new URLSearchParams(location.search);
const run = params.get("run") || "adhoc";
const variant = params.get("variant") === "iife" ? "iife" : "esm";
const baselines = params.get("baselines") === "1";

window.__alVerdicts = [];

function record(kind, payload) {
  const entry = { kind, run, variant, url: location.pathname, at: Date.now(), payload };
  window.__alVerdicts.push(entry);
  const body = new Blob([JSON.stringify(entry)], { type: "text/plain;charset=UTF-8" });
  navigator.sendBeacon("/record?run=" + encodeURIComponent(run), body);
}

function start(createDetector) {
  // Init cost, read by the perf trace runner.
  const t0 = performance.now();
  const d = createDetector();
  window.__alInitMs = performance.now() - t0;
  d.on("verdict", (v) => record("verdict", v));
  d.on("signal", (s) => record("signal", s));
  window.__alSnapshot = () => d.snapshot();
  if (baselines) void startBaselines();
}

if (variant === "iife") {
  const s = document.createElement("script");
  s.src = "/lib/agentlens.iife.js";
  s.onload = () => start(window.agentlens.createDetector);
  document.head.append(s);
} else {
  import("/lib/agentlens.mjs")
    .then((m) => start(m.createDetector))
    .catch((err) => console.error("agentlens failed to load", err));
}

// Baselines (architecture 7.4) on the same run, loaded after agentlens so they never delay it.
// Each records its own result per page; the eval counts a run as flagged by a baseline if any
// page's last result flagged it. BotD's monitoring ping is off, so neither makes a request.
async function startBaselines() {
  try {
    const { load } = await import("/baselines/botd/botd.esm.js");
    const r = (await load({ monitoring: false })).detect();
    record("baseline", { name: "botd", bot: r.bot, botKind: r.bot ? r.botKind : null });
  } catch (err) {
    record("baseline", { name: "botd", error: String(err) });
  }
  try {
    const { createEngine } = await import("/baselines/agent-detector/index.js");
    const engine = createEngine(window);
    const snap = (v, when) =>
      record("baseline", {
        name: "agent-detector",
        when,
        class: v.class,
        pHuman: v.probability.human,
        pBot: v.probability.bot,
        pAgent: v.probability.agent,
      });
    addEventListener("pagehide", () => snap(engine.verdict(), "pagehide"));
    snap(await engine.ready, "ready");
  } catch (err) {
    record("baseline", { name: "agent-detector", error: String(err) });
  }
}

// Carry the run id, variant and baselines flag across the three pages.
for (const a of document.querySelectorAll("a[data-next]")) {
  a.href = a.getAttribute("href") + location.search;
}
