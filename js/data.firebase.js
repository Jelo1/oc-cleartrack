/* =====================================================================
   
   Firestore layout
     config/app                          { deadline: '2026-11-30' }
     users/{uid}                         { email, name, course, year, role, studentId?, section?, office? }
     users/{uid}/clearances/{officeId}   { status, requirement, updated, by }
     users/{uid}/notifications/{id}      { title, text, date, office, read, createdAt }

   About the 4-digit PIN:
   Firebase requires passwords of at least 6 characters, so the real password
   is the PIN plus a fixed suffix (PIN_SUFFIX). The student still only types
   4 digits. A 4-digit PIN is weak by nature; Firebase slows down repeated
   wrong attempts, which helps, but it is fine for a school prototype only.
   ===================================================================== */

const DOMAIN = '@olivarezcollege.edu.ph';

/* Offices shown in the app. Locations and hours are SAMPLE data. */
const OFFICES = [
  { id: 'library',    name: 'Library',                         short: 'Library',    location: 'DPRO Building, 3rd Floor',   hours: 'Mon–Fri, 8:00 AM–5:00 PM' },
  { id: 'accounting', name: 'Accounting',                      short: 'Accounting', location: 'ELO Building, 2nd Floor',    hours: 'Mon–Fri, 8:00 AM–5:00 PM' },
  { id: 'osa',        name: 'Office of Student Affairs (OSA)', short: 'OSA',        location: 'Nursing Building, Ground Floor', hours: 'Mon–Fri, 8:00 AM–5:00 PM' },
  { id: 'registrar',  name: 'Registrar Office',                short: 'Registrar',  location: 'ELO Building, 2nd Floor',  hours: 'Mon–Fri, 8:00 AM–5:00 PM' },
  { id: 'it',         name: 'IT Department',                   short: 'IT Department', location: 'DPRO Building, 3rd Floor', hours: 'Mon–Fri, 8:00 AM–5:00 PM' },
  { id: 'dean',       name: 'Dean assigned office',            short: 'Dean',       location: 'ELO Building, 3rd Floor',  hours: 'Mon–Fri, 8:00 AM–5:00 PM' }
];

