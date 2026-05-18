import React from 'react';

/**
 * NotificationOverlay - Hardened for accessibility.
 * Uses aria-live and role attributes to ensure operators using assistive technology
 * are informed of transient system feedback.
 */
export const NotificationOverlay = React.memo(({ notifications, removeNotification }) => {
  if (notifications.length === 0) return null;

  return (
    <div className="op-notification-overlay" role="log" aria-live="polite">
      {notifications.map((n) => (
        <div key={n.id} className={`op-notification op-notification-${n.type} op-fade-in`} role="status">
          <span className="op-notification-icon" aria-hidden="true">
            {n.type === 'ok' ? '✓' : n.type === 'warn' ? '⚠' : n.type === 'crit' ? '✗' : 'ℹ'}
          </span>
          <span className="op-notification-msg">{n.message}</span>
          <button 
            onClick={() => removeNotification(n.id)} 
            className="op-notification-close"
            aria-label="Dismiss notification"
          >×</button>
        </div>
      ))}
    </div>
  );
});
