import React, { useState } from "react";
import { track } from "../analytics";
import "./MarketplaceCenter.css";

const AGENTS = [
  { id:"a1", name:"Lead Follow-Up Agent",     author:"Ooplix",      category:"Sales",       downloads:3240, rating:4.9, reviews:142, price:"Free",  tag:"official", desc:"Automated WhatsApp follow-up sequences for every stage of your pipeline." },
  { id:"a2", name:"Invoice Generator",        author:"Priya Sharma",category:"Finance",     downloads:1820, rating:4.7, reviews:89,  price:"Free",  tag:"popular",  desc:"Auto-generate PDF invoices from lead data and send via WhatsApp." },
  { id:"a3", name:"Appointment Scheduler",    author:"Dev Kumar",   category:"Operations",  downloads:1104, rating:4.5, reviews:61,  price:"Free",  tag:"new",      desc:"Book calls and demos. Syncs with Google Calendar, sends WhatsApp reminders." },
  { id:"a4", name:"Sentiment Analyzer",       author:"Ooplix Labs", category:"AI",          downloads:672,  rating:4.6, reviews:38,  price:"Pro",   tag:"official", desc:"Analyze customer reply sentiment and escalate hot leads automatically." },
  { id:"a5", name:"Payment Reminder Bot",     author:"Rohan Singh", category:"Finance",     downloads:540,  rating:4.4, reviews:29,  price:"Free",  tag:"popular",  desc:"Send payment reminders on custom schedules via WhatsApp." },
  { id:"a6", name:"Cold Outreach Sequencer",  author:"Arjun Mehta", category:"Sales",       downloads:430,  rating:4.3, reviews:24,  price:"Free",  tag:"new",      desc:"Multi-step outreach sequences with auto-personalization per lead." },
];

const WORKFLOWS = [
  { id:"w1", name:"New Lead → 7-Day Nurture", author:"Ooplix",     downloads:2180, rating:4.8, reviews:97,  price:"Free",  desc:"Full nurture sequence triggered on lead creation. 7 timed touchpoints." },
  { id:"w2", name:"Trial → Paid Conversion",  author:"Priya Sharma",downloads:960, rating:4.7, reviews:54,  price:"Free",  desc:"Automated trial-to-paid journey with objection-handling scripts." },
  { id:"w3", name:"Referral Reward Flow",      author:"Dev Kumar",  downloads:512,  rating:4.5, reviews:31,  price:"Free",  desc:"Detect referral joins, auto-send reward coupons, track conversions." },
  { id:"w4", name:"Proposal → Close Sequence",author:"Fatima Ali", downloads:388,  rating:4.4, reviews:22,  price:"Pro",   desc:"Send proposals via WhatsApp, auto-follow up until signed or declined." },
];

const TEMPLATES = [
  { id:"tp1", name:"High-Converting Follow-Up Messages", author:"Ooplix",      downloads:4100, rating:4.9, reviews:184, price:"Free", desc:"12 battle-tested WhatsApp message templates proven to increase reply rates." },
  { id:"tp2", name:"Proposal Templates Pack",            author:"Priya Sharma",downloads:1760, rating:4.7, reviews:88,  price:"Free", desc:"6 proposal formats for agencies, coaches, freelancers, and consultants." },
  { id:"tp3", name:"Invoice + Receipt Messages",         author:"Rohan Singh", downloads:1240, rating:4.6, reviews:63,  price:"Free", desc:"Ready-to-use invoice notification and payment receipt message templates." },
  { id:"tp4", name:"Objection Handling Scripts",         author:"Arjun Mehta", downloads:890,  rating:4.5, reviews:47,  price:"Free", desc:"14 tested responses to the most common sales objections." },
];

const PROMPTS = [
  { id:"pr1", name:"Lead Qualification Prompt",     author:"Ooplix",       downloads:2640, rating:4.8, reviews:112, price:"Free", desc:"Prompt that extracts lead intent, budget, and timeline from any conversation." },
  { id:"pr2", name:"WhatsApp Reply Generator",      author:"Priya Sharma", downloads:1820, rating:4.7, reviews:79,  price:"Free", desc:"Generate context-aware WhatsApp replies at any stage of the sales cycle." },
  { id:"pr3", name:"Business Summary Prompt",       author:"Dev Kumar",    downloads:1100, rating:4.6, reviews:55,  price:"Free", desc:"Summarize day's activity, pipeline health, and next actions in one shot." },
  { id:"pr4", name:"Cold Outreach Personalizer",    author:"Fatima Ali",   downloads:740,  rating:4.5, reviews:38,  price:"Pro",  desc:"Personalize cold messages using lead profile data for higher open rates." },
];

