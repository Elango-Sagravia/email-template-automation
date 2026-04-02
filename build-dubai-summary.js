/**
 * build-dubai-summary.js (v1.4)
 * ----------------------------
 * ✅ DOCX -> Mammoth HTML
 * ✅ Extract:
 *   1) In this edition
 *   2) Spotlight (H2 "Spotlight" -> each H3 story)
 *      - Spotlight heading only for the 1st spotlight card
 *      - Insert AD block after spotlight #1
 *   3) Events (H2 "Events" -> repeated rows: image + title + desc + link)
 *      - Insert dotted divider between rows
 *      - Stop at H3 "Where to eat?" or next H2
 *   4) Where to eat? (H3 "Where to eat?" -> first image + paragraphs until next H2)
 *   5) Career (H2 "Career" -> H3 title -> next 3 paragraphs = tags -> rest until next H2 = summary/cta)
 *   6) Meanwhile (H2 "Meanwhile" -> each H3 story)
 *   7) Did you know? (H2 "Did you know?" -> paragraphs)
 * ✅ Inject into layout placeholders:
 *   {{%IN_THIS_EDITION_TABLE%}}
 *   {{%SPOTLIGHT_SECTION%}}
 *   {{%EVENTS_SECTION%}}
 *   {{%WHERE_TO_EAT_IMAGE_SRC%}}
 *   {{%WHERE_TO_EAT_IMAGE_ALT%}}
 *   {{%WHERE_TO_EAT_IMAGE_HREF%}}
 *   {{%WHERE_TO_EAT_SECTION%}}
 *   {{%CAREER_SECTION%}}
 *   {{%MEANWHILE_SECTION%}}
 *   {{%DID_YOU_KNOW_SECTION%}}
 * ✅ Compile MJML -> HTML
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

const NEWSLETTER_SLUG = "dubai-summary";
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

const TOKEN_EVENTS_SECTION = /\{\{\%\s*EVENTS_SECTION\s*\%\}\}/g;

const TOKEN_WHERE_TO_EAT_SECTION = /\{\{\%\s*WHERE_TO_EAT_SECTION\s*\%\}\}/g;
const TOKEN_WHERE_TO_EAT_IMAGE_SRC =
  /\{\{\%\s*WHERE_TO_EAT_IMAGE_SRC\s*\%\}\}/g;
const TOKEN_WHERE_TO_EAT_IMAGE_ALT =
  /\{\{\%\s*WHERE_TO_EAT_IMAGE_ALT\s*\%\}\}/g;
const TOKEN_WHERE_TO_EAT_IMAGE_HREF =
  /\{\{\%\s*WHERE_TO_EAT_IMAGE_HREF\s*\%\}\}/g;

const TOKEN_CAREER_SECTION = /\{\{\%\s*CAREER_SECTION\s*\%\}\}/g;
const TOKEN_ROWS = /\{\{\%\s*ROWS\s*\%\}\}/g;

const TOKEN_MEANWHILE_SECTION = /\{\{\%\s*MEANWHILE_SECTION\s*\%\}\}/g;
const TOKEN_DID_YOU_KNOW_SECTION = /\{\{\%\s*DID_YOU_KNOW_SECTION\s*\%\}\}/g;

const TOKEN_PREVIEW_TEXT = /\{\{\%\s*PREVIEW_TEXT\s*\%\}\}/g;
const TOKEN_DAY = /\{\{\%\s*DAY\s*\%\}\}/g;
const TOKEN_DATE = /\{\{\%\s*DATE\s*\%\}\}/g;
const TOKEN_TEMPERATURE = /\{\{\%\s*TEMPERATURE\s*\%\}\}/g;
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
    throw new Error(
      'Usage: node build-dubai-summary.js "docx/dubai-summary/2026/mar/mar-4.docx"',
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

  // 1.1) Meta fields
  const meta = extractMetaFieldsDubai(docHtml);
  console.log("🧩 Meta:", meta);

  // 2) In this edition
  const editionItems = extractInThisEditionDubai(docHtml);
  console.log("🧩 In this edition items:", editionItems);
  const inThisEditionMjml = renderInThisEditionFromTemplate(editionItems);

  // 3) Spotlight
  const spotlightStories = extractSpotlightDubai(docHtml);
  console.log(
    "🧩 Spotlight stories:",
    spotlightStories.map((s) => s.title),
  );
  const spotlightMjml = renderSpotlightDubai(spotlightStories);

  // 4) Events rows (new)
  const events = extractEventsDubai(docHtml);
  console.log(
    "🧩 Events:",
    events.map((e) => e.title),
  );
  const eventsMjml = renderEventsDubai(events);

  // 5) Where to eat? (image + paragraphs)
  const whereToEat = extractWhereToEatDubai(docHtml);
  console.log("🧩 Where to eat:", {
    img: Boolean(whereToEat?.imageSrc),
    paras: whereToEat?.items?.length || 0,
  });
  const whereToEatHtml = renderWhereToEatDubai(whereToEat.items || []);

  // 6) Career
  const career = extractCareerDubai(docHtml);
  console.log("🧩 Career:", {
    title: career?.title || "",
    tags: (career?.tags || []).length,
    body: (career?.body || []).length,
  });
  const careerMjml = renderCareerDubai(career);

  // 7) Meanwhile
  const meanwhileStories = extractMeanwhileDubai(docHtml);
  console.log(
    "🧩 Meanwhile stories:",
    meanwhileStories.map((s) => s.title),
  );
  const meanwhileMjml = renderMeanwhileDubai(meanwhileStories);

  // 8) Did you know?
  const didYouKnowParas = extractDidYouKnowDubai(docHtml);
  console.log("🧩 Did you know paras:", didYouKnowParas.length);
  const didYouKnowHtml = renderDidYouKnowDubai(didYouKnowParas);

  const imageCreditsHtml = extractImageCreditsDS(docHtml);
  console.log("🧩 Image credits:", cleanText(imageCreditsHtml));

  // 9) Inject into layout
  let finalMjml = fs.readFileSync(LAYOUT_PATH, "utf8");

  // Meta injections
  finalMjml = finalMjml.replace(TOKEN_PREVIEW_TEXT, meta.previewText || "");
  finalMjml = finalMjml.replace(TOKEN_DAY, meta.day || "");
  finalMjml = finalMjml.replace(TOKEN_DATE, meta.date || "");
  finalMjml = finalMjml.replace(TOKEN_TEMPERATURE, meta.temperature || "");

  // In this edition
  if (!TOKEN_IN_THIS_EDITION.test(finalMjml)) {
    console.warn(
      "⚠️ Token {{%IN_THIS_EDITION_TABLE%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_IN_THIS_EDITION, inThisEditionMjml);

  // Spotlight
  if (!TOKEN_SPOTLIGHT_SECTION.test(finalMjml)) {
    console.warn("⚠️ Token {{%SPOTLIGHT_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_SPOTLIGHT_SECTION, spotlightMjml);

  // Events (new)
  if (!TOKEN_EVENTS_SECTION.test(finalMjml)) {
    console.warn("⚠️ Token {{%EVENTS_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_EVENTS_SECTION, eventsMjml);

  // Where to eat image tokens (new)
  finalMjml = finalMjml.replace(
    TOKEN_WHERE_TO_EAT_IMAGE_SRC,
    whereToEat.imageSrc || "",
  );
  finalMjml = finalMjml.replace(
    TOKEN_WHERE_TO_EAT_IMAGE_ALT,
    whereToEat.imageAlt || "",
  );
  finalMjml = finalMjml.replace(
    TOKEN_WHERE_TO_EAT_IMAGE_HREF,
    whereToEat.imageHref || "",
  );

  // Where to eat body
  if (!TOKEN_WHERE_TO_EAT_SECTION.test(finalMjml)) {
    console.warn(
      "⚠️ Token {{%WHERE_TO_EAT_SECTION%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_WHERE_TO_EAT_SECTION, whereToEatHtml);

  // Career
  if (!TOKEN_CAREER_SECTION.test(finalMjml)) {
    console.warn("⚠️ Token {{%CAREER_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_CAREER_SECTION, careerMjml);

  // Meanwhile
  if (!TOKEN_MEANWHILE_SECTION.test(finalMjml)) {
    console.warn("⚠️ Token {{%MEANWHILE_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_MEANWHILE_SECTION, meanwhileMjml);

  // Did you know
  if (!TOKEN_DID_YOU_KNOW_SECTION.test(finalMjml)) {
    console.warn(
      "⚠️ Token {{%DID_YOU_KNOW_SECTION%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_DID_YOU_KNOW_SECTION, didYouKnowHtml);

  if (!hasToken(TOKEN_IMAGE_CREDITS, finalMjml)) {
    console.warn("⚠️ Token {{%IMAGE_CREDITS%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_IMAGE_CREDITS, imageCreditsHtml || "");

  // 10) MJML -> HTML
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
 * In this edition (Dubai)
 * ----------------------------- */
