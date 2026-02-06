/**
 * build-presidential-summary.js
 * -----------------------------
 * DOCX -> Mammoth HTML -> extract sections -> render MJML -> compile to HTML
 *
 * Usage:
 *   node build.js "docx/presidential-summary/2026/feb/feb-5.docx"
 *   (build.js dispatcher will call this file)
 *
 * Requirements:
 *   npm i mjml mammoth cheerio
 *
 * Templates expected:
 *   mjml-template/presidential-summary/layout.mjml
 *   mjml-template/presidential-summary/in-this-edition-table.mjml   (has {{%ROWS%}})
 *   mjml-template/presidential-summary/spotlight.mjml               (has {{%SPOTLIGHT_HEADER%}} + {{%SPOTLIGHT_TOPIC%}})
 *   mjml-template/presidential-summary/long-story-short.mjml        (optional, can have {{%SUBTOPIC_BLOCKS%}})
 *
 * Layout tokens expected:
 *   {{%IN_THIS_EDITION_TABLE%}}
 *   {{%SPOTLIGHT_SECTIONS%}}
 *   {{%LONG_STORY_SHORT_SECTIONS%}}
 *   {{%FOOTER_BANNER%}}
 *   {{%IMAGE_CREDITS%}}
 *   {{%PREVIEW_TEXT%}}
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
const NEWSLETTER = "presidential-summary";

const TEMPLATE_DIR = path.join(ROOT, "mjml-template", NEWSLETTER);

const LAYOUT_PATH = path.join(TEMPLATE_DIR, "layout.mjml");
const IN_THIS_EDITION_TPL_PATH = path.join(
  TEMPLATE_DIR,
  "in-this-edition-table.mjml",
);
const SPOTLIGHT_SECTION_TPL_PATH = path.join(TEMPLATE_DIR, "spotlight.mjml");

// Optional wrapper template for LSS blocks
const LSS_TPL_PATH = path.join(TEMPLATE_DIR, "long-story-short.mjml");

/** -----------------------------
 * TOKENS (spaces tolerated)
 * ----------------------------- */
const TOKEN_IN_THIS_EDITION = /\{\{\%\s*IN_THIS_EDITION_TABLE\s*\%\}\}/g;
const TOKEN_ROWS = /\{\{\%\s*ROWS\s*\%\}\}/g;

const TOKEN_SPOTLIGHT_SECTIONS = /\{\{\%\s*SPOTLIGHT_SECTIONS\s*\%\}\}/g;
const TOKEN_SPOTLIGHT_HEADER = /\{\{\%\s*SPOTLIGHT_HEADER\s*\%\}\}/g;
const TOKEN_SPOTLIGHT_TOPIC = /\{\{\%\s*SPOTLIGHT_TOPIC\s*\%\}\}/g;

const TOKEN_LSS_SECTIONS = /\{\{\%\s*LONG_STORY_SHORT_SECTIONS\s*\%\}\}/g;
const TOKEN_LSS_SUBTOPIC_BLOCKS = /\{\{\%\s*SUBTOPIC_BLOCKS\s*\%\}\}/g;

const TOKEN_FOOTER_BANNER = /\{\{\%\s*FOOTER_BANNER\s*\%\}\}/g;
const TOKEN_IMAGE_CREDITS = /\{\{\%\s*IMAGE_CREDITS\s*\%\}\}/g;
const TOKEN_PREVIEW_TEXT = /\{\{\%\s*PREVIEW_TEXT\s*\%\}\}/g;

