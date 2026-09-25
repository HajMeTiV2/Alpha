const ALPHA_VERSION = "6.18.0";
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
  status:s, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...h}
});
async function sha(v){const b=await crypto.subtle.digest("SHA-256",enc.encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function token(){const b=crypto.getRandomValues(new Uint8Array(32));return [...b].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function auth(req,env){
  const t=req.headers.get("cookie")?.match(/(?:^|;)\s*alpha_session=([^;]+)/)?.[1];
  if(!t)return false;
  try{
    return !!await env.DB.prepare("SELECT id FROM admin_sessions WHERE token_hash=? AND expires_at>CURRENT_TIMESTAMP").bind(await sha(t)).first();
  }catch(_){
    return false;
  }
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
  if(p==="/api/health")return json({ok:true,name:"ALPHA",version:ALPHA_VERSION});
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
    }catch(_){
      return json({error:"Authentication storage is not ready. Apply the database migrations."},503);
    }
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
  if(p==="/api/users"&&req.method==="GET"){
    const page=Math.max(1,Math.min(10000,Number(u.searchParams.get("page")||1))||1);
    const limit=Math.max(10,Math.min(100,Number(u.searchParams.get("limit")||50))||50);
    const offset=(page-1)*limit;
    const [rows,total]=await Promise.all([
      env.DB.prepare("SELECT * FROM users ORDER BY id DESC LIMIT ? OFFSET ?").bind(limit,offset).all(),
      env.DB.prepare("SELECT COUNT(*) c FROM users").first()
    ]);
    return json({items:rows.results||[],page,limit,total:Number(total?.c||0),pages:Math.max(1,Math.ceil(Number(total?.c||0)/limit))});
  }
  if(p==="/api/users"&&req.method==="POST"){
    const b=await req.json().catch(()=>({})); if(!b.username)return json({error:"username is required"},400);
    try{
      const clientUuid=crypto.randomUUID(), subToken=token(24);
      await env.DB.prepare("INSERT INTO users(username,protocol,country,quota_gb,device_limit,status,expires_at,client_uuid,subscription_token) VALUES(?,?,?,?,?,?,?,?,?)").bind(
        b.username,b.protocol||"VLESS",b.country||"Unknown",Number(b.quota_gb||0),Number(b.device_limit||1),b.status||"active",b.expires_at||null,clientUuid,subToken).run();
      await log(env,"user_created",b.username); return json({ok:true,subscription_token:subToken},201);
    }catch{return json({error:"Could not create user"},409)}
  }
  const userNotesMatch=p.match(/^\/api\/users\/([^/]+)\/notes$/);
  if(userNotesMatch && req.method==="GET")return userNotesList(req,env,userNotesMatch[1]);
  if(userNotesMatch && req.method==="POST")return userNoteCreate(req,env,userNotesMatch[1]);
  const userTimelineMatch=p.match(/^\/api\/users\/([^/]+)\/timeline$/);
  if(userTimelineMatch && req.method==="GET")return userTimeline(req,env,userTimelineMatch[1]);
  const user360Match=p.match(/^\/api\/users\/([^/]+)\/360$/);
  if(user360Match && req.method==="GET")return user360(req,env,user360Match[1]);
  if(p.startsWith("/api/users/")&&req.method==="PATCH"){
    const id=p.split("/").pop(),b=await req.json().catch(()=>({}));
    const before=await env.DB.prepare("SELECT status,quota_gb,device_limit,expires_at FROM users WHERE id=?").bind(id).first();
    const result=await env.DB.prepare("UPDATE users SET status=COALESCE(?,status),quota_gb=COALESCE(?,quota_gb),device_limit=COALESCE(?,device_limit),expires_at=COALESCE(?,expires_at),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.status??null,b.quota_gb??null,b.device_limit??null,b.expires_at??null,id).run();
    if(!result.meta.changes)return json({error:"not found"},404);
    await subscriptionEvent(env,id,"updated",{before,changes:b});
    await log(env,"user_updated",id); return json({ok:true});
  }
  if(p.startsWith("/api/users/")&&req.method==="DELETE"){const id=p.split("/").pop();await env.DB.prepare("DELETE FROM users WHERE id=?").bind(id).run();await log(env,"user_deleted",id);return json({ok:true})}
  // ALPHA 6.18 Config Factory
  if(p==="/api/config/ip-repository"&&req.method==="GET")return configRepoList(req,env,"ip");
  if(p==="/api/config/ip-repository"&&req.method==="POST")return configRepoCreate(req,env,"ip");
  const ipRepoMatch=p.match(/^\/api\/config\/ip-repository\/([^/]+)$/);
  if(ipRepoMatch&&req.method==="PATCH")return configRepoUpdate(req,env,"ip",ipRepoMatch[1]);
  if(ipRepoMatch&&req.method==="DELETE")return configRepoDelete(req,env,"ip",ipRepoMatch[1]);
  if(p==="/api/config/proxy-repository"&&req.method==="GET")return configRepoList(req,env,"proxy");
  if(p==="/api/config/proxy-repository"&&req.method==="POST")return configRepoCreate(req,env,"proxy");
  const proxyRepoMatch=p.match(/^\/api\/config\/proxy-repository\/([^/]+)$/);
  if(proxyRepoMatch&&req.method==="PATCH")return configRepoUpdate(req,env,"proxy",proxyRepoMatch[1]);
  if(proxyRepoMatch&&req.method==="DELETE")return configRepoDelete(req,env,"proxy",proxyRepoMatch[1]);
  if(p==="/api/config/templates"&&req.method==="GET")return configTemplates(req,env);
  if(p==="/api/config/templates"&&req.method==="POST")return configTemplateCreate(req,env);
  const templateMatch=p.match(/^\/api\/config\/templates\/([^/]+)$/);
  if(templateMatch&&req.method==="DELETE")return configTemplateDelete(req,env,templateMatch[1]);
  if(p==="/api/config/generate"&&req.method==="POST")return configGenerate(req,env);
  if(p==="/api/config/snapshots"&&req.method==="GET")return configSnapshots(req,env);
  if(p==="/api/config/snapshots"&&req.method==="POST")return configSnapshotCreate(req,env);

  if(p==="/api/nodes"&&req.method==="GET")return listNodes(req,env);
  if(p==="/api/nodes"&&req.method==="POST")return createNode(req,env);
  if(p.startsWith("/api/nodes/")&&req.method==="PATCH")return updateNode(req,env,p.split("/").pop());
  if(p.startsWith("/api/nodes/")&&req.method==="DELETE")return deleteNode(req,env,p.split("/").pop());
  const nodeOpsMatch=p.match(/^\/api\/nodes\/([^/]+)\/operations$/);
  if(nodeOpsMatch && req.method==="POST")return nodeOperations(req,env,nodeOpsMatch[1]);
  if(p==="/api/nodes/operations" && req.method==="GET")return nodeOperationsSummary(req,env);
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
  if (p === "/api/backup/manifest" && req.method === "GET") return alphaBackupManifestList(req, env);
  if (p === "/api/backup/manifest" && req.method === "POST") return alphaBackupManifestCreate(req, env);
  if (p === "/api/backup/restore" && req.method === "POST") return alphaBackupRestore(req, env);
  if (p === "/api/security/status" && req.method === "GET") return alphaSecurityStatus(req, env);
  if (p === "/api/security/overview" && req.method === "GET") return alphaSecurityOverview(req, env);
  if (p === "/api/system/diagnostics" && req.method === "GET") return alphaSystemDiagnostics(req, env);
  if (p === "/api/auth/session" && req.method === "GET") return alphaSessionInfo(req, env);
  if (p === "/api/auth/sessions/revoke-all" && req.method === "POST") return alphaRevokeAllSessions(req, env);

  if (p === "/api/reports/summary" && req.method === "GET") return alphaReportsSummary(req, env);
  if (p === "/api/reports/export" && req.method === "GET") return alphaReportsExport(req, env);
  if (p === "/api/jobs" && req.method === "GET") return alphaJobsList(req, env);
  if (p === "/api/jobs/run-due" && req.method === "POST") return alphaRunDueJobs(req, env);
  if (p === "/api/jobs" && req.method === "POST") return alphaJobCreate(req, env);
  const alphaJobRunMatch = p.match(/^\/api\/jobs\/([^/]+)\/run$/);
  if (alphaJobRunMatch && req.method === "POST") return alphaRunJob(req, env, alphaJobRunMatch[1], "manual");
  const alphaJobMatch = p.match(/^\/api\/jobs\/([^/]+)$/);
  if (alphaJobMatch && req.method === "PATCH") return alphaJobUpdate(req, env, alphaJobMatch[1]);
  if (alphaJobMatch && req.method === "DELETE") return alphaJobDelete(req, env, alphaJobMatch[1]);

  if (p === "/api/monitoring/overview" && req.method === "GET") return alphaMonitoringOverview(req, env);
  if (p === "/api/performance/overview" && req.method === "GET") return alphaPerformanceOverview(req, env);
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

  if (p === "/api/integrations/api-keys" && req.method === "GET") return alphaApiKeysList(req, env);
  if (p === "/api/integrations/api-keys" && req.method === "POST") return alphaApiKeyCreate(req, env);
  const apiKeyMatch=p.match(/^\/api\/integrations\/api-keys\/([^/]+)$/);
  if(apiKeyMatch && req.method === "PATCH") return alphaApiKeyUpdate(req, env, apiKeyMatch[1]);
  if(apiKeyMatch && req.method === "DELETE") return alphaApiKeyDelete(req, env, apiKeyMatch[1]);
  if (p === "/api/integrations/webhooks" && req.method === "GET") return alphaWebhooksList(req, env);
  if (p === "/api/integrations/webhooks" && req.method === "POST") return alphaWebhookCreate(req, env);
  const webhookMatch=p.match(/^\/api\/integrations\/webhooks\/([^/]+)$/);
  if(webhookMatch && req.method === "PATCH") return alphaWebhookUpdate(req, env, webhookMatch[1]);
  if(webhookMatch && req.method === "DELETE") return alphaWebhookDelete(req, env, webhookMatch[1]);
  const webhookTestMatch=p.match(/^\/api\/integrations\/webhooks\/([^/]+)\/test$/);
  if(webhookTestMatch && req.method === "POST") return alphaWebhookTest(req, env, webhookTestMatch[1]);
  if (p === "/api/integrations/overview" && req.method === "GET") return alphaIntegrationsOverview(req, env);
  if (p === "/api/v1/health" && req.method === "GET") return alphaIntegrationHealth(req, env);

  return json({error:"Not found"},404);
}


async function alphaHashSecret(v){return sha(String(v||""))}
function alphaIntegrationSecret(prefix="alpha"){return `${prefix}_${token().slice(0,48)}`}
async function alphaApiKeyAuth(req,env,scope="read"){
  const raw=req.headers.get("X-ALPHA-API-Key")||req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
  if(!raw)return null;
  const row=await env.DB.prepare("SELECT * FROM api_keys WHERE key_hash=? AND enabled=1").bind(await alphaHashSecret(raw)).first();
  if(!row)return null;
  const scopes=JSON.parse(row.scopes||"[]");
  if(scope && !scopes.includes(scope) && !scopes.includes("*") )return null;
  await env.DB.prepare("UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP,usage_count=usage_count+1 WHERE id=?").bind(row.id).run();
  return row;
}
async function alphaApiKeysList(req,env){
  const r=await env.DB.prepare("SELECT id,name,key_prefix,scopes,enabled,last_used_at,usage_count,created_at FROM api_keys ORDER BY created_at DESC").all();
  return json({items:(r.results||[]).map(x=>({...x,scopes:JSON.parse(x.scopes||"[]")}))});
}
async function alphaApiKeyCreate(req,env){
  const b=await req.json().catch(()=>({})), name=String(b.name||"Integration Key").trim().slice(0,80);
  const scopes=Array.isArray(b.scopes)&&b.scopes.length?b.scopes.filter(x=>["read","write","*"] .includes(String(x))):["read"];
  const secret=alphaIntegrationSecret("alpha");
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO api_keys(id,name,key_prefix,key_hash,scopes) VALUES(?,?,?,?,?)").bind(id,name,secret.slice(0,12),await alphaHashSecret(secret),JSON.stringify(scopes)).run();
  await log(env,"integration.api_key.create","admin",name);
  return json({ok:true,item:{id,name,key_prefix:secret.slice(0,12),scopes,enabled:1},secret,warning:"این کلید فقط همین بار نمایش داده می‌شود."},201);
}
async function alphaApiKeyUpdate(req,env,id){
  const b=await req.json().catch(()=>({}));
  const enabled=b.enabled==null?null:(b.enabled?1:0);
  const name=b.name==null?null:String(b.name).slice(0,80);
  const scopes=Array.isArray(b.scopes)?JSON.stringify(b.scopes.filter(x=>["read","write","*"].includes(String(x)))):null;
  await env.DB.prepare("UPDATE api_keys SET name=COALESCE(?,name),enabled=COALESCE(?,enabled),scopes=COALESCE(?,scopes) WHERE id=?").bind(name,enabled,scopes,id).run();
  await log(env,"integration.api_key.update","admin",id); return json({ok:true});
}
async function alphaApiKeyDelete(req,env,id){await env.DB.prepare("DELETE FROM api_keys WHERE id=?").bind(id).run();await log(env,"integration.api_key.delete","admin",id);return json({ok:true})}
function alphaWebhookUrlValid(value){try{const u=new URL(String(value||"")); if(!["https:","http:"].includes(u.protocol))return false; if(["localhost","127.0.0.1","0.0.0.0","::1"].includes(u.hostname))return false; return true}catch{return false}}
async function alphaWebhooksList(req,env){
  const r=await env.DB.prepare("SELECT id,name,url,events,enabled,last_status,last_delivered_at,failure_count,created_at,updated_at FROM webhooks ORDER BY created_at DESC").all();
  return json({items:(r.results||[]).map(x=>({...x,events:JSON.parse(x.events||"[]")}))});
}
async function alphaWebhookCreate(req,env){
  const b=await req.json().catch(()=>({}));
  const name=String(b.name||"Webhook").trim().slice(0,80),url=String(b.url||"").trim();
  if(!alphaWebhookUrlValid(url))return json({error:"Webhook URL must be a valid HTTP(S) endpoint."},400);
  const events=Array.isArray(b.events)&&b.events.length?b.events.map(String).slice(0,20):["*"];
  const secret=alphaIntegrationSecret("whsec");
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO webhooks(id,name,url,events,secret_hash,secret_prefix) VALUES(?,?,?,?,?,?)").bind(id,name,url,JSON.stringify(events),await alphaHashSecret(secret),secret.slice(0,12)).run();
  await log(env,"integration.webhook.create","admin",name);
  return json({ok:true,item:{id,name,url,events,enabled:1,secret_prefix:secret.slice(0,12)},secret,warning:"Secret فقط همین بار نمایش داده می‌شود."},201);
}
async function alphaWebhookUpdate(req,env,id){const b=await req.json().catch(()=>({})); const enabled=b.enabled==null?null:(b.enabled?1:0); const name=b.name==null?null:String(b.name).slice(0,80); const url=b.url==null?null:String(b.url).trim(); if(url&&!alphaWebhookUrlValid(url))return json({error:"Invalid webhook URL"},400); const events=Array.isArray(b.events)?JSON.stringify(b.events.map(String).slice(0,20)):null; await env.DB.prepare("UPDATE webhooks SET name=COALESCE(?,name),url=COALESCE(?,url),enabled=COALESCE(?,enabled),events=COALESCE(?,events),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name,url,enabled,events,id).run(); await log(env,"integration.webhook.update","admin",id); return json({ok:true})}
async function alphaWebhookDelete(req,env,id){await env.DB.prepare("DELETE FROM webhook_deliveries WHERE webhook_id=?").bind(id).run();await env.DB.prepare("DELETE FROM webhooks WHERE id=?").bind(id).run();await log(env,"integration.webhook.delete","admin",id);return json({ok:true})}
async function alphaWebhookDeliver(env,w,event,payload){
  const started=Date.now(),body=JSON.stringify({event,created_at:new Date().toISOString(),data:payload});
  const sig=await alphaHashSecret(`${w.secret_hash}:${body}`);
  try{const r=await fetch(w.url,{method:"POST",headers:{"content-type":"application/json","x-alpha-event":event,"x-alpha-signature":sig},body});const status=r.status;const ok=r.ok;await env.DB.prepare("INSERT INTO webhook_deliveries(id,webhook_id,event,status,http_status,duration_ms,error) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(),w.id,event,ok?"success":"failed",status,Date.now()-started,ok?null:`HTTP ${status}`).run();await env.DB.prepare("UPDATE webhooks SET last_status=?,last_delivered_at=CURRENT_TIMESTAMP,failure_count=CASE WHEN ? THEN 0 ELSE failure_count+1 END WHERE id=?").bind(status,ok?1:0,w.id).run();return {ok,status};}
  catch(e){const msg=String(e?.message||e).slice(0,300);await env.DB.prepare("INSERT INTO webhook_deliveries(id,webhook_id,event,status,http_status,duration_ms,error) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(),w.id,event,"failed",0,Date.now()-started,msg).run();await env.DB.prepare("UPDATE webhooks SET last_status=0,last_delivered_at=CURRENT_TIMESTAMP,failure_count=failure_count+1 WHERE id=?").bind(w.id).run();return {ok:false,error:msg}}
}
async function alphaWebhookTest(req,env,id){const w=await env.DB.prepare("SELECT * FROM webhooks WHERE id=?").bind(id).first();if(!w)return json({error:"Webhook not found"},404);const r=await alphaWebhookDeliver(env,w,"test",{message:"ALPHA integration test",timestamp:Date.now()});return json(r,r.ok?200:502)}
async function alphaIntegrationsOverview(req,env){const [k,w,d]=await Promise.all([env.DB.prepare("SELECT COUNT(*) total,SUM(enabled) enabled,COALESCE(SUM(usage_count),0) usage FROM api_keys").first(),env.DB.prepare("SELECT COUNT(*) total,SUM(enabled) enabled,COALESCE(SUM(failure_count),0) failures FROM webhooks").first(),env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success FROM webhook_deliveries WHERE created_at>=datetime('now','-24 hours')").first()]);return json({api_keys:{total:Number(k?.total||0),enabled:Number(k?.enabled||0),usage:Number(k?.usage||0)},webhooks:{total:Number(w?.total||0),enabled:Number(w?.enabled||0),failures:Number(w?.failures||0)},deliveries24h:{total:Number(d?.total||0),success:Number(d?.success||0)}})}
async function alphaIntegrationHealth(req,env){const key=await alphaApiKeyAuth(req,env,"read");if(!key)return json({error:"Valid X-ALPHA-API-Key is required"},401);return json({ok:true,service:"ALPHA",version:ALPHA_VERSION,timestamp:Date.now(),key:key.key_prefix})}

async function configRepoList(req,env,type){
  const table=type==="ip"?"config_ip_repository":"config_proxy_repository";
  const q=String(new URL(req.url).searchParams.get("q")||"").trim();
  const status=String(new URL(req.url).searchParams.get("status")||"").trim();
  const where=[],bind=[];
  if(q){where.push(type==="ip"?"(address LIKE ? OR country LIKE ? OR provider LIKE ? OR source LIKE ? OR tags LIKE ?)":"(host LIKE ? OR country LIKE ? OR provider LIKE ? OR source LIKE ? OR tags LIKE ?)");for(let i=0;i<5;i++)bind.push(`%${q}%`)}
  if(status){where.push("status=?");bind.push(status)}
  const cols=type==="ip"?"id,address,port,country,city,provider,source,status,latency_ms,last_checked_at,tags,notes,created_at,updated_at":"id,host,port,type,username,country,provider,source,status,latency_ms,last_checked_at,tags,notes,created_at,updated_at";
  const sql=`SELECT ${cols} FROM ${table} ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY updated_at DESC,id DESC LIMIT 200`;
  const r=await env.DB.prepare(sql).bind(...bind).all();return json({items:r.results||[],type});
}
async function configRepoCreate(req,env,type){
  const b=await req.json().catch(()=>({})),now=Date.now(),id=crypto.randomUUID();
  try{
    if(type==="ip"){
      const address=String(b.address||"").trim();if(!address)return json({error:"address is required"},400);
      await env.DB.prepare("INSERT INTO config_ip_repository(id,address,port,country,city,provider,source,status,latency_ms,last_checked_at,tags,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,address,Number(b.port||0)||null,String(b.country||"Unknown"),String(b.city||""),String(b.provider||""),String(b.source||"manual"),String(b.status||"active"),Number.isFinite(Number(b.latency_ms))?Number(b.latency_ms):null,b.last_checked_at||null,JSON.stringify(Array.isArray(b.tags)?b.tags:[]),String(b.notes||""),now,now).run();
    }else{
      const host=String(b.host||"").trim(),port=Number(b.port||0);if(!host||!port)return json({error:"host and port are required"},400);
      await env.DB.prepare("INSERT INTO config_proxy_repository(id,host,port,type,username,password,country,provider,source,status,latency_ms,last_checked_at,tags,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,host,port,String(b.type||"HTTP").toUpperCase(),String(b.username||""),String(b.password||""),String(b.country||"Unknown"),String(b.provider||""),String(b.source||"manual"),String(b.status||"active"),Number.isFinite(Number(b.latency_ms))?Number(b.latency_ms):null,b.last_checked_at||null,JSON.stringify(Array.isArray(b.tags)?b.tags:[]),String(b.notes||""),now,now).run();
    }
    await log(env,`config.${type}.create`,"admin",id);return json({ok:true,id},201);
  }catch(e){return json({error:"Could not create repository item",details:String(e?.message||"")},409)}
}
async function configRepoUpdate(req,env,type,id){
  const b=await req.json().catch(()=>({})),table=type==="ip"?"config_ip_repository":"config_proxy_repository";
  const now=Date.now();
  const fields=type==="ip"?[
    ["address",b.address],["port",b.port==null?null:Number(b.port)||null],["country",b.country],["city",b.city],["provider",b.provider],["source",b.source],["status",b.status],["latency_ms",b.latency_ms==null?null:Number(b.latency_ms)],["last_checked_at",b.last_checked_at],["tags",Array.isArray(b.tags)?JSON.stringify(b.tags):b.tags],["notes",b.notes]
  ]:[
    ["host",b.host],["port",b.port==null?null:Number(b.port)||null],["type",b.type],["username",b.username],["password",b.password],["country",b.country],["provider",b.provider],["source",b.source],["status",b.status],["latency_ms",b.latency_ms==null?null:Number(b.latency_ms)],["last_checked_at",b.last_checked_at],["tags",Array.isArray(b.tags)?JSON.stringify(b.tags):b.tags],["notes",b.notes]
  ];
  const allowed=fields.filter(([,v])=>v!==undefined).map(([k])=>k),values=fields.filter(([,v])=>v!==undefined).map(([,v])=>v);
  if(!allowed.length)return json({error:"No changes supplied"},400);
  allowed.push("updated_at");values.push(now);
  const set=allowed.map(k=>`${k}=?`).join(",");const r=await env.DB.prepare(`UPDATE ${table} SET ${set} WHERE id=?`).bind(...values,id).run();
  if(!r.meta.changes)return json({error:"not found"},404);await log(env,`config.${type}.update`,"admin",id);return json({ok:true});
}
async function configRepoDelete(req,env,type,id){const table=type==="ip"?"config_ip_repository":"config_proxy_repository";const r=await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();if(!r.meta.changes)return json({error:"not found"},404);await log(env,`config.${type}.delete`,"admin",id);return json({ok:true})}
async function configTemplates(req,env){const r=await env.DB.prepare("SELECT id,name,mode,settings_json,created_at,updated_at FROM config_templates ORDER BY updated_at DESC,id DESC LIMIT 100").all();return json({items:r.results||[]})}
async function configTemplateCreate(req,env){const b=await req.json().catch(()=>({}));const name=String(b.name||"").trim();if(!name)return json({error:"name is required"},400);const id=crypto.randomUUID(),now=Date.now(),settings=JSON.stringify(b.settings||{});await env.DB.prepare("INSERT INTO config_templates(id,name,mode,settings_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(id,name,String(b.mode||"simple"),settings,now,now).run();await log(env,"config.template.create","admin",name);return json({ok:true,id},201)}
async function configTemplateDelete(req,env,id){const r=await env.DB.prepare("DELETE FROM config_templates WHERE id=?").bind(id).run();if(!r.meta.changes)return json({error:"not found"},404);await log(env,"config.template.delete","admin",id);return json({ok:true})}
function configBuildText(b,user,ip){
  const protocol=String(b.protocol||user?.protocol||"VLESS").toUpperCase();const address=String(ip?.address||b.address||"").trim();const port=Number(b.port||ip?.port||443);const uuid=String(user?.client_uuid||b.uuid||"");
  if(protocol==="VLESS"&&uuid&&address){const qs=new URLSearchParams();qs.set("type",String(b.transport||"tcp"));qs.set("security",String(b.security||"none"));if(b.sni)qs.set("sni",String(b.sni));if(b.path)qs.set("path",String(b.path));if(b.host)qs.set("host",String(b.host));if(b.fp)qs.set("fp",String(b.fp));if(b.flow)qs.set("flow",String(b.flow));return `vless://${uuid}@${address}:${port}?${qs.toString()}#${encodeURIComponent(String(b.name||user?.username||"ALPHA"))}`}
  if(address)return `${protocol} ${address}:${port}`;
  return "";
}
async function configGenerate(req,env){
  const b=await req.json().catch(()=>({}));const userId=b.user_id?String(b.user_id):"";let user=null,ip=null,proxy=null;
  if(userId){user=await env.DB.prepare("SELECT id,username,protocol,client_uuid,subscription_token FROM users WHERE id=?").bind(userId).first();if(!user)return json({error:"user not found"},404)}
  if(b.ip_id)ip=await env.DB.prepare("SELECT * FROM config_ip_repository WHERE id=? AND status='active'").bind(String(b.ip_id)).first();
  if(b.proxy_id)proxy=await env.DB.prepare("SELECT id,host,port,type,username,country,provider,status,latency_ms,tags,notes FROM config_proxy_repository WHERE id=? AND status='active'").bind(String(b.proxy_id)).first();
  const settings={...b};delete settings.user_id;delete settings.ip_id;delete settings.proxy_id;
  const errors=[];if(!settings.protocol)settings.protocol=user?.protocol||"VLESS";if(!ip && !settings.address)errors.push("یک IP از مخزن انتخاب کنید");if(String(settings.protocol).toUpperCase()==="VLESS"&&!user&&!settings.uuid)errors.push("کاربر برای UUID انتخاب نشده است");if(errors.length)return json({valid:false,errors},400);
  const configText=configBuildText(settings,user,ip);if(!configText)return json({valid:false,errors:["اطلاعات کافی برای ساخت کانفیگ وجود ندارد"]},400);
  return json({valid:true,config:configText,settings,ip,proxy,user:user?{id:user.id,username:user.username,protocol:user.protocol}:null,generated_at:Date.now()});
}
async function configSnapshots(req,env){const r=await env.DB.prepare("SELECT id,name,version,status,user_id,template_id,settings_json,config_text,created_at,updated_at FROM config_snapshots ORDER BY created_at DESC LIMIT 100").all();return json({items:r.results||[]})}
async function configSnapshotCreate(req,env){
  const b=await req.json().catch(()=>({}));const name=String(b.name||"Config").trim().slice(0,120);const settings=b.settings||{};const generated=await configGenerate(new Request("https://alpha.local/api/config/generate",{method:"POST",body:JSON.stringify(b),headers:{"content-type":"application/json"}}),env);const data=await generated.json();if(!generated.ok||!data.valid)return json(data,400);
  const id=crypto.randomUUID(),now=Date.now(),existing=await env.DB.prepare("SELECT COALESCE(MAX(version),0) v FROM config_snapshots WHERE name=?").bind(name).first();const version=Number(existing?.v||0)+1;await env.DB.prepare("INSERT INTO config_snapshots(id,name,version,status,user_id,template_id,settings_json,config_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,name,version,"active",b.user_id||null,b.template_id||null,JSON.stringify({...settings,ip_snapshot:data.ip,proxy_snapshot:data.proxy}),data.config,now,now).run();await log(env,"config.snapshot.create","admin",`${name}:v${version}`);return json({ok:true,id,version,config:data.config,ip:data.ip,proxy:data.proxy});
}

async function listNodes(req,env){
  const q=new URL(req.url).searchParams;
  const status=String(q.get("status")||"").trim();
  const maintenance=q.get("maintenance");
  const where=[]; const args=[];
  if(status){where.push("status=?");args.push(status)}
  if(maintenance!==null && ["0","1"].includes(maintenance)){where.push("maintenance_mode=?");args.push(Number(maintenance))}
  const sql=`SELECT * FROM nodes ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY maintenance_mode ASC, drain_mode ASC, status='online' DESC, id DESC`;
  const r=await env.DB.prepare(sql).bind(...args).all();
  return json(r.results||[]);
}

async function nodeOperations(req,env,id){
  const b=await req.json().catch(()=>({}));
  const action=String(b.action||"").trim();
  const n=await env.DB.prepare("SELECT * FROM nodes WHERE id=?").bind(id).first();
  if(!n)return json({error:"not found"},404);
  const now=Date.now();
  if(action==="maintenance_on"||action==="maintenance_off"){
    const v=action==="maintenance_on"?1:0;
    await env.DB.prepare("UPDATE nodes SET maintenance_mode=?,updated_at=? WHERE id=?").bind(v,now,id).run();
  }else if(action==="drain_on"||action==="drain_off"){
    const v=action==="drain_on"?1:0;
    await env.DB.prepare("UPDATE nodes SET drain_mode=?,updated_at=? WHERE id=?").bind(v,now,id).run();
  }else if(action==="weight"){
    const v=Math.max(1,Math.min(1000,Number(b.value||100)));
    await env.DB.prepare("UPDATE nodes SET weight=?,updated_at=? WHERE id=?").bind(v,now,id).run();
  }else if(action==="capacity"){
    const v=Math.max(0,Math.min(100000,Number(b.value||0)));
    await env.DB.prepare("UPDATE nodes SET capacity=?,updated_at=? WHERE id=?").bind(v,now,id).run();
  }else if(action==="tags"){
    const tags=Array.isArray(b.value)?b.value.map(x=>String(x).trim()).filter(Boolean).slice(0,20):[];
    await env.DB.prepare("UPDATE nodes SET tags=?,updated_at=? WHERE id=?").bind(JSON.stringify(tags),now,id).run();
  }else if(action==="notes"){
    await env.DB.prepare("UPDATE nodes SET notes=?,updated_at=? WHERE id=?").bind(String(b.value||"").slice(0,1000),now,id).run();
  }else{return json({error:"Unsupported node operation"},400)}
  await log(env,`node.operation.${action}`,"admin",String(id));
  return json({ok:true,action});
}

async function nodeOperationsSummary(req,env){
  const [t,o,m,d,h]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) c FROM nodes").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM nodes WHERE status='online' AND maintenance_mode=0 AND drain_mode=0").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM nodes WHERE maintenance_mode=1").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM nodes WHERE drain_mode=1").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM node_health_history WHERE checked_at>=strftime('%s','now')*1000-86400000 AND status='offline'").first()
  ]);
  return json({total:Number(t?.c||0),ready:Number(o?.c||0),maintenance:Number(m?.c||0),draining:Number(d?.c||0),offline_events_24h:Number(h?.c||0)});
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
  const tags=Array.isArray(b.tags)?b.tags.map(x=>String(x).trim()).filter(Boolean).slice(0,20):[];
  await env.DB.prepare("INSERT INTO nodes(id,name,country,endpoint,protocol,status,latency_ms,created_at,updated_at,weight,capacity,tags,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id,String(b.name).slice(0,120),String(b.country||"").slice(0,80),endpoint.url,b.protocol||"VLESS","unknown",null,now,now,Math.max(1,Math.min(1000,Number(b.weight||100))),Math.max(0,Math.min(100000,Number(b.capacity||0))),JSON.stringify(tags),String(b.notes||"").slice(0,1000)).run();
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
  const tags=b.tags===undefined?null:(Array.isArray(b.tags)?JSON.stringify(b.tags.map(x=>String(x).trim()).filter(Boolean).slice(0,20)):"[]");
  const r=await env.DB.prepare("UPDATE nodes SET name=COALESCE(?,name),country=COALESCE(?,country),endpoint=COALESCE(?,endpoint),protocol=COALESCE(?,protocol),status=COALESCE(?,status),latency_ms=COALESCE(?,latency_ms),weight=COALESCE(?,weight),capacity=COALESCE(?,capacity),tags=COALESCE(?,tags),notes=COALESCE(?,notes),updated_at=? WHERE id=?")
    .bind(b.name??null,b.country??null,b.endpoint??null,b.protocol??null,b.status??null,b.latency_ms??null,b.weight==null?null:Math.max(1,Math.min(1000,Number(b.weight))),b.capacity==null?null:Math.max(0,Math.min(100000,Number(b.capacity))),tags,b.notes==null?null:String(b.notes).slice(0,1000),now,id).run();
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


async function subscriptionEvent(env,userId,eventType,details){
  try{await env.DB.prepare("INSERT INTO subscription_events(id,user_id,event_type,details,created_at) VALUES(?,?,?,?,?)").bind(token(12),String(userId),eventType,JSON.stringify(details||{}),Date.now()).run();}catch(_){}
}
async function userNotesList(req,env,userId){
  const r=await env.DB.prepare("SELECT id,note,created_at,updated_at FROM user_notes WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(userId).all();
  return json({items:r.results||[]});
}
async function userNoteCreate(req,env,userId){
  const exists=await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(userId).first();
  if(!exists)return json({error:"not found"},404);
  const b=await req.json().catch(()=>({})); const note=String(b.note||"").trim(); if(!note)return json({error:"note is required"},400);
  const now=Date.now(),id=token(12); await env.DB.prepare("INSERT INTO user_notes(id,user_id,note,created_at,updated_at) VALUES(?,?,?,?,?)").bind(id,userId,note,now,now).run();
  await subscriptionEvent(env,userId,"note_added",{note}); await log(env,"user.note_added","admin",userId); return json({ok:true,id},201);
}
async function userTimeline(req,env,userId){
  const [events,notes,activity]=await Promise.all([
    env.DB.prepare("SELECT id,event_type,details,created_at FROM subscription_events WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(userId).all(),
    env.DB.prepare("SELECT id,note,created_at FROM user_notes WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(userId).all(),
    env.DB.prepare("SELECT id,action,actor,details,created_at FROM activity_logs WHERE details LIKE ? OR actor=? ORDER BY id DESC LIMIT 100").bind(`%${String(userId)}%`,String(userId)).all()
  ]);
  return json({events:events.results||[],notes:notes.results||[],activity:activity.results||[]});
}
async function user360(req,env,userId){
  const u=await env.DB.prepare("SELECT id,username,protocol,country,quota_gb,used_gb,device_limit,status,expires_at,created_at,updated_at,client_uuid,subscription_token FROM users WHERE id=?").bind(userId).first();
  if(!u)return json({error:"not found"},404);
  const [nodes,notes,events]=await Promise.all([
    env.DB.prepare("SELECT n.id,n.name,n.country,n.protocol,n.status,n.latency_ms,n.endpoint FROM subscription_nodes sn INNER JOIN nodes n ON n.id=sn.node_id WHERE sn.user_id=? ORDER BY n.name").bind(userId).all(),
    env.DB.prepare("SELECT id,note,created_at,updated_at FROM user_notes WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(userId).all(),
    env.DB.prepare("SELECT id,event_type,details,created_at FROM subscription_events WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(userId).all()
  ]);
  const quota=Number(u.quota_gb||0),used=Number(u.used_gb||0);
  return json({user:u,stats:{usage_pct:quota>0?Math.min(100,used/quota*100):0,remaining_gb:Math.max(0,quota-used),assigned_nodes:(nodes.results||[]).length},nodes:nodes.results||[],notes:notes.results||[],events:events.results||[]});
}

async function usersAdvanced(req,env){
  const u=new URL(req.url);
  const q=(u.searchParams.get("q")||"").trim();
  const status=u.searchParams.get("status")||"";
  const country=u.searchParams.get("country")||"";
  const sort=u.searchParams.get("sort")||"created_at";
  const dir=u.searchParams.get("dir")==="asc"?"ASC":"DESC";
  const page=Math.max(1,Number(u.searchParams.get("page")||1));
  const pageSize=Math.min(100,Math.max(10,Number(u.searchParams.get("pageSize")||50)));
  const offset=(page-1)*pageSize;
  const allowed={created_at:"created_at",username:"username",used_gb:"used_gb",quota_gb:"quota_gb",expires_at:"expires_at",status:"status"};
  const order=allowed[sort]||"created_at";
  const like=`%${q}%`;
  const where=`WHERE (?='' OR username LIKE ? OR country LIKE ? OR protocol LIKE ?) AND (?='' OR status=?) AND (?='' OR country=?)`;
  const [r,total,active,traffic,expiring]=await Promise.all([
    env.DB.prepare(`SELECT id,username,protocol,country,quota_gb,used_gb,device_limit,status,expires_at,created_at,updated_at FROM users ${where} ORDER BY ${order} ${dir} LIMIT ? OFFSET ?`)
      .bind(q,like,like,like,status,status,country,country,pageSize,offset).all(),
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
    },
    pagination:{page,pageSize,total:Number(total?.c||0),pages:Math.max(1,Math.ceil(Number(total?.c||0)/pageSize))}
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

async function alphaBackupTables(env){
  return [
    "users","nodes","subscription_nodes","admin_users","panel_settings","panel_notifications",
    "traffic_snapshots","node_health_history","automation_jobs","automation_job_runs","user_notes","subscription_events"
  ];
}
async function alphaBackupBuild(env){
  const tables=await alphaBackupTables(env), out={format:"ALPHA-BACKUP",version:"6.15",created_at:Date.now(),tables:{}};
  for(const table of tables){
    try{const r=await env.DB.prepare(`SELECT * FROM ${table}`).all();out.tables[table]=r.results||[]}
    catch(_){out.tables[table]=[]}
  }
  const payload=JSON.stringify(out);
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(payload));
  out.checksum="sha256:"+Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
  return out;
}
async function alphaBackupExport(req, env) { return json(await alphaBackupBuild(env)); }
async function alphaBackupManifestList(req, env){
  try{
    const r=await env.DB.prepare("SELECT id,checksum,created_at,table_count,row_count,notes FROM backup_manifests ORDER BY created_at DESC LIMIT 30").all();
    return json({items:r.results||[]});
  }catch(e){return json({items:[],error:"Backup manifest migration is not ready"},503)}
}
async function alphaBackupManifestCreate(req, env){
  const backup=await alphaBackupBuild(env), id=crypto.randomUUID(), tables=Object.keys(backup.tables);
  const rowCount=tables.reduce((n,t)=>n+(Array.isArray(backup.tables[t])?backup.tables[t].length:0),0);
  const notes=String((await req.json().catch(()=>({}))).notes||"").slice(0,500);
  try{
    await env.DB.prepare("INSERT INTO backup_manifests(id,checksum,created_at,table_count,row_count,notes) VALUES(?,?,?,?,?,?)")
      .bind(id,backup.checksum,backup.created_at,tables.length,rowCount,notes).run();
    await log(env,"backup.manifest.create","admin",`${id}:${backup.checksum}`);
    return json({ok:true,id,checksum:backup.checksum,created_at:backup.created_at,table_count:tables.length,row_count:rowCount});
  }catch(e){return json({error:"Could not create backup manifest",details:String(e?.message||e)},503)}
}
async function alphaBackupRestore(req, env){
  const body=await req.json().catch(()=>null);
  if(!body || body.format!=="ALPHA-BACKUP" || !body.tables) return json({error:"Invalid ALPHA backup"},400);
  if(body.confirm!=="ALPHA-RESTORE") return json({error:"confirmation required"},400);
  if(body.checksum){ const copy={...body}; delete copy.checksum; const raw=JSON.stringify(copy); const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw)); const actual="sha256:"+Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join(""); if(actual!==body.checksum) return json({error:"Backup checksum mismatch"},400); }
  const allowed={
    users:["id","username","protocol","country","quota_gb","used_gb","device_limit","status","expires_at","created_at","updated_at","client_uuid","subscription_token"],
    nodes:["id","name","country","endpoint","protocol","status","latency_ms","created_at","updated_at"],
    subscription_nodes:["user_id","node_id","created_at"],
    admin_users:["id","username","role","status","created_at","updated_at"],
    panel_settings:["key","value","updated_at"],
    panel_notifications:["id","title","message","level","is_read","created_at"],
    traffic_snapshots:["id","captured_at","total_users","active_users","total_quota_gb","total_used_gb","total_used_bytes"],
    node_health_history:["id","node_id","status","latency_ms","checked_at"],
    automation_jobs:["id","name","type","enabled","interval_minutes","last_run_at","next_run_at","last_status","last_duration_ms","last_error","run_count","fail_count","created_at","updated_at"],
    automation_job_runs:["id","job_id","started_at","finished_at","status","duration_ms","details","error"]
  };
  const restoreOrder=["users","nodes","subscription_nodes","admin_users","panel_settings","panel_notifications","traffic_snapshots","node_health_history","automation_jobs","automation_job_runs","user_notes","subscription_events"];
  try{
    const stmts=[];
    for(const table of restoreOrder){
      const rows=Array.isArray(body.tables[table])?body.tables[table]:[];
      if(!Object.prototype.hasOwnProperty.call(allowed,table)) continue;
      stmts.push(env.DB.prepare(`DELETE FROM ${table}`));
      const cols=allowed[table];
      for(const row of rows.slice(0,10000)){
        const vals=cols.map(c=>row[c]===undefined?null:row[c]);
        stmts.push(env.DB.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(()=>"?").join(",")})`).bind(...vals));
      }
    }
    for(let i=0;i<stmts.length;i+=50) await env.DB.batch(stmts.slice(i,i+50));
    await log(env,"backup.restore","admin",`restored:${restoreOrder.join(",")}`);
    return json({ok:true,restored_tables:restoreOrder.filter(t=>Array.isArray(body.tables[t])),note:"admin_sessions, activity_logs and auth_rate_limits were intentionally not restored"});
  }catch(e){return json({error:"Restore failed",details:String(e?.message||e)},500)}
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
async function alphaPerformanceOverview(req, env) {
  const started=Date.now();
  const probe=async(name,fn)=>{const t=Date.now();try{return {name,ok:true,ms:Date.now()-t,value:await fn()};}catch(e){return {name,ok:false,ms:Date.now()-t,error:String(e?.message||e)}}};
  const probes=await Promise.all([
    probe("database",async()=>{const r=await env.DB.prepare("SELECT 1 v").first();return r?.v===1?"ok":"unexpected"}),
    probe("users_count",async()=>{const r=await env.DB.prepare("SELECT COUNT(*) c FROM users").first();return Number(r?.c||0)}),
    probe("nodes_count",async()=>{const r=await env.DB.prepare("SELECT COUNT(*) c FROM nodes").first();return Number(r?.c||0)}),
    probe("activity_recent",async()=>{const r=await env.DB.prepare("SELECT COUNT(*) c FROM activity_logs WHERE created_at>=datetime('now','-24 hours')").first();return Number(r?.c||0)})
  ]);
  const cacheable=probes.filter(x=>x.ok).length;
  return json({ok:probes.every(x=>x.ok),generated_at:Date.now(),total_ms:Date.now()-started,probes,cache:{strategy:"short-lived client GET cache",ttl_seconds:5},pagination:{users_max_page_size:100},recommendations:["Use paginated user queries for large datasets","Keep high-cardinality lists filtered before rendering","Prefer snapshots for historical charts"]},200,{"Cache-Control":"private, max-age=5"});
}

async function alphaMonitoringOverview(req, env) {
  const since = "datetime('now','-24 hours')";
  const checks=[];
  const run=async(name,fn)=>{const started=Date.now();try{const value=await fn();checks.push({name,status:"ok",latency_ms:Date.now()-started,value});}catch(e){checks.push({name,status:"error",latency_ms:Date.now()-started,value:String(e?.message||e)});}};
  await run("database",async()=>{const r=await env.DB.prepare("SELECT 1 v").first();if(r?.v!==1)throw Error("Database probe failed");return "reachable"});
  await run("users",async()=>{const r=await env.DB.prepare("SELECT COUNT(*) c FROM users").first();return `${Number(r?.c||0)} users`});
  await run("nodes",async()=>{const r=await env.DB.prepare("SELECT COUNT(*) c FROM nodes").first();return `${Number(r?.c||0)} nodes`});
  await run("automation",async()=>{const r=await env.DB.prepare("SELECT COUNT(*) c FROM automation_jobs WHERE enabled=1").first();return `${Number(r?.c||0)} enabled jobs`});
  await run("integrations",async()=>{const [a,w]=await Promise.all([env.DB.prepare("SELECT COUNT(*) c FROM api_keys WHERE enabled=1").first(),env.DB.prepare("SELECT COUNT(*) c FROM webhooks WHERE enabled=1").first()]);return `${Number(a?.c||0)} API keys · ${Number(w?.c||0)} webhooks`});
  const node=await env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) online,SUM(CASE WHEN status='offline' THEN 1 ELSE 0 END) offline,AVG(CASE WHEN status='online' THEN latency_ms END) latency FROM nodes").first();
  const activity=await env.DB.prepare("SELECT COUNT(*) c FROM activity_logs WHERE created_at>=datetime('now','-24 hours')").first();
  const errors=await env.DB.prepare("SELECT COUNT(*) c FROM activity_logs WHERE created_at>=datetime('now','-24 hours') AND (action LIKE '%failed%' OR action LIKE '%error%' OR action LIKE '%failed')").first();
  const recent=await env.DB.prepare("SELECT action,actor,details,created_at FROM activity_logs WHERE created_at>=datetime('now','-24 hours') AND (action LIKE '%failed%' OR action LIKE '%error%' OR action IN ('sessions.revoked_all','audit.clear')) ORDER BY id DESC LIMIT 25").all();
  let webhooks={enabled:0,failed_deliveries:0,last_delivery:null};
  try { const w=await env.DB.prepare("SELECT COUNT(*) c FROM webhooks WHERE enabled=1").first(); const f=await env.DB.prepare("SELECT COUNT(*) c FROM webhook_deliveries WHERE created_at>=datetime('now','-24 hours') AND status='failed'").first(); const l=await env.DB.prepare("SELECT created_at,status FROM webhook_deliveries ORDER BY id DESC LIMIT 1").first(); webhooks={enabled:Number(w?.c||0),failed_deliveries:Number(f?.c||0),last_delivery:l||null}; } catch(_){ }
  const totalChecks=checks.length, failedChecks=checks.filter(x=>x.status!=="ok").length;
  return json({generated_at:Date.now(),overall:failedChecks?"degraded":"healthy",checks,nodes:{total:Number(node?.total||0),online:Number(node?.online||0),offline:Number(node?.offline||0),avg_latency_ms:Math.round(Number(node?.latency||0))},activity_24h:Number(activity?.c||0),error_events_24h:Number(errors?.c||0),error_rate:Number(activity?.c||0)?Number((Number(errors?.c||0)/Number(activity.c)*100).toFixed(2)):0,webhooks,recent_incidents:recent.results||[],service_count:totalChecks});
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
  return json({ok:errors===0,version:ALPHA_VERSION,checked_at:Date.now(),checks});
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
  return json({version:ALPHA_VERSION,checks,nodeHealth,generated_at:Date.now()});
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
  const allowed=["panel_name","channel","creator","accent","theme","compact_mode","notifications","language","timezone","dashboard_density","dashboard_widgets","saved_filters","shortcut_profile"];
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


async function alphaJobsList(req, env){
  try{
    const jobs=(await env.DB.prepare("SELECT id,name,type,enabled,interval_minutes,last_run_at,next_run_at,last_status,last_duration_ms,last_error,run_count,fail_count,created_at,updated_at FROM automation_jobs ORDER BY id").all()).results||[];
    const runs=(await env.DB.prepare("SELECT id,job_id,started_at,finished_at,status,duration_ms,details,error FROM automation_job_runs ORDER BY started_at DESC LIMIT 40").all()).results||[];
    const byJob={};
    for(const r of runs)(byJob[r.job_id]??=[]).push(r);
    return json({jobs:jobs.map(j=>({...j,enabled:Boolean(j.enabled),runs:byJob[j.id]||[]})),recent_runs:runs});
  }catch(e){return json({error:"Automation tables are not ready. Apply migration 0015_automation_jobs.sql.",details:String(e?.message||e)},503)}
}

async function alphaJobCreate(req,env){
  const b=await req.json().catch(()=>({}));
  const name=String(b.name||"").trim().slice(0,80), type=String(b.type||"").trim();
  const allowed={health_check:"Node Health Check",traffic_snapshot:"Traffic Snapshot",notifications_sync:"Alert Sync",cleanup:"Data Cleanup"};
  if(!allowed[type])return json({error:"Unsupported job type"},400);
  if(!name)return json({error:"Job name is required"},400);
  const interval=Math.max(5,Math.min(10080,Number(b.interval_minutes||60)));
  const id=crypto.randomUUID(),now=Date.now();
  try{await env.DB.prepare("INSERT INTO automation_jobs(id,name,type,enabled,interval_minutes,next_run_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(id,name,type,b.enabled===false?0:1,interval,now,id?now:now,now).run();await log(env,"automation.job.create","admin",`${type}:${interval}m`);return json({ok:true,id},201)}catch(e){return json({error:"Could not create job",details:String(e?.message||e)},409)}
}

async function alphaJobUpdate(req,env,id){
  const b=await req.json().catch(()=>({}));
  const row=await env.DB.prepare("SELECT id FROM automation_jobs WHERE id=?").bind(id).first();
  if(!row)return json({error:"Job not found"},404);
  const enabled=b.enabled==null?null:(b.enabled?1:0);
  const interval=b.interval_minutes==null?null:Math.max(5,Math.min(10080,Number(b.interval_minutes)));
  const name=b.name==null?null:String(b.name).trim().slice(0,80);
  const now=Date.now();
  await env.DB.prepare("UPDATE automation_jobs SET name=COALESCE(?,name),enabled=COALESCE(?,enabled),interval_minutes=COALESCE(?,interval_minutes),next_run_at=CASE WHEN ? IS NOT NULL THEN ? ELSE next_run_at END,updated_at=? WHERE id=?")
    .bind(name,enabled,interval,interval,interval?now:null,now,id).run();
  await log(env,"automation.job.update","admin",id);
  return json({ok:true});
}

async function alphaJobDelete(req,env,id){
  const row=await env.DB.prepare("SELECT id,type FROM automation_jobs WHERE id=?").bind(id).first();
  if(!row)return json({error:"Job not found"},404);
  await env.DB.prepare("DELETE FROM automation_job_runs WHERE job_id=?").bind(id).run();
  await env.DB.prepare("DELETE FROM automation_jobs WHERE id=?").bind(id).run();
  await log(env,"automation.job.delete","admin",`${id}:${row.type}`);
  return json({ok:true});
}

async function alphaExecuteJob(env,job,trigger="scheduled"){
  const started=Date.now(),runId=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO automation_job_runs(id,job_id,started_at,status) VALUES(?,?,?,?)").bind(runId,job.id,started,"running").run();
  let details="";
  try{
    if(job.type==="health_check"){
      const r=await monitorAllNodes(new Request("https://alpha.internal/api/nodes/monitor",{method:"POST"}),env); details=JSON.stringify(await r.json().catch(()=>({ok:true})));
    }else if(job.type==="traffic_snapshot"){
      await takeTrafficSnapshot(env); details="Traffic snapshot captured";
    }else if(job.type==="notifications_sync"){
      const r=await alphaNotificationsSync(new Request("https://alpha.internal/api/notifications/sync",{method:"POST"}),env); details=JSON.stringify(await r.json().catch(()=>({ok:true})));
    }else if(job.type==="cleanup"){
      const now=Date.now();
      const oldRuns=await env.DB.prepare("DELETE FROM automation_job_runs WHERE started_at<?").bind(now-30*86400000).run();
      const oldHealth=await env.DB.prepare("DELETE FROM node_health_history WHERE checked_at<?").bind(now-30*86400000).run();
      const oldTraffic=await env.DB.prepare("DELETE FROM traffic_snapshots WHERE captured_at<?").bind(now-30*86400000).run();
      await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at<=CURRENT_TIMESTAMP").run();
      details=`cleanup runs:${oldRuns.meta?.changes||0} health:${oldHealth.meta?.changes||0} traffic:${oldTraffic.meta?.changes||0}`;
    }else throw new Error("Unsupported job type");
    const finished=Date.now(),duration=finished-started;
    await env.DB.prepare("UPDATE automation_jobs SET last_run_at=?,next_run_at=?,last_status='success',last_duration_ms=?,last_error=NULL,run_count=run_count+1,updated_at=? WHERE id=?")
      .bind(finished,finished+Number(job.interval_minutes)*60000,duration,finished,job.id).run();
    await env.DB.prepare("UPDATE automation_job_runs SET finished_at=?,status='success',duration_ms=?,details=? WHERE id=?").bind(finished,"success",duration,details.slice(0,2000),runId).run();
    await log(env,"automation.job.success","system",`${job.type}:${trigger}:${duration}ms`);
    return {ok:true,status:"success",duration_ms:duration,details};
  }catch(e){
    const finished=Date.now(),duration=finished-started,error=String(e?.message||e).slice(0,1000);
    await env.DB.prepare("UPDATE automation_jobs SET last_run_at=?,next_run_at=?,last_status='failed',last_duration_ms=?,last_error=?,run_count=run_count+1,fail_count=fail_count+1,updated_at=? WHERE id=?")
      .bind(finished,finished+Number(job.interval_minutes)*60000,duration,error,finished,job.id).run();
    await env.DB.prepare("UPDATE automation_job_runs SET finished_at=?,status='failed',duration_ms=?,error=? WHERE id=?").bind(finished,"failed",duration,error,runId).run();
    await log(env,"automation.job.failed","system",`${job.type}:${trigger}:${error}`);
    return {ok:false,status:"failed",duration_ms:duration,error};
  }
}

async function alphaRunJob(req,env,id,trigger="manual"){
  const job=await env.DB.prepare("SELECT * FROM automation_jobs WHERE id=?").bind(id).first();
  if(!job)return json({error:"Job not found"},404);
  const result=await alphaExecuteJob(env,job,trigger);
  return json(result,result.ok?200:500);
}

async function alphaRunDueJobs(env){
  try{
    const now=Date.now();
    const rows=(await env.DB.prepare("SELECT * FROM automation_jobs WHERE enabled=1 AND (next_run_at IS NULL OR next_run_at<=?) ORDER BY next_run_at ASC LIMIT 10").bind(now).all()).results||[];
    for(const job of rows) await alphaExecuteJob(env,job,"scheduled");
    return {ok:true,count:rows.length};
  }catch(e){return {ok:false,error:String(e?.message||e)}}
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
  async scheduled(event,env,ctx){ ctx.waitUntil(alphaRunDueJobs(env)); }
};
