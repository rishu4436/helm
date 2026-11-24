// HELM v2: product demo. Real capture frames only; picture retimed to narration; gesture inset driven by the real recorded inputs.
const GL='/workspace/helm-video/captures/glasses', CO='/workspace/helm-video/captures/companion';
const WHEEL=(id,sz)=>`<svg id="${id}" width="${sz}" height="${sz}" viewBox="0 0 100 100" style="overflow:visible">
 <defs><linearGradient id="${id}g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#FFC15A"/><stop offset="1" stop-color="#D9822B"/></linearGradient></defs>
 <circle class="ring" cx="50" cy="50" r="30" fill="none" stroke="url(#${id}g)" stroke-width="5" pathLength="100" stroke-dasharray="100"/>
 <g class="spokes" stroke="url(#${id}g)" stroke-width="5" stroke-linecap="round">${[0,45,90,135,180,225,270,315].map(a=>`<line x1="50" y1="50" x2="${50+46*Math.cos(a*Math.PI/180)}" y2="${50+46*Math.sin(a*Math.PI/180)}" pathLength="100" stroke-dasharray="100"/>`).join('')}</g>
 <circle class="hub" cx="50" cy="50" r="9" fill="#111316" stroke="url(#${id}g)" stroke-width="5"/></svg>`;
