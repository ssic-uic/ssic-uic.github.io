/* Renders the site from window.SITE (built from data/*.yml by scripts/build.js).
   chem() comes from assets/chem.js (lib/chem.js). */
const SITE = window.SITE;
const chem = window.chem;

const AREAS = {
  ion:{name:"Ion transport", c:"var(--t-ion)"},
  redox:{name:"Redox beyond the metal", c:"var(--t-redox)"},
  interface:{name:"Reactivity at electrochemical interfaces", c:"var(--t-interface)"},
  xray:{name:"X-ray analytical science", c:"var(--t-xray)"},
  other:{name:"Other", c:"var(--t-other)"}
};
const AREA_KEYS = SITE.research.map(r => r.key);
const FILTER_KEYS = [...AREA_KEYS, "other"];
const PUBS = SITE.publications;
const themesOf = p => p.themes || [];
const inArea = (p,k) => k==="other" ? !themesOf(p).length : themesOf(p).includes(k);

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const authors = a => esc(a).replace(/J\. Cabana(-Jimenez)?/g, m => '<b>'+m+'</b>');
const initials = n => { const w = n.replace(/\(.*?\)/g,'').trim().split(/\s+/); return (w[0][0] + w[w.length-1][0]).toUpperCase(); };

function pubHTML(p){
  const ks = themesOf(p).length ? themesOf(p) : ["other"];
  return `<article class="pub"><span class="dots">${ks.map(k=>`<span class="dot" style="--c:${AREAS[k].c}" title="${AREAS[k].name}"></span>`).join("")}</span><div>
    <a class="t" href="${esc(p.url)}">${chem(p.title)}</a>
    <div class="a">${authors(p.authors)}</div>
    <div class="j"><i>${esc(p.journal)}</i> ${p.year}, ${esc(p.citation)}</div></div></article>`;
}
function newsHTML(n){
  return `<article class="news"><div class="meta"><span>${esc(n.date)}</span></div>
    <h3><a href="${esc(n.url)}">${chem(n.title)}</a></h3><p>${esc(n.body)}</p></article>`;
}

/* home */
const years = [...new Set(PUBS.map(p=>p.year))];
$('#home-areas').innerHTML = SITE.research.map(r => `<div class="area" style="--c:${AREAS[r.key].c}"><h3>${esc(r.title)}</h3><p class="q">${esc(r.question)}</p><a href="#research" data-go="research">Read more</a></div>`).join('');
if (SITE.news.length) {
  $('#home-news').innerHTML = SITE.news.slice(0,3).map(newsHTML).join('');
  $('#all-news').innerHTML = SITE.news.map(newsHTML).join('');
} else {
  $('#home-news').parentElement.hidden = true;
  $('#all-news').innerHTML = `<p style="color:var(--ink-2)">No news yet. New papers and group news will appear here.</p>`;
}
$('#home-pubs').innerHTML = PUBS.slice(0,4).map(pubHTML).join('');

/* join: postdoc openings come from data/join.yml; each one disappears after its closing date */
const today = new Date().toISOString().slice(0,10);
const openNow = SITE.openings.filter(o => !o.closes || o.closes >= today);
$('#openings').innerHTML = openNow.length
  ? openNow.map(o=>`<article class="opening"><h4>${esc(o.title)}</h4><p>${esc(o.summary)}</p><p class="meta">Posted ${esc(o.posted)}${o.closes?` · Apply by ${esc(o.closes)}`:''}</p><p>${esc(o.apply)}</p></article>`).join('')
  : `<p>We have no postdoc openings right now. When we do, they will be listed here.</p>`;

/* research */
$('#research-rows').innerHTML = SITE.research.map(r => { const k = r.key; const recent = PUBS.filter(p=>inArea(p,k)).slice(0,3);
  return `<div class="rrow" style="--c:${AREAS[k].c}"><h3><i></i>${esc(r.title)}</h3><div><p class="q">${esc(r.question)}</p><p>${esc(r.text)}</p>
  <div class="papers"><h4>Recent papers</h4><ul>${recent.map(p=>`<li><a href="${esc(p.url)}">${chem(p.title)}</a><span><i>${esc(p.journal)}</i> ${p.year}</span></li>`).join('')}</ul><a class="all" href="#publications" data-go="publications" data-area="${k}">All papers in this theme</a></div></div></div>`; }).join('');

/* people */
const pi = SITE.people.pi;
$('#pi').innerHTML = `<div class="ph" aria-hidden="true">${initials(pi.name)}</div>
  <div><h2>${esc(pi.name)}</h2><p class="role">${esc(pi.role)}<br><a href="mailto:${esc(pi.email)}">${esc(pi.email)}</a></p>
  <ul class="cv">${pi.cv.map(c=>`<li><span>${esc(c.years)}</span>${esc(c.text)}</li>`).join('')}</ul></div>`;
const tints = ["var(--blue)","var(--green)","var(--sky)"];
const person = (p,i) => `<div class="person"><div class="ph" style="background:color-mix(in srgb,${tints[i%3]} 13%,var(--white));color:${tints[i%3]}" aria-hidden="true">${initials(p.name)}</div><b>${esc(p.name)}</b>${p.argonne?'<span>Based at Argonne</span>':''}</div>`;
const grads = SITE.people.grads;
$('#postdocs').innerHTML = SITE.people.postdocs.map((p,i)=>person(p,i+1)).join('');
$('#grads').innerHTML = grads.map(person).join('');
$('#grad-n').textContent = `${grads.length} students, ${grads.filter(g=>g.argonne).length} of them based at Argonne.`;
$('#alumni').innerHTML = SITE.alumni.map(g=>`<div><h3>${esc(g.role)} <span>${g.people.length}</span></h3><ul>${g.people.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></div>`).join('');

