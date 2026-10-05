import React, { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Ball, Block, Cylinder, DESK_SLOTS, G, PALETTE as P, material } from './world';

// Bake the architectural model into one draw call per material. Animated details
// and characters stay separate, so the scene retains life without hundreds of draws.
function StaticBatch({ children }) {
  const source = useRef();
  const [batches,setBatches] = useState(null);
  useLayoutEffect(()=>{
    source.current.updateWorldMatrix(true,true);
    const inverse=source.current.matrixWorld.clone().invert(), buckets=new Map();
    source.current.traverse(object=>{
      if(!object.isMesh || Array.isArray(object.material)) return;
      const key=`${object.material.uuid}/${object.castShadow}/${object.receiveShadow}`;
      if(!buckets.has(key)) buckets.set(key,{material:object.material,castShadow:object.castShadow,receiveShadow:object.receiveShadow,parts:[]});
      const geometry=object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      const transform=new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld);
      geometry.applyMatrix4(transform);
      // All primitives deliberately share this position/normal/UV schema.
      Object.keys(geometry.attributes).forEach(key=>{if(!['position','normal','uv'].includes(key)) geometry.deleteAttribute(key);});
      buckets.get(key).parts.push(geometry);
    });
    const merged=[...buckets.values()].map(bucket=>{
      const geometry=mergeGeometries(bucket.parts,false);
      bucket.parts.forEach(part=>part.dispose());
      return {...bucket,geometry};
    }).filter(bucket=>bucket.geometry);
    setBatches(merged);
    return ()=>merged.forEach(bucket=>bucket.geometry.dispose());
  },[]);
  return <group dispose={null}>
    <group ref={source} visible={!batches}>{children}</group>
    {batches?.map((bucket,i)=><mesh key={i} geometry={bucket.geometry} material={bucket.material} castShadow={bucket.castShadow} receiveShadow={bucket.receiveShadow}/>)}
  </group>;
}

function Rug({position,size,color}) {
  return <Block position={[position[0],.012,position[1]]} size={[size[0],.035,size[1]]} radius={.016} color={color} castShadow={false}/>;
}

function TableLeg({x,z,height=.83,color=P.white}) {
  return <group position={[x,height/2,z]}>
    <Block size={[.11,height,.11]} radius={.025} color={color}/>
    <Block position={[0,-height/2+.04,0]} size={[.38,.07,.32]} color={color}/>
  </group>;
}

function Cup({position,color=P.clay}) {
  return <group position={position}>
    <Cylinder size={[.092,.17,.092]} position={[0,.085,0]} color={color}/>
    <Cylinder size={[.071,.008,.071]} position={[0,.173,0]} color="#755640" castShadow={false}/>
    <mesh geometry={G.torus} material={material(color)} scale={[.065,.065,.065]} position={[.09,.10,0]} castShadow/>
  </group>;
}

function Chair({position,rotation=0,color=P.sage}) {
  return <group position={position} rotation={[0,rotation,0]}>
    <Cylinder size={[.05,.4,.05]} position={[0,.23,0]} color={P.gray}/>
    <Block size={[.63,.14,.65]} position={[0,.48,0]} color={color} radius={.1}/>
    <Block size={[.62,.59,.13]} position={[0,.80,.27]} rotation={[-.08,0,0]} color={color} radius={.09}/>
    <Block size={[.8,.05,.065]} position={[0,.045,0]} color={P.gray}/>
    <Block size={[.065,.05,.8]} position={[0,.045,0]} color={P.gray}/>
    {[-1,1].map(side=><Block key={side} size={[.065,.23,.31]} position={[side*.35,.64,.02]} color={P.oakLight}/>) }
  </group>;
}

