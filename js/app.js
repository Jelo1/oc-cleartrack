
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PATHS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5S15.5 16.5 15.5 20"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c3 0 4.5 1.8 4.5 4.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  arrow: '<path d="M9 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>'
};

const STATUS = {
  cleared:     { label: 'Cleared',         cls: 'ok',   icon: 'check' },
  pending:     { label: 'Pending',         cls: 'wait', icon: 'clock' },
  requirement: { label: 'Has Requirement', cls: 'warn', icon: 'alert' }
};

const UI = {
  icon(name, size = 20) {
    return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
  },
  badge(status) {
    const s = STATUS[status] || STATUS.pending;
    return `<span class="badge ${s.cls}">${UI.icon(s.icon, 14)}${s.label}</span>`;
  },
  brand(href) {
    return `<a class="brand" href="${href}"><img class="brand-logo" src="img/logo.png" width="46" height="46" alt="Olivarez College ClearTrack logo"><span class="brand-text"><strong>ClearTrack</strong><small>OLIVAREZ COLLEGE</small></span></a>`;
  },

  /* ----- formatting ----- */
  fmtDate(iso) { return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; },
  fmtLong(iso) { return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''; },
  daysLeft(iso) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const d = Math.round((new Date(iso + 'T00:00:00') - t) / 86400000);
    if (d > 1) return `${d} days left`;
    if (d === 1) return '1 day left';
    if (d === 0) return 'Due today';
    return 'Deadline passed';
  },
  daysUntil(iso) { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(iso + 'T00:00:00') - t) / 86400000); },
  /* the earliest deadline among offices the student has not cleared yet */
  nextDeadline(rows) { return rows.filter(r => r.status !== 'cleared' && r.deadline).map(r => r.deadline).sort()[0] || ''; },
  dueLine(r) {
    if (r.status === 'cleared' || !r.deadline) return '';
    return `<small class="due${UI.daysUntil(r.deadline) < 0 ? ' late' : ''}">Due ${UI.fmtDate(r.deadline)}</small>`;
  },
  courseLine(u) { return u.section ? `${u.course} – ${u.section}` : `${u.course} • ${u.year}`; },
  firstName(u) { return (u.name || '').split(' ')[0] || 'there'; },
  joinNames(list) {
    if (list.length <= 1) return list[0] || '';
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  },
  summarize(rows) {
    const total = rows.length, cleared = rows.filter(r => r.status === 'cleared').length;
    return { total, cleared, out: rows.filter(r => r.status !== 'cleared'), pct: total ? Math.round(cleared / total * 100) : 0 };
  },
  checkEmail(email) {
    if (!email) return 'Please enter your Olivarez College email.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address.';
    if (!email.toLowerCase().endsWith(DOMAIN)) return `Use your school email (name${DOMAIN}).`;
    return '';
  },

  /* ----- messages ----- */
  toast(msg, type = 'ok') {
    let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast ' + type; t.setAttribute('role', 'status');
    t.innerHTML = UI.icon(type === 'ok' ? 'check' : type === 'err' ? 'alert' : 'info', 18) + `<span>${esc(msg)}</span>`;
    box.appendChild(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 4200);
  },
  flash(msg, type = 'ok') { try { sessionStorage.setItem('cleartrack.flash', JSON.stringify({ msg, type })); } catch (e) { /* */ } },
  showFlash() {
    try { const f = JSON.parse(sessionStorage.getItem('cleartrack.flash')); if (f) { sessionStorage.removeItem('cleartrack.flash'); UI.toast(f.msg, f.type); } } catch (e) { /* */ }
  },
  showError(el, msg) { el.textContent = msg; el.hidden = !msg; if (msg) el.focus?.(); },
  pinToggle() {
    $$('.pin-wrap').forEach(w => {
      const inp = $('input', w), btn = $('button', w);
      btn.addEventListener('click', () => { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; btn.textContent = show ? 'Hide' : 'Show'; });
      inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, inp.maxLength || 4); });
    });
  },

  /* ----- access control ----- */
  async require(role) {
    const u = await DB.currentUser();
    if (!u) { location.replace('index.html'); return null; }
    if (u.role !== role) { location.replace(u.role === 'staff' ? 'staff.html' : 'home.html'); return null; }
    return u;
  },

  /* ----- top bar + sidebar (same on every logged-in page) ----- */
  async mountShell(user, active) {
    const staff = user.role === 'staff';
    const office = staff ? OFFICES.find(o => o.id === user.office) : null;

    $('#topbar').innerHTML = `${UI.brand(staff ? 'staff.html' : 'home.html')}
      <div class="top-right">
        <span class="top-tag">Olivarez College • Clearance portal</span>
        <a class="user-chip" href="${staff ? 'staff.html' : 'profile.html'}">
          <span class="user-name">${esc(staff ? office.short + ' Staff' : user.name)}</span>
          <span class="avatar">${UI.icon('user', 18)}</span>
        </a>
      </div>`;

    let nav = '', foot = '';
    if (staff) {
      nav = `<a class="nav-link active" href="staff.html" aria-current="page">${UI.icon('building')}<span>Student clearance</span></a>`;
      foot = `<div class="side-box"><small>${esc(office.short)} staff</small><strong>Olivarez College</strong><small>Staff portal</small></div>
              <button class="btn btn-outline btn-block side-btn" id="signout" type="button">Sign Out</button>`;
    } else {
      const unread = await DB.unreadCount(user.email);
      const links = [
        ['home', 'home.html', 'Home', 'Home', 'home'],
        ['offices', 'offices.html', 'Offices / Location', 'Offices', 'building'],
        ['notifications', 'notifications.html', 'Notifications', 'Notifications', 'bell'],
        ['profile', 'profile.html', 'Profile', 'Profile', 'user']
      ];
      nav = links.map(([k, href, long, short, ic]) =>
        `<a class="nav-link${k === active ? ' active' : ''}" href="${href}"${k === active ? ' aria-current="page"' : ''}>${UI.icon(ic)}<span class="lbl-long">${long}</span><span class="lbl-short">${short}</span>${k === 'notifications' && unread ? `<span class="count">${unread}</span>` : ''}</a>`).join('');
      const rows = await DB.getClearances(user.email), sum = UI.summarize(rows), next = UI.nextDeadline(rows);
      foot = `<div class="side-box"><small>${next ? 'Next deadline' : 'Clearance'}</small><strong>${next ? UI.fmtLong(next) : 'All cleared'}</strong><small>${sum.cleared} of ${sum.total} offices cleared</small></div>`;
    }
    $('#sidebar').innerHTML = `<nav class="nav" aria-label="Main">${nav}</nav><div class="side-foot">${foot}</div>`;
    const so = $('#signout');
    if (so) so.addEventListener('click', async () => { await DB.logout(); location.href = 'index.html'; });
    UI.showFlash();
  }
};
