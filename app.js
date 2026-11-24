import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SnowReveal, createWinterTerrain, snowShader } from './snow.js?v=terrain-fog-margin';

const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(pointer: coarse)').matches;
const mapOnly = document.documentElement.classList.contains('map-only');
const placeCard = $('place-card');
const places = [
  {id:'sella',name:'Sella',region:'В САМОМ СЕРДЦЕ ДОЛОМИТОВ',lat:46.5088861,lon:11.8282806,description:'Мощный скальный массив между долинами Валь-Гардена, Валь-Бадия и Валь-ди-Фасса.'},
  {id:'marmolada',name:'Marmolada',region:'КОРОЛЕВА ДОЛОМИТОВ',lat:46.4344,lon:11.8496056,description:'Самый высокий массив Доломитов. На его северной стороне расположен ледник Мармолада.'},
  {id:'cortina',name:'Cortina d’Ampezzo',region:'ДОЛИНА АМПЕЦЦО',lat:46.5405,lon:12.1357,description:'Альпийский город в широкой долине, окружённой скальными группами центральных Доломитов.'},
  {id:'tre-cime',name:'Tre Cime',region:'ВОСТОЧНЫЕ ДОЛОМИТЫ',lat:46.6186,lon:12.3026,description:'Три узнаваемые известняковые вершины на северо-востоке этой карты.'},
  {id:'gardena',name:'Val Gardena',region:'СЕВЕРО-ЗАПАДНЫЕ ДОЛОМИТЫ',lat:46.5755,lon:11.6714,description:'Зелёная долина между альпийскими пастбищами и скальными массивами Одле и Сассолунго.'},
  {id:'pale',name:'Pale di San Martino',region:'ЮЖНАЯ ЧАСТЬ КАРТЫ',lat:46.29,lon:11.842,description:'Протяжённый горный массив со светлыми скалами и высокогорным плато.'},
];

let renderer, scene, camera, controls, terrain, geometry, material, skirts;
let meta, heights, uniforms, snow;
let ready=false, presented=false, verticalScale=1, currentLayer='style', selected=null, flight=null;
let placeCardEntrance, placeCardExit;
let frame=0, previousTime=0, demandFrames=0, disposed=false;
let mapZoomedOut=false;
const textures=new Map();
const markers=[];
const projected=new THREE.Vector3();
const homeTarget=new THREE.Vector3();
const homeOffset=new THREE.Vector3(0,53,19);
const placeViewOffset=new THREE.Vector3(-1.25,40.9,39.7).setLength(57);
const fogColor=new THREE.Color(0xffffff);
const terrainMarginKm=5;

function announce(message){$('announcement').textContent=message;}
function setSettingsOpen(open){
  $('settings').hidden=!open;
  $('settings-toggle').setAttribute('aria-expanded',String(open));
}

