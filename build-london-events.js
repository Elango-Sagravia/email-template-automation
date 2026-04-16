/**
 * build-london-events.js
 * ----------------------
 * DOCX -> Mammoth HTML -> structured extraction -> MJML injection -> HTML
 *
 * Usage:
 *   node build-london-events.js "docx/london-events/2026/apr/10.docx"
 *
 * Expected layout tokens inside mjml-template/london-events/layout.mjml:
 *   {{%PREVIEW_TEXT%}}
 *   {{%IN_THIS_EDITION_ROWS%}}
 *   {{%SPOTLIGHT_SECTION%}}
 *   {{%FEATURED_SECTION%}}
 *   {{%LIVE_EVENTS_SECTION%}}
 *   {{%SHOPPING_SECTION%}}
 *   {{%NIGHTLIFE_SECTION%}}
 *   {{%EVERYTHING_ELSE_SECTION%}}
 *   {{%IMAGE_CREDITS%}}
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

const NEWSLETTER_SLUG = "london-events";
const TEMPLATE_DIR = path.join(ROOT, "mjml-template", NEWSLETTER_SLUG);
const LAYOUT_PATH = path.join(TEMPLATE_DIR, "layout.mjml");

const DEFAULT_IMAGE_SRC =
  "https://www.londonsummary.com/email/images/REPLACE_ME.jpg";
const DEFAULT_IMAGE_ALT = "REPLACE_ME";
const DEFAULT_IMAGE_HREF = "https://www.londonsummary.com/";

/** -----------------------------
 * TOKENS
 * ----------------------------- */
const TOKEN_PREVIEW_TEXT = /\{\{\%\s*PREVIEW_TEXT\s*\%\}\}/g;
const TOKEN_IN_THIS_EDITION_ROWS = /\{\{\%\s*IN_THIS_EDITION_ROWS\s*\%\}\}/g;
const TOKEN_SPOTLIGHT_SECTION = /\{\{\%\s*SPOTLIGHT_SECTION\s*\%\}\}/g;
const TOKEN_FEATURED_SECTION = /\{\{\%\s*FEATURED_SECTION\s*\%\}\}/g;
const TOKEN_LIVE_EVENTS_SECTION = /\{\{\%\s*LIVE_EVENTS_SECTION\s*\%\}\}/g;
const TOKEN_SHOPPING_SECTION = /\{\{\%\s*SHOPPING_SECTION\s*\%\}\}/g;
const TOKEN_NIGHTLIFE_SECTION = /\{\{\%\s*NIGHTLIFE_SECTION\s*\%\}\}/g;
const TOKEN_EVERYTHING_ELSE_SECTION =
  /\{\{\%\s*EVERYTHING_ELSE_SECTION\s*\%\}\}/g;
const TOKEN_IMAGE_CREDITS = /\{\{\%\s*IMAGE_CREDITS\s*\%\}\}/g;

/** -----------------------------
 * MAIN
 * ----------------------------- */
main().catch((e) => {
  console.error("Build failed:", e);
  process.exit(1);
});

