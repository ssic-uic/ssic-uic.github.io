// The member pipeline: adding people in order, processing photos, and showing them.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const YAML = require("yaml");
const sharp = require("sharp");
const { slug, upsert, makePhoto, SIZE } = require("../scripts/add-member.js");
const { validate } = require("../scripts/validate.js");
const { loadData, siteFrom } = require("../scripts/build.js");

const root = path.join(__dirname, "..");
const people = () => YAML.parseDocument(fs.readFileSync(path.join(root, "data", "people.yml"), "utf8"));

test("photo file names drop diacritics and nicknames", () => {
  assert.strictEqual(slug("Dževad Kozlica"), "dzevad-kozlica");
  assert.strictEqual(slug("Hyun Deog (Sam) Yoo"), "hyun-deog-yoo");
  assert.strictEqual(slug("Catherine Barth-Yoakum"), "catherine-barth-yoakum");
});

test("a new member goes in alphabetical order by family name, keeping the file's comments", () => {
  const doc = people();
  upsert(doc, { name: "Ana Ávila", group: "grads", argonne: true, photo: "ana-avila.webp" });
  upsert(doc, { name: "Zoe Zhang", group: "undergrad" });
  const d = doc.toJS();
  const ana = d.grads.findIndex(m => m.name === "Ana Ávila");
  // after Abeysinghe Arachchilage and Anjanarambath, before Barth-Yoakum
  assert.strictEqual(d.grads[ana - 1].name, "Kavyasree Anjanarambath");
  assert.strictEqual(d.grads[ana + 1].name, "Catherine Barth-Yoakum");
  assert.deepStrictEqual(d.grads[ana], { name: "Ana Ávila", argonne: true, photo: "ana-avila.webp" });
  assert.strictEqual(d.undergrads.at(-1).name, "Zoe Zhang");
  assert.match(doc.toString(), /^# Current group members/);
  const errs = validate({ ...loadData(), people: d, photos: ["ana-avila.webp"] });
  assert.deepStrictEqual(errs, []);
});

test("an existing member (or the PI) just gets the photo; mistakes are refused", () => {
  const doc = people();
  const before = doc.toJS().grads.length;
  upsert(doc, { name: "Meghan Burns", photo: "meghan-burns.webp" });
  upsert(doc, { name: "Jordi Cabana", photo: "jordi-cabana.webp" });
  const d = doc.toJS();
  assert.strictEqual(d.grads.length, before);
  assert.strictEqual(d.grads.find(m => m.name === "Meghan Burns").photo, "meghan-burns.webp");
  assert.strictEqual(d.pi.photo, "jordi-cabana.webp");
  assert.throws(() => upsert(people(), { name: "New Person" }), /which --group/);
  assert.throws(() => upsert(people(), { name: "Meghan Burns", group: "postdocs" }), /already listed under grads/);
  assert.throws(() => upsert(people(), { name: "New Person", group: "faculty" }), /--group must be/);
});

test("validation catches missing photos, leftover photos and out-of-order names", () => {
  const d = loadData().people;
  const ppl = { ...d, grads: [...d.grads, { name: "Aaron Aardvark" }], undergrads: [{ name: "Hannah Hicks", photo: "hannah-hicks.webp" }] };
  const errs = validate({ people: ppl, photos: ["someone-who-left.webp"] });
  assert.ok(errs.some(e => /Aaron Aardvark should come before/.test(e)), errs.join("\n"));
  assert.ok(errs.some(e => /hannah-hicks.webp not found/.test(e)));
  assert.ok(errs.some(e => /someone-who-left.webp isn't used/.test(e)));
});

test("photos are cropped square, resized, rotated upright and stripped of metadata", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-"));
  // a 1200×800 landscape JPEG stored sideways (EXIF orientation 6) with camera metadata
  const src = path.join(dir, "in.jpg");
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#4a7" } })
    .jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Make: "TestCam", Artist: "someone" } } }).toFile(src);
  assert.ok((await sharp(src).metadata()).exif, "test input should carry EXIF");
  const { file, warn } = await makePhoto(src, "Dževad Kozlica", "attention", dir);
  assert.strictEqual(file, "dzevad-kozlica.webp");
  assert.strictEqual(warn, null);
  const m = await sharp(path.join(dir, file)).metadata();
  assert.strictEqual(m.format, "webp");
  assert.deepStrictEqual([m.width, m.height], [SIZE, SIZE]);
  assert.strictEqual(m.exif, undefined);
  assert.ok(!m.orientation || m.orientation === 1);
  assert.ok(fs.statSync(path.join(dir, file)).size < 60_000, "photo should be small");

  const small = path.join(dir, "small.png");
  await sharp({ create: { width: 300, height: 400, channels: 3, background: "#000" } }).png().toFile(small);
  assert.match((await makePhoto(small, "Small One", "top", dir)).warn, /only 300 px/);
  await assert.rejects(makePhoto(path.join(dir, "missing.jpg"), "X", "attention", dir), /Can't read/);
  await assert.rejects(makePhoto(small, "X", "sideways", dir), /--focus must be/);
  fs.rmSync(dir, { recursive: true });
});

test("members with a photo show it; everyone else keeps their initials", async () => {
  const { JSDOM, VirtualConsole } = require("jsdom");
  const site = siteFrom(loadData());
  site.people.pi.photo = "assets/photos/jordi-cabana.webp?v=1";
  site.people.grads[0].photo = "assets/photos/prasadi.webp?v=1";
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => { if (!/scrollTo|Could not load/.test(e.message)) errors.push(e.message); });
  const chem = fs.readFileSync(path.join(root, "lib", "chem.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8")
    .replace('<script src="assets/data.js"></script>', () => `<script>window.SITE=${JSON.stringify(site)}</script>`)
    .replace('<script src="assets/chem.js"></script>', () => `<script>(function(){ var module;\n${chem}\nwindow.chem = chem; })();</script>`)
    .replace('<script src="assets/app.js"></script>', () => `<script>${fs.readFileSync(path.join(root, "src", "app.js"), "utf8")}</script>`);
  const dom = new JSDOM(html, { runScripts: "dangerously", virtualConsole: vc, pretendToBeVisual: true, url: "https://example.test/#people" });
  dom.window.scrollTo = () => {};
  await new Promise(r => setTimeout(r, 100));
  const d = dom.window.document;
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(d.querySelector("#pi img.ph").getAttribute("src"), "assets/photos/jordi-cabana.webp?v=1");
  const first = d.querySelector("#grads .person");
  assert.strictEqual(first.querySelector("img.ph").getAttribute("alt"), "");
  assert.strictEqual(d.querySelectorAll("#grads img.ph").length, 1);
  assert.strictEqual(d.querySelector("#grads .person:nth-child(2) div.ph").textContent, "KA");
});