$('settings-toggle').addEventListener('click',()=>setSettingsOpen($('settings').hidden));
$('place-close').addEventListener('click',()=>clearPlace());
$('reset').addEventListener('click',resetView);
$('top-view').addEventListener('click',()=>{
  if(!ready)return;
  const distance=Math.max(18,controls.getDistance());
  moveCamera(controls.target.clone(),new THREE.Vector3(0,distance,.03));
  announce('Вид сверху');
});
$('zoom-in').addEventListener('click',()=>zoom(.76));
$('zoom-out').addEventListener('click',()=>zoom(1.3));
$('fullscreen').addEventListener('click',async()=>{
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else if($('explorer').requestFullscreen)await $('explorer').requestFullscreen();
    else announce('Полный экран недоступен в этом браузере');
  }catch{announce('Браузер не разрешил полноэкранный режим');}
});
document.addEventListener('fullscreenchange',()=>{
  const active=Boolean(document.fullscreenElement);
  $('fullscreen').setAttribute('aria-label',active?'Выйти из полного экрана':'Полный экран');
  $('fullscreen').title=active?'Выйти из полного экрана':'Полный экран';
  resize();
});
$('show-markers').addEventListener('change',()=>{$('markers').hidden=!$('show-markers').checked;invalidate();});
$('auto-rotate').addEventListener('change',()=>{if(!ready)return;controls.autoRotate=$('auto-rotate').checked;invalidate();});
$('layer-style').addEventListener('click',()=>changeLayer('style'));
$('layer-satellite').addEventListener('click',()=>changeLayer('satellite'));
$('snow-enabled').addEventListener('change',()=>{
  if(!snow)return;
  snow.setEnabled($('snow-enabled').checked);
  $('snow-brush').disabled=!snow.enabled;$('snow-reset').disabled=!snow.enabled;
  document.body.classList.toggle('winter',snow.enabled);
  announce(snow.enabled?'Зимняя карта: снег тает под курсором':'Карта golden hour');
});
$('snow-brush').addEventListener('change',()=>{snow?.setBrushEnabled($('snow-brush').checked);});
$('snow-reset').addEventListener('click',()=>{if(snow){snow.reset();announce('Снежный покров восстановлен');}});
$('relief').addEventListener('input',()=>{
  if(!ready)return;
  verticalScale=Number($('relief').value);
  $('relief-value').textContent='×'+verticalScale;
  uniforms.reliefScale.value=verticalScale;
  updateRelief();
  invalidate();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){setSettingsOpen(false);clearPlace();}
  if(!ready||/INPUT|SELECT|TEXTAREA/.test(event.target.tagName))return;
  if(!mapOnly&&!$('explorer').contains(event.target))return;
  if(event.key==='+'||event.key==='='){zoom(.8);event.preventDefault();}
  if(event.key==='-'){zoom(1.25);event.preventDefault();}
  if(event.key==='Home'){resetView();event.preventDefault();}
});
document.addEventListener('pointerdown',event=>{
  if(!event.target.closest('.bottom-right'))setSettingsOpen(false);
});

function mercator(lat,lon){
  const radius=6378137;
  return [radius*THREE.MathUtils.degToRad(lon),radius*Math.log(Math.tan(Math.PI/4+THREE.MathUtils.degToRad(lat)/2))];
}
function geographicToWorld(lat,lon){
  const [mx,my]=mercator(lat,lon),[xmin,ymin,xmax,ymax]=meta.bounds_epsg3857;
  const x=((mx-xmin)/(xmax-xmin)-.5)*meta.widthKm;
  const z=((ymax-my)/(ymax-ymin)-.5)*meta.depthKm;
  return new THREE.Vector3(x,sampleHeight(x,z),z);
}
function sampleHeight(x,z){
  if(!heights||!meta)return 0;
  const cols=meta.terrain.cols,rows=meta.terrain.rows;
  const u=THREE.MathUtils.clamp(x/meta.widthKm+.5,0,1)*(cols-1);
  const v=THREE.MathUtils.clamp(z/meta.depthKm+.5,0,1)*(rows-1);
  const x0=Math.floor(u),y0=Math.floor(v),x1=Math.min(x0+1,cols-1),y1=Math.min(y0+1,rows-1);
  const a=u-x0,b=v-y0;
  return (heights[y0*cols+x0]*(1-a)*(1-b)+heights[y0*cols+x1]*a*(1-b)+heights[y1*cols+x0]*(1-a)*b+heights[y1*cols+x1]*a*b)/1000*verticalScale;
}
function sampleTerrainHeight(x,z){
  const halfWidth=meta.widthKm/2,halfDepth=meta.depthKm/2;
  const edgeX=THREE.MathUtils.clamp(x,-halfWidth,halfWidth);
  const edgeZ=THREE.MathUtils.clamp(z,-halfDepth,halfDepth);
  const outside=Math.max(Math.abs(x-edgeX),Math.abs(z-edgeZ));
  if(outside===0)return sampleHeight(x,z);

  // Carry the slope across the survey edge, then level it out in the fog.
  const edge=sampleHeight(edgeX,edgeZ);
  const inside=sampleHeight(2*edgeX-x,2*edgeZ-z);
  const continuation=1-THREE.MathUtils.smoothstep(outside,0,terrainMarginKm);
  return edge+(edge-inside)*continuation;
}