function extractInThisEditionDubai(html) {
  const $ = cheerio.load(html);

  const marker = $("p, h1, h2, h3, div")
    .filter((_, el) => {
      const t = cleanText($(el).text()).toLowerCase();
      return t === "in this edition:" || t.startsWith("in this edition:");
    })
    .first();

  if (!marker.length) return [];

  // Case 1: <ul> after marker
  let ul = marker.nextAll("ul").first();
  if (!ul.length) ul = marker.nextAll().find("ul").first();

  if (ul.length) {
    return ul
      .find("li")
      .map((_, li) => cleanText($(li).text()))
      .get()
      .filter(Boolean);
  }

  // Case 2: paragraphs after marker until next H2
  const items = [];
  let el = marker.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());
    const lower = txt.toLowerCase();

    if (tag === "h2" && txt) break;
    if (tag === "h2" && lower === "spotlight") break;

    if (tag === "p") {
      if (!txt) break;

      // Skip weekday/date-ish line (optional)
      if (
        /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
          txt,
        )
      ) {
        el = el.next();
        continue;
      }

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

/** -----------------------------
 * Spotlight extraction (Dubai)
 * ----------------------------- */
function extractSpotlightDubai(html) {
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
 * Spotlight renderer (Dubai)
 * ----------------------------- */
function renderSpotlightDubai(stories) {
  if (!stories?.length) return "";

  const AD_BLOCK =
    `<!--primary ad --><mj-section background-color="#EFF1F4" css-class="border-line" padding="1px 0.5px 1px 1px" border-radius="5px" > <mj-raw> <a href="https://link.dubaisummary.com/ds-1-apr-2026-p-ad-lt" target="_blank" style="color:black"> </mj-raw> <mj-column background-color="#fff" border-radius="5px" padding="0px"> <mj-spacer height="10px" /> <mj-text padding="2px 12px 8px 12px" font-family="TNYAdobeCaslonPro, 'Times New Roman', serif;" color="#000000" > <h2 style=" font-size: 24px; line-height: 1.2; font-weight: 500; margin-top: 2px !important; margin: 0; " > What your credit report may be hiding </h2> </mj-text> <mj-spacer height="0px" /> <mj-image border-radius="10px" padding="10px 12px 4px 12px" width="600px" src="https://www.geopoliticalsummary.com/email/ad/1-apr-2026-p-ad-lt.jpg" alt="campaign - lt" /> <mj-text padding="10px 12px 0px 12px" font-family="Roboto+Serif" color="#000000" > <p style="font-size: 16px; line-height: 24px; margin: 0 0 10px 0"> <strong>Credit check:</strong> Your credit score does not always tell the full story. Errors, outdated information, or negative marks on your credit report can quietly affect borrowing costs, approvals, and financial options without you fully realizing it. </p> <p style="font-size: 16px; line-height: 24px; margin: 0 0 10px 0"> <strong>Why it matters:</strong> Lexington Law offers a free credit assessment designed to help people understand what may be affecting their credit. The idea is simple. Before making any big financial move, it helps to know what is actually on your report and what could be holding you back. </p> <p style="font-size: 16px; line-height: 24px; margin: 0"> <strong>What you get:</strong> For readers who want a clearer picture of their credit without jumping straight into a commitment, this is an easy first step. The positioning is practical and low-friction, with the added credibility of coming from a law firm rather than just another credit tool. </p> </mj-text> <mj-text padding="10px 12px 8px 12px" font-family="Roboto+Serif" color="#000000" > <p style="font-size: 16px; line-height: 24px; margin: 0"> <a style=" text-decoration: none; border-bottom: 2px solid #102341; color: black; " ><strong >Credit assessment from Lexington Law, on the house for Summary readers</strong ></a > </p> </mj-text> <mj-spacer height="12px" /> </mj-column> <mj-raw> </a> </mj-raw> </mj-section><!--primary ad -->`.trim();

  const SPOTLIGHT_HEADING = `
<mj-table
  css-class="new-heading-with-border"
  cellpadding="0"
  cellspacing="0"
  width="100%"
  padding="16px 0px 12px 0px"
>
  <tr>
    <td valign="middle" style="width: 12%; font-size: 0; line-height: 0; padding: 0px; mso-line-height-rule: exactly;">
      <div style="height: 0px; border-top: 4px solid #eeca66">&nbsp;</div>
    </td>
    <td valign="middle" style="padding: 0 8px; text-align: center; white-space: nowrap">
      <span style="display: inline-block; font-weight: 900; font-size: 15px; line-height: 1.2; font-family: Arial, sans-serif; color: #000000; text-transform: uppercase;">
        Spotlight
      </span>
    </td>
    <td valign="middle" style="width: 100%; font-size: 0; line-height: 0; padding: 0px; mso-line-height-rule: exactly;">
      <div style="height: 0px; border-top: 4px solid #eeca66">&nbsp;</div>
    </td>
  </tr>
</mj-table>
`.trim();

  const blocks = stories.map((s, idx) => {
    const title = escapeHtml(cleanText(s.title || ""));
    const bodyHtml = renderSpotlightBodyDubai(s.nodes || []);

    const spotlightBlock = `
<mj-section background-color="#eff1f4" padding="1px 0.5px 1px 1px" border-radius="5px">
  <mj-column background-color="#fff" border-radius="5px" padding="0px">
    ${idx === 0 ? SPOTLIGHT_HEADING : ""}

    <mj-text
      padding="${idx === 0 ? "10px 12px" : "16px 12px 0px 12px"}"
      font-family="Austin News Text Web, TNYAdobeCaslonPro, 'Times New Roman', serif"
      color="#000000"
    >
      <h2 style="font-size: 24px; line-height: 1.2; font-weight: 400; margin: 0;">
        ${title}
      </h2>
    </mj-text>
    <mj-image
          border-radius="10px"
          padding="10px 12px"
          width="600px"
          src="https://www.dubaisummary.com/email/images/REPLACE_ME.jpg"
          alt="REPLACE_ME"
          href="https://www.dubaisummary.com/"
          target="_blank"
        />

    <mj-text padding="10px 12px 16px 12px" font-family="Arial" color="#000000">
      ${bodyHtml}
    </mj-text>
  </mj-column>
</mj-section>
<mj-spacer height="10px" />
`.trim();

    // if (idx === 0 && stories.length > 1)
    //   return `${spotlightBlock}\n${AD_BLOCK}`;
    // return spotlightBlock;
    return `${spotlightBlock}\n${AD_BLOCK}`;
  });

  return blocks.join("\n\n");
}

function renderSpotlightBodyDubai(nodes) {
  const parts = [];

  for (const node of nodes || []) {
    const tag = (node[0]?.tagName || "").toLowerCase();

    if (tag === "p") {
      const inner = sanitizeInlineHtmlDubai(node.html() || "");
      if (isEmptyRichText(inner)) continue;

      parts.push(
        `<p style="font-size: 16px; line-height: 1.5; margin: 0 0 10px 0;">${inner}</p>`,
      );
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const chunk = cheerio.load("<root></root>", null, false);
      chunk("root").append(node.clone());
      rewriteAnchorsDubai(chunk);

      let listHtml = chunk("root").children().first().toString();
      listHtml = listHtml
        .replace("<ul", '<ul style="margin: 10px 0 0 18px; padding: 0"')
        .replace("<ol", '<ol style="margin: 10px 0 0 18px; padding: 0"')
        .replace(
          /<li>/g,
          '<li style="font-size: 16px; line-height: 1.5; margin-bottom: 6px;">',
        );

      parts.push(listHtml);
    }
  }

  return parts.join("\n");
}

/** -----------------------------
 * Events extraction (NEW)
 * H2 "Events" -> rows until H3 "Where to eat?" or next H2
 * Each row: image, title, desc, link
 * ----------------------------- */
function extractEventsDubai(html) {
  const $ = cheerio.load(html);

  const eventsH2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "events")
    .first();

  if (!eventsH2.length) return [];

  const blocks = [];
  let el = eventsH2.next();

  const isStop = (node) => {
    const tag = (node?.[0]?.tagName || "").toLowerCase();
    const txt = cleanText(node.text());

    if (tag === "h2" && txt) return true;
    if (tag === "h3" && txt && txt.toLowerCase() === "where to eat?")
      return true;
    return false;
  };

  while (el && el.length) {
    if (isStop(el)) break;

    const tag = (el[0]?.tagName || "").toLowerCase();

    if (tag === "p" || tag === "img") {
      blocks.push(el);
    } else if (tag === "div") {
      el.children("p, img").each((_, c) => blocks.push($(c)));
    }

    el = el.next();
  }

  const rows = [];
  let i = 0;

  const readNextNonEmptyP = () => {
    while (i < blocks.length) {
      const b = blocks[i];
      const tag = (b[0]?.tagName || "").toLowerCase();
      i++;

      if (tag !== "p") continue;

      const t = cleanText(b.text());
      if (!t) continue;
      return b;
    }
    return null;
  };

  const readOptionalImg = () => {
    if (i >= blocks.length) return null;
    const b = blocks[i];
    const tag = (b[0]?.tagName || "").toLowerCase();
    if (tag !== "img") return null;
    i++;
    return b;
  };

  while (i < blocks.length) {
    const imgNode = readOptionalImg();

    const titleP = readNextNonEmptyP();
    if (!titleP) break;

    const descP = readNextNonEmptyP();
    const linkP = readNextNonEmptyP();

    const title = cleanText(titleP.text());
    const descHtml = descP ? sanitizeInlineHtmlDubai(descP.html() || "") : "";
    const linkHtmlRaw = linkP ? linkP.html() || "" : "";

    let linkHref = "";
    let linkText = "";

    if (linkP) {
      const $$ = cheerio.load(`<root>${linkHtmlRaw}</root>`, null, false);
      rewriteAnchorsDubai($$);
      const a = $$("a").first();
      if (a.length) {
        linkHref = a.attr("href") || "";
        linkText = cleanText(a.text());
      } else {
        linkText = cleanText($$("root").text());
      }
    }

    let imageSrc = "";
    let imageAlt = "";
    if (imgNode) {
      imageSrc = imgNode.attr("src") || "";
      imageAlt = imgNode.attr("alt") || "";
    }

    if (!title) continue;

    rows.push({
      imageSrc,
      imageAlt,
      title,
      descHtml,
      linkHref,
      linkText,
    });
  }

  return rows;
}

