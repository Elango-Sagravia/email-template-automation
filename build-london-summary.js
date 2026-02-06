/**
 * build-london-summary.js
 * ----------------------
 * v2.4 (Spotlight + What's on + Long story short split into 2 cards)
 *
 * - DOCX -> Mammoth HTML
 * - Extract "In this edition" items
 * - Extract Spotlight stories ONLY from:
 *     H2 "Spotlight" -> each H3 after it is a story title
 *     story body = p/ul/ol until next H3 or next H2
 * - Render Spotlight blocks:
 *     - always include image:
 *         src="https://www.londonsummary.com/email/images/REPLACE_ME.jpg"
 *         alt=title
 *     - insert the AD block between spotlight #1 and spotlight #2
 * - Extract "What’s on" items from H2 "What’s on"
 *     - supports 2 or 3 items
 *     - no dashed divider after last item
 * - Extract "Long story short" from H2/H3 "Long story short"
 *     - Each H3 inside it is a category (Politics, Business, Art & Culture, Misc, etc.)
 *     - Split into 2 MJML cards:
 *         Card 1: Long story short heading + divider + Politics + Business
 *         Card 2: Image (first img after Business within LSS) + remaining categories (Art & Culture, Misc...)
 * - Inject into layout placeholders:
 *     {{%IN_THIS_EDITION_TABLE%}}
 *     {{%SPOTLIGHT_SECTION%}}
 *     {{%WHATS_ON_SECTION%}}
 *     {{%LONG_STORY_SHORT_SECTION%}}
 * - Compile MJML -> HTML
 *
 * Usage:
 *   node build-london-summary.js "docx/london-summary/2026/feb/feb-4.docx"
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
const NEWSLETTER_SLUG = "london-summary";

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
const TOKEN_WHATS_ON_SECTION = /\{\{\%\s*WHATS_ON_SECTION\s*\%\}\}/g;
const TOKEN_LONG_STORY_SHORT_SECTION =
  /\{\{\%\s*LONG_STORY_SHORT_SECTION\s*\%\}\}/g;
const TOKEN_ROWS = /\{\{\%\s*ROWS\s*\%\}\}/g;
const TOKEN_DID_YOU_KNOW_SECTION = /\{\{\%\s*DID_YOU_KNOW_SECTION\s*\%\}\}/g;
const TOKEN_PREVIEW_TEXT = /\{\{\%\s*PREVIEW_TEXT\s*\%\}\}/g;
const TOKEN_IMAGE_CREDITS = /\{\{\%\s*IMAGE_CREDITS\s*\%\}\}/g;

/** -----------------------------
 * MAIN
 * ----------------------------- */
main().catch((e) => {
  console.error("❌ Build failed:", e);
  process.exit(1);
});

