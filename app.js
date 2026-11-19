import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SnowReveal, createWinterTerrain, snowShader } from './snow.js?v=flowing-melt';

const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(pointer: coarse)').matches;
const mapOnly = document.documentElement.classList.contains('map-only');
const places = [
  {id:'sella',name:'Sella',region:'В САМОМ СЕРДЦЕ ДОЛОМИТОВ',subtitle:'Массив Селла · Пиц-Боэ',lat:46.5088861,lon:11.8282806,description:'Мощный скальный массив между долинами Валь-Гардена, Валь-Бадия и Валь-ди-Фасса.'},
  {id:'marmolada',name:'Marmolada',region:'КОРОЛЕВА ДОЛОМИТОВ',subtitle:'Мармолада · Пунта-Пения',lat:46.4344,lon:11.8496056,description:'Самый высокий массив Доломитов. На его северной стороне расположен ледник Мармолада.'},
  {id:'cortina',name:'Cortina d’Ampezzo',region:'ДОЛИНА АМПЕЦЦО',subtitle:'Кортина-д’Ампеццо',lat:46.5405,lon:12.1357,description:'Альпийский город в широкой долине, окружённой скальными группами центральных Доломитов.'},
  {id:'tre-cime',name:'Tre Cime',region:'ВОСТОЧНЫЕ ДОЛОМИТЫ',subtitle:'Тре-Чиме-ди-Лаваредо',lat:46.6186,lon:12.3026,description:'Три узнаваемые известняковые вершины на северо-востоке этой карты.'},
  {id:'gardena',name:'Val Gardena',region:'СЕВЕРО-ЗАПАДНЫЕ ДОЛОМИТЫ',subtitle:'Валь-Гардена · Ортизеи',lat:46.5755,lon:11.6714,description:'Зелёная долина между альпийскими пастбищами и скальными массивами Одле и Сассолунго.'},
  {id:'pale',name:'Pale di San Martino',region:'ЮЖНАЯ ЧАСТЬ КАРТЫ',subtitle:'Пале-ди-Сан-Мартино',lat:46.29,lon:11.842,description:'Протяжённый горный массив со светлыми скалами и высокогорным плато.'},
];

let renderer, scene, camera, controls, terrain, geometry, material, skirts;
let meta, heights, uniforms, snow;
let ready=false, presented=false, verticalScale=1, currentLayer='style', selected=null, flight=null;
let frame=0, previousTime=0, demandFrames=0, disposed=false;
const textures=new Map();
const markers=[];
const projected=new THREE.Vector3();
const homeTarget=new THREE.Vector3();
const homeOffset=new THREE.Vector3(0,53,19);

function announce(message){$('announcement').textContent=message;}
function setPanel(id,button,open){$(id).hidden=!open;$(button).setAttribute('aria-expanded',String(open));}
function closeMenus(){setPanel('destinations','explore-toggle',false);setPanel('settings','settings-toggle',false);}

