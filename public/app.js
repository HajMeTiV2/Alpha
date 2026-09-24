const $ = s => document.querySelector(s);
let users = [];

async function api(path, options={}) {
  const r = await fetch(path, {headers: {"content-type":"application/json", ...(options.headers||{})}, ...options});
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "API error");
  return data;
}

function showSection(name){
  document.querySelectorAll(".section").forEach(x=>x.classList.toggle("active", x.id===name));
  document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active", x.dataset.section===name));
  const titles={dashboard:"مرکز فرمان Alpha",users:"مدیریت کاربران",activity:"فعالیت‌ها",settings:"تنظیمات Alpha"};
  $("#pageTitle").textContent=titles[name]||"Alpha";
}
document.querySelectorAll("[data-section]").forEach(b=>b.onclick=()=>showSection(b.dataset.section));
document.querySelectorAll("[data-section-jump]").forEach(b=>b.onclick=()=>showSection(b.dataset.sectionJump));

function table(list){
  if(!list.length) return '<div class="empty">هنوز کاربری ثبت نشده است.</div>';
  return `<table class="table"><thead><tr><th>کاربر</th><th>پروتکل</th><th>کشور</th><th>مصرف / سهمیه</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>
  ${list.map(u=>`<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.protocol)}</td><td>${esc(u.country)}</td><td>${Number(u.used_gb||0).toFixed(1)} / ${Number(u.quota_gb||0).toFixed(0)} GB</td><td><span class="badge">${u.status==="active"?"ACTIVE":"PAUSED"}</span></td><td><div class="actions"><button class="mini" onclick="toggleUser(${u.id},'${u.status==="active"?"paused":"active"}')">${u.status==="active"?"توقف":"فعال"}</button><button class="mini" onclick="deleteUser(${u.id})">حذف</button></div></td></tr>`).join("")}
  </tbody></table>`;
}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}

async function load(){
  try{
    users=await api("/api/users");
    render();
  }catch(e){
    users=[];
    render();
    console.warn(e.message);
  }
}
function render(){
  $("#usersTable").innerHTML=table(users);
  $("#recentUsers").innerHTML=table(users.slice(0,5));
  $("#statUsers").textContent=users.length;
  $("#statActive").textContent=users.filter(u=>u.status==="active").length;
  const total=users.reduce((a,u)=>a+Number(u.used_gb||0),0);
  $("#statUsage").textContent=total.toFixed(1)+" GB";
}
$("#search").oninput=async e=>{
  const q=e.target.value.trim();
  users=q?await api("/api/users?q="+encodeURIComponent(q)):await api("/api/users");
  render();
};
$("#refresh").onclick=load;
$("#addBtn").onclick=()=>$("#userDialog").showModal();
$("#userForm").onsubmit=async e=>{
  e.preventDefault();
  const fd=new FormData(e.currentTarget);
  try{
    await api("/api/users",{method:"POST",body:JSON.stringify(Object.fromEntries(fd))});
    e.currentTarget.reset(); $("#userDialog").close(); await load();
  }catch(err){alert(err.message)}
};
async function toggleUser(id,status){await api("/api/users/"+id,{method:"PATCH",body:JSON.stringify({status})});await load()}
async function deleteUser(id){if(confirm("این کاربر حذف شود؟")){await api("/api/users/"+id,{method:"DELETE"});await load()}}
load();