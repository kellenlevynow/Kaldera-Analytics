import json, random, itertools
random.seed(7)
OUT="/home/user/Kaldera-Analytics/gauntlet/"

# ---------- inputs (K) ----------
K=dict(K1=0.5,K2=60,K3=None,K4=3,K5=0.20,K6="proposals.kaldera-analytics.com",K7=None,K8=None,K9=False,K10="Mid-November 2026",K11=None)
F15_MONTH=7387.0
SE_RATE=0.153; SE_BASE=0.9235
STEADY_HOURS=12; M1_HOURS=19   # advisor-hours modeled per client
HOURS_90=M1_HOURS+2*STEADY_HOURS  # 62

def per_advisor_net(monthly_fee, inspection_fee=0, discount=0.0):
    rev90=monthly_fee*3*(1-discount)+inspection_fee
    gross=rev90/3*K["K1"]
    se=gross*SE_BASE*SE_RATE
    inc=(gross-se/2)*K["K5"]
    return round(gross-se-inc)

# ---------- candidate ----------
LEVERS=dict(
  fee=[4000+250*i for i in range(7)],
  hours=[4,5,6,8], hours_def=["joint","advisor"],
  response=[1,2], billing=["monthly","prepaid3"], discount=[0,0.03,0.05,0.07],
  inspection=[0,1500,2500,3500,5000], rescope=[False,True], hiring=[True,False],
  value_line=["covers","none"])
BASE=dict(fee=5000,hours=6,hours_def="joint",response=2,billing="monthly",discount=0,
          inspection=1500,rescope=True,hiring=True,value_line="covers")

def advisor_hours_sold(c): return c["hours"]*(2 if c["hours_def"]=="joint" else 1)
def rev90(c): return c["fee"]*3*(1-(c["discount"] if c["billing"]=="prepaid3" else 0))+c["inspection"]
def eff_rate_modeled(c): return rev90(c)/HOURS_90
def eff_rate_sold(c): return c["fee"]/advisor_hours_sold(c)

def gates(c):
    fails=[]
    if c["billing"]=="monthly" and c["discount"]>0: fails.append("G4: a discount without prepaid-only billing is a second option")
    if c["billing"]=="prepaid3" and c["discount"]==0: fails.append("G4/G3: prepaid with no discount is just a worse baseline; dropped as redundant")
    sold=advisor_hours_sold(c)
    if sold<STEADY_HOURS-2 and c["hiring"]: fails.append(f"G6: {sold} advisor-hours sold vs {STEADY_HOURS} modeled (hiring support included)")
    if sold<STEADY_HOURS-5: fails.append(f"G6: {sold} advisor-hours sold cannot cover the model")
    # capacity at K4 clients
    need=K["K4"]*max(STEADY_HOURS,sold)
    if need>2*K["K2"]: fails.append("G6: capacity exceeded at K4 clients")
    return fails

def objections(c):
    """returns list of (n, passed, answer)"""
    r=[]
    r.append((1,True,"The role is one seat. Here Mira Home gets two lead advisors who have both worked in these accounts, and you still hire the specialist you need. Advice and a hire, not one or the other."))
    r.append((2,c["value_line"]=="covers","The fee buys the decisions that protect CAC while spend grows: catching every lead, tracing every dollar, and guardrails agreed before launch. Scope only moves when the step before it holds." if c["value_line"]=="covers" else "No value line on the page; the candidate has nothing to point to."))
    r.append((3,c["hiring"],"Different jobs. The specialist runs the accounts every day. We help you hire and onboard the right one, then become their sounding board, so the first months of a new hire are not spent learning alone." if c["hiring"] else "Candidate excludes hiring support, so the fee and the hire are unconnected."))
    r.append((4,True,"The first 90 days are one plan, inspect, treat, protect, timed to be ready before the spring season. Month to month breaks that plan. At day 90 we agree terms that fit what you have learned."))
    r.append((5,True,"An agency sells hours of execution and is paid more when you spend more. Your team keeps the accounts, your specialist runs them, and our advice has no stake in the spend. That is what keeps the advice honest."))
    if c["fee"]>=4750:
        r.append((6,True,"We can scope smaller, fewer advisory hours or one advisor in the sessions, and the price follows. We would not take the full scope at that price, because it would mean less preparation for each session."))
    else:
        r.append((6,True,"Already near that price; the answer is the scope list on the page."))
    r.append((7,True,"Southern markets wake first, around February, so a spring launch is prepared in winter. The inspection, tracking and guardrails take the first weeks. Starting now means launching into the season ready, not into it."))
    return r