async function main() {
  if (!DOCX_PATH) {
    throw new Error(
      'Usage: node build-london-events.js "docx/london-events/2026/apr/10.docx"',
    );
  }

  if (!fs.existsSync(DOCX_PATH)) {
    throw new Error(`DOCX not found: ${DOCX_PATH}`);
  }

  if (!fs.existsSync(LAYOUT_PATH)) {
    throw new Error(`layout.mjml not found: ${LAYOUT_PATH}`);
  }

  const { outDir, outMjmlPath, outHtmlPath } = computeOutPaths(DOCX_PATH);
  ensureDir(outDir);

  const docHtml = await convertDocxToHtml(DOCX_PATH);
  const data = parseDocument(docHtml);

  console.log("🧩 Parsed data:");
  console.dir(data, { depth: null });

  let finalMjml = fs.readFileSync(LAYOUT_PATH, "utf8");

  if (!hasToken(TOKEN_PREVIEW_TEXT, finalMjml)) {
    console.warn("⚠️ Token {{%PREVIEW_TEXT%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(
    TOKEN_PREVIEW_TEXT,
    renderPreviewRaw(data.previewText),
  );

  if (!hasToken(TOKEN_IN_THIS_EDITION_ROWS, finalMjml)) {
    console.warn(
      "⚠️ Token {{%IN_THIS_EDITION_ROWS%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(
    TOKEN_IN_THIS_EDITION_ROWS,
    renderInThisEditionRows(data.inThisEdition),
  );

  if (!hasToken(TOKEN_SPOTLIGHT_SECTION, finalMjml)) {
    console.warn("⚠️ Token {{%SPOTLIGHT_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(
    TOKEN_SPOTLIGHT_SECTION,
    renderFeatureCard(data.spotlight, true),
  );

  if (!hasToken(TOKEN_FEATURED_SECTION, finalMjml)) {
    console.warn("⚠️ Token {{%FEATURED_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(
    TOKEN_FEATURED_SECTION,
    renderFeatureCard(data.featured, false),
  );

  if (!hasToken(TOKEN_LIVE_EVENTS_SECTION, finalMjml)) {
    console.warn("⚠️ Token {{%LIVE_EVENTS_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(
    TOKEN_LIVE_EVENTS_SECTION,
    renderListSection("Live events", data.liveEvents),
  );

  if (!hasToken(TOKEN_SHOPPING_SECTION, finalMjml)) {
    console.warn("⚠️ Token {{%SHOPPING_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(
    TOKEN_SHOPPING_SECTION,
    renderListSection("Shopping", data.shopping),
  );

  if (!hasToken(TOKEN_NIGHTLIFE_SECTION, finalMjml)) {
    console.warn("⚠️ Token {{%NIGHTLIFE_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(
    TOKEN_NIGHTLIFE_SECTION,
    renderListSection("Nightlife", data.nightlife),
  );

  if (!hasToken(TOKEN_EVERYTHING_ELSE_SECTION, finalMjml)) {
    console.warn(
      "⚠️ Token {{%EVERYTHING_ELSE_SECTION%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(
    TOKEN_EVERYTHING_ELSE_SECTION,
    renderListSection("Everything else", data.everythingElse),
  );

  if (!hasToken(TOKEN_IMAGE_CREDITS, finalMjml)) {
    console.warn("⚠️ Token {{%IMAGE_CREDITS%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(
    TOKEN_IMAGE_CREDITS,
    escapeHtml(data.imageCredits || ""),
  );

  const { html, errors } = mjml2html(finalMjml, {
    validationLevel: "soft",
    filePath: LAYOUT_PATH,
    minify: false,
  });

  if (errors?.length) {
    console.warn("⚠️ MJML validation warnings:");
    for (const err of errors) {
      console.warn("-", err.formattedMessage || err.message || err);
    }
  }

  fs.writeFileSync(outMjmlPath, finalMjml, "utf8");
  fs.writeFileSync(outHtmlPath, html, "utf8");

  console.log("✅ Built outputs:");
  console.log(" -", outMjmlPath);
  console.log(" -", outHtmlPath);
}

/** -----------------------------
 * Output path mirroring
 * ----------------------------- */
function computeOutPaths(docxPath) {
  const abs = path.resolve(docxPath);

  const docxRoot = path.join(ROOT, "docx");
  const distRoot = path.join(ROOT, "dist");

  const rel = path.relative(docxRoot, abs);
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

/** -----------------------------
 * DOCX -> HTML
 * ----------------------------- */
async function convertDocxToHtml(docxPath) {
  const buffer = fs.readFileSync(docxPath);

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.inline(async (image) => {
        const b64 = await image.read("base64");
        return {
          src: `data:${image.contentType};base64,${b64}`,
        };
      }),
    },
  );

  return result.value;
}

/** -----------------------------
 * Parse full document
 * ----------------------------- */
function parseDocument(html) {
  return {
    previewText: extractPreviewText(html),
    imageCredits: extractImageCredits(html),
    inThisEdition: extractInThisEdition(html),
    ...extractSpotlightAndFeatured(html),
    liveEvents: extractListSectionByH3(html, "Live events"),
    shopping: extractListSectionByH3(html, "Shopping"),
    nightlife: extractListSectionByH3(html, "Nightlife"),
    everythingElse: extractListSectionByH3(html, "Everything else"),
  };
}

/** -----------------------------
 * Extractors
 * ----------------------------- */
function extractPreviewText(html) {
  const $ = cheerio.load(html);

  const marker = findSectionNode($, "Preview text");
  if (!marker.length) return "";

  let el = marker.next();
  while (el && el.length) {
    const tag = getTag(el);
    const txt = cleanText(el.text());

    if (tag === "h2" && txt) break;

    if (tag === "p" && txt) return txt;

    if (tag === "div") {
      const p = el.find("p").first();
      if (p.length) {
        const t = cleanText(p.text());
        if (t) return t;
      }
    }

    el = el.next();
  }

  return "";
}

function extractImageCredits(html) {
  const $ = cheerio.load(html);

  const marker =
    findSectionNode($, "Image credits") || findSectionNode($, "Images credits");
  if (!marker.length) return "";

  const parts = [];
  let el = marker.next();

  while (el && el.length) {
    const txt = cleanText(el.text());
    const lower = txt.toLowerCase();
    const tag = getTag(el);

    if (tag === "h2" && txt) break;
    if (lower === "preview text") break;

    if (tag === "p" && txt) {
      parts.push(txt);
    } else if (tag === "div") {
      el.find("p").each((_, p) => {
        const t = cleanText($(p).text());
        if (t) parts.push(t);
      });
    }

    el = el.next();
  }

  return parts.join(" ");
}

function extractInThisEdition(html) {
  const $ = cheerio.load(html);
  const lines = getOrderedTextLines($);

  const startIdx = lines.findIndex(
    (line) =>
      cleanText(line).toLowerCase() === "in this edition:" ||
      cleanText(line).toLowerCase() === "in this edition",
  );

  if (startIdx === -1) return [];

  const items = [];

  for (let i = startIdx + 1; i < lines.length; i++) {
    const text = cleanText(lines[i]);
    const lower = text.toLowerCase();

    if (!text) continue;
    if (lower === "spotlight") break;

    items.push(text);
  }

  return dedupeSimple(items);
}

function extractSpotlightAndFeatured(html) {
  const $ = cheerio.load(html);

  const section = extractStoriesFromSectionByH3($, "Spotlight");

  return {
    spotlight: section[0] || null,
    featured: section[1] || null,
  };
}

function extractListSectionByH3(html, sectionHeadingText) {
  const $ = cheerio.load(html);
  return extractStoriesFromSectionByH3($, sectionHeadingText);
}

function extractStoriesFromSectionByH3($, sectionHeadingText) {
  const marker = findSectionNode($, sectionHeadingText);
  if (!marker.length) return [];

  const stopSectionNames = [
    "Spotlight",
    "Live events",
    "Shopping",
    "Nightlife",
    "Everything else",
    "Image credits",
    "Images credits",
    "Preview text",
  ].filter((x) => x !== sectionHeadingText);

  const stories = [];
  let current = null;
  let el = marker.next();

  while (el && el.length) {
    const tag = getTag(el);
    const txt = cleanText(el.text());

    if (tag === "h2" && txt && txt !== sectionHeadingText) break;
    if (stopSectionNames.includes(txt)) break;

    if (tag === "h3" && txt) {
      if (current) stories.push(finalizeStory(current));
      current = {
        title: txt,
        chunks: [],
      };
      el = el.next();
      continue;
    }

    if (current) {
      if (tag === "p" || tag === "div" || tag === "ul" || tag === "ol") {
        current.chunks.push(el);
      }
    }

    el = el.next();
  }

  if (current) stories.push(finalizeStory(current));

  return stories;
}

function finalizeStory(story) {
  let summary = "";
  const body = [];
  let linkText = "";
  let linkHref = "";
  let when = "";
  let cost = "";
  let where = "";

  for (const chunk of story.chunks || []) {
    const tag = getTag(chunk);

    if (tag === "p") {
      consumeParagraph(chunk);
      continue;
    }

    if (tag === "div") {
      const childPs = chunk.children("p");
      if (childPs.length) {
        childPs.each((_, p) => consumeParagraph(chunk.constructor(p)));
      } else {
        const txt = cleanText(chunk.text());
        if (txt) {
          parseTextLine(txt, chunk.find("a[href]").first().attr("href") || "");
        }
      }
      continue;
    }
  }

  if (!body.length && summary) {
    body.push(summary);
  }

  return {
    title: cleanText(story.title || ""),
    summary,
    body,
    imageSrc: DEFAULT_IMAGE_SRC,
    imageAlt: DEFAULT_IMAGE_ALT,
    imageHref: DEFAULT_IMAGE_HREF,
    linkText,
    linkHref,
    when,
    cost,
    where,
  };

  function consumeParagraph(pNode) {
    const txt = cleanText(pNode.text());
    if (!txt) return;

    const href = pNode.find("a[href]").first().attr("href") || "";
    parseTextLine(txt, href);
  }

  function parseTextLine(txt, href) {
    const lower = txt.toLowerCase();

    if (lower.startsWith("summary:")) {
      summary = txt.replace(/^summary:\s*/i, "").trim();
      return;
    }

    if (lower.startsWith("🔗")) {
      linkText = txt.replace(/^🔗\s*link:\s*/i, "").trim();
      if (href) linkHref = href;
      return;
    }

    if (lower.startsWith("📅")) {
      when = txt.replace(/^📅\s*when:\s*/i, "").trim();
      if (href && !linkHref) linkHref = href;
      return;
    }

    if (lower.startsWith("💸")) {
      cost = txt.replace(/^💸\s*cost:\s*/i, "").trim();
      return;
    }

    if (lower.startsWith("📍")) {
      where = txt.replace(/^📍\s*where:\s*/i, "").trim();
      if (href && !linkHref) linkHref = href;
      return;
    }

    body.push(txt);
  }
}

function findSectionNode($, title) {
  return $("h1, h2, h3, p, div")
    .filter((_, el) => cleanText($(el).text()) === title)
    .first();
}

function getTag(node) {
  return (node?.[0]?.tagName || "").toLowerCase();
}

function getOrderedTextLines($) {
  const lines = [];

  $("h1, h2, h3, h4, p, li, div").each((_, el) => {
    const tag = (el.tagName || "").toLowerCase();
    const node = $(el);

    if (tag === "div" && node.children("h1, h2, h3, h4, p, li, div").length) {
      return;
    }

    const text = cleanText(node.text());
    if (!text) return;

    lines.push(text);
  });

  return dedupeConsecutive(lines);
}

function dedupeConsecutive(items) {
  const out = [];
  for (const item of items) {
    if (!out.length || out[out.length - 1] !== item) {
      out.push(item);
    }
  }
  return out;
}

function dedupeSimple(arr) {
  const out = [];
  const seen = new Set();

  for (const item of arr) {
    const key = cleanText(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

/** -----------------------------
 * Renderers
 * ----------------------------- */
function renderPreviewRaw(text) {
  const safe = escapeHtml(text || "");

  return `
<mj-raw>
  <div style="display: none; max-height: 0px; overflow: hidden">${safe}</div>
  <div style="display: none; max-height: 0px; overflow: hidden">
    &#847; &zwnj; &nbsp; &#8199; &shy; &#847; &zwnj; &nbsp; &#8199; &shy; &#847; &zwnj; &nbsp; &#8199; &shy;
    &#847; &zwnj; &nbsp; &#8199; &shy; &#847; &zwnj; &nbsp; &#8199; &shy; &#847; &zwnj; &nbsp; &#8199; &shy;
  </div>
</mj-raw>`.trim();
}

function renderInThisEditionRows(items) {
  return (items || [])
    .filter(Boolean)
    .map((item, idx, arr) => {
      const last = idx === arr.length - 1;
      return `
<tr>
  <td
    style="
      font-size: 18px;
      width: 20px;
      vertical-align: top;
      padding-right: 8px;
      ${last ? "" : "padding-bottom: 11px;"}
    "
  >
    →
  </td>
  <td
    style="
      font-size: 16px;
      line-height: 24px;
      ${last ? "line-height: 1.6;" : "padding-bottom: 11px;"}
    "
  >
    ${escapeHtml(item)}
  </td>
</tr>`.trim();
    })
    .join("\n");
}

function renderFeatureCard(story, showHeading) {
  if (!story || !story.title) return "";

  const paras = (story.body || [])
    .map((text, idx, arr) =>
      `
<p
  style="
    font-size: 16px;
    line-height: 1.5;
    padding-top: ${idx === 0 ? "15px" : "15px"};
    padding-bottom: ${idx === arr.length - 1 ? "0px" : "0px"};
    margin: 0;
  "
>
  ${escapeHtml(text)}
</p>`.trim(),
    )
    .join("\n");

  const meta = renderFeatureMetaBlock(story);

  return `
<mj-section
  background-color="#eff1f4"
  padding="1px 1px 1px 1px"
  border-radius="10px"
>
  <mj-column background-color="#fff" border-radius="10px" padding="0px">
    <mj-image
      border-radius="10px 10px 0 0"
      padding="0"
      width="600px"
      src="${DEFAULT_IMAGE_SRC}"
      alt="${DEFAULT_IMAGE_ALT}"
      href="${DEFAULT_IMAGE_HREF}"
    />
    <mj-text
      padding="20px 20px 0px 20px"
      font-family="Austin News Text Web, TNYAdobeCaslonPro, 'Times New Roman', serif"
      color="#000000"
    >
      <h2
        style="
          font-size: 24px;
          line-height: 1.2;
          font-weight: 400;
          margin: 0;
        "
      >
        ${escapeHtml(story.title)}
      </h2>
    </mj-text>
    <mj-text
      padding="0px 20px 0px 20px"
      font-family="Arial"
      color="#000000"
    >
      ${paras}
      ${meta}
    </mj-text>
  </mj-column>
</mj-section>`.trim();
}

function renderFeatureMetaBlock(story) {
  const lines = [];

  if (story.linkText || story.linkHref) {
    lines.push(
      `
🔗 <strong>Link:</strong>
<a
  style="
    text-decoration: none;
    border-bottom: 2px solid #80011f;
    color: black;
  "
  href="${escapeHtml(story.linkHref || "#")}"
  target="_blank"
>${escapeHtml(story.linkText || story.linkHref)}</a>`.trim(),
    );
  }

  if (story.when) {
    lines.push(`📅 <strong>When:</strong> ${escapeHtml(story.when)}`);
  }

  if (story.cost) {
    lines.push(`💸 <strong>Cost:</strong> ${escapeHtml(story.cost)}`);
  }

  if (story.where) {
    if (story.linkHref) {
      lines.push(
        `
📍 <strong>Where:</strong>
<a
  style="
    text-decoration: none;
    border-bottom: 2px solid #80011f;
    color: black;
  "
  href="${escapeHtml(story.linkHref)}"
  target="_blank"
>${escapeHtml(story.where)}</a>`.trim(),
      );
    } else {
      lines.push(`📍 <strong>Where:</strong> ${escapeHtml(story.where)}`);
    }
  }

  if (!lines.length) return "";

  return `
<p
  style="
    font-size: 16px;
    line-height: 24px;
    padding-top: 15px;
    padding-bottom: 20px;
    margin: 0;
  "
>
  ${lines.join("<br />")}
</p>`.trim();
}

function renderListSection(title, items) {
  const list = (items || []).filter((item) => item && item.title);
  if (!list.length) return "";

  return `
<mj-section
  background-color="#eff1f4"
  padding="1px 1px 1px 1px"
  border-radius="10px"
>
  <mj-column
    background-color="#fff"
    border-radius="10px"
    padding-bottom="7px"
  >
    <mj-text
      padding="20px 20px 0px 20px"
      font-family="Austin News Text Web, TNYAdobeCaslonPro, 'Times New Roman', serif"
      color="#000000"
    >
      <h2
        style="
          font-size: 24px;
          line-height: 1.2;
          font-weight: 400;
          margin: 0;
        "
      >
        ${escapeHtml(title)}
      </h2>
    </mj-text>
    <mj-divider
      border-width="4.8px"
      border-color="#80011F"
      width="35px"
      align="left"
      padding="0 20px 0px 20px"
    />
    <mj-section padding="0px">
      <mj-column padding="0px">
        <mj-spacer height="10px" />
      </mj-column>
    </mj-section>
    ${list.map((item, idx) => renderListItem(item, idx < list.length - 1)).join("\n")}
    <mj-section padding="0px">
      <mj-column padding="0px">
        <mj-spacer height="20px" />
      </mj-column>
    </mj-section>
  </mj-column>
</mj-section>`.trim();
}

function renderListItem(item, addDivider) {
  const descHtml = (item.body || [])
    .map((p) => `<p style="line-height: 24px">${escapeHtml(p)}</p>`)
    .join("\n");

  const whenParts = [];
  if (item.when) whenParts.push(escapeHtml(item.when));
  if (item.cost) whenParts.push(escapeHtml(item.cost));
  const whenText = whenParts.join(" | ");

  const whenLine = whenText
    ? item.linkHref
      ? `<a
          style="
            text-decoration: none;
            border-bottom: 2px solid #80011f;
            color: black;
          "
          href="${escapeHtml(item.linkHref)}"
          target="_blank"
        >${whenText}</a>`
      : whenText
    : "";

  const whereLine = item.where
    ? item.linkHref
      ? `<a
          style="
            text-decoration: none;
            border-bottom: 2px solid #80011f;
            color: black;
          "
          href="${escapeHtml(item.linkHref)}"
          target="_blank"
        >${escapeHtml(item.where)}</a>`
      : escapeHtml(item.where)
    : "";

  return `
<mj-section padding="5px 10px 0px 10px">
  <mj-group width="100%">
    <mj-column width="30%" vertical-align="top" padding="0">
      <mj-image
        align="left"
        src="${DEFAULT_IMAGE_SRC}"
        alt="${DEFAULT_IMAGE_ALT}"
        padding="0px"
        border-radius="8px"
        fluid-on-mobile="true"
        css-class="event-image"
        href="${DEFAULT_IMAGE_HREF}"
      />
    </mj-column>
    <mj-column width="70%" vertical-align="top">
      <mj-text
        padding="0px 15px 0px 15px"
        font-family="Arial"
        color="#000000"
        font-size="16px"
      >
        <p
          style="
            margin-bottom: 7px !important;
            margin-top: 6px !important;
            line-height: 16px;
          "
        >
          <strong>${escapeHtml(item.title)}</strong>
        </p>
        ${descHtml}
        <p style="margin-bottom: 0px; line-height: 24px">
          ${
            whenLine
              ? `📅 <strong>When:</strong> ${whenLine}${whereLine ? "<br />" : ""}`
              : ""
          }
          ${whereLine ? `📍 <strong>Where:</strong> ${whereLine}` : ""}
        </p>
      </mj-text>
    </mj-column>
  </mj-group>
</mj-section>
${
  addDivider
    ? `<mj-divider
         border-style="dashed"
         border-width="1px"
         border-color="lightgrey"
         padding="20px 22px 8px 22px"
       />`
    : ""
}`.trim();
}

/** -----------------------------
 * Utils
 * ----------------------------- */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanText(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hasToken(re, str) {
  re.lastIndex = 0;
  return re.test(str);
}
