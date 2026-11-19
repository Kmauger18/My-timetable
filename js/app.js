import { createStore, newId } from './store.js';

/* ───────────────────────── Utilitaires ───────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const SESSION_TYPES = ['Cours', 'CM', 'TD', 'TP', 'Projet', 'Examen', 'Autre'];
const WEEK_TYPES = {
  '': { label: 'Semaine normale', icon: '' },
  ecole: { label: 'Semaine à l’école', icon: '🎓' },
  entreprise: { label: 'Semaine en entreprise', icon: '🏢' },
  examens: { label: 'Semaine d’examens', icon: '📝' },
  vacances: { label: 'Vacances', icon: '🌴' },
};
const PALETTE = ['#4f46e5', '#0ea5e9', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b', '#92400e'];
const DEFAULT_SETTINGS = { title: 'My Timetable', startHour: 8, endHour: 19, days: 5, defaultDuration: 120 };
const PPM = 1.1; // pixels par minute dans la grille

const KINDS = {
  courses: {
    label: 'Cours', one: 'cours', newTitle: 'Nouveau cours', editTitle: 'Modifier le cours',
    fields: [
      { name: 'name', label: 'Nom du cours', required: true, placeholder: 'Ex. : Maquette numérique BIM' },
      { name: 'code', label: 'Abréviation', placeholder: 'Ex. : BIM', maxlength: 8 },
      { name: 'color', label: 'Couleur', type: 'color' },
    ],
    sub: (i) => i.code || '',
  },
  teachers: {
    label: 'Profs', one: 'prof', newTitle: 'Nouveau prof', editTitle: 'Modifier le prof',
    fields: [
      { name: 'name', label: 'Nom', required: true, placeholder: 'Ex. : Mme Martin' },
      { name: 'email', label: 'E-mail', type: 'email', placeholder: 'optionnel' },
      { name: 'note', label: 'Note', placeholder: 'optionnel' },
    ],
    sub: (i) => [i.email, i.note].filter(Boolean).join(' · '),
  },
  rooms: {
    label: 'Salles', one: 'salle', newTitle: 'Nouvelle salle', editTitle: 'Modifier la salle',
    fields: [
      { name: 'name', label: 'Nom / numéro', required: true, placeholder: 'Ex. : B204' },
      { name: 'building', label: 'Bâtiment / site', placeholder: 'optionnel' },
      { name: 'note', label: 'Note', placeholder: 'Ex. : visio, capacité…' },
    ],
    sub: (i) => [i.building, i.note].filter(Boolean).join(' · '),
  },
};

const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const fmtDur = (m) => { const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h${r ? ' ' + pad(r) : ''}` : `${r} min`; };
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
};
const fmtRange = (mon, days) => {
  const end = addDays(mon, days - 1);
  const sameMonth = mon.getMonth() === end.getMonth();
  return sameMonth
    ? `${mon.getDate()} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
    : `${mon.getDate()} ${MONTHS_SHORT[mon.getMonth()]} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
};
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
const emptyWeek = () => ({ type: '', note: '', sessions: [] });
const normalizeWeek = (d) => ({
  type: d?.type || '',
  note: d?.note || '',
  sessions: Array.isArray(d?.sessions) ? d.sessions.filter((s) => s && s.id) : [],
});

/* ───────────────────────── État ───────────────────────── */
const state = {
  store: null,
  monday: mondayOf(new Date()),
  week: emptyWeek(),
  weekLoaded: false,
  lib: { courses: [], teachers: [], rooms: [] },
  settings: { ...DEFAULT_SETTINGS },
  user: null,
  unsubWeek: null,
  libTab: 'courses',
  editing: null,       // séance en cours d'édition
  range: null,         // plage affichée {days, startH, endH}
};
const isAdmin = () => !!state.user;
const weekId = () => ymd(state.monday);
const get = (kind, id) => state.lib[kind].find((i) => i.id === id);

/* ───────────────────────── Toasts ───────────────────────── */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 5000 : 2800);
}
function errMsg(err) {
  const code = err?.code || '';
  if (code.includes('permission-denied')) return 'Accès refusé : ce compte n’a pas le droit de modifier.';
  if (code.includes('unavailable')) return 'Hors connexion : la modification sera envoyée au retour du réseau.';
  return err?.message || 'Une erreur est survenue.';
}

/* ───────────────────────── Persistance ───────────────────────── */
async function persistWeek(week, id = weekId()) {
  const data = { ...normalizeWeek(week), updatedAt: Date.now() };
  if (id === weekId()) { state.week = normalizeWeek(data); render(); }
  try {
    if (!data.sessions.length && !data.type && !data.note) await state.store.deleteWeek(id);
    else await state.store.saveWeek(id, data);
    return true;
  } catch (e) { toast(errMsg(e), 'error'); return false; }
}

