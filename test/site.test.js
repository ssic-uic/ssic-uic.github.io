// Checks the data files are valid and the built page renders without errors.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { loadData } = require("../scripts/build.js");
const { validate } = require("../scripts/validate.js");

const root = path.join(__dirname, "..");

test("data files are valid", () => {
  assert.deepStrictEqual(validate(loadData()), []);
});

test("build writes canonical link, sitemap and robots.txt for search engines", () => {
  execFileSync("node", [path.join(root, "scripts", "build.js")], { stdio: "pipe" });
  const dist = path.join(root, "dist");
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const canon = html.match(/<link rel="canonical" href="([^"]+)">/);
  assert.ok(canon, "canonical link missing");
  const site = canon[1];
  assert.match(site, /^https:\/\/[^#]+\/$/);
  const sitemap = fs.readFileSync(path.join(dist, "sitemap.xml"), "utf8");
  assert.ok(sitemap.includes(`<loc>${site}</loc>`), "sitemap lacks the site URL");
  assert.match(sitemap, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.ok(fs.readFileSync(path.join(dist, "robots.txt"), "utf8").includes(`Sitemap: ${site}sitemap.xml`));
});

test("built page renders every section without script errors", async () => {
  execFileSync("node", [path.join(root, "scripts", "build.js")], { stdio: "pipe" });
  const { JSDOM, VirtualConsole } = require("jsdom");
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => { if (!/scrollTo|Could not load/.test(e.message)) errors.push(e.message); });
  const dist = path.join(root, "dist");
  let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  // inline the local scripts so jsdom runs them without a server
  html = html.replace(/<script src="(assets\/[^"]+)"><\/script>/g, (_, f) => `<script>${fs.readFileSync(path.join(dist, f), "utf8")}</script>`);
  const dom = new JSDOM(html, { runScripts: "dangerously", virtualConsole: vc, pretendToBeVisual: true, url: "https://example.test/#home" });
  dom.window.scrollTo = () => {};
  await new Promise(r => setTimeout(r, 200));
  const d = dom.window.document;
  const data0 = loadData();
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(d.querySelectorAll("#home-areas .area").length, loadData().research.length);
  assert.ok(d.querySelectorAll("#publist .pub").length > 0, "publications list is empty");
  assert.ok(d.querySelector("#pi h2").textContent.length > 0, "PI profile missing");
  assert.ok(d.querySelectorAll("#research-rows .rrow").length > 0, "research themes missing");

  // Research: each theme shows the papers the owner chose
  const rows = [...d.querySelectorAll("#research-rows .rrow")];
  data0.research.forEach((r, i) => {
    // exactly the owner's chosen papers, newest first
    const chosen = (r.papers || []).map(x => String(x).toLowerCase());
    const want = data0.publications.filter(p => !p.hide && chosen.includes(String(p.doi || "").toLowerCase())).map(p => p.url);
    assert.strictEqual(want.length, chosen.length, `${r.key}: a chosen paper is missing or hidden`);
    const got = [...rows[i].querySelectorAll(".papers li a")].map(a => a.getAttribute("href"));
    assert.deepStrictEqual(got, want, `Research papers for ${r.key}`);
  });

  // People: every group from the data files appears, and PI roles with a url become links
  const data = loadData();
  for (const g of ["postdocs", "grads", "undergrads"]) {
    const sel = { postdocs: "#postdocs", grads: "#grads", undergrads: "#undergrads" }[g];
    assert.strictEqual(d.querySelectorAll(`${sel} .person`).length, (data.people[g] || []).length, `${g} count`);
  }
  assert.strictEqual(d.querySelectorAll("#alumni > div").length, data.alumni.length, "alums groups");
  const roleLinks = [...d.querySelectorAll("#pi .role a")].map(a => a.href);
  data.people.pi.roles.filter(r => r.url).forEach(r => assert.ok(roleLinks.includes(r.url), `PI role link ${r.url} missing`));
});