function createTerrainGeometry(){
  const columns=touch?256:512;
  const rows=Math.round(columns*9/16);
  const marginCells=touch?8:12;
  const axis=(size,cells)=>Array.from({length:cells+2*marginCells+1},(_,index)=>{
    const cell=index-marginCells;
    const coreCell=THREE.MathUtils.clamp(cell,0,cells);
    return (coreCell/cells-.5)*size+(cell-coreCell)*terrainMarginKm/marginCells;
  });
  const x=axis(meta.widthKm,columns);
  const z=axis(meta.depthKm,rows);
  const meshGeometry=new THREE.PlaneGeometry(1,1,x.length-1,z.length-1);
  const {position,uv}=meshGeometry.attributes;
  for(let row=0;row<z.length;row++){
    for(let column=0;column<x.length;column++){
      const index=row*x.length+column;
      position.setXYZ(index,x[column],0,z[row]);
      uv.setXY(index,x[column]/meta.widthKm+.5,.5-z[row]/meta.depthKm);
    }
  }
  return meshGeometry;
}

function updateRelief(){
  const position=geometry.attributes.position;
  for(let i=0;i<position.count;i++)position.setY(i,sampleTerrainHeight(position.getX(i),position.getZ(i)));
  position.needsUpdate=true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  if(skirts){scene.remove(skirts);skirts.geometry.dispose();skirts.material.dispose();}
  skirts=createSkirts();scene.add(skirts);
  if(selected){const p=places.find(p=>p.id===selected);const target=geographicToWorld(p.lat,p.lon);controls.target.y=target.y;}
}

function createSkirts(){
  const vertices=[];
  const segments=128;
  const halfWidth=meta.widthKm/2+terrainMarginKm,halfDepth=meta.depthKm/2+terrainMarginKm;
  const edges=[[-1,-1,1,-1],[1,-1,1,1],[1,1,-1,1],[-1,1,-1,-1]];
  for(const [ax,az,bx,bz] of edges){
    for(let i=0;i<segments;i++){
      const t0=i/segments,t1=(i+1)/segments;
      const x0=THREE.MathUtils.lerp(ax,bx,t0)*halfWidth,z0=THREE.MathUtils.lerp(az,bz,t0)*halfDepth;
      const x1=THREE.MathUtils.lerp(ax,bx,t1)*halfWidth,z1=THREE.MathUtils.lerp(az,bz,t1)*halfDepth;
      const y0=sampleHeight(x0,z0),y1=sampleHeight(x1,z1);
      vertices.push(x0,y0,z0,x0,-.6,z0,x1,y1,z1,x1,y1,z1,x0,-.6,z0,x1,-.6,z1);
    }
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  return new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:fogColor,side:THREE.DoubleSide}));
}

async function getTexture(layer){
  if(!textures.has(layer))textures.set(layer,new THREE.TextureLoader().loadAsync(`./assets/${layer==='style'?'styled':'satellite'}.webp`).then(texture=>{
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    return texture;
  }).catch(error=>{textures.delete(layer);throw error;}));
  return textures.get(layer);
}
async function changeLayer(layer){
  if(!ready)return;
  currentLayer=layer;
  for(const [id,name] of [['layer-style','style'],['layer-satellite','satellite']]){$(id).classList.toggle('active',name===layer);$(id).setAttribute('aria-pressed',String(name===layer));}
  $('layer-satellite').disabled=true;$('layer-style').disabled=true;
  try{
    const texture=await getTexture(layer);
    if(currentLayer===layer){uniforms.mapTexture.value=texture;uniforms.satelliteLayer.value=layer==='satellite'?1:0;invalidate();announce(layer==='style'?'Стилизованный вид':'Спутниковый снимок 2017 года');}
  }catch{
    currentLayer=uniforms.satelliteLayer.value===1?'satellite':'style';
    $('layer-style').classList.toggle('active',currentLayer==='style');$('layer-satellite').classList.toggle('active',currentLayer==='satellite');
    $('layer-style').setAttribute('aria-pressed',String(currentLayer==='style'));$('layer-satellite').setAttribute('aria-pressed',String(currentLayer==='satellite'));
    announce('Не удалось загрузить этот слой. Попробуйте ещё раз.');
  }finally{$('layer-satellite').disabled=false;$('layer-style').disabled=false;}
}

function setupPlaces(){
  for(const place of places){
    const button=document.createElement('button');button.type='button';button.className='marker';button.dataset.place=place.id;button.setAttribute('aria-label',`Перелететь к ${place.name}`);button.innerHTML=`<span class="marker-dot"></span><span class="marker-name">${place.name}</span>`;button.addEventListener('click',()=>selectPlace(place));$('markers').append(button);markers.push({place,button});
  }
}

