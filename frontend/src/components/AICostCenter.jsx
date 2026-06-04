import React, { useState } from "react";
import { track } from "../analytics";
import "./AICostCenter.css";

const PROVIDERS = [
  {
    id:"openrouter", name:"OpenRouter", type:"hosted", logo:"OR",
    color:"#a78bfa",
    models:[
      {name:"claude-3-haiku",  requests:1840, tokens:2_180_000, cost:1.09, rpm:60},
      {name:"gpt-4o-mini",     requests:920,  tokens:840_000,   cost:0.84, rpm:45},
      {name:"llama-3-8b",      requests:640,  tokens:720_000,   cost:0.22, rpm:80},
    ],
    monthlyCost:  2.15,
    monthlyForecast: 7.20,
    savings:      0.88,
    status:"active",
  },
  {
    id:"ollama", name:"Ollama", type:"local", logo:"OL",
    color:"#52d68a",
    models:[
      {name:"llama3:8b",        requests:3120, tokens:4_640_000, cost:0, rpm:120},
      {name:"mistral:7b",       requests:1880, tokens:2_210_000, cost:0, rpm:90},
      {name:"phi3:mini",        requests:740,  tokens:580_000,   cost:0, rpm:200},
    ],
    monthlyCost:  0,
    monthlyForecast: 0,
    savings:      14.40,
    status:"active",
  },
  {
    id:"deepseek", name:"DeepSeek", type:"hosted", logo:"DS",
    color:"#4ecdc4",
    models:[
      {name:"deepseek-chat",    requests:480,  tokens:1_120_000, cost:0.17, rpm:60},
      {name:"deepseek-coder",   requests:210,  tokens:480_000,   cost:0.07, rpm:40},
    ],
    monthlyCost:  0.24,
    monthlyForecast: 0.80,
    savings:      2.10,
    status:"active",
  },
  {
    id:"qwen", name:"Qwen", type:"hosted", logo:"QW",
    color:"#f0b429",
    models:[
      {name:"qwen2-72b-instruct",requests:320, tokens:860_000,   cost:0.26, rpm:40},
      {name:"qwen2-7b-instruct", requests:180, tokens:340_000,   cost:0.04, rpm:80},
    ],
    monthlyCost:  0.30,
    monthlyForecast: 1.00,
    savings:      0.90,
    status:"active",
  },
  {
    id:"llama", name:"Llama (Meta)", type:"local", logo:"LL",
    color:"#da552f",
    models:[
      {name:"llama-3.1-70b",    requests:840,  tokens:1_920_000, cost:0, rpm:30},
      {name:"llama-3-8b",       requests:1640, tokens:2_880_000, cost:0, rpm:120},
    ],
    monthlyCost:  0,
    monthlyForecast: 0,
    savings:      8.20,
    status:"active",
  },
];

const ROUTING_RULES = [
  { id:"rr1", condition:"Token count < 2,000",       route:"Ollama llama3:8b",    reason:"Free local inference for short tasks" },
  { id:"rr2", condition:"Code generation request",   route:"Ollama mistral:7b",   reason:"Fast local code model" },
  { id:"rr3", condition:"Sentiment / classification",route:"DeepSeek chat",       reason:"Cheapest hosted model, high accuracy" },
  { id:"rr4", condition:"Customer-facing reply",     route:"OpenRouter claude-3-haiku",reason:"Quality-first for external messages" },
  { id:"rr5", condition:"Long-form generation >8k",  route:"Qwen2-72b-instruct",  reason:"Best cost/quality for long outputs" },
  { id:"rr6", condition:"Fallback (offline local)",  route:"Llama-3.1-70b local", reason:"Zero-cost fallback when hosted rate-limited" },
];

