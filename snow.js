import * as THREE from 'three';

// Both seasons use the same vertices and UVs. This shader changes only the coat.
export const snowShader = `
uniform sampler2D meltMask;
uniform sampler2D winterTerrain;
uniform float snowEnabled;
uniform vec4 meltBounds;
uniform vec2 terrainKm;
uniform vec2 marmoladaUV;
float snowHash(vec2 p){
  vec3 q=fract(vec3(p.xyx)*.1031);
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float snowNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(snowHash(i),snowHash(i+vec2(1.,0.)),f.x),
    mix(snowHash(i+vec2(0.,1.)),snowHash(i+vec2(1.,1.)),f.x),f.y);
}
float snowBands(vec2 position){
  float broad=snowNoise(position*vec2(.80,1.35));
  float drifts=snowNoise(position*vec2(3.4,7.0)+broad*2.0);
  return broad*.55+drifts*.45;
}
float iceFractures(vec2 position){
  // Distorted, staggered cracks in exposed ice and tighter crevasses higher up.
  vec2 grid=position*vec2(5.1,9.0);
  grid.y+=snowNoise(position*3.1)*1.6+grid.x*.34;
  grid.x+=snowNoise(position*4.5+7.0)*.83;
  float offset=snowHash(vec2(3.7,floor(grid.y)));
  float seam=abs(fract(grid.y+offset*.32)-.5);
  float split=abs(fract(grid.x+offset)-.5);
  float width=max(fwidth(grid.y)*.70,.048);
  float crossWidth=max(fwidth(grid.x)*.7,.045);
  float crevasse=(1.0-smoothstep(.032,.032+width,seam))*.91;
  float cross=(1.0-smoothstep(.012,.012+crossWidth,split))*.35;
  return max(crevasse,cross)*smoothstep(.27,.67,snowNoise(position*8.1));
}
vec3 winterReveal(vec3 summer,vec3 albedo,vec3 normal,float light,float visibility,float haze,vec2 uv,vec2 sourceUv){
  if(snowEnabled<.5)return summer;
  vec2 ground=uv*terrainKm;
  float drift=snowBands(ground);
  float reveal=0.0;
  if(all(greaterThanEqual(uv,meltBounds.xy))&&all(lessThanEqual(uv,meltBounds.zw))){
    reveal=texture2D(meltMask,uv).r;
  }
  if(reveal>.999)return summer;
  vec4 terrainData=texture2D(winterTerrain,sourceUv);
  float altitude=terrainData.r;
  float shelter=terrainData.g;
  float hollow=terrainData.b;
  float flatWater=terrainData.a;
  float luma=dot(albedo,vec3(.2126,.7152,.0722));
  float detail=pow(max(luma,.001),.43);
  float vegetation=smoothstep(.013,.074,albedo.g-albedo.b)*(1.0-smoothstep(.20,.44,luma));
  float canopy=vegetation*(1.0-smoothstep(.54,.76,altitude));
  float grain=snowNoise(ground*vec2(26.,48.));
  float deposition=normal.y+.22*(altitude-.50)+.47*(shelter-.40)
    +.47*(drift-.50)+.11*(grain-.5)-.12*canopy;
  float coverage=smoothstep(.54,.76,deposition);

  // Cold bare limestone and dark conifer clusters remain visible between drifts.
  vec3 rock=mix(vec3(.079,.084,.093),vec3(.30,.276,.245),detail);
  vec3 forest=mix(vec3(.021,.044,.045),vec3(.092,.113,.117),detail);
  vec3 groundColor=mix(rock,forest,canopy*.92);
  float snowDetail=.70+.18*detail+.14*drift+.09*(grain-.5);
  vec3 powder=vec3(.88,.91,.91)*snowDetail;
  float dust=smoothstep(.22,.75,drift)*.24+canopy*.09;
  vec3 surface=mix(groundColor,powder,max(coverage,dust));
  // Blue ice is localized to level water from the imagery and the glacier area.
  float coolWater=smoothstep(.008,.027,albedo.b-albedo.r)
    *smoothstep(.006,.032,albedo.g-albedo.r)*(1.0-smoothstep(.12,.21,luma));
  float lakeIce=smoothstep(.71,.91,flatWater)*coolWater;
  vec2 fromGlacier=(uv-marmoladaUV)*terrainKm;
  vec2 glacierAxes=(fromGlacier-vec2(.69,.57))/vec2(1.60,.68);
  float glacier=(1.0-smoothstep(.48,1.12,length(glacierAxes)+(drift-.5)*.33))
    *smoothstep(.65,.77,altitude)*smoothstep(.11,.38,-normal.z+.19);
  float ice=max(lakeIce*.95,glacier*.91);
  if(ice>.006){
    float seam=iceFractures(ground);
    float glaze=snowNoise(ground*vec2(12.,21.));
    vec3 solidIce=mix(vec3(.06,.19,.28),vec3(.29,.54,.64),glaze);
    solidIce=mix(solidIce,vec3(.025,.083,.12),seam*.79);
    float frost=smoothstep(.52,.82,glaze*.45+drift*.55)*.67;
    surface=mix(surface,mix(solidIce,powder,frost),ice);
  }

  vec3 skylight=vec3(.33,.37,.43)*(.72+.28*max(normal.y,0.));
  vec3 sun=vec3(1.16,.94,.73)*(.15+.59*light)*(.24+.76*visibility);
  vec3 winter=surface*(skylight+sun);
  vec2 mistFlow=vec2(ground.x+ground.y*.42,ground.y-snowNoise(ground*.16)*1.65);
  float mistPockets=smoothstep(.42,.78,snowNoise(mistFlow*vec2(.10,.35)));
  float valleyMist=smoothstep(.25,.87,hollow)*(1.0-smoothstep(.38,.70,altitude))
    *(.045+.39*mistPockets);
  winter=mix(winter,vec3(.41,.46,.51),min(.45,haze*.66+valleyMist));
  return mix(winter,summer,reveal);
}`;

