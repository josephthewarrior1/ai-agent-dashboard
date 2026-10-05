import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import OfficeEnvironment from './OfficeEnvironment';
import AgentAvatar from './AgentAvatar';
import { DESK_SLOTS, PALETTE, matchesFilter } from './world';

export { DESK_SLOTS, OFFICE_GOALS, makeRoute, point2 } from './world';

class SceneBoundary extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(error){console.warn('Hermes office rendering unavailable:',error.message);}
  render(){return this.state.failed ? this.props.fallback : this.props.children;}
}

function FallbackOffice({agents,onSelect}) {
  return <div style={{width:'100%',height:'100%',minHeight:300,display:'grid',placeItems:'center',background:'#e9eee6',fontFamily:'inherit',color:'#607163'}}>
    <div style={{width:'min(80%,960px)',position:'relative'}}>
      <svg viewBox="0 0 800 460" style={{width:'100%',filter:'drop-shadow(0 15px 25px #788d6b16)'}} aria-label="Office floor plan">
        <rect x="10" y="10" width="780" height="435" rx="22" fill="#faf8ef" stroke="#d1cdbd" strokeWidth="6"/>
        <rect x="33" y="31" width="123" height="110" rx="12" fill="#dce7d9"/>
        <rect x="175" y="30" width="174" height="53" rx="9" fill="#e8cfac"/>
        <rect x="508" y="30" width="184" height="107" rx="12" fill="#dce9ed"/>
        <rect x="714" y="30" width="52" height="105" rx="9" fill="#91a7a0"/>
        <rect x="34" y="175" width="104" height="95" rx="20" fill="#97b4a0"/>
        <rect x="34" y="324" width="123" height="94" rx="12" fill="#dce9ed"/>
        <rect x="694" y="177" width="73" height="95" rx="12" fill="#f5d9c4"/>
        <rect x="624" y="322" width="143" height="95" rx="16" fill="#dce7d9"/>
        <rect x="334" y="377" width="143" height="36" rx="14" fill="#97b4a0"/>
        {[[-4,-1.8],[0,-1.8],[4,-1.8],[-2,2.5],[2,2.5]].map(([x,z],i)=><g key={i}>
          <rect x={396+x*25-37} y={211+z*23-29} width="75" height="34" rx="6" fill="#e8cfac"/>
          <rect x={396+x*25-14} y={211+z*23-24} width="29" height="17" rx="3" fill="#8ba9a3"/>
        </g>)}
        {agents.map((agent,i)=>{
          const [x,z]=DESK_SLOTS[i%5];
          return <g key={agent.id||i} onClick={()=>onSelect?.(agent.id)} style={{cursor:'pointer'}}>
            <circle cx={396+x*25} cy={221+z*23} r="12" fill={agent.color||['#d79279','#97b4a0','#94b9cc','#b6a0c4','#d3b271'][i%5]}/>
            <text x={396+x*25} y={249+z*23} textAnchor="middle" fontSize="12" fill="#46604f">{agent.name}</text>
          </g>;
        })}
      </svg>
      <p style={{textAlign:'center',fontSize:12,margin:'14px 0'}}>3D is unavailable in this browser. You can still select an agent to inspect their activity.</p>
    </div>
  </div>;
}

function CameraRig({viewMode,cameraCommand,positions}) {
  const controls=useRef(), transition=useRef(null),lastCommand=useRef(null),interacted=useRef(false);
  const {camera,size}=useThree();
  const isTop=viewMode==='2d';
  const reset=()=>{
    const zoom=Math.min(size.width/(isTop?25:28),size.height/(isTop?18.2:20.4));
    transition.current={position:new THREE.Vector3(...(isTop?[0,32,.025]:[21,24,27])),target:new THREE.Vector3(0,.55,0),zoom:Math.max(zoom,14)};
  };
  useEffect(()=>{interacted.current=false;reset();},[viewMode]);
  useEffect(()=>{if(!interacted.current)reset();},[size.width,size.height]);
  useEffect(()=>{
    if(!cameraCommand || lastCommand.current===cameraCommand.id) return;
    lastCommand.current=cameraCommand.id;
    const type=cameraCommand.type;
    if(type==='reset'){interacted.current=false;reset();return;}
    interacted.current=true;
    if(type==='zoomIn'||type==='zoomOut') {
      transition.current={position:camera.position.clone(),target:controls.current.target.clone(),zoom:THREE.MathUtils.clamp(camera.zoom*(type==='zoomIn'?1.25:.8),12,110)};
    } else if(type==='focus') {
      const agentPosition=positions.get(cameraCommand.agentId);
      if(!agentPosition)return;
      const target=agentPosition.clone();target.y=.80;
      const direction=isTop?new THREE.Vector3(0,32,.025):new THREE.Vector3(15,18,20);
      const zoom=Math.max(52,Math.min(76,Math.min(size.width/15,size.height/10)));
      if(size.width<680) {
        const forward=direction.clone().normalize();
        const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),forward).normalize();
        const up=new THREE.Vector3().crossVectors(forward,right).normalize();
        target.addScaledVector(up,-size.height*.20/zoom);
      }
      transition.current={position:target.clone().add(direction),target,zoom};
    }
  },[cameraCommand,viewMode]);
  useFrame((_,delta)=>{
    const current=transition.current;
    if(!current||!controls.current)return;
    const amount=1-Math.exp(-delta*4.3);
    camera.position.lerp(current.position,amount);
    controls.current.target.lerp(current.target,amount);
    camera.zoom=THREE.MathUtils.lerp(camera.zoom,current.zoom,amount);
    camera.updateProjectionMatrix();
    controls.current.update();
    if(camera.position.distanceTo(current.position)<.006&&Math.abs(camera.zoom-current.zoom)<.015) transition.current=null;
  });
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.085} enableRotate={!isTop} enablePan enableZoom
    zoomSpeed={.75} panSpeed={.72} rotateSpeed={.46} minZoom={12} maxZoom={110}
    minPolarAngle={isTop?.001:.16} maxPolarAngle={isTop?.001:Math.PI/2.13}
    target={[0,.55,0]} mouseButtons={{LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN}}
    onStart={()=>{transition.current=null;interacted.current=true;}}/>
}