/** -----------------------------
 * Events renderer (NEW)
 * Output MJML safe inside your existing mj-column:
 * Use mj-table for 30/70 layout, mj-divider for dotted lines
 * ----------------------------- */
function renderEventsDubai(events) {
  const list = (events || []).filter((e) => e && cleanText(e.title));
  if (!list.length) return "";

  const PLACEHOLDER =
    "https://www.dubaisummary.com/email/images/event-placeholder.jpg";

  return list
    .map((e, idx) => {
      const title = escapeHtml(cleanText(e.title || ""));
      const desc = e.descHtml || "";
      const href = e.linkHref ? escapeHtml(e.linkHref) : "";
      const linkText = escapeHtml(cleanText(e.linkText || ""));
      const imgSrc = e.imageSrc ? escapeHtml(e.imageSrc) : PLACEHOLDER;
      const imgAlt = escapeHtml(e.imageAlt || "Event image");

      const linkLine = href
        ? `<a target="_blank" href="${href}" style="text-decoration: none; border-bottom: 2px solid #102341; color: black;">${linkText}</a>`
        : linkText;

      const imgCell = `
<td width="30%" valign="top" style="padding:0;">
  ${href ? `<a href="${href}" target="_blank">` : ""}
  <img
    src="https://www.dubaisummary.com/email/images/REPLACE_ME.jpg"
    alt="REPLACE_ME"
    width="170"
    style="display:block;width:100%;max-width:170px;border-radius:8px;"
  />
  ${href ? `</a>` : ""}
</td>`;

      return `
<mj-table padding="${idx === 0 ? "0px 12px 0px 12px" : "5px 12px 0px 12px"}" width="100%" cellpadding="0" cellspacing="0">
<tr>
${imgCell}

<td width="70%" valign="top" style="padding:0 0 0 15px;font-family:Arial,sans-serif;color:#000;">

<p style="margin-bottom:7px;margin-top:6px;line-height:16px;font-size:16px;">
<strong>${title}</strong>
</p>

${
  !isEmptyRichText(desc)
    ? `<p style="margin:0 0 10px 0;line-height:24px;font-size:16px;">${desc}</p>`
    : ""
}

${
  linkLine
    ? `<p style="margin:0;line-height:24px;font-size:16px;">${linkLine}</p>`
    : ""
}

</td>
</tr>
</mj-table>

<mj-divider
  border-style="dashed"
  border-width="1px"
  border-color="lightgrey"
  padding="20px 22px 8px 22px"
/>
`;
    })
    .join("\n");
}

