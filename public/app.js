
let us=[];
const $=x=>document.getElementById(x);
async function api(p,o={}){let r=await fetch(p,{...o,headers:{"content-type":"application/json",...(o.headers||{})}}),d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"خطا");return d}
function show(id){document.querySelectorAll(".auth,.app").forEach(x=>x.classList.add("hidden"));$(id).classList.remove("hidden")}
function showInstaller(){show("installer")}
function toggleSecret(){const x=$("cf-token"),b=x.nextElementSibling;x.type=x.type==="password"?"text":"password";b.textContent=x.type==="password"?"نمایش":"مخفی"}
async function login(){try{await api("/api/auth/login",{method:"POST",body:JSON.stringify({password:$("password").value})});location.reload()}catch(e){alert(e.message)}}
async function logout(){await api("/api/auth/logout",{method:"POST"});location.reload()}
async function checkToken(){const t=$("cf-token").value.trim(),b=$("install-result");if(!t){b.innerHTML="<p class='err'>Token را وارد کن.</p>";return}b.innerHTML="<p>در حال بررسی دسترسی...</p>";try{const d=await api("/api/installer/check",{method:"POST",body:JSON.stringify({token:t})});if(!d.accounts.length){b.innerHTML="<p class='err'>اکانت Cloudflare پیدا نشد.</p>";return}b.innerHTML=`<div class="install-box"><b>Token معتبر است.</b><label>Account<select id="account">${d.accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} — ${esc(a.id)}</option>`).join("")}</select></label><label>نام D1<input id="dbname" value="alpha-db"></label><button class="primary wide" onclick="provisionD1()">ساخت D1</button></div>`}catch(e){b.innerHTML=`<p class="err">${esc(e.message)}</p>`}}
async function provisionD1(){const t=$("cf-token").value.trim(),a=$("account").value,n=$("dbname").value.trim()||"alpha-db",b=$("install-result");b.innerHTML="<p>در حال ساخت D1...</p>";try{const d=await api("/api/installer/provision-d1",{method:"POST",body:JSON.stringify({token:t,accountId:a,name:n})}),id=d.database?.uuid||d.database?.id||"";b.innerHTML=`<div class="install-box success-box"><b>✓ D1 ساخته شد</b><p>Database ID</p><code>${esc(id)}</code><pre>npm install
npx wrangler d1 migrations apply alpha-db --remote
npx wrangler secret put ALPHA_ADMIN_PASSWORD
npx wrangler deploy</pre><button class="primary wide" onclick="copyInstall()">کپی دستورات</button></div>`;$("cf-token").value=""}catch(e){b.innerHTML=`<p class="err">${esc(e.message)}</p>`}}
function copyInstall(){navigator.clipboard?.writeText(`npm install
npx wrangler d1 migrations apply alpha-db --remote
npx wrangler secret put ALPHA_ADMIN_PASSWORD
npx wrangler deploy`)}
async function dash(){
  const stamp=()=>new Date().toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"});
  const results=await Promise.allSettled([
    api("/api/dashboard"),
    api("/api/users"),
    api("/api/nodes"),
    api("/api/activity"),
    api("/api/traffic/history?hours=24"),
    api("/api/settings/health"),
    api("/api/notifications/sync",{method:"POST"})
  ]);
  const [rd,ru,rn,ra,rt,rh,rnotif]=results;
  if(rd.status!=="fulfilled"){
    console.error("dashboard api",rd.reason);
    if($("dash-last-sync")) $("dash-last-sync").textContent="خطا در دریافت آمار اصلی";
    return;
  }
  const d=rd.value||{};
  const users=ru.status==="fulfilled" && Array.isArray(ru.value)?ru.value:[];
  const nodes=rn.status==="fulfilled" && Array.isArray(rn.value)?rn.value:[];
  const acts=ra.status==="fulfilled" && Array.isArray(ra.value)?ra.value:[];
  const traffic=rt.status==="fulfilled"?rt.value:{items:[],current_used_gb:Number(d.trafficGb||0)};
  const health=rh.status==="fulfilled"?rh.value:{checks:[]};
  if(rnotif.status!=="fulfilled") console.warn("notification sync",rnotif.reason);
  alphaLoadNotifications().catch(()=>{});
  $("users").textContent=d.users??users.length;
  $("active").textContent=d.activeUsers??users.filter(x=>x.status==="active").length;
  $("nodes").textContent=d.nodes??nodes.length;
  $("traffic").textContent=Number(d.trafficGb||0).toFixed(1)+" GB";
  $("activity").textContent=d.activity24h??acts.length;
  const activeRate=users.length?Math.round((users.filter(x=>x.status==="active").length/users.length)*100):0;
  $("active-rate").textContent=`${activeRate}٪ از کاربران`;
  $("users-trend").textContent=users.length?`آخرین ثبت: ${formatDate(users[0]?.created_at)}`:"هنوز کاربری ثبت نشده";
  const online=nodes.filter(x=>x.status==="online"||x.status==="active").length;
  $("nodes-health").textContent=nodes.length?`${online} آنلاین · ${nodes.length-online} نیازمند بررسی`:"هنوز Node ثبت نشده";
  $("dash-last-sync").textContent=`آخرین بروزرسانی ${stamp()}`;
  renderDashTraffic(traffic);
  renderDashUsers(users);
  renderDashNodes(nodes);
  renderDashActivity(acts);
  renderDashHealth(health,nodes);
  alphaRenderIntelligence({users,nodes,traffic});
  alphaLoadOperations();
  if(rt.status!=="fulfilled") console.warn("traffic history unavailable",rt.reason);
  if(rh.status!=="fulfilled") console.warn("health unavailable",rh.reason);
}

function alphaFmtGB(v){const n=Number(v||0);return n>=100?n.toFixed(0):n.toFixed(1)}
function alphaDaysUntil(v){const t=parseExpiry(v);return t?Math.ceil((t-Date.now())/86400000):null}
function alphaRenderIntelligence(data={}){
  const users=data.users||[], nodes=data.nodes||[], items=data.traffic?.items||[];
  const total=users.length, active=users.filter(u=>u.status==='active').length;
  const activeRate=total?Math.round(active/total*100):0;
  const traffic=users.reduce((n,u)=>n+Number(u.used_gb||0),0);
  const avg=total?traffic/total:0;
  const quotaRisk=users.filter(u=>Number(u.quota_gb)>0 && Number(u.used_gb)/Number(u.quota_gb)>=.8 && u.status==='active');
  const expiring=users.filter(u=>{const d=alphaDaysUntil(u.expires_at);return d!==null&&d>=0&&d<=7&&u.status==='active'});
  let trend='—';
  if(items.length>=2){const first=Number(items[0].total_used_gb||0),last=Number(items.at(-1).total_used_gb||0);const delta=last-first;trend=(delta>=0?'+':'')+alphaFmtGB(delta)+' GB';}
  const k=$('alpha-intelligence-kpis');
  if(k)k.innerHTML=`<div class="intel-card"><span>نرخ فعال‌بودن</span><b>${activeRate}%</b><small>${active} از ${total} کاربر</small></div><div class="intel-card"><span>میانگین مصرف</span><b>${alphaFmtGB(avg)} GB</b><small>برای هر کاربر</small></div><div class="intel-card"><span>ریسک Quota</span><b>${quotaRisk.length}</b><small>کاربر با مصرف بالای ۸۰٪</small></div><div class="intel-card"><span>انقضای ۷ روزه</span><b>${expiring.length}</b><small>نیازمند پیگیری</small></div><div class="intel-card"><span>روند ترافیک</span><b>${esc(trend)}</b><small>${items.length?`${items.length} Snapshot`:'داده کافی نیست'}</small></div>`;
  const forecast=$('alpha-expiry-forecast');
  const buckets=[0,1,3,7].map(max=>users.filter(u=>{const d=alphaDaysUntil(u.expires_at);return d!==null&&d>=0&&d<=max}).length);
  if(forecast)forecast.innerHTML=`<div class="intel-row"><span>تا ۲۴ ساعت</span><b>${buckets[0]}</b></div><div class="intel-row"><span>تا ۳ روز</span><b>${buckets[1]}</b></div><div class="intel-row"><span>تا ۷ روز</span><b>${buckets[2]}</b></div><div class="intel-row"><span>بدون تاریخ انقضا</span><b>${users.filter(u=>!parseExpiry(u.expires_at)).length}</b></div>`;
  const risk=$('alpha-risk-list');
  const offline=nodes.filter(n=>n.status!=='online'&&n.status!=='active');
  const noQuota=users.filter(u=>Number(u.quota_gb)>0&&Number(u.used_gb)>=Number(u.quota_gb)&&u.status==='active');
  const suspended=users.filter(u=>u.status==='suspended');
  const rows=[];
  if(quotaRisk.length)rows.push(`<button onclick="alphaOpenView('users')"><span>Quota نزدیک به سقف</span><b>${quotaRisk.length}</b></button>`);
  if(noQuota.length)rows.push(`<button onclick="alphaOpenView('users')"><span>Quota مصرف‌شده</span><b>${noQuota.length}</b></button>`);
  if(expiring.length)rows.push(`<button onclick="alphaOpenView('users')"><span>انقضای نزدیک</span><b>${expiring.length}</b></button>`);
  if(offline.length)rows.push(`<button onclick="alphaOpenView('nodes')"><span>Node نیازمند بررسی</span><b>${offline.length}</b></button>`);
  if(suspended.length)rows.push(`<button onclick="alphaOpenView('users')"><span>کاربر معلق</span><b>${suspended.length}</b></button>`);
  if(!rows.length)rows.push('<div class="intel-good">✓ ریسک شاخصی بر اساس داده فعلی شناسایی نشد.</div>');
  if(risk)risk.innerHTML=rows.join('');
}

async function alphaRefreshDashboard(){await dash()}

const alphaCommands = [
  {label:"داشبورد", hint:"نمای کلی و عملیات", icon:"⌂", action:()=>alphaOpenView("dashboard")},
  {label:"مدیریت کاربران", hint:"جستجو، سهمیه و وضعیت", icon:"♙", action:()=>alphaOpenView("users")},
  {label:"نودها", hint:"وضعیت، latency و مانیتورینگ", icon:"◇", action:()=>alphaOpenView("nodes")},
  {label:"گزارش‌ها", hint:"گزارش مدیریتی و Export CSV", icon:"▤", action:()=>alphaOpenView("reports")},
  {label:"Automation Center", hint:"Jobهای زمان‌بندی‌شده و اجرای دستی", icon:"⚙", action:()=>alphaOpenView("jobs")},
  {label:"Diagnostics", hint:"بررسی سلامت سیستم", icon:"✓", action:()=>{alphaOpenView("production");alphaRunDiagnostics()}},
  {label:"اشتراک‌ها", hint:"مدیریت و تمدید", icon:"▣", action:()=>alphaOpenView("subscriptions")},
  {label:"ترافیک", hint:"تاریخچه مصرف", icon:"◫", action:()=>alphaOpenView("traffic")},
  {label:"فعالیت و Audit", hint:"رویدادهای مدیریتی", icon:"◌", action:()=>alphaOpenView("activity")},
  {label:"امنیت و Backup", hint:"بررسی امنیت و خروجی", icon:"◈", action:()=>alphaOpenView("security")},
  {label:"Monitoring", hint:"سلامت سرویس‌ها و رخدادها", icon:"◉", action:()=>alphaOpenView("monitoring")},
  {label:"Production Center", hint:"سلامت Worker و PWA", icon:"☁", action:()=>alphaOpenView("production")},
  {label:"دسترسی ادمین", hint:"Role و دسترسی", icon:"⚙", action:()=>alphaOpenView("settings")},
  {label:"ظاهر پنل", hint:"Theme و تنظیمات رابط", icon:"◐", action:()=>alphaOpenView("appearance")},
  {label:"کاربر جدید", hint:"ایجاد حساب جدید", icon:"＋", action:()=>openModal()},
  {label:"Node جدید", hint:"افزودن زیرساخت", icon:"＋", action:()=>openNodeModal()},
  {label:"ثبت Snapshot", hint:"ثبت نقطه فعلی ترافیک", icon:"◫", action:()=>captureTrafficNow()},
  {label:"بروزرسانی داشبورد", hint:"دریافت دوباره وضعیت", icon:"↻", action:()=>alphaRefreshDashboard()}
];
let alphaCommandIndex=0;
function alphaRenderCommands(list=alphaCommands){
  const box=$("alpha-command-list"); if(!box)return;
  if(!list.length){box.innerHTML='<div class="command-empty">موردی پیدا نشد.</div>';return;}
  alphaCommandIndex=Math.min(alphaCommandIndex,list.length-1);
  box.innerHTML=list.map((x,i)=>`<button class="command-item ${i===alphaCommandIndex?"active":""}" data-command-index="${i}"><span class="command-icon">${x.icon}</span><span><b>${esc(x.label)}</b><small>${esc(x.hint)}</small></span><kbd>${i<9?i+1:""}</kbd></button>`).join("");
  box.querySelectorAll(".command-item").forEach((el,i)=>el.onclick=()=>alphaRunCommand(list[i]));
}
function alphaRunCommand(cmd){
  alphaCloseCommandPalette();
  setTimeout(()=>{try{cmd.action()}catch(e){console.error(e)}},20);
}
function alphaOpenCommandPalette(){
  const p=$("alpha-command-palette"); if(!p)return;
  p.classList.remove("hidden");
  const input=$("alpha-command-input"); if(input){input.value="";alphaCommandIndex=0;alphaRenderCommands();setTimeout(()=>input.focus(),0);}
}
function alphaCloseCommandPalette(){$("alpha-command-palette")?.classList.add("hidden")}
function alphaFilterCommands(q){
  q=String(q||"").trim().toLowerCase();
  const list=q?alphaCommands.filter(x=>(x.label+" "+x.hint).toLowerCase().includes(q)):alphaCommands;
  alphaCommandIndex=0;alphaRenderCommands(list);
}
document.addEventListener("keydown",(e)=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();alphaOpenCommandPalette();return}
  const p=$("alpha-command-palette");
  if(!p||p.classList.contains("hidden"))return;
  if(e.key==="Escape"){e.preventDefault();alphaCloseCommandPalette();return}
  const input=$("alpha-command-input");
  const q=input?.value||"";
  const list=q?alphaCommands.filter(x=>(x.label+" "+x.hint).toLowerCase().includes(q.toLowerCase())):alphaCommands;
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){
    e.preventDefault();alphaCommandIndex=(alphaCommandIndex+(e.key==="ArrowDown"?1:-1)+list.length)%Math.max(list.length,1);alphaRenderCommands(list);
    return;
  }
  if(e.key==="Enter"&&list[alphaCommandIndex]){e.preventDefault();alphaRunCommand(list[alphaCommandIndex]);}
});
async function alphaLoadOperations(){
  const box=$("alpha-attention-list");if(!box)return;
  try{
    const d=await api("/api/operations/summary");
    const items=d.items||[];
    const snapshot=d.traffic_snapshot;
    const stale=snapshot&&snapshot.age_minutes>90;
    if(!items.length&&!stale){
      box.innerHTML='<div class="attention-good"><span>✓</span><div><b>همه‌چیز تحت کنترل است</b><small>در حال حاضر مورد فوری برای بررسی ثبت نشده است.</small></div></div>';
      return;
    }
    const rows=items.map(x=>`<button class="attention-item ${esc(x.level)}" onclick="alphaOpenView('${esc(x.target)}')"><span class="attention-icon">${x.level==="danger"?"!":x.level==="warning"?"△":"i"}</span><span><b>${esc(x.title)}</b><small>${x.count} مورد نیازمند توجه</small></span><strong>مشاهده</strong></button>`);
    if(stale)rows.push(`<button class="attention-item info" onclick="alphaOpenView('traffic')"><span class="attention-icon">◫</span><span><b>Snapshot ترافیک قدیمی است</b><small>آخرین ثبت ${snapshot.age_minutes} دقیقه قبل</small></span><strong>ترافیک</strong></button>`);
    box.innerHTML=rows.join("");
  }catch(e){
    box.innerHTML=`<div class="attention-error"><b>بررسی عملیات انجام نشد</b><small>${esc(e.message||"خطای ناشناخته")}</small></div>`;
  }
}

function renderDashTraffic(d){
  const items=d?.items||[], chart=$("dash-traffic-chart");
  const current=Number(d?.current_used_gb||0);
  if($("dash-traffic-current"))$("dash-traffic-current").textContent=current.toFixed(2)+" GB";
  if($("dash-traffic-min"))$("dash-traffic-min").textContent=items.length?`${items.length} نقطه ثبت‌شده`:"بدون Snapshot";
  if(!chart)return;
  if(!items.length){chart.innerHTML='<div class="dash-chart-empty"><span>◌</span><b>هنوز تاریخچه‌ای ثبت نشده</b><small>با Cron ساعتی یا «ثبت نقطه فعلی» داده واقعی ایجاد می‌شود.</small></div>';return}
  const vals=items.map(x=>Number(x.total_used_gb||0));
  const min=Math.min(...vals), max=Math.max(...vals), span=Math.max(max-min,.01);
  const W=900,H=230,pad=18;
  const points=vals.map((v,i)=>{const x=pad+(i/(Math.max(vals.length-1,1)))*(W-pad*2);const y=H-pad-((v-min)/span)*(H-pad*2);return [x,y]});
  const line=points.map(p=>p.join(",")).join(" ");
  const area=`M ${points[0][0]} ${H-pad} L ${points.map(p=>p.join(" ")).join(" L ")} L ${points.at(-1)[0]} ${H-pad} Z`;
  chart.innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="نمودار ترافیک ۲۴ ساعت"><defs><linearGradient id="alphaTrafficFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#39d9ff" stop-opacity=".28"/><stop offset="1" stop-color="#8d6cff" stop-opacity="0"/></linearGradient><filter id="alphaGlow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="${area}" fill="url(#alphaTrafficFill)"/><polyline points="${line}" fill="none" stroke="#39d9ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#alphaGlow)"/><polyline points="${line}" fill="none" stroke="#8d6cff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>${points.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="${i===points.length-1?5:3}" fill="#07101d" stroke="#39d9ff" stroke-width="2"><title>${new Date(items[i].captured_at).toLocaleString("fa-IR")} — ${vals[i].toFixed(2)} GB</title></circle>`).join("")}</svg><div class="dash-chart-axis"><span>${new Date(items[0].captured_at).toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"})}</span><span>۲۴ ساعت</span><span>${new Date(items.at(-1).captured_at).toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"})}</span></div>`;
}
function renderDashUsers(users){
  const box=$("dash-recent-users");if(!box)return;
  const rows=users.slice().sort((a,b)=>Number(b.created_at||0)-Number(a.created_at||0)).slice(0,5);
  box.innerHTML=rows.length?rows.map((u,i)=>{const used=Number(u.used_gb||0),quota=Number(u.quota_gb||0);const pct=quota?Math.min(100,used/quota*100):0;return `<div class="dash-user-row"><div class="dash-avatar">${esc((u.username||"A").slice(0,1).toUpperCase())}</div><div class="dash-user-main"><b>${esc(u.username)}</b><small>${esc(u.protocol||"VLESS")} · ${esc(u.country||"—")}</small><div class="dash-progress"><i style="width:${pct}%"></i></div></div><div class="dash-user-meta"><b>${used.toFixed(1)} GB</b><span class="status-pill ${u.status==='active'?'ok':''}">${esc(u.status||'—')}</span></div></div>`}).join(""):'<div class="dash-empty">هنوز کاربری ثبت نشده است.</div>';
}
function renderDashNodes(nodes){
  const box=$("dash-node-list");if(!box)return;
  const rows=nodes.slice().sort((a,b)=>(a.status==='online'?0:1)-(b.status==='online'?0:1)).slice(0,5);
  box.innerHTML=rows.length?rows.map(n=>`<div class="dash-node-row"><div class="node-icon">◇</div><div class="dash-node-main"><b>${esc(n.name||"Node")}</b><small>${esc(n.country||"—")} · ${esc(n.protocol||"—")}</small></div><div class="dash-node-meta"><span class="node-state ${n.status==='online'?'online':'offline'}">${n.status==='online'?'ONLINE':'OFFLINE'}</span><b>${n.latency_ms?`${n.latency_ms} ms`:'—'}</b></div></div>`).join(""):'<div class="dash-empty">هنوز Node ثبت نشده است.</div>';
}
function renderDashActivity(acts){
  const box=$("dash-activity-feed");if(!box)return;
  const rows=acts.slice().sort((a,b)=>Number(b.id||0)-Number(a.id||0)).slice(0,6);
  box.innerHTML=rows.length?rows.map(x=>`<div class="dash-activity-row"><span class="activity-icon">•</span><div><b>${esc(x.action||"activity")}</b><small>${esc(x.details||"بدون جزئیات")}</small></div><time>${esc(formatDateTime(x.created_at))}</time></div>`).join(""):'<div class="dash-empty">فعالیتی ثبت نشده است.</div>';
}
function renderDashHealth(h,nodes){
  const checks=h?.checks||[];const ok=checks.length?checks.filter(x=>x.ok).length:0;const total=checks.length||1;
  const nodeTotal=nodes.length, nodeOnline=nodes.filter(x=>x.status==='online').length;
  const pct=Math.round(((ok/total)*0.75+(nodeTotal?nodeOnline/nodeTotal:1)*0.25)*100);
  if($('dash-health-ring'))$('dash-health-ring').textContent=pct+'%';
  if($('health-time'))$('health-time').textContent=new Date().toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});
  const find=k=>checks.find(x=>x.key===k);
  if($('health-pwa'))$('health-pwa').textContent=('serviceWorker' in navigator)?'Ready':'Unavailable';
  if($('health-worker'))$('health-worker').textContent='Online';
  if($('health-db'))$('health-db').textContent=find('d1')?.ok?'Connected':'Check';
  if($('health-auth'))$('health-auth').textContent=find('admin_auth')?.ok?'Protected':'Check';
}
async function loadUsers(){const r=await api("/api/users?limit=50&page=1");us=Array.isArray(r)?r:(r.items||[]);renderUsers()}
function renderUsers(){let q=($("search").value||"").toLowerCase();$("ut").innerHTML=us.filter(x=>x.username.toLowerCase().includes(q)).map(x=>`<tr><td>${esc(x.username)}</td><td>${esc(x.protocol)}</td><td>${esc(x.country)}</td><td>${x.used_gb}/${x.quota_gb} GB</td><td>${esc(x.status)}</td><td><button onclick="profile(${x.id})">جزئیات</button> <button onclick="toggle(${x.id},'${x.status==="active"?"disabled":"active"}')">${x.status==="active"?"غیرفعال":"فعال"}</button> <button onclick="del(${x.id})">حذف</button></td></tr>`).join("")||"<tr><td colspan=6>کاربری وجود ندارد</td></tr>"}
async function toggle(id,s){await api("/api/users/"+id,{method:"PATCH",body:JSON.stringify({status:s})});loadUsers()}
async function del(id){if(confirm("حذف شود؟")){await api("/api/users/"+id,{method:"DELETE"});loadUsers()}}
function openModal(){$("modal").showModal()}
async function createUser(e){e.preventDefault();try{const r=await api("/api/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:$("un").value,protocol:$("up").value,quota_gb:+$("uq").value,country:$("uc").value,device_limit:+$("ud").value})});$("modal")?.close();e.target.reset();await loadUsers();await alphaLoadConfigUsers();const sel=document.getElementById("cfg-user");if(sel){const hit=[...sel.options].find(o=>o.textContent.startsWith($("un").value+" · "));if(hit){sel.value=hit.value;alphaConfigUserChanged();}}alphaToast("کاربر ساخته شد","success")}catch(x){alphaToast(x.message||"ساخت کاربر ناموفق بود","error")}}
async function profile(id){try{const d=await api("/api/users/"+id),u=d.user,sub=location.origin+"/sub/"+u.subscription_token;const b=$("profile-body");b.innerHTML=`<h2>${esc(u.username)}</h2><div class="profile-grid"><div><small>Protocol</small><b>${esc(u.protocol)}</b></div><div><small>Quota</small><b>${u.used_gb}/${u.quota_gb} GB</b></div><div><small>Devices</small><b>${u.device_limit}</b></div><div><small>Status</small><b>${esc(u.status)}</b></div></div><label>لینک اشتراک<input id="sub-link" readonly value="${esc(sub)}"></label><div id="qrcode" class="qr"></div><button class="primary wide" onclick="copyText('sub-link')">کپی لینک اشتراک</button><h3>کانفیگ‌ها</h3><pre id="configs">در حال دریافت...</pre>`;$("profile-modal").showModal();const r=await fetch(sub+"?format=json");const x=await r.json();const raw=await fetch(sub);const cfg=await raw.json();$("configs").textContent=(cfg.configs||[]).join("\\n")||"برای این کاربر هنوز Node فعالی ثبت نشده است.";new QRCode($("qrcode"),{text:sub,width:190,height:190})}catch(e){alert(e.message)}}
function copyText(id){const x=$(id);x.select();navigator.clipboard?.writeText(x.value)}
async function nodes(){let x=await api("/api/nodes");$("nl").innerHTML=x.length?x.map(n=>`<div class="node-row"><div><b>${esc(n.name)}</b><small>${esc(n.country)} · ${esc(n.protocol)}</small></div><span>${esc(n.status)}</span></div>`).join(""):"هنوز نودی ثبت نشده است."}
function openNodeModal(){$("node-modal").classList.remove("hidden")}
async function saveNode(){try{await api("/api/nodes",{method:"POST",body:JSON.stringify({name:$("n-name").value,country:$("n-country").value,endpoint:$("n-endpoint").value,protocol:$("n-protocol").value})});closeModal("node-modal");await nodes();dash()}catch(e){alert(e.message)}}
async function loadSubscriptions(){const r=await api("/api/subscriptions");$("subs-list").innerHTML=(r.items||[]).map(x=>`<tr><td>${esc(x.username)}</td><td>${esc(x.protocol)}</td><td>${x.quota_gb} GB</td><td>${x.used_gb} GB</td><td>${x.device_limit}</td><td>${esc(x.status)}</td><td><button onclick="profile('${x.id}')">جزئیات</button> <button class="danger" onclick="removeSub('${x.id}')">حذف</button></td></tr>`).join("")||"<tr><td colspan=7>اشتراکی وجود ندارد</td></tr>"}
function openSubModal(){$("sub-modal").classList.remove("hidden")}
async function saveSub(){try{await api("/api/subscriptions",{method:"POST",body:JSON.stringify({username:$("s-user").value,quota_gb:$("s-quota").value,device_limit:$("s-devices").value,protocol:$("s-protocol").value})});closeModal("sub-modal");await loadSubscriptions()}catch(e){alert(e.message)}}
async function removeSub(id){if(!confirm("حذف این اشتراک؟"))return;await api("/api/subscriptions/"+id,{method:"DELETE"});await loadSubscriptions()}
async function activity(){let x=await api("/api/activity");$("al").innerHTML=x.map(n=>`<p>${esc(n.action)} — ${esc(n.details||"")} <small>${esc(n.created_at)}</small></p>`).join("")||"فعالیتی ثبت نشده است."}
function closeModal(id){$(id).classList.add("hidden")}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function alphaToast(message,type="info"){
  let box=document.getElementById("alpha-toast-stack");
  if(!box){box=document.createElement("div");box.id="alpha-toast-stack";box.className="alpha-toast-stack";document.body.appendChild(box)}
  const item=document.createElement("div");item.className=`alpha-toast ${type}`;item.textContent=message;box.appendChild(item);
  requestAnimationFrame(()=>item.classList.add("show"));
  setTimeout(()=>{item.classList.remove("show");setTimeout(()=>item.remove(),220)},3200);
}
function alphaTarget(p){return ({dashboard:"dashboard",users:"users-page",nodes:"nodes-page",subscriptions:"subscription-center",traffic:"traffic-page",activity:"activity-page",security:"security-center",production:"alpha-production",settings:"alpha-settings-center",appearance:"alpha-ui-center","config-builder":"config-builder",reports:"alpha-reports",jobs:"alpha-jobs",monitoring:"alpha-monitoring",performance:"alpha-performance"})[p]||"dashboard"}
function alphaOpenView(p){document.getElementById("app")?.classList.toggle("alpha-config-active",p==="config-builder");document.querySelectorAll(".page,.view").forEach(x=>x.classList.add("hidden"));const el=$(alphaTarget(p));if(el)el.classList.remove("hidden");document.querySelectorAll("nav button[data-p]").forEach(x=>x.classList.toggle("active",x.dataset.p===p));if(p==="dashboard")dash();if(p==="users")loadProUsers();if(p==="nodes")loadNodeMonitor();if(p==="subscriptions")alphaLoadSubscriptions();if(p==="traffic")loadTrafficHistory();if(p==="activity")activity();if(p==="security"){alphaSecurityCheck();alphaLoadAudit();alphaLoadSecurityOverview();alphaLoadBackupManifests();}if(p==="production"){alphaProductionCheck();alphaLoadSessionInfo();}if(p==="settings")alphaRefreshControlCenter();if(p==="appearance")alphaLoadUISettings();if(p==="reports")alphaLoadReports();if(p==="jobs")alphaLoadJobs();if(p==="monitoring")alphaLoadMonitoring();if(p==="performance")alphaLoadPerformance();if(p==="integrations")alphaLoadIntegrations();if(p==="config-builder")alphaLoadConfigFactory();}
document.querySelectorAll("nav button[data-p]").forEach(b=>b.onclick=()=>alphaOpenView(b.dataset.p));
function toggleSidebar(){document.getElementById("alpha-sidebar")?.classList.toggle("collapsed");document.getElementById("app")?.classList.toggle("sidebar-collapsed");}

async function alphaRunDiagnostics(){
  const box=$("alpha-diagnostics"); if(!box)return;
  box.innerHTML='<div class="diag-loading">در حال بررسی سلامت سیستم…</div>';
  try{const d=await api("/api/system/diagnostics");box.innerHTML=(d.checks||[]).map(c=>`<div class="diag-row ${c.status==='ok'?'ok':'error'}"><span>${c.status==='ok'?'✓':'!'}</span><b>${esc(c.name)}</b><small>${esc(c.value)}</small></div>`).join('')+`<div class="diag-footer">آخرین بررسی: ${new Date(d.checked_at).toLocaleString('fa-IR')} · ${d.ok?'سیستم سالم':'نیازمند بررسی'}</div>`;alphaToast(d.ok?'بررسی سیستم با موفقیت انجام شد':'برخی بررسی‌ها نیاز به توجه دارند',d.ok?'success':'warning');}catch(e){box.innerHTML=`<div class="diag-row error"><span>!</span><b>Diagnostics</b><small>${esc(e.message)}</small></div>`;alphaToast(e.message,'error')}}
async function alphaLoadSessionInfo(){const el=$("alpha-session-info");if(!el)return;try{const d=await api("/api/auth/session");if(!d.authenticated){el.textContent='Session فعال پیدا نشد.';return}el.textContent=`Session فعلی تا ${new Date(d.expires_at).toLocaleString('fa-IR')} معتبر است · ${d.active_sessions} Session فعال`;}catch(e){el.textContent='دریافت وضعیت Session ناموفق بود.'}}
async function alphaRevokeSessions(){if(!confirm('همه Sessionهای مدیریتی خارج شوند؟'))return;try{await api('/api/auth/sessions/revoke-all',{method:'POST'});location.reload()}catch(e){alphaToast(e.message,'error')}}

async function boot(){try{await api("/api/dashboard");$("login").classList.add("hidden");$("app").classList.remove("hidden");alphaOpenView("dashboard");}catch{try{await api("/api/health");show("login")}catch{$("login").classList.remove("hidden")}}}
boot()
setInterval(()=>{const app=$("app"),dashPage=$("dashboard");if(app&&!app.classList.contains("hidden")&&dashPage&&!dashPage.classList.contains("hidden"))dash().catch(()=>{})},30000);

async function loadTrafficHistory(){try{const hours=Number($("traffic-range")?.value||24);const d=await api(`/api/traffic/history?hours=${hours}`);const items=d.items||[];$('tv').textContent=Number(d.current_used_gb||0).toFixed(2)+" GB";$('traffic-points').textContent=items.length;$('traffic-last').textContent=items.length?new Date(items[items.length-1].captured_at).toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"}):"—";const first=items[0]?.total_used_gb,last=items.at(-1)?.total_used_gb;const delta=first!=null&&last!=null?Number(last)-Number(first):null;const td=$("traffic-delta");if(td)td.textContent=delta==null?"—":`${delta>=0?"+":""}${delta.toFixed(2)} GB`;const chart=$("traffic-chart");if(chart){if(!items.length){chart.innerHTML='<div class="chart-empty">هنوز Snapshot در این بازه ثبت نشده است.</div>';}else{const max=Math.max(...items.map(x=>Number(x.total_used_gb||0)),1);chart.innerHTML=items.map(x=>`<div class="chart-bar" title="${new Date(x.captured_at).toLocaleString("fa-IR")}"><i style="height:${Math.max(6,Number(x.total_used_gb||0)/max*100)}%"></i><small>${new Date(x.captured_at).toLocaleTimeString("fa-IR",{hour:"2-digit"})}</small></div>`).join("");}}const list=$("traffic-history-list");if(list)list.innerHTML=`<table><thead><tr><th>زمان</th><th>مصرف کل</th><th>کاربران</th><th>فعال</th></tr></thead><tbody>${items.slice().reverse().map(x=>`<tr><td>${new Date(x.captured_at).toLocaleString("fa-IR")}</td><td>${Number(x.total_used_gb||0).toFixed(2)} GB</td><td>${x.users_count}</td><td>${x.active_users_count}</td></tr>`).join("")||'<tr><td colspan="4">داده‌ای ثبت نشده است.</td></tr>'}</tbody></table>`;}catch(e){console.error(e);alphaToast(e.message||"خطا در دریافت ترافیک","error")}}
async function captureTrafficNow(){try{await api("/api/traffic/snapshot",{method:"POST"});await loadTrafficHistory();alphaToast("Snapshot ترافیک ثبت شد","success")}catch(e){alphaToast(e.message,"error")}}

let proUsers=[], selectedUsers=new Set(), userSearchTimer, userPage=1, userPageSize=25;
function debouncedUsers(){clearTimeout(userSearchTimer);userSearchTimer=setTimeout(loadProUsers,250)}
async function loadProUsers(){
  const q=encodeURIComponent($("user-search")?.value||""), st=encodeURIComponent($("user-status")?.value||""), country=encodeURIComponent($("user-country")?.value||""), sort=encodeURIComponent($("user-sort")?.value||"created_at");
  userPage=1;
  try {
    const r=await api(`/api/users/advanced?q=${q}&status=${st}&country=${country}&sort=${sort}`);
    proUsers=r.items||[];
    renderProUsers();
    updateUsersPageStats(r.stats||null);
  } catch(e) {
    const el=$("pro-users-list"); if(el) el.innerHTML=`<div class="dash-empty">دریافت کاربران ناموفق بود: ${esc(e.message||"خطای ناشناخته")}</div>`;
  }
}

function updateUsersPageStats(stats){
  const total=stats?Number(stats.total||0):proUsers.length;
  const active=stats?Number(stats.active||0):proUsers.filter(u=>u.status==='active').length;
  const traffic=stats?Number(stats.traffic||0):proUsers.reduce((n,u)=>n+Number(u.used_gb||0),0);
  const expiring=stats?Number(stats.expiring||0):proUsers.filter(u=>{
    const t=parseExpiry(u.expires_at); return t&&t>Date.now()&&t<=Date.now()+7*86400000;
  }).length;
  if($("u-total"))$("u-total").textContent=total;
  if($("u-active"))$("u-active").textContent=active;
  if($("u-traffic"))$("u-traffic").textContent=traffic.toFixed(1)+" GB";
  if($("u-expiring"))$("u-expiring").textContent=expiring;
  if($("users-result-count"))$("users-result-count").textContent=`${proUsers.length} کاربر`;
  const countryEl=$("user-country"); if(countryEl){const current=countryEl.value; const countries=[...new Set(proUsers.map(u=>u.country).filter(Boolean))].sort(); countryEl.innerHTML=`<option value="">همه کشورها</option>`+countries.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join(""); countryEl.value=current;}
}
function parseExpiry(v){
  if(v===null||v===undefined||v==="")return 0;
  const n=Number(v); if(Number.isFinite(n)&&n>0)return n<1e12?n*1000:n;
  const t=Date.parse(v); return Number.isFinite(t)?t:0;
}

function renderProUsers(){
  const el=$("pro-users-list"); if(!el)return;
  const totalPages=Math.max(1,Math.ceil(proUsers.length/userPageSize)); userPage=Math.min(userPage,totalPages);
  const start=(userPage-1)*userPageSize, rows=proUsers.slice(start,start+userPageSize);
  el.innerHTML=`<table><thead><tr><th><input type="checkbox" ${rows.length&&rows.every(u=>selectedUsers.has(u.id))?'checked':''} onchange="toggleVisibleUsers(this.checked)"></th><th>کاربر</th><th>Protocol</th><th>Quota</th><th>مصرف</th><th>دستگاه</th><th>انقضا</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${rows.map(u=>{
    const pct=u.quota_gb?Math.min(100,(Number(u.used_gb)/Number(u.quota_gb))*100):0;
    return `<tr><td><input type="checkbox" ${selectedUsers.has(u.id)?"checked":""} onchange="toggleUser('${u.id}',this.checked)"></td>
    <td><button class="link-btn" onclick="showUserDetail('${u.id}')">${esc(u.username)}</button><small class="muted">${esc(u.country||"—")} · ${esc(u.protocol||"—")}</small></td>
    <td>${esc(u.protocol||"—")}</td><td>${Number(u.quota_gb||0)} GB</td><td><div class="usage-cell"><span>${Number(u.used_gb||0).toFixed(1)} GB</span><i><b style="width:${pct}%"></b></i></div></td>
    <td>${u.device_limit}</td><td>${formatDate(u.expires_at)}</td><td><span class="badge ${esc(u.status||"")}">${esc(u.status||"—")}</span></td>
    <td><button class="ghost small" onclick="showUserDetail('${u.id}')">جزئیات</button></td></tr>`}).join("")||'<tr><td colspan="9"><div class="empty-state">کاربری با این فیلتر پیدا نشد.</div></td></tr>'}</tbody></table>`;
  updateBulkBar();
  const range=$("user-page-range"); if(range)range.textContent=proUsers.length?`${start+1} تا ${Math.min(start+userPageSize,proUsers.length)} از ${proUsers.length}`:"۰ کاربر";
}
function changeUserPage(delta){const pages=Math.max(1,Math.ceil(proUsers.length/userPageSize));userPage=Math.max(1,Math.min(pages,userPage+delta));renderProUsers()}
function toggleVisibleUsers(on){const totalPages=Math.max(1,Math.ceil(proUsers.length/userPageSize));userPage=Math.min(userPage,totalPages);const start=(userPage-1)*userPageSize;proUsers.slice(start,start+userPageSize).forEach(u=>on?selectedUsers.add(u.id):selectedUsers.delete(u.id));renderProUsers()}
function toggleUser(id,on){on?selectedUsers.add(id):selectedUsers.delete(id);updateBulkBar()}
function toggleAllUsers(on){proUsers.forEach(u=>on?selectedUsers.add(u.id):selectedUsers.delete(u.id));renderProUsers()}
function updateBulkBar(){const b=$("bulk-bar"); if(!b)return;b.classList.toggle("hidden",selectedUsers.size===0);$("selected-count").textContent=`${selectedUsers.size} انتخاب`}
async function bulkUserAction(action){const ids=[...selectedUsers];if(!ids.length)return;if(action==="delete"&&!confirm("کاربران انتخاب‌شده حذف شوند؟"))return;await api("/api/users/bulk",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ids,action})});selectedUsers.clear();await loadProUsers()}
async function showUserDetail(id){
  const base=proUsers.find(x=>String(x.id)===String(id)); if(!base)return;
  const box=$("user-detail-content"); box.innerHTML='<div class="detail-loading">در حال دریافت User 360…</div>';
  $("user-detail-modal").classList.remove("hidden");
  try{
    const r=await api(`/api/users/${encodeURIComponent(id)}/360`),u=r.user||base,stats=r.stats||{};
    const pct=Number(stats.usage_pct||0),sub=u.subscription_token?`${location.origin}/sub/${u.subscription_token}`:"";
    const nodes=r.nodes||[],notes=r.notes||[],events=r.events||[];
    box.innerHTML=`<div class="detail-head"><div class="avatar">${esc((u.username||"?")[0].toUpperCase())}</div><div><span class="eyebrow">USER 360</span><h3>${esc(u.username)}</h3><span class="muted">${esc(u.protocol||"—")} · ${esc(u.country||"—")} · ایجاد ${formatDate(u.created_at)}</span></div><span class="badge ${esc(u.status||"")} detail-status">${esc(u.status||"—")}</span></div>
      <div class="detail-grid"><div><small>Quota</small><b>${Number(u.quota_gb||0)} GB</b></div><div><small>مصرف</small><b>${Number(u.used_gb||0).toFixed(1)} GB</b></div><div><small>باقی‌مانده</small><b>${Number(stats.remaining_gb||0).toFixed(1)} GB</b></div><div><small>Nodeهای اختصاصی</small><b>${Number(stats.assigned_nodes||0)}</b></div><div><small>دستگاه</small><b>${u.device_limit||0}</b></div><div><small>انقضا</small><b>${formatDate(u.expires_at)}</b></div></div>
      <div class="usage-label"><span>مصرف سهمیه</span><b>${pct.toFixed(0)}%</b></div><div class="progress"><i style="width:${pct}%"></i></div>
      <div class="detail-form"><label>Quota GB<input id="detail-quota" type="number" min="0" value="${Number(u.quota_gb||0)}"></label><label>Device limit<input id="detail-devices" type="number" min="1" value="${Number(u.device_limit||1)}"></label><label>تاریخ انقضا<input id="detail-expiry" type="datetime-local" value="${toLocalInput(u.expires_at)}"></label></div>
      ${sub?`<label class="subscription-link-field">لینک اشتراک<input id="detail-sub-link" readonly value="${esc(sub)}"><button class="ghost" onclick="copyText('detail-sub-link')">کپی</button></label>`:""}
      <div class="detail-actions"><button class="primary" onclick="saveUserDetail('${esc(u.id)}')">ذخیره تغییرات</button><button class="ghost" onclick="extendUser('${esc(u.id)}')">+ تمدید</button><button class="ghost" onclick="toggleUserStatus('${esc(u.id)}','${esc(u.status)}')">${u.status==="active"?"تعلیق":"فعال‌سازی"}</button><button class="ghost" onclick="loadUserConfigs('${esc(u.id)}')">کانفیگ‌ها</button></div>
      <div class="lifecycle-grid"><div class="panel-card mini"><div class="panel-title"><h4>Nodeهای اختصاصی</h4><button class="ghost small" onclick="alphaShowNodes('${esc(u.id)}')">مدیریت</button></div>${nodes.length?nodes.map(n=>`<div class="mini-row"><span><b>${esc(n.name)}</b><small>${esc(n.country||"—")} · ${esc(n.protocol||"—")}</small></span><span class="badge ${esc(n.status||"")}">${esc(n.status||"—")}</span></div>`).join(""):'<div class="empty-state">Node اختصاصی ندارد.</div>'}</div>
      <div class="panel-card mini"><div class="panel-title"><h4>یادداشت داخلی</h4></div><div class="note-compose"><textarea id="user-note-input" maxlength="1000" placeholder="یادداشت برای این کاربر…"></textarea><button class="primary small" onclick="addUserNote('${esc(u.id)}')">ثبت یادداشت</button></div><div class="notes-list">${notes.length?notes.slice(0,5).map(n=>`<div class="note-item"><b>${alphaDate(n.created_at)}</b><span>${esc(n.note)}</span></div>`).join(""):'<div class="empty-state">یادداشتی ثبت نشده.</div>'}</div></div></div>
      <div class="panel-card lifecycle-card"><div class="panel-title"><div><span class="eyebrow">LIFECYCLE</span><h4>تاریخچه اشتراک</h4></div></div><div class="timeline">${events.length?events.slice(0,12).map(e=>`<div class="timeline-item"><i></i><div><b>${esc(e.event_type)}</b><small>${alphaDate(e.created_at)}</small><span>${esc(e.details||"")}</span></div></div>`).join(""):'<div class="empty-state">تاریخچه‌ای ثبت نشده.</div>'}</div></div><div id="detail-configs" class="detail-configs hidden"></div>`;
  }catch(e){box.innerHTML=`<div class="empty-state">خطا در دریافت اطلاعات: ${esc(e.message||"خطا")}</div>`}
}
async function addUserNote(id){const input=$("user-note-input"),note=String(input?.value||"").trim();if(!note)return alphaToast("متن یادداشت خالی است","error");try{await api(`/api/users/${encodeURIComponent(id)}/notes`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({note})});alphaToast("یادداشت ثبت شد","success");await showUserDetail(id)}catch(e){alphaToast(e.message||"ثبت یادداشت ناموفق بود","error")}}

function toLocalInput(v){const t=parseExpiry(v);if(!t)return"";const d=new Date(t-Date.now()*0);const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
async function saveUserDetail(id){
  const quota=Number($("detail-quota")?.value||0),devices=Number($("detail-devices")?.value||1),expiry=$("detail-expiry")?.value;
  if(quota<0||devices<1)return alphaToast("مقادیر سهمیه و دستگاه معتبر نیستند","error");
  const body={quota_gb:quota,device_limit:devices}; if(expiry)body.expires_at=String(new Date(expiry).getTime());
  try{await api(`/api/users/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});alphaToast("اطلاعات کاربر ذخیره شد","success");await loadProUsers();await showUserDetail(id)}catch(e){alphaToast(e.message||"ذخیره ناموفق بود","error")}
}
async function loadUserConfigs(id){
  const box=$("detail-configs");if(!box)return;box.classList.remove("hidden");box.textContent="در حال دریافت کانفیگ‌ها…";
  try{const u=await api(`/api/users/${encodeURIComponent(id)}`),token=u.user?.subscription_token;if(!token){box.textContent="لینک اشتراک موجود نیست.";return}const r=await fetch(`${location.origin}/sub/${encodeURIComponent(token)}`);const data=await r.json();box.innerHTML=(data.configs||[]).length?`<pre>${esc((data.configs||[]).join("\n"))}</pre>`:'<span class="muted">کانفیگ فعالی برای این کاربر وجود ندارد.</span>'}catch(e){box.textContent="دریافت کانفیگ ناموفق بود."}
}
async function extendUser(id){const days=prompt("چند روز تمدید شود؟","30");if(!days)return;try{await api(`/api/users/${id}/extend`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({days:Number(days)})});alphaToast("اشتراک کاربر تمدید شد","success");await loadProUsers();await showUserDetail(id)}catch(e){alphaToast(e.message,"error")}}
async function toggleUserStatus(id,status){try{await api(`/api/users/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status:status==="active"?"suspended":"active"})});alphaToast("وضعیت کاربر بروزرسانی شد","success");await loadProUsers();await showUserDetail(id)}catch(e){alphaToast(e.message,"error")}}
function clearUserFilters(){if($("user-search"))$("user-search").value="";if($("user-status"))$("user-status").value="";if($("user-country"))$("user-country").value="";if($("user-sort"))$("user-sort").value="created_at";selectedUsers.clear();loadProUsers()}
function formatDate(v){const t=parseExpiry(v);if(!t)return"—";const d=new Date(t);return isNaN(d)?"—":d.toLocaleDateString("fa-IR")}
function exportUsersCSV(){
 const rows=[["username","protocol","country","quota_gb","used_gb","device_limit","status","expires_at"],...proUsers.map(u=>[u.username,u.protocol,u.country,u.quota_gb,u.used_gb,u.device_limit,u.status,u.expires_at])];
 const csv=rows.map(r=>r.map(x=>`"${String(x??"").replaceAll('"','""')}"`).join(",")).join("\n");
 const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download="alpha-users.csv";a.click();URL.revokeObjectURL(a.href)
}

try{document.addEventListener("click",e=>{const b=e.target.closest("[data-view=\"users\"]");if(b)setTimeout(loadProUsers,50)})}catch(e){}

let nodeTimer=null;
async function loadNodeMonitor(){
  const [r,s,o]=await Promise.all([api("/api/nodes"),api("/api/nodes/stats"),api("/api/nodes/operations")]);
  const el=$("nodes-monitor-list"); if(!el)return;
  const rows=Array.isArray(r)?r:(r.items||[]);
  const st=$("node-stats"); if(st)st.innerHTML=`<div class="stat-card"><small>کل Nodeها</small><b>${s.total}</b></div><div class="stat-card"><small>آماده سرویس</small><b class="ok-text">${o.ready}</b></div><div class="stat-card"><small>Maintenance</small><b>${o.maintenance}</b></div><div class="stat-card"><small>Drain</small><b>${o.draining}</b></div><div class="stat-card"><small>Offline</small><b class="bad-text">${s.offline}</b></div><div class="stat-card"><small>میانگین Latency</small><b>${s.avg_latency_ms} ms</b></div>`;
  el.innerHTML=rows.map(n=>nodeCard(n)).join("")||'<div class="empty-state">Nodeای ثبت نشده است.</div>';
  [...el.querySelectorAll('[data-node-history]')].forEach(x=>loadNodeHistory(x.dataset.nodeHistory,x));
}
function nodeCard(n){
 const cls=n.status==="online"?"node-online":"node-offline",age=n.updated_at?formatDateTime(n.updated_at):"—";
 const tags=(()=>{try{return JSON.parse(n.tags||"[]")}catch(_){return[]}})();
 const state=n.maintenance_mode?"Maintenance":(n.drain_mode?"Draining":(n.status==="online"?"Online":"Offline"));
 return `<article class="node-card ${cls}"><div class="node-card-head"><div><h3>${esc(n.name)}</h3><span class="muted">${esc(n.country||"—")} · ${esc(n.protocol)} · وزن ${Number(n.weight||100)}</span></div><span class="node-status">${state}</span></div><div class="node-metrics"><div><small>Latency</small><b>${n.latency_ms==null?"—":n.latency_ms+" ms"}</b></div><div><small>Last Seen</small><b>${age}</b></div><div><small>Uptime 24h</small><b data-node-history="${esc(n.id)}">در حال محاسبه…</b></div><div><small>Capacity</small><b>${Number(n.capacity||0)||"—"}</b></div></div><div class="node-health-strip"><span style="width:0%" data-node-healthbar="${esc(n.id)}"></span></div><div class="node-endpoint">${esc(n.endpoint)}</div><div class="node-tags">${tags.map(t=>`<span class="badge">${esc(t)}</span>`).join("")}</div><div class="node-actions"><button class="ghost small" onclick="checkNode('${esc(n.id)}')">Health Check</button><button class="ghost small" onclick="nodeOperation('${esc(n.id)}',${n.maintenance_mode?"\"maintenance_off\"":"\"maintenance_on\""})">${n.maintenance_mode?"خروج از Maintenance":"Maintenance"}</button><button class="ghost small" onclick="nodeOperation('${esc(n.id)}',${n.drain_mode?"\"drain_off\"":"\"drain_on\""})">${n.drain_mode?"پایان Drain":"Drain"}</button><button class="danger small" onclick="removeNode('${esc(n.id)}')">حذف</button></div></article>`
}
async function loadNodeHistory(id,el){try{const d=await api(`/api/nodes/${encodeURIComponent(id)}/history?hours=24`);if(d.uptime_pct==null){el.textContent="—";return}el.textContent=d.uptime_pct+"%";const sample=el.parentElement.parentElement.querySelector(`[data-node-samples="${CSS.escape(id)}"]`);if(sample)sample.textContent=(d.items||[]).length;const bar=el.closest('.node-card').querySelector(`[data-node-healthbar="${CSS.escape(id)}"]`);if(bar)bar.style.width=Math.min(100,Math.max(0,d.uptime_pct))+"%"}catch(_){el.textContent="—"}}
async function checkNode(id){try{await api(`/api/nodes/${encodeURIComponent(id)}/health`,{method:"POST"});$("node-last-check").textContent="آخرین بررسی: "+new Date().toLocaleTimeString("fa-IR");await loadNodeMonitor();alphaToast("Health Check انجام شد","success")}catch(e){alphaToast(e.message,"error")}}
async function checkAllNodes(){try{await api("/api/nodes/monitor",{method:"POST"});$("node-last-check").textContent="آخرین بررسی: "+new Date().toLocaleTimeString("fa-IR");await loadNodeMonitor();alphaToast("همه Nodeها بررسی شدند","success")}catch(e){alphaToast(e.message,"error")}}
function toggleAutoNodeCheck(on){if(nodeTimer)clearInterval(nodeTimer);nodeTimer=on?setInterval(checkAllNodes,60000):null}
async function alphaNodeOpsSummary(){try{const d=await api("/api/nodes/operations");alphaToast(`آماده: ${d.ready} · Maintenance: ${d.maintenance} · Drain: ${d.draining}`,"success")}catch(e){alphaToast(e.message||"دریافت وضعیت عملیات ناموفق بود","error")}}
async function nodeOperation(id,action,value){try{await api(`/api/nodes/${encodeURIComponent(id)}/operations`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,value})});await loadNodeMonitor();alphaToast("عملیات Node انجام شد","success")}catch(e){alphaToast(e.message||"عملیات ناموفق بود","error")}}
async function removeNode(id){if(!confirm("این Node حذف شود؟"))return;await api("/api/nodes/"+encodeURIComponent(id),{method:"DELETE"});await loadNodeMonitor()}
function formatDateTime(v){const d=new Date(Number(v));return isNaN(d)?"—":d.toLocaleString("fa-IR",{dateStyle:"short",timeStyle:"short"})}
document.addEventListener("click",e=>{const b=e.target.closest("[data-view='nodes']");if(b)setTimeout(loadNodeMonitor,50)})

