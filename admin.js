/* ═══════════════════════════════════════
   ONLINE MARKET — admin.js
   تسجيل الدخول عن طريق Supabase Auth (مفيش باسورد مكتوب في الكود)
═══════════════════════════════════════ */
const SB_URL = 'https://znminmjaiprdgwjdxirj.supabase.co';
const SB_KEY = 'sb_publishable_CVcKNac97IpfUu7k1PETkQ_GBJ_S0iY';
const sb = supabase.createClient(SB_URL, SB_KEY);

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EGP = v => `${Number(v || 0).toLocaleString('ar-EG')} ج`;
const tm = s => new Date(s).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const STATUS = { new: 'جديد', preparing: 'قيد التحضير', delivering: 'في الطريق', delivered: 'تم التسليم', cancelled: 'ملغي' };
const NEXT = { new: ['preparing', 'بدء التحضير'], preparing: ['delivering', 'خرج للتوصيل'], delivering: ['delivered', 'تم التسليم'] };
const fullDate = s => new Date(s).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });
const ago = s => { const m = Math.floor((Date.now() - new Date(s)) / 60000); return m < 1 ? 'الآن' : m < 60 ? `منذ ${m} دقيقة` : m < 1440 ? `منذ ${Math.floor(m / 60)} ساعة` : `منذ ${Math.floor(m / 1440)} يوم`; };
const linkify = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" target="_blank" rel="noopener">رابط الموقع</a>`);
function applyBrand() {
  const raw = settings.brand_color || '';
  if (!/^#[0-9a-f]{6}$/i.test(raw)) return;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(raw.slice(i, i + 2), 16));
  const root = document.documentElement.style;
  root.setProperty('--acc', raw);
  root.setProperty('--acc-d', `rgb(${Math.round(r * .85)},${Math.round(g * .85)},${Math.round(b * .85)})`);
  root.setProperty('--acc-bg', `rgba(${r},${g},${b},.1)`);
}
const waNum = p => { const d = String(p || '').replace(/\D/g, ''); return d.startsWith('0') ? '20' + d.slice(1) : d; };

function toast(msg, type = '', ms = 3000) {
  const t = document.createElement('div');
  t.className = 'tst' + (type ? ' ' + type : '');
  t.textContent = msg; $('tc').appendChild(t);
  setTimeout(() => { t.classList.add('hid'); setTimeout(() => t.remove(), 300); }, ms);
}
window.closeMo = id => $(id).classList.remove('open');
const openMo = id => $(id).classList.add('open');
document.addEventListener('click', e => { if (e.target.classList.contains('mo')) e.target.classList.remove('open'); });

function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); setTimeout(() => { o.stop(); a.close(); }, 400);
  } catch (e) {}
}

/* ── State ── */
let cats = [], prods = [], offs = [], orders = [], posSales = [], settings = {};
// PostgREST بيرجّع 1000 صف بس في المرة، فنقرا على دفعات
async function fetchAll(make) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await make().range(from, from + 999);
    if (error) return { data: null, error };
    out = out.concat(data || []);
    if (!data || data.length < 1000 || from > 30000) return { data: out, error: null };
    from += 1000;
  }
}
let ordFilter = 'active', knownMax = null, started = false, timer = null;

/* ══ AUTH ══ */
async function tryLogin() {
  const { error } = await sb.auth.signInWithPassword({ email: $('loginUser').value.trim(), password: $('loginPass').value });
  if (error) {
    $('loginErr').style.display = 'block'; $('loginPass').value = '';
    setTimeout(() => $('loginErr').style.display = 'none', 3500);
    return;
  }
  $('loginScreen').style.display = 'none'; start();
}
$('loginBtn').addEventListener('click', tryLogin);
$('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
$('loginUser').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginPass').focus(); });
$('logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

$('prodSearch').addEventListener('input', renderLists);

/* ══ NAV ══ */
document.querySelectorAll('.nav[data-tab]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.nav[data-tab]').forEach(b => b.classList.toggle('on', b === btn));
  document.querySelectorAll('.tab-p').forEach(p => p.classList.remove('on'));
  $('tab-' + btn.dataset.tab).classList.add('on');
  closeSB();
}));
function closeSB() { $('sidebar').classList.remove('open'); $('sbOv').style.display = 'none'; }
$('mobBtn').addEventListener('click', () => { $('sidebar').classList.add('open'); $('sbOv').style.display = 'block'; });
$('sbOv').addEventListener('click', closeSB);

/* ══ LOAD ══ */
async function loadAll() {
  const [c, p, o, s] = await Promise.all([
    sb.from('mk_categories').select('*').order('sort').order('id'),
    fetchAll(() => sb.from('mk_products').select('*').order('sort').order('id')),
    sb.from('mk_offers').select('*').order('sort').order('id'),
    sb.from('mk_settings').select('*'),
  ]);
  if (c.error || p.error) { console.error('load error', c.error || p.error); toast('تعذر تحميل البيانات، يرجى إعادة المحاولة', 'err', 5000); return; }
  cats = c.data || []; prods = p.data || []; offs = o.data || [];
  settings = Object.fromEntries((s.data || []).map(r => [r.key, r.value]));
  $('admName').textContent = settings.shop_name || 'المتجر'; applyBrand();
  renderLists(); renderSettings(); renderPos();
  await loadOrders(true);
  loadPos();
}
async function start() {
  if (started) return; started = true;
  await loadAll();
  timer = setInterval(() => loadOrders(false), 10000);
}

/* ══ ORDERS ══ */
async function loadOrders(initial) {
  let { data, error } = await sb.from('mk_orders').select('*').neq('source', 'pos').order('id', { ascending: false }).limit(300);
  if (error) ({ data, error } = await sb.from('mk_orders').select('*').order('id', { ascending: false }).limit(300));  // قبل تشغيل pos-setup.sql
  if (error) { console.error('orders error', error); if (initial) toast('تعذر تحميل الطلبات', 'err'); return; }
  orders = data || [];
  const max = orders.reduce((m, o) => Math.max(m, o.id), 0);
  if (knownMax !== null && orders.some(o => o.id > knownMax && o.status === 'new')) {
    beep(); toast('وصل طلب جديد', 'ok', 4000); reloadProducts();
  }
  knownMax = max;
  renderOrders();
}
$('btnRefresh').addEventListener('click', () => loadOrders(false));

