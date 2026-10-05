// A consumer that vendored the release file into vendor/agentlens/ (the smoke test copies the
// built agentlens.mjs there; it is not committed).
import { createDetector } from "../vendor/agentlens/agentlens.mjs";

const d = createDetector();
d.on("verdict", (v) => console.log(`agentlens verdict ${v.label} ${v.reason}`));