def score(c):
    s={}; why={}
    sold=advisor_hours_sold(c); rate_sold=eff_rate_sold(c); rate_mod=eff_rate_modeled(c)
    obj=objections(c); fails=sum(1 for _,p,_ in obj if not p)
    # --- Client acceptance (E1,E2)
    a=7.0
    r90=rev90(c)
    if r90>16500: a-=(r90-16500)/1000*0.35      # E2 judges the 90-day total against F11
    else: a+=min((16500-r90)/1000*0.2,1.0)
    if c["fee"]<5000: a+=0.3                     # E1 sells a lower monthly headline upward
    if c["fee"]>5000: a-=0.3
    if c["response"]==1: a+=0.3
    if c["inspection"]>0: a+=0.2                 # a priced Month 1 deliverable is easy to explain
    if c["rescope"]: a-=0.2
    if c["billing"]=="prepaid3": a-=1.0
    if not c["hiring"]: a-=0.5
    if c["hours"]<5: a-=0.5
    if c["hours_def"]=="advisor": a-=0.3
    if c["value_line"]=="none": a-=0.3
    a-=fails
    s["acceptance"]=a
    why["acceptance"]=f"E1/E2: 90-day total ${rev90(c):,.0f} vs $16,500 target, headline ${c['fee']:,}; {'1-day email helps E1 (F3 phone hours, F24 responsiveness)' if c['response']==1 else '2-day email as in F11'}; {'prepaid cash ask hurts E2' if c['billing']=='prepaid3' else 'monthly in advance'}; {fails} objection failures."
    # --- Value and ROI clarity (E2,E5)
    v=7.0
    if c["value_line"]=="covers": v+=1
    if c["inspection"]>0: v+=0.5
    if c["hiring"]: v+=0.5
    if c["fee"]>7000: v-=0.5
    if c["hours_def"]=="joint": v+=0.5
    s["value"]=v
    why["value"]=f"E2/E5: {'value line names what the fee covers' if c['value_line']=='covers' else 'no value line'}; {'Month 1 inspection priced as its own deliverable' if c['inspection'] else 'inspection folded into the fee'}; {'hiring support (F9) ties fee to the hire' if c['hiring'] else 'no hiring support'}; hour defined as {c['hours_def']}."
    # --- Kaldera economics (E4)
    e=5+(rate_mod-200)/50
    if c["billing"]=="prepaid3": e+=0.3  # cash up front
    e=min(e,10)
    s["economics"]=e
    net=per_advisor_net(c["fee"],c["inspection"],c["discount"] if c["billing"]=="prepaid3" else 0)
    why["economics"]=f"E4: ${rate_mod:,.0f} per modeled advisor-hour over 90 days (62 hours), ${rate_sold:,.0f} per sold hour; per-advisor net about ${net:,} a month, {net/F15_MONTH:.0%} of F15 (F16, K1, K5)."
    # --- Delivery (E3)
    d=7.0
    if sold>=STEADY_HOURS+2: d+=1
    elif sold>=STEADY_HOURS: d+=0.5
    else: d-=1 if sold>=STEADY_HOURS-3 else 2
    if c["response"]==1: d-=1
    if c["rescope"]: d+=1
    if c["inspection"]>0: d+=0.5
    if not c["hiring"]: d+=0.5
    if c["inspection"]==0 and not c["rescope"]: d-=0.5  # Month 1 overage unaddressed
    s["delivery"]=d
    why["delivery"]=f"E3: {sold} advisor-hours sold vs 12 steady / 19 Month 1 modeled; {'1-day email strains cover when one advisor is out' if c['response']==1 else '2-day email leaves cover'}; {'re-scope trigger on markets or channels' if c['rescope'] else 'no re-scope trigger'}; {'inspection scoped separately handles Month 1 overage' if c['inspection'] else 'Month 1 overage inside the fee'}."
    # --- Benchmark fit (E5)
    b=8.0
    if not (200<=rate_sold<=500): b-=2
    if c["fee"]<=6000: b+=1
    if c["fee"]<5000: b-=1  # under the F19 advisory floor
    elif c["fee"]>=7500: b-=2
    if c["fee"]<5000: b-=1
    if c["inspection"]>3500: b-=1
    s["benchmark"]=b
    why["benchmark"]=f"E5: ${rate_sold:,.0f}/advisor-hour against F19 ($200 to $600) and F20 ($200 to $500); ${c['fee']:,} against F18 ($2,500 to $6,000) and the F21 agency floor ($7,500 with execution); {'under the F19 $5,000 floor' if c['fee']<5000 else 'above the F19 floor'}."
    # --- Copy (E7)
    p=8.0
    if c["inspection"]>0: p-=0.5
    if c["billing"]=="prepaid3": p-=0.5
    if c["rescope"]: p-=0.5
    if c["value_line"]=="none": p-=1
    if c["hours_def"]=="joint": p+=0.5
    s["copy"]=p
    why["copy"]=f"E7: {'one flat fee' if not c['inspection'] else 'flat fee plus one line item (G4 allows one)'}; {'joint hours read plainly: both advisors, up to ten hours' if c['hours_def']=='joint' else 'advisor-hours need explaining'}; G5, G8, G9, G10 pass by construction."
    for k in s: s[k]=max(1,min(10,round(s[k],2)))
    W=dict(acceptance=.30,value=.20,economics=.20,delivery=.15,benchmark=.10,copy=.05)
    total=round(sum(s[k]*W[k] for k in s),2)
    # EV12
    p_accept=round(max(.1,min(.9,s["acceptance"]/10*0.9)),2)
    p_extend=0.6+(0.05 if c["hiring"] else 0); p_expand=0.3+(0.05 if c["hiring"] else 0)+(0.05 if c["inspection"] else 0)
    X=15000
    M=c["fee"]*(1-(c["discount"] if c["billing"]=="prepaid3" else 0))
    ev=round(p_accept*(3*M+c["inspection"]+p_extend*9*M+p_expand*X))
    clients=-(-F15_MONTH//net) if net>0 else None
    cap_ok = clients is not None and clients*max(STEADY_HOURS,sold)/2<=K["K2"]
    return dict(scores=s,rationale=why,total=total,objections=[(n,p) for n,p,_ in obj],
                ev12=ev,p_accept=p_accept,p_extend=p_extend,p_expand=p_expand,
                eff_rate_modeled=round(rate_mod),eff_rate_sold=round(rate_sold),advisor_hours_sold=sold,
                per_advisor_net=net,share_f15=round(net/F15_MONTH,3),clients_to_replace=int(clients),capacity_ok=bool(cap_ok))

def key(c): return json.dumps(c,sort_keys=True)
def label(c):
    parts=[f"${c['fee']:,}/mo",f"{c['hours']} {c['hours_def']} hrs",f"{c['response']}-day email",c["billing"]+(f" -{int(c['discount']*100)}%" if c["billing"]=="prepaid3" else "")]
    if c["inspection"]: parts.append(f"inspection ${c['inspection']:,} one-time")
    if c["rescope"]: parts.append("re-scope trigger")
    if not c["hiring"]: parts.append("no hiring support")
    if c["value_line"]=="none": parts.append("no value line")
    return "; ".join(parts)

def mutate(parent,seen):
    for _ in range(500):
        c=dict(parent); n=random.randint(1,3)
        for lv in random.sample(list(LEVERS),n):
            c[lv]=random.choice([x for x in LEVERS[lv] if x!=parent[lv]] or LEVERS[lv])
        if c["billing"]=="monthly": c["discount"]=0
        if c["billing"]=="prepaid3" and c["discount"]==0: c["discount"]=random.choice([0.03,0.05,0.07])
        if key(c) not in seen: return c
    return None

log=[]; seen=set()
def record(rnd,c,parent=None):
    seen.add(key(c)); fails=gates(c); rec=dict(round=rnd,id=f"R{rnd}-{len(log)+1:02d}",label=label(c),levers=c,parent=parent,gate_failures=fails)
    if not fails: rec.update(score(c))
    log.append(rec); return rec

base=record(0,BASE); top=[base]; hold=0; best_hist=[]
for rnd in range(1,9):
    new=[]
    for p in top[:2]:
        for _ in range(3):
            c=mutate(p["levers"],seen)
            if c: new.append(record(rnd,c,p["id"]))
    pool=[r for r in top+new if not r["gate_failures"]]
    pool.sort(key=lambda r:(r["total"],r["ev12"]),reverse=True)
    top=pool[:2]; best_hist.append((rnd,top[0]["id"],top[0]["total"]))
    hold = hold+1 if top[0]["total"]>=8.5 and len(best_hist)>1 and best_hist[-2][1]==top[0]["id"] else (1 if top[0]["total"]>=8.5 else 0)
    if hold>=2: break

json.dump(dict(log=log,top=top,history=best_hist,base_total=base["total"]),open(OUT+"_run.json","w"),indent=1,default=str)
with open(OUT+"candidates.jsonl","w") as f:
    for r in log: f.write(json.dumps(r,default=str)+"\n")
print("base",base["total"],base["ev12"]); 
for h in best_hist: print(h)
scored=sorted([r for r in log if not r["gate_failures"]],key=lambda r:(r["total"],r["ev12"]),reverse=True)
for r in scored[:8]: print(r["id"],r["total"],r["ev12"],r["label"]); print("   ",r["scores"],r["objections"])
print("dropped:",[(r["id"],r["gate_failures"]) for r in log if r["gate_failures"]])
