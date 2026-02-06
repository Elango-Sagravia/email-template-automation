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
const IN_THIS_EDITION_TPL_PATH = path.join(
  TEMPLATE_DIR,
  "in-this-edition-table.mjml",
);
const SPOTLIGHT_SECTION_TPL_PATH = path.join(TEMPLATE_DIR, "spotlight.mjml");

const DIST_DIR = path.join(ROOT, "dist");
const OUT_MJML = path.join(DIST_DIR, "email.mjml");
const OUT_HTML = path.join(DIST_DIR, "email.html");

/** -----------------------------
 * TOKENS (spaces tolerated)
 * ----------------------------- */
const TOKEN_IN_THIS_EDITION = /\{\{\%\s*IN_THIS_EDITION_TABLE\s*\%\}\}/g;
const TOKEN_ROWS = /\{\{\%\s*ROWS\s*\%\}\}/g;

// Layout token that will be replaced by multiple spotlight <mj-section> blocks
const TOKEN_SPOTLIGHT_SECTIONS = /\{\{\%\s*SPOTLIGHT_SECTIONS\s*\%\}\}/g;

// Spotlight section template tokens
const TOKEN_SPOTLIGHT_HEADER = /\{\{\%\s*SPOTLIGHT_HEADER\s*\%\}\}/g;
const TOKEN_SPOTLIGHT_TOPIC = /\{\{\%\s*SPOTLIGHT_TOPIC\s*\%\}\}/g;

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
  if (!fs.existsSync(IN_THIS_EDITION_TPL_PATH)) {
    throw new Error(
      `in-this-edition-table.mjml not found: ${IN_THIS_EDITION_TPL_PATH}`,
    );
  }
  if (!fs.existsSync(SPOTLIGHT_SECTION_TPL_PATH)) {
    throw new Error(`spotlight.mjml not found: ${SPOTLIGHT_SECTION_TPL_PATH}`);
  }

  ensureDir(DIST_DIR);

  // 1) DOCX -> HTML
  const buffer = fs.readFileSync(DOCX_PATH);
  const { value: docHtml } = await mammoth.convertToHtml({ buffer });

  // Optional debug:
  // fs.writeFileSync(path.join(DIST_DIR, "doc.html"), docHtml, "utf8");

  // 2) In this edition
  const editionItems = extractInThisEdition(docHtml);
  const inThisEditionMjml = renderInThisEditionFromTemplate(editionItems);

  console.log("🧩 In this edition items:", editionItems);

  // 3) Spotlight
  const spotlightTopics = extractSpotlightTopics(docHtml);
  const spotlightSectionsMjml = renderSpotlightSections(spotlightTopics);

  console.log(
    "🧩 Spotlight topics:",
    spotlightTopics.map((t) => t.title),
  );

  // 4) Inject into layout
  const layoutMjml = fs.readFileSync(LAYOUT_PATH, "utf8");

  if (!TOKEN_IN_THIS_EDITION.test(layoutMjml)) {
    console.warn(
      "⚠️ Placeholder {{%IN_THIS_EDITION_TABLE%}} not found in layout.mjml",
    );
  }
  if (!TOKEN_SPOTLIGHT_SECTIONS.test(layoutMjml)) {
    console.warn(
      "⚠️ Placeholder {{%SPOTLIGHT_SECTIONS%}} not found in layout.mjml",
    );
  }

  const finalMjml = layoutMjml
    .replace(TOKEN_IN_THIS_EDITION, inThisEditionMjml)
    .replace(TOKEN_SPOTLIGHT_SECTIONS, spotlightSectionsMjml);

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

  const marker = $("p, h1, h2, h3, div")
    .filter((_, el) => {
      const t = cleanText($(el).text()).toLowerCase();
      return t === "in this edition:" || t.startsWith("in this edition:");
    })
    .first();

  if (!marker.length) return [];

  let ul = marker.nextAll("ul").first();
  if (!ul.length) ul = marker.nextAll().find("ul").first();
  if (!ul.length) return [];

  return ul
    .find("li")
    .map((_, li) => cleanText($(li).text()))
    .get()
    .filter(Boolean);
}

function renderInThisEditionFromTemplate(items) {
  const tpl = fs.readFileSync(IN_THIS_EDITION_TPL_PATH, "utf8");

  const rows = (items || [])
    .filter(Boolean)
    .map((text) => makeEditionRow(text))
    .join("\n");

  if (!rows) return "";

  if (!TOKEN_ROWS.test(tpl)) {
    console.warn(
      "⚠️ Placeholder {{%ROWS%}} not found in in-this-edition-table.mjml",
    );
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

/** -----------------------------
 * Spotlight extraction
 * Rules:
 * - Find <h2> == "Spotlight"
 * - Each <h3> after that is a topic title
 * - Topic content = all following p/ul/ol/img until next h3 or next h2
 * ----------------------------- */
function extractSpotlightTopics(html) {
  const $ = cheerio.load(html);

  const spotlightH2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "spotlight")
    .first();

  if (!spotlightH2.length) return [];

  const topics = [];
  let current = null;

  let el = spotlightH2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();

    if (tag === "h2") break; // end Spotlight section

    if (tag === "h3") {
      if (current) topics.push(current);
      current = { title: cleanText($(el).text()), nodes: [] };
      el = el.next();
      continue;
    }

    if (!current) {
      el = el.next();
      continue;
    }

    if (tag === "p" || tag === "ul" || tag === "ol" || tag === "img") {
      current.nodes.push(el);
    } else if (tag === "div") {
      const children = el.children("p, ul, ol, img");
      if (children.length) {
        children.each((_, child) => current.nodes.push($(child)));
      }
    }

    el = el.next();
  }

  if (current) topics.push(current);
  return topics;
}