// side view of the G2 temple arm with the touchpad zone near the hinge, and the R1 ring
const TEMPLE=`<svg width="250" height="92" viewBox="0 0 250 92">
 <rect x="6" y="20" width="34" height="40" rx="10" fill="none" stroke="#7C838D" stroke-width="3"/>
 <path d="M40 36 H200 Q226 36 236 62" fill="none" stroke="#9AA1AB" stroke-width="7" stroke-linecap="round"/>
 <rect id="pad" x="150" y="30" width="56" height="12" rx="6" fill="rgba(245,165,36,.25)" stroke="#F5A524" stroke-width="1.5"/>
 <circle id="fing" cx="178" cy="36" r="9" fill="#F5A524" opacity="0"/>
 <circle id="rip" cx="178" cy="36" r="9" fill="none" stroke="#F5A524" stroke-width="2" opacity="0"/>
</svg>`;
const RING=`<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="none" stroke="#9AA1AB" stroke-width="7"/><rect x="24" y="8" width="16" height="9" rx="4" fill="rgba(245,165,36,.35)" stroke="#F5A524" stroke-width="1.5"/></svg>`;
stageInit(`
<div id="film" style="position:absolute;inset:0">
 <div id="gview" class="view" style="left:150px;top:100px;width:1440px;height:720px;background:#000">
  <div id="gcam" style="position:absolute;left:0;top:0;width:576px;height:288px;transform-origin:0 0"><img id="gimg" style="position:absolute;left:0;top:0;width:576px;height:288px"><div id="ghl" class="hl" style="opacity:0"></div></div>
  <div class="rim"></div></div>
 <div id="glabel" class="lbl" style="position:absolute;left:154px;top:834px;color:#7C838D">Even Realities G2 display · Even Hub simulator · screen capture</div>
 <div id="cview" class="view" style="left:224px;top:90px;width:1472px;height:828px;background:#0d0e10">
  <div id="ccam" style="position:absolute;left:0;top:0;width:1440px;height:810px;transform-origin:0 0"><img id="cimg" style="position:absolute;left:0;top:0;width:1440px;height:810px"><div id="chl" class="hl" style="opacity:0;border-width:3px"></div></div>
  <div class="rim"></div></div>
 <div id="clabel" class="lbl" style="position:absolute;left:228px;top:930px;color:#7C838D">HELM companion site · screen recording</div>
 <div id="gest" style="position:absolute;left:1430px;top:836px;width:420px;height:184px;border-radius:20px;background:rgba(17,19,22,.9);box-shadow:inset 0 0 0 1px rgba(160,168,180,.22)">
  <div style="position:absolute;left:22px;top:16px;font-size:16px;letter-spacing:.06em;color:#8A919B">TEMPLE TOUCHPAD · OR EVEN R1 RING</div>
  <div style="position:absolute;left:14px;top:44px">${TEMPLE}</div>
  <div id="ringw" style="position:absolute;left:318px;top:56px;opacity:.55">${RING}</div>
  <div id="gname" style="position:absolute;left:22px;top:134px;font-size:28px;font-weight:700;color:#F5A524"></div>
 </div>
 <div id="cap" style="position:absolute;left:0;width:1920px;top:960px;display:flex;justify-content:center"><span class="pill" style="font-size:28px;font-weight:600;color:#F3F4F6;background:rgba(17,19,22,.92);padding:13px 28px;box-shadow:inset 0 0 0 1.5px rgba(245,165,36,.55)"><span id="capX"></span></span></div>
 <div id="foot" style="position:absolute;left:154px;top:1040px;font-size:16px;color:#646B75">Demo accounts only · not financial advice</div>
</div>
<div id="brand" style="position:absolute;inset:0">
 <div id="halo" style="position:absolute;left:660px;top:30px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(245,165,36,.20),transparent 65%)"></div>
 <div id="mk" style="position:absolute;left:885px;top:250px;width:150px;height:150px">${WHEEL('wheel',150)}</div>
 <div id="house" class="lbl" style="position:absolute;left:0;width:1920px;top:440px;text-align:center;letter-spacing:.3em;font-size:28px;color:#C9CED6">RISHABH ORIGINALS</div>
 <div id="topic" class="cap" style="top:496px;font-size:54px;line-height:80px;font-weight:700"><span style="color:#F5A524">HELM</span> — Hands-free trading <span style="color:#9AA1AB;font-weight:600">on Even Realities G2</span></div>
</div>
<div id="endc" style="position:absolute;inset:0">
 <div style="position:absolute;left:0;top:300px;width:1920px;display:flex;justify-content:center">${WHEEL('wheel2',90)}</div>
 <div id="e1" class="cap" style="top:440px;font-size:46px;line-height:64px;font-weight:700;color:#ECEEF1">Demo/paper accounts only. Not financial advice.</div>
 <div id="e2" class="cap" style="top:520px;font-size:32px;line-height:48px;font-weight:500;color:#9AA1AB">Shown: Binance Demo &amp; Bybit Demo · OKX supported, untested from India</div>
</div>`);
const {shots,frames,cnt,gest}=EDL;
const media=shots.filter(s=>s.kind==='g'||s.kind==='c').sort((a,b)=>a.g0-b.g0);
function srcTime(sh,t){let seg=sh.segs[0];for(const s of sh.segs) if(t>=s[0]) seg=s;const i=sh.segs.indexOf(seg);const gend=i+1<sh.segs.length?sh.segs[i+1][0]:sh.g1;let st=seg[1]+(Math.min(t,gend)-seg[0]);if(seg.length>2) st=Math.min(st,seg[2]);return Math.max(seg[1],st);}
function gFrame(run,st){const F=frames[run];const ms=st*1000;let lo=0,hi=F.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(F[m]<=ms) lo=m;else hi=m-1;}return `${GL}/${run}/frames/${String(F[lo]).padStart(7,'0')}.png`;}
function cFrame(s,st){const n=Math.min(cnt[s],Math.max(1,Math.floor(st*30)+1));return `${CO}/f${s}/${String(n).padStart(5,'0')}.jpg`;}
async function setImg(el,src){if(el.dataset.s!==src){el.dataset.s=src;el.src='file://'+src;try{await el.decode();}catch(e){}}}
function hlAt(sh,t,el,W){let on=null;for(const h of sh.hl) if(t>=h[0]-.25&&t<=h[1]+.25) on=h;if(!on){el.style.opacity=0;return;}
 const k=Math.min(win(t,on[0]-.25,on[0]+.05),1-win(t,on[1],on[1]+.25));const r=on[2];el.style.left=(r[0]-W)+'px';el.style.top=(r[1]-W)+'px';el.style.width=(r[2]-r[0]+2*W)+'px';el.style.height=(r[3]-r[1]+2*W)+'px';el.style.opacity=k;}
function capAt(sh,t){let on=null;for(const c of sh.cap) if(t>=c[0]-.3&&t<=c[1]+.3) on=c;const e=$('cap');if(!on){e.style.opacity=0;return;}
 const k=Math.min(win(t,on[0]-.3,on[0]),1-win(t,on[1],on[1]+.3));$('capX').textContent=on[2];e.style.opacity=k;}
