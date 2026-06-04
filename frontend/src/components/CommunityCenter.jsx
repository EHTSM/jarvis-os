import React, { useState } from "react";
import { track } from "../analytics";
import "./CommunityCenter.css";

const MEMBERS = [
  { id:"m1", name:"Arjun Mehta",    handle:"@arjunm",    role:"Power User",    rep:1240, posts:42, joined:"Jan 2026", avatar:"AM", color:"#4ecdc4" },
  { id:"m2", name:"Priya Sharma",   handle:"@priya_s",   role:"Agency Owner",  rep:980,  posts:31, joined:"Feb 2026", avatar:"PS", color:"#f0b429" },
  { id:"m3", name:"Rohan Singh",    handle:"@rohanops",  role:"Freelancer",    rep:820,  posts:28, joined:"Jan 2026", avatar:"RS", color:"#7c6fff" },
  { id:"m4", name:"Fatima Ali",     handle:"@fatimaa",   role:"Consultant",    rep:640,  posts:19, joined:"Mar 2026", avatar:"FA", color:"#da552f" },
  { id:"m5", name:"Dev Kumar",      handle:"@devkumar",  role:"Power User",    rep:580,  posts:22, joined:"Feb 2026", avatar:"DK", color:"#52d68a" },
  { id:"m6", name:"Sonia Kapoor",   handle:"@sonia_k",   role:"Coach",         rep:460,  posts:15, joined:"Apr 2026", avatar:"SK", color:"#a78bfa" },
  { id:"m7", name:"You",            handle:"@you",       role:"Owner",         rep:120,  posts:4,  joined:"May 2026", avatar:"YO", color:"var(--accent2)", isYou:true },
];

const DISCUSSIONS = [
  { id:"d1", title:"Best follow-up sequence for coaches?",         author:"Priya Sharma",  replies:14, likes:28, views:342, tag:"strategy",    hot:true,  ts:"2h ago"  },
  { id:"d2", title:"WhatsApp number getting flagged — solutions?", author:"Rohan Singh",   replies:22, likes:41, views:518, tag:"technical",   hot:true,  ts:"5h ago"  },
  { id:"d3", title:"How I closed 3 clients in one week using Ooplix",author:"Arjun Mehta",replies:8,  likes:64, views:890, tag:"showcase",    hot:true,  ts:"1d ago"  },
  { id:"d4", title:"Integrating Ooplix with Google Sheets",       author:"Fatima Ali",    replies:11, likes:19, views:210, tag:"integrations",hot:false, ts:"2d ago"  },
  { id:"d5", title:"Feature request: bulk CSV import v2",          author:"Dev Kumar",     replies:7,  likes:33, views:180, tag:"feedback",    hot:false, ts:"3d ago"  },
  { id:"d6", title:"Trial to paid conversion tips",               author:"Sonia Kapoor",  replies:5,  likes:22, views:156, tag:"strategy",    hot:false, ts:"4d ago"  },
];

const SHOWCASES = [
  { id:"sh1", title:"Agency pipeline: 50 leads in 7 days on autopilot", author:"Arjun Mehta",  likes:94, tag:"automation", ts:"3d ago" },
  { id:"sh2", title:"Coach booking system built entirely in Ooplix",    author:"Priya Sharma", likes:71, tag:"workflow",   ts:"5d ago" },
  { id:"sh3", title:"Razorpay + WhatsApp = instant payment collection", author:"Rohan Singh",  likes:58, tag:"payments",   ts:"1w ago" },
];

const CHALLENGES = [
  { id:"ch1", title:"7-Day Follow-Up Streak",      desc:"Send 7 automated follow-ups in 7 days with zero manual work.", prize:"1 month free",      participants:47, ends:"2026-06-10", status:"active"   },
  { id:"ch2", title:"First Paid Client Challenge", desc:"Close your first paid client using Ooplix automation.",       prize:"Growth plan upgrade",participants:89, ends:"2026-06-30", status:"active"   },
  { id:"ch3", title:"100 Leads Milestone",         desc:"Add 100 leads and automate follow-ups for all of them.",      prize:"Featured on homepage",participants:23,ends:"2026-07-15", status:"upcoming" },
];

const EVENTS = [
  { id:"ev1", title:"Ooplix Live: Advanced WhatsApp Automation", type:"webinar", date:"2026-06-12 19:00 IST", registered:124, host:"Ooplix Team"    },
  { id:"ev2", title:"Community AMA — Founder Q&A",              type:"ama",     date:"2026-06-20 20:00 IST", registered:81,  host:"Altamashjauhar" },
  { id:"ev3", title:"Partner Program Launch",                    type:"launch",  date:"2026-07-01",           registered:0,   host:"Ooplix Team"    },
];

const TAG_COLORS = {
  strategy:"var(--accent2)", technical:"var(--danger)", showcase:"var(--success)",
  integrations:"var(--accent)", feedback:"var(--warning)", automation:"var(--accent2)",
  workflow:"#a78bfa", payments:"#52d68a",
};

