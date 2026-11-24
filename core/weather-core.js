/*! Polychrome Weather Core v1.1.0 — 날씨 알고리즘 (예보 수집·대체·기상청 덮어쓰기·라운드 등급·기관 비교·비 합의 예보·한 줄 요약)
 *  © 2026 HYEOKSANG LEE. All rights reserved. 소유: Polychrome · Roundcast는 이 파일의 고정 버전(pinned) 사본을 넣어 사용.
 *  원본: Roundcast index.html 2026.11.15b 에서 분리(v1.0.0). 시간대 인자(tz)를 생략하면 "Asia/Seoul"로 동작해 1.0.2와 결과 동일.
 *  변경 이력: CHANGELOG.md (docs/handoff-from-roundcast.md 참고) */
(function(G){"use strict";
const VERSION="1.1.0";
/* ---- 설정: 앱이 WeatherCore.config({...}) 로 넣어 줌 (값 대신 함수도 가능) ---- */
const C={kma:()=>false,sbUrl:()=>"",sbKey:()=>"",fetch:null,rawFetch:(u,o)=>fetch(u,o),tz:()=>"Asia/Seoul"};
const fn=v=>typeof v==="function"?v:()=>v;
function config(o){o=o||{};if("kma"in o)C.kma=fn(o.kma);if("sbUrl"in o)C.sbUrl=fn(o.sbUrl);if("sbKey"in o)C.sbKey=fn(o.sbKey);if(o.fetch)C.fetch=o.fetch;if(o.rawFetch)C.rawFetch=o.rawFetch;if(o.tz)C.tz=fn(o.tz);return WC}
/* ===== 1.1.0 시간대: IANA 시간대의 UTC 차이(분)를 순간마다 계산 (일광절약시간 반영) =====
 * Asia/Seoul은 1988년 이후 일광절약시간이 없어 +9시간 고정 → 1.0.2와 비트 단위로 같은 결과(Intl 불필요). */
const tzOf=tz=>tz||C.tz()||"Asia/Seoul";
const dtfMem=new Map();
function tzOffsetMin(tz,ms){
  tz=tzOf(tz);if(tz==="Asia/Seoul")return 540;
  if(tz==="UTC"||tz==="Etc/UTC")return 0;
  let f=dtfMem.get(tz);
  if(!f){f=new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"});dtfMem.set(tz,f)}
  const p={};for(const x of f.formatToParts(new Date(ms)))p[x.type]=x.value;
  const asUTC=Date.UTC(+p.year,+p.month-1,+p.day,(+p.hour)%24,+p.minute,+p.second);
  return Math.round((asUTC-Math.floor(ms/1000)*1000)/6e4);
}
/* 순간(ms 또는 ISO 문자열) → 현지 "YYYY-MM-DDTHH:MM" */
function localIso(t,tz){const ms=typeof t==="number"?t:new Date(t).getTime();return new Date(ms+tzOffsetMin(tz,ms)*6e4).toISOString().slice(0,16)}
const localHour=(t,tz)=>localIso(t,tz).slice(0,13)+":00";
function localNow(tz){return localIso(Date.now(),tz)}
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
async function metNorway(lat,lon,times,tz){
  // 노르웨이 기상청(yr.no): 단순 요청만 허용, 헤더 추가 금지
  const j=await (await wfetch(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`,{},12000)).json();
  const map={};
  for(const t of j.properties.timeseries){
    const k=localHour(t.time,tz); /* 1.1.0: +9h 고정 → 시간대별 */
    const n=t.data.next_1_hours?.details;if(n)map[k]={p:n.precipitation_amount,pp:n.probability_of_precipitation};
  }
  return{p:times.map(k=>map[k]?.p??null),pp:times.map(k=>map[k]?.pp??null)};
}
/* 국내·해외 예보 기관별 시간 강수 비교: 실제로 데이터가 오는 곳만 (국내 최대 3 + 해외 SHOW_GLOBAL) */
async function compareModels(lat,lon,times,tz){
  const course={lat,lon};
    const base=`https://api.open-meteo.com/v1/forecast?latitude=${course.lat}&longitude=${course.lon}&hourly=precipitation&timezone=${encodeURIComponent(tzOf(tz))}&forecast_days=7`;
    const live=a=>Array.isArray(a)&&a.slice(0,48).filter(v=>v!=null).length>=24; // 앞으로 이틀 치 데이터가 있어야 '운영 중'
    const one=async ids=>{for(const m of ids){try{const r=await wfetch(base+"&models="+m);if(r.ok){const j=await r.json();if(live(j.hourly?.precipitation))return{p:j.hourly.precipitation,id:m}}}catch(e){}}throw 0};
    const get=list=>Promise.allSettled(list.map(([,ids])=>ids?one(ids):metNorway(lat,lon,times,tz).then(v=>{if(!live(v.p))throw 0;return v})));
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
function sunTimes(lat,lon,ymd,tz){ // NOAA 간이식, 현지(tz, 기본 KST) "YYYY-MM-DDTHH:MM"
  const d=new Date(ymd+"T12:00:00Z"),n=Math.floor((d-Date.UTC(d.getUTCFullYear(),0,0))/864e5),R=Math.PI/180;
  const g=2*Math.PI/365*(n-1),eq=229.18*(0.000075+0.001868*Math.cos(g)-0.032077*Math.sin(g)-0.014615*Math.cos(2*g)-0.040849*Math.sin(2*g));
  const dec=0.006918-0.399912*Math.cos(g)+0.070257*Math.sin(g)-0.006758*Math.cos(2*g)+0.000907*Math.sin(2*g)-0.002697*Math.cos(3*g)+0.00148*Math.sin(3*g);
  const ha=Math.acos(Math.cos(90.833*R)/(Math.cos(lat*R)*Math.cos(dec))-Math.tan(lat*R)*Math.tan(dec))/R;
  const day0=Date.parse(ymd+"T00:00:00Z"),off=m=>tzOffsetMin(tz,isFinite(m)?day0+m*6e4:day0+720*6e4); /* 1.1.0: 그 순간의 UTC 차이 */
  const f=m=>{m=((m+off(m))%1440+1440)%1440;return String(Math.floor(m/60)).padStart(2,"0")+":"+String(Math.round(m%60)%60).padStart(2,"0")};
  return[ymd+"T"+f(720-4*(lon+ha)-eq),ymd+"T"+f(720-4*(lon-ha)-eq)];
}
const metMem=new Map();
async function metAsOM(lat,lon,days=7,tz){
  tz=tzOf(tz);
  const k=(+lat).toFixed(3)+","+(+lon).toFixed(3);
  if(!metMem.has(k)){const p=C.rawFetch(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`).then(r=>{if(!r.ok)throw new Error("met "+r.status);return r.json()});
    metMem.set(k,p);p.catch(()=>metMem.delete(k));setTimeout(()=>metMem.delete(k),15*6e4)}
  const j=await metMem.get(k),ts=j.properties.timeseries;
  const kst=t=>localHour(t,tz); /* 1.1.0: 이름은 그대로, 시간대별 현지 시각 */
  const today=localNow(tz).slice(0,10),T=[];
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
    D.weather_code.push(c.length?Math.max(...c):3);const st=sunTimes(+lat,+lon,day,tz);D.sunrise.push(st[0]);D.sunset.push(st[1]);}
  const nowK=localHour(Date.now(),tz),ni=Math.max(0,T.indexOf(nowK));
  return{latitude:+lat,longitude:+lon,timezone:tz,src:"met",
    current:{time:T[ni],temperature_2m:H.temperature_2m[ni],apparent_temperature:H.apparent_temperature[ni],precipitation:H.precipitation[ni]??0,wind_speed_10m:H.wind_speed_10m[ni],weather_code:H.weather_code[ni]??3},
    hourly:H,daily:D};
}
// Open-Meteo를 먼저 시도하고, 4초 안에 답이 없으면 노르웨이 기상청도 같이 요청해서 먼저 온 쪽을 씀
function omOrMet(url,pts,days,tz){ /* 1.1.0: tz 선택 인자 → MET 대체 경로의 현지 시각 */
  let done=false;
  const om=wfetch(url).then(r=>{if(!r.ok)throw 0;return r.json()}).then(j=>{done=true;return j});
  const met=new Promise(z=>setTimeout(z,4000)).then(()=>{if(done)throw 0;return Promise.all(pts.map(p=>tz?metAsOM(p[0],p[1],days,tz):metAsOM(p[0],p[1],days)))}).then(a=>a.length===1?a[0]:a);
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

/* =====================================================================
 * 1.1.0 추가: Open-Meteo URL · 비 전망 · 비 합의 예보 · 미세먼지 등급 · 한 줄 요약 · 아이콘 키
 * 시간 문자열은 모두 도시 현지 "YYYY-MM-DDTHH:MM". ===================================================================== */
const OM_HOURLY="temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,dew_point_2m,uv_index,is_day";
const OM_DAILY="weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max";
const OM_CURRENT="temperature_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,is_day";
function omUrl(o){o=o||{};const days=o.days??7,m=o.models;
  let u=`https://api.open-meteo.com/v1/forecast?latitude=${o.lat}&longitude=${o.lon}&hourly=${OM_HOURLY}&daily=${OM_DAILY}&current=${OM_CURRENT}&timezone=${encodeURIComponent(tzOf(o.tz))}&forecast_days=${days}&wind_speed_unit=ms`;
  if(m&&(!Array.isArray(m)||m.length))u+="&models="+(Array.isArray(m)?m.join(","):m);
  return u}
const sum=a=>a.reduce((x,y)=>x+y,0),r1=x=>Math.round(x*10)/10,r2=x=>Math.round(x*100)/100;
/* 시간별 예보(hourly)에서 fromIdx부터 hours시간: 비 여부(isWet), 첫/마지막 비 시각(그 시간 칸의 표시 시각), 합계 강수량, 최대 확률 */
function rainOutlook(h,fromIdx,hours=24){
  const T=(h&&h.time)||[],P=(h&&h.precipitation_probability)||[],R=(h&&h.precipitation)||[];
  const a=Math.max(0,fromIdx|0),b=Math.min(T.length,a+hours);let s=-1,e=-1,n=0,mm=0,mp=null;
  for(let i=a;i<b;i++){if(R[i]!=null)mm+=R[i];if(P[i]!=null)mp=mp==null?P[i]:Math.max(mp,P[i]);
    if(isWet(P[i],R[i])){n++;if(s<0)s=i;e=i}}
  return{wet:n>0,start:s<0?null:T[s],end:e<0?null:T[e],totalMm:r1(mm),maxProb:mp,hoursWet:n};
}
/* 가중 분위수(계단형): 누적 무게 비율이 q 이상이 되는 가장 작은 값 */
function wQuant(vw,q){const a=vw.slice().sort((x,y)=>x[0]-y[0]),W=sum(a.map(x=>x[1]));if(!a.length)return null;if(!(W>0))return wQuant(a.map(x=>[x[0],1]),q);
  let c=0;for(const [v,w] of a){c+=w;if(c>=q*W-1e-9)return v}return a[a.length-1][0]}
/* 비 합의 예보. models:[{id,p:[mm…],pp?:[%…],issued?}] (같은 시간 축), weights:{[id]:{rain,amount,bias}}
 * 시간별: prob = 비 무게 가중 '비 온다(isWet)' 비율(%), mm = 강수량 무게 가중 평균(p/bias), mmLo/mmHi = 가중 20/80 분위,
 * agree = 다수 쪽에 선 기관 비율. 그 시간 값이 없는(null) 기관은 제외. 무게가 없으면 같은 무게, bias 1. */
function consensus(models,weights){
  models=(models||[]).filter(m=>m&&Array.isArray(m.p||m.pp));weights=weights||{};
  const W=m=>weights[m.id]||{},wr=m=>{const w=W(m).rain;return w!=null&&w>=0?+w:1},wa=m=>{const w=W(m).amount;return w!=null&&w>=0?+w:1},
    bias=m=>{const b=W(m).bias;return b!=null&&b>0?+b:1};
  const N=Math.max(0,...models.map(m=>Math.max((m.p||[]).length,(m.pp||[]).length)));
  const out={prob:[],mm:[],mmLo:[],mmHi:[],agree:[],n:models.length,
    members:models.map(m=>({id:m.id,w:wr(m),wet:[]}))};
  for(let i=0;i<N;i++){
    const wet=[],amt=[];
    models.forEach((m,k)=>{const p=m.p?.[i],pp=m.pp?.[i];
      if(p==null&&pp==null){out.members[k].wet.push(null);return}
      const w=isWet(pp,p);out.members[k].wet.push(w);wet.push([w,wr(m)]);
      if(p!=null)amt.push([p/bias(m),wa(m)])});
    if(!wet.length){out.prob.push(null);out.agree.push(null)}
    else{let sw=sum(wet.map(x=>x[1]));const ws=sw>0?wet:wet.map(x=>[x[0],1]);sw=sum(ws.map(x=>x[1]));
      out.prob.push(Math.round(100*sum(ws.filter(x=>x[0]).map(x=>x[1]))/sw));
      const y=wet.filter(x=>x[0]).length;out.agree.push(r2(Math.max(y,wet.length-y)/wet.length))}
    if(!amt.length){out.mm.push(null);out.mmLo.push(null);out.mmHi.push(null)}
    else{let sa=sum(amt.map(x=>x[1]));const as=sa>0?amt:amt.map(x=>[x[0],1]);sa=sum(as.map(x=>x[1]));
      out.mm.push(r2(sum(as.map(x=>x[0]*x[1]))/sa));out.mmLo.push(r2(wQuant(as,0.2)));out.mmHi.push(r2(wQuant(as,0.8)))}
  }
  return out;
}
/* 합의 예보의 구간 요약. prob = 구간 안 어느 한 시간이라도 비가 오는 기관의 가중 비율(%), grade 70↑ sure · 40↑ likely · low,
 * mm/mmLo/mmHi = 시간별 값의 합, start/end = 시간별 prob≥50인 첫/마지막 시간(times 또는 c.time이 있으면 시각 문자열, 없으면 인덱스),
 * agreeN = 구간 다수 쪽(비/무강수)에 선 기관 수, n = 구간 안에 값이 있는 기관 수. */
function consensusWindow(c,fromIdx,hours,times){
  times=times||c?.time||null;const L=(c?.prob||[]).length,a=Math.max(0,fromIdx|0),b=Math.min(L,a+(hours??24));
  const mem=(c?.members||[]).map(m=>{const s=m.wet.slice(a,b).filter(x=>x!=null);return s.length?{w:m.w,any:s.some(Boolean)}:null}).filter(Boolean);
  let prob=null,agreeN=0;
  if(mem.length){const sw=sum(mem.map(m=>m.w)),ms=sw>0?mem:mem.map(m=>({...m,w:1})),tw=sum(ms.map(m=>m.w));
    prob=Math.round(100*sum(ms.filter(m=>m.any).map(m=>m.w))/tw);const y=mem.filter(m=>m.any).length;agreeN=Math.max(y,mem.length-y)}
  else{const ps=c.prob.slice(a,b).filter(x=>x!=null);if(ps.length)prob=Math.max(...ps)}
  let s=-1,e=-1,mm=0,lo=0,hi=0,any=false;
  for(let i=a;i<b;i++){if(c.mm[i]!=null){any=true;mm+=c.mm[i];lo+=c.mmLo[i]??0;hi+=c.mmHi[i]??0}if(c.prob[i]!=null&&c.prob[i]>=50){if(s<0)s=i;e=i}}
  const t=i=>i<0?null:times?times[i]??null:i;
  return{prob,grade:prob==null?null:prob>=70?"sure":prob>=40?"likely":"low",mm:any?r1(mm):null,mmLo:any?r1(lo):null,mmHi:any?r1(hi):null,
    start:t(s),end:t(e),startIdx:s<0?null:s,endIdx:e<0?null:e,agreeN,n:mem.length};
}
/* 미세먼지 등급 (환경부): PM10 0–30 좋음 / 31–80 보통 / 81–150 나쁨 / 151+ 매우나쁨, PM2.5 0–15 / 16–35 / 36–75 / 76+ */
const AIR_ORDER=["good","moderate","bad","verybad"];
function airGrade(pm10,pm25){
  const g=(v,t)=>v==null||v===""||isNaN(+v)?null:+v<=t[0]?"good":+v<=t[1]?"moderate":+v<=t[2]?"bad":"verybad";
  const a=g(pm10,[30,80,150]),b=g(pm25,[15,35,75]),w=[a,b].filter(Boolean).sort((x,y)=>AIR_ORDER.indexOf(y)-AIR_ORDER.indexOf(x))[0]||null;
  return{pm10:a,pm25:b,worst:w};
}
const addDays=(ymd,n)=>new Date(Date.parse(ymd+"T00:00:00Z")+n*864e5).toISOString().slice(0,10);
/* 한 줄 요약 (문장 아님): 극한 → 비(24시간 안 지금/시작/그침, 아니면 이번 주 비 오는 날) → 초미세먼지 나쁨 → 기온 변화(전날 대비 3°↑) → 무난 */
function summary(wx,o){
  o=o||{};const H=(wx&&wx.hourly)||{},D=(wx&&wx.daily)||{},T=H.time||[];
  const now=o.now||wx?.current?.time||localNow(wx?.timezone),today=now.slice(0,10);
  let i0=-1;for(let i=0;i<T.length;i++){if(T[i]<=now)i0=i;else break}if(i0<0)i0=0;
  const di=(D.time||[]).indexOf(today),dv=f=>di>=0&&D[f]?D[f][di]??null:null;
  const cur=wx?.current||{},temp=cur.temperature_2m??H.temperature_2m?.[i0]??null,feels=cur.apparent_temperature??H.apparent_temperature?.[i0]??null;
  const tmax=dv("temperature_2m_max"),tmin=dv("temperature_2m_min");
  /* 1. 극한 */
  const ex=extreme(temp,feels)||(tmax!=null&&tmin!=null?extremeDay(tmax,tmin):null);
  if(ex)return{kind:"extreme",key:"extreme."+ex.k,data:{temp,feels,tmax,tmin}};
  /* 2. 비 (24시간) */
  const ro=rainOutlook(H,i0,24);
  if(ro.wet){const P=H.precipitation_probability||[],R=H.precipitation||[],wet=i=>i<T.length&&isWet(P[i],R[i]);
    let s=i0;while(s<i0+24&&s<T.length&&!wet(s))s++;let e=s;while(e+1<i0+24&&wet(e+1))e++;
    const run=[];for(let i=s;i<=e;i++)run.push(i);const mm=r1(sum(run.map(i=>R[i]??0))),prob=Math.max(...run.map(i=>P[i]??0));
    const ended=e+1<Math.min(i0+24,T.length); /* 구간 안에서 그침 */
    const data={start:T[s],end:ended?T[e]:null,mm,prob,totalMm:ro.totalMm,hoursWet:ro.hoursWet};
    if(s===i0)return{kind:"rain",key:ended?"rain.end":"rain.now",data};
    return{kind:"rain",key:T[s].slice(0,10)===addDays(today,1)?"rain.tomorrow":"rain.start",data}}
  if(di>=0&&D.precipitation_probability_max){for(let d=di+1;d<Math.min(D.time.length,di+7);d++){const pp=D.precipitation_probability_max[d];
    if(pp!=null&&pp>=60){const date=D.time[d];return{kind:"rain",key:d===di+1?"rain.tomorrow":"rain.dayOfWeek",
      data:{date,dow:new Date(date+"T00:00:00Z").getUTCDay(),prob:pp,mm:D.precipitation_sum?.[d]??null}}}}}
  /* 3. 미세먼지 */
  if(o.air){const g=airGrade(o.air.pm10,o.air.pm25);if(g.worst==="bad"||g.worst==="verybad")return{kind:"air",key:"air."+g.worst,data:{pm10:o.air.pm10??null,pm25:o.air.pm25??null,grade:g}}}
  /* 4. 기온 변화 */
  if(o.prevDay&&o.prevDay.tmax!=null&&tmax!=null){const diff=r1(tmax-o.prevDay.tmax);
    if(diff>=3)return{kind:"temp",key:"temp.warmer",data:{tmax,prevTmax:o.prevDay.tmax,diff}};
    if(diff<=-3)return{kind:"temp",key:"temp.colder",data:{tmax,prevTmax:o.prevDay.tmax,diff}}}
  /* 5. 무난 */
  const code=dv("weather_code")??cur.weather_code??H.weather_code?.[i0]??null;
  return{kind:"calm",key:code!=null&&code>=3?"calm.cloudy":"calm.clear",data:{code,tmax,tmin,temp}};
}
/* WMO 코드 → 선 아이콘 키. 68·69는 기상청 변환(진눈깨비). 바람 14m/s 이상 + 맑음~흐림이면 강풍 */
function iconKey(code,isDay,mm,windMs){
  const d=!(isDay===0||isDay===false),c=code==null?null:+code;
  if(windMs!=null&&windMs>=14&&c!=null&&c<=3)return"wind";
  if(c==null||isNaN(c))return"cloudy";
  if(c===0)return d?"clear-day":"clear-night";
  if(c<=2)return d?"partly-day":"partly-night";
  if(c===3)return"cloudy";
  if(c>=40&&c<=49)return"fog";
  if(c>=50&&c<=59)return"drizzle";
  if(c===66||c===67||c===68||c===69)return"sleet";
  if(c>=60&&c<=65)return c===65||(mm!=null&&mm>=5)?"rain-heavy":"rain";
  if(c>=70&&c<=79)return"snow";
  if(c>=80&&c<=84)return d?"showers-day":"showers-night";
  if(c===85||c===86)return"snow";
  if(c>=95&&c<=99)return"thunder";
  return"cloudy";
}

const WC={VERSION,config,wfetch,WMO,grade,windWord,score,winGrade,tips,extreme,extremeDay,isWet,fogLevel,DOMESTIC,GLOBAL,SHOW_GLOBAL,metNorway,compareModels,MET_SYM,metCode,sunTimes,metAsOM,omOrMet,kmaGet,kmaWait,kmaOverlay,
  localNow,localIso,tzOffsetMin,omUrl,rainOutlook,consensus,consensusWindow,airGrade,summary,iconKey};
G.WeatherCore=WC;if(typeof module!=="undefined"&&module.exports)module.exports=WC;
})(typeof globalThis!=="undefined"?globalThis:this);
