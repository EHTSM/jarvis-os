import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./EndOfDayReview.css";

const BASE = process.env.REACT_APP_API_URL || "";

export default function EndOfDayReview({ onClose }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    Promise.all([
      fetch(`${BASE}/missions`,                 { credentials: "include" }).then(r => r.json()).catch(() => ({ missions: [] })),
      fetch(`${BASE}/lessons`,                  { credentials: "include" }).then(r => r.json()).catch(() => ({ lessons: [] })),
      fetch(`${BASE}/engineering/intelligence`, { credentials: "include" }).then(r => r.json()).catch(() => ({})),
    ]).then(([missionsData, lessonsData, intelData]) => {
      const missions = (Array.isArray(missionsData?.missions) ? missionsData.missions : [])
        .filter(m => m.updatedAt?.startsWith(today) || m.createdAt?.startsWith(today))
        .slice(0, 8);
      // A.11 UX consistency: `lessonsData.lessons || lessonsData` fell through to
      // the RESPONSE OBJECT whenever the endpoint returned anything without a
      // `lessons` key — including the real error body {"error":"Unauthorized"} —
      // and `.slice()` on that object threw, crashing the whole review with
      // "(o.lessons || o || []).slice is not a function". Measured live.
      // Array.isArray() is the guard already used 102× across the app.
      const lessons = (Array.isArray(lessonsData?.lessons) ? lessonsData.lessons
        : Array.isArray(lessonsData) ? lessonsData : []).slice(0, 5);
      const signals = intelData.signals?.slice(0, 3) || [];
      setData({ missions, lessons, signals, date: today });
      setLoading(false);
    });
  }, []);

  // A.11.1 UX consistency fix: every other real dismissible overlay in the
  // app (CommandPalette.jsx's handleKey, ConfirmDialog.jsx's onKey) closes
  // on Escape. This modal already closes on backdrop click and the ✕/Close
  // Review buttons, but had no Escape handler at all — the one interaction
  // a founder is most likely to reach for muscle-memory-first after using
  // ⌘K or any confirm dialog elsewhere in the same session. Same pattern,
  // same event, no new UI.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const suggestions = [
    "Review open missions and close any stale ones.",
    "Write a commit message that summarizes today's work.",
    "Check the pipeline health before shutting down.",
    "Star your best mission from today as a favorite.",
  ];

  return (
    <motion.div
      className="eod-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={e => e.target === e.currentTarget && onClose?.()}
    >
      <motion.div
        className="eod-panel"
        initial={{ scale: 0.95, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <div className="eod-header">
          <div>
            <h2 className="eod-title">End of Day Review</h2>
            <span className="eod-date">{data?.date || new Date().toDateString()}</span>
          </div>
          <button className="eod-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="eod-loading">
            <div className="skeleton eod-skel" />
            <div className="skeleton eod-skel" />
            <div className="skeleton eod-skel" />
          </div>
        ) : (
          <div className="eod-body">
            <section className="eod-section">
              <h3 className="eod-section-title">
                Today's Missions <span className="eod-count">{data.missions.length}</span>
              </h3>
              {data.missions.length === 0
                ? <p className="eod-empty">No missions ran today.</p>
                : (
                  <div className="eod-mission-list">
                    {data.missions.map(m => (
                      <div key={m.id} className="eod-mission-item">
                        <span className={`eod-status eod-status--${m.status}`} />
                        <span className="eod-mission-title">{m.title || m.goal}</span>
                        <span className="eod-mission-status">{m.status}</span>
                      </div>
                    ))}
                  </div>
                )
              }
            </section>

            <section className="eod-section">
              <h3 className="eod-section-title">
                Lessons Learned <span className="eod-count">{data.lessons.length}</span>
              </h3>
              {data.lessons.length === 0
                ? <p className="eod-empty">No lessons recorded today.</p>
                : (
                  <ul className="eod-lessons">
                    {data.lessons.map((l, i) => (
                      <li key={i} className="eod-lesson">{l.lesson || l.pattern || l}</li>
                    ))}
                  </ul>
                )
              }
            </section>

            <section className="eod-section">
              <h3 className="eod-section-title">Suggestions for Tomorrow</h3>
              <ul className="eod-suggestions">
                {suggestions.map((s, i) => (
                  <li key={i} className="eod-suggestion">
                    <span className="eod-suggestion-num">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        <div className="eod-footer">
          <button className="eod-btn eod-btn--primary" onClick={onClose}>Close Review</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