function Monitor({position,rotation=0,width=.93,accent=P.blue}) {
  return <group position={position} rotation={[0,rotation,0]}>
    <Block size={[.37,.05,.26]} position={[0,.025,.01]} color={P.gray}/>
    <Block size={[.055,.25,.055]} position={[0,.15,.02]} color={P.gray}/>
    <Block size={[width,.58,.075]} position={[0,.56,0]} radius={.035} color={P.ink}/>
    <Block size={[width-.075,.49,.009]} position={[0,.56,.041]} radius={.018} color="#dcefeb" castShadow={false}/>
    <Block size={[.12,.40,.014]} position={[-width/2+.12,.57,.050]} radius={.006} color={accent} castShadow={false}/>
    <Block size={[width*.48,.035,.014]} position={[.055,.70,.052]} radius={.007} color="#8aafa3" castShadow={false}/>
    {[0,1,2].map(i=><Block key={i} size={[width*(.49-i*.09),.023,.014]} position={[.025-i*.04,.60-i*.063,.052]} radius={.005} color={i===1?accent:'#b1cbc0'} castShadow={false}/>) }
    <Block size={[.24,.082,.014]} position={[.11,.385,.052]} radius={.009} color={accent} castShadow={false}/>
  </group>;
}

function Desk({slot,index}) {
  const [x,z]=slot, accent=[P.sage,P.blue,P.clay,'#c6b0ce',P.brass][index];
  return <group position={[x,0,z-.76]}>
    <Block size={[2.4,.14,1.12]} position={[0,.9,0]} radius={.095} color={P.oakLight}/>
    <TableLeg x={-.92} z={-.33}/><TableLeg x={.92} z={-.33}/>
    <TableLeg x={-.92} z={.34}/><TableLeg x={.92} z={.34}/>
    <Block size={[.61,.63,.62]} position={[-.81,.4,-.05]} radius={.055} color={P.white}/>
    {[.31,.50].map(y=><Block key={y} size={[.22,.023,.025]} position={[-.81,y,.272]} color={P.oak}/>) }
    <Monitor position={[-.18,.977,-.28]} accent={accent}/>
    <Block size={[.67,.035,.245]} position={[-.12,.99,.29]} radius={.024} color={P.gray}/>
    {[0,1,2].map(i=><Block key={i} size={[.57,.009,.018]} position={[-.12,1.012,.22+i*.06]} radius={.003} color={P.white} castShadow={false}/>) }
    <Block size={[.14,.036,.2]} position={[.42,.99,.28]} color={accent}/>
    <Block size={[.39,.025,.52]} position={[.78,.99,.16]} rotation={[0,.12,0]} color={accent}/>
    <Block size={[.33,.012,.43]} position={[.78,1.008,.16]} rotation={[0,.12,0]} color={P.white}/>
    <Cup position={[.78,.98,-.31]} color={accent}/>
    <Block size={[.14,.12,.15]} position={[-.95,1.027,-.34]} color={accent}/>
    {[0,1,2].map(i=><Cylinder key={i} size={[.011,.24,.011]} position={[-.99+i*.037,1.17,-.34]} rotation={[0,0,(i-1)*.08]} color={i===1?P.brass:P.ink}/>) }
    <Chair position={[0,0,.92]} color={accent}/>
  </group>;
}

function Bookcase() {
  const bookColors=[P.sage,P.clay,P.blue,P.brass,'#c6b0ce','#e5c6a9'];
  return <group position={[-3.7,0,-6.72]}>
    <Block size={[4.35,2.17,.5]} position={[0,1.08,-.12]} color={P.oakLight}/>
    <Block size={[4.1,1.98,.045]} position={[0,1.09,.145]} color={P.cream}/>
    {[.10,.75,1.4,2.05].map(y=><Block key={y} size={[4.4,.065,.58]} position={[0,y,.04]} color={P.oak}/>) }
    {[-2.16,-.72,.72,2.16].map(x=><Block key={x} size={[.067,2.1,.57]} position={[x,1.08,.02]} color={P.oak}/>) }
    {[0,1,2].flatMap(row=>Array.from({length:21},(_,i)=>{
      const height=.28+(i*7+row*3)%5*.056;
      return <Block key={`${row}-${i}`} size={[.105+(i%3)*.018,height,.29]} position={[-2+i*.198,row*.65+.15+height/2,.09]} rotation={[0,0,i%9===0?.14:0]} color={bookColors[(i+row)%bookColors.length]} radius={.009}/>;
    }))}
    <Block size={[.49,.05,.30]} position={[1.1,2.12,.03]} color={P.clay}/>
    <Block size={[.44,.04,.31]} position={[1.1,2.16,.03]} color={P.blue}/>
    <Ball size={[.15,.14,.14]} position={[-.75,2.20,0]} color={P.brass}/>
  </group>;
}

