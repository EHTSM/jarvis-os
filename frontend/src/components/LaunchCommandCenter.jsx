import React, { useState, useCallback } from "react";
import { track } from "../analytics";
import "./LaunchCommandCenter.css";

// ── Persistence ────────────────────────────────────────────────────────
const TASKS_KEY = "ooplix_launch_tasks";

function _loadTasks() {
  try { return JSON.parse(localStorage.getItem(TASKS_KEY) || "[]"); }
  catch { return []; }
}
function _saveTasks(tasks) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

// ── Launch tracks ──────────────────────────────────────────────────────
const LAUNCH_TRACKS = {

  linkedin: {
    label:  "LinkedIn",
    icon:   "in",
    color:  "#0a66c2",
    tasks: [
      { id: "li_profile",   title: "Optimise Ooplix LinkedIn page",          desc: "Add logo, banner, tagline, and website link",             priority: "high" },
      { id: "li_post1",     title: "Founder story post",                      desc: "Share the origin story — why Ooplix was built",           priority: "high" },
      { id: "li_post2",     title: "Problem/value post",                      desc: "Cost of manual follow-up — position automation as fix",   priority: "high" },
      { id: "li_post3",     title: "Feature walkthrough post",                desc: "Show the WhatsApp automation flow in 3 steps",            priority: "medium"},
      { id: "li_thread1",   title: "Engage in 5 SMB/freelancer posts daily",  desc: "Comment with value before promoting",                     priority: "medium"},
      { id: "li_collab",    title: "Find 3 collaborators for reposts",        desc: "Creators, agencies, consultants in your niche",           priority: "low"  },
    ],
  },

  blog: {
    label:  "Blog",
    icon:   "◎",
    color:  "var(--accent)",
    tasks: [
      { id: "blog_setup",   title: "Set up blog (Ghost, Hashnode, or Medium)", desc: "Use ooplix.com/blog or a subdomain",                     priority: "high" },
      { id: "blog_post1",   title: "Publish: WhatsApp follow-up automation",   desc: "Target keyword: 4,400 monthly searches",                priority: "high" },
      { id: "blog_post2",   title: "Publish: AI CRM for freelancers India",    desc: "Target keyword: 1,900 monthly searches",                priority: "high" },
      { id: "blog_post3",   title: "Publish: Razorpay automation guide",       desc: "Informational — high backlink potential",               priority: "medium"},
      { id: "blog_schema",  title: "Add Article schema to all posts",          desc: "Structured data for Google rich results",               priority: "medium"},
      { id: "blog_internal",title: "Internal link from landing to each post",  desc: "Pass authority and improve crawl depth",                priority: "low"  },
    ],
  },

  newsletter: {
    label:  "Newsletter",
    icon:   "✉",
    color:  "var(--warning)",
    tasks: [
      { id: "nl_esp",       title: "Set up ESP (Brevo or Mailchimp)",          desc: "Free tier covers launch phase",                         priority: "high" },
      { id: "nl_welcome",   title: "Write and test welcome email",             desc: "Send to yourself first",                                priority: "high" },
      { id: "nl_signup",    title: "Add signup form to landing page",          desc: "Above the fold and at bottom CTA",                     priority: "high" },
      { id: "nl_issue1",    title: "Publish Issue #1",                         desc: "Founder note + Ooplix origin + what's coming",         priority: "medium"},
      { id: "nl_cadence",   title: "Set monthly send schedule",               desc: "Same day/time every month builds open rate habit",      priority: "medium"},
      { id: "nl_double",    title: "Confirm double opt-in is enabled",        desc: "Required for legal compliance and list quality",        priority: "high" },
    ],
  },

  outreach: {
    label:  "Outreach",
    icon:   "◈",
    color:  "var(--accent2)",
    tasks: [
      { id: "out_list",     title: "Build list of 50 target prospects",       desc: "Freelancers, coaches, agencies in India",               priority: "high" },
      { id: "out_template", title: "Write personalised outreach template",    desc: "1:1 feel — reference their specific work",             priority: "high" },
      { id: "out_10",       title: "Send first 10 personalised outreach DMs", desc: "LinkedIn DM or cold email",                            priority: "high" },
      { id: "out_followup", title: "Follow up on all unreplied messages",     desc: "80% of replies come after the first follow-up",        priority: "medium"},
      { id: "out_calls",    title: "Book 5 discovery calls",                  desc: "15-min call to understand their follow-up problem",    priority: "medium"},
      { id: "out_community",title: "Join 3 relevant communities",             desc: "WhatsApp groups, Telegram, LinkedIn Groups",           priority: "low"  },
    ],
  },

  producthunt: {
    label:  "Product Hunt",
    icon:   "⬟",
    color:  "#da552f",
    tasks: [
      { id: "ph_account",   title: "Create Product Hunt account",              desc: "Use founder email — activity builds credibility",       priority: "high" },
      { id: "ph_hunter",    title: "Find an established hunter to post",       desc: "Hunters with 1000+ followers increase visibility",      priority: "high" },
      { id: "ph_assets",    title: "Prepare all PH assets",                   desc: "Logo, screenshots, tagline, description, video",        priority: "high" },
      { id: "ph_gallery",   title: "Prepare 5 product screenshots",           desc: "Control Center, pipeline, WhatsApp feed, settings",    priority: "high" },
      { id: "ph_teaser",    title: "Post 3 teaser comments in community",     desc: "Builds awareness before launch day",                   priority: "medium"},
      { id: "ph_squad",     title: "Build 30-person support squad",           desc: "Friends, users, and community members to upvote",      priority: "high" },
      { id: "ph_schedule",  title: "Schedule launch for Tuesday 12:01am PST", desc: "Most activity happens Tue–Thu",                        priority: "high" },
      { id: "ph_response",  title: "Prepare comment response templates",      desc: "Answer: pricing, WhatsApp, India focus, trial",        priority: "medium"},
    ],
  },

  directories: {
    label:  "Directories",
    icon:   "◇",
    color:  "var(--success)",
    tasks: [
      { id: "dir_g2",       title: "Submit to G2",                            desc: "SaaS review platform — high domain authority",          priority: "high" },
      { id: "dir_capterra", title: "Submit to Capterra",                      desc: "CRM and automation category",                           priority: "high" },
      { id: "dir_appsumo",  title: "Apply to AppSumo marketplace",            desc: "Lifetime deal generates email list + revenue",          priority: "high" },
      { id: "dir_saasgenius",title: "List on SaaSGenius",                    desc: "India-specific SaaS directory",                        priority: "medium"},
      { id: "dir_toolify",  title: "Submit to Toolify.ai",                    desc: "AI tools directory — growing traffic",                  priority: "medium"},
      { id: "dir_futurepedia",title: "Submit to Futurepedia",                 desc: "Top AI tool discovery platform",                       priority: "medium"},
      { id: "dir_theresanaiforthat",title: "Submit to There's An AI For That",desc: "High-traffic AI discovery site",                       priority: "medium"},
      { id: "dir_betalist",  title: "Submit to BetaList",                    desc: "Early-stage product discovery",                        priority: "low"  },
      { id: "dir_saashub",  title: "Submit to SaaSHub",                      desc: "Alternative-to directory with SEO value",              priority: "low"  },
    ],
  },

};