/* ALPHA 6.1 — Subscription Center */
let alphaSubscriptions = [], alphaSelectedSubscriptions = new Set(), alphaSubPage = 1, alphaSubPageSize = 25, alphaSubTimer = null;
async function alphaLoadSubscriptions(){
  clearTimeout(alphaSubTimer); alphaSubTimer=setTimeout(async()=>{
    const q=encodeURIComponent(document.getElementById("alpha-sub-search")?.value||""),status=encodeURIComponent(document.getElementById("alpha-sub-status")?.value||""),sort=encodeURIComponent(document.getElementById("alpha-sub-sort")?.value||"created_at");
    try{const r=await api(`/api/subscriptions/advanced?q=${q}&status=${status}&sort=${sort}`);alphaSubscriptions=r.items||[];alphaSubPage=1;alphaRenderSubscriptions()}catch(e){const el=document.getElementById("alpha-sub-list");if(el)el.innerHTML=`<div class="empty-state">${alphaEsc(e.message||"خطا در دریافت اشتراک‌ها")}</div>`}
  },120);
}
function alphaRenderSubscriptions(){
  const list=$("alpha-sub-list"),stats=$("alpha-sub-stats");if(!list)return;
  const active=alphaSubscriptions.filter(x=>x.status==="active").length,suspended=alphaSubscriptions.filter(x=>x.status==="suspended").length,expiring=alphaSubscriptions.filter(x=>x.days_left!=null&&x.days_left>=0&&x.days_left<=7).length,totalQuota=alphaSubscriptions.reduce((n,x)=>n+Number(x.quota_gb||0),0),used=alphaSubscriptions.reduce((n,x)=>n+Number(x.used_gb||0),0);
  if(stats)stats.innerHTML=`<div><small>کل</small><b>${alphaSubscriptions.length}</b><span>اشتراک</span></div><div><small>فعال</small><b>${active}</b><span>در حال سرویس</span></div><div><small>نزدیک انقضا</small><b>${expiring}</b><span>تا ۷ روز</span></div><div><small>مصرف</small><b>${used.toFixed(1)} GB</b><span>از ${totalQuota.toFixed(1)} GB</span></div>`;
  if(!alphaSubscriptions.length){list.innerHTML='<div class="empty-state">اشتراکی پیدا نشد.</div>';alphaUpdateSubBulk();return}
  const pages=Math.max(1,Math.ceil(alphaSubscriptions.length/alphaSubPageSize));alphaSubPage=Math.min(alphaSubPage,pages);const start=(alphaSubPage-1)*alphaSubPageSize,rows=alphaSubscriptions.slice(start,start+alphaSubPageSize);
  list.innerHTML=`<table><thead><tr><th><input type="checkbox" ${rows.length&&rows.every(x=>alphaSelectedSubscriptions.has(x.id))?'checked':''} onchange="alphaToggleVisibleSubs(this.checked)"></th><th>کاربر</th><th>Quota</th><th>مصرف</th><th>باقی‌مانده</th><th>انقضا</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${rows.map(x=>`<tr><td><input type="checkbox" ${alphaSelectedSubscriptions.has(x.id)?"checked":""} onchange="alphaToggleSub('${alphaEsc(x.id)}',this.checked)"></td><td><strong>${alphaEsc(x.username)}</strong><small class="muted">${alphaEsc(x.protocol||"—")} · ${alphaEsc(x.country||"—")}</small></td><td>${Number(x.quota_gb||0)} GB</td><td>${Number(x.used_gb||0).toFixed(1)} GB</td><td>${Number(x.remaining_gb||0).toFixed(1)} GB</td><td>${alphaExpiry(x)}</td><td><span class="badge ${alphaEsc(x.status||"")}">${alphaEsc(x.status||"—")}</span></td><td><button class="ghost small" onclick="alphaRenewSubscription('${alphaEsc(x.id)}')">تمدید</button> <button class="ghost small" onclick="alphaShowNodes('${alphaEsc(x.id)}')">Nodeها</button></td></tr>`).join("")}</tbody></table>`;
  const range=$("alpha-sub-range");if(range)range.textContent=`${start+1} تا ${Math.min(start+alphaSubPageSize,alphaSubscriptions.length)} از ${alphaSubscriptions.length}`;alphaUpdateSubBulk();
}
function alphaChangeSubPage(delta){const pages=Math.max(1,Math.ceil(alphaSubscriptions.length/alphaSubPageSize));alphaSubPage=Math.max(1,Math.min(pages,alphaSubPage+delta));alphaRenderSubscriptions()}
function alphaToggleSub(id,on){on?alphaSelectedSubscriptions.add(id):alphaSelectedSubscriptions.delete(id);alphaUpdateSubBulk()}
function alphaToggleVisibleSubs(on){const start=(alphaSubPage-1)*alphaSubPageSize;alphaSubscriptions.slice(start,start+alphaSubPageSize).forEach(x=>on?alphaSelectedSubscriptions.add(x.id):alphaSelectedSubscriptions.delete(x.id));alphaRenderSubscriptions()}
function alphaUpdateSubBulk(){const b=$("alpha-sub-bulk"),n=$("alpha-sub-selected-count");if(b)b.classList.toggle("hidden",alphaSelectedSubscriptions.size===0);if(n)n.textContent=`${alphaSelectedSubscriptions.size} انتخاب`}
async function alphaBulkSubscription(action){const ids=[...alphaSelectedSubscriptions];if(!ids.length)return;if(action==="delete"&&!confirm("اشتراک‌های انتخاب‌شده حذف شوند؟"))return;try{await api("/api/subscriptions/bulk",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ids,action})});alphaSelectedSubscriptions.clear();alphaToast("عملیات گروهی انجام شد","success");await alphaLoadSubscriptions()}catch(e){alphaToast(e.message||"عملیات ناموفق بود","error")}}
function alphaExpiry(x){if(x.expires_at==null)return"بدون انقضا";if(x.days_left<0)return"منقضی";if(x.days_left<=7)return`${x.days_left} روز`;return new Date(Number(x.expires_at)).toLocaleDateString("fa-IR")}
async function alphaRenewSubscription(id){const raw=prompt("چند روز تمدید شود؟","30");if(raw===null)return;const days=Number(raw);if(!Number.isFinite(days)||days<1)return alphaToast("تعداد روز معتبر نیست","error");try{await api(`/api/subscriptions/${encodeURIComponent(id)}/renew`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({days})});alphaToast("اشتراک تمدید شد","success");await alphaLoadSubscriptions()}catch(e){alphaToast(e.message||"تمدید ناموفق بود","error")}}
async function alphaShowNodes(id){
  const box=$("subscription-node-content");if(!box)return;$("subscription-node-modal").classList.remove("hidden");box.innerHTML='<div class="detail-loading">در حال دریافت Nodeها…</div>';
  try{const [assigned,all]=await Promise.all([api(`/api/subscriptions/${encodeURIComponent(id)}/nodes`),api('/api/nodes')]);const allNodes=Array.isArray(all)?all:(all.items||[]);const ids=new Set((assigned.items||[]).map(x=>String(x.id)));box.innerHTML=`<div class="detail-head"><div><span class="eyebrow">SUBSCRIPTION NODES</span><h3>اتصال Nodeها</h3><span class="muted">Nodeهای فعال را برای این اشتراک انتخاب کن.</span></div></div><div class="node-select-list">${allNodes.map(n=>`<label><input type="checkbox" value="${alphaEsc(n.id)}" ${ids.has(String(n.id))?'checked':''}><span><b>${alphaEsc(n.name)}</b><small>${alphaEsc(n.country||'—')} · ${alphaEsc(n.protocol||'—')} · ${alphaEsc(n.status||'—')}</small></span></label>`).join('')||'<div class="empty-state">Nodeای وجود ندارد.</div>'}</div><div class="detail-actions"><button class="primary" onclick="alphaSaveSubscriptionNodes('${alphaEsc(id)}')">ذخیره Nodeها</button></div>`}catch(e){box.innerHTML=`<div class="empty-state">${alphaEsc(e.message||"خطا")}</div>`}
}
async function alphaSaveSubscriptionNodes(id){const box=$("subscription-node-content"),ids=[...box.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);try{await api(`/api/subscriptions/${encodeURIComponent(id)}/nodes`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({node_ids:ids})});alphaToast("Nodeهای اشتراک ذخیره شد","success");closeModal("subscription-node-modal")}catch(e){alphaToast(e.message||"ذخیره ناموفق بود","error")}}
function alphaExportSubscriptions(){const rows=[["username","protocol","country","quota_gb","used_gb","remaining_gb","status","expires_at"],...alphaSubscriptions.map(x=>[x.username,x.protocol,x.country,x.quota_gb,x.used_gb,x.remaining_gb,x.status,x.expires_at])];const csv=rows.map(row=>row.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="alpha-subscriptions.csv";a.click();URL.revokeObjectURL(a.href)}

document.addEventListener("DOMContentLoaded",()=>{const search=$("alpha-sub-search"),status=$("alpha-sub-status"),sort=$("alpha-sub-sort");if(search)search.addEventListener("input",alphaLoadSubscriptions);if(status)status.addEventListener("change",alphaLoadSubscriptions);if(sort)sort.addEventListener("change",alphaLoadSubscriptions);if($("subscription-center"))alphaLoadSubscriptions()});

function alphaEsc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

document.addEventListener("DOMContentLoaded", () => {
  const search = document.getElementById("alpha-sub-search");
  const status = document.getElementById("alpha-sub-status");
  const sort = document.getElementById("alpha-sub-sort");
  if (search) search.addEventListener("input", alphaLoadSubscriptions);
  if (status) status.addEventListener("change", alphaLoadSubscriptions);
  if (sort) sort.addEventListener("change", alphaLoadSubscriptions);
  if (document.getElementById("subscription-center")) alphaLoadSubscriptions();
});


/* Alpha v2.9 Security + Audit Center */
async function alphaSecurityCheck(){
  const box=document.getElementById("alpha-security-status");
  if(!box)return;
  try{
    const r=await api("/api/security/status");
    box.innerHTML=(r.checks||[]).map(x=>`
      <div class="security-card ${x.ok?"ok":"bad"}">
        <span>${x.ok?"✓":"!"}</span><div><b>${alphaEsc(x.label)}</b><small>${x.ok?"فعال":"نیازمند بررسی"}</small></div>
      </div>`).join("");
  }catch(e){box.innerHTML='<div class="security-card bad"><span>!</span><div><b>Security check failed</b><small>دوباره تلاش کن</small></div></div>'}
}
async function alphaLoadSecurityOverview(){
  const box=document.getElementById("alpha-security-overview"); if(!box)return;
  try{
    const d=await api("/api/security/overview");
    const events=d.events||[];
    box.innerHTML=`<div class="security-overview-grid">
      <div class="security-metric"><span>Session فعال</span><b>${Number(d.sessions?.active||0)}</b><small>اعتبار ۲۴ ساعته</small></div>
      <div class="security-metric"><span>تلاش ناموفق</span><b>${Number(d.authentication?.failed_attempts||0)}</b><small>ثبت‌شده در Rate Limit</small></div>
      <div class="security-metric"><span>IP مسدود</span><b>${Number(d.authentication?.blocked_ips||0)}</b><small>در حال حاضر</small></div>
      <div class="security-metric"><span>Cookie</span><b>Secure</b><small>HttpOnly · SameSite Strict</small></div>
    </div>
    <div class="panel-card security-events"><div class="panel-title"><div><span class="eyebrow">SECURITY EVENTS</span><h3>رویدادهای حساس اخیر</h3></div></div>
      ${events.length?`<div class="security-event-list">${events.map(x=>`<div class="security-event"><code>${alphaEsc(x.action||"")}</code><span>${alphaEsc(x.actor||"")}</span><small>${alphaEsc(x.details||"")} · ${alphaDate(x.created_at)}</small></div>`).join("")}</div>`:'<div class="empty-state">رویداد امنیتی ثبت‌شده‌ای وجود ندارد.</div>'}
    </div>`;
  }catch(e){box.innerHTML='<div class="empty-state">دریافت وضعیت امنیتی ناموفق بود.</div>'}
}

async function alphaLoadAudit(){
  const box=document.getElementById("alpha-audit-list");
  if(!box)return;
  const q=encodeURIComponent((document.getElementById("alpha-audit-search")||{}).value||"");
  const limit=Number(document.getElementById("alpha-audit-limit")?.value||100);
  const action=document.getElementById("alpha-audit-action")?.value||"";
  try{
    const r=await api(`/api/audit?q=${q}&limit=${limit}`);
    let rows=(r.items||[]);
    if(action) rows=rows.filter(x=>String(x.action||"")===action);
    const select=document.getElementById("alpha-audit-action");
    if(select && select.options.length===1){
      [...new Set((r.items||[]).map(x=>String(x.action||"")).filter(Boolean))].sort().forEach(a=>{const o=document.createElement("option");o.value=a;o.textContent=a;select.appendChild(o)});
      if(action)select.value=action;
    }
    box.innerHTML=rows.length?`<table><thead><tr><th>زمان</th><th>Action</th><th>Actor</th><th>Details</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${alphaDate(x.created_at)}</td><td><code>${alphaEsc(x.action||"")}</code></td><td>${alphaEsc(x.actor||"")}</td><td>${alphaEsc(x.details||"")}</td></tr>`).join("")}</tbody></table>`:'<div class="empty-state">Audit log خالی است.</div>';
  }catch(e){box.innerHTML='<div class="empty-state">خطا در دریافت Audit log</div>'}
}
function alphaDate(v){try{return new Date(Number(v)).toLocaleString("fa-IR")}catch(_){return"—"}}
async function alphaBackupDownload(){
  try{
    const data=await api("/api/backup/export");
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`alpha-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);
    alphaToast?.("Backup آماده شد","success");
  }catch(e){alphaToast?.("Backup دریافت نشد","error")}
}
async function alphaBackupPreview(){
  const box=document.getElementById("alpha-backup-info"); if(!box)return;
  box.textContent="در حال بررسی…";
  try{
    const data=await api("/api/backup/export");
    const tables=Object.entries(data).filter(([k,v])=>Array.isArray(v)).map(([k,v])=>`${k}: ${v.length}`);
    box.innerHTML=`<b>Backup سالم و قابل خواندن است.</b><span>${alphaEsc(tables.join(" · ")||"داده‌ای برای export وجود ندارد")}</span>`;
  }catch(e){box.innerHTML='<b>بررسی Backup ناموفق بود.</b>'}
}
document.addEventListener("DOMContentLoaded",()=>{
  const audit=document.getElementById("alpha-audit-search"), action=document.getElementById("alpha-audit-action"), limit=document.getElementById("alpha-audit-limit");
  if(audit)audit.addEventListener("input",alphaLoadAudit);
  if(action)action.addEventListener("change",alphaLoadAudit);
  if(limit)limit.addEventListener("change",alphaLoadAudit);
  if(document.getElementById("security-center")){alphaSecurityCheck();alphaLoadAudit();alphaLoadSecurityOverview();}
});


