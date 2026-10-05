import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const PALETTE = {
  cream: '#f6f4eb', wall: '#fbfbf5', oak: '#ccb18b', oakLight: '#e8cfac',
  sage: '#97b4a0', sageLight: '#dce7d9', pine: '#477b65', clay: '#d79279',
  peach: '#f5d9c4', blue: '#94b9cc', blueLight: '#dce9ed', ink: '#354b4b',
  brass: '#c5a56f', gray: '#b6c1bc', glass: '#b9d8cf', white: '#fffdf8',
};

export const DESK_SLOTS = [[-4, -1.8], [0, -1.8], [4, -1.8], [-2, 2.5], [2, 2.5]];
export const OFFICE_GOALS = {
  meeting: [7, -4], focus: [-8, -4], research: [8, 0], library: [-4, -5.5],
  server: [9, -5.5], lounge: [-8, 0], pantry: [-8, 4], reception: [0, 6], garden: [8, 5],
};

// The graph follows the generous aisles and approaches every chair from its side.
const AISLES = [
  [-6, -3.55], [-2, -3.55], [2, -3.55], [6.3, -2.85],
  [-6, .15], [-2, .15], [2, .15], [6.3, .15],
  [-6, 3.9], [-2, 3.9], [2, 3.9], [6.3, 3.9],
  [-8, -4], [-4, -5.5], [7, -4], [9, -5.5],
  [-8, 0], [8, 0], [-8, 4], [0, 6], [8, 5],
  ...DESK_SLOTS, [0,.15], [0,3.9], [9,-3.1],
];
const LINKS = [
  [0,1],[1,2],[4,5],[5,6],[6,7],[8,9],[9,10],[10,11],
  [0,4],[4,8],[1,5],[2,6],[3,7],[7,11],
  [0,12],[1,13],[3,14],[3,28],[28,15],[4,16],[7,17],[8,18],[9,19],[10,19],[11,20],
  [4,21],[5,21],[5,22],[6,22],[6,23],[7,23],[9,24],[10,25],
  [5,26],[6,26],[26,27],[27,9],[27,10],[27,19],
];
const neighbors = AISLES.map(() => []);
LINKS.forEach(([a,b]) => { neighbors[a].push(b); neighbors[b].push(a); });
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);

export function point2(value, fallback = [0,0]) {
  if (Array.isArray(value) && value.length >= 3) return [Number(value[0]) || 0, Number(value[2]) || 0];
  if (Array.isArray(value) && value.length >= 2) return [Number(value[0]) || 0, Number(value[1]) || 0];
  if (value && typeof value === 'object' && value.x !== undefined) return [Number(value.x) || 0, Number(value.z ?? value.y) || 0];
  return [...fallback];
}

export function makeRoute(start, finish) {
  const end = [THREE.MathUtils.clamp(finish[0],-10.2,10.2),THREE.MathUtils.clamp(finish[1],-6.8,6.7)];
  if (distance(start,end) < .2) return [];
  const closest = p => AISLES.reduce((best,v,i) => distance(p,v) < distance(p,AISLES[best]) ? i : best,0);
  const a = closest(start), b = closest(end);
  const cost = AISLES.map(() => Infinity), previous = AISLES.map(() => -1), pending = new Set(AISLES.map((_,i)=>i));
  cost[a] = 0;
  while (pending.size) {
    let u = -1;
    pending.forEach(i=>{ if(u === -1 || cost[i] < cost[u]) u=i; });
    if(u === b || !Number.isFinite(cost[u])) break;
    pending.delete(u);
    neighbors[u].forEach(v=>{ const next = cost[u]+distance(AISLES[u],AISLES[v]); if(next<cost[v]) { cost[v]=next; previous[v]=u; }});
  }
  const path = [b];
  for(let at=b; at!==a && previous[at]>=0;) { at=previous[at]; path.unshift(at); }
  const route = path.map(i=>[...AISLES[i]]);
  if(distance(start,route[0])<.16) route.shift();
  if(!route.length || distance(route[route.length-1],end)>.12) route.push(end);
  return route;
}

export function agentState(agent) {
  const raw = String(agent.visualState || agent.status || 'idle').toLowerCase();
  if(['working','running','active','busy','typing','executing'].includes(raw)) return 'working';
  if(['thinking','planning','reasoning','queued'].includes(raw)) return 'thinking';
  if(['completed','complete','done','success'].includes(raw)) return 'completed';
  if(['error','failed','blocked','failure'].includes(raw)) return 'error';
  if(['offline','disconnected','unknown'].includes(raw)) return raw === 'unknown' ? 'unknown' : 'offline';
  if(['meeting','resting','walking'].includes(raw)) return raw;
  return 'idle';
}