/** -----------------------------
 * Spotlight rendering
 * Output:
 * - multiple <mj-section> blocks
 * - first section includes Spotlight heading
 * - later sections do NOT include Spotlight heading
 * ----------------------------- */
function renderSpotlightSections(topics) {
  if (!topics?.length) return "";

  const sectionTpl = fs.readFileSync(SPOTLIGHT_SECTION_TPL_PATH, "utf8");

  const spotlightHeaderBlock = getSpotlightHeaderMjml();

  return topics
    .map((topic, idx) => {
      const header =
        idx === 0 ? spotlightHeaderBlock : '<mj-spacer height="10px" />';

      const topicMjml = renderSpotlightTopic(topic);

      // Fill spotlight section template
      let out = sectionTpl;

      if (!TOKEN_SPOTLIGHT_HEADER.test(out)) {
        console.warn(
          "⚠️ {{%SPOTLIGHT_HEADER%}} not found in spotlight.mjml template",
        );
      }
      if (!TOKEN_SPOTLIGHT_TOPIC.test(out)) {
        console.warn(
          "⚠️ {{%SPOTLIGHT_TOPIC%}} not found in spotlight.mjml template",
        );
      }

      out = out.replace(TOKEN_SPOTLIGHT_HEADER, header);
      out = out.replace(TOKEN_SPOTLIGHT_TOPIC, topicMjml);

      return out.trim();
    })
    .join('\n\n<mj-spacer height="10px" />\n\n');
}

function getSpotlightHeaderMjml() {
  return `
<mj-text
  padding="16px 12px 10px 12px"
  font-family="TNYAdobeCaslonPro, 'Times New Roman', serif;"
  color="white"
>
  <h2
    style="
      padding-bottom: 8px;
      color: #4d3060;
      text-align: left;
      border-bottom: 2px solid #4d3060;

      font-size: 26px;
      line-height: 1.2;
      font-weight: 400;
    "
  >
    Spotlight
  </h2>
</mj-text>`.trim();
}

function renderSpotlightTopic(topic) {
  const title = escapeHtml(cleanText(topic.title));

  const titleBlock = `
<mj-text padding="10px 12px" font-family="TNYAdobeCaslonPro, 'Times New Roman', serif;" color="#000000">
  <h2 style="font-size: 24px; line-height: 1.2; font-weight: 400; margin-top: 2px !important;">
    ${title}
  </h2>
</mj-text>`.trim();

  // ✅ Option A: always include image placeholder
  const imageBlock = `
<mj-image
  border-radius="10px"
  padding="10px 12px"
  width="600px"
  src="https://www.presidentialsummary.com/email/images/REPLACE_ME.jpg"
  alt="${title}"
  href="https://www.presidentialsummary.com/"
/>`.trim();

  // Render content (ignore img tags if any appear)
  const bodyHtml = renderSpotlightBodyHtml(
    topic.nodes.filter((n) => (n[0]?.tagName || "").toLowerCase() !== "img"),
  );

  const bodyBlock = bodyHtml
    ? `
<mj-text padding="10px 12px" font-family="Roboto+Serif" color="#000000">
  ${bodyHtml}
</mj-text>`.trim()
    : "";

  return [titleBlock, imageBlock, bodyBlock].filter(Boolean).join("\n");
}

function renderSpotlightBodyHtml(nodes) {
  const parts = [];

  for (const node of nodes) {
    const tag = (node[0]?.tagName || "").toLowerCase();

    if (tag === "p") {
      const inner = sanitizeInlineHtml(node.html() || "");

      // ✅ Skip empty paragraphs
      if (isEmptyRichText(inner)) continue;

      parts.push(`<p style="font-size: 16px; line-height: 1.5">${inner}</p>`);
    } else if (tag === "ul" || tag === "ol") {
      const chunk = cheerio.load("<root></root>", null, false);
      chunk("root").append(node.clone());
      rewriteAnchors(chunk);

      let listHtml = chunk("root").children().first().toString();

      listHtml = listHtml
        .replace("<ul", '<ul style="margin: 0 0 10px 18px; padding: 0"')
        .replace("<ol", '<ol style="margin: 0 0 10px 18px; padding: 0"')
        .replace(
          /<li>/g,
          '<li style="font-size: 16px; line-height: 1.5; margin-bottom: 6px;">',
        );

      // also skip empty lists (rare)
      if (!listHtml.replace(/&nbsp;|\s+/g, "").includes("<li")) continue;

      parts.push(listHtml);
    }
  }

  return parts.join("\n");
}

/** Keep strong/em/i + rewrite links to your anchor style */
function sanitizeInlineHtml(html) {
  const $ = cheerio.load(`<root>${html}</root>`, null, false);

  rewriteAnchors($);

  const allowed = new Set(["strong", "b", "em", "i", "a", "br"]);
  $("root")
    .find("*")
    .each((_, el) => {
      const tag = (el.tagName || "").toLowerCase();
      if (!allowed.has(tag)) {
        $(el).replaceWith($(el).text());
      }
    });

  return $("root").html()?.trim() || "";
}

function rewriteAnchors($) {
  $("a").each((_, a) => {
    $(a).attr("target", "_blank");
    $(a).attr(
      "style",
      `
                text-decoration: none;
                border-bottom: 2px solid #4d3060;
                color: black;
              `.trim(),
    );
  });
}

function isEmptyRichText(html) {
  const t = (html || "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, "")
    .replace(/\s+/g, "")
    .trim();
  return t.length === 0;
}

/** -----------------------------
 * Utils
 * ----------------------------- */
function cleanText(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

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