/* ───────────────────────── Navigation ───────────────────────── */
function setMonday(d) {
  state.monday = mondayOf(d);
  loadWeek();
}
function loadWeek() {
  state.unsubWeek?.();
  const id = weekId();
  state.weekLoaded = false;
  state.week = emptyWeek();
  if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
  render();
  state.unsubWeek = state.store.subscribeWeek(id, (data) => {
    if (id !== weekId()) return;
    state.week = normalizeWeek(data);
    state.weekLoaded = true;
    render();
  });
}
function readHash() {
  const h = location.hash.slice(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(h)) { const d = parseYmd(h); if (!isNaN(d)) { state.monday = mondayOf(d); return true; } }
  return false;
}

/* ───────────────────────── Rendu ───────────────────────── */
function computeRange() {
  const s = state.settings;
  let days = Math.min(7, Math.max(5, Number(s.days) || 5));
  let startH = Number(s.startHour) || 8;
  let endH = Number(s.endHour) || 19;
  for (const x of state.week.sessions) {
    days = Math.max(days, Math.min(7, x.day + 1));
    startH = Math.min(startH, Math.floor(toMin(x.start) / 60));
    endH = Math.max(endH, Math.ceil(toMin(x.end) / 60));
  }
  if (endH <= startH) endH = startH + 1;
  return { days, startH, endH };
}

function render() {
  if (!state.store) return;
  state.range = computeRange();
  document.title = `${state.settings.title || 'My Timetable'} · S${isoWeek(state.monday)}`;
  $('#appTitle').textContent = state.settings.title || 'My Timetable';
  $('#weekLabel').textContent = `Semaine ${isoWeek(state.monday)}`;
  $('#weekRange').textContent = fmtRange(state.monday, state.range.days);
  $('#datePicker').value = weekId();
  document.body.classList.toggle('is-admin', isAdmin());
  renderAdminBar();
  renderBanner();
  renderGrid();
  renderDayList();
  renderSummary();
}

function renderAdminBar() {
  $('#adminBar').hidden = !isAdmin();
  if (!isAdmin()) return;
  const sel = $('#weekType');
  if (!sel.options.length) sel.innerHTML = Object.entries(WEEK_TYPES).map(([k, v]) => `<option value="${k}">${v.icon ? v.icon + ' ' : ''}${v.label}</option>`).join('');
  sel.value = state.week.type;
  const note = $('#weekNote');
  if (document.activeElement !== note) note.value = state.week.note;
}

function renderBanner() {
  const { type, note, sessions } = state.week;
  const el = $('#weekBanner');
  const t = WEEK_TYPES[type];
  if (!type && !note) { el.hidden = true; return; }
  el.hidden = false;
  el.className = `week-banner ${type ? 'type-' + type : ''} ${!sessions.length && type ? 'big' : ''}`;
  el.innerHTML = `${type ? `<strong>${t.icon} ${esc(t.label)}</strong>` : ''}${note ? `<span>${esc(note)}</span>` : ''}`;
}

function layoutDay(list) {
  const items = [...list].sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end));
  const out = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const it of cluster) {
      let lane = lanes.findIndex((end) => end <= toMin(it.start));
      if (lane === -1) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = toMin(it.end);
      it._lane = lane;
    }
    for (const it of cluster) out.push({ s: it, lane: it._lane, lanes: lanes.length });
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && toMin(it.start) >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, toMin(it.end));
  }
  if (cluster.length) flush();
  return out;
}

function sessionInfo(s) {
  const course = get('courses', s.courseId);
  const teacher = get('teachers', s.teacherId);
  const room = get('rooms', s.roomId);
  return {
    name: course?.name || 'Cours supprimé',
    code: course?.code || '',
    color: course?.color || '#94a3b8',
    teacher: teacher?.name || '',
    teacherObj: teacher,
    room: room?.name || '',
    roomObj: room,
  };
}

