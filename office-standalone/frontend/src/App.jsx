import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import { officeStore, useOfficeStore } from './state/office-store.js';
import AgentPanel from './components/AgentPanel.jsx';
import ConversationModal from './components/ConversationModal.jsx';
import ActivityModal from './components/ActivityModal.jsx';
import { Avatar, BirdMark, Icon, STATUS_LABELS, formatTime } from './components/ui.jsx';
import './styles.css';

const OfficeScene = lazy(() => import('./scene/OfficeScene.jsx'));
const FILTERS = [{ id: 'all', label: 'All' }, { id: 'operations', label: 'Operations' }, { id: 'customer-support', label: 'Customer Support' }, { id: 'corporate', label: 'Corporate' }, { id: 'research', label: 'Research' }, { id: 'idle', label: 'Idle' }, { id: 'working', label: 'Working' }, { id: 'meeting', label: 'Meeting' }];

class SceneBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="scene-loading scene-error"><Icon name="cube" size={30} /><strong>Kantor 3D belum dapat dibuka</strong><span>Detail agen dan riwayat tetap tersedia melalui daftar di bawah.</span><button className="secondary-button" onClick={() => { this.setState({ failed: false }); this.props.onRetry(); }}>Coba lagi</button></div> : this.props.children;
  }
}