function MeetingRoom() {
  const glass=material(P.glass,{transparent:true,opacity:.16,roughness:.2,metalness:.03,depthWrite:false});
  return <group>
    <Rug position={[6,-4.95]} size={[5.2,3.25]} color={P.blueLight}/>
    <Block size={[5.2,.08,.055]} position={[5.9,.08,-6.6]} color={P.sage}/>
    <Block size={[.05,2.5,3.45]} position={[3.28,1.25,-4.9]} radius={.005} material={glass} castShadow={false}/>
    <Block size={[5.25,2.5,.05]} position={[5.9,1.25,-6.6]} radius={.005} material={glass} castShadow={false}/>
    <Block size={[.05,2.5,2.13]} position={[8.5,1.25,-5.55]} radius={.005} material={glass} castShadow={false}/>
    {[3.25,5.85,8.5].map(x=><Block key={x} size={[.055,2.55,.055]} position={[x,1.28,-6.61]} color={P.sage}/>) }
    {[-6.61,-3.2].map(z=><Block key={z} size={[.055,2.55,.055]} position={[3.25,1.28,z]} color={P.sage}/>) }
    <Block size={[5.3,.055,.075]} position={[5.88,2.55,-6.6]} color={P.sage}/>
    <Block size={[.075,.055,3.5]} position={[3.25,2.55,-4.91]} color={P.sage}/>
    <Block size={[.055,.055,2.2]} position={[8.5,2.55,-5.55]} color={P.sage}/>
    <Block size={[2.95,.15,1.2]} position={[5.9,.84,-5.1]} radius={.26} color={P.oakLight}/>
    <Cylinder size={[.17,.78,.17]} position={[5.05,.4,-5.1]} color={P.white}/>
    <Cylinder size={[.17,.78,.17]} position={[6.75,.4,-5.1]} color={P.white}/>
    {[4.95,5.95,6.95].map((x,i)=><Chair key={`near${i}`} position={[x,0,-3.93]} color={P.blue}/>) }
    {[4.95,5.95,6.95].map((x,i)=><Chair key={`far${i}`} position={[x,0,-6.15]} rotation={Math.PI} color={P.blue}/>) }
    <Block size={[.55,.035,.38]} position={[5.3,.939,-5.0]} color={P.ink}/>
    <Block size={[.55,.40,.03]} position={[5.3,1.12,-5.19]} rotation={[-.18,0,0]} color={P.gray}/>
    <Block size={[.47,.31,.018]} position={[5.3,1.13,-5.165]} rotation={[-.18,0,0]} color={P.blueLight}/>
    <Cup position={[6.55,.93,-5.07]} color={P.blue}/>
    <Block size={[.44,.015,.31]} position={[6,.93,-5.15]} rotation={[0,.12,0]} color={P.white}/>
    <Block size={[1.62,.90,.055]} position={[5.8,1.82,-6.49]} color={P.white}/>
    <Block size={[1.48,.77,.021]} position={[5.8,1.82,-6.45]} color={P.cream}/>
    {[0,1,2].map(i=><Block key={i} size={[.21,.16,.025]} position={[5.34+i*.43,1.88,-6.43]} radius={.015} color={[P.clay,P.sage,P.blue][i]}/>) }
    <Block size={[.81,.022,.025]} position={[5.8,1.58,-6.43]} color={P.gray}/>
  </group>;
}

