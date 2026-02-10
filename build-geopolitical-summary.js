/**
 * build-geopolitical-summary.js (v1.0)
 * -----------------------------------
 * ✅ DOCX -> Mammoth HTML
 * ✅ Extract:
 *   1) In this edition
 *   2) Spotlight (H2 "Spotlight" -> each H3 story)
 *      - Spotlight heading only for the 1st spotlight block
 *      - If italic paragraph exists right after image -> render as caption block
 * ✅ Inject into layout placeholders:
 *   {{%IN_THIS_EDITION_TABLE%}}
 *   {{%SPOTLIGHT_SECTION%}}
 * ✅ Compile MJML -> HTML
 *
 * Usage:
 *   node build-geopolitical-summary.js "docx/geopolitical-summary/2026/feb/feb-6.docx"
 *
 * Requirements:
 *   npm i mjml mammoth cheerio
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

const NEWSLETTER_SLUG = "geopolitical-summary";
const TEMPLATE_DIR = path.join(ROOT, "mjml-template", NEWSLETTER_SLUG);

const LAYOUT_PATH = path.join(TEMPLATE_DIR, "layout.mjml");
const IN_THIS_EDITION_TPL_PATH = path.join(
  TEMPLATE_DIR,
  "in-this-edition-table.mjml",
);

/** -----------------------------
 * TOKENS
 * ----------------------------- */
const TOKEN_IN_THIS_EDITION = /\{\{\%\s*IN_THIS_EDITION_TABLE\s*\%\}\}/g;
const TOKEN_SPOTLIGHT_SECTION = /\{\{\%\s*SPOTLIGHT_SECTION\s*\%\}\}/g;
const TOKEN_ROWS = /\{\{\%\s*ROWS\s*\%\}\}/g;
const TOKEN_WORLDWIDE_SECTION = /\{\{\%\s*WORLDWIDE_SECTION\s*\%\}\}/g;
const TOKEN_FOUNDATIONS_SECTION = /\{\{\%\s*FOUNDATIONS_SECTION\s*\%\}\}/g;
const TOKEN_PREVIEW_TEXT = /\{\{\%\s*PREVIEW_TEXT\s*\%\}\}/g;
const TOKEN_ANALYSIS_SECTION = /\{\{\%\s*ANALYSIS_SECTION\s*\%\}\}/g;

/** -----------------------------
 * MAIN
 * ----------------------------- */
main().catch((e) => {
  console.error("❌ Build failed:", e);
  process.exit(1);
});

