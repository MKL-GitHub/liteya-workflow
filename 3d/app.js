// liteya · 3D dashboard. Same data and semantics as the 2D page (/), shown as soft glass panels floating in a room.
// Data: fetch("/api/state") is served by /lw.js from the AES-GCM encrypted /data.enc (key from the login/password).
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

const qs = new URLSearchParams(location.search);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches || qs.has('still');
const hasGL = (() => { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; } })();
let Q = !hasGL ? 0 : ((navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 8) <= 4 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) ? 1 : 2;
if (qs.get('q') === 'low') Q = Math.min(Q, 1); if (qs.get('q') === 'high' && hasGL) Q = 2; if (qs.get('q') === 'none') Q = 0;
const dprFor = q => Math.min(window.devicePixelRatio || 1, q >= 2 ? 1.5 : 1);
if (!Q) document.body.classList.add('nogl');

/* ---------------- data semantics (ported from the 2D page) ---------------- */
const S = {
  done: { t: "Готово", c: "done", i: "✓" }, running: { t: "В работе", c: "run", i: "●" }, verify: { t: "Проверка", c: "verify", i: "◆" },
  review: { t: "Ждёт проверки", c: "review", i: "◇" }, ci_failed: { t: "CI упал", c: "bad", i: "!" }, failed: { t: "Сбой", c: "bad", i: "!" },
  needs_split: { t: "На разбиение", c: "bad", i: "✂" }, blocked: { t: "Заблокирована", c: "bad", i: "■" },
  ready: { t: "Готова к запуску", c: "ready", i: "" }, missing: { t: "Карточки нет", c: "missing", i: "?" }, waiting: { t: "Ждёт зависимостей", c: "wait", i: "" }
};
const FILTERS = [
  ["all", "Все", () => true], ["active", "Активные", c => ["running", "verify", "review"].includes(c.status)],
  ["todo", "Не начаты", c => ["ready", "waiting", "missing"].includes(c.status)], ["done", "Готово", c => c.status === "done"],
  ["bad", "Проблемы", c => ["failed", "ci_failed", "needs_split", "blocked"].includes(c.status)]
];
const CI = { success: "CI ✓", failure: "CI ✗", running: "CI идёт", queued: "CI в очереди", action_required: "CI ждёт одобрения", cancelled: "CI отменён" };
const MS_HINT = { M0: "основа и импорт", M1: "ядро nano", M2: "обучение и QV" };
const LS = k => "d3_" + k;
let state = null, filter = localStorage.getItem(LS("f")) || "all", pf = JSON.parse(localStorage.getItem(LS("pf")) || "{}"), q = "", hideDone = localStorage.getItem(LS("hd")) === "1";
const closedSet = new Set(JSON.parse(localStorage.getItem(LS("closed")) || "[]"));
let selId = null;
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const msk = iso => { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return "";
  return d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " МСК"; };
const save = () => localStorage.setItem(LS("closed"), JSON.stringify([...closedSet]));
function topo(cards) {
  const ids = new Set(cards.map(c => c.id)), out = [], seen = new Set(), byId = Object.fromEntries(cards.map(c => [c.id, c]));
  const visit = c => { if (seen.has(c.id)) return; seen.add(c.id); (c.depends_on || []).filter(d => ids.has(d)).sort().forEach(d => visit(byId[d])); out.push(c); };
  [...cards].sort((a, b) => a.id.localeCompare(b.id)).forEach(visit); return out;
}
const bar = (p, act) => `<div class="bar"><i class="act" style="width:${Math.min(100, act)}%"></i><i style="width:${p}%"></i></div>`;
// milestone badge: computed by the server as apps[p].ms[M] (same items as the bar); old data without .ms: derived the same way
function msBadge(p, m) {
  const a = state.apps[p] || {}; if (a.ms) return a.ms[m] || null;
  const g = (a.goals || {})[m]; if (!g) return null;
  const mc = state.cards.filter(c => c.project === p && c.milestone === m), d = mc.filter(c => c.status === "done").length;
  if (g === "PASS" && mc.length && d === mc.length) return { state: "pass", label: "веха пройдена" };
  if (g === "PASS") return { state: "review", label: "веха на проверке" };
  return { state: "open", label: "веха не пройдена" + (g === "NOT_RUN" ? "" : " · " + g) };
}
function groupOf(c, m) {
  const par = String(c.parent || "");
  if (/^E-\d+/.test(par)) return [par, par];
  const acc = c.kind === "acceptance" || /acceptance|приёмк|приемк/i.test(c.title || "");
  if (acc) return ["~2acc", "Приёмка " + m];
  if (["orchestrate", "plan", "planning"].includes(c.kind) || /^plan\b/i.test(c.title || "")) return ["~1plan", "Планирование " + m];
  if (/^M\d+$/.test(par)) return ["~0" + m, "Задачи " + m];
  return ["~0" + (par || "—"), par || "Без эпика"];
}

