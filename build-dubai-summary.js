/**
 * build-dubai-summary.js (MIN: In this edition only)
 * --------------------------------------------------
 * DOCX -> Mammoth HTML -> Extract "In this edition" -> Inject into layout -> MJML -> HTML
 *
 * Usage:
 *   node build-dubai-summary.js "docx/dubai-summary/2026/feb/feb-5.docx"
 *
 * Requirements:
 *   npm i mjml mammoth cheerio
 *
 * Templates:
 *   mjml-template/dubai-summary/layout.mjml                 (has {{%IN_THIS_EDITION_TABLE%}})
 *   mjml-template/dubai-summary/in-this-edition-table.mjml  (has {{%ROWS%}})
 */

import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import * as cheerio from "cheerio";
import mjml2html from "mjml";

const DOCX_PATH = process.argv[2];
const ROOT = process.cwd();

const NEWSLETTER_SLUG = "dubai-summary";
const TEMPLATE_DIR = path.join(ROOT, "mjml-template", NEWSLETTER_SLUG);

const LAYOUT_PATH = path.join(TEMPLATE_DIR, "layout.mjml");
const IN_THIS_EDITION_TPL_PATH = path.join(
  TEMPLATE_DIR,
  "in-this-edition-table.mjml",
);

const TOKEN_IN_THIS_EDITION = /\{\{\%\s*IN_THIS_EDITION_TABLE\s*\%\}\}/g;
const TOKEN_ROWS = /\{\{\%\s*ROWS\s*\%\}\}/g;

main().catch((e) => {
  console.error("❌ Build failed:", e);
  process.exit(1);
});

async function main() {
  if (!DOCX_PATH) {
    throw new Error(
      'Usage: node build-dubai-summary.js "docx/dubai-summary/2026/feb/feb-5.docx"',
    );
  }

  if (!fs.existsSync(DOCX_PATH))
    throw new Error(`DOCX not found: ${DOCX_PATH}`);
  if (!fs.existsSync(LAYOUT_PATH))
    throw new Error(`layout.mjml not found: ${LAYOUT_PATH}`);
  if (!fs.existsSync(IN_THIS_EDITION_TPL_PATH))
    throw new Error(
      `in-this-edition-table.mjml not found: ${IN_THIS_EDITION_TPL_PATH}`,
    );

  const { outMjmlPath, outHtmlPath, outDir } = computeOutPaths(DOCX_PATH);
  ensureDir(outDir);

  // 1) DOCX -> HTML
  const buffer = fs.readFileSync(DOCX_PATH);
  const { value: docHtml } = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.inline(async (image) => {
        const b64 = await image.read("base64");
        return { src: `data:${image.contentType};base64,${b64}` };
      }),
    },
  );

  // Optional debug:
  // fs.writeFileSync(path.join(outDir, "doc.html"), docHtml, "utf8");

  // 2) Extract "In this edition" items
  const editionItems = extractInThisEditionDubai(docHtml);
  console.log("🧩 In this edition items:", editionItems);

  // 3) Render MJML table from template
  const inThisEditionMjml = renderInThisEditionFromTemplate(editionItems);

  // 4) Inject into layout
  const layoutMjml = fs.readFileSync(LAYOUT_PATH, "utf8");

  if (!TOKEN_IN_THIS_EDITION.test(layoutMjml)) {
    console.warn(
      "⚠️ Token {{%IN_THIS_EDITION_TABLE%}} not found in layout.mjml",
    );
  }

  const finalMjml = layoutMjml.replace(
    TOKEN_IN_THIS_EDITION,
    inThisEditionMjml,
  );

  // 5) MJML -> HTML
  const { html, errors } = mjml2html(finalMjml, {
    validationLevel: "soft",
    filePath: LAYOUT_PATH,
  });

  if (errors?.length) {
    console.warn("⚠️ MJML validation warnings:");
    for (const err of errors)
      console.warn("-", err.formattedMessage || err.message || err);
  }

  fs.writeFileSync(outMjmlPath, finalMjml, "utf8");
  fs.writeFileSync(outHtmlPath, html, "utf8");

  console.log("✅ Built outputs:");
  console.log(" -", outMjmlPath);
  console.log(" -", outHtmlPath);
}