let alphaPendingRestore=null;
async function alphaLoadBackupManifests(){
  const box=document.getElementById("alpha-backup-manifests"); if(!box)return;
  try{const d=await api("/api/backup/manifest"); const rows=d.items||[]; box.innerHTML=rows.length?`<table><thead><tr><th>زمان</th><th>Checksum</th><th>Tables</th><th>Rows</th><th>یادداشت</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${alphaDate(x.created_at)}</td><td><code>${alphaEsc(String(x.checksum||"").slice(0,24))}…</code></td><td>${x.table_count}</td><td>${x.row_count}</td><td>${alphaEsc(x.notes||"")}</td></tr>`).join("")}</tbody></table>`:'<div class="empty-state">Manifest ثبت نشده است.</div>'}catch(e){box.innerHTML='<div class="empty-state">Manifest در دسترس نیست.</div>'}
}
async function alphaCreateBackupManifest(){
  try{const d=await api("/api/backup/manifest",{method:"POST",body:JSON.stringify({notes:"manual backup manifest"})}); alphaToast?.("Manifest ثبت شد","success"); await alphaLoadBackupManifests(); return d}catch(e){alphaToast?.("ثبت Manifest ناموفق بود","error")}
}
async function alphaPrepareRestore(input){
  alphaPendingRestore=null; const btn=document.getElementById("alpha-restore-btn"), box=document.getElementById("alpha-restore-info"); if(btn)btn.disabled=true; if(!input?.files?.[0])return;
  try{const text=await input.files[0].text(), data=JSON.parse(text); if(data.format!=="ALPHA-BACKUP"||!data.tables)throw new Error("فرمت Backup معتبر نیست"); const counts=Object.entries(data.tables).filter(([k,v])=>Array.isArray(v)).map(([k,v])=>`${k}: ${v.length}`).join(" · "); alphaPendingRestore=data; if(box)box.innerHTML=`<b>Backup معتبر است.</b><span>${alphaEsc(counts)}</span><small>Restore داده‌های مدیریتی را جایگزین می‌کند.</small>`; if(btn)btn.disabled=false}catch(e){if(box)box.innerHTML=`<b>فایل نامعتبر است.</b> <span>${alphaEsc(e.message||"")}</span>`}
}
async function alphaRestoreBackup(){
  if(!alphaPendingRestore)return; const ok=confirm("این عملیات داده‌های مدیریتی را با Backup جایگزین می‌کند. ادامه می‌دهید؟"); if(!ok)return;
  try{const data={...alphaPendingRestore,confirm:"ALPHA-RESTORE"}; await api("/api/backup/restore",{method:"POST",body:JSON.stringify(data)}); alphaToast?.("Restore با موفقیت انجام شد","success"); alphaPendingRestore=null; const btn=document.getElementById("alpha-restore-btn"); if(btn)btn.disabled=true; await alphaLoadBackupManifests(); dash();}catch(e){alphaToast?.(e.message||"Restore ناموفق بود","error")}
}

/* Alpha 6.7 Reports Center */

async function alphaLoadPerformance(){
  const k=$("alpha-performance-kpis"), probes=$("alpha-performance-probes"), tips=$("alpha-performance-tips");
  if(!k)return;
  k.innerHTML='<div class="monitor-loading">در حال اندازه‌گیری Performance…</div>';
  try{
    const d=await api("/api/performance/overview");
    k.innerHTML=`<div class="performance-kpi"><span>وضعیت</span><b>${d.ok?'HEALTHY':'DEGRADED'}</b><small>Probeهای موفق ${d.probes.filter(x=>x.ok).length}/${d.probes.length}</small></div><div class="performance-kpi"><span>زمان کل Probe</span><b>${d.total_ms} ms</b><small>اندازه‌گیری سمت Worker</small></div><div class="performance-kpi"><span>Page Size</span><b>${d.pagination.users_max_page_size}</b><small>حداکثر کاربران در هر صفحه</small></div><div class="performance-kpi"><span>Client Cache</span><b>${d.cache.ttl_seconds}s</b><small>برای GETهای Performance</small></div>`;
    probes.innerHTML=(d.probes||[]).map(x=>`<div class="performance-probe ${x.ok?'ok':'error'}"><span>${x.ok?'✓':'!'}</span><div><b>${esc(x.name)}</b><small>${esc(String(x.value??x.error??''))}</small></div><strong>${x.ms} ms</strong></div>`).join('');
    tips.innerHTML=(d.recommendations||[]).map(x=>`<div class="performance-tip">✓ <span>${esc(x)}</span></div>`).join('');
  }catch(e){k.innerHTML=`<div class="monitor-loading error">${esc(e.message||'Performance در دسترس نیست')}</div>`;alphaToast(e.message||'خطا در Performance','error')}
}

async function alphaLoadMonitoring(){
  const k=$("alpha-monitoring-kpis"), services=$("alpha-monitoring-services"), incidents=$("alpha-monitoring-incidents"), nodes=$("alpha-monitoring-nodes"), state=$("alpha-monitoring-state");
  if(!k)return; k.innerHTML='<div class="monitor-loading">در حال جمع‌آوری Metrics…</div>';
  try{
    const d=await api("/api/monitoring/overview");
    const uptime= d.nodes.total ? Math.round(d.nodes.online/d.nodes.total*100) : 100;
    k.innerHTML=`<div class="monitor-kpi"><span>وضعیت سیستم</span><b>${d.overall==='healthy'?'HEALTHY':'DEGRADED'}</b><small>سرویس‌های بررسی‌شده: ${d.service_count}</small></div><div class="monitor-kpi"><span>Node Uptime</span><b>${uptime}%</b><small>${d.nodes.online}/${d.nodes.total} آنلاین</small></div><div class="monitor-kpi"><span>Latency</span><b>${d.nodes.avg_latency_ms||0} ms</b><small>میانگین Nodeهای آنلاین</small></div><div class="monitor-kpi"><span>Error Rate</span><b>${d.error_rate}%</b><small>${d.error_events_24h} رخداد خطا / ۲۴ ساعت</small></div><div class="monitor-kpi"><span>Activity</span><b>${d.activity_24h}</b><small>رویداد در ۲۴ ساعت</small></div><div class="monitor-kpi"><span>Webhook Failures</span><b>${d.webhooks.failed_deliveries}</b><small>تحویل ناموفق / ۲۴ ساعت</small></div>`;
    state.textContent=d.overall==='healthy'?'HEALTHY':'DEGRADED'; state.className=`badge ${d.overall==='healthy'?'active':'warning'}`;
    services.innerHTML=(d.checks||[]).map(x=>`<div class="monitor-service"><span class="service-dot ${x.status}"></span><div><b>${esc(x.name)}</b><small>${esc(x.value)}</small></div><strong>${x.latency_ms} ms</strong></div>`).join('');
    incidents.innerHTML=(d.recent_incidents||[]).map(x=>`<div class="incident-row"><span class="incident-dot"></span><div><b>${esc(x.action)}</b><small>${esc(x.details||'')} · ${esc(x.actor||'')}</small></div><time>${alphaDate(x.created_at)}</time></div>`).join('')||'<div class="empty-state">در ۲۴ ساعت اخیر رخداد مهمی ثبت نشده است.</div>';
    nodes.innerHTML=`<div class="node-health-big"><b>${d.nodes.online}</b><span>Online</span></div><div class="node-health-big bad"><b>${d.nodes.offline}</b><span>Offline</span></div><div class="node-health-bar"><i style="width:${uptime}%"></i></div><small>${d.nodes.total} Node · میانگین latency ${d.nodes.avg_latency_ms||0}ms</small>`;
  }catch(e){k.innerHTML=`<div class="monitor-loading error">${esc(e.message||'Monitoring در دسترس نیست')}</div>`;alphaToast(e.message||'خطا در Monitoring','error')}
}
async function alphaLoadReports(){
  const days=Number(document.getElementById("alpha-report-days")?.value||7);
  try{
    const d=await api(`/api/reports/summary?days=${days}`);
    const cards=[
      ["کاربران",d.users.total,`${d.users.active_rate}% فعال`],
      ["مصرف",`${Number(d.users.used_gb).toFixed(1)} GB`,`${d.users.quota_usage}% از سهمیه کل`],
      ["Node",`${d.nodes.online}/${d.nodes.total}`,`${d.nodes.avg_latency_ms} ms میانگین`],
      ["رشد ترافیک",`${d.traffic.delta_gb>=0?"+":""}${d.traffic.delta_gb.toFixed(2)} GB`,`${d.traffic.points} Snapshot`],
      ["فعالیت",d.activity,`در ${days} روز`],
      ["اعلان باز",d.unread_notifications,"نیازمند پیگیری"]
    ];
    const box=document.getElementById("alpha-report-kpis");if(box)box.innerHTML=cards.map(x=>`<div class="report-kpi"><span>${alphaEsc(x[0])}</span><b>${alphaEsc(x[1])}</b><small>${alphaEsc(x[2])}</small></div>`).join("");
    const note=document.getElementById("alpha-report-note");if(note)note.textContent=`گزارش ${days} روزه · آخرین بروزرسانی ${new Date(d.generated_at).toLocaleString("fa-IR")}`;
  }catch(e){alphaToast(e.message||"گزارش در دسترس نیست","error")}
}
function alphaDownloadReport(type){
  const days=Number(document.getElementById("alpha-report-days")?.value||30);
  const a=document.createElement("a");a.href=`/api/reports/export?type=${encodeURIComponent(type)}&days=${days}`;a.download="";document.body.appendChild(a);a.click();a.remove();alphaToast("Export شروع شد","success");
}


/* Alpha v3.0 Production + PWA */
let alphaDeferredInstall=null;
async function alphaProductionCheck(){
  const box=document.getElementById("alpha-prod-grid"); if(!box)return;
  let security={checks:[]}, nodes={};
  try{security=await api("/api/security/status")}catch(_){}
  try{nodes=await api("/api/nodes/stats")}catch(_){}
  const secure=(security.checks||[]).filter(x=>x.ok).length, total=(security.checks||[]).length;
  const online=nodes.online ?? nodes.online_count ?? "—";
  const all=nodes.total ?? nodes.total_count ?? "—";
  box.innerHTML=[
    ["Security",`${secure}/${total||"—"}`,"security"],
    ["Nodes",`${online}/${all}`,"nodes"],
    ["PWA",navigator.serviceWorker?"Enabled":"Unavailable","pwa"],
    ["HTTPS",location.protocol==="https:"||location.hostname==="localhost"?"Secure":"Check","tls"]
  ].map(x=>`<div class="alpha-prod-stat"><small>${x[0]}</small><b>${alphaEsc(x[1])}</b><span>${x[2]}</span></div>`).join("");
}
async function alphaInstallPWA(){
  if(alphaDeferredInstall){alphaDeferredInstall.prompt();await alphaDeferredInstall.userChoice;alphaDeferredInstall=null;return}
  alert("در این مرورگر گزینه نصب PWA در دسترس نیست؛ از منوی مرورگر گزینه Install/Add to Home Screen را انتخاب کن.");
}
if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();alphaDeferredInstall=e});
document.addEventListener("DOMContentLoaded",()=>{if(document.getElementById("alpha-production"))alphaProductionCheck()});


/* Alpha v3.1 Control Center */
async function alphaRefreshControlCenter(){
  const box=document.getElementById("alpha-settings-health");
  if(box){
    try{
      const r=await api("/api/settings/health");
      box.innerHTML=(r.checks||[]).map(x=>`<div class="alpha-settings-stat"><small>${alphaEsc(x.key)}</small><b>${x.value?"OK":"CHECK"}</b></div>`).join("")+
      `<div class="alpha-settings-stat"><small>Version</small><b>${alphaEsc(r.version||"6.3.0")}</b></div>`;
    }catch(e){box.innerHTML='<div class="alpha-settings-stat"><b>Health check failed</b></div>'}
  }
  alphaLoadAdmins();
}
async function alphaLoadAdmins(){
  const box=document.getElementById("alpha-admin-list"); if(!box)return;
  try{
    const r=await api("/api/admin/roles");
    const rows=r.items||[];
    box.innerHTML=rows.length?`<table><thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>${
      rows.map(x=>`<tr><td>${alphaEsc(x.username)}</td><td><select onchange="alphaUpdateAdmin('${alphaEsc(x.id)}',{role:this.value})"><option ${x.role==="viewer"?"selected":""}>viewer</option><option ${x.role==="operator"?"selected":""}>operator</option><option ${x.role==="admin"?"selected":""}>admin</option><option ${x.role==="owner"?"selected":""}>owner</option></select></td><td>${alphaEsc(x.status)}</td><td><button class="ghost small" onclick="alphaToggleAdmin('${alphaEsc(x.id)}','${alphaEsc(x.status)}')">${x.status==="active"?"Suspend":"Activate"}</button></td></tr>`).join("")
    }</tbody></table>`:'<div class="empty-state">ادمینی ثبت نشده است.</div>';
  }catch(e){box.innerHTML='<div class="empty-state">Admin API در دسترس نیست.</div>'}
}
async function alphaCreateAdmin(){
  const username=(document.getElementById("alpha-admin-name")||{}).value||"";
  const role=(document.getElementById("alpha-admin-role")||{}).value||"viewer";
  if(!username.trim())return alert("نام کاربری را وارد کن.");
  await api("/api/admin/roles",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,role})});
  document.getElementById("alpha-admin-name").value="";
  alphaLoadAdmins();
  alphaToast?.("ادمین اضافه شد","success");
}
async function alphaUpdateAdmin(id,body){
  await api(`/api/admin/roles/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  alphaToast?.("دسترسی بروزرسانی شد","success");
}
async function alphaToggleAdmin(id,status){
  await alphaUpdateAdmin(id,{status:status==="active"?"suspended":"active"}); alphaLoadAdmins();
}
document.addEventListener("DOMContentLoaded",()=>{if(document.getElementById("alpha-settings-center"))alphaRefreshControlCenter()});