export function createWinterTerrain(meta, heights) {
  const { cols, rows } = meta.terrain;
  const data = new Uint8Array(cols * rows * 4);
  const sample = (x, y) => heights[
    THREE.MathUtils.clamp(y, 0, rows - 1) * cols + THREE.MathUtils.clamp(x, 0, cols - 1)
  ];
  const neighbours = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  const encode = value => Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const height = sample(x, y);
      let nearby = 0;
      let distant = 0;
      let roughness = 0;
      for (const [dx, dy] of neighbours) {
        nearby += sample(x + dx * 4, y + dy * 4);
        distant += sample(x + dx * 17, y + dy * 17);
        roughness += Math.abs(sample(x + dx, y + dy) - height);
      }
      const index = ((rows - y - 1) * cols + x) * 4;
      data[index] = encode(height / 3600);
      data[index + 1] = encode(.42 + (nearby / 8 - height) / 280);
      data[index + 2] = encode((distant / 8 - height) / 560);
      data[index + 3] = encode(1 - roughness / 136);
    }
  }

  const texture = new THREE.DataTexture(data, cols, rows);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const fieldWidth = 512;
const fieldHeight = 288;
const hoverHoldMs = 1100;
const radiusScale = 1.3;
const edgeReach = 1.25;
const refreezeRate = 1.25;
const minimumHeat = 1 / 255;