/** -----------------------------
 * Where to eat? extraction (UPDATED)
 * H3 "Where to eat?" -> first image + paragraphs
 * ----------------------------- */
function extractWhereToEatDubai(html) {
  const $ = cheerio.load(html);

  const whereH2 = $("h2")
    .filter(
      (_, el) => cleanText($(el).text()).toLowerCase() === "where to eat?",
    )
    .first();

  if (!whereH2.length) {
    return { imageSrc: "", imageAlt: "", imageHref: "", items: [] };
  }

  let imageSrc = "";
  let imageAlt = "";
  let imageHref = "";

  const items = [];
  let el = whereH2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    if (tag === "h2" && txt) break;

    if (!imageSrc) {
      if (tag === "img") {
        imageSrc = el.attr("src") || "";
        imageAlt = el.attr("alt") || "";
        el = el.next();
        continue;
      }

      if (tag === "p") {
        const img = el.find("img").first();
        if (img.length) {
          imageSrc = img.attr("src") || "";
          imageAlt = img.attr("alt") || "";

          const linkedImg = el.find("a img").first();
          if (linkedImg.length) {
            const a = linkedImg.parent("a");
            if (a.length) imageHref = a.attr("href") || "";
          }

          el = el.next();
          continue;
        }
      }

      if (tag === "div") {
        const img = el.find("img").first();
        if (img.length) {
          imageSrc = img.attr("src") || "";
          imageAlt = img.attr("alt") || "";

          const linkedImg = el.find("a img").first();
          if (linkedImg.length) {
            const a = linkedImg.parent("a");
            if (a.length) imageHref = a.attr("href") || "";
          }
        }
      }
    }

    if (tag === "p") {
      const htmlInner = el.html() || "";

      const hasOnlyImage =
        el.find("img").length > 0 && cleanText(el.text()).length === 0;

      if (!hasOnlyImage) {
        const item = parseWhereToEatParagraph(htmlInner);
        if (item) items.push(item);
      }

      if (!imageHref) {
        const $$ = cheerio.load(`<root>${htmlInner}</root>`, null, false);
        const a = $$("a").first();
        if (a.length && $$("img").length === 0) {
          imageHref = a.attr("href") || "";
        }
      }
    } else if (tag === "div") {
      const ps = el.children("p");
      if (ps.length) {
        ps.each((_, p) => {
          const pNode = $(p);
          const h = pNode.html() || "";

          const hasOnlyImage =
            pNode.find("img").length > 0 &&
            cleanText(pNode.text()).length === 0;

          if (!hasOnlyImage) {
            const item = parseWhereToEatParagraph(h);
            if (item) items.push(item);
          }

          if (!imageHref) {
            const $$ = cheerio.load(`<root>${h}</root>`, null, false);
            const a = $$("a").first();
            if (a.length && $$("img").length === 0) {
              imageHref = a.attr("href") || "";
            }
          }
        });
      }
    }

    el = el.next();
  }

  return { imageSrc, imageAlt, imageHref, items };
}

