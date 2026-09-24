
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
async function dash(){try{let d=await api("/api/dashboard");$("users").textContent=d.users;$("active").textContent=d.activeUsers;$("nodes").textContent=d.nodes;$("traffic").textContent=Number(d.trafficGb).toFixed(1)+" GB";$("activity").textContent=d.activity24h;$("tv").textContent=Number(d.trafficGb).toFixed(1)+" GB";$("tb").style.width=Math.min(100,d.trafficGb)+"%"}catch{}}
async function loadUsers(){us=await api("/api/users");renderUsers()}
function renderUsers(){let q=($("search").value||"").toLowerCase();$("ut").innerHTML=us.filter(x=>x.username.toLowerCase().includes(q)).map(x=>`<tr><td>${esc(x.username)}</td><td>${esc(x.protocol)}</td><td>${esc(x.country)}</td><td>${x.used_gb}/${x.quota_gb} GB</td><td>${esc(x.status)}</td><td><button onclick="profile(${x.id})">جزئیات</button> <button onclick="toggle(${x.id},'${x.status==="active"?"disabled":"active"}')">${x.status==="active"?"غیرفعال":"فعال"}</button> <button onclick="del(${x.id})">حذف</button></td></tr>`).join("")||"<tr><td colspan=6>کاربری وجود ندارد</td></tr>"}
async function toggle(id,s){await api("/api/users/"+id,{method:"PATCH",body:JSON.stringify({status:s})});loadUsers()}
async function del(id){if(confirm("حذف شود؟")){await api("/api/users/"+id,{method:"DELETE"});loadUsers()}}
function openModal(){$("modal").showModal()}
async function createUser(e){e.preventDefault();try{await api("/api/users",{method:"POST",body:JSON.stringify({username:$("un").value,protocol:$("up").value,quota_gb:+$("uq").value,country:$("uc").value,device_limit:+$("ud").value})});$("modal").close();e.target.reset();loadUsers()}catch(x){alert(x.message)}}
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
document.querySelectorAll("nav button[data-p]").forEach(b=>b.onclick=()=>{let p=b.dataset.p;document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));$(p==="users"?"users-page":p+"-page").classList.remove("hidden");if(p==="users")loadUsers();if(p==="nodes")nodes();if(p==="subscriptions")loadSubscriptions();if(p==="activity")activity();if(p==="traffic")dash()})
async function boot(){try{await api("/api/dashboard");$("login").classList.add("hidden");$("app").classList.remove("hidden");dash()}catch{try{await api("/api/health");show("login")}catch{$("login").classList.remove("hidden")}}}
boot()

