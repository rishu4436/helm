const $=id=>document.getElementById(id);
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const lerp=(a,b,t)=>a+(b-a)*t;
const win=(t,a,b)=>clamp((t-a)/(b-a));
const expOut=t=>t<=0?0:t>=1?1:1-Math.pow(2,-10*t);
const expIn=t=>t<=0?0:t>=1?1:Math.pow(2,10*t-10);
const cubicIO=t=>{t=clamp(t);return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;};
const sineIO=t=>-(Math.cos(Math.PI*clamp(t))-1)/2;
const backOut=(t,s=1.7)=>{t=clamp(t);return 1+(s+1)*Math.pow(t-1,3)+s*Math.pow(t-1,2);};
function spring(t,f=2.2,z=.7){if(t<=0)return 0;const w=2*Math.PI*f;if(z>=1)return 1-Math.exp(-w*t)*(1+w*t);const wd=w*Math.sqrt(1-z*z);return 1-Math.exp(-z*w*t)*(Math.cos(wd*t)+(z*w/wd)*Math.sin(wd*t));}
const sp=(t,t0,f=2,z=.72)=>spring(t-t0,f,z);
// camera spline: keys [[t,fx,fy,s],...]
function camSpline(K,t){const n=K.length;if(t<=K[0][0])return K[0].slice(1);if(t>=K[n-1][0])return K[n-1].slice(1);let i=0;while(K[i+1][0]<t)i++;const p0=K[Math.max(0,i-1)],p1=K[i],p2=K[i+1],p3=K[Math.min(n-1,i+2)];const u=(t-p1[0])/(p2[0]-p1[0]);const o=[];for(let c=1;c<4;c++){const m1=(p2[c]-p0[c])/(p2[0]-p0[0]||1)*(p2[0]-p1[0]),m2=(p3[c]-p1[c])/(p3[0]-p1[0]||1)*(p2[0]-p1[0]);const u2=u*u,u3=u2*u;o.push((2*u3-3*u2+1)*p1[c]+(u3-2*u2+u)*m1*.85+(-2*u3+3*u2)*p2[c]+(u3-u2)*m2*.85);}return o;}
// standard scene in/out "whip zoom": returns extra scale multiplier and blur
function whip(t,DUR,inDur=.35,outDur=.3){const a=1-expOut(win(t,0,inDur));const b=expIn(win(t,DUR-outDur,DUR));return {s:1+.18*a+.35*b,blur:10*a*a+14*b,op:1};}
function applyCam(cam,fx,fy,s,blur){cam.style.transform=`translate(960px,540px) scale(${s}) translate(${-fx}px,${-fy}px)`;cam.style.filter=blur>.25?`blur(${blur.toFixed(2)}px)`:'none';}
function bgPar(fx,fy,s){const b=$('bg');if(b)b.style.transform=`translate(${(960-fx)*.18}px,${(540-fy)*.18}px) scale(${1+(s-1)*.12})`;}
const show=(e,op)=>{e.style.opacity=op;};
// mask-reveal words: element children span inside .mask
function revealWords(ids,t0,step,t){ids.forEach((id,j)=>{const e=$(id);const k=sp(t,t0+j*step,1.9,.75);e.style.transform=`translateY(${(1-k)*110}%)`;e.style.opacity=t>=t0+j*step?1:0;});}
const STAGE_BG=`<div id="bg"><div class="glow" style="left:200px;top:100px;width:1000px;height:760px;background:rgba(245,165,36,.10)"></div><div class="glow" style="left:1300px;top:620px;width:950px;height:700px;background:rgba(120,128,140,.10)"></div><div class="glow" style="left:900px;top:-150px;width:900px;height:520px;background:rgba(245,165,36,.05)"></div></div>`;
const GRAIN=`<svg id="grain" width="1920" height="1080"><filter id="nz"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(#nz)"/></svg><div id="vig"></div>`;
const LOGO=(sz=30,id='lgx')=>`<svg width="${sz}" height="${sz}" viewBox="0 0 32 32"><defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#F5A524"/><stop offset="1" stop-color="#D9822B"/></linearGradient></defs><path d="M16 3 L29 27 H3 Z" fill="none" stroke="url(#${id})" stroke-width="2.4" stroke-linejoin="round"/><path d="M9.5 19.5 H22.5" stroke="url(#${id})" stroke-width="2.4" stroke-linecap="round"/><circle cx="16" cy="12" r="2" fill="#F5A524"/></svg>`;
const ICON={
 check:(c='#F5A524',s=14)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="${c}" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
 clock:(c='#fbbf24',s=14)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path class="hand" d="M12 7v5l3 2"/></svg>`,
 lock:(c='#f0b90b',s=16)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="${c}" fill-opacity=".2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>`,
 hex:(c='#f0b90b',s=18)=>`<svg width="${s}" height="${s}" viewBox="0 0 40 40"><path d="M20 2 L35.6 11 V29 L20 38 L4.4 29 V11 Z" fill="${c}" fill-opacity=".2" stroke="${c}" stroke-width="3" stroke-linejoin="round"/><path d="M13 20.5 l4.6 4.6 L27.5 15" stroke="${c}" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
 shield:(c='#F5A524',s=16)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"><path d="M12 2.5 20 6v6c0 4.6-3.4 8.3-8 9.5-4.6-1.2-8-4.9-8-9.5V6z" fill="${c}" fill-opacity=".15"/><path d="M8.5 12l2.5 2.5 4.5-5" stroke-linecap="round"/></svg>`,
 key:(c='#93a1b3',s=16)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"><circle cx="8" cy="15" r="4.5"/><path d="M11.5 12 20 3.5M16.5 7l2.5 2.5M14 9.5l2 2"/></svg>`,
 arrow:(c='#93a1b3',s=16)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
 wallet:(c='#F5A524',s=16)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="3" fill="${c}" fill-opacity=".12"/><path d="M3 9h18M16 14h2" stroke-linecap="round"/></svg>`,
 pencil:(c='#93a1b3',s=16)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"><path d="M4 20l1-4L16 5l3 3L8 19z"/></svg>`,
};
function stageInit(inner){document.body.innerHTML=`<div id="stage">${STAGE_BG}<div id="cam"><div class="persp" id="persp">${inner}</div></div>${GRAIN}</div>`;}
