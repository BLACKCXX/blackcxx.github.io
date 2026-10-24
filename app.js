import {PairClock} from './timing.js?v=1';
const gallery=document.querySelector('#gallery'), pauseAll=document.querySelector('#pause-all');
const cards=[]; let globalPlay=true;
const node=(tag, cls, text) => {const n=document.createElement(tag); if(cls)n.className=cls;if(text)n.textContent=text;return n;};
const eventReady=(video,event,ready) => new Promise((resolve,reject) => {
  if(ready()){resolve();return;}
  const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,ok);video.removeEventListener('error',bad);};
  const ok=()=>{if(ready()){cleanup();resolve();}};
  const bad=()=>{cleanup();reject(new Error('视频加载失败'));};
  const timer=setTimeout(()=>{cleanup();reject(new Error('视频加载超时，请点击播放重试'));},15000);
  video.addEventListener(event,ok);video.addEventListener('error',bad);
});
async function seek(video,time){
  if(Math.abs(video.currentTime-time)>.0005){
    // Subscribe before seek; retain the old visible frame until the destination is ready.
    let assigned=false;
    const done=eventReady(video,'seeked',()=>assigned && !video.seeking && Math.abs(video.currentTime-time)<.01);
    assigned=true;video.currentTime=time;await done;
  }
  await eventReady(video,'loadeddata',()=>video.readyState>=2);
}
class PairCard {
  constructor(sample,index){
    this.sample=sample;this.mode='g1';this.desired='g1';this.visible=false;this.ready=false;this.wantsPlay=true;this.busy=false;this.resetting=false;this.packed=sample.presentation?.kind==='packed_pair';this.loading=null;
    this.el=node('article','card');this.el.dataset.sampleKey=sample.sample_key;this.el.dataset.sampleId=sample.sample_id;this.el.dataset.mode='g1';
    this.stage=node('button','switch');this.stage.type='button';this.stage.setAttribute('aria-label',sample.title+'，切换人体 / G1');this.stage.setAttribute('aria-pressed','false');
    this.poster=node('img','poster');this.poster.alt='';this.poster.loading='lazy';if(sample.poster_path)this.poster.src=sample.poster_path;
    this.stage.append(this.poster);this.videos={};
    for(const side of this.packed?['g1']:['g1','human']){
      const v=node('video',this.packed?'packed':'');v.muted=true;v.defaultMuted=true;v.playsInline=true;v.preload='none';v.disablePictureInPicture=true;v.setAttribute('aria-hidden','true');v.dataset.side=this.packed?'pair':side;
      v.addEventListener('error',()=>this.fail(new Error('视频暂时无法加载，请点击播放重试')));
      v.addEventListener('ended',()=>this.restart().catch(e=>this.fail(e)));
      this.videos[side]=v;this.stage.append(v);
    }
    this.blend=node('canvas','transition-frame');this.blend.setAttribute('aria-hidden','true');this.stage.append(this.blend);this.blendAnimation=null;
    this.badge=node('span','badge','HUMANOID · G1');this.stage.append(this.badge);
    this.message=node('span','media-message');this.message.hidden=true;this.stage.append(this.message);
    const info=node('div','card-info'), title=node('div','card-title');title.append(node('h2','',sample.title),node('span','number',String(index+1).padStart(2,'0')));
    const controls=node('div','card-controls');this.toggle=node('button','toggle-side','查看人体');this.toggle.type='button';this.toggle.setAttribute('aria-pressed','false');
    this.play=node('button','play-card','暂停');this.play.type='button';this.play.setAttribute('aria-pressed','false');controls.append(this.toggle,this.play);
    const links=node('div','links');for(const [field,label] of [['source_url','原视频'],['details_url','修复详情']])if(sample[field]){const a=node('a','',label);a.href=sample[field];a.target='_blank';a.rel='noopener';links.append(a);}
    info.append(title,controls,links);
    if(sample.quality_note)info.append(node('p','quality-note',sample.quality_note));
    if(sample.timing.mode==='mapped')info.append(node('p','quality-note','配对播放：共同有效时段'));
    this.el.append(this.stage,info);gallery.append(this.el);
    this.el.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')this.request('human');});
    this.el.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')this.request('g1');});
    this.toggle.addEventListener('click',()=>this.request(this.desired==='g1'?'human':'g1'));
    this.stage.addEventListener('click',e=>{if(e.detail===0 || !matchMedia('(hover:hover)').matches)this.request(this.desired==='g1'?'human':'g1');});
    this.play.addEventListener('click',()=>{
      if(!globalPlay){globalPlay=true;updateGlobal();}
      if(this.error){this.error=null;this.wantsPlay=true;}else this.wantsPlay=!this.wantsPlay;
      this.ensure().then(()=>this.reconcile()).catch(e=>this.fail(e));this.syncPlay();
    });
  }
  active(){return this.videos[this.packed?'g1':this.mode];}
  shouldPlay(){return this.visible && !document.hidden && globalPlay && this.wantsPlay;}
  showMode(mode){
    this.mode=mode;this.el.dataset.mode=mode;this.el.classList.toggle('is-human',mode==='human');
    this.stage.setAttribute('aria-pressed',String(mode==='human'));this.toggle.setAttribute('aria-pressed',String(mode==='human'));
    this.toggle.textContent=mode==='human'?'查看 G1':'查看人体';this.badge.textContent=mode==='human'?'HUMAN · SMPL-X':'HUMANOID · G1';
    Object.entries(this.videos).forEach(([side,v])=>v.classList.toggle('active',this.packed || side===mode));
    this.poster.hidden=true;this.message.hidden=true;this.el.dataset.ready='true';
  }
  swapMode(mode){
    // Hold the displayed frame until the aligned destination is ready, then
    // dissolve the old view over it. Crop packed pairs instead of sliding them.
    const v=this.active(), duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:220;
    if(!duration || v.readyState<2){this.blendAnimation?.cancel();this.blend.style.opacity='0';this.showMode(mode);return;}
    const width=this.packed?v.videoWidth/2:v.videoWidth, height=v.videoHeight;
    if(!width || !height){this.showMode(mode);return;}
    const frame=document.createElement('canvas');frame.width=width;frame.height=height;
    const ctx=frame.getContext('2d');
    ctx.drawImage(v,this.packed && this.mode==='g1'?width:0,0,width,height,0,0,width,height);
    if(this.blendAnimation?.playState==='running'){
      ctx.globalAlpha=Number(getComputedStyle(this.blend).opacity);ctx.drawImage(this.blend,0,0,width,height);
    }
    this.blendAnimation?.cancel();this.blend.width=width;this.blend.height=height;
    this.blend.getContext('2d').drawImage(frame,0,0);this.blend.style.opacity='1';
    this.showMode(mode);
    const animation=this.blend.animate([{opacity:1},{opacity:0}],{duration,easing:'cubic-bezier(.2,.7,.2,1)',fill:'forwards'});
    this.blendAnimation=animation;
    animation.finished.then(()=>{if(this.blendAnimation===animation){this.blend.style.opacity='0';animation.cancel();this.blendAnimation=null;}}).catch(()=>{});
  }
  fail(error){this.error=error.message;this.message.textContent=this.error;this.message.hidden=false;this.play.textContent='点击播放';this.el.dataset.error=this.error;}
  async loadSide(side){
    const v=this.videos[this.packed?'g1':side];
    if(!v.getAttribute('src') || v.error){v.src=this.packed?this.sample.presentation.path:this.sample[side].path;v.preload='auto';v.load();}
    await eventReady(v,'loadedmetadata',()=>v.readyState>=1);return v;
  }
  async ensure(){
    if(this.ready)return;
    if(this.loading)return this.loading;
    this.loading=(async()=>{
      let mapping=null;
      if(this.sample.timing.mode==='mapped'){const r=await fetch(this.sample.timing.mapping_path);if(!r.ok)throw new Error('时间映射无法读取');mapping=await r.json();}
      this.clock=new PairClock(this.sample,mapping);
      const v=await this.loadSide('g1');
      const full=this.clock.mode==='shared_output_clock' && this.clock.range[0]===0 && Math.abs(this.clock.range[1]-v.duration)<.0001;
      v.loop=full;
      await seek(v,this.clock.toMedia('g1',this.clock.range[0]));
      this.ready=true;this.showMode(this.packed?this.desired:'g1');this.watchClock();
    })();
    try{await this.loading;}finally{this.loading=null;}
  }
  request(side){this.desired=side;if(!this.visible)return;this.reconcile().catch(e=>this.fail(e));}
  async reconcile(){
    if(this.busy)return;
    this.busy=true;
    try{
      await this.ensure();
      while(this.mode!==this.desired){
        if(this.packed){this.swapMode(this.desired);break;}
        const targetSide=this.desired;
        const target=await this.loadSide(targetSide);
        if(targetSide!==this.desired)continue;
        const source=this.active();source.pause();
        let t=this.clock.fromMedia(this.mode,source.currentTime);
        if(t===null || t>=this.clock.range[1])t=this.clock.range[0];
        target.loop=this.clock.mode==='shared_output_clock' && this.clock.range[0]===0 && Math.abs(this.clock.range[1]-target.duration)<.0001;
        await seek(target,this.clock.toMedia(targetSide,t));
        if(targetSide!==this.desired)continue;
        this.swapMode(targetSide);
      }
      delete this.el.dataset.error;this.error=null;this.message.hidden=true;
    }finally{this.busy=false;this.syncPlay();}
  }
  syncPlay(){
    for(const v of Object.values(this.videos))if(v!==this.active() || !this.shouldPlay())v.pause();
    this.play.textContent=globalPlay && this.wantsPlay?'暂停':'播放';this.play.setAttribute('aria-pressed',String(!globalPlay || !this.wantsPlay));
    if(!this.ready || !this.shouldPlay() || this.busy || this.resetting)return;
    const v=this.active(), side=this.packed?'g1':this.mode;
    v.playbackRate=this.clock.rate(side,this.clock.fromMedia(side,v.currentTime)??this.clock.range[0]);
    const p=v.play();if(p)p.then(()=>{if(!this.shouldPlay() || v!==this.active())v.pause();}).catch(e=>{if(e.name!=='AbortError'){this.wantsPlay=false;this.fail(new Error('点击播放以开始视频'));}});
  }
  async restart(){
    if(this.resetting || this.busy || !this.ready)return;
    this.resetting=true;
    try{const v=this.active();v.pause();await seek(v,this.clock.toMedia(this.packed?'g1':this.mode,this.clock.range[0]));}
    finally{this.resetting=false;this.syncPlay();}
  }
  watchClock(){
    const tick=()=>{
      if(this.ready && this.visible && !this.busy && !this.resetting){
        const side=this.packed?'g1':this.mode,v=this.active();
        if(!v.paused){const t=this.clock.fromMedia(side,v.currentTime);if(t===null || t>=this.clock.range[1])this.restart().catch(e=>this.fail(e));else v.playbackRate=this.clock.rate(side,t);}
      }
      requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
  }
  setVisible(on){this.visible=on;if(on)this.reconcile().catch(e=>this.fail(e));else this.syncPlay();}
}
function updateGlobal(){pauseAll.textContent=globalPlay?'暂停全部':'播放全部';pauseAll.setAttribute('aria-pressed',String(!globalPlay));cards.forEach(c=>c.syncPlay());}
pauseAll.addEventListener('click',()=>{globalPlay=!globalPlay;updateGlobal();});
document.addEventListener('visibilitychange',()=>cards.forEach(c=>c.syncPlay()));
try{
  const response=await fetch('data.json',{cache:'no-store'});if(!response.ok)throw new Error('manifest unavailable');
  const data=await response.json();if(data.schema_version!==1 || !Array.isArray(data.samples))throw new Error('manifest schema');
  if(new Set(data.samples.map(s=>s.sample_key)).size!==data.samples.length)throw new Error('duplicate sample keys');
  document.body.dataset.revision=String(data.revision);document.querySelector('#sample-count').textContent=data.samples.length+' 组';document.querySelector('#empty').hidden=Boolean(data.samples.length);
  const observer=new IntersectionObserver(entries=>entries.forEach(e=>cards.find(c=>c.el===e.target)?.setVisible(e.isIntersecting && e.intersectionRatio>.01)),{threshold:[0,.01,.08]});
  data.samples.forEach((sample,i)=>{const c=new PairCard(sample,i);cards.push(c);observer.observe(c.el);});
}catch(error){document.querySelector('#load-error').hidden=false;document.querySelector('#sample-count').textContent='加载失败';console.error(error);}