const DB = (() => {
  const PIN_SUFFIX = '-oc';
  const DEFAULT_DEADLINE = '2026-11-30';
  const pw = pin => String(pin) + PIN_SUFFIX;
  const iso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const officeOf = id => OFFICES.find(o => o.id === id);
  const defaultRow = () => ({ status: 'pending', requirement: '', updated: iso(), by: '' });

  const configured = typeof FIREBASE_CONFIG !== 'undefined' && !/PASTE|YOUR_PROJECT/.test(JSON.stringify(FIREBASE_CONFIG));
  const NOT_SET = 'Firebase is not set up yet. Paste your config into js/firebase-config.js (see FIREBASE-SETUP.md).';
  let auth = null, fs = null, authReady = Promise.resolve(null);

  if (configured) {
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    fs = firebase.firestore();
    /*  Long polling uses plain requests and works everywhere. */
    fs.settings({ experimentalForceLongPolling: true });
    /* The first auth event tells us whether someone is already signed in. */
    authReady = new Promise(res => { const off = auth.onAuthStateChanged(u => { off(); res(u); }); });
  } else {
    console.error('[ClearTrack] ' + NOT_SET);
  }

  const fail = error => ({ ok: false, error });

  function authMsg(e) {
    switch (e && e.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
      case 'auth/invalid-email':        return 'Incorrect email or PIN. Please try again.';
      case 'auth/too-many-requests':    return 'Too many attempts. Please wait a few minutes, or reset your PIN.';
      case 'auth/network-request-failed': return 'No internet connection. Please check your network and try again.';
      case 'auth/email-already-in-use': return 'This email already has an account. Please sign in.';
      case 'auth/operation-not-allowed': return 'Email/Password sign-in is not enabled in Firebase yet.';
      case 'auth/expired-action-code':
      case 'auth/invalid-action-code':  return 'This reset link is invalid or has expired. Please request a new one.';
      case 'auth/requires-recent-login': return 'Please sign in again, then try once more.';
      case 'permission-denied':         return 'You do not have permission to do that.';
      default:                          return 'Something went wrong. Please try again.';
    }
  }

  /* ---------- small caches (per page load) ---------- */
  const uids = new Map();       // email -> uid
  let nCache = null;            // { email, p }
  let deadlineP = null;
  let deadlinesP = null;       // { officeId: 'YYYY-MM-DD' }

  async function profileOf(uid) {
    const d = await fs.collection('users').doc(uid).get();
    if (!d.exists) return null;
    const u = { uid, ...d.data() };
    if (u.email) uids.set(String(u.email).toLowerCase(), uid);
    return u;
  }

  async function uidOf(email) {
    email = String(email).toLowerCase();
    if (uids.has(email)) return uids.get(email);
    const me = auth.currentUser;
    if (me && String(me.email).toLowerCase() === email) { uids.set(email, me.uid); return me.uid; }
    const snap = await fs.collection('users').where('email', '==', email).limit(1).get();
    if (snap.empty) return null;
    uids.set(email, snap.docs[0].id);
    return snap.docs[0].id;
  }

  /* ---------- accounts ---------- */
  async function login(email, pin) {
    if (!configured) return fail(NOT_SET);
    try {
      const cred = await auth.signInWithEmailAndPassword(email.toLowerCase(), pw(pin));
      const u = await profileOf(cred.user.uid);
      if (!u) { await auth.signOut(); return fail('This account has no profile yet. Please contact the school administrator.'); }
      return { ok: true, user: u };
    } catch (e) { return fail(authMsg(e)); }
  }

  async function logout() {
    if (!configured) return;
    uids.clear(); nCache = null; deadlineP = null; deadlinesP = null;
    await auth.signOut();
  }

  async function currentUser() {
    if (!configured) return null;
    await authReady;
    const fu = auth.currentUser;
    if (!fu) return null;
    try { return await profileOf(fu.uid); } catch (e) { console.error(e); return null; }
  }

  async function register({ email, name, course, year, pin }) {
    if (!configured) return fail(NOT_SET);
    email = email.toLowerCase();
    let cred;
    try { cred = await auth.createUserWithEmailAndPassword(email, pw(pin)); }
    catch (e) { return fail(authMsg(e)); }
    const uid = cred.user.uid;
    try {
      const ref = fs.collection('users').doc(uid);
      await ref.set({ email, name, course, year, role: 'student' });
      await ref.collection('notifications').add({
        title: 'Clearance list assigned', text: 'Your clearance list for AY 2026–2027 is ready.',
        date: iso(), office: 'osa', read: false, createdAt: Date.now()
      });
    } catch (e) {
      console.error(e);
      try { await cred.user.delete(); } catch (e2) { /* ignore */ }   // do not leave a half-made account
      return fail('We could not finish creating your account. Please try again.');
    }
    await auth.signOut();   // user signs in on the next screen, like the original flow
    return { ok: true };
  }

  async function changePin(email, current, next) {
    if (!configured) return fail(NOT_SET);
    const fu = auth.currentUser;
    if (!fu) return fail('Please sign in again.');
    try {
      await fu.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(fu.email, pw(current)));
    } catch (e) {
      const wrong = ['auth/invalid-credential', 'auth/wrong-password'].includes(e.code);
      return fail(wrong ? 'Current PIN is incorrect.' : authMsg(e));
    }
    try { await fu.updatePassword(pw(next)); return { ok: true }; }
    catch (e) { return fail(authMsg(e)); }
  }

  /* ---------- forgot PIN (Firebase emails a reset LINK, not a 6-digit code) ---------- */
  async function sendResetLink(email) {
    if (!configured) return fail(NOT_SET);
    email = email.toLowerCase();
    const resetUrl = new URL('reset-pin.html', location.href).href;
    try {
      await auth.sendSignInLinkToEmail(email, { url: resetUrl, handleCodeInApp: true });
      localStorage.setItem('ct_reset_email', email);
      return { ok: true };
    } catch (e) {
      return fail(authMsg(e));
    }
  }

  async function verifyResetLink() {
    if (!configured) return fail(NOT_SET);
    if (!auth.isSignInWithEmailLink(location.href)) {
      return fail('This reset link is invalid or has expired. Please request a new one.');
    }
    let email = localStorage.getItem('ct_reset_email') || '';
    if (!email) {
      email = window.prompt('Please enter your college email to confirm your reset link:') || '';
    }
    email = email.trim().toLowerCase();
    if (!email) return fail('Email is required to verify your reset link.');
    try {
      const cred = await auth.signInWithEmailLink(email, location.href);
      localStorage.removeItem('ct_reset_email');
      /* Ensure a user profile actually exists so typos don't create blank accounts */
      const u = await profileOf(cred.user.uid);
      if (!u) {
        try { await cred.user.delete(); } catch (e2) { /* ignore */ }
        return fail('No ClearTrack account was found for that email.');
      }
      return { ok: true, email };
    } catch (e) {
      return fail(authMsg(e));
    }
  }

  async function resetWithLink(pin) {
    if (!configured) return fail(NOT_SET);
    const fu = auth.currentUser;
    if (!fu) return fail('Session expired. Please request a new reset link.');
    try {
      await fu.updatePassword(pw(pin));
      await auth.signOut();
      return { ok: true };
    } catch (e) {
      return fail(authMsg(e));
    }
  }

  /* ---------- clearance data ---------- */
  function getDeadline() {
    if (!deadlineP) {
      deadlineP = (async () => {
        if (!configured) return DEFAULT_DEADLINE;
        try { const d = await fs.collection('config').doc('app').get(); return (d.exists && d.data().deadline) || DEFAULT_DEADLINE; }
        catch (e) { return DEFAULT_DEADLINE; }
      })();
    }
    return deadlineP;
  }
  async function getOffice(id) { return officeOf(id) || null; }

  /* Each office can have its own deadline (offices/{officeId}).
     An office with no date of its own uses the school-wide date (config/app). */
  function getDeadlines() {
    if (!deadlinesP) {
      deadlinesP = (async () => {
        const all = await getDeadline();
        const map = Object.fromEntries(OFFICES.map(o => [o.id, all]));
        if (!configured) return map;
        try {
          (await fs.collection('offices').get()).forEach(d => { const v = d.data().deadline; if (v && d.id in map) map[d.id] = v; });
        } catch (e) { console.warn('Office deadlines unavailable:', e.code || e.message); }
        return map;
      })();
    }
    return deadlinesP;
  }

  async function getClearances(email) {
    const uid = await uidOf(email);
    const rows = {};
    if (uid) (await fs.collection('users').doc(uid).collection('clearances').get()).forEach(d => { rows[d.id] = d.data(); });
    const dl = await getDeadlines();
    return OFFICES.map(o => ({ office: o, deadline: dl[o.id], ...(rows[o.id] || defaultRow()) }));
  }

  function loadNotifications(email) {
    if (!nCache || nCache.email !== email) {
      nCache = {
        email,
        p: (async () => {
          const uid = await uidOf(email); if (!uid) return [];
          const snap = await fs.collection('users').doc(uid).collection('notifications').get();
          return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        })()
      };
    }
    return nCache.p;
  }
  async function getNotifications(email) { return (await loadNotifications(email)).slice(); }
  async function unreadCount(email) { return (await loadNotifications(email)).filter(n => !n.read).length; }
  async function markRead(email, id) {
    const uid = await uidOf(email); if (!uid) return;
    await fs.collection('users').doc(uid).collection('notifications').doc(id).update({ read: true });
    nCache = null;
  }

  /* ---------- deadline reminder (runs when a student opens Home) ----------
     the reminder is created the moment the student opens the app within 1 day of an office deadline and
     still has that office to clear.  */
  async function ensureDeadlineReminder(user, rows) {
    try {
      if (!configured || !user || user.role !== 'student') return;
      const t = new Date(); t.setHours(0, 0, 0, 0);
      const daysTo = d => Math.round((new Date(d + 'T00:00:00') - t) / 86400000);
      const byDate = {};
      rows.filter(r => r.status !== 'cleared' && r.deadline).forEach(r => {
        const n = daysTo(r.deadline);
        if (n === 0 || n === 1) (byDate[r.deadline] = byDate[r.deadline] || []).push(r);
      });
      for (const [date, list] of Object.entries(byDate)) {
        const ref = fs.collection('users').doc(user.uid).collection('notifications').doc('deadline-' + date);
        if ((await ref.get()).exists) continue;
        const when = daysTo(date) === 0 ? 'today' : 'tomorrow';
        await ref.set({
          title: `Clearance deadline ${when}`,
          text: `${list.map(r => r.office.short).join(', ')}: the deadline is ${when}. You still have requirements to complete.`,
          date: iso(), office: list[0].office.id, read: false, createdAt: Date.now()
        });
        nCache = null;
      }
    } catch (e) { console.warn('Reminder skipped:', e.code || e.message); }
  }

  /* ---------- staff ---------- */
  /* staff search by the exact school email or the exact student ID number. */
  async function searchStudent(q) {
    q = String(q || '').trim(); if (!q) return null;
    const col = fs.collection('users');
    const tries = q.includes('@')
      ? [col.where('email', '==', q.toLowerCase()).limit(1)]
      : [col.where('studentId', '==', q.toUpperCase()).limit(1), col.where('email', '==', q.toLowerCase() + DOMAIN).limit(1)];
    for (const query of tries) {
      const snap = await query.get();
      const d = snap.docs.find(x => x.data().role === 'student');
      if (d) { uids.set(String(d.data().email).toLowerCase(), d.id); return { uid: d.id, ...d.data() }; }
    }
    return null;
  }

  const clearanceMessage = (off, status, requirement, note) => ({
    cleared:     { title: `${off.short} marked you as Cleared`, text: note || `No requirements remaining for ${off.name}.` },
    requirement: { title: `${off.short} updated your status`,   text: note || `New requirement: ${requirement}.` },
    pending:     { title: `${off.short} is reviewing`,          text: note || 'Your clearance is currently being reviewed.' }
  }[status]);

  /* Staff set the deadline for THEIR office only. */
  async function setOfficeDeadline(officeId, date, staff) {
    if (!staff || staff.role !== 'staff' || staff.office !== officeId) return fail('You can set the deadline only for your own office.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00'))) return fail('Please choose a valid date.');
    try {
      await fs.collection('offices').doc(officeId).set({ deadline: date, updated: iso(), by: staff.name || '' });
      deadlinesP = null;
      return { ok: true };
    } catch (e) { console.error(e); return fail(authMsg(e)); }
  }

  /* Students of a group: everyone, or one course and/or year level. */
  async function listStudents({ course = '', year = '' } = {}) {
    let q = fs.collection('users').where('role', '==', 'student');
    if (course) q = q.where('course', '==', course);
    if (year) q = q.where('year', '==', year);
    const snap = await q.get();
    return snap.docs.map(d => { const u = { uid: d.id, ...d.data() }; uids.set(String(u.email).toLowerCase(), d.id); return u; });
  }

  /* A student edits their own profile. The school email, role and office cannot be changed here. */
  const COURSES = ['BSIT', 'BSCS', 'BSBA', 'BSED', 'BSHM', 'BSA', 'BSCrim'], YEARS = ['1st year', '2nd year', '3rd year', '4th year'];
  async function updateProfile({ name, studentId, course, year, section }) {
    if (!configured) return fail(NOT_SET);
    const fu = auth.currentUser; if (!fu) return fail('Please sign in again.');
    name = String(name || '').trim().replace(/\s+/g, ' ');
    studentId = String(studentId || '').trim().toUpperCase();
    section = String(section || '').trim().toUpperCase();
    if (name.length < 2 || name.length > 80) return fail('Please enter your full name (2 to 80 characters).');
    if (studentId && !/^[A-Z0-9][A-Z0-9-]{2,19}$/.test(studentId)) return fail('Student ID may use letters, numbers and dashes only (3 to 20 characters).');
    if (!COURSES.includes(course)) return fail('Please choose your course.');
    if (!YEARS.includes(year)) return fail('Please choose your year level.');
    if (section.length > 10) return fail('Section is too long (10 characters at most).');
    try {
      await fs.collection('users').doc(fu.uid).update({ name, studentId, course, year, section });
      return { ok: true, user: await profileOf(fu.uid) };
    } catch (e) { console.error(e); return fail(authMsg(e)); }
  }

  /* Everyone's status for ONE office (used by the staff table).
     Reads every student, then that office's clearance document for each one.
     Students the office has never touched count as Pending. */
  async function listOfficeStudents(officeId) {
    const students = await listStudents();
    const rows = [];
    for (let i = 0; i < students.length; i += 40) {
      const part = students.slice(i, i + 40);
      const docs = await Promise.all(part.map(u => fs.collection('users').doc(u.uid).collection('clearances').doc(officeId).get()));
      part.forEach((u, j) => {
        const c = docs[j].exists ? docs[j].data() : {};
        rows.push({ uid: u.uid, email: u.email, name: u.name || '', studentId: u.studentId || '', course: u.course || '', year: u.year || '',
                    status: c.status || 'pending', requirement: c.requirement || '', updated: c.updated || '' });
      });
    }
    return rows;
  }

  /* Apply one status to a whole list of students. Writes go in batches
     (2 writes per student). If Firebase refuses a big batch, the batch size is
     halved automatically and the same students are retried. */
  async function updateGroup(students, officeId, { status, requirement, note }, staff, { skipCleared = true, onProgress } = {}) {
    if (!staff || staff.role !== 'staff' || staff.office !== officeId) return fail('You can update only your own office.');
    try {
      const off = officeOf(officeId), msg = clearanceMessage(off, status, requirement, note);
      let list = students, skipped = 0;
      if (skipCleared) {
        list = [];
        for (let i = 0; i < students.length; i += 40) {
          const part = students.slice(i, i + 40);
          const docs = await Promise.all(part.map(u => fs.collection('users').doc(u.uid).collection('clearances').doc(officeId).get()));
          part.forEach((u, j) => { (docs[j].exists && docs[j].data().status === 'cleared') ? skipped++ : list.push(u); });
        }
      }
      let size = 200, done = 0;
      while (done < list.length) {
        const part = list.slice(done, done + size), batch = fs.batch();
        part.forEach(u => {
          const base = fs.collection('users').doc(u.uid);
          batch.set(base.collection('clearances').doc(officeId), { status, requirement, updated: iso(), by: staff.name || '' });
          batch.set(base.collection('notifications').doc(), { ...msg, date: iso(), office: officeId, read: false, createdAt: Date.now() });
        });
        try { await batch.commit(); }
        catch (e) {
          if (size > 10 && ['permission-denied', 'resource-exhausted', 'invalid-argument', 'failed-precondition'].includes(e.code)) { size = Math.max(10, size >> 1); continue; }
          throw e;
        }
        done += part.length;
        if (onProgress) onProgress(done, list.length);
      }
      return { ok: true, updated: done, skipped };
    } catch (e) { console.error(e); return fail(authMsg(e)); }
  }

  async function updateClearance(studentEmail, officeId, { status, requirement, note }, staff) {
    if (!staff || staff.role !== 'staff' || staff.office !== officeId)
      return fail('You can update only your own office.');
    try {
      const uid = await uidOf(studentEmail);
      if (!uid) return fail('Student not found.');
      const off = officeOf(officeId), base = fs.collection('users').doc(uid);
      const msg = clearanceMessage(off, status, requirement, note);
      const batch = fs.batch();
      batch.set(base.collection('clearances').doc(officeId), { status, requirement, updated: iso(), by: staff.name || '' });
      batch.set(base.collection('notifications').doc(), { ...msg, date: iso(), office: officeId, read: false, createdAt: Date.now() });
      await batch.commit();
      return { ok: true };
    } catch (e) { console.error(e); return fail(authMsg(e)); }
  }

  return { login, logout, currentUser, register, changePin, sendResetLink, verifyResetLink, resetWithLink,
           getDeadline, getDeadlines, getOffice, getClearances, getNotifications, unreadCount, markRead,
           searchStudent, updateClearance, setOfficeDeadline, listStudents, listOfficeStudents, updateProfile, updateGroup, ensureDeadlineReminder };
})();
