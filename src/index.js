const enc = new TextEncoder();
const json = (d,s=200,h={}) => new Response(JSON.stringify(d), {
  status:s, headers:{"content-type":"application/json; charset=utf-8",...h}
});
async function sha(v){const b=await crypto.subtle.digest("SHA-256",enc.encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function token(){const b=crypto.getRandomValues(new Uint8Array(32));return [...b].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function auth(req,env){
  const t=req.headers.get("cookie")?.match(/alpha_session=([^;]+)/)?.[1];
  if(!t)return false;
  return !!await env.DB.prepare("SELECT id FROM admin_sessions WHERE token_hash=? AND expires_at>CURRENT_TIMESTAMP").bind(await sha(t)).first();
}
async function log(env,a,d=""){await env.DB.prepare("INSERT INTO activity_logs(action,actor,details) VALUES(?,?,?)").bind(a,"admin",d).run()}

async function cfFetch(token, path, init={}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  return fetch(`https://api.cloudflare.com/client/v4${path}`, {...init, headers});
}
async function cfJson(token, path, init={}) {
  const r = await cfFetch(token, path, init);
  const d = await r.json().catch(()=>({success:false,errors:[{message:"Invalid Cloudflare response"}]}));
  return {r,d};
}

async function api(req,env){
  const u=new URL(req.url), p=u.pathname;
  if(p==="/api/health")return json({ok:true,name:"ALPHA",version:"2.0.0"});
  if(p==="/api/auth/login"&&req.method==="POST"){
    const b=await req.json().catch(()=>({}));
    if(!env.ALPHA_ADMIN_PASSWORD)return json({error:"ALPHA_ADMIN_PASSWORD is not configured"},503);
    if(b.password!==env.ALPHA_ADMIN_PASSWORD){await log(env,"login_failed");return json({error:"Invalid credentials"},401)}
    const t=token(), h=await sha(t), exp=new Date(Date.now()+86400000).toISOString();
    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at<=CURRENT_TIMESTAMP").run();
    await env.DB.prepare("INSERT INTO admin_sessions(id,token_hash,expires_at,admin_id) VALUES(?,?,?,?)").bind(crypto.randomUUID(),h,exp,"owner-local").run();
    await log(env,"login");
    return json({ok:true},200,{"Set-Cookie":`alpha_session=${t}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`});
  }
  if(p==="/api/auth/logout"&&req.method==="POST"){
    const t=req.headers.get("cookie")?.match(/alpha_session=([^;]+)/)?.[1];
    if(t)await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha(t)).run();
    return json({ok:true},200,{"Set-Cookie":"alpha_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});
  }
  if(p.startsWith("/api/")&&!(p==="/api/health"||p==="/api/auth/login"||p==="/api/auth/logout")&&!await auth(req,env))return json({error:"Unauthorized"},401);

  // Installer: the supplied Cloudflare API token is never stored in D1,
  // logs, cookies, or environment variables. It exists only for this request.
  if(p==="/api/installer/check" && req.method==="POST"){
    const b=await req.json().catch(()=>({}));
    const t=String(b.token||"").trim();
    if(!t) return json({error:"Cloudflare API Token is required"},400);
    const {r,d}=await cfJson(t,"/user/tokens/verify");
    if(!r.ok || !d.success) return json({error:"Token verification failed", details:d.errors||[]},401);
    const account = await cfJson(t,"/accounts?page=1&per_page=10");
    return json({
      ok:true,
      tokenValid:true,
      accounts:(account.d?.result||[]).map(x=>({id:x.id,name:x.name})),
      note:"Token was used only for this request and was not saved."
    });
  }

  if(p==="/api/installer/provision-d1" && req.method==="POST"){
    const b=await req.json().catch(()=>({}));
    const t=String(b.token||"").trim();
    const accountId=String(b.accountId||"").trim();
    const name=String(b.name||"alpha-db").trim().replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,63);
    if(!t || !accountId) return json({error:"Token and Account ID are required"},400);
    const {r,d}=await cfJson(t,`/accounts/${encodeURIComponent(accountId)}/d1/database`,{
      method:"POST",body:JSON.stringify({name})
    });
    if(!r.ok || !d.success) {
      return json({error:"D1 creation failed", details:d.errors||[]},400);
    }
    return json({
      ok:true,
      database:d.result,
      next:"Put the returned database_id into wrangler.toml, then run the migration and deploy commands shown in the installer."
    });
  }

  if(p==="/api/dashboard"){
    const [a,b,c,d,e]=await Promise.all([
      env.DB.prepare("SELECT COUNT(*) c FROM users").first(),
      env.DB.prepare("SELECT COUNT(*) c FROM users WHERE status='active'").first(),
      env.DB.prepare("SELECT COUNT(*) c FROM nodes").first(),
      env.DB.prepare("SELECT COALESCE(SUM(used_gb),0) v FROM users").first(),
      env.DB.prepare("SELECT COUNT(*) c FROM activity_logs WHERE created_at>=datetime('now','-24 hours')").first()
    ]);
    return json({users:a?.c||0,activeUsers:b?.c||0,nodes:c?.c||0,trafficGb:Number(d?.v||0),activity24h:e?.c||0});
  }
  if(p==="/api/users"&&req.method==="GET")return json((await env.DB.prepare("SELECT * FROM users ORDER BY id DESC").all()).results||[]);
  if(p==="/api/users"&&req.method==="POST"){
    const b=await req.json().catch(()=>({})); if(!b.username)return json({error:"username is required"},400);
    try{
      const clientUuid=crypto.randomUUID(), subToken=token(24);
      await env.DB.prepare("INSERT INTO users(username,protocol,country,quota_gb,device_limit,status,expires_at,client_uuid,subscription_token) VALUES(?,?,?,?,?,?,?,?,?)").bind(
        b.username,b.protocol||"VLESS",b.country||"Unknown",Number(b.quota_gb||0),Number(b.device_limit||1),b.status||"active",b.expires_at||null,clientUuid,subToken).run();
      await log(env,"user_created",b.username); return json({ok:true,subscription_token:subToken},201);
    }catch{return json({error:"Could not create user"},409)}
  }
  if(p.startsWith("/api/users/")&&req.method==="PATCH"){
    const id=p.split("/").pop(),b=await req.json().catch(()=>({}));
    await env.DB.prepare("UPDATE users SET status=COALESCE(?,status),quota_gb=COALESCE(?,quota_gb),device_limit=COALESCE(?,device_limit),expires_at=COALESCE(?,expires_at),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.status??null,b.quota_gb??null,b.device_limit??null,b.expires_at??null,id).run();
    await log(env,"user_updated",id); return json({ok:true});
  }
  if(p.startsWith("/api/users/")&&req.method==="DELETE"){const id=p.split("/").pop();await env.DB.prepare("DELETE FROM users WHERE id=?").bind(id).run();await log(env,"user_deleted",id);return json({ok:true})}
  if(p==="/api/nodes"&&req.method==="GET")return json((await env.DB.prepare("SELECT * FROM nodes ORDER BY id DESC").all()).results||[]);
  if(p==="/api/nodes"&&req.method==="POST")return createNode(req,env);
  if(p.startsWith("/api/nodes/")&&req.method==="PATCH")return updateNode(req,env,p.split("/").pop());
  if(p.startsWith("/api/nodes/")&&req.method==="DELETE")return deleteNode(req,env,p.split("/").pop());
  if(p==="/api/subscriptions"&&req.method==="GET")return subscriptions(req,env);
  if(p==="/api/subscriptions"&&req.method==="POST")return createSubscription(req,env);
  if(p.startsWith("/api/subscriptions/")&&req.method==="DELETE")return deleteSubscription(req,env,p.split("/").pop());
  if(p.startsWith("/api/users/")&&req.method==="GET"){
    const id=p.split("/").pop();
    const urow=await env.DB.prepare("SELECT id,username,protocol,country,quota_gb,used_gb,device_limit,status,expires_at,created_at,client_uuid,subscription_token FROM users WHERE id=?").bind(id).first();
    if(!urow)return json({error:"not found"},404);
    return json({user:urow});
  }
  if(p==="/api/activity")return json((await env.DB.prepare("SELECT * FROM activity_logs ORDER BY id DESC LIMIT 100").all()).results||[]);
  if (p === "/api/v4/health" && req.method === "GET") {
    const session = await alphaRBAC(req, env, "viewer");
    return json({ok:true,version:"4.0.1",rbac:session.ok,role:session.role||null,now:Date.now()});
  }

  if (req.method !== "GET" && p.startsWith("/api/")) {
    const minimum = p.startsWith("/api/admin/") || p.startsWith("/api/panel/") || p.startsWith("/api/backup/")
      ? "admin" : "operator";
    const session = await alphaRBAC(req, env, minimum);
    if (!session.ok) return json({error:"Forbidden",role:session.role||null},403);
  }

  if (p === "/api/subscriptions/advanced" && req.method === "GET")
    return alphaSubscriptionAdvanced(req, env);
  if (p === "/api/subscriptions/bulk" && req.method === "POST")
    return alphaSubscriptionBulk(req, env);
  const subRenew = p.match(/^\/api\/subscriptions\/([^/]+)\/renew$/);
  if (subRenew && req.method === "POST")
    return alphaSubscriptionRenew(req, env, subRenew[1]);
  const subNodes = p.match(/^\/api\/subscriptions\/([^/]+)\/nodes$/);
  if (subNodes && req.method === "GET") return alphaSubscriptionNodes(env, subNodes[1]);
  if (subNodes && req.method === "PUT") return alphaSetSubscriptionNodes(req, env, subNodes[1]);

  if (p === "/api/audit" && req.method === "GET") return alphaAuditList(req, env);
  if (p === "/api/audit/clear" && req.method === "POST") return alphaAuditClear(req, env);
  if (p === "/api/backup/export" && req.method === "GET") return alphaBackupExport(req, env);
  if (p === "/api/security/status" && req.method === "GET") return alphaSecurityStatus(req, env);

  if (p === "/api/settings/health" && req.method === "GET") return alphaSettings(req, env);
  if (p === "/api/auth/me" && req.method === "GET") {
    const session = await alphaRBAC(req, env, "viewer");
    return json({authenticated:session.ok,role:session.role||null});
  }
  if (p === "/api/admin/roles" && req.method === "GET") return alphaAdminRoles(req, env);
  if (p === "/api/admin/roles" && req.method === "POST") return alphaAdminRoleCreate(req, env);
  const adminRoleMatch = p.match(/^\/api\/admin\/roles\/([^/]+)$/);
  if (adminRoleMatch && req.method === "PATCH") return alphaAdminRoleUpdate(req, env, adminRoleMatch[1]);

  if (p === "/api/panel/settings" && req.method === "GET") return alphaPanelSettingsGet(req, env);
  if (p === "/api/panel/settings" && req.method === "PUT") return alphaPanelSettingsPut(req, env);
  if (p === "/api/notifications" && req.method === "GET") return alphaNotifications(req, env);
  if (p === "/api/notifications/read-all" && req.method === "POST") return alphaNotificationsReadAll(req, env);
  const alphaNotifMatch=p.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if(alphaNotifMatch && req.method==="POST") return alphaNotificationRead(req,env,alphaNotifMatch[1]);

  return json({error:"Not found"},404);
}

async function createNode(req,env){
  const b=await req.json();
  if(!b.name||!b.endpoint)return json({error:"name and endpoint required"},400);
  const id=token(8), now=Date.now();
  await env.DB.prepare("INSERT INTO nodes(id,name,country,endpoint,protocol,status,latency_ms,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(id,b.name,b.country||"",b.endpoint,b.protocol||"VLESS","online",null,now,now).run();
  await log(env,"node.create","admin",b.name);
  return json({ok:true,id});
}
async function updateNode(req,env,id){
  const b=await req.json(), now=Date.now();
  const r=await env.DB.prepare("UPDATE nodes SET name=COALESCE(?,name),country=COALESCE(?,country),endpoint=COALESCE(?,endpoint),protocol=COALESCE(?,protocol),status=COALESCE(?,status),latency_ms=COALESCE(?,latency_ms),updated_at=? WHERE id=?")
    .bind(b.name??null,b.country??null,b.endpoint??null,b.protocol??null,b.status??null,b.latency_ms??null,now,id).run();
  if(!r.meta.changes)return json({error:"not found"},404);
  await log(env,"node.update","admin",id); return json({ok:true});
}
async function deleteNode(req,env,id){
  const r=await env.DB.prepare("DELETE FROM nodes WHERE id=?").bind(id).run();
  if(!r.meta.changes)return json({error:"not found"},404);
  await log(env,"node.delete","admin",id); return json({ok:true});
}
async function subscriptions(req,env){
  const r=await env.DB.prepare("SELECT id,username,protocol,quota_gb,used_gb,device_limit,status,expires_at,created_at FROM users ORDER BY created_at DESC").all();
  return json({items:r.results||[]});
}
async function createSubscription(req,env){
  const b=await req.json();
  if(!b.username)return json({error:"username required"},400);
  const id=token(8), now=Date.now(), clientUuid=crypto.randomUUID(), subToken=token(24);
  await env.DB.prepare("INSERT INTO users(id,username,protocol,country,quota_gb,used_gb,device_limit,status,expires_at,created_at,updated_at,client_uuid,subscription_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id,b.username,b.protocol||"VLESS",b.country||"",Number(b.quota_gb||10),0,Number(b.device_limit||2),"active",b.expires_at||null,now,now,clientUuid,subToken).run();
  await log(env,"subscription.create","admin",b.username);
  return json({ok:true,id,subscription_token:subToken});
}
async function deleteSubscription(req,env,id){
  const r=await env.DB.prepare("DELETE FROM users WHERE id=?").bind(id).run();
  if(!r.meta.changes)return json({error:"not found"},404);
  await log(env,"subscription.delete","admin",id); return json({ok:true});
}


async function publicSubscription(sub,env,u){
  if(!sub)return json({error:"Not found"},404);
  const user=await env.DB.prepare("SELECT id,username,protocol,quota_gb,used_gb,device_limit,status,expires_at,client_uuid,subscription_token FROM users WHERE subscription_token=?").bind(sub).first();
  if(!user)return json({error:"Not found"},404);
  if(u.searchParams.get("format")==="json"){
    return json({name:user.username,protocol:user.protocol,status:user.status,quota_gb:user.quota_gb,used_gb:user.used_gb,expires_at:user.expires_at,device_limit:user.device_limit});
  }
  const nodes=(await env.DB.prepare("SELECT name,endpoint,protocol,country,status FROM nodes WHERE status!='offline' ORDER BY id DESC").all()).results||[];
  const configs=nodes.filter(n=>n.endpoint).map(n=>{
    const proto=(n.protocol||user.protocol||"VLESS").toUpperCase();
    if(proto==="VLESS"&&user.client_uuid){
      const ep=String(n.endpoint).replace(/^https?:\/\//,"").replace(/\/$/,"");
      return `vless://${user.client_uuid}@${ep}?type=tcp&security=none#${encodeURIComponent(n.name||"Alpha")}`;
    }
    return `${proto} ${n.endpoint}`;
  });
  return json({name:user.username,protocol:user.protocol,status:user.status,quota_gb:user.quota_gb,used_gb:user.used_gb,expires_at:user.expires_at,device_limit:user.device_limit,configs});
}


async function usersAdvanced(req,env){
  const u=new URL(req.url);
  const q=(u.searchParams.get("q")||"").trim();
  const status=u.searchParams.get("status")||"";
  const country=u.searchParams.get("country")||"";
  const sort=u.searchParams.get("sort")||"created_at";
  const dir=u.searchParams.get("dir")==="asc"?"ASC":"DESC";
  const allowed={created_at:"created_at",username:"username",used_gb:"used_gb",quota_gb:"quota_gb",expires_at:"expires_at",status:"status"};
  const order=allowed[sort]||"created_at";
  const like=`%${q}%`;
  const r=await env.DB.prepare(`SELECT id,username,protocol,country,quota_gb,used_gb,device_limit,status,expires_at,created_at,updated_at FROM users WHERE (?='' OR username LIKE ? OR country LIKE ? OR protocol LIKE ?) AND (?='' OR status=?) AND (?='' OR country=?) ORDER BY ${order} ${dir} LIMIT 500`)
    .bind(q,like,like,like,status,status,country,country).all();
  return json({items:r.results||[]});
}
async function updateUserPro(req,env,id){
  const b=await req.json();
  const fields=[], vals=[];
  for(const k of ["username","protocol","country","quota_gb","device_limit","status","expires_at"]){
    if(b[k]!==undefined){fields.push(`${k}=?`); vals.push(b[k]);}
  }
  if(!fields.length)return json({error:"no changes"},400);
  fields.push("updated_at=?"); vals.push(Date.now(),id);
  const r=await env.DB.prepare(`UPDATE users SET ${fields.join(",")} WHERE id=?`).bind(...vals).run();
  if(!r.meta.changes)return json({error:"not found"},404);
  await log(env,"user.update","admin",id);
  return json({ok:true});
}
async function bulkUsers(req,env){
  const b=await req.json();
  const ids=Array.isArray(b.ids)?b.ids.filter(Boolean):[];
  if(!ids.length)return json({error:"ids required"},400);
  const action=b.action;
  if(!["activate","suspend","delete"].includes(action))return json({error:"invalid action"},400);
  const placeholders=ids.map(()=>"?").join(",");
  if(action==="delete"){
    await env.DB.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).bind(...ids).run();
  }else{
    const status=action==="activate"?"active":"suspended";
    await env.DB.prepare(`UPDATE users SET status=?,updated_at=? WHERE id IN (${placeholders})`).bind(status,Date.now(),...ids).run();
  }
  await log(env,`user.bulk.${action}`,"admin",`${ids.length} users`);
  return json({ok:true,count:ids.length});
}
async function extendUser(req,env,id){
  const b=await req.json(), days=Math.max(1,Math.min(3650,Number(b.days||30)));
  const row=await env.DB.prepare("SELECT expires_at FROM users WHERE id=?").bind(id).first();
  if(!row)return json({error:"not found"},404);
  const baseDate=Number(row.expires_at)>Date.now()?Number(row.expires_at):Date.now();
  const expires=baseDate+days*86400000;
  await env.DB.prepare("UPDATE users SET expires_at=?,status='active',updated_at=? WHERE id=?").bind(expires,Date.now(),id).run();
  await log(env,"user.extend","admin",`${id}:${days}d`);
  return json({ok:true,expires_at:expires});
}


async function nodeMonitor(req,env,id){
  const n=await env.DB.prepare("SELECT id,name,country,endpoint,protocol,status,latency_ms,created_at,updated_at FROM nodes WHERE id=?").bind(id).first();
  if(!n)return json({error:"not found"},404);
  const started=Date.now();
  let ok=false, latency=null, error="";
  try{
    const target=new URL(n.endpoint);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    const r=await fetch(target.toString(),{method:"HEAD",signal:controller.signal,redirect:"manual"});
    clearTimeout(timer);
    latency=Date.now()-started;
    ok=r.status<500;
  }catch(e){latency=Date.now()-started;error=String(e?.message||e)}
  const status=ok?"online":"offline";
  await env.DB.prepare("UPDATE nodes SET status=?,latency_ms=?,updated_at=? WHERE id=?").bind(status,latency,Date.now(),id).run();
  await log(env,"node.healthcheck","system",`${id}:${status}:${latency}`);
  return json({ok:true,node:{...n,status,latency_ms:latency},error:error||null});
}
async function monitorAllNodes(req,env){
  const r=await env.DB.prepare("SELECT id,name,country,endpoint,protocol,status,latency_ms,created_at,updated_at FROM nodes ORDER BY name").all();
  const items=[];
  for(const n of (r.results||[])){
    const started=Date.now(); let ok=false, err="";
    try{
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),5000);
      const res=await fetch(new URL(n.endpoint).toString(),{method:"HEAD",signal:controller.signal,redirect:"manual"});
      clearTimeout(timer); ok=res.status<500;
    }catch(e){err=String(e?.message||e)}
    const latency=Date.now()-started, status=ok?"online":"offline";
    await env.DB.prepare("UPDATE nodes SET status=?,latency_ms=?,updated_at=? WHERE id=?").bind(status,latency,Date.now(),n.id).run();
    items.push({...n,status,latency_ms:latency,error:err||null});
  }
  await log(env,"node.healthcheck.all","system",`${items.length} nodes`);
  return json({items});
}
async function nodeStats(req,env){
  const total=await env.DB.prepare("SELECT COUNT(*) c FROM nodes").first();
  const online=await env.DB.prepare("SELECT COUNT(*) c FROM nodes WHERE status='online'").first();
  const offline=await env.DB.prepare("SELECT COUNT(*) c FROM nodes WHERE status='offline'").first();
  const avg=await env.DB.prepare("SELECT AVG(latency_ms) a FROM nodes WHERE status='online' AND latency_ms IS NOT NULL").first();
  return json({total:Number(total?.c||0),online:Number(online?.c||0),offline:Number(offline?.c||0),avg_latency_ms:avg?.a?Math.round(avg.a):0});
}


async function alphaSubscriptionAdvanced(req, env) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") || "").trim();
  const status = u.searchParams.get("status") || "";
  const sortMap = {
    created_at: "created_at",
    username: "username",
    quota_gb: "quota_gb",
    used_gb: "used_gb",
    expires_at: "expires_at"
  };
  const order = sortMap[u.searchParams.get("sort")] || "created_at";
  const like = `%${q}%`;

  const result = await env.DB.prepare(
    `SELECT id,username,protocol,country,quota_gb,used_gb,device_limit,status,
            expires_at,created_at,updated_at
       FROM users
      WHERE (? = '' OR username LIKE ? OR country LIKE ? OR protocol LIKE ?)
        AND (? = '' OR status = ?)
      ORDER BY ${order} DESC
      LIMIT 500`
  ).bind(q, like, like, like, status, status).all();

  const now = Date.now();
  const items = (result.results || []).map(x => ({
    ...x,
    remaining_gb: Math.max(0, Number(x.quota_gb || 0) - Number(x.used_gb || 0)),
    days_left: x.expires_at == null ? null : Math.ceil((Number(x.expires_at) - now) / 86400000)
  }));

  return json({items});
}

async function alphaSubscriptionRenew(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const days = Math.max(1, Math.min(3650, Number(body.days || 30)));
  const row = await env.DB.prepare("SELECT expires_at FROM users WHERE id=?").bind(id).first();
  if (!row) return json({error:"not found"}, 404);

  const current = Number(row.expires_at || 0);
  const base = current > Date.now() ? current : Date.now();
  const expires = base + days * 86400000;

  await env.DB.prepare(
    "UPDATE users SET expires_at=?, status='active', updated_at=? WHERE id=?"
  ).bind(expires, Date.now(), id).run();

  if (typeof log === "function") await log(env, "subscription.renew", "admin", `${id}:${days}d`);
  return json({ok:true, expires_at:expires});
}

async function alphaSubscriptionNodes(env, id) {
  const result = await env.DB.prepare(
    `SELECT n.id,n.name,n.country,n.endpoint,n.protocol,n.status,n.latency_ms
       FROM nodes n
       INNER JOIN subscription_nodes sn ON sn.node_id=n.id
      WHERE sn.user_id=?
      ORDER BY n.name`
  ).bind(id).all();
  return json({items: result.results || []});
}

async function alphaSetSubscriptionNodes(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.node_ids) ? [...new Set(body.node_ids.filter(Boolean))] : [];

  await env.DB.prepare("DELETE FROM subscription_nodes WHERE user_id=?").bind(id).run();
  for (const nodeId of ids) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO subscription_nodes(user_id,node_id,created_at) VALUES(?,?,?)"
    ).bind(id, nodeId, Date.now()).run();
  }

  if (typeof log === "function") await log(env, "subscription.nodes.update", "admin", `${id}:${ids.length}`);
  return json({ok:true, count:ids.length});
}

