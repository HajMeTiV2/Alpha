const enc = new TextEncoder();
function withSecurityHeaders(response){
  const h=new Headers(response.headers);
  h.set("X-Content-Type-Options","nosniff");
  h.set("X-Frame-Options","DENY");
  h.set("Referrer-Policy","strict-origin-when-cross-origin");
  h.set("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
}

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
async function log(env,a,actor="admin",d=""){await env.DB.prepare("INSERT INTO activity_logs(action,actor,details) VALUES(?,?,?)").bind(a,actor,d).run()}

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
  if(p==="/api/health")return json({ok:true,name:"ALPHA",version:"6.8.0"});
  if(p==="/api/auth/login"&&req.method==="POST"){
    const b=await req.json().catch(()=>({}));
    if(!env.ALPHA_ADMIN_PASSWORD)return json({error:"ALPHA_ADMIN_PASSWORD is not configured"},503);
    const password=String(b.password||"");
    const ip=req.headers.get("CF-Connecting-IP")||"unknown";
    try{
      const rate=await env.DB.prepare("SELECT attempts,blocked_until FROM auth_rate_limits WHERE ip=?").bind(ip).first();
      if(rate?.blocked_until && Number(rate.blocked_until)>Date.now()) return json({error:"Too many login attempts. Try again later."},429);
      if(password!==env.ALPHA_ADMIN_PASSWORD){
        const attempts=Number(rate?.attempts||0)+1;
        const blockedUntil=attempts>=8?Date.now()+15*60*1000:0;
        await env.DB.prepare("INSERT INTO auth_rate_limits(ip,attempts,blocked_until,updated_at) VALUES(?,?,?,?) ON CONFLICT(ip) DO UPDATE SET attempts=excluded.attempts,blocked_until=excluded.blocked_until,updated_at=excluded.updated_at")
          .bind(ip,attempts,blockedUntil,Date.now()).run();
        await log(env,"login_failed","admin",`ip:${ip}`);
        return json({error:"Invalid credentials"},401);
      }
      await env.DB.prepare("DELETE FROM auth_rate_limits WHERE ip=?").bind(ip).run();
    }catch(_){ /* migration may not be applied yet; continue with normal auth */ }
    const t=token(), h=await sha(t), exp=new Date(Date.now()+86400000).toISOString();
    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at<=CURRENT_TIMESTAMP").run();
    await env.DB.prepare("INSERT INTO admin_sessions(id,token_hash,expires_at,ip,user_agent) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),h,exp,ip,String(req.headers.get("User-Agent")||"").slice(0,300)).run();
    await log(env,"login","admin",`ip:${ip}`);
    return json({ok:true},200,{"Set-Cookie":`alpha_session=${t}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`});
  }
  if(p==="/api/auth/logout"&&req.method==="POST"){
    const t=req.headers.get("cookie")?.match(/alpha_session=([^;]+)/)?.[1];
    if(t){ await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha(t)).run(); await log(env,"logout","admin",`ip:${req.headers.get("CF-Connecting-IP")||"unknown"}`); }
    return json({ok:true},200,{"Set-Cookie":"alpha_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});
  }
  // Installer is intentionally public: it is used before the first admin
  // session exists. The supplied Cloudflare token is used only for the request.
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

  if(p.startsWith("/api/")&&!(p==="/api/health"||p==="/api/auth/login"||p==="/api/auth/logout"||p==="/api/installer/check"||p==="/api/installer/provision-d1")&&!await auth(req,env))return json({error:"Unauthorized"},401);

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
  // Professional user management endpoints must be matched BEFORE
  // the generic /api/users/:id GET route. Otherwise "advanced" is treated
  // as a user id and the panel receives a 404.
  if(p==="/api/users/advanced" && req.method==="GET")return usersAdvanced(req,env);
  if(p==="/api/users/bulk" && req.method==="POST")return bulkUsers(req,env);
  const userExtendMatch=p.match(/^\/api\/users\/([^/]+)\/extend$/);
  if(userExtendMatch && req.method==="POST")return extendUser(req,env,userExtendMatch[1]);

  if(p.startsWith("/api/users/")&&req.method==="GET"){
    const id=p.split("/").pop();
    const urow=await env.DB.prepare("SELECT id,username,protocol,country,quota_gb,used_gb,device_limit,status,expires_at,created_at,client_uuid,subscription_token FROM users WHERE id=?").bind(id).first();
    if(!urow)return json({error:"not found"},404);
    return json({user:urow});
  }
  if(p==="/api/activity")return json((await env.DB.prepare("SELECT * FROM activity_logs ORDER BY id DESC LIMIT 100").all()).results||[]);

  // Professional node monitoring endpoints
  if(p==="/api/nodes/stats" && req.method==="GET")return nodeStats(req,env);
  const nodeHealthMatch=p.match(/^\/api\/nodes\/([^/]+)\/health$/);
  if(nodeHealthMatch && req.method==="POST")return nodeMonitor(req,env,nodeHealthMatch[1]);
  if(p==="/api/nodes/monitor" && req.method==="POST")return monitorAllNodes(req,env);
  const nodeHistoryMatch=p.match(/^\/api\/nodes\/([^/]+)\/history$/);
  if(nodeHistoryMatch && req.method==="GET")return nodeHealthHistory(req,env,nodeHistoryMatch[1]);

  if (p === "/api/subscriptions/advanced" && req.method === "GET") return alphaSubscriptionAdvanced(req, env);
  if (p === "/api/subscriptions/bulk" && req.method === "POST") return alphaSubscriptionBulk(req, env);
  const subRenew = p.match(/^\/api\/subscriptions\/([^/]+)\/renew$/);
  if (subRenew && req.method === "POST") return alphaSubscriptionRenew(req, env, subRenew[1]);
  const subNodes = p.match(/^\/api\/subscriptions\/([^/]+)\/nodes$/);
  if (subNodes && req.method === "GET") return alphaSubscriptionNodes(env, subNodes[1]);
  if (subNodes && req.method === "PUT") return alphaSetSubscriptionNodes(req, env, subNodes[1]);

  if (p === "/api/audit" && req.method === "GET") return alphaAuditList(req, env);
  if (p === "/api/audit/clear" && req.method === "POST") return alphaAuditClear(req, env);
  if (p === "/api/backup/export" && req.method === "GET") return alphaBackupExport(req, env);
  if (p === "/api/security/status" && req.method === "GET") return alphaSecurityStatus(req, env);
  if (p === "/api/security/overview" && req.method === "GET") return alphaSecurityOverview(req, env);
  if (p === "/api/system/diagnostics" && req.method === "GET") return alphaSystemDiagnostics(req, env);
  if (p === "/api/auth/session" && req.method === "GET") return alphaSessionInfo(req, env);
  if (p === "/api/auth/sessions/revoke-all" && req.method === "POST") return alphaRevokeAllSessions(req, env);

  if (p === "/api/reports/summary" && req.method === "GET") return alphaReportsSummary(req, env);
  if (p === "/api/reports/export" && req.method === "GET") return alphaReportsExport(req, env);

  if (p === "/api/operations/summary" && req.method === "GET") return alphaOperationsSummary(req, env);
  if (p === "/api/settings/health" && req.method === "GET") return alphaSettings(req, env);
  if (p === "/api/admin/roles" && req.method === "GET") return alphaAdminRoles(req, env);
  if (p === "/api/admin/roles" && req.method === "POST") return alphaAdminRoleCreate(req, env);
  const adminRoleMatch = p.match(/^\/api\/admin\/roles\/([^/]+)$/);
  if (adminRoleMatch && req.method === "PATCH") return alphaAdminRoleUpdate(req, env, adminRoleMatch[1]);

  if (p === "/api/panel/settings" && req.method === "GET") return alphaPanelSettingsGet(req, env);
  if (p === "/api/panel/settings" && req.method === "PUT") return alphaPanelSettingsPut(req, env);
  if (p === "/api/notifications" && req.method === "GET") return alphaNotifications(req, env);
  if (p === "/api/notifications/read-all" && req.method === "POST") return alphaNotificationsReadAll(req, env);
  const alphaNotifMatch = p.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (alphaNotifMatch && req.method === "POST") return alphaNotificationRead(req, env, alphaNotifMatch[1]);

  if (p === "/api/traffic/history" && req.method === "GET") return alphaTrafficHistory(req, env);
  if (p === "/api/traffic/snapshot" && req.method === "POST") return alphaTrafficSnapshot(req, env);

  return json({error:"Not found"},404);
}

function validateNodeEndpoint(value){
  try{
    const u=new URL(String(value||"").trim());
    if(!["http:","https:"].includes(u.protocol)) return {ok:false,error:"Endpoint must use http or https."};
    const host=u.hostname.toLowerCase();
    if(host==="localhost" || host==="127.0.0.1" || host==="0.0.0.0" || host==="::1" || host.endsWith(".local")) return {ok:false,error:"Local endpoints are not allowed."};
    if(/^10\\.|^127\\.|^169\\.254\\.|^192\\.168\\.|^172\\.(1[6-9]|2\\d|3[0-1])\\./.test(host)) return {ok:false,error:"Private IP endpoints are not allowed."};
    return {ok:true,url:u.toString()};
  }catch(_){return {ok:false,error:"Invalid endpoint URL."}}
}

async function createNode(req,env){
  const b=await req.json();
  if(!b.name||!b.endpoint)return json({error:"name and endpoint required"},400);
  const endpoint=validateNodeEndpoint(b.endpoint);
  if(!endpoint.ok)return json({error:endpoint.error},400);
  const id=token(8), now=Date.now();
  await env.DB.prepare("INSERT INTO nodes(id,name,country,endpoint,protocol,status,latency_ms,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(id,String(b.name).slice(0,120),String(b.country||"").slice(0,80),endpoint.url,b.protocol||"VLESS","unknown",null,now,now).run();
  await log(env,"node.create","admin",b.name);
  return json({ok:true,id});
}
async function updateNode(req,env,id){
  const b=await req.json(), now=Date.now();
  if(b.endpoint!==undefined){
    const endpoint=validateNodeEndpoint(b.endpoint);
    if(!endpoint.ok)return json({error:endpoint.error},400);
    b.endpoint=endpoint.url;
  }
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
    return json({name:user.username,protocol:user.protocol,status:user.status,quota_gb:user.quota_gb,used_gb:user.used_gb,expires_at:user.expires_at,device_limit:user.device_limit},200,{"Cache-Control":"no-store"});
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
  return json({name:user.username,protocol:user.protocol,status:user.status,quota_gb:user.quota_gb,used_gb:user.used_gb,expires_at:user.expires_at,device_limit:user.device_limit,configs},200,{"Cache-Control":"no-store"});
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
  const where=`WHERE (?='' OR username LIKE ? OR country LIKE ? OR protocol LIKE ?) AND (?='' OR status=?) AND (?='' OR country=?)`;
  const [r,total,active,traffic,expiring]=await Promise.all([
    env.DB.prepare(`SELECT id,username,protocol,country,quota_gb,used_gb,device_limit,status,expires_at,created_at,updated_at FROM users ${where} ORDER BY ${order} ${dir} LIMIT 500`)
      .bind(q,like,like,like,status,status,country,country).all(),
    env.DB.prepare(`SELECT COUNT(*) c FROM users ${where}`).bind(q,like,like,like,status,status,country,country).first(),
    env.DB.prepare(`SELECT COUNT(*) c FROM users ${where} AND status='active'`).bind(q,like,like,like,status,status,country,country).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(used_gb),0) v FROM users ${where}`).bind(q,like,like,like,status,status,country,country).first(),
    env.DB.prepare(`SELECT COUNT(*) c FROM users ${where} AND expires_at IS NOT NULL AND CAST(expires_at AS INTEGER)>? AND CAST(expires_at AS INTEGER)<=?`)
      .bind(q,like,like,like,status,status,country,country,Date.now(),Date.now()+7*86400000).first()
  ]);
  return json({
    items:r.results||[],
    stats:{
      total:Number(total?.c||0),
      active:Number(active?.c||0),
      traffic:Number(traffic?.v||0),
      expiring:Number(expiring?.c||0)
    }
  });
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
    const endpoint=validateNodeEndpoint(n.endpoint);
    if(!endpoint.ok) return json({error:endpoint.error},400);
    const target=new URL(endpoint.url);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    const r=await fetch(target.toString(),{method:"HEAD",signal:controller.signal,redirect:"manual"});
    clearTimeout(timer);
    latency=Date.now()-started;
    ok=r.status<500;
  }catch(e){latency=Date.now()-started;error=String(e?.message||e)}
  const status=ok?"online":"offline";
  await env.DB.prepare("UPDATE nodes SET status=?,latency_ms=?,updated_at=? WHERE id=?").bind(status,latency,Date.now(),id).run();
  await recordNodeHealth(env,id,status,latency,error||null);
  await log(env,"node.healthcheck","system",`${id}:${status}:${latency}`);
  return json({ok:true,node:{...n,status,latency_ms:latency},error:error||null});
}
async function monitorAllNodes(req,env){
  const r=await env.DB.prepare("SELECT id,name,country,endpoint,protocol,status,latency_ms,created_at,updated_at FROM nodes ORDER BY name").all();
  const items=[];
  for(const n of (r.results||[])){
    const started=Date.now(); let ok=false, err="";
    try{
      const endpoint=validateNodeEndpoint(n.endpoint);
      if(!endpoint.ok){ items.push({...n,status:"offline",latency_ms:null,error:endpoint.error}); continue; }
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),5000);
      const res=await fetch(endpoint.url,{method:"HEAD",signal:controller.signal,redirect:"manual"});
      clearTimeout(timer); ok=res.status<500;
    }catch(e){err=String(e?.message||e)}
    const latency=Date.now()-started, status=ok?"online":"offline";
    await env.DB.prepare("UPDATE nodes SET status=?,latency_ms=?,updated_at=? WHERE id=?").bind(status,latency,Date.now(),n.id).run();
    await recordNodeHealth(env,n.id,status,latency,err||null);
    items.push({...n,status,latency_ms:latency,error:err||null});
  }
  await log(env,"node.healthcheck.all","system",`${items.length} nodes`);
  return json({items});
}
async function recordNodeHealth(env,nodeId,status,latency,error){
  try{
    await env.DB.prepare("INSERT INTO node_health_history(id,node_id,checked_at,status,latency_ms,error) VALUES(?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),nodeId,Date.now(),status,latency,error).run();
    await env.DB.prepare("DELETE FROM node_health_history WHERE checked_at < ?").bind(Date.now()-30*86400000).run();
  }catch(_){ /* migration is optional until applied */ }
}
async function nodeHealthHistory(req,env,id){
  const u=new URL(req.url);
  const hours=Math.min(168,Math.max(1,Number(u.searchParams.get("hours")||24)));
  try{
    const r=await env.DB.prepare("SELECT checked_at,status,latency_ms,error FROM node_health_history WHERE node_id=? AND checked_at>=? ORDER BY checked_at ASC")
      .bind(id,Date.now()-hours*3600000).all();
    const items=r.results||[], online=items.filter(x=>x.status==='online').length;
    const avg=items.filter(x=>x.latency_ms!=null).reduce((a,x)=>a+Number(x.latency_ms),0)/(items.filter(x=>x.latency_ms!=null).length||1);
    return json({hours,items,uptime_pct:items.length?Math.round(online/items.length*1000)/10:0,avg_latency_ms:items.length?Math.round(avg):0});
  }catch(_){ return json({hours,items:[],uptime_pct:null,avg_latency_ms:null,storage:false}); }
}

async function nodeStats(req,env){
  const total=await env.DB.prepare("SELECT COUNT(*) c FROM nodes").first();
  const online=await env.DB.prepare("SELECT COUNT(*) c FROM nodes WHERE status='online'").first();
  const offline=await env.DB.prepare("SELECT COUNT(*) c FROM nodes WHERE status='offline'").first();
  const avg=await env.DB.prepare("SELECT AVG(latency_ms) a FROM nodes WHERE status='online' AND latency_ms IS NOT NULL").first();
  return json({total:Number(total?.c||0),online:Number(online?.c||0),offline:Number(offline?.c||0),avg_latency_ms:avg?.a?Math.round(avg.a):0});
}


async function alphaTrafficSnapshot(req, env) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const total = await env.DB.prepare("SELECT COALESCE(SUM(used_gb),0) v FROM users").first();
  const users = await env.DB.prepare("SELECT COUNT(*) c FROM users").first();
  const active = await env.DB.prepare("SELECT COUNT(*) c FROM users WHERE status='active'").first();
  try {
    await env.DB.prepare("INSERT INTO traffic_snapshots(id,captured_at,total_used_gb,users_count,active_users_count) VALUES(?,?,?,?,?)")
      .bind(id,now,Number(total?.v||0),Number(users?.c||0),Number(active?.c||0)).run();
    await env.DB.prepare("DELETE FROM traffic_snapshots WHERE captured_at < ?").bind(now-30*86400000).run();
    return json({ok:true,captured_at:now,total_used_gb:Number(total?.v||0),storage:true});
  } catch (e) {
    return json({error:"Traffic history table is not ready. Apply migration 0010_traffic_snapshots.sql."},503);
  }
}

async function alphaTrafficHistory(req, env) {
  const hours=Math.min(168,Math.max(1,Number(new URL(req.url).searchParams.get("hours")||24)));
  const since=Date.now()-hours*3600000;
  const current=await env.DB.prepare("SELECT COALESCE(SUM(used_gb),0) v FROM users").first();
  try {
    const r=await env.DB.prepare("SELECT captured_at,total_used_gb,users_count,active_users_count FROM traffic_snapshots WHERE captured_at>=? ORDER BY captured_at ASC")
      .bind(since).all();
    return json({hours,items:r.results||[],current_used_gb:Number(current?.v||0),storage:true});
  } catch (e) {
    // Keep Dashboard usable even if migration 0010 has not been applied yet.
    return json({hours,items:[],current_used_gb:Number(current?.v||0),storage:false,notice:"traffic_snapshots migration is not applied"});
  }
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
  const tables = ["users","nodes","activity_logs","subscription_nodes","admin_users","panel_settings","panel_notifications","traffic_snapshots"];
  const out = {format:"ALPHA-BACKUP",version:"5.3",created_at:Date.now(),tables:{}};

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

async function alphaSessionInfo(req, env) {
  const raw=req.headers.get("cookie")?.match(/alpha_session=([^;]+)/)?.[1];
  if(!raw) return json({authenticated:false});
  const hash=await sha(raw);
  const row=await env.DB.prepare("SELECT id,expires_at FROM admin_sessions WHERE token_hash=? AND expires_at>CURRENT_TIMESTAMP").bind(hash).first();
  if(!row) return json({authenticated:false});
  const count=await env.DB.prepare("SELECT COUNT(*) c FROM admin_sessions WHERE expires_at>CURRENT_TIMESTAMP").first();
  return json({authenticated:true,expires_at:row.expires_at,active_sessions:Number(count?.c||0)});
}
async function alphaRevokeAllSessions(req, env) {
  const raw=req.headers.get("cookie")?.match(/alpha_session=([^;]+)/)?.[1];
  if(!raw) return json({error:"Unauthorized"},401);
  const hash=await sha(raw);
  const current=await env.DB.prepare("SELECT id FROM admin_sessions WHERE token_hash=? AND expires_at>CURRENT_TIMESTAMP").bind(hash).first();
  if(!current) return json({error:"Unauthorized"},401);
  await env.DB.prepare("DELETE FROM admin_sessions").run();
  await log(env,"sessions.revoked_all","admin","all admin sessions revoked");
  return json({ok:true},200,{"Set-Cookie":"alpha_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});
}
async function alphaSystemDiagnostics(req, env) {
  const checks=[];
  const check=async(name,fn)=>{try{const value=await fn();checks.push({name,status:"ok",value});}catch(e){checks.push({name,status:"error",value:String(e?.message||e)});}};
  await check("database",async()=>{const r=await env.DB.prepare("SELECT 1 v").first();return r?.v===1?"reachable":"unexpected"});
  await check("users_table",async()=>{const r=await env.DB.prepare("SELECT COUNT(*) c FROM users").first();return `${Number(r?.c||0)} rows`});
  await check("nodes_table",async()=>{const r=await env.DB.prepare("SELECT COUNT(*) c FROM nodes").first();return `${Number(r?.c||0)} rows`});
  await check("sessions_table",async()=>{const r=await env.DB.prepare("SELECT COUNT(*) c FROM admin_sessions WHERE expires_at>CURRENT_TIMESTAMP").first();return `${Number(r?.c||0)} active`});
  await check("notifications_table",async()=>{const r=await env.DB.prepare("SELECT COUNT(*) c FROM panel_notifications").first();return `${Number(r?.c||0)} rows`});
  await check("traffic_snapshots",async()=>{const r=await env.DB.prepare("SELECT MAX(captured_at) v FROM traffic_snapshots").first();return r?.v?new Date(Number(r.v)).toISOString():"no snapshots"});
  await check("health_history",async()=>{const r=await env.DB.prepare("SELECT COUNT(*) c FROM node_health_history").first();return `${Number(r?.c||0)} rows`});
  const errors=checks.filter(x=>x.status!=="ok").length;
  return json({ok:errors===0,version:"6.6.0",checked_at:Date.now(),checks});
}


async function alphaSecurityOverview(req, env) {
  const [sessions, failed, blocked, recent] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) c FROM admin_sessions WHERE expires_at>CURRENT_TIMESTAMP").first(),
    env.DB.prepare("SELECT COALESCE(SUM(attempts),0) c FROM auth_rate_limits").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM auth_rate_limits WHERE blocked_until>?").bind(Date.now()).first(),
    env.DB.prepare("SELECT action,actor,details,created_at FROM activity_logs WHERE action IN ('login','login_failed','logout','sessions.revoked_all','admin.role.create','admin.role.update','audit.clear') ORDER BY id DESC LIMIT 20").all()
  ]);
  return json({
    generated_at:Date.now(),
    sessions:{active:Number(sessions?.c||0)},
    authentication:{failed_attempts:Number(failed?.c||0),blocked_ips:Number(blocked?.c||0)},
    events:recent.results||[],
    controls:{session_ttl_hours:24,login_attempt_limit:8,lockout_minutes:15,same_site:"Strict",secure_cookie:true,http_only:true}
  });
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





async function alphaOperationsSummary(req, env) {
  const now = Date.now();
  const soon = now + 7 * 86400000;
  const [
    expiring,
    exhausted,
    suspended,
    offline,
    staleNodes,
    unread,
    snapshot
  ] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) c FROM users WHERE expires_at IS NOT NULL AND CAST(expires_at AS INTEGER)>? AND CAST(expires_at AS INTEGER)<=? AND status!='disabled'").bind(now, soon).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM users WHERE quota_gb>0 AND used_gb>=quota_gb AND status='active'").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM users WHERE status='suspended'").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM nodes WHERE status='offline'").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM nodes WHERE updated_at<? AND status!='online'").bind(now-15*60*1000).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM panel_notifications WHERE is_read=0").first(),
    env.DB.prepare("SELECT captured_at,total_used_gb FROM traffic_snapshots ORDER BY captured_at DESC LIMIT 1").first()
  ]);
  const items = [
    {key:"offline_nodes", level:"danger", title:"Nodeهای آفلاین", count:Number(offline?.c||0), target:"nodes"},
    {key:"expiring_users", level:"warning", title:"انقضای نزدیک", count:Number(expiring?.c||0), target:"users"},
    {key:"quota_exhausted", level:"warning", title:"سهمیه تمام‌شده", count:Number(exhausted?.c||0), target:"users"},
    {key:"suspended_users", level:"info", title:"کاربران معلق", count:Number(suspended?.c||0), target:"users"},
    {key:"unread_notifications", level:"info", title:"اعلان خوانده‌نشده", count:Number(unread?.c||0), target:"security"}
  ].filter(x=>x.count>0);
  return json({
    generated_at: now,
    items,
    totals: {
      expiring_users:Number(expiring?.c||0),
      quota_exhausted:Number(exhausted?.c||0),
      suspended_users:Number(suspended?.c||0),
      offline_nodes:Number(offline?.c||0),
      stale_nodes:Number(staleNodes?.c||0),
      unread_notifications:Number(unread?.c||0)
    },
    traffic_snapshot: snapshot ? {
      captured_at:Number(snapshot.captured_at||0),
      total_used_gb:Number(snapshot.total_used_gb||0),
      age_minutes: Math.max(0, Math.round((now-Number(snapshot.captured_at||now))/60000))
    } : null
  });
}

async function alphaSettings(req, env) {
  const checks = [
    {key:"admin_auth", value:!!env.ALPHA_ADMIN_PASSWORD},
    {key:"d1", value:!!env.DB},
    {key:"pwa", value:true},
    {key:"audit", value:true}
  ];
  let nodeHealth={total:0,online:0,offline:0};
  try{
    const [total,online,offline]=await Promise.all([
      env.DB.prepare("SELECT COUNT(*) c FROM nodes").first(),
      env.DB.prepare("SELECT COUNT(*) c FROM nodes WHERE status='online'").first(),
      env.DB.prepare("SELECT COUNT(*) c FROM nodes WHERE status='offline'").first()
    ]);
    nodeHealth={total:Number(total?.c||0),online:Number(online?.c||0),offline:Number(offline?.c||0)};
  }catch(_){}
  return json({version:"6.2.0",checks,nodeHealth,generated_at:Date.now()});
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
async function alphaNotificationsSync(req, env) {
  const [usersR,nodesR] = await Promise.all([
    env.DB.prepare("SELECT id,username,quota_gb,used_gb,status,expires_at FROM users").all(),
    env.DB.prepare("SELECT id,name,status,latency_ms FROM nodes").all()
  ]);
  const users=usersR.results||[], nodes=nodesR.results||[], now=Date.now(), alerts=[];
  const add=(key,title,message,level="warning")=>alerts.push({key,title,message,level});
  const quota=users.filter(u=>u.status==='active'&&Number(u.quota_gb)>0&&Number(u.used_gb)/Number(u.quota_gb)>=.8);
  if(quota.length)add(`quota:${quota.length}`,"Quota نزدیک سقف",`${quota.length} کاربر فعال بیش از ۸۰٪ سهمیه خود را مصرف کرده‌اند.`,`warning`);
  const exhausted=users.filter(u=>u.status==='active'&&Number(u.quota_gb)>0&&Number(u.used_gb)>=Number(u.quota_gb));
  if(exhausted.length)add(`exhausted:${exhausted.length}`,"Quota تمام شده",`${exhausted.length} کاربر فعال به سقف سهمیه رسیده‌اند.`,`critical`);
  const expiring=users.filter(u=>u.status==='active'&&u.expires_at&&Number(u.expires_at)>now&&Number(u.expires_at)-now<=7*86400000);
  if(expiring.length)add(`expiry:${expiring.length}`,"انقضای نزدیک",`${expiring.length} کاربر در ۷ روز آینده منقضی می‌شوند.`,`warning`);
  const offline=nodes.filter(n=>n.status!=='online'&&n.status!=='active');
  if(offline.length)add(`nodes:${offline.length}`,"Node نیازمند بررسی",`${offline.length} Node آنلاین نیستند یا وضعیت نامشخص دارند.`,`critical`);
  const slow=nodes.filter(n=>Number(n.latency_ms)>500);
  if(slow.length)add(`latency:${slow.length}`,"Latency بالا",`${slow.length} Node دارای latency بالاتر از ۵۰۰ms هستند.`,`warning`);
  for(const a of alerts){
    const existing=await env.DB.prepare("SELECT id FROM panel_notifications WHERE title=? AND message=? AND created_at>? LIMIT 1").bind(a.title,a.message,now-6*3600000).first();
    if(!existing) await env.DB.prepare("INSERT INTO panel_notifications(id,title,message,level,is_read,created_at) VALUES(?,?,?,?,0,?)").bind(crypto.randomUUID(),a.title,a.message,a.level,now).run();
  }
  return alphaNotifications(req,env);
}

async function alphaNotificationRead(req, env, id) {
  await env.DB.prepare("UPDATE panel_notifications SET is_read=1 WHERE id=?").bind(id).run();
  return json({ok:true});
}
async function alphaNotificationsReadAll(req, env) {
  await env.DB.prepare("UPDATE panel_notifications SET is_read=1 WHERE is_read=0").run();
  return json({ok:true});
}



function csvCell(v){
  const x=String(v??"").replace(/"/g,'""');
  return `"${x}"`;
}
function csvResponse(rows,filename){
  const csv="\ufeff"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n")+"\r\n";
  return new Response(csv,{status:200,headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="${filename}"`}});
}
async function alphaReportsSummary(req,env){
  const u=new URL(req.url), days=Math.min(90,Math.max(1,Number(u.searchParams.get("days")||7))), since=Date.now()-days*86400000;
  const [users,nodes,traffic,activity,notifs]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active, SUM(CASE WHEN status='suspended' THEN 1 ELSE 0 END) suspended, COALESCE(SUM(used_gb),0) used, COALESCE(SUM(quota_gb),0) quota FROM users").first(),
    env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status IN ('online','active') THEN 1 ELSE 0 END) online, SUM(CASE WHEN status NOT IN ('online','active') THEN 1 ELSE 0 END) offline, COALESCE(AVG(latency_ms),0) latency FROM nodes").first(),
    env.DB.prepare("SELECT COUNT(*) points, COALESCE(MIN(total_used_gb),0) start_gb, COALESCE(MAX(total_used_gb),0) end_gb FROM traffic_snapshots WHERE captured_at>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM activity_logs WHERE created_at>=datetime('now',?)").bind(`-${days} days`).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM panel_notifications WHERE created_at>=? AND is_read=0").bind(since).first()
  ]);
  const total=Number(users?.total||0), active=Number(users?.active||0), used=Number(users?.used||0), quota=Number(users?.quota||0);
  return json({days,since,generated_at:Date.now(),users:{total,active,suspended:Number(users?.suspended||0),active_rate:total?Number((active/total*100).toFixed(1)):0,used_gb:used,quota_gb:quota,quota_usage:quota?Number((used/quota*100).toFixed(1)):0},nodes:{total:Number(nodes?.total||0),online:Number(nodes?.online||0),offline:Number(nodes?.offline||0),avg_latency_ms:Number(Number(nodes?.latency||0).toFixed(0))},traffic:{points:Number(traffic?.points||0),start_gb:Number(traffic?.start_gb||0),end_gb:Number(traffic?.end_gb||0),delta_gb:Number((Number(traffic?.end_gb||0)-Number(traffic?.start_gb||0)).toFixed(2))},activity:Number(activity?.c||0),unread_notifications:Number(notifs?.c||0)});
}
async function alphaReportsExport(req,env){
  const u=new URL(req.url), type=String(u.searchParams.get("type")||"users"), days=Math.min(90,Math.max(1,Number(u.searchParams.get("days")||30))), since=Date.now()-days*86400000;
  if(type==="users"){
    const r=await env.DB.prepare("SELECT username,protocol,country,status,quota_gb,used_gb,device_limit,expires_at,created_at FROM users ORDER BY id DESC").all();
    return csvResponse([["username","protocol","country","status","quota_gb","used_gb","device_limit","expires_at","created_at"],...(r.results||[]).map(x=>[x.username,x.protocol,x.country,x.status,x.quota_gb,x.used_gb,x.device_limit,x.expires_at,x.created_at])],`alpha-users-${new Date().toISOString().slice(0,10)}.csv`);
  }
  if(type==="nodes"){
    const r=await env.DB.prepare("SELECT name,country,endpoint,protocol,status,latency_ms,last_seen,created_at FROM nodes ORDER BY id DESC").all();
    return csvResponse([["name","country","endpoint","protocol","status","latency_ms","last_seen","created_at"],...(r.results||[]).map(x=>[x.name,x.country,x.endpoint,x.protocol,x.status,x.latency_ms,x.last_seen,x.created_at])],`alpha-nodes-${new Date().toISOString().slice(0,10)}.csv`);
  }
  if(type==="traffic"){
    const r=await env.DB.prepare("SELECT captured_at,total_used_gb,users_count,active_users_count FROM traffic_snapshots WHERE captured_at>=? ORDER BY captured_at ASC").bind(since).all();
    return csvResponse([["captured_at","total_used_gb","users_count","active_users_count"],...(r.results||[]).map(x=>[new Date(Number(x.captured_at)).toISOString(),x.total_used_gb,x.users_count,x.active_users_count])],`alpha-traffic-${days}d-${new Date().toISOString().slice(0,10)}.csv`);
  }
  if(type==="activity"){
    const r=await env.DB.prepare("SELECT action,actor,details,created_at FROM activity_logs WHERE created_at>=datetime('now',?) ORDER BY id DESC").bind(`-${days} days`).all();
    return csvResponse([["action","actor","details","created_at"],...(r.results||[]).map(x=>[x.action,x.actor,x.details,x.created_at])],`alpha-activity-${days}d-${new Date().toISOString().slice(0,10)}.csv`);
  }
  return json({error:"Unknown report type"},400);
}


