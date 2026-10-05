function officeTimestamp(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  let time;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    time = value < 100000000000 ? value * 1000 : value;
  } else if (typeof value === "string") time = Date.parse(value);
  else return null;
  const date = new Date(time);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeOfficeState(payload) {
  const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const text = value => typeof value === "string" ? value : "";
  const count = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === "object" && !Array.isArray(row)) : [];
  const platforms = value => Array.isArray(value) ? value.filter(name => typeof name === "string") : Object.keys(object(value));
  const gateway = value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return { ...value, running: typeof value.running === "boolean" ? value.running : null, active_agents: count(value.active_agents), active_sessions: count(value.active_sessions), updated_at: officeTimestamp(value.updated_at) };
  };
  const raw = object(payload), source = object(raw.source);
  const agents = rows(raw.agents).map(agent => {
    const id = text(agent.id) || text(agent.profile);
    const ownGateway = gateway(agent.gateway);
    return { ...agent, id, profile: text(agent.profile) || id, label: text(agent.label) || id,
      platforms: platforms(agent.platforms || ownGateway?.platforms || (agent.platform ? [agent.platform] : [])),
      gateway: ownGateway, session_count: count(agent.session_count), updated_at: officeTimestamp(agent.updated_at), last_active: officeTimestamp(agent.last_active) };
  }).filter(agent => agent.id);
  const profileIds = new Map(agents.map(agent => [agent.profile, agent.id]));
  const agentId = row => text(row.agent_id) || profileIds.get(text(row.profile)) || text(row.profile);
  let sourceState = ["connected", "connecting", "needs_login", "stale", "error"].includes(source.state) ? source.state : null;
  const publicStatusConnected = source.mode === "status_only" && source.connected === true;
  if (source.requires_login === true && !publicStatusConnected) sourceState = "needs_login";
  else if (source.stale === true) sourceState = source.syncing === true && source.last_sync == null && source.last_success_at == null && source.connected !== true ? "connecting" : "stale";
  else if (publicStatusConnected) sourceState = "connected";
  else if (!sourceState) sourceState = source.connected === true && source.stale !== true ? "connected" : source.syncing === true ? "connecting" : source.error ? "error" : "connecting";
  const normalizedSource = { ...source, state: sourceState, url: text(source.url), label: text(source.label),
    message: text(source.message) || text(source.error), last_success_at: officeTimestamp(source.last_success_at ?? source.last_sync), checked_at: officeTimestamp(source.checked_at) };
  const sessions = rows(raw.sessions).map(session => ({ ...session, agent_id: agentId(session), id: text(session.id), source: text(session.source),
    title: text(session.title) || text(session.id), last_active: officeTimestamp(session.last_active), message_count: count(session.message_count), tool_call_count: count(session.tool_call_count) }));
  const events = rows(raw.events).map(event => {
    const timestamp = officeTimestamp(event.timestamp ?? event.at), messages = count(event.messages_added), tools = count(event.tools_added);
    const parts = [];
    if (messages !== null) parts.push(`${messages} pesan baru`);
    if (tools !== null) parts.push(`${tools} panggilan tool baru`);
    if (!parts.length) parts.push("Aktivitas Hermes tercatat");
    if (text(event.session_id)) parts.push(`Sesi ${event.session_id}`);
    return { id: text(event.id) || [agentId(event), text(event.session_id), timestamp, messages, tools].join(":"),
      agent_id: agentId(event), label: text(event.label) || (event.type === "activity" ? "Aktivitas sesi" : "Aktivitas Hermes"),
      detail: parts.join(" · "), timestamp, status: text(event.status) };
  });
  return { ...raw, agents, sessions, events, source: normalizedSource, gateway: gateway(raw.gateway), updated_at: officeTimestamp(raw.updated_at) };
}

function sharedOfficeLayout(agents) {
  const positions = [[.322,.45,.54],[.498,.45,.54],[.677,.45,.54],[.395,.78,.875],[.603,.78,.875]];
  return agents.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id),"en")).slice(0,5).map((agent,index)=>({
    id:agent.id, character:index, x:positions[index][0]*1942, y:positions[index][1]*810,
    nameY:positions[index][2]*810, normalizedX:positions[index][0], normalizedY:positions[index][1], normalizedNameY:positions[index][2]
  }));
}

