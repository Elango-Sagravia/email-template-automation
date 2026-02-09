/**
 * build-dubai-summary.js
 * ---------------------
 * v1.1 (In this edition + Spotlight + Did you know)
 *
 * - DOCX -> Mammoth HTML
 * - Extract:
 *   - "In this edition" items
 *   - Spotlight stories (Spotlight heading -> multiple story titles + body)
 *   - "Did you know?" line
 * - Inject into layout placeholders:
 *   {{%IN_THIS_EDITION_TABLE%}}
 *   {{%SPOTLIGHT_SECTION%}}
 *   {{%DID_YOU_KNOW_SECTION%}}
 * - Compile MJML -> HTML
 *
 * Usage:
 *   node build-dubai-summary.js "docx/dubai-summary/2026/feb/feb-5.docx"
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
const TOKEN_DID_YOU_KNOW_SECTION = /\{\{\%\s*DID_YOU_KNOW_SECTION\s*\%\}\}/g;
const TOKEN_ROWS = /\{\{\%\s*ROWS\s*\%\}\}/g;

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
      // keep if you ever embed images in docx; harmless otherwise
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

  // 4) Did you know
  const didYouKnow = extractDidYouKnowDubai(docHtml);
  console.log("🧩 Did you know:", didYouKnow);
  const didYouKnowHtml = renderDidYouKnowDubai(didYouKnow);

  // 5) Inject into layout
  const layoutMjml = fs.readFileSync(LAYOUT_PATH, "utf8");
  let finalMjml = layoutMjml;

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

  if (!TOKEN_DID_YOU_KNOW_SECTION.test(finalMjml)) {
    console.warn(
      "⚠️ Token {{%DID_YOU_KNOW_SECTION%}} not found in layout.mjml",
    );
  }
  finalMjml = finalMjml.replace(TOKEN_DID_YOU_KNOW_SECTION, didYouKnowHtml);

  // 6) MJML -> HTML
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

  // Case 2: Paragraph lines after marker
  const items = [];
  let el = marker.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());
    const lower = txt.toLowerCase();

    // stop at next big section
    if (tag === "h2" && txt) break;
    if (tag === "h3" && txt) break;
    if (tag === "p" && lower === "spotlight") break;

    if (tag === "p") {
      if (!txt) break;

      // skip weekday/date-ish line
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

  return Array.from(new Set(items)).filter(Boolean);
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
 * Spotlight (Dubai)
 * Goal:
 * - Find "Spotlight"
 * - Extract multiple stories:
 *   title: heading-ish line after spotlight OR later headings
 *   body: paragraphs until next title or next big section (Event/Career/Meanwhile/Did you know)
 * - Render:
 *   - Include the Spotlight heading table ONLY for story #1
 * ----------------------------- */
function extractSpotlightDubai(html) {
  const $ = cheerio.load(html);

  const marker = $("p, h2, h3")
    .filter((_, el) => cleanText($(el).text()).toLowerCase() === "spotlight")
    .first();

  if (!marker.length) return [];

  const STOP_SECTIONS = new Set([
    "event",
    "career",
    "meanwhile",
    "did you know?",
    "did you know",
    "fact:",
    "fact",
  ]);

  const stories = [];
  let current = null;

  let el = marker.next();

  // helper: start a story
  const startStory = (title) => {
    if (current && current.title && current.nodes.length) stories.push(current);
    current = { title: title || "", nodes: [] };
  };

  // First story title is usually the next non-empty line after "Spotlight"
  // could be <h2>/<h3> or a <p> line (Word style varies)
  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());
    const lower = txt.toLowerCase();

    if (!txt) {
      el = el.next();
      continue;
    }

    // Stop if we immediately hit another major section
    if ((tag === "h2" || tag === "h3") && STOP_SECTIONS.has(lower)) break;
    if (tag === "p" && STOP_SECTIONS.has(lower)) break;

    // If it's a heading or looks like a heading line, treat as title
    if (tag === "h2" || tag === "h3" || looksLikeTitleLine(el)) {
      startStory(txt);
      el = el.next();
      break;
    }

    // fallback: if it's just text, use it as title anyway
    startStory(txt);
    el = el.next();
    break;
  }

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());
    const lower = txt.toLowerCase();

    // stop at next big section
    if ((tag === "h2" || tag === "h3") && txt && STOP_SECTIONS.has(lower))
      break;
    if (tag === "p" && txt && STOP_SECTIONS.has(lower)) break;

    // new story title (often plain line between spotlight stories)
    if (txt && (tag === "h2" || tag === "h3" || looksLikeTitleLine(el))) {
      startStory(txt);
      el = el.next();
      continue;
    }

    // collect body nodes
    if (!current) {
      el = el.next();
      continue;
    }

    if (tag === "p" || tag === "ul" || tag === "ol") {
      // ignore very short “Spotlight” repeats or empty
      if (tag === "p" && !txt) {
        el = el.next();
        continue;
      }
      current.nodes.push(el);
    } else if (tag === "div") {
      const children = el.children("p, ul, ol");
      if (children.length) children.each((_, c) => current.nodes.push($(c)));
    }

    el = el.next();
  }

  if (current && current.title && current.nodes.length) stories.push(current);

  // cleanup: remove titles that are actually stop headings
  return stories
    .map((s) => ({
      title: cleanText(s.title || ""),
      nodes: s.nodes || [],
    }))
    .filter((s) => s.title && !STOP_SECTIONS.has(s.title.toLowerCase()));
}