async function alphaSubscriptionBulk(req, env) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  const action = body.action;

  if (!ids.length) return json({error:"ids required"}, 400);
  if (!["activate","suspend","delete"].includes(action)) return json({error:"invalid action"}, 400);

  const marks = ids.map(() => "?").join(",");
  if (action === "delete") {
    await env.DB.prepare(`DELETE FROM users WHERE id IN (${marks})`).bind(...ids).run();
  } else {
    await env.DB.prepare(
      `UPDATE users SET status=?, updated_at=? WHERE id IN (${marks})`
    ).bind(action === "activate" ? "active" : "suspended", Date.now(), ...ids).run();
  }

  if (typeof log === "function") await log(env, `subscription.bulk.${action}`, "admin", `${ids.length}`);
  return json({ok:true, count:ids.length});
}


    
    
async function alphaAuditList(req, env) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") || "").trim();
  const limit = Math.min(500, Math.max(1, Number(u.searchParams.get("limit") || 100)));
  const like = `%${q}%`;
  const result = await env.DB.prepare(
    `SELECT id,action,actor,details,created_at
       FROM activity_logs
      WHERE (?='' OR action LIKE ? OR actor LIKE ? OR details LIKE ?)
      ORDER BY created_at DESC
      LIMIT ?`
  ).bind(q, like, like, like, limit).all();
  return json({items: result.results || []});
}