function renderGrid() {
  const el = $('#timetable');
  const { days, startH, endH } = state.range;
  const totalMin = (endH - startH) * 60;
  const today = ymd(new Date());
  const cols = `grid-template-columns: var(--time-col) repeat(${days}, minmax(0, 1fr))`;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  let head = `<div class="tt-head" style="${cols}"><div class="corner"></div>`;
  for (let d = 0; d < days; d++) {
    const date = addDays(state.monday, d);
    head += `<div class="day-h ${ymd(date) === today ? 'today' : ''}"><span>${DAY_SHORT[d]}</span><b>${date.getDate()}</b></div>`;
  }
  head += '</div>';

  let times = '';
  for (let h = startH; h < endH; h++) times += `<div class="t" style="top:${(h - startH) * 60 * PPM}px">${pad(h)}:00</div>`;

  let colsHtml = '';
  for (let d = 0; d < days; d++) {
    const date = addDays(state.monday, d);
    const isToday = ymd(date) === today;
    const blocks = layoutDay(state.week.sessions.filter((s) => s.day === d)).map(({ s, lane, lanes }) => {
      const info = sessionInfo(s);
      const top = (toMin(s.start) - startH * 60) * PPM;
      const h = Math.max(18, (toMin(s.end) - toMin(s.start)) * PPM);
      const dur = toMin(s.end) - toMin(s.start);
      const size = dur < 50 ? 'xs' : dur < 80 ? 'sm' : '';
      const where = [info.room, info.teacher].filter(Boolean).map(esc).join(' · ');
      return `<button class="sess ${size} ${s.type === 'Examen' ? 'exam' : ''}" data-id="${esc(s.id)}"
        style="top:${top}px;height:${h}px;left:calc(${(lane * 100) / lanes}% + 3px);width:calc(${100 / lanes}% - 6px);--c:${esc(info.color)}"
        title="${esc(info.name)} — ${s.start}–${s.end}${info.room ? ' — ' + esc(info.room) : ''}">
        <span class="sess-title">${esc(info.name)}</span>
        <span class="sess-time">${s.start} – ${s.end}${s.type ? `<em>${esc(s.type)}</em>` : ''}</span>
        ${where ? `<span class="sess-meta">${where}</span>` : ''}
        ${s.note ? `<span class="sess-note">${esc(s.note)}</span>` : ''}
      </button>`;
    }).join('');
    const nowLine = isToday && nowMin >= startH * 60 && nowMin <= endH * 60
      ? `<div class="now-line" style="top:${(nowMin - startH * 60) * PPM}px"></div>` : '';
    colsHtml += `<div class="day-col ${isToday ? 'today' : ''}" data-day="${d}" style="height:${totalMin * PPM}px">${blocks}${nowLine}</div>`;
  }

  el.style.setProperty('--hour-px', `${60 * PPM}px`);
  el.classList.toggle('loading', !state.weekLoaded);
  el.innerHTML = `${head}<div class="tt-body" style="${cols}"><div class="times" style="height:${totalMin * PPM}px">${times}</div>${colsHtml}</div>`;
}

function renderDayList() {
  const el = $('#dayList');
  const { days } = state.range;
  const today = ymd(new Date());
  let html = '';
  for (let d = 0; d < days; d++) {
    const date = addDays(state.monday, d);
    const list = state.week.sessions.filter((s) => s.day === d).sort((a, b) => toMin(a.start) - toMin(b.start));
    if (d >= 5 && !list.length && !isAdmin()) continue;
    const cards = list.map((s) => {
      const info = sessionInfo(s);
      const meta = [s.type, info.room, info.teacher].filter(Boolean).map(esc).join(' · ');
      return `<button class="dl-sess" data-id="${esc(s.id)}" style="--c:${esc(info.color)}">
        <span class="dl-time">${s.start}<small>${s.end}</small></span>
        <span class="dl-body"><b>${esc(info.name)}</b>${meta ? `<span>${meta}</span>` : ''}${s.note ? `<i>${esc(s.note)}</i>` : ''}</span>
      </button>`;
    }).join('');
    html += `<section class="dl-day ${ymd(date) === today ? 'today' : ''}">
      <h3>${DAY_NAMES[d]} <small>${date.getDate()} ${MONTHS[date.getMonth()]}</small></h3>
      ${cards || '<p class="empty">Pas de cours</p>'}
      ${isAdmin() ? `<button class="btn small ghost add-day" data-day="${d}">+ Ajouter une séance</button>` : ''}
    </section>`;
  }
  el.innerHTML = html;
}

function renderSummary() {
  const el = $('#summary');
  const per = new Map();
  let total = 0;
  for (const s of state.week.sessions) {
    const dur = Math.max(0, toMin(s.end) - toMin(s.start));
    total += dur;
    per.set(s.courseId, (per.get(s.courseId) || 0) + dur);
  }
  if (!total) {
    const t = state.week.type;
    el.innerHTML = state.weekLoaded && !t
      ? `<p class="empty-week">Aucune séance cette semaine.${isAdmin() ? ' Clique sur la grille ou sur « + Séance » pour commencer.' : ''}</p>` : '';
    return;
  }
  const chips = [...per.entries()].sort((a, b) => b[1] - a[1]).map(([id, m]) => {
    const c = get('courses', id);
    return `<span class="chip" style="--c:${esc(c?.color || '#94a3b8')}"><i></i>${esc(c?.name || 'Cours supprimé')} <b>${fmtDur(m)}</b></span>`;
  }).join('');
  el.innerHTML = `<div class="total">Total de la semaine <b>${fmtDur(total)}</b> · ${state.week.sessions.length} séance${state.week.sessions.length > 1 ? 's' : ''}</div><div class="chips">${chips}</div>`;
}

/* ───────────────────────── Dialogues : outils ───────────────────────── */
function openDialog(id) { const d = $(id); if (!d.open) d.showModal(); return d; }
function closeDialog(el) { el.closest('dialog')?.close(); }

function fillSelect(sel, kind, value, { optional = false } = {}) {
  const items = state.lib[kind];
  const opts = [];
  opts.push(`<option value="">${optional ? '— Aucun —' : items.length ? '— Choisir —' : `Aucun ${KINDS[kind].one} : clique sur +`}</option>`);
  for (const i of items) opts.push(`<option value="${esc(i.id)}">${esc(i.name)}${i.code ? ` (${esc(i.code)})` : ''}</option>`);
  if (value && !items.some((i) => i.id === value)) opts.push(`<option value="${esc(value)}">(supprimé)</option>`);
  sel.innerHTML = opts.join('');
  sel.value = value || '';
}