const INTEGRATIONS = [
  { id:"i1", name:"Google Sheets Sync",       author:"Ooplix",       downloads:3840, rating:4.9, reviews:168, price:"Free", desc:"Bi-directional sync of leads and activity data to any Google Sheet." },
  { id:"i2", name:"Razorpay Payment Events",  author:"Ooplix Labs",  downloads:2210, rating:4.8, reviews:104, price:"Free", desc:"Receive Razorpay payment webhooks and auto-update lead status." },
  { id:"i3", name:"Notion CRM Bridge",        author:"Rohan Singh",  downloads:980,  rating:4.5, reviews:47,  price:"Free", desc:"Push leads and deal stages into your Notion CRM database automatically." },
  { id:"i4", name:"Calendly Booking Trigger", author:"Arjun Mehta",  downloads:760,  rating:4.4, reviews:36,  price:"Free", desc:"Trigger follow-up sequences when a Calendly booking is made or cancelled." },
  { id:"i5", name:"Slack Alerts",             author:"Dev Kumar",    downloads:540,  rating:4.3, reviews:28,  price:"Free", desc:"Post real-time Ooplix activity alerts to your Slack channels." },
];

const SECTIONS = [
  {id:"agents",       label:"Agents"},
  {id:"workflows",    label:"Workflows"},
  {id:"templates",    label:"Templates"},
  {id:"prompts",      label:"Prompts"},
  {id:"integrations", label:"Integrations"},
];

const TAG_COLORS = { official:"var(--accent2)", popular:"var(--success)", new:"var(--accent)", pro:"var(--warning)" };

function ItemCard({ item }) {
  return (
    <div className="mc-item-card">
      <div className="mc-item-header">
        <div className="mc-item-title-row">
          <span className="mc-item-name">{item.name}</span>
          {item.tag && <span className="mc-item-tag" style={{color:TAG_COLORS[item.tag]||"var(--accent2)",borderColor:(TAG_COLORS[item.tag]||"var(--accent2)")+"33"}}>{item.tag}</span>}
          <span className="mc-item-price" style={{color:item.price==="Free"?"var(--success)":"var(--warning)"}}>{item.price}</span>
        </div>
        <span className="mc-item-author">by {item.author}</span>
      </div>
      <p className="mc-item-desc">{item.desc}</p>
      <div className="mc-item-footer">
        <span className="mc-item-stat"><span className="mc-item-sv">{item.downloads.toLocaleString("en-IN")}</span> downloads</span>
        <span className="mc-item-stat"><span className="mc-item-sv" style={{color:"var(--warning)"}}>{"★".repeat(Math.round(item.rating))}</span> {item.rating} ({item.reviews})</span>
        <button className="mc-item-btn" onClick={()=>track.event("marketplace_install",{id:item.id})}>Install</button>
      </div>
    </div>
  );
}

export default function MarketplaceCenter({ onNavigate }) {
  const [section, setSection] = useState("agents");
  const [search,  setSearch]  = useState("");

  React.useEffect(() => { track.event("marketplace_viewed"); }, []);

  const DATA = { agents:AGENTS, workflows:WORKFLOWS, templates:TEMPLATES, prompts:PROMPTS, integrations:INTEGRATIONS };
  const items = (DATA[section] || []).filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.desc.toLowerCase().includes(search.toLowerCase())
  );

  const totalDownloads = Object.values(DATA).flat().reduce((a,i)=>a+i.downloads,0);

  return (
    <div className="marketplace-center page-enter">
      <div className="mc-header">
        <div>
          <h1 className="mc-title">Marketplace</h1>
          <p className="mc-subtitle">Agents · Workflows · Templates · Prompts · Integrations — downloads, ratings, usage, and authors.</p>
        </div>
      </div>

      <div className="mc-summary-strip">
        {[
          { label:"Total agents",      value:AGENTS.length,       color:"var(--accent2)" },
          { label:"Workflows",         value:WORKFLOWS.length,    color:"var(--accent)"  },
          { label:"Templates",         value:TEMPLATES.length,    color:"var(--success)" },
          { label:"Prompts",           value:PROMPTS.length,      color:"var(--text)"    },
          { label:"Integrations",      value:INTEGRATIONS.length, color:"#7c6fff"        },
          { label:"Total downloads",   value:totalDownloads.toLocaleString("en-IN"), color:"var(--warning)" },
        ].map(s=>(
          <div key={s.label} className="mc-summary-tile">
            <span className="mc-sv" style={{color:s.color}}>{s.value}</span>
            <span className="mc-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="mc-search-bar">
        <input
          className="mc-search-input"
          placeholder="Search marketplace…"
          value={search}
          onChange={e=>setSearch(e.target.value)}
        />
        {search && <button className="mc-search-clear" onClick={()=>setSearch("")}>✕</button>}
      </div>

      <div className="mc-tabs">
        {SECTIONS.map(t=>(
          <button key={t.id} className={`mc-tab${section===t.id?" mc-tab--active":""}`} onClick={()=>{setSection(t.id);setSearch("");}}>
            {t.label}
            <span className="mc-tab-count">{DATA[t.id].length}</span>
          </button>
        ))}
      </div>

      <div className="mc-content" key={section}>
        {items.length === 0 ? (
          <div className="mc-empty">No results for "{search}"</div>
        ) : (
          <div className="mc-grid">
            {items.map(item=><ItemCard key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </div>
  );
}
