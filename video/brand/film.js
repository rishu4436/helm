// HELM demo film: deterministic render(t). Real capture frames only (glasses simulator screenshots, companion Playwright video frames).
const GL='/workspace/helm-video/captures/glasses', CO='/workspace/helm-video/captures/companion';
const WHEEL=(id,sz)=>`<svg id="${id}" width="${sz}" height="${sz}" viewBox="0 0 100 100" style="overflow:visible">
 <defs><linearGradient id="${id}g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#FFC15A"/><stop offset="1" stop-color="#D9822B"/></linearGradient></defs>
 <circle class="ring" cx="50" cy="50" r="30" fill="none" stroke="url(#${id}g)" stroke-width="5" pathLength="100" stroke-dasharray="100"/>
 <g class="spokes" stroke="url(#${id}g)" stroke-width="5" stroke-linecap="round">${[0,45,90,135,180,225,270,315].map(a=>`<line x1="50" y1="50" x2="${50+46*Math.cos(a*Math.PI/180)}" y2="${50+46*Math.sin(a*Math.PI/180)}" pathLength="100" stroke-dasharray="100"/>`).join('')}</g>
 <circle class="hub" cx="50" cy="50" r="9" fill="#111316" stroke="url(#${id}g)" stroke-width="5"/></svg>`;
const DISC='Demo/paper accounts only. Not financial advice.';
stageInit(`
<div id="film" style="position:absolute;inset:0">
 <div id="chap" style="position:absolute;left:84px;top:44px;display:flex;align-items:baseline;gap:16px;font-size:26px;font-weight:600;color:#C9CED6"><span id="chapN" class="mono" style="color:#F5A524;font-size:22px"></span><span id="chapT"></span></div>
 <div id="gview" class="view" style="left:240px;top:150px;width:1440px;height:720px;background:#000">
  <div id="gcam" style="position:absolute;left:0;top:0;width:576px;height:288px;transform-origin:0 0"><img id="gimg" style="position:absolute;left:0;top:0;width:576px;height:288px"><div id="ghl" class="hl" style="opacity:0"></div></div>
  <div class="rim"></div></div>
 <div id="glabel" class="lbl" style="position:absolute;left:244px;top:884px;color:#7C838D">Even Realities G2 · Even Hub simulator · live capture</div>
 <div id="cview" class="view" style="left:224px;top:112px;width:1472px;height:828px;background:#0d0e10">
  <div id="ccam" style="position:absolute;left:0;top:0;width:1440px;height:810px;transform-origin:0 0"><img id="cimg" style="position:absolute;left:0;top:0;width:1440px;height:810px"><div id="chl" class="hl" style="opacity:0;border-width:3px"></div></div>
  <div class="rim"></div></div>
 <div id="clabel" class="lbl" style="position:absolute;left:228px;top:952px;color:#7C838D">HELM companion · Playwright recording</div>
 <div id="cap" style="position:absolute;left:0;width:1920px;top:976px;display:flex;justify-content:center"><span id="capT" class="pill" style="font-size:30px;font-weight:600;color:#F3F4F6;background:rgba(17,19,22,.92);padding:14px 30px;box-shadow:inset 0 0 0 1.5px rgba(245,165,36,.55)"><span style="width:10px;height:10px;border-radius:50%;background:#F5A524"></span><span id="capX"></span></span></div>
 <div id="foot" style="position:absolute;right:84px;top:1036px;font-size:17px;color:#7C838D">${DISC}</div>
</div>
<div id="brand" style="position:absolute;inset:0">
 <div id="halo" style="position:absolute;left:660px;top:30px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(245,165,36,.20),transparent 65%)"></div>
 <div id="mk" style="position:absolute;left:870px;top:190px;width:180px;height:180px">${WHEEL('wheel',180)}</div>
 <div id="house" class="lbl" style="position:absolute;left:0;width:1920px;top:418px;text-align:center;letter-spacing:.3em;font-size:24px;color:#A7AEB8">RISHABH ORIGINALS</div>
 <div class="cap" style="top:466px;height:96px;font-size:66px;line-height:96px"><span class="mask"><span id="wA" style="color:#F5A524">HELM</span></span> <span class="mask"><span id="wB" style="color:#ECEEF1;font-weight:700">—</span></span> <span class="mask"><span id="wC" style="color:#ECEEF1;font-weight:700">Hands-free trading</span></span> <span class="mask"><span id="wD" style="color:#9AA1AB;font-weight:600">on Even Realities G2</span></span></div>
 <div id="bdisc" style="position:absolute;left:0;width:1920px;top:640px;display:flex;justify-content:center"><span class="pill" style="font-size:24px;color:#C9CED6;padding:12px 26px;box-shadow:inset 0 0 0 1px rgba(160,168,180,.3)">${DISC}</span></div>
</div>
<div id="endc" style="position:absolute;inset:0">
 <div style="position:absolute;left:0;top:250px;width:1920px;display:flex;justify-content:center">${WHEEL('wheel2',96)}</div>
 <div class="cap" style="top:400px;font-size:84px;line-height:112px"><span class="mask"><span id="e1">One interface.</span></span></div>
 <div class="cap" style="top:512px;font-size:84px;line-height:112px"><span class="mask"><span id="e2" style="color:#C9CED6">Multiple exchanges.</span></span></div>
 <div class="cap" style="top:624px;font-size:84px;line-height:112px"><span class="mask"><span id="e3" style="color:#F5A524">Verified actions.</span></span></div>
 <div id="edisc" style="position:absolute;left:0;width:1920px;top:800px;display:flex;justify-content:center"><span class="pill" style="font-size:26px;color:#ECEEF1;padding:14px 30px;background:rgba(245,165,36,.08);box-shadow:inset 0 0 0 1.5px rgba(245,165,36,.5)">${DISC}</span></div>
 <div id="eokx" style="position:absolute;left:0;width:1920px;top:890px;text-align:center;font-size:20px;color:#7C838D">Binance Demo & Bybit Demo shown · OKX supported, untested from India</div>
</div>`);
const {shots,frames,cnt,CH,END,DUR}=EDL;
const media=shots.filter(s=>s.kind==='g'||s.kind==='c').sort((a,b)=>a.g0-b.g0);
function srcTime(sh,t){let seg=sh.segs[0];for(const s of sh.segs) if(t>=s[0]) seg=s;const i=sh.segs.indexOf(seg);const gend=i+1<sh.segs.length?sh.segs[i+1][0]:sh.g1;let st=seg[1]+(Math.min(t,gend)-seg[0]);if(seg.length>2) st=Math.min(st,seg[2]);return Math.max(seg[1],st);}
function gFrame(run,st){const F=frames[run];const ms=st*1000;let lo=0,hi=F.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(F[m]<=ms) lo=m;else hi=m-1;}return `${GL}/${run}/frames/${String(F[lo]).padStart(7,'0')}.png`;}
function cFrame(s,st){const n=Math.min(cnt[s],Math.max(1,Math.floor(st*30)+1));return `${CO}/f${s}/${String(n).padStart(5,'0')}.jpg`;}
function camAt(K,t){if(!K) return null;return camSpline(K,t);}
async function setImg(el,src){if(el.dataset.s!==src){el.dataset.s=src;el.src='file://'+src;try{await el.decode();}catch(e){}}}
function hlAt(sh,t,el,W){let on=null;for(const h of sh.hl) if(t>=h[0]-.25&&t<=h[1]+.25) on=h;if(!on){el.style.opacity=0;return;}
 const k=Math.min(win(t,on[0]-.25,on[0]+.05),1-win(t,on[1],on[1]+.25));const r=on[2],p=W;el.style.left=(r[0]-p)+'px';el.style.top=(r[1]-p)+'px';el.style.width=(r[2]-r[0]+2*p)+'px';el.style.height=(r[3]-r[1]+2*p)+'px';el.style.opacity=k;}