export class SnowReveal {
  constructor({element,camera,controls,meta,sampleHeight,heightScale,invalidate,canPaint,touch}){
    Object.assign(this,{element,camera,controls,meta,sampleHeight,heightScale,invalidate,canPaint,touch});
    this.enabled=true;this.brushEnabled=true;
    this.heat=new Float32Array(fieldWidth*fieldHeight);
    this.pixels=new Uint8Array(this.heat.length);
    this.texture=new THREE.DataTexture(this.pixels,fieldWidth,fieldHeight,THREE.RedFormat);
    this.texture.minFilter=THREE.LinearFilter;this.texture.magFilter=THREE.LinearFilter;
    this.uniforms={
      meltMask:{value:this.texture},snowEnabled:{value:1},
      meltBounds:{value:new THREE.Vector4()}
    };
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    this.touchPointers=new Set();
    this.reset();this.syncControls();
    element.addEventListener('pointerdown',e=>this.pointerDown(e),{capture:true});
    element.addEventListener('pointermove',e=>this.pointerMove(e));
    element.addEventListener('pointerup',e=>this.pointerUp(e));
    element.addEventListener('pointercancel',e=>this.pointerUp(e));
    element.addEventListener('pointerleave',()=>this.leave());
    controls.addEventListener('change',()=>{
      if(this.lastPointer&&this.canPaint()){this.pending=this.lastPointer;this.tip=null;}
    });
    window.addEventListener('blur',()=>{this.touchPointers.clear();this.leave();});
  }
  syncControls(){
    this.controls.touches.ONE=this.touch&&this.enabled&&this.brushEnabled?null:THREE.TOUCH.ROTATE;
  }
  setEnabled(enabled){
    this.enabled=enabled;this.uniforms.snowEnabled.value=enabled?1:0;
    this.reset();this.syncControls();
  }
  setBrushEnabled(enabled){this.brushEnabled=enabled;this.leave();this.syncControls();this.invalidate();}
  reset(){
    this.heat.fill(0);
    this.pixels.fill(0);
    this.bounds=null;
    this.uniforms.meltBounds.value.set(1,1,0,0);
    this.texture.needsUpdate=true;
    this.stopPainting();
    this.lastUV=null;this.lastUpdate=0;this.heatUpdates=0;
    this.invalidate();
  }
  remember(event){
    if(!this.enabled||!this.brushEnabled)return;
    const r=this.element.getBoundingClientRect();
    if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom){this.leave();return;}
    this.pending={x:(event.clientX-r.left)/r.width*2-1,y:-(event.clientY-r.top)/r.height*2+1};
    this.lastPointer=this.pending;
    this.holdUntil=performance.now()+hoverHoldMs;
    this.invalidate();
  }
  pointerDown(event){
    if(event.pointerType==='touch'){
      this.touchPointers.add(event.pointerId);
      if(this.touchPointers.size===1)this.remember(event);else this.leave();
    }else this.leave();
  }
  pointerMove(event){
    if(event.pointerType==='touch'){
      if(this.touchPointers.size===1)this.remember(event);else this.leave();
    }else if(event.buttons===0)this.remember(event);else this.leave();
  }
  pointerUp(event){
    if(event.pointerType==='touch'){this.touchPointers.delete(event.pointerId);this.leave();}
    else this.remember(event);
  }
  stopPainting(){
    this.pending=null;this.lastPointer=null;this.hit=null;this.tip=null;
    this.holdUntil=0;
  }
  leave(){
    this.stopPainting();
    if(this.bounds)this.invalidate();
  }
  pick(ndc){
    this.raycaster.setFromCamera(ndc,this.camera);
    const ray=this.raycaster.ray;
    const lows=[-this.meta.widthKm/2,-.01,-this.meta.depthKm/2];
    const highs=[this.meta.widthKm/2,4*this.heightScale(),this.meta.depthKm/2];
    const o=ray.origin.toArray(),d=ray.direction.toArray();
    let near=0,far=Infinity;
    for(let i=0;i<3;i++){
      if(Math.abs(d[i])<1e-8){if(o[i]<lows[i]||o[i]>highs[i])return null;continue;}
      let a=(lows[i]-o[i])/d[i],b=(highs[i]-o[i])/d[i];
      if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);
      if(far<near)return null;
    }
    const difference=t=>o[1]+d[1]*t-this.sampleHeight(o[0]+d[0]*t,o[2]+d[2]*t);
    let previous=near;
    for(let i=0;i<=128;i++){
      const t=near+(far-near)*i/128;
      if(difference(t)<=0){
        let a=previous,b=t;
        for(let j=0;j<10;j++){const middle=(a+b)/2;if(difference(middle)>0)a=middle;else b=middle;}
        return ray.at((a+b)/2,new THREE.Vector3());
      }
      previous=t;
    }
    return null;
  }
  refreeze(elapsed){
    if(!this.bounds)return;
    const bounds=this.bounds;
    const retention=Math.exp(-elapsed*refreezeRate);
    let left=fieldWidth,right=-1,bottom=fieldHeight,top=-1;
    for(let y=bounds.bottom;y<=bounds.top;y++){
      for(let x=bounds.left;x<=bounds.right;x++){
        const index=y*fieldWidth+x;
        const heat=this.heat[index]*retention;
        if(heat<minimumHeat){
          this.heat[index]=0;
          this.pixels[index]=0;
          continue;
        }
        this.heat[index]=heat;
        this.pixels[index]=Math.round(heat*255);
        left=Math.min(left,x);right=Math.max(right,x);
        bottom=Math.min(bottom,y);top=Math.max(top,y);
      }
    }
    this.bounds=right>=left?{left,right,bottom,top}:null;
  }
  warmTrail(elapsed){
    const hit=this.hit;
    const x=(hit.x/this.meta.widthKm+.5)*fieldWidth-.5;
    const y=(.5-hit.z/this.meta.depthKm)*fieldHeight-.5;
    const distance=hit.distanceTo(this.camera.position);
    const screenRadius=this.touch?72:105;
    const radius=radiusScale*THREE.MathUtils.clamp(
      2*distance*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*screenRadius/this.element.clientHeight,.30,7.5
    );
    const target={x,y,radius};
    const previous=this.tip??target;
    const dt=this.tip?elapsed:Math.min(elapsed,.028);
    const follow=1-Math.exp(-dt*18);
    const tip={
      x:THREE.MathUtils.lerp(previous.x,x,follow),
      y:THREE.MathUtils.lerp(previous.y,y,follow),
      radius:THREE.MathUtils.lerp(previous.radius,radius,follow),
    };
    const rx=tip.radius/this.meta.widthKm*fieldWidth;
    const ry=tip.radius/this.meta.depthKm*fieldHeight;
    const left=Math.max(0,Math.floor(Math.min(previous.x,tip.x)-rx*edgeReach));
    const right=Math.min(fieldWidth-1,Math.ceil(Math.max(previous.x,tip.x)+rx*edgeReach));
    const bottom=Math.max(0,Math.floor(Math.min(previous.y,tip.y)-ry*edgeReach));
    const top=Math.min(fieldHeight-1,Math.ceil(Math.max(previous.y,tip.y)+ry*edgeReach));
    const dx=(tip.x-previous.x)/rx,dy=(tip.y-previous.y)/ry;
    const lengthSquared=Math.max(dx*dx+dy*dy,.0001);
    const amount=1-Math.exp(-dt*12);

    // Bake the irregular edge into the terrain mask as the cursor passes.
    // Beyond the cursor's reach, the mask only fades through refreezing.
    for(let row=bottom;row<=top;row++){
      for(let col=left;col<=right;col++){
        const px=(col-previous.x)/rx,py=(row-previous.y)/ry;
        const nearest=THREE.MathUtils.clamp((px*dx+py*dy)/lengthSquared,0,1);
        const distance=Math.hypot(px-nearest*dx,py-nearest*dy);
        if(distance>=edgeReach)continue;
        const u=col/rx,v=row/ry;
        const edge=.16*Math.sin(u*4.7+v*2.4)*Math.sin(v*4.1-u*1.6)+.09*Math.sin(u*11.3-v*8.2);
        const influence=1-THREE.MathUtils.smoothstep(distance,.30,1+edge);
        if(!influence)continue;
        const index=row*fieldWidth+col;
        const heat=this.heat[index]+(1-this.heat[index])*amount*influence;
        this.heat[index]=heat;
        this.pixels[index]=Math.round(heat*255);
      }
    }
    const existing=this.bounds;
    this.bounds=existing?{
      left:Math.min(left,existing.left),right:Math.max(right,existing.right),
      bottom:Math.min(bottom,existing.bottom),top:Math.max(top,existing.top)
    }:{left,right,bottom,top};
    this.tip=tip;
    this.lastUV=[(tip.x+.5)/fieldWidth,(tip.y+.5)/fieldHeight];
    this.heatUpdates++;
  }
  update(time){
    if(!this.enabled)return false;
    if(this.holdUntil&&(time>=this.holdUntil||!this.canPaint()))this.stopPainting();
    if(this.pending){
      this.pointer.set(this.pending.x,this.pending.y);
      this.hit=this.pick(this.pointer);this.pending=null;
      if(!this.hit)this.tip=null;
    }
    if(!this.bounds&&!this.hit)return false;
    if(time-this.lastUpdate<15)return true;
    const elapsed=(time-(this.lastUpdate||time-17))/1000;
    this.lastUpdate=time;
    this.refreeze(elapsed);
    if(this.hit&&this.brushEnabled)this.warmTrail(elapsed);
    const bounds=this.bounds;
    if(bounds){
      // Linear filtering can sample an adjacent texel just outside the occupied bounds.
      this.uniforms.meltBounds.value.set(
        (bounds.left-.5)/fieldWidth,(bounds.bottom-.5)/fieldHeight,
        (bounds.right+1.5)/fieldWidth,(bounds.top+1.5)/fieldHeight
      );
    }else{
      this.uniforms.meltBounds.value.set(1,1,0,0);
      this.lastUpdate=0;
    }
    this.texture.needsUpdate=true;
    return Boolean(bounds);
  }
  diagnostics(){
    let value=0;
    if(this.lastUV){
      const x=THREE.MathUtils.clamp(Math.floor(this.lastUV[0]*fieldWidth),0,fieldWidth-1);
      const y=THREE.MathUtils.clamp(Math.floor(this.lastUV[1]*fieldHeight),0,fieldHeight-1);
      value=this.heat[y*fieldWidth+x];
    }
    return {enabled:this.enabled,brushEnabled:this.brushEnabled,heatUpdates:this.heatUpdates,lastUV:this.lastUV,lastMaskValue:value,hasTrail:Boolean(this.bounds),touchPointers:this.touchPointers.size};
  }
}
