import type { Calendario } from '../modules/calendarios.js';

// Páginas públicas de la agenda (HTML + JS sin dependencias). Estilo sobrio:
// fuente del sistema, acento azul, radios chicos, claro/oscuro automático.

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface ExtrasAgenda {
  anfitrion?: string | null;     // nombre del negocio / cuenta
  usuario?: string | null;       // @ de Instagram del negocio
  prefill?: { nombre?: string | null; email?: string | null; ig?: string | null };
}

const ESTILOS = (color: string) => `
:root{--bg:#f6f7f9;--card:#fff;--txt:#0f172a;--sec:#475569;--mut:#64748b;--bd:#e2e8f0;--bd2:#cbd5e1;--ac:${color};--ac-bg:color-mix(in srgb,var(--ac) 9%,transparent);--ok:#16a34a}
@media (prefers-color-scheme:dark){:root{--bg:#0b0c0e;--card:#141518;--txt:#f1f5f9;--sec:#cbd5e1;--mut:#94a3b8;--bd:#25272c;--bd2:#33363d;--ac-bg:color-mix(in srgb,var(--ac) 18%,transparent)}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--txt);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.w{max-width:1000px;margin:0 auto;padding:32px 16px}@media(max-width:640px){.w{padding:12px}}
.c{background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden}
.mut{color:var(--mut)}.sec{color:var(--sec)}
button{font:inherit;color:inherit}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:42px;padding:0 16px;border-radius:6px;border:1px solid var(--bd2);background:transparent;cursor:pointer;text-decoration:none;color:var(--txt);font-weight:500}
.btn:hover{background:var(--ac-bg)}.btn.pri{background:var(--ac);border-color:var(--ac);color:#fff}.btn.pri:hover{filter:brightness(.95)}.btn[disabled]{opacity:.6;cursor:default}
.fila{display:flex;align-items:center;gap:8px;margin:6px 0;color:var(--sec)}.fila svg{flex:0 0 16px;color:var(--mut)}
`;

const ICONO = {
  reloj: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  lugar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10l4.5-2.5v9L15 14"/><rect x="3" y="7" width="12" height="10" rx="2"/></svg>',
  globo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  cal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
};