let proUsers=[], selectedUsers=new Set(), userSearchTimer;
function debouncedUsers(){clearTimeout(userSearchTimer);userSearchTimer=setTimeout(loadProUsers,250)}
async function loadProUsers(){
  const q=encodeURIComponent($("user-search")?.value||""), st=encodeURIComponent($("user-status")?.value||""), sort=encodeURIComponent($("user-sort")?.value||"created_at");
  const r=await api(`/api/users/advanced?q=${q}&status=${st}&sort=${sort}`);
  proUsers=r.items||[]; renderProUsers();
}
function renderProUsers(){
  const el=$("pro-users-list"); if(!el)return;
  el.innerHTML=`<table><thead><tr><th><input type="checkbox" onchange="toggleAllUsers(this.checked)"></th><th>کاربر</th><th>Protocol</th><th>Quota</th><th>مصرف</th><th>دستگاه</th><th>انقضا</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${proUsers.map(u=>{
    const pct=u.quota_gb?Math.min(100,(Number(u.used_gb)/Number(u.quota_gb))*100):0;
    return `<tr><td><input type="checkbox" ${selectedUsers.has(u.id)?"checked":""} onchange="toggleUser('${u.id}',this.checked)"></td>
    <td><button class="link-btn" onclick="showUserDetail('${u.id}')">${esc(u.username)}</button><small class="muted">${esc(u.country||"—")}</small></td>
    <td>${esc(u.protocol)}</td><td>${u.quota_gb} GB</td><td><div class="usage-cell"><span>${u.used_gb} GB</span><i><b style="width:${pct}%"></b></i></div></td>
    <td>${u.device_limit}</td><td>${formatDate(u.expires_at)}</td><td><span class="badge ${u.status}">${esc(u.status)}</span></td>
    <td><button class="ghost small" onclick="showUserDetail('${u.id}')">جزئیات</button></td></tr>`}).join("")}</tbody></table>`;
  updateBulkBar();
}
function toggleUser(id,on){on?selectedUsers.add(id):selectedUsers.delete(id);updateBulkBar()}
function toggleAllUsers(on){proUsers.forEach(u=>on?selectedUsers.add(u.id):selectedUsers.delete(u.id));renderProUsers()}
function updateBulkBar(){const b=$("bulk-bar"); if(!b)return;b.classList.toggle("hidden",selectedUsers.size===0);$("selected-count").textContent=`${selectedUsers.size} انتخاب`}
async function bulkUserAction(action){const ids=[...selectedUsers];if(!ids.length)return;if(action==="delete"&&!confirm("کاربران انتخاب‌شده حذف شوند؟"))return;await api("/api/users/bulk",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ids,action})});selectedUsers.clear();await loadProUsers()}
async function showUserDetail(id){
  const u=proUsers.find(x=>x.id===id); if(!u)return;
  const pct=u.quota_gb?Math.min(100,(Number(u.used_gb)/Number(u.quota_gb))*100):0;
  $("user-detail-content").innerHTML=`<div class="detail-head"><div class="avatar">${esc((u.username||"?")[0].toUpperCase())}</div><div><span class="eyebrow">USER PROFILE</span><h3>${esc(u.username)}</h3><span class="muted">${esc(u.protocol)} · ${esc(u.country||"—")}</span></div></div>
  <div class="detail-grid"><div><small>Quota</small><b>${u.quota_gb} GB</b></div><div><small>مصرف</small><b>${u.used_gb} GB</b></div><div><small>دستگاه</small><b>${u.device_limit}</b></div><div><small>انقضا</small><b>${formatDate(u.expires_at)}</b></div></div>
  <div class="progress"><i style="width:${pct}%"></i></div>
  <div class="detail-actions"><button class="primary" onclick="extendUser('${u.id}')">+ تمدید</button><button class="ghost" onclick="editUserPrompt('${u.id}')">ویرایش</button><button class="ghost" onclick="toggleUserStatus('${u.id}','${u.status}')">${u.status==="active"?"تعلیق":"فعال‌سازی"}</button></div>`;
  $("user-detail-modal").classList.remove("hidden");
}
async function extendUser(id){const days=prompt("چند روز تمدید شود؟","30");if(!days)return;await api(`/api/users/${id}/extend`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({days:Number(days)})});closeModal("user-detail-modal");await loadProUsers()}
async function toggleUserStatus(id,status){await api(`/api/users/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status:status==="active"?"suspended":"active"})});closeModal("user-detail-modal");await loadProUsers()}
async function editUserPrompt(id){
 const u=proUsers.find(x=>x.id===id);if(!u)return;
 const quota=prompt("Quota (GB)",u.quota_gb), devices=prompt("Device limit",u.device_limit);
 if(quota===null||devices===null)return;
 await api(`/api/users/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({quota_gb:Number(quota),device_limit:Number(devices)})});
 closeModal("user-detail-modal");await loadProUsers()
}
function clearUserFilters(){if($("user-search"))$("user-search").value="";if($("user-status"))$("user-status").value="";if($("user-sort"))$("user-sort").value="created_at";loadProUsers()}
function formatDate(v){if(!v)return"—";const d=new Date(Number(v));return isNaN(d)?"—":d.toLocaleDateString("fa-IR")}
function exportUsersCSV(){
 const rows=[["username","protocol","country","quota_gb","used_gb","device_limit","status","expires_at"],...proUsers.map(u=>[u.username,u.protocol,u.country,u.quota_gb,u.used_gb,u.device_limit,u.status,u.expires_at])];
 const csv=rows.map(r=>r.map(x=>`"${String(x??"").replaceAll('"','""')}"`).join(",")).join("\n");
 const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download="alpha-users.csv";a.click();URL.revokeObjectURL(a.href)
}

