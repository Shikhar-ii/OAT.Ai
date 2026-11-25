'use strict';

const $ = selector => document.querySelector(selector);
const view = $('#view');
const dialog = $('#dialog');
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = value => Number(value).toLocaleString('en-US',{style:'currency',currency:'USD'});
const qty = n => Number(n).toLocaleString('en-US');
const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
const storageKey = 'oat-inventory-demo-v1';
const shop = 'Oak & Main Market';
const suppliers = {
  'Harvest Supply Co.': {phone:'+12025550101', email:'orders@harvestsupply.example'},
  'Market Pantry Wholesale': {phone:'+12025550102', email:'orders@marketpantry.example'}
};
const item = (id,name,sku,location,count,cost,rate,vendor,kind,shape,color) =>
  ({id,name,sku,location,count,cost,rate,vendor,kind,shape,color,unit:'units'});
const seed = {
  items:[
    item('tonic','Rolled Oats','OAT-1001','A1 · Shelf 02',3,18.5,1.35,'Harvest Supply Co.','Pantry','box','lilac'),
    item('pomade','Wildflower Honey','OAT-1002','A2 · Shelf 01',24,12,1.7,'Market Pantry Wholesale','Pantry','jar','amber'),
    item('blades','Whole Grain Oat Packs','OAT-1003','B1 · Shelf 03',6,9.2,2.1,'Harvest Supply Co.','Pantry','box','blue'),
    item('oil','Extra Virgin Olive Oil','OAT-1004','A2 · Shelf 02',18,11.75,1.1,'Market Pantry Wholesale','Pantry','tube','mint'),
    item('spray','Sea Salt Crackers','OAT-1005','A2 · Shelf 03',2,13.4,.9,'Market Pantry Wholesale','Snacks','box','rose'),
    item('neck','Brown Rice','OAT-1006','B1 · Shelf 01',32,4.5,2.2,'Harvest Supply Co.','Pantry','box','lilac'),
    item('shampoo','Oat Milk','OAT-1007','A1 · Shelf 03',15,8.75,1.5,'Market Pantry Wholesale','Beverages','tube','blue'),
    item('towels','Paper Towels','OAT-1008','B2 · Shelf 02',40,2.9,3,'Harvest Supply Co.','Household','box','mint')
  ],
  prices:[{id:'seed-oil',itemId:'oil',name:'Extra Virgin Olive Oil',vendor:'Market Pantry Wholesale',before:10.75,after:11.75,units:18}],
  received:[],
  flags:[],
  events:[
    {text:'Received 12 Extra Virgin Olive Oil units',detail:'Market Pantry Wholesale · Sample delivery',type:'scan',time:null},
    {text:'Logged 2 Rolled Oats units',detail:'Retail sale · Sample stock update',type:'mic',time:null}
  ]
};
let state;
try { state = JSON.parse(localStorage.getItem(storageKey)) || structuredClone(seed); }
catch { state = structuredClone(seed); }
let filters = {query:'',kind:'all',status:'all'};
let toastTimer;
let lastFocus;
let sourceUrl;
let recognition;
let lastDraft = null;
let bottleScan;
const pageNames = {overview:'Overview',inventory:'Inventory',capture:'Capture & review',reorders:'Insights',activity:'Activity'};
const usageNames = {Internal:'Internal use',Retail:'Retail sale',Receiving:'Receiving'};
const categories = ['Pantry','Snacks','Beverages','Household','Other'];
const page = () => Object.hasOwn(pageNames,location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
const threshold = product => product.minimum ?? Math.ceil(product.rate * 5);
const low = product => product.count === 0 || product.count <= threshold(product);
const orderQuantity = product => Math.max(1,threshold(product)*2 - product.count);
const watched = () => state.items.filter(low);
const priceChange = price => ((price.after / price.before - 1) * 100).toFixed(1);
const available = product => product.count ? qty(product.count) + ' on hand' : 'Out of stock';
const badge = (title,tone) => `<span class="pill ${tone}">${escape(title)}</span>`;
const badgeIcon = (symbol,color) => `<span class="badge-icon ${color}">${icon(symbol)}</span>`;
const button = (label,action,style='outline',symbol='') =>
  `<button type="button" class="btn ${style}" data-action="${action}">${symbol ? icon(symbol) : ''}${label}</button>`;
const head = (title,description,extra='') => `<div class="page-head"><div><h1>${title}</h1><p class="sub">${description}</p></div>${extra}</div>`;
const matches = (product, terms) => {
  const entry = [product.name,product.sku,product.location,product.kind,product.vendor].join(' ').toLowerCase();
  return terms.every(term => entry.includes(term) || entry.split(/[^a-z0-9]+/).some(word => {
    if (term.length < 4 || Math.abs(word.length - term.length) > 1) return false;
    let a = 0, b = 0, errors = 0;
    while (a < term.length && b < word.length) {
      if (term[a] === word[b]) { a++; b++; continue; }
      if (++errors > 1) return false;
      if (term.length >= word.length) a++;
      if (word.length >= term.length) b++;
    }
    return errors + (term.length-a) + (word.length-b) <= 1;
  }));
};

function save(next) {
  try { localStorage.setItem(storageKey, JSON.stringify(next)); }
  catch { toast('Device storage is unavailable. Changes were kept for this session.'); }
  state = next;
}

function recordActivity(next,text,detail,type) {
  next.events.unshift({text,detail,type,time:new Date().toISOString()});
}

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  toastTimer = setTimeout(() => { $('#toast').textContent = ''; },4200);
}