function matchFilter(o) {
  if (ordFilter === 'all') return true;
  if (ordFilter === 'active') return ['new', 'preparing', 'delivering'].includes(o.status);
  return o.status === ordFilter;
}
function renderOrders() {
  const today = todayStr();
  const tod = orders.filter(o => o.order_date === today);
  const newC = orders.filter(o => o.status === 'new').length;
  $('sNew').textContent = newC;
  $('sToday').textContent = tod.length;
  $('sRev').textContent = EGP(tod.filter(o => o.status !== 'cancelled').reduce((s, o) => s + Number(o.total), 0));
  $('sDone').textContent = tod.filter(o => o.status === 'delivered').length;
  const bd = $('qBadge'); bd.style.display = newC ? 'inline-block' : 'none'; bd.textContent = newC;
  document.title = newC ? `(${newC}) لوحة التحكم` : 'لوحة التحكم';

  const count = f => orders.filter(o => f === 'all' ? true : f === 'active' ? ['new', 'preparing', 'delivering'].includes(o.status) : o.status === f).length;
  const chips = [['active', 'النشطة'], ['new', 'جديد'], ['preparing', 'قيد التحضير'], ['delivering', 'في الطريق'], ['delivered', 'تم التسليم'], ['cancelled', 'ملغي'], ['all', 'الكل']];
  $('ordChips').innerHTML = chips.map(([k, l]) => `<button class="chip ${ordFilter === k ? 'on' : ''}" data-f="${k}">${l} (${count(k)})</button>`).join('');

  const q = $('ordSearch').value.trim().toLowerCase();
  let list = orders.filter(matchFilter).filter(o => !q || o.customer_name.toLowerCase().includes(q) || o.customer_phone.includes(q) || String(o.order_no) === q.replace('#', ''));
  const asc = ['active', 'new', 'preparing', 'delivering'].includes(ordFilter);
  list = list.slice().sort((a, b) => asc ? a.id - b.id : b.id - a.id);
  $('ordList').innerHTML = list.length ? list.map(orderCard).join('') : '<div class="q-empty mut" style="grid-column:1/-1;padding:30px;text-align:center">لا توجد طلبات</div>';
}
$('ordChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { ordFilter = b.dataset.f; renderOrders(); } });
$('ordSearch').addEventListener('input', renderOrders);

function payText(o) {
  return o.payment_method === 'wallet'
    ? `محفظة${o.wallet_ref ? ` من <span style="direction:ltr;display:inline-block">${esc(o.wallet_ref)}</span>` : ''} · <span class="st ${o.payment_status}">${o.payment_status === 'paid' ? 'تم تأكيد الدفع' : 'لم يتم تأكيد الدفع'}</span>`
    : `نقداً عند الاستلام · <span class="st ${o.payment_status}">${o.payment_status === 'paid' ? 'تم التحصيل' : 'لم يُحصَّل بعد'}</span>`;
}
function orderCard(o) {
  const nx = NEXT[o.status];
  const final = o.status === 'delivered' || o.status === 'cancelled';
  const items = o.items || [];
  const pieces = items.reduce((n, i) => n + i.qty, 0);
  const prev = orders.filter(x => x.customer_phone === o.customer_phone).length;
  return `<div class="ord ${o.status === 'new' ? 'is-new' : ''}">
    <div class="ord-h"><div><b>طلب #${o.order_no}</b><div class="mut">${fullDate(o.created_at)} · ${ago(o.created_at)}</div></div><span class="st ${o.status}">${STATUS[o.status]}</span></div>
    <div class="ord-b">
      <div class="blk-t">العميل</div>
      <div><b>${esc(o.customer_name)}</b>${prev > 1 ? ` <span class="mut">· عدد طلباته: ${prev}</span>` : ''}</div>
      <div class="ord-links">
        <a href="tel:${esc(o.customer_phone)}" style="direction:ltr">${esc(o.customer_phone)}</a>
        <a href="https://wa.me/${waNum(o.customer_phone)}" target="_blank" rel="noopener">واتساب</a>
      </div>
      <div class="blk-t">العنوان</div>
      <div class="addr">${linkify(o.address)}</div>
      ${o.lat != null && o.lng != null ? `<div class="ord-links">
        <a href="https://www.google.com/maps?q=${o.lat},${o.lng}" target="_blank" rel="noopener">الموقع على الخريطة</a>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}" target="_blank" rel="noopener">الاتجاهات</a>
      </div>` : ''}
      <div class="blk-t">المنتجات (${pieces} قطعة)</div>
      <table class="it"><tr><th>المنتج</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th></tr>
        ${items.map(i => `<tr><td>${esc(i.name)}</td><td>${EGP(i.price)}</td><td>${i.qty}</td><td>${EGP(i.price * i.qty)}</td></tr>`).join('')}</table>
      ${o.notes ? `<div class="ord-note">ملاحظات العميل: ${esc(o.notes)}</div>` : ''}
      <div class="tl"><span>المنتجات</span><span>${EGP(o.subtotal)}</span></div>
      <div class="tl"><span>التوصيل</span><span>${o.delivery_fee > 0 ? EGP(o.delivery_fee) : `<a href="#" onclick="showInvoice(${o.id});return false">حدّد رسوم التوصيل</a>`}</span></div>
      <div class="ord-tot"><span>الإجمالي</span><span class="gold">${EGP(o.total)}</span></div>
      <div class="blk-t">الدفع</div>
      <div>${payText(o)}</div>
    </div>
    <div class="ord-f">
      ${nx ? `<button class="btn btn-gold btn-sm" onclick="setStatus(${o.id},'${nx[0]}')">${nx[1]}</button>` : ''}
      ${o.payment_method === 'wallet' && o.payment_status === 'unpaid' && o.status !== 'cancelled' ? `<button class="btn btn-green btn-sm" onclick="markPaid(${o.id})">تأكيد استلام الدفع</button>` : ''}
      <button class="btn btn-dark btn-sm" onclick="showInvoice(${o.id})">الفاتورة</button>
      ${!final ? `<button class="btn btn-red btn-sm" onclick="cancelOrder(${o.id})">إلغاء الطلب</button>` : ''}
    </div>
  </div>`;
}

/* ══ INVOICE ══ */
let curInv = null;
const paperPref = () => { try { return localStorage.getItem('mk_paper') || '80mm'; } catch (e) { return '80mm'; } };
$('invPaper').addEventListener('change', e => { try { localStorage.setItem('mk_paper', e.target.value); } catch (x) {} });
$('invFq').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) $('invFee').value = b.dataset.v === '0' ? '' : b.dataset.v; });
$('invFeeBtn').addEventListener('click', async () => {
  const o = curInv; if (!o || isPos(o)) return;
  const fee = Number($('invFee').value) || 0;
  if (fee < 0) { toast('الرسوم غير صحيحة', 'err'); return; }
  const { data, error } = await sb.rpc('mk_set_delivery', { p_id: o.id, p_fee: fee });
  if (error) { console.error(error); toast(/does not exist|permission denied|schema cache/i.test(error.message || '') ? 'شغّل ملف update-3.sql في Supabase أولاً' : (error.message || 'تعذر الحفظ'), 'err', 5000); return; }
  if (!data) return;
  o.delivery_fee = data.delivery_fee; o.total = data.total;
  $('invoice').innerHTML = invoiceHtml(o);
  toast(fee > 0 ? 'تمت إضافة رسوم التوصيل للفاتورة' : 'تم حذف رسوم التوصيل', 'ok');
  loadOrders(false);
});
const isPos = o => o.source === 'pos';
const payPlain = o => o.payment_method === 'card' ? 'كارت'
  : o.payment_method === 'wallet'
    ? `محفظة إلكترونية${o.payment_status === 'paid' ? ' (تم الدفع)' : ' (لم يتم تأكيد الدفع)'}`
    : isPos(o) ? 'نقدي' : `نقداً عند الاستلام${o.payment_status === 'paid' ? ' (تم التحصيل)' : ''}`;
