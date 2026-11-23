/* ═══════════════════════════════════════
   ONLINE MARKET — store.js (customer page)
═══════════════════════════════════════ */
const SB_URL = 'https://znminmjaiprdgwjdxirj.supabase.co';
const SB_KEY = 'sb_publishable_CVcKNac97IpfUu7k1PETkQ_GBJ_S0iY';
const sb = supabase.createClient(SB_URL, SB_KEY);

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EGP = v => `${Number(v).toLocaleString('ar-EG')} جنيه`;
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
const STATUS = { new: 'تم استلام الطلب', preparing: 'قيد التحضير', delivering: 'في الطريق إليك', delivered: 'تم التسليم', cancelled: 'ملغي' };
const STEPS = ['new', 'preparing', 'delivering', 'delivered'];
const tm = s => new Date(s).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });

function toast(msg, type = '', ms = 3200) {
  const t = document.createElement('div');
  t.className = 'tst' + (type ? ' ' + type : '');
  t.textContent = msg;
  $('tc').appendChild(t);
  setTimeout(() => { t.classList.add('hid'); setTimeout(() => t.remove(), 300); }, ms);
}
window.closeMo = id => $(id).classList.remove('open');
const openMo = id => $(id).classList.add('open');
document.addEventListener('click', e => { if (e.target.classList.contains('mo')) e.target.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.mo.open').forEach(m => m.classList.remove('open')); });

/* ── State ── */
let categories = [], products = [], offers = [], settings = {};
let cart = {};                       // "product:5" -> { type, id, qty }
let activeCat = 'all', query = '';
let geo = null, payMethod = 'cash';

const getItem = (type, id) => type === 'offer' ? offers.find(x => x.id === id) : products.find(x => x.id === id);
const itemName = it => it.title || it.name;
const isAvail = (type, it) => type === 'offer' ? true : it.available;

/* ══ LOAD ══ */
// الخادم بيرجّع 1000 صف بس في المرة، فنقرا المنتجات على دفعات
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
async function loadAll() {
  const [c, p, o, s] = await Promise.all([
    sb.from('mk_categories').select('*').eq('active', true).order('sort').order('id'),
    fetchAll(() => sb.from('mk_products').select('*').eq('active', true).order('sort').order('id')),
    sb.from('mk_offers').select('*').eq('active', true).order('sort').order('id'),
    sb.from('mk_settings').select('*'),
  ]);
  if (c.error || p.error) {
    console.error('load error', c.error || p.error);
    $('prods').innerHTML = '<div class="empty">الخدمة غير متاحة حالياً.<br>يرجى المحاولة بعد قليل أو التواصل معنا مباشرة.</div>';
    return;
  }
  categories = c.data || []; products = p.data || []; offers = o.data || [];
  settings = Object.fromEntries((s.data || []).map(r => [r.key, r.value]));
  applySettings();
  loadCart();
  renderAll();
  if (!tourSeen('mk_tour_main') && products.length) setTimeout(mainTour, 700);
}

function applyBrand() {
  const raw = settings.brand_color || '';
  if (!/^#[0-9a-f]{6}$/i.test(raw)) return;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(raw.slice(i, i + 2), 16));
  const root = document.documentElement.style;
  root.setProperty('--acc', raw);
  root.setProperty('--acc-d', `rgb(${Math.round(r * .85)},${Math.round(g * .85)},${Math.round(b * .85)})`);
  root.setProperty('--acc-bg', `rgba(${r},${g},${b},.1)`);
}

function applySettings() {
  applyBrand();
  const n = settings.shop_name || 'المتجر';
  $('shopName').textContent = n; $('shopName2').textContent = n; document.title = n;
  if (settings.logo_url) { $('logoImg').src = settings.logo_url; $('logoImg').classList.remove('hide'); }
  else $('logoImg').classList.add('hide');
  $('closedBanner').style.display = settings.accepting === 'false' ? 'block' : 'none';
  const wa = (settings.whatsapp || '').replace(/\D/g, '');
  $('waLink').classList.toggle('hide', !wa);
  if (wa) { $('waLink').href = 'https://wa.me/' + wa; $('fWa').href = 'https://wa.me/' + wa; $('fWa').textContent = '+' + wa; }
  $('fWaRow').classList.toggle('hide', !wa);
  $('walletName').textContent = settings.wallet_name || 'المحفظة';
  $('walletNum').textContent = settings.wallet_number || '';
}

function renderAll() { renderChips(); renderOffers(); renderProducts(); renderBar(); if ($('moCart').classList.contains('open')) renderCart(); }

/* ══ RENDER ══ */
function renderChips() {
  const used = new Set(products.map(p => p.category_id));
  const cats = categories.filter(c => used.has(c.id));
  $('chips').innerHTML = [`<button class="chip ${activeCat === 'all' ? 'on' : ''}" data-c="all">الكل</button>`]
    .concat(cats.map(c => `<button class="chip ${activeCat === c.id ? 'on' : ''}" data-c="${c.id}">${esc(c.name)}</button>`)).join('');
}

function ctrl(type, id, avail) {
  if (!avail) return '<span class="na">غير متاح</span>';
  const qty = (cart[`${type}:${id}`] || {}).qty || 0;
  return qty
    ? `<div class="step"><button onclick="chg('${type}',${id},1)">+</button><span>${qty}</span><button onclick="chg('${type}',${id},-1)">−</button></div>`
    : `<button class="btn btn-gold btn-sm" onclick="chg('${type}',${id},1)">إضافة</button>`;
}
const priceBlock = it => `<div class="pc-price">${EGP(it.price)}${it.old_price && Number(it.old_price) > Number(it.price) ? `<span class="old">${EGP(it.old_price)}</span>` : ''}</div>`;
const discTag = it => it.old_price && Number(it.old_price) > Number(it.price) ? `<span class="tag">خصم ${Math.round((1 - it.price / it.old_price) * 100)}%</span>` : '';
const imgHtml = (it, alt) => it.image_url ? `<img src="${esc(it.image_url)}" alt="${esc(alt)}" loading="lazy"/>` : '<span>بدون صورة</span>';

function renderOffers() {
  $('offersSec').classList.toggle('hide', !offers.length);
  $('offers').innerHTML = offers.map(o => `<div class="of-card">
    <div class="of-img">${imgHtml(o, o.title)}${discTag(o)}</div>
    <div class="pc-body"><div class="pc-name">${esc(o.title)}</div><div class="pc-desc">${esc(o.description || '')}</div>
      <div class="pc-row">${priceBlock(o)}${ctrl('offer', o.id, true)}</div></div></div>`).join('');
}

function renderProducts() {
  const q = query.trim().toLowerCase();
  const list = products.filter(p => (activeCat === 'all' || p.category_id === activeCat)
    && (!q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)));
  const cat = categories.find(c => c.id === activeCat);
  $('prodTitle').textContent = q ? 'نتائج البحث' : cat ? cat.name : 'المنتجات';
  $('prods').innerHTML = list.length ? list.map(p => `<div class="pc">
    <div class="pc-img">${imgHtml(p, p.name)}${discTag(p)}</div>
    <div class="pc-body"><div class="pc-name">${esc(p.name)}</div><div class="pc-desc">${esc(p.description || '')}</div>
      <div class="pc-row">${priceBlock(p)}${ctrl('product', p.id, p.available)}</div></div></div>`).join('')
    : '<div class="empty">لا توجد منتجات</div>';
}

$('chips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  activeCat = b.dataset.c === 'all' ? 'all' : Number(b.dataset.c);
  renderChips(); renderProducts();
});
$('search').addEventListener('input', e => { query = e.target.value; renderProducts(); });

/* ══ CART ══ */
function saveCart() { ls.set('mk_cart', JSON.stringify(cart)); }
function loadCart() {
  let saved = {};
  try { saved = JSON.parse(ls.get('mk_cart') || '{}') || {}; } catch (e) {}
  cart = {};
  for (const [k, c] of Object.entries(saved)) {
    const it = c && getItem(c.type, c.id);
    if (it && isAvail(c.type, it) && c.qty > 0) cart[k] = { type: c.type, id: c.id, qty: Math.min(50, c.qty) };
  }
  saveCart();
}
window.chg = (type, id, d) => {
  const k = `${type}:${id}`, cur = cart[k] ? cart[k].qty : 0, n = Math.min(50, cur + d);
  if (n <= 0) delete cart[k]; else cart[k] = { type, id, qty: n };
  saveCart(); renderOffers(); renderProducts(); renderBar();
  if ($('moCart').classList.contains('open')) renderCart();
};
function totals() {
  let sub = 0, count = 0;
  Object.values(cart).forEach(c => { const it = getItem(c.type, c.id); if (it) { sub += Number(it.price) * c.qty; count += c.qty; } });
  const base = Number(settings.delivery_fee) || 0, free = Number(settings.free_over) || 0, min = Number(settings.min_order) || 0;
  const fee = count && !(free > 0 && sub >= free) ? base : 0;
  return { sub, count, fee, total: sub + fee, min };
}
function renderBar() {
  const t = totals();
  $('cartCount').textContent = t.count;
  $('cartBar').classList.toggle('hide', !t.count);
  $('barCount').textContent = t.count;
  $('barTotal').textContent = EGP(t.sub);
}

function renderCart() {
  const t = totals();
  const rows = Object.values(cart).map(c => ({ c, it: getItem(c.type, c.id) })).filter(x => x.it);
  $('cartItems').innerHTML = rows.length ? rows.map(({ c, it }) => `<div class="ci">
      <div class="avatar" style="width:44px;height:44px">${it.image_url ? `<img src="${esc(it.image_url)}" alt=""/>` : ''}</div>
      <div class="ci-info"><div class="ci-name">${esc(itemName(it))}</div><div class="ci-price">${EGP(it.price)} × ${c.qty} = ${EGP(it.price * c.qty)}</div></div>
      <div class="step"><button onclick="chg('${c.type}',${c.id},1)">+</button><span>${c.qty}</span><button onclick="chg('${c.type}',${c.id},-1)">−</button></div></div>`).join('')
    : '<div class="empty">السلة فارغة</div>';
  $('sSub').textContent = EGP(t.sub);
  $('sFee').textContent = !t.count ? '—' : t.fee ? EGP(t.fee) : 'مجاني';
  $('sTot').textContent = EGP(t.total);
  $('wAmt').textContent = EGP(t.total);
  const short = t.count && t.sub < t.min;
  $('minWarn').classList.toggle('hide', !short);
  if (short) $('minWarn').textContent = `الحد الأدنى للطلب ${EGP(t.min)}، أضف منتجات بقيمة ${EGP(t.min - t.sub)} لإتمام الطلب.`;
  $('placeBtn').disabled = !t.count || short || settings.accepting === 'false';
  renderPay();
}

function payOptions() {
  const o = [];
  if (settings.cash_enabled !== 'false') o.push({ k: 'cash', t: 'الدفع نقداً عند الاستلام' });
  if (settings.wallet_enabled !== 'false' && settings.wallet_number) o.push({ k: 'wallet', t: `الدفع بالمحفظة (${settings.wallet_name || 'محفظة إلكترونية'})` });
  return o;
}
function renderPay() {
  const opts = payOptions();
  if (!opts.some(o => o.k === payMethod)) payMethod = opts.length ? opts[0].k : 'cash';
  $('payOpts').innerHTML = opts.map(o => `<label class="opt ${payMethod === o.k ? 'on' : ''}"><input type="radio" name="pay" value="${o.k}" ${payMethod === o.k ? 'checked' : ''}/>${esc(o.t)}</label>`).join('')
    || '<div class="warn">لا توجد وسيلة دفع متاحة حالياً.</div>';
  $('walletBox').classList.toggle('hide', payMethod !== 'wallet');
}
$('payOpts').addEventListener('change', e => { if (e.target.name === 'pay') { payMethod = e.target.value; renderPay(); } });
$('copyNum').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(settings.wallet_number || ''); toast('تم نسخ الرقم', 'ok'); }
  catch (e) { toast('انسخ الرقم يدوياً'); }
});