$('explore-toggle').addEventListener('click',()=>{
  const open=$('destinations').hidden;
  setPanel('settings','settings-toggle',false);
  setPanel('destinations','explore-toggle',open);
});
$('settings-toggle').addEventListener('click',()=>{
  const open=$('settings').hidden;
  setPanel('destinations','explore-toggle',false);
  setPanel('settings','settings-toggle',open);
});
$('about-open').addEventListener('click',()=>{closeMenus();$('about-dialog').showModal();});
$('about-close').addEventListener('click',()=>$('about-dialog').close());
$('about-dialog').addEventListener('click',event=>{if(event.target===$('about-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
$('place-close').addEventListener('click',clearPlace);
$('home').addEventListener('click',event=>{event.preventDefault();resetView();});
$('reset').addEventListener('click',resetView);
$('top-view').addEventListener('click',()=>{
  if(!ready)return;
  const distance=Math.min(95,Math.max(18,controls.getDistance()));
  moveCamera(controls.target.clone(),new THREE.Vector3(0,distance,.03));
  announce('Вид сверху');
});
$('compass').addEventListener('click',()=>{
  if(!ready)return;
  const offset=camera.position.clone().sub(controls.target);
  moveCamera(controls.target.clone(),new THREE.Vector3(0,offset.y,Math.hypot(offset.x,offset.z)));
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
  updateSnowHint();announce(snow.enabled?'Зимняя карта: снег тает под курсором':'Карта golden hour');
});
$('snow-brush').addEventListener('change',()=>{if(snow){snow.setBrushEnabled($('snow-brush').checked);updateSnowHint();}});
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
  if(event.key==='Escape'){closeMenus();clearPlace();}
  if(!ready||$('about-dialog').open||/INPUT|SELECT|TEXTAREA/.test(event.target.tagName))return;
  if(!mapOnly&&!$('explorer').contains(event.target))return;
  if(event.key==='+'||event.key==='='){zoom(.8);event.preventDefault();}
  if(event.key==='-'){zoom(1.25);event.preventDefault();}
  if(event.key==='Home'){resetView();event.preventDefault();}
});
document.addEventListener('pointerdown',event=>{
  if(!event.target.closest('.explore-dock')&&!event.target.closest('.bottom-right'))closeMenus();
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
function worldToGeographic(x,z){
  const [xmin,ymin,xmax,ymax]=meta.bounds_epsg3857;
  const mx=xmin+(x/meta.widthKm+.5)*(xmax-xmin);
  const my=ymax-(z/meta.depthKm+.5)*(ymax-ymin);
  return [THREE.MathUtils.radToDeg(2*Math.atan(Math.exp(my/6378137))-Math.PI/2),THREE.MathUtils.radToDeg(mx/6378137)];
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
function updateRelief(){
  const position=geometry.attributes.position;
  for(let i=0;i<position.count;i++)position.setY(i,sampleHeight(position.getX(i),position.getZ(i)));
  position.needsUpdate=true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  if(skirts){scene.remove(skirts);skirts.geometry.dispose();skirts.material.dispose();}
  skirts=createSkirts();scene.add(skirts);
  if(selected){const p=places.find(p=>p.id===selected);const target=geographicToWorld(p.lat,p.lon);controls.target.y=target.y;}
}

function createSkirts(){
  const vertices=[],colors=[];
  const segments=128;
  const edges=[[-1,-1,1,-1],[1,-1,1,1],[1,1,-1,1],[-1,1,-1,-1]];
  for(const [ax,az,bx,bz] of edges){
    for(let i=0;i<segments;i++){
      const t0=i/segments,t1=(i+1)/segments;
      const x0=THREE.MathUtils.lerp(ax,bx,t0)*meta.widthKm/2,z0=THREE.MathUtils.lerp(az,bz,t0)*meta.depthKm/2;
      const x1=THREE.MathUtils.lerp(ax,bx,t1)*meta.widthKm/2,z1=THREE.MathUtils.lerp(az,bz,t1)*meta.depthKm/2;
      const y0=sampleHeight(x0,z0),y1=sampleHeight(x1,z1);
      vertices.push(x0,y0,z0,x0,-.6,z0,x1,y1,z1,x1,y1,z1,x0,-.6,z0,x1,-.6,z1);
      for(let j=0;j<6;j++){const top=j===0||j===2||j===3;colors.push(top?.22:.11,top?.27:.15,top?.15:.095);}
    }
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  return new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}));
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
    const item=document.createElement('button');item.type='button';item.className='destination';item.dataset.destination=place.id;item.innerHTML=`<span><strong>${place.name}</strong><small>${place.subtitle}</small></span><b aria-hidden="true">↗</b>`;item.addEventListener('click',()=>selectPlace(place));$('destinations').append(item);
  }
}
function selectPlace(place){
  if(!ready)return;
  closeMenus();selected=place.id;
  $('place-region').textContent=place.region;$('place-title').textContent=place.name;$('place-description').textContent=place.description;
  $('place-coordinate').textContent=`${place.lat.toFixed(4)}° N · ${place.lon.toFixed(4)}° E`;
  $('place-card').hidden=false;
  for(const marker of markers)marker.button.classList.toggle('selected',marker.place.id===selected);
  const target=geographicToWorld(place.lat,place.lon);
  moveCamera(target,new THREE.Vector3(4,23,10));
  announce(`Перелёт: ${place.name}`);
}
function clearPlace(){selected=null;$('place-card').hidden=true;for(const marker of markers)marker.button.classList.remove('selected');}
function moveCamera(target,offset,duration=1200){
  if(!ready)return;
  snow?.leave();
  if(controls.autoRotate){controls.autoRotate=false;$('auto-rotate').checked=false;}
  // Flush damping so a completed flight cannot spring back to an earlier drag.
  controls.enableDamping=false;controls.update();controls.enableDamping=true;
  flight={start:performance.now(),duration:reducedMotion?0:duration,fromPosition:camera.position.clone(),fromTarget:controls.target.clone(),toPosition:target.clone().add(offset),toTarget:target.clone()};
  controls.enabled=false;invalidate();
}
function resetView(){if(!ready)return;clearPlace();closeMenus();moveCamera(homeTarget,homeOffset);announce('Общий вид Доломитов');}
function zoom(factor){
  if(!ready)return;
  const offset=camera.position.clone().sub(controls.target),length=THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance);
  offset.setLength(length);moveCamera(controls.target.clone(),offset,450);
}
function cancelFlight(){if(flight){flight=null;controls.enabled=true;}invalidate();}

function visibleFromCamera(point){
  // Height-field occlusion avoids expensive per-marker triangle raycasts.
  const direction=point.clone().sub(camera.position);
  for(let i=1;i<22;i++){
    const t=i/22,x=camera.position.x+direction.x*t,z=camera.position.z+direction.z*t;
    if(Math.abs(x)>meta.widthKm/2||Math.abs(z)>meta.depthKm/2)continue;
    if(camera.position.y+direction.y*t<sampleHeight(x,z)+.03)return false;
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
  const ground=sampleHeight(camera.position.x,camera.position.z);
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
  const snowAnimating=snow?.update(time)??false;
  renderer.render(scene,camera);
  updateMarkers();
  if(!presented){
    presented=true;
    document.body.classList.add('ready');
    window.dispatchEvent(new Event('dolomites:ready'));
    announce('Зимняя карта загружена. Проведите курсором или пальцем, чтобы растопить снег.');
  }
  $('compass-arrow').style.transform=`rotate(${-THREE.MathUtils.radToDeg(controls.getAzimuthalAngle())}deg)`;
  const [lat,lon]=worldToGeographic(controls.target.x,controls.target.z);
  $('camera-coordinate').textContent=`${lat.toFixed(3)}° N   ${lon.toFixed(3)}° E`;
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
    renderer.setClearColor('#a18975');
    renderer.domElement.tabIndex=0;
    renderer.domElement.setAttribute('aria-label',mapOnly
      ?'3D-карта: мышью вращайте и перемещайте, колесом меняйте масштаб'
      :'3D-карта: перетаскивайте для вращения, Ctrl и колесо для масштаба');
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
    controls.minDistance=4;controls.maxDistance=135;
    controls.minPolarAngle=.015;controls.maxPolarAngle=Math.PI*.43;
    controls.screenSpacePanning=false;controls.zoomToCursor=true;
    controls.autoRotateSpeed=.32;
    controls.addEventListener('change',invalidate);
    renderer.domElement.addEventListener('pointerdown',cancelFlight,{capture:true});
    if(!mapOnly){
      renderer.domElement.addEventListener('wheel',event=>{
        if(!event.ctrlKey&&!document.fullscreenElement)event.stopImmediatePropagation();
      },{capture:true,passive:true});
    }
    renderer.domElement.addEventListener('wheel',cancelFlight,{passive:true});
    const segments=touch?256:512;
    geometry=new THREE.PlaneGeometry(meta.widthKm,meta.depthKm,segments,Math.round(segments*9/16));
    geometry.rotateX(-Math.PI/2);
    snow=new SnowReveal({element:renderer.domElement,camera,controls,meta,sampleHeight,heightScale:()=>verticalScale,invalidate,canPaint:()=>!flight&&!controls.autoRotate,touch});
    const [marmoladaLat, marmoladaLon] = meta.landmark_coordinates['Marmolada / Punta Penia'];
    const marmolada = geographicToWorld(marmoladaLat, marmoladaLon);
    uniforms={...snow.uniforms,mapTexture:{value:texture},sunDirection:{value:new THREE.Vector3(-.86,.23,-.45).normalize()},fogColor:{value:new THREE.Color('#efbf8b')},horizonMap:{value:horizonTexture},reliefScale:{value:verticalScale},satelliteLayer:{value:0},
      winterTerrain:{value:createWinterTerrain(meta,heights)},terrainKm:{value:new THREE.Vector2(meta.widthKm,meta.depthKm)},
      marmoladaUV:{value:new THREE.Vector2(marmolada.x/meta.widthKm+.5,.5-marmolada.z/meta.depthKm)}};
    material=new THREE.ShaderMaterial({
      uniforms,
      vertexShader:`varying vec2 mapUv; varying vec3 terrainNormal; varying float cameraDistance;
        void main(){mapUv=uv;terrainNormal=normalize(mat3(modelMatrix)*normal);vec4 world=modelMatrix*vec4(position,1.0);cameraDistance=length(cameraPosition-world.xyz);gl_Position=projectionMatrix*viewMatrix*world;}`,
      fragmentShader:`uniform sampler2D mapTexture; uniform sampler2D horizonMap; uniform vec3 sunDirection; uniform vec3 fogColor; uniform float reliefScale; uniform float satelliteLayer;
        varying vec2 mapUv; varying vec3 terrainNormal; varying float cameraDistance;
        ${snowShader}
        void main(){vec3 albedo=texture2D(mapTexture,mapUv).rgb;vec3 color=albedo;
          vec3 normal=normalize(terrainNormal);float light=max(dot(normal,sunDirection),0.0);
          float horizon=texture2D(horizonMap,mapUv).r*2.0*reliefScale;
          float sunSlope=sunDirection.y/length(sunDirection.xz);
          float visibility=1.0-smoothstep(sunSlope-.022,sunSlope+.035,horizon);
          // Warm low-angle direct light, with cooler skylight filling terrain shadows.
          vec3 skylight=vec3(.60,.64,.71)*(.91+.09*max(normal.y,0.0));
          vec3 sunset=vec3(1.00,.57,.27)*(.30+.65*light)*visibility;
          color*=skylight+sunset;
          float luminance=dot(color,vec3(.2126,.7152,.0722));
          color=mix(vec3(luminance),color,.96);
          float haze=smoothstep(24.0,150.0,cameraDistance)*.29;
          vec3 summer=mix(color,fogColor,haze);
          gl_FragColor=vec4(winterReveal(summer,albedo,normal,light,visibility,haze,mapUv),1.0);
          #include <colorspace_fragment>
        }`,
      side:THREE.FrontSide,
    });
    terrain=new THREE.Mesh(geometry,material);scene.add(terrain);updateRelief();
    setupPlaces();resize();
    updateSnowHint();
    controls.update();ready=true;
    window.dolomitesDiagnostics=()=>({ready:ready&&presented,layer:currentLayer,selected,verticalScale,camera:camera.position.toArray(),target:controls.target.toArray(),triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,renderFrames:renderer.info.render.frame,vertexCount:geometry.attributes.position.count,canvasSize:renderer.getSize(new THREE.Vector2()).toArray(),activeFlight:Boolean(flight),boundsKm:[meta.widthKm,meta.depthKm],textureSize:[uniforms.mapTexture.value.image.width,uniforms.mapTexture.value.image.height],snow:snow.diagnostics()});
    invalidate();
  }catch(error){console.error('Dolomiti initialization:',error);showError('Не удалось открыть 3D-карту');}
}
function updateSnowHint(){
  const melting=snow?.enabled&&snow?.brushEnabled;
  const zoomHint=mapOnly?'Колесо — масштаб':'Ctrl и колесо — масштаб';
  document.body.classList.toggle('winter',Boolean(snow?.enabled));
  const controlsHint=touch
    ?(melting?'Проведите пальцем — снег тает · Два пальца — карта':'Один палец — вращение · Два пальца — масштаб и перемещение')
    :(melting?`Водите курсором — снег тает · Тяните — вращение · ${zoomHint}`:`Тяните — вращение · ${zoomHint} · Правая кнопка — перемещение`);
  const exitHint=touch?'Два длинных свайпа вверх — продолжить':'Прокрутите несколько раз, чтобы продолжить';
  $('gesture-hint').textContent=mapOnly?controlsHint:`${controlsHint} · ${exitHint}`;
}
function showError(message){
  window.dispatchEvent(new CustomEvent('dolomites:error',{detail:message}));
}