export function agentGoal(agent, index, state = agentState(agent)) {
  if (agent.targetPosition) return point2(agent.targetPosition, DESK_SLOTS[index % 5]);
  const room = String(agent.room || '').toLowerCase();
  if(OFFICE_GOALS[room]) return [...OFFICE_GOALS[room]];
  if(state==='meeting') return [...OFFICE_GOALS.meeting];
  if(state==='resting') return [...OFFICE_GOALS.lounge];
  if(state==='working' || state==='thinking') {
    const task = `${agent.currentTask || ''} ${(Array.isArray(agent.tools)?agent.tools:[]).map(t=>typeof t==='string'?t:t.name||'').join(' ')}`.toLowerCase();
    if(/research|search|browse|investigat/.test(task)) return [...OFFICE_GOALS.research];
    if(/deploy|server|terminal|infrastructure/.test(task)) return [...OFFICE_GOALS.server];
  }
  return [...DESK_SLOTS[index % 5]];
}

export function matchesFilter(agent, filter) {
  if(!filter || filter==='all') return true;
  const state = agentState(agent);
  if(typeof filter === 'object') {
    const text=String(filter.search || filter.query || '').toLowerCase();
    const status=String(filter.status || 'all').toLowerCase();
    return (!text || `${agent.name} ${agent.role} ${agent.currentTask}`.toLowerCase().includes(text)) &&
      (status==='all' || status===state || (status==='active' && ['working','thinking','walking','meeting'].includes(state)));
  }
  const query=String(filter).toLowerCase();
  if(['operations','customer-support','corporate','research'].includes(query)) {
    const category=String(agent.category||agent.team||'').toLowerCase().replace(/[_\s]+/g,'-');
    if(category===query) return true;
    const role=String(agent.role||'').toLowerCase();
    const patterns={operations:/operation|operasi|pms|system|coordina/, 'customer-support':/customer|support|layanan|service/,corporate:/corporate|admin|finance|keuangan|business/,research:/research|peneliti|analyst|analisis/};
    return !category&&patterns[query].test(role);
  }
  if(query==='active') return ['working','thinking','walking','meeting'].includes(state);
  if(['idle','thinking','working','walking','meeting','resting','completed','error','offline','unknown'].includes(query)) return state===query;
  return `${agent.name} ${agent.role} ${agent.currentTask}`.toLowerCase().includes(query);
}

export const STATE_COLORS = {
  working:'#64a38d', thinking:'#b597ce', walking:'#7aaaca', meeting:'#7aaaca',
  resting:'#bbad8b', idle:'#a0afa4', completed:'#65a779', error:'#d88676', offline:'#aab1b0', unknown:'#aab1b0',
};

export const G = {
  sphere:new THREE.SphereGeometry(1,16,12), cylinder:new THREE.CylinderGeometry(1,1,1,14),
  cone:new THREE.ConeGeometry(1,1,12), plane:new THREE.PlaneGeometry(1,1),
  torus:new THREE.TorusGeometry(1,.12,8,24), circle:new THREE.CircleGeometry(1,32),
};
const geometries = new Map(), materials = new Map();
export function roundedGeometry(args,radius=.06) {
  const key=`${args.join(',')}/${radius}`;
  if(!geometries.has(key)) geometries.set(key,new RoundedBoxGeometry(...args,2,Math.min(radius,...args.map(v=>v/2))));
  return geometries.get(key);
}
export function material(color, options={}) {
  const key=`${color}/${JSON.stringify(options)}`;
  if(!materials.has(key)) materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.76,metalness:0,...options}));
  return materials.get(key);
}

export function Block({size=[1,1,1],radius=.05,color=PALETTE.white,position,rotation,opacity=1,material:custom,...props}) {
  return <mesh geometry={roundedGeometry(size,radius)} material={custom||material(color,opacity<1?{transparent:true,opacity,depthWrite:false}:{})}
    position={position} rotation={rotation} castShadow receiveShadow {...props} />;
}
export function Ball({size=[1,1,1],color=PALETTE.white,opacity=1,...props}) {
  return <mesh geometry={G.sphere} scale={size} material={material(color,opacity<1?{transparent:true,opacity,depthWrite:false}:{})} castShadow receiveShadow {...props}/>;
}
export function Cylinder({size=[1,1,1],color=PALETTE.white,...props}) {
  return <mesh geometry={G.cylinder} scale={size} material={material(color)} castShadow receiveShadow {...props}/>;
}
