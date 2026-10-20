/* ---------- Characters ---------- */
const SK=["#d39a72","#c58660","#e0b08c","#b77651","#a96a46","#dba680"];
function face(o){
  const h=o.hair||"#1e1614";
  const hairTop={
    short:`<path d="M18 27Q17 12 32 12Q47 12 46 27Q43 18 32 18Q21 18 18 27Z" fill="${h}"/>`,
    bun:`<circle cx="32" cy="12" r="6" fill="${h}"/><path d="M18 28Q17 13 32 13Q47 13 46 28Q42 19 32 19Q22 19 18 28Z" fill="${h}"/>`,
    long:`<path d="M17 30Q15 12 32 12Q49 12 47 30Q44 19 32 19Q20 19 17 30Z" fill="${h}"/>`,
    curly:`<g fill="${h}"><circle cx="21" cy="20" r="6"/><circle cx="29" cy="15" r="6"/><circle cx="37" cy="15" r="6"/><circle cx="44" cy="21" r="6"/></g>`
  }[o.style||"short"];
  return `<svg viewBox="0 0 64 64" class="av" aria-hidden="true">
  ${o.style==="long"?`<path d="M15 30Q12 52 19 58L45 58Q52 52 49 30Z" fill="${h}"/>`:""}
  <path d="M8 64Q10 46 32 44Q54 46 56 64Z" fill="${o.shirt}"/>
  <path d="M27 44L32 50L37 44" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.4"/>
  <rect x="27" y="36" width="10" height="9" rx="3" fill="${o.skin}"/>
  <circle cx="32" cy="28" r="14" fill="${o.skin}"/>
  ${hairTop}
  <g class="eyes"><circle cx="27" cy="29" r="1.8" fill="#1d1715"/><circle cx="37" cy="29" r="1.8" fill="#1d1715"/></g>
  <path d="M27.5 34Q32 37.5 36.5 34" stroke="#6b2f24" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  ${o.bindi?`<circle cx="32" cy="23" r="1.2" fill="#c2264b"/>`:""}
  ${o.glasses?`<g fill="none" stroke="#2a2a2a" stroke-width="1.2"><rect x="22.5" y="26" width="9" height="6.5" rx="2.5"/><rect x="32.5" y="26" width="9" height="6.5" rx="2.5"/><path d="M31.5 29h1"/></g>`:""}
  ${o.headset?`<path d="M17 28Q17 11 32 11Q47 11 47 28" fill="none" stroke="#333" stroke-width="2"/><rect x="15" y="26" width="4" height="7" rx="2" fill="#333"/><path d="M17 33Q19 38 25 37" stroke="#333" stroke-width="1.3" fill="none"/>`:""}
  ${o.ai?`<circle cx="50" cy="12" r="5" fill="#0f6e6a"/><path d="M48 12h4M50 10v4" stroke="#fff" stroke-width="1.3"/>`:""}
  </svg>`;
}
function diaSVG(){
  return `<svg viewBox="0 0 120 132" class="dia" aria-label="Dia, the virtual owner">
  <circle cx="60" cy="25" r="13" fill="#1b1212"/>
  <g fill="#fffaf0" stroke="#e9dcc0" stroke-width=".5">${[...Array(9)].map((_,i)=>{const a=Math.PI*(1.05+i*0.11);return `<circle cx="${60+16*Math.cos(a)}" cy="${25+16*Math.sin(a)+2}" r="2.6"/>`}).join("")}</g>
  <path d="M12 132Q16 94 60 89Q104 94 108 132Z" fill="#0f7a6e"/>
  <path d="M22 132Q22 104 46 95L58 98Q36 108 38 132Z" fill="#7a1f5c"/>
  <path d="M96 132Q92 104 70 96L84 92Q102 102 108 132Z" fill="#c2185b"/>
  <path d="M70 96Q92 104 96 132" fill="none" stroke="#e8b53a" stroke-width="3"/>
  <path d="M84 92Q102 102 108 132" fill="none" stroke="#e8b53a" stroke-width="2"/>
  <rect x="53" y="76" width="14" height="14" rx="5" fill="#d39a72"/>
  <path d="M47 89Q60 99 73 89" fill="none" stroke="#e8b53a" stroke-width="2.4"/>
  <g fill="#e8b53a"><circle cx="54" cy="94" r="1.6"/><circle cx="60" cy="96" r="1.9"/><circle cx="66" cy="94" r="1.6"/></g>
  <ellipse cx="60" cy="56" rx="24" ry="25" fill="#d39a72"/>
  <path d="M35 58Q33 31 60 31Q87 31 85 58Q82 42 62 40L60 37L58 40Q38 42 35 58Z" fill="#1b1212"/>
  <path d="M58 40Q60 37 62 40" stroke="#c2264b" stroke-width="1" fill="none"/>
  <path d="M55.5 45Q60 49.5 64.5 45Q60 47.2 55.5 45Z" fill="#c2264b"/><circle cx="60" cy="50" r="1.4" fill="#c2264b"/>
  <path d="M44 50Q49 47.5 54 50M66 50Q71 47.5 76 50" stroke="#1b1212" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <g class="eyes"><ellipse cx="49" cy="56" rx="3" ry="3.4" fill="#1b1212"/><ellipse cx="71" cy="56" rx="3" ry="3.4" fill="#1b1212"/>
  <circle cx="50" cy="55" r="1" fill="#fff"/><circle cx="72" cy="55" r="1" fill="#fff"/>
  <path d="M45 54.5Q49 51.5 53.5 54.5M66.5 54.5Q71 51.5 75 54.5" stroke="#1b1212" stroke-width="1.4" fill="none"/></g>
  <path d="M60 58Q58.5 63 60.5 64.5" stroke="#a96a46" stroke-width="1.2" fill="none" stroke-linecap="round"/>
  <path d="M57 64Q51 68 54.5 72.5Q59 75 61.5 69" fill="none" stroke="#e8b53a" stroke-width="1.4"/>
  <g fill="#fffaf0"><circle cx="52.6" cy="67" r="1.3"/><circle cx="53.6" cy="71" r="1.3"/><circle cx="57" cy="73.4" r="1.2"/></g>
  <circle cx="58.8" cy="66.4" r="1.1" fill="#c2264b"/>
  <circle cx="44" cy="64" r="4.5" fill="#e86a7a" opacity=".3"/><circle cx="76" cy="64" r="4.5" fill="#e86a7a" opacity=".3"/>
  <path d="M53 70Q60 76 67 70" stroke="#8a2a2a" stroke-width="2" fill="#fff" stroke-linecap="round"/>
  <g fill="#e8b53a"><path d="M35 63l-3 8h6z"/><circle cx="35" cy="72.5" r="1.6"/><path d="M85 63l-3 8h6z"/><circle cx="85" cy="72.5" r="1.6"/></g>
  </svg>`;
}

