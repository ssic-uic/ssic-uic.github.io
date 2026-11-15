// Importing a folder of dropped photos: matching file names to members, skipping
// repeats, and leaving anything unclear to the owner.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const YAML = require("yaml");
const sharp = require("sharp");
const { execFileSync } = require("child_process");
const { importPhotos, matchName, rosterOf } = require("../scripts/import-photos.js");

const root = path.join(__dirname, "..");
const roster = rosterOf(YAML.parse(fs.readFileSync(path.join(root, "data", "people.yml"), "utf8")));

test("file names are matched to members whatever the order, case or accents", () => {
  const m = f => matchName(f, roster).name || matchName(f, roster).error;
  assert.strictEqual(m("Meghan Burns.jpg"), "Meghan Burns");
  assert.strictEqual(m("burns_meghan headshot.HEIC"), "Meghan Burns");
  assert.strictEqual(m("Dzevad Kozlica (2026-11-16 15.02 UTC).png"), "Dževad Kozlica");
  assert.strictEqual(m("KIN-LUNG-SEETHO.jpeg"), "Kin Lung Seetho");
  assert.strictEqual(m("jordi cabana 2026.jpg"), "Jordi Cabana");
  assert.match(m("Burns.jpg"), /no current member/);
  assert.match(m("IMG_4021.jpg"), /no current member/);
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "import-"));
  const drop = path.join(dir, "drop");
  fs.mkdirSync(drop);
  fs.copyFileSync(path.join(root, "data", "people.yml"), path.join(dir, "people.yml"));
  return { dir, drop, opts: { peoplePath: path.join(dir, "people.yml"), photosDir: path.join(dir, "photos"), intakePath: path.join(dir, "intake.yml") } };
}
const jpeg = (file, color, w = 900, h = 1200) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toFile(file);

test("a folder is imported once; repeats are skipped and unclear files go to the owner", async () => {
  const { dir, drop, opts } = scratch();
  await jpeg(path.join(drop, "Meghan Burns.jpg"), "#a33");
  await jpeg(path.join(drop, "IMG_4021.jpg"), "#3a3");
  fs.writeFileSync(path.join(drop, "notes.txt"), "hi");

  const dry = await importPhotos(drop, { ...opts, dryRun: true });
  assert.deepStrictEqual(dry.imported.map(i => i.name), ["Meghan Burns"]);
  assert.ok(!fs.existsSync(opts.photosDir), "a dry run writes nothing");

  const r = await importPhotos(drop, opts);
  assert.deepStrictEqual(r.imported.map(i => [i.name, i.photo]), [["Meghan Burns", "data/photos/meghan-burns.webp"]]);
  assert.deepStrictEqual(r.needs_owner.map(n => n.file).sort(), ["IMG_4021.jpg", "notes.txt"]);
  const people = YAML.parse(fs.readFileSync(opts.peoplePath, "utf8"));
  assert.strictEqual(people.grads.find(g => g.name === "Meghan Burns").photo, "meghan-burns.webp");
  const meta = await sharp(path.join(opts.photosDir, "meghan-burns.webp")).metadata();
  assert.deepStrictEqual([meta.width, meta.height], [480, 480]);
  const intake = YAML.parse(fs.readFileSync(opts.intakePath, "utf8")).imported;
  assert.strictEqual(intake.length, 1);
  assert.deepStrictEqual(Object.keys(intake[0]).sort(), ["date", "name", "sha1"]);

  const again = await importPhotos(drop, opts);
  assert.deepStrictEqual(again.imported, []);
  assert.deepStrictEqual(again.skipped.map(s => s.reason), ["already imported"]);
  fs.rmSync(dir, { recursive: true });
});

test("when someone uploads twice, the newest photo wins", async () => {
  const { dir, drop, opts } = scratch();
  const older = path.join(drop, "Shivam Singh.jpg"), newer = path.join(drop, "Shivam Singh (1).jpg");
  await jpeg(older, "#000");
  await jpeg(newer, "#fff");
  fs.utimesSync(older, new Date("2026-11-01"), new Date("2026-11-01"));
  const r = await importPhotos(drop, opts);
  assert.deepStrictEqual(r.imported.map(i => i.file), ["Shivam Singh (1).jpg"]);
  assert.match(r.skipped[0].reason, /older than another new photo/);
  const { channels, ...px } = await sharp(path.join(opts.photosDir, "shivam-singh.webp")).stats();
  assert.ok(channels[0].mean > 200, "the newer (white) photo was used");
  fs.rmSync(dir, { recursive: true });
});

const hasHeif = (() => { try { execFileSync("python3", ["-c", "import pillow_heif"], { stdio: "pipe" }); return true; } catch { return false; } })();
test("iPhone HEIC photos are converted", { skip: !hasHeif && "pillow-heif not installed" }, async () => {
  const { dir, drop, opts } = scratch();
  execFileSync("python3", ["-c", "import sys, pillow_heif; from PIL import Image; pillow_heif.register_heif_opener(); Image.new('RGB',(600,800),(40,90,160)).save(sys.argv[1])", path.join(drop, "Erica Strojny.HEIC")]);
  const r = await importPhotos(drop, opts);
  assert.deepStrictEqual(r.imported.map(i => i.name), ["Erica Strojny"]);
  fs.rmSync(dir, { recursive: true });
});
