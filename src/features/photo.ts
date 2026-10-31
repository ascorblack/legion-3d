import * as THREE from 'three';
import { layoutColliderBoxes } from '../engine/camera';
import { fromX, fromZ } from '../world/coords';
import { isTyping, type InputEx } from '../engine/input';
import { composePhoto, photoPanel, type PhotoOptions } from '../photo/panel';
import { clampPhotoPosition, photoFilename, photoSnapshot } from '../photo/state';
import { coreFeature } from './types';
import { registerPauseItem } from '../ui/settings-ext';

export default coreFeature({
  id: 'photo', order: 110,
  setup(ctx) {
    const { camera, engine, input, meAv, labels, rig } = ctx;
    const canvas = engine.renderer.domElement;
    const photoInput = input as InputEx;
    const opts: PhotoOptions = { pose: 'idle', filter: 'none', vignette: 12, names: true, hud: true, watermark: true };
    const keys = new Set<string>();
    const fill = new THREE.PointLight(0xffe0b8, 9, 6, 1.4); fill.name = 'photo:fill';
    const velocity = new THREE.Vector3(), wanted = new THREE.Vector3(), forward = new THREE.Vector3(), side = new THREE.Vector3(), delta = new THREE.Vector3();
    const ray = new THREE.Ray(); const hit = new THREE.Vector3(); const hero = new THREE.Vector3(); const photoPos = new THREE.Vector3(); const old = new THREE.Vector3(); const rc = new THREE.Raycaster();
    let boxes: THREE.Box3[] = [], active = false, panel: HTMLElement | null = null, restore: (()=>void) | null = null;
    let yaw = 0, pitch = 0, fov = 60, previousLock = false, previousHud = true, previousVm = true;
    let hidden = false, writing = false, flying = false;
    const currentFloor = (x: number, z: number) => ctx.rooms.scene?.groundAt(x,z) ?? ctx.world().groundAt(fromX(x),fromZ(z));
    const bones: THREE.Bone[] = [];
    const applyPose = () => {
      if (opts.pose === 'idle') return;
      if (!bones[1]?.parent) meAv.root.traverse(o => { if (o instanceof THREE.Bone && /^b[1-5]$/.test(o.name)) bones[Number(o.name.slice(1))] = o; });
      if (!bones[1] || !bones[2] || !bones[3] || !bones[4] || !bones[5]) return;
      const [,body,left,right,legL,legR] = bones;
      if (opts.pose === 'wave') right.rotation.set(-0.2,0,2.5);
      if (opts.pose === 'cheer') {left.rotation.set(0,0,-2.6);right.rotation.set(0,0,2.6);}
      if (opts.pose === 'sit') { body.position.y -= .19;legL.rotation.x=-1.15;legR.rotation.x=-1.15;left.rotation.x=-.35;right.rotation.x=-.35; }
      if (opts.pose === 'sleep') {body.rotation.z=.15;body.position.y-=.3;legL.rotation.x=-.65;legR.rotation.x=-.65;left.rotation.x=.6;right.rotation.x=.6;}
    };
    const resetCamera = () => {
      hero.copy(ctx.feet);
      const origin=new THREE.Vector3(hero.x,hero.y+.85,hero.z);
      const candidate=new THREE.Vector3();
      const preferred=meAv.root.rotation.y+Math.PI;
      let best=-Infinity, angle=preferred;
      const roomMeshes=ctx.rooms.scene?.colliders ?? [];
      const worldMeshes: THREE.Object3D[]=[];
      if (!ctx.rooms.scene) ctx.world().root.traverse(o=>{
        const mesh=o as THREE.Mesh;
        // Merged terrain is huge; use the rig's layout blockers instead.
        if (mesh.isMesh && mesh.geometry?.getIndex() && mesh.geometry.getIndex()!.count < 4500 && !/ground|floor/i.test(o.name)) worldMeshes.push(o);
      });
      for (let i=0;i<8;i++) {
        const a=preferred+(i<2?i*Math.PI/4:((i%2?1:-1)*Math.ceil(i/2)*Math.PI/4));
        candidate.set(hero.x+Math.sin(a)*2.0,hero.y+1.05,hero.z+Math.cos(a)*2.0);   // portrait: closer, near eye level
        candidate.y=Math.max(candidate.y,currentFloor(candidate.x,candidate.z)+.4);
        let score=10-Math.abs(i)*.9;
        if(candidate.distanceTo(hero)>12 || boxes.some(b=>b.containsPoint(candidate)))continue;
        ray.origin.copy(origin);ray.direction.subVectors(candidate,origin).normalize();
        const dist=candidate.distanceTo(origin);
        for(const box of boxes){const intersection=ray.intersectBox(box,hit);if(intersection && intersection.distanceTo(origin)<dist-.15)score-=30;}
        rc.set(origin,ray.direction);rc.near=.2;rc.far=dist-.2;
        if ((roomMeshes.length && rc.intersectObjects(roomMeshes,true).length) ||
            (worldMeshes.length && rc.intersectObjects(worldMeshes,false).length)) score-=20;
        if(score>best){best=score;angle=a;photoPos.copy(candidate);}
      }
      if(best===-Infinity)photoPos.set(hero.x,hero.y+1.5,hero.z+2.7);
      yaw=angle;
      const distance=Math.hypot(photoPos.x-hero.x,photoPos.z-hero.z);
      pitch=Math.atan2(hero.y+.55-photoPos.y,distance);
      fov=36;velocity.set(0,0,0);
      camera.position.copy(photoPos);fill.position.copy(photoPos).y+=.65;camera.fov=fov;camera.updateProjectionMatrix();
    };
    const refresh = () => { labels.root.visible = !opts.names; ctx.uiApi.setHudVisible(!opts.hud && previousHud); };
    const showPanel = () => { if (!active || panel) return; flying=false; panel=photoPanel(opts,refresh,()=>{void capture();},finish,resetCamera,()=>{panel?.remove();panel=null;flying=true;lockCanvas();});ctx.uiRoot.append(panel); };
    // a refused lock (Chrome's re-lock cooldown, no user activation) rejects the promise: the panel comes back
    const lockCanvas=()=>{try {const r=canvas.requestPointerLock() as unknown as Promise<void>|undefined;r?.catch?.(()=>{showPanel();});} catch {showPanel();}};
    const finish = () => {
      if (!active) return;
      active=false; flying=false; keys.clear(); velocity.set(0,0,0); panel?.remove(); panel=null;
      photoInput.popModal('photo');
      restore?.(); restore=null; fill.removeFromParent();
      labels.root.visible=hidden;
      ctx.uiApi.setHudVisible(previousHud);
      ctx.vm.setVisible(previousVm);
      meAv.setFirstPerson(rig.distance < .9 && !ctx.rooms.stage);
      window.dispatchEvent(new CustomEvent('l3d:photo',{detail:{on:false}}));
      if (!previousLock && document.pointerLockElement === canvas) input.unlock();
      else if (previousLock && !document.pointerLockElement) {
        input.lock();
        // Browsers temporarily reject re-lock after Escape; retry only if gameplay is still available.
        setTimeout(() => { if (!active && input.gameplay && !input.locked) input.lock(); }, 350);
      }
      ctx.applyCamera(true);
    };
    const capture = async () => {
      if (!active || writing) return;
      writing = true;
      const renderer=engine.renderer, oldRatio=renderer.getPixelRatio(), oldNames=labels.root.visible;
      const width=canvas.clientWidth || innerWidth, height=canvas.clientHeight || innerHeight;
      try {
        labels.root.visible=!opts.names;
        // Responsive high resolution, capped by the GPU renderbuffer and twice the current physical viewport.
        const max=renderer.capabilities.maxTextureSize;
        const ratio=Math.min(2, max / Math.max(width,height));
        renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);
        renderer.render(ctx.scene,camera);
        const image=composePhoto(canvas,opts);
        const blob=await new Promise<Blob|null>(done=>image.toBlob(done,'image/png'));
        if (!blob) throw Error('PNG encoding failed');
        const url=URL.createObjectURL(blob), link=document.createElement('a');
        link.href=url;link.download=photoFilename(new Date());document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),30000);
        if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
          navigator.clipboard.write([new ClipboardItem({'image/png':blob})]).catch(()=>{});
        }
        ctx.ui.toast('Снимок сохранён');
      } catch (e) {console.error('[l3d] photo capture',e);ctx.ui.toast('Не удалось сохранить снимок',true);}
      finally {renderer.setPixelRatio(oldRatio);renderer.setSize(width,height,false);labels.root.visible=oldNames;writing=false;}
    };
    const start = () => {
      if (active) return;
      if (ctx.state.classic || ctx.state.menu || photoInput.modals.length || !input.gameplay || isTyping()) {ctx.ui.toast('Закройте окно или чат перед снимком');return;}
      if (ctx.state.overlayOver3d || ctx.rooms.stage) {ctx.ui.toast('В комнате с панелью фоторежим недоступен');return;}
      active=true;
      previousLock=input.locked; previousHud=!ctx.uiRoot.querySelector('.ui.nohud');
      previousVm=ctx.vm.root.visible; hidden=labels.root.visible;
      restore=photoSnapshot(camera,engine.renderer,[labels.root]);
      hero.copy(ctx.feet); boxes=ctx.rooms.scene ? [] : layoutColliderBoxes(ctx.layout(),ctx.world().groundAt);
      resetCamera();
      ctx.scene.add(fill);
      window.dispatchEvent(new CustomEvent('l3d:photo',{detail:{on:true}}));
      camera.fov=fov;camera.filmOffset=0;camera.updateProjectionMatrix();
      ctx.vm.setVisible(false);meAv.setFirstPerson(false);
      photoInput.pushModal('photo',finish); // stops the player controller and releases pointer lock
      showPanel();refresh();
    };
    const keyDown=(e:KeyboardEvent)=>{
      if (!active) return;
      if (isTyping(e.target instanceof Element?e.target:null) && !panel?.contains(e.target as Node)) return;
      if (e.code==='Escape') {e.preventDefault();e.stopImmediatePropagation();finish();return;}
      if (e.code==='KeyR') {e.preventDefault();e.stopImmediatePropagation();resetCamera();return;}
      if (e.code==='Enter' || e.code==='NumpadEnter') {e.preventDefault();e.stopImmediatePropagation();void capture();return;}
      if (/^(Key[WASDQE]|ShiftLeft|ShiftRight)$/.test(e.code)){keys.add(e.code);e.preventDefault();e.stopImmediatePropagation();}
    };
    const keyUp=(e:KeyboardEvent)=>{keys.delete(e.code);};
    const mouse=(e:MouseEvent)=>{
      if (!active || document.pointerLockElement!==canvas) return;
      yaw-=e.movementX*.0022;pitch=Math.max(-1.45,Math.min(1.45,pitch-e.movementY*.0022));
    };
    const wheel=(e:WheelEvent)=>{if (!active)return;fov=Math.max(30,Math.min(85,fov+Math.sign(e.deltaY)*3));e.preventDefault();e.stopImmediatePropagation();};
    const down=(e:MouseEvent)=>{if(active && !panel && e.target===canvas) lockCanvas();};
    // keyup never comes after Alt+Tab / a hidden tab: drop the held keys (the camera would keep flying)
    const dropKeys=()=>{keys.clear();};const onVisKeys=()=>{if(document.hidden)keys.clear();};
    const lockChange=()=>{if (active && flying && document.pointerLockElement!==canvas) {showPanel();keys.clear();}};
    window.addEventListener('keydown',keyDown,true);window.addEventListener('keyup',keyUp,true);window.addEventListener('blur',dropKeys);document.addEventListener('visibilitychange',onVisKeys);
    document.addEventListener('mousemove',mouse,true);canvas.addEventListener('wheel',wheel,{capture:true,passive:false});canvas.addEventListener('mousedown',down,true);document.addEventListener('pointerlockchange',lockChange);
    const offKey=ctx.registries.keys.register('photo.toggle',{code:'F9',label:'Фоторежим',run:()=>{start();return true;}});
    const offPause=registerPauseItem({id:'photo',label:'Фоторежим',key:'F9',order:10,run:()=>{setTimeout(start,0);}});
    const offFrame=ctx.onFrame(dt=>{
      if(!active)return;
      hero.copy(ctx.feet);
      // Rig has just updated; override the pose only while photo mode is active.
      camera.position.copy(photoPos);camera.fov=fov;camera.filmOffset=0;camera.updateProjectionMatrix();
      forward.set(-Math.sin(yaw),0,-Math.cos(yaw));side.set(Math.cos(yaw),0,-Math.sin(yaw));
      wanted.set(0,0,0).addScaledVector(forward,Number(keys.has('KeyW'))-Number(keys.has('KeyS')))
        .addScaledVector(side,Number(keys.has('KeyD'))-Number(keys.has('KeyA')));
      wanted.y=Number(keys.has('KeyE'))-Number(keys.has('KeyQ'));
      if(wanted.lengthSq()>1)wanted.normalize();wanted.multiplyScalar(keys.has('ShiftLeft')||keys.has('ShiftRight')? .65:2.8);
      velocity.lerp(wanted,1-Math.exp(-7*dt));
      delta.copy(velocity).multiplyScalar(dt);
      old.copy(photoPos); camera.position.add(delta);
      clampPhotoPosition(camera.position,hero,currentFloor(camera.position.x,camera.position.z));
      const travel=camera.position.distanceTo(old);
      if(travel>.0001){ray.origin.copy(old);ray.direction.subVectors(camera.position,old).normalize();let nearest=travel;
        for(const box of boxes){if(box.containsPoint(old))continue;const p=ray.intersectBox(box,hit);if(p)nearest=Math.min(nearest,p.distanceTo(old)-.12);}
        for(const obj of ctx.rooms.scene?.colliders??[]){rc.set(old,ray.direction);rc.near=0;rc.far=travel;const hits=rc.intersectObject(obj,true);if(hits.length)nearest=Math.min(nearest,hits[0].distance-.12);}
        if(nearest<travel)camera.position.copy(old).addScaledVector(ray.direction,Math.max(0,nearest));
      }
      photoPos.copy(camera.position);fill.position.copy(photoPos);fill.position.y+=.65;
      camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0,'YXZ');camera.updateMatrixWorld();
      applyPose();ctx.vm.setVisible(false);meAv.setFirstPerson(false);
    });
    ctx.dev.photo=()=>({active,position:camera.position.toArray(),pose:opts.pose,filter:opts.filter,capture,enter:start,exit:finish});
    return ()=>{finish();offKey();offPause();offFrame();window.removeEventListener('keydown',keyDown,true);window.removeEventListener('keyup',keyUp,true);window.removeEventListener('blur',dropKeys);document.removeEventListener('visibilitychange',onVisKeys);document.removeEventListener('mousemove',mouse,true);canvas.removeEventListener('wheel',wheel,true);canvas.removeEventListener('mousedown',down,true);document.removeEventListener('pointerlockchange',lockChange);};
  },
});