// ✅ Insert between Spotlight #1 and #2
const SPOTLIGHT_PRIMARY_AD_MJML = `
<mj-spacer height="10px" />
<mj-section
  background-color="#eff1f4"
  css-class="border-line"
  padding="1px 0.5px 1px 1px"
  border-radius="5px"
>
  <mj-raw>
    <a href=""
    target="_blank" style="color:black">
  </mj-raw>

  <mj-column background-color="#fff" border-radius="5px" padding="0px">
    <mj-spacer height="14px" />

    <mj-text
      padding="2px 12px 0px 12px"
      font-family="TNYAdobeCaslonPro, 'Times New Roman', serif;"
      color="white"
    >
      <h2
        style="
          padding-bottom: 8px;
          color: #4d3060;
          text-align: left;
          letter-spacing: 1px;
          border-bottom: 2px solid #4d3060;
          font-size: 26px;
          line-height: 1.2;
          font-weight: 300;
        "
      >
        This could be your business
      </h2>
    </mj-text>

    <mj-spacer height="12px" />

    <mj-image
      border-radius="10px"
      padding="10px 12px 14px 12px"
      width="600px"
      src="https://www.presidentialsummary.com/email/ad/REPLACE_ME.jpg"
      alt="Advertise your business to an engaged, influential audience"
    />

    <mj-text
      padding="10px 12px 0px 12px"
      font-family="Roboto+Serif"
      color="#000000"
    >
      <p style="font-size: 16px; line-height: 24px">
        Reach a wide audience of engaged, loyal readers right where they’re
        paying attention. Our audience is educated, influential, and ready
        to respond.
      </p>
      <p style="font-size: 16px; line-height: 24px">
        Whether you want to drive revenue, build awareness, or launch
        something fresh, this is your spot. Secure your placement and get in
        front of the right eyes.
      </p>
    </mj-text>

    <mj-text
      padding="10px 12px 0px 12px"
      font-family="Roboto+Serif"
      color="#000000"
    >
      <p style="font-size: 16px; line-height: 24px">
        <a
          style="
            text-decoration: none;
            border-bottom: 2px solid #4d3060;
            color: black;
          "
        ><strong>Partner with us</strong></a>
      </p>
    </mj-text>

    <mj-spacer height="15px" />
  </mj-column>

  <mj-raw></a></mj-raw>
</mj-section>


`.trim();

/** -----------------------------
 * MAIN
 * ----------------------------- */
main().catch((e) => {
  console.error("❌ Build failed:", e);
  process.exit(1);
});

