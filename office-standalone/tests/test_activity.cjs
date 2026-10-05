"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const Activity=require("../web/office-activity.js");
const WALL=1_800_000_000_000;
const row=(id,role="user",content="Hello",timestamp=WALL/1000)=>({id:String(id),role,content,timestamp});
const page=(messages,profile="alpha",session="session-1",extra={})=>({available:true,stale:false,profile,session_id:session,requested_session_id:session,messages,pagination:{offset:0,order:"latest"},...extra});

test("the first page is a silent baseline and unchanged polls never prolong a bubble",()=>{
  const activity=Activity.create();
  assert.deepEqual(activity.observe("alpha",page([row(1)]),0,{wallTimeMs:WALL}),[]);
  assert.equal(activity.getBubble("alpha",0),null);
  const events=activity.observe("alpha",page([row(1),row(2)]),1000,{wallTimeMs:WALL});
  assert.equal(events.length,1);assert.equal(events[0].label,"Pesan masuk");
  assert.deepEqual(activity.observe("alpha",page([row(1),row(2)]),14000),[]);
  assert.equal(activity.getBubble("alpha",15999).expires_at,16000);
  assert.equal(activity.getBubble("alpha",16000),null);
});

test("new user, assistant and tool evidence creates real labels and safe bounded plain text",()=>{
  const activity=Activity.create();activity.observe("alpha",page([]),0);
  const events=activity.observe("alpha",page([row(1,"user","  Hi\n\tthere  "),row(2,"assistant","A reply"),
    {...row(3,"assistant",""),tool_calls:[{name:"read_report",arguments:"not copied into bubble"}]},
    {...row(4,"tool","<script>alert('QA')</script>\n"+"🙂".repeat(110)),tool_name:"search"}]),100);
  assert.deepEqual(events.map(event=>event.label),["Pesan masuk","Balasan","read_report","search"]);
  assert.equal(events[0].snippet,"Hi there");assert.equal(events[2].kind,"tool");
  assert.equal(Array.from(events[3].snippet).length,100);
  assert.ok(events[3].snippet.startsWith("<script>"),"HTML remains literal text for the caller's textContent renderer");
  assert.equal(JSON.stringify(events).includes("not copied"),false);
  assert.equal(activity.getBubble("alpha",100).message_id,"4");
});

test("initial recent-session opt-in excludes old, future and missing timestamps",()=>{
  const activity=Activity.create();
  const messages=[row(1,"user","old",WALL/1000-31),row(2,"user","missing",null),row(3,"user","future",WALL/1000+3),row(4,"user","recent",WALL/1000-2)];
  assert.deepEqual(activity.observe("alpha",page(messages),0,{allowRecentInitial:true}),[],"monotonic time is not a source wall clock");
  activity.clear();
  const events=activity.observe("alpha",page(messages),0,{allowRecentInitial:true,wallTimeMs:WALL});
  assert.deepEqual(events.map(event=>event.message_id),["4"]);
  assert.deepEqual(activity.observe("alpha",page(messages),1000,{allowRecentInitial:true,wallTimeMs:WALL}),[]);
  const later=activity.observe("alpha",page([...messages,row(5,"assistant","new with no time",null)]),2000);
  assert.equal(later.length,1);assert.equal(later[0].timestamp,null);
});

test("history pagination, old numeric rows and invalid ownership cannot claim incoming activity",()=>{
  const activity=Activity.create();activity.observe("alpha",page([row(10)]),0);
  assert.deepEqual(activity.observe("alpha",page([row(1),row(10)]),10),[]);
  assert.deepEqual(activity.observe("alpha",page([row(11)],"beta"),20),[]);
  assert.deepEqual(activity.observe("alpha",page([row(11)],"alpha","session-1",{available:false}),20),[]);
  assert.deepEqual(activity.observe("alpha",page([row(11)],"alpha","session-1",{requires_login:true}),20),[]);
  assert.deepEqual(activity.observe("alpha",page([row(11)]),20,{sessionId:"other-session"}),[]);
  assert.deepEqual(activity.observe("alpha",page([row(11)],"alpha","session-1",{pagination:{offset:50,order:"latest"}}),20),[]);
  assert.deepEqual(activity.observe("alpha",page([row(11)],"alpha","session-1",{pagination:{offset:0,order:"oldest"}}),20),[]);
  assert.equal(activity.observe("alpha",page([row(11)]),30).length,1,"rejected snapshots do not change dedupe state");
});

test("dedupe is scoped to resolved profile/session, ignores hidden roles and protects internal snapshots",()=>{
  const activity=Activity.create();
  activity.observe("alpha",page([row(1)]),0);activity.observe("beta",page([row(1)],"beta"),0);
  assert.equal(activity.observe("alpha",page([row(1),row(2)]),100).length,1);
  assert.equal(activity.observe("beta",page([row(1),row(2)],"beta"),100).length,1);
  assert.deepEqual(activity.observe("alpha",page([row(2)],"alpha","session-2"),100),[]);
  assert.deepEqual(activity.observe("alpha",page([{...row(3),display_kind:"hidden"},row(4,"system"),row(5,"reasoning")]),100),[]);
  const exposed=activity.getBubble("alpha",100);exposed.snippet="changed";
  assert.equal(activity.getBubble("alpha",100).snippet,"Hello");
  activity.clear("alpha");assert.equal(activity.getBubble("alpha",100),null);assert.ok(activity.getBubble("beta",100));
});

test("working fallback is truthful and bounded eviction safely establishes a new baseline",()=>{
  const activity=Activity.create();
  for(const status of ["idle","offline","unknown",undefined])assert.equal(activity.getBubble("alpha",0,{status}),null);
  assert.equal(activity.getBubble("alpha",0,{status:"working"}).label,"Mengerjakan…");
  activity.observe("alpha",page([row(1)]),0);
  for(let i=0;i<205;i++)activity.observe("alpha",page([row(1)],"alpha","session-extra-"+i),i);
  assert.deepEqual(activity.observe("alpha",page([row(1),row(2)]),300),[],"evicted history re-baselines rather than announcing old rows");
});
