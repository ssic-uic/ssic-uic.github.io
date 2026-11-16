// Bolding group members in author lists: matching and the owner's exceptions.
const test = require("node:test");
const assert = require("node:assert");
const { parseAuthor, groupMembers, boldAuthors } = require("../lib/group-authors.js");

const people = { postdocs: [{ name: "Dževad Kozlica" }], grads: [{ name: "Shivam Singh" }, { name: "Prasadi Abeysinghe Arachchilage", family: "Abeysinghe Arachchilage" }] };
const alumni = [{ role: "Postdoctoral Researchers", people: ["Hyun Deog (Sam) Yoo", "Young-Sang Yu"] }, { role: "Graduate Students", people: ["Mark Wolfman", "Eva Allen"] }];
const rules = [
  { name: "Mark Wolfman", until: 2022, also: ["10.1/exception"] },
  { name: "Hyun Deog (Sam) Yoo", until: 2022 },
  { name: "Shivam Singh", not: ["10.1/sakshi"] },
];
const M = groupMembers(people, alumni);
const bold = (authors, year, doi = "10.1/x") => boldAuthors({ authors, year, doi }, M, rules);

test("author names parse into first initial and family name", () => {
  assert.deepStrictEqual(parseAuthor("Y.-S. Yu"), { first: "y", family: "yu" });
  assert.deepStrictEqual(parseAuthor("S. Kumar Singh"), { first: "s", family: "kumar singh" });
  assert.deepStrictEqual(parseAuthor("Cabana"), { first: "", family: "cabana" });
});

test("members match by family name and first initial, ignoring accents", () => {
  assert.deepStrictEqual(bold("A. Other, D. K. Kozlica, Y.-S. Yu, Y. Yu, X. Yu and J. Cabana", 2026), ["D. K. Kozlica", "Y.-S. Yu", "Y. Yu"]);
  assert.deepStrictEqual(bold("P. Abeysinghe Arachchilage and J. Cabana", 2026), ["P. Abeysinghe Arachchilage"]);
  assert.deepStrictEqual(bold("H. D. Yoo and J. Yoo", 2020), ["H. D. Yoo"], "nickname in parentheses ignored; other initials not bolded");
});

test("until, also and not", () => {
  assert.deepStrictEqual(bold("M. Wolfman and J. Cabana", 2022), ["M. Wolfman"]);
  assert.deepStrictEqual(bold("M. Wolfman and J. Cabana", 2023), [], "bolded after until");
  assert.deepStrictEqual(bold("M. Wolfman and J. Cabana", 2023, "10.1/exception"), ["M. Wolfman"], "the one-time exception");
  assert.deepStrictEqual(bold("H. D. Yoo and J. Cabana", 2023), []);
  assert.deepStrictEqual(bold("E. Allen and J. Cabana", 2030), ["E. Allen"], "no rule, no limit");
  assert.deepStrictEqual(bold("S. Singh and J. Cabana", 2023, "10.1/sakshi"), [], "same initial, someone else");
  assert.deepStrictEqual(bold("S. Singh and J. Cabana", 2027), ["S. Singh"]);
});
