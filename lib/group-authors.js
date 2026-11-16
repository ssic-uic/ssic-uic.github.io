// Which authors on a paper were members of the group, so the site can bold them.
//
// Everyone in people.yml (current members) and alumni.yml (Alums) counts. An author matches a
// member when the family name and the first initial agree ("H. D. Yoo" = Hyun Deog (Sam) Yoo),
// ignoring accents and case. data/group-authors.yml holds the owner's exceptions:
//   until: last year to bold the person (after that they collaborate as independent researchers)
//   also:  DOIs to bold anyway after `until`
//   not:   DOIs where an author with the same initial and family name is someone else
//   unbold: DOIs where it is the member, but they weren't in the group at the time
//   as:    extra spellings to match exactly, for names that don't follow the first-initial rule
//   confirmed: DOIs where the owner confirmed the matching author is this member
// The PI is bolded separately by the page.
//
// New papers (owner's rule, 16 Nov 2026): on every paper the weekly sync adds, the authors that would
// be bolded are held back (listed in the paper's group_check, not bolded) until the owner confirms
// them; ambiguousAuthors() says why a particular match is doubtful (two members could match, or
// people outside the group share the family name). Matches that wouldn't be bolded anyway (after
// `until`) aren't asked about. The owner's answer goes in confirmed: or not:.

const norm = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const normDoi = d => norm(d).replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
const isInitial = t => /^\p{L}{1,2}\.(-\p{L}{1,2}\.)*$/u.test(t);

// "Y.-S. Yu" -> { first: "y", family: "yu" }; "S. Kumar Singh" -> { first: "s", family: "kumar singh" }
function parseAuthor(a) {
  const t = String(a).trim().split(/\s+/);
  let i = 0;
  while (i < t.length - 1 && isInitial(t[i])) i++;
  return { first: i ? norm(t[0])[0] : "", family: norm(t.slice(i).join(" ")) };
}

// every current member and alum, as { name, first, family }
function groupMembers(people, alumni) {
  const names = [
    ...["postdocs", "grads", "undergrads"].flatMap(g => ((people || {})[g] || []).map(m => ({ name: m.name, family: m.family }))),
    ...(alumni || []).flatMap(g => (g.people || []).map(n => (typeof n === "string" ? { name: n } : n))),
  ];
  return names.map(m => {
    const words = m.name.replace(/\(.*?\)/g, "").trim().split(/\s+/);
    return { name: m.name, first: norm(words[0])[0], family: norm(m.family || words[words.length - 1]) };
  });
}

const splitAuthors = s => String(s || "").split(/, | and /).map(a => a.trim()).filter(Boolean);

const ruleMap = rules => new Map((rules || []).map(r => [r.name, r]));
const has = (list, doi) => (list || []).map(normDoi).includes(doi);

// members an author could be: [{ member, rule }], leaving out members the owner said it isn't
function matchMembers(a, doi, members, rules) {
  const rule = ruleMap(rules), p = parseAuthor(a);
  return members
    .filter(m => (rule.get(m.name)?.as || []).includes(a) || (p.first && p.first === m.first && p.family === m.family))
    .map(m => ({ member: m, rule: rule.get(m.name) || {} }))
    .filter(x => !has(x.rule.not, doi));
}

// the author names (exactly as written in paper.authors) to bold
function boldAuthors(paper, members, rules = []) {
  const doi = normDoi(paper.doi), year = Number(paper.year);
  const held = new Set(paper.group_check || []);
  const out = [];
  for (const a of splitAuthors(paper.authors)) {
    const ms = matchMembers(a, doi, members, rules);
    if (!ms.length) continue;
    const confirmed = ms.find(x => has(x.rule.confirmed, doi));
    if (held.has(a) && !confirmed) continue; // waiting for the owner's answer
    const { rule: r } = confirmed || ms[0];
    if (has(r.unbold, doi)) continue;
    if (r.until && year > Number(r.until) && !has(r.also, doi)) continue;
    out.push(a);
  }
  return out;
}

// Matches on `paper` the owner should confirm, judged against the papers listed before it:
// [{ author, members: [names], reason }]
function ambiguousAuthors(paper, listed, members, rules = []) {
  const doi = normDoi(paper.doi), year = Number(paper.year);
  const outsiders = new Set(); // family names of authors who aren't group members
  for (const q of listed) for (const a of splitAuthors(q.authors)) if (!matchMembers(a, normDoi(q.doi), members, rules).length) outsiders.add(parseAuthor(a).family);
  const wouldBold = r => !has(r.unbold, doi) && !(r.until && year > Number(r.until) && !has(r.also, doi));
  const out = [];
  for (const a of splitAuthors(paper.authors)) {
    const ms = matchMembers(a, doi, members, rules).filter(x => wouldBold(x.rule));
    if (!ms.length || ms.some(x => has(x.rule.confirmed, doi))) continue;
    const names = ms.map(x => x.member.name);
    let reason = "";
    if (ms.length > 1) reason = `it could be ${names.join(" or ")}`;
    else if (outsiders.has(ms[0].member.family)) reason = `other people named ${a.split(/\s+/).filter(t => !/\.$/.test(t)).join(" ")} appear in the publication list`;
    if (reason) out.push({ author: a, members: names, reason });
  }
  return out;
}

module.exports = { parseAuthor, groupMembers, boldAuthors, splitAuthors, matchMembers, ambiguousAuthors };