function FocusRoom() {
  return <group position={[-8.2,0,-4.8]}>
    <Rug position={[0,0]} size={[3.65,3.23]} color={P.sageLight}/>
    <Block size={[.16,1.55,3.1]} position={[-1.6,.775,-.07]} color={P.sageLight} radius={.07}/>
    <Block size={[3.35,1.55,.16]} position={[0,.775,-1.55]} color={P.sageLight} radius={.07}/>
    <Block size={[.16,1.55,1.75]} position={[1.65,.775,-.68]} color={P.sageLight} radius={.07}/>
    <Block size={[.02,1.05,2.88]} position={[-1.51,.82,-.12]} color={P.sage} radius={.005}/>
    <Block size={[1.95,.14,.78]} position={[-.19,.9,-.69]} color={P.oakLight}/>
    <TableLeg x={-.99} z={-.68}/><TableLeg x={.62} z={-.68}/>
    <Monitor position={[-.28,.98,-.83]} width={.81} accent={P.sage}/>
    <Block size={[.57,.028,.2]} position={[-.28,.99,-.40]} color={P.gray}/>
    <Chair position={[.2,0,.90]} color={P.sage}/>
    <Block size={[.035,.55,.035]} position={[.63,1.19,-.97]} color={P.brass}/>
    <Ball size={[.18,.1,.18]} position={[.63,1.46,-.97]} color={P.white}/>
  </group>;
}

function ServerRoom() {
  return <group position={[9.57,0,-5.55]}>
    <Rug position={[0,0]} size={[2.02,2.1]} color="#e2e6e2"/>
    <Block size={[1.0,1.93,.63]} position={[.16,.99,-.48]} color={P.ink} radius={.075}/>
    <Block size={[.86,1.79,.06]} position={[.16,1.0,-.13]} color="#728982" radius={.035}/>
    {[0,1,2,3,4,5].map(i=><group key={i}>
      <Block size={[.73,.22,.07]} position={[.16,.27+i*.28,-.09]} color="#425c56" radius={.012}/>
      <Block size={[.36,.013,.012]} position={[.19,.30+i*.28,-.045]} color="#6d8980" radius={.004}/>
      <Block size={[.36,.013,.012]} position={[.19,.25+i*.28,-.045]} color="#6d8980" radius={.004}/>
    </group>) }
    <Block size={[.39,.055,.37]} position={[-.54,.95,.57]} color={P.oakLight}/>
    <Block size={[.07,.94,.07]} position={[-.54,.47,.57]} color={P.gray}/>
    <Block size={[.35,.025,.23]} position={[-.54,1,.57]} color={P.ink}/>
    <Block size={[.35,.27,.025]} position={[-.54,1.13,.45]} rotation={[-.14,0,0]} color={P.ink}/>
    <Block size={[.28,.20,.018]} position={[-.54,1.13,.474]} rotation={[-.14,0,0]} color={P.sage}/>
  </group>;
}

function ResearchCorner() {
  return <group position={[9.05,0,.1]}>
    <Rug position={[0,0]} size={[2.65,3.35]} color={P.peach}/>
    <Block size={[.90,.14,2.6]} position={[.43,.91,0]} color={P.oakLight}/>
    {[-1,1].map(i=><Block key={i} size={[.75,.84,.10]} position={[.45,.43,i*1.1]} color={P.white}/>) }
    <Monitor position={[.50,1,-.50]} rotation={-Math.PI/2} width={.82} accent={P.clay}/>
    <Block size={[.26,.03,.58]} position={[.22,1,-.50]} color={P.gray}/>
    <Block size={[.50,.05,.66]} position={[.43,1,.56]} rotation={[0,.1,0]} color={P.blue}/>
    <Block size={[.45,.025,.61]} position={[.43,1.045,.56]} rotation={[0,.1,0]} color={P.white}/>
    <Cup position={[.61,1,1.05]} color={P.clay}/>
    <Chair position={[-1.05,0,-.10]} rotation={Math.PI/2} color={P.clay}/>
    <Block size={[.07,1.45,1.75]} position={[1.15,1.74,-.10]} color={P.oak}/>
    <Block size={[.02,1.3,1.60]} position={[1.10,1.74,-.10]} color={P.cream}/>
    {[-.5,0,.5].flatMap((z,i)=>[0,1].map(j=><Block key={`${i}-${j}`} size={[.028,.24,.25]} position={[1.08,1.5+j*.43,z]} color={[P.sage,P.clay,P.blue][(i+j)%3]} radius={.01}/>)) }
  </group>;
}