/* ---------------- panels (HTML, crisp) ---------------- */
const IC = {
  done: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  runs: '<path d="M13 3L5 13.5h6L10 21l9-11h-6l1-7z"/>',
  verify: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  work: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3"/>',
  agents: '<circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M12 7.2v4.3M10.6 12.6l-4.2 3.8M13.4 12.6l4.2 3.8"/><circle cx="12" cy="12" r="1.3"/>',
  bots: '<path d="M4 5.5h16v10H9.5L5 19.5v-4H4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'
};
const ico = k => `<span class="ico"><svg viewBox="0 0 24 24">${IC[k]}</svg></span>`;
const INF = `<svg class="inf" viewBox="0 0 100 50"><defs><linearGradient id="ig" x1="0" x2="1"><stop offset="0" stop-color="#5b7cff"/><stop offset=".5" stop-color="#b48bff"/><stop offset="1" stop-color="#38e1ff"/></linearGradient></defs>
<path d="M50 25C40 9 14 9 14 25s26 16 36 0 36-16 36 0-26 16-36 0z" fill="none" stroke="url(#ig)" stroke-width="7" stroke-linecap="round"/></svg>`;

const P = {}; // id -> panel record
function panel(id, cls, html, opt = {}) {
  const el = document.createElement('div'); el.className = 'pnl ' + cls; el.innerHTML = html; el.dataset.p = id;
  const obj = new CSS3DObject(el);
  const rec = P[id] = { id, el, obj, base: { x: 0, y: 0, z: 0, rx: 0, ry: 0, w: 300, h: 100 }, tx: sp(), ty: sp(), lift: sp(), glow: sp(), intro: sp(), gl: -1, hover: false, i: Object.keys(P).length, show: opt.show ?? 1, still: !!opt.still };
  el.addEventListener('pointerenter', () => { rec.hover = true; if (id === 'win' && room) room.winHover = true; });
  el.addEventListener('pointerleave', () => { rec.hover = false; if (id === 'win' && room) room.winHover = false; });
  el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(); el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%'); el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%'); });
  return rec;
}
function sp(v = 0) { return { v, vel: 0 }; }
function spring(s, target, dt, k = 70, c = 12.5) { // soft spring, slight settle; semi-implicit Euler with sub-steps
  const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
  for (let i = 0; i < n; i++) { s.vel += (k * (target - s.v) - c * s.vel) * h; s.v += s.vel * h; }
  return s.v;
}

const $c = {};
const $ = id => { const c = $c[id]; if (c && c.isConnected !== false && (c.isConnected || !document.getElementById(id))) return c;
  let e = document.getElementById(id); if (!e) for (const k in P) { e = P[k].el.querySelector('#' + id); if (e) break; }
  return e ? ($c[id] = e) : null; };
function buildPanels() {
  panel('hdr', 'bare', `<div class="hdr">${INF}<div class="logo">liteya</div><div class="sep"></div><div><div class="tag1">Ход работы <span>оркестратора</span></div><div class="sub" id="sub">оркестратор · подключение…</div></div></div>`);
  panel('live', 'bare', `<div class="live"><span class="dot" id="dot"></span><span id="liveText">подключение…</span><a class="sw" href="/" title="обычная версия">2D версия</a></div>`);
  panel('t1', 'tile c1', `${ico('done')}<div><b id="sDone">—</b><span>карточек готово<br>(все проекты)</span></div>`);
  panel('t2', 'tile c4', `${ico('runs')}<div><b id="sToday">—</b><span>запусков за сутки<br>(UTC)</span></div>`);
  panel('t3', 'tile c5', `${ico('verify')}<div><b id="sVerify">—</b><span>на проверке</span></div>`);
  panel('t4', 'tile c2', `${ico('work')}<div><b id="sWork">—</b><span>в работе</span></div>`);
  panel('ag', 'crew ag', `<h3>${ico('agents')}<span>Агенты</span><b id="cAgents">—</b><span class="st" id="cAgSt"></span></h3><div class="lst" id="cAgList"></div>`);
  panel('bt', 'crew bt', `<h3>${ico('bots')}<span>Боты</span><b id="cBots">—</b><span class="st" id="cBtSt"></span></h3><div class="lst" id="cBtList"></div>`);
  panel('tb', 'toolbar', `<div id="toolbar" style="display:contents"></div>`);
  panel('pr', 'projects', `<div class="err" id="err" style="display:none"></div><div class="scroll" id="sc"><div class="inner" id="tree"><div class="empty">загрузка…</div></div><div class="sbar" id="sbar"></div></div>`);
  panel('ft', 'foot', `<div id="foot" style="display:contents">…</div>`);
  panel('dt', 'detail detailP', `<div id="detail"></div>`, { show: 0 });
  if (!Q) panel('win', 'winP', `<img src="assets/window.jpg" alt="">`);
  else { panel('win', 'bare', ``); P.win.el.style.background = 'transparent'; }
}