function extractImageCreditsDS(html) {
  const $ = cheerio.load(html);

  const h2 = $("h2")
    .filter(
      (_, el) => cleanText($(el).text()).toLowerCase() === "image credits",
    )
    .first();

  if (!h2.length) return "";

  const parts = [];
  let el = h2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    if (tag === "h2" && txt) break;

    if (tag === "p") {
      const inner = sanitizeInlineHtmlDubai(el.html() || "");
      if (!isEmptyRichText(inner)) parts.push(inner);
    } else if (tag === "ul" || tag === "ol") {
      const chunk = cheerio.load("<root></root>", null, false);
      chunk("root").append(el.clone());
      rewriteAnchorsDubai(chunk);

      let listHtml = chunk("root").children().first().toString();
      listHtml = listHtml
        .replace("<ul", '<ul style="margin: 0; padding-left: 18px;"')
        .replace("<ol", '<ol style="margin: 0; padding-left: 18px;"')
        .replace(
          /<li>/g,
          '<li style="font-size: 10px; line-height: 2; margin-bottom: 2px;">',
        );

      parts.push(listHtml);
    } else if (tag === "div") {
      el.children("p, ul, ol").each((_, child) => {
        const childTag = (child.tagName || "").toLowerCase();

        if (childTag === "p") {
          const inner = sanitizeInlineHtmlDubai($(child).html() || "");
          if (!isEmptyRichText(inner)) parts.push(inner);
        } else if (childTag === "ul" || childTag === "ol") {
          const chunk = cheerio.load("<root></root>", null, false);
          chunk("root").append($(child).clone());
          rewriteAnchorsDubai(chunk);

          let listHtml = chunk("root").children().first().toString();
          listHtml = listHtml
            .replace("<ul", '<ul style="margin: 0; padding-left: 18px;"')
            .replace("<ol", '<ol style="margin: 0; padding-left: 18px;"')
            .replace(
              /<li>/g,
              '<li style="font-size: 10px; line-height: 2; margin-bottom: 2px;">',
            );

          parts.push(listHtml);
        }
      });
    }

    el = el.next();
  }

  return parts.join(" ");
}

