// Offline checks for the publication sync's formatting rules (no network).
const test = require("node:test");
const assert = require("node:assert");
const { authorList, initials, fromCrossref, guessThemes, plain, normDoi } = require("../scripts/sync-publications.js");

test("initials handle hyphens and existing initials", () => {
  assert.strictEqual(initials("Jordi"), "J.");
  assert.strictEqual(initials("Jean-Marie"), "J.-M.");
  assert.strictEqual(initials("P. F. B. D."), "P. F. B. D.");
  assert.strictEqual(initials("Bob Jin"), "B. J.");
});

test("author list joins the last name with 'and'", () => {
  assert.strictEqual(authorList([{ given: "Hao", family: "Li" }, { given: "Jordi", family: "Cabana" }]), "H. Li and J. Cabana");
  assert.strictEqual(authorList([{ given: "A", family: "One" }, { given: "B", family: "Two" }, { given: "C", family: "Three" }]), "A. One, B. Two and C. Three");
  assert.strictEqual(authorList([{ name: "ESRA Collaboration" }]), "ESRA Collaboration");
});

test("titles lose markup but keep the formula text", () => {
  assert.strictEqual(plain("Active States of MoS<sub>2</sub> &amp; CO<sub>2</sub>"), "Active States of MoS2 & CO2");
});

test("Crossref record maps to our fields, year from first appearance", () => {
  const c = fromCrossref({
    title: ["Spinel <i>frameworks</i>"],
    author: [{ given: "Jordi", family: "Cabana" }],
    "short-container-title": ["Acc. Chem. Res."],
    volume: "57", page: "9-19",
    issued: { "date-parts": [[2023, 12, 20]] },
    "published-print": { "date-parts": [[2024, 1, 2]] },
  });
  assert.strictEqual(c.year, 2023);
  assert.strictEqual(c.published, "2023-12-20");
  assert.strictEqual(c.citation, "57, 9–19");
  assert.strictEqual(c.journal, "Acc. Chem. Res.");
  assert.strictEqual(c.title, "Spinel frameworks");
  assert.ok(c.hasCabana);
});

test("article numbers and missing Cabana are handled", () => {
  const c = fromCrossref({ title: ["X"], author: [{ given: "A", family: "B" }], volume: "123", "article-number": "213904", issued: { "date-parts": [[2023]] } });
  assert.strictEqual(c.citation, "123, 213904");
  assert.strictEqual(c.hasCabana, false);
});

test("theme guesses and DOI normalisation", () => {
  assert.deepStrictEqual(guessThemes("Mg intercalation in spinel cathodes"), ["ion"]);
  assert.deepStrictEqual(guessThemes("Operando X-ray imaging of oxygen redox in Li-rich cathodes"), ["ion", "redox", "xray"]);
  assert.strictEqual(normDoi("https://doi.org/10.1021/JACS.5C07442"), "10.1021/jacs.5c07442");
});

test("formula pieces split by Crossref markup are rejoined", () => {
  assert.strictEqual(plain("performance of α-V <sub>2</sub> O <sub>5</sub> as a Mg <sup>2+</sup> intercalation host"), "performance of α-V2O5 as a Mg2+ intercalation host");
  assert.strictEqual(plain("Evolution upon Redox Swings of Li <sub>3</sub> IrO <sub>4</sub>"), "Evolution upon Redox Swings of Li3IrO4");
  assert.strictEqual(plain("CO <sub>2</sub> reduction"), "CO2 reduction");
});

test("APS MathML formulas collapse to plain text", () => {
  assert.strictEqual(plain('Changes in <mml:math><mml:mrow><mml:msub><mml:mi>Li</mml:mi>\n<mml:mn>2</mml:mn></mml:msub>\n<mml:mi>Ru</mml:mi><mml:msub><mml:mi mathvariant="normal">O</mml:mi>\n<mml:mn>3</mml:mn></mml:msub></mml:mrow></mml:math> induced'), "Changes in Li2RuO3 induced");
});

const { notArticleReason, publishedVersion } = require("../scripts/sync-publications.js");

test("only peer-reviewed journal articles pass", () => {
  assert.strictEqual(notArticleReason({ type: "journal-article", "container-title": ["Chemistry of Materials"], page: "100-110" }), "");
  assert.strictEqual(notArticleReason({ type: "journal-article", "container-title": ["Microscopy and Microanalysis"], page: "1547-1548" }), "conference abstract");
  assert.strictEqual(notArticleReason({ type: "journal-article", "container-title": ["Microscopy and Microanalysis"], page: "100-112" }), "");
  assert.strictEqual(notArticleReason({ type: "journal-article", "container-title": ["Acta Crystallographica Section A Foundations and Advances"], page: "a119-a119" }), "conference abstract");
  assert.strictEqual(notArticleReason({ type: "journal-article", "container-title": ["ECS Meeting Abstracts"] }), "conference abstract or proceedings");
  assert.strictEqual(notArticleReason({ type: "journal-article", "container-title": ["MRS Proceedings"] }), "conference abstract or proceedings");
  assert.strictEqual(notArticleReason({ type: "posted-content" }), "preprint");
  assert.strictEqual(notArticleReason({ type: "book-chapter" }), "book or book chapter");
  assert.strictEqual(notArticleReason({ type: "proceedings-article" }), "conference proceedings");
});

test("a preprint's published version is found", () => {
  assert.strictEqual(publishedVersion({ relation: { "is-preprint-of": [{ "id-type": "doi", id: "10.1021/ACS.CHEMREV.5C00772" }] } }), "10.1021/acs.chemrev.5c00772");
  assert.strictEqual(publishedVersion({}), "");
});

test("Microscopy and Microanalysis abstracts without page ranges are left out", () => {
  assert.strictEqual(notArticleReason({ type: "journal-article", "container-title": ["Microscopy and Microanalysis"], issue: "Supplement_1" }), "conference abstract");
  assert.strictEqual(notArticleReason({ type: "journal-article", "short-container-title": ["Microsc Microanal"] }), "conference abstract");
});

test("corresponding authorship from OpenAlex flags", () => {
  const { cabanaCorresponds } = require("../scripts/sync-publications.js");
  const au = (name, corr, orcid) => ({ author: { display_name: name, orcid: orcid ? `https://orcid.org/${orcid}` : null }, is_corresponding: corr });
  const me = "0000-0002-2353-5986";
  assert.strictEqual(cabanaCorresponds([au("A. Student", false), au("Jordi Cabana", true, me)], me), true);
  assert.strictEqual(cabanaCorresponds([au("A. Student", false), au("J. Cabana-Jiménez", true)], me), true, "matched by name without ORCID");
  assert.strictEqual(cabanaCorresponds([au("Jordi Cabana", false, me), au("H. D. Yoo", true)], me), false);
  assert.strictEqual(cabanaCorresponds([au("Jordi Cabana", true, me), au("D. J. Siegel", true)], me), true, "co-corresponding counts");
  assert.strictEqual(cabanaCorresponds([au("Jordi Cabana", false, me), au("H. D. Yoo", false)], me), null, "nobody flagged = unknown");
  assert.strictEqual(cabanaCorresponds(undefined, me), null);
});
