import type { Calendario } from '../modules/calendarios.js';

// Página pública para agendar (HTML + JS sin dependencias, estilo sobrio).
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function paginaAgenda(cal: Calendario) {
  const datos = {
    slug: cal.slug, nombre: cal.nombre, duracion: cal.duracion_min, color: cal.color || '#2563eb',
    preguntas: cal.preguntas ?? [], zona: cal.zona_horaria,
  };
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cal.nombre)}</title>
<style>
:root{--bg:#f7f7f8;--card:#fff;--txt:#111;--mut:#6b7280;--bd:#e5e7eb;--ac:${esc(datos.color)}}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0c;--card:#161618;--txt:#f2f2f3;--mut:#9ca3af;--bd:#2a2a2e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.w{max-width:760px;margin:0 auto;padding:24px 16px}.c{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:20px}
h1{font-size:20px;margin:0 0 4px}.m{color:var(--mut);font-size:13px}
.dias{display:flex;gap:6px;overflow-x:auto;padding:12px 0}.d{flex:0 0 auto;border:1px solid var(--bd);background:transparent;color:var(--txt);border-radius:6px;padding:8px 10px;text-align:center;cursor:pointer;min-width:62px;font:inherit}
.d small{display:block;color:var(--mut);font-size:11px}.d[disabled]{opacity:.35;cursor:default}.d.on{border-color:var(--ac);background:color-mix(in srgb,var(--ac) 10%,transparent)}
.h{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px}.h button{border:1px solid var(--ac);color:var(--ac);background:transparent;border-radius:6px;padding:9px 0;font:inherit;font-weight:600;cursor:pointer}
.h button.on{background:var(--ac);color:#fff}label{display:block;font-size:13px;margin:10px 0 4px}
input,textarea{width:100%;padding:9px 10px;border:1px solid var(--bd);border-radius:6px;background:transparent;color:var(--txt);font:inherit}
.b{margin-top:14px;width:100%;background:var(--ac);color:#fff;border:0;border-radius:6px;padding:11px;font:inherit;font-weight:600;cursor:pointer}.b[disabled]{opacity:.6}
.err{color:#dc2626;font-size:13px;margin-top:8px}.ok{text-align:center;padding:30px 10px}.nav{display:flex;justify-content:space-between;align-items:center;margin-top:12px}
.nav button{background:transparent;border:1px solid var(--bd);color:var(--txt);border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}
</style></head><body><div class="w"><div class="c" id="app">
<h1>${esc(cal.nombre)}</h1>
<div class="m">⏱ ${cal.duracion_min} min${cal.ubicacion ? ` · 📍 ${esc(cal.ubicacion)}` : ''} · <span id="tz"></span></div>
${cal.descripcion ? `<p class="m" style="white-space:pre-wrap">${esc(cal.descripcion)}</p>` : ''}
<div class="nav"><button id="prev" aria-label="Semana anterior">←</button><b id="mes"></b><button id="next" aria-label="Semana siguiente">→</button></div>
<div class="dias" id="dias"></div><div class="h" id="horas"><p class="m">Cargando horarios…</p></div>
<form id="f" hidden>
<p style="margin:16px 0 0"><b id="elegido"></b></p>
<label>Nombre y apellido *</label><input name="nombre" required maxlength="120" autocomplete="name">
<label>Email *</label><input name="email" type="email" required maxlength="200" autocomplete="email">
<label>Tu usuario de Instagram</label><input name="ig_username" maxlength="80" placeholder="@usuario">
<div id="pq"></div>
<button class="b" id="enviar">Confirmar reunión</button><div class="err" id="err" role="alert"></div>
</form></div></div>
<script>
const D=${JSON.stringify(datos).replace(/</g, '\\u003c')};
const inv=new URLSearchParams(location.search).get('i')||undefined;
const tzLocal=Intl.DateTimeFormat().resolvedOptions().timeZone;
document.getElementById('tz').textContent='Horarios en tu hora ('+tzLocal+')';
const $=id=>document.getElementById(id);
const hoy=new Date();const iso=d=>d.toISOString().slice(0,10);
let inicioSemana=new Date(Date.UTC(hoy.getFullYear(),hoy.getMonth(),hoy.getDate()));let datos=[];let dia=null;let hueco=null;
const fh=s=>new Date(s).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
const ff=s=>new Date(s).toLocaleDateString([], {weekday:'long',day:'numeric',month:'long'});
for(const p of D.preguntas){const l=document.createElement('label');l.textContent=p.nombre+(p.obligatoria?' *':'');const t=document.createElement('textarea');t.rows=2;t.dataset.p=p.nombre;t.required=!!p.obligatoria;$('pq').append(l,t);}
async function cargar(){
  $('horas').innerHTML='<p class="m">Cargando horarios…</p>';
  const desde=new Date(inicioSemana.getTime()-86400000);
  const r=await fetch(location.pathname+'/huecos?desde='+iso(desde)+'&dias=9').then(r=>r.json()).catch(()=>null);
  const todos=[];for(const d of (r&&r.dias)||[])todos.push(...d.huecos);
  // Agrupo por día en la hora del visitante
  const g={};for(const h of todos){const k=new Date(h).toLocaleDateString('en-CA');(g[k]=g[k]||[]).push(h);}
  datos=[];for(let i=0;i<7;i++){const d=new Date(inicioSemana.getTime()+i*86400000);const k=new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()).toLocaleDateString('en-CA');datos.push({k,d:new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()),h:(g[k]||[]).sort()});}
  $('mes').textContent=datos[0].d.toLocaleDateString([], {month:'long',year:'numeric'});
  $('prev').disabled=inicioSemana<=new Date(Date.UTC(hoy.getFullYear(),hoy.getMonth(),hoy.getDate()));
  if(!dia||!datos.some(x=>x.k===dia))dia=(datos.find(x=>x.h.length)||{}).k||null;pintar();
}
function pintar(){
  $('dias').innerHTML='';for(const x of datos){const b=document.createElement('button');b.type='button';b.className='d'+(x.k===dia?' on':'');b.disabled=!x.h.length;
    b.innerHTML='<small>'+x.d.toLocaleDateString([], {weekday:'short'})+'</small><b>'+x.d.getDate()+'</b>';b.onclick=()=>{dia=x.k;hueco=null;$('f').hidden=true;pintar();};$('dias').append(b);}
  const sel=datos.find(x=>x.k===dia);$('horas').innerHTML='';
  if(!sel){$('horas').innerHTML='<p class="m">No hay horarios libres esta semana. Probá la siguiente →</p>';return;}
  for(const h of sel.h){const b=document.createElement('button');b.type='button';b.textContent=fh(h);if(h===hueco)b.className='on';
    b.onclick=()=>{hueco=h;$('elegido').textContent='📅 '+ff(h)+' · '+fh(h);$('f').hidden=false;pintar();$('f').scrollIntoView({behavior:'smooth'});};$('horas').append(b);}
}
$('prev').onclick=()=>{inicioSemana=new Date(inicioSemana.getTime()-7*86400000);dia=null;cargar();};
$('next').onclick=()=>{inicioSemana=new Date(inicioSemana.getTime()+7*86400000);dia=null;cargar();};
$('f').onsubmit=async e=>{e.preventDefault();$('err').textContent='';const f=new FormData($('f'));const resp={};
  document.querySelectorAll('[data-p]').forEach(t=>{if(t.value.trim())resp[t.dataset.p]=t.value.trim();});
  $('enviar').disabled=true;$('enviar').textContent='Agendando…';
  const r=await fetch(location.pathname+'/reservar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({inicio:hueco,nombre:f.get('nombre'),email:f.get('email'),ig_username:f.get('ig_username')||undefined,respuestas:resp,invitacion:inv})}).catch(()=>null);
  const j=r?await r.json().catch(()=>({})):{};
  if(!r||!r.ok){$('err').textContent=(j&&j.mensaje)||'No se pudo agendar. Probá otro horario.';$('enviar').disabled=false;$('enviar').textContent='Confirmar reunión';if(r&&r.status===400)cargar();return;}
  $('app').innerHTML='<div class="ok"><div style="font-size:36px">✅</div><h1>¡Reunión agendada!</h1><p>'+ff(j.inicio)+' · '+fh(j.inicio)+'</p><p class="m">Si no podés asistir, <a href="'+j.cancelar+'">cancelala acá</a>.</p></div>';
};
cargar();
</script></body></html>`;
}