function parseWhereToEatParagraph(htmlInner) {
  const $ = cheerio.load(`<root>${htmlInner || ""}</root>`, null, false);

  const rawText = cleanText($("root").text());
  if (!rawText) return null;

  rewriteAnchorsDubai($);

  // wrap first link as <strong>restaurant</strong>
  const firstA = $("a").first();
  if (firstA.length) {
    const parentTag = (firstA.parent()[0]?.tagName || "").toLowerCase();
    if (parentTag !== "strong" && parentTag !== "b")
      firstA.wrap("<strong></strong>");
  }

  // allow only safe inline tags
  const allowed = new Set(["strong", "b", "em", "i", "a", "br"]);
  $("root")
    .find("*")
    .each((_, el) => {
      const tag = (el.tagName || "").toLowerCase();
      if (!allowed.has(tag)) $(el).replaceWith($(el).text());
    });

  const out = normalizeDashes($("root").html()?.trim() || "")
    .replace(/\s*-\s*>/g, " → ")
    .replace(/\s*→\s*/g, " → ");

  if (isEmptyRichText(out)) return null;
  return out;
}

function renderWhereToEatDubai(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return "";

  return list
    .map(
      (innerHtml) =>
        `<p style="font-size: 16px; line-height: 1.5; margin: 0 0 10px 0;">${innerHtml}</p>`,
    )
    .join("\n");
}

