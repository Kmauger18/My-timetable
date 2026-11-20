// Import d'emplois du temps depuis un PDF ou une photo (grille manuscrite ou imprimée).
// 1. Les pages sont transformées en images (pdf.js pour les PDF).
// 2. Chaque page est lue par l'IA (Gemini via Firebase AI Logic) → séances détectées.
// 3. Écran de vérification : on corrige, puis on importe dans les semaines.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
const MAX_W = 1800;

const $ = (s, r = document) => r.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const PALETTE = ['#4f46e5', '#0ea5e9', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b', '#92400e'];

// Lundi de la semaine ISO n°w de l'année y
function isoWeekMonday(y, w) {
  const jan4 = new Date(y, 0, 4);
  return addDays(mondayOf(jan4), (w - 1) * 7);
}
// Parmi l'année précédente / en cours / suivante, la date la plus proche d'aujourd'hui
function nearest(candidates) {
  const now = Date.now();
  return candidates.sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0];
}
function guessMonday(weekNumber, mondayDate) {
  const y = new Date().getFullYear();
  if (weekNumber >= 1 && weekNumber <= 53) return nearest([y - 1, y, y + 1].map((yy) => isoWeekMonday(yy, weekNumber)));
  const m = /^(\d{1,2})[/.-](\d{1,2})/.exec(mondayDate || '');
  if (m) return mondayOf(nearest([y - 1, y, y + 1].map((yy) => new Date(yy, Number(m[2]) - 1, Number(m[1])))));
  return null;
}
function fixTime(t) {
  const m = /(\d{1,2})\s*[:hH.]\s*(\d{2})?/.exec(String(t || ''));
  if (!m) return '';
  const h = Math.min(23, Number(m[1])), mi = Math.min(59, Number(m[2] || 0));
  return `${pad(h)}:${pad(mi)}`;
}

/* ───────────── Fichiers → images ───────────── */
let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ||= import(PDFJS + 'pdf.min.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
    return m;
  });
  return pdfjsPromise;
}
function canvasToImage(canvas) {
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { url, data: url.split(',')[1], mime: 'image/jpeg' };
}
async function pdfToImages(file) {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, MAX_W / base.width) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push({ ...canvasToImage(c), label: `${file.name} · p.${i}` });
  }
  return out;
}
async function imageFileToImage(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, MAX_W / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return { ...canvasToImage(c), label: file.name };
}

/* ───────────── Lecture IA ───────────── */
function buildPrompt(lib) {
  const list = (arr) => arr.slice(0, 80).map((i) => i.code ? `${i.name} (${i.code})` : i.name).join(', ') || '(aucun)';
  return `Tu lis la photo ou le scan d'un emploi du temps hebdomadaire (souvent une grille remplie à la main).
- Colonnes : les jours (Lundi à Vendredi, parfois Samedi), avec souvent une date écrite à côté (ex. « Lundi 30 », « Mardi 1/12 »).
- Lignes : les créneaux horaires imprimés à gauche (ex. 8:00-9:00, 9:00-10:00, 10:00-11:00, 11:00-12:00, 13:30-14:30, 14:30-15:30, 15:30-16:30, 16:30-17:30, 17:30-18:30). Utilise les heures réellement imprimées sur la grille.
- Une accolade ({ ou }) dessinée à gauche d'un texte regroupe plusieurs créneaux consécutifs : la séance va du début du premier créneau couvert par l'accolade à la fin du dernier.
- Sans accolade, la séance n'occupe que le créneau (la ligne) où le texte est écrit.
- Une séance contient en général un nom de professeur (ex. « Lesaigle ») et un code de module (ex. « USBTN3 », « USBT20 », « UABT18 »). Parfois c'est une matière avec un professeur (« Communication DAVID », « Anglais I Godey ») ou une mention (« Autonomie encadrée », « Entreprise Néosite », « Néosite intervenant externe »).
- IGNORE le texte très pâle, gommé, effacé ou barré : il a été annulé.
- Ne crée pas de séance pour une case vide.
Noms déjà connus (si un texte y correspond, recopie exactement cette orthographe) :
- Professeurs : ${list(lib.teachers)}
- Cours / codes : ${list(lib.courses)}
- Salles : ${list(lib.rooms)}

Réponds UNIQUEMENT avec un objet JSON de cette forme :
{"weekNumber": numéro de semaine écrit (ex. 49) ou null,
 "mondayDate": "JJ/MM" date du lundi si elle est lisible, sinon null,
 "sessions": [{"day": 0 pour lundi … 4 pour vendredi, "start": "HH:MM", "end": "HH:MM",
   "course": "code de module ou matière (ou la mention s'il n'y en a pas)", "teacher": "nom du professeur ou \\"\\"",
   "room": "salle ou \\"\\"", "note": "autre information utile ou \\"\\""}]}`;
}
function parseAiJson(text) {
  const t = String(text || '').replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  const obj = JSON.parse(start >= 0 ? t.slice(start, end + 1) : t);
  const rows = (Array.isArray(obj.sessions) ? obj.sessions : []).map((s) => ({
    day: Math.max(0, Math.min(6, Number(s.day) || 0)),
    start: fixTime(s.start), end: fixTime(s.end),
    course: String(s.course || '').trim(), teacher: String(s.teacher || '').trim(),
    room: String(s.room || '').trim(), note: String(s.note || '').trim(), type: 'Cours',
  })).filter((r) => r.course || r.teacher || r.note);
  return { weekNumber: Number(obj.weekNumber) || null, mondayDate: obj.mondayDate || null, rows };
}