/* ───────────────────────── Séances ───────────────────────── */
function openSession(id) {
  const s = state.week.sessions.find((x) => x.id === id);
  if (!s) return;
  if (isAdmin()) editSession(s);
  else showDetail(s);
}

function showDetail(s) {
  const info = sessionInfo(s);
  const date = addDays(state.monday, s.day);
  $('#detailTitle').innerHTML = `<i class="dot" style="--c:${esc(info.color)}"></i>${esc(info.name)}`;
  const row = (k, v) => (v ? `<div class="drow"><span>${k}</span><b>${v}</b></div>` : '');
  $('#detailBody').innerHTML = [
    row('Date', `${DAY_NAMES[s.day]} ${date.getDate()} ${MONTHS[date.getMonth()]}`),
    row('Horaire', `${s.start} – ${s.end} <small>(${fmtDur(toMin(s.end) - toMin(s.start))})</small>`),
    row('Type', esc(s.type)),
    row('Salle', info.roomObj ? esc(info.room) + (info.roomObj.building ? ` <small>${esc(info.roomObj.building)}</small>` : '') : ''),
    row('Prof', info.teacherObj ? (info.teacherObj.email ? `<a href="mailto:${esc(info.teacherObj.email)}">${esc(info.teacher)}</a>` : esc(info.teacher)) : ''),
    row('Note', esc(s.note)),
  ].join('');
  openDialog('#detailDialog');
}

function editSession(s, preset = {}) {
  const f = $('#sessionForm');
  const isNew = !s;
  const dur = Number(state.settings.defaultDuration) || 120;
  const base = s || {
    id: null, day: preset.day ?? 0, start: preset.start || '08:00',
    end: preset.end || fromMin(Math.min(toMin(preset.start || '08:00') + dur, 23 * 60 + 55)),
    courseId: state.lib.courses.length === 1 ? state.lib.courses[0].id : '', teacherId: '', roomId: '', type: 'Cours', note: '',
  };
  state.editing = { ...base };
  $('#sessionTitle').textContent = isNew ? 'Nouvelle séance' : 'Modifier la séance';
  f.day.innerHTML = DAY_NAMES.map((n, i) => `<option value="${i}">${n} ${addDays(state.monday, i).getDate()}</option>`).join('');
  f.type.innerHTML = SESSION_TYPES.map((t) => `<option>${t}</option>`).join('');
  fillSelect(f.courseId, 'courses', base.courseId);
  fillSelect(f.teacherId, 'teachers', base.teacherId, { optional: true });
  fillSelect(f.roomId, 'rooms', base.roomId, { optional: true });
  f.day.value = base.day;
  f.type.value = SESSION_TYPES.includes(base.type) ? base.type : 'Autre';
  f.start.value = base.start;
  f.end.value = base.end;
  f.note.value = base.note || '';
  f.repeat.checked = false;
  f.repeatCount.value = 1;
  $('#deleteSessionBtn').hidden = isNew;
  $('#duplicateSessionBtn').hidden = isNew;
  $('#sessionError').hidden = true;
  checkConflicts();
  openDialog('#sessionDialog');
  if (isNew) setTimeout(() => f.courseId.focus(), 50);
}

function readSessionForm() {
  const f = $('#sessionForm');
  return {
    id: state.editing?.id || null,
    day: Number(f.day.value),
    start: f.start.value,
    end: f.end.value,
    courseId: f.courseId.value,
    teacherId: f.teacherId.value,
    roomId: f.roomId.value,
    type: f.type.value,
    note: f.note.value.trim(),
  };
}

function checkConflicts() {
  const s = readSessionForm();
  const el = $('#conflictWarn');
  if (!s.start || !s.end || toMin(s.end) <= toMin(s.start)) { el.hidden = true; return; }
  const overl = state.week.sessions.filter((x) => x.id !== s.id && x.day === s.day &&
    toMin(x.start) < toMin(s.end) && toMin(s.start) < toMin(x.end));
  const msgs = [];
  for (const x of overl) {
    const info = sessionInfo(x);
    const why = [];
    if (s.roomId && x.roomId === s.roomId) why.push(`même salle (${esc(info.room)})`);
    if (s.teacherId && x.teacherId === s.teacherId) why.push(`même prof (${esc(info.teacher)})`);
    msgs.push(`Chevauche <b>${esc(info.name)}</b> ${x.start}–${x.end}${why.length ? ' — ' + why.join(', ') : ''}`);
  }
  el.hidden = !msgs.length;
  el.innerHTML = msgs.join('<br>');
}

