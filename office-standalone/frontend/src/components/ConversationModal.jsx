import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Avatar, EmptyState, Icon, formatTime, useDialogFocus } from './ui.jsx';

const PAGE_SIZE = 50;
const ROLES = { user: 'Pengguna', assistant: 'Asisten', tool: 'Tool' };
const string = value => typeof value === 'string' ? value : '';
const channelName = value => string(value).trim().toLowerCase().replace(/[_-]/g, ' ');
const channelLabel = value => ({ telegram: 'Telegram', whatsapp: 'WhatsApp', web: 'Web', cli: 'CLI' })[value] || value || 'Kanal tidak tersedia';
const emptyPage = () => ({ rows: [], loading: false, available: null, error: '', requiresLogin: false, offset: 0, hasMore: false });
const mergeRows = (older, existing) => [...new Map([...older, ...existing].map(row => [String(row.id), row])).values()];

async function auditRequest(path, params, signal, profile) {
  const response = await fetch(`${path}?${new URLSearchParams(params)}`, { credentials: 'same-origin', cache: 'no-store', signal });
  if (!response.ok) {
    const error = new Error(response.status === 401 ? 'Masuk ke Hermes untuk membaca riwayat.' : 'Riwayat belum dapat dimuat. Coba lagi.');
    error.requiresLogin = response.status === 401;
    throw error;
  }
  const payload = await response.json();
  if (payload.profile !== profile) throw new Error('Pemilik riwayat tidak cocok dengan bot yang dipilih.');
  return payload;
}

function AccessState({ page, onRetry, noun = 'Riwayat' }) {
  return <EmptyState title={page.requiresLogin ? 'Hubungkan riwayat Hermes' : `${noun} belum tersedia`} action={page.requiresLogin ? <a className="primary-button" href="/connect.html">Hubungkan Hermes<Icon name="arrow" size={15} /></a> : <button className="secondary-button" onClick={onRetry}>Muat ulang</button>}>{page.error || (page.requiresLogin ? 'Login diperlukan untuk membaca percakapan pribadi bot ini.' : 'Hermes belum dapat mengembalikan data. Status kantor tetap dapat dilihat.')}</EmptyState>;
}

function ToolDisclosure({ name, content }) {
  return <details className="tool-disclosure"><summary><Icon name="task" size={14} />{name}<Icon name="chevron" size={13} /></summary><pre>{typeof content === 'string' ? content : JSON.stringify(content, null, 2)}</pre></details>;
}

function Message({ message }) {
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return <article className={`chat-message message-${message.role}`}><header><span><span className="message-role-dot" />{ROLES[message.role] || 'Pesan'}</span><time>{formatTime(message.timestamp)}</time></header>{message.role === 'tool' ? <ToolDisclosure name={`Hasil tool${message.tool_name ? ` · ${message.tool_name}` : ''}`} content={string(message.content)} /> : message.content ? <div className="message-content">{string(message.content)}</div> : <p className="message-note">Tidak ada teks pada pesan ini.</p>}{calls.map((call, index) => <ToolDisclosure key={call.id || index} name={`Tool · ${string(call.name) || 'Tanpa nama'}`} content={call.arguments} />)}{message.attachment_count > 0 && <p className="message-note">{message.attachment_count} lampiran tercatat. Buka Hermes untuk melihat lampiran.</p>}{message.truncated && <p className="message-note">Teks dipotong oleh sumber. Buka Hermes untuk versi lengkap.</p>}</article>;
}

