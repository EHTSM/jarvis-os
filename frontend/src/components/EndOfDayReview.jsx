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
      const missions = (missionsData.missions || [])
        .filter(m => m.updatedAt?.startsWith(today) || m.createdAt?.startsWith(today))
        .slice(0, 8);
      const lessons = (lessonsData.lessons || lessonsData || []).slice(0, 5);
      const signals = intelData.signals?.slice(0, 3) || [];
      setData({ missions, lessons, signals, date: today });
      setLoading(false);
    });
  }, []);

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