async function takeTrafficSnapshot(env){
  if(!env.DB)return;
  const now=Date.now();
  const total=await env.DB.prepare("SELECT COALESCE(SUM(used_gb),0) v FROM users").first();
  const users=await env.DB.prepare("SELECT COUNT(*) c FROM users").first();
  const active=await env.DB.prepare("SELECT COUNT(*) c FROM users WHERE status='active'").first();
  await env.DB.prepare("INSERT INTO traffic_snapshots(id,captured_at,total_used_gb,users_count,active_users_count) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(),now,Number(total?.v||0),Number(users?.c||0),Number(active?.c||0)).run();
  await env.DB.prepare("DELETE FROM traffic_snapshots WHERE captured_at < ?").bind(now-30*86400000).run();
}

export default {
  async fetch(req,env){
    const u=new URL(req.url);
    if(u.pathname === "/panel" || u.pathname === "/panel/") return withSecurityHeaders(await env.ASSETS.fetch(new Request(new URL("/index.html",u),req)));
    if(u.pathname.startsWith("/sub/")){
      const sub=u.pathname.split("/").filter(Boolean)[1]||"";
      return withSecurityHeaders(await publicSubscription(sub,env,u));
    }
    if(u.pathname.startsWith("/api/")) return withSecurityHeaders(await api(req,env));
    return withSecurityHeaders(await env.ASSETS.fetch(req));
  },
  async scheduled(event,env,ctx){ ctx.waitUntil(takeTrafficSnapshot(env)); }
};