function Sofa({position,rotation=0,color=P.sage}) {
  return <group position={position} rotation={[0,rotation,0]}>
    <Block size={[2.6,.48,.86]} position={[0,.38,0]} radius={.14} color={color}/>
    <Block size={[2.65,.77,.26]} position={[0,.81,-.37]} radius={.13} color={color}/>
    {[-1,1].map(i=><Block key={i} size={[.30,.64,.9]} position={[i*1.25,.68,0]} radius={.12} color={color}/>) }
    {[-.7,0,.7].map(x=><Block key={x} size={[.65,.14,.62]} position={[x,.67,.06]} radius={.09} color={P.sageLight}/>) }
    <Block size={[.49,.42,.13]} position={[-.81,.94,-.16]} rotation={[0,0,.12]} radius={.09} color={P.peach}/>
    <Block size={[.39,.36,.13]} position={[.87,.91,-.16]} rotation={[0,0,-.12]} radius={.08} color={P.blueLight}/>
    {[-1,1].flatMap(x=>[-1,1].map(z=><Cylinder key={`${x}${z}`} size={[.07,.17,.07]} position={[x*1.02,.10,z*.28]} color={P.oak}/>) )}
  </group>;
}

function Lounge() {
  return <group>
    <Rug position={[-8.2,.22]} size={[4.35,3.42]} color="#e9e4d5"/>
    <Sofa position={[-9.37,0,.18]} rotation={Math.PI/2}/>
    <Cylinder size={[.58,.08,.58]} position={[-7.3,.58,.98]} color={P.oakLight}/>
    <Cylinder size={[.07,.54,.07]} position={[-7.3,.29,.98]} color={P.oak}/>
    <Block size={[.33,.035,.44]} position={[-7.27,.64,1.02]} rotation={[0,.15,0]} color={P.clay}/>
    <Block size={[.29,.025,.42]} position={[-7.27,.675,1.02]} rotation={[0,-.08,0]} color={P.blue}/>
    <Cup position={[-7.49,.63,.71]} color={P.sage}/>
    <Cylinder size={[.34,.1,.34]} position={[-9.94,.06,-1.3]} color={P.brass}/>
    <Cylinder size={[.025,2.2,.025]} position={[-9.94,1.15,-1.3]} color={P.brass}/>
    <mesh geometry={G.cone} scale={[.47,.46,.47]} position={[-9.94,2.24,-1.3]} rotation={[Math.PI,0,0]} material={material(P.white)} castShadow/>
    <Ball size={[.14,.10,.14]} position={[-9.94,2.15,-1.3]} color="#fff1c9"/>
    <Block size={[1.2,.73,.63]} position={[-9.42,.44,1.86]} color={P.clay} radius={.13}/>
    <Block size={[.94,.12,.64]} position={[-9.42,.85,1.83]} color={P.peach} radius={.07}/>
  </group>;
}

function Pantry() {
  return <group position={[-8.9,0,4.75]}>
    <Rug position={[0,0]} size={[3.65,3.1]} color={P.blueLight}/>
    <Block size={[.88,.9,2.65]} position={[-.95,.46,0]} color={P.sageLight}/>
    <Block size={[1.01,.1,2.82]} position={[-.95,.96,0]} color={P.oakLight}/>
    {[-.91,0,.91].map(z=><Block key={z} size={[.025,.71,.77]} position={[-.492,.48,z]} color={P.sage}/>) }
    <Block size={[.55,.54,.51]} position={[-.95,1.26,-.82]} color={P.ink}/>
    <Block size={[.026,.40,.37]} position={[-.66,1.27,-.82]} color={P.gray}/>
    <Cylinder size={[.055,.025,.055]} position={[-.64,1.35,-.72]} rotation={[0,0,Math.PI/2]} color={P.brass}/>
    <Block size={[.14,.055,.41]} position={[-.57,1.04,-.82]} color={P.gray}/>
    <Cup position={[-.57,1.065,-.81]} color={P.white}/>
    <Block size={[.48,.04,.5]} position={[-.95,1.03,.30]} color={P.gray}/>
    <Block size={[.35,.04,.36]} position={[-.95,1.05,.30]} color={P.ink}/>
    <Cylinder size={[.023,.4,.023]} position={[-1.17,1.25,.29]} color={P.brass}/>
    <Cylinder size={[.018,.22,.018]} position={[-1.07,1.44,.29]} rotation={[0,0,Math.PI/2]} color={P.brass}/>
    <Cylinder size={[.11,.008,.11]} position={[-.84,1.03,1.02]} color={P.white}/>
    <Ball size={[.07,.06,.07]} position={[-.84,1.08,1.02]} color={P.clay}/>
    <Block size={[.80,1.70,.81]} position={[-.60,.86,1.85]} color={P.white}/>
    <Block size={[.025,.41,.032]} position={[-.17,1.16,1.62]} color={P.gray}/>
    <Block size={[.025,.22,.032]} position={[-.17,.54,1.62]} color={P.gray}/>
    <Cylinder size={[.58,.09,.58]} position={[.69,.9,.43]} color={P.oakLight}/>
    <Cylinder size={[.08,.85,.08]} position={[.69,.45,.43]} color={P.white}/>
    <Chair position={[1.37,0,1.18]} rotation={-.7} color={P.blue}/>
    <Cup position={[.69,.95,.43]} color={P.clay}/>
  </group>;
}

