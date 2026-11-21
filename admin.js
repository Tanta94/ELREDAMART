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
let cats = [], prods = [], offs = [], orders = [], settings = {};
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
    sb.from('mk_products').select('*').order('sort').order('id'),
    sb.from('mk_offers').select('*').order('sort').order('id'),
    sb.from('mk_settings').select('*'),
  ]);
  if (c.error || p.error) { console.error('load error', c.error || p.error); toast('تعذر تحميل البيانات، يرجى إعادة المحاولة', 'err', 5000); return; }
  cats = c.data || []; prods = p.data || []; offs = o.data || [];
  settings = Object.fromEntries((s.data || []).map(r => [r.key, r.value]));
  $('admName').textContent = settings.shop_name || 'المتجر'; applyBrand();
  renderLists(); renderSettings();
  await loadOrders(true);
}
async function start() {
  if (started) return; started = true;
  await loadAll();
  timer = setInterval(() => loadOrders(false), 10000);
}

/* ══ ORDERS ══ */
async function loadOrders(initial) {
  const { data, error } = await sb.from('mk_orders').select('*').order('id', { ascending: false }).limit(300);
  if (error) { console.error('orders error', error); if (initial) toast('تعذر تحميل الطلبات', 'err'); return; }
  orders = data || [];
  const max = orders.reduce((m, o) => Math.max(m, o.id), 0);
  if (knownMax !== null && orders.some(o => o.id > knownMax && o.status === 'new')) {
    beep(); toast('وصل طلب جديد', 'ok', 4000);
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
      <div class="tl"><span>التوصيل</span><span>${o.delivery_fee > 0 ? EGP(o.delivery_fee) : 'مجاني'}</span></div>
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
const payPlain = o => o.payment_method === 'wallet'
  ? `محفظة إلكترونية${o.payment_status === 'paid' ? ' (تم الدفع)' : ' (لم يتم تأكيد الدفع)'}`
  : `نقداً عند الاستلام${o.payment_status === 'paid' ? ' (تم التحصيل)' : ''}`;
function invoiceHtml(o) {
  const shop = settings.shop_name || 'المتجر';
  const wa = (settings.whatsapp || '').replace(/\D/g, '');
  return `<div class="inv-head">
      <div>${settings.logo_url ? `<img src="${esc(settings.logo_url)}" alt="" style="max-height:48px;max-width:130px;display:block;margin-bottom:6px"/>` : ''}<h2>${esc(shop)}</h2>${wa ? `<div style="font-size:.84rem;direction:ltr;text-align:right">+${wa}</div>` : ''}</div>
      <div class="inv-meta"><b>فاتورة رقم #${o.order_no}</b><br>${fullDate(o.created_at)}</div>
    </div>
    <div class="inv-cust"><b>العميل:</b> ${esc(o.customer_name)}\n<b>الهاتف:</b> <span dir="ltr">${esc(o.customer_phone)}</span>\n<b>العنوان:</b> ${esc(o.address)}</div>
    <table class="inv-t"><tr><th>#</th><th>الصنف</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th></tr>
      ${(o.items || []).map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td>${EGP(i.price)}</td><td>${i.qty}</td><td>${EGP(i.price * i.qty)}</td></tr>`).join('')}</table>
    <div class="inv-tot">
      <div><span>المنتجات</span><span>${EGP(o.subtotal)}</span></div>
      <div><span>التوصيل</span><span>${o.delivery_fee > 0 ? EGP(o.delivery_fee) : 'مجاني'}</span></div>
      <div class="g"><span>الإجمالي</span><span>${EGP(o.total)}</span></div>
    </div>
    <div class="inv-pay"><b>طريقة الدفع:</b> ${payPlain(o)}</div>
    <div class="inv-foot">شكراً لتعاملكم معنا</div>`;
}
function invText(o) {
  const shop = settings.shop_name || 'المتجر';
  return [
    `فاتورة طلب #${o.order_no} - ${shop}`, `التاريخ: ${fullDate(o.created_at)}`, '',
    `العميل: ${o.customer_name}`, `الهاتف: ${o.customer_phone}`, `العنوان: ${o.address}`,
    o.lat != null ? `الموقع: https://www.google.com/maps?q=${o.lat},${o.lng}` : null, '',
    'الطلب:', ...(o.items || []).map(i => `${i.qty} × ${i.name} = ${EGP(i.price * i.qty)}`), '',
    `المنتجات: ${EGP(o.subtotal)}`, `التوصيل: ${o.delivery_fee > 0 ? EGP(o.delivery_fee) : 'مجاني'}`,
    `الإجمالي: ${EGP(o.total)}`, `الدفع: ${payPlain(o)}`, '', 'شكراً لطلبكم',
  ].filter(x => x !== null).join('\n');
}
window.showInvoice = id => {
  const o = orders.find(x => x.id === id); if (!o) return;
  curInv = o; $('invoice').innerHTML = invoiceHtml(o); openMo('moInv');
};
async function invFile(o) {
  if (!window.html2canvas) return null;
  const canvas = await window.html2canvas($('invoice'), { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return blob ? new File([blob], `invoice-${o.order_no}.png`, { type: 'image/png' }) : null;
}
$('invPrint').addEventListener('click', () => window.print());
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

const CFG = {
  products: {
    label: 'منتج',
    fields: [['name', 'اسم المنتج', 'text', 1], ['category_id', 'القسم', 'cat'], ['description', 'الوصف', 'text'], ['price', 'السعر (جنيه)', 'number', 1], ['old_price', 'السعر قبل الخصم (اختياري)', 'number'], ['image_url', 'صورة المنتج', 'image'], ['sort', 'الترتيب', 'number']],
    head: ['', 'المنتج', 'السعر', 'متاح', 'ظاهر', ''],
    row: r => `<td>${thumb(r.image_url)}</td><td><b>${esc(r.name)}</b><div class="mut">${esc(catName(r.category_id))}</div></td><td class="gold">${EGP(r.price)}${r.old_price ? ` <s class="mut">${EGP(r.old_price)}</s>` : ''}</td><td>${tog('products', r.id, 'available', r.available)}</td><td>${tog('products', r.id, 'active', r.active)}</td>${actions('products', r.id)}`,
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
    const list = DATA()[key], cfg = CFG[key];
    $('list-' + key).innerHTML = `<table class="tbl"><thead><tr>${cfg.head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
      list.length ? list.map(r => `<tr>${cfg.row(r)}</tr>`).join('')
        : `<tr><td colspan="${cfg.head.length}" style="text-align:center;padding:30px;color:var(--ink3)">لا يوجد، أضف أول ${cfg.label}</td></tr>`}</tbody></table>`;
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
  $('setFee').value = settings.delivery_fee ?? 0;
  $('setMin').value = settings.min_order ?? 0;
  $('setFree').value = settings.free_over ?? 0;
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
const num = id => String(Math.max(0, Number($(id).value) || 0));
$('btnSaveSet').addEventListener('click', async () => {
  const rows = [
    { key: 'shop_name', value: $('setName').value.trim() || 'المتجر' },
    { key: 'whatsapp', value: $('setWa').value.trim() },
    { key: 'accepting', value: $('setAcc').checked ? 'true' : 'false' },
    { key: 'delivery_fee', value: num('setFee') },
    { key: 'min_order', value: num('setMin') },
    { key: 'free_over', value: num('setFree') },
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