async function saveSession(e) {
  e.preventDefault();
  const f = $('#sessionForm');
  const s = readSessionForm();
  const err = $('#sessionError');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  if (!s.courseId) return fail('Choisis un cours (ou crée-le avec le bouton +).');
  if (!s.start || !s.end) return fail('Indique l’heure de début et de fin.');
  if (toMin(s.end) <= toMin(s.start)) return fail('L’heure de fin doit être après l’heure de début.');
  const isNew = !s.id;
  if (isNew) s.id = newId();
  const sessions = state.week.sessions.filter((x) => x.id !== s.id).concat(s);
  closeDialog(f);
  const ok = await persistWeek({ ...state.week, sessions });
  if (!ok) return;
  const n = f.repeat.checked ? Math.min(52, Math.max(1, Number(f.repeatCount.value) || 1)) : 0;
  for (let i = 1; i <= n; i++) {
    const id = ymd(addDays(state.monday, 7 * i));
    try {
      const w = normalizeWeek(await state.store.getWeek(id));
      w.sessions.push({ ...s, id: newId() });
      await state.store.saveWeek(id, { ...w, updatedAt: Date.now() });
    } catch (e2) { toast(errMsg(e2), 'error'); return; }
  }
  toast((isNew ? 'Séance ajoutée' : 'Séance enregistrée') + (n ?` (+ ${n} semaine${n > 1 ? 's' : ''})` : ''), 'success');
}

async function deleteSession() {
  const id = state.editing?.id;
  if (!id || !confirm('Supprimer cette séance ?')) return;
  closeDialog($('#sessionForm'));
  if (await persistWeek({ ...state.week, sessions: state.week.sessions.filter((x) => x.id !== id) })) toast('Séance supprimée');
}

function duplicateSession() {
  const s = readSessionForm();
  closeDialog($('#sessionForm'));
  editSession(null, { day: s.day, start: s.start, end: s.end });
  const f = $('#sessionForm');
  fillSelect(f.courseId, 'courses', s.courseId);
  fillSelect(f.teacherId, 'teachers', s.teacherId, { optional: true });
  fillSelect(f.roomId, 'rooms', s.roomId, { optional: true });
  f.type.value = s.type;
  f.note.value = s.note;
  $('#sessionTitle').textContent = 'Copie de la séance';
  checkConflicts();
}