function normalizeAuditPayload(payload) {
  const raw=payload&&typeof payload==="object"?payload:{};
  const text=value=>typeof value==="string"?value:"";
  const count=value=>typeof value==="number"&&Number.isFinite(value)&&value>=0?Math.floor(value):null;
  const rows=value=>Array.isArray(value)?value.filter(row=>row&&typeof row==="object"):[];
  const page=raw.pagination&&typeof raw.pagination==="object"?raw.pagination:{};
  return {
    available:raw.available===true, requires_login:raw.requires_login===true, error:text(raw.error), profile:text(raw.profile),
    requested_session_id:text(raw.requested_session_id),session_id:text(raw.session_id),session:raw.session||null,
    pagination:{limit:count(page.limit)||50,offset:count(page.offset)||0,returned:count(page.returned)||0,total:count(page.total),has_more:page.has_more===true,order:text(page.order)},
    sessions:rows(raw.sessions).filter(row=>text(row.id)).map(row=>({...row,last_active:officeTimestamp(row.last_active),started_at:officeTimestamp(row.started_at),ended_at:officeTimestamp(row.ended_at),message_count:count(row.message_count),tool_call_count:count(row.tool_call_count)})),
    messages:rows(raw.messages).map(row=>({
      id:text(row.id),role:text(row.role)||"unknown",content:text(row.content),timestamp:officeTimestamp(row.timestamp),
      tool_name:text(row.tool_name),tool_call_id:text(row.tool_call_id),truncated:row.truncated===true,attachment_count:count(row.attachment_count)||0,
      tool_calls:rows(row.tool_calls).map(call=>({id:text(call.id),name:text(call.name),arguments:call.arguments}))
    }))
  };
}

function auditChannel(source) {
  const value=typeof source==="string"?source.trim().toLowerCase().replace(/[ -]/g,"_"):"";
  return value==="api"||value==="api_server"?"api":value;
}

function preferredConversation(sessions,channel="all") {
  const matches=sessions.filter(session=>channel==="all"||auditChannel(session.source)===channel);
  return matches.find(session=>["telegram","whatsapp"].includes(auditChannel(session.source)))||matches[0]||null;
}

if (typeof module !== "undefined" && module.exports) module.exports = { normalizeOfficeState, officeTimestamp, sharedOfficeLayout, normalizeAuditPayload, auditChannel, preferredConversation };