async function main() {
  if (!DOCX_PATH)
    throw new Error(
      `Usage: node build.js "docx/${NEWSLETTER}/YYYY/mon/file.docx"`,
    );
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

  // ✅ derive output paths from DOCX path:
  // docx/presidential-summary/2026/feb/feb-5.docx
  // -> dist/presidential-summary/2026/feb/feb-5.mjml + .html
  const { outDir, outMjmlPath, outHtmlPath } = deriveOutputPaths({
    root: ROOT,
    docxPath: DOCX_PATH,
    expectedNewsletter: NEWSLETTER,
  });

  ensureDir(outDir);

  // 1) DOCX -> HTML (include images as <img src="data:...">)
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

  // 4) Long story short
  const lss = extractLongStoryShort(docHtml);
  const lssMjml = renderLongStoryShortSections(lss);
  console.log(
    "🧩 LSS subtopics:",
    (lss || []).map((s) => s.title),
  );

  // 5) Footer banner
  const footerBanner = extractFooterBanner(docHtml);
  console.log("🧩 Footer banner found:", footerBanner ? "YES" : "NO");

  // 6) Image credits + Preview text (from DOCX H2 sections)
  const imageCredits = extractSingleParagraphAfterH2(docHtml, "image credits");
  const previewText = extractSingleParagraphAfterH2(docHtml, "preview text");

  console.log("🧩 Image credits found:", imageCredits ? "YES" : "NO");
  console.log("🧩 Preview text found:", previewText ? "YES" : "NO");

  // 7) Inject into layout
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
  if (!TOKEN_LSS_SECTIONS.test(layoutMjml)) {
    console.warn(
      "⚠️ Placeholder {{%LONG_STORY_SHORT_SECTIONS%}} not found in layout.mjml",
    );
  }
  if (!TOKEN_FOOTER_BANNER.test(layoutMjml)) {
    console.warn("⚠️ Placeholder {{%FOOTER_BANNER%}} not found in layout.mjml");
  }
  if (!TOKEN_IMAGE_CREDITS.test(layoutMjml)) {
    console.warn("⚠️ Placeholder {{%IMAGE_CREDITS%}} not found in layout.mjml");
  }
  if (!TOKEN_PREVIEW_TEXT.test(layoutMjml)) {
    console.warn("⚠️ Placeholder {{%PREVIEW_TEXT%}} not found in layout.mjml");
  }

  const finalMjml = layoutMjml
    .replace(TOKEN_IN_THIS_EDITION, inThisEditionMjml)
    .replace(TOKEN_SPOTLIGHT_SECTIONS, spotlightSectionsMjml)
    .replace(TOKEN_LSS_SECTIONS, lssMjml)
    .replace(TOKEN_FOOTER_BANNER, footerBanner || "")
    .replace(TOKEN_IMAGE_CREDITS, escapeHtml(imageCredits || ""))
    .replace(TOKEN_PREVIEW_TEXT, escapeHtml(previewText || ""));

  // 8) Compile MJML -> HTML
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

/** -----------------------------
 * Output paths
 * ----------------------------- */
function deriveOutputPaths({ root, docxPath, expectedNewsletter }) {
  const abs = path.isAbsolute(docxPath) ? docxPath : path.join(root, docxPath);
  const rel = path.relative(root, abs);
  const parts = rel.split(path.sep);

  // Expect: docx/<newsletter>/<year>/<month>/<file>.docx
  if (parts.length < 5 || parts[0] !== "docx") {
    throw new Error(
      `Invalid DOCX path. Expected: docx/${expectedNewsletter}/YYYY/mon/file.docx\nGot: ${docxPath}`,
    );
  }

  const newsletter = parts[1];
  const year = parts[2];
  const month = parts[3];
  const file = parts[4];

  if (newsletter !== expectedNewsletter) {
    throw new Error(
      `This builder is for "${expectedNewsletter}" but DOCX path is for "${newsletter}".`,
    );
  }

  const baseName = path.basename(file, path.extname(file));
  const outDir = path.join(root, "dist", newsletter, year, month);

  return {
    outDir,
    outMjmlPath: path.join(outDir, `${baseName}.mjml`),
    outHtmlPath: path.join(outDir, `${baseName}.html`),
  };
}

/** -----------------------------
 * In this edition
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
 * Spotlight
 * Rules:
 * - Find <h2> == "Spotlight"
 * - Each <h3> after that is a topic title
 * - Topic content = p/ul/ol/img until next h3 or next h2
 * Output:
 * - Multiple template blocks (spotlight.mjml)
 * - First section includes Spotlight heading, others don't
 * - Always includes image placeholder
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

    if (tag === "h2") break;

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

function renderSpotlightSections(topics) {
  if (!topics?.length) return "";

  const sectionTpl = fs.readFileSync(SPOTLIGHT_SECTION_TPL_PATH, "utf8");
  const spotlightHeaderBlock = getSpotlightHeaderMjml();

  const outParts = [];

  topics.forEach((topic, idx) => {
    const header =
      idx === 0 ? spotlightHeaderBlock : '<mj-spacer height="10px" />';

    const topicMjml = renderSpotlightTopic(topic);

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

    outParts.push(out.trim());

    // ✅ Insert Primary Ad between Spotlight #1 and #2
    if (idx === 0 && topics.length > 1) {
      outParts.push(SPOTLIGHT_PRIMARY_AD_MJML);
    }

    // existing spacing between spotlight blocks (keep)
    if (idx < topics.length - 1) {
      outParts.push('<mj-spacer height="10px" />');
    }
  });

  return outParts.join("\n\n");
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

  const imageBlock = `
<mj-image
  border-radius="10px"
  padding="10px 12px"
  width="600px"
  src="https://www.presidentialsummary.com/email/images/REPLACE_ME.jpg"
  alt="${title}"
  href="https://www.presidentialsummary.com/"
/>`.trim();

  const bodyHtml = renderBodyHtml(
    topic.nodes.filter((n) => (n[0]?.tagName || "").toLowerCase() !== "img"),
    {
      pStyle: "font-size: 16px; line-height: 1.5",
      wrapP: true,
    },
  );

  const bodyBlock = bodyHtml
    ? `
<mj-text padding="10px 12px" font-family="Roboto+Serif" color="#000000">
  ${bodyHtml}
</mj-text>`.trim()
    : "";

  return [titleBlock, imageBlock, bodyBlock].filter(Boolean).join("\n");
}

/** -----------------------------
 * Long story short
 * Rules:
 * - Find <h2> == "Long story short"
 * - Each <h3> after that is a subtopic
 * - Subtopic content = p/ul/ol/img until next h3 or next h2
 * Output:
 * - For Science & Tech: ALWAYS include the Gizmo image block after the h3
 * - For other subtopics: include image only if Mammoth found <img>
 * ----------------------------- */
function extractLongStoryShort(html) {
  const $ = cheerio.load(html);

  const lssH2 = $("h2")
    .filter(
      (_, el) => cleanText($(el).text()).toLowerCase() === "long story short",
    )
    .first();

  if (!lssH2.length) return [];

  const sections = [];
  let current = null;
  let el = lssH2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    if (tag === "h2") break;

    if (tag === "h3") {
      if (current) sections.push(current);
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

  if (current) sections.push(current);
  return sections;
}

function renderLongStoryShortSections(subtopics) {
  if (!subtopics?.length) return "";

  const blocks = subtopics
    .map((sub, idx) => renderLssSubtopic(sub, idx, subtopics.length))
    .filter(Boolean)
    .join("\n");

  if (fs.existsSync(LSS_TPL_PATH)) {
    const tpl = fs.readFileSync(LSS_TPL_PATH, "utf8");
    if (TOKEN_LSS_SUBTOPIC_BLOCKS.test(tpl)) {
      return tpl.replace(TOKEN_LSS_SUBTOPIC_BLOCKS, blocks);
    }
    return `${tpl}\n${blocks}`.trim();
  }

  return blocks;
}

function renderLssSubtopic(sub, idx, total) {
  const rawTitle = cleanText(sub.title);
  const title = escapeHtml(rawTitle);

  const h3Block = `
<mj-text
  padding="${idx === 0 ? "14px 12px 0px 12px" : "0px 12px"}"
  font-family="TNYAdobeCaslonPro, 'Times New Roman', serif;"
  color="#000000"
>
  <h3
    style="
      font-size: 24px;
      line-height: 1.2;
      font-weight: 400;
      margin-top: ${idx === 0 ? "1px" : "15px"};
    "
  >
    ${title}
  </h3>
</mj-text>`.trim();

  const isScienceTech = rawTitle.toLowerCase() === "science & tech";

  const docHasImage = (sub.nodes || []).some(
    (n) => (n[0]?.tagName || "").toLowerCase() === "img",
  );

  const imageBlock = isScienceTech
    ? `
<mj-image
  border-radius="10px"
  padding="0px 12px 10px 12px"
  width="600px"
  src="https://www.presidentialsummary.com/email/images/REPLACE_ME.jpg"
  alt="${title}"
  href="https://www.presidentialsummary.com/"
/>`.trim()
    : docHasImage
      ? `
<mj-image
  border-radius="10px"
  padding="0px 12px 10px 12px"
  width="600px"
  src="https://www.presidentialsummary.com/email/images/REPLACE_ME.jpg"
  alt="${title}"
  href="https://www.presidentialsummary.com/"
/>`.trim()
      : "";

  const storyHtml = renderBodyHtml(
    (sub.nodes || []).filter(
      (n) => (n[0]?.tagName || "").toLowerCase() !== "img",
    ),
    {
      wrapP: true,
      pStyle: `
              font-size: 16px;
              line-height: 1.5;
              border-left: 3px solid #4d3060;
              padding-left: 14px;
              margin-bottom: 15px;
            `.trim(),
    },
  );

  const storiesBlock = storyHtml
    ? `
<mj-text padding="0px 12px" font-family="Roboto+Serif" color="#000000">
  ${storyHtml}
</mj-text>`.trim()
    : "";

  const divider =
    idx < total - 1
      ? `
<mj-divider
  border-width="1px"
  border-style="solid"
  border-color="lightgrey"
  padding="0px 12px"
/>`.trim()
      : "";

  return [h3Block, imageBlock, storiesBlock, divider]
    .filter(Boolean)
    .join("\n");
}

/** -----------------------------
 * Footer banner
 * Rules:
 * - Find <h2> == "Footer"
 * - Take subsequent <p> (and <div><p>..) until next <h2> or end
 * - Render inner HTML (no wrapping <p>) for injecting into banner <div>
 * - Rewrite <a> with footer style (white underline)
 * ----------------------------- */
function extractFooterBanner(html) {
  const $ = cheerio.load(html);

  const footerH2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "footer")
    .first();

  if (!footerH2.length) return "";

  const nodes = [];
  let el = footerH2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    if (tag === "h2") break;

    if (tag === "p") {
      nodes.push(el);
    } else if (tag === "div") {
      const children = el.children("p");
      if (children.length) {
        children.each((_, child) => nodes.push($(child)));
      }
    }

    el = el.next();
  }

  return renderFooterBannerHtml(nodes);
}