function removeOutgoingPlaceCard(){
  if(!placeCardExit)return;
  placeCardExit.effect.target.remove();
  placeCardExit.cancel();
  placeCardExit=null;
}

function sendPlaceCardLeft(){
  removeOutgoingPlaceCard();
  const {opacity, transform} = getComputedStyle(placeCard);
  // Keep the old content below the active card while both animations play.
  const outgoing = placeCard.cloneNode(true);
  outgoing.removeAttribute('id');
  outgoing.removeAttribute('aria-live');
  outgoing.setAttribute('aria-hidden','true');
  outgoing.inert=true;
  for(const child of outgoing.querySelectorAll('[id]'))child.removeAttribute('id');
  placeCard.before(outgoing);
  outgoing.scrollTop=placeCard.scrollTop;

  const exit = outgoing.animate([
    {opacity, transform},
    {opacity:0, transform:'translateX(calc(-100% - 32px))'}
  ], {
    duration:560,
    easing:'cubic-bezier(.4, 0, .2, 1)',
    fill:'both'
  });
  placeCardExit=exit;
  exit.onfinish=()=>{
    if(placeCardExit===exit)removeOutgoingPlaceCard();
  };
}

function selectPlace(place){
  if(!ready)return;
  const placeChanged = selected !== place.id;
  const switchingPlace = placeChanged && selected !== null;
  if(switchingPlace && !reducedMotion)sendPlaceCardLeft();
  setSettingsOpen(false);selected=place.id;
  $('place-region').textContent=place.region;$('place-title').textContent=place.name;$('place-description').textContent=place.description;
  $('place-coordinate').textContent=`${place.lat.toFixed(4)}° N · ${place.lon.toFixed(4)}° E`;
  placeCard.hidden=false;
  if(placeChanged && !reducedMotion){
    placeCardEntrance?.cancel();
    // Use AOS zoom-in on open and zoom-out-left when replacing a card.
    const entranceTransform = switchingPlace ? 'translateX(-100px) scale(1.2)' : 'scale(.6)';
    placeCardEntrance = placeCard.animate([
      {opacity:0, transform:entranceTransform},
      {opacity:1, transform:'none'}
    ], {
      duration:1000,
      easing:'cubic-bezier(.175, .885, .32, 1.275)',
      fill:'backwards'
    });
  }
  for(const marker of markers)marker.button.classList.toggle('selected',marker.place.id===selected);
  const target=geographicToWorld(place.lat,place.lon);
  const offset=placeViewOffset.clone().clampLength(0,controls.getDistance());
  moveCamera(target,offset);
  announce(`Перелёт: ${place.name}`);
}
function clearPlace({slideOut=false}={}){
  if(slideOut && !reducedMotion)sendPlaceCardLeft();
  else removeOutgoingPlaceCard();
  placeCardEntrance?.cancel();
  placeCardEntrance=null;
  selected=null;
  placeCard.hidden=true;
  for(const marker of markers)marker.button.classList.remove('selected');
}
function bindMapPointerEvents(canvas){
  let press;
  const isTap = event => press?.pointerId===event.pointerId &&
    Math.hypot(event.clientX-press.clientX, event.clientY-press.clientY)<=7;
  canvas.addEventListener('pointerdown',event=>{
    cancelFlight();
    press=event.isPrimary && event.button===0 ? event : null;
  },{capture:true});
  canvas.addEventListener('pointermove',event=>{
    if(press && !isTap(event))press=null;
  });
  canvas.addEventListener('pointerup',event=>{
    if(isTap(event) && selected!==null)clearPlace({slideOut:true});
    press=null;
  });
  canvas.addEventListener('pointercancel',()=>{press=null;});
  canvas.addEventListener('wheel',event=>{
    if(Math.abs(event.deltaX)>Math.abs(event.deltaY)){
      event.stopImmediatePropagation();
      return;
    }
    cancelFlight();
  },{capture:true,passive:true});
  $('markers').addEventListener('wheel',event=>{
    event.preventDefault();
    canvas.dispatchEvent(new WheelEvent('wheel',event));
  },{passive:false});
}
function moveCamera(target,offset,duration=1200){
  if(!ready)return;
  snow?.leave();
  if(controls.autoRotate){controls.autoRotate=false;$('auto-rotate').checked=false;}
  // Flush damping so a completed flight cannot spring back to an earlier drag.
  controls.enableDamping=false;controls.update();controls.enableDamping=true;
  const toPosition=offset.clone().clampLength(controls.minDistance,controls.maxDistance).add(target);
  flight={start:performance.now(),duration:reducedMotion?0:duration,fromPosition:camera.position.clone(),fromTarget:controls.target.clone(),toPosition,toTarget:target.clone()};
  controls.enabled=false;invalidate();
}
function resetView(){if(!ready)return;clearPlace();setSettingsOpen(false);moveCamera(homeTarget,homeOffset);announce('Общий вид Доломитов');}
function zoom(factor){
  if(!ready)return;
  const offset=camera.position.clone().sub(controls.target).multiplyScalar(factor);
  moveCamera(controls.target.clone(),offset,450);
}
function cancelFlight(){if(flight){flight=null;controls.enabled=true;}invalidate();}