function looksLikeTitleLine($el) {
  // If Word bolded the title, Mammoth often outputs: <p><strong>Title</strong></p>
  const html = ($el.html?.() || "").trim().toLowerCase();
  const txt = cleanText($el.text?.() || "");
  if (!txt) return false;

  const strongOnly =
    html.startsWith("<strong>") &&
    html.endsWith("</strong>") &&
    txt.length <= 80;

  // Also treat short-ish lines as titles if they don't end with a period
  const shortNoPeriod = txt.length <= 60 && !/[.!?]$/.test(txt);

  return strongOnly || shortNoPeriod;
}

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
    <a href="https://link.dubaisummary.com/REPLACE_ME"
    target="_blank" style="color:black">
  </mj-raw>
  <mj-column background-color="#fff" border-radius="5px" padding="0px">
    <mj-spacer height="14px" />
    <mj-text padding="2px 12px 0px 12px" font-family="Arial" color="#000000">
      <p style="font-size: 12px; line-height: 1.2">
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
        Laundry, dry cleaning, shoe & bag restoration
      </h2>
    </mj-text>
    <mj-spacer height="12px" />
    <mj-image
      border-radius="10px"
      padding="10px 12px 14px 12px"
      width="600px"
      src="https://www.dubaisummary.com/email/ad/REPLACE_ME.jpg"
      alt="REPLACE_ME"
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

  return stories
    .map((s, idx) => {
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

      // ✅ Insert AD after first spotlight
      if (idx === 0 && stories.length > 1) {
        return `${spotlightBlock}\n${AD_BLOCK}`;
      }

      return spotlightBlock;
    })
    .join("\n\n");
}

function renderSpotlightBodyDubai(nodes) {
  const parts = [];

  for (const node of nodes || []) {
    const tag = (node[0]?.tagName || "").toLowerCase();

    if (tag === "p") {
      const txt = cleanText(node.text() || "");
      if (!txt) continue;

      // If paragraph starts with "Summary:" make it bold like your sample
      const isSummary = /^summary\s*:/i.test(txt);

      const inner = sanitizeInlineHtmlDubai(node.html() || "");

      if (isEmptyRichText(inner)) continue;

      if (isSummary) {
        parts.push(
          `<p style="font-size: 16px; line-height: 1.5; margin: 0 0 10px 0;"><strong>${escapeHtml(
            txt,
          )}</strong></p>`,
        );
      } else {
        parts.push(
          `<p style="font-size: 16px; line-height: 1.5; margin: 0 0 10px 0;">${inner}</p>`,
        );
      }
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

  // remove extra bottom margin on last paragraph
  if (parts.length) {
    parts[parts.length - 1] = parts[parts.length - 1].replace(
      /margin:\s*0\s*0\s*10px\s*0;/g,
      "margin: 0;",
    );
  }

  return parts.join("\n");
}

/** -----------------------------
 * Did you know? (Dubai)
 * ----------------------------- */
function extractDidYouKnowDubai(html) {
  const $ = cheerio.load(html);

  const marker = $("p, h2, h3")
    .filter((_, el) => {
      const t = cleanText($(el).text()).toLowerCase();
      return t === "did you know?" || t === "did you know";
    })
    .first();

  if (!marker.length) return "";

  const lines = [];
  let el = marker.next();

  while (el && el.length) {
    const tag = (el[0]?.tagName || "").toLowerCase();
    const txt = cleanText(el.text());

    // stop at next heading or end
    if ((tag === "h2" || tag === "h3") && txt) break;

    if (tag === "p") {
      if (!txt) break;
      lines.push(txt);
    } else if (tag === "div") {
      const ps = el.children("p");
      if (ps.length) {
        ps.each((_, p) => {
          const t = cleanText($(p).text());
          if (t) lines.push(t);
        });
      }
    }

    // usually only one paragraph; stop after first non-empty chunk
    if (lines.length) break;

    el = el.next();
  }

  return lines.join(" ").trim();
}

function renderDidYouKnowDubai(text) {
  const safe = escapeHtml(cleanText(text || ""));
  if (!safe) return "";
  // Your layout already centers this mj-text, so return a clean paragraph
  return `<p style="font-size: 16px; line-height: 1.5; margin: 0;">${safe}</p>`;
}

/** -----------------------------
 * Inline HTML sanitizer + anchors (Dubai styles)
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
  const $ = cheerio.load(`<root>${html}</root>`, null, false);
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
