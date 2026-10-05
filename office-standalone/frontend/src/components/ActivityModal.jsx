import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { EmptyState, Icon, formatTime, useDialogFocus } from './ui.jsx';

const TASK_TYPES = new Set(['agent.task.started', 'agent.task.completed']);

function belongsToAgent(event, agent) {
  const ownerIds = new Set([agent.id, agent.profile].filter(Boolean));
  const eventIds = [event.agent_id, event.agentId, event.profile].filter(value => typeof value === 'string' && value);
  return eventIds.length > 0 && eventIds.every(value => ownerIds.has(value));
}

function EventList({ rows, taskHistory = false }) {
  return (
    <ol className="event-list">
      {rows.map((event, index) => {
        const description = typeof event.detail === 'string'
          ? event.detail
          : [event.label, event.text].filter(value => typeof value === 'string' && value).join(' · ');
        const taskLabel = event.type === 'agent.task.started' ? 'Tugas dimulai' : 'Tugas selesai';
        return (
          <li key={event.id || index}>
            <span className="event-dot" />
            <div>
              <time>{formatTime(event.at || event.timestamp)}</time>
              {taskHistory ? (
                <p><strong>{taskLabel}</strong>{typeof event.text === 'string' && event.text ? <> · {event.text}</> : null}</p>
              ) : (
                <p>{description || event.type || 'Aktivitas tercatat'}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function ActivityModal({ kind, agent, events = [], mode, onClose }) {
  const reducedMotion = useReducedMotion();
  const ref = useDialogFocus(onClose);
  const isTasks = kind === 'tasks';
  const task = typeof agent.currentTask === 'string' ? agent.currentTask : agent.currentTask?.title;
  const progress = typeof agent.progress === 'number' && Number.isFinite(agent.progress)
    ? Math.round(Math.max(0, Math.min(100, agent.progress)))
    : null;
  const ownEvents = events.filter(event => event && belongsToAgent(event, agent));
  const logs = ownEvents.slice(-30).reverse();
  const taskHistory = ownEvents.filter(event => TASK_TYPES.has(event.type)).slice(-12).reverse();

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.18 }}
      onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}
    >
      <motion.section
        ref={ref}
        className="activity-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-title"
        tabIndex={-1}
        initial={reducedMotion ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.2 }}
      >
        <header className="modal-header">
          <div className="modal-title">
            <span className="modal-title-icon"><Icon name={isTasks ? 'task' : 'log'} size={20} /></span>
            <div>
              <span className="eyebrow">{agent.name} · {mode === 'demo' ? 'SIMULASI' : 'HERMES'}</span>
              <h2 id="activity-title">{isTasks ? 'Tasks' : 'Logs'}</h2>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={isTasks ? 'Tutup tugas' : 'Tutup log'}>
            <Icon name="close" />
          </button>
        </header>
        <div className="activity-content">
          {isTasks ? (
            <>
              {task && (
                <article className="task-record">
                  <span className="eyebrow">TUGAS SAAT INI</span>
                  <h3>{task}</h3>
                  <p>{progress !== null ? progress + '% selesai' : 'Progres belum tersedia dari Hermes.'}</p>
                </article>
              )}
              {taskHistory.length > 0 && (
                <>
                  <div className="task-record" style={{ paddingBottom: 0, paddingTop: task ? 0 : 28 }}>
                    <span className="eyebrow">RIWAYAT TUGAS</span>
                    <p>{mode === 'demo' ? 'Peristiwa tugas dalam simulasi ini.' : 'Peristiwa tugas yang diterima dari Hermes.'}</p>
                  </div>
                  <EventList rows={taskHistory} taskHistory />
                </>
              )}
              {!task && taskHistory.length === 0 && (
                <EmptyState title="Detail tugas belum tersedia" icon="task">
                  Hermes belum menyediakan daftar tugas untuk agen ini. Buka percakapan untuk meninjau pekerjaan yang tercatat.
                </EmptyState>
              )}
            </>
          ) : logs.length > 0 ? (
            <EventList rows={logs} />
          ) : (
            <EmptyState title="Belum ada aktivitas tercatat" icon="log">
              Log hanya menampilkan perubahan yang benar-benar diterima dari sumber.
            </EmptyState>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}