function table(items,full) {
  if (!items.length) return '<p class="empty">No matching products.</p>';
  return `<div class="table-wrap"><table class="stock-table" role="table"><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Product</th><th scope="col" role="columnheader">Location</th>${full?'<th scope="col" role="columnheader">Minimum</th>':''}<th scope="col" role="columnheader">On hand</th><th scope="col" role="columnheader">Status</th>${full?'<th scope="col" role="columnheader">Actions</th>':''}</tr></thead><tbody role="rowgroup">${items.map(product => `
    <tr role="row"><td role="cell" class="product-cell"><div class="product">${badgeIcon(product.shape,product.color)}<div><b>${escape(product.name)}</b><small>${escape(full ? product.sku + ' · ' + product.kind : product.kind)}</small></div></div></td>
    <td role="cell" data-label="Location">${escape(product.location)}</td>${full?'<td role="cell" data-label="Minimum">'+threshold(product)+'</td>':''}<td role="cell" class="stock" data-label="On hand">${qty(product.count)} <span class="muted">${escape(product.unit)}</span></td>
    <td role="cell" data-label="Status">${state.flags.some(flag=>flag.itemId===product.id) ? badge('Count flagged','price') : low(product)?badge(product.count ? 'Low stock':'Out of stock','low'):badge('In stock','good')}</td>
    ${full?`<td role="cell" class="action-cell"><div class="row-controls"><button class="icon-btn" data-action="stock:${product.id}:add" aria-label="Add stock for ${escape(product.name)}">+</button><button class="icon-btn" data-action="stock:${product.id}:remove" aria-label="Remove stock for ${escape(product.name)}">−</button><button class="btn text row-action" data-action="edit:${product.id}">Edit</button><button class="btn text row-action" data-action="flag:${product.id}">Flag</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`;
}

function alertRow(symbol,color,title,description,tag,tone) {
  return `<div class="alert-card">${badgeIcon(symbol,color)}<div><b>${escape(title)}</b><p>${escape(description)}</p></div>${tag?badge(tag,tone):''}</div>`;
}

function metric(symbol,color,label,value,note,action) {
  return `<button class="metric" data-action="${action}"><span class="metric-top"><span>${label}</span>${badgeIcon(symbol,color)}</span><strong class="metric-value">${value}</strong><span class="metric-note">${note}</span></button>`;
}

function overview() {
  const lowItems = watched();
  const price = state.prices[0];
  const urgent = lowItems.slice(0,2).map(product => alertRow('alert','amber',product.name,`${available(product)} · minimum ${threshold(product)}`,'Low stock','low'));
  const date = new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric'}).format(new Date());
  if (price) urgent.splice(1,0,alertRow('up','rose',price.name,'Supplier unit cost increased',`+${priceChange(price)}%`,'price'));
  return `${head('Inventory overview','Track what’s on hand, what’s running low, and what needs attention.',`<span class="date">${icon('clock')}${date}</span>`)}
    <section class="hero bottle-hero" aria-label="Bottle scanner">
      <div class="hero-copy"><h2>Scan a bottle.</h2><p>Use your camera to identify bottles and count what’s on the shelf.</p><div class="actions">${button('Scan bottle','bottle','hero-main','scan')}${button('Scan delivery','sample','hero-alt','file')}</div></div>
      <div class="hero-art" aria-hidden="true"><div class="hero-photo"><div class="hero-viewfinder"></div></div></div>
    </section>
    <section class="metrics" aria-label="Inventory summary">
      ${metric('box','lilac','Products',state.items.length,'In your catalog','go:inventory')}
      ${metric('alert','amber','Low stock',lowItems.length,'At or below minimum','go:low')}
      ${metric('up','rose','Price alerts',state.prices.length,'Supplier increases over 3%','go:prices')}
      ${metric('cart','mint','Units on hand',qty(state.items.reduce((sum,product)=>sum+product.count,0)),'Across all products','go:inventory')}
    </section>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-head"><div><h2>Inventory snapshot</h2><p>Stock and shelf locations at a glance</p></div>${button('View inventory','go:inventory','text')}</div>${table(state.items.slice(0,5),false)}</section>
      <section class="panel"><div class="panel-head"><h2>Needs attention</h2></div><div class="alerts">${urgent.join('') || '<p class="empty">You’re caught up.</p>'}${button('Review insights','go:reorders')}</div></section>
    </div><section class="panel section-gap"><div class="panel-head"><h2>Recent activity</h2>${button('View activity','go:activity','text')}</div><ul class="history">${recent()}</ul></section>`;
}

function inventory() {
  return `${head('Inventory','Look up products, shelf locations, and on-hand counts.',`<div class="actions">${button('Add product','new','primary','box')}${button('Log by voice','voice','outline','mic')}</div>`)}
    <section class="panel"><div class="panel-head"><div><h2>Counter lookup</h2><p id="result-count" aria-live="polite"></p></div></div>
    <div class="toolbar"><label class="search">${icon('search')}<input type="search" id="search" aria-label="Search products" placeholder="Search product, SKU, or aisle" value="${escape(filters.query)}"></label>
    <select id="kind" aria-label="Product category"><option value="all">All categories</option>${categories.map(k=>`<option>${k}</option>`).join('')}</select>
    <select id="stock-filter" aria-label="Stock status"><option value="all">All stock</option><option value="low">Low stock</option><option value="flagged">Count flagged</option></select></div>
    <div id="results"></div></section>`;
}

function refreshResults() {
  const terms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = state.items.filter(product => matches(product,terms)
    && (filters.kind === 'all' || product.kind === filters.kind)
    && (filters.status !== 'low' || low(product))
    && (filters.status !== 'flagged' || state.flags.some(flag=>flag.itemId===product.id)));
  $('#results').innerHTML = table(filtered,true);
  $('#result-count').textContent = `${filtered.length} of ${state.items.length} products`;
}

function capture() {
  return `${head('Capture & review','Review deliveries before adding stock and record shelf observations.')}
    <div class="content-grid">
      <section class="panel content-card">${badgeIcon('bottle','mint')}<h2>Bottle scanner</h2><p>Use your camera or a photo to detect and count bottles.</p>${button('Scan bottle','bottle','primary','scan')}</section>
      <section class="panel content-card">${badgeIcon('scan','lilac')}<h2>Receipt or invoice</h2><p>Try the sample receipt to review extracted quantities, costs, and a flagged decimal.</p><div class="actions">${button('Scan delivery','sample','primary','scan')}${button('Upload photo or PDF','upload')}</div></section>
      <section class="panel content-card">${badgeIcon('box','blue')}<h2>Shelf count</h2><p>Try a sample shelf count or attach a shelf photo and enter the counted quantity.</p><div class="actions">${button('Try sample shelf','shelf','primary','box')}${button('Upload shelf photo','shelf-upload')}</div></section>
      <section class="panel content-card">${badgeIcon('mic','mint')}<h2>Voice stock update</h2><p>Say what you used or sold and confirm the adjustment before it posts.</p>${button('Log by voice','voice')}</section>
    </div>
    ${lastDraft ? `<section class="panel content-card section-gap"><h2>Pending review</h2><p>Continue reviewing your latest capture.</p>${button('Resume review','resume','primary')}</section>`:''}`;
}

function recent() {
  return state.events.slice(0,3).map(entry=>`<li>${badgeIcon(entry.type,'lilac')}<div><b>${escape(entry.text)}</b><small>${escape(entry.detail)}</small></div></li>`).join('');
}

function reorders() {
  const vendors = [...new Set(watched().map(product=>product.vendor))];
  const draftCards = vendors.map(vendor => {
    const products = watched().filter(product=>product.vendor===vendor);
    const count = products.length;
    return `<article class="panel content-card">${badgeIcon('cart','lilac')}<h2>${escape(vendor)}</h2><p>${count} ${count===1?'item':'items'} at or below minimum</p>
      <ul class="vendor-list">${products.map(product=>`<li>${escape(product.name)} · Order ${orderQuantity(product)} ${escape(product.unit)}</li>`).join('')}</ul>
      ${button('Review order draft','order:'+encodeURIComponent(vendor),'primary')}</article>`;
  });
  const priceCards = state.prices.map(price => `<article class="panel content-card">${badgeIcon('up','rose')}<h3>${escape(price.name)} ${badge('+'+priceChange(price)+'%','price')}</h3><p>${escape(price.vendor)} · ${money(price.before)} to ${money(price.after)} per unit<br>Added cost for ${qty(price.units)} units: ${money((price.after-price.before)*price.units)}</p>${button('Draft supplier query','price:'+price.id)}</article>`);
  return `${head('Insights','Review restock suggestions, supplier drafts, and unit cost changes.')}
    <section class="panel content-card assistant-panel"><div class="assistant-heading">${badgeIcon('box','mint')}<h2>Inventory assistant</h2>${badge('Automated suggestions','good')}</div><p>Ask what needs restocking, how many units you have, or look up a product by name.</p><form id="assistant-form" class="actions"><label class="search"><input id="assistant-query" name="question" aria-label="Ask about inventory" placeholder="What needs restocking?" required></label><button class="btn primary" type="submit">Ask assistant</button></form><div id="assistant-answer" class="preview-message" role="status">${escape(assistantAnswer('What needs restocking?'))}</div></section>
    <section class="section-gap" aria-label="Reorder drafts"><div class="panel-head"><h2>Supplier order drafts</h2></div><div class="content-grid">${draftCards.join('') || '<div class="panel empty">All products are above their stock minimum.</div>'}</div></section>
    <section id="prices" class="section-gap"><div class="panel-head"><div><h2>Supplier price alerts</h2><p>Unit cost increases over 3%</p></div></div><div class="content-grid">${priceCards.join('') || '<div class="panel empty">No supplier price alerts.</div>'}</div></section>`;
}

function activity() {
  return `${head('Activity','Review stock changes and resolve flagged counts.')}
    ${state.flags.length ? `<section class="panel section-gap"><div class="panel-head"><h2>Count discrepancies</h2></div><ul class="history">${state.flags.map(flag=>`
    <li>${badgeIcon('alert','amber')}<div><b>${escape(state.items.find(product=>product.id===flag.itemId)?.name||'Product')}</b><small>Reported ${qty(flag.count)} on hand${flag.note ? ' · '+escape(flag.note):''}</small>${button('Review count','resolve:'+flag.id,'text')}</div></li>`).join('')}</ul></section>`:''}
    <section class="panel section-gap"><div class="panel-head"><h2>Stock history</h2></div><ul class="history">${state.events.map(entry=>`
      <li>${badgeIcon(entry.type,entry.type==='alert'?'amber':'lilac')}<div><b>${escape(entry.text)}</b><small>${escape(entry.detail)}${entry.time ? ' · '+new Date(entry.time).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}) : ''}</small></div></li>`).join('')}</ul></section>`;
}