const hasCust = o => !isPos(o) || o.customer_name !== 'عميل نقدي' || (o.customer_phone && o.customer_phone !== '-');
const nf = v => Number(v || 0).toLocaleString('ar-EG');
function invoiceHtml(o) {
  const shop = settings.shop_name || 'المتجر';
  const wa = (settings.whatsapp || '').replace(/\D/g, '');
  const pos = isPos(o), fee = Number(o.delivery_fee) || 0, disc = Number(o.discount) || 0;
  return `<div class="inv-head">
      ${settings.logo_url ? `<img src="${esc(settings.logo_url)}" alt=""/>` : ''}<h2>${esc(shop)}</h2>${wa ? `<div style="font-size:11px;direction:ltr">+${wa}</div>` : ''}
      <div class="inv-meta"><b>${pos ? 'إيصال' : 'فاتورة'} #${o.order_no}</b> · ${fullDate(o.created_at)}</div>
    </div>
    ${hasCust(o) ? `<div class="inv-cust"><b>العميل:</b> ${esc(o.customer_name)}${o.customer_phone && o.customer_phone !== '-' ? ` · <span dir="ltr">${esc(o.customer_phone)}</span>` : ''}${pos ? '' : `\n<b>العنوان:</b> ${esc(o.address)}`}</div>` : ''}
    <table class="inv-t"><tr><th>الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th></tr>
      ${(o.items || []).map(i => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${nf(i.price)}</td><td>${nf(i.price * i.qty)}</td></tr>`).join('')}</table>
    <div class="inv-tot">
      ${fee > 0 || disc > 0 ? `<div><span>المنتجات</span><span>${EGP(o.subtotal)}</span></div>` : ''}
      ${fee > 0 ? `<div><span>خدمة التوصيل</span><span>${EGP(fee)}</span></div>` : ''}
      ${disc > 0 ? `<div><span>الخصم</span><span>- ${EGP(disc)}</span></div>` : ''}
      <div class="g"><span>الإجمالي</span><span>${EGP(o.total)}</span></div>
      ${pos && o.payment_method === 'cash' && o.received != null ? `<div><span>المستلم</span><span>${EGP(o.received)}</span></div><div><span>الباقي</span><span>${EGP(Number(o.received) - Number(o.total))}</span></div>` : ''}
    </div>
    <div class="inv-pay">الدفع: ${payPlain(o)}</div>
    <div class="inv-foot">${pos ? 'شكراً لزيارتكم' : 'شكراً لتعاملكم معنا'}</div>`;
}
function invText(o) {
  const shop = settings.shop_name || 'المتجر';
  return [
    `${isPos(o) ? 'إيصال' : 'فاتورة طلب'} #${o.order_no} - ${shop}`, `التاريخ: ${fullDate(o.created_at)}`, '',
    hasCust(o) ? `العميل: ${o.customer_name}` : null, hasCust(o) && o.customer_phone !== '-' ? `الهاتف: ${o.customer_phone}` : null, isPos(o) ? null : `العنوان: ${o.address}`,
    o.lat != null ? `الموقع: https://www.google.com/maps?q=${o.lat},${o.lng}` : null, '',
    'الطلب:', ...(o.items || []).map(i => `${i.qty} × ${i.name} = ${EGP(i.price * i.qty)}`), '',
    `المنتجات: ${EGP(o.subtotal)}`, Number(o.delivery_fee) > 0 ? `خدمة التوصيل: ${EGP(o.delivery_fee)}` : null,
    Number(o.discount) > 0 ? `الخصم: ${EGP(o.discount)}` : null,
    `الإجمالي: ${EGP(o.total)}`, `الدفع: ${payPlain(o)}`, '', isPos(o) ? 'شكراً لزيارتكم' : 'شكراً لطلبكم',
  ].filter(x => x !== null).join('\n');
}
window.showInvoice = id => {
  const o = orders.find(x => x.id === id) || posSales.find(x => x.id === id); if (!o) return;
  curInv = o; $('invoice').innerHTML = invoiceHtml(o); $('invoice').classList.toggle('rcpt', isPos(o));
  $('invWa').style.display = hasCust(o) && o.customer_phone && o.customer_phone !== '-' ? '' : 'none';
  const canFee = !isPos(o) && o.status !== 'cancelled';
  $('invDel').classList.toggle('hide', !canFee);
  if (canFee) {
    $('invFee').value = Number(o.delivery_fee) > 0 ? Number(o.delivery_fee) : '';
    const a = Number(settings.delivery_min) || 0, b = Number(settings.delivery_max) || 0, vals = [0];
    if (a && b && b >= a) for (let v = a; v <= b && vals.length < 12; v += 5) vals.push(v); else vals.push(15, 20, 25, 30, 35);
    $('invFq').innerHTML = vals.map(v => `<button type="button" data-v="${v}">${v === 0 ? 'بدون' : v}</button>`).join('');
  }
  $('invPaper').value = paperPref();
  openMo('moInv');
};
async function invFile(o) {
  if (!window.html2canvas) return null;
  const canvas = await window.html2canvas($('invoice'), { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return blob ? new File([blob], `invoice-${o.order_no}.png`, { type: 'image/png' }) : null;
}
$('invPrint').addEventListener('click', () => {
  const p = paperPref(), thermal = p.endsWith('mm');
  const st = document.createElement('style');
  st.textContent = `@page{size:${thermal ? p + ' auto' : p};margin:${thermal ? '2mm' : '8mm'}}`
    + (p === '58mm' ? '.inv{font-size:10px!important}.inv-t{font-size:10px!important}' : '')
    + (thermal ? '' : '.inv{max-width:105mm!important;margin:0 auto!important}');
  document.head.appendChild(st);
  const done = () => { st.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
});
$('invImg').addEventListener('click', async () => {
  if (!curInv) return;
  try {
    const f = await invFile(curInv);
    if (!f) { toast('ميزة الصورة غير متاحة الآن، استخدم الطباعة أو حفظ PDF', 'err', 4500); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { console.error(e); toast('تعذر إنشاء الصورة، استخدم الطباعة أو حفظ PDF', 'err', 4500); }
});
$('invShare').addEventListener('click', async () => {
  const o = curInv; if (!o) return;
  try {
    const f = await invFile(o);
    if (f && navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: `فاتورة #${o.order_no}` }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; console.error(e); }
  if (navigator.share) {
    try { await navigator.share({ title: `فاتورة #${o.order_no}`, text: invText(o) }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(invText(o)), '_blank');
});
$('invWa').addEventListener('click', () => {
  if (!curInv) return;
  window.open(`https://wa.me/${waNum(curInv.customer_phone)}?text=${encodeURIComponent(invText(curInv))}`, '_blank');
});
$('invCopy').addEventListener('click', async () => {
  if (!curInv) return;
  try { await navigator.clipboard.writeText(invText(curInv)); toast('تم نسخ نص الفاتورة', 'ok'); }
  catch (e) { toast('تعذر النسخ', 'err'); }
});

async function patchOrder(id, patch) {
  const { error } = await sb.from('mk_orders').update(patch).eq('id', id);
  if (error) { console.error(error); toast('تعذر تحديث الطلب', 'err'); return false; }
  await loadOrders(false); return true;
}
window.setStatus = (id, status) => {
  const o = orders.find(x => x.id === id);
  const patch = { status };
  if (status === 'delivered' && o && o.payment_method === 'cash') patch.payment_status = 'paid';
  patchOrder(id, patch);
};
window.markPaid = id => patchOrder(id, { payment_status: 'paid' }).then(ok => ok && toast('تم تأكيد الدفع', 'ok'));
window.cancelOrder = id => { if (confirm('هل تريد إلغاء الطلب؟')) patchOrder(id, { status: 'cancelled' }); };

/* ══ CRUD ══ */
const T = { products: 'mk_products', categories: 'mk_categories', offers: 'mk_offers' };
const DATA = () => ({ products: prods, categories: cats, offers: offs });
const catName = id => (cats.find(c => c.id === id) || {}).name || '—';
const thumb = u => u ? `<img class="thumb" src="${esc(u)}" alt="" loading="lazy"/>` : '<div class="thumb"></div>';
const tog = (key, id, field, v) => `<input type="checkbox" class="tog" ${v ? 'checked' : ''} onchange="toggleField('${key}',${id},'${field}',this.checked)"/>`;
const actions = (key, id) => `<td class="r"><button class="btn btn-line btn-sm" onclick="editItem('${key}',${id})">تعديل</button> <button class="btn btn-red btn-sm" onclick="delItem('${key}',${id})">حذف</button></td>`;

const num = v => Number(v).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const trk = p => p.stock !== null && p.stock !== undefined && p.stock !== '';
const stkState = p => !trk(p) ? 'off' : Number(p.stock) <= 0 ? 'out' : Number(p.stock) <= Number(p.low_stock ?? 5) ? 'low' : 'ok';
const STK_L = { ok: 'متوفر', low: 'قرب يخلص', out: 'نفد', off: 'غير متابَع' };
let stkFilter = 'all';
const stockCell = r => `<div class="stk-b">${trk(r) ? `<b>${num(r.stock)}</b>` : ''}<span class="st ${stkState(r)}">${STK_L[stkState(r)]}</span><button class="btn btn-line btn-sm" onclick="stockDlg(${r.id})">${trk(r) ? 'توريد / جرد' : 'تتبّع'}</button></div>`;
function renderStockBar() {
  const c = { all: prods.length, low: 0, out: 0, off: 0, ok: 0 }; let val = 0;
  prods.forEach(p => { const st = stkState(p); c[st]++; if (st === 'ok' || st === 'low') val += Number(p.stock) * Number(p.price); });
  const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $('stkStats').innerHTML = stat('أصناف متابَعة', c.all - c.off) + stat('قرب يخلص', c.low) + stat('نفد', c.out) + stat('قيمة المخزون (بسعر البيع)', EGP(val));
  $('stkChips').innerHTML = [['all', 'الكل'], ['low', 'قرب يخلص'], ['out', 'نفد'], ['ok', 'متوفر'], ['off', 'غير متابَع']].map(([k, l]) => `<button class="chip ${stkFilter === k ? 'on' : ''}" data-f="${k}">${l} (${c[k]})</button>`).join('');
}
$('stkChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { stkFilter = b.dataset.f; renderLists(); } });

async function reloadProducts() {
  const { data, error } = await fetchAll(() => sb.from('mk_products').select('*').order('sort').order('id'));
  if (error || !data) return;
  prods = data; renderLists(); renderPos();
}
let stkId = null;
const stkErr = e => { console.error(e); toast(/does not exist|permission denied|schema cache|column/i.test(e.message || '') ? 'شغّل ملف update-3.sql في Supabase أولاً' : (e.message || 'تعذر الحفظ'), 'err', 5000); };
window.stockDlg = id => {
  const p = prods.find(x => x.id === id); if (!p) return;
  stkId = id; $('stkTitle').textContent = p.name;
  $('stkCur').textContent = trk(p) ? `الكمية الحالية: ${num(p.stock)} · الحالة: ${STK_L[stkState(p)]}` : 'المنتج غير متابَع، أضف كمية أو اضبطها لبدء المتابعة.';
  $('stkAdd').value = ''; $('stkSet').value = ''; $('stkLow').value = p.low_stock ?? 5;
  $('stkOff').style.display = trk(p) ? '' : 'none';
  openMo('moStock'); setTimeout(() => $('stkAdd').focus(), 50);
};
$('stkAddBtn').addEventListener('click', async () => {
  const v = Number($('stkAdd').value); if (!$('stkAdd').value || !isFinite(v) || v === 0) { toast('اكتب الكمية', 'err'); return; }
  const { error } = await sb.rpc('mk_stock_add', { p_id: stkId, p_delta: v });
  if (error) return stkErr(error);
  closeMo('moStock'); toast('تم تحديث المخزون', 'ok'); reloadProducts();
});
const stkUpdate = async patch => {
  const { error } = await sb.from('mk_products').update(patch).eq('id', stkId);
  if (error) return stkErr(error);
  closeMo('moStock'); toast('تم الحفظ', 'ok'); reloadProducts();
};
$('stkSetBtn').addEventListener('click', () => { const v = Number($('stkSet').value); if (!$('stkSet').value || !isFinite(v)) { toast('اكتب الكمية الفعلية', 'err'); return; } stkUpdate({ stock: v }); });
$('stkLowBtn').addEventListener('click', () => { const v = Number($('stkLow').value); if (!(v >= 0)) { toast('رقم غير صحيح', 'err'); return; } stkUpdate({ low_stock: v }); });
$('stkOff').addEventListener('click', () => { if (confirm('إيقاف متابعة المخزون لهذا المنتج؟')) stkUpdate({ stock: null }); });

const CFG = {
  products: {
    label: 'منتج',
    fields: [['name', 'اسم المنتج', 'text', 1], ['barcode', 'الباركود (اختياري)', 'text'], ['category_id', 'القسم', 'cat'], ['description', 'الوصف', 'text'], ['price', 'السعر (جنيه)', 'number', 1], ['old_price', 'السعر قبل الخصم (اختياري)', 'number'], ['stock', 'الكمية في المخزن (فاضي = بدون متابعة)', 'number'], ['low_stock', 'تنبيه "قرب يخلص" عند', 'number'], ['image_url', 'صورة المنتج', 'image'], ['sort', 'الترتيب', 'number']],
    head: ['', 'المنتج', 'السعر', 'المخزون', 'متاح', 'ظاهر', ''],
    row: r => `<td>${thumb(r.image_url)}</td><td><b>${esc(r.name)}</b><div class="mut">${esc(catName(r.category_id))}</div></td><td class="gold">${EGP(r.price)}${r.old_price ? ` <s class="mut">${EGP(r.old_price)}</s>` : ''}</td><td>${stockCell(r)}</td><td>${tog('products', r.id, 'available', r.available)}</td><td>${tog('products', r.id, 'active', r.active)}</td>${actions('products', r.id)}`,
  },
  categories: {
    label: 'قسم',
    fields: [['name', 'اسم القسم', 'text', 1], ['sort', 'الترتيب', 'number']],
    head: ['القسم', 'عدد المنتجات', 'ظاهر', ''],
    row: r => `<td><b>${esc(r.name)}</b></td><td>${prods.filter(p => p.category_id === r.id).length}</td><td>${tog('categories', r.id, 'active', r.active)}</td>${actions('categories', r.id)}`,
  },
  offers: {
    label: 'عرض',
    fields: [['title', 'عنوان العرض', 'text', 1], ['description', 'الوصف (إيه اللي في العرض)', 'text'], ['price', 'سعر العرض (جنيه)', 'number', 1], ['old_price', 'السعر قبل الخصم (اختياري)', 'number'], ['image_url', 'صورة العرض', 'image'], ['sort', 'الترتيب', 'number']],
    head: ['', 'العرض', 'السعر', 'ظاهر', ''],
    row: r => `<td>${thumb(r.image_url)}</td><td><b>${esc(r.title)}</b><div class="mut">${esc(r.description || '')}</div></td><td class="gold">${EGP(r.price)}${r.old_price ? ` <s class="mut">${EGP(r.old_price)}</s>` : ''}</td><td>${tog('offers', r.id, 'active', r.active)}</td>${actions('offers', r.id)}`,
  },
};

function renderLists() {
  for (const key of Object.keys(CFG)) {
    let list = DATA()[key]; const cfg = CFG[key];
    let more = 0;
    if (key === 'products') {
      const q = ($('prodSearch') ? $('prodSearch').value : '').trim().toLowerCase();
      renderStockBar();
      if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q));
      if (stkFilter !== 'all') list = list.filter(p => stkState(p) === stkFilter);
      if (stkFilter === 'low' || stkFilter === 'out') list = list.slice().sort((a, b) => Number(a.stock) - Number(b.stock));
      if (list.length > 300) { more = list.length - 300; list = list.slice(0, 300); }
    }
    $('list-' + key).innerHTML = `<table class="tbl"><thead><tr>${cfg.head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
      list.length ? list.map(r => `<tr>${cfg.row(r)}</tr>`).join('')
        : `<tr><td colspan="${cfg.head.length}" style="text-align:center;padding:30px;color:var(--ink3)">لا يوجد، أضف أول ${cfg.label}</td></tr>`}</tbody></table>${more ? `<div class="mut" style="padding:10px">يوجد ${more} منتج آخر، استخدم البحث لإظهارهم</div>` : ''}`;
  }
}
window.toggleField = async (key, id, field, v) => {
  const { error } = await sb.from(T[key]).update({ [field]: v }).eq('id', id);
  if (error) { toast('تعذر التحديث', 'err'); loadAll(); return; }
  DATA()[key].find(r => r.id === id)[field] = v;
  toast('تم التحديث');
};
window.delItem = async (key, id) => {
  if (!confirm('هل تريد الحذف؟ يفضل الإخفاء بدلاً من الحذف.')) return;
  const { error } = await sb.from(T[key]).delete().eq('id', id);
  if (error) { toast('تعذر الحذف', 'err'); return; }
  toast('تم الحذف'); loadAll();
};

/* ── صورة: اختيار من الجهاز، تصغير، رفع ── */
let uploading = false;
function imageField(label, url) {
  return `<div class="fg"><label>${label}</label>
    <div style="display:flex;align-items:center;gap:12px">
      <div class="avatar" id="phPrev" style="width:72px;height:72px">${url ? `<img src="${esc(url)}" alt=""/>` : 'بدون صورة'}</div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
        <button type="button" class="btn btn-line btn-sm" id="phPick">اختيار صورة</button>
        <button type="button" class="btn btn-red btn-sm" id="phDel" ${url ? '' : 'style="display:none"'}>إزالة الصورة</button>
        <span class="mut" id="phMsg"></span>
      </div>
      <input type="file" id="phFile" accept="image/*" hidden/>
    </div>
    <input type="hidden" data-k="image_url" value="${esc(url || '')}"/></div>`;
}
async function resizeMax(file, max = 900, type = 'image/jpeg') {
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file);
  });
  const r = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise(res => c.toBlob(res, type, 0.82));
}
async function uploadImage(file, folder, max = 900, type = 'image/jpeg') {
  const blob = await resizeMax(file, max, type);
  const path = `${folder}/${Date.now()}.${type === 'image/png' ? 'png' : 'jpg'}`;
  const { error } = await sb.storage.from('market').upload(path, blob, { contentType: type, cacheControl: '31536000' });
  if (error) throw error;
  return sb.storage.from('market').getPublicUrl(path).data.publicUrl;
}
function wirePhoto(folder) {
  const file = $('phFile'); if (!file) return;
  const hidden = document.querySelector('#itemFields [data-k="image_url"]');
  const setUrl = u => {
    hidden.value = u || '';
    $('phPrev').innerHTML = u ? `<img src="${esc(u)}" alt=""/>` : 'بدون صورة';
    $('phDel').style.display = u ? '' : 'none';
  };
  $('phPick').onclick = () => file.click();
  $('phDel').onclick = () => setUrl('');
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    uploading = true; $('phMsg').textContent = 'جاري رفع الصورة...';
    try {
      setUrl(await uploadImage(f, folder));
      $('phMsg').textContent = '';
    } catch (e) {
      console.error('upload error', e);
      $('phMsg').textContent = '';
      toast('تعذر رفع الصورة، حاول بصورة أخرى', 'err', 4500);
    }
    uploading = false; file.value = '';
  };
}

let editing = null;
window.editItem = (key, id) => {
  const cfg = CFG[key], row = id ? DATA()[key].find(r => r.id === id) : null;
  editing = { key, id };
  $('itemTitle').textContent = (row ? 'تعديل ' : 'إضافة ') + cfg.label;
  $('itemFields').innerHTML = cfg.fields.map(([k, l, t, req]) => {
    if (t === 'image') return imageField(l, row ? row[k] : '');
    if (t === 'cat') return `<div class="fg"><label>${l}</label><select data-k="${k}"><option value="">بدون قسم</option>${cats.map(c => `<option value="${c.id}" ${row && row[k] === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>`;
    return `<div class="fg"><label>${l}${req ? ' *' : ''}</label><input data-k="${k}" type="${t}" ${t === 'number' ? 'min="0" step="any"' : ''} value="${esc(row ? row[k] ?? '' : (k === 'sort' ? 0 : ''))}"/></div>`;
  }).join('');
  wirePhoto(key);
  openMo('moItem');
};
$('btnSaveItem').addEventListener('click', async () => {
  if (uploading) { toast('انتظر اكتمال رفع الصورة', 'err'); return; }
  const { key, id } = editing, cfg = CFG[key], payload = {};
  for (const [k, l, t, req] of cfg.fields) {
    const raw = document.querySelector(`#itemFields [data-k="${k}"]`).value.trim();
    if (req && !raw) { toast(`${l} مطلوب`, 'err'); return; }
    payload[k] = t === 'number' ? (raw === '' ? null : Number(raw)) : t === 'cat' ? (raw ? Number(raw) : null) : (raw || null);
  }
  if ('sort' in payload && payload.sort === null) payload.sort = 0;
  if ('low_stock' in payload && payload.low_stock === null) payload.low_stock = 5;
  if ('price' in payload && payload.price < 0) { toast('السعر غير صحيح', 'err'); return; }
  const { error } = await (id ? sb.from(T[key]).update(payload).eq('id', id) : sb.from(T[key]).insert([payload]));
  if (error) { console.error(error); toast('تعذر الحفظ، تأكد من البيانات', 'err', 4500); return; }
  closeMo('moItem'); toast('تم الحفظ', 'ok'); loadAll();
});

/* ══ SETTINGS ══ */
function renderSettings() {
  $('setName').value = settings.shop_name || '';
  $('setWa').value = settings.whatsapp || '';
  $('setAcc').checked = settings.accepting !== 'false';
  $('setDMin').value = settings.delivery_min ?? 15;
  $('setDMax').value = settings.delivery_max ?? 35;
  $('setMin').value = settings.min_order ?? 0;
  $('setCash').checked = settings.cash_enabled !== 'false';
  $('setWallet').checked = settings.wallet_enabled !== 'false';
  $('setWName').value = settings.wallet_name || '';
  $('setWNum').value = settings.wallet_number || '';
  $('setColor').value = /^#[0-9a-f]{6}$/i.test(settings.brand_color || '') ? settings.brand_color : '#ff5a00';
  $('setLogo').value = settings.logo_url || ''; renderLogo();
}
function renderLogo() {
  const u = $('setLogo').value;
  $('logoPrev').innerHTML = u ? `<img src="${esc(u)}" alt=""/>` : 'بدون شعار';
  $('logoDel').classList.toggle('hide', !u);
}
$('logoPick').addEventListener('click', () => $('logoFile').click());
$('logoDel').addEventListener('click', () => { $('setLogo').value = ''; renderLogo(); });
$('logoFile').addEventListener('change', async () => {
  const f = $('logoFile').files[0]; if (!f) return;
  try { $('setLogo').value = await uploadImage(f, 'logo', 400, 'image/png'); renderLogo(); toast('تم رفع الشعار، اضغط حفظ لتثبيته'); }
  catch (e) { console.error('logo upload', e); toast('تعذر رفع الشعار', 'err'); }
  $('logoFile').value = '';
});
const snum = id => String(Math.max(0, Number($(id).value) || 0));
$('btnSaveSet').addEventListener('click', async () => {
  const rows = [
    { key: 'shop_name', value: $('setName').value.trim() || 'المتجر' },
    { key: 'whatsapp', value: $('setWa').value.trim() },
    { key: 'accepting', value: $('setAcc').checked ? 'true' : 'false' },
    { key: 'delivery_min', value: snum('setDMin') },
    { key: 'delivery_max', value: snum('setDMax') },
    { key: 'min_order', value: snum('setMin') },
    { key: 'cash_enabled', value: $('setCash').checked ? 'true' : 'false' },
    { key: 'wallet_enabled', value: $('setWallet').checked ? 'true' : 'false' },
    { key: 'wallet_name', value: $('setWName').value.trim() },
    { key: 'wallet_number', value: $('setWNum').value.trim() },
    { key: 'brand_color', value: $('setColor').value },
    { key: 'logo_url', value: $('setLogo').value },
  ];
  const { error } = await sb.from('mk_settings').upsert(rows);
  if (error) { toast('تعذر الحفظ', 'err'); return; }
  toast('تم حفظ الإعدادات', 'ok'); loadAll();
});

/* ══ INIT ══ */
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) { $('loginScreen').style.display = 'none'; start(); }
  else $('loginUser').focus();
})();

