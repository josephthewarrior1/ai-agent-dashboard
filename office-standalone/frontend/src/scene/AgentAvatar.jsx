import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useCursor } from '@react-three/drei';
import * as THREE from 'three';
import { Ball, Block, DESK_SLOTS, G, OFFICE_GOALS, PALETTE as P, STATE_COLORS, agentGoal, agentState, makeRoute, material, point2 } from './world';

const LOOKS = [
  {skin:'#d6a181',hair:'#514033',shirt:'#f1eee5',jacket:P.clay,pants:'#647c7b',shoes:'#f9f3e8',style:'glasses'},
  {skin:'#a97351',hair:'#35342e',shirt:'#e8eadc',jacket:P.sage,pants:'#53685f',shoes:'#e8dcc6',style:'headphones'},
  {skin:'#e9b6a0',hair:'#a46846',shirt:'#fbf4e9',jacket:P.blue,pants:'#607f94',shoes:'#f5e6d1',style:'bob'},
  {skin:'#c78d6c',hair:'#3b3d39',shirt:'#f6ede9',jacket:'#b6a0c4',pants:'#726c85',shoes:'#f7f2e8',style:'bun'},
  {skin:'#e4b78f',hair:'#8d7154',shirt:'#789593',jacket:'#d3b271',pants:'#62746d',shoes:'#eedcc2',style:'cap'},
];
const eyeGeometry=new THREE.SphereGeometry(1,10,8);
const headphoneGeometry=new THREE.TorusGeometry(.31,.032,8,24,Math.PI);
const glassesGeometry=new THREE.TorusGeometry(.069,.010,7,18);
const ringGeometry=new THREE.RingGeometry(.42,.47,40);
const sparkGeometry=new THREE.OctahedronGeometry(.045);
const STATE_LABELS={idle:'Siap',working:'Bekerja',thinking:'Berpikir',walking:'Berjalan',meeting:'Meeting',resting:'Istirahat',completed:'Selesai',error:'Kendala',offline:'Offline',unknown:'Belum terverifikasi'};