const NAME={down:'Swipe',up:'Swipe',click:'Tap',double_click:'Double-tap'};
function gestAt(t,isG){ // real recorded inputs; explanation loop 22.0–28.0 (narration: "I swipe and tap on the touchpad … or the R1 ring")
 const box=$('gest'); const explain=t>=21.9&&t<28.0;
 let ev=null; for(const g of gest) if(t>=g[0]&&t<g[0]+.9) ev=g;
 if(explain){ const u=(t-21.9)%3.0; ev=[t-(u<1?u:u<2?u-1:u-2), u<1?'down':u<2?'click':'double_click']; }
 box.style.opacity=isG?1:0; const ek=sineIO(Math.min(win(t,21.4,22.0),1-win(t,27.8,28.4))); box.style.transformOrigin='100% 100%'; box.style.transform=`translate(${-120*ek}px,${-150*ek}px) scale(${1+.7*ek})`; $('ringw').style.opacity=explain? .55+.45*Math.abs(Math.sin(t*2.2)) : .5;
 const f=$('fing'), r=$('rip');
 if(!ev||!isG){ f.setAttribute('opacity',0); r.setAttribute('opacity',0); $('gname').textContent=''; return; }
 const u=t-ev[0]; $('gname').textContent=NAME[ev[1]]||'';
 if(ev[1]==='down'||ev[1]==='up'){ const k=cubicIO(clamp(u/.45)); f.setAttribute('cx',156+44*k); f.setAttribute('opacity',u<.7?1:Math.max(0,1-(u-.7)/.2)); r.setAttribute('opacity',0); }
 else { const n=ev[1]==='double_click'?2:1; const k=n===2&&u>.3?(u-.3)/.45:u/.45; f.setAttribute('cx',178); f.setAttribute('opacity',u<.75?1:0);
   r.setAttribute('cx',178); r.setAttribute('r',9+12*clamp(k)); r.setAttribute('opacity',Math.max(0,1-clamp(k))); }
}
function brandRender(t,mode,D){
 const ring=document.querySelector('#wheel .ring'), sp=document.querySelectorAll('#wheel .spokes line'), hub=document.querySelector('#wheel .hub');
 ring.setAttribute('stroke-dashoffset',100*(1-cubicIO(win(t,0,.6))));
 sp.forEach((l,i)=>l.setAttribute('stroke-dashoffset',100*(1-cubicIO(win(t,.1+i*.03,.6+i*.03)))));
 hub.style.opacity=win(t,.4,.6); $('wheel').style.transform=`rotate(${-35*(1-cubicIO(win(t,0,1.1)))}deg)`;
 $('halo').style.opacity=.9*win(t,.2,.7);
 $('house').style.opacity=win(t,.15,.45); $('house').style.transform=`translateY(${10*(1-sineIO(win(t,.15,.6)))}px)`;
 $('topic').style.opacity=win(t,.35,.7); $('topic').style.transform=`translateY(${12*(1-sineIO(win(t,.35,.8)))}px)`;
 applyCam($('cam'),960,540,1+.02*t/D,0);
 $('brand').style.opacity=mode==='intro'?(t<.2?win(t,0,.2):1-win(t,D-.3,D)):(win(t,0,.3)*(1-win(t,D-.45,D)));
}
async function render(t){
 const intro=t<2.0, outro=t>=167.2, endc=t>=157.2&&t<167.2;
 $('brand').style.display=(intro||outro)?'block':'none'; $('endc').style.display=endc?'block':'none'; $('film').style.display=(!intro&&!outro&&(!endc||t<157.7))?'block':'none';
 if(intro){ brandRender(t,'intro',2.0); return; }
 if(outro){ brandRender(t-167.2,'outro',2.0); return; }
 applyCam($('cam'),960,540,1,0);
 if(endc){ $('film').style.opacity=1-win(t,157.2,157.7); $('endc').style.opacity=win(t,157.4,158.0)*(1-win(t,166.8,167.2));
   $('e1').style.opacity=win(t,157.5,158.0); $('e2').style.opacity=win(t,163.0,163.5); if(t>=157.7) return; }
 else $('film').style.opacity=t<2.3?win(t,2.0,2.3):1;
 let sh=media[0]; for(const s of media) if(t>=s.g0) sh=s;
 const i=media.indexOf(sh), prev=media[i-1], nxt=media[i+1], isG=sh.kind==='g';
 $('gview').style.display=$('glabel').style.display=isG?'block':'none';
 $('cview').style.display=$('clabel').style.display=isG?'none':'block';
 let op=1; if(!prev||prev.kind!==sh.kind) op=sineIO(win(t,sh.g0,sh.g0+.25)); if(nxt&&nxt.kind!==sh.kind) op*=1-sineIO(win(t,sh.g1-.2,sh.g1));
 const view=isG?$('gview'):$('cview'); view.style.opacity=op; (isG?$('glabel'):$('clabel')).style.opacity=op*.9;
 const st=srcTime(sh,t);
 if(isG){ await setImg($('gimg'),gFrame(sh.src,st)); $('gcam').style.transform=`scale(2.5)`; hlAt(sh,t,$('ghl'),3); $('ghl').style.borderWidth='1px'; }
 else { await setImg($('cimg'),cFrame(sh.src,st)); $('ccam').style.transform=`scale(${1472/1440})`; hlAt(sh,t,$('chl'),8); }
 capAt(sh,t); gestAt(t,isG); $('gest').style.opacity=isG?op:0;
}
window.render=render;