/* ══════════════════════════════════════
   POS — الكاشير
══════════════════════════════════════ */
const POS_CART = 'mk_pos_cart', POS_HOLD = 'mk_pos_hold';
const jget = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const PAYN = { cash: 'نقدي', card: 'كارت', wallet: 'محفظة' };
let pc = { lines: [], cat: 'all', pay: 'cash', busy: false, cu: 1 };
try { const sv = jget(POS_CART, []); if (Array.isArray(sv)) pc.lines = sv.filter(l => l && l.name && l.qty > 0 && l.price >= 0); } catch (e) {}
const savePos = () => jset(POS_CART, pc.lines);
const holds = () => { const h = jget(POS_HOLD, []); return Array.isArray(h) ? h : []; };

const barcodes = p => String(p.barcode || '').split(/[|,\s]+/).filter(Boolean);
function posList() {
  const q = $('posSearch').value.trim().toLowerCase();
  return prods.filter(p => p.active && p.available
    && (pc.cat === 'all' || String(p.category_id) === String(pc.cat))
    && (!q || p.name.toLowerCase().includes(q) || barcodes(p).some(b => b.includes(q))));
}
function renderPosChips() {
  const used = new Set(prods.filter(p => p.active && p.available).map(p => p.category_id));
  $('posChips').innerHTML = [`<button class="chip ${pc.cat === 'all' ? 'on' : ''}" data-c="all">الكل</button>`]
    .concat(cats.filter(c => used.has(c.id)).map(c => `<button class="chip ${String(pc.cat) === String(c.id) ? 'on' : ''}" data-c="${c.id}">${esc(c.name)}</button>`)).join('');
}
function renderPosGrid() {
  const list = posList(), CAP = 120;
  $('posGrid').innerHTML = list.length
    ? list.slice(0, CAP).map(p => `<button class="pos-p" data-id="${p.id}"><b>${esc(p.name)}</b><span>${EGP(p.price)}</span>${trk(p) ? `<small class="${stkState(p) === 'out' ? 'out' : stkState(p) === 'low' ? 'lo' : ''}">${stkState(p) === 'out' ? 'نفد' : 'متبقي ' + num(p.stock)}</small>` : ''}</button>`).join('')
    : '<div class="empty">لا توجد منتجات مطابقة</div>';
  $('posMore').textContent = list.length > CAP ? `يظهر أول ${CAP} من ${list.length} منتج، اكتب في البحث لتضييق النتائج` : '';
}
const posSub = () => r2(pc.lines.reduce((t, l) => t + Number(l.price) * Number(l.qty), 0));
function posDisc(sub) {
  const v = Math.max(0, Number($('posDisc').value) || 0);
  return r2(Math.min(sub, $('posDiscT').value === 'pct' ? sub * Math.min(v, 100) / 100 : v));
}
function renderPosCart() {
  $('posLines').innerHTML = pc.lines.length ? pc.lines.map(l => `<div class="pl" data-k="${l.key}">
      <div class="pl-n">${esc(l.name)}</div><div class="pl-t">${EGP(r2(l.price * l.qty))}</div>
      <div class="pl-c">
        <span class="q"><button data-a="dec">−</button><input data-f="qty" type="number" min="0" step="any" value="${l.qty}"/><button data-a="inc">+</button></span>
        <span class="mut">×</span><input data-f="price" type="number" min="0" step="any" value="${l.price}" title="تعديل السعر"/>
        <button class="pl-x" data-a="del" title="حذف">✕</button>
      </div></div>`).join('') : '<div class="pos-empty">الفاتورة فاضية، اختار منتج أو امسح الباركود</div>';
  posTotals();
}
function posTotals() {
  const sub = posSub(), disc = posDisc(sub), tot = r2(sub - disc), cash = pc.pay === 'cash';
  $('posSub').textContent = EGP(sub); $('posTot').textContent = EGP(tot);
  $('posCash').classList.toggle('hide', !cash);
  const rv = $('posRecv').value.trim(), recv = rv === '' ? null : Number(rv);
  const chg = recv == null ? 0 : r2(recv - tot);
  $('posChg').textContent = EGP(Math.max(chg, 0)); $('posChg').parentElement.classList.toggle('neg', chg < 0);
  if (chg < 0) $('posChg').textContent = 'ناقص ' + EGP(-chg);
  const bad = cash && recv != null && recv < tot;
  $('posPay').disabled = pc.busy || !pc.lines.length || bad;
  $('posPay').textContent = pc.lines.length ? `إتمام البيع — ${EGP(tot)}  (F9)` : 'إتمام البيع  (F9)';
  $('posHoldN').textContent = holds().length;
}
function renderPos() { renderPosChips(); renderPosGrid(); renderPosCart(); }

