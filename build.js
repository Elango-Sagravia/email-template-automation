/**
 * build.js (dispatcher)
 * Usage:
 *   node build.js "docx/presidential-summary/2026/feb/feb-5.docx"
 */

import path from "path";
import { spawnSync } from "child_process";

const DOCX_PATH = process.argv[2];
if (!DOCX_PATH) {
  console.error('Usage: node build.js "docx/<newsletter>/YYYY/mon/file.docx"');
  process.exit(1);
}

// Normalize to forward parsing, still safe on Windows/macOS/Linux
const normalized = DOCX_PATH.split(path.sep).join("/");

// Very simple parse: docx/<newsletter>/...
const parts = normalized.split("/");
const newsletter = parts[1];

const builders = {
  "presidential-summary": "build-presidential-summary.js",
  // later:
  "geopolitical-summary": "build-geopolitical-summary.js",
  "dubai-summary": "build-dubai-summary.js",
  "london-summary": "build-london-summary.js",
  "singapore-summary": "build-singapore-summary.js",
  "saudi-summary": "build-saudi-summary.js",
};

const builder = builders[newsletter];
if (!builder) {
  console.error(
    `No builder found for "${newsletter}". Expected one of: ${Object.keys(builders).join(", ")}`,
  );
  process.exit(1);
}

const builderPath = path.join(process.cwd(), builder);

// Run: node <builder> "<docx_path>"
const res = spawnSync(process.execPath, [builderPath, DOCX_PATH], {
  stdio: "inherit",
});

process.exit(res.status ?? 1);