// ── Metrics placeholders ──────────────────────────────────────────────
const LAUNCH_METRICS = [
  { label: "Total tasks",    getValue: tasks => tasks.length                           },
  { label: "Done",          getValue: tasks => tasks.filter(t=>t.done).length          },
  { label: "In progress",   getValue: tasks => tasks.filter(t=>t.inProgress).length    },
  { label: "Completion",    getValue: tasks => {
    if (!tasks.length) return "0%";
    return Math.round((tasks.filter(t=>t.done).length / tasks.length) * 100) + "%";
  }},
];

// ── Task row ──────────────────────────────────────────────────────────
function TaskRow({ task, overrideState, onToggleDone, onToggleInProgress }) {
  const done       = overrideState?.done       ?? false;
  const inProgress = overrideState?.inProgress ?? false;

  return (
    <div className={`lcc-task${done ? " lcc-task--done" : ""}${inProgress ? " lcc-task--inprogress" : ""}`}>
      <div className="lcc-task-left">
        <button
          className={`lcc-task-check${done ? " lcc-task-check--done" : ""}`}
          onClick={onToggleDone}
          title="Mark complete"
        >
          {done ? "✓" : ""}
        </button>
        <div className="lcc-task-body">
          <span className="lcc-task-title">{task.title}</span>
          <span className="lcc-task-desc">{task.desc}</span>
        </div>
      </div>
      <div className="lcc-task-right">
        <span className={`lcc-priority lcc-priority--${task.priority}`}>{task.priority}</span>
        <button
          className={`lcc-task-wip${inProgress ? " lcc-task-wip--active" : ""}`}
          onClick={onToggleInProgress}
          title="Mark in progress"
        >
          {inProgress ? "●" : "○"}
        </button>
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────
export default function LaunchCommandCenter({ onNavigate }) {
  const [track_,    setTrack]    = useState("linkedin");
  const [taskState, setTaskState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TASKS_KEY) || "{}"); }
    catch { return {}; }
  });

  React.useEffect(() => { track.event("launch_center_viewed"); }, []);

  const toggleDone = useCallback((taskId) => {
    setTaskState(prev => {
      const next = { ...prev, [taskId]: { ...prev[taskId], done: !prev[taskId]?.done } };
      localStorage.setItem(TASKS_KEY, JSON.stringify(next));
      if (!prev[taskId]?.done) track.event("launch_task_completed", { task: taskId });
      return next;
    });
  }, []);

  const toggleInProgress = useCallback((taskId) => {
    setTaskState(prev => {
      const next = { ...prev, [taskId]: { ...prev[taskId], inProgress: !prev[taskId]?.inProgress } };
      localStorage.setItem(TASKS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Global stats across all tracks
  const allTasks = Object.values(LAUNCH_TRACKS).flatMap(t => t.tasks);
  const doneAll  = allTasks.filter(t => taskState[t.id]?.done).length;
  const pct      = Math.round((doneAll / allTasks.length) * 100);

  const currentTrack = LAUNCH_TRACKS[track_];
  const trackDone    = currentTrack.tasks.filter(t => taskState[t.id]?.done).length;

  return (
    <div className="launch-center page-enter">

      <div className="lcc-header">
        <div>
          <h1 className="lcc-title">Launch Command Center</h1>
          <p className="lcc-subtitle">Every distribution task, tracked in one place.</p>
        </div>
        <div className="lcc-global-progress">
          <span className="lcc-gp-num" style={{ color: pct === 100 ? "var(--success)" : "var(--accent2)" }}>{pct}%</span>
          <span className="lcc-gp-label">Launch complete</span>
        </div>
      </div>

      {/* Global progress bar */}
      <div className="lcc-progress-strip">
        <div className="lcc-progress-track">
          <div
            className="lcc-progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="lcc-progress-count">{doneAll} / {allTasks.length} tasks</span>
      </div>

      {/* Track summary chips */}
      <div className="lcc-track-summary">
        {Object.entries(LAUNCH_TRACKS).map(([key, t]) => {
          const done = t.tasks.filter(tk => taskState[tk.id]?.done).length;
          const pct_ = Math.round((done / t.tasks.length) * 100);
          return (
            <button
              key={key}
              className={`lcc-track-chip${track_ === key ? " lcc-track-chip--active" : ""}`}
              style={track_ === key ? { borderColor: t.color + "66", color: t.color } : {}}
              onClick={() => setTrack(key)}
            >
              <span className="lcc-track-chip-icon" style={{ color: t.color }}>{t.icon}</span>
              <span className="lcc-track-chip-name">{t.label}</span>
              <span className="lcc-track-chip-pct">{pct_}%</span>
            </button>
          );
        })}
      </div>

      {/* Active track tasks */}
      <div className="lcc-track-panel">
        <div className="lcc-track-header">
          <div className="lcc-track-name-row">
            <span className="lcc-track-icon" style={{ color: currentTrack.color }}>{currentTrack.icon}</span>
            <h2 className="lcc-track-name">{currentTrack.label}</h2>
          </div>
          <span className="lcc-track-progress">{trackDone}/{currentTrack.tasks.length} done</span>
        </div>
        <div className="lcc-tasks-list">
          {currentTrack.tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              overrideState={taskState[task.id]}
              onToggleDone={() => toggleDone(task.id)}
              onToggleInProgress={() => toggleInProgress(task.id)}
            />
          ))}
        </div>
      </div>

      {/* Priority filter legend */}
      <div className="lcc-legend">
        <span className="lcc-legend-label">Priority:</span>
        <span className="lcc-priority lcc-priority--high">high</span>
        <span className="lcc-priority lcc-priority--medium">medium</span>
        <span className="lcc-priority lcc-priority--low">low</span>
        <span className="lcc-legend-sep">·</span>
        <span className="lcc-legend-hint">● = in progress · ✓ = complete</span>
      </div>

    </div>
  );
}