function render() {
  const key = page();
  $('#crumb').textContent = pageNames[key];
  $('#nav-count').textContent = new Set(watched().map(product=>product.vendor)).size || '';
  document.querySelectorAll('nav a').forEach(link => {
    if (link.hash === '#'+key) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  view.innerHTML = ({overview,inventory,capture,reorders,activity}[key])();
  if (key==='inventory') {
    $('#kind').value=filters.kind;
    $('#stock-filter').value=filters.status;
    refreshResults();
  }
}

function route(target) {
  const actual = target==='low' ? 'inventory' : target==='prices' ? 'reorders' : target;
  if (actual==='inventory') filters={query:'',kind:'all',status:target==='low'?'low':'all'};
  if (page()===actual) render();
  else location.hash=actual;
  if (target==='prices') requestAnimationFrame(()=>$('#prices')?.scrollIntoView({block:'start'}));
}

function modal(title,content,wide=false) {
  if (!dialog.open) lastFocus=document.activeElement;
  dialog.classList.toggle('wide',wide);
  dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button type="button" class="icon-btn" aria-label="Close dialog" data-action="close">${icon('close')}</button></div><div class="dialog-body">${content}</div>`;
  if (!dialog.open) dialog.showModal();
  else dialog.querySelector('button').focus();
}

function formError(form,message) {
  form.querySelector('.form-error').textContent=message;
}

const sampleReceipt = [
  {name:'Rolled Oats',count:12,cost:185,unit:'units',location:'A1 · Shelf 02',confidence:68},
  {name:'Vanilla Overnight Oats',count:8,cost:9.8,unit:'units',location:'A1 · Shelf 04',confidence:98},
  {name:'Wildflower Honey',count:6,cost:12,unit:'units',location:'A2 · Shelf 01',confidence:99}
];
const receiptText = 'HARVEST SUPPLY CO.\nDelivery receipt · HS-2048\n--------------------------\nRolled Oats\n12 units × $18.50\n\nVanilla Overnight Oats\n8 units × $9.80\n\nWildflower Honey\n6 units × $12.00\n--------------------------\nTOTAL              $372.40';

function openDraft(mode) {
  if (sourceUrl) { URL.revokeObjectURL(sourceUrl); sourceUrl=null; }
  if (mode==='receipt') lastDraft={mode,kind:'sample',vendor:'Harvest Supply Co.',reference:'HS-2048',rows:structuredClone(sampleReceipt)};
  if (mode==='shelf') lastDraft={mode,kind:'sample',itemId:'blades',count:3};
  if (mode==='upload') lastDraft={mode:'receipt',kind:'upload',vendor:'',reference:'',rows:[{name:'',count:'',cost:'',unit:'units',location:'',confidence:null}]};
  if (mode==='shelf-upload') lastDraft={mode:'shelf',kind:'upload',itemId:'',count:''};
  showDraft();
}

function sourceView(draft) {
  if (draft.kind==='upload') return `<label>Attach ${draft.mode==='shelf'?'shelf photo':'photo or PDF'}<input class="field" type="file" id="source" accept="${draft.mode==='shelf'?'image/*':'image/*,application/pdf'}"></label><div id="source-preview"></div><p class="note">Enter the details from your attachment. Automatic extraction is simulated with the sample receipt.</p>`;
  if (draft.mode==='receipt') return `<div class="receipt">${escape(receiptText)}</div>`;
  return '<div class="receipt">CEREALS & GRAINS · B1 / SHELF 03\nWhole Grain Oat Packs\n▣  ▣  ▣\n\nVisible shelf count: 3 packs</div>';
}

function reviewRows(rows) {
  return rows.map((line,index)=>`<div class="review-item form-grid">
    <label class="span-all">Product name<input name="name" class="field" maxlength="75" required value="${escape(line.name)}"></label>
    <label>Quantity<input name="count" class="field" type="number" min="1" max="99999" step="1" required value="${escape(line.count)}"></label>
    <label>Unit cost<input name="cost" class="field" type="number" min="0" max="99999" step="0.01" required value="${escape(line.cost)}"></label>
    <label>Unit of measure<input name="unit" class="field" maxlength="24" required value="${escape(line.unit)}"></label>
    <label>Shelf location<input name="location" class="field" maxlength="40" required value="${escape(line.location)}"></label>
    ${line.confidence===null?'':`<div class="span-all">${badge(line.confidence+'% confidence',line.confidence<80?'low':'good')} ${line.confidence<80?'<span class="note">Check possible 10× decimal error.</span>':''}</div>`}
    ${rows.length>1?`<button type="button" class="btn text span-all" data-action="remove-line:${index}">Remove line</button>`:''}</div>`).join('');
}

function showDraft() {
  const draft=lastDraft;
  if (!draft) return;
  const source=`<div class="source-panel stack"><h3>${draft.kind==='sample'?'Sample source':'Source attachment'}</h3>${sourceView(draft)}</div>`;
  let form;
  if (draft.mode==='receipt') {
    const duplicate = draft.reference && state.received.some(record=>record.key.toLowerCase()===(draft.vendor+' / '+draft.reference).toLowerCase());
    form=`<form class="stack" id="receipt-form"><div class="form-grid"><label>Supplier<input name="vendor" class="field" required maxlength="70" value="${escape(draft.vendor)}"></label><label>Receipt reference<input name="reference" class="field" required maxlength="50" value="${escape(draft.reference)}"></label></div>
      ${duplicate?`<div>${badge('Duplicate receipt','price')} <span class="note">This receipt was already approved.</span></div>`:''}
      <div id="review-lines" class="stack">${reviewRows(draft.rows)}</div>
      ${button('Add line','add-line','text')}
      <p class="form-error" role="alert"></p>
      <button class="btn primary" type="submit">${icon('check')}Approve and add stock</button></form>`;
  } else {
    form=`<form id="shelf-form" class="stack"><label>Product<select name="product" required><option value="">Choose product</option>${state.items.map(product=>`<option value="${product.id}" ${draft.itemId===product.id?'selected':''}>${escape(product.name)}</option>`).join('')}</select></label>
      <label>Visible shelf count<input class="field" name="count" type="number" min="0" max="99999" step="1" value="${escape(draft.count)}" required></label>
      <p class="note">Approval records a shelf observation. Receiving and stock adjustments change total inventory.</p><p class="form-error" role="alert"></p>
      <button class="btn primary" type="submit">${icon('check')}Record shelf observation</button></form>`;
  }
  modal(draft.mode==='receipt'?'Review receipt':'Review shelf count',`<div class="content-grid">${source}${form}</div>`,true);
  showSourcePreview();
}

function keepDraft() {
  if (!lastDraft || !dialog.open) return;
  const receipt = $('#receipt-form');
  const shelf = $('#shelf-form');
  if (receipt) {
    lastDraft.vendor=receipt.elements.vendor.value;
    lastDraft.reference=receipt.elements.reference.value;
    lastDraft.rows=[...receipt.querySelectorAll('.review-item')].map((line,index) => ({
      ...Object.fromEntries([...line.querySelectorAll('input')].map(input=>[input.name,input.value])),
      confidence:lastDraft.rows[index].confidence
    }));
  }
  if (shelf) {
    lastDraft.itemId=shelf.elements.product.value;
    lastDraft.count=shelf.elements.count.value;
  }
}

function showSourcePreview() {
  const preview=$('#source-preview');
  if (!preview || !sourceUrl || !lastDraft?.file) return;
  if (lastDraft.file.type.startsWith('image/')) {
    const image=document.createElement('img');
    image.className='source-image';
    image.alt='Uploaded source attachment';
    image.src=sourceUrl;
    preview.replaceChildren(image);
  } else {
    const link=document.createElement('a');
    link.className='btn outline';
    link.href=sourceUrl;
    link.target='_blank';
    link.rel='noopener';
    link.textContent='Open attached PDF';
    preview.replaceChildren(link);
  }
}

function approveReceipt(form) {
  keepDraft();
  const {vendor,reference,rows}=lastDraft;
  if (lastDraft.kind==='upload' && !lastDraft.file) return formError(form,'Attach a receipt photo or PDF before approving.');
  const key=vendor.trim()+' / '+reference.trim();
  if (!vendor.trim() || !reference.trim() || rows.some(line=>!line.name.trim() || !line.unit.trim() || !line.location.trim())) return formError(form,'Fill in the supplier, receipt reference, and all line details.');
  if (state.received.some(record=>record.key.toLowerCase()===key.toLowerCase())) return formError(form,'This receipt has already been added. Check the supplier and reference.');
  if (rows.some(line=>line.confidence!==null && line.confidence<80 && Number(line.cost)===185) && !form.dataset.confirmed) {
    form.dataset.confirmed='yes';
    return formError(form,'The sample source shows $18.50. Correct the unit cost, or approve again to confirm $185.00.');
  }
  const next=structuredClone(state);
  for (const line of rows) {
    const name=line.name.trim();
    const cost=Number(line.cost);
    const count=Number(line.count);
    let product=next.items.find(product=>product.name.toLowerCase()===name.toLowerCase());
    if (product) {
      if (product.cost>0 && cost>product.cost*1.03) next.prices.unshift({id:uid(),itemId:product.id,name:product.name,vendor:vendor.trim(),before:product.cost,after:cost,units:count});
      product.count+=count;
      product.cost=cost;
      product.location=line.location.trim();
    } else {
      let skuNumber=1001+next.items.length;
      while (next.items.some(known=>known.sku==='OAT-'+skuNumber)) skuNumber++;
      product=item(uid(),name,'OAT-'+skuNumber,line.location.trim(),count,cost,0,vendor.trim(),'Pantry','box','lilac');
      next.items.push(product);
    }
    product.unit=line.unit.trim();
  }
  next.received.push({key});
  recordActivity(next,'Approved receipt '+reference.trim(),vendor.trim()+' · '+rows.length+' catalog lines','scan');
  save(next);
  lastDraft=null;
  closeDialog();
  render();
  toast('Receipt approved. Inventory updated.');
}

function approveShelf(form) {
  keepDraft();
  if (lastDraft.kind==='upload' && !lastDraft.file) return formError(form,'Attach a shelf photo before recording the count.');
  const product=state.items.find(data=>data.id===lastDraft.itemId);
  if (!product) return formError(form,'Choose an item to update.');
  const next=structuredClone(state);
  recordActivity(next,'Recorded shelf observation for '+product.name,qty(lastDraft.count)+' visible · '+product.location,'scan');
  save(next);
  lastDraft=null;
  closeDialog();
  render();
  toast('Shelf observation recorded. Total inventory is unchanged.');
}

function assistantAnswer(question) {
  const query=question.toLowerCase();
  const describe=product=>`${product.name} has ${qty(product.count)} ${product.unit} on hand at ${product.location}. Minimum: ${threshold(product)}.${low(product)?' Suggest ordering '+orderQuantity(product)+' '+product.unit+'.':''}`;
  const product=state.items.find(product=>query.includes(product.name.toLowerCase())) ||
    state.items.find(product=>query.includes(product.sku.toLowerCase()));
  if (product) return describe(product);
  if (/restock|reorder|running low|low stock|buy|suggest/.test(query)) {
    return watched().map(describe).join('\n\n') || 'All products are above their minimum stock levels.';
  }
  if (/total|how many|units|products/.test(query)) {
    return `There are ${state.items.length} products and ${qty(state.items.reduce((sum,product)=>sum+product.count,0))} units on hand. ${watched().length} products are at or below their minimum.`;
  }
  return 'Try asking what needs restocking, how many units you have in total, or asking about a product by its exact name or SKU.';
}

function productModal(product) {
  modal(product?'Edit product':'Add product',`<form id="product-form" data-id="${product?.id || ''}" class="stack">
    <div class="form-grid"><label class="span-all">Product name<input name="name" class="field" required maxlength="75" value="${escape(product?.name||'')}"></label>
    <label>Category<select name="kind">${categories.map(category=>`<option ${product?.kind===category?'selected':''}>${category}</option>`).join('')}</select></label>
    <label>Shelf location<input name="location" class="field" required maxlength="40" value="${escape(product?.location||'')}"></label>
    <label>On-hand quantity<input name="count" class="field" type="number" min="0" max="99999" required value="${product?.count??0}"></label>
    <label>Minimum stock<input name="minimum" class="field" type="number" min="0" max="99999" required value="${product?threshold(product):5}"></label>
    <label>Unit of measure<input name="unit" class="field" required maxlength="24" value="${escape(product?.unit||'units')}"></label>
    <label>Unit cost<input name="cost" class="field" type="number" min="0" max="99999" step=".01" required value="${product?.cost??0}"></label>
    <label class="span-all">Supplier<input name="vendor" class="field" required maxlength="70" value="${escape(product?.vendor||'')}"></label></div>
    <p class="form-error" role="alert"></p><div class="actions"><button class="btn primary" type="submit">Save product</button>${product?button('Delete product','delete:'+product.id,'outline danger'):''}</div>
  </form>`);
}

function saveProduct(form) {
  const fields=Object.fromEntries(new FormData(form));
  const values={name:fields.name.trim(),location:fields.location.trim(),unit:fields.unit.trim(),vendor:fields.vendor.trim()};
  if (Object.values(values).some(value=>!value)) return formError(form,'Fill in all product details.');
  const next=structuredClone(state);
  const existing=next.items.find(product=>product.id===form.dataset.id);
  if (next.items.some(product=>product.id!==existing?.id && product.name.toLowerCase()===values.name.toLowerCase())) return formError(form,'A product already uses that name.');
  const sku=Math.max(1000,...next.items.map(product=>Number(product.sku.split('-')[1])||0))+1;
  const product=existing || item(uid(),values.name,'OAT-'+sku,values.location,0,0,0,values.vendor,fields.kind,'box','mint');
  Object.assign(product,values,{kind:fields.kind,count:Number(fields.count),cost:Number(fields.cost),minimum:Number(fields.minimum)});
  if (!existing) next.items.push(product);
  recordActivity(next,(existing?'Updated ':'Added ')+product.name,qty(product.count)+' '+product.unit+' on hand','box');
  complete(next,existing?'Product updated.':'Product added.');
}

function complete(next,message) {
  save(next);
  closeDialog();
  render();
  toast(message);
}

function stockModal(product,mode) {
  const adding=mode==='add';
  modal(adding?'Add stock':'Remove stock',`<form id="stock-form" data-id="${product.id}" data-mode="${mode}" class="stack"><p>${escape(product.name)} · ${available(product)}</p>
    <label>Quantity<input name="count" class="field" type="number" min="1" max="99999" required value="1"></label>
    <label>Reason<select name="usage">${Object.entries(usageNames).map(([key,name])=>`<option value="${key}" ${(adding?key==='Receiving':key==='Retail')?'selected':''}>${name}</option>`).join('')}</select></label>
    <p class="form-error" role="alert"></p><button class="btn primary" type="submit">${adding?'Add':'Remove'} stock</button></form>`);
}

function adjust(form,voice) {
  const data=new FormData(form);
  const next=structuredClone(state);
  const product=next.items.find(product=>product.id===(voice?data.get('product'):form.dataset.id));
  const count=Number(data.get('count'));
  const adding=form.dataset.mode==='add';
  if (!product) return formError(form,'Choose a product.');
  if (!Number.isInteger(count) || count<1) return formError(form,'Enter a whole number greater than zero.');
  if (!adding && count>product.count) return formError(form,`You can remove up to ${product.count} ${product.unit}.`);
  product.count+=adding?count:-count;
  recordActivity(next,`${adding?'Added':'Removed'} ${count} · ${product.name}`,`${usageNames[data.get('usage')]} · ${product.count} on hand`,voice?'mic':'box');
  complete(next,'Stock updated.');
  if (voice) navigator.vibrate?.(60);
}

function voiceModal() {
  modal('Log stock by voice',`<form id="voice-form" class="stack"><p class="note">Use your microphone if your browser supports speech recognition, or try the sample note.</p>
    <label>Voice note<textarea name="transcript" rows="3" placeholder="Sold two Rolled Oats" required></textarea></label>
    <div class="actions">${button('Use microphone','mic','outline','mic')}${button('Use sample note','voice-sample')}</div>
    <p class="form-error" role="alert"></p><button class="btn primary" type="submit">Review adjustment</button></form>`);
}

function parseVoice(form) {
  const transcript=form.elements.transcript.value.trim().toLowerCase();
  const numbers={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const quantity=transcript.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/)?.[1];
  const product=state.items.find(product=>transcript.includes(product.name.toLowerCase()));
  if (!product || !quantity) return formError(form,'Include a product name and a quantity, such as “Sold two Rolled Oats.”');
  const adding=/\b(add|added|receive|received|restock|restocked)\b/.test(transcript);
  const reason=adding?'Receiving':/\b(internal|used)\b/.test(transcript)?'Internal':'Retail';
  modal('Confirm stock adjustment',`<form id="voice-confirm" data-mode="${adding?'add':'remove'}" class="stack">
    <label>Product<select name="product" required>${state.items.map(entry=>`<option value="${entry.id}" ${entry.id===product.id?'selected':''}>${escape(entry.name)} · ${available(entry)}</option>`).join('')}</select></label>
    <label>Quantity to ${adding?'add':'remove'}<input name="count" class="field" type="number" min="1" max="99999" required value="${numbers[quantity]||Number(quantity)}"></label>
    <label>Reason<select name="usage">${Object.entries(usageNames).map(([key,name])=>`<option value="${key}" ${key===reason?'selected':''}>${name}</option>`).join('')}</select></label>
    <p class="form-error" role="alert"></p><button class="btn primary" type="submit">Confirm stock change</button></form>`);
}

function startMic() {
  const form=$('#voice-form');
  const Speech=window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) return formError(form,'Speech recognition is unavailable in this browser. Type a note or use the sample.');
  if (recognition) return;
  recognition=new Speech();
  recognition.lang='en-US';
  const button=form.querySelector('[data-action=mic]');
  button.textContent='Listening…';
  recognition.onresult=e=>{form.elements.transcript.value=e.results[0][0].transcript; formError(form,'');};
  recognition.onerror=()=>formError(form,'Microphone capture failed. Check browser access, or use the sample note.');
  recognition.onend=()=>{recognition=null;button.innerHTML=icon('mic')+'Use microphone';};
  try { recognition.start(); }
  catch { recognition=null;button.innerHTML=icon('mic')+'Use microphone';formError(form,'Microphone capture could not start. Try the sample note.'); }
}

function flagModal(product,flag) {
  modal(flag?'Review reported count':'Flag a stock discrepancy',`<form id="flag-form" data-id="${product.id}" data-flag="${flag?.id||''}" class="stack"><p>${escape(product.name)} · ${available(product)} in inventory</p>
    <label>Physical count<input name="count" class="field" type="number" min="0" max="99999" required value="${flag?.count??''}"></label>
    <label>Note (optional)<input name="note" class="field" maxlength="120" value="${escape(flag?.note||'')}"></label>
    <p class="note">${flag?'Confirm the count to update inventory and clear this flag.':'The report goes into Activity for review.'}</p><button class="btn primary" type="submit">${flag?'Confirm count':'Save report'}</button></form>`);
}

function saveFlag(form) {
  const next=structuredClone(state);
  const product=next.items.find(product=>product.id===form.dataset.id);
  const fields=new FormData(form);
  const count=Number(fields.get('count'));
  const resolving=Boolean(form.dataset.flag);
  if (resolving) {
    product.count=count;
    next.flags=next.flags.filter(flag=>flag.id!==form.dataset.flag);
  } else {
    next.flags=next.flags.filter(flag=>flag.itemId!==product.id);
    next.flags.unshift({id:uid(),itemId:product.id,count,note:fields.get('note').trim()});
  }
  recordActivity(next,(resolving?'Reconciled count for ':'Flagged count for ')+product.name,qty(count)+' counted · '+product.location,resolving?'check':'alert');
  complete(next,resolving?'Count reconciled.':'Discrepancy added to Activity.');
}

function messageModal(mode,value) {
  let vendor, message;
  if (mode==='order') {
    vendor=decodeURIComponent(value);
    const lines=watched().filter(product=>product.vendor===vendor).map(product=>`• ${qty(orderQuantity(product))} ${product.unit} — ${product.name}`);
    message=`Hi ${vendor}, please confirm availability, pricing, and delivery for this ${shop} order:\n\n${lines.join('\n')}\n\nThank you!`;
  } else {
    const price=state.prices.find(price=>price.id===value);
    vendor=price.vendor;
    message=`Hi ${vendor}, can you confirm the latest unit cost for ${price.name}? Our records show a change from ${money(price.before)} to ${money(price.after)}. Thanks, ${shop}.`;
  }
  const contact=suppliers[vendor];
  const content=encodeURIComponent(message);
  modal(mode==='order'?'Review order draft':'Review supplier query',`<p class="note">Sample supplier contacts. Copy the draft or open it in your messaging app.</p>
    <pre class="preview-message" id="message">${escape(message)}</pre>
    <div class="dialog-footer">${button('Copy draft','copy','primary')}<a class="btn outline" href="sms:${contact?.phone||''}?body=${content}">Open SMS</a>
    <a class="btn outline" href="https://wa.me/${contact?.phone.slice(1)||''}?text=${content}" target="_blank" rel="noopener">Open WhatsApp</a>
    <a class="btn outline" href="mailto:${contact?.email||''}?subject=${encodeURIComponent(mode==='order'?'Restock request':'Unit cost question')}&amp;body=${content}">Open email</a></div>`);
}

async function openBottleScan() {
  bottleScan?.abort();
  const scan = new AbortController();
  bottleScan = scan;
  modal('Scan bottle',`<section id="bottle-scan" class="bottle-scan" aria-label="Bottle scanner">
    <p class="scan-instruction">Place one bottle upright and keep it fully in view.</p>
    <div class="scanner-stage">
      <video class="scanner-media" playsinline muted hidden aria-label="Live camera"></video>
      <canvas class="scanner-media" hidden role="img" aria-label="Scanned photo"></canvas>
      <div class="scanner-placeholder" aria-hidden="true">${icon('bottle')}</div>
      <div class="scanner-frame" aria-hidden="true"></div>
    </div>
    <div class="scan-result" hidden>
      <div><span>Detected item</span><strong>Bottle</strong></div>
      <div><span>Quantity</span><strong id="bottle-quantity"></strong></div>
    </div>
    <p class="scan-status" role="status" aria-live="polite">Starting camera…</p>
    <div class="actions scan-actions">
      <button type="button" class="btn primary" id="capture-bottle" disabled>${icon('scan')}Scan now</button>
      <button type="button" class="btn outline" id="retry-bottle" hidden>Scan again</button>
      <label class="btn outline photo-label">Upload photo<input type="file" id="bottle-photo" accept="image/*" aria-label="Upload bottle photo" disabled></label>
      <button type="button" class="btn primary" id="save-bottle" hidden>${icon('check')}Save count</button>
    </div>
  </section>`);
  const root = $('#bottle-scan');
  try {
    const {mountBottleScanner} = await import('./bottle-scan.mjs');
    if (scan.signal.aborted) return;
    mountBottleScanner(root,scan.signal,count=>{
      const next = structuredClone(state);
      recordActivity(next,'Recorded bottle scan',qty(count)+' '+(count===1?'bottle':'bottles')+' visible · Shelf observation','scan');
      complete(next,'Bottle count saved to Activity.');
    });
  } catch {
    if (!scan.signal.aborted) root.querySelector('.scan-status').textContent='Scanner could not load. Reopen it to try again.';
  }
}

function closeDialog() {
  bottleScan?.abort();
  keepDraft();
  dialog.close();
}

function run(action) {
  const [type,value,mode]=action.split(':');
  if (type==='go') return route(value);
  if (type==='bottle') return openBottleScan();
  if (type==='sample') return openDraft('receipt');
  if (['upload','shelf','shelf-upload'].includes(type)) return openDraft(type);
  if (type==='resume') return showDraft();
  if (type==='voice') return voiceModal();
  if (type==='mic') return startMic();
  if (type==='voice-sample') { $('#voice-form').elements.transcript.value='Sold two Rolled Oats'; return; }
  if (type==='close') return closeDialog();
  if (type==='add-line' || type==='remove-line') {
    keepDraft();
    if (type==='add-line') lastDraft.rows.push({name:'',count:'',cost:'',unit:'units',location:'',confidence:null});
    else lastDraft.rows.splice(Number(value),1);
    return showDraft();
  }
  if (type==='order' || type==='price') return messageModal(type,value);
  if (type==='copy') {
    navigator.clipboard?.writeText($('#message').textContent).then(()=>toast('Draft copied.'),()=>toast('Select the message text to copy the draft.'));
    return;
  }
  if (type==='new') return productModal();
  const flag=type==='resolve'?state.flags.find(flag=>flag.id===value):undefined;
  const product=state.items.find(product=>product.id===(flag?.itemId || value));
  if (!product) return;
  if (type==='edit') return productModal(product);
  if (type==='stock') return stockModal(product,mode);
  if (type==='flag' || type==='resolve') return flagModal(product,flag);
  if (type==='delete') return modal('Delete product?',`<form id="delete-form" data-id="${product.id}" class="stack"><p>Remove ${escape(product.name)} from this catalog?</p><div class="actions"><button class="btn danger outline" type="submit">Delete product</button>${button('Cancel','close')}</div></form>`);
}

function setNavigation(open) {
  $('#sidebar').classList.toggle('open',open);
  $('#menu').setAttribute('aria-expanded',String(open));
}

document.addEventListener('click',event=>{
  if ($('#sidebar').classList.contains('open') &&
      (!event.target.closest('#sidebar, #menu') || event.target.closest('#sidebar a'))) setNavigation(false);
  const button=event.target.closest('[data-action]');
  if (button) return run(button.dataset.action);
});
document.addEventListener('keydown',event=>{
  if (event.key==='Escape' && !dialog.open && $('#sidebar').classList.contains('open')) {
    setNavigation(false);
    $('#menu').focus();
  }
});
document.addEventListener('input',event=>{
  if (event.target.id==='search') { filters.query=event.target.value; refreshResults(); }
  if (event.target.form?.id==='receipt-form') delete event.target.form.dataset.confirmed;
});
document.addEventListener('change',event=>{
  const target=event.target;
  if (target.id==='kind') { filters.kind=target.value; refreshResults(); }
  if (target.id==='stock-filter') { filters.status=target.value; refreshResults(); }
  if (target.id==='source') {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    lastDraft.file=target.files[0];
    sourceUrl=lastDraft.file?URL.createObjectURL(lastDraft.file):null;
    if (!sourceUrl) $('#source-preview').replaceChildren();
    showSourcePreview();
  }
});
document.addEventListener('submit',event=>{
  const form=event.target;
  const actions={
    'receipt-form':()=>approveReceipt(form),'shelf-form':()=>approveShelf(form),
    'product-form':()=>saveProduct(form),'stock-form':()=>adjust(form,false),
    'voice-form':()=>parseVoice(form),'voice-confirm':()=>adjust(form,true),'flag-form':()=>saveFlag(form),
    'assistant-form':()=>{$('#assistant-answer').textContent=assistantAnswer(form.elements.question.value);},
    'delete-form':()=>{
      const next=structuredClone(state);
      const product=next.items.find(product=>product.id===form.dataset.id);
      next.items=next.items.filter(entry=>entry.id!==product.id);
      next.flags=next.flags.filter(flag=>flag.itemId!==product.id);
      recordActivity(next,'Deleted '+product.name,'Product removed from catalog','box');
      complete(next,'Product deleted.');
    }
  };
  if (!actions[form.id]) return;
  event.preventDefault();
  actions[form.id]();
});

function connection() {
  const status = !navigator.onLine ? 'Offline' : navigator.serviceWorker?.controller ? 'Offline-ready' : 'Browser storage';
  $('#connection').innerHTML='<span></span>'+status;
}
$('#menu').addEventListener('click',()=>setNavigation(!$('#sidebar').classList.contains('open')));
dialog.addEventListener('cancel',()=>{
  bottleScan?.abort();
  keepDraft();
});
dialog.addEventListener('close',()=>{
  recognition?.abort();
  if (!lastDraft && sourceUrl) { URL.revokeObjectURL(sourceUrl); sourceUrl=null; }
  if (lastFocus?.isConnected) lastFocus.focus();
  if (page()==='capture') render();
});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
window.addEventListener('online',connection);
window.addEventListener('offline',connection);
window.addEventListener('storage',event=>{
  if (event.key!==storageKey) return;
  try { state=event.newValue?JSON.parse(event.newValue):structuredClone(seed); render(); }
  catch { /* Keep the active workspace if stored data is unreadable. */ }
});
document.querySelectorAll('[data-icon]').forEach(node=>{node.innerHTML=icon(node.dataset.icon);});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange',connection);
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
connection();
render();
