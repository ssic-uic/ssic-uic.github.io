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

test("uncertain matches: two members, or outsiders share the family name; held until answered", () => {
  const { ambiguousAuthors } = require("../lib/group-authors.js");
  const al = [{ role: "Graduate Students", people: ["Haifeng Li", "Hong Li", "Neelam Sunariwal", "Eva Allen"] }];
  const M2 = groupMembers({}, al);
  const listed = [{ doi: "10.1/old", year: 2020, authors: "X. Li, J. L. Allen, N. Sunariwal and J. Cabana" }];
  const rules2 = [{ name: "Eva Allen", until: 2024 }, { name: "Hong Li", not: ["10.1/new2"] }];
  const p = { doi: "10.1/new", year: 2026, authors: "H. Li, N. Sunariwal, E. Allen and J. Cabana" };
  const amb = ambiguousAuthors(p, listed, M2, rules2);
  assert.deepStrictEqual(amb.map(x => x.author), ["H. Li"], "two members match H. Li; Sunariwal is unique; Allen is past her until");
  assert.match(amb[0].reason, /Haifeng Li or Hong Li/);
  // the owner said "not Hong Li" for this paper: one member left, but other Lis exist, so still asked
  const amb2 = ambiguousAuthors({ ...p, doi: "10.1/new2" }, listed, M2, rules2);
  assert.match(amb2[0].reason, /other people named Li/);
  // held back from bold until confirmed
  assert.deepStrictEqual(boldAuthors({ ...p, group_check: ["H. Li"] }, M2, rules2), ["N. Sunariwal"]);
  const yes = [...rules2, { name: "Haifeng Li", confirmed: ["10.1/new2"] }];
  assert.deepStrictEqual(boldAuthors({ ...p, doi: "10.1/new2", group_check: ["H. Li"] }, M2, yes), ["H. Li", "N. Sunariwal"]);
  assert.deepStrictEqual(ambiguousAuthors({ ...p, doi: "10.1/new2" }, listed, M2, yes), [], "confirmed: no longer asked");
});