function renderFooterBannerHtml(nodes) {
  const parts = [];

  for (const node of nodes) {
    const inner = sanitizeInlineHtmlFooter(node.html() || "");
    if (isEmptyRichText(inner)) continue;
    parts.push(inner);
  }

  return parts.join(" ");
}

function sanitizeInlineHtmlFooter(html) {
  const $ = cheerio.load(`<root>${html}</root>`, null, false);
  rewriteFooterAnchors($);

  const allowed = new Set(["strong", "b", "em", "i", "a", "br"]);
  $("root")
    .find("*")
    .each((_, el) => {
      const tag = (el.tagName || "").toLowerCase();
      if (!allowed.has(tag)) {
        $(el).replaceWith($(el).text());
      }
    });

  return normalizeDashes($("root").html()?.trim() || "");
}

function rewriteFooterAnchors($) {
  $("a").each((_, a) => {
    $(a).attr("target", "_blank");
    $(a).attr(
      "style",
      `
                text-decoration: none;
                border-bottom: 2px solid #fff;
                color: white !important;
              `.trim(),
    );
  });
}

/** -----------------------------
 * Extract 1 paragraph after an H2 title
 * Used for:
 * - "Image credits" -> fill {{%IMAGE_CREDITS%}}
 * - "Preview text"  -> fill {{%PREVIEW_TEXT%}}
 * Rules:
 * - Find <h2> whose text matches the given title
 * - Take the first <p> after it (or first <div><p>..)
 * - Return plain text
 * ----------------------------- */