function Reception() {
  return <group position={[0,0,6.83]}>
    <Rug position={[0,-.10]} size={[4.7,1.75]} color="#e5ece3"/>
    <Block size={[3.12,.87,.75]} position={[0,.44,.04]} color={P.sageLight} radius={.23}/>
    <Block size={[3.25,.12,.90]} position={[0,.93,.04]} color={P.oakLight} radius={.19}/>
    {Array.from({length:13},(_,i)=><Block key={i} size={[.028,.59,.027]} position={[-1.32+i*.22,.48,.417]} color={P.sage}/>) }
    <Block size={[.38,.055,.29]} position={[-.54,1.02,-.12]} color={P.ink}/>
    <Block size={[.42,.31,.035]} position={[-.54,1.18,-.24]} rotation={[-.1,0,0]} color={P.gray}/>
    <Block size={[.34,.24,.022]} position={[-.54,1.18,-.214]} rotation={[-.1,0,0]} color={P.blueLight}/>
    <Block size={[.44,.035,.31]} position={[.63,1.005,.12]} color={P.clay}/>
    <Block size={[.38,.025,.28]} position={[.63,1.04,.12]} color={P.white}/>
    <Cylinder size={[.06,.06,.06]} position={[1.13,1.03,.14]} color={P.brass}/>
    <Ball size={[.08,.04,.08]} position={[1.13,1.08,.14]} color={P.brass}/>
  </group>;
}

function Garden() {
  return <group>
    <Rug position={[8.3,5.27]} size={[4.35,3.48]} color={P.sageLight}/>
    <Block size={[2.67,.16,.72]} position={[8.13,.49,6.51]} color={P.oakLight} radius={.065}/>
    <Block size={[2.64,.49,.1]} position={[8.13,.82,6.81]} color={P.oak} radius={.025}/>
    {[-1,1].map(i=><Block key={i} size={[.12,.44,.58]} position={[8.13+i*1.02,.23,6.51]} color={P.white}/>) }
    <Block size={[.51,.33,.12]} position={[7.47,.77,6.71]} color={P.blueLight} radius={.055}/>
    <Block size={[.51,.33,.12]} position={[8.83,.77,6.71]} color={P.peach} radius={.055}/>
    <Block size={[.53,.05,.58]} position={[9.74,.6,4.85]} color={P.oakLight}/>
    <Cylinder size={[.055,.55,.055]} position={[9.74,.30,4.85]} color={P.oak}/>
    <Block size={[.25,.035,.34]} position={[9.72,.65,4.85]} color={P.blue}/>
    <Cup position={[9.9,.64,4.77]} color={P.sage}/>
    {[0,1,2,3].map(i=><Cylinder key={i} size={[.20,.018,.15]} position={[6.76+i*.49,.05,5.72+(i%2)*.12]} color="#bbc7b2"/>) }
  </group>;
}

