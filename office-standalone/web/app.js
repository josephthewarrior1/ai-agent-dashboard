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
  const sorted = agents.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), "en"));
  const positions = [[174, 128], [322, 128], [470, 128], [245, 275], [407, 275]];
  return sorted.map((agent, index) => {
    const [x, y] = positions[index] || [174 + ((index - 5) % 3) * 148, 422 + Math.floor((index - 5) / 3) * 147];
    return { id: agent.id, character: index % 5, x, y };
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { normalizeOfficeState, officeTimestamp, sharedOfficeLayout };

(() => {
  "use strict";
  if (typeof document === "undefined") return;
  const $ = id => document.getElementById(id);
  const create = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; };
  const STATUSES = { idle: "Idle", working: "Bekerja", waiting: "Perlu input", error: "Gagal", offline: "Offline", unknown: "Belum pasti" };
  const SOURCE_LABELS = { connected: "Hermes terhubung", connecting: "Menyambungkan Hermes…", needs_login: "Hermes perlu dihubungkan", stale: "Data Hermes belum diperbarui", error: "Koneksi Hermes bermasalah" };
  let state = { agents: [], sessions: [], events: [], source: { state: "connecting" }, gateway: null };
  let received = false;
  let selected = null;
  let filter = "all";
  let query = "";
  let polling = false;
  let pollTimer = null;
  let pollController = null;
  let lastInspectorSignature = "";
  const teamNodes = new Map();
  const deskNodes = new Map();
  const images = new Map();
  const sprites = new Map();
  const safeString = value => value == null ? "" : String(value);
  const displayTime = value => { const timestamp = officeTimestamp(value); if (!timestamp) return ""; return new Date(timestamp).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };
  const safeLink = (node, value) => {
    try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); node.href = url.href; node.hidden = false; }
    catch { node.hidden = true; node.removeAttribute("href"); }
  };
  const characterFor = id => sharedOfficeLayout(state.agents).find(agent => agent.id === id)?.character || 0;
  const normalizeAgent = agent => ({ ...agent, id: safeString(agent.id), label: safeString(agent.label || agent.id), status: STATUSES[agent.status] ? agent.status : "unknown", platforms: Array.isArray(agent.platforms) ? agent.platforms.map(safeString) : agent.platform ? [safeString(agent.platform)] : [], character: characterFor(agent.id) });
  const visibleAgents = () => state.agents.filter(agent => (filter === "all" || agent.status === filter) && `${agent.label} ${agent.id} ${agent.platforms.join(" ")} ${agent.detail || ""} ${STATUSES[agent.status]}`.toLocaleLowerCase("id-ID").includes(query));
  const loadImage = path => {
    if (!images.has(path)) images.set(path, new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = `/assets/${path}`; }));
    return images.get(path);
  };
  const ASSETS = [
    ["sofa", "studio-atlas.png", [62,157,536,360], [40,28]], ["server", "studio-atlas.png", [792,81,299,468], [20,32]],
    ["shelf", "studio-atlas.png", [79,699,494,453], [34,28]], ["plant", "studio-atlas.png", [680,656,501,512], [26,32]],
    ["coffee", "utilities-atlas.png", [184,85,374,517], [20,26]], ["cooler", "utilities-atlas.png", [863,98,155,504], [12,26]],
    ["lamp", "utilities-atlas.png", [279,680,179,491], [12,30]], ["clock", "utilities-atlas.png", [829,868,221,227], [10,10]],
    ["succulent", "decor-atlas.png", [188,766,267,360], [12,16]], ["planter", "decor-atlas.png", [658,800,550,313], [32,18]],
    ["conference", "meeting-atlas.png", [44,216,560,304], [80,44]], ["board", "meeting-atlas.png", [686,195,510,290], [48,28]],
    ["chair", "meeting-atlas.png", [185,712,278,407], [15,22]], ["easel", "specialty-atlas.png", [181,72,264,506], [26,42]],
    ["globe", "specialty-atlas.png", [158,692,303,469], [22,30]]
  ];
  const rect = (ctx,x,y,w,h,color) => { ctx.fillStyle = color; ctx.fillRect(x,y,w,h); };
  const prop = (ctx,id,x,y,scale=1) => { const sprite = sprites.get(id); if (sprite) ctx.drawImage(sprite,x,y,Math.round(sprite.width*scale),Math.round(sprite.height*scale)); };
  const avatar = (canvas,character) => { const ctx=canvas.getContext("2d"); ctx.clearRect(0,0,16,32); ctx.imageSmoothingEnabled=false; prop(ctx,`char-${character}-idle`,0,0); };
  const officeText = (ctx,label,x,y,color="#8fa4b8") => {ctx.font="7px monospace";ctx.textAlign="left";ctx.fillStyle=color;ctx.fillText(label,x,y);};
  const drawWorkstation = (ctx,agent,position) => {
    const {x,y}=position; const accent=["#83b7cd","#c5ac82","#ae9dcc","#9fba9c","#b3c0c5"][position.character];
    rect(ctx,x-48,y+18,98,9,"#19283d");rect(ctx,x-43,y+17,5,30,"#142137");rect(ctx,x+37,y+17,5,30,"#142137");
    rect(ctx,x-48,y-5,96,26,"#5e5148");rect(ctx,x-48,y-8,96,25,"#92785f");rect(ctx,x-47,y-7,94,3,"#b09b7d");rect(ctx,x-47,y+14,94,4,"#6f5949");
    rect(ctx,x-19,y-39,38,29,"#142034");rect(ctx,x-16,y-36,32,21,agent?.status==="working"?"#608181":"#3d5774");rect(ctx,x-15,y-35,30,2,accent);rect(ctx,x-13,y-28,20,2,"#7b95a7");rect(ctx,x-13,y-22,12,2,"#637f98");rect(ctx,x-2,y-10,4,5,"#15243a");rect(ctx,x-9,y-6,18,2,"#26364a");
    rect(ctx,x-17,y+3,29,7,"#36475a");rect(ctx,x-15,y+4,25,2,"#8c9baa");rect(ctx,x+19,y+2,8,8,"#b9c4c4");rect(ctx,x+26,y+4,3,4,"#70849a");
    prop(ctx,"succulent",x-42,y-19,1.1);
    rect(ctx,x-13,y+50,26,7,"#15253b");rect(ctx,x-15,y+39,30,17,"#23374b");rect(ctx,x-13,y+40,26,12,accent);rect(ctx,x-11,y+43,22,8,"#3c5368");
    if(agent)prop(ctx,`char-${position.character}-${agent.status==="working"?"work":"idle"}`,x-16,y+7,2);
    if(agent?.id===selected){const left=x-54,top=y-44;for(const [cx,cy,sx,sy]of [[left,top,1,1],[left+105,top,-1,1],[left,top+113,1,-1],[left+105,top+113,-1,-1]]){rect(ctx,cx,cy,8*sx,2*sy,"#a9cdb9");rect(ctx,cx,cy,2*sx,8*sy,"#a9cdb9");}}
  };
  const drawOffice = () => {
    const canvas=$("office-scene"),layout=sharedOfficeLayout(state.agents),height=Math.max(410,...layout.map(position=>position.y+117));if(canvas.height!==height)canvas.height=height;const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;
    rect(ctx,0,0,640,height,"#111e33");rect(ctx,5,5,630,height-10,"#293d53");
    for(let y=68;y<height-7;y+=15){rect(ctx,8,y,624,14,y%2?"#293d53":"#273a50");for(let x=(Math.round(y/15)%2)*34+12;x<631;x+=68)rect(ctx,x,y,1,14,"#30445b");}
    rect(ctx,6,6,628,58,"#34475d");rect(ctx,6,62,628,5,"#182a40");rect(ctx,7,height-8,626,2,"#587086");
    for(const x of[37,265,468]){rect(ctx,x,16,78,35,"#162a41");rect(ctx,x+3,19,72,28,"#526d83");rect(ctx,x+4,20,70,12,"#879fb1");rect(ctx,x+37,19,3,28,"#2d475e");rect(ctx,x+3,33,72,3,"#2d475e");rect(ctx,x-3,49,84,5,"#8c9ba5");}
    rect(ctx,156,17,78,28,"#12233a");rect(ctx,157,18,76,26,"#415670");officeText(ctx,"HERMES HQ",167,30,"#e2d4b4");officeText(ctx,"CONTROL ROOM",162,39,"#a2b5c7");prop(ctx,"clock",596,21,1.8);
    rect(ctx,19,100,91,70,"#21344a");rect(ctx,20,101,89,68,"#314b58");prop(ctx,"sofa",25,103,1.8);prop(ctx,"shelf",26,69,1.5);prop(ctx,"plant",87,123,1.4);officeText(ctx,"LOUNGE",28,186);
    prop(ctx,"server",567,78,1.7);prop(ctx,"server",605,78,1.25);prop(ctx,"cooler",608,152,1.6);officeText(ctx,"SERVER",570,145);
    prop(ctx,"board",29,221,1.7);prop(ctx,"chair",15,298,1.3);prop(ctx,"chair",143,298,1.3);prop(ctx,"chair",54,329,1.3);prop(ctx,"chair",101,329,1.3);prop(ctx,"conference",35,280,1.35);officeText(ctx,"MEETING",64,371);
    prop(ctx,"coffee",565,267,1.8);prop(ctx,"plant",588,310,1.5);prop(ctx,"planter",499,height-35,1.5);prop(ctx,"lamp",116,218,1.7);
    const positions=layout.length?layout:sharedOfficeLayout([0,1,2,3,4].map(index=>({id:String(index)})));positions.forEach(position=>drawWorkstation(ctx,state.agents.find(agent=>agent.id===position.id),position));
    layout.forEach(position=>{const desk=deskNodes.get(position.id);if(!desk)return;desk.button.style.left=`${position.x/640*100}%`;desk.button.style.top=`${(position.y-44)/height*100}%`;desk.button.style.width=`${110/640*100}%`;desk.button.style.height=`${120/height*100}%`;});
  };
  const choose = id => { selected=id; renderRoster(); renderInspector(); };
  const newBotNodes = agent => {
    const button=create("button","team-member");button.type="button";
    const image=create("canvas","team-avatar");image.width=16;image.height=32;image.setAttribute("aria-hidden","true");
    const info=create("span","team-info"),name=create("span","team-name"),platform=create("span","team-platform"),status=create("span","team-status"),dot=create("i","status-dot"),statusLabel=create("span");dot.setAttribute("aria-hidden","true");status.append(dot,statusLabel);info.append(name,platform,status);button.append(image,info);button.addEventListener("click",()=>choose(agent.id));teamNodes.set(agent.id,{button,image,name,platform,dot,statusLabel});
    const deskButton=create("button","desk-target");deskButton.type="button";const nameplate=create("span","desk-nameplate"),deskName=create("span","desk-name"),deskStatus=create("span","desk-status"),deskDot=create("i","status-dot");deskDot.setAttribute("aria-hidden","true");const deskStatusText=create("span");deskStatus.append(deskDot,deskStatusText);nameplate.append(deskName,deskStatus);deskButton.append(nameplate);deskButton.addEventListener("click",()=>choose(agent.id));deskNodes.set(agent.id,{button:deskButton,name:deskName,status:deskStatusText,dot:deskDot});
  };
  const renderRoster = () => {
    const list=visibleAgents();const ids=new Set(state.agents.map(agent=>agent.id));
    for(const [id,nodes] of teamNodes) if(!ids.has(id)){nodes.button.remove();deskNodes.get(id)?.button.remove();teamNodes.delete(id);deskNodes.delete(id);}
    $("team-list").querySelectorAll(".list-message").forEach(node=>node.remove());
    state.agents.forEach(agent=>{
      if(!teamNodes.has(agent.id))newBotNodes(agent);const team=teamNodes.get(agent.id),desk=deskNodes.get(agent.id),show=list.some(item=>item.id===agent.id);team.button.hidden=!show;desk.button.classList.toggle("is-muted",!show);
      team.name.textContent=agent.label;team.platform.textContent=agent.platforms.join(" · ")||"Hermes";team.dot.className=`status-dot ${agent.status}`;team.statusLabel.textContent=STATUSES[agent.status];team.button.setAttribute("aria-pressed",String(selected===agent.id));team.button.title=safeString(agent.detail||agent.label);avatar(team.image,agent.character);
      desk.name.textContent=agent.label;desk.status.textContent=STATUSES[agent.status];desk.dot.className=`status-dot ${agent.status}`;desk.button.setAttribute("aria-pressed",String(selected===agent.id));desk.button.setAttribute("aria-label",`Pilih meja ${agent.label}, ${STATUSES[agent.status]}`);desk.button.title=`${agent.label} · ${STATUSES[agent.status]}`;
      if(team.button.parentElement!==$("team-list"))$("team-list").append(team.button);if(desk.button.parentElement!==$("desk-targets"))$("desk-targets").append(desk.button);
    });
    $("session-count").textContent=received?`${state.agents.length} BOT`:"—";
    for(const status of ["all","working","idle","unknown","offline"]){$("count-"+status).textContent=received?state.agents.filter(agent=>status==="all"||agent.status===status).length:"—";}
    if(!list.length){
      let title="Menyambungkan Hermes…";
      if(received&&state.agents.length)title="Tidak ada bot yang cocok. Coba filter Semua.";
      else if(received&&state.source.state==="needs_login")title="Hubungkan Hermes untuk melihat bot.";
      else if(received&&state.source.state==="connected")title="Belum ada bot terdeteksi.";
      else if(received&&["stale","error"].includes(state.source.state))title="Menunggu data bot dari Hermes.";
      $("team-list").append(create("p","list-message",title));
    }
    document.querySelectorAll("[data-filter]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.filter===filter)));
    $("office-occupancy").textContent=received?`${state.agents.length} BOT · KANTOR BERSAMA`:"MENUNGGU BOT";drawOffice();
  };
  const emptyLog = (target,title,detail) => {const box=create("div","empty-log"),symbol=create("span","","▤");symbol.setAttribute("aria-hidden","true");box.append(symbol,create("p","",title),create("small","",detail));target.replaceChildren(box);};
  const renderInspector = () => {
    const agent=state.agents.find(item=>item.id===selected);$("selected-agent").hidden=!agent;$("session-details").hidden=!agent;
    const sessions=agent?state.sessions.filter(session=>safeString(session.agent_id)===agent.id).sort((a,b)=>(Date.parse(b.last_active)||0)-(Date.parse(a.last_active)||0)):[];
    const events=agent?state.events.filter(event=>safeString(event.agent_id)===agent.id).sort((a,b)=>(Date.parse(b.timestamp)||0)-(Date.parse(a.timestamp)||0)):[];
    const detailElsewhere=state.source.sessions_available===false||state.source.mode==="status_only"||agent?.private_detail_requires_login===true;
    const signature=JSON.stringify([agent,sessions,events,detailElsewhere,state.source.url]);if(signature===lastInspectorSignature)return;lastInspectorSignature=signature;
    $("sessions-log").replaceChildren();$("selected-session-count").textContent=agent?(detailElsewhere?"DI HERMES":`${sessions.length} SESI`):"—";$("event-count").textContent=agent?(detailElsewhere&&!events.length?"DI HERMES":`${events.length} CATATAN`):"—";
    if(!agent){emptyLog($("activity-log"),"Pilih bot untuk melihat aktivitas.","Aktivitas muncul dari Hermes yang terhubung.");return;}
    $("selected-name").textContent=agent.label;$("selected-platform").textContent=agent.platforms.join(" · ")||"Hermes";$("selected-status").textContent=STATUSES[agent.status];avatar($("selected-avatar"),agent.character);
    $("selected-detail").textContent=safeString(agent.detail||"Belum ada detail aktivitas untuk bot ini.");$("selected-updated").textContent=agent.updated_at?`Diperbarui ${displayTime(agent.updated_at)}`:"";$("session-link").textContent=detailElsewhere?"Buka Hermes ↗":"Buka sesi asli ↗";safeLink($("session-link"),agent.url||agent.session_url||agent.chat_url||(detailElsewhere?state.source.url:null));
    if(!sessions.length)$("sessions-log").append(create("p","sessions-empty",detailElsewhere?"Detail sesi ada di dashboard Hermes.":"Belum ada sesi tercatat untuk bot ini."));
    sessions.slice(0,12).forEach(session=>{const item=create("div","session-record");item.append(create("p","",safeString(session.title||session.id)));const notes=[safeString(session.source),displayTime(session.last_active)];if(Number.isFinite(session.message_count))notes.push(`${session.message_count} pesan`);if(Number.isFinite(session.tool_call_count))notes.push(`${session.tool_call_count} panggilan tool`);item.append(create("small","",notes.filter(Boolean).join(" · ")));$("sessions-log").append(item);});
    const expanded=new Set(Array.from($("activity-log").querySelectorAll("details[open]")).map(node=>node.dataset.eventId));$("activity-log").replaceChildren();
    if(!events.length){emptyLog($("activity-log"),detailElsewhere?"Detail aktivitas ada di Hermes.":"Belum ada aktivitas tercatat.",detailElsewhere?"Status bot tetap dipantau di kantor ini. Buka Hermes untuk melihat detail sesi.":"Catatan akan muncul saat tersedia dari Hermes.");return;}
    events.slice(0,40).forEach((event,index)=>{const record=create("details","event-record");record.dataset.eventId=safeString(event.id);record.open=expanded.has(safeString(event.id))||(expanded.size===0&&index===0);const summary=create("summary"),meta=create("span","event-meta");meta.append(create("span","event-kind",safeString(event.label||event.status||"Aktivitas")),create("time","",displayTime(event.timestamp)));summary.append(meta,create("p","event-detail",safeString(event.detail||"")));record.append(summary);$("activity-log").append(record);});
  };
  const renderSource = () => {
    const source=state.source||{state:"connecting"};$("connection-status").textContent=SOURCE_LABELS[source.state]||"Status sumber belum tersedia";$("connection-signal").className=`signal ${source.state==="connected"?"connected":["needs_login","stale","error"].includes(source.state)?"disconnected":""}`;
    $("source-status").textContent=source.label||SOURCE_LABELS[source.state]||"Sumber Hermes";$("source-detail").textContent=source.message||(source.state==="connected"?"Bot dan aktivitas berasal dari Hermes yang terhubung.":"Menunggu data dari sumber Hermes.");safeLink($("source-link"),source.url);$("connect-link").textContent=source.mode==="status_only"?"Hubungkan detail sesi ↗":"Hubungkan Hermes ↗";$("connect-link").hidden=source.state!=="needs_login"&&source.mode!=="status_only";
    $("gateway-detail").hidden=!state.gateway;if(state.gateway){const gateway=state.gateway;const parts=[gateway.running===true?"Gateway aktif":gateway.running===false?"Gateway tidak aktif":"Gateway belum terverifikasi"];if(Number.isFinite(gateway.active_agents)&&gateway.scope==="all_profiles")parts.push(`${gateway.active_agents} pekerjaan aktif`);else if(Number.isFinite(gateway.active_agents)&&gateway.scope==="default")parts.push(`${gateway.active_agents} pekerjaan gateway utama`);if(Number.isFinite(gateway.active_sessions)&&gateway.scope==="all_profiles")parts.push(`${gateway.active_sessions} sesi aktif`);else if(Number.isFinite(gateway.active_sessions)&&gateway.scope==="default")parts.push(`${gateway.active_sessions} sesi gateway utama`);$("gateway-detail").textContent=parts.join(" · ");}
    const stamp=source.last_success_at||state.updated_at;$("last-update").textContent=stamp?`Data Hermes ${displayTime(stamp)}`:"Belum menerima data Hermes";$("office-message").textContent=source.state==="connected"?"Status bot mengikuti Hermes. Pilih meja untuk melihat detail.":SOURCE_LABELS[source.state]||"Menunggu data Hermes.";$("office-source-dot").className=`status-dot ${source.state==="connected"?"working":source.state==="needs_login"?"waiting":"unknown"}`;
  };
  const schedulePoll = () => {clearTimeout(pollTimer);if(!document.hidden)pollTimer=setTimeout(poll,5000);};
  const poll = async () => {
    if(polling||document.hidden)return;clearTimeout(pollTimer);polling=true;const controller=new AbortController();pollController=controller;const requestTimer=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch("/api/state",{cache:"no-store",credentials:"same-origin",signal:controller.signal});if(!response.ok){const error=new Error(`HTTP ${response.status}`);error.status=response.status;throw error;}const next=await response.json();
      state=normalizeOfficeState(next);state.agents=state.agents.map(normalizeAgent);received=true;
      if(!state.agents.some(agent=>agent.id===selected))selected=state.agents[0]?.id||null;renderSource();renderRoster();renderInspector();
    } catch(error){
      if(!(error.name==="AbortError"&&document.hidden)){$("connection-signal").className="signal disconnected";$("connection-status").textContent=error.status===401?"Login control room dibutuhkan":"Koneksi control room terputus";$("source-detail").textContent=error.status===401?"Buka ulang halaman lalu masuk ke control room.":"Koneksi ke control room terputus. Mencoba lagi dalam beberapa detik.";$("office-message").textContent=received?"Koneksi terputus. Status terakhir tetap ditampilkan.":"Menunggu koneksi server. Kantor siap menampilkan bot.";$("office-source-dot").className="status-dot unknown";}
    } finally{clearTimeout(requestTimer);polling=false;pollController=null;schedulePoll();}
  };
  document.addEventListener("visibilitychange",()=>{clearTimeout(pollTimer);if(document.hidden)pollController?.abort();else if(!polling)poll();});
  $("session-search").addEventListener("input",event=>{query=event.target.value.trim().toLocaleLowerCase("id-ID");renderRoster();});
  document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{filter=button.dataset.filter;renderRoster();}));
  const tick=()=>{const now=new Date();$("clock").textContent=now.toLocaleTimeString("id-ID",{hour12:false});$("clock").dateTime=now.toISOString();};tick();setInterval(tick,1000);
  drawOffice();
  Promise.allSettled([
    ...ASSETS.map(async([id,path,bounds,size])=>{const img=await loadImage(path),canvas=document.createElement("canvas");canvas.width=size[0];canvas.height=size[1];const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;ctx.drawImage(img,...bounds,0,0,...size);sprites.set(id,canvas);}),
    ...[0,1,2,3,4].flatMap(character=>["idle","work"].map(async(mode)=>{const img=await loadImage(`char_${character}.png`),canvas=document.createElement("canvas");canvas.width=16;canvas.height=32;const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;ctx.drawImage(img,mode==="work"?48:0,0,16,32,0,0,16,32);sprites.set(`char-${character}-${mode}`,canvas);}))
  ]).then(results=>{renderRoster();if(selected){avatar($("selected-avatar"),characterFor(selected));}drawOffice();if(results.some(result=>result.status==="rejected"))$("last-update").textContent="Sebagian gambar belum terbaca. Muat ulang halaman.";});
  poll();
})();