export default function ConversationModal({ agent, agents, mode, initialSessionId, onClose, onLive }) {
  const reducedMotion = useReducedMotion();
  const dialogRef = useDialogFocus(onClose);
  const [profile, setProfile] = useState(agent.profile || agent.id);
  const [channel, setChannel] = useState('all');
  const [sessionQuery, setSessionQuery] = useState('');
  const [messageQuery, setMessageQuery] = useState('');
  const [sessions, setSessions] = useState(emptyPage);
  const [messages, setMessages] = useState(emptyPage);
  const [selectedSession, setSelectedSession] = useState(null);
  const [resolvedSession, setResolvedSession] = useState(null);
  const sessionController = useRef(null);
  const messageController = useRef(null);
  const epoch = useRef(0);
  const messageEpoch = useRef(0);
  const sessionsRef = useRef(sessions);
  const messagesRef = useRef(messages);
  sessionsRef.current = sessions;
  messagesRef.current = messages;
  const selectedAgent = agents.find(item => (item.profile || item.id) === profile) || agent;

  const loadSessions = useCallback(async (more = false) => {
    if (!profile || mode === 'demo') return;
    const currentEpoch = epoch.current;
    const controller = new AbortController();
    sessionController.current?.abort();
    sessionController.current = controller;
    const offset = more ? sessionsRef.current.offset : 0;
    setSessions(previous => ({ ...(more ? previous : emptyPage()), loading: true }));
    try {
      const payload = await auditRequest('/api/audit/sessions', { profile, limit: PAGE_SIZE, offset }, controller.signal, profile);
      if (controller.signal.aborted || currentEpoch !== epoch.current) return;
      const rows = Array.isArray(payload.sessions) ? payload.sessions : [];
      if (rows.some(row => row.profile !== profile)) throw new Error('Daftar sesi tidak cocok dengan bot yang dipilih.');
      const available = payload.available === true;
      const returned = Number.isInteger(payload.pagination?.returned) ? payload.pagination.returned : 0;
      setSessions(previous => ({ rows: available ? more ? mergeRows(previous.rows, rows) : rows : [], loading: false, available, error: string(payload.error), requiresLogin: payload.requires_login === true, offset: offset + returned, hasMore: available && payload.pagination?.has_more === true && returned > 0 }));
      if (!available) { messageEpoch.current += 1; messageController.current?.abort(); setSelectedSession(null); setResolvedSession(null); setMessages(emptyPage()); }
    } catch (error) {
      if (error.name !== 'AbortError' && currentEpoch === epoch.current) {
        setSessions({ ...emptyPage(), available: false, error: error.message, requiresLogin: error.requiresLogin === true });
        messageEpoch.current += 1; messageController.current?.abort();
        setSelectedSession(null); setResolvedSession(null); setMessages(emptyPage());
      }
    }
  }, [profile, mode]);

  const loadMessages = useCallback(async (older = false) => {
    if (!selectedSession || !profile || mode === 'demo') return;
    const currentEpoch = epoch.current, currentMessageEpoch = messageEpoch.current;
    const controller = new AbortController();
    messageController.current?.abort();
    messageController.current = controller;
    const offset = older ? messagesRef.current.offset : 0;
    setMessages(previous => ({ ...(older ? previous : emptyPage()), loading: true }));
    try {
      const payload = await auditRequest('/api/audit/messages', { profile, session_id: selectedSession.id, order: 'latest', limit: PAGE_SIZE, offset }, controller.signal, profile);
      if (controller.signal.aborted || currentEpoch !== epoch.current || currentMessageEpoch !== messageEpoch.current) return;
      if (payload.available === true && (!payload.session || payload.session.profile !== profile || payload.session.id !== payload.session_id)) throw new Error('Pemilik percakapan tidak cocok dengan bot yang dipilih.');
      const rows = Array.isArray(payload.messages) ? payload.messages.filter(message => ['user', 'assistant', 'tool'].includes(message.role)) : [];
      const available = payload.available === true;
      const returned = Number.isInteger(payload.pagination?.returned) ? payload.pagination.returned : 0;
      setMessages(previous => ({ rows: available ? older ? mergeRows(rows, previous.rows) : rows : [], loading: false, available, error: string(payload.error), requiresLogin: payload.requires_login === true, offset: offset + returned, hasMore: available && payload.pagination?.has_more === true && returned > 0 }));
      setResolvedSession(available ? payload.session : null);
    } catch (error) {
      if (error.name !== 'AbortError' && currentEpoch === epoch.current && currentMessageEpoch === messageEpoch.current) setMessages({ ...emptyPage(), available: false, error: error.message, requiresLogin: error.requiresLogin === true });
    }
  }, [profile, selectedSession, mode]);

  useEffect(() => {
    epoch.current += 1;
    messageEpoch.current += 1;
    sessionController.current?.abort();
    messageController.current?.abort();
    setSessions(emptyPage()); setMessages(emptyPage()); setSelectedSession(null); setResolvedSession(null);
    setChannel('all'); setSessionQuery(''); setMessageQuery('');
    loadSessions();
    return () => { sessionController.current?.abort(); messageController.current?.abort(); };
  }, [profile, mode, loadSessions]);

  useEffect(() => {
    messageEpoch.current += 1;
    messageController.current?.abort();
    setMessages(emptyPage()); setResolvedSession(null); setMessageQuery('');
    if (selectedSession) loadMessages();
    return () => messageController.current?.abort();
  }, [selectedSession, loadMessages]);

  const channels = useMemo(() => [...new Set(sessions.rows.map(row => channelName(row.source)).filter(Boolean))], [sessions.rows]);
  const visibleSessions = sessions.rows.filter(row => (channel === 'all' || channelName(row.source) === channel) && `${row.title || ''} ${row.id}`.toLocaleLowerCase('id-ID').includes(sessionQuery.toLocaleLowerCase('id-ID')));
  const visibleMessages = messages.rows.filter(row => [row.content, row.tool_name, JSON.stringify(row.tool_calls || [])].join(' ').toLocaleLowerCase('id-ID').includes(messageQuery.toLocaleLowerCase('id-ID')));

  useEffect(() => {
    if (selectedSession || sessions.loading || sessions.available !== true) return;
    const eligible = sessions.rows.filter(row => channel === 'all' || channelName(row.source) === channel);
    const preferred = (profile === (agent.profile || agent.id) && initialSessionId ? eligible.find(row => row.id === initialSessionId) : null) || eligible.find(row => /telegram|whatsapp/.test(channelName(row.source))) || eligible[0];
    if (preferred) setSelectedSession(preferred);
  }, [sessions, selectedSession, channel, initialSessionId, profile, agent.profile, agent.id]);

  const chooseChannel = value => { setChannel(value); if (selectedSession && value !== 'all' && channelName(selectedSession.source) !== value) setSelectedSession(null); };
  const chooseProfile = value => {
    if (value === profile) return;
    epoch.current += 1; messageEpoch.current += 1;
    sessionController.current?.abort(); messageController.current?.abort();
    setSessions(emptyPage()); setMessages(emptyPage()); setSelectedSession(null); setResolvedSession(null);
    setProfile(value);
  };

  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.18 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><motion.section ref={dialogRef} className="conversation-modal" role="dialog" aria-modal="true" aria-labelledby="conversation-title" tabIndex={-1} initial={reducedMotion ? false : { opacity: 0, y: 24, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }} transition={{ duration: 0.23 }}>
    <header className="modal-header"><div className="modal-title"><span className="modal-title-icon"><Icon name="chat" size={20} /></span><div><span className="eyebrow">HERMES · RIWAYAT ASLI</span><h2 id="conversation-title">Percakapan</h2></div></div><span className="read-only-chip">Read only</span><button className="icon-button" onClick={onClose} aria-label="Tutup percakapan"><Icon name="close" size={20} /></button></header>
    {mode === 'demo' ? <EmptyState title="Riwayat asli ada di mode live" action={<button className="primary-button" onClick={onLive}>Kembali ke live<Icon name="arrow" size={15} /></button>}>Simulasi hanya memperlihatkan aktivitas kantor. Percakapan pribadi tetap diambil dari Hermes.</EmptyState> : <div className="audit-layout">
      <aside className="sessions-column"><div className="audit-profile"><Avatar agent={selectedAgent} size="small" /><label><span>Bot</span><select value={profile} onChange={event => chooseProfile(event.target.value)} aria-label="Pilih bot untuk riwayat">{agents.map(item => <option key={item.id} value={item.profile || item.id}>{item.name || item.id}</option>)}</select></label></div><div className="audit-filters"><label className="search-input"><Icon name="search" size={15} /><input value={sessionQuery} onChange={event => setSessionQuery(event.target.value)} placeholder="Cari sesi yang dimuat" aria-label="Cari sesi yang sudah dimuat" /></label><label className="channel-select"><span>Kanal</span><select value={channel} onChange={event => chooseChannel(event.target.value)} aria-label="Filter kanal"><option value="all">Semua kanal</option>{channels.map(value => <option value={value} key={value}>{channelLabel(value)}</option>)}</select></label></div><div className="session-list" aria-busy={sessions.loading}>
        {sessions.loading && !sessions.rows.length ? <EmptyState title="Memuat sesi…">Mengambil riwayat bot ini dari Hermes.</EmptyState> : sessions.available === false ? <AccessState page={sessions} onRetry={() => loadSessions()} /> : !visibleSessions.length ? <EmptyState title={sessionQuery || channel !== 'all' ? 'Tidak ada sesi yang cocok' : 'Belum ada sesi'}>{sessions.hasMore ? 'Filter dan pencarian berlaku untuk sesi yang telah dimuat. Muat sesi lainnya untuk melanjutkan.' : 'Hermes belum mengembalikan sesi yang cocok untuk bot ini.'}</EmptyState> : visibleSessions.map(session => <button key={session.id} className={`session-item ${selectedSession?.id === session.id ? 'selected' : ''}`} aria-pressed={selectedSession?.id === session.id} onClick={() => setSelectedSession(session)}><span className="session-channel">{channelLabel(channelName(session.source))}<time>{formatTime(session.last_active, 'Waktu —')}</time></span><strong>{session.title || session.id}</strong><small>{Number.isFinite(session.message_count) ? `${session.message_count} pesan` : 'Pesan —'}{Number.isFinite(session.tool_call_count) && ` · ${session.tool_call_count} tool`}</small></button>)}
        {sessions.hasMore && <button className="load-more secondary-button" disabled={sessions.loading} onClick={() => loadSessions(true)}>{sessions.loading ? 'Memuat…' : 'Sesi lainnya'}</button>}
      </div><p className="audit-scope-note">Hanya sesi milik bot yang dipilih.</p></aside>
      <div className="thread-column"><div className="thread-heading"><div><span className="eyebrow">{selectedSession ? channelLabel(channelName((resolvedSession || selectedSession).source)) : 'PERCAKAPAN'}</span><h3>{(resolvedSession || selectedSession)?.title || 'Pilih sesi percakapan'}</h3><p>{selectedSession ? `${selectedAgent.name || profile} · ${(resolvedSession || selectedSession).id}` : 'Pesan dan aktivitas tool dari Hermes.'}</p></div><button className="icon-button" disabled={messages.loading || !selectedSession} onClick={() => loadMessages()} aria-label="Muat ulang pesan"><Icon name="reset" size={16} /></button></div><div className="thread-search"><label className="search-input"><Icon name="search" size={15} /><input value={messageQuery} onChange={event => setMessageQuery(event.target.value)} placeholder="Cari pesan yang dimuat" aria-label="Cari pesan yang sudah dimuat" /></label><span>{messages.rows.length} dimuat</span></div><div className="message-list" aria-busy={messages.loading}>
        {messages.loading && !messages.rows.length ? <EmptyState title="Memuat percakapan…">Pesan asli sedang diambil dari Hermes.</EmptyState> : messages.available === false ? <AccessState page={messages} noun="Percakapan" onRetry={() => loadMessages()} /> : !selectedSession ? <EmptyState title="Pilih sesi untuk membaca">Pilih bot, kanal, lalu sesi percakapan di sebelah kiri.</EmptyState> : <>{messages.hasMore && <button className="load-more secondary-button" disabled={messages.loading} onClick={() => loadMessages(true)}>{messages.loading ? 'Memuat…' : 'Pesan lebih lama'}</button>}{!visibleMessages.length ? <EmptyState title={messageQuery ? 'Tidak ada pesan yang cocok' : 'Belum ada pesan'}>{messageQuery ? 'Pencarian hanya berlaku untuk pesan yang telah dimuat.' : messages.hasMore ? 'Muat pesan lebih lama untuk melanjutkan penelusuran.' : 'Sesi ini belum mengembalikan pesan yang dapat ditampilkan.'}</EmptyState> : visibleMessages.map((message, index) => <Message key={message.id || index} message={message} />)}</>}
      </div><footer className="thread-footer"><Icon name="info" size={13} />Pencarian hanya pada data yang dimuat. Lampiran dibuka melalui Hermes.</footer></div>
    </div>}
  </motion.section></motion.div>;
}
