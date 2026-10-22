// Builds + runs golden_dashboard.jsx (see its header). Usage, from mobile/:
//   TZ=Asia/Kolkata LANG=en_US.UTF-8 node test/production/engine/tool/build_dashboard_golden.mjs <scratchDir> > test/production/engine/fixtures/dashboard_parity_golden.json
// The plugin below appends `export { ... }` to two client files IN MEMORY so the
// private helpers can be imported; the client sources are never modified.
import { build } from "/Users/hqepldev/HQEPL/Indo-OEE/client/node_modules/esbuild/lib/main.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const C = "/Users/hqepldev/HQEPL/Indo-OEE/client";
const patches = {
  "ProcessDashboard/charts.jsx": "\nexport { niceAxis, tickText, truncate, shortCause };\n",
  "ProcessDashboard/DrillModal.jsx": "\nexport { Split, Records };\n",
};
const patch = {
  name: "export-privates",
  setup(b) {
    b.onLoad({ filter: /ProcessDashboard\/(charts|DrillModal)\.jsx$/ }, (a) => {
      const key = Object.keys(patches).find((k) => a.path.endsWith(k));
      return { contents: fs.readFileSync(a.path, "utf8") + patches[key], loader: "jsx", resolveDir: path.dirname(a.path) };
    });
  },
};
const outfile = path.join(dir, "gen_dash.mjs");
await build({
  entryPoints: ["test/production/engine/tool/golden_dashboard.jsx"],
  bundle: true, platform: "node", format: "esm", outfile, logLevel: "error",
  loader: { ".js": "jsx", ".css": "empty" },
  banner: { js: "import {createRequire} from 'module';const require=createRequire(import.meta.url);" },
  nodePaths: [`${C}/node_modules`],
  plugins: [patch],
});
const r = spawnSync("node", [outfile], { stdio: ["ignore", "inherit", "inherit"], maxBuffer: 1 << 30 });
process.exit(r.status ?? 1);