function capAt(sh,t){let on=null;for(const c of sh.cap) if(t>=c[0]-.3&&t<=c[1]+.3) on=c;const e=$('cap');if(!on){e.style.opacity=0;return;}
 const k=Math.min(win(t,on[0]-.3,on[0]),1-win(t,on[1],on[1]+.3));$('capX').textContent=on[2];e.style.opacity=k;e.style.transform=`translateY(${(1-sineIO(k))*14}px)`;}
function brandRender(t,mode,D){ // intro / outro lockup
 const a=.1; const ring=document.querySelector('#wheel .ring'), sp=document.querySelectorAll('#wheel .spokes line'), hub=document.querySelector('#wheel .hub');
 ring.setAttribute('stroke-dashoffset',100*(1-cubicIO(win(t,a,a+.8))));
 sp.forEach((l,i)=>l.setAttribute('stroke-dashoffset',100*(1-cubicIO(win(t,a+.25+i*.04,a+.85+i*.04)))));
 hub.style.opacity=win(t,a+.6,a+.9);
 $('wheel').style.transform=`rotate(${-50*(1-cubicIO(win(t,a,1.6)))+3*Math.sin(t*.8)}deg) scale(${.9+.1*sp_(t,a,1.2,.8)})`;
 $('halo').style.opacity=.9*win(t,a+.5,a+1.1);
 const hk=sp_(t,a+.55,2.0,.8);$('house').style.opacity=win(t,a+.5,a+.85);$('house').style.transform=`translateY(${16*(1-hk)}px)`;
 revealWords(['wA','wB','wC','wD'],a+.8,.12,t);
 $('bdisc').style.opacity=mode==='outro'?win(t,a+1.5,a+1.9):0;
 let s=1+.03*t/D,blur=0,fy=540;
 if(mode==='intro'){const w=expIn(win(t,D-.45,D));s*=1+.45*w;blur=9*w;fy=lerp(540,500,w);}
 applyCam($('cam'),960,fy,s,blur);
 $('brand').style.opacity=mode==='outro'?(1-win(t,D-.8,D)):1;
}
const sp_=(t,t0,f,z)=>spring(t-t0,f,z);
async function render(t){
 const intro=t<5.0, outro=t>=161.0, endc=t>=148.6&&t<161.0;
 $('brand').style.display=(intro||outro)?'block':'none'; $('endc').style.display=endc?'block':'none'; $('film').style.display=(!intro&&!outro&&!endc)||(endc&&t<149.2)?'block':'none';
 $('stage').style.opacity=intro?win(t,0,.3):1;
 if(intro){ brandRender(t,'intro',5.0); return; }
 if(outro){ brandRender(t-161.0,'outro',6.0); return; }
 if(endc){ const u=t-148.6; applyCam($('cam'),960,540,1+.02*u/12,0);
  $('film').style.opacity=1-win(t,148.6,149.2); $('endc').style.opacity=win(t,148.7,149.3)*(1-win(t,160.4,161.0));
  const w2=document.querySelector('#wheel2'); w2.style.opacity=win(t,148.9,149.5); w2.style.transform=`rotate(${12*Math.sin(u*.5)}deg)`;
  revealWords(['e1','e2','e3'],0,0,0); ['e1','e2','e3'].forEach((id,j)=>{const e=$(id);const k=sp_(t,END.w[j]-.1,1.9,.78);e.style.transform=`translateY(${(1-k)*110}%)`;e.style.opacity=t>=END.w[j]-.1?1:0;});
  $('edisc').style.opacity=win(t,END.disc,END.disc+.4); $('edisc').style.transform=`translateY(${12*(1-sineIO(win(t,END.disc,END.disc+.5)))}px)`;
  $('eokx').style.opacity=win(t,END.w[2]+.8,END.w[2]+1.3);
  if(t>=149.2) return; }
 applyCam($('cam'),960,540,1,0);
 let sh=media[0]; for(const s of media) if(t>=s.g0) sh=s;
 const prev=media[media.indexOf(sh)-1];
 const isG=sh.kind==='g';
 $('gview').style.display=$('glabel').style.display=isG?'block':'none';
 $('cview').style.display=$('clabel').style.display=isG?'none':'block';
 // fade between panel types (and from intro); no hard flashes
 let op=1; const typeChange=!prev||prev.kind!==sh.kind; if(typeChange) op=sineIO(win(t,sh.g0,sh.g0+.28));
 const nxt=media[media.indexOf(sh)+1]; if(!nxt||nxt.kind!==sh.kind) op*=1-sineIO(win(t,sh.g1-.22,sh.g1));
 const view=isG?$('gview'):$('cview'); view.style.opacity=op; (isG?$('glabel'):$('clabel')).style.opacity=op*.9;
 view.style.transform=`scale(${.985+.015*op})`;
 const st=srcTime(sh,t);
 if(isG){ await setImg($('gimg'),gFrame(sh.src,st)); const c=camAt(sh.cam,t)||[288,144,1]; const S=2.5*c[2]; const fx=c[2]>1.001&&c[0]<400?720/S:clamp(c[0],720/S,576-720/S), fy=clamp(c[1],360/S,288-360/S);
   $('gcam').style.transform=`translate(720px,360px) scale(${S}) translate(${-fx}px,${-fy}px)`; $('gimg').style.imageRendering=S>=3?'pixelated':'auto'; hlAt(sh,t,$('ghl'),3); $('ghl').style.borderWidth=(2.4/c[2]/2.5*2.5).toFixed(2)+'px'; }
 else { await setImg($('cimg'),cFrame(sh.src,st)); const c=camAt(sh.cam,t)||[720,405,1]; const S=1472/1440*c[2]; const fx=clamp(c[0],736/S,1440-736/S), fy=clamp(c[1],414/S,810-414/S);
   $('ccam').style.transform=`translate(736px,414px) scale(${S}) translate(${-fx}px,${-fy}px)`; hlAt(sh,t,$('chl'),8); }
 // chapter tag
 const ch=sh.chapter; const ce=$('chap'); if(ch){ $('chapN').textContent=ch; $('chapT').textContent=CH[ch]; let first=sh; for(const s of media) if(s.chapter===ch){first=s;break;} ce.style.opacity=win(t,first.g0,first.g0+.4); ce.style.transform=`translateX(${-14*(1-sineIO(win(t,first.g0,first.g0+.5)))}px)`; } else ce.style.opacity=0;
 capAt(sh,t);
 $('foot').style.opacity=win(t,5.2,5.8);
}
window.render=render;
