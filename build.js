/**
 * build.js
 * ----------
 * DOCX -> Mammoth HTML -> extract "In this edition" bullets -> render MJML rows
 * -> inject rows into in-this-edition-table.mjml ({{%ROWS%}})
 * -> inject the table into layout.mjml ({{%IN_THIS_EDITION_TABLE%}})
 * -> compile MJML -> HTML
 *
 * Usage:
 *   node build.js "docx/presidential-summary/feb-5.docx"
 *
 * Install:
 *   npm i mjml mammoth cheerio
 *
 * Required files:
 *   mjml-template/presidential-summary/layout.mjml
 *   mjml-template/presidential-summary/in-this-edition-table.mjml
 *
 * Required placeholders:
 *   - layout.mjml must contain: {{%IN_THIS_EDITION_TABLE%}} (spaces ok)
 *   - in-this-edition-table.mjml must contain: {{%ROWS%}} (spaces ok)
 */

import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import * as cheerio from "cheerio";
import mjml2html from "mjml";

/** -----------------------------
 * CONFIG
 * ----------------------------- */
const DOCX_PATH = process.argv[2];
const ROOT = process.cwd();

const TEMPLATE_DIR = path.join(ROOT, "mjml-template", "presidential-summary");
const LAYOUT_PATH = path.join(TEMPLATE_DIR, "layout.mjml");
const TABLE_TPL_PATH = path.join(TEMPLATE_DIR, "in-this-edition-table.mjml");

const DIST_DIR = path.join(ROOT, "dist");
const OUT_MJML = path.join(DIST_DIR, "email.mjml");
const OUT_HTML = path.join(DIST_DIR, "email.html");

/** -----------------------------
 * MAIN
 * ----------------------------- */
main().catch((e) => {
  console.error("❌ Build failed:", e);
  process.exit(1);
});

async function main() {
  if (!DOCX_PATH) throw new Error('Usage: node build.js "<path-to-docx>"');
  if (!fs.existsSync(DOCX_PATH))
    throw new Error(`DOCX not found: ${DOCX_PATH}`);
  if (!fs.existsSync(LAYOUT_PATH))
    throw new Error(`layout.mjml not found: ${LAYOUT_PATH}`);
  if (!fs.existsSync(TABLE_TPL_PATH))
    throw new Error(`in-this-edition-table.mjml not found: ${TABLE_TPL_PATH}`);

  ensureDir(DIST_DIR);

  // 1) DOCX -> HTML
  const buffer = fs.readFileSync(DOCX_PATH);
  const { value: docHtml } = await mammoth.convertToHtml({ buffer });

  // Optional: inspect Mammoth HTML
  // fs.writeFileSync(path.join(DIST_DIR, "doc.html"), docHtml, "utf8");

  // 2) Extract items
  const items = extractInThisEdition(docHtml);

  // 3) Render the table MJML from template (fills {{%ROWS%}})
  const tableMjml = renderInThisEditionTable(items);

  console.log("🧩 In this edition items:", items);
  console.log("🧩 Table MJML chars:", tableMjml.length);

  // 4) Inject into layout at {{%IN_THIS_EDITION_TABLE%}} (spaces ok)
  const layoutMjml = fs.readFileSync(LAYOUT_PATH, "utf8");
  const layoutToken = /\{\{\%\s*IN_THIS_EDITION_TABLE\s*\%\}\}/g;

  if (!layoutToken.test(layoutMjml)) {
    console.warn(
      "⚠️ Placeholder {{%IN_THIS_EDITION_TABLE%}} not found in layout.mjml.",
    );
    console.warn(
      "   Add it where you want the bullet table to appear, then re-run.",
    );
  }

  const finalMjml = layoutMjml.replace(layoutToken, tableMjml);

  // 5) Compile MJML -> HTML
  const { html, errors } = mjml2html(finalMjml, {
    validationLevel: "soft",
    filePath: LAYOUT_PATH,
  });

  if (errors?.length) {
    console.warn("⚠️ MJML validation warnings:");
    for (const err of errors)
      console.warn("-", err.formattedMessage || err.message || err);
  }

  fs.writeFileSync(OUT_MJML, finalMjml, "utf8");
  fs.writeFileSync(OUT_HTML, html, "utf8");

  console.log("✅ Built outputs:");
  console.log(" -", OUT_MJML);
  console.log(" -", OUT_HTML);
}

/** -----------------------------
 * Extract "In this edition" bullets from Mammoth HTML
 * ----------------------------- */
function extractInThisEdition(html) {
  const $ = cheerio.load(html);

  // Find the marker line (tolerant)
  const marker = $("p, h1, h2, h3, div")
    .filter((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim().toLowerCase();
      return t === "in this edition:" || t.startsWith("in this edition:");
    })
    .first();

  if (!marker.length) return [];

  // Find the first UL after marker
  let ul = marker.nextAll("ul").first();
  if (!ul.length) ul = marker.nextAll().find("ul").first();
  if (!ul.length) return [];

  return ul
    .find("li")
    .map((_, li) => $(li).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean);
}

/** -----------------------------
 * Render MJML table using in-this-edition-table.mjml (fills {{%ROWS%}})
 * ----------------------------- */
function renderInThisEditionTable(items) {
  const tpl = fs.readFileSync(TABLE_TPL_PATH, "utf8");

  const rows = (items || [])
    .filter(Boolean)
    .map((text) => makeRow(text))
    .join("\n");

  // If no bullets, return empty string so layout has no table gap
  if (!rows) return "";

  const rowsToken = /\{\{\%\s*ROWS\s*\%\}\}/g;

  if (!rowsToken.test(tpl)) {
    console.warn(
      "⚠️ Placeholder {{%ROWS%}} not found in in-this-edition-table.mjml.",
    );
    console.warn("   Add {{%ROWS%}} inside the <mj-table> and re-run.");
  }

  return tpl.replace(rowsToken, rows);
}

/** Row HTML: matches your original styles */
function makeRow(text) {
  const safe = escapeHtml((text || "").trim());
  return `
  <tr>
    <td style="
                font-size: 18px;
                width: 20px;
                vertical-align: top;
                padding-right: 8px;
                line-height: 1.6;
              "> → </td>
    <td style="font-size: 16px; line-height: 1.6">${safe}</td>
  </tr>`.trim();
}

/** -----------------------------
 * Utils
 * ----------------------------- */
function escapeHtml(str) {
  return (str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