const BUDGET_ALERTS = [
  { id:"ba1", provider:"All",        threshold:10, current:2.69, status:"ok"      },
  { id:"ba2", provider:"OpenRouter", threshold:5,  current:2.15, status:"ok"      },
  { id:"ba3", provider:"DeepSeek",   threshold:1,  current:0.24, status:"ok"      },
  { id:"ba4", provider:"Qwen",       threshold:0.5,current:0.30, status:"warning" },
];

const MONTHLY_SPEND = [
  {month:"Jan", cost:0.00}, {month:"Feb", cost:0.00}, {month:"Mar", cost:0.42},
  {month:"Apr", cost:1.18}, {month:"May", cost:2.40}, {month:"Jun", cost:2.69},
];

const OPTIMIZATIONS = [
  { id:"o1", title:"Route 43% more tasks to Ollama",       saving:"$1.20/mo", effort:"Low",  detail:"Short-prompt tasks currently hitting OpenRouter can run locally." },
  { id:"o2", title:"Enable Qwen caching for repeat prompts",saving:"$0.15/mo", effort:"Low",  detail:"17% of Qwen requests are near-duplicates. Semantic cache would eliminate them." },
  { id:"o3", title:"Switch DeepSeek coder → Ollama phi3",   saving:"$0.07/mo", effort:"Low",  detail:"phi3:mini performs equivalently on your code tasks at zero cost." },
  { id:"o4", title:"Batch classification requests",          saving:"$0.22/mo", effort:"Medium",detail:"Group up to 20 classification calls per batch to cut per-request overhead." },
];

const SECTIONS = [
  {id:"overview",    label:"Overview"},
  {id:"providers",   label:"Providers"},
  {id:"routing",     label:"Model Routing"},
  {id:"budget",      label:"Budget & Alerts"},
  {id:"optimize",    label:"Optimizations"},
];

function fmt(n) { return n.toLocaleString("en-IN"); }
function fmtTok(n) { return n >= 1_000_000 ? (n/1_000_000).toFixed(2)+"M" : n >= 1000 ? (n/1000).toFixed(0)+"K" : n; }