function extractSingleParagraphAfterH2(html, h2TitleLower) {
  const $ = cheerio.load(html);

  const h2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === h2TitleLower)
    .first();

  if (!h2.length) return "";

  let el = h2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    if (tag === "h2") break;

    if (tag === "p") {
      const txt = cleanText(el.text());
      return txt;
    }

    if (tag === "div") {
      const p = el.find("p").first();
      if (p.length) return cleanText(p.text());
    }

    el = el.next();
  }

  return "";
}

/** -----------------------------
 * Shared body rendering with link styles, keep strong/em/i, skip empty p
 * ----------------------------- */
function renderBodyHtml(nodes, { wrapP, pStyle }) {
  const parts = [];

  for (const node of nodes) {
    const tag = (node[0]?.tagName || "").toLowerCase();

    if (tag === "p") {
      const inner = sanitizeInlineHtml(node.html() || "");
      if (isEmptyRichText(inner)) continue;

      if (wrapP) {
        parts.push(`<p style="${pStyle}">${inner}</p>`);
      } else {
        parts.push(inner);
      }
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

      parts.push(listHtml);
    }
  }

  return parts.join("\n");
}

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

  return normalizeDashes($("root").html()?.trim() || "");
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

// Treat "<strong></strong>" etc as empty
function isEmptyRichText(html) {
  const $ = cheerio.load(`<root>${html || ""}</root>`, null, false);
  const text = $("root")
    .text()
    .replace(/\u00A0/g, " ")
    .trim();
  return text.length === 0;
}

/** -----------------------------
 * Utils
 * ----------------------------- */
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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
