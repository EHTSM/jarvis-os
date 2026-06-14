import { useEffect, useRef } from 'react';

/**
 * Global keyboard shortcut registry for Ooplix.
 * Handles: Cmd+K, Cmd+1-9, Escape, /, ? and all OS-level shortcuts.
 * Respects: input focus, modal state, contentEditable elements.
 */

const SHORTCUTS = [
  // Navigation — Cmd+1 through Cmd+9
  { id: 'nav-home',        keys: ['Meta+1', 'Ctrl+1'],     description: 'Command Center'    },
  { id: 'nav-intelligence',keys: ['Meta+2', 'Ctrl+2'],     description: 'Intelligence'      },
  { id: 'nav-engineering', keys: ['Meta+3', 'Ctrl+3'],     description: 'Engineering'       },
  { id: 'nav-contacts',    keys: ['Meta+4', 'Ctrl+4'],     description: 'Contacts'          },
  { id: 'nav-payments',    keys: ['Meta+5', 'Ctrl+5'],     description: 'Payments'          },
  { id: 'nav-reports',     keys: ['Meta+6', 'Ctrl+6'],     description: 'Reports'           },
  { id: 'nav-chat',        keys: ['Meta+7', 'Ctrl+7'],     description: 'AI Assistant'      },

  // Actions
  { id: 'palette',         keys: ['Meta+k', 'Ctrl+k'],     description: 'Command Palette'   },
  { id: 'new-task',        keys: ['Meta+n', 'Ctrl+n'],     description: 'New Task'          },
  { id: 'search',          keys: ['/'],                     description: 'Quick Search',     noInput: true },
  { id: 'help',            keys: ['?'],                     description: 'Keyboard Shortcuts', noInput: true },
  { id: 'escape',          keys: ['Escape'],                description: 'Close / Cancel'   },

  // Runtime
  { id: 'emergency-stop',  keys: ['Meta+Shift+.', 'Ctrl+Shift+.'], description: 'Emergency Stop' },
  { id: 'emergency-resume',keys: ['Meta+Shift+/', 'Ctrl+Shift+/'], description: 'Resume'         },

  // View
  { id: 'zoom-in',         keys: ['Meta+=', 'Ctrl+='],     description: 'Zoom In'           },
  { id: 'zoom-out',        keys: ['Meta+-', 'Ctrl+-'],     description: 'Zoom Out'          },
  { id: 'fullscreen',      keys: ['F11'],                   description: 'Fullscreen'        },
];

export { SHORTCUTS };

/**
 * Parse a shortcut string like "Meta+k" into its components
 */
function parseShortcut(shortcut) {
  const parts = shortcut.split('+');
  const key = parts[parts.length - 1].toLowerCase();
  return {
    key,
    meta:  parts.includes('Meta'),
    ctrl:  parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt:   parts.includes('Alt'),
  };
}

/**
 * Check if an event matches a parsed shortcut
 */
function matchesShortcut(e, parsed) {
  const eventKey = e.key.toLowerCase();
  // Normalize: '=' key may come as '=' or '+' depending on keyboard
  const key = parsed.key === '=' ? (eventKey === '=' || eventKey === '+') : eventKey === parsed.key;
  return (
    key &&
    e.metaKey  === parsed.meta &&
    e.ctrlKey  === parsed.ctrl &&
    e.shiftKey === parsed.shift &&
    e.altKey   === parsed.alt
  );
}

/**
 * Is the user currently typing in a text field?
 */
function isTyping(e) {
  const t = e.target?.tagName?.toLowerCase();
  return (
    t === 'input' ||
    t === 'textarea' ||
    t === 'select' ||
    e.target?.isContentEditable ||
    e.target?.closest('[role="textbox"]') ||
    e.target?.closest('[data-no-shortcuts]')
  );
}

/**
 * useKeyboardShortcuts — register global keyboard shortcut handlers.
 *
 * handlers: Record<shortcutId, (event) => void>
 * Example:
 *   useKeyboardShortcuts({
 *     'palette': () => setPaletteOpen(true),
 *     'nav-home': () => setTab('home'),
 *   });
 */
export function useKeyboardShortcuts(handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e) => {
      for (const shortcut of SHORTCUTS) {
        const handler = handlersRef.current[shortcut.id];
        if (!handler) continue;

        for (const keyStr of shortcut.keys) {
          const parsed = parseShortcut(keyStr);
          if (!matchesShortcut(e, parsed)) continue;

          // Skip if user is typing and this shortcut requires noInput
          if (shortcut.noInput && isTyping(e)) continue;

          // Don't prevent default for some system shortcuts we still want to pass through
          const isNavShortcut = shortcut.id.startsWith('nav-') || shortcut.id === 'palette' || shortcut.id === 'new-task';
          if (isNavShortcut) e.preventDefault();

          handler(e);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);
}

/**
 * Single shortcut hook — simpler API for one-off shortcuts
 */
export function useShortcut(shortcutId, handler, deps = []) {
  const handlers = { [shortcutId]: handler };
  const stableHandlers = useRef(handlers);
  stableHandlers.current = { [shortcutId]: handler };
  useKeyboardShortcuts(stableHandlers.current);
}
