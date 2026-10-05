import React, { useEffect, useRef } from 'react';

const paths = {
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  reset: <><path d="M4 11a8 8 0 1 1 2.1 6.4M4 4v7h7" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
  external: <><path d="M14 4h6v6m0-6-9 9" /><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>,
  chat: <><path d="M20 11a8 8 0 0 1-8 8H5l-4 3V11a8 8 0 0 1 8-8h3a8 8 0 0 1 8 8Z" /><path d="M6 10h9M6 14h6" /></>,
  task: <><path d="M9 5H5v15h14V5h-4" /><path d="M9 3h6v4H9zM8 12l2 2 5-5M8 17h7" /></>,
  log: <><path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h6" /></>,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  play: <path d="m8 4 12 8-12 8z" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v.1" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  cube: <><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10" /></>,
  bird: <><path d="M4 15c2-1 3-4 4-7 2 3 4 4 7 3 1-3 4-4 6-3l-2 3c-1 5-4 8-8 8-4 0-6-2-7-4Z" /><path d="m8 8-2-3M5 15H2" /></>,
};

export function Icon({ name, size = 18, className = '', ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>{paths[name] || paths.info}</svg>;
}

export function BirdMark() {
  return <svg className="bird-mark" viewBox="0 0 44 44" aria-hidden="true"><path d="M9 29c6-2 6-11 10-16 3 6 8 8 12 5 1-5 6-7 10-5l-5 5c-1 12-8 19-17 17-4-1-8-3-10-6Z" fill="currentColor" /><path d="m18 15-5-5-3 2 5 8M12 29l-7-1-1 3 9 2" fill="currentColor" /><circle cx="34" cy="14" r="1" fill="#f4f5ef" /></svg>;
}

export const STATUS_LABELS = {
  working: 'Bekerja', idle: 'Siap', meeting: 'Meeting', thinking: 'Berpikir', error: 'Perlu perhatian',
  walking: 'Berpindah', offline: 'Offline', stopped: 'Tidak aktif', unknown: 'Belum terverifikasi',
};

export function StatusBadge({ status, visualState, demo = false }) {
  const state = demo ? visualState || status : status;
  return <span className={`status-badge status-${state || 'unknown'}`}><span className="status-pip" />{STATUS_LABELS[state] || state || 'Belum terverifikasi'}</span>;
}

export function Avatar({ agent, size = 'normal' }) {
  const name = agent?.name || agent?.label || agent?.id || '?';
  return <span className={`avatar avatar-${size}`} style={{ '--avatar-color': agent?.color || '#b8cfbb' }} aria-hidden="true"><span className="avatar-hair" /><span className="avatar-face"><i /><i /></span><span className="avatar-shirt" /><span className="avatar-initial">{name.charAt(0).toUpperCase()}</span></span>;
}

export function formatTime(value, missing = 'Waktu tidak tersedia') {
  if (value === null || value === undefined || value === '' || value === 0) return missing;
  const parsed = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return missing;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(parsed);
}

export function metric(value) {
  return value === undefined || value === null || value === '' || (typeof value === 'number' && !Number.isFinite(value)) ? '—' : String(value);
}

export function useDialogFocus(onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const panel = ref.current;
    const selector = 'button:not([disabled]), a[href], input, select, textarea, summary, [tabindex="0"]';
    panel?.querySelector(selector)?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = [...(panel?.querySelectorAll(selector) || [])].filter(item => item.offsetParent !== null);
      if (!items.length) { event.preventDefault(); panel?.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); if (previous?.isConnected) previous.focus(); };
  }, []);
  return ref;
}

export function EmptyState({ title, children, icon = 'chat', action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={24} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