export function paginaAgenda(cal: Calendario, extra: ExtrasAgenda = {}) {
  const color = /^#[0-9a-f]{3,8}$/i.test(cal.color || '') ? cal.color : '#2563eb';
  const anfitrion = extra.anfitrion || '';
  const inicial = (anfitrion || cal.nombre).trim().charAt(0).toUpperCase();
  const datos = {
    nombre: cal.nombre, duracion: cal.duracion_min, preguntas: cal.preguntas ?? [], ubicacion: cal.ubicacion,
    descripcion: cal.descripcion, prefill: extra.prefill ?? {}, anfitrion,
  };
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cal.nombre)}${anfitrion ? ` · ${esc(anfitrion)}` : ''}</title>
<meta name="robots" content="noindex">
<style>${ESTILOS(color)}
.grid{display:grid;grid-template-columns:280px 1fr;min-height:540px}
.info{padding:28px 24px;border-right:1px solid var(--bd)}
.av{width:44px;height:44px;border-radius:50%;background:var(--ac);color:#fff;display:grid;place-items:center;font-weight:600;font-size:18px;margin-bottom:14px}
.info h1{font-size:22px;line-height:1.25;margin:4px 0 14px;letter-spacing:-.01em}
.desc{white-space:pre-wrap;margin-top:14px;color:var(--sec)}
.der{padding:24px 28px;display:grid;grid-template-columns:1fr 200px;gap:24px}
.der.sin-dia{grid-template-columns:1fr}
h2{font-size:15px;margin:0 0 14px;font-weight:600}
.mes{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.mes b{font-weight:600}
.nav{width:34px;height:34px;border-radius:50%;border:0;background:transparent;cursor:pointer;display:grid;place-items:center;color:var(--ac)}
.nav:hover{background:var(--ac-bg)}.nav[disabled]{color:var(--bd2);cursor:default;background:transparent}
.sem,.dias{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}
.sem span{font-size:11px;color:var(--mut);text-transform:uppercase;padding:4px 0}
.dia{aspect-ratio:1;max-width:46px;width:100%;margin:0 auto;border-radius:50%;border:0;background:transparent;cursor:default;font-weight:500;color:var(--mut);position:relative}
.dia.si{background:var(--ac-bg);color:var(--ac);cursor:pointer;font-weight:600}.dia.si:hover{background:color-mix(in srgb,var(--ac) 18%,transparent)}
.dia.on{background:var(--ac);color:#fff}.dia.hoy::after{content:"";position:absolute;bottom:5px;left:50%;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:currentColor}
.tz{margin-top:16px;display:flex;align-items:center;gap:6px;font-size:12px}
.horas{display:flex;flex-direction:column;gap:8px;max-height:430px;overflow:auto;padding-right:2px}
.hora{height:44px;border:1px solid color-mix(in srgb,var(--ac) 55%,transparent);color:var(--ac);background:transparent;border-radius:6px;font-weight:600;cursor:pointer}
.hora:hover{border-color:var(--ac);background:var(--ac-bg)}
.dtit{font-size:14px;font-weight:600;margin:0 0 12px}
.vacio{padding:30px 0;color:var(--mut)}
form{padding:24px 28px;max-width:560px}
label{display:block;font-size:13px;font-weight:500;margin:14px 0 6px}
input,textarea{width:100%;padding:10px 12px;border:1px solid var(--bd2);border-radius:6px;background:transparent;color:var(--txt);font:inherit}
input:focus,textarea:focus,.btn:focus-visible,.hora:focus-visible,.dia:focus-visible{outline:2px solid var(--ac);outline-offset:1px}
.atras{border:0;background:transparent;color:var(--ac);cursor:pointer;padding:0;font-weight:500;display:inline-flex;gap:6px;align-items:center;margin-bottom:6px}
.err{color:#dc2626;font-size:13px;margin-top:10px}
.resumen{border:1px solid var(--bd);border-radius:8px;padding:12px 14px;margin:6px 0 4px;background:var(--ac-bg)}
.resumen b{display:block}
.cargando{display:flex;gap:6px;align-items:center;color:var(--mut);padding:20px 0}
@media(max-width:820px){.grid{grid-template-columns:1fr}.info{border-right:0;border-bottom:1px solid var(--bd);padding:20px}.der{grid-template-columns:1fr;padding:20px}.horas{max-height:none;display:grid;grid-template-columns:repeat(3,1fr)}form{padding:20px}}
@media(max-width:420px){.horas{grid-template-columns:repeat(2,1fr)}}
</style></head><body><div class="w"><div class="c" id="app">
<div class="grid">
  <aside class="info">
    <div class="av" aria-hidden="true">${esc(inicial)}</div>
    ${anfitrion ? `<div class="mut" style="font-weight:500">${esc(anfitrion)}</div>` : ''}
    <h1>${esc(cal.nombre)}</h1>
    <div class="fila">${ICONO.reloj}<span>${cal.duracion_min} min</span></div>
    ${cal.ubicacion ? `<div class="fila">${ICONO.lugar}<span>${/^https?:/i.test(cal.ubicacion) ? 'Videollamada (te llega el link al confirmar)' : esc(cal.ubicacion)}</span></div>` : ''}
    ${cal.descripcion ? `<div class="desc">${esc(cal.descripcion)}</div>` : ''}
  </aside>
  <main id="paso"></main>
</div></div></div>
<script>
const D=${JSON.stringify(datos).replace(/</g, '\\u003c')};
const inv=new URLSearchParams(location.search).get('i')||undefined;
const TZ=Intl.DateTimeFormat().resolvedOptions().timeZone;
const L='es';
const $=s=>document.querySelector(s);
const pad=n=>String(n).padStart(2,'0');
const clave=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const fh=s=>new Date(s).toLocaleTimeString(L,{hour:'2-digit',minute:'2-digit'});
const may=x=>x.charAt(0).toUpperCase()+x.slice(1);
const fd=s=>may(new Date(s).toLocaleDateString(L,{weekday:'long',day:'numeric',month:'long'}));
const hoy=new Date();hoy.setHours(0,0,0,0);
let mes=new Date(hoy.getFullYear(),hoy.getMonth(),1), porDia={}, dia=null, hueco=null, cargado=false;
const flecha=(d)=>'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="'+(d<0?'M15 18l-6-6 6-6':'M9 18l6-6-6-6')+'"/></svg>';
async function cargarMes(){
  cargado=false;pintarCal();
  const ini=new Date(mes.getFullYear(),mes.getMonth(),1), fin=new Date(mes.getFullYear(),mes.getMonth()+1,1);
  const desde=new Date(ini.getTime()-86400000).toISOString().slice(0,10);
  const dias=Math.round((fin-ini)/86400000)+2;
  const r=await fetch(location.pathname+'/huecos?desde='+desde+'&dias='+Math.min(42,dias)).then(r=>r.json()).catch(()=>null);
  porDia={};for(const d of (r&&r.dias)||[])for(const h of d.huecos){const k=clave(new Date(h));(porDia[k]=porDia[k]||[]).push(h);}
  for(const k in porDia)porDia[k].sort();
  cargado=true;
  if(!dia||!porDia[dia]){const pri=Object.keys(porDia).filter(k=>k.startsWith(mes.getFullYear()+'-'+pad(mes.getMonth()+1))).sort()[0];dia=pri||null;}
  pintarCal();
}
function pintarCal(){
  const conDia=dia&&porDia[dia];
  const ini=new Date(mes.getFullYear(),mes.getMonth(),1);const off=(ini.getDay()+6)%7;
  const total=new Date(mes.getFullYear(),mes.getMonth()+1,0).getDate();
  let celdas='';for(let i=0;i<off;i++)celdas+='<span></span>';
  for(let n=1;n<=total;n++){const d=new Date(mes.getFullYear(),mes.getMonth(),n);const k=clave(d);const si=!!porDia[k];
    celdas+='<button type="button" class="dia'+(si?' si':'')+(k===dia?' on':'')+(d.getTime()===hoy.getTime()?' hoy':'')+'" '+(si?'data-k="'+k+'"':'disabled')+' aria-label="'+d.toLocaleDateString(L,{weekday:'long',day:'numeric',month:'long'})+(si?', con horarios':'')+'">'+n+'</button>';}
  const titulo=may(mes.toLocaleDateString(L,{month:'long',year:'numeric'}).replace(' de ',' '));
  const prevOff=mes<=new Date(hoy.getFullYear(),hoy.getMonth(),1);
  let horas='';
  if(conDia){horas='<div><p class="dtit">'+fd(porDia[dia][0])+'</p><div class="horas">'+porDia[dia].map(h=>'<button type="button" class="hora" data-h="'+h+'">'+fh(h)+'</button>').join('')+'</div></div>';}
  const vacio=cargado&&!Object.keys(porDia).some(k=>k.startsWith(mes.getFullYear()+'-'+pad(mes.getMonth()+1)));
  $('#paso').innerHTML='<div class="der'+(conDia?'':' sin-dia')+'"><div><h2>Elegí día y horario</h2>'+
    '<div class="mes"><button class="nav" id="ant" aria-label="Mes anterior" '+(prevOff?'disabled':'')+'>'+flecha(-1)+'</button><b>'+titulo+'</b><button class="nav" id="sig" aria-label="Mes siguiente">'+flecha(1)+'</button></div>'+
    '<div class="sem">'+['lun','mar','mié','jue','vie','sáb','dom'].map(x=>'<span>'+x+'</span>').join('')+'</div><div class="dias">'+celdas+'</div>'+
    (!cargado?'<div class="cargando">Buscando horarios…</div>':vacio?'<div class="vacio">No quedan horarios este mes. Probá el siguiente →</div>':'')+
    '<div class="tz mut">'+${JSON.stringify(ICONO.globo)}+'<span>Horarios en tu hora · '+TZ.replace(/_/g,' ')+'</span></div></div>'+horas+'</div>';
  $('#ant').onclick=()=>{mes=new Date(mes.getFullYear(),mes.getMonth()-1,1);dia=null;cargarMes();};
  $('#sig').onclick=()=>{mes=new Date(mes.getFullYear(),mes.getMonth()+1,1);dia=null;cargarMes();};
  document.querySelectorAll('.dia.si').forEach(b=>b.onclick=()=>{dia=b.dataset.k;pintarCal();});
  document.querySelectorAll('.hora').forEach(b=>b.onclick=()=>{hueco=b.dataset.h;pintarForm();});
}
function campo(l,n,t,v,req,extra){return '<label for="f-'+n+'">'+l+(req?' *':'')+'</label><input id="f-'+n+'" name="'+n+'" type="'+t+'" '+(req?'required ':'')+(extra||'')+' value="'+(v||'').replace(/"/g,'&quot;')+'">';}
function pintarForm(){
  const fin=new Date(new Date(hueco).getTime()+D.duracion*60000).toISOString();
  const P=D.prefill||{};
  $('#paso').innerHTML='<form id="f" novalidate><button type="button" class="atras" id="volver">'+flecha(-1)+' Cambiar horario</button>'+
    '<div class="resumen"><b>'+fd(hueco)+'</b><span class="sec">'+fh(hueco)+' – '+fh(fin)+' · '+TZ.replace(/_/g,' ')+'</span></div>'+
    campo('Nombre y apellido','nombre','text',P.nombre,true,'autocomplete="name" maxlength="120"')+
    campo('Email','email','email',P.email,true,'autocomplete="email" maxlength="200"')+
    campo('Tu usuario de Instagram','ig_username','text',P.ig?'@'+P.ig:'',false,'placeholder="@usuario" maxlength="80"')+
    D.preguntas.map((p,i)=>'<label for="q'+i+'">'+p.nombre.replace(/</g,'&lt;')+(p.obligatoria?' *':'')+'</label><textarea id="q'+i+'" rows="3" data-p="'+p.nombre.replace(/"/g,'&quot;')+'" '+(p.obligatoria?'required':'')+'></textarea>').join('')+
    '<div style="margin-top:20px"><button class="btn pri" id="enviar" style="width:100%">Confirmar reunión</button></div><div class="err" id="err" role="alert"></div></form>';
  $('#volver').onclick=()=>pintarCal();
  const prim=$('#f-nombre').value?($('#f-email').value?null:'#f-email'):'#f-nombre';if(prim)$(prim).focus();
  $('#f').onsubmit=async e=>{e.preventDefault();const f=new FormData($('#f'));$('#err').textContent='';
    if(!String(f.get('nombre')||'').trim()){$('#err').textContent='Escribí tu nombre.';return;}
    if(!/^\\S+@\\S+\\.\\S+$/.test(String(f.get('email')||''))){$('#err').textContent='Revisá tu email.';return;}
    const resp={};let falta=null;document.querySelectorAll('[data-p]').forEach(t=>{if(t.value.trim())resp[t.dataset.p]=t.value.trim();else if(t.required&&!falta)falta=t.dataset.p;});
    if(falta){$('#err').textContent='Completá «'+falta+'».';return;}
    $('#enviar').disabled=true;$('#enviar').textContent='Confirmando…';
    const r=await fetch(location.pathname+'/reservar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({inicio:hueco,nombre:f.get('nombre'),email:f.get('email'),ig_username:String(f.get('ig_username')||'').trim()||undefined,respuestas:resp,invitacion:inv})}).catch(()=>null);
    const j=r?await r.json().catch(()=>({})):{};
    if(!r||!r.ok){$('#err').textContent=(j&&j.mensaje)||'No se pudo agendar. Probá otro horario.';$('#enviar').disabled=false;$('#enviar').textContent='Confirmar reunión';if(r&&r.status===400){await cargarMes();}return;}
    location.href=j.gracias;
  };
}
cargarMes();
</script></body></html>`;
}

export function paginaGracias(cal: Calendario, r: { nombre?: string | null; inicio: Date; fin: Date; token: string; email?: string | null }, extra: ExtrasAgenda & { urlIcs: string; urlCancelar: string; urlOtra: string }) {
  const color = /^#[0-9a-f]{3,8}$/i.test(cal.color || '') ? cal.color : '#2563eb';
  const f = (d: Date) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${cal.nombre}${extra.anfitrion ? ` · ${extra.anfitrion}` : ''}`)}&dates=${f(r.inicio)}/${f(r.fin)}&details=${encodeURIComponent(`Para cancelar: ${extra.urlCancelar}`)}${cal.ubicacion ? `&location=${encodeURIComponent(cal.ubicacion)}` : ''}`;
  const primer = String(r.nombre ?? '').trim().split(/\s+/)[0];
  const datos = { inicio: new Date(r.inicio).toISOString(), fin: new Date(r.fin).toISOString() };
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reunión confirmada · ${esc(cal.nombre)}</title><meta name="robots" content="noindex">
<style>${ESTILOS(color)}
.c{max-width:560px;margin:0 auto;padding:36px 32px;text-align:center}@media(max-width:520px){.c{padding:28px 18px}}
.ok{width:64px;height:64px;border-radius:50%;background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok);display:grid;place-items:center;margin:0 auto 16px;animation:pop .45s cubic-bezier(.2,1.4,.4,1) both}
.ok svg{stroke-dasharray:30;stroke-dashoffset:30;animation:dib .5s .25s ease-out forwards}
@keyframes pop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}@keyframes dib{to{stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){.ok,.ok svg{animation:none;stroke-dashoffset:0}}
h1{font-size:22px;margin:0 0 6px;letter-spacing:-.01em}
.det{text-align:left;border:1px solid var(--bd);border-radius:8px;padding:16px 18px;margin:22px 0}
.det .t{font-weight:600;font-size:15px;margin-bottom:8px}
.fila span{color:var(--txt)}
.acc{display:grid;gap:8px}.acc .btn{width:100%}
.pie{margin-top:18px;font-size:13px}.pie a{color:var(--mut)}
</style></head><body><div class="w"><div class="c">
<div class="ok" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
<h1>${primer ? `¡Listo, ${esc(primer)}!` : '¡Listo!'} Tu reunión está confirmada</h1>
<p class="sec" style="margin:0">${r.email ? `Te esperamos. Guardala en tu calendario para no olvidarte.` : 'Te esperamos. Guardala en tu calendario para no olvidarte.'}</p>
<div class="det">
  <div class="t">${esc(cal.nombre)}${extra.anfitrion ? ` <span class="mut" style="font-weight:400">· ${esc(extra.anfitrion)}</span>` : ''}</div>
  <div class="fila">${ICONO.cal}<span class="cap" id="cuando"></span></div>
  <div class="fila">${ICONO.reloj}<span id="horas"></span></div>
  <div class="fila">${ICONO.globo}<span id="zona"></span></div>
  ${cal.ubicacion ? `<div class="fila">${ICONO.lugar}<span>${/^https?:/i.test(cal.ubicacion) ? `<a href="${esc(cal.ubicacion)}" target="_blank" rel="noopener" style="color:var(--ac)">Link de la videollamada</a>` : esc(cal.ubicacion)}</span></div>` : ''}
</div>
<div class="acc">
  <a class="btn pri" href="${esc(google)}" target="_blank" rel="noopener">Agregar a Google Calendar</a>
  <a class="btn" href="${esc(extra.urlIcs)}">Agregar a Apple / Outlook (.ics)</a>
</div>
<div class="pie mut">¿No podés? <a href="${esc(extra.urlCancelar)}">Cancelar la reunión</a></div>
</div></div>
<script>
const D=${JSON.stringify(datos)};const L='es';
const a=new Date(D.inicio),b=new Date(D.fin);
const t=a.toLocaleDateString(L,{weekday:'long',day:'numeric',month:'long',year:'numeric'});document.getElementById('cuando').textContent=t.charAt(0).toUpperCase()+t.slice(1);
document.getElementById('horas').textContent=a.toLocaleTimeString(L,{hour:'2-digit',minute:'2-digit'})+' – '+b.toLocaleTimeString(L,{hour:'2-digit',minute:'2-digit'})+' ('+Math.round((b-a)/60000)+' min)';
document.getElementById('zona').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g,' ');
</script></body></html>`;
}

export function paginaMensaje(titulo: string, texto: string, ok = true) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>${ESTILOS('#2563eb')}.c{max-width:460px;margin:10vh auto 0;padding:32px;text-align:center}h1{font-size:20px;margin:0 0 6px}</style></head>
<body><div class="w"><div class="c"><div style="font-size:34px;margin-bottom:10px">${ok ? '👋' : '🗓️'}</div><h1>${esc(titulo)}</h1><p class="sec" style="margin:0">${esc(texto)}</p></div></div></body></html>`;
}
