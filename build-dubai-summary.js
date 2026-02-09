/**
 * build-dubai-summary.js (v1.3)
 * ----------------------------
 * ✅ DOCX -> Mammoth HTML
 * ✅ Extract:
 *   1) In this edition
 *   2) Spotlight (H2 "Spotlight" -> each H3 story)
 *      - Spotlight heading only for the 1st spotlight card
 *      - Insert AD block after spotlight #1
 *   3) Event -> "Where to eat?" (H2 "Event" -> H3 "Where to eat?" -> paragraphs until next H2)
 *   4) Career (H2 "Career" -> H3 title -> next 3 paragraphs = tags -> rest until next H2 = summary/cta paragraphs)
 * ✅ Inject into layout placeholders:
 *   {{%IN_THIS_EDITION_TABLE%}}
 *   {{%SPOTLIGHT_SECTION%}}
 *   {{%WHERE_TO_EAT_SECTION%}}
 *   {{%CAREER_SECTION%}}
 * ✅ Compile MJML -> HTML
 *
 * Usage:
 *   node build-dubai-summary.js "docx/dubai-summary/2026/feb/feb-5.docx"
 *
 * Requirements:
 *   npm i mjml mammoth cheerio
 *
 * Notes:
 * - This file is built to match the content structure in your Feb-5 DOCX.  [oai_citation:0‡feb-5.docx](sediment://file_00000000ff247230b4f85e822568d7ac)
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
const TOKEN_WHERE_TO_EAT_SECTION = /\{\{\%\s*WHERE_TO_EAT_SECTION\s*\%\}\}/g;
const TOKEN_CAREER_SECTION = /\{\{\%\s*CAREER_SECTION\s*\%\}\}/g;
const TOKEN_ROWS = /\{\{\%\s*ROWS\s*\%\}\}/g;
const TOKEN_MEANWHILE_SECTION = /\{\{\%\s*MEANWHILE_SECTION\s*\%\}\}/g;
const TOKEN_DID_YOU_KNOW_SECTION = /\{\{\%\s*DID_YOU_KNOW_SECTION\s*\%\}\}/g;
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

  // 4) Event -> Where to eat?
  const whereToEatItems = extractWhereToEatDubai(docHtml);
  console.log("🧩 Where to eat items:", whereToEatItems.length);
  const whereToEatHtml = renderWhereToEatDubai(whereToEatItems);

  // 5) Career
  const career = extractCareerDubai(docHtml);
  console.log("🧩 Career:", {
    title: career?.title || "",
    tags: (career?.tags || []).length,
    body: (career?.body || []).length,
  });
  const careerMjml = renderCareerDubai(career);

  // 6) Meanwhile
  const meanwhileStories = extractMeanwhileDubai(docHtml);
  console.log(
    "🧩 Meanwhile stories:",
    meanwhileStories.map((s) => s.title),
  );
  const meanwhileMjml = renderMeanwhileDubai(meanwhileStories);

  // 7) Did you know?
  const didYouKnowParas = extractDidYouKnowDubai(docHtml);
  console.log("🧩 Did you know paras:", didYouKnowParas.length);
  const didYouKnowHtml = renderDidYouKnowDubai(didYouKnowParas);

  // 6) Inject into layout
  let finalMjml = fs.readFileSync(LAYOUT_PATH, "utf8");

  if (!TOKEN_IN_THIS_EDITION.test(finalMjml)) {
    console.warn(
      "⚠️ Token {{%IN_THIS_EDITION_TABLE%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_IN_THIS_EDITION, inThisEditionMjml);

  if (!TOKEN_SPOTLIGHT_SECTION.test(finalMjml)) {
    console.warn("⚠️ Token {{%SPOTLIGHT_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_SPOTLIGHT_SECTION, spotlightMjml);

  if (!TOKEN_WHERE_TO_EAT_SECTION.test(finalMjml)) {
    console.warn(
      "⚠️ Token {{%WHERE_TO_EAT_SECTION%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_WHERE_TO_EAT_SECTION, whereToEatHtml);

  if (!TOKEN_CAREER_SECTION.test(finalMjml)) {
    console.warn("⚠️ Token {{%CAREER_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_CAREER_SECTION, careerMjml);

  if (!TOKEN_MEANWHILE_SECTION.test(finalMjml)) {
    console.warn("⚠️ Token {{%MEANWHILE_SECTION%}} not found in layout.mjml");
  }
  finalMjml = finalMjml.replace(TOKEN_MEANWHILE_SECTION, meanwhileMjml);

  if (!TOKEN_DID_YOU_KNOW_SECTION.test(finalMjml)) {
    console.warn(
      "⚠️ Token {{%DID_YOU_KNOW_SECTION%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_DID_YOU_KNOW_SECTION, didYouKnowHtml);

  // 7) MJML -> HTML
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
 * - Spotlight heading only on first spotlight card
 * - Insert ad block after spotlight #1
 * ----------------------------- */