try{document.addEventListener("click",e=>{const b=e.target.closest("[data-view=\"users\"]");if(b)setTimeout(loadProUsers,50)})}catch(e){}

let nodeTimer=null;
async function loadNodeMonitor(){
  const [r,s]=await Promise.all([api("/api/nodes"),api("/api/nodes/stats")]);
  const el=$("nodes-monitor-list"); if(!el)return;
  const st=$("node-stats"); if(st)st.innerHTML=`<div class="stat-card"><small>کل Nodeها</small><b>${s.total}</b></div><div class="stat-card"><small>Online</small><b class="ok-text">${s.online}</b></div><div class="stat-card"><small>Offline</small><b class="bad-text">${s.offline}</b></div><div class="stat-card"><small>میانگین Latency</small><b>${s.avg_latency_ms} ms</b></div>`;
  el.innerHTML=(r.items||[]).map(n=>nodeCard(n)).join("");
}
function nodeCard(n){
 const cls=n.status==="online"?"node-online":"node-offline";
 const age=n.updated_at?formatDateTime(n.updated_at):"—";
 return `<article class="node-card ${cls}"><div class="node-card-head"><div><h3>${esc(n.name)}</h3><span class="muted">${esc(n.country||"—")} · ${esc(n.protocol)}</span></div><span class="node-status">${n.status==="online"?"● Online":"● Offline"}</span></div><div class="node-metrics"><div><small>Latency</small><b>${n.latency_ms==null?"—":n.latency_ms+" ms"}</b></div><div><small>Last Seen</small><b>${age}</b></div></div><div class="node-endpoint">${esc(n.endpoint)}</div><div class="node-actions"><button class="ghost small" onclick="checkNode('${n.id}')">Health Check</button><button class="danger small" onclick="removeNode('${n.id}')">حذف</button></div></article>`
}
async function checkNode(id){await api(`/api/nodes/${id}/health`,{method:"POST"});$("node-last-check").textContent="آخرین بررسی: "+new Date().toLocaleTimeString("fa-IR");await loadNodeMonitor()}
async function checkAllNodes(){await api("/api/nodes/monitor",{method:"POST"});$("node-last-check").textContent="آخرین بررسی: "+new Date().toLocaleTimeString("fa-IR");await loadNodeMonitor()}
function toggleAutoNodeCheck(on){if(nodeTimer)clearInterval(nodeTimer);nodeTimer=on?setInterval(checkAllNodes,60000):null}
async function removeNode(id){if(!confirm("این Node حذف شود؟"))return;await api("/api/nodes/"+id,{method:"DELETE"});await loadNodeMonitor()}
function formatDateTime(v){const d=new Date(Number(v));return isNaN(d)?"—":d.toLocaleString("fa-IR",{dateStyle:"short",timeStyle:"short"})}
document.addEventListener("click",e=>{const b=e.target.closest("[data-view='nodes']");if(b)setTimeout(loadNodeMonitor,50)})


/* Alpha v2.8 Subscription Center */
let alphaSubscriptions = [];