function visibleFromCamera(point){
  // Height-field occlusion avoids expensive per-marker triangle raycasts.
  const direction=point.clone().sub(camera.position);
  const halfWidth=meta.widthKm/2+terrainMarginKm,halfDepth=meta.depthKm/2+terrainMarginKm;
  for(let i=1;i<22;i++){
    const t=i/22,x=camera.position.x+direction.x*t,z=camera.position.z+direction.z*t;
    if(Math.abs(x)>halfWidth||Math.abs(z)>halfDepth)continue;
    if(camera.position.y+direction.y*t<sampleTerrainHeight(x,z)+.03)return false;
  }
  return true;
}
function updateMarkers(){
  if($('markers').hidden)return;
  const w=renderer.domElement.clientWidth,h=renderer.domElement.clientHeight;
  for(const {place,button} of markers){
    const anchor=geographicToWorld(place.lat,place.lon);anchor.y+=.16;
    projected.copy(anchor).project(camera);
    const shown=projected.z>-1&&projected.z<1&&Math.abs(projected.x)<1.05&&Math.abs(projected.y)<1.05&&visibleFromCamera(anchor);
    button.hidden=!shown;
    if(shown){button.style.left=`${(projected.x*.5+.5)*w}px`;button.style.top=`${(-projected.y*.5+.5)*h}px`;}
  }
}
function constrainCamera(){
  const x=THREE.MathUtils.clamp(controls.target.x,-meta.widthKm*.46,meta.widthKm*.46);
  const z=THREE.MathUtils.clamp(controls.target.z,-meta.depthKm*.46,meta.depthKm*.46);
  const y=sampleHeight(x,z);
  const delta=new THREE.Vector3(x-controls.target.x,y-controls.target.y,z-controls.target.z);
  controls.target.add(delta);camera.position.add(delta);
  const ground=sampleTerrainHeight(camera.position.x,camera.position.z);
  camera.position.y=Math.max(camera.position.y,ground+.65);
}
function invalidate(){
  demandFrames=3;
  if(!frame&&!disposed)frame=requestAnimationFrame(draw);
}
function draw(time){
  frame=0;if(!ready||disposed)return;
  const dt=Math.min(.05,(time-(previousTime||time))/1000);previousTime=time;
  let moving=false;
  if(flight){
    const t=flight.duration===0?1:Math.min(1,(time-flight.start)/flight.duration);
    const eased=t*t*(3-2*t);
    camera.position.lerpVectors(flight.fromPosition,flight.toPosition,eased);
    controls.target.lerpVectors(flight.fromTarget,flight.toTarget,eased);
    camera.lookAt(controls.target);
    if(t===1){flight=null;controls.enabled=true;}else moving=true;
  }else{
    moving=controls.update(dt)||controls.autoRotate;
    constrainCamera();
  }
  camera.updateMatrixWorld();
  const distance=controls.getDistance();
  const zoomedOut=distance>=controls.maxDistance-.5;
  if(!mapOnly && zoomedOut!==mapZoomedOut){
    mapZoomedOut=zoomedOut;
    window.dispatchEvent(new CustomEvent('dolomites:zoom-limit',{detail:zoomedOut}));
  }
  uniforms.fogStart.value=Math.max(12,distance-6);
  const fogExtent=uniforms.fogExtent.value;
  uniforms.fogFocus.value.set(.55*controls.target.x/fogExtent.x,-.55*controls.target.z/fogExtent.y);
  const snowAnimating=snow?.update(time)??false;
  renderer.render(scene,camera);
  updateMarkers();
  if(!presented){
    presented=true;
    document.body.classList.add('ready');
    window.dispatchEvent(new Event('dolomites:ready'));
    announce('Зимняя карта загружена. Проведите курсором или пальцем, чтобы растопить снег.');
  }
  if(moving||snowAnimating||--demandFrames>0){if(!frame)frame=requestAnimationFrame(draw);}else previousTime=0;
}
function resize(){
  if(!renderer||!camera)return;
  const {clientWidth:width,clientHeight:height}=$('viewport');
  if(!width||!height)return;
  camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);invalidate();
}
window.addEventListener('resize',resize);
const viewportResize=new ResizeObserver(resize);
viewportResize.observe($('viewport'));
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=0;previousTime=0;}else invalidate();});