/* ---------------- layout ---------------- */
let MODE = 'wide', HW = 965, HH = 525, scrollMax = 0;
function layout(W, H) {
  const a = W / H; MODE = a >= 1.22 ? 'wide' : 'tall';
  const L = {};
  if (MODE === 'wide') {
    HW = 968; HH = 528;
    L.hdr = [-560, 470, 0, 0, 0, 760, 80]; L.live = [672, 474, 0, 0, 0, 470, 46];
    [-700, -428, 428, 700].forEach((x, i) => L['t' + (i + 1)] = [x, 372, 0, 0, 0, 256, 88]);
    L.tb = [0, 250, 0, 0, 0, 880, 54];
    L.pr = [0, -84, 0, 0, 0, 880, 578];
    L.ag = [-738, 118, -80, 0, .34, 396, 292];
    L.bt = [-738, -210, -80, 0, .34, 396, 292];
    L.win = [738, -46, -80, 0, -.34, 420, 620];
    L.ft = [0, -428, 30, -.30, 0, 1020, 44];
    L.dt = [0, 20, 230, 0, 0, 640, 0];
  } else {
    HW = 430; HH = 0; let y = 0; const col = (id, h, w = 820, x = 0) => { L[id] = [x, y - h / 2, 0, 0, 0, w, h]; y -= h + 18; };
    col('hdr', 80); col('live', 46);
    L.t1 = [-209, y - 44, 0, 0, 0, 400, 88]; L.t2 = [209, y - 44, 0, 0, 0, 400, 88]; y -= 106;
    L.t3 = [-209, y - 44, 0, 0, 0, 400, 88]; L.t4 = [209, y - 44, 0, 0, 0, 400, 88]; y -= 106;
    col('ag', 240); col('bt', 240); col('tb', 104); col('pr', 900); col('win', 640, 500); col('ft', 70);
    L.dt = [0, 0, 230, 0, 0, 760, 0];
    const top = 0; scrollMax = Math.max(0, -y);
    for (const k in L) L[k][1] -= -0; // y already relative to top=0
    L._top = top;
  }
  for (const k in L) { if (k[0] === '_' || !P[k]) continue; const [x, y, z, rx, ry, w, h] = L[k];
    Object.assign(P[k].base, { x, y, z, rx, ry, w, h }); P[k].el.style.width = w + 'px'; if (h) P[k].el.style.height = h + 'px'; else P[k].el.style.height = ''; }
  P.tb.el.style.flexWrap = MODE === 'wide' ? 'nowrap' : 'wrap';
  if (room && room.win) { const b = P.win.base; room.win.grp.position.set(b.x, b.y, b.z - 6); room.win.grp.rotation.set(b.rx, b.ry, 0); }
  return L;
}