async function alphaAuditClear(req, env) {
  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "ALPHA-CLEAR-AUDIT") return json({error:"confirmation required"}, 400);
  await env.DB.prepare("DELETE FROM activity_logs").run();
  if (typeof log === "function") await log(env, "audit.clear", "admin", "audit log cleared");
  return json({ok:true});
}

async function alphaBackupExport(req, env) {
  const tables = ["users","nodes","activity_logs","admin_sessions","subscription_nodes"];
  const out = {format:"ALPHA-BACKUP",version:"2.9",created_at:Date.now(),tables:{}};

  for (const table of tables) {
    try {
      const r = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      out.tables[table] = r.results || [];
    } catch (_) {
      out.tables[table] = [];
    }
  }
  return json(out);
}

async function alphaSecurityStatus(req, env) {
  const checks = [
    {key:"admin_password_secret", ok:!!env.ALPHA_ADMIN_PASSWORD, label:"Admin password secret"},
    {key:"database_binding", ok:!!env.DB, label:"D1 database binding"},
    {key:"token_not_persisted", ok:true, label:"Installer token not persisted by application"},
    {key:"audit_logging", ok:true, label:"Audit logging enabled"}
  ];
  return json({
    checks,
    score: checks.filter(x=>x.ok).length,
    total: checks.length,
    generated_at: Date.now()
  });
}