function openCart() {
  $('cName').value = $('cName').value || ls.get('mk_name') || '';
  $('cPhone').value = $('cPhone').value || ls.get('mk_phone') || '';
  $('cAddr').value = $('cAddr').value || ls.get('mk_addr') || '';
  renderCart(); openMo('moCart'); cartTour();
}
$('cartBtn').addEventListener('click', openCart);
$('barBtn').addEventListener('click', openCart);

/* ── Location ── */
const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|MicroMessenger|TikTok|; wv\)/i.test(navigator.userAgent || '');
function showGeo() {
  $('locState').innerHTML = geo
    ? `تم تحديد موقعك · <a href="https://www.google.com/maps?q=${geo.lat},${geo.lng}" target="_blank" rel="noopener">عرض على الخريطة</a> · <a href="#" id="locClear">إزالة</a>`
    : 'لم يتم تحديد الموقع (اختياري)';
}
$('locState').addEventListener('click', e => { if (e.target.id === 'locClear') { e.preventDefault(); geo = null; showGeo(); } });
function locHelp(msg) {
  $('locHelp').textContent = msg; $('locHelp').classList.remove('hide');
  $('mapLinkRow').classList.remove('hide');
}
const getPos = opts => new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, opts));
$('locBtn').addEventListener('click', async () => {
  $('locHelp').classList.add('hide');
  if (!navigator.geolocation) { locHelp('هذا المتصفح لا يدعم تحديد الموقع. اكتب عنوانك أو الصق رابط موقعك من خرائط جوجل.'); return; }
  if (window.isSecureContext === false) { locHelp('تحديد الموقع يعمل فقط على رابط آمن (https). افتح الرابط الرسمي للمتجر.'); return; }
  $('locBtn').disabled = true; $('locState').textContent = 'جاري تحديد الموقع...';
  let pos = null, err = null;
  try { pos = await getPos({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }); }
  catch (e) {
    err = e;
    // لو المشكلة مش رفض إذن (GPS ضعيف أو انتهت المهلة) نجرب بدقة أقل
    if (e && e.code !== 1) {
      try { pos = await getPos({ enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 }); err = null; } catch (e2) { err = e2; }
    }
  }
  $('locBtn').disabled = false;
  if (pos) { geo = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) }; showGeo(); return; }
  showGeo();
  const code = err && err.code;
  if (code === 1) {
    locHelp(inApp
      ? 'يبدو أنك فتحت الصفحة من داخل تطبيق (واتساب أو فيسبوك أو انستجرام) وهو لا يسمح بتحديد الموقع. افتح الرابط من متصفح Chrome أو Safari. أو الصق رابط موقعك من خرائط جوجل بالأسفل.'
      : 'إذن الموقع غير مفعّل لهذا الموقع. اضغط على أيقونة القفل بجوار الرابط ثم الأذونات ثم الموقع ثم سماح، وأعد المحاولة. على الآيفون: الإعدادات ثم الخصوصية ثم خدمات الموقع ثم Safari. أو الصق رابط موقعك من خرائط جوجل بالأسفل.');
  } else if (code === 3) {
    locHelp('انتهت مهلة تحديد الموقع. تأكد من تشغيل GPS وأعد المحاولة، أو الصق رابط موقعك من خرائط جوجل.');
  } else {
    locHelp('تعذر تحديد موقعك. تأكد من تشغيل GPS وأعد المحاولة، أو الصق رابط موقعك من خرائط جوجل.');
  }
});

