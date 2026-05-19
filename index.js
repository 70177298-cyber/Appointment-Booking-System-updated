/* ═══════════════════════════════════════════════
   SHARED STATE — simulated via window.storage
   This is the "database" both tabs read/write
═══════════════════════════════════════════════ */

const STORAGE_KEY = 'abs-bookings-v3';
const FEED_KEY    = 'abs-feed-v3';

async function dbRead() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function dbWrite(bookings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
  } catch(e) { console.error('storage write fail', e); }
}

async function feedRead() {
  try {
    const raw = localStorage.getItem(FEED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function feedAppend(entry) {
  try {
    const feed = await feedRead();
    feed.unshift({ ...entry, ts: Date.now(), id: Math.random().toString(36).slice(2,8) });
    if (feed.length > 50) feed.length = 50;
    localStorage.setItem(FEED_KEY, JSON.stringify(feed));
  } catch(e) {}
}

/* ═══════════════════════════════════════════════
   DATA
═══════════════════════════════════════════════ */

const USERS = [
  { email:'demo@abs.com',   pass:'1234',  name:'Demo User',        role:'customer' },
  { email:'ayesha@abs.com', pass:'1234',  name:'Dr. Ayesha Khan',  role:'provider', domain:'health',    providerName:'Dr. Ayesha Khan – General Physician', fee:'PKR 1,500' },
  { email:'ahmed@abs.com',  pass:'1234',  name:'Prof. Ahmed Hassan',role:'provider', domain:'education', providerName:'Prof. Ahmed Hassan – Mathematics',    fee:'PKR 800'   },
  { email:'luxe@abs.com',   pass:'1234',  name:'Luxe Beauty Lounge',role:'provider', domain:'beauty',    providerName:'Luxe Beauty Lounge',                  fee:'PKR 3,000' },
  { email:'admin@abs.com',  pass:'admin', name:'Admin',             role:'admin' }
];

const PROVIDERS = {
  health:[
    {name:'Dr. Ayesha Khan – General Physician', fee:'PKR 1,500'},
    {name:'Dr. Usman Malik – Cardiologist',       fee:'PKR 2,500'},
    {name:'Dr. Fatima Shah – Pediatrician',       fee:'PKR 1,200'}
  ],
  education:[
    {name:'Prof. Ahmed Hassan – Mathematics',     fee:'PKR 800'},
    {name:'Ms. Sara Noor – English Literature',   fee:'PKR 700'},
    {name:'Sir Ali Rehman – Physics',             fee:'PKR 900'}
  ],
  beauty:[
    {name:'Luxe Beauty Lounge',                   fee:'PKR 3,000'},
    {name:'Glamour Studio',                        fee:'PKR 2,000'},
    {name:'Elysium Spa & Salon',                  fee:'PKR 2,500'}
  ]
};

const STATIC_PROVIDERS = [
  {name:'Dr. Ayesha Khan',  domain:'Health',   rating:'4.9'},
  {name:'Dr. Usman Malik',  domain:'Health',   rating:'4.7'},
  {name:'Prof. Ahmed Hassan',domain:'Education',rating:'4.6'},
  {name:'Ms. Sara Noor',    domain:'Education',rating:'4.5'},
  {name:'Luxe Beauty Lounge',domain:'Beauty',  rating:'4.8'},
  {name:'Glamour Studio',   domain:'Beauty',   rating:'4.6'},
];

const ALL_SLOTS = ['09:00 AM','10:00 AM','11:30 AM','01:00 PM','02:00 PM','03:30 PM','04:30 PM','05:00 PM'];

function getSlotsForDate(d) {
  let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0;
  const arr = [...ALL_SLOTS];
  for (let i = arr.length - 1; i > 0; i--) { h = (h * 1664525 + 1013904223) >>> 0; const j = h % (i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr.slice(0, 4 + (h % 3)).sort((a, b) => ALL_SLOTS.indexOf(a) - ALL_SLOTS.indexOf(b));
}

async function isSlotTaken(provider, date, time) {
  const bookings = await dbRead();
  return bookings.some(b => b.provider === provider && b.date === date && b.time === time && b.status !== 'cancelled');
}

/* ═══════════════════════════════════════════════
   STATE & HELPERS
═══════════════════════════════════════════════ */

let currentUser = null, currentDomain = null, selectedSlot = null, pendingBooking = null;
let pollInterval = null;
let lastKnownCount = 0;
let sessionBookings = 0;

const $ = id => document.getElementById(id);
const show = id => $(id).style.display = '';
const hide = id => $(id).style.display = 'none';
const delay = ms => new Promise(r => setTimeout(r, ms));

function toast(msg, type = '') {
  const wrap = $('toast-wrap');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  wrap.appendChild(t);
  requestAnimationFrame(() => { requestAnimationFrame(() => t.classList.add('show')); });
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4000);
}

function fmtDate(dateStr) {
  return new Date(dateStr + 'T00:00').toLocaleDateString('en-PK', { weekday:'short', month:'short', day:'numeric' });
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  return Math.floor(s/3600) + 'h ago';
}

/* ═══════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════ */

function doLogin() {
  const email = $('login-email').value.trim();
  const pass  = $('login-pass').value;
  const err   = $('login-err');
  err.style.display = 'none';
  const user = USERS.find(u => u.email === email && u.pass === pass);
  if (!user) { err.textContent = 'Invalid credentials. Check hints below.'; err.style.display = 'block'; return; }
  currentUser = user;
  $('nav-name').textContent = user.name;
  const badge = $('nav-role');
  badge.textContent = user.role === 'provider' ? 'Provider' : user.role.charAt(0).toUpperCase() + user.role.slice(1);
  badge.className = 'role-badge ' + user.role;
  $('screen-login').style.display = 'none';
  $('screen-app').style.display = 'block';
  if (user.role === 'customer') initCustomer();
  else if (user.role === 'provider') initProvider();
  else initAdmin();
}

function doLogout() {
  currentUser = null; currentDomain = null; selectedSlot = null; pendingBooking = null;
  sessionBookings = 0; lastKnownCount = 0;
  clearInterval(pollInterval); pollInterval = null;
  $('login-email').value = ''; $('login-pass').value = '';
  $('screen-login').style.display = 'flex';
  $('screen-app').style.display = 'none';
  $('modal-pay').classList.remove('open');
  $('modal-confirm').classList.remove('open');
  hide('view-customer'); hide('view-provider'); hide('view-admin');
}

/* ═══════════════════════════════════════════════
   CUSTOMER
═══════════════════════════════════════════════ */

async function initCustomer() {
  show('view-customer'); hide('view-provider'); hide('view-admin');
  show('cust-home'); hide('cust-booking');
  await renderMyBookings();
  // Poll so slot availability stays fresh
  pollInterval = setInterval(async () => {
    if ($('slots-section').style.display !== 'none') {
      const p = $('cust-provider').value, d = $('cust-date').value;
      if (p && d) await refreshSlots(p, d);
    }
  }, 4000);
}

async function renderMyBookings() {
  const all = await dbRead();
  const mine = all.filter(b => b.patientEmail === currentUser.email);
  const el = $('my-bookings-list');
  const countEl = $('cust-bk-count');
  countEl.textContent = mine.length ? mine.length : '';
  if (!mine.length) { el.innerHTML = '<div class="empty-state"><div class="emo">📋</div>No bookings yet</div>'; return; }
  const icon = { health:'🏥', education:'📖', beauty:'💆‍♀️' };
  el.innerHTML = [...mine].reverse().map(b => `
    <div class="bk-item">
      <div class="bk-left">
        <div class="bk-ico ${b.domain}">${icon[b.domain]||'📅'}</div>
        <div class="bk-info">
          <h4>${b.provider}</h4>
          <p>${fmtDate(b.date)} • ${b.time}</p>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:.6rem">
        <span style="font-size:13px;font-weight:500;color:var(--success)">${b.fee}</span>
        <span class="status-pill ${b.status}">${b.status.charAt(0).toUpperCase()+b.status.slice(1)}</span>
      </div>
    </div>`).join('');
}

function custSelectDomain(domain) {
  currentDomain = domain;
  const lbl = { health:'🏥 Healthcare', education:'📖 Education', beauty:'💆‍♀️ Beauty' };
  $('booking-heading').textContent = 'Book — ' + lbl[domain];
  const sel = $('cust-provider');
  sel.innerHTML = '<option value="">Select provider</option>';
  PROVIDERS[domain].forEach(p => { const o = document.createElement('option'); o.value = o.textContent = p.name; sel.appendChild(o); });
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  $('cust-date').min = today; $('cust-date').value = '';
  selectedSlot = null; hide('slots-section'); hide('avail-box');
  $('proceed-btn').disabled = true;
  hide('cust-home'); show('cust-booking');
}

function custGoBack() { show('cust-home'); hide('cust-booking'); selectedSlot = null; renderMyBookings(); }

async function custFieldChange() {
  selectedSlot = null; hide('avail-box'); $('proceed-btn').disabled = true;
  const p = $('cust-provider').value, d = $('cust-date').value;
  if (!p || !d) { hide('slots-section'); return; }
  show('slots-section');
  await buildSlotGrid(p, d);
}

async function buildSlotGrid(provider, date) {
  const grid = $('slots-grid');
  grid.innerHTML = '<span class="spin"></span>';
  const slots = getSlotsForDate(date);
  const taken = [];
  for (const t of slots) { if (await isSlotTaken(provider, date, t)) taken.push(t); }
  grid.innerHTML = '';
  slots.forEach(time => {
    const booked = taken.includes(time);
    const btn = document.createElement('button');
    btn.className = 'slot-btn' + (booked ? ' taken' : '') + (time === selectedSlot ? ' sel' : '');
    btn.disabled = booked;
    btn.dataset.time = time;
    btn.textContent = time + (booked ? ' — taken' : '');
    if (!booked) btn.onclick = () => pickSlot(btn, time);
    grid.appendChild(btn);
  });
}

async function refreshSlots(provider, date) {
  $('slots-loading').style.display = '';
  const slots = getSlotsForDate(date);
  for (const time of slots) {
    const taken = await isSlotTaken(provider, date, time);
    const btn = $('slots-grid') && [...$('slots-grid').querySelectorAll('.slot-btn')].find(b => b.dataset.time === time);
    if (!btn) continue;
    if (taken && !btn.classList.contains('taken')) {
      btn.classList.add('taken'); btn.disabled = true;
      btn.textContent = time + ' — taken';
      if (btn.classList.contains('sel')) {
        btn.classList.remove('sel'); selectedSlot = null; $('proceed-btn').disabled = true;
        toast('Your selected slot was just taken by someone else!', 'cancel');
      }
    }
  }
  $('slots-loading').style.display = 'none';
}

function pickSlot(btn, time) {
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel'); selectedSlot = time; hide('avail-box'); $('proceed-btn').disabled = false;
}

async function checkAndProceed() {
  const provider = $('cust-provider').value, date = $('cust-date').value;
  if (!provider || !date || !selectedSlot) { alert('Please select provider, date, and a slot.'); return; }
  const box = $('avail-box'); box.style.display = 'block';
  box.className = 'avail-box checking'; box.innerHTML = '<span class="spin"></span> Verifying availability in real time…';
  $('proceed-btn').disabled = true;
  await delay(900 + Math.random() * 400);
  const taken = await isSlotTaken(provider, date, selectedSlot);
  if (!taken) {
    box.className = 'avail-box ok'; box.textContent = '✓ Slot available! Proceeding to payment…';
    await delay(650);
    const provObj = PROVIDERS[currentDomain].find(p => p.name === provider);
    pendingBooking = { provider, date, time: selectedSlot, fee: provObj ? provObj.fee : 'N/A', domain: currentDomain };
    openPayModal();
  } else {
    box.className = 'avail-box fail'; box.textContent = '✕ Slot just taken — please choose another time.';
    const btn = [...$('slots-grid').querySelectorAll('.slot-btn')].find(b => b.dataset.time === selectedSlot);
    if (btn) { btn.classList.remove('sel'); btn.classList.add('taken'); btn.disabled = true; btn.textContent = selectedSlot + ' — taken'; }
    selectedSlot = null; $('proceed-btn').disabled = true;
  }
}

function openPayModal() {
  const { provider, date, time, fee } = pendingBooking;
  $('pay-summary').innerHTML = `
    <div class="summ-row"><span class="sk">Provider</span><span>${provider}</span></div>
    <div class="summ-row"><span class="sk">Date</span><span>${fmtDate(date)}</span></div>
    <div class="summ-row"><span class="sk">Time</span><span>${time}</span></div>
    <div class="summ-row price"><span class="sk">Consultation Fee</span><span style="color:var(--success)">${fee}</span></div>`;
  ['card-num','card-name','card-exp','card-cvv'].forEach(id => $(id).value = '');
  $('pay-err').style.display = 'none'; $('pay-btn').disabled = false;
  $('pay-btn').textContent = 'Pay & Confirm Appointment';
  $('modal-pay').classList.add('open');
}

function closePayModal() { $('modal-pay').classList.remove('open'); $('proceed-btn').disabled = false; }
function fmtCard(el) { let v = el.value.replace(/\D/g,'').substring(0,16); el.value = v.replace(/(.{4})/g,'$1 ').trim(); }
function fmtExp(el) { let v = el.value.replace(/\D/g,'').substring(0,4); if (v.length >= 3) v = v.substring(0,2) + ' / ' + v.substring(2); el.value = v; }

async function processPayment() {
  const num = $('card-num').value.replace(/\s/g,''), name = $('card-name').value.trim();
  const exp = $('card-exp').value.replace(/[\s/]/g,''), cvv = $('card-cvv').value.trim();
  const err = $('pay-err'); err.style.display = 'none';
  if (num.length < 16) { showPayErr('Enter a valid 16-digit card number.'); return; }
  if (!name)           { showPayErr('Enter the cardholder name.');          return; }
  if (exp.length < 4)  { showPayErr('Enter a valid expiry (MM/YY).');       return; }
  if (cvv.length < 3)  { showPayErr('Enter a valid 3-digit CVV.');          return; }
  const btn = $('pay-btn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Processing…';
  await delay(1800 + Math.random() * 700);

  // Double-check slot wasn't taken during payment
  const stillFree = !(await isSlotTaken(pendingBooking.provider, pendingBooking.date, pendingBooking.time));
  if (!stillFree) {
    showPayErr('Sorry — this slot was just taken while you were paying. Please go back and choose another.');
    btn.disabled = false; btn.textContent = 'Pay & Confirm Appointment'; return;
  }

  const ref = 'ABS-' + Math.random().toString(36).substring(2,8).toUpperCase();
  const booking = {
    id: ref, provider: pendingBooking.provider, date: pendingBooking.date,
    time: pendingBooking.time, fee: pendingBooking.fee, domain: pendingBooking.domain,
    patientName: currentUser.name, patientEmail: currentUser.email,
    status: 'pending', bookedAt: Date.now(), ref
  };

  // Write to shared storage
  const all = await dbRead();
  all.push(booking);
  await dbWrite(all);
  await feedAppend({ type:'booking', msg:`${currentUser.name} booked ${pendingBooking.provider} on ${fmtDate(pendingBooking.date)} at ${pendingBooking.time}`, domain: pendingBooking.domain });

  sessionBookings++;
  $('modal-pay').classList.remove('open');
  showConfirmation(booking);
}

function showPayErr(msg) { const e = $('pay-err'); e.textContent = msg; e.style.display = 'block'; const btn = $('pay-btn'); btn.disabled = false; btn.textContent = 'Pay & Confirm Appointment'; }

function showConfirmation(b) {
  $('confirm-ref').textContent = 'Ref: ' + b.ref;
  $('confirm-details').innerHTML = `
    <div class="summ-row"><span class="sk">Provider</span><span>${b.provider}</span></div>
    <div class="summ-row"><span class="sk">Date</span><span>${fmtDate(b.date)}</span></div>
    <div class="summ-row"><span class="sk">Time</span><span>${b.time}</span></div>
    <div class="summ-row"><span class="sk">Patient</span><span>${b.patientName}</span></div>
    <div class="summ-row price"><span class="sk">Amount Paid</span><span style="color:var(--success)">${b.fee}</span></div>`;
  $('modal-confirm').classList.add('open');
}

async function afterConfirm() {
  $('modal-confirm').classList.remove('open');
  pendingBooking = selectedSlot = null;
  show('cust-home'); hide('cust-booking');
  await renderMyBookings();
}

/* ═══════════════════════════════════════════════
   PROVIDER
═══════════════════════════════════════════════ */

async function initProvider() {
  hide('view-customer'); show('view-provider'); hide('view-admin');
  $('prov-heading').textContent = currentUser.name + ' — Dashboard';
  $('prov-sub').textContent = 'Real-time appointment management · ' + currentUser.domain;
  renderAvailToggles();
  await renderProviderAppts();
  lastKnownCount = (await dbRead()).filter(filterForProvider).length;
  // Poll for new bookings
  pollInterval = setInterval(async () => {
    const all = await dbRead();
    const mine = all.filter(filterForProvider);
    if (mine.length > lastKnownCount) {
      const sorted = [...mine].sort((a,b) => a.bookedAt - b.bookedAt);
      const newOnes = sorted.slice(lastKnownCount);
      newOnes.forEach(b => toast(`🔔 New booking! ${b.patientName} — ${fmtDate(b.date)} at ${b.time}`, 'new-booking'));
      lastKnownCount = mine.length;
      await renderProviderAppts(true);
    }
    await renderProviderFeed();
  }, 3000);
}

function filterForProvider(b) {
  return b.provider === currentUser.providerName || b.domain === currentUser.domain;
}

function feeToNum(fee) { return parseInt((fee || '0').replace(/[^\d]/g, '')) || 0; }

async function renderProviderAppts(flash = false) {
  const all = await dbRead();
  const mine = all.filter(filterForProvider);
  const today = new Date().toISOString().slice(0,10);
  const todayAppts = mine.filter(b => b.date === today);
  const todayEarn = todayAppts.reduce((s,b) => s + feeToNum(b.fee), 0);
  const confirmed = mine.filter(b => b.status === 'confirmed').length;
  const pending   = mine.filter(b => b.status === 'pending').length;
  const totalRev  = mine.filter(b => b.status === 'confirmed').reduce((s,b) => s + feeToNum(b.fee), 0);
  $('prov-today-count').textContent = todayAppts.length;
  $('prov-today-earn').textContent  = todayEarn >= 1000 ? (todayEarn/1000).toFixed(1)+'k' : todayEarn;
  $('prov-total').textContent       = mine.length;
  $('prov-confirmed').textContent   = confirmed;
  $('prov-pending').textContent     = pending;
  $('prov-revenue').textContent     = 'PKR ' + totalRev.toLocaleString();
  if (!mine.length) {
    $('prov-appt-rows').innerHTML = '<div class="empty-state"><div class="emo">📭</div>No appointments yet. Waiting for bookings…</div>';
    return;
  }
  const sorted = [...mine].sort((a,b) => b.bookedAt - a.bookedAt);
  $('prov-appt-rows').innerHTML = sorted.map((b, i) => {
    const isNew = flash && i < (mine.length - lastKnownCount + (mine.length - lastKnownCount));
    const statusHtml = b.status === 'pending'
      ? `<button class="act-btn accept" onclick="provAction('${b.id}','confirmed')">Accept</button><button class="act-btn reject" onclick="provAction('${b.id}','cancelled')">Reject</button>`
      : `<span class="status-pill ${b.status}">${b.status.charAt(0).toUpperCase()+b.status.slice(1)}</span>`;
    const newTag = (Date.now() - b.bookedAt < 30000) ? '<span class="new-tag">NEW</span>' : '';
    return `<div class="appt-row ${(Date.now()-b.bookedAt<5000&&flash)?'new-flash':''}" id="apptrow-${b.id}">
      <div><strong>${b.patientName}</strong>${newTag}<br><span style="font-size:11px;color:var(--muted)">${b.patientEmail}</span></div>
      <div>${fmtDate(b.date)}<br><span style="color:var(--muted);font-size:12px">${b.time}</span></div>
      <div style="text-transform:capitalize">${b.domain}</div>
      <div style="color:var(--success);font-weight:500">${b.fee}</div>
      <div>${statusHtml}</div>
    </div>`;
  }).join('');
}

async function provAction(id, newStatus) {
  const all = await dbRead();
  const idx = all.findIndex(b => b.id === id);
  if (idx === -1) return;
  all[idx].status = newStatus;
  await dbWrite(all);
  await feedAppend({ type: newStatus === 'confirmed' ? 'booking' : 'cancel', msg:`${all[idx].patientName}'s appointment ${newStatus === 'confirmed' ? 'accepted' : 'rejected'} by provider`, domain: all[idx].domain });
  const row = $('apptrow-' + id);
  if (row) {
    row.querySelector('div:last-child').innerHTML = `<span class="status-pill ${newStatus}">${newStatus.charAt(0).toUpperCase()+newStatus.slice(1)}</span>`;
  }
  await renderProviderAppts();
  toast(newStatus === 'confirmed' ? '✓ Appointment confirmed' : '✕ Appointment rejected');
}

async function renderProviderFeed() {
  const feed = await feedRead();
  const mine = feed.filter(f => f.domain === currentUser.domain);
  if (!mine.length) return;
  $('feed-rows').innerHTML = mine.slice(0,15).map(f => `
    <div class="feed-item">
      <div class="feed-dot ${f.type}"></div>
      <div>
        <div>${f.msg}</div>
        <div class="feed-time">${timeAgo(f.ts)}</div>
      </div>
    </div>`).join('');
}

function renderAvailToggles() {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  $('avail-toggles').innerHTML = days.map((d,i) => `
    <div class="toggle-wrap">
      <span>${d}</span>
      <label class="tog">
        <input type="checkbox" ${i < 5 ? 'checked' : ''}>
        <div class="tog-track"></div>
        <div class="tog-thumb"></div>
      </label>
    </div>`).join('');
}

function provTab(btn, target) {
  document.querySelectorAll('.prov-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  hide('prov-appts'); hide('prov-feed'); show(target);
  if (target === 'prov-feed') renderProviderFeed();
}

/* ═══════════════════════════════════════════════
   ADMIN
═══════════════════════════════════════════════ */

async function initAdmin() {
  hide('view-customer'); hide('view-provider'); show('view-admin');
  await renderAdminAll();
  lastKnownCount = (await dbRead()).length;
  pollInterval = setInterval(async () => {
    const all = await dbRead();
    if (all.length > lastKnownCount) {
      const diff = all.length - lastKnownCount;
      toast(`🔔 ${diff} new booking${diff>1?'s':''} across the platform!`, 'new-booking');
      lastKnownCount = all.length;
    }
    await renderAdminAll(true);
  }, 3000);
}

async function renderAdminAll(flash = false) {
  const all = await dbRead();
  const confirmed = all.filter(b => b.status === 'confirmed');
  const pending   = all.filter(b => b.status === 'pending');
  const totalRev  = confirmed.reduce((s,b) => s + feeToNum(b.fee), 0);
  $('adm-total').textContent   = all.length;
  $('adm-session').textContent = sessionBookings;
  $('adm-revenue').textContent = (totalRev/1000).toFixed(1) + 'k';
  $('adm-pending').textContent = pending.length;

  const sorted = [...all].sort((a,b) => b.bookedAt - a.bookedAt);
  $('adm-bk-rows').innerHTML = sorted.length ? sorted.map((b,i) => `
    <div class="dt-row ${i===0&&flash?'new-flash':''}">
      <div><strong>${b.patientName}</strong><br><span style="font-size:11px;color:var(--muted)">${b.patientEmail}</span></div>
      <div>${b.provider}</div>
      <div style="text-transform:capitalize">${b.domain}</div>
      <div>${fmtDate(b.date)} • ${b.time}</div>
      <div style="color:var(--success)">${b.fee}</div>
      <div><span class="status-pill ${b.status}">${b.status.charAt(0).toUpperCase()+b.status.slice(1)}</span></div>
    </div>`).join('') : '<div class="empty-state">No bookings yet</div>';

  // Provider stats
  $('adm-prov-rows').innerHTML = STATIC_PROVIDERS.map(p => {
    const pBookings = all.filter(b => b.provider.includes(p.name.split(' ')[0]) && b.provider.includes(p.name.split(' ').slice(-1)[0]));
    const pRev = pBookings.filter(b => b.status === 'confirmed').reduce((s,b) => s + feeToNum(b.fee), 0);
    return `<div class="dt-row">
      <div><strong>${p.name}</strong></div>
      <div>${p.domain}</div>
      <div>${pBookings.length}</div>
      <div style="color:var(--success)">PKR ${pRev.toLocaleString()}</div>
      <div>⭐ ${p.rating}</div>
      <div><button class="ap sus">Manage</button></div>
    </div>`;
  }).join('');

  // Feed
  const feed = await feedRead();
  $('adm-feed').innerHTML = feed.length ? feed.slice(0,10).map(f => `
    <div class="feed-item">
      <div class="feed-dot ${f.type}"></div>
      <div><div>${f.msg}</div><div class="feed-time">${timeAgo(f.ts)}</div></div>
    </div>`).join('') : '<div class="empty-state" style="padding:1rem"><div class="emo">📡</div>Waiting for activity…</div>';
}

function adminTab(btn, target) {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.admin-sec').forEach(s => s.classList.remove('active'));
  $(target).classList.add('active');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && $('screen-login').style.display !== 'none') doLogin();
});

// Cross-tab real-time sync via storage events
window.addEventListener('storage', async (e) => {
  if (e.key !== STORAGE_KEY) return;
  if (currentUser?.role === 'customer') await renderMyBookings();
});