async function alphaSettings(req, env) {
  const checks = [
    {key:"admin_auth", value:!!env.ALPHA_ADMIN_PASSWORD},
    {key:"d1", value:!!env.DB},
    {key:"pwa", value:true},
    {key:"audit", value:true}
  ];
  return json({version:"3.1.0",checks,generated_at:Date.now()});
}
async function alphaAdminRoles(req, env) {
  const r=await env.DB.prepare(
    "SELECT id,username,role,status,created_at,updated_at FROM admin_users ORDER BY created_at DESC LIMIT 100"
  ).all();
  return json({items:r.results||[]});
}
async function alphaAdminRoleCreate(req, env) {
  const b=await req.json().catch(()=>({}));
  const username=String(b.username||"").trim();
  const role=["owner","admin","operator","viewer"].includes(b.role)?b.role:"viewer";
  if(!username) return json({error:"username required"},400);
  const id=crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO admin_users(id,username,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?)"
    ).bind(id,username,role,"active",Date.now(),Date.now()).run();
  } catch(e) { return json({error:"username already exists or database error"},409); }
  if(typeof log==="function") await log(env,"admin.role.create","admin",`${username}:${role}`);
  return json({ok:true,id,username,role});
}
async function alphaAdminRoleUpdate(req, env, id) {
  const b=await req.json().catch(()=>({}));
  const role=["owner","admin","operator","viewer"].includes(b.role)?b.role:null;
  const status=["active","suspended"].includes(b.status)?b.status:null;
  if(!role && !status) return json({error:"nothing to update"},400);
  const row=await env.DB.prepare("SELECT id FROM admin_users WHERE id=?").bind(id).first();
  if(!row) return json({error:"not found"},404);
  if(role) await env.DB.prepare("UPDATE admin_users SET role=?,updated_at=? WHERE id=?").bind(role,Date.now(),id).run();
  if(status) await env.DB.prepare("UPDATE admin_users SET status=?,updated_at=? WHERE id=?").bind(status,Date.now(),id).run();
  if(typeof log==="function") await log(env,"admin.role.update","admin",id);
  return json({ok:true});
}