function Head({look,opacity=1}) {
  const {skin,hair,style}=look;
  return <group>
    <Ball size={[.274,.289,.25]} position={[0,0,0]} color={skin} opacity={opacity}/>
    <Ball size={[.048,.072,.055]} position={[-.267,-.035,.025]} color={skin} opacity={opacity}/>
    <Ball size={[.048,.072,.055]} position={[.267,-.035,.025]} color={skin} opacity={opacity}/>
    <Ball size={[.052,.047,.055]} position={[0,-.045,.249]} color={skin} opacity={opacity}/>
    <Ball size={[.27,.20,.245]} position={[0,.15,-.035]} color={hair} opacity={opacity}/>
    <Ball size={[.19,.081,.115]} position={[-.08,.18,.16]} rotation={[0,0,.25]} color={hair} opacity={opacity}/>
    <Ball size={[.11,.065,.1]} position={[.16,.19,.135]} rotation={[0,0,-.4]} color={hair} opacity={opacity}/>
    {[-1,1].map(side=><group key={side}>
      <mesh geometry={eyeGeometry} scale={[.029,.038,.017]} position={[side*.105,.006,.228]} material={material('#343d36',opacity<1?{transparent:true,opacity,depthWrite:false}:{})}/>
      <Ball size={[.008,.011,.005]} position={[side*.10,.019,.244]} color={P.white} opacity={opacity} castShadow={false}/>
      <Block size={[.073,.014,.016]} radius={.006} position={[side*.105,.086,.222]} rotation={[0,0,-side*.07]} color={hair} opacity={opacity}/>
      <Ball size={[.044,.024,.011]} position={[side*.159,-.061,.217]} color="#d99884" opacity={opacity} castShadow={false}/>
    </group>)}
    <Block size={[.067,.016,.017]} radius={.007} position={[0,-.13,.221]} rotation={[0,0,-.08]} color="#975f53" opacity={opacity}/>
    {(style==='glasses'||style==='bun') && <group position={[0,.011,.265]}>
      {[-1,1].map(side=><mesh key={side} geometry={glassesGeometry} scale={style==='bun'?[1.05,.92,1]:[1,1,1]} position={[side*.105,0,0]} material={material(style==='bun'?P.ink:P.brass,opacity<1?{transparent:true,opacity,depthWrite:false}:{})}/>) }
      <Block size={[.08,.012,.013]} position={[0,.015,0]} color={style==='bun'?P.ink:P.brass} opacity={opacity}/>
      {[-1,1].map(side=><Block key={side} size={[.07,.015,.012]} position={[side*.206,.01,-.036]} rotation={[0,-side*.40,0]} color={style==='bun'?P.ink:P.brass} opacity={opacity}/>) }
    </group>}
    {style==='headphones' && <group>
      <mesh geometry={headphoneGeometry} position={[0,.072,-.005]} material={material('#516d65',opacity<1?{transparent:true,opacity,depthWrite:false}:{})}/>
      {[-1,1].map(side=><group key={side}>
        <Ball size={[.075,.112,.095]} position={[side*.289,-.015,-.005]} color={P.oakLight} opacity={opacity}/>
        <Ball size={[.045,.085,.069]} position={[side*.337,-.015,-.005]} color={P.sage} opacity={opacity}/>
      </group>)}
      {[0,1,2,3,4,5].map(i=><Ball key={i} size={[.105,.095,.10]} position={[(i%3-1)*.145,.25+(i>2?.02:0),(i>2?-.11:.065)]} color={hair} opacity={opacity}/>) }
    </group>}
    {style==='bob' && <group>
      <Ball size={[.12,.235,.20]} position={[-.215,-.035,-.035]} color={hair} opacity={opacity}/>
      <Ball size={[.105,.235,.18]} position={[.22,-.025,-.045]} color={hair} opacity={opacity}/>
      <Ball size={[.265,.21,.11]} position={[0,.02,-.19]} color={hair} opacity={opacity}/>
      <Block size={[.092,.028,.026]} position={[.235,.055,.09]} rotation={[0,0,.18]} color={P.brass} opacity={opacity}/>
    </group>}
    {style==='bun' && <group>
      <Ball size={[.125,.13,.12]} position={[0,.32,-.105]} color={hair} opacity={opacity}/>
      <Ball size={[.071,.056,.10]} position={[-.22,.12,.14]} rotation={[0,0,-.3]} color={hair} opacity={opacity}/>
      <Block size={[.095,.025,.11]} position={[0,.265,-.10]} color={P.clay} opacity={opacity}/>
      <Ball size={[.023,.028,.018]} position={[-.272,-.088,.048]} color={P.brass} opacity={opacity}/>
      <Ball size={[.023,.028,.018]} position={[.272,-.088,.048]} color={P.brass} opacity={opacity}/>
    </group>}
    {style==='cap' && <group>
      <Ball size={[.287,.16,.266]} position={[0,.24,-.025]} color={P.sage} opacity={opacity}/>
      <Block size={[.42,.045,.33]} radius={.022} position={[0,.19,.172]} rotation={[-.07,0,0]} color={P.sage} opacity={opacity}/>
      <Block size={[.057,.054,.012]} radius={.014} position={[0,.302,.223]} color={P.cream} opacity={opacity}/>
    </group>}
  </group>;
}

function Arm({side,look,armRef,elbowRef,opacity=1}) {
  return <group ref={armRef} position={[side*.255,.988,0]}>
    <Block size={[.16,.28,.19]} position={[side*.016,-.10,0]} radius={.075} color={look.jacket} opacity={opacity}/>
    <group ref={elbowRef} position={[side*.02,-.235,0]}>
      <Block size={[.132,.20,.152]} position={[0,-.075,0]} radius={.06} color={look.jacket} opacity={opacity}/>
      <Ball size={[.073,.080,.068]} position={[0,-.19,.016]} color={look.skin} opacity={opacity}/>
    </group>
  </group>;
}