/* Alpha v3.2 UI/UX + Notifications */
function alphaApplyTheme(settings){
  document.documentElement.dataset.theme=settings.theme||"dark";
  document.documentElement.dataset.accent=settings.accent||"cyan";
  document.body.classList.toggle("alpha-compact",settings.compact_mode==="1");
  document.body.dataset.density=settings.dashboard_density||"comfortable";
  if(settings.language) document.documentElement.lang=settings.language;
  if(settings.timezone) document.documentElement.dataset.timezone=settings.timezone;
  try{localStorage.setItem("alpha.workspace",JSON.stringify(settings));}catch(_){ }
  alphaApplyDashboardWidgets(settings.dashboard_widgets);
} 
function alphaApplyDashboardWidgets(raw){
  let cfg={}; try{cfg=typeof raw==="string"?JSON.parse(raw||"{}"):raw||{};}catch(_){cfg={};}
  Object.entries(cfg).forEach(([id,visible])=>{const el=document.getElementById(id);if(el)el.classList.toggle("hidden",visible===false);});
}
function alphaToggleWorkspaceWidget(id,checked){
  const el=document.getElementById(id); if(el)el.classList.toggle("hidden",!checked);
}
async function alphaLoadUISettings(){
  try{
    const r=await api("/api/panel/settings"),s=r.settings||{};
    const map={name:"panel_name",channel:"channel",creator:"creator",theme:"theme",accent:"accent",language:"language",timezone:"timezone",density:"dashboard_density",shortcut:"shortcut_profile"};
    Object.entries(map).forEach(([id,key])=>{const el=document.getElementById("alpha-set-"+id);if(el)el.value=s[key]||""});
    const c=document.getElementById("alpha-set-compact"),n=document.getElementById("alpha-set-notify");
    if(c)c.checked=s.compact_mode==="1"; if(n)n.checked=s.notifications!=="0";
    const widgets=(()=>{try{return JSON.parse(s.dashboard_widgets||"{}")}catch(_){return {}}})();
    document.querySelectorAll("[data-workspace-widget]").forEach(el=>{const id=el.dataset.workspaceWidget; const v=widgets[id]!==false; const cb=document.getElementById("alpha-widget-"+id); if(cb)cb.checked=v;});
    alphaApplyTheme(s);
  }catch(_){}
}
async function alphaSaveUISettings(){
  const body={
    panel_name:document.getElementById("alpha-set-name")?.value||"ALPHA",
    channel:document.getElementById("alpha-set-channel")?.value||"@V2rayTun0",
    creator:document.getElementById("alpha-set-creator")?.value||"@Mehtif",
    theme:document.getElementById("alpha-set-theme")?.value||"dark",
    accent:document.getElementById("alpha-set-accent")?.value||"cyan",
    compact_mode:document.getElementById("alpha-set-compact")?.checked?"1":"0",
    notifications:document.getElementById("alpha-set-notify")?.checked?"1":"0",
    language:document.getElementById("alpha-set-language")?.value||"fa",
    timezone:document.getElementById("alpha-set-timezone")?.value||"Asia/Tehran",
    dashboard_density:document.getElementById("alpha-set-density")?.value||"comfortable",
    shortcut_profile:document.getElementById("alpha-set-shortcut")?.value||"default",
    dashboard_widgets:JSON.stringify(Object.fromEntries([...document.querySelectorAll("[data-workspace-widget]")].map(el=>[el.dataset.workspaceWidget,document.getElementById("alpha-widget-"+el.dataset.workspaceWidget)?.checked!==false])) )
  };
  const r=await api("/api/panel/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  alphaApplyTheme(r.settings||body);
  alphaToast?.("Workspace با موفقیت ذخیره شد","success");
}
function alphaResetWorkspace(){
  ["alpha-set-theme","alpha-set-accent","alpha-set-language","alpha-set-timezone","alpha-set-density","alpha-set-shortcut"].forEach(id=>{const el=document.getElementById(id);if(el)el.selectedIndex=0;});
  const c=document.getElementById("alpha-set-compact"),n=document.getElementById("alpha-set-notify"); if(c)c.checked=false;if(n)n.checked=true;
  document.querySelectorAll("[data-workspace-widget]").forEach(el=>{const cb=document.getElementById("alpha-widget-"+el.dataset.workspaceWidget);if(cb)cb.checked=true;alphaToggleWorkspaceWidget(el.dataset.workspaceWidget,true);});
  alphaToast?.("تنظیمات Workspace بازنشانی شد","success");
}
function alphaSaveFilter(name,value){try{const x=JSON.parse(localStorage.getItem("alpha.savedFilters")||"{}");x[name]=value;localStorage.setItem("alpha.savedFilters",JSON.stringify(x));alphaToast?.("فیلتر ذخیره شد","success");}catch(_){} }
async function alphaLoadNotifications(){
  try{
    const r=await api("/api/notifications"),items=r.items||[],unread=items.filter(x=>!x.is_read).length;
    const count=document.getElementById("alpha-notif-count");if(count){count.textContent=unread>99?"99+":unread;count.classList.toggle("hidden",unread===0)}
    const box=document.getElementById("alpha-notif-list");if(!box)return;
    box.innerHTML=items.length?items.map(x=>`<div class="alpha-notif ${x.is_read?"read":""}" onclick="alphaReadNotification('${alphaEsc(x.id)}')"><b>${alphaEsc(x.title)}</b><small>${alphaEsc(x.message)}</small><time>${alphaDate(x.created_at)}</time></div>`).join(""):'<div class="empty-state">اعلانی وجود ندارد.</div>';
  }catch(_){}
}
function alphaToggleNotifications(){document.getElementById("alpha-notification-drawer")?.classList.toggle("hidden");alphaLoadNotifications()}
async function alphaReadNotification(id){await api(`/api/notifications/${encodeURIComponent(id)}/read`,{method:"POST"});alphaLoadNotifications()}
async function alphaReadAllNotifications(){await api("/api/notifications/read-all",{method:"POST"});alphaLoadNotifications()}
document.addEventListener("DOMContentLoaded",()=>{alphaLoadUISettings();alphaLoadNotifications()});


/* Alpha 6.9 Automation Center */
function alphaJobLabel(type){return ({health_check:"Node Health Check",traffic_snapshot:"Traffic Snapshot",notifications_sync:"Alert Sync",cleanup:"Data Cleanup"}[type]||type)}
function alphaJobTime(v){return v?new Date(Number(v)).toLocaleString("fa-IR",{dateStyle:"short",timeStyle:"short"}):"—"}
async function alphaLoadJobs(){
  const list=document.getElementById("alpha-job-list"), runs=document.getElementById("alpha-job-runs"), k=document.getElementById("alpha-jobs-kpis");
  if(!list)return;
  try{
    const d=await api("/api/jobs"),jobs=d.jobs||[],recent=d.recent_runs||[];
    const enabled=jobs.filter(x=>x.enabled).length,failed=jobs.filter(x=>x.last_status==="failed").length,totalRuns=jobs.reduce((n,x)=>n+Number(x.run_count||0),0);
    if(k)k.innerHTML=`<div class="intel-card"><span>Job فعال</span><b>${enabled}</b><small>از ${jobs.length} Job</small></div><div class="intel-card"><span>اجرای موفق</span><b>${Math.max(0,totalRuns-jobs.reduce((n,x)=>n+Number(x.fail_count||0),0))}</b><small>در مجموع</small></div><div class="intel-card"><span>Job خطادار</span><b>${failed}</b><small>نیازمند بررسی</small></div><div class="intel-card"><span>آخرین اجرا</span><b>${recent[0]?alphaJobTime(recent[0].finished_at):"—"}</b><small>Automation</small></div>`;
    list.innerHTML=jobs.length?jobs.map(j=>`<div class="alpha-job-card ${j.last_status==='failed'?'job-failed':''}"><div class="job-main"><div class="job-icon">${j.type==='health_check'?'♥':j.type==='traffic_snapshot'?'◫':j.type==='notifications_sync'?'!':'⌘'}</div><div><b>${alphaEsc(j.name||alphaJobLabel(j.type))}</b><small>${alphaEsc(alphaJobLabel(j.type))} · هر ${Number(j.interval_minutes)} دقیقه</small></div></div><div class="job-meta"><span class="badge ${j.enabled?'active':''}">${j.enabled?'فعال':'متوقف'}</span><small>آخرین اجرا: ${alphaJobTime(j.last_run_at)}</small><small>موعد بعدی: ${j.enabled?alphaJobTime(j.next_run_at):'—'}</small><small>موفق: ${Number(j.run_count||0)-Number(j.fail_count||0)} · خطا: ${Number(j.fail_count||0)}</small></div><div class="job-actions"><button class="ghost small" onclick="alphaRunJob('${alphaEsc(j.id)}')">▶ اجرا</button><button class="ghost small" onclick="alphaToggleJob('${alphaEsc(j.id)}',${j.enabled?'false':'true'})">${j.enabled?'⏸ توقف':'▶ فعال'}</button><button class="ghost small" onclick="alphaEditJob('${alphaEsc(j.id)}',${Number(j.interval_minutes)})">⏱ Interval</button></div>${j.last_error?`<div class="job-error">${alphaEsc(j.last_error)}</div>`:''}</div>`).join(''):'<div class="empty-state">Jobای ثبت نشده است.</div>';
    runs.innerHTML=recent.length?`<div class="table-wrap"><table><thead><tr><th>Job</th><th>شروع</th><th>وضعیت</th><th>مدت</th><th>جزئیات</th></tr></thead><tbody>${recent.map(r=>{const j=jobs.find(x=>x.id===r.job_id);return `<tr><td>${alphaEsc(j?.name||r.job_id)}</td><td>${alphaJobTime(r.started_at)}</td><td><span class="badge ${r.status==='success'?'active':''}">${r.status==='success'?'SUCCESS':r.status==='failed'?'FAILED':'RUNNING'}</span></td><td>${r.duration_ms!=null?Number(r.duration_ms)+' ms':'—'}</td><td>${alphaEsc(r.error||r.details||'—')}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty-state">اجرایی ثبت نشده است.</div>';
  }catch(e){list.innerHTML=`<div class="empty-state">${alphaEsc(e.message||"Automation API در دسترس نیست.")}</div>`}
}
async function alphaRunJob(id){try{const r=await api(`/api/jobs/${encodeURIComponent(id)}/run`,{method:"POST"});alphaToast(r.ok?"Job با موفقیت اجرا شد":"Job با خطا اجرا شد",r.ok?"success":"error");await alphaLoadJobs()}catch(e){alphaToast(e.message||"اجرای Job ناموفق بود","error");await alphaLoadJobs()}}
async function alphaToggleJob(id,enabled){try{await api(`/api/jobs/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({enabled})});alphaToast(enabled?"Job فعال شد":"Job متوقف شد","success");await alphaLoadJobs()}catch(e){alphaToast(e.message,"error")}}
async function alphaEditJob(id,current){const raw=prompt("Interval به دقیقه (حداقل ۵):",String(current));if(raw===null)return;const n=Number(raw);if(!Number.isFinite(n)||n<5)return alphaToast("Interval معتبر نیست","error");try{await api(`/api/jobs/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({interval_minutes:n})});alphaToast("Interval ذخیره شد","success");await alphaLoadJobs()}catch(e){alphaToast(e.message,"error")}}
async function alphaRunDueJobsNow(){try{const r=await api("/api/jobs/run-due",{method:"POST"});alphaToast(`${Number(r.count||0)} Job اجرا شد`,"success");await alphaLoadJobs()}catch(e){alphaToast(e.message||"اجرای Jobها ناموفق بود","error")}}