async function alphaPanelSettingsGet(req, env) {
  const r=await env.DB.prepare("SELECT key,value,updated_at FROM panel_settings ORDER BY key").all();
  const defaults={
    panel_name:"ALPHA",
    channel:"@V2rayTun0",
    creator:"@Mehtif",
    accent:"cyan",
    theme:"dark",
    compact_mode:"0",
    notifications:"1"
  };
  for(const row of (r.results||[])) defaults[row.key]=row.value;
  return json({settings:defaults});
}
async function alphaPanelSettingsPut(req, env) {
  const body=await req.json().catch(()=>({}));
  const allowed=["panel_name","channel","creator","accent","theme","compact_mode","notifications"];
  for(const key of allowed){
    if(body[key]===undefined) continue;
    const value=String(body[key]).slice(0,200);
    await env.DB.prepare(
      "INSERT INTO panel_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
    ).bind(key,value,Date.now()).run();
  }
  if(typeof log==="function") await log(env,"settings.update","admin","panel settings updated");
  return alphaPanelSettingsGet(req,env);
}
async function alphaNotifications(req, env) {
  const r=await env.DB.prepare(
    "SELECT id,title,message,level,is_read,created_at FROM panel_notifications ORDER BY created_at DESC LIMIT 100"
  ).all();
  return json({items:r.results||[]});
}
async function alphaNotificationRead(req, env, id) {
  await env.DB.prepare("UPDATE panel_notifications SET is_read=1 WHERE id=?").bind(id).run();
  return json({ok:true});
}
async function alphaNotificationsReadAll(req, env) {
  await env.DB.prepare("UPDATE panel_notifications SET is_read=1 WHERE is_read=0").run();
  return json({ok:true});
}


