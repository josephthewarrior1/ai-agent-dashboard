"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const Motion=require("../web/office-motion.js");
const agents=()=>["alpha","beta","gamma","delta","epsilon"].map(id=>({id,status:"idle"}));
const near=(a,b,tolerance=.001)=>Math.hypot(a.x-b.x,a.y-b.y)<=tolerance;
const blocked=point=>Motion.OBSTACLES.some(rect=>point.x>rect.x-Motion.SCENE.footRadius+.001&&point.x<rect.x+rect.width+Motion.SCENE.footRadius-.001&&point.y>rect.y-Motion.SCENE.footRadius+.001&&point.y<rect.y+rect.height+Motion.SCENE.footRadius-.001);

test("every handmapped edge stays on clear bounded floor and every break can return home",()=>{
  for(const[from,to]of Motion.EDGES){
    const a=Motion.NODES[from],b=Motion.NODES[to];assert.ok(a.x===b.x||a.y===b.y,"corridors use orthogonal turns");
    const steps=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y));
    for(let i=0;i<=steps;i++){
      const point={x:a.x+(b.x-a.x)*i/steps,y:a.y+(b.y-a.y)*i/steps};
      assert.ok(point.x>=14&&point.y>=14&&point.x<=Motion.SCENE.width-14&&point.y<=Motion.SCENE.height-14);
      assert.equal(blocked(point),false,`${from} -> ${to} crosses furniture at ${point.x},${point.y}`);
    }
  }
  for(const goal of Motion.GOALS)for(let slot=0;slot<5;slot++){
    const path=Motion.findPath(goal,"desk-"+slot);assert.equal(path[0],goal);assert.equal(path.at(-1),"desk-"+slot);
  }
});

test("idle actors appear at break areas immediately and preserve identity across polls",()=>{
  const motion=Motion.create(),input=agents();motion.update(input,0);
  assert.equal(motion.getEntities().filter(a=>a.location!=="desk").length,5);
  for(let time=20;time<=2200;time+=20)motion.step(time);
  assert.ok(motion.getEntities().some(a=>a.moving));
  const before=motion.getPositions();motion.update(input.map(a=>({...a})).reverse(),2200);
  assert.deepEqual(motion.getPositions(),before);assert.ok(input.every(a=>a.status==="idle"));
});

test("smooth walking is refresh independent and a long browser gap cannot teleport",()=>{
  function simulate(fps){const motion=Motion.create();motion.update([{id:"one",status:"idle"}],0);for(let tick=1;tick<=fps*8;tick++)motion.step(tick*1000/fps);return motion;}
  const slow=simulate(30),fast=simulate(60);assert.ok(near(slow.getEntities()[0],fast.getEntities()[0],3));
  const before=fast.getEntities()[0];fast.step(1_000_000);const after=fast.getEntities()[0];assert.ok(near(before,after,65*.25+.001));
  for(const actor of fast.getEntities()){assert.ok(actor.frame>=0&&actor.frame<=6);assert.equal(blocked(actor),false);}
});

test("actual work returns all actors to their own desk before typing",()=>{
  const motion=Motion.create(),input=agents();motion.update(input,0);for(let time=33;time<=3000;time+=33)motion.step(time);
  const working=input.map(a=>({...a,status:"working"}));motion.update(working,3000);
  for(let time=3033;time<=120000;time+=33)motion.step(time);
  for(const actor of motion.getEntities()){
    assert.ok(near(actor,{x:actor.deskX,y:actor.deskY}));assert.equal(actor.location,"desk");assert.equal(actor.mode,"working");assert.ok(actor.frame===3||actor.frame===4);assert.equal(actor.moving,false);
  }
});

test("paused clocks freeze positions and reduced motion stays static",()=>{
  const motion=Motion.create();motion.update(agents(),0);motion.step(1500);const before=motion.getPositions();
  motion.step(3000,{paused:true});motion.step(40000,{paused:true});
  for(const actor of motion.getEntities()){assert.ok(near(actor,before[actor.id]));assert.equal(actor.moving,false);}
  motion.step(50000,{paused:false});for(const actor of motion.getEntities())assert.ok(near(actor,before[actor.id]));
  motion.step(51000,{reducedMotion:true});const reduced=motion.getPositions();motion.step(100000,{reducedMotion:true});
  for(const actor of motion.getEntities()){assert.ok(near(actor,reduced[actor.id]));assert.equal(actor.moving,false);}
});

test("offline and unknown actors stay at desk without fabricated work animation",()=>{
  const motion=Motion.create();motion.update([{id:"offline",status:"offline"},{id:"unknown",status:"unknown"}],0);motion.step(10000);
  for(const actor of motion.getEntities()){assert.equal(actor.location,"desk");assert.equal(actor.frame,0);assert.equal(actor.mode,"stationary");assert.equal(actor.moving,false);}
});