/* ───────────────────────── Bibliothèque ───────────────────────── */
function renderLibrary() {
  const kind = state.libTab;
  $$('#libraryDialog .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === kind));
  const q = $('#libSearch').value.trim().toLowerCase();
  const items = state.lib[kind].filter((i) => !q || JSON.stringify(i).toLowerCase().includes(q));
  const k = KINDS[kind];
  $('#libAddBtn').textContent = `+ ${k.newTitle}`;
  $('#libList').innerHTML = items.length ? items.map((i) => `
    <li>
      ${kind === 'courses' ? `<i class="dot" style="--c:${esc(i.color || '#94a3b8')}"></i>` : `<i class="avatar">${esc((i.name || '?').trim().charAt(0).toUpperCase())}</i>`}
      <div class="lib-main"><b>${esc(i.name)}</b>${k.sub(i) ? `<small>${esc(k.sub(i))}</small>` : ''}</div>
      <button class="icon-btn" data-edit="${esc(i.id)}" title="Modifier" aria-label="Modifier"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg></button>
      <button class="icon-btn danger" data-del="${esc(i.id)}" title="Supprimer" aria-label="Supprimer"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
    </li>`).join('')
    : `<li class="empty">${q ? 'Aucun résultat.' : `Aucun ${k.one} pour l’instant. Ajoute le premier !`}</li>`;
}

let itemCallback = null;
function openItem(kind, item = null, onSaved = null) {
  const k = KINDS[kind];
  itemCallback = onSaved;
  const f = $('#itemForm');
  f.dataset.kind = kind;
  f.dataset.id = item?.id || '';
  $('#itemTitle').textContent = item ? k.editTitle : k.newTitle;
  const used = new Set(state.lib.courses.map((c) => c.color));
  const defColor = PALETTE.find((c) => !used.has(c)) || PALETTE[state.lib.courses.length % PALETTE.length];
  $('#itemFields').innerHTML = k.fields.map((fd) => {
    const v = item?.[fd.name] ?? '';
    if (fd.type === 'color') {
      const cur = v || defColor;
      return `<div class="field"><span>${fd.label}</span><div class="swatches">
        ${PALETTE.map((c) => `<button type="button" class="sw ${c === cur ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}
        <input type="color" name="color" value="${esc(cur)}" title="Couleur personnalisée"></div></div>`;
    }
    return `<label class="field">${fd.label}${fd.required ? ' *' : ''}<input type="${fd.type || 'text'}" name="${fd.name}" value="${esc(v)}" ${fd.required ? 'required' : ''} ${fd.maxlength ? `maxlength="${fd.maxlength}"` : 'maxlength="80"'} placeholder="${esc(fd.placeholder || '')}"></label>`;
  }).join('') + '<p class="form-error" id="itemError" hidden></p>';
  openDialog('#itemDialog');
  setTimeout(() => f.querySelector('input')?.focus(), 50);
}

async function saveItem(e) {
  e.preventDefault();
  const f = $('#itemForm');
  const kind = f.dataset.kind;
  const data = {};
  for (const fd of KINDS[kind].fields) data[fd.name] = (f.elements[fd.name]?.value || '').trim();
  if (!data.name) { const er = $('#itemError'); er.textContent = 'Le nom est obligatoire.'; er.hidden = false; return; }
  const dup = state.lib[kind].find((i) => i.id !== f.dataset.id && i.name.toLowerCase() === data.name.toLowerCase());
  if (dup && !confirm(`« ${data.name} » existe déjà. Créer quand même un doublon ?`)) return;
  if (f.dataset.id) data.id = f.dataset.id;
  closeDialog(f);
  try {
    const id = await state.store.saveItem(kind, data);
    toast(`${KINDS[kind].one.charAt(0).toUpperCase() + KINDS[kind].one.slice(1)} enregistré${kind === 'rooms' ? 'e' : ''}`, 'success');
    itemCallback?.(id);
  } catch (err) { toast(errMsg(err), 'error'); }
  itemCallback = null;
}

async function deleteItem(kind, id) {
  const item = get(kind, id);
  const usedHere = state.week.sessions.filter((s) => s.courseId === id || s.teacherId === id || s.roomId === id).length;
  const msg = `Supprimer « ${item?.name} » de la bibliothèque ?` +
    (usedHere ? `\n\nAttention : utilisé dans ${usedHere} séance(s) de cette semaine (et peut-être d’autres).` : '');
  if (!confirm(msg)) return;
  try { await state.store.deleteItem(kind, id); toast('Supprimé'); } catch (err) { toast(errMsg(err), 'error'); }
}

/* ───────────────────────── Semaine : copie, vidage ───────────────────────── */
function openCopy() {
  const f = $('#copyForm');
  $('#copySource').textContent = `Semaine ${isoWeek(state.monday)} (${fmtRange(state.monday, state.range.days)}) — ${state.week.sessions.length} séance(s)`;
  f.date.value = ymd(addDays(state.monday, 7));
  openDialog('#copyDialog');
}

async function doCopy(e) {
  e.preventDefault();
  const f = $('#copyForm');
  const target = f.target.value;
  let mondays = [];
  if (target === 'next') mondays = [addDays(state.monday, 7)];
  else if (target === 'many') {
    const n = Math.min(52, Math.max(1, Number(f.count.value) || 1));
    mondays = Array.from({ length: n }, (_, i) => addDays(state.monday, 7 * (i + 1)));
  } else {
    if (!f.date.value) return toast('Choisis une date', 'error');
    mondays = [mondayOf(parseYmd(f.date.value))];
  }
  mondays = mondays.filter((m) => ymd(m) !== weekId());
  if (!mondays.length) return toast('La semaine cible est la semaine actuelle.', 'error');
  const replace = f.mode.value === 'replace';
  const withMeta = f.withMeta.checked;
  closeDialog(f);
  try {
    for (const m of mondays) {
      const id = ymd(m);
      const existing = normalizeWeek(await state.store.getWeek(id));
      const copies = state.week.sessions.map((s) => ({ ...s, id: newId() }));
      const w = {
        type: withMeta ? state.week.type : existing.type,
        note: withMeta ? state.week.note : existing.note,
        sessions: replace ? copies : existing.sessions.concat(copies),
        updatedAt: Date.now(),
      };
      await state.store.saveWeek(id, w);
    }
    toast(`Semaine dupliquée vers ${mondays.length} semaine${mondays.length > 1 ? 's' : ''}`, 'success');
  } catch (err) { toast(errMsg(err), 'error'); }
}

async function clearWeek() {
  if (!state.week.sessions.length && !state.week.type && !state.week.note) return toast('La semaine est déjà vide');
  if (!confirm('Vider complètement cette semaine (séances, type et note) ?')) return;
  if (await persistWeek(emptyWeek())) toast('Semaine vidée');
}

/* ───────────────────────── Paramètres ───────────────────────── */
function openSettings() {
  const f = $('#settingsForm');
  const s = state.settings;
  f.startHour.innerHTML = Array.from({ length: 9 }, (_, i) => i + 5).map((h) => `<option value="${h}">${pad(h)}:00</option>`).join('');
  f.endHour.innerHTML = Array.from({ length: 11 }, (_, i) => i + 14).map((h) => `<option value="${h}">${pad(h)}:00</option>`).join('');
  f.title.value = s.title || '';
  f.startHour.value = s.startHour;
  f.endHour.value = s.endHour;
  f.days.value = s.days;
  f.defaultDuration.value = s.defaultDuration;
  openDialog('#settingsDialog');
}
async function saveSettings(e) {
  e.preventDefault();
  const f = $('#settingsForm');
  const s = {
    title: f.title.value.trim() || DEFAULT_SETTINGS.title,
    startHour: Number(f.startHour.value),
    endHour: Number(f.endHour.value),
    days: Number(f.days.value),
    defaultDuration: Number(f.defaultDuration.value),
  };
  if (s.endHour <= s.startHour) return toast('La fin de journée doit être après le début.', 'error');
  closeDialog(f);
  state.settings = { ...state.settings, ...s };
  render();
  try { await state.store.saveSettings(s); toast('Paramètres enregistrés', 'success'); } catch (err) { toast(errMsg(err), 'error'); }
}

/* ───────────────────────── Connexion ───────────────────────── */
function openLogin() {
  const f = $('#loginForm');
  const local = state.store.mode === 'local';
  $('#loginLocalNote').hidden = !local;
  f.email.required = f.password.required = !local;
  f.email.closest('.field').hidden = f.password.closest('.field').hidden = local;
  $('#forgotBtn').hidden = local;
  $('#loginError').hidden = true;
  f.password.value = '';
  openDialog('#loginDialog');
  if (!local) setTimeout(() => (f.email.value ? f.password : f.email).focus(), 50);
}
async function doLogin(e) {
  e.preventDefault();
  const f = $('#loginForm');
  const err = $('#loginError');
  err.hidden = true;
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    await state.store.login(f.email.value.trim(), f.password.value);
    closeDialog(f);
    toast('Mode gestion activé', 'success');
  } catch (ex) {
    const c = ex?.code || '';
    err.textContent = c.includes('invalid') || c.includes('wrong-password') || c.includes('user-not-found')
      ? 'E-mail ou mot de passe incorrect.'
      : c.includes('too-many-requests') ? 'Trop de tentatives, réessaie dans quelques minutes.' : errMsg(ex);
    err.hidden = false;
  } finally { btn.disabled = false; }
}
async function forgotPassword() {
  const email = $('#loginForm').email.value.trim();
  if (!email) { const er = $('#loginError'); er.textContent = 'Saisis ton e-mail d’abord.'; er.hidden = false; return; }
  try { await state.store.resetPassword(email); toast('E-mail de réinitialisation envoyé', 'success'); }
  catch (err) { toast(errMsg(err), 'error'); }
}
function updateAuthUI() {
  const btn = $('#manageBtn');
  btn.classList.toggle('primary', !isAdmin());
  btn.classList.toggle('exit', isAdmin());
  btn.querySelector('span').textContent = isAdmin() ? 'Quitter la gestion' : 'Gestion';
  btn.title = isAdmin() ? `Connecté : ${state.user.email}` : 'Se connecter pour modifier';
}

/* ───────────────────────── Export .ics ───────────────────────── */
function exportIcs() {
  if (!state.week.sessions.length) return toast('Aucune séance à exporter cette semaine');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const dt = (day, t) => { const d = addDays(state.monday, day); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${t.replace(':', '')}00`; };
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//My Timetable//FR', 'CALSCALE:GREGORIAN'];
  for (const s of state.week.sessions) {
    const info = sessionInfo(s);
    lines.push('BEGIN:VEVENT', `UID:${s.id}-${weekId()}@my-timetable`, `DTSTAMP:${stamp}`,
      `DTSTART:${dt(s.day, s.start)}`, `DTEND:${dt(s.day, s.end)}`,
      `SUMMARY:${icsEsc(info.name + (s.type ? ` (${s.type})` : ''))}`);
    if (info.room) lines.push(`LOCATION:${icsEsc(info.room + (info.roomObj?.building ? ', ' + info.roomObj.building : ''))}`);
    const desc = [info.teacher && `Prof : ${info.teacher}`, s.note].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${icsEsc(desc)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `emploi-du-temps-S${isoWeek(state.monday)}-${weekId()}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ───────────────────────── Événements ───────────────────────── */
function bindUI() {
  $('#prevWeek').onclick = () => setMonday(addDays(state.monday, -7));
  $('#nextWeek').onclick = () => setMonday(addDays(state.monday, 7));
  $('#todayBtn').onclick = () => setMonday(new Date());
  $('#weekLabelBtn').onclick = () => { const p = $('#datePicker'); try { p.showPicker(); } catch { p.focus(); p.click(); } };
  $('#datePicker').onchange = (e) => e.target.value && setMonday(parseYmd(e.target.value));
  $('#printBtn').onclick = () => window.print();
  $('#icsBtn').onclick = exportIcs;
  $('#manageBtn').onclick = async () => {
    if (isAdmin()) { await state.store.logout(); toast('Déconnecté'); } else openLogin();
  };

  // Grille : clic sur une séance ou sur un créneau vide
  $('#timetable').addEventListener('click', (e) => {
    const b = e.target.closest('.sess');
    if (b) return openSession(b.dataset.id);
    const col = e.target.closest('.day-col');
    if (!col || !isAdmin()) return;
    const y = e.clientY - col.getBoundingClientRect().top;
    const m = state.range.startH * 60 + Math.floor(y / PPM / 30) * 30;
    editSession(null, { day: Number(col.dataset.day), start: fromMin(Math.max(0, m)) });
  });
  $('#dayList').addEventListener('click', (e) => {
    const b = e.target.closest('.dl-sess');
    if (b) return openSession(b.dataset.id);
    const add = e.target.closest('.add-day');
    if (add) editSession(null, { day: Number(add.dataset.day), start: pad(state.settings.startHour) + ':00' });
  });

  // Barre de gestion
  $('#weekType').onchange = (e) => persistWeek({ ...state.week, type: e.target.value });
  let noteTimer;
  $('#weekNote').oninput = (e) => { clearTimeout(noteTimer); noteTimer = setTimeout(() => persistWeek({ ...state.week, note: e.target.value.trim() }), 700); };
  $('#addSessionBtn').onclick = () => {
    const todayIdx = Math.round((mondayOf(new Date()) - state.monday) / 864e5) === 0 ? (new Date().getDay() + 6) % 7 : 0;
    editSession(null, { day: Math.min(todayIdx, state.range.days - 1), start: pad(state.settings.startHour) + ':00' });
  };
  $('#copyWeekBtn').onclick = openCopy;
  $('#clearWeekBtn').onclick = clearWeek;
  $('#libraryBtn').onclick = () => { renderLibrary(); openDialog('#libraryDialog'); };
  $('#settingsBtn').onclick = openSettings;

  // Fermeture des dialogues
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDialog(e.target); });
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  // Séance
  const sf = $('#sessionForm');
  sf.addEventListener('submit', saveSession);
  sf.addEventListener('input', checkConflicts);
  sf.start.addEventListener('change', () => {
    // garde la durée quand on déplace le début
    const prev = state.editing;
    if (!prev) return;
    const dur = toMin(prev.end) - toMin(prev.start);
    if (dur > 0) sf.end.value = fromMin(Math.min(toMin(sf.start.value) + dur, 23 * 60 + 55));
    state.editing = { ...prev, start: sf.start.value, end: sf.end.value };
    checkConflicts();
  });
  sf.end.addEventListener('change', () => { if (state.editing) state.editing.end = sf.end.value; });
  $('#deleteSessionBtn').onclick = deleteSession;
  $('#duplicateSessionBtn').onclick = duplicateSession;
  $$('.add-inline').forEach((b) => b.onclick = () => {
    const kind = b.dataset.kind;
    const sel = sf.elements[kind === 'courses' ? 'courseId' : kind === 'teachers' ? 'teacherId' : 'roomId'];
    openItem(kind, null, (id) => {
      // la liste se met à jour via l'abonnement ; on attend un tick
      setTimeout(() => { fillSelect(sel, kind, id, { optional: kind !== 'courses' }); checkConflicts(); }, 60);
    });
  });

  // Bibliothèque
  $$('#libraryDialog .tab').forEach((t) => t.onclick = () => { state.libTab = t.dataset.tab; $('#libSearch').value = ''; renderLibrary(); });
  $('#libSearch').oninput = renderLibrary;
  $('#libAddBtn').onclick = () => openItem(state.libTab);
  $('#libList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return openItem(state.libTab, get(state.libTab, ed.dataset.edit));
    const del = e.target.closest('[data-del]');
    if (del) deleteItem(state.libTab, del.dataset.del);
  });
  $('#itemForm').addEventListener('submit', saveItem);
  $('#itemFields').addEventListener('click', (e) => {
    const sw = e.target.closest('.sw');
    if (!sw) return;
    $$('#itemFields .sw').forEach((x) => x.classList.toggle('on', x === sw));
    $('#itemForm').elements.color.value = sw.dataset.color;
  });
  $('#itemFields').addEventListener('input', (e) => {
    if (e.target.type === 'color') $$('#itemFields .sw').forEach((x) => x.classList.toggle('on', x.dataset.color === e.target.value));
  });

  $('#copyForm').addEventListener('submit', doCopy);
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#loginForm').addEventListener('submit', doLogin);
  $('#forgotBtn').onclick = forgotPassword;

  // Clavier : ← / → pour changer de semaine
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (e.key === 'ArrowLeft') setMonday(addDays(state.monday, -7));
    if (e.key === 'ArrowRight') setMonday(addDays(state.monday, 7));
  });
  window.addEventListener('hashchange', () => { if (readHash()) loadWeek(); });

  // Ligne « maintenant » rafraîchie chaque minute
  setInterval(() => state.store && renderGrid(), 60_000);
}

/* ───────────────────────── Démarrage ───────────────────────── */
async function init() {
  readHash();
  bindUI();
  try {
    state.store = await createStore();
  } catch (e) {
    console.error(e);
    toast('Connexion à Firebase impossible : passage en mode local.', 'error');
    state.store = await createStore({ forceLocal: true });
  }
  state.store.onError = (err) => toast(errMsg(err), 'error');
  if (state.store.mode === 'local') {
    const b = $('#modeBadge');
    b.hidden = false;
    b.textContent = 'Mode local';
    b.title = 'Firebase n’est pas configuré : les données restent dans ce navigateur.';
  }
  for (const kind of Object.keys(KINDS)) {
    state.store.subscribeCollection(kind, (items) => {
      state.lib[kind] = items.sort(byName);
      render();
      if ($('#libraryDialog').open) renderLibrary();
    });
  }
  state.store.subscribeSettings((s) => { state.settings = { ...DEFAULT_SETTINGS, ...s }; render(); });
  state.store.onAuth((user) => { state.user = user; updateAuthUI(); render(); });
  loadWeek();
}

init();

// PWA : cache hors-ligne de l'interface
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