function addLine(p) {
  const key = 'p' + p.id, ex = pc.lines.find(l => l.key === key && l.price === Number(p.price));
  if (ex) ex.qty = r2(ex.qty + 1);
  else pc.lines.push({ key, id: p.id, name: p.name, price: Number(p.price), base: Number(p.price), qty: 1 });
  const tot = pc.lines.filter(l => l.id === p.id).reduce((t, l) => t + l.qty, 0);
  if (trk(p) && tot > Number(p.stock)) toast(`تنبيه: المخزون المسجّل من «${p.name}» ${num(p.stock)} فقط`, 'err', 3500);
  savePos(); renderPosCart();
}
$('posGrid').addEventListener('click', e => {
  const b = e.target.closest('.pos-p'); if (!b) return;
  const p = prods.find(x => x.id === Number(b.dataset.id)); if (p) addLine(p);
  $('posSearch').value = ''; renderPosGrid(); $('posSearch').focus();   // خلّصت المنتج، امسح البحث
});
$('posChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; pc.cat = b.dataset.c; renderPosChips(); renderPosGrid(); });
$('posSearch').addEventListener('input', renderPosGrid);
$('posSearch').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.target.value = ''; renderPosGrid(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const v = e.target.value.trim(); if (!v) return;
  const hit = prods.find(p => p.active && p.available && barcodes(p).includes(v)) || (posList().length === 1 ? posList()[0] : null);
  if (hit) { addLine(hit); e.target.value = ''; renderPosGrid(); }
  else { toast('مفيش منتج بالاسم أو الباركود ده', 'err'); e.target.value = ''; renderPosGrid(); }
});