function Architecture() {
  return <group>
    <Block size={[22.4,.52,15.4]} position={[0,-.30,0]} radius={.25} color="#d6c8b2"/>
    <Block size={[22.2,.12,15.2]} position={[0,-.035,0]} radius={.06} color={P.cream} castShadow={false}/>
    {Array.from({length:24},(_,i)=><Block key={i} size={[.018,.009,14.92]} position={[-10.73+i*.932,.032,0]} radius={.002} color="#e5dfd0" castShadow={false}/>) }
    <Block size={[22.2,2.65,.20]} position={[0,1.3,-7.50]} radius={.07} color={P.wall}/>
    <Block size={[.20,1.1,15.2]} position={[-11.05,.525,0]} radius={.055} color={P.wall}/>
    <Block size={[.20,.57,15.2]} position={[11.05,.26,0]} radius={.055} color={P.wall}/>
    <Block size={[22.16,.13,.27]} position={[0,2.65,-7.50]} color={P.oakLight}/>
    <Block size={[.27,.10,15.18]} position={[-11.05,1.11,0]} color={P.oakLight}/>
    <Block size={[.27,.10,15.18]} position={[11.05,.59,0]} color={P.oakLight}/>
    <Rug position={[0,-.55]} size={[13.7,8.9]} color="#eee8dc"/>
    <Block size={[.55,.019,2.6]} position={[0,.053,4.9]} color={P.oakLight} castShadow={false}/>
    <Block size={[.55,.019,1.1]} position={[0,.053,.05]} color={P.oakLight} castShadow={false}/>
    {/* Three tall windows, lit with sky-colored panes and oak mullions. */}
    {[-8.4,-.2,9.35].map((x,i)=><group key={x} position={[x,1.76,-7.36]}>
      <Block size={[i===1?3.75:2.2,1.21,.075]} color={P.oakLight}/>
      <Block size={[i===1?3.54:2.0,1.03,.025]} position={[0,0,.051]} color={P.blueLight}/>
      <Block size={[.055,1.05,.06]} position={[0,0,.085]} color={P.white}/>
      <Block size={[i===1?3.55:2.05,.055,.06]} position={[0,0,.085]} color={P.white}/>
      <Block size={[i===1?3.83:2.26,.075,.3]} position={[0,-.64,.08]} color={P.oakLight}/>
    </group>) }
    {[-5.25,2.12].map((x,i)=><group key={x} position={[x,1.77,-7.33]}>
      <Block size={[.85,1.04,.065]} color={P.oak}/>
      <Block size={[.73,.92,.022]} position={[0,0,.05]} color={i?P.blueLight:P.peach}/>
      <Ball size={[.24,.30,.022]} position={[-.08,-.12,.069]} color={i?P.sage:P.clay} castShadow={false}/>
      <Ball size={[.14,.14,.021]} position={[.16,.19,.070]} color={i?P.brass:P.oakLight} castShadow={false}/>
    </group>) }
    {/* Ceiling pendants are sparse enough to preserve the cutaway view. */}
    {[-4,0,4].map((x,i)=><group key={x} position={[x,0,-1.85]}>
      <Cylinder size={[.012,.45,.012]} position={[0,3.75,0]} color={P.brass}/>
      <Cylinder size={[.41,.055,.41]} position={[0,3.51,0]} color={P.brass}/>
      <Ball size={[.37,.20,.37]} position={[0,3.39,0]} color="#fff9e8"/>
    </group>) }
    <Cylinder size={[.045,.05,.045]} position={[2.0,1.03,2.17]} color={P.brass}/>
  </group>;
}

const PLANTS = [
  {p:[-10.12,0,-6.60],s:1.15}, {p:[-5.75,0,-6.35],s:.68}, {p:[2.6,0,-6.7],s:.86},
  {p:[10.05,0,-2.38],s:.78}, {p:[-6.45,0,1.94],s:.74}, {p:[5.97,0,2.13],s:.75},
  {p:[-10.10,0,2.69],s:.77}, {p:[-4.3,0,6.55],s:.75}, {p:[4.5,0,6.61],s:.80},
  {p:[10.1,0,6.56],s:1.18}, {p:[10.03,0,3.43],s:1.05}, {p:[6.53,0,3.18],s:.69},
];

