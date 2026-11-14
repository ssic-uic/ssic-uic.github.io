// Run with: node --test
const test = require("node:test");
const assert = require("node:assert");
const { chem } = require("../lib/chem.js");

const cases = [
  ["Li2RuO3", "Li<sub>2</sub>RuO<sub>3</sub>"],
  ["CO2 by a MoS2 Electrocatalyst", "CO<sub>2</sub> by a MoS<sub>2</sub> Electrocatalyst"],
  ["upon Mg2+ Extraction", "upon Mg<sup>2+</sup> Extraction"],
  ["Accelerating Li+ Diffusion", "Accelerating Li<sup>+</sup> Diffusion"],
  ["Revealed by 25Mg Ultrahigh", "Revealed by <sup>25</sup>Mg Ultrahigh"],
  // dimensions are not isotopes
  ["1D Nb1−xTaxS3", "1D Nb<sub>1−x</sub>Ta<sub>x</sub>S<sub>3</sub>"],
  ["Enabled by 2D Medium‐Entropy Catalyst", "Enabled by 2D Medium‐Entropy Catalyst"],
  ["3D Quantification", "3D Quantification"],
  ["β-V2O5 as Magnesium", "β-V<sub>2</sub>O<sub>5</sub> as Magnesium"],
  ["layered Li4/7[□1/7Mn6/7]O2 enabled", "layered Li<sub>4/7</sub>[□<sub>1/7</sub>Mn<sub>6/7</sub>]O<sub>2</sub> enabled"],
  ["Li3xLa2/3−xTiO3", "Li<sub>3x</sub>La<sub>2/3−x</sub>TiO<sub>3</sub>"],
  ["LiNiyMnzCo1−y−zO2", "LiNi<sub>y</sub>Mn<sub>z</sub>Co<sub>1−y−z</sub>O<sub>2</sub>"],
  // an en dash inside stoichiometry is a minus sign
  ["Li1–xNi0.33Mn0.33Co0.33O2", "Li<sub>1−x</sub>Ni<sub>0.33</sub>Mn<sub>0.33</sub>Co<sub>0.33</sub>O<sub>2</sub>"],
  ["With a d0 Transition Metal", "With a d<sup>0</sup> Transition Metal"],
  ["Li[Na1/3Ru2/3]O2", "Li[Na<sub>1/3</sub>Ru<sub>2/3</sub>]O<sub>2</sub>"],
  ["High‐Rate Li–CO2 Battery", "High‐Rate Li–CO<sub>2</sub> Battery"],
  ["Ru(IV)–Ru(V) Redox", "Ru(IV)–Ru(V) Redox"],
  ["spinel (Mg2+) host", "spinel (Mg<sup>2+</sup>) host"],
  ["Does it occur in Li2NiO3?", "Does it occur in Li<sub>2</sub>NiO<sub>3</sub>?"],
  // left alone
  ["NGenE 2022: Electrochemistry", "NGenE 2022: Electrochemistry"],
  ["18650 Lithium-Ion Batteries", "18650 Lithium-Ion Batteries"],
  ["T2-type Li-excess", "T2-type Li-excess"],
  ["cathode–electrolyte interphases", "cathode–electrolyte interphases"],
  ["Fish & <Chips>", "Fish &amp; &lt;Chips&gt;"],
];

for (const [input, want] of cases) {
  test(input, () => assert.strictEqual(chem(input), want));
}