$('posLines').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const k = b.closest('.pl').dataset.k, l = pc.lines.find(x => x.key === k); if (!l) return;
  if (b.dataset.a === 'inc') l.qty = r2(l.qty + 1);
  else if (b.dataset.a === 'dec') { l.qty = r2(l.qty - 1); if (l.qty <= 0) pc.lines = pc.lines.filter(x => x !== l); }
  else pc.lines = pc.lines.filter(x => x !== l);
  savePos(); renderPosCart();
});
$('posLines').addEventListener('change', e => {
  const f = e.target.dataset.f; if (!f) return;
  const k = e.target.closest('.pl').dataset.k, l = pc.lines.find(x => x.key === k); if (!l) return;
  const v = Number(e.target.value);
  if (f === 'qty') { if (!(v > 0)) pc.lines = pc.lines.filter(x => x !== l); else l.qty = r2(Math.min(v, 9999)); }
  else if (v >= 0 && e.target.value !== '') l.price = r2(v);
  savePos(); renderPosCart();
});
['posDisc', 'posDiscT', 'posRecv'].forEach(id => $(id).addEventListener('input', posTotals));
$('posPayOpts').addEventListener('click', e => {
  const b = e.target.closest('[data-pay]'); if (!b) return;
  pc.pay = b.dataset.pay;
  $('posPayOpts').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  posTotals();
});
$('posQ').addEventListener('click', e => {
  const b = e.target.closest('[data-q]'); if (!b) return;
  const tot = r2(posSub() - posDisc(posSub()));
  $('posRecv').value = b.dataset.q === 'exact' ? tot : b.dataset.q; posTotals();
});