function Leg({side,look,legRef,kneeRef,opacity=1}) {
  return <group ref={legRef} position={[side*.125,.56,0]}>
    <Block size={[.168,.25,.19]} position={[0,-.095,0]} radius={.064} color={look.pants} opacity={opacity}/>
    <group ref={kneeRef} position={[0,-.215,0]}>
      <Block size={[.145,.24,.165]} position={[0,-.095,0]} radius={.056} color={look.pants} opacity={opacity}/>
      <Block size={[.18,.117,.283]} position={[0,-.231,.045]} radius={.055} color={look.shoes} opacity={opacity}/>
      <Block size={[.181,.033,.28]} position={[0,-.275,.046]} radius={.014} color={P.oak} opacity={opacity}/>
    </group>
  </group>;
}

function destinationPose(agent,state) {
  if(state!=='walking') return state;
  if(String(agent.room).toLowerCase()==='meeting') return 'meeting';
  if(['working','active','busy','running'].includes(String(agent.status).toLowerCase())) return 'working';
  return 'idle';
}

function AgentAvatar({agent,index,selected,dimmed,onSelect,onAgentArrived,motionPaused,bubble,positions,labelPortal}) {
  const id=agent.id || `agent-${index}`;
  const state=agentState(agent), pose=destinationPose(agent,state);
  const initial=useMemo(()=>point2(agent.position || agent.deskPosition,DESK_SLOTS[index%5]),[id,index]);
  const goal=agentGoal(agent,index,state), goalKey=goal.join(',');
  const root=useRef(), rig=useRef(), head=useRef(), leftArm=useRef(),rightArm=useRef(),leftElbow=useRef(),rightElbow=useRef();
  const leftLeg=useRef(),rightLeg=useRef(),leftKnee=useRef(),rightKnee=useRef(),ring=useRef(),sparks=useRef();
  const route=useRef([]), phase=useRef(index*1.8), currentPose=useRef(pose), nextIdleAt=useRef(12+index*4),idleStop=useRef(0),desiredAngle=useRef(.55);
  const arrivedKey=useRef(null),arrivalCallback=useRef(onAgentArrived);
  arrivalCallback.current=onAgentArrived;
  const [hovered,setHovered]=useState(false);
  const [labelsReady,setLabelsReady]=useState(false);
  // Html owns a separate DOM root. Wait for the Canvas camera and the explicit
  // portal to finish their first StrictMode commit before creating those roots.
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>setLabelsReady(true));
    return ()=>cancelAnimationFrame(frame);
  },[id]);
  useCursor(hovered&&!dimmed);
  const look=useMemo(()=>({...LOOKS[index%5],jacket:agent.color || LOOKS[index%5].jacket}),[index,agent.color]);
  const opacity=dimmed?.28:1;
  useEffect(()=>{
    const position=root.current.position;
    route.current=makeRoute([position.x,position.z],goal);
    if(agent.targetPosition&&(route.current.length>0||state==='walking')) arrivedKey.current=null;
    currentPose.current=pose;
    nextIdleAt.current=phase.current+12+index*4;
    desiredAngle.current=pose==='working' ? String(agent.room).toLowerCase()==='research' ? Math.PI/2 : Math.PI : .55;
  },[goalKey,pose,state,id,index,agent.room]);
  useEffect(()=>{
    positions.set(id,root.current.position);
    return ()=>positions.delete(id);
  },[id,positions]);
  useFrame((_,rawDelta)=>{
    if(!root.current || motionPaused) return;
    const delta=Math.min(rawDelta,.05),t=phase.current+=delta;
    const p=root.current.position;
    let moving=route.current.length>0;
    if(moving) {
      const waypoint=route.current[0],dx=waypoint[0]-p.x,dz=waypoint[1]-p.z,d=Math.hypot(dx,dz);
      const step=delta*(pose==='error'?.84:1.45);
      if(d<step+.045) {p.x=waypoint[0];p.z=waypoint[1];route.current.shift();}
      else {p.x+=dx/d*step;p.z+=dz/d*step;desiredAngle.current=Math.atan2(dx,dz);}
    } else if(pose==='idle' && !agent.targetPosition && t>nextIdleAt.current) {
      const destinations=[OFFICE_GOALS.garden,OFFICE_GOALS.pantry,OFFICE_GOALS.library,OFFICE_GOALS.lounge,DESK_SLOTS[index%5]];
      const stop=(idleStop.current++ + index)%destinations.length;
      route.current=makeRoute([p.x,p.z],destinations[stop]);
      currentPose.current=(stop===0||stop===3)?'resting':stop===2?'thinking':'idle';
      nextIdleAt.current=t+25+index*2;
    }
    moving=route.current.length>0;
    if(!moving&&agent.targetPosition) {
      const key=goalKey;
      if(arrivedKey.current!==key&&Math.hypot(p.x-goal[0],p.z-goal[1])<.1) {
        arrivedKey.current=key;
        arrivalCallback.current?.(id,[p.x,0,p.z]);
      }
    }
    const activity=moving?'walking':currentPose.current;
    if(!moving && activity==='working') {
      const room=String(agent.room||'').toLowerCase();
      desiredAngle.current=room==='research'?Math.PI/2:room==='server'?0:Math.PI;
    }
    if(!moving && activity==='meeting') desiredAngle.current=Math.atan2(5.9-p.x,-5.1-p.z);
    if(!moving && ['idle','resting','thinking','completed','error','offline','unknown'].includes(activity)) desiredAngle.current=.48+(index-2)*.075+Math.sin(t*.32)*.075;
    const angleDelta=Math.atan2(Math.sin(desiredAngle.current-root.current.rotation.y),Math.cos(desiredAngle.current-root.current.rotation.y));
    root.current.rotation.y+=angleDelta*Math.min(delta*8,1);
    const stride=Math.sin(t*8.5), breath=Math.sin(t*1.9+index);
    const seated=!moving&&(activity==='meeting'||(activity==='working'&&['desk','focus','research'].includes(String(agent.room||'desk').toLowerCase())));
    const targetHeight=seated?.11:activity==='resting'?.035:0;
    rig.current.position.y=THREE.MathUtils.damp(rig.current.position.y,targetHeight+(moving?Math.abs(stride)*.034:breath*.009),7,delta);
    rig.current.rotation.z=THREE.MathUtils.damp(rig.current.rotation.z,activity==='thinking'?.04:activity==='error'?Math.sin(t*8)*.018:moving?stride*.026:0,7,delta);
    rig.current.rotation.x=THREE.MathUtils.damp(rig.current.rotation.x,seated?.08:activity==='resting'?-.07:0,6,delta);
    head.current.rotation.x=THREE.MathUtils.damp(head.current.rotation.x,activity==='thinking'?-.1:activity==='working'?.14:activity==='resting'?-.12:0,6,delta);
    head.current.rotation.z=THREE.MathUtils.damp(head.current.rotation.z,activity==='thinking'?Math.sin(t*.8)*.07:activity==='meeting'?Math.sin(t*1.8)*.04:0,6,delta);
    let la=0,ra=0,le=-.12,re=-.12,ll=0,rl=0,lk=0,rk=0,lz=.07,rz=-.07;
    if(moving) {ll=stride*.50;rl=-stride*.50;lk=Math.max(0,-stride)*.58;rk=Math.max(0,stride)*.58;la=-stride*.35;ra=stride*.35;}
    else if(activity==='working') {la=-.85+Math.sin(t*9)*.05;ra=-.85+Math.sin(t*11+.4)*.05;le=-.82;re=-.82;if(seated){ll=-1.24;rl=-1.24;lk=1.18;rk=1.18;}}
    else if(activity==='thinking') {ra=-2.25;re=-.76;rz=-.15;la=-.10;le=-.46;}
    else if(activity==='meeting') {la=-.7-Math.sin(t*2.4)*.23;le=-.75;ra=-.27;re=-.43;ll=-1.24;rl=-1.24;lk=1.18;rk=1.18;}
    else if(activity==='resting') {la=-.18;ra=-.15;le=-.45;re=-.45;lz=.11;rz=-.11;}
    else if(activity==='completed') {la=-2.35;ra=-2.35;le=-.37;re=-.37;lz=.29;rz=-.29;rig.current.position.y+=Math.max(0,Math.sin(t*5))*.045;}
    else if(activity==='error') {la=-.42;ra=-1.5;le=-.7;re=-1.25;head.current.rotation.z=Math.sin(t*1.1)*.085;}
    else if(activity==='offline'||activity==='unknown') {head.current.rotation.x=.22;la=.08;ra=.08;}
    [[leftArm,la],[rightArm,ra],[leftElbow,le],[rightElbow,re],[leftLeg,ll],[rightLeg,rl],[leftKnee,lk],[rightKnee,rk]].forEach(([ref,target])=>{ref.current.rotation.x=THREE.MathUtils.damp(ref.current.rotation.x,target,12,delta);});
    leftArm.current.rotation.z=THREE.MathUtils.damp(leftArm.current.rotation.z,lz,8,delta);
    rightArm.current.rotation.z=THREE.MathUtils.damp(rightArm.current.rotation.z,rz,8,delta);
    if(ring.current) {ring.current.rotation.z=t*.2;ring.current.material.opacity=selected?.40+Math.sin(t*2)*.09:hovered?.24:.085;}
    if(sparks.current) {
      sparks.current.visible=activity==='completed';
      sparks.current.children.forEach((spark,i)=>{
        const theta=t*.7+i*Math.PI*.5;
        spark.position.set(Math.cos(theta)*.54,1.55+(Math.sin(t*2+i)+1)*.23,Math.sin(theta)*.54);
        spark.rotation.y=t+i;
      });
    }
  });
  const tone=STATE_COLORS[state]||STATE_COLORS.idle;
  const showBubble=!!bubble?.label&&!dimmed&&!hovered;
  return <group ref={root} position={[initial[0],0,initial[1]]} dispose={null}
    onClick={event=>{event.stopPropagation();if(!dimmed) onSelect?.(id);}}
    onPointerOver={event=>{event.stopPropagation();setHovered(true);}}
    onPointerOut={()=>setHovered(false)}>
    <mesh ref={ring} geometry={ringGeometry} rotation={[-Math.PI/2,0,0]} position={[0,.045,0]}>
      <meshBasicMaterial color={selected?agent.color||tone:tone} transparent opacity={selected?.45:.09} depthWrite={false}/>
    </mesh>
    <group ref={rig}>
      <Block size={[.47,.52,.29]} position={[0,.79,0]} radius={.16} color={look.jacket} opacity={opacity}/>
      <Block size={[.22,.35,.026]} position={[0,.825,.151]} radius={.035} color={look.shirt} opacity={opacity}/>
      <Block size={[.047,.42,.042]} position={[-.135,.79,.143]} rotation={[0,0,-.16]} color={look.jacket} opacity={opacity}/>
      <Block size={[.047,.42,.042]} position={[.135,.79,.143]} rotation={[0,0,.16]} color={look.jacket} opacity={opacity}/>
      <Block size={[.065,.065,.014]} position={[.17,.86,.155]} radius={.012} color={P.white} opacity={opacity}/>
      <Block size={[.037,.013,.009]} position={[.17,.864,.165]} radius={.002} color={look.jacket} opacity={opacity}/>
      <Ball size={[.085,.105,.080]} position={[0,1.067,0]} color={look.skin} opacity={opacity}/>
      <group ref={head} position={[0,1.325,0]}><Head look={look} opacity={opacity}/></group>
      <Arm side={-1} look={look} armRef={leftArm} elbowRef={leftElbow} opacity={opacity}/>
      <Arm side={1} look={look} armRef={rightArm} elbowRef={rightElbow} opacity={opacity}/>
      <Leg side={-1} look={look} legRef={leftLeg} kneeRef={leftKnee} opacity={opacity}/>
      <Leg side={1} look={look} legRef={rightLeg} kneeRef={rightKnee} opacity={opacity}/>
    </group>
    <group ref={sparks} visible={state==='completed'}>
      {[0,1,2,3].map(i=><mesh key={i} geometry={sparkGeometry} material={material(i%2?P.brass:P.sage)} position={[.4,1.6,0]}/>)}
    </group>
    {labelsReady&&<Html portal={labelPortal} center position={[0,1.94,0]} zIndexRange={[20,10]} style={{pointerEvents:'auto',opacity:dimmed?.35:1}}>
      <button type="button" onClick={event=>{event.stopPropagation();if(!dimmed)onSelect?.(id);}}
        onPointerDown={event=>event.stopPropagation()} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocus={()=>setHovered(true)} onBlur={()=>setHovered(false)} title={`${agent.name || 'Agent'} · ${STATE_LABELS[state]||state}`}
        aria-label={`Pilih ${agent.name || 'agent'}`} data-agent-id={id} style={{display:'flex',alignItems:'center',gap:6,whiteSpace:'nowrap',fontFamily:'inherit',fontSize:11,fontWeight:650,
          color:'#38504a',background:selected?'#ffffff':'rgba(255,253,247,.94)',border:`1px solid ${selected?agent.color||tone:'#dedfd2'}`,borderRadius:20,
          boxShadow:selected?'0 3px 15px #59726025':'0 2px 6px #4c655d12',padding:'5px 9px',cursor:dimmed?'default':'pointer',outlineOffset:3,transition:'border-color .2s,box-shadow .2s'}}>
        <span style={{width:6,height:6,borderRadius:'50%',background:tone,boxShadow:`0 0 0 2px ${tone}16`}}/>
        {agent.name || `Agent ${index+1}`}
      </button>
    </Html>}
    {labelsReady&&hovered&&!dimmed&&<Html portal={labelPortal} center position={[0,2.63,0]} zIndexRange={[28,18]} style={{pointerEvents:'none'}}>
      <div role="tooltip" style={{width:190,fontFamily:'inherit',padding:'10px 12px',borderRadius:12,background:'rgba(255,255,250,.98)',border:'1px solid #dbe3d7',boxShadow:'0 5px 20px #47625420',color:'#41544d'}}>
        <div style={{fontSize:11,fontWeight:700}}>{agent.name} <span style={{float:'right',fontSize:9,fontWeight:500,color:tone}}>{STATE_LABELS[state]||state}</span></div>
        <div style={{fontSize:10,color:'#8a988a',marginTop:3}}>{agent.role}</div>
        <div style={{fontSize:10,lineHeight:1.5,marginTop:7,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{agent.currentTask || 'Tidak ada task aktif'}</div>
      </div>
    </Html>}
    {labelsReady&&showBubble&&<Html portal={labelPortal} center position={[0,2.67,0]} zIndexRange={[25,12]} style={{pointerEvents:'none'}}>
      <div style={{fontFamily:'inherit',width:184,padding:'8px 10px',borderRadius:11,background:'rgba(255,255,251,.97)',border:'1px solid #dfe5d9',boxShadow:'0 5px 17px #47625416',color:'#41544d'}}>
        <div style={{fontSize:10,fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:bubble.kind==='error'?'#af6b58':'#466550'}}>{bubble.label}</div>
        {bubble.snippet&&<div style={{fontSize:10,lineHeight:1.45,marginTop:3,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',color:'#7c8b7e'}}>{bubble.snippet}</div>}
      </div>
      <div style={{margin:'-1px auto 0',width:9,height:9,background:'#fffffb',borderRight:'1px solid #dfe5d9',borderBottom:'1px solid #dfe5d9',transform:'rotate(45deg)'}}/>
    </Html>}
  </group>;
}

export default memo(AgentAvatar);