async function alphaLoadSubscriptions() {
  const q = encodeURIComponent((document.getElementById("alpha-sub-search") || {}).value || "");
  const status = encodeURIComponent((document.getElementById("alpha-sub-status") || {}).value || "");
  const sort = encodeURIComponent((document.getElementById("alpha-sub-sort") || {}).value || "created_at");

  try {
    const r = await api(`/api/subscriptions/advanced?q=${q}&status=${status}&sort=${sort}`);
    alphaSubscriptions = r.items || [];
    alphaRenderSubscriptions();
  } catch (e) {
    const el = document.getElementById("alpha-sub-list");
    if (el) el.innerHTML = `<div class="empty-state">خطا در دریافت اشتراک‌ها</div>`;
  }
}

function alphaRenderSubscriptions() {
  const list = document.getElementById("alpha-sub-list");
  const stats = document.getElementById("alpha-sub-stats");
  if (!list) return;

  const active = alphaSubscriptions.filter(x => x.status === "active").length;
  const suspended = alphaSubscriptions.filter(x => x.status === "suspended").length;
  const expiring = alphaSubscriptions.filter(x => x.days_left != null && x.days_left >= 0 && x.days_left <= 7).length;

  if (stats) {
    stats.innerHTML =
      `<div><small>کل</small><b>${alphaSubscriptions.length}</b></div>` +
      `<div><small>فعال</small><b>${active}</b></div>` +
      `<div><small>معلق</small><b>${suspended}</b></div>` +
      `<div><small>انقضای نزدیک</small><b>${expiring}</b></div>`;
  }

  if (!alphaSubscriptions.length) {
    list.innerHTML = `<div class="empty-state">اشتراکی پیدا نشد.</div>`;
    return;
  }

  list.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>کاربر</th><th>Quota</th><th>مصرف</th><th>باقی‌مانده</th>
          <th>انقضا</th><th>وضعیت</th><th>عملیات</th>
        </tr>
      </thead>
      <tbody>
        ${alphaSubscriptions.map(x => `
          <tr>
            <td><strong>${alphaEsc(x.username)}</strong><small class="muted">${alphaEsc(x.protocol || "—")} · ${alphaEsc(x.country || "—")}</small></td>
            <td>${Number(x.quota_gb || 0)} GB</td>
            <td>${Number(x.used_gb || 0)} GB</td>
            <td>${Number(x.remaining_gb || 0)} GB</td>
            <td>${alphaExpiry(x)}</td>
            <td><span class="badge ${alphaEsc(x.status || "")}">${alphaEsc(x.status || "—")}</span></td>
            <td>
              <button class="ghost small" onclick="alphaRenewSubscription('${alphaEsc(x.id)}')">تمدید</button>
              <button class="ghost small" onclick="alphaShowNodes('${alphaEsc(x.id)}')">Nodeها</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function alphaExpiry(x) {
  if (!x.expires_at) return "—";
  if (x.days_left < 0) return "منقضی";
  if (x.days_left <= 7) return `${x.days_left} روز`;
  try { return new Date(Number(x.expires_at)).toLocaleDateString("fa-IR"); }
  catch (_) { return "—"; }
}

async function alphaRenewSubscription(id) {
  const raw = prompt("چند روز تمدید شود؟", "30");
  if (raw === null) return;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 1) return alert("تعداد روز معتبر نیست.");
  await api(`/api/subscriptions/${encodeURIComponent(id)}/renew`, {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify({days})
  });
  await alphaLoadSubscriptions();
}

async function alphaShowNodes(id) {
  const r = await api(`/api/subscriptions/${encodeURIComponent(id)}/nodes`);
  const items = r.items || [];
  alert(items.length ? items.map(x => `${x.name} — ${x.status}`).join("\n") : "برای این اشتراک Nodeای متصل نیست.");
}

function alphaExportSubscriptions() {
  const rows = [
    ["username","protocol","country","quota_gb","used_gb","remaining_gb","status","expires_at"],
    ...alphaSubscriptions.map(x => [
      x.username,x.protocol,x.country,x.quota_gb,x.used_gb,x.remaining_gb,x.status,x.expires_at
    ])
  ];
  const csv = rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "alpha-subscriptions.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

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
async function alphaLoadAudit(){
  const q=encodeURIComponent((document.getElementById("alpha-audit-search")||{}).value||"");
  const box=document.getElementById("alpha-audit-list");
  if(!box)return;
  try{
    const r=await api(`/api/audit?q=${q}&limit=150`);
    const rows=r.items||[];
    box.innerHTML=rows.length?`<table><thead><tr><th>زمان</th><th>Action</th><th>Actor</th><th>Details</th></tr></thead><tbody>${
      rows.map(x=>`<tr><td>${alphaDate(x.created_at)}</td><td><code>${alphaEsc(x.action||"")}</code></td><td>${alphaEsc(x.actor||"")}</td><td>${alphaEsc(x.details||"")}</td></tr>`).join("")
    }</tbody></table>`:'<div class="empty-state">Audit log خالی است.</div>';
  }catch(e){box.innerHTML='<div class="empty-state">خطا در دریافت Audit log</div>'}
}
function alphaDate(v){try{return new Date(Number(v)).toLocaleString("fa-IR")}catch(_){return"—"}}
async function alphaBackupDownload(){
  try{
    const data=await api("/api/backup/export");
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`alpha-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }catch(e){alert("Backup دریافت نشد.")}
}
document.addEventListener("DOMContentLoaded",()=>{
  const audit=document.getElementById("alpha-audit-search");
  if(audit)audit.addEventListener("input",alphaLoadAudit);
  if(document.getElementById("security-center")){
    alphaSecurityCheck();
    alphaLoadAudit();
  }
});


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
      `<div class="alpha-settings-stat"><small>Version</small><b>${alphaEsc(r.version||"3.1.0")}</b></div>`;
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
}
async function alphaUpdateAdmin(id,body){
  await api(`/api/admin/roles/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
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
}
async function alphaLoadUISettings(){
  try{
    const r=await api("/api/panel/settings"),s=r.settings||{};
    const map={name:"panel_name",channel:"channel",creator:"creator",theme:"theme",accent:"accent"};
    Object.entries(map).forEach(([id,key])=>{const el=document.getElementById("alpha-set-"+id);if(el)el.value=s[key]||""});
    const c=document.getElementById("alpha-set-compact"),n=document.getElementById("alpha-set-notify");
    if(c)c.checked=s.compact_mode==="1"; if(n)n.checked=s.notifications!=="0";
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
    notifications:document.getElementById("alpha-set-notify")?.checked?"1":"0"
  };
  const r=await api("/api/panel/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  alphaApplyTheme(r.settings||body);
  alert("تنظیمات ذخیره شد.");
}
async function alphaLoadNotifications(){
  try{
    const r=await api("/api/notifications"),items=r.items||[],unread=items.filter(x=>!x.is_read).length;
    const count=document.getElementById("alpha-notif-count");if(count)count.textContent=unread>99?"99+":unread;
    const box=document.getElementById("alpha-notif-list");if(!box)return;
    box.innerHTML=items.length?items.map(x=>`<div class="alpha-notif ${x.is_read?"read":""}" onclick="alphaReadNotification('${alphaEsc(x.id)}')"><b>${alphaEsc(x.title)}</b><small>${alphaEsc(x.message)}</small><time>${alphaDate(x.created_at)}</time></div>`).join(""):'<div class="empty-state">اعلانی وجود ندارد.</div>';
  }catch(_){}
}
function alphaToggleNotifications(){document.getElementById("alpha-notification-drawer")?.classList.toggle("hidden");alphaLoadNotifications()}
async function alphaReadNotification(id){await api(`/api/notifications/${encodeURIComponent(id)}/read`,{method:"POST"});alphaLoadNotifications()}
async function alphaReadAllNotifications(){await api("/api/notifications/read-all",{method:"POST"});alphaLoadNotifications()}
document.addEventListener("DOMContentLoaded",()=>{alphaLoadUISettings();alphaLoadNotifications()});