/* Alpha 6.11 API & Integration Center */
async function alphaLoadIntegrations(){
  try{
    const [o,k,w]=await Promise.all([api("/api/integrations/overview"),api("/api/integrations/api-keys"),api("/api/integrations/webhooks")]);
    const ko=document.getElementById("alpha-integration-kpis"),kb=document.getElementById("alpha-api-keys"),wb=document.getElementById("alpha-webhooks");
    if(ko)ko.innerHTML=`<div class="intel-card"><span>API Key فعال</span><b>${o.api_keys.enabled}</b><small>از ${o.api_keys.total}</small></div><div class="intel-card"><span>API Usage</span><b>${o.api_keys.usage}</b><small>درخواست‌های ثبت‌شده</small></div><div class="intel-card"><span>Webhook فعال</span><b>${o.webhooks.enabled}</b><small>از ${o.webhooks.total}</small></div><div class="intel-card"><span>Delivery موفق</span><b>${o.deliveries24h.success}/${o.deliveries24h.total}</b><small>۲۴ ساعت اخیر</small></div>`;
    kb.innerHTML=(k.items||[]).length?(k.items||[]).map(x=>`<div class="integration-row"><div><b>${alphaEsc(x.name)}</b><small>${alphaEsc(x.key_prefix)} · ${alphaEsc((x.scopes||[]).join(", "))}</small><small>استفاده: ${Number(x.usage_count)} · آخرین استفاده: ${x.last_used_at?alphaDate(x.last_used_at):"—"}</small></div><div class="job-actions"><span class="badge ${x.enabled?'active':''}">${x.enabled?'فعال':'متوقف'}</span><button class="ghost small" onclick="alphaToggleApiKey('${x.id}',${x.enabled?'false':'true'})">${x.enabled?'توقف':'فعال'}</button><button class="danger small" onclick="alphaDeleteApiKey('${x.id}')">حذف</button></div></div>`).join(""):"<div class='empty-state'>API Keyای وجود ندارد.</div>";
    wb.innerHTML=(w.items||[]).length?(w.items||[]).map(x=>`<div class="integration-row"><div><b>${alphaEsc(x.name)}</b><small>${alphaEsc(x.url)}</small><small>رویدادها: ${alphaEsc((x.events||[]).join(", "))} · خطا: ${Number(x.failure_count)}</small></div><div class="job-actions"><span class="badge ${x.enabled?'active':''}">${x.enabled?'فعال':'متوقف'}</span><button class="ghost small" onclick="alphaTestWebhook('${x.id}')">تست</button><button class="ghost small" onclick="alphaToggleWebhook('${x.id}',${x.enabled?'false':'true'})">${x.enabled?'توقف':'فعال'}</button><button class="danger small" onclick="alphaDeleteWebhook('${x.id}')">حذف</button></div></div>`).join(""):"<div class='empty-state'>Webhookای وجود ندارد.</div>";
  }catch(e){alphaToast(e.message||"Integration API در دسترس نیست","error")}
}
async function alphaCreateApiKey(){const name=prompt("نام API Key:","My Integration");if(!name)return;const scope=prompt("Scope (read / write / *):","read");if(!scope)return;try{const r=await api("/api/integrations/api-keys",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,scopes:[scope]})});prompt("API Key — این مقدار را در جای امن ذخیره کن:",r.secret);alphaToast("API Key ساخته شد","success");alphaLoadIntegrations()}catch(e){alphaToast(e.message,"error")}}
async function alphaToggleApiKey(id,enabled){try{await api(`/api/integrations/api-keys/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({enabled})});alphaLoadIntegrations()}catch(e){alphaToast(e.message,"error")}}
async function alphaDeleteApiKey(id){if(!confirm("API Key حذف شود؟"))return;try{await api(`/api/integrations/api-keys/${encodeURIComponent(id)}`,{method:"DELETE"});alphaToast("API Key حذف شد","success");alphaLoadIntegrations()}catch(e){alphaToast(e.message,"error")}}
async function alphaCreateWebhook(){const name=prompt("نام Webhook:","Production Webhook");if(!name)return;const url=prompt("URL مقصد HTTPS:","");if(!url)return;try{const r=await api("/api/integrations/webhooks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,url,events:["*"]})});prompt("Webhook Secret — فقط همین بار نمایش داده می‌شود:",r.secret);alphaToast("Webhook ساخته شد","success");alphaLoadIntegrations()}catch(e){alphaToast(e.message,"error")}}
async function alphaToggleWebhook(id,enabled){try{await api(`/api/integrations/webhooks/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({enabled})});alphaLoadIntegrations()}catch(e){alphaToast(e.message,"error")}}
async function alphaTestWebhook(id){try{const r=await api(`/api/integrations/webhooks/${encodeURIComponent(id)}/test`,{method:"POST"});alphaToast(r.ok?"Webhook با موفقیت تحویل شد":"Webhook خطا داد",r.ok?"success":"error");alphaLoadIntegrations()}catch(e){alphaToast(e.message,"error")}}
async function alphaDeleteWebhook(id){if(!confirm("Webhook و سابقه تحویل آن حذف شود؟"))return;try{await api(`/api/integrations/webhooks/${encodeURIComponent(id)}`,{method:"DELETE"});alphaToast("Webhook حذف شد","success");alphaLoadIntegrations()}catch(e){alphaToast(e.message,"error")}}