export default function App() {
  const state = useOfficeStore();
  const agents = state.agents || [];
  const source = state.source || {};
  const mode = state.mode || 'live';
  const reducedMotion = useReducedMotion();
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [viewMode, setViewMode] = useState('3d');
  const [motionPaused, setMotionPaused] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const motionOverridden = useRef(false);
  const [cameraCommand, setCameraCommand] = useState({ id: 0, type: 'reset' });
  const [overlay, setOverlay] = useState(null);
  const [auditSessionId, setAuditSessionId] = useState(null);
  const [performanceInfo, setPerformanceInfo] = useState(null);
  const [sceneKey, setSceneKey] = useState(0);
  const selected = agents.find(agent => agent.id === selectedId);
  const connected = state.connected === true && source.stale !== true && source.state !== 'disconnected';
  const liveOnline = agents.filter(agent => agent.gatewayStatus != null ? ['idle', 'working'].includes(agent.gatewayStatus) : ['idle', 'working', 'meeting', 'thinking', 'walking', 'resting', 'completed', 'error'].includes(agent.status)).length;
  const online = mode === 'demo' ? agents.length : connected ? liveOnline : '—';
  const latestEvent = (state.events || []).slice(-1)[0];
  const latestEventAgent = latestEvent && agents.find(agent => [latestEvent.agent_id, latestEvent.agentId, latestEvent.profile].includes(agent.id));
  const latestEventText = latestEvent && (latestEvent.detail || [latestEvent.label, latestEvent.text].filter(Boolean).join(' · ') || latestEvent.type);
  const onPerformance = useCallback(info => setPerformanceInfo(info), []);
  const onAgentArrived = useCallback((id, position) => officeStore.dispatchEvent({ type: 'agent.moved', agentId: id, position }), []);

  useEffect(() => { officeStore.start(); return () => officeStore.stop(); }, []);
  useEffect(() => { if (reducedMotion && !motionOverridden.current) setMotionPaused(true); }, [reducedMotion]);
  useEffect(() => { if (selectedId && !agents.some(agent => agent.id === selectedId)) { setSelectedId(null); setOverlay(null); } }, [agents, selectedId]);
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape' && !overlay) setSelectedId(null); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);

  const camera = (type, agentId) => setCameraCommand(previous => ({ id: previous.id + 1, type, ...(agentId ? { agentId } : {}) }));
  const selectAgent = id => { setSelectedId(id); officeStore.select?.(id); camera('focus', id); };
  const changeMode = next => { setSelectedId(null); setOverlay(null); officeStore.setMode(next); camera('reset'); };
  const closePanel = () => { setSelectedId(null); officeStore.select?.(null); };
  const toggleMotion = () => { motionOverridden.current = true; setMotionPaused(previous => !previous); };
  const openAction = (action, sessionId) => { setAuditSessionId(sessionId || null); setOverlay(action); };
  const displayedSource = mode === 'demo' ? 'Mode simulasi' : connected ? 'Sistem terhubung' : source.requires_login ? 'Login diperlukan' : source.stale ? 'Data terakhir' : 'Menghubungkan Hermes';

  return <main className={`office-app ${selected ? 'has-selection' : ''}`} data-performance-fps={performanceInfo?.fps} data-performance-draw-calls={performanceInfo?.drawCalls} data-performance-triangles={performanceInfo?.triangles} data-performance-dpr={performanceInfo?.dpr}>
    <header className="topbar"><a className="brand" href="/" aria-label="Hermes HQ beranda"><BirdMark /><span>HERMES <b>HQ</b></span><i>AGENT OFFICE</i></a><div className="topbar-status"><span className={`online-count ${mode === 'demo' ? 'is-demo' : ''}`}><span className="status-pip" />{online} {mode === 'demo' ? 'agen simulasi' : 'online'}</span><span className="topbar-divider" /><span className={`source-health ${connected || mode === 'demo' ? 'healthy' : 'waiting'}`}><span className="health-bars"><i /><i /><i /></span>{displayedSource}</span></div><div className="topbar-actions"><div className="mode-switch" aria-label="Mode kantor"><button aria-pressed={mode === 'live'} className={mode === 'live' ? 'active' : ''} onClick={() => changeMode('live')}>Live</button><button aria-pressed={mode === 'demo'} className={mode === 'demo' ? 'active' : ''} onClick={() => changeMode('demo')}>Simulasi</button></div><a className="source-link" href="/connect.html" title="Hubungkan sumber Hermes" aria-label="Hubungkan sumber Hermes"><Icon name="external" size={16} /></a></div></header>
    <div className="office-stage"><SceneBoundary key={sceneKey} onRetry={() => setSceneKey(value => value + 1)}><Suspense fallback={<div className="scene-loading"><span className="office-loader"><Icon name="bird" size={31} /></span><strong>Menyiapkan kantor…</strong><span>Agen akan muncul setelah sumber tersambung.</span></div>}><OfficeScene agents={agents} selectedId={selectedId} onSelect={selectAgent} filter={filter} viewMode={viewMode} cameraCommand={cameraCommand} motionPaused={motionPaused} bubbles={state.bubbles || {}} onPerformance={onPerformance} onAgentArrived={onAgentArrived} /></Suspense></SceneBoundary></div>
    <nav className="filter-dock" aria-label="Filter agen">{FILTERS.map(item => <button key={item.id} aria-pressed={filter === item.id} className={`${filter === item.id ? 'active' : ''} ${['idle', 'working', 'meeting'].includes(item.id) ? 'state-filter' : ''}`} onClick={() => setFilter(item.id)}>{['idle', 'working', 'meeting'].includes(item.id) && <span className={`filter-pip pip-${item.id}`} />}{item.label}</button>)}</nav>
    <div className="scene-caption"><span className="eyebrow">YOUR TEAM, IN ONE PLACE</span><h1>Hari baru.<br />Ide besar.</h1><p>Klik agen untuk melihat<br />aktivitas dan percakapannya.</p><div className="caption-rule" /></div>
    {mode === 'demo' && <div className="demo-banner"><span className="demo-badge">SIMULASI</span><span>Aktivitas contoh, terpisah dari Hermes.</span><button onClick={() => officeStore.runDemo('meeting')}><Icon name="play" size={13} />Coba alur meeting</button></div>}
    <div className="scene-view-label"><span className="view-dot" />{viewMode === '3d' ? 'Isometric office' : 'Floor plan'}<span className="view-slash">/</span><span>HERMES HQ</span></div>
    <div className={`source-note ${mode === 'demo' ? 'demo-source-note' : ''}`}><span className={`source-dot ${connected ? 'connected' : ''}`} /><div><strong>{mode === 'demo' ? 'Simulasi kantor' : connected ? 'Hermes tersambung' : source.requires_login ? 'Hubungkan kembali Hermes' : source.stale ? 'Menampilkan data terakhir' : 'Menunggu sumber Hermes'}</strong><span>{mode === 'demo' ? 'Tugas dan gerakan di sini adalah contoh.' : connected ? source.sessions_available ? 'Status & riwayat tersedia' : 'Status live · riwayat perlu login' : source.error || 'Status agen akan muncul saat sumber tersedia.'}</span>{mode !== 'demo' && (!connected || !source.sessions_available) && <a href="/connect.html">{source.requires_login || source.private_detail_requires_login ? 'Hubungkan riwayat' : 'Atur koneksi'}<Icon name="arrow" size={12} /></a>}</div></div>
    <div className="camera-controls" aria-label="Kontrol tampilan kantor"><div className="view-switch"><button className={viewMode === '2d' ? 'active' : ''} aria-pressed={viewMode === '2d'} onClick={() => setViewMode('2d')}>2D</button><button className={viewMode === '3d' ? 'active' : ''} aria-pressed={viewMode === '3d'} onClick={() => setViewMode('3d')}>3D</button></div><span className="control-divider" /><button className="icon-button" onClick={() => camera('zoomOut')} aria-label="Perkecil tampilan"><Icon name="minus" size={17} /></button><button className="icon-button" onClick={() => camera('zoomIn')} aria-label="Perbesar tampilan"><Icon name="plus" size={17} /></button><button className="icon-button" onClick={() => camera('reset')} aria-label="Reset kamera"><Icon name="reset" size={16} /></button><span className="control-divider" /><button className={`icon-button ${motionPaused ? 'is-paused' : ''}`} aria-pressed={motionPaused} onClick={toggleMotion} aria-label={motionPaused ? 'Lanjutkan animasi kantor' : 'Jeda animasi kantor'} title="Jeda animasi kantor"><Icon name={motionPaused ? 'play' : 'pause'} size={15} /></button></div>
    <nav className="agent-roster" aria-label="Pilih agen dengan keyboard"><span className="roster-label">THE TEAM <span>{agents.length.toString().padStart(2, '0')}</span></span><div className="roster-buttons">{agents.map(agent => <button key={agent.id} className={`roster-agent ${selectedId === agent.id ? 'selected' : ''}`} aria-pressed={selectedId === agent.id} onClick={() => selectAgent(agent.id)} title={`${agent.name} · ${STATUS_LABELS[agent.status] || 'Belum terverifikasi'}`}><Avatar agent={agent} size="small" /><span>{agent.name || agent.id}</span><i className={`roster-status status-${mode === 'demo' ? agent.visualState || agent.status : agent.status}`} /></button>)}{!agents.length && <span className="roster-empty">Belum ada agen dari sumber</span>}</div></nav>
    <footer className="office-footer"><span><i />Siap</span><span><i />Bekerja</span><span><i />Meeting</span><span className="footer-help">Drag untuk memutar · scroll untuk zoom</span></footer>
    <div className="activity-ribbon" aria-label="Aktivitas terbaru"><span className="activity-label">{mode === 'demo' ? 'SIMULASI' : 'AKTIVITAS'}</span>{latestEvent ? <button onClick={() => { if (latestEventAgent) { selectAgent(latestEventAgent.id); setOverlay('logs'); } }} disabled={!latestEventAgent} title={latestEventText}><span className="activity-ribbon-dot" />{latestEventAgent && <strong>{latestEventAgent.name}</strong>}<span>{latestEventText || 'Aktivitas tercatat'}</span><time>{formatTime(latestEvent.at || latestEvent.timestamp, 'Waktu —')}</time></button> : <span className="activity-ribbon-empty">Belum ada perubahan tercatat</span>}</div>
    <AnimatePresence>{selected && <AgentPanel key={selected.id} agent={selected} mode={mode} source={source} onClose={closePanel} onAction={openAction} />}</AnimatePresence>
    <AnimatePresence>{overlay && selected && (overlay === 'conversations' ? <ConversationModal key={`conversation-${selected.id}-${mode}`} agent={selected} agents={agents} mode={mode} initialSessionId={auditSessionId} onClose={() => setOverlay(null)} onLive={() => changeMode('live')} /> : <ActivityModal key={`${overlay}-${selected.id}`} kind={overlay} agent={selected} events={state.events || []} mode={mode} onClose={() => setOverlay(null)} />)}</AnimatePresence>
  </main>;
}