function FrameMeter({onPerformance}) {
  const {gl,setDpr}=useThree();
  const callback=useRef(onPerformance),samples=useRef({time:0,frames:0,warm:0,slow:0});
  useEffect(()=>{callback.current=onPerformance;},[onPerformance]);
  useFrame((_,delta)=>{
    const sample=samples.current;
    sample.warm+=delta;
    // Discard model construction and a returning background-tab frame.
    if(sample.warm<2||delta>.4) return;
    sample.time+=delta;sample.frames++;
    if(sample.time<2) return;
    const fps=Math.round(sample.frames/sample.time);
    callback.current?.({fps,drawCalls:gl.info.render.calls,triangles:gl.info.render.triangles,dpr:gl.getPixelRatio()});
    if(fps<34) sample.slow++;else sample.slow=0;
    if(sample.slow>=2&&gl.getPixelRatio()>1) {setDpr(1);sample.slow=0;}
    sample.time=0;sample.frames=0;
  });
  return null;
}

function SceneContent({agents,selectedId,onSelect,onAgentArrived,filter,viewMode,cameraCommand,motionPaused,bubbles,onPerformance,labelPortal}) {
  const positions=useMemo(()=>new Map(),[]);
  return <>
    <color attach="background" args={['#e9eee6']}/>
    <OrthographicCamera makeDefault position={[21,24,27]} near={.1} far={110} zoom={34}/>
    <ambientLight intensity={.48}/>
    <hemisphereLight args={['#fffdf4','#c5d0be',.8]}/>
    <directionalLight position={[-7,17,9]} color="#fff2d7" intensity={1.95} castShadow shadow-mapSize={[1024,1024]}
      shadow-camera-left={-15} shadow-camera-right={15} shadow-camera-top={14} shadow-camera-bottom={-13}
      shadow-camera-near={1} shadow-camera-far={45} shadow-bias={-.0003} shadow-normalBias={.025}/>
    <directionalLight position={[9,12,-8]} color="#e4f1fa" intensity={.55}/>
    <OfficeEnvironment motionPaused={motionPaused}/>
    {agents.map((agent,index)=><AgentAvatar key={agent.id||index} agent={agent} index={index} selected={selectedId===agent.id}
      dimmed={!matchesFilter(agent,filter)} onSelect={onSelect} onAgentArrived={onAgentArrived} motionPaused={motionPaused} bubble={bubbles?.[agent.id]} positions={positions} labelPortal={labelPortal}/>)}
    <CameraRig viewMode={viewMode} cameraCommand={cameraCommand} positions={positions}/>
    <FrameMeter onPerformance={onPerformance}/>
  </>;
}

export default function OfficeScene({agents=[],selectedId=null,onSelect,onAgentArrived,filter='all',viewMode='3d',cameraCommand=null,motionPaused=false,bubbles={},onPerformance}) {
  const labelPortal=useRef(null);
  const fallback=<FallbackOffice agents={agents} onSelect={onSelect}/>;
  return <div className="office-canvas" style={{width:'100%',height:'100%',position:'relative',isolation:'isolate'}} data-office-scene="true">
    <SceneBoundary fallback={fallback}>
      <Canvas shadows dpr={[1,1.6]} gl={{antialias:true,alpha:false,powerPreference:'high-performance'}} fallback={fallback}
        onPointerMissed={()=>onSelect?.(null)} onCreated={({gl})=>{gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=1;gl.shadowMap.type=THREE.PCFSoftShadowMap;gl.setClearColor('#e9eee6');}}>
        <Suspense fallback={<Html center><div style={{padding:14,borderRadius:20,background:'#fffdf5',fontSize:12,color:'#6f826a',whiteSpace:'nowrap'}}>Opening the office…</div></Html>}>
          <SceneContent agents={agents} selectedId={selectedId} onSelect={onSelect} onAgentArrived={onAgentArrived} filter={filter} viewMode={viewMode}
            cameraCommand={cameraCommand} motionPaused={motionPaused} bubbles={bubbles} onPerformance={onPerformance} labelPortal={labelPortal}/>
        </Suspense>
      </Canvas>
    </SceneBoundary>
    <div ref={labelPortal} className="office-label-layer" style={{position:'absolute',inset:0,pointerEvents:'none',overflow:'hidden'}}/>
  </div>;
}