/** -----------------------------
 * Career (Dubai)
 * ----------------------------- */
function extractCareerDubai(html) {
  const $ = cheerio.load(html);

  const careerH2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "career")
    .first();

  if (!careerH2.length) return { title: "", tags: [], body: [] };

  let title = "";
  let el = careerH2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());
    if (tag === "h2" && txt) break;

    if (tag === "h3" && txt) {
      title = txt;
      el = el.next();
      break;
    }

    el = el.next();
  }

  if (!title) return { title: "", tags: [], body: [] };

  const paras = [];
  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());
    if (tag === "h2" && txt) break;

    if (tag === "p") {
      const h = el.html() || "";
      const cleaned = sanitizeInlineHtmlDubai(h);
      if (!isEmptyRichText(cleaned)) paras.push(cleaned);
    } else if (tag === "div") {
      const ps = el.children("p");
      if (ps.length) {
        ps.each((_, p) => {
          const h = $(p).html() || "";
          const cleaned = sanitizeInlineHtmlDubai(h);
          if (!isEmptyRichText(cleaned)) paras.push(cleaned);
        });
      }
    }

    el = el.next();
  }

  const tags = paras
    .slice(0, 3)
    .map((x) => cleanText(stripHtml(x)))
    .filter(Boolean);
  const body = paras.slice(3);

  return { title: cleanText(title), tags, body };
}

function renderCareerDubai(data) {
  const title = escapeHtml(cleanText(data?.title || ""));
  const tags = (data?.tags || []).filter(Boolean);
  const body = (data?.body || []).filter(Boolean);

  if (!title) return "";

  const titleBlock = `
<!-- Job Title -->
<mj-text
  padding="10px 12px"
  font-family="Austin News Text Web, TNYAdobeCaslonPro, 'Times New Roman', serif"
  color="#000000"
>
  <h2 style="font-size: 24px; line-height: 1.2; font-weight: 400; margin: 0;">
    ${title}
  </h2>
</mj-text>`.trim();

  const tagSpan = (t) =>
    `
<span
  style="
    display: inline-block;
    background-color: #eef2f9;
    padding: 6px 9px;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    line-height: 24px;
    margin-right: 8px;
    margin-bottom: 10px;
  "
>${escapeHtml(cleanText(t))}</span>`.trim();

  const tagsBlock = tags.length
    ? `
<!-- Tags -->
<mj-text padding="20px 12px" font-family="Arial, regular">
  ${tags.map(tagSpan).join("\n")}
</mj-text>`.trim()
    : "";

  const bodyBlock = body.length
    ? `
<!-- Summary / CTA -->
<mj-text padding="0px 12px 10px 12px" font-family="Arial" color="#000000">
  ${body
    .map((inner) => {
      return `<p style="font-size: 16px; line-height: 1.5; margin: 0 0 10px 0;">${inner}</p>`;
    })
    .join("\n")}
</mj-text>`.trim()
    : "";

  return [titleBlock, tagsBlock, bodyBlock].filter(Boolean).join("\n\n");
}

/** -----------------------------
 * Meanwhile (Dubai)
 * ----------------------------- */
function extractMeanwhileDubai(html) {
  const $ = cheerio.load(html);

  const h2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "meanwhile")
    .first();

  if (!h2.length) return [];

  const stories = [];
  let current = null;
  let el = h2.next();

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

    if (tag === "p") {
      current.nodes.push(el);
    } else if (tag === "div") {
      const ps = el.children("p");
      if (ps.length) ps.each((_, p) => current.nodes.push($(p)));
    }

    el = el.next();
  }

  if (current) stories.push(current);

  return stories.filter((s) => s.title && (s.nodes?.length || 0) > 0);
}

function renderMeanwhileDubai(stories) {
  const list = (stories || []).filter(Boolean);
  if (!list.length) return "";

  return list
    .map((s, idx) => {
      const title = escapeHtml(cleanText(s.title || ""));
      const body = (s.nodes || [])
        .map((p) => {
          const inner = sanitizeInlineHtmlDubai(p.html() || "");
          if (isEmptyRichText(inner)) return "";
          return `<p style="font-size: 16px; line-height: 1.5; margin: 0 0 10px 0;">${inner}</p>`;
        })
        .filter(Boolean)
        .join("\n");

      const divider =
        idx === list.length - 1
          ? ""
          : `
<mj-divider
  border-style="dashed"
  border-width="1px"
  border-color="lightgrey"
  padding="0px 12px 4px 12px"
/>`.trim();

      return `${idx === 0 ? `<mj-image border-radius="10px" padding="10px 12px" width="600px" src="https://www.dubaisummary.com/email/images/REPLACE_ME.jpg" alt="REPLACE_ME" href="https://www.dubaisummary.com/" target="_blank" />` : ""}
      
<mj-text
  padding="10px 12px"
  font-family="Austin News Text Web, TNYAdobeCaslonPro, 'Times New Roman', serif"
  color="#000000"
>
  <h2 style="font-size: 24px; line-height: 1.5; font-weight: 400; margin: 0;">
    ${title}
  </h2>
</mj-text>

<mj-text padding="10px 12px" font-family="Arial" color="#000000">
  ${body}
</mj-text>

${divider}
`.trim();
    })
    .join("\n\n");
}

