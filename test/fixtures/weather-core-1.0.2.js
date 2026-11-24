/*! Roundcast Weather Core v1.0.0 — 골프 날씨 알고리즘 (예보 수집·대체·기상청 덮어쓰기·라운드 등급·기관 비교)
 *  © 2026 HYEOKSANG LEE. All rights reserved. 소유: 날씨 앱(예정) · Roundcast는 이 파일의 고정 버전 사본을 넣어 사용.
 *  원본: Roundcast index.html 2026.11.15b 에서 분리. 계산 결과는 분리 전과 동일해야 함 (tools/날씨앱-인수인계.md 참고) */
(function(G){"use strict";
const VERSION="1.0.2";
/* ---- 설정: 앱이 WeatherCore.config({...}) 로 넣어 줌 (값 대신 함수도 가능) ---- */
const C={kma:()=>false,sbUrl:()=>"",sbKey:()=>"",fetch:null,rawFetch:(u,o)=>fetch(u,o)};
const fn=v=>typeof v==="function"?v:()=>v;
function config(o){o=o||{};if("kma"in o)C.kma=fn(o.kma);if("sbUrl"in o)C.sbUrl=fn(o.sbUrl);if("sbKey"in o)C.sbKey=fn(o.sbKey);if(o.fetch)C.fetch=o.fetch;if(o.rawFetch)C.rawFetch=o.rawFetch;return WC}
/* 시간 제한 + Open-Meteo 재시도 요청 (앱이 자체 fetch를 주면 그것을 사용) */
async function wfetch(url,opt={},ms=15000){
  if(C.fetch)return C.fetch(url,opt,ms);
  const once=(t)=>{const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),t);return C.rawFetch(url,{...opt,signal:ac.signal}).finally(()=>clearTimeout(tm))};
  if(!/^https:\/\/api\.open-meteo\.com\//.test(String(url)))return once(ms);
  const tries=[Math.min(ms,6000),Math.min(ms,9000)];let last;
  for(let i=0;i<tries.length;i++){try{const r=await once(tries[i]);if(r.ok||(r.status>=400&&r.status<429))return r;last=r}catch(e){last=e}if(i<tries.length-1)await new Promise(z=>setTimeout(z,600*(i+1)))}
  if(last instanceof Response)return last;throw last||new Error("fetch");
}

/* ===== 날씨 코드 → 한국어 ===== */
const WMO=c=>c===0?"맑음":c<=2?"구름 조금":c===3?"흐림":c<=48?"안개":c<=57?"이슬비":c<=67?"비":c<=77?"눈":c<=82?"소나기":c<=86?"눈 소나기":"뇌우";

/* ===== 라운드 등급 ===== */
function grade(s){return s>=85?{t:"매우좋음",c:"g-a"}:s>=70?{t:"좋음",c:"g-a"}:s>=50?{t:"보통",c:"g-b"}:{t:"나쁨",c:"g-c"}}
function windWord(w){return w<3?{t:"약함",c:"w1"}:w<6?{t:"보통",c:"w2"}:w<9?{t:"강함",c:"w3"}:{t:"매우 강함",c:"w4"}}
// 라운드 등급: 강수확률·강수량·기온만 반영 (바람은 별도 표시, 등급에서는 제외)
// 1.0.1 영하 상한: 최저기온 또는 체감온도 영하 → 최대 '보통', 최고기온도 영하(종일 영하)거나 체감 −10° 이하 → '나쁨'
function score(tmax,tmin,pp,wind,psum,gust,amin){
  let s=100;s-=(pp??0)*.5;
  if(tmax<5)s-=(5-tmax)*3;if(tmin<-5)s-=(-5-tmin)*2;if(tmax>31)s-=(tmax-31)*4;if(psum>1)s-=Math.min(20,psum*2);
  if(tmin<0||(amin!=null&&amin<=0))s=Math.min(s,65);if(tmax<0||(amin!=null&&amin<=-10)||tmax>=33)s=Math.min(s,45); /* 1.0.2 폭염(최고 33° 이상)도 '나쁨' */
  return Math.max(0,Math.min(100,Math.round(s)));
}
// 티오프부터 약 5시간(라운드 시간) 동안의 시간별 예보로 등급 계산
function winGrade(h,i){
  const idx=[0,1,2,3,4].map(k=>i+k).filter(k=>h.temperature_2m&&h.temperature_2m[k]!=null);if(!idx.length)return null;
  const v=a=>idx.map(k=>(h[a]||[])[k]).filter(x=>x!=null),mx=a=>v(a).length?Math.max(...v(a)):0,T=v("temperature_2m");
  return grade(score(Math.max(...T),Math.min(...T),mx("precipitation_probability"),mx("wind_speed_10m"),v("precipitation").reduce((x,y)=>x+y,0),v("wind_gusts_10m").length?mx("wind_gusts_10m"):undefined,v("apparent_temperature").length?Math.min(...v("apparent_temperature")):undefined));
}
/* 1.0.2 일상 활동이 어려운 극한 날씨 (기상청 한파주의보: 아침 최저 −12° 이하 · 폭염: 체감 33° 이상 기준) */
function extreme(T,A){if((A!=null&&A<=-10)||(T!=null&&T<=-12))return{k:"cold",t:"한파 수준의 추위. 일상 활동도 어려운 날씨입니다. 동상·저체온 위험이 있어 라운드 연기를 권합니다."};
  if((A!=null&&A>=33)||(T!=null&&T>=35))return{k:"hot",t:"폭염 수준의 더위. 일상 활동도 어려운 날씨입니다. 열사병 위험이 있어 라운드 연기나 이른 아침 티오프를 권합니다."};return null}
function extremeDay(tmax,tmin){if(tmin<=-12||tmax<=-5)return{k:"cold",t:"한파 · 일상 활동도 어려운 추위"};if(tmax>=33)return{k:"hot",t:"폭염 · 일상 활동도 어려운 더위"};return null}
function tips(hr,T,A,P,R,W,G,D){
  const t=[],ex=extreme(T,A);if(ex)t.push(ex.t);
  if(hr<=8&&T<=2&&T-D<3)t.push("서리 가능. 티오프 지연이 있을 수 있어 골프장에 미리 확인하세요.");
  else if(hr<=8&&T-D<2.5)t.push("이슬로 런이 줄어듭니다. 방수 골프화를 권합니다.");
  if(A<=0)t.push("체감 영하. 핫팩·넥워머·겨울장갑을 챙기고 볼을 주머니에 보관하세요.");
  else if(A<8)t.push("쌀쌀합니다. 바람막이와 얇은 이너를 겹쳐 입으세요.");
  else if(A>=30&&!(ex&&ex.k==="hot"))t.push("더위 주의. 매 홀 수분을 보충하세요.");
  if(T<10)t.push(`저온으로 비거리가 ${T<0?"10~12":"5~8"}m 줄어듭니다. 한 클럽 길게.`);
  if(W>=7||G>=11)t.push("강풍. 맞바람엔 두 클럽 길게, 넉다운 샷으로 탄도를 낮추세요.");
  else if(W>=4)t.push("맞바람 한 클럽 길게, 뒷바람 한 클럽 짧게.");
  if((P??0)>=60||R>=1)t.push("비 예보. 레인커버와 여분 장갑 2~3켤레를 챙기세요.");
  else if((P??0)>=30)t.push("간헐적 비 가능. 우산을 카트에 실어두세요.");
  if(!t.length)t.push("라운드하기 좋은 조건입니다.");
  return t;
}
/* 시간별 강수: 확률 50% 이상 또는 1시간 0.5mm 이상이면 '비' */
const isWet=(P,R)=>(P??0)>=50||(R??0)>=0.5;
/* 안개 단계: 0 맑음 · 1 옅은 안개(가시거리 3km 미만 또는 습도 95% 이상) · 2 안개(1km 미만) */
const fogLevel=(km,rh)=>isNaN(km)?0:km<1?2:km<3||(rh>=95)?1:0;

/* ===== 예보 비교 (국내 최대 3 + 해외 7) ===== */
// 국내: 실제로 데이터가 오는 곳만 맨 위에 표시. 해외: 우선순위대로 7곳
const DOMESTIC=[
  ["한국 기상청 KIM",["kma_kim","kma_kim_global","kim_global"],"한국형 수치예보모델"],
  ["한국 기상청 LDPS",["kma_ldps"],"국지 1.5km"],
  ["한국 기상청 GDPS",["kma_gdps","kma_seamless"],"전지구"]];
const GLOBAL=[
  ["유럽 ECMWF",["ecmwf_ifs","ecmwf_ifs025"],"Windy 기본 모델"],
  ["미국 NOAA GFS",["gfs_seamless"]],
  ["노르웨이 기상청",null,"yr.no"],
  ["영국 기상청",["ukmo_seamless","ukmo_global_deterministic_10km"]],
  ["독일 기상청",["icon_seamless","icon_global"]],
  ["프랑스 기상청",["meteofrance_seamless","meteofrance_arpege_world"]],
  ["캐나다 기상청",["gem_seamless","gem_global"]],
  ["일본 기상청",["jma_seamless"]]];
const SHOW_GLOBAL=7;
async function metNorway(lat,lon,times){
  // 노르웨이 기상청(yr.no): 단순 요청만 허용, 헤더 추가 금지
  const j=await (await wfetch(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`,{},12000)).json();
  const map={};
  for(const t of j.properties.timeseries){
    const k=new Date(new Date(t.time).getTime()+9*3600e3).toISOString().slice(0,13)+":00";
    const n=t.data.next_1_hours?.details;if(n)map[k]={p:n.precipitation_amount,pp:n.probability_of_precipitation};
  }
  return{p:times.map(k=>map[k]?.p??null),pp:times.map(k=>map[k]?.pp??null)};
}
/* 국내·해외 예보 기관별 시간 강수 비교: 실제로 데이터가 오는 곳만 (국내 최대 3 + 해외 SHOW_GLOBAL) */
async function compareModels(lat,lon,times){
  const course={lat,lon};
    const base=`https://api.open-meteo.com/v1/forecast?latitude=${course.lat}&longitude=${course.lon}&hourly=precipitation&timezone=Asia%2FSeoul&forecast_days=7`;
    const live=a=>Array.isArray(a)&&a.slice(0,48).filter(v=>v!=null).length>=24; // 앞으로 이틀 치 데이터가 있어야 '운영 중'
    const one=async ids=>{for(const m of ids){try{const r=await wfetch(base+"&models="+m);if(r.ok){const j=await r.json();if(live(j.hourly?.precipitation))return{p:j.hourly.precipitation,id:m}}}catch(e){}}throw 0};
    const get=list=>Promise.allSettled(list.map(([,ids])=>ids?one(ids):metNorway(lat,lon,times).then(v=>{if(!live(v.p))throw 0;return v})));
    const [dr,gr]=await Promise.all([get(DOMESTIC),get(GLOBAL)]);
    const used=new Set();
    const pick=(list,res)=>list.map(([n,,sub],i)=>res[i].status==="fulfilled"?{name:n,sub,...res[i].value}:null)
      .filter(m=>m&&!(m.id&&used.has(m.id))&&(m.id?used.add(m.id):1));
    const dom=pick(DOMESTIC,dr).slice(0,3).map(m=>({...m,dom:1,...(m.id==="kma_seamless"?{name:"한국 기상청 통합",sub:"GDPS+LDPS"}:{})})),glo=pick(GLOBAL,gr).slice(0,SHOW_GLOBAL);
    return{dom,glo};
}

/* ===== 날씨 예비 경로: Open-Meteo가 안 될 때 노르웨이 기상청(MET Norway) 예보를 같은 모양으로 변환 ===== */
const MET_SYM=[["clearsky",0],["fair",1],["partlycloudy",2],["cloudy",3],["fog",45],["lightrainshowers",80],["heavyrainshowers",82],["rainshowers",81],["lightsleetshowers",85],["sleetshowers",85],["heavysleetshowers",86],
 ["lightsnowshowers",85],["heavysnowshowers",86],["snowshowers",85],["thunder",95],["lightrain",61],["heavyrain",65],["rain",63],["lightsleet",66],["heavysleet",67],["sleet",67],["lightsnow",71],["heavysnow",75],["snow",73]];
function metCode(sym){if(!sym)return null;const s=sym.replace(/_(day|night|polartwilight)$/,"");if(/thunder/.test(s))return 95;for(const [k,c] of MET_SYM)if(s===k)return c;for(const [k,c] of MET_SYM)if(s.startsWith(k))return c;return 3}
function sunTimes(lat,lon,ymd){ // NOAA 간이식, KST "HH:MM"
  const d=new Date(ymd+"T12:00:00Z"),n=Math.floor((d-Date.UTC(d.getUTCFullYear(),0,0))/864e5),R=Math.PI/180;
  const g=2*Math.PI/365*(n-1),eq=229.18*(0.000075+0.001868*Math.cos(g)-0.032077*Math.sin(g)-0.014615*Math.cos(2*g)-0.040849*Math.sin(2*g));
  const dec=0.006918-0.399912*Math.cos(g)+0.070257*Math.sin(g)-0.006758*Math.cos(2*g)+0.000907*Math.sin(2*g)-0.002697*Math.cos(3*g)+0.00148*Math.sin(3*g);
  const ha=Math.acos(Math.cos(90.833*R)/(Math.cos(lat*R)*Math.cos(dec))-Math.tan(lat*R)*Math.tan(dec))/R;
  const f=m=>{m=((m+540)%1440+1440)%1440;return String(Math.floor(m/60)).padStart(2,"0")+":"+String(Math.round(m%60)%60).padStart(2,"0")};
  return[ymd+"T"+f(720-4*(lon+ha)-eq),ymd+"T"+f(720-4*(lon-ha)-eq)];
}
const metMem=new Map();
async function metAsOM(lat,lon,days=7){
  const k=(+lat).toFixed(3)+","+(+lon).toFixed(3);
  if(!metMem.has(k)){const p=C.rawFetch(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`).then(r=>{if(!r.ok)throw new Error("met "+r.status);return r.json()});
    metMem.set(k,p);p.catch(()=>metMem.delete(k));setTimeout(()=>metMem.delete(k),15*6e4)}
  const j=await metMem.get(k),ts=j.properties.timeseries;
  const kst=t=>new Date(new Date(t).getTime()+9*3600e3).toISOString().slice(0,13)+":00";
  const today=new Date(Date.now()+9*3600e3).toISOString().slice(0,10),T=[];
  for(let d=0;d<days;d++){const day=new Date(Date.parse(today+"T00:00:00Z")+d*864e5).toISOString().slice(0,10);for(let h=0;h<24;h++)T.push(day+"T"+String(h).padStart(2,"0")+":00")}
  const idx=new Map(T.map((t,i)=>[t,i])),N=T.length,arr=()=>Array(N).fill(null);
  const H={time:T,temperature_2m:arr(),apparent_temperature:arr(),precipitation_probability:arr(),precipitation:arr(),wind_speed_10m:arr(),wind_gusts_10m:arr(),dew_point_2m:arr(),weather_code:arr(),visibility:arr(),relative_humidity_2m:arr()};
  for(const t of ts){const i0=idx.get(kst(t.time));if(i0==null)continue;const det=t.data.instant.details,n1=t.data.next_1_hours,n6=t.data.next_6_hours;
    const span=n1?1:n6?6:1,next=n1||n6;
    for(let o=0;o<span&&i0+o<N;o++){const i=i0+o;if(o>0&&H.temperature_2m[i]!=null)continue;
      H.temperature_2m[i]=det.air_temperature??null;H.apparent_temperature[i]=det.air_temperature??null;H.wind_speed_10m[i]=det.wind_speed??null;
      H.wind_gusts_10m[i]=det.wind_speed_of_gust??null;H.dew_point_2m[i]=det.dew_point_temperature??null;H.relative_humidity_2m[i]=det.relative_humidity??null;
      if(next){H.weather_code[i]=metCode(next.summary?.symbol_code);const nd=next.details||{};
        H.precipitation[i]=nd.precipitation_amount!=null?Math.round(nd.precipitation_amount/span*100)/100:null;
        H.precipitation_probability[i]=nd.probability_of_precipitation??(nd.precipitation_amount>0?60:nd.precipitation_amount===0?5:null);}}}
  // 빈 칸 채우기: 오늘 지난 시간은 첫 값으로, 6시간 간격 구간·누락은 앞 값으로 (화면 계산에 빈 값이 없게)
  for(const f of Object.keys(H)){if(f==="time")continue;const a=H[f];let first=a.find(x=>x!=null);if(first==null)continue;let last=first;
    for(let i=0;i<N;i++){if(a[i]==null)a[i]=f==="precipitation"?0:last;else last=a[i]}}
  for(let i=0;i<N;i++){if(H.wind_gusts_10m[i]==null||H.wind_gusts_10m[i]<H.wind_speed_10m[i])H.wind_gusts_10m[i]=Math.round((H.wind_speed_10m[i]||0)*17)/10;
    if(H.dew_point_2m[i]==null&&H.temperature_2m[i]!=null)H.dew_point_2m[i]=H.temperature_2m[i]-6;if(H.apparent_temperature[i]==null)H.apparent_temperature[i]=H.temperature_2m[i]}
  const D={time:[],weather_code:[],temperature_2m_max:[],temperature_2m_min:[],precipitation_probability_max:[],precipitation_sum:[],wind_speed_10m_max:[],wind_gusts_10m_max:[],sunrise:[],sunset:[]};
  for(let d=0;d<days;d++){const ii=[...Array(24).keys()].map(h=>d*24+h),v=f=>ii.map(i=>H[f][i]).filter(x=>x!=null),day=T[d*24].slice(0,10);
    const t=v("temperature_2m");if(!t.length)break;const c=ii.filter(i=>{const h=i%24;return h>=6&&h<=19}).map(i=>H.weather_code[i]).filter(x=>x!=null);
    D.time.push(day);D.temperature_2m_max.push(Math.max(...t));D.temperature_2m_min.push(Math.min(...t));
    const pp=v("precipitation_probability"),pr=v("precipitation"),w=v("wind_speed_10m"),g=v("wind_gusts_10m");
    D.precipitation_probability_max.push(pp.length?Math.max(...pp):null);D.precipitation_sum.push(pr.length?Math.round(pr.reduce((a,b)=>a+b,0)*10)/10:0);
    D.wind_speed_10m_max.push(w.length?Math.max(...w):null);D.wind_gusts_10m_max.push(g.length?Math.max(...g):null);
    D.weather_code.push(c.length?Math.max(...c):3);const st=sunTimes(+lat,+lon,day);D.sunrise.push(st[0]);D.sunset.push(st[1]);}
  const nowK=new Date(Date.now()+9*3600e3).toISOString().slice(0,13)+":00",ni=Math.max(0,T.indexOf(nowK));
  return{latitude:+lat,longitude:+lon,timezone:"Asia/Seoul",src:"met",
    current:{time:T[ni],temperature_2m:H.temperature_2m[ni],apparent_temperature:H.apparent_temperature[ni],precipitation:H.precipitation[ni]??0,wind_speed_10m:H.wind_speed_10m[ni],weather_code:H.weather_code[ni]??3},
    hourly:H,daily:D};
}
// Open-Meteo를 먼저 시도하고, 4초 안에 답이 없으면 노르웨이 기상청도 같이 요청해서 먼저 온 쪽을 씀
function omOrMet(url,pts,days){
  let done=false;
  const om=wfetch(url).then(r=>{if(!r.ok)throw 0;return r.json()}).then(j=>{done=true;return j});
  const met=new Promise(z=>setTimeout(z,4000)).then(()=>{if(done)throw 0;return Promise.all(pts.map(p=>metAsOM(p[0],p[1],days)))}).then(a=>a.length===1?a[0]:a);
  return Promise.any([om,met]).catch(()=>{throw new Error("weather")});
}

/* ===== 기상청 동네예보 (오늘~글피, 5km 격자) 덧씌우기 ===== */
const kmaMem=new Map();
function kmaGet(lat,lon){
  if(!C.kma())return Promise.resolve(null);
  const k=(+lat).toFixed(3)+","+(+lon).toFixed(3);
  if(!kmaMem.has(k)){
    const p=wfetch(`${C.sbUrl()}/functions/v1/kma?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`,{headers:{apikey:C.sbKey()}},8000)
      .then(r=>r.ok?r.json():null).then(j=>j&&j.ok&&j.hourly&&Array.isArray(j.hourly.time)&&j.hourly.time.length?j:null).catch(()=>null);
    kmaMem.set(k,p);setTimeout(()=>kmaMem.delete(k),15*6e4);
  }
  return kmaMem.get(k);
}
const kmaWait=(lat,lon,ms=6000)=>Promise.race([kmaGet(lat,lon),new Promise(r=>setTimeout(()=>r(null),ms))]);
function kmaOverlay(j,k){
  if(!j||!k||!j.hourly||!Array.isArray(j.hourly.time))return 0;
  const H=j.hourly,idx=new Map(H.time.map((t,i)=>[t,i])),days=new Map();let n=0;
  k.hourly.time.forEach((t,ki)=>{const i=idx.get(t);if(i==null)return;
    ["temperature_2m","precipitation_probability","precipitation","wind_speed_10m","weather_code","relative_humidity_2m"].forEach(f=>{const v=k.hourly[f]?.[ki];if(v!=null&&Array.isArray(H[f]))H[f][i]=v});
    (H.kma=H.kma||[])[i]=1;n++;const d=t.slice(0,10);days.set(d,(days.get(d)||0)+1)});
  const D=j.daily;
  if(D&&Array.isArray(D.time))D.time.forEach((d,di)=>{if((days.get(d)||0)<12)return;
    const ii=H.time.map((t,i)=>t.startsWith(d)?i:-1).filter(i=>i>=0),v=f=>ii.map(i=>H[f]?.[i]).filter(x=>x!=null);
    const T=v("temperature_2m"),P=v("precipitation_probability"),R=v("precipitation"),W=v("wind_speed_10m");
    if(T.length&&D.temperature_2m_max){D.temperature_2m_max[di]=Math.max(...T);D.temperature_2m_min[di]=Math.min(...T)}
    if(P.length&&D.precipitation_probability_max)D.precipitation_probability_max[di]=Math.max(...P);
    if(R.length&&D.precipitation_sum)D.precipitation_sum[di]=Math.round(R.reduce((a,b)=>a+b,0)*10)/10;
    if(W.length&&D.wind_speed_10m_max)D.wind_speed_10m_max[di]=Math.max(...W);
    const C=ii.filter(i=>{const h=+H.time[i].slice(11,13);return h>=6&&h<=19}).map(i=>H.weather_code?.[i]).filter(x=>x!=null);
    if(C.length&&D.weather_code)D.weather_code[di]=Math.max(...C);
    (D.kma=D.kma||[])[di]=1});
  j.kmaN=n;return n;
}

const WC={VERSION,config,wfetch,WMO,grade,windWord,score,winGrade,tips,extreme,extremeDay,isWet,fogLevel,DOMESTIC,GLOBAL,SHOW_GLOBAL,metNorway,compareModels,MET_SYM,metCode,sunTimes,metAsOM,omOrMet,kmaGet,kmaWait,kmaOverlay};
G.WeatherCore=WC;if(typeof module!=="undefined"&&module.exports)module.exports=WC;
})(typeof globalThis!=="undefined"?globalThis:this);