async function main() {
  if (!DOCX_PATH) {
    throw new Error(
      'Usage: node build-geopolitical-summary.js "docx/geopolitical-summary/2026/feb/feb-6.docx"',
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

  // 2) In this edition
  const editionItems = extractInThisEditionGS(docHtml);
  console.log("🧩 In this edition items:", editionItems);
  const inThisEditionMjml = renderInThisEditionFromTemplate(editionItems);

  // 3) Spotlight
  const spotlightStories = extractSpotlightGS(docHtml);
  console.log(
    "🧩 Spotlight stories:",
    spotlightStories.map((s) => s.title),
  );
  const spotlightMjml = renderSpotlightGS(spotlightStories);

  const analysisItems = extractAnalysisGS(docHtml);
  const analysisHtml = renderAnalysisGS(analysisItems);
  console.log("🧩 Analysis items:", analysisItems.length);

  // ✅ 4) Worldwide (compute BEFORE replace)
  const worldwideItems = extractWorldwideGS(docHtml);
  const worldwideHtml = renderWorldwideGS(worldwideItems);
  console.log("🧩 Worldwide items:", worldwideItems.length);

  // ✅ 5) Foundations
  const foundationsItems = extractFoundationsGS(docHtml);
  const foundationsMjml = renderFoundationsGS(foundationsItems);
  console.log("🧩 Foundations items:", foundationsItems.length);

  const previewTextHtml = extractPreviewTextGS(docHtml);
  console.log("🧩 Preview text:", cleanText(previewTextHtml));

  // ✅ Inject into layout
  let finalMjml = fs.readFileSync(LAYOUT_PATH, "utf8");

  if (!hasToken(TOKEN_PREVIEW_TEXT, finalMjml)) {
    console.warn("⚠️ Token {{%PREVIEW_TEXT%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_PREVIEW_TEXT, previewTextHtml || "");

  if (!hasToken(TOKEN_IN_THIS_EDITION, finalMjml)) {
    console.warn(
      "⚠️ Token {{%IN_THIS_EDITION_TABLE%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_IN_THIS_EDITION, inThisEditionMjml);

  if (!hasToken(TOKEN_SPOTLIGHT_SECTION, finalMjml)) {
    console.warn("⚠️ Token {{%SPOTLIGHT_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_SPOTLIGHT_SECTION, spotlightMjml);

  if (!hasToken(TOKEN_WORLDWIDE_SECTION, finalMjml)) {
    console.warn("⚠️ Token {{%WORLDWIDE_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_WORLDWIDE_SECTION, worldwideHtml);

  if (!hasToken(TOKEN_FOUNDATIONS_SECTION, finalMjml)) {
    console.warn("⚠️ Token {{%FOUNDATIONS_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_FOUNDATIONS_SECTION, foundationsMjml);

  if (!hasToken(TOKEN_ANALYSIS_SECTION, finalMjml)) {
    console.warn("⚠️ Token {{%ANALYSIS_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_ANALYSIS_SECTION, analysisHtml || "");

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

/** -----------------------------
 * Output path mirroring
 * ----------------------------- */
function computeOutPaths(docxPath) {
  const abs = path.resolve(docxPath);

  const docxRoot = path.join(ROOT, "docx");
  const distRoot = path.join(ROOT, "dist");

  const rel = path.relative(docxRoot, abs); // geopolitical-summary/2026/feb/feb-6.docx
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
 * In this edition (GS)
 * ----------------------------- */
function extractInThisEditionGS(html) {
  const $ = cheerio.load(html);

  // Find a marker line like "In this edition:" (usually a paragraph)
  const marker = $("p, h1, h2, h3, div")
    .filter((_, el) => {
      const t = cleanText($(el).text()).toLowerCase();
      return t === "in this edition:" || t.startsWith("in this edition:");
    })
    .first();

  if (!marker.length) return [];

  // If list exists right after
  let ul = marker.nextAll("ul").first();
  if (!ul.length) ul = marker.nextAll().find("ul").first();

  if (ul.length) {
    return ul
      .find("li")
      .map((_, li) => cleanText($(li).text()))
      .get()
      .filter(Boolean);
  }

  // Otherwise, collect subsequent paragraphs until next H2 (or "Spotlight")
  const items = [];
  let el = marker.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());
    const lower = txt.toLowerCase();

    if (tag === "h2" && txt) break;
    if (tag === "h2" && lower === "spotlight") break;

    if (tag === "p") {
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

  // Clean common empties
  return items.map((x) => x.replace(/\u00A0/g, " ").trim()).filter(Boolean);
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

/** -----------------------------
 * Spotlight extraction (GS)
 * Rule:
 * - Find H2 "Spotlight"
 * - Each H3 = story title
 * - story nodes = everything until next H3 or next H2
 * ----------------------------- */
function extractSpotlightGS(html) {
  const $ = cheerio.load(html);

  const spotH2 = $("h2")
    .filter(
      (_, el) =>
        cleanText($(el).text()).toLowerCase() === "spotlights" ||
        cleanText($(el).text()).toLowerCase() === "spotlight",
    )
    .first();

  if (!spotH2.length) return [];

  const stories = [];
  let current = null;
  let el = spotH2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    if (tag === "h2" && txt) break;

    if (tag === "h3" && txt) {
      if (current) stories.push(current);
      current = { title: txt, nodes: [] };
      el = el.next();
      continue;
    }

    if (!current) {
      el = el.next();
      continue;
    }

    // Collect paragraphs, lists, and also standalone images
    if (tag === "p" || tag === "ul" || tag === "ol" || tag === "img") {
      current.nodes.push(el);
    } else if (tag === "div") {
      const children = el.children("p, ul, ol, img");
      if (children.length) children.each((_, c) => current.nodes.push($(c)));
    }

    el = el.next();
  }

  if (current) stories.push(current);

  // Keep stories even if the body is empty, but usually you want content
  return stories.filter((s) => s.title);
}

/** -----------------------------
 * Spotlight renderer (GS)
 * - Spotlight heading only on first spotlight
 * - If italic paragraph right after image -> render caption style
 * ----------------------------- */
function renderSpotlightGS(stories) {
  if (!stories?.length) return "";

  const SPOTLIGHT_HEADING = `
<mj-text
  padding="16px 12px 10px 12px "
  font-family="TNYAdobeCaslonPro, 'Times New Roman', serif;"
  color="white"
>
  <h2
    style="
      padding-bottom: 8px;
      color: #06266d;
      text-align: left;
      border-bottom: 2px solid #06266d;
      font-size: 26px;
      line-height: 1.2;
      font-weight: 300;
      margin: 0;
    "
  >
    Spotlight
  </h2>
</mj-text>
`.trim();

  // ✅ Insert this after Spotlight #1 (between #1 and #2)
  const AD_BLOCK = `
<mj-section
  background-color="#eff1f4"
  css-class="border-line"
  padding="1px 0.5px 1px 1px"
  border-radius="5px"
>
  <mj-raw>
    <a href="REPLACE_ME"
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
          color: #06266d;
          text-align: left;
          letter-spacing: 1px;
          border-bottom: 2px solid #06266d;
          font-size: 26px;
          line-height: 1.2;
          font-weight: 300;
          margin: 0;
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
      src="https://www.geopoliticalsummary.com/email/ad/REPLACE_ME.jpg"
      alt="campaign-x-2"
    />
    <mj-text
      padding="10px 12px 0px 12px"
      font-family="Roboto+Serif"
      color="#000000"
    >
      <p style="font-size: 16px; line-height: 24px; margin: 0 0 10px 0;">
        Reach a wide audience of engaged, loyal readers right where they’re
        paying attention. Our audience is educated, influential, and ready to
        respond.
      </p>
      <p style="font-size: 16px; line-height: 24px; margin: 0;">
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
      <p style="font-size: 16px; line-height: 24px; margin: 0;">
        <a
          style="
            text-decoration: none;
            border-bottom: 2px solid #06266d;
            color: black;
          "
        ><strong>Partner with us</strong></a>
      </p>
    </mj-text>
    <mj-spacer height="15px" />
  </mj-column>
  <mj-raw> </a> </mj-raw>
</mj-section>
<mj-spacer height="10px" />
`.trim();

  const blocks = stories.map((story, idx) => {
    const title = escapeHtml(cleanText(story.title || ""));
    const parsed = parseSpotlightNodesGS(story.nodes || []);

    const titleBlock = `
<mj-text
  padding="10px 12px"
  font-family="TNYAdobeCaslonPro, 'Times New Roman', serif;"
  color="#000000"
>
  <h2
    style="
      font-size: 24px;
      line-height: 1.2;
      font-weight: 500;
      margin-top: 2px !important;
      margin: 0;
    "
  >
    ${title}
  </h2>
</mj-text>
`.trim();

    const imageBlock = parsed.image
      ? `
<mj-image
  border-radius="10px"
  padding="10px 12px"
  width="600px"
  src="https://www.geopoliticalsummary.com/email/images/REPLACE_ME.jpg"
  alt="REPLACE_ME"
  target="_blank"
/>
`.trim()
      : "";

    // ✅ caption only when there is italic paragraph right after image
    const captionBlock = parsed.captionHtml
      ? `
<mj-text padding="0px 12px" font-family="Roboto+Serif" color="#A9A7AF">
  <p style="font-size: 12px; line-height: 1.2; color: #a9a7af; margin: 0;">
    <i>${parsed.captionHtml}</i>
  </p>
</mj-text>
`.trim()
      : "";

    const bodyBlock = parsed.bodyHtml
      ? `
<mj-text padding="10px 12px" font-family="Roboto+Serif" color="#000000">
  ${parsed.bodyHtml}
</mj-text>
`.trim()
      : "";

    const spotlightBlock = `
<mj-section background-color="#eff1f4" padding="1px 0.5px 1px 1px" border-radius="5px">
  <mj-column background-color="#fff" border-radius="5px" padding="0px">
    ${idx === 0 ? SPOTLIGHT_HEADING : ""}
    ${titleBlock}
    ${imageBlock}
    ${captionBlock}
    ${bodyBlock}
  </mj-column>
</mj-section>
<mj-spacer height="10px" />
`.trim();

    // ✅ Insert AD after first spotlight
    if (idx === 0 && stories.length > 1)
      return `${spotlightBlock}\n${AD_BLOCK}`;

    return spotlightBlock;
  });

  return blocks.join("\n\n");
}

/**
 * Parse story nodes into:
 * - image (first img found)
 * - caption (first italic paragraph right after image)
 * - bodyHtml (remaining paragraphs/lists)
 */
function parseSpotlightNodesGS(nodes) {
  const parts = {
    image: null, // {src, alt, href?}
    captionHtml: "",
    bodyHtml: "",
  };

  // Flatten nodes into a simple sequence (as cheerio nodes)
  const seq = (nodes || []).filter(Boolean);

  // 1) Find first image occurrence (either <img> node or <p><img/></p>)
  let imgIndex = -1;
  for (let i = 0; i < seq.length; i++) {
    const node = seq[i];
    const tag = (node[0]?.tagName || "").toLowerCase();

    if (tag === "img") {
      const src = node.attr("src") || "";
      const alt = node.attr("alt") || "";
      parts.image = { src, alt, href: "" };
      imgIndex = i;
      break;
    }

    if (tag === "p") {
      const $p = cheerio.load(`<root>${node.html() || ""}</root>`, null, false);
      const img = $p("img").first();
      if (img.length) {
        parts.image = {
          src: img.attr("src") || "",
          alt: img.attr("alt") || "",
          href: "",
        };
        imgIndex = i;
        break;
      }
    }
  }

  // 2) Detect caption paragraph: immediately after image, paragraph that is basically italic
  let captionIndex = -1;
  if (imgIndex >= 0 && imgIndex + 1 < seq.length) {
    const next = seq[imgIndex + 1];
    const tag = (next[0]?.tagName || "").toLowerCase();
    if (tag === "p") {
      const raw = next.html() || "";
      const $ = cheerio.load(`<root>${raw}</root>`, null, false);

      // If it contains only <em>/<i> (or mostly italic text), treat as caption
      const hasItalic = $("em, i").length > 0;
      const plain = cleanText($("root").text());
      const hasOtherBlocks =
        $("root").find("strong,b,ul,ol,h1,h2,h3,img").length > 0;

      if (hasItalic && plain && !hasOtherBlocks) {
        // Use inner text only (keep links styled if any exist)
        rewriteAnchorsGS($);
        parts.captionHtml = sanitizeInlineHtmlGS($("root").html() || "");
        captionIndex = imgIndex + 1;
      }
    }
  }

  // 3) Build body HTML from remaining nodes (skip image node and caption node)
  const bodyParts = [];
  for (let i = 0; i < seq.length; i++) {
    if (i === imgIndex) continue;
    if (i === captionIndex) continue;

    const node = seq[i];
    const tag = (node[0]?.tagName || "").toLowerCase();

    if (tag === "p") {
      const inner = sanitizeInlineHtmlGS(node.html() || "");
      if (isEmptyRichText(inner)) continue;
      bodyParts.push(
        `<p style="font-size: 16px; line-height: 1.5; margin: 0 0 10px 0;">${inner}</p>`,
      );
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const chunk = cheerio.load("<root></root>", null, false);
      chunk("root").append(node.clone());
      rewriteAnchorsGS(chunk);

      let listHtml = chunk("root").children().first().toString();
      listHtml = listHtml
        .replace("<ul", '<ul style="margin: 10px 0 0 18px; padding: 0"')
        .replace("<ol", '<ol style="margin: 10px 0 0 18px; padding: 0"')
        .replace(
          /<li>/g,
          '<li style="font-size: 16px; line-height: 1.5; margin-bottom: 6px;">',
        );

      bodyParts.push(listHtml);
    }
  }

  parts.bodyHtml = bodyParts.join("\n");
  return parts;
}

function extractWorldwideGS(html) {
  const $ = cheerio.load(html);

  const worldH2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "worldwide")
    .first();

  if (!worldH2.length) return [];

  const items = [];
  let el = worldH2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    if (tag === "h2" && txt) break;

    if (tag === "p") {
      const inner = sanitizeInlineHtmlGS(el.html() || "");
      if (!isEmptyRichText(inner)) items.push(inner);
    } else if (tag === "div") {
      const ps = el.children("p");
      if (ps.length) {
        ps.each((_, p) => {
          const inner = sanitizeInlineHtmlGS($(p).html() || "");
          if (!isEmptyRichText(inner)) items.push(inner);
        });
      }
    }

    el = el.next();
  }

  return items;
}
function renderWorldwideGS(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return "";

  return list
    .map((innerHtml) =>
      `
<p
  style="
    font-size: 16px;
    line-height: 1.5;
    padding-top: 0px;
    padding-bottom: 6px;
    margin: 0 0 10px 0;
  "
>
  ${innerHtml}
</p>`.trim(),
    )
    .join("\n");
}

function extractFoundationsGS(html) {
  const $ = cheerio.load(html);

  const h2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "foundations")
    .first();

  if (!h2.length) return [];

  const items = [];
  let current = null;
  let el = h2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    if (tag === "h2" && txt) break;

    if (tag === "h3" && txt) {
      if (current) items.push(current);
      current = { title: txt, nodes: [] };
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
      if (children.length) children.each((_, c) => current.nodes.push($(c)));
    }

    el = el.next();
  }

  if (current) items.push(current);

  return items.filter((x) => x.title);
}
function renderFoundationsGS(items) {
  if (!items?.length) return "";

  return items
    .map((item) => {
      const title = escapeHtml(cleanText(item.title || ""));
      const parsed = parseFoundationNodesGS(item.nodes || []);

      const titleBlock = `
<mj-text
  padding="10px 12px"
  font-family="TNYAdobeCaslonPro, 'Times New Roman', serif;"
  color="#000000"
>
  <h2 style="font-size: 24px; line-height: 1.2; font-weight: 500; margin: 0;">
    ${title}
  </h2>
</mj-text>
`.trim();

      const imageBlock = parsed.image
        ? `
<mj-image
  border="1px solid #00000013"
  border-radius="10px"
  padding="10px 12px"
  width="600px"
  src="https://www.geopoliticalsummary.com/email/images/REPLACE_ME.jpg"
  alt="REPLACE_ME"
  href="https://www.geopoliticalsummary.com/"
/>
`.trim()
        : "";

      const captionBlock = parsed.captionHtml
        ? `
<mj-text padding="0px 12px" font-family="Roboto+Serif" color="#A9A7AF">
  <p style="font-size: 12px; line-height: 1.2; color: #a9a7af; margin: 0;">
    <i>${parsed.captionHtml}</i>
  </p>
</mj-text>
`.trim()
        : "";

      const bodyBlock = parsed.bodyHtml
        ? `
<mj-text padding="10px 12px" font-family="Roboto+Serif" color="#000000">
  ${parsed.bodyHtml}
</mj-text>
`.trim()
        : "";

      return `
${titleBlock}
${imageBlock}
${captionBlock}
${bodyBlock}
`.trim();
    })
    .join("\n\n");
}

function parseFoundationNodesGS(nodes) {
  const parts = { image: null, captionHtml: "", bodyHtml: "" };
  const seq = (nodes || []).filter(Boolean);

  // Find first image
  let imgIndex = -1;
  for (let i = 0; i < seq.length; i++) {
    const node = seq[i];
    const tag = (node[0]?.tagName || "").toLowerCase();

    if (tag === "img") {
      parts.image = {
        src: node.attr("src") || "",
        alt: node.attr("alt") || "",
        href: "",
      };
      imgIndex = i;
      break;
    }

    if (tag === "p") {
      const $p = cheerio.load(`<root>${node.html() || ""}</root>`, null, false);
      const img = $p("img").first();
      if (img.length) {
        parts.image = {
          src: img.attr("src") || "",
          alt: img.attr("alt") || "",
          href: "",
        };
        imgIndex = i;
        break;
      }
    }
  }

  // Caption if italic paragraph immediately after image
  let captionIndex = -1;
  if (imgIndex >= 0 && imgIndex + 1 < seq.length) {
    const next = seq[imgIndex + 1];
    const tag = (next[0]?.tagName || "").toLowerCase();
    if (tag === "p") {
      const raw = next.html() || "";
      const $ = cheerio.load(`<root>${raw}</root>`, null, false);

      const hasItalic = $("em, i").length > 0;
      const plain = cleanText($("root").text());
      const hasOtherBlocks =
        $("root").find("strong,b,ul,ol,h1,h2,h3,img").length > 0;

      if (hasItalic && plain && !hasOtherBlocks) {
        rewriteAnchorsGS($);
        parts.captionHtml = sanitizeInlineHtmlGS($("root").html() || "");
        captionIndex = imgIndex + 1;
      }
    }
  }

  // Body
  const bodyParts = [];
  for (let i = 0; i < seq.length; i++) {
    if (i === imgIndex) continue;
    if (i === captionIndex) continue;

    const node = seq[i];
    const tag = (node[0]?.tagName || "").toLowerCase();

    if (tag === "p") {
      const inner = sanitizeInlineHtmlGS(node.html() || "");
      if (isEmptyRichText(inner)) continue;
      bodyParts.push(
        `<p style="font-size: 16px; line-height: 1.5; margin: 0 0 10px 0;">${inner}</p>`,
      );
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const chunk = cheerio.load("<root></root>", null, false);
      chunk("root").append(node.clone());
      rewriteAnchorsGS(chunk);

      let listHtml = chunk("root").children().first().toString();
      listHtml = listHtml
        .replace("<ul", '<ul style="margin: 10px 0 0 18px; padding: 0"')
        .replace("<ol", '<ol style="margin: 10px 0 0 18px; padding: 0"')
        .replace(
          /<li>/g,
          '<li style="font-size: 16px; line-height: 1.5; margin-bottom: 6px;">',
        );

      bodyParts.push(listHtml);
    }
  }

  parts.bodyHtml = bodyParts.join("\n");
  return parts;
}
function extractPreviewTextGS(html) {
  const $ = cheerio.load(html);

  // Find H2 exactly "Preview text"
  const h2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "preview text")
    .first();

  if (!h2.length) return "";

  // Usually the value is the first <p> after it
  let p = h2.nextAll("p").first();
  if (!p.length) p = h2.nextAll().find("p").first();

  if (!p.length) return "";

  // Preserve inline formatting + links (and apply your link style)
  const inner = sanitizeInlineHtmlGS(p.html() || "");
  return inner;
}

function extractAnalysisGS(html) {
  const $ = cheerio.load(html);

  const h2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "analysis")
    .first();

  if (!h2.length) return [];

  const items = [];
  let current = null;
  let el = h2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    // stop when next section starts
    if (tag === "h2" && txt) break;

    // each H3 is a new analysis story
    if (tag === "h3" && txt) {
      if (current) items.push(current);
      current = { title: txt, nodes: [] };
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
      if (children.length) children.each((_, c) => current.nodes.push($(c)));
    }

    el = el.next();
  }

  if (current) items.push(current);

  return items.filter((x) => x.title);
}

function renderAnalysisGS(items) {
  if (!items?.length) return "";

  return items
    .map((item) => {
      const title = escapeHtml(cleanText(item.title || ""));
      const parsed = parseAnalysisNodesGS(item.nodes || []);

      const titleHtml = `
<h2 style="font-size: 24px; line-height: 1.2; font-weight: 500; margin: 0;">
  ${title}
</h2>`.trim();

      return `
${titleHtml}
${parsed.bodyHtml}
`.trim();
    })
    .join("\n\n");
}

function parseAnalysisNodesGS(nodes) {
  const seq = (nodes || []).filter(Boolean);
  const bodyParts = [];

  for (const node of seq) {
    const tag = (node[0]?.tagName || "").toLowerCase();

    if (tag === "p") {
      const inner = sanitizeInlineHtmlGS(node.html() || "");
      if (isEmptyRichText(inner)) continue;

      bodyParts.push(
        `<p style="font-size: 16px; line-height: 1.5; margin: 10px 0 0 0;">${inner}</p>`,
      );
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const chunk = cheerio.load("<root></root>", null, false);
      chunk("root").append(node.clone());
      rewriteAnchorsGS(chunk);

      let listHtml = chunk("root").children().first().toString();
      listHtml = listHtml
        .replace("<ul", '<ul style="margin: 10px 0 0 18px; padding: 0"')
        .replace("<ol", '<ol style="margin: 10px 0 0 18px; padding: 0"')
        .replace(
          /<li>/g,
          '<li style="font-size: 16px; line-height: 1.5; margin-bottom: 6px;">',
        );

      bodyParts.push(listHtml);
    }
  }

  return { bodyHtml: bodyParts.join("\n") };
}
/** -----------------------------
 * Inline sanitizer + anchors (GS styles)
 * ----------------------------- */
function rewriteAnchorsGS($) {
  $("a").each((_, a) => {
    $(a).attr("target", "_blank");
    $(a).attr(
      "style",
      "text-decoration: none; border-bottom: 2px solid #06266d; color: black;",
    );
  });
}

function sanitizeInlineHtmlGS(html) {
  const $ = cheerio.load(`<root>${html}</root>`, null, false);

  rewriteAnchorsGS($);

  // keep only safe inline tags
  const allowed = new Set(["strong", "b", "em", "i", "a", "br"]);
  $("root")
    .find("*")
    .each((_, el) => {
      const tag = (el.tagName || "").toLowerCase();
      if (!allowed.has(tag)) $(el).replaceWith($(el).text());
    });

  return normalizeDashes($("root").html()?.trim() || "");
}
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
function hasToken(re, str) {
  re.lastIndex = 0; // IMPORTANT when /g is used
  return re.test(str);
}