/* ALPHA 6.19 — Config Studio */
let alphaConfigMode="simple", alphaConfigIPs=[], alphaConfigProxies=[], alphaConfigTemplates=[], alphaConfigSnapshots=[];
let alphaZeusSuggested={ip:[],proxy:[]};
const cfgVal=id=>document.getElementById(id)?.value||"";
const alphaCloudflareTlsPorts=[443,2053,2083,2087,2096,8443];
const alphaCloudflareNonTlsPorts=[80,8080,8880,2052,2082,2086,2095];
const alphaZeusCountries = "AA AE AF AL ALL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BO BR BS BT BW BY BZ CA CD CG CH CI CL CM CN CO CR CW CY CZ DE DK DO DZ EC EE EG ES FI GA GB GE GH GM GN GQ GR GT GU HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KR KW KZ LA LB LK LS LT LU LV LY MA MD ME MG MK ML MM MN MO MT MU MV MW MX MY MZ NA NG NI NL NO NP NZ OM PA PE PG PH PK PL PR PS PT PY QA RE RO RS RU RW SA SC SE SG SI SK SL SN SO SS SY SZ TG TH TJ TM TN TR TT TW TZ UA UG US UY UZ VE VI VN VU WS XK YE YT ZA ZM ZW".split(" ");
function alphaSetConfigMode(mode){alphaConfigMode=mode;document.getElementById("config-mode-simple")?.classList.toggle("active",mode==="simple");document.getElementById("config-mode-advanced")?.classList.toggle("active",mode==="advanced");document.querySelectorAll("#config-builder .cfg-accordion details").forEach((d,i)=>d.hidden=mode==="simple"&&i>=3);}
function alphaInitConfigPorts(){
  const t=document.getElementById("cfg-tls-ports"),n=document.getElementById("cfg-nontls-ports");
  const chip=(p,g)=>`<label class="cfg-port-chip"><input type="checkbox" name="cfg-port" value="${p}" data-group="${g}" ${p===443?"checked":""}><span>${p}</span></label>`;
  if(t&&!t.dataset.ready){t.innerHTML=alphaCloudflareTlsPorts.map(p=>chip(p,"tls")).join("");t.dataset.ready="1"}
  if(n&&!n.dataset.ready){n.innerHTML=alphaCloudflareNonTlsPorts.map(p=>chip(p,"nontls")).join("");n.dataset.ready="1"}
}
function alphaSelectAllPorts(v){document.querySelectorAll('input[name="cfg-port"]').forEach(x=>x.checked=v);}
function alphaConfigSelectedPorts(){const a=[...document.querySelectorAll('input[name="cfg-port"]:checked')].map(x=>Number(x.value)).filter(Boolean);const custom=String(cfgVal("cfg-custom-ports")||"").split(",").map(x=>Number(x.trim())).filter(x=>x>0&&x<65536);return [...new Set([...a,...custom])];}
function alphaInitZeusCountrySelect(){
  const sels=[document.getElementById("cfg-proxy-country"),document.getElementById("cfg-proxy-country-build")];
  sels.forEach(sel=>{if(!sel||sel.dataset.ready)return;sel.innerHTML=alphaZeusCountries.map(c=>`<option value="${c}">${c==="ALL"?"همه کشورها":c}</option>`).join("");sel.dataset.ready="1";});
}
function alphaProxyCountry(){return document.getElementById("cfg-proxy-country-build")?.value||document.getElementById("cfg-proxy-country")?.value||"ALL"}
function alphaToggleRepoSource(type,source,btn){
  if(type==="proxy"&&source==="suggested") {document.getElementById("config-proxy-suggested")?.classList.remove("hidden");document.getElementById("config-proxy-list")?.classList.add("hidden");alphaLoadZeusSuggestions("proxy");}
  else if(type==="proxy"){document.getElementById("config-proxy-suggested")?.classList.add("hidden");document.getElementById("config-proxy-list")?.classList.remove("hidden");}
  else {document.getElementById(`config-${type}-local`)?.classList.toggle("hidden",source!=="local");document.getElementById(`config-${type}-suggested`)?.classList.toggle("hidden",source!=="suggested");if(source==="suggested")alphaLoadZeusSuggestions(type);}
  btn?.parentElement?.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===btn));
}
async function alphaLoadZeusSuggestions(type){
  try{const country=type==="proxy"?alphaProxyCountry():"";const d=await api(`/api/config/suggestions?type=${type}&limit=30${country?`&country=${encodeURIComponent(country)}`:""}`);const items=d.items||[];alphaZeusSuggested[type]=items;const list=document.getElementById(`config-${type}-suggested-list`);if(!list)return;list.innerHTML=items.map((x,i)=>{const label=type==="ip"?x.address:`${x.host}:${x.port}`;const sub=type==="ip"?`IP · ${x.country||"Cloudflare"}`:`${x.type} · ${x.country||"ALL"}`;return `<div class="cfg-repo-item"><span><b>${alphaEsc(label)}</b><small>${alphaEsc(sub)} · پیشنهاد</small></span><button class="primary small" onclick="alphaImportZeusSuggestion('${type}',${i})">استفاده</button></div>`}).join("")||'<div class="empty-state">پیشنهادی وجود ندارد.</div>';}catch(e){alphaToast(e.message||"دریافت پیشنهادها ناموفق بود","error")}
}
async function alphaImportZeusSuggestion(type,index){const item=alphaZeusSuggested[type]?.[index];if(!item)return;try{const r=await api("/api/config/suggestions/import",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type,item})});await alphaLoadConfigRepo(type);alphaSelectConfigRepo(type,r.id);alphaToast(r.existing?"این مورد قبلاً در مخزن بوده است":"به مخزن اضافه شد","success");}catch(e){alphaToast(e.message||"وارد کردن ناموفق بود","error")}}
async function alphaLoadConfigFactory(){document.getElementById("app")?.classList.add("alpha-config-active");alphaInitConfigPorts();alphaInitZeusCountrySelect();await Promise.all([alphaLoadConfigRepo("ip"),alphaLoadConfigRepo("proxy"),alphaLoadConfigUsers(),alphaLoadConfigTemplates(),alphaLoadConfigSnapshots()]);alphaSetConfigMode(alphaConfigMode);alphaConfigUserChanged();alphaRenderConfigSubLink();}
async function alphaLoadConfigRepo(type){try{const q=encodeURIComponent(cfgVal(type==="ip"?"config-ip-search":"config-proxy-search"));const country=type==="proxy"?alphaProxyCountry():"";const r=await api(`/api/config/${type==="ip"?"ip-repository":"proxy-repository"}?q=${q}&status=active${country&&country!=="ALL"?`&country=${encodeURIComponent(country)}`:""}`);if(type==="ip")alphaConfigIPs=r.items||[];else alphaConfigProxies=r.items||[];alphaRenderConfigRepo(type);}catch(e){const el=document.getElementById(type==="ip"?"config-ip-list":"config-proxy-list");if(el)el.innerHTML=`<div class="empty-state">${alphaEsc(e.message||"خطا")}</div>`}}
function alphaRenderConfigRepo(type){const items=type==="ip"?alphaConfigIPs:alphaConfigProxies,el=document.getElementById(type==="ip"?"config-ip-list":"config-proxy-list");if(!el)return;el.innerHTML=items.map(x=>{const selected=(type==="ip"?cfgVal("cfg-ip-id"):cfgVal("cfg-proxy-id"))===String(x.id);const country=x.country||"Unknown";const title=type==="ip"?x.address:`${x.host}:${x.port}`;const meta=type==="ip"?country:`${x.type||"HTTP"} · ${country}`;return `<button class="cfg-repo-item ${selected?"selected":""}" onclick="alphaSelectConfigRepo('${type}','${alphaEsc(x.id)}')"><span><b>${alphaEsc(title)}</b><small>${alphaEsc(meta)} · ${x.latency_ms!=null?x.latency_ms+"ms":"ping —"}</small></span><i class="cfg-status-dot ${x.status==="active"?"on":""}"></i></button>`}).join("")||'<div class="empty-state">موردی در مخزن نیست.</div>'}
function alphaFilterConfigProxies(){alphaLoadConfigRepo("proxy")}
function alphaSelectConfigRepo(type,id){const arr=type==="ip"?alphaConfigIPs:alphaConfigProxies,x=arr.find(v=>String(v.id)===String(id));if(!x)return;const hid=document.getElementById(type==="ip"?"cfg-ip-id":"cfg-proxy-id");if(hid)hid.value=x.id;if(type==="ip"){document.getElementById("cfg-ip-display").value=`${x.address}${x.port?":"+x.port:""} · ${x.country||"Unknown"}`;if(x.country&&document.getElementById("cfg-proxy-country-build")?.value==="ALL")document.getElementById("cfg-proxy-country-build").value=x.country;alphaLoadConfigRepo("proxy");}else{document.getElementById("cfg-proxy-display").value=`${x.host}:${x.port} · ${x.type||"Proxy"} · ${x.country||"Unknown"}`;if(x.country){document.getElementById("cfg-proxy-country-build").value=x.country;document.getElementById("cfg-proxy-country").value=x.country;}}alphaRenderConfigRepo(type);alphaPreviewConfig(true)}
async function alphaLoadConfigUsers(){try{const r=await api("/api/users?limit=100&page=1"),items=r.items||r,sel=document.getElementById("cfg-user");if(sel)sel.innerHTML='<option value="">انتخاب کاربر...</option>'+items.map(x=>`<option value="${alphaEsc(x.id)}" data-quota="${Number(x.quota_gb||0)}" data-devices="${Number(x.device_limit||1)}" data-expires="${x.expires_at||""}" data-token="${alphaEsc(x.subscription_token||"")}">${alphaEsc(x.username)} · ${alphaEsc(x.protocol||"VLESS")} · ${alphaEsc(x.country||"—")}</option>`).join("")}catch(e){}}
function alphaConfigUserChanged(){const sel=document.getElementById("cfg-user"),o=sel?.selectedOptions?.[0];if(!o||!o.value){alphaRenderConfigSubLink();return}const q=o.dataset.quota,d=o.dataset.devices,e=o.dataset.expires;if(q!==undefined)document.getElementById("cfg-quota").value=q;if(d!==undefined)document.getElementById("cfg-devices").value=d;if(e){const days=Math.max(0,Math.ceil((Number(e)-Date.now())/86400000));if(Number.isFinite(days))document.getElementById("cfg-days").value=days}alphaRenderConfigSubLink()}
function alphaRenderConfigSubLink(){const sel=document.getElementById("cfg-user"),o=sel?.selectedOptions?.[0],token=o?.dataset?.token||"",box=document.getElementById("cfg-sub-link"),card=document.getElementById("cfg-sub-link-card");if(!token){if(box)box.textContent="بعد از انتخاب کاربر نمایش داده می‌شود.";if(card)card.textContent="کاربر انتخاب نشده است.";return}const link=`${location.origin}/sub/${token}`;if(box)box.textContent=link;if(card)card.textContent=link}
function alphaCopyConfigSubLink(){const t=document.getElementById("cfg-sub-link")?.textContent||"";if(t.startsWith("http"))navigator.clipboard?.writeText(t).then(()=>alphaToast("لینک اشتراک کپی شد","success"))}
function alphaOpenConfigSubLink(){const t=document.getElementById("cfg-sub-link")?.textContent||"";if(t.startsWith("http"))window.open(t,"_blank","noopener") }
async function alphaLoadConfigTemplates(){try{const r=await api("/api/config/templates"),items=r.items||[];alphaConfigTemplates=items;const sel=document.getElementById("cfg-template");if(sel)sel.innerHTML='<option value="">بدون Template</option>'+items.map(x=>`<option value="${alphaEsc(x.id)}">${alphaEsc(x.name)}</option>`).join("")}catch(e){}}
async function alphaLoadConfigSnapshots(){try{const r=await api("/api/config/snapshots"),items=r.items||[];alphaConfigSnapshots=items;const box=document.getElementById("config-snapshot-list");if(box)box.innerHTML=items.slice(0,12).map(x=>`<div class="config-snapshot-row"><div><b>${alphaEsc(x.name)} <small>v${x.version}</small></b><span>${new Date(Number(x.created_at)).toLocaleString("fa-IR")}</span></div><button class="ghost small" onclick="alphaRestoreSnapshot('${alphaEsc(x.id)}')">بارگذاری</button></div>`).join("")||'<div class="empty-state">هنوز نسخه‌ای ساخته نشده.</div>'}catch(e){}}
function alphaApplyTemplate(id){if(!id)return;const t=alphaConfigTemplates.find(x=>String(x.id)===String(id));if(!t)return;let s={};try{s=JSON.parse(t.settings_json||"{}")}catch(_){};for(const [k,v] of Object.entries(s)){const el=document.getElementById("cfg-"+k);if(el&&typeof v!=="object")el.value=v}if(Array.isArray(s.ports)){document.querySelectorAll('input[name="cfg-port"]').forEach(x=>x.checked=s.ports.includes(Number(x.value)))}alphaToast(`Template «${t.name}» اعمال شد`,`success`);alphaPreviewConfig(true)}
function alphaConfigPayload(){
  const settings={name:cfgVal("cfg-name"),protocol:cfgVal("cfg-protocol"),ports:alphaConfigSelectedPorts(),custom_ports:cfgVal("cfg-custom-ports"),transport:cfgVal("cfg-transport"),security:cfgVal("cfg-security"),sni:cfgVal("cfg-sni"),fp:cfgVal("cfg-fp"),path:cfgVal("cfg-path"),host:cfgVal("cfg-host"),flow:cfgVal("cfg-flow"),proxy_country:alphaProxyCountry(),quota_gb:Number(cfgVal("cfg-quota")||0),device_limit:Number(cfgVal("cfg-devices")||1),expiry_days:Number(cfgVal("cfg-days")||0),status:cfgVal("cfg-status"),reset_days:Number(cfgVal("cfg-reset-days")||0),ip_limit:Number(cfgVal("cfg-ip-limit")||0),block_ads:cfgVal("cfg-block-ads")==="1",block_nsfw:cfgVal("cfg-block-nsfw")==="1",max_connections:Number(cfgVal("cfg-max-connections")||0),auto_rotate_ip:cfgVal("cfg-auto-rotate")==="1",rotate_time:Number(cfgVal("cfg-rotate-time")||0),enable_direct:cfgVal("cfg-direct")==="1",frag_len:cfgVal("cfg-frag-len"),frag_int:cfgVal("cfg-frag-int"),advanced_frag:cfgVal("cfg-advanced-frag"),cipher_suites:cfgVal("cfg-cipher-suites"),tls_mask:cfgVal("cfg-tls-mask"),fingerprint:cfgVal("cfg-fingerprint-manual"),note:cfgVal("cfg-note")};
  return {...settings,user_id:cfgVal("cfg-user"),ip_id:cfgVal("cfg-ip-id"),proxy_id:cfgVal("cfg-proxy-id"),template_id:cfgVal("cfg-template")};
}
async function alphaValidateConfig(silent=false){try{const d=await api("/api/config/generate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(alphaConfigPayload())}),box=document.getElementById("config-validation");if(d.valid){if(box)box.innerHTML='<span class="ok-text">✓ کاربر، IP، Proxy و پورت‌ها معتبر هستند.</span>';if(!silent)alphaToast("تنظیمات معتبر است","success");return d}if(box)box.innerHTML=`<span class="bad-text">! ${alphaEsc((d.errors||[]).join(" · "))}</span>`;if(!silent)alphaToast((d.errors||[]).join(" · "),"error");return d}catch(e){if(!silent)alphaToast(e.message||"اعتبارسنجی ناموفق بود","error");return{valid:false,errors:[e.message||"error"]}}}
async function alphaPreviewConfig(silent=false){const d=await alphaValidateConfig(true),out=document.getElementById("config-output"),meta=document.getElementById("config-preview-meta"),status=document.getElementById("config-preview-status");if(!d.valid){if(out)out.textContent=(d.errors||["تنظیمات کامل نیست."]).join("\n");if(status){status.textContent="INVALID";status.className="badge danger"}return d}if(out)out.textContent=d.config||"";if(meta)meta.innerHTML=`<div><span>IP</span><b>${alphaEsc(d.ip?.address||"—")}</b></div><div><span>Proxy</span><b>${alphaEsc(d.proxy?d.proxy.host+":"+d.proxy.port:"بدون Proxy")}</b></div><div><span>پورت‌ها</span><b>${alphaEsc((d.settings?.ports||[]).join(", "))}</b></div><div><span>حجم / زمان</span><b>${Number(d.settings?.quota_gb||0)} GB · ${Number(d.settings?.expiry_days||0)} روز</b></div><div><span>Protocol</span><b>${alphaEsc(d.settings?.protocol||"—")}</b></div><div><span>Transport</span><b>${alphaEsc(d.settings?.transport||"—")}</b></div>`;if(status){status.textContent="VALID";status.className="badge active"}if(!silent)alphaToast("پیش‌نمایش آماده شد","success");return d}
async function alphaCreateConfigSnapshot(){const payload=alphaConfigPayload();const d=await alphaValidateConfig(true);if(!d.valid)return alphaToast("ابتدا خطاهای تنظیمات را برطرف کن","error");try{if(payload.user_id){const expires=payload.expiry_days>0?Date.now()+payload.expiry_days*86400000:null;await api(`/api/users/${encodeURIComponent(payload.user_id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({quota_gb:payload.quota_gb,device_limit:payload.device_limit,status:payload.status,expires_at:expires})});await alphaLoadConfigUsers();document.getElementById("cfg-user").value=payload.user_id;alphaConfigUserChanged()}if(document.getElementById("cfg-save-template")?.checked){const nm=cfgVal("cfg-template-name")||payload.name;await api("/api/config/templates",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:nm,mode:alphaConfigMode,settings:payload})});await alphaLoadConfigTemplates()}const r=await api("/api/config/snapshots",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});document.getElementById("config-output").textContent=r.config||d.config;alphaToast(`کانفیگ ${payload.name} · نسخه ${r.version} ساخته شد`,"success");await alphaLoadConfigSnapshots()}catch(e){alphaToast(e.message||"ساخت کانفیگ ناموفق بود","error")}}
function alphaRestoreSnapshot(id){const x=alphaConfigSnapshots.find(v=>String(v.id)===String(id));if(!x)return;let s={};try{s=JSON.parse(x.settings_json||"{}")}catch(_){};for(const [k,v] of Object.entries(s)){if(["ip_snapshot","proxy_snapshot","ports"].includes(k))continue;const el=document.getElementById("cfg-"+k);if(el&&typeof v!=="object")el.value=v}if(Array.isArray(s.ports))document.querySelectorAll('input[name="cfg-port"]').forEach(x=>x.checked=s.ports.includes(Number(x.value)));if(s.ip_snapshot?.id)alphaSelectConfigRepo("ip",s.ip_snapshot.id);if(s.proxy_snapshot?.id)alphaSelectConfigRepo("proxy",s.proxy_snapshot.id);document.getElementById("config-output").textContent=x.config_text||"";alphaToast(`نسخه ${x.version} بارگذاری شد`,`success`)}
function alphaResetConfigStudio(){document.querySelectorAll('#config-builder input,#config-builder textarea').forEach(el=>{if(el.type==="checkbox")el.checked=false;else if(el.type!=="hidden")el.value=""});document.getElementById("cfg-name").value="ALPHA Config";document.getElementById("cfg-quota").value=50;document.getElementById("cfg-devices").value=1;document.getElementById("cfg-days").value=30;document.getElementById("cfg-protocol").value="VLESS";document.querySelectorAll('input[name="cfg-port"]').forEach(x=>x.checked=Number(x.value)===443);document.getElementById("config-output").textContent="هنوز کانفیگی ساخته نشده است.";alphaRenderConfigSubLink();alphaToast("Builder پاک شد","success")}
function alphaAddRepoItem(type){const title=type==="ip"?"افزودن IP":"افزودن Proxy";const address=prompt(type==="ip"?"IP Address":"Proxy Host");if(!address)return;const port=Number(prompt("Port",type==="ip"?"443":"8080"));if(!port)return;const country=prompt("Country",alphaProxyCountry()==="ALL"?"Unknown":alphaProxyCountry())||"Unknown";const body=type==="ip"?{address,port,country,source:"manual",status:"active"}:{host:address,port,type:(prompt("Proxy Type","SOCKS5")||"SOCKS5").toUpperCase(),country,source:"manual",status:"active"};api(`/api/config/${type==="ip"?"ip-repository":"proxy-repository"}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(()=>{alphaToast(`${title} ثبت شد`,`success`);alphaLoadConfigRepo(type)}).catch(e=>alphaToast(e.message||"ثبت ناموفق بود","error"))}