/* publications */
let fy = 'all', fa = 'all';
$('#area-f').innerHTML = `<button class="chip" data-a="all" aria-pressed="true">All research</button>` + FILTER_KEYS.map(k=>`<button class="chip" data-a="${k}" style="--c:${AREAS[k].c}" aria-pressed="false"><i></i>${AREAS[k].name}</button>`).join('');
$('#year-f').innerHTML = `<button class="chip" data-y="all" aria-pressed="true">All years</button>` + years.map(y=>`<button class="chip" data-y="${y}" aria-pressed="false">${y}</button>`).join('');
function renderPubs(){
  const q = $('#q').value.trim().toLowerCase();
  const list = PUBS.filter(p => (fy==='all'||p.year===fy) && (fa==='all'||inArea(p,fa)) && (!q || (p.title+' '+p.authors+' '+p.journal).toLowerCase().includes(q)));
  const first = Math.min(...PUBS.map(p=>+p.year));
  $('#count').textContent = list.length===PUBS.length ? `${PUBS.length} papers since ${first}` : `${list.length} of ${PUBS.length} papers`;
  $('#publist').innerHTML = years.map(y => { const ys = list.filter(p=>p.year===y); if(!ys.length) return '';
    return `<div class="yr"><h3>${y}</h3><span>${ys.length} paper${ys.length>1?'s':''}</span></div>` + ys.map(pubHTML).join(''); }).join('')
    || `<p style="margin-top:28px;color:var(--ink-2)">No papers match. Try a shorter search or clear the filters.</p>`;
}
function setChip(group, attr, val){ document.querySelectorAll(group+' .chip').forEach(c=>c.setAttribute('aria-pressed', c.dataset[attr]===val)); }
$('#area-f').addEventListener('click', e=>{ const b=e.target.closest('.chip'); if(!b) return; fa=b.dataset.a; setChip('#area-f','a',fa); renderPubs(); });
$('#year-f').addEventListener('click', e=>{ const b=e.target.closest('.chip'); if(!b) return; fy=b.dataset.y; setChip('#year-f','y',fy); renderPubs(); });
$('#q').addEventListener('input', renderPubs);
renderPubs();

/* hero: layered host with ions sliding into the galleries */
function drawHost(){
  const svg = $('#host'); let s = '';
  const layers = 5, top = 34, gap = 74, n = 11, w = 40, x0 = 40;
  const ionColors = ["var(--t-ion)","var(--t-redox)","var(--t-interface)","var(--t-xray)"];
  for (let L=0; L<layers; L++){
    const y = top + L*gap, off = (L%2) ? w/2 : 0;
    for (let i=0; i<n - (L%2); i++){
      const cx = x0 + off + i*w, cy = y;
      s += `<path d="M${cx} ${cy-17} L${cx+18} ${cy} L${cx} ${cy+17} L${cx-18} ${cy} Z" style="fill:var(--host-fill);stroke:var(--ink)" stroke-width="1.3" stroke-linejoin="round"/>`;
      s += `<circle cx="${cx}" cy="${cy}" r="2.4" style="fill:var(--ink)"/>`;
    }
  }
  let k = 0;
  for (let G=0; G<layers-1; G++){
    const y = top + G*gap + gap/2, count = [5,4,5,3][G];
    for (let j=0; j<count; j++){
      const x = x0 + 30 + j*62 + (G%2)*22, c = ionColors[(G+j)%4];
      const shift = 300 + j*40;
      s += `<circle class="ion" cx="${x}" cy="${y}" r="11" style="fill:${c};transform:translateX(${shift}px);transition-delay:${(k++)*70}ms"/>`;
    }
  }
  svg.innerHTML = s;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    svg.classList.remove('pre');
    svg.querySelectorAll('.ion').forEach(el=>el.style.transform='translateX(0)');
  }));
}
drawHost();

/* router */
function go(page, area){
  if (!document.getElementById('p-'+page)) page = 'home';
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('on', p.id==='p-'+page));
  document.querySelectorAll('nav a').forEach(a=>{ if(a.dataset.go===page) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
  if (page==='publications' && area){ fa = area; setChip('#area-f','a',fa); renderPubs(); }
  $('#nav').classList.remove('open'); $('.menu').setAttribute('aria-expanded','false');
  window.scrollTo(0,0);
}
document.addEventListener('click', e=>{ const a=e.target.closest('[data-go]'); if(!a) return; e.preventDefault(); try{history.replaceState(null,'','#'+a.dataset.go)}catch(_){}; go(a.dataset.go, a.dataset.area); });
$('.menu').addEventListener('click', ()=>{ const o=$('#nav').classList.toggle('open'); $('.menu').setAttribute('aria-expanded', o); });
addEventListener('scroll', ()=>$('#top').classList.toggle('scrolled', scrollY>8), {passive:true});
addEventListener('hashchange', ()=>go((location.hash||'#home').slice(1)));
$('#updated').textContent = `Last updated ${SITE.updated}.`;
go((location.hash||'#home').slice(1));