/* ALPHA v4.0 — real RBAC helpers */
async function alphaGetSessionRole(req, env) {
  const cookie = req.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)alpha_session=([^;]+)/);
  if (!m) return null;
  const sessionToken = decodeURIComponent(m[1]);
  const session = await env.DB.prepare(
    "SELECT s.*, a.role, a.status FROM admin_sessions s LEFT JOIN admin_users a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP LIMIT 1"
  ).bind(await sha(sessionToken)).first().catch(()=>null);
  if (!session || session.status === "suspended") return null;
  return session.role || "owner";
}
const ALPHA_ROLE_LEVEL = {viewer:1, operator:2, admin:3, owner:4};
function alphaRequireRole(role, minimum) {
  return (ALPHA_ROLE_LEVEL[role]||0) >= (ALPHA_ROLE_LEVEL[minimum]||99);
}
async function alphaRBAC(req, env, minimum="viewer") {
  const role = await alphaGetSessionRole(req, env);
  return {ok: !!role && alphaRequireRole(role, minimum), role};
}

export default {async fetch(req,env){
  const u=new URL(req.url);
  if(u.pathname === "/panel" || u.pathname === "/panel/"){
    return env.ASSETS.fetch(new Request(new URL("/index.html",u),req));
  }
  if(u.pathname.startsWith("/sub/")){
    const sub=u.pathname.split("/").filter(Boolean)[1]||"";
    return publicSubscription(sub,env, u);
  }
  if(u.pathname.startsWith("/api/")) return api(req,env);
  return env.ASSETS.fetch(req);
}};