export async function initialize(){
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance',alpha:false});
    renderer.setPixelRatio(Math.min(devicePixelRatio,touch?1.5:1.75));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.setClearColor(fogColor);
    renderer.domElement.tabIndex=0;
    renderer.domElement.setAttribute('aria-label','3D-карта. Перетаскивайте для вращения, колесом меняйте масштаб.');
    $('viewport').append(renderer.domElement);
    renderer.domElement.addEventListener('contextmenu',event=>event.preventDefault());
    renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();ready=false;if(frame)cancelAnimationFrame(frame);frame=0;showError('3D-сцена приостановлена браузером. Перезагрузите карту.');});
    const responses=await Promise.all([fetch('./assets/map.json'),fetch('./assets/terrain.u16'),fetch('./assets/evening-horizon.u8')]);
    if(responses.some(response=>!response.ok))throw new Error('Terrain asset request failed');
    meta=await responses[0].json();
    const buffer=await responses[1].arrayBuffer();
    if(buffer.byteLength!==meta.terrain.cols*meta.terrain.rows*2)throw new Error('Terrain data length mismatch');
    heights=new Uint16Array(buffer);
    const horizonBuffer=await responses[2].arrayBuffer();
    if(horizonBuffer.byteLength!==meta.terrain.cols*meta.terrain.rows)throw new Error('Lighting data length mismatch');
    const horizonTexture=new THREE.DataTexture(new Uint8Array(horizonBuffer),meta.terrain.cols,meta.terrain.rows,THREE.RedFormat,THREE.UnsignedByteType);
    horizonTexture.minFilter=THREE.LinearFilter;horizonTexture.magFilter=THREE.LinearFilter;horizonTexture.unpackAlignment=1;horizonTexture.needsUpdate=true;
    const texture=await getTexture('style');
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.05,400);
    homeTarget.set(0,sampleHeight(0,0),0);
    camera.position.copy(homeTarget).add(homeOffset);
    controls=new OrbitControls(camera,renderer.domElement);
    controls.target.copy(homeTarget);controls.enableDamping=true;controls.dampingFactor=.075;
    controls.rotateSpeed=.55;controls.panSpeed=.7;controls.zoomSpeed=.8;
    controls.minDistance=4;controls.maxDistance=68.6;
    controls.minPolarAngle=.015;controls.maxPolarAngle=Math.PI*.43;
    controls.screenSpacePanning=false;controls.zoomToCursor=true;
    controls.autoRotateSpeed=.32;
    controls.addEventListener('change',invalidate);
    bindMapPointerEvents(renderer.domElement);
    geometry=createTerrainGeometry();
    snow=new SnowReveal({element:renderer.domElement,camera,controls,meta,sampleHeight,heightScale:()=>verticalScale,invalidate,canPaint:()=>!flight&&!controls.autoRotate,touch});
    const [marmoladaLat, marmoladaLon] = meta.landmark_coordinates['Marmolada / Punta Penia'];
    const marmolada = geographicToWorld(marmoladaLat, marmoladaLon);
    uniforms={...snow.uniforms,mapTexture:{value:texture},sunDirection:{value:new THREE.Vector3(-.86,.23,-.45).normalize()},sunsetHazeColor:{value:new THREE.Color('#efbf8b')},horizonMap:{value:horizonTexture},reliefScale:{value:verticalScale},satelliteLayer:{value:0},
      fogColor:{value:fogColor},fogStart:{value:0},
      fogExtent:{value:new THREE.Vector2(meta.widthKm/2+terrainMarginKm,meta.depthKm/2+terrainMarginKm)},
      fogFocus:{value:new THREE.Vector2()},
      winterTerrain:{value:createWinterTerrain(meta,heights)},terrainKm:{value:new THREE.Vector2(meta.widthKm,meta.depthKm)},
      marmoladaUV:{value:new THREE.Vector2(marmolada.x/meta.widthKm+.5,.5-marmolada.z/meta.depthKm)}};
    material=new THREE.ShaderMaterial({
      uniforms,
      vertexShader:`varying vec2 mapUv; varying vec3 terrainNormal; varying float cameraDistance;
        void main(){mapUv=uv;terrainNormal=normalize(mat3(modelMatrix)*normal);vec4 world=modelMatrix*vec4(position,1.0);cameraDistance=length(cameraPosition-world.xyz);gl_Position=projectionMatrix*viewMatrix*world;}`,
      fragmentShader:`uniform sampler2D mapTexture; uniform sampler2D horizonMap; uniform vec3 sunDirection; uniform vec3 fogColor; uniform float reliefScale; uniform float satelliteLayer;
        uniform vec3 sunsetHazeColor; uniform float fogStart;
        uniform vec2 fogExtent; uniform vec2 fogFocus;
        varying vec2 mapUv; varying vec3 terrainNormal; varying float cameraDistance;
        ${snowShader}
        void main(){
          vec2 sourceUv=2.0*clamp(mapUv,0.0,1.0)-mapUv;
          vec3 albedo=texture2D(mapTexture,sourceUv).rgb;vec3 color=albedo;
          vec3 normal=normalize(terrainNormal);float light=max(dot(normal,sunDirection),0.0);
          float horizon=texture2D(horizonMap,sourceUv).r*2.0*reliefScale;
          float sunSlope=sunDirection.y/length(sunDirection.xz);
          float visibility=1.0-smoothstep(sunSlope-.022,sunSlope+.035,horizon);
          // Warm low-angle direct light, with cooler skylight filling terrain shadows.
          vec3 skylight=vec3(.60,.64,.71)*(.91+.09*max(normal.y,0.0));
          vec3 sunset=vec3(1.00,.57,.27)*(.30+.65*light)*visibility;
          color*=skylight+sunset;
          float luminance=dot(color,vec3(.2126,.7152,.0722));
          color=mix(vec3(luminance),color,.96);
          float haze=smoothstep(24.0,150.0,cameraDistance)*.29;
          vec3 summer=mix(color,sunsetHazeColor,haze);
          vec3 surface=winterReveal(summer,albedo,normal,light,visibility,haze,mapUv,sourceUv);
          float distanceFog=smoothstep(fogStart,fogStart+46.0,cameraDistance);
          vec2 mapPoint=(mapUv-.5)*terrainKm/fogExtent;
          // Shift the clear area with the camera target while keeping the model boundary white.
          vec2 ovalPoint=(mapPoint-fogFocus)/(1.0-mapPoint*fogFocus);
          float ovalFog=smoothstep(.66,.99,length(ovalPoint));
          float fog=mix(distanceFog,1.0,ovalFog);
          gl_FragColor=vec4(mix(surface,fogColor,fog),1.0);
          #include <colorspace_fragment>
        }`,
      side:THREE.FrontSide,
    });
    terrain=new THREE.Mesh(geometry,material);scene.add(terrain);updateRelief();
    setupPlaces();resize();
    document.body.classList.toggle('winter',snow.enabled);
    controls.update();ready=true;
    window.dolomitesDiagnostics=()=>({ready:ready&&presented,layer:currentLayer,selected,verticalScale,camera:camera.position.toArray(),target:controls.target.toArray(),triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,renderFrames:renderer.info.render.frame,vertexCount:geometry.attributes.position.count,canvasSize:renderer.getSize(new THREE.Vector2()).toArray(),activeFlight:Boolean(flight),boundsKm:[meta.widthKm,meta.depthKm],textureSize:[uniforms.mapTexture.value.image.width,uniforms.mapTexture.value.image.height],snow:snow.diagnostics()});
    invalidate();
  }catch(error){console.error('Dolomiti initialization:',error);showError('Не удалось открыть 3D-карту');}
}
function showError(message){
  window.dispatchEvent(new CustomEvent('dolomites:error',{detail:message}));
}
