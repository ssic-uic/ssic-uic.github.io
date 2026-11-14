// Builds the site into dist/ from the data files in data/ and the sources in src/.
// Run with: npm run build
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const { validate } = require("./validate");

const root = path.join(__dirname, "..");
const out = path.join(root, "dist");
const read = f => YAML.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));

function loadData() {
  return {
    research: read("research.yml").themes,
    people: read("people.yml"),
    alumni: read("alumni.yml").groups,
    news: read("news.yml").items || [],
    publications: read("publications.yml") || [],
    openings: read("join.yml").openings || [],
  };
}

function siteFrom(d) {
  return {
    research: d.research,
    people: d.people,
    alumni: d.alumni,
    // draft news stays out of the public site until approved
    news: d.news.filter(n => n.status === "published").map(({ status, ...n }) => ({ ...n, date: String(n.date) })),
    publications: d.publications.map(p => ({
      year: String(p.year), title: p.title, authors: p.authors, journal: p.journal,
      citation: String(p.citation ?? ""), url: p.url, themes: p.themes || [],
    })),
    openings: d.openings,
    updated: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" }),
  };
}

function build() {
  const data = loadData();
  const errors = validate(data);
  if (errors.length) {
    console.error("Data problems, build stopped:\n- " + errors.join("\n- "));
    process.exit(1);
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "assets", "fonts"), { recursive: true });

  fs.copyFileSync(path.join(root, "src", "index.html"), path.join(out, "index.html"));
  for (const f of ["tokens.css", "styles.css", "app.js"]) {
    fs.copyFileSync(path.join(root, "src", f), path.join(out, "assets", f));
  }
  const fontDir = path.join(root, "node_modules", "@fontsource-variable", "schibsted-grotesk", "files");
  for (const f of ["schibsted-grotesk-latin-wght-normal.woff2", "schibsted-grotesk-latin-wght-italic.woff2"]) {
    fs.copyFileSync(path.join(fontDir, f), path.join(out, "assets", "fonts", f));
  }

  fs.writeFileSync(path.join(out, "assets", "data.js"), "window.SITE = " + JSON.stringify(siteFrom(data)) + ";\n");
  const chem = fs.readFileSync(path.join(root, "lib", "chem.js"), "utf8");
  fs.writeFileSync(path.join(out, "assets", "chem.js"), "(function(){ var module;\n" + chem + "\nwindow.chem = chem; })();\n");

  console.log(`Built dist/: ${data.publications.length} papers, ${data.news.filter(n => n.status === "published").length} published news items.`);
}

if (require.main === module) build();
module.exports = { loadData, siteFrom };