/* ══ PLACE ORDER ══ */
$('placeBtn').addEventListener('click', async () => {
  const t = totals(); if (!t.count) return;
  const name = $('cName').value.trim();
  const phone = $('cPhone').value.replace(/[\s-]/g, '');
  let addr = $('cAddr').value.trim();
  const ref = $('walletRef').value.replace(/[\s-]/g, '');
  if (!name) { toast('أدخل الاسم', 'err'); $('cName').focus(); return; }
  if (!/^\+?\d{10,14}$/.test(phone)) { toast('رقم الهاتف غير صحيح', 'err'); $('cPhone').focus(); return; }
  const link = $('mapLink').value.trim();
  const okLink = /^https?:\/\/\S+$/i.test(link) && link.length < 400;
  if (link && !okLink) { toast('رابط الموقع غير صحيح', 'err'); $('mapLink').focus(); return; }
  if (!addr && (geo || okLink)) addr = geo ? 'الموقع المحدد على الخريطة' : 'الموقع على الرابط المرفق';
  if (!addr) { toast('أدخل العنوان أو حدد موقعك', 'err'); $('cAddr').focus(); return; }
  if (okLink && !geo) addr += `\nرابط الموقع: ${link}`;
  if (payMethod === 'wallet' && !/^\+?\d{10,14}$/.test(ref)) { toast('أدخل رقم المحفظة المحوَّل منها', 'err'); $('walletRef').focus(); return; }

  const items = Object.values(cart).filter(c => getItem(c.type, c.id)).map(({ type, id, qty }) => ({ type, id, qty }));
  const btn = $('placeBtn'); btn.disabled = true; btn.textContent = 'جاري إرسال الطلب...';
  const { data, error } = await sb.rpc('mk_create_order', {
    p_name: name, p_phone: phone, p_address: addr,
    p_lat: geo ? geo.lat : null, p_lng: geo ? geo.lng : null,
    p_notes: $('cNotes').value.trim() || null,
    p_payment: payMethod, p_wallet_ref: payMethod === 'wallet' ? ref : null,
    p_items: items,
  });
  btn.textContent = 'تأكيد الطلب';
  if (error) {
    console.error('order error', error);
    toast(error.code === 'P0001' ? error.message : 'حدث خطأ، حاول مرة أخرى', 'err', 5000);
    renderCart(); return;
  }

  ls.set('mk_name', name); ls.set('mk_phone', phone); ls.set('mk_addr', $('cAddr').value.trim());
  cart = {}; saveCart(); $('cNotes').value = ''; $('walletRef').value = ''; $('mapLink').value = '';
  closeMo('moCart'); renderOffers(); renderProducts(); renderBar();

  $('dNo').textContent = `#${data.order_no}`;
  $('dInfo').innerHTML = `المنتجات: ${EGP(data.subtotal)}<br>التوصيل: ${data.delivery_fee > 0 ? EGP(data.delivery_fee) : 'مجاني'}<br><b>الإجمالي: ${EGP(data.total)}</b><br>`
    + (data.payment_method === 'wallet' ? 'الدفع: بالمحفظة (بانتظار تأكيد المتجر)' : 'الدفع: نقداً عند الاستلام');
  $('trkPhone').value = phone;
  openMo('moDone');
});

