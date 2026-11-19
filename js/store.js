// Couche de données : Firebase (Auth + Firestore) ou stockage local de démo.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

export const isConfigured = Boolean(
  firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('A_REMPLACER') && firebaseConfig.projectId
);

const clean = (obj) => JSON.parse(JSON.stringify(obj ?? {}));
const clone = (obj) => (obj == null ? obj : JSON.parse(JSON.stringify(obj)));
const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2))
    .replace(/-/g, '').slice(0, 20);

/* ───────────────────────── Firebase ───────────────────────── */
class FirebaseStore {
  mode = 'firebase';
  onError = null;

  async init() {
    const [appM, fsM, authM] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-firestore.js'),
      import(SDK + 'firebase-auth.js'),
    ]);
    this.fs = fsM;
    this.au = authM;
    const app = appM.initializeApp(firebaseConfig);
    try {
      // Cache hors-ligne : l'emploi du temps reste consultable sans réseau.
      this.db = fsM.initializeFirestore(app, {
        localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }),
      });
    } catch {
      this.db = fsM.getFirestore(app);
    }
    this.auth = authM.getAuth(app);
    return this;
  }

  _err = (err) => { console.error(err); this.onError?.(err); };

  subscribeCollection(kind, cb) {
    const { collection, onSnapshot } = this.fs;
    return onSnapshot(collection(this.db, kind),
      (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), this._err);
  }
  async saveItem(kind, item) {
    const { doc, collection, setDoc } = this.fs;
    const { id, ...rest } = item;
    const ref = id ? doc(this.db, kind, id) : doc(collection(this.db, kind));
    await setDoc(ref, clean(rest));
    return ref.id;
  }
  async deleteItem(kind, id) {
    const { doc, deleteDoc } = this.fs;
    await deleteDoc(doc(this.db, kind, id));
  }

  subscribeWeek(weekId, cb) {
    const { doc, onSnapshot } = this.fs;
    return onSnapshot(doc(this.db, 'weeks', weekId), (d) => cb(d.exists() ? d.data() : null), this._err);
  }
  async getWeek(weekId) {
    const { doc, getDoc } = this.fs;
    const d = await getDoc(doc(this.db, 'weeks', weekId));
    return d.exists() ? d.data() : null;
  }
  async saveWeek(weekId, data) {
    const { doc, setDoc } = this.fs;
    await setDoc(doc(this.db, 'weeks', weekId), clean(data));
  }
  async deleteWeek(weekId) {
    const { doc, deleteDoc } = this.fs;
    await deleteDoc(doc(this.db, 'weeks', weekId));
  }

  subscribeSettings(cb) {
    const { doc, onSnapshot } = this.fs;
    return onSnapshot(doc(this.db, 'settings', 'general'), (d) => cb(d.exists() ? d.data() : {}), this._err);
  }
  async saveSettings(s) {
    const { doc, setDoc } = this.fs;
    await setDoc(doc(this.db, 'settings', 'general'), clean(s), { merge: true });
  }

  onAuth(cb) {
    return this.au.onAuthStateChanged(this.auth, (u) => cb(u ? { email: u.email, uid: u.uid } : null));
  }
  async login(email, password) {
    await this.au.signInWithEmailAndPassword(this.auth, email, password);
  }
  async logout() { await this.au.signOut(this.auth); }
  async resetPassword(email) { await this.au.sendPasswordResetEmail(this.auth, email); }
}

/* ───────────────────────── Local (démo) ───────────────────────── */
const LOCAL_KEY = 'mytimetable:v1';
const emptyData = () => ({ courses: {}, teachers: {}, rooms: {}, weeks: {}, settings: {} });

class LocalStore {
  mode = 'local';
  onError = null;

  constructor() {
    this.data = this._load();
    this.listeners = new Set();
    this.authCbs = new Set();
    this.user = sessionStorage.getItem(LOCAL_KEY + ':admin') ? { email: 'mode local' } : null;
    window.addEventListener('storage', (e) => {
      if (e.key === LOCAL_KEY) { this.data = this._load(); this._emit(); }
    });
    if (!localStorage.getItem(LOCAL_KEY)) this._seed();
  }
  _load() {
    try { return { ...emptyData(), ...JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') }; }
    catch { return emptyData(); }
  }
  _save() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(this.data));
    this._emit();
  }
  _emit() { for (const l of this.listeners) l(); }
  _sub(fn) { this.listeners.add(fn); fn(); return () => this.listeners.delete(fn); }