function Plant({position,scale=1,index=0,paused}) {
  const crown=useRef(), leaves=useRef();
  const dummy=useMemo(()=>new THREE.Object3D(),[]);
  useLayoutEffect(()=>{
    for(let i=0;i<14;i++) {
      const turn=i*2.399, level=.31+(i%4)*.20;
      const radius=.17+(i%3)*.06;
      dummy.position.set(Math.cos(turn)*radius,level,Math.sin(turn)*radius);
      dummy.rotation.set(.5+Math.cos(turn)*.6,turn,.28+Math.sin(turn)*.6);
      dummy.scale.set(.13,.31,.067); dummy.updateMatrix();
      leaves.current.setMatrixAt(i,dummy.matrix);
      leaves.current.setColorAt(i,new THREE.Color([P.sage,P.pine,'#6d9876'][i%3]));
    }
    leaves.current.instanceMatrix.needsUpdate=true;
    leaves.current.instanceColor.needsUpdate=true;
  },[dummy]);
  useFrame(({clock})=>{ if(crown.current&&!paused) crown.current.rotation.z=Math.sin(clock.elapsedTime*.65+index)*.022; });
  return <group position={position} scale={scale} dispose={null}>
    <group ref={crown} position={[0,.39,0]}>
      <Cylinder size={[.022,.87,.022]} position={[0,.39,0]} color={P.pine}/>
      <instancedMesh ref={leaves} args={[G.sphere,material('#ffffff'),14]} castShadow receiveShadow/>
    </group>
  </group>;
}

function AmbientDetails({paused}) {
  const serverLights=useRef(), coffee=useRef(), monitors=useRef();
  useFrame(({clock})=>{
    if(paused) return;
    const t=clock.elapsedTime;
    if(serverLights.current) serverLights.current.children.forEach((light,i)=>{ light.material.opacity=.32+(.5+.5*Math.sin(t*2.1+i*2.7))*.65; });
    if(coffee.current) coffee.current.children.forEach((puff,i)=>{ puff.position.y=.10+((t*.13+i*.14)%.45); puff.position.x=Math.sin(t*.6+i)*.022; puff.material.opacity=.23*(1-(puff.position.y-.10)/.45); });
    if(monitors.current) monitors.current.children.forEach((screen,i)=>{screen.scale.x=.22*(.72+.28*Math.sin(t*.8+i*.81));});
  });
  return <group dispose={null}>
    {PLANTS.map(({p,s},i)=><Plant key={i} position={p} scale={s} index={i} paused={paused}/>)}
    <group ref={serverLights}>
      {[0,1,2,3,4,5].map(i=><mesh key={i} geometry={G.sphere} position={[9.45,.27+i*.28,-5.593]} scale={[.029,.029,.015]}>
        <meshBasicMaterial color={i===3?P.blue:'#a9efc5'} transparent opacity={.75}/>
      </mesh>)}
    </group>
    <group ref={coffee} position={[-9.47,1.30,3.94]}>
      {[0,1,2].map(i=><mesh key={i} geometry={G.sphere} scale={[.032,.068,.032]} position={[0,.1+i*.15,0]}>
        <meshBasicMaterial color="#ffffff" transparent opacity={.14} depthWrite={false}/>
      </mesh>)}
    </group>
    <group ref={monitors}>
      {DESK_SLOTS.map(([x,z],i)=><mesh key={i} geometry={G.plane} position={[x-.07,1.362,z-.986]} scale={[.22,.012,1]}>
        <meshBasicMaterial color={P.sage}/>
      </mesh>)}
    </group>
  </group>;
}

function OfficeEnvironment({motionPaused=false}) {
  return <group dispose={null}>
    <StaticBatch>
      <Architecture/>
      {DESK_SLOTS.map((slot,index)=><Desk key={index} slot={slot} index={index}/>)}
      <MeetingRoom/><FocusRoom/><Bookcase/><ServerRoom/><ResearchCorner/>
      <Lounge/><Pantry/><Reception/><Garden/>
      {PLANTS.map(({p,s},i)=><group key={i} position={p} scale={s}>
        <Cylinder size={[.28,.43,.28]} position={[0,.215,0]} color={i%3===1?P.clay:P.white}/>
        <Cylinder size={[.24,.017,.24]} position={[0,.44,0]} color="#8c745a"/>
      </group>)}
    </StaticBatch>
    <AmbientDetails paused={motionPaused}/>
  </group>;
}

export default memo(OfficeEnvironment);