/**
 * Output path mirroring:
 * docx/dubai-summary/2026/feb/feb-5.docx
 * -> dist/dubai-summary/2026/feb/feb-5.mjml
 * -> dist/dubai-summary/2026/feb/feb-5.html
 */
function computeOutPaths(docxPath) {
  const abs = path.resolve(docxPath);

  const docxRoot = path.join(ROOT, "docx");
  const distRoot = path.join(ROOT, "dist");

  const rel = path.relative(docxRoot, abs); // dubai-summary/2026/feb/feb-5.docx
  if (rel.startsWith("..")) {
    throw new Error(
      `DOCX must be inside ${docxRoot}. Got: ${abs} (relative: ${rel})`,
    );
  }

  const relNoExt = rel.replace(/\.docx$/i, "");
  const outDir = path.join(distRoot, path.dirname(relNoExt));
  const base = path.basename(relNoExt);

  return {
    outDir,
    outMjmlPath: path.join(outDir, `${base}.mjml`),
    outHtmlPath: path.join(outDir, `${base}.html`),
  };
}

/**
 * Dubai "In this edition" extraction
 * Works for both:
 * - bullet lists (<ul><li>)
 * - plain paragraph lines after "In this edition:"
 */
function extractInThisEditionDubai(html) {
  const $ = cheerio.load(html);

  // Find marker: "In this edition:" (sometimes within a longer paragraph)
  const marker = $("p, h1, h2, h3, div")
    .filter((_, el) => {
      const t = cleanText($(el).text()).toLowerCase();
      return t === "in this edition:" || t.startsWith("in this edition:");
    })
    .first();

  if (!marker.length) return [];

  // Case 1: <ul> directly after marker
  let ul = marker.nextAll("ul").first();
  if (!ul.length) ul = marker.nextAll().find("ul").first();

  if (ul.length) {
    return ul
      .find("li")
      .map((_, li) => cleanText($(li).text()))
      .get()
      .filter(Boolean);
  }

  // Case 2: Plain lines as paragraphs after marker until we hit Spotlight or empty
  const items = [];
  let el = marker.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());
    const lower = txt.toLowerCase();

    // stop when Spotlight starts
    if (tag === "h2" && lower === "spotlight") break;
    if (tag === "h2" && txt) break;

    if (tag === "p") {
      if (!txt) break;

      // Skip date-like line (optional)
      if (
        /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
          txt,
        )
      ) {
        el = el.next();
        continue;
      }

      // Some docs include "In this edition:" on the same line, remove prefix
      const cleaned = txt.replace(/^in this edition:\s*/i, "").trim();
      if (cleaned) items.push(cleaned);
    } else if (tag === "div") {
      el.find("p").each((_, p) => {
        const t = cleanText($(p).text());
        const cleaned = t.replace(/^in this edition:\s*/i, "").trim();
        if (cleaned) items.push(cleaned);
      });
    }

    el = el.next();
  }

  return items.filter(Boolean);
}

function renderInThisEditionFromTemplate(items) {
  const tpl = fs.readFileSync(IN_THIS_EDITION_TPL_PATH, "utf8");

  const rows = (items || [])
    .filter(Boolean)
    .map((text) => makeEditionRow(text))
    .join("\n");

  if (!rows) return "";

  if (!TOKEN_ROWS.test(tpl)) {
    console.warn("⚠️ Token {{%ROWS%}} not found in in-this-edition-table.mjml");
  }

  return tpl.replace(TOKEN_ROWS, rows);
}

function makeEditionRow(text) {
  const safe = escapeHtml(cleanText(text));
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

/** Utils */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeDashes(s) {
  return (s || "").replace(/\u2010|\u2011|\u2012|\u2013|\u2014|\u2212/g, "-");
}

function cleanText(s) {
  return normalizeDashes((s || "").replace(/\s+/g, " ").trim());
}

function escapeHtml(str) {
  str = normalizeDashes(str || "");
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