function posReset() {
  pc.lines = []; savePos();
  ['posDisc', 'posRecv', 'posName', 'posPhone'].forEach(id => { $(id).value = ''; });
  $('posDiscT').value = 'amt'; renderPosCart();
}
$('posClear').addEventListener('click', () => { if (pc.lines.length && confirm('مسح الفاتورة الحالية؟')) posReset(); });

// تعليق واسترجاع فواتير
function holdCurrent() {
  if (!pc.lines.length) return false;
  const h = holds(); h.push({ id: Date.now(), at: new Date().toISOString(), lines: pc.lines, disc: $('posDisc').value, discT: $('posDiscT').value, name: $('posName').value, phone: $('posPhone').value });
  jset(POS_HOLD, h); return true;
}
$('posHold').addEventListener('click', () => { if (!holdCurrent()) { toast('الفاتورة فاضية', 'err'); return; } posReset(); toast('تم تعليق الفاتورة', 'ok'); });
function renderHolds() {
  const h = holds();
  $('holdList').innerHTML = h.length ? h.map(x => `<div class="hold-i"><div><b>${x.lines.length} صنف · ${EGP(r2(x.lines.reduce((t, l) => t + l.price * l.qty, 0)))}</b><div class="mut">${tm(x.at)}${x.name ? ' · ' + esc(x.name) : ''}</div></div>
    <div><button class="btn btn-gold btn-sm" data-h="${x.id}" data-a="open">استرجاع</button> <button class="btn btn-red btn-sm" data-h="${x.id}" data-a="del">حذف</button></div></div>`).join('')
    : '<div class="pos-empty">لا توجد فواتير معلّقة</div>';
}
$('posRecall').addEventListener('click', () => { renderHolds(); openMo('moHold'); });
$('holdList').addEventListener('click', e => {
  const b = e.target.closest('[data-h]'); if (!b) return;
  const id = Number(b.dataset.h), h = holds(), x = h.find(y => y.id === id); if (!x) return;
  if (b.dataset.a === 'del') { jset(POS_HOLD, h.filter(y => y.id !== id)); renderHolds(); posTotals(); return; }
  const rest = h.filter(y => y.id !== id); jset(POS_HOLD, rest);
  holdCurrent();                     // الفاتورة الحالية تتعلّق تلقائياً
  pc.lines = x.lines; $('posDisc').value = x.disc || ''; $('posDiscT').value = x.discT || 'amt';
  $('posName').value = x.name || ''; $('posPhone').value = x.phone || '';
  savePos(); renderPosCart(); closeMo('moHold');
});

// صنف حر
$('posCustom').addEventListener('click', () => { $('cuName').value = ''; $('cuPrice').value = ''; $('cuQty').value = 1; openMo('moCustom'); setTimeout(() => $('cuName').focus(), 50); });
$('cuAdd').addEventListener('click', () => {
  const name = $('cuName').value.trim(), price = Number($('cuPrice').value), qty = Number($('cuQty').value);
  if (!name) { toast('اكتب اسم الصنف', 'err'); return; }
  if (!($('cuPrice').value !== '' && price >= 0)) { toast('اكتب السعر', 'err'); return; }
  if (!(qty > 0)) { toast('الكمية غير صحيحة', 'err'); return; }
  pc.lines.push({ key: 'c' + Date.now() + (pc.cu++), id: null, name, price: r2(price), base: null, qty: r2(qty) });
  savePos(); renderPosCart(); closeMo('moCustom'); $('posSearch').focus();
});

// إتمام البيع
async function posPay() {
  if (pc.busy || !pc.lines.length) return;
  const sub = posSub(), disc = posDisc(sub), tot = r2(sub - disc), cash = pc.pay === 'cash';
  const rv = $('posRecv').value.trim(), recv = rv === '' ? null : Number(rv);
  if (cash && recv != null && recv < tot) { toast('المبلغ المستلم أقل من الإجمالي', 'err'); return; }
  const items = pc.lines.map(l => l.id != null
    ? (l.base !== null && l.price !== l.base ? { id: l.id, qty: l.qty, price: l.price } : { id: l.id, qty: l.qty })
    : { name: l.name, qty: l.qty, price: l.price });
  pc.busy = true; posTotals();
  const { data, error } = await sb.rpc('mk_pos_sale', {
    p_items: items, p_discount: disc, p_payment: pc.pay, p_received: cash ? recv : null,
    p_name: $('posName').value.trim() || null, p_phone: $('posPhone').value.trim() || null, p_notes: null,
  });
  pc.busy = false;
  if (error) {
    console.error('pos sale', error);
    const m = String(error.message || '');
    toast(/does not exist|permission denied|schema cache/i.test(m) ? 'شغّل ملف pos-setup.sql في Supabase أولاً' : (m || 'تعذر إتمام البيع'), 'err', 5000);
    posTotals(); return;
  }
  const chg = Number(data.change) || 0;
  posReset();
  toast(cash && chg > 0 ? `تم البيع — الباقي ${EGP(chg)}` : 'تم البيع', 'ok', 4000);
  reloadProducts();
  await loadPos();
  showInvoice(data.id);
}
$('posPay').addEventListener('click', posPay);