/** -----------------------------
 * Did you know? (Dubai)
 * ----------------------------- */
function extractDidYouKnowDubai(html) {
  const $ = cheerio.load(html);

  const h2 = $("h2")
    .filter(
      (_, el) => cleanText($(el).text()).toLowerCase() === "did you know?",
    )
    .first();

  if (!h2.length) return [];

  const items = [];
  let el = h2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    if (tag === "h2" && txt) break;

    if (tag === "p") {
      const inner = el.html() || "";
      const parsed = parseDidYouKnowParagraph(inner);
      if (parsed) items.push(parsed);
    } else if (tag === "div") {
      const ps = el.children("p");
      if (ps.length) {
        ps.each((_, p) => {
          const inner = $(p).html() || "";
          const parsed = parseDidYouKnowParagraph(inner);
          if (parsed) items.push(parsed);
        });
      }
    }

    el = el.next();
  }

  return items;
}

function parseDidYouKnowParagraph(htmlInner) {
  const $ = cheerio.load(`<root>${htmlInner || ""}</root>`, null, false);

  const rawText = cleanText($("root").text());
  if (!rawText) return null;

  rewriteAnchorsDubai($);

  const allowed = new Set(["strong", "b", "em", "i", "a", "br"]);
  $("root")
    .find("*")
    .each((_, el) => {
      const tag = (el.tagName || "").toLowerCase();
      if (!allowed.has(tag)) $(el).replaceWith($(el).text());
    });

  const out = normalizeDashes($("root").html()?.trim() || "");
  if (isEmptyRichText(out)) return null;
  return out;
}

function renderDidYouKnowDubai(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return "";

  return list
    .map(
      (innerHtml) =>
        `<p style="font-size: 16px; line-height: 1.5; margin: 0 0 10px 0;">${innerHtml}</p>`,
    )
    .join("\n");
}

/** -----------------------------
 * Meta fields (Dubai)
 * ----------------------------- */
function extractMetaFieldsDubai(html) {
  const $ = cheerio.load(html);

  const readAfterH2 = (label) => {
    const h2 = $("h2")
      .filter(
        (_, el) =>
          cleanText($(el).text()).toLowerCase() === label.toLowerCase(),
      )
      .first();

    if (!h2.length) return "";

    let el = h2.next();
    while (el && el.length) {
      const tag = (el[0]?.tagName || "").toLowerCase();

      if (tag === "p") {
        const inner = el.html() || "";
        const safe = sanitizeInlineHtmlDubai(inner);
        return safe;
      }

      if (tag === "div") {
        const p = el.find("p").first();
        if (p.length) {
          const inner = p.html() || "";
          const safe = sanitizeInlineHtmlDubai(inner);
          return safe;
        }
      }

      if (tag === "h2") break;

      el = el.next();
    }

    return "";
  };

  const previewText = readAfterH2("Preview text");
  const day = stripHtmlToText(readAfterH2("Day"));
  const date = stripHtmlToText(readAfterH2("Date"));
  const temperature = stripHtmlToText(readAfterH2("Temperature"));

  return {
    previewText: previewText || "",
    day: day || "",
    date: date || "",
    temperature: temperature || "",
  };
}

function stripHtmlToText(html) {
  const $ = cheerio.load(`<root>${html || ""}</root>`, null, false);
  return cleanText($("root").text());
}

/** -----------------------------
 * Inline sanitizer + anchors (Dubai styles)
 * ----------------------------- */
function rewriteAnchorsDubai($) {
  $("a").each((_, a) => {
    $(a).attr("target", "_blank");
    $(a).attr(
      "style",
      "text-decoration: none; border-bottom: 2px solid #102341; color: black;",
    );
  });
}

function sanitizeInlineHtmlDubai(html) {
  const $ = cheerio.load(`<root>${html || ""}</root>`, null, false);
  rewriteAnchorsDubai($);

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

function stripHtml(html) {
  const $ = cheerio.load(`<root>${html || ""}</root>`, null, false);
  return $("root").text();
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
  re.lastIndex = 0;
  return re.test(str);
}