export default function AICostCenter({ onNavigate }) {
  const [section, setSection] = useState("overview");
  const [selProvider, setSelProvider] = useState(null);

  React.useEffect(() => { track.event("ai_cost_center_viewed"); }, []);

  const totalCost       = PROVIDERS.reduce((a,p)=>a+p.monthlyCost, 0);
  const totalSavings    = PROVIDERS.reduce((a,p)=>a+p.savings, 0);
  const totalRequests   = PROVIDERS.flatMap(p=>p.models).reduce((a,m)=>a+m.requests, 0);
  const totalTokens     = PROVIDERS.flatMap(p=>p.models).reduce((a,m)=>a+m.tokens, 0);
  const localProviders  = PROVIDERS.filter(p=>p.type==="local");
  const hostedProviders = PROVIDERS.filter(p=>p.type==="hosted");
  const localReqs       = localProviders.flatMap(p=>p.models).reduce((a,m)=>a+m.requests,0);
  const localPct        = Math.round(localReqs/totalRequests*100);
  const forecastTotal   = PROVIDERS.reduce((a,p)=>a+p.monthlyForecast, 0);

  return (
    <div className="ai-cost-center page-enter">
      <div className="acc-header">
        <div>
          <h1 className="acc-title">AI Cost Management</h1>
          <p className="acc-subtitle">OpenRouter · Ollama · DeepSeek · Qwen · Llama — requests, tokens, cost, savings, routing, and budget.</p>
        </div>
      </div>

      <div className="acc-summary-strip">
        {[
          { label:"Month-to-date cost", value:`$${totalCost.toFixed(2)}`,       color:"var(--text)"    },
          { label:"Monthly forecast",   value:`$${forecastTotal.toFixed(2)}`,   color:"var(--accent2)" },
          { label:"Total savings",      value:`$${totalSavings.toFixed(2)}`,    color:"var(--success)" },
          { label:"Total requests",     value:fmt(totalRequests),               color:"var(--accent)"  },
          { label:"Total tokens",       value:fmtTok(totalTokens),             color:"#7c6fff"        },
          { label:"Local inference",    value:`${localPct}%`,                   color:"#52d68a"        },
        ].map(s=>(
          <div key={s.label} className="acc-summary-tile">
            <span className="acc-sv" style={{color:s.color}}>{s.value}</span>
            <span className="acc-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="acc-tabs">
        {SECTIONS.map(t=>(
          <button key={t.id} className={`acc-tab${section===t.id?" acc-tab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="acc-content" key={section}>

        {section==="overview" && (
          <div className="acc-overview">
            <div className="acc-ov-row">
              <div className="acc-ov-card acc-ov-card--compare">
                <p className="acc-ov-label">Local vs Hosted</p>
                <div className="acc-compare-grid">
                  <div className="acc-compare-col acc-compare-col--local">
                    <span className="acc-compare-label">Local</span>
                    <span className="acc-compare-cost" style={{color:"#52d68a"}}>$0.00</span>
                    <span className="acc-compare-reqs">{fmt(localReqs)} req</span>
                    <span className="acc-compare-pct">{localPct}% of traffic</span>
                    <ul className="acc-compare-list">
                      {localProviders.map(p=><li key={p.id} style={{color:p.color}}>{p.name}</li>)}
                    </ul>
                  </div>
                  <div className="acc-compare-divider" />
                  <div className="acc-compare-col acc-compare-col--hosted">
                    <span className="acc-compare-label">Hosted</span>
                    <span className="acc-compare-cost" style={{color:"var(--warning)"}}>$2.69</span>
                    <span className="acc-compare-reqs">{fmt(totalRequests-localReqs)} req</span>
                    <span className="acc-compare-pct">{100-localPct}% of traffic</span>
                    <ul className="acc-compare-list">
                      {hostedProviders.map(p=><li key={p.id} style={{color:p.color}}>{p.name}</li>)}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="acc-ov-card">
                <p className="acc-ov-label">Monthly spend trend</p>
                <div className="acc-spend-bars">
                  {MONTHLY_SPEND.map(m=>{
                    const max = Math.max(...MONTHLY_SPEND.map(x=>x.cost), 0.01);
                    const h = Math.max(m.cost/max*100, 2);
                    return (
                      <div key={m.month} className="acc-spend-bar-col">
                        <span className="acc-spend-val">{m.cost>0?`$${m.cost.toFixed(2)}`:"—"}</span>
                        <div className="acc-spend-bar-track">
                          <div className="acc-spend-bar-fill" style={{height:`${h}%`,background:m.month==="Jun"?"var(--accent2)":"rgba(255,255,255,.18)"}} />
                        </div>
                        <span className="acc-spend-month">{m.month}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="acc-forecast-line">
                  Forecast: <strong style={{color:"var(--accent2)"}}>$9.00/mo</strong> by Aug 2026 at current growth
                </div>
              </div>
            </div>

            <div className="acc-provider-summary-list">
              {PROVIDERS.map(p=>{
                const reqs = p.models.reduce((a,m)=>a+m.requests,0);
                const toks = p.models.reduce((a,m)=>a+m.tokens,0);
                return (
                  <div key={p.id} className="acc-prov-row" onClick={()=>{setSection("providers");setSelProvider(p.id);}}>
                    <div className="acc-prov-logo" style={{background:p.color+"22",color:p.color}}>{p.logo}</div>
                    <div className="acc-prov-info">
                      <span className="acc-prov-name">{p.name}</span>
                      <span className="acc-prov-type">{p.type}</span>
                    </div>
                    <span className="acc-prov-reqs">{fmt(reqs)} req</span>
                    <span className="acc-prov-toks">{fmtTok(toks)}</span>
                    <span className="acc-prov-cost" style={{color:p.monthlyCost===0?"#52d68a":"var(--text)"}}>
                      {p.monthlyCost===0?"Free":`$${p.monthlyCost.toFixed(2)}`}
                    </span>
                    <span className="acc-prov-savings" style={{color:"var(--success)"}}>-${p.savings.toFixed(2)} saved</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {section==="providers" && (
          <div className="acc-providers">
            <div className="acc-prov-selector">
              {PROVIDERS.map(p=>(
                <button key={p.id} className={`acc-prov-btn${selProvider===p.id?" acc-prov-btn--active":""}`}
                  style={selProvider===p.id?{borderColor:p.color,color:p.color}:{}}
                  onClick={()=>setSelProvider(selProvider===p.id?null:p.id)}>
                  <span className="acc-prov-btn-logo" style={{background:p.color+"22",color:p.color}}>{p.logo}</span>
                  {p.name}
                  <span className="acc-prov-btn-type">{p.type}</span>
                </button>
              ))}
            </div>

            {(selProvider ? PROVIDERS.filter(p=>p.id===selProvider) : PROVIDERS).map(p=>(
              <div key={p.id} className="acc-provider-card">
                <div className="acc-pc-header">
                  <div className="acc-pc-logo" style={{background:p.color+"22",color:p.color}}>{p.logo}</div>
                  <div>
                    <span className="acc-pc-name">{p.name}</span>
                    <span className="acc-pc-type-badge" style={{background:p.type==="local"?"#52d68a22":"var(--accent2)22",color:p.type==="local"?"#52d68a":"var(--accent2)"}}>{p.type}</span>
                  </div>
                  <div className="acc-pc-cost-block">
                    <span className="acc-pc-cost-val" style={{color:p.monthlyCost===0?"#52d68a":"var(--text)"}}>
                      {p.monthlyCost===0?"$0.00 (Free)":`$${p.monthlyCost.toFixed(2)}`}
                    </span>
                    <span className="acc-pc-cost-label">MTD cost</span>
                  </div>
                  <div className="acc-pc-cost-block">
                    <span className="acc-pc-cost-val" style={{color:"var(--success)"}}>+${p.savings.toFixed(2)}</span>
                    <span className="acc-pc-cost-label">saved vs GPT-4o</span>
                  </div>
                </div>
                <div className="acc-pc-model-list">
                  {p.models.map(m=>(
                    <div key={m.name} className="acc-pc-model-row">
                      <span className="acc-pc-model-name">{m.name}</span>
                      <span className="acc-pc-model-req">{fmt(m.requests)} req</span>
                      <span className="acc-pc-model-tok">{fmtTok(m.tokens)} tokens</span>
                      <span className="acc-pc-model-cost" style={{color:m.cost===0?"#52d68a":"var(--text)"}}>
                        {m.cost===0?"Free":`$${m.cost.toFixed(2)}`}
                      </span>
                      <span className="acc-pc-model-rpm">{m.rpm} rpm</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {section==="routing" && (
          <div className="acc-routing">
            <div className="acc-routing-intro">
              <p className="acc-routing-desc">Model routing automatically selects the cheapest capable model for each request type. Rules are evaluated top-to-bottom — first match wins.</p>
            </div>
            <div className="acc-routing-list">
              {ROUTING_RULES.map((r,i)=>(
                <div key={r.id} className="acc-routing-row">
                  <span className="acc-routing-num">{i+1}</span>
                  <div className="acc-routing-cond">
                    <span className="acc-routing-cond-label">IF</span>
                    <span className="acc-routing-cond-val">{r.condition}</span>
                  </div>
                  <span className="acc-routing-arrow">→</span>
                  <div className="acc-routing-target">
                    <span className="acc-routing-target-label">ROUTE TO</span>
                    <span className="acc-routing-target-val" style={{color:"var(--accent2)"}}>{r.route}</span>
                  </div>
                  <span className="acc-routing-reason">{r.reason}</span>
                </div>
              ))}
            </div>
            <div className="acc-routing-stats">
              <div className="acc-routing-stat">
                <span className="acc-routing-stat-val" style={{color:"#52d68a"}}>{localPct}%</span>
                <span className="acc-routing-stat-label">routed to local</span>
              </div>
              <div className="acc-routing-stat">
                <span className="acc-routing-stat-val" style={{color:"var(--accent2)"}}>{100-localPct}%</span>
                <span className="acc-routing-stat-label">routed to hosted</span>
              </div>
              <div className="acc-routing-stat">
                <span className="acc-routing-stat-val" style={{color:"var(--success)"}}>$26.48</span>
                <span className="acc-routing-stat-label">saved vs all-GPT-4o</span>
              </div>
            </div>
          </div>
        )}

        {section==="budget" && (
          <div className="acc-budget">
            <div className="acc-budget-list">
              {BUDGET_ALERTS.map(b=>{
                const pct = Math.min(b.current/b.threshold*100,100);
                return (
                  <div key={b.id} className={`acc-budget-row acc-budget-row--${b.status}`}>
                    <div className="acc-budget-info">
                      <span className="acc-budget-provider">{b.provider}</span>
                      <span className="acc-budget-threshold">Budget: ${b.threshold.toFixed(2)}/mo</span>
                    </div>
                    <div className="acc-budget-bar-wrap">
                      <div className="acc-budget-bar-track">
                        <div className="acc-budget-bar-fill"
                          style={{width:`${pct}%`,background:b.status==="warning"?"var(--warning)":b.status==="critical"?"var(--danger)":"var(--success)"}}
                        />
                      </div>
                      <span className="acc-budget-pct">{pct.toFixed(0)}%</span>
                    </div>
                    <span className="acc-budget-current" style={{color:b.status==="warning"?"var(--warning)":"var(--text)"}}>${b.current.toFixed(2)}</span>
                    <span className={`acc-budget-status acc-budget-status--${b.status}`}>{b.status}</span>
                  </div>
                );
              })}
            </div>
            <div className="acc-budget-note">
              <span className="acc-budget-note-icon">!</span>
              Alerts fire via Slack + email when spend crosses 80% of threshold.
            </div>
            <div className="acc-forecast-card">
              <p className="acc-forecast-title">Monthly spend forecast</p>
              <div className="acc-forecast-grid">
                {PROVIDERS.map(p=>(
                  <div key={p.id} className="acc-forecast-item">
                    <span className="acc-forecast-name" style={{color:p.color}}>{p.name}</span>
                    <span className="acc-forecast-val">{p.monthlyForecast===0?"Free":`$${p.monthlyForecast.toFixed(2)}`}</span>
                  </div>
                ))}
                <div className="acc-forecast-item acc-forecast-item--total">
                  <span className="acc-forecast-name">Total</span>
                  <span className="acc-forecast-val" style={{color:"var(--accent2)"}}>${forecastTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {section==="optimize" && (
          <div className="acc-optimize">
            <div className="acc-optimize-header">
              <span className="acc-optimize-total-saving">
                Total potential savings: <strong style={{color:"var(--success)"}}>$1.64/mo</strong>
              </span>
            </div>
            <div className="acc-optimize-list">
              {OPTIMIZATIONS.map(o=>(
                <div key={o.id} className="acc-optimize-card">
                  <div className="acc-opt-top">
                    <span className="acc-opt-title">{o.title}</span>
                    <span className="acc-opt-saving" style={{color:"var(--success)"}}>{o.saving}</span>
                    <span className="acc-opt-effort" style={{color:o.effort==="Low"?"var(--success)":"var(--warning)"}}>{o.effort} effort</span>
                  </div>
                  <p className="acc-opt-detail">{o.detail}</p>
                  <button className="acc-opt-btn" onClick={()=>track.event("ai_cost_optimize_apply",{id:o.id})}>Apply</button>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