async function main() {
  if (!DOCX_PATH) {
    throw new Error('Usage: node build-london-summary.js "<path-to-docx>"');
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
  const { value: docHtml } = await mammoth.convertToHtml({ buffer });

  // Optional debug:
  // fs.writeFileSync(path.join(outDir, "doc.html"), docHtml, "utf8");

  // 2) In this edition
  const editionItems = extractInThisEditionLondon(docHtml);
  console.log("🧩 In this edition:", editionItems);
  const inThisEditionMjml = renderInThisEditionFromTemplate(editionItems);

  // 3) Spotlight
  const spotlightStories = extractSpotlightLondon(docHtml);
  console.log(
    "🧩 Spotlight stories:",
    spotlightStories.map((s) => s.title),
  );
  const spotlightMjml = renderSpotlightLondon(spotlightStories);

  // 4) What's on
  const whatsOnItems = extractWhatsOnLondon(docHtml);
  console.log(
    "🧩 What’s on items:",
    whatsOnItems.map((x) => x.title),
  );
  const whatsOnMjml = renderWhatsOnLondon(whatsOnItems);

  // 5) Long story short (split)
  const lss = extractLongStoryShortLondon(docHtml);
  console.log("🧩 Long story short split:", {
    card1Cats: (lss.first || []).map((x) => x.title),
    card2Cats: (lss.second || []).map((x) => x.title),
    card2Image: lss.secondImage ? "✅" : "❌",
  });
  const lssMjml = renderLongStoryShortLondon(lss);

  // 6) Did you know?
  const dyk = extractDidYouKnowLondon(docHtml);
  console.log("🧩 Did you know:", dyk?.text || "(none)");
  const dykHtml = renderDidYouKnowLondon(dyk);

  // 6) Inject into layout
  const layoutMjml = fs.readFileSync(LAYOUT_PATH, "utf8");
  let finalMjml = layoutMjml;

  if (!TOKEN_IN_THIS_EDITION.test(finalMjml)) {
    console.warn(
      "⚠️ Placeholder {{%IN_THIS_EDITION_TABLE%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_IN_THIS_EDITION, inThisEditionMjml);

  if (!TOKEN_SPOTLIGHT_SECTION.test(finalMjml)) {
    console.warn(
      "⚠️ Placeholder {{%SPOTLIGHT_SECTION%}} not found in layout.mjml (add it where Spotlight should appear)",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_SPOTLIGHT_SECTION, spotlightMjml);

  if (!TOKEN_WHATS_ON_SECTION.test(finalMjml)) {
    console.warn(
      "⚠️ Placeholder {{%WHATS_ON_SECTION%}} not found in layout.mjml (add it where What’s on should appear)",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_WHATS_ON_SECTION, whatsOnMjml);

  if (!TOKEN_LONG_STORY_SHORT_SECTION.test(finalMjml)) {
    console.warn(
      "⚠️ Placeholder {{%LONG_STORY_SHORT_SECTION%}} not found in layout.mjml (add it where LSS should appear)",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_LONG_STORY_SHORT_SECTION, lssMjml);

  // Inject into layout
  if (!TOKEN_DID_YOU_KNOW_SECTION.test(finalMjml)) {
    console.warn(
      "⚠️ Placeholder {{%DID_YOU_KNOW_SECTION%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_DID_YOU_KNOW_SECTION, dykHtml);

  // Preview text
  const preview = extractPreviewTextLondon(docHtml);
  finalMjml = finalMjml.replace(TOKEN_PREVIEW_TEXT, escapeHtml(preview || ""));

  // Image credits
  const imageCredits = extractImageCreditsLondon(docHtml);
  finalMjml = finalMjml.replace(
    TOKEN_IMAGE_CREDITS,
    renderImageCreditsLondon(imageCredits),
  );

  // 7) Compile MJML -> HTML
  const { html, errors } = mjml2html(finalMjml, {
    validationLevel: "soft",
    filePath: LAYOUT_PATH,
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
 * In this edition (London)
 * ----------------------------- */
function extractInThisEditionLondon(html) {
  const $ = cheerio.load(html);

  const marker = $("p, h1, h2, h3, div")
    .filter((_, el) => {
      const t = cleanText($(el).text()).toLowerCase();
      return (
        t === "in this edition" ||
        t === "in this edition:" ||
        t.startsWith("in this edition")
      );
    })
    .first();

  if (!marker.length) return [];

  // Case 1: bullets
  const ul = marker.nextAll("ul").first();
  if (ul.length) {
    return ul
      .find("li")
      .map((_, li) => cleanText($(li).text()))
      .get()
      .filter(Boolean)
      .slice(0, 12);
  }

  // Case 2: paragraphs
  const items = [];
  let el = marker.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());
    const lower = txt.toLowerCase();

    if ((tag === "h2" || tag === "h3") && txt) break;

    if (tag === "p") {
      if (!txt) break;
      if (/\bAQI\b/i.test(txt)) {
        el = el.next();
        continue;
      }
      if (lower.startsWith("was this email forwarded")) break;
      items.push(txt);
    }

    el = el.next();
  }

  return Array.from(new Set(items)).filter(Boolean).slice(0, 12);
}

function renderInThisEditionFromTemplate(items) {
  const tpl = fs.readFileSync(IN_THIS_EDITION_TPL_PATH, "utf8");

  const rows = (items || [])
    .filter(Boolean)
    .map((text, idx) => makeEditionRow(text, idx, items.length))
    .join("\n");

  if (!rows) return "";

  if (!TOKEN_ROWS.test(tpl)) {
    console.warn(
      "⚠️ Placeholder {{%ROWS%}} not found in in-this-edition-table.mjml",
    );
  }

  return tpl.replace(TOKEN_ROWS, rows);
}

function makeEditionRow(text, idx, total) {
  const safe = escapeHtml(cleanText(text));
  const isLast = idx === total - 1;

  const leftTdExtra = isLast
    ? `padding-right: 8px;`
    : `padding-right: 8px; padding-bottom: 5px;`;

  const rightTdExtra = isLast
    ? `line-height: 1.6;`
    : `line-height: 24px; padding-bottom: 11px;`;

  return `
<tr>
  <td style="
    font-size: 18px;
    width: 20px;
    vertical-align: top;
    ${leftTdExtra}
  "> → </td>
  <td style="font-size: 16px; ${rightTdExtra}">
    ${safe}
  </td>
</tr>`.trim();
}

/** -----------------------------
 * Spotlight extraction (London)
 * Rule:
 * - Find H2 "Spotlight"
 * - Each H3 = story title
 * - body = p/ul/ol until next H3 or next H2
 * ----------------------------- */
function extractSpotlightLondon(html) {
  const $ = cheerio.load(html);

  const spotH2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "spotlight")
    .first();

  if (!spotH2.length) return [];

  const stories = [];
  let current = null;
  let el = spotH2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    // stop at next big section
    if (tag === "h2" && txt) break;

    if (tag === "h3" && txt) {
      if (current) stories.push(current);
      current = { title: txt, nodes: [] };
      el = el.next();
      continue;
    }

    // ignore content before first h3
    if (!current) {
      el = el.next();
      continue;
    }

    if (tag === "p" || tag === "ul" || tag === "ol") {
      current.nodes.push(el);
    } else if (tag === "div") {
      const children = el.children("p, ul, ol");
      if (children.length) children.each((_, c) => current.nodes.push($(c)));
    }

    el = el.next();
  }

  if (current) stories.push(current);

  return stories.filter((s) => s.title && (s.nodes?.length || 0) > 0);
}

/** -----------------------------
 * Spotlight rendering (London)
 * - Always include image:
 *   src=".../REPLACE_ME.jpg"
 *   alt=title
 * - Insert ad between spotlight #1 and #2
 * - Spacer after each block
 * ----------------------------- */
function renderSpotlightLondon(stories) {
  if (!stories?.length) return "";

  const AD_BLOCK = `
<mj-section background-color="#eff1f4" css-class="border-line" padding="1px 1px 1px 1px" border-radius="10px">
  <mj-raw>
    <a href="https://link.londonsummary.com/ls-4-feb-2026-p-ad-x-4" target="_blank" style="color:black">
  </mj-raw>
  <mj-column background-color="#fff" border-radius="10px" padding="0px">
    <mj-image border-radius="10px 10px 0 0" padding="0px" width="600px"
      src="https://www.londonsummary.com/email/ad/REPLACE_ME.jpg"
      alt="Advertisement promoting newsletter sponsorship to reach engaged readers" />
    <mj-text padding="20px 20px 0px 20px"
      font-family="Austin News Text Web, TNYAdobeCaslonPro, 'Times New Roman', serif"
      color="#000000">
      <h2 style="font-size: 24px; line-height: 1.2; font-weight: 400; margin: 0;">
        This could be your business
      </h2>
    </mj-text>
    <mj-text padding="0px 20px 0px 20px" font-family="Arial" color="#000000">
      <p style="font-size: 16px; line-height: 1.5; padding-top: 15px; margin: 0;">
        Reach a wide audience of engaged, loyal readers right where they’re paying attention.
        Our audience is educated, influential, and ready to respond.
      </p>
      <p style="font-size: 16px; line-height: 1.5; padding-top: 15px; margin: 0;">
        Whether you want to drive revenue, build awareness, or launch something fresh,
        this is your spot. Secure your placement and get in front of the right eyes.
      </p>
      <p style="font-size: 16px; line-height: 1.5; padding-top: 15px; padding-bottom: 20px; margin: 0;">
        <a style="text-decoration: none; border-bottom: 2px solid #80011f; color: black;">
          <strong>Partner with us</strong>
        </a>
      </p>
    </mj-text>
  </mj-column>
  <mj-raw></a></mj-raw>
</mj-section>
<mj-spacer height="20px" />
`.trim();

  return stories
    .map((s, idx) => {
      const titleText = cleanText(s.title || "");
      const title = escapeHtml(titleText);

      const { bodyHtml } = renderSpotlightBodyLondon(s.nodes || []);

      const spotlightBlock = `
<mj-section background-color="#eff1f4" padding="1px 1px 1px 1px" border-radius="10px">
  <mj-column background-color="#fff" border-radius="10px" padding="0px">
    <mj-image
      border-radius="10px 10px 0 0"
      padding="0"
      width="600px"
      src="https://www.londonsummary.com/email/images/REPLACE_ME.jpg"
      alt="${title}"
      href="https://www.londonsummary.com/"
    />
    <mj-text
      padding="20px 20px 0px 20px"
      font-family="Austin News Text Web, TNYAdobeCaslonPro, 'Times New Roman', serif"
      color="#000000"
    >
      <h2 style="font-size: 24px; line-height: 1.2; font-weight: 400; margin: 0;">
        ${title}
      </h2>
    </mj-text>
    <mj-text padding="0px 20px 0px 20px" font-family="Arial" color="#000000">
      ${bodyHtml}
    </mj-text>
  </mj-column>
</mj-section>
<mj-spacer height="20px" />
`.trim();

      // Insert ad AFTER spotlight #1 (idx 0)
      if (idx === 0 && stories.length > 1) {
        return `${spotlightBlock}\n${AD_BLOCK}`;
      }

      return spotlightBlock;
    })
    .join("\n\n");
}

/** -----------------------------
 * Spotlight body renderer
 * - paragraphs + lists
 * - applies LS anchor style
 * - last paragraph gets padding-bottom: 20px & line-height: 24px
 * ----------------------------- */
function renderSpotlightBodyLondon(nodes) {
  const parts = [];

  for (const node of nodes || []) {
    const tag = (node[0]?.tagName || "").toLowerCase();

    if (tag === "p") {
      const inner = sanitizeInlineHtmlLondon(node.html() || "");
      if (isEmptyRichText(inner)) continue;

      parts.push(
        `<p style="font-size: 16px; line-height: 1.5; padding-top: 15px; margin: 0;">
  ${inner}
</p>`.trim(),
      );
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const chunk = cheerio.load("<root></root>", null, false);
      chunk("root").append(node.clone());
      rewriteAnchorsLondon(chunk);

      let listHtml = chunk("root").children().first().toString();
      listHtml = listHtml
        .replace("<ul", '<ul style="margin: 12px 0 0 18px; padding: 0"')
        .replace("<ol", '<ol style="margin: 12px 0 0 18px; padding: 0"')
        .replace(
          /<li>/g,
          '<li style="font-size: 16px; line-height: 1.5; margin-bottom: 6px;">',
        );

      parts.push(listHtml);
    }
  }

  // last paragraph like your sample
  if (parts.length) {
    const last = parts[parts.length - 1];
    if (last.startsWith("<p ")) {
      parts[parts.length - 1] = last
        .replace("line-height: 1.5;", "line-height: 24px;")
        .replace("margin: 0;", "padding-bottom: 20px; margin: 0;");
    }
  }

  return { bodyHtml: parts.join("\n") };
}

/** -----------------------------
 * What’s on extraction (London)
 * ----------------------------- */
function extractWhatsOnLondon(html) {
  const $ = cheerio.load(html);

  const marker = $("h2, h3")
    .filter((_, el) => {
      const t = cleanText($(el).text()).toLowerCase();
      return (
        t === "what’s on" ||
        t === "what's on" ||
        t.startsWith("what’s on") ||
        t.startsWith("what's on")
      );
    })
    .first();

  if (!marker.length) return [];

  const items = [];
  let el = marker.next();

  // Collect paragraphs until next h2
  const lines = [];
  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    if (tag === "h2" && txt) break;

    if (tag === "p") {
      lines.push({ text: txt, html: el.html() || "" });
    } else if (tag === "div") {
      const ps = el.children("p");
      if (ps.length) {
        ps.each((_, p) => {
          const $p = $(p);
          lines.push({
            text: cleanText($p.text()),
            html: $p.html() || "",
          });
        });
      }
    }

    el = el.next();
  }

  // Split by empty lines
  const blocks = [];
  let cur = [];
  for (const ln of lines) {
    if (!ln.text) {
      if (cur.length) blocks.push(cur);
      cur = [];
      continue;
    }
    cur.push(ln);
  }
  if (cur.length) blocks.push(cur);

  for (const b of blocks.slice(0, 3)) {
    const title = b[0]?.text || "";
    if (!title) continue;

    const url = firstHrefFromHtmlBlock(b.map((x) => x.html).join("\n"));
    const ctaLine = b.length >= 2 ? b[b.length - 1].text : "";
    const descLines = b.slice(1, Math.max(1, b.length - 1)).map((x) => x.text);
    const desc = descLines.join(" ");

    items.push({
      img: "https://www.londonsummary.com/email/images/REPLACE_ME.jpg",
      imgAlt: title,
      title,
      desc,
      ctaText: ctaLine || "Learn more",
      ctaUrl: url || "https://www.londonsummary.com/",
    });
  }

  return items;
}

function firstHrefFromHtmlBlock(html) {
  if (!html) return "";
  const $ = cheerio.load(`<root>${html}</root>`, null, false);
  const a = $("a").first();
  return a.length ? a.attr("href") || "" : "";
}

/**
 * WHAT'S ON (London) — renderer
 * - up to 3 items
 * - no dashed divider after last item
 */
function renderWhatsOnLondon(items = []) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return "";

  const header = `
<mj-section background-color="#eff1f4" padding="1px 1px 1px 1px" border-radius="10px">
  <mj-column background-color="#fff" border-radius="10px" padding-bottom="7px">
    <mj-text padding="20px 20px 0px 20px"
      font-family="Austin News Text Web, TNYAdobeCaslonPro, 'Times New Roman', serif"
      color="#000000">
      <h2 style="font-size: 24px; line-height: 1.2; font-weight: 400; margin: 0;">What’s on</h2>
    </mj-text>
    <mj-divider border-width="4.8px" border-color="#80011F" width="35px" align="left" padding="0 20px 0px 20px" />
    <mj-spacer height="10px" />
`;

  const usable = list.slice(0, 3);

  const blocks = usable
    .map((it, idx) => {
      const isLast = idx === usable.length - 1;

      const img = escapeHtml(it.img || "");
      const imgAlt = escapeHtml(it.imgAlt || it.title || "");
      const title = escapeHtml(it.title || "");
      const desc = escapeHtml(it.desc || "");
      const ctaText = escapeHtml(it.ctaText || "");
      const ctaUrl = escapeHtml(it.ctaUrl || "#");

      const story = `
    <mj-section padding="5px 10px 0px 10px" padding-bottom="0px !important">
      <mj-group width="100%" padding="0px !important">
        <mj-column width="30%" vertical-align="top" padding="0">
          <mj-image
            align="left"
            src="${img}"
            alt="${imgAlt}"
            padding="0px"
            border-radius="8px"
            fluid-on-mobile="true"
            css-class="event-image"
            href="${ctaUrl}"
          />
        </mj-column>
        <mj-column width="70%" vertical-align="top">
          <mj-text padding="0px 15px 0px 15px" font-family="Arial" color="#000000" font-size="16px">
            <p style="margin-bottom: 7px !important; margin-top: 6px !important; line-height: 16px;">
              <strong>${title}</strong>
            </p>
            <p style="line-height: 24px">${desc}</p>
            <p style="margin-bottom: 0px; line-height: 16px">
              <a
                style="text-decoration: none; border-bottom: 2px solid #80011f; color: black;"
                target="_blank"
                href="${ctaUrl}"
              >${ctaText}</a>
            </p>
          </mj-text>
        </mj-column>
      </mj-group>
    </mj-section>
`.trim();

      const divider = !isLast
        ? `
    <mj-divider
      border-style="dashed"
      border-width="1px"
      border-color="lightgrey"
      padding="20px 22px 8px 22px"
    />
`.trim()
        : "";

      return [story, divider].filter(Boolean).join("\n");
    })
    .join("\n");

  const footer = `
  </mj-column>
</mj-section>
<mj-spacer height="20px" />
`.trim();

  return [header, blocks, footer].join("\n");
}

/** -----------------------------
 * LONG STORY SHORT (London) — SPLIT INTO 2 CARDS
 *
 * Card 1: Heading + divider + categories up to Business (inclusive)
 * Card 2: Image (first <img> after Business inside LSS) + remaining categories
 * ----------------------------- */
function extractLongStoryShortLondon(html) {
  const $ = cheerio.load(html);

  const marker = $("h2, h3")
    .filter((_, el) => {
      const t = cleanText($(el).text()).toLowerCase();
      return (
        t === "long story short" ||
        t === "long story short:" ||
        t.startsWith("long story short")
      );
    })
    .first();

  if (!marker.length) {
    return { first: [], second: [], secondImage: "" };
  }

  const categories = [];
  let current = null;

  let foundBusiness = false;
  let afterBusinessImage = "";

  let el = marker.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    // Stop at next big section heading
    if (tag === "h2" && txt) break;

    // Capture first image after Business (for card 2)
    if (tag === "img") {
      const src = $(el).attr("src") || "";
      if (foundBusiness && !afterBusinessImage && src) afterBusinessImage = src;
      el = el.next();
      continue;
    }

    // Category heading
    if (tag === "h3" && txt) {
      if (current) categories.push(current);
      current = { title: txt, items: [] };

      if (cleanText(txt).toLowerCase() === "business") {
        foundBusiness = true;
      }

      el = el.next();
      continue;
    }

    // Ignore content until first h3
    if (!current) {
      el = el.next();
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const items = extractBulletItemsFromListNode($, el);
      current.items.push(...items);
      el = el.next();
      continue;
    }

    if (tag === "p") {
      const htmlInner = el.html() || "";
      if (containsMeaningfulLssLine(htmlInner, txt)) {
        const itemHtml = sanitizeInlineHtmlLondon(htmlInner);
        if (!isEmptyRichText(itemHtml)) current.items.push(itemHtml);
      }
      el = el.next();
      continue;
    }

    if (tag === "div") {
      const lists = el.children("ul, ol");
      if (lists.length) {
        lists.each((_, listEl) => {
          const items = extractBulletItemsFromListNode($, $(listEl));
          current.items.push(...items);
        });
      } else {
        const ps = el.children("p");
        if (ps.length) {
          ps.each((_, p) => {
            const $p = $(p);
            const t = cleanText($p.text());
            const h = $p.html() || "";
            if (containsMeaningfulLssLine(h, t)) {
              const itemHtml = sanitizeInlineHtmlLondon(h);
              if (!isEmptyRichText(itemHtml)) current.items.push(itemHtml);
            }
          });
        }
      }
      el = el.next();
      continue;
    }

    el = el.next();
  }

  if (current) categories.push(current);

  const cleaned = categories
    .map((c) => ({
      title: cleanText(c.title || ""),
      items: (c.items || []).filter(Boolean),
    }))
    .filter((c) => c.title && c.items.length);

  if (!cleaned.length) return { first: [], second: [], secondImage: "" };

  const idxBusiness = cleaned.findIndex(
    (c) => c.title.toLowerCase() === "business",
  );

  const first = idxBusiness >= 0 ? cleaned.slice(0, idxBusiness + 1) : cleaned;
  const second = idxBusiness >= 0 ? cleaned.slice(idxBusiness + 1) : [];

  return {
    first,
    second,
    secondImage:
      (afterBusinessImage || "").trim() ||
      "https://www.londonsummary.com/email/images/REPLACE_ME.jpg",
  };
}

function renderLongStoryShortLondon(data) {
  const first = data?.first || [];
  const second = data?.second || [];
  const secondImage = escapeHtml(
    data?.secondImage ||
      "https://www.londonsummary.com/email/images/REPLACE_ME.jpg",
  );

  if (!first.length && !second.length) return "";

  const card1 = `
<mj-section background-color="#eff1f4" padding="1px 1px 1px 1px" border-radius="10px">
  <mj-column background-color="#fff" border-radius="10px" padding="0px">
    <mj-text padding="20px 20px 0px 20px"
      font-family="Austin News Text Web, TNYAdobeCaslonPro, 'Times New Roman', serif"
      color="#000000">
      <h2 style="font-size: 24px; line-height: 1.2; font-weight: 400; margin: 0;">Long story short</h2>
    </mj-text>
    <mj-divider border-width="4.8px" border-color="#80011F" width="35px" align="left" padding="0 20px 0px 20px" />
    <mj-spacer height="30px" />

    ${renderLssCategoryBlocks(first, { firstCategoryPaddingTop: "0px" })}

  </mj-column>
</mj-section>
<mj-spacer height="20px" />
`.trim();

  if (!second.length) return card1;

  const card2 = `
<mj-section background-color="#eff1f4" padding="1px 1px 1px 1px" border-radius="10px">
  <mj-column background-color="#fff" border-radius="10px" padding-bottom="20px">
    <mj-image border-radius="10px 10px 0 0" padding="0" width="600px"
      src="${secondImage}"
      alt="REPLACE_ME"
      href="https://www.londonsummary.com/" />
    ${renderLssCategoryBlocks(second, { firstCategoryPaddingTop: "20px" })}
  </mj-column>
</mj-section>
<mj-spacer height="20px" />
`.trim();

  return `${card1}\n${card2}`;
}

function renderLssCategoryBlocks(categories, opts = {}) {
  const firstCategoryPaddingTop = opts.firstCategoryPaddingTop ?? "20px";

  return (categories || [])
    .map((sec, idx) => {
      const title = escapeHtml(cleanText(sec.title || ""));
      const isFirst = idx === 0;
      const padTop = isFirst ? firstCategoryPaddingTop : "20px";
      const padBottomTable = idx === categories.length - 1 ? "5px" : "0px";

      return `
<mj-text padding="${padTop} 20px 10px 20px" font-family="Arial" color="#000000">
  <h3 style="font-size: 20px; line-height: 1.2; font-weight: 700; margin: 0;">${title}</h3>
</mj-text>
${renderLssBulletTable(sec.items || [], { paddingTop: "0px", paddingBottom: padBottomTable })}
`.trim();
    })
    .join("\n");
}

function renderLssBulletTable(items, opts = {}) {
  const paddingTop = opts.paddingTop ?? "0px";
  const paddingBottom = opts.paddingBottom ?? "0px";

  const rows = (items || [])
    .filter(Boolean)
    .map((html) => {
      return `
<tr>
  <td style="
    font-size: 18px;
    vertical-align: top;
    line-height: 24px;
    padding-bottom: 15px;
    padding-right: 8px;
  "> &#8226; </td>
  <td style="
    font-size: 16px;
    line-height: 24px;
    padding-bottom: 15px;
    padding-left: 0px;
  ">
    ${normalizeDashes(html)}
  </td>
</tr>`.trim();
    })
    .join("\n");

  if (!rows) return "";

  return `
<mj-table
  font-family="Arial"
  cellpadding="0"
  cellspacing="0"
  padding="${paddingTop} 32px ${paddingBottom} 32px"
  style="width: 100%"
>
  ${rows}
</mj-table>`.trim();
}

function extractBulletItemsFromListNode($, listNode) {
  const items = [];
  listNode.find("li").each((_, li) => {
    const $li = $(li);
    const inner = $li.html() || "";
    const clean = sanitizeInlineHtmlLondon(inner);
    if (!isEmptyRichText(clean)) items.push(clean);
  });
  return items;
}

function containsMeaningfulLssLine(htmlInner, txt) {
  const hasLink = /<a\b/i.test(htmlInner || "");
  const hasText = (txt || "").trim().length > 0;
  return hasText && (hasLink || (htmlInner || "").length > 0);
}

function extractPreviewTextLondon(html) {
  const $ = cheerio.load(html);

  const marker = $("h1,h2,h3,p,div")
    .filter((_, el) => {
      const t = cleanText($(el).text()).toLowerCase();
      return (
        t === "preview text" || t === "preview" || t.startsWith("preview text")
      );
    })
    .first();

  if (!marker.length) return "";

  let el = marker.next();
  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    if ((tag === "h2" || tag === "h3") && txt) break;

    if (tag === "p" && txt) return txt;

    if (tag === "div") {
      const p = el.children("p").first();
      if (p.length) {
        const t = cleanText(p.text());
        if (t) return t;
      }
    }

    el = el.next();
  }

  return "";
}

function extractImageCreditsLondon(html) {
  const $ = cheerio.load(html);

  const marker = $("h1,h2,h3,p,div")
    .filter((_, el) => {
      const t = cleanText($(el).text()).toLowerCase();
      return (
        t === "image credits" ||
        t === "images credits" ||
        t.startsWith("image credits") ||
        t.startsWith("images credits")
      );
    })
    .first();

  if (!marker.length) return "";

  let el = marker.next();
  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();

    const txt = cleanText(el.text());
    if ((tag === "h2" || tag === "h3") && txt) break;

    if (tag === "p") {
      const inner = sanitizeInlineHtmlLondon(el.html() || ""); // keeps your LS link style
      if (!isEmptyRichText(inner)) return inner;
    }

    if (tag === "div") {
      const p = el.children("p").first();
      if (p.length) {
        const inner = sanitizeInlineHtmlLondon(p.html() || "");
        if (!isEmptyRichText(inner)) return inner;
      }
    }

    el = el.next();
  }

  return "";
}

function renderImageCreditsLondon(htmlOrText) {
  // This goes inside: <strong>Images credits:</strong> {{%IMAGE_CREDITS%}}
  // so return inline HTML (no <p>)
  if (!htmlOrText) return "";
  return htmlOrText;
}

/** -----------------------------
 * Inline HTML sanitizer + anchors (London styles)
 * ----------------------------- */
function rewriteAnchorsLondon($) {
  $("a").each((_, a) => {
    $(a).attr("target", "_blank");
    $(a).attr(
      "style",
      "text-decoration: none; border-bottom: 2px solid #80011F; color: black;",
    );
  });
}

function sanitizeInlineHtmlLondon(html) {
  const $ = cheerio.load(`<root>${html}</root>`, null, false);
  rewriteAnchorsLondon($);

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
function normalizeDashes(s) {
  return (s || "").replace(/\u2010|\u2011|\u2012|\u2013|\u2014|\u2212/g, "-");
}

function cleanText(s) {
  return normalizeDashes((s || "").replace(/\s+/g, " ").trim());
}

function extractDidYouKnowLondon(html) {
  const $ = cheerio.load(html);

  // Find heading "Did you know?"
  const marker = $("h2, h3, p, div")
    .filter((_, el) => {
      const t = cleanText($(el).text()).toLowerCase();
      return (
        t === "did you know?" ||
        t === "did you know" ||
        t.startsWith("did you know")
      );
    })
    .first();

  if (!marker.length) return null;

  // Next meaningful paragraph after the heading
  let el = marker.next();
  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();

    // stop at next section
    if ((tag === "h2" || tag === "h3") && cleanText(el.text())) break;

    if (tag === "p") {
      const inner = sanitizeInlineHtmlLondon(el.html() || "");
      if (!isEmptyRichText(inner)) {
        return { html: inner, text: cleanText(el.text()) };
      }
    }

    if (tag === "div") {
      const p = el.children("p").first();
      if (p.length) {
        const inner = sanitizeInlineHtmlLondon(p.html() || "");
        if (!isEmptyRichText(inner)) {
          return { html: inner, text: cleanText(p.text()) };
        }
      }
    }

    el = el.next();
  }

  return null;
}

function renderDidYouKnowLondon(dyk) {
  if (!dyk?.html) return "";

  // wrap extracted inline HTML into the exact <p> you want
  return `<p style="font-size: 16px; line-height: 24px; margin: 0 !important">
    ${dyk.html}
  </p>`.trim();
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