function renderSpotlightDubai(stories) {
  if (!stories?.length) return "";

  const AD_BLOCK = `
<mj-section
  background-color="#eff1f4"
  css-class="border-line"
  padding="1px 0.5px 1px 1px"
  border-radius="5px"
>
  <mj-raw>
    <a href="https://link.dubaisummary.com/ds-5-feb-2026-p-ad-d5-1"
    target="_blank" style="color:black">
  </mj-raw>
  <mj-column background-color="#fff" border-radius="5px" padding="0px">
    <mj-spacer height="14px" />
    <mj-text padding="2px 12px 0px 12px" font-family="Arial" color="#000000">
      <p style="font-size: 12px; line-height: 1.2; margin: 0;">
        <i>Brand in residence: Washmen</i>
      </p>
    </mj-text>
    <mj-text
      padding="2px 12px 0px 12px"
      font-family="Austin News Text Web, TNYAdobeCaslonPro, 'Times New Roman', serif"
      color="white"
    >
      <h2
        style="
          padding-bottom: 8px;
          color: #102341;
          text-align: left;
          border-bottom: 2px solid #102341;
          font-size: 26px;
          line-height: 1.2;
          font-weight: 300;
          margin: 0;
        "
      >
        Laundry, dry cleaning, shoe &amp; bag restoration
      </h2>
    </mj-text>
    <mj-spacer height="12px" />
    <mj-image
      border-radius="10px"
      padding="10px 12px 14px 12px"
      width="600px"
      src="https://www.dubaisummary.com/email/ad/REPLACE_ME.jpg"
      alt="Washmen laundry, dry cleaning, and restoration service in Dubai"
    />
    <mj-text padding="10px 12px 0px 12px" font-family="Arial" color="#000000">
      <p style="font-size: 16px; line-height: 24px; margin: 0 0 10px 0;">
        Dubai moves fast. Your laundry should not slow you down.
        <a style="text-decoration: none; border-bottom: 2px solid #102341; color: black;">
          Washmen
        </a>
        collects, cleans, and delivers with hotel-grade care. Free delivery the next day!
      </p>
    </mj-text>
    <mj-text padding="0px 12px 10px 12px" font-family="Arial" color="#000000">
      <p style="font-size: 16px; line-height: 24px; margin: 0;">
        <a style="text-decoration: none; border-bottom: 2px solid #102341; color: black;">
          <strong>Download the app</strong>
        </a>
      </p>
    </mj-text>
    <mj-spacer height="6px" />
  </mj-column>
  <mj-raw></a></mj-raw>
</mj-section>
<mj-spacer height="10px" />
`.trim();

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

    <mj-text padding="10px 12px 16px 12px" font-family="Arial" color="#000000">
      ${bodyHtml}
    </mj-text>
  </mj-column>
</mj-section>
<mj-spacer height="10px" />
`.trim();

    // insert ad AFTER spotlight #1
    if (idx === 0 && stories.length > 1)
      return `${spotlightBlock}\n${AD_BLOCK}`;
    return spotlightBlock;
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
 * Event -> Where to eat? (Dubai)
 * ----------------------------- */
function extractWhereToEatDubai(html) {
  const $ = cheerio.load(html);

  const eventH2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "event")
    .first();

  if (!eventH2.length) return [];

  // find H3 "Where to eat?"
  let whereH3 = null;
  let el = eventH2.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    if (tag === "h2" && txt) break;
    if (tag === "h3" && txt && txt.toLowerCase() === "where to eat?") {
      whereH3 = el;
      break;
    }

    el = el.next();
  }

  if (!whereH3) return [];

  const items = [];
  el = whereH3.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    if (tag === "h2" && txt) break;

    if (tag === "p") {
      const htmlInner = el.html() || "";
      const item = parseWhereToEatParagraph(htmlInner);
      if (item) items.push(item);
    } else if (tag === "div") {
      const ps = el.children("p");
      if (ps.length) {
        ps.each((_, p) => {
          const h = $(p).html() || "";
          const item = parseWhereToEatParagraph(h);
          if (item) items.push(item);
        });
      }
    }

    el = el.next();
  }

  return items;
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

  // normalize arrow spacing
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
 * Rule:
 * - Find H2 "Career"
 * - Next H3 = job title
 * - Next 3 paragraphs = tags
 * - Remaining paragraphs until next H2 = body (summary + cta, etc.)
 * ----------------------------- */
function extractCareerDubai(html) {
  const $ = cheerio.load(html);

  const careerH2 = $("h2")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "career")
    .first();

  if (!careerH2.length) return { title: "", tags: [], body: [] };

  // find first H3 after Career
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

  // collect paragraphs until next H2
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
      // keep as-is (already sanitized inline HTML), just wrap in <p> with your style
      return `<p style="font-size: 16px; line-height: 1.5; margin: 0 0 10px 0;">${inner}</p>`;
    })
    .join("\n")}
</mj-text>`.trim()
    : "";

  return [titleBlock, tagsBlock, bodyBlock].filter(Boolean).join("\n\n");
}

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

    // stop when next big section starts
    if (tag === "h2" && txt) break;

    // each H3 starts a new story
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

    // collect paragraph content
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

      return `
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

    if (tag === "h2" && txt) break; // next section

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

  // must have text
  const rawText = cleanText($("root").text());
  if (!rawText) return null;

  // apply your DS anchor styling + target=_blank
  rewriteAnchorsDubai($);

  // allow only safe inline tags
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