export default function CommunityCenter({ onNavigate }) {
  const [section, setSection] = useState("discussions");

  React.useEffect(() => { track.event("community_center_viewed"); }, []);

  const totalMembers = MEMBERS.length;
  const hotCount     = DISCUSSIONS.filter(d=>d.hot).length;
  const totalActivity= DISCUSSIONS.reduce((a,d)=>a+d.replies+d.likes,0) + SHOWCASES.reduce((a,s)=>a+s.likes,0);

  return (
    <div className="community-center page-enter">
      <div className="cc-header">
        <div>
          <h1 className="cc-title">Community</h1>
          <p className="cc-subtitle">Discussions · Showcase · Leaderboard · Challenges · Events — members, posts, activity, and reputation.</p>
        </div>
      </div>

      <div className="cc-summary-strip">
        {[
          { label:"Members",          value:totalMembers,                                    color:"var(--accent2)" },
          { label:"Discussions",      value:DISCUSSIONS.length,                              color:"var(--text)"    },
          { label:"Hot topics",       value:hotCount,                                        color:"var(--warning)" },
          { label:"Showcases",        value:SHOWCASES.length,                                color:"var(--success)" },
          { label:"Active challenges",value:CHALLENGES.filter(c=>c.status==="active").length,color:"var(--accent)"  },
          { label:"Total activity",   value:totalActivity,                                   color:"var(--accent2)" },
        ].map(s=>(
          <div key={s.label} className="cc-summary-tile">
            <span className="cc-sv" style={{color:s.color}}>{s.value}</span>
            <span className="cc-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="cc-tabs">
        {[
          {id:"discussions", label:"Discussions"},
          {id:"showcase",    label:"Showcase"},
          {id:"leaderboard", label:"Leaderboard"},
          {id:"challenges",  label:"Challenges"},
          {id:"events",      label:"Events"},
        ].map(t=>(
          <button key={t.id} className={`cc-tab${section===t.id?" cc-tab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="cc-content" key={section}>

        {section==="discussions" && (
          <div className="cc-discussions-list">
            {DISCUSSIONS.map(d=>(
              <div key={d.id} className="cc-disc-row">
                <div className="cc-disc-left">
                  {d.hot && <span className="cc-hot-badge">Hot</span>}
                  <div className="cc-disc-info">
                    <span className="cc-disc-title">{d.title}</span>
                    <div className="cc-disc-meta">
                      <span>{d.author}</span>
                      <span className="cc-disc-tag" style={{color:TAG_COLORS[d.tag]||"var(--text-faint)"}}>#{d.tag}</span>
                      <span>{d.ts}</span>
                    </div>
                  </div>
                </div>
                <div className="cc-disc-stats">
                  <span className="cc-disc-stat"><span className="cc-disc-sv">{d.replies}</span> replies</span>
                  <span className="cc-disc-stat"><span className="cc-disc-sv">{d.likes}</span> likes</span>
                  <span className="cc-disc-stat cc-disc-stat--views">{d.views} views</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {section==="showcase" && (
          <div className="cc-showcase-list">
            {SHOWCASES.map(s=>(
              <div key={s.id} className="cc-showcase-card">
                <div className="cc-sc-header">
                  <span className="cc-sc-tag" style={{color:TAG_COLORS[s.tag]||"var(--accent2)"}}>#{s.tag}</span>
                  <span className="cc-sc-ts">{s.ts}</span>
                </div>
                <p className="cc-sc-title">{s.title}</p>
                <div className="cc-sc-footer">
                  <span className="cc-sc-author">{s.author}</span>
                  <span className="cc-sc-likes">♥ {s.likes}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {section==="leaderboard" && (
          <div className="cc-leaderboard">
            <div className="cc-lb-list">
              {[...MEMBERS].sort((a,b)=>b.rep-a.rep).map((m,i)=>(
                <div key={m.id} className={`cc-lb-row${m.isYou?" cc-lb-row--you":""}`}>
                  <span className="cc-lb-rank" style={{color:i===0?"var(--warning)":i===1?"var(--text-faint)":i===2?"#cd7f32":"var(--text-faint)"}}>
                    {i===0?"#1":i===1?"#2":i===2?"#3":`#${i+1}`}
                  </span>
                  <div className="cc-lb-avatar" style={{background:m.color+"33",color:m.color}}>{m.avatar}</div>
                  <div className="cc-lb-info">
                    <span className="cc-lb-name">{m.name}{m.isYou?" (you)":""}</span>
                    <span className="cc-lb-role">{m.role} · {m.handle}</span>
                  </div>
                  <div className="cc-lb-right">
                    <span className="cc-lb-rep" style={{color:m.color}}>{m.rep.toLocaleString("en-IN")} rep</span>
                    <span className="cc-lb-posts">{m.posts} posts</span>
                    <span className="cc-lb-joined">since {m.joined}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {section==="challenges" && (
          <div className="cc-challenges-list">
            {CHALLENGES.map(c=>(
              <div key={c.id} className={`cc-challenge-card cc-challenge-card--${c.status}`}>
                <div className="cc-ch-header">
                  <span className="cc-ch-status" style={{color:c.status==="active"?"var(--success)":"var(--accent2)",borderColor:(c.status==="active"?"var(--success)":"var(--accent2)")+"33"}}>{c.status}</span>
                  <span className="cc-ch-ends">Ends: {c.ends}</span>
                </div>
                <h3 className="cc-ch-title">{c.title}</h3>
                <p className="cc-ch-desc">{c.desc}</p>
                <div className="cc-ch-footer">
                  <span className="cc-ch-prize">Prize: {c.prize}</span>
                  <span className="cc-ch-participants">{c.participants} participants</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {section==="events" && (
          <div className="cc-events-list">
            {EVENTS.map(e=>(
              <div key={e.id} className="cc-event-card">
                <div className="cc-ev-left">
                  <span className={`cc-ev-type cc-ev-type--${e.type}`}>{e.type}</span>
                  <div className="cc-ev-info">
                    <span className="cc-ev-title">{e.title}</span>
                    <span className="cc-ev-meta">{e.date} · Host: {e.host}</span>
                  </div>
                </div>
                <div className="cc-ev-right">
                  {e.registered > 0 && <span className="cc-ev-reg">{e.registered} registered</span>}
                  <button className="cc-ev-btn" onClick={()=>track.event("community_event_rsvp",{id:e.id})}>RSVP</button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