  subscribeCollection(kind, cb) {
    return this._sub(() => cb(Object.entries(this.data[kind] || {}).map(([id, v]) => ({ ...clone(v), id }))));
  }
  async saveItem(kind, item) {
    const { id, ...rest } = item;
    const key = id || newId();
    this.data[kind][key] = clean(rest);
    this._save();
    return key;
  }
  async deleteItem(kind, id) { delete this.data[kind][id]; this._save(); }

  subscribeWeek(weekId, cb) { return this._sub(() => cb(clone(this.data.weeks[weekId] ?? null))); }
  async getWeek(weekId) { return clone(this.data.weeks[weekId] ?? null); }
  async saveWeek(weekId, data) { this.data.weeks[weekId] = clean(data); this._save(); }
  async deleteWeek(weekId) { delete this.data.weeks[weekId]; this._save(); }

  subscribeSettings(cb) { return this._sub(() => cb(clone(this.data.settings || {}))); }
  async saveSettings(s) { this.data.settings = { ...this.data.settings, ...clean(s) }; this._save(); }

  onAuth(cb) { this.authCbs.add(cb); cb(this.user); return () => this.authCbs.delete(cb); }
  _emitAuth() { for (const cb of this.authCbs) cb(this.user); }
  async login() {
    this.user = { email: 'mode local' };
    sessionStorage.setItem(LOCAL_KEY + ':admin', '1');
    this._emitAuth();
  }
  async logout() {
    this.user = null;
    sessionStorage.removeItem(LOCAL_KEY + ':admin');
    this._emitAuth();
  }
  async resetPassword() { throw new Error('Indisponible en mode local'); }

  // Quelques données d'exemple pour découvrir l'appli.
  _seed() {
    const d = emptyData();
    const c = (name, code, color) => { const id = newId(); d.courses[id] = { name, code, color }; return id; };
    const t = (name, email = '') => { const id = newId(); d.teachers[id] = { name, email }; return id; };
    const r = (name, building = '') => { const id = newId(); d.rooms[id] = { name, building }; return id; };
    const bim = c('Maquette numérique BIM', 'BIM', '#4f46e5');
    const revit = c('Revit / modélisation', 'REV', '#0ea5e9');
    const gp = c('Gestion de projet', 'GP', '#22c55e');
    const ang = c('Anglais technique', 'ANG', '#f97316');
    const vrd = c('Réseaux & VRD', 'VRD', '#a855f7');
    const t1 = t('M. Durand'); const t2 = t('Mme Lefèvre'); const t3 = t('Mme Martin');
    const r1 = r('Salle B204', 'Bâtiment B'); const r2 = r('Labo info 3', 'Bâtiment C'); const r3 = r('Amphi A', 'Bâtiment A');
    const now = new Date();
    const m = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    const p = (n) => String(n).padStart(2, '0');
    const wid = `${m.getFullYear()}-${p(m.getMonth() + 1)}-${p(m.getDate())}`;
    const s = (day, start, end, courseId, teacherId, roomId, type, note = '') =>
      ({ id: newId(), day, start, end, courseId, teacherId, roomId, type, note });
    d.weeks[wid] = {
      type: 'ecole', note: '',
      sessions: [
        s(0, '08:30', '10:30', bim, t1, r3, 'CM'),
        s(0, '10:45', '12:45', revit, t2, r2, 'TP'),
        s(0, '14:00', '16:00', gp, t3, r1, 'TD'),
        s(1, '09:00', '12:00', revit, t2, r2, 'TP'),
        s(1, '13:30', '15:30', ang, t3, r1, 'Cours'),
        s(2, '08:30', '10:30', vrd, t1, r3, 'CM'),
        s(2, '10:45', '12:15', bim, t1, r2, 'TD'),
        s(3, '09:00', '12:00', bim, t1, r2, 'Projet', 'Rendu intermédiaire'),
        s(3, '14:00', '16:00', gp, t3, r1, 'TD'),
        s(4, '08:30', '10:30', ang, t3, r1, 'Examen', 'Oral'),
      ],
    };
    this.data = d;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(d));
  }
}

export async function createStore({ forceLocal = false } = {}) {
  if (!forceLocal && isConfigured) return new FirebaseStore().init();
  return new LocalStore();
}

export { newId };
