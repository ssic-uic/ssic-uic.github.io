// Formats chemical formulas in paper titles for HTML:
// subscript stoichiometry (incl. fractions, decimals, variables like 1−x),
// superscript charges (Mg2+), isotopes (25Mg) and orbital occupancy (d0).
// Anything that does not parse as a formula is left exactly as written.
// Works in Node (build step) and in the browser (preview).

const ELEMENTS = new Set(("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn " +
  "Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd " +
  "Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf").split(" "));

const MINUS = "−";
// A stoichiometric amount: 2, 0.33, 2/3, 3x, 1−x, 1–y–z, 3−δ
const STOICH = /^(?:[\d.\/]+[xyzδ]?|[xyzδ])(?:[−–\-](?:[\d.\/]+[xyzδ]?|[xyzδ]))*/;
const CHARGE = /^(\d*)([+−])$/;
const GREEK_PREFIX = /^([α-ωΑ-Ω][\-‐])/;

const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Parse one segment (no spaces, no hyphens). Returns HTML, or null if it isn't a formula.
function formula(seg) {
  let out = "", i = 0, digits = false, atoms = 0;
  while (i < seg.length) {
    const rest = seg.slice(i);
    let sym = null;
    if (/^[A-Z][a-z]/.test(rest) && ELEMENTS.has(rest.slice(0, 2))) sym = rest.slice(0, 2);
    else if (/^[A-Z]/.test(rest) && ELEMENTS.has(rest[0])) sym = rest[0];
    else if (/^[□\[\]()]/.test(rest)) sym = rest[0];
    if (!sym) return null;
    if (/[A-Z□]/.test(sym[0])) atoms++;
    out += sym; i += sym.length;
    const after = seg.slice(i);
    const ch = after.match(CHARGE);
    if (ch && sym !== "(" && sym !== "[") { out += "<sup>" + ch[1] + (ch[2] === "+" ? "+" : MINUS) + "</sup>"; digits = true; i = seg.length; break; }
    const st = after.match(STOICH);
    if (st && sym !== "(" && sym !== "[") {
      out += "<sub>" + st[0].replace(/[–\-]/g, MINUS) + "</sub>";
      if (/\d/.test(st[0])) digits = true;
      i += st[0].length;
    }
  }
  return digits && atoms > 0 ? out : null;
}

function segment(seg) {
  if (!seg) return seg;
  const iso = seg.match(/^(\d{1,3})([A-Z][a-z]?)$/);           // 25Mg, 7Li; not 1D/2D/3D
  if (iso && iso[2] !== "D" && ELEMENTS.has(iso[2])) return "<sup>" + iso[1] + "</sup>" + iso[2];
  const orb = seg.match(/^([spdf])(\d{1,2})$/);                  // d0
  if (orb) return orb[1] + "<sup>" + orb[2] + "</sup>";
  const f = formula(seg);
  return f === null ? esc(seg) : f;
}

// Split a word on hyphens; split on en dashes only between letters/brackets (Li–O–Na),
// not inside stoichiometry (Li1–xNi…), where the dash is a minus sign.
function word(w) {
  const m = w.match(/^(.*?)([?,.:;!]*)$/); let core = m[1]; let tail = m[2];
  let pre = "";
  // a formula wrapped in brackets: (Mg2+) → open/close kept as plain text
  const wrap = core.match(/^\((.*)\)$/);
  if (wrap && !/[()]/.test(wrap[1])) return "(" + word(wrap[1]) + ")" + esc(tail);
  const g = core.match(GREEK_PREFIX);
  if (g) { pre = esc(g[1]); core = core.slice(g[1].length); }
  const parts = core.split(/([\-‐]|(?<=[A-Za-z)\]])–(?=[A-Z(\[]))/);
  return pre + parts.map((p, k) => (k % 2 ? p : segment(p))).join("") + esc(tail);
}

function chem(title) {
  return title.split(" ").map(word).join(" ");
}

if (typeof module !== "undefined") module.exports = { chem };