/* ══ TRACK ══ */
let trkTimer = null;
function openTrack() {
  if (!$('trkPhone').value) $('trkPhone').value = ls.get('mk_phone') || '';
  openMo('moTrack');
  if ($('trkPhone').value) track();
}
$('trackBtn').addEventListener('click', openTrack);
$('helpBtn').addEventListener('click', mainTour);
$('dTrack').addEventListener('click', () => { closeMo('moDone'); openTrack(); });
$('trkGo').addEventListener('click', track);
$('trkPhone').addEventListener('keydown', e => { if (e.key === 'Enter') track(); });

async function track() {
  const phone = $('trkPhone').value.replace(/[\s-]/g, '');
  if (!phone) return;
  const { data, error } = await sb.rpc('mk_track_orders', { p_phone: phone });
  if (error) { toast('تعذر جلب الطلبات', 'err'); return; }
  ls.set('mk_phone', phone);
  $('trkList').innerHTML = data.length ? data.map(o => {
    const idx = STEPS.indexOf(o.status);
    const pay = o.payment_method === 'wallet' ? (o.payment_status === 'paid' ? 'محفظة · تم تأكيد الدفع' : 'محفظة · بانتظار تأكيد الدفع') : 'نقداً عند الاستلام';
    return `<div class="trk">
      <div class="trk-top"><b>طلب #${o.order_no} <span class="mut">${tm(o.created_at)}</span></b><span class="st ${o.status}">${STATUS[o.status]}</span></div>
      ${o.status === 'cancelled' ? '' : `<div class="steps">${STEPS.map((_, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>`}
      <ul>${(o.items || []).map(i => `<li><span>${i.qty} × ${esc(i.name)}</span><span>${EGP(i.price * i.qty)}</span></li>`).join('')}</ul>
      <div class="mut">التوصيل: ${o.delivery_fee > 0 ? EGP(o.delivery_fee) : 'مجاني'} · ${pay}</div>
      <div style="margin-top:4px"><b>الإجمالي: ${EGP(o.total)}</b></div>
      ${o.status === 'new' ? `<button class="btn btn-red btn-sm" style="margin-top:8px" onclick="cancelOrder(${o.id})">إلغاء الطلب</button>` : ''}
    </div>`;
  }).join('') : '<div class="empty" style="padding:22px 0 6px">لا توجد طلبات حديثة على هذا الرقم</div>';

  clearInterval(trkTimer);
  trkTimer = setInterval(() => { $('moTrack').classList.contains('open') ? track() : clearInterval(trkTimer); }, 20000);
}
window.cancelOrder = async id => {
  if (!confirm('هل تريد إلغاء الطلب؟')) return;
  const { data } = await sb.rpc('mk_cancel_order', { p_id: id, p_phone: $('trkPhone').value.replace(/[\s-]/g, '') });
  toast(data ? 'تم إلغاء الطلب' : 'لا يمكن إلغاء الطلب الآن، تواصل مع المتجر', data ? 'ok' : 'err', 4000);
  track();
};

/* ══ TOUR (شرح الموقع لأول زيارة) ══ */
const tourSeen = k => ls.get(k) === '1';
let tour = null;
function tourStart(name, steps, key) {
  tourEnd(true);
  steps = steps.filter(s => !s.el || document.querySelector(s.el));
  if (!steps.length) return;
  const ov = document.createElement('div'); ov.className = 'tr-ov';
  const hl = document.createElement('div'); hl.className = 'tr-hl';
  const tip = document.createElement('div'); tip.className = 'tr-tip';
  document.body.append(ov, hl, tip);
  tour = { name, steps, key, i: 0, ov, hl, tip };
  tourShow();
}
function tourEnd(silent) {
  if (!tour) return;
  if (!silent && tour.key) ls.set(tour.key, '1');
  tour.ov.remove(); tour.hl.remove(); tour.tip.remove(); tour = null;
}
function tourShow() {
  const t = tour, s = t.steps[t.i], last = t.i === t.steps.length - 1;
  const target = s.el ? document.querySelector(s.el) : null;
  t.tip.innerHTML = `<b>${esc(s.title)}</b><p>${esc(s.text)}</p>
    <div class="tr-foot"><span class="tr-dots">${t.steps.map((_, k) => `<i class="${k === t.i ? 'on' : ''}"></i>`).join('')}</span>
    <span>${last ? '' : '<button class="tr-skip" id="trSkip">تخطي</button>'}<button class="tr-next" id="trNext">${last ? 'تمام' : t.i === 0 && !target ? 'ابدأ' : 'التالي'}</button></span></div>`;
  $('trNext').onclick = () => { if (last) tourEnd(); else { t.i++; tourShow(); } };
  const sk = $('trSkip'); if (sk) sk.onclick = () => tourEnd();
  t.tip.style.visibility = 'hidden';
  if (target) target.scrollIntoView({ block: 'center', behavior: 'auto' });
  setTimeout(() => tourPlace(), 60);
}
function tourPlace() {
  if (!tour) return;
  const t = tour, s = t.steps[t.i], target = s.el ? document.querySelector(s.el) : null;
  const vw = window.innerWidth, vh = window.innerHeight, tw = Math.min(300, vw - 24);
  t.tip.style.width = tw + 'px';
  const th = t.tip.offsetHeight;
  if (!target) {
    t.hl.style.display = 'none'; t.ov.classList.add('dark');
    t.tip.style.left = (vw - tw) / 2 + 'px'; t.tip.style.top = Math.max(12, (vh - th) / 2) + 'px';
  } else {
    t.ov.classList.remove('dark');
    const r = target.getBoundingClientRect(), pad = 6;
    Object.assign(t.hl.style, { display: 'block', top: r.top - pad + 'px', left: r.left - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    let top = r.bottom + 14;
    if (top + th > vh - 10) top = Math.max(10, r.top - th - 14);
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(12, Math.min(left, vw - tw - 12));
    t.tip.style.left = left + 'px'; t.tip.style.top = top + 'px';
  }
  t.tip.style.visibility = 'visible';
}
window.addEventListener('resize', () => tourPlace());
document.addEventListener('keydown', e => { if (e.key === 'Escape') tourEnd(); });

function mainTour() {
  tourStart('main', [
    { title: 'أهلاً بيك في ' + (settings.shop_name || 'المتجر'), text: 'هنعرّفك على الموقع في خطوات سريعة، مش هتاخد أكتر من نص دقيقة.' },
    { el: '#search', title: 'ابحث عن المنتج', text: 'اكتب اسم المنتج هنا ويظهر لك على طول.' },
    { el: '#chips', title: 'اختار القسم', text: 'اضغط على أي قسم عشان تشوف منتجاته بس.' },
    { el: '#offers .of-card, #prods .pc .btn', title: 'أضف للسلة', text: 'اضغط «إضافة» على أي منتج أو عرض، وتقدر تزوّد الكمية بعدها.' },
    { el: '#cartBtn', title: 'سلتك', text: 'من هنا تفتح السلة وتراجع طلبك وتكمل الشراء.' },
  ], 'mk_tour_main');
}
function cartTour() {
  if (tourSeen('mk_tour_cart') || tour) return;
  setTimeout(() => tourStart('cart', [
    { el: '#cName', title: 'بياناتك', text: 'اكتب اسمك ورقم تليفونك وعنوانك بالتفصيل عشان المندوب يوصلك.' },
    { el: '#locBtn', title: 'موقعك', text: 'اضغط هنا ويتحدد موقعك من التليفون، وده اختياري.' },
    { el: '#payOpts', title: 'طريقة الدفع', text: 'اختار تدفع كاش عند الاستلام أو بالمحفظة الإلكترونية.' },
    { el: '#placeBtn', title: 'تأكيد الطلب', text: 'اضغط هنا لما تخلّص، وهيوصلنا طلبك على طول.' },
  ], 'mk_tour_cart'), 350);
}

/* ══ INIT ══ */
document.addEventListener('DOMContentLoaded', () => {
  $('yr').textContent = new Date().getFullYear();
  loadAll();
});