// مبيعات اليوم
async function loadPos() {
  const { data, error } = await sb.from('mk_orders').select('*').eq('source', 'pos').eq('order_date', todayStr()).order('id', { ascending: false }).limit(300);
  if (error) { posSales = []; $('posSales').innerHTML = '<div class="pos-empty">لتفعيل الكاشير شغّل ملف pos-setup.sql في Supabase</div>'; $('posSalesSum').textContent = ''; return; }
  posSales = data || []; renderPosSales();
}
function renderPosSales() {
  const ok = posSales.filter(o => o.status !== 'cancelled');
  const tot = ok.reduce((t, o) => t + Number(o.total), 0), cash = ok.filter(o => o.payment_method === 'cash').reduce((t, o) => t + Number(o.total), 0);
  $('posSalesSum').textContent = ok.length ? `· ${ok.length} عملية · ${EGP(tot)} (نقدي ${EGP(cash)})` : '';
  $('posSales').innerHTML = posSales.length ? `<table class="tbl"><thead><tr><th>#</th><th>الوقت</th><th>الأصناف</th><th>الدفع</th><th>الإجمالي</th><th></th></tr></thead><tbody>${
    posSales.map(o => `<tr class="${o.status === 'cancelled' ? 'sale-x' : ''}"><td>${o.order_no}</td><td>${tm(o.created_at)}</td><td>${(o.items || []).reduce((n, i) => n + Number(i.qty), 0)}</td><td>${PAYN[o.payment_method] || ''}</td><td class="gold">${EGP(o.total)}</td>
      <td class="r"><button class="btn btn-line btn-sm" onclick="showInvoice(${o.id})">إيصال</button>${o.status === 'cancelled' ? ' <span class="mut">ملغي</span>' : ` <button class="btn btn-red btn-sm" onclick="voidSale(${o.id})">إلغاء</button>`}</td></tr>`).join('')}</tbody></table>`
    : '<div class="pos-empty">لا توجد مبيعات اليوم</div>';
}
window.voidSale = async id => {
  if (!confirm('إلغاء عملية البيع دي؟ مش هتتحسب في التقارير.')) return;
  const { error } = await sb.from('mk_orders').update({ status: 'cancelled' }).eq('id', id);
  if (error) { toast('تعذر الإلغاء', 'err'); return; }
  toast('تم إلغاء العملية', 'ok'); loadPos();
};

// اختصارات
document.addEventListener('keydown', e => {
  if (!$('tab-pos').classList.contains('on') || document.querySelector('.mo.open')) return;
  if (e.key === 'F9') { e.preventDefault(); posPay(); }
  else if (e.key === 'F2') { e.preventDefault(); $('posSearch').focus(); }
});

/* ══ REPORTS ══ */
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function setRange(r) {
  const t = todayStr();
  const [f, to] = r === 'yest' ? [addDays(t, -1), addDays(t, -1)] : r === 'week' ? [addDays(t, -6), t] : r === 'month' ? [t.slice(0, 8) + '01', t] : [t, t];
  $('rpFrom').value = f; $('rpTo').value = to;
  $('rpQuick').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.r === r));
}
let rpText = '';
async function runReport() {
  const f = $('rpFrom').value, t = $('rpTo').value;
  if (!f || !t || f > t) { toast('اختار فترة صحيحة', 'err'); return; }
  $('rpOut').innerHTML = '<div class="pos-empty">جاري التحميل...</div>';
  const { data, error } = await fetchAll(() => sb.from('mk_orders').select('*').gte('order_date', f).lte('order_date', t).order('id'));
  if (error) { console.error(error); $('rpOut').innerHTML = '<div class="pos-empty">تعذر تحميل التقرير</div>'; return; }
  const ok = data.filter(o => o.status !== 'cancelled'), canc = data.length - ok.length;
  const sum = (a, k = 'total') => a.reduce((x, o) => x + Number(o[k] || 0), 0);
  const total = sum(ok), n = ok.length;
  const pos = ok.filter(isPos), onl = ok.filter(o => !isPos(o));
  const by = (a, fn) => { const m = {}; a.forEach(o => { const k = fn(o); (m[k] = m[k] || []).push(o); }); return m; };
  const pay = by(ok, o => o.payment_method), cashiers = by(pos, o => o.cashier || 'غير معروف'), days = by(ok, o => o.order_date);
  const unpaid = sum(ok.filter(o => o.payment_status !== 'paid'));
  const drawer = sum(ok.filter(o => o.payment_method === 'cash' && o.payment_status === 'paid'));
  const items = {};
  ok.forEach(o => (o.items || []).forEach(i => { const m = items[i.name] = items[i.name] || { q: 0, s: 0 }; m.q += Number(i.qty); m.s += Number(i.price) * Number(i.qty); }));
  const top = Object.entries(items).sort((a, b) => b[1].s - a[1].s).slice(0, 15);
  const tbl = (head, rows) => `<div class="tbl-w"><table class="tbl"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $('rpOut').innerHTML = `<div class="rp-g">${stat('إجمالي المبيعات', EGP(total))}${stat('عدد الفواتير', n)}${stat('متوسط الفاتورة', EGP(n ? total / n : 0))}${stat('إجمالي الخصومات', EGP(sum(ok, 'discount')))}${stat('نقدي في الدرج', EGP(drawer))}${stat('غير محصّل', EGP(unpaid))}${stat('ملغي', canc)}</div>
    <div class="rp-t"><h3>حسب القناة</h3>${tbl(['القناة', 'عدد', 'المبلغ'], [['الكاشير', pos.length, EGP(sum(pos))], ['الأونلاين', onl.length, EGP(sum(onl))]])}</div>
    <div class="rp-t"><h3>حسب طريقة الدفع</h3>${tbl(['الطريقة', 'عدد', 'المبلغ'], Object.entries(pay).map(([k, a]) => [PAYN[k] || k, a.length, EGP(sum(a))]))}</div>
    ${pos.length ? `<div class="rp-t"><h3>حسب الكاشير</h3>${tbl(['الكاشير', 'عدد', 'المبلغ'], Object.entries(cashiers).map(([k, a]) => [esc(k), a.length, EGP(sum(a))]))}</div>` : ''}
    ${Object.keys(days).length > 1 ? `<div class="rp-t"><h3>حسب اليوم</h3>${tbl(['اليوم', 'عدد', 'المبلغ'], Object.entries(days).sort().map(([k, a]) => [k, a.length, EGP(sum(a))]))}</div>` : ''}
    <div class="rp-t"><h3>الأكثر مبيعاً</h3>${top.length ? tbl(['الصنف', 'الكمية', 'المبلغ'], top.map(([k, v]) => [esc(k), v.q, EGP(v.s)])) : '<div class="mut">لا توجد بيانات</div>'}</div>`;
  rpText = [`تقرير ${settings.shop_name || 'المتجر'}`, f === t ? f : `من ${f} إلى ${t}`, '',
    `إجمالي المبيعات: ${EGP(total)}`, `عدد الفواتير: ${n}`, `متوسط الفاتورة: ${EGP(n ? total / n : 0)}`, `الخصومات: ${EGP(sum(ok, 'discount'))}`,
    `الكاشير: ${EGP(sum(pos))} (${pos.length})`, `الأونلاين: ${EGP(sum(onl))} (${onl.length})`, '',
    ...Object.entries(pay).map(([k, a]) => `${PAYN[k] || k}: ${EGP(sum(a))} (${a.length})`), `نقدي في الدرج: ${EGP(drawer)}`, `غير محصّل: ${EGP(unpaid)}`, `ملغي: ${canc}`].join('\n');
}
$('rpQuick').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) { setRange(b.dataset.r); runReport(); } });
$('rpGo').addEventListener('click', () => { $('rpQuick').querySelectorAll('.chip').forEach(c => c.classList.remove('on')); runReport(); });
$('rpCopy').addEventListener('click', async () => {
  if (!rpText) { toast('اعرض التقرير الأول', 'err'); return; }
  try { await navigator.clipboard.writeText(rpText); toast('تم نسخ التقرير', 'ok'); } catch (e) { toast('تعذر النسخ', 'err'); }
});
setRange('today');
document.querySelectorAll('.nav[data-tab]').forEach(btn => btn.addEventListener('click', () => {
  if (btn.dataset.tab === 'pos' || btn.dataset.tab === 'products') reloadProducts();
  if (btn.dataset.tab === 'pos') { loadPos(); setTimeout(() => $('posSearch').focus(), 50); }
  if (btn.dataset.tab === 'reports') runReport();
}));