(() => {
  "use strict";
  if(typeof document==="undefined")return;
  const $=id=>document.getElementById(id);
  const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const STATUS={idle:"Idle",working:"Bekerja",waiting:"Perlu input",error:"Gagal",offline:"Offline",unknown:"Belum pasti"};
  const SOURCE={connected:"Hermes terhubung",connecting:"Menghubungkan Hermes",needs_login:"Perlu koneksi Hermes",stale:"Data belum diperbarui",error:"Koneksi bermasalah"};
  const ROLE={user:"Pengguna",assistant:"Bot",tool:"Tool",system:"Sistem"};
  let state={agents:[],sessions:[],events:[],source:{state:"connecting"},gateway:null};
  let selected=null,received=false,view=null,polling=false,pollTimer=null,pollController=null;
  const roster=new Map(),desks=new Map(),avatars=new Map(),images=new Map(),characters=new Map();
  let background=null;
  const reducedMotion=matchMedia("(prefers-reduced-motion: reduce)");
  const motion=window.HermesOfficeMotion?.create()||null;
  let motionPaused=false,motionOverride=false,animationFrame=null,lastDrawTime=0;
  const reduceOfficeMotion=()=>reducedMotion.matches&&!motionOverride;
  const motionOptions=()=>({reducedMotion:reduceOfficeMotion(),paused:motionPaused||document.hidden||view!=="overview"});
  const audit={profile:"",channel:"all",sessions:[],sessionId:"",session:null,messages:[],available:null,requiresLogin:false,error:"",loadingSessions:false,loadingMessages:false,sessionQuery:"",messageQuery:"",sessionOffset:0,messageOffset:0,hasMoreSessions:false,hasMoreMessages:false,sessionController:null,messageController:null,epoch:0,messageEpoch:0};
  const text=value=>typeof value==="string"?value:"";
  const time=value=>{const stamp=officeTimestamp(value);return stamp?new Date(stamp).toLocaleString("id-ID",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"";};
  const labelFor=profile=>state.agents.find(agent=>(agent.profile||agent.id)===profile)?.label||profile;
  const initials=label=>String(label||"").trim().slice(0,1).toUpperCase();
  const setLink=(el,value)=>{try{const url=new URL(value);if(!["https:","http:"].includes(url.protocol))throw Error();el.href=url.href;el.hidden=false;}catch{el.hidden=true;el.removeAttribute("href");}};
  const serialize=value=>typeof value==="string"?value:JSON.stringify(value,null,2)||"";
  const imageFor=path=>{if(!images.has(path))images.set(path,new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src="/assets/"+path;}));return images.get(path);};
  const api=async(path,signal)=>{const response=await fetch(path,{cache:"no-store",credentials:"same-origin",signal});let value={};try{value=await response.json();}catch{}if(!response.ok){const error=new Error(response.status===401?"Masuk ke control room untuk membuka data.":text(value.error)||"Data belum dapat dimuat. Coba kembali.");error.status=response.status;throw error;}return value;};

  function drawOffice(){
    const canvas=$("office-scene"),width=background?.naturalWidth||1942,height=background?.naturalHeight||810;
    if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
    const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;
    if(background)ctx.drawImage(background,0,0,width,height);else{ctx.fillStyle="#17263f";ctx.fillRect(0,0,width,height);}
    const entities=motion?.getEntities()||sharedOfficeLayout(state.agents).map(position=>({...position,x:position.x,y:position.y+12,row:0,frame:state.agents.find(agent=>agent.id===position.id)?.status==="working"?3:0,mirror:false,location:"desk",moving:false}));
    entities.slice().sort((a,b)=>a.y-b.y).forEach(entity=>{
      const image=characters.get(entity.character),x=entity.x/1942*width,y=entity.y/810*height;
      if(image){ctx.save();ctx.translate(Math.round(x),Math.round(y));if(entity.mirror)ctx.scale(-1,1);ctx.drawImage(image,entity.frame*16,entity.row*32,16,32,-20,-80,40,80);ctx.restore();}
      const avatar=avatars.get(entity.id),agent=state.agents.find(item=>item.id===entity.id);
      if(avatar&&agent){avatar.style.left=(entity.x/1942*100)+"%";avatar.style.top=(entity.y/810*100)+"%";avatar.dataset.location=entity.location||"desk";avatar.dataset.moving=String(entity.moving===true);avatar.title=agent.label;avatar.setAttribute("aria-label","Buka chat "+agent.label);avatar.setAttribute("aria-pressed",String(selected===agent.id));}
    });
    sharedOfficeLayout(state.agents).forEach(position=>{
      const agent=state.agents.find(item=>item.id===position.id);
      const desk=desks.get(agent.id);if(!desk)return;
      desk.button.style.left=(position.normalizedX*100)+"%";
      desk.button.style.top=((position.normalizedY-.12)*100)+"%";
      desk.button.style.width="14%";desk.button.style.height="23%";
      const labelY=matchMedia("(max-width:800px)").matches?(position.normalizedY>.7?.82:.55):position.normalizedNameY;
      desk.nameplate.style.top=((labelY-(position.normalizedY-.12))/.23*100)+"%";
    });
  }
  function animateOffice(now){
    animationFrame=null;
    if(document.hidden||view!=="overview"||motionPaused||reduceOfficeMotion()||!motion||!state.agents.some(agent=>agent.status==="idle"||agent.status==="working"))return;
    if(now-lastDrawTime>=1000/30){motion.step(now,motionOptions());drawOffice();lastDrawTime=now;}
    animationFrame=requestAnimationFrame(animateOffice);
  }
  function syncMotion(){
    if(animationFrame!==null)cancelAnimationFrame(animationFrame);animationFrame=null;
    motion?.step(performance.now(),motionOptions());
    const enabled=Boolean(motion)&&!motionPaused&&!reduceOfficeMotion();
    $("motion-toggle").textContent=motionPaused||reduceOfficeMotion()?"Aktifkan gerak":"Jeda gerak";
    $("motion-toggle").disabled=!motion;
    $("motion-toggle").setAttribute("aria-pressed",String(enabled));
    $("motion-toggle").title=reduceOfficeMotion()?"Gerak dikurangi sesuai preferensi perangkat. Aktifkan gerak untuk tab ini.":"Gerak bot saat idle hanya visual; status tetap berasal dari Hermes.";
    drawOffice();
    if(enabled&&!document.hidden&&view==="overview"&&state.agents.some(agent=>agent.status==="idle"||agent.status==="working"))animationFrame=requestAnimationFrame(animateOffice);
  }
  function chooseBot(id){selected=id;renderOverview();if(view==="audit")chooseAuditProfile(state.agents.find(agent=>agent.id===id)?.profile||id);}
  function createBot(agent){
    const button=node("button","team-member");button.type="button";
    const monogram=node("span","bot-monogram",initials(agent.label)),info=node("span","team-info"),name=node("span","team-name"),platform=node("span","team-platform"),status=node("span","team-status"),dot=node("i","status-dot"),statusLabel=node("span");
    dot.setAttribute("aria-hidden","true");status.append(dot,statusLabel);info.append(name,platform);button.append(monogram,info,status);button.addEventListener("click",()=>chooseBot(agent.id));roster.set(agent.id,{button,monogram,name,platform,dot,statusLabel});
    const target=node("button","desk-target");target.type="button";const nameplate=node("span","desk-nameplate"),deskName=node("span","desk-name"),deskStatus=node("span","desk-status"),deskDot=node("i","status-dot"),deskStatusText=node("span");deskDot.setAttribute("aria-hidden","true");deskStatus.append(deskDot,deskStatusText);nameplate.append(deskName,deskStatus);target.append(nameplate);target.addEventListener("click",()=>{chooseBot(agent.id);openAudit();});desks.set(agent.id,{button:target,nameplate,name:deskName,dot:deskDot,status:deskStatusText});
    const avatar=node("button","avatar-target");avatar.type="button";avatar.dataset.agentId=agent.id;avatar.addEventListener("click",()=>{chooseBot(agent.id);openAudit();});avatars.set(agent.id,avatar);$("avatar-targets").append(avatar);
  }
  function renderOverview(){
    const ids=new Set(state.agents.map(agent=>agent.id));
    for(const[id,item]of roster)if(!ids.has(id)){item.button.remove();desks.get(id)?.button.remove();avatars.get(id)?.remove();roster.delete(id);desks.delete(id);avatars.delete(id);}
    $("team-list").querySelectorAll(".list-message").forEach(item=>item.remove());
    state.agents.forEach(agent=>{
      if(!roster.has(agent.id))createBot(agent);const item=roster.get(agent.id),desk=desks.get(agent.id);
      item.name.textContent=agent.label;item.platform.textContent=agent.platforms.join(" · ")||"Hermes";item.monogram.textContent=initials(agent.label);item.dot.className="status-dot "+agent.status;item.statusLabel.textContent=STATUS[agent.status];item.button.setAttribute("aria-pressed",String(selected===agent.id));
      desk.name.textContent=agent.label;desk.status.textContent=STATUS[agent.status];desk.dot.className="status-dot "+agent.status;desk.button.setAttribute("aria-pressed",String(selected===agent.id));desk.button.setAttribute("aria-label","Pilih "+agent.label+", "+STATUS[agent.status]);desk.button.title=agent.label+" · "+STATUS[agent.status];
      if(item.button.parentElement!==$("team-list"))$("team-list").append(item.button);if(desk.button.parentElement!==$("desk-targets"))$("desk-targets").append(desk.button);
    });
    if(!state.agents.length)$("team-list").append(node("p","list-message",received?"Belum ada bot tersedia dari Hermes.":"Menyambungkan Hermes…"));
    $("office-occupancy").textContent=received?state.agents.length+" bot":"Memuat bot";
    const agent=state.agents.find(item=>item.id===selected);$("selected-agent").hidden=!agent;$("selected-empty").hidden=Boolean(agent);
    if(agent){$("selected-name").textContent=agent.label;$("selected-platform").textContent=agent.platforms.join(" · ")||"Hermes";$("selected-monogram").textContent=initials(agent.label);$("selected-status").textContent=STATUS[agent.status];$("selected-status").className="status-pill "+agent.status;$("selected-detail").textContent=text(agent.detail)||"Status aktivitas belum tersedia.";$("selected-updated").textContent=agent.updated_at?"Diperbarui "+time(agent.updated_at):"Waktu pembaruan belum tersedia.";}
    $("online-count").textContent=received?state.agents.filter(agent=>agent.gateway?.running===true).length+" / "+state.agents.length:"—";
    $("working-count").textContent=received?state.agents.filter(agent=>agent.status==="working").length:"—";
    drawOffice();
  }
  function renderSource(){
    const source=state.source;$("connection-status").textContent=SOURCE[source.state]||"Status belum tersedia";
    $("connection-signal").className="status-dot "+(source.state==="connected"?"connected":["error","needs_login","stale"].includes(source.state)?"disconnected":"unknown");
    $("source-status").textContent=source.label||SOURCE[source.state]||"Hermes";$("source-detail").textContent=source.message||(source.state==="connected"?"Status bot diperbarui dari Hermes.":"Menunggu data dari Hermes.");
    setLink($("source-link"),source.url);setLink($("audit-source-link"),source.url);
    $("connect-link").hidden=source.state!=="needs_login"&&source.mode!=="status_only";
    const gateway=state.gateway;$("gateway-detail").hidden=!gateway;
    if(gateway){const parts=[gateway.running===true?"Gateway aktif":gateway.running===false?"Gateway tidak aktif":"Gateway belum terverifikasi"];if(Number.isFinite(gateway.active_agents)&&gateway.scope==="all_profiles")parts.push(gateway.active_agents+" pekerjaan aktif");else if(Number.isFinite(gateway.active_agents)&&gateway.scope==="default")parts.push(gateway.active_agents+" pekerjaan gateway utama");$("gateway-detail").textContent=parts.join(" · ");}
    const stamp=source.last_success_at||state.updated_at;$("last-update").textContent=stamp?"Data terakhir "+time(stamp):"Belum menerima data";
    $("office-message").textContent=source.state==="connected"?"Status dari Hermes. Pilih meja atau bot untuk membuka chat.":SOURCE[source.state]||"Menunggu data Hermes.";
    $("office-source-dot").className="status-dot "+(source.state==="connected"?"working":"unknown");
    renderAuditAccess();
  }
  function syncProfiles(){
    const previous=$("audit-profile").value;const signature=JSON.stringify(state.agents.map(agent=>[agent.profile||agent.id,agent.label]));
    if($("audit-profile").dataset.signature!==signature){$("audit-profile").dataset.signature=signature;$("audit-profile").replaceChildren();state.agents.forEach(agent=>{const option=node("option","",agent.label);option.value=agent.profile||agent.id;$("audit-profile").append(option);});if(!state.agents.length){const option=node("option","","Belum ada bot");option.value="";$("audit-profile").append(option);}}
    if(audit.profile&&state.agents.some(agent=>(agent.profile||agent.id)===audit.profile))$("audit-profile").value=audit.profile;
    else if(state.agents.length){const agent=state.agents.find(item=>item.id===selected)||state.agents[0];chooseAuditProfile(agent.profile||agent.id);}
    else $("audit-profile").value=previous||"";
    renderBotSwitcher();renderChannels();
  }
  function renderBotSwitcher(){
    const signature=JSON.stringify(state.agents.map(agent=>[agent.profile||agent.id,agent.label]));
    if($("bot-switcher").dataset.signature!==signature){$("bot-switcher").dataset.signature=signature;$("bot-switcher").replaceChildren();state.agents.forEach(agent=>{const button=node("button","bot-chip",agent.label);button.type="button";button.dataset.profile=agent.profile||agent.id;button.addEventListener("click",()=>{chooseBot(agent.id);chooseAuditProfile(agent.profile||agent.id);});$("bot-switcher").append(button);});}
    $("bot-switcher").querySelectorAll("button").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.profile===audit.profile)));
  }
  function renderChannels(){
    const agent=state.agents.find(item=>(item.profile||item.id)===audit.profile);const channels=Array.from(new Set(audit.sessions.map(session=>auditChannel(session.source)).concat((agent?.platforms||[]).map(auditChannel)))).filter(Boolean);
    const labels={telegram:"Telegram",whatsapp:"WhatsApp",api:"API",cli:"CLI"};const signature=JSON.stringify(channels);
    if($("audit-channel").dataset.signature!==signature){$("audit-channel").dataset.signature=signature;$("audit-channel").replaceChildren();const all=node("option","","Semua kanal");all.value="all";$("audit-channel").append(all);channels.forEach(channel=>{const option=node("option","",labels[channel]||channel);option.value=channel;$("audit-channel").append(option);});}
    if(audit.channel!=="all"&&!channels.includes(audit.channel))audit.channel="all";$("audit-channel").value=audit.channel;$("audit-channel").disabled=!audit.profile;
  }
  function switchView(next,updateHash=true){
    next=next==="audit"?"audit":"overview";view=next;$("overview-view").hidden=next!=="overview";$("audit-view").hidden=next!=="audit";
    document.querySelectorAll("[data-view]").forEach(button=>{if(button.dataset.view===next)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");});
    if(updateHash&&location.hash!=="#"+next)history.replaceState(null,"","#"+next);
    if(next==="audit"){syncProfiles();if(audit.profile&&audit.available===null&&!audit.loadingSessions)loadSessions();}
    syncMotion();
  }
  function showState(target,title,detail,options={}){
    const box=node("div","empty-state"+(options.compact?" compact":""));
    if(options.loading){box.append(node("span","loading-line","Memuat data…"));}
    box.append(node("h3","",title),node("p","",detail));
    if(options.connect){const link=node("a","primary-button","Hubungkan riwayat chat");link.href="/connect.html";box.append(link);}
    if(options.retry){const button=node("button","secondary-button","Coba lagi");button.type="button";button.addEventListener("click",options.retry);box.append(button);}
    target.replaceChildren(box);
  }
  function renderAuditAccess(){
    $("audit-access").hidden=!(audit.available===false&&audit.requiresLogin||(audit.available===null&&state.source.mode==="status_only"));
    $("audit-context").textContent=audit.profile?"Riwayat untuk "+labelFor(audit.profile):"Pilih bot untuk membuka riwayat.";
  }
  function chooseAuditProfile(profile){
    if(profile===audit.profile){$("audit-profile").value=profile;return;}
    audit.epoch++;audit.messageEpoch++;audit.sessionController?.abort();audit.messageController?.abort();
    Object.assign(audit,{profile,channel:"all",sessions:[],sessionId:"",session:null,messages:[],available:null,requiresLogin:false,error:"",loadingSessions:false,loadingMessages:false,sessionQuery:"",messageQuery:"",sessionOffset:0,messageOffset:0,hasMoreSessions:false,hasMoreMessages:false});
    $("audit-profile").value=profile;$("audit-search").value="";$("message-search").value="";renderBotSwitcher();renderChannels();renderAuditAccess();renderSessions();renderThread();
    if(view==="audit"&&profile)loadSessions();
  }
  function renderSessions(){
    $("audit-session-count").textContent=audit.available===true?audit.sessions.length:"—";
    if(audit.loadingSessions&&!audit.sessions.length){showState($("audit-sessions"),"Memuat sesi","Mengambil daftar sesi dari Hermes.",{compact:true,loading:true});return;}
    if(!audit.profile){showState($("audit-sessions"),"Pilih bot","Daftar sesi akan muncul setelah bot tersedia.",{compact:true});return;}
    if(audit.available===false){showState($("audit-sessions"),audit.requiresLogin?"Riwayat perlu dihubungkan":"Riwayat belum tersedia",audit.error||(audit.requiresLogin?"Hubungkan riwayat Hermes untuk membuka percakapan bot.":"Koneksi riwayat belum dapat dibaca."),{compact:true,connect:audit.requiresLogin,retry:audit.requiresLogin?null:()=>loadSessions()});return;}
    if(audit.available===null){showState($("audit-sessions"),"Riwayat belum dimuat","Buka audit untuk mengambil sesi dari Hermes.",{compact:true});return;}
    const query=audit.sessionQuery.toLocaleLowerCase("id-ID");const sessions=audit.sessions.filter(session=>(audit.channel==="all"||auditChannel(session.source)===audit.channel)&&(session.title||session.id||"").toLocaleLowerCase("id-ID").includes(query));
    const moreButton=()=>{const more=node("button","secondary-button load-more",audit.loadingSessions?"Memuat…":"Sesi lainnya");more.type="button";more.disabled=audit.loadingSessions;more.addEventListener("click",()=>loadSessions(true));return more;};
    if(!sessions.length){showState($("audit-sessions"),query||audit.channel!=="all"?"Tidak ada sesi yang cocok":"Belum ada sesi",audit.hasMoreSessions?"Coba sesi lainnya; pencarian dan filter berlaku pada sesi yang sudah dimuat.":query?"Coba kata pencarian lain.":audit.channel!=="all"?"Belum ada sesi yang dimuat dari kanal ini.":"Hermes belum mengembalikan sesi untuk bot ini.",{compact:true});if(audit.hasMoreSessions)$("audit-sessions").prepend(moreButton());return;}
    $("audit-sessions").replaceChildren();sessions.forEach(session=>{const button=node("button","session-button");button.type="button";button.setAttribute("aria-pressed",String(session.id===audit.sessionId));button.append(node("span","session-title",text(session.title)||session.id));const notes=[text(session.source),time(session.last_active)].filter(Boolean);button.append(node("span","session-meta",notes.join(" · ")));const counts=[];if(Number.isFinite(session.message_count))counts.push(session.message_count+" pesan");if(Number.isFinite(session.tool_call_count))counts.push(session.tool_call_count+" tool");if(counts.length)button.append(node("span","session-counts",counts.join(" · ")));button.addEventListener("click",()=>chooseSession(session));$("audit-sessions").append(button);});
    if(audit.hasMoreSessions)$("audit-sessions").append(moreButton());
  }
  async function loadSessions(more=false){
    if(!audit.profile||audit.loadingSessions)return;
    if(!more){audit.epoch++;audit.messageEpoch++;audit.messageController?.abort();audit.sessions=[];audit.sessionId="";audit.messages=[];audit.session=null;audit.sessionOffset=0;}
    const epoch=audit.epoch,profile=audit.profile;const controller=new AbortController();audit.sessionController?.abort();audit.sessionController=controller;audit.loadingSessions=true;renderSessions();if(!more)renderThread();
    try{
      const query=new URLSearchParams({profile,limit:"50",offset:String(more?audit.sessionOffset:0)});
      const response=normalizeAuditPayload(await api("/api/audit/sessions?"+query,controller.signal));
      if(epoch!==audit.epoch||profile!==audit.profile)return;
      audit.available=response.available;audit.requiresLogin=response.requires_login;audit.error=response.error;
      if(response.available){const combined=more?audit.sessions.concat(response.sessions):response.sessions;audit.sessions=Array.from(new Map(combined.map(session=>[session.id,session])).values());audit.sessionOffset=response.pagination.offset+response.pagination.returned;audit.hasMoreSessions=response.pagination.has_more&&response.pagination.returned>0;}
      else{audit.sessions=[];audit.hasMoreSessions=false;}
    }catch(error){if(error.name!=="AbortError"&&epoch===audit.epoch){audit.available=false;audit.requiresLogin=error.status===401;audit.error=error.message;audit.hasMoreSessions=false;}}
    finally{if(epoch===audit.epoch){audit.loadingSessions=false;audit.sessionController=null;renderChannels();renderAuditAccess();renderSessions();if(audit.available===true&&!audit.sessionId){const preferred=preferredConversation(audit.sessions,audit.channel);if(preferred)chooseSession(preferred);else renderThread();}else if(!audit.sessionId)renderThread();}}
  }
  function chooseSession(session){audit.messageEpoch++;audit.messageController?.abort();audit.sessionId=session.id;audit.session=session;audit.messages=[];audit.messageOffset=0;audit.hasMoreMessages=false;audit.loadingMessages=false;audit.messageQuery="";$("message-search").value="";renderSessions();loadMessages();}
  async function loadMessages(older=false){
    if(!audit.profile||!audit.sessionId||audit.loadingMessages)return;
    const epoch=audit.epoch,messageEpoch=audit.messageEpoch,profile=audit.profile,sessionId=audit.sessionId;
    const controller=new AbortController();audit.messageController=controller;audit.loadingMessages=true;renderThread();
    try{
      const query=new URLSearchParams({profile,session_id:sessionId,limit:"50",offset:String(older?audit.messageOffset:0),order:"latest"});
      const response=normalizeAuditPayload(await api("/api/audit/messages?"+query,controller.signal));
      if(epoch!==audit.epoch||messageEpoch!==audit.messageEpoch||profile!==audit.profile||sessionId!==audit.sessionId)return;
      if(!response.available){audit.available=false;audit.requiresLogin=response.requires_login;audit.error=response.error;audit.messages=[];audit.hasMoreMessages=false;}
      else{audit.available=true;audit.requiresLogin=false;audit.error="";const combined=older?response.messages.concat(audit.messages):response.messages;const seen=new Set();audit.messages=combined.filter((message,index)=>{const key=message.id||"source-row-"+index;if(seen.has(key))return false;seen.add(key);return true;});audit.messageOffset=response.pagination.offset+response.pagination.returned;audit.hasMoreMessages=response.pagination.has_more&&response.pagination.returned>0;if(response.session)audit.session=response.session;}
    }catch(error){if(error.name!=="AbortError"&&epoch===audit.epoch&&messageEpoch===audit.messageEpoch){audit.error=error.message;audit.available=false;audit.requiresLogin=error.status===401;}}
    finally{if(epoch===audit.epoch&&messageEpoch===audit.messageEpoch){audit.loadingMessages=false;audit.messageController=null;renderAuditAccess();renderThread();}}
  }
  function toolDisclosure(name,content){const detail=node("details","tool-disclosure");detail.append(node("summary","",name),node("pre","",content));return detail;}
  function renderThread(){
    $("export-session").disabled=audit.available!==true||!audit.sessionId||!audit.messages.length;
    $("message-count").hidden=!audit.messages.length;$("message-count").textContent=audit.messages.length+" pesan dimuat";
    $("thread-heading").textContent=audit.session?text(audit.session.title)||audit.session.id:"Percakapan";
    const resolvedId=audit.session?.id||audit.sessionId;$("thread-subtitle").textContent=audit.session?labelFor(audit.profile)+" · "+(text(audit.session.source)||"Hermes")+" · "+resolvedId.slice(0,12):"Pilih sesi untuk melihat pesan.";$("thread-subtitle").title=audit.session?"Sesi dipilih: "+audit.sessionId+"; sesi sumber: "+resolvedId:"";
    if(audit.loadingMessages&&!audit.messages.length){showState($("audit-thread"),"Memuat percakapan","Mengambil pesan asli dari Hermes.",{loading:true});return;}
    if(audit.available===false){showState($("audit-thread"),audit.requiresLogin?"Hubungkan riwayat chat":"Percakapan belum dapat dimuat",audit.error||(audit.requiresLogin?"Status bot tetap tersedia. Hubungkan riwayat untuk membaca isi chat.":"Coba memuat ulang riwayat Hermes."),{connect:audit.requiresLogin,retry:audit.requiresLogin?null:()=>audit.sessionId?loadMessages():loadSessions()});return;}
    if(!audit.sessionId){showState($("audit-thread"),"Pilih sesi percakapan","Pesan asli beserta peran, waktu, dan aktivitas tool akan ditampilkan di sini.");return;}
    const query=audit.messageQuery.toLocaleLowerCase("id-ID");const messages=audit.messages.filter(message=>[message.content,message.tool_name,serialize(message.tool_calls)].join(" ").toLocaleLowerCase("id-ID").includes(query));
    const olderButton=()=>{const more=node("button","secondary-button older-messages",audit.loadingMessages?"Memuat pesan…":"Pesan lebih lama");more.type="button";more.disabled=audit.loadingMessages;more.addEventListener("click",()=>loadMessages(true));return more;};
    if(!messages.length){showState($("audit-thread"),query?"Tidak ada pesan yang cocok":audit.hasMoreMessages?"Belum ada pesan di halaman ini":"Belum ada pesan",query?"Pencarian berlaku pada pesan yang sudah dimuat.":audit.hasMoreMessages?"Muat pesan lebih lama untuk melanjutkan penelusuran.":"Tidak ada pesan yang tersedia untuk sesi ini.");if(audit.hasMoreMessages)$("audit-thread").prepend(olderButton());return;}
    const scroll=$("audit-thread").scrollTop;$("audit-thread").replaceChildren();
    if(audit.hasMoreMessages)$("audit-thread").append(olderButton());
    messages.forEach(message=>{
      const article=node("article","message "+(message.role==="user"?"user":"")),header=node("div","message-header"),role=node("span","message-role",ROLE[message.role]||"Pesan"),stamp=node("time","message-time",time(message.timestamp)||"Waktu tidak tersedia");if(message.timestamp)stamp.dateTime=message.timestamp;header.append(role,stamp);article.append(header);
      if(message.role==="tool"){article.append(toolDisclosure("Hasil tool"+(message.tool_name?": "+message.tool_name:""),message.content));}
      else if(message.content)article.append(node("div","message-content",message.content));
      message.tool_calls.forEach(call=>article.append(toolDisclosure("Tool: "+(call.name||"Tanpa nama"),serialize(call.arguments))));
      if(message.attachment_count)article.append(node("p","message-note",message.attachment_count+" lampiran tercatat. Buka Hermes untuk melihat lampiran."));
      if(message.truncated)article.append(node("p","message-note","Isi pesan dipotong. Buka Hermes untuk versi lengkap."));
      $("audit-thread").append(article);
    });
    $("audit-thread").scrollTop=scroll;
  }
  function schedulePoll(){clearTimeout(pollTimer);if(!document.hidden)pollTimer=setTimeout(poll,5000);}
  async function poll(){
    if(polling||document.hidden)return;clearTimeout(pollTimer);polling=true;const controller=new AbortController();pollController=controller;const timer=setTimeout(()=>controller.abort(),15000);
    try{const next=normalizeOfficeState(await api("/api/state",controller.signal));state=next;state.agents=state.agents.map(agent=>({...agent,status:STATUS[agent.status]?agent.status:"unknown"}));received=true;if(!state.agents.some(agent=>agent.id===selected))selected=state.agents[0]?.id||null;motion?.update(state.agents,performance.now(),motionOptions());renderOverview();renderSource();syncProfiles();syncMotion();}
    catch(error){if(!(error.name==="AbortError"&&document.hidden)){$("connection-status").textContent=error.status===401?"Masuk diperlukan":"Koneksi terputus";$("connection-signal").className="status-dot disconnected";$("office-source-dot").className="status-dot unknown";$("office-message").textContent=received?"Koneksi terputus. Status terakhir tetap ditampilkan.":"Menunggu koneksi. Kantor siap menampilkan bot.";$("source-detail").textContent=error.message;}}
    finally{clearTimeout(timer);polling=false;pollController=null;schedulePoll();}
  }
  function openAudit(){const agent=state.agents.find(item=>item.id===selected);if(agent)chooseAuditProfile(agent.profile||agent.id);switchView("audit");}
  document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>switchView(button.dataset.view)));
  document.querySelectorAll("[data-open-audit]").forEach(button=>button.addEventListener("click",openAudit));
  $("selected-audit").addEventListener("click",openAudit);
  $("audit-profile").addEventListener("change",event=>chooseAuditProfile(event.target.value));
  $("audit-channel").addEventListener("change",event=>{audit.channel=event.target.value;const current=audit.sessions.find(session=>session.id===audit.sessionId);renderSessions();if(!current||audit.channel!=="all"&&auditChannel(current.source)!==audit.channel){const preferred=preferredConversation(audit.sessions,audit.channel);if(preferred)chooseSession(preferred);else{audit.messageEpoch++;audit.messageController?.abort();audit.sessionId="";audit.session=null;audit.messages=[];audit.loadingMessages=false;renderThread();}}});
  $("audit-search").addEventListener("input",event=>{audit.sessionQuery=event.target.value.trim();renderSessions();});
  $("message-search").addEventListener("input",event=>{audit.messageQuery=event.target.value.trim();renderThread();});
  $("refresh-audit").addEventListener("click",()=>{if(!audit.loadingSessions&&!audit.loadingMessages)loadSessions();});
  $("export-session").addEventListener("click",()=>{if(audit.available!==true||!audit.sessionId||!audit.messages.length)return;const blob=new Blob([JSON.stringify({scope:"loaded_messages",loaded_count:audit.messages.length,source_rows_scanned:audit.messageOffset,has_more:audit.hasMoreMessages,profile:audit.profile,requested_session_id:audit.sessionId,session_id:audit.session?.id||audit.sessionId,session:audit.session,messages:audit.messages},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=("hermes-loaded-"+audit.profile+"-"+audit.sessionId).replace(/[^a-zA-Z0-9_.-]/g,"-").slice(0,160)+".json";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  addEventListener("hashchange",()=>switchView(location.hash==="#audit"?"audit":"overview",false));
  addEventListener("resize",drawOffice);
  $("motion-toggle").addEventListener("click",()=>{if(motionPaused||reduceOfficeMotion()){motionOverride=true;motionPaused=false;}else motionPaused=true;syncMotion();});
  reducedMotion.addEventListener("change",syncMotion);
  document.addEventListener("visibilitychange",()=>{clearTimeout(pollTimer);syncMotion();if(document.hidden)pollController?.abort();else if(!polling)poll();});
  const tick=()=>{const now=new Date();$("clock").textContent=now.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false});$("clock").dateTime=now.toISOString();};tick();setInterval(tick,1000);
  switchView(location.hash==="#audit"?"audit":"overview",false);drawOffice();renderOverview();
  Promise.allSettled([imageFor("hermes-hq-office.png").then(image=>{background=image;}),...[0,1,2,3,4].map(async character=>{characters.set(character,await imageFor("char_"+character+".png"));})]
  ).then(results=>{drawOffice();if(results.some(result=>result.status==="rejected"))$("office-message").textContent="Sebagian gambar belum terbaca. Muat ulang halaman.";});
  poll();
})();