/* ---------------- rendering of the data ---------------- */
function renderToolbar() {
  const cs = state ? state.cards : []; const glob = Object.keys(pf).length ? "" : filter;
  $("toolbar").innerHTML = `<span class="sum">Все проекты:</span>` +
    FILTERS.map(([k, l, f]) => `<span class="chip ${glob === k ? "on" : ""}" data-f="${k}">${l}<span class="n">${cs.filter(f).length}</span></span>`).join("") +
    `<span class="chip ${hideDone ? "on" : ""}" data-hd="1">Скрыть готовые</span>` +
    `<input class="search" id="q" placeholder="Поиск: C-0141, хеш, CLI…" value="${esc(q)}">`;
  $("q").oninput = e => { q = e.target.value; renderTree(); };
}
function cardHtml(c) {
  const s = S[c.status] || { t: c.status, c: "", i: "" };
  const pr = c.pr ? `<a class="pr" href="${esc(c.pr.url)}" target="_blank" rel="noopener">#${c.pr.number}${c.pr.state === "merged" ? " ✓" : ""}</a>` : "";
  const ci = (c.ci && c.status !== "done") ? `<a class="ci ${esc(c.ci.state)}" href="${esc(c.ci.url)}" target="_blank" rel="noopener">${CI[c.ci.state] || "CI " + esc(c.ci.state)}</a>` : "";
  return `<div class="card ${s.c} ${selId === c.id ? "sel" : ""}" data-id="${esc(c.id)}"><span class="ic">${s.i}</span><span class="id">${esc(c.id)}</span><span class="t" title="${esc(c.title)}">${esc(c.title)}</span><span class="meta">${ci}${pr}<span class="badge b-${esc(c.status)}">${s.t}</span></span></div>`;
}
function renderTree() {
  if (!state) return;
  const ql = q.trim().toLowerCase();
  const fOf = p => pf[p] || filter, fn = k => (FILTERS.find(f => f[0] === k) || FILTERS[0])[2];
  const chipOk = c => fn(fOf(c.project))(c) && !(hideDone && c.status === "done");
  const cardHit = c => [c.id, c.project, c.title, c.parent, c.milestone, c.sha, c.head_sha, c.status, c.raw_status, (S[c.status] || {}).t, c.pr && ("#" + c.pr.number)].filter(Boolean).join(" ").toLowerCase().includes(ql);
  const msHit = (p, m) => { if (!ql) return false; const b = msBadge(p, m); const name = (p === "nano" ? MS_HINT[m] || "" : "") + " " + (b ? b.label : "");
    return m.toLowerCase().startsWith(ql) || (ql.length >= 3 && name.toLowerCase().includes(ql)); };
  const anyMs = !!ql && state.cards.some(c => msHit(c.project, c.milestone));
  const projects = [...new Set(state.cards.map(c => c.project))].sort((a, b) => a === "nano" ? -1 : b === "nano" ? 1 : a.localeCompare(b));
  let html = "";
  for (const p of projects) {
    let phtml = ""; const pc = state.cards.filter(c => c.project === p), filter = fOf(p);
    const mss = [...new Set(pc.map(c => c.milestone))].sort((a, b) => (parseInt(a.slice(1)) || 0) - (parseInt(b.slice(1)) || 0));
    for (const m of mss) {
      const mc = pc.filter(c => c.milestone === m), d = mc.filter(c => c.status === "done").length;
      const act = mc.filter(c => ["running", "verify", "review"].includes(c.status)).length;
      const pct = Math.round(100 * d / mc.length), apct = Math.round(100 * (d + act) / mc.length);
      const mb = msBadge(p, m), key = p + "/" + m, mhit = msHit(p, m);
      if (anyMs && !mhit) continue;
      const match = c => chipOk(c) && (!ql || mhit || (!anyMs && cardHit(c)));
      const shown = mc.filter(match);
      const defClosed = pct === 100 && !closedSet.has("!" + key);
      const closed = !ql && (closedSet.has(key) || (defClosed && filter === "all"));
      if (!shown.length && (ql || filter !== "all" || hideDone)) continue;
      const eps = {}, epName = {}; mc.forEach(c => { const [k, n] = groupOf(c, m); (eps[k] ||= []).push(c); epName[k] = n; });
      let body = "";
      for (const e of Object.keys(eps).sort()) {
        const ec = topo(eps[e]), es = ec.filter(match); if (!es.length) continue;
        const ed = ec.filter(c => c.status === "done").length, ek = key + "/" + e, first = ec.find(c => c.status !== "done") || ec[0];
        const epClosed = !ql && (closedSet.has(ek) || (ed === ec.length && !closedSet.has("!" + ek) && filter === "all"));
        body += `<div class="ep ${ed === ec.length ? "alldone" : ""} ${epClosed ? "closed" : ""}"><div class="head" data-k="${esc(ek)}" data-dc="${ed === ec.length ? 1 : 0}"><span class="caret">▾</span><span class="name">${esc(epName[e])}</span>
          <span class="hint">${esc(ed === ec.length ? "все подзадачи готовы" : "дальше: " + first.title)}</span><span class="cnt">${ed}/${ec.length}</span><div class="mini">${bar(Math.round(100 * ed / ec.length), 0)}</div></div>
          <div class="fold"><div>${es.map(cardHtml).join("")}</div></div></div>`;
      }
      phtml += `<section class="ms ${closed ? "closed" : ""}"><div class="head" data-k="${esc(key)}" data-dc="${pct === 100 ? 1 : 0}"><span class="caret">▾</span><h2>${esc(m)}</h2>
        ${mb ? `<span class="tag ${esc(mb.state)}">${esc(mb.label)}</span>` : ""}<span class="msub">${esc(MS_HINT[m] && p === "nano" ? MS_HINT[m] : "")}</span>
        <div class="prog">${bar(pct, apct)}<span class="cnt">${d} из ${mc.length} · ${pct}%</span></div></div>
        <div class="fold"><div>${body || '<div class="empty">ничего не подходит под фильтр</div>'}</div></div></section>`;
    }
    if (!phtml && ql) continue;
    const pd = pc.filter(c => c.status === "done").length;
    html += `<div class="proj">${ico('grid').replace('class="ico"', 'class="ico" style="width:28px;height:28px;border-radius:9px"')}<span>Проект ${esc(p)}${state.apps[p] ? " · " + esc(state.apps[p].control) : ""}</span><span class="ln2"></span><span class="pc"><b>${pd} / ${pc.length}</b> готово</span></div>` +
      `<div class="ptools">` + FILTERS.map(([k, l, f]) => `<span class="chip ${filter === k ? "on" : ""}" data-f="${k}" data-p="${esc(p)}">${l}<span class="n">${pc.filter(f).length}</span></span>`).join("") + `</div>` +
      (phtml || '<div class="empty">ничего не подходит под фильтр</div>');
  }
  $("tree").innerHTML = html || `<div class="empty">${state.cards.length ? "Ничего не найдено" : "Нет карточек"}</div>`;
  scroller.clamp();
}
function wkHtml(w, isAgent) {
  const short = String(w.id || "").replace(/^bc-([0-9a-f]{8}).*$/, "bc-$1");
  const nm = isAgent ? (w.name && w.name !== w.id ? `${esc(w.name)} <span class="mono">${esc(short)}</span>` : `<span class="mono" style="color:var(--text)">${esc(short)}</span>`) : esc(w.name || w.id);
  const title = w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${nm}</a>` : nm;
  const src = isAgent ? (w.source === "dispatch" ? "dispatch" : "запущен Nano") : "";
  const ln = [w.role && `<span>${esc(w.role)}</span>`, w.model && `<span class="mdl">${esc(w.model)}</span>`, w.card && `<span class="crd">${esc(w.card)}</span>`,
    w.started_at && `<span>с ${esc(msk(w.started_at))}</span>`, src && `<span>${src}</span>`, w.stale && `<span style="color:var(--warn)">нет обновлений &gt;${state.workers.stale_hours} ч</span>`].filter(Boolean).join("");
  return `<div class="wk ${w.stale ? "stale" : ""}" title="${esc(w.id)}"><span class="pip"></span><span class="nm">${title}</span><div class="ln">${ln}</div>${w.task ? `<div class="tk" title="${esc(w.task)}">${esc(w.task)}</div>` : ""}</div>`;
}
function renderCrew() {
  const w = state.workers; if (!w) return; const stale = l => l.filter(x => x.stale).length;
  $("cAgents").textContent = w.agents_active; $("cBots").textContent = w.bots_active;
  $("cAgSt").textContent = stale(w.agents) ? `+${stale(w.agents)} без обновлений` : "работают сейчас";
  $("cBtSt").textContent = stale(w.bots) ? `+${stale(w.bots)} без обновлений` : "работают сейчас";
  $("cAgList").innerHTML = w.agents.map(x => wkHtml(x, true)).join("") || '<div class="none">сейчас никто не работает</div>';
  $("cBtList").innerHTML = w.bots.map(x => wkHtml(x, false)).join("") || '<div class="none">сейчас никто не работает</div>';
}
const counters = {};
function countTo(id, text) { // numbers roll softly to their new value
  const el = $(id), m = /^(\d+)(?: \/ (\d+))?$/.exec(text);
  if (!m || RM) { el.textContent = text; return; }
  const c = counters[id] || (counters[id] = { a: 0, b: 0 }), A = +m[1], B = m[2] != null ? +m[2] : null, t0 = performance.now(), a0 = c.a, b0 = c.b;
  const step = now => { const k = Math.min(1, (now - t0) / 1400), e = 1 - Math.pow(1 - k, 3);
    c.a = Math.round(a0 + (A - a0) * e); if (B != null) c.b = Math.round(b0 + (B - b0) * e);
    el.textContent = B != null ? `${c.a} / ${c.b}` : `${c.a}`; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function render() {
  const cs = state.cards;
  countTo("sDone", `${cs.filter(c => c.status === "done").length} / ${cs.length}`);
  countTo("sWork", String(cs.filter(c => c.status === "running").length));
  countTo("sVerify", String(cs.filter(c => ["verify", "review"].includes(c.status)).length));
  const a = state.agents || {}; countTo("sToday", `${a.today ?? "—"}`);
  const ctl = state.control === "RUN" ? "работает" : state.control === "PAUSE" ? "на паузе" : state.control;
  $("sub").innerHTML = `оркестратор <b style="color:${state.control === "RUN" ? "var(--ok)" : "var(--warn)"}">${esc(String(ctl).split(/\n+/).join(" · "))}</b> · ${esc(state.repo)}`;
  const err = $("err"), errs = state.errors || [], notes = state.notices || [];
  err.style.display = (errs.length || notes.length) ? "block" : "none"; err.classList.toggle("quiet", !errs.length); err.textContent = errs.concat(notes).join(" · ");
  const act = state.actions;
  $("foot").innerHTML = `<span>main: <b>${esc(state.commit.sha)}</b> ${esc(msk(state.commit.at))}</span>` + (act ? `<span>GitHub Actions: ${act.running} идёт, ${act.queued} в очереди</span>` : "") +
    `<span>данные: ${esc(msk(state.generated_at))}</span><span>GitHub: ${state.github_at ? esc(msk(state.github_at)) : "не подключён"}</span>`;
  renderCrew(); renderToolbar(); renderTree(); if (selId) openDetail(selId, true);
}
function setLive(ok, text) { $("dot").className = "dot " + (ok ? "on" : "off"); $("liveText").textContent = text; }
function apply(s) {
  const keepQ = document.activeElement && document.activeElement.id === "q"; state = s; window.__state = s; render();
  if (keepQ) { const qi = $("q"); qi.focus(); qi.setSelectionRange(q.length, q.length); }
  setLive(true, "обновлено " + new Date().toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }) + " МСК");
}
async function poll() { try { const r = await fetch("/api/state", { cache: "no-store" }); if (r.ok) apply(await r.json()); } catch (e) { setLive(false, "нет связи"); } }

/* ---------------- card detail (floats toward you) ---------------- */
function openDetail(id, refresh) {
  const c = state && state.cards.find(x => x.id === id); if (!c) { closeDetail(); return; }
  selId = id; const s = S[c.status] || { t: c.status };
  const done = new Set(state.cards.filter(x => x.status === "done").map(x => x.id));
  const deps = (c.depends_on || []).map(d => `<span class="dep ${done.has(d) ? "ok" : ""}">${esc(d)}</span>`).join("") || "нет";
  const rows = [["Статус", `<span class="badge b-${esc(c.status)}">${esc(s.t)}</span>`], ["Проект / веха", `<b>${esc(c.project)} · ${esc(c.milestone)}</b>${c.parent ? ` · ${esc(c.parent)}` : ""}`],
    ["Зависит от", deps], ["Тип", `<b>${esc(c.kind)}</b>`], ["Попыток", `<b>${c.attempts || 0}</b>`],
    c.acc_total && ["Критериев приёмки", `<b>${c.acc_total}</b>`], c.checks && c.checks.length && ["Проверки", `<b>${esc(c.checks.join(", "))}</b>`],
    c.exec_model && ["Исполнитель", `<b>${esc(c.exec_model)}</b>`], c.verify_model && ["Проверяющий", `<b>${esc(c.verify_model)}</b>`],
    c.started_at && ["Запуск", `<b>${msk(c.started_at)}</b>`], c.done_at && ["Готово", `<b>${msk(c.done_at)}</b>`],
    c.verdict && c.verdict.result && ["Вердикт", `<b>${esc(c.verdict.result)}</b>`], c.findings && ["Находки", esc(c.findings)]].filter(Boolean);
  const links = [c.pr && `<a class="pr" href="${esc(c.pr.url)}" target="_blank" rel="noopener">PR #${c.pr.number}${c.pr.state === "merged" ? " ✓" : ""}</a>`,
    c.ci && c.status !== "done" && `<a class="ci ${esc(c.ci.state)}" href="${esc(c.ci.url)}" target="_blank" rel="noopener">${CI[c.ci.state] || "CI " + esc(c.ci.state)}</a>`].filter(Boolean).join("");
  $("detail").innerHTML = `<div class="top"><span class="id">${esc(c.id)}</span>${links ? `<span class="links">${links}</span>` : ""}<span class="x" data-x="1" title="закрыть (Esc)">✕</span></div>
    <h4>${esc(c.title)}</h4><div class="task">${esc(c.task) || "<i>без описания</i>"}</div><div class="rows">${rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join("")}</div>`;
  if (!refresh) { P.dt.show = 1; document.body.classList.add('dimmed'); document.querySelectorAll('.card.sel').forEach(e => e.classList.remove('sel'));
    const ce = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`); if (ce) ce.classList.add('sel'); }
}
function closeDetail() { selId = null; P.dt.show = 0; document.body.classList.remove('dimmed'); document.querySelectorAll('.card.sel').forEach(e => e.classList.remove('sel')); }

document.addEventListener("click", e => {
  if (e.target.closest("[data-x]")) { closeDetail(); return; }
  const f = e.target.closest("[data-f]"); if (f) { const pp = f.dataset.p;
    if (pp) { if (f.dataset.f === filter) delete pf[pp]; else pf[pp] = f.dataset.f; } else { filter = f.dataset.f; pf = {}; localStorage.setItem(LS("f"), filter); }
    localStorage.setItem(LS("pf"), JSON.stringify(pf)); renderToolbar(); renderTree(); return; }
  if (e.target.closest("[data-hd]")) { hideDone = !hideDone; localStorage.setItem(LS("hd"), hideDone ? "1" : "0"); renderToolbar(); renderTree(); return; }
  if (e.target.closest("a") || e.target.closest("#detail")) return;
  const card = e.target.closest(".card"); if (card) { const id = card.dataset.id; selId === id ? closeDetail() : openDetail(id); return; }
  const h = e.target.closest("[data-k]"); if (h) { const k = h.dataset.k, box = h.parentElement; box.classList.toggle("closed");
    const cl = box.classList.contains("closed"); // a 100% group is closed by default: remember an explicit open as "!key"
    if (cl) { closedSet.add(k); closedSet.delete("!" + k); } else { closedSet.delete(k); if (h.dataset.dc === "1") closedSet.add("!" + k); } save(); return; }
  if (selId && !e.target.closest('.pnl')) closeDetail();
});
addEventListener('keydown', e => { if (e.key === 'Escape' && selId) closeDetail(); });

/* ---------------- smooth inner scrolling for the projects panel ---------------- */
const scroller = {
  cur: 0, target: 0, max: 0,
  init() { const sc = $("sc");
    sc.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); const k = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? sc.clientHeight : 1; this.target = Math.max(0, Math.min(this.max, this.target + e.deltaY * k)); }, { passive: false });
    let ty = null; sc.addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true });
    sc.addEventListener('touchmove', e => { if (ty == null) return; const y = e.touches[0].clientY; this.target = Math.max(0, Math.min(this.max, this.target + (ty - y) * 1.4)); ty = y; e.preventDefault(); e.stopPropagation(); }, { passive: false });
    sc.addEventListener('touchend', () => ty = null);
    sc.addEventListener('scroll', () => { sc.scrollTop = 0; }); // focus() on the search field must not jump the native scroll
    new ResizeObserver(() => this.clamp()).observe($("tree"));
  },
  clamp() { const sc = $("sc"), inner = $("tree"); this.max = Math.max(0, inner.scrollHeight - sc.clientHeight); this.target = Math.min(this.target, this.max); },
  tick(dt) { const k = RM ? 1 : 1 - Math.exp(-dt * 9); this.cur += (this.target - this.cur) * k; if (Math.abs(this.target - this.cur) < .05) this.cur = this.target;
    $("tree").style.transform = `translateY(${(-this.cur).toFixed(2)}px)`;
    const sc = $("sc"), sb = $("sbar"), H = sc.clientHeight, tot = H + this.max;
    if (this.max > 1) { const th = Math.max(30, H * H / tot), y = (H - th - 28) * (this.cur / this.max); sb.style.height = th + 'px'; sb.style.transform = `translateY(${y.toFixed(1)}px)`; sb.style.display = ''; } else sb.style.display = 'none'; }
};

/* ---------------- scene, camera, loop ---------------- */
let room = null, front = null, camera, cssR, W = innerWidth, H = innerHeight, D = 1300;
const FOV = 40, ptr = { x: 0, y: 0, sx: 0, sy: 0, px: W / 2, py: H / 2, moved: false };
let pageScroll = { cur: 0, target: 0 };
const scrollMaxCam = () => Math.max(0, scrollMax - 2 * D * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) + 60);
function fit() {
  W = innerWidth; H = innerHeight; layout(W, H);
  const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), a = W / H;
  D = MODE === 'wide' ? Math.max(HH / t, HW / (t * a)) : HW / (t * a);
  camera.aspect = a; camera.near = 10; camera.far = 9000; camera.updateProjectionMatrix();
  cssR.setSize(W, H);
  if (room) room.resize(W, H, dprFor(Q)); if (front) front.resize(W, H, window.devicePixelRatio || 1);
}
addEventListener('pointermove', e => { ptr.px = e.clientX; ptr.py = e.clientY; ptr.x = e.clientX / W * 2 - 1; ptr.y = -(e.clientY / H * 2 - 1);
  if (!ptr.moved) { ptr.moved = true; setTimeout(() => document.body.classList.add('hinted'), 5000); } }, { passive: true });
document.addEventListener('pointerleave', () => { ptr.x = 0; ptr.y = 0; });
addEventListener('wheel', e => { if (MODE !== 'tall') return; pageScroll.target = Math.max(0, Math.min(scrollMaxCam(), pageScroll.target + e.deltaY)); }, { passive: true });
{ let ty = null; addEventListener('touchstart', e => ty = e.touches[0].clientY, { passive: true });
  addEventListener('touchmove', e => { if (MODE !== 'tall' || ty == null) return; const y = e.touches[0].clientY; pageScroll.target = Math.max(0, Math.min(scrollMaxCam(), pageScroll.target + (ty - y) * 1.5)); ty = y; }, { passive: true }); }

function init() {
  buildPanels();
  camera = new THREE.PerspectiveCamera(FOV, W / H, 10, 9000);
  cssR = new CSS3DRenderer(); $("css").appendChild(cssR.domElement);
  const cssScene = new THREE.Scene(); for (const k in P) cssScene.add(P[k].obj);
  if (Q) {
    try {
      import('./scene.js?v=202610291437').then(mod => {
        room = new mod.Room($("gl"), { quality: Q, reducedMotion: RM });
        room.addWindow('assets/window.jpg', 420, 537);
        room.setup(camera, W, H, dprFor(Q));
        if (Q >= 2 && !RM) { front = new mod.FrontPetals($("fx"), 14); }
        fit(); window.__room = room;
      }).catch(err => { console.warn('3D room unavailable, panels only', err); document.body.classList.add('nogl'); });
    } catch (e) { document.body.classList.add('nogl'); }
  }
  fit(); addEventListener('resize', fit); scroller.init();
  let last = performance.now(), acc = 0, frames = 0, slow = 0; const t0 = last;
  window.__fps = 0;
  const loop = now => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = (now - t0) / 1000;
    // fps governor: step quality down softly if the device can't keep up
    acc += dt; frames++; if (acc >= 2) { const fps = frames / acc; window.__fps = fps; acc = 0; frames = 0;
      if (room && t > 4) { if (fps < 42) slow++; else slow = 0;
        if (slow >= 2 && Q > 0) { Q--; slow = 0; room.degrade(Q); if (front && Q < 2) { front = null; $("fx").style.display = 'none'; } room.resize(W, H, dprFor(Q)); console.info('quality ->', Q); } } }
    // pointer smoothing (soft, never jerky)
    const k = 1 - Math.exp(-dt * (RM ? 2 : 3.2)); ptr.sx += (ptr.x - ptr.sx) * k; ptr.sy += (ptr.y - ptr.sy) * k;
    const amp = RM ? .25 : 1;
    pageScroll.cur += (pageScroll.target - pageScroll.cur) * (1 - Math.exp(-dt * 6));
    const vh = D * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const baseY = MODE === 'tall' ? -vh + 30 - pageScroll.cur : 6;
    const drift = RM ? 0 : Math.sin(t * .11) * 10;
    camera.position.set(ptr.sx * 80 * amp + drift, ptr.sy * 46 * amp + baseY, D);
    camera.lookAt(0, baseY, 0);
    // panels: tilt toward the cursor, lift + glow on hover, soft intro
    const v = new THREE.Vector3(); let any = 0;
    for (const id in P) { const r = P[id], b = r.base;
      const delay = .25 + r.i * .07, introT = RM ? 1 : (t > delay ? 1 : 0); spring(r.intro, introT, dt, 26, 9.5);
      v.set(b.x, b.y, b.z).project(camera); const cx = (v.x + 1) / 2 * W, cy = (1 - v.y) / 2 * H;
      const dx = Math.max(-1.3, Math.min(1.3, (ptr.px - cx) / (W * .5))), dy = Math.max(-1.3, Math.min(1.3, (ptr.py - cy) / (H * .5)));
      const hv = r.hover ? 1 : 0, ta = (id === 'pr' ? .045 : .09) * (1 + hv * .5) * amp;
      spring(r.ty, dx * ta, dt); spring(r.tx, dy * ta * .8, dt); spring(r.lift, hv * (id === 'pr' ? 14 : 34) * (RM ? .4 : 1), dt, 60, 11);
      const gt = (selId && id === 'dt') ? .6 : hv; const g = spring(r.glow, gt, dt, 40, 11);
      if (Math.abs(g - r.gl) > .004) { r.el.style.setProperty('--glow', Math.max(0, Math.min(1.2, g)).toFixed(3)); r.gl = g; }
      const intro = r.intro.v, fl = (RM || r.still) ? 0 : Math.sin(t * .55 + r.i * 1.7) * 4;
      if (id === 'dt') { r.show = selId ? 1 : 0; const s = spring(r.glow2 || (r.glow2 = sp()), r.show, dt, 36, 10.5);
        r.obj.position.set(b.x, b.y + (1 - s) * -60 + fl, b.z + (1 - s) * -420 + r.lift.v); r.obj.rotation.set(b.rx + r.tx.v, b.ry + r.ty.v, 0);
        r.el.style.opacity = Math.max(0, Math.min(1, s * 1.25 - .1)).toFixed(3); r.el.style.visibility = s < .02 ? 'hidden' : 'visible'; r.el.style.pointerEvents = selId ? 'auto' : 'none'; continue; }
      r.obj.position.set(b.x, b.y + fl - (1 - intro) * 40, b.z + r.lift.v - (1 - intro) * 520);
      r.obj.rotation.set(b.rx + r.tx.v, b.ry + r.ty.v, 0);
      const dim = spring(r.dim || (r.dim = sp(1)), selId ? .28 : 1, dt, 30, 11);
      r.el.style.opacity = Math.max(0, Math.min(1, intro * dim)).toFixed(3);
      if (id === 'win' && room && room.win) { room.win.grp.position.set(b.x, b.y + fl - (1 - intro) * 40, b.z - 6 + r.lift.v - (1 - intro) * 520); room.win.grp.rotation.set(b.rx + r.tx.v, b.ry + r.ty.v, 0); }
      any = Math.max(any, r.glow.v);
    }
    scroller.tick(dt);
    if (room) { room.scene.position.y = MODE === 'tall' ? baseY - 6 : 0; room.cursor.set(ptr.sx * 1500, ptr.sy * 700 + 80, -1200 + Math.abs(ptr.sx) * 300); room.update(dt, { x: ptr.sx, y: ptr.sy }, any); room.render(); }
    cssR.render(cssScene, camera);
    if (front) front.render(camera, t);
  };
  requestAnimationFrame(loop);
  setTimeout(() => document.body.classList.add('ready'), 120);
  poll(); setInterval(() => { if (document.visibilityState === "visible") poll(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
}
init();
