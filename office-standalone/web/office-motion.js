(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.HermesOfficeMotion = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  // Foot anchors for the actual 1942×810 room. Only chair portals enter seats;
  // all other edges remain on open floor. Two aisle lanes prevent head-on walks.
  const SCENE = Object.freeze({width:1942,height:810,footRadius:14});
  const DESKS = Object.freeze([[625,375],[967,375],[1315,375],[770,630],[1170,630]].map(Object.freeze));
  const nodes = {}, edges = [], adjacency = new Map();
  const node = (id,x,y,location="corridor") => {nodes[id]=Object.freeze({id,x,y,location});adjacency.set(id,[]);};
  const edge = (a,b,both=true) => {edges.push(Object.freeze([a,b]));adjacency.get(a).push(b);if(both){edges.push(Object.freeze([b,a]));adjacency.get(b).push(a);}};
  const xs=[450,625,790,950,967,1120,1315,1390,1430,1450];
  xs.forEach(x=>{node("east-"+x,x,480);node("west-"+x,x,510);edge("east-"+x,"west-"+x);});
  for(let i=1;i<xs.length;i++){edge("east-"+xs[i-1],"east-"+xs[i],false);edge("west-"+xs[i],"west-"+xs[i-1],false);}
  node("left",450,405);edge("left","east-450");
  node("north",450,260);edge("left","north");
  node("coffee-road",640,260);node("vending-road",715,260);edge("north","coffee-road");edge("coffee-road","vending-road");
  node("coffee",640,230,"coffee");node("vending",715,230,"coffee");edge("coffee-road","coffee");edge("vending-road","vending");
  node("lounge-road",330,405);node("lounge-road-left",270,405);edge("left","lounge-road");edge("lounge-road","lounge-road-left");
  node("lounge",270,365,"lounge");node("lounge-side",330,365,"lounge");edge("lounge-road-left","lounge");edge("lounge-road","lounge-side");
  node("recreation-road",430,510);node("recreation",430,550,"recreation");edge("west-450","recreation-road");edge("recreation-road","recreation");
  node("server-road",1480,480);node("server-gate",1480,445);node("server",1480,300,"server");edge("east-1450","server-road");edge("server-road","server-gate");edge("server-gate","server");
  node("meeting",1430,630,"meeting");edge("west-1430","meeting");
  DESKS.forEach((seat,index)=>node("desk-"+index,seat[0],seat[1],"desk"));
  for(let i=0;i<3;i++){node("chair-exit-"+i,DESKS[i][0],445);edge("desk-"+i,"chair-exit-"+i);edge("chair-exit-"+i,"east-"+DESKS[i][0]);}
  node("bottom-left",770,710);node("bottom-middle",950,710);node("bottom-right",1170,710);node("bottom-corner",1390,710);
  edge("desk-3","bottom-left");edge("desk-4","bottom-right");edge("bottom-left","bottom-middle");edge("bottom-middle","bottom-right");edge("bottom-right","bottom-corner");edge("bottom-middle","west-950");edge("bottom-corner","west-1390");
  const GOALS=Object.freeze(["lounge","coffee","server","recreation","meeting","lounge-side","vending"]);
  // Table surfaces, legs/drawers, lounge furniture, machines and the glass room.
  // Chairs are interaction portals, not cross-room navigation shortcuts.
  const OBSTACLES=Object.freeze([
    [72,178,72,126],[143,126,201,97],[349,159,78,124],[174,217,151,80],[399,298,36,48],
    [557,70,41,121],[610,70,78,138],[697,69,69,144],
    [495,289,260,72],[837,289,264,72],[1187,289,261,72],
    [495,350,18,57],[736,356,19,52],[680,363,73,44],
    [837,350,18,57],[1086,355,17,54],[1023,363,76,44],
    [1187,350,18,57],[1430,357,18,52],[1374,363,73,44],
    [636,548,262,68],[1040,548,264,68],[804,617,91,43],[1208,617,89,42],
    [636,610,16,49],[882,615,16,43],[1040,610,16,49],[1288,615,16,43],
    [299,460,66,147],[129,470,103,144],[1520,73,169,174],[1505,365,416,384],[1468,550,37,146]
  ].map(rect=>Object.freeze({x:rect[0],y:rect[1],width:rect[2],height:rect[3]})));
  Object.freeze(nodes);Object.freeze(edges);
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const hash=value=>{let h=2166136261;for(const c of String(value)){h=Math.imul(h^c.charCodeAt(0),16777619);}return h>>>0;};
  function findPath(start,target){
    if(!nodes[start]||!nodes[target])return [];
    const costs=new Map([[start,0]]),previous=new Map(),remaining=new Set(Object.keys(nodes));
    while(remaining.size){
      let current=null,cost=Infinity;
      for(const id of remaining){const candidate=costs.get(id)??Infinity;if(candidate<cost){current=id;cost=candidate;}}
      if(current===null)break;if(current===target){const path=[target];while(previous.has(path[0]))path.unshift(previous.get(path[0]));return path;}
      remaining.delete(current);
      for(const next of adjacency.get(current)){if(!remaining.has(next))continue;const candidate=cost+distance(nodes[current],nodes[next]);if(candidate<(costs.get(next)??Infinity)){costs.set(next,candidate);previous.set(next,current);}}
    }
    return [];
  }
  const pathLength=path=>path.slice(1).reduce((sum,id,index)=>sum+distance(nodes[path[index]],nodes[id]),0);
  function create(){
    const actors=new Map();let roster=[],lastTime=null,paused=false,reduced=false;
    function route(actor,target){
      // If a status changes mid-edge, first follow that edge to an endpoint.
      const starts=actor.path.length?[actor.path[0]]:[actor.node];
      let best=[],cost=Infinity;
      for(const start of starts){const path=findPath(start,target);if(!path.length)continue;const length=distance(actor,nodes[start])+pathLength(path);if(length<cost){best=path;cost=length;}}
      if(!best.length)return;
      actor.path=distance(actor,nodes[best[0]])<.001?best.slice(1):best;
      actor.destination=target;actor.mode=actor.path.length?"walking":"resting";
      if(!actor.path.length)arrive(actor);
    }
    function arrive(actor){
      actor.node=actor.destination;actor.path=[];
      const atDesk=actor.node===actor.home;
      actor.mode=actor.status==="working"&&atDesk?"working":atDesk?"idle":"resting";
      actor.dwell=atDesk?2.5+(actor.seed+actor.cycle)%35/10:4+(actor.seed+actor.cycle)%65/10;
      actor.direction=nodes[actor.node].location==="coffee"?"up":nodes[actor.node].location==="recreation"?"left":"down";
    }
    function chooseGoal(actor){
      const reserved=new Set([...actors.values()].filter(other=>other!==actor&&other.status==="idle").map(other=>other.destination));
      const start=(actor.seed+actor.cycle*3)%GOALS.length;
      for(let i=0;i<GOALS.length;i++){const goal=GOALS[(start+i)%GOALS.length];if(!reserved.has(goal))return goal;}
      return actor.home;
    }
    function synchronize(agents){
      const valid=(Array.isArray(agents)?agents:[]).filter(a=>a&&typeof a.id==="string"&&a.id).slice().sort((a,b)=>a.id.localeCompare(b.id,"en")).slice(0,DESKS.length);
      const ids=new Set(valid.map(a=>a.id));for(const id of actors.keys())if(!ids.has(id))actors.delete(id);
      for(const agent of valid){
        let actor=actors.get(agent.id);
        if(!actor){
          const used=new Set([...actors.values()].map(a=>a.slot));let slot=0;while(used.has(slot))slot++;
          const initial=agent.status==="idle"?GOALS[slot]:"desk-"+slot,point=nodes[initial],seed=hash(agent.id);
          actor={id:agent.id,slot,home:"desk-"+slot,node:initial,destination:initial,x:point.x,y:point.y,status:agent.status,
                 mode:agent.status==="working"?"working":agent.status==="idle"?"resting":"stationary",direction:point.location==="coffee"?"up":"down",
                 path:[],seed,speed:40+seed%26,distance:0,animation:0,cycle:0,wait:0,dwell:.3+(seed%10)/10};
          actors.set(agent.id,actor);
        }
        actor.status=agent.status;
      }
      roster=valid;
    }
    function advance(timeMs,options={}){
      const now=Number.isFinite(timeMs)?timeMs:lastTime??0;
      const wasPaused=paused;paused=options.paused===undefined?paused:options.paused===true;reduced=options.reducedMotion===undefined?reduced:options.reducedMotion===true;
      const dt=lastTime===null||wasPaused||paused?0:Math.max(0,Math.min((now-lastTime)/1000,.25));lastTime=now;
      if(paused)return getEntities();
      for(const actor of actors.values()){
        if(actor.status!=="idle"&&actor.status!=="working"){
          const home=nodes[actor.home];Object.assign(actor,{x:home.x,y:home.y,node:actor.home,destination:actor.home,path:[],mode:"stationary",direction:"down"});continue;
        }
        if(reduced){
          if(actor.status==="working"){const home=nodes[actor.home];Object.assign(actor,{x:home.x,y:home.y,node:actor.home,destination:actor.home,path:[],mode:"working",direction:"down"});}
          continue;
        }
        actor.animation+=dt;
        if(actor.status==="working"&&actor.destination!==actor.home)route(actor,actor.home);
        if(actor.status==="idle"&&!actor.path.length){
          actor.dwell-=dt;
          if(actor.dwell<=0){actor.cycle++;route(actor,actor.node===actor.home?chooseGoal(actor):actor.home);}
        }
        if(!actor.path.length)continue;
        let budget=actor.speed*dt;
        for(let segment=0;budget>0&&actor.path.length&&segment<4;segment++){
          const next=nodes[actor.path[0]],length=distance(actor,next),amount=Math.min(length,budget);
          if(length<.001){actor.node=actor.path.shift();if(!actor.path.length)arrive(actor);continue;}
          const candidate={x:actor.x+(next.x-actor.x)*amount/length,y:actor.y+(next.y-actor.y)*amount/length};
          const blocked=[...actors.values()].some(other=>other!==actor&&distance(candidate,other)<SCENE.footRadius*2&&distance(candidate,other)<distance(actor,other)-.001);
          // Briefly yield at crossings; bounded waits keep cosmetic pedestrians
          // from deadlocking when two return-to-desk routes meet at a junction.
          if(blocked&&actor.wait<1.1){actor.wait+=dt;break;}
          if(!blocked)actor.wait=0;
          const dx=next.x-actor.x,dy=next.y-actor.y;actor.direction=Math.abs(dx)>Math.abs(dy)?dx<0?"left":"right":dy<0?"up":"down";
          actor.x=candidate.x;actor.y=candidate.y;actor.distance+=amount;budget-=amount;
          if(amount>=length-.001){actor.node=actor.path.shift();if(!actor.path.length)arrive(actor);}
        }
      }
      return getEntities();
    }
    function getEntities(){
      return [...actors.values()].map(actor=>{
        const moving=actor.path.length>0&&!paused&&!reduced;
        const atDesk=actor.node===actor.home&&actor.path.length===0;
        const location=actor.path.length?"corridor":nodes[actor.node].location;
        const working=actor.status==="working"&&atDesk;
        const frame=moving?[0,1,2,1][Math.floor(actor.distance/12)%4]:working?3+(paused||reduced?0:Math.floor(actor.animation*3)%2):actor.status==="idle"&&location==="coffee"?5+(paused||reduced?0:Math.floor(actor.animation*1.5)%2):0;
        const direction=atDesk?"down":actor.direction;
        return {id:actor.id,x:actor.x,y:actor.y,direction,facing:direction,frame,row:direction==="up"?1:direction==="down"?0:2,
                mirror:direction==="left",moving,mode:working?"working":moving?"walking":actor.status==="idle"?"resting":"stationary",
                location,character:actor.slot,deskX:DESKS[actor.slot][0],deskY:DESKS[actor.slot][1]};
      });
    }
    return {update(agents,timeMs,options){synchronize(agents);return advance(timeMs,options);},step:advance,getEntities,
            getPositions(){return Object.fromEntries(getEntities().map(entity=>[entity.id,entity]));}};
  }
  return Object.freeze({create,SCENE,DESKS,NODES:nodes,EDGES:edges,OBSTACLES,GOALS,findPath});
});