/* ───────────── Interface ───────────── */
export function setupImporter(ctx) {
  const { state, toast, errMsg, setMonday, isoWeek } = ctx;
  let pages = [];
  let current = 0;
  const dlg = $('#importDialog');

  const findItem = (kind, text) => {
    const n = norm(text);
    if (!n) return null;
    return state.lib[kind].find((i) => norm(i.name) === n || (i.code && norm(i.code) === n)) || null;
  };

  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) start(files);
  };

  async function start(files) {
    pages = [];
    current = 0;
    $('#importStatus').textContent = 'Lecture des fichiers…';
    $('#importStatus').hidden = false;
    $('#importBody').hidden = true;
    if (!dlg.open) dlg.showModal();
    try {
      for (const f of files) {
        const imgs = f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? await pdfToImages(f) : [await imageFileToImage(f)];
        for (const img of imgs) pages.push({ img, rows: [], monday: null, status: 'pending', error: '' });
      }
    } catch (err) {
      console.error(err);
      $('#importStatus').textContent = 'Impossible de lire ce fichier : ' + (err?.message || err);
      return;
    }
    if (!pages.length) { $('#importStatus').textContent = 'Aucune page trouvée.'; return; }
    $('#importStatus').hidden = true;
    $('#importBody').hidden = false;
    render();
    for (let i = 0; i < pages.length; i++) await analyze(i);
  }

  async function analyze(i) {
    const p = pages[i];
    p.status = 'analyzing'; p.error = '';
    render();
    try {
      const text = await state.store.readImage(buildPrompt(state.lib), p.img);
      const res = parseAiJson(text);
      p.rows = res.rows;
      p.monday = guessMonday(res.weekNumber, res.mondayDate) || p.monday;
      p.weekNumber = res.weekNumber;
      p.status = 'done';
    } catch (err) {
      console.error(err);
      p.status = 'error';
      p.error = err?.code === 'ai/local'
        ? 'Lecture automatique indisponible en mode local : saisis les séances à la main à partir de l’image.'
        : /api.?key|PERMISSION|403|not enabled|has not been used|disabled/i.test(String(err?.message))
          ? 'La lecture IA n’est pas activée dans Firebase (Firebase AI Logic). Tu peux saisir les séances à la main.'
          : 'La lecture automatique a échoué (' + (err?.message || err).toString().slice(0, 140) + '). Tu peux réessayer ou saisir à la main.';
    }
    if (!p.monday) p.monday = i > 0 && pages[i - 1].monday ? addDays(pages[i - 1].monday, 7) : state.monday;
    render();
  }

  function newBadge(kind, text) {
    if (!text) return '';
    return findItem(kind, text) ? '' : '<span class="new-tag" title="N’existe pas encore : sera créé dans la bibliothèque">nouveau</span>';
  }

  function render() {
    // Onglets de pages
    $('#importTabs').innerHTML = pages.map((p, i) => {
      const lbl = p.monday ? `S${isoWeek(p.monday)}` : `Page ${i + 1}`;
      const ico = p.status === 'analyzing' ? '⏳' : p.status === 'error' ? '⚠️' : p.status === 'done' ? '✓' : '';
      return `<button class="tab ${i === current ? 'active' : ''}" data-page="${i}">${ico} ${esc(lbl)} <small>${p.rows.length}</small></button>`;
    }).join('');
    const p = pages[current];
    if (!p) return;
    $('#importImg').src = p.img.url;
    $('#importImgLabel').textContent = p.img.label;
    $('#importWeek').value = p.monday ? ymd(p.monday) : '';
    $('#importWeekInfo').textContent = p.monday ? `Semaine ${isoWeek(p.monday)} — du lundi ${p.monday.getDate()}/${pad(p.monday.getMonth() + 1)}` : '';
    const msg = $('#importMsg');
    if (p.status === 'analyzing') { msg.className = 'import-msg info'; msg.innerHTML = '<span class="spinner"></span> Lecture de la page par l’IA…'; msg.hidden = false; }
    else if (p.status === 'error') { msg.className = 'import-msg warn'; msg.textContent = p.error; msg.hidden = false; }
    else if (p.status === 'done') { msg.className = 'import-msg ok'; msg.textContent = `${p.rows.length} séance(s) détectée(s). Vérifie-les en comparant avec l’image avant d’importer.`; msg.hidden = false; }
    else msg.hidden = true;

    $('#importRows').innerHTML = p.rows.length ? p.rows.map((r, i) => {
      const bad = !r.course || !r.start || !r.end || toMin(r.end) <= toMin(r.start);
      return `<tr class="${bad ? 'bad' : ''}" data-row="${i}">
        <td><select data-k="day">${DAYS.slice(0, 6).map((d, k) => `<option value="${k}" ${k === r.day ? 'selected' : ''}>${d.slice(0, 3)}</option>`).join('')}</select></td>
        <td><input type="time" data-k="start" value="${esc(r.start)}" step="300"></td>
        <td><input type="time" data-k="end" value="${esc(r.end)}" step="300"></td>
        <td class="cell-tag"><input data-k="course" list="dlCourses" value="${esc(r.course)}" placeholder="Cours *">${newBadge('courses', r.course)}</td>
        <td class="cell-tag"><input data-k="teacher" list="dlTeachers" value="${esc(r.teacher)}" placeholder="Prof">${newBadge('teachers', r.teacher)}</td>
        <td class="cell-tag"><input data-k="room" list="dlRooms" value="${esc(r.room)}" placeholder="Salle">${newBadge('rooms', r.room)}</td>
        <td><input data-k="note" value="${esc(r.note)}" placeholder="Note"></td>
        <td><button class="icon-btn danger" data-delrow="${i}" title="Supprimer la ligne" aria-label="Supprimer la ligne">×</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="8" class="empty">${p.status === 'analyzing' ? 'Analyse en cours…' : 'Aucune séance. Ajoute des lignes à la main.'}</td></tr>`;

    // Listes de suggestions
    const opt = (arr, withCode) => arr.map((i) => `<option value="${esc(i.name)}">${withCode && i.code ? esc(i.code) : ''}</option>`).join('');
    $('#dlCourses').innerHTML = opt(state.lib.courses, true);
    $('#dlTeachers').innerHTML = opt(state.lib.teachers);
    $('#dlRooms').innerHTML = opt(state.lib.rooms);

    const total = pages.reduce((n, x) => n + x.rows.length, 0);
    const busy = pages.some((x) => x.status === 'analyzing');
    const btn = $('#importGo');
    btn.disabled = busy || !total;
    btn.textContent = `Importer ${total} séance${total > 1 ? 's' : ''} (${pages.filter((x) => x.rows.length).length} semaine${pages.filter((x) => x.rows.length).length > 1 ? 's' : ''})`;
    $('#importRetry').disabled = p.status === 'analyzing';
  }

  // Événements de la boîte de dialogue
  $('#importTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) { current = Number(b.dataset.page); render(); }
  });
  $('#importWeek').addEventListener('change', (e) => {
    if (e.target.value) { pages[current].monday = mondayOf(parseYmd(e.target.value)); render(); }
  });
  $('#importRows').addEventListener('input', (e) => {
    const tr = e.target.closest('[data-row]');
    const k = e.target.dataset.k;
    if (!tr || !k) return;
    const r = pages[current].rows[Number(tr.dataset.row)];
    r[k] = k === 'day' ? Number(e.target.value) : e.target.value;
    // mise à jour légère de la ligne (badges « nouveau » et validité) sans perdre le focus
    if (['course', 'teacher', 'room'].includes(k)) {
      const kind = { course: 'courses', teacher: 'teachers', room: 'rooms' }[k];
      e.target.parentElement.querySelector('.new-tag')?.remove();
      e.target.insertAdjacentHTML('afterend', newBadge(kind, r[k]));
    }
    tr.classList.toggle('bad', !r.course || !r.start || !r.end || toMin(r.end) <= toMin(r.start));
  });
  $('#importRows').addEventListener('click', (e) => {
    const d = e.target.closest('[data-delrow]');
    if (d) { pages[current].rows.splice(Number(d.dataset.delrow), 1); render(); }
  });
  $('#importAddRow').onclick = () => {
    const p = pages[current];
    const last = p.rows[p.rows.length - 1];
    p.rows.push({ day: last?.day ?? 0, start: last?.end || '08:00', end: '', course: '', teacher: '', room: '', note: '', type: 'Cours' });
    render();
    const inputs = document.querySelectorAll('#importRows tr:last-child input');
    inputs[1]?.focus();
  };
  $('#importRetry').onclick = () => analyze(current);
  $('#importZoom').onclick = () => $('#importImgWrap').classList.toggle('zoomed');
  $('#importGo').onclick = doImport;

  async function doImport() {
    const valid = (r) => r.course && r.start && r.end && toMin(r.end) > toMin(r.start);
    const badPage = pages.findIndex((p) => p.rows.some((r) => !valid(r)));
    if (badPage >= 0) {
      current = badPage; render();
      return toast('Certaines lignes sont incomplètes (cours, début et fin obligatoires) : elles sont surlignées.', 'error');
    }
    const targets = pages.filter((p) => p.rows.length);
    const ids = targets.map((p) => ymd(p.monday));
    if (new Set(ids).size !== ids.length) return toast('Deux pages visent la même semaine : corrige la date de l’une d’elles.', 'error');
    const replace = $('#importMode').value === 'replace';
    const btn = $('#importGo');
    btn.disabled = true;
    btn.textContent = 'Import en cours…';
    const created = { courses: 0, teachers: 0, rooms: 0 };
    const cache = { courses: {}, teachers: {}, rooms: {} };
    const usedColors = new Set(state.lib.courses.map((c) => c.color));
    const resolve = async (kind, text) => {
      const name = String(text || '').trim();
      if (!name) return '';
      const found = findItem(kind, name);
      if (found) return found.id;
      const n = norm(name);
      if (cache[kind][n]) return cache[kind][n];
      let data = { name };
      if (kind === 'courses') {
        const color = PALETTE.find((c) => !usedColors.has(c)) || PALETTE[(state.lib.courses.length + created.courses) % PALETTE.length];
        usedColors.add(color);
        data = { name, code: /^[A-Z0-9]{3,10}$/i.test(name) && /\d/.test(name) ? name.toUpperCase() : '', color };
      }
      const id = await state.store.saveItem(kind, data);
      cache[kind][n] = id;
      created[kind]++;
      return id;
    };
    try {
      for (const p of targets) {
        const sessions = [];
        for (const r of p.rows) {
          sessions.push({
            id: ctx.newId(), day: r.day, start: r.start, end: r.end, type: r.type || 'Cours', note: r.note || '',
            courseId: await resolve('courses', r.course),
            teacherId: await resolve('teachers', r.teacher),
            roomId: await resolve('rooms', r.room),
          });
        }
        const id = ymd(p.monday);
        const existing = ctx.normalizeWeek(await state.store.getWeek(id));
        await state.store.saveWeek(id, {
          type: existing.type || 'ecole',
          note: existing.note,
          sessions: replace ? sessions : existing.sessions.concat(sessions),
          updatedAt: Date.now(),
        });
      }
    } catch (err) {
      toast(errMsg(err), 'error');
      render();
      return;
    }
    dlg.close();
    const extra = [created.courses && `${created.courses} cours`, created.teachers && `${created.teachers} prof(s)`, created.rooms && `${created.rooms} salle(s)`].filter(Boolean).join(', ');
    toast(`${targets.length} semaine(s) importée(s)${extra ? ` · créés : ${extra}` : ''}`, 'success');
    setMonday(targets[0].monday);
  }
}

// Exposé pour les tests
export const _internal = { parseAiJson, guessMonday, isoWeekMonday, buildPrompt };
