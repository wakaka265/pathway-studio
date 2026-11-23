/* Shared document model and SVG renderer. No network or runtime dependencies. */
(function (root) {
  'use strict';
  const VERSION = 1;
  const FONT = 'Arial, Microsoft YaHei, sans-serif';
  const STRUCTURE_PRESETS=Object.freeze({
    nature:Object.freeze({label:'Nature 化学生物学',atomPt:8,captionPt:8,bondPt:14.4,linePt:.6,boldPt:2,spacing:.18,marginPt:1.6,hashPt:2.5,abbreviateMethyl:true}),
    acs:Object.freeze({label:'ACS 1996',atomPt:10,captionPt:10,bondPt:14.4,linePt:.6,boldPt:2,spacing:.18,marginPt:1.6,hashPt:2.5}),
    talk:Object.freeze({label:'汇报大字',atomPt:12,captionPt:12,bondPt:21.6,linePt:.9,boldPt:3,spacing:.18,marginPt:2.4,hashPt:3.75}),
  });
  const STRUCTURE_FONT='Arial, Helvetica, sans-serif';
  const ptToPx=pt=>pt*4/3;
  function typicalBondLength(molecule){
    const sites=molecule.atomSites||[],lengths=(molecule.bondSites||[]).map(b=>sites[b.a]&&sites[b.b]?Math.hypot(sites[b.b].x-sites[b.a].x,sites[b.b].y-sites[b.a].y):0).filter(v=>v>.01).sort((a,b)=>a-b);
    if(!lengths.length)return 0;
    const middle=Math.floor(lengths.length/2);
    return lengths.length%2?lengths[middle]:(lengths[middle-1]+lengths[middle])/2;
  }
  function applyStructurePreset(node,molecule,key){
    if(!Object.hasOwn(STRUCTURE_PRESETS,key))throw new Error('未知化学结构样式');
    const preset=STRUCTURE_PRESETS[key],length=typicalBondLength(molecule);
    if(length){
      const scale=ptToPx(preset.bondPt)/length;
      node.w=molecule.width*scale;
      node.h=molecule.height*scale;
    }
    node.fontFamily=STRUCTURE_FONT;
    node.fontSize=ptToPx(preset.captionPt);
    node.molecule={...molecule,stylePreset:key,atomFontFamily:STRUCTURE_FONT,atomFontSize:ptToPx(preset.atomPt),bondWidth:ptToPx(preset.linePt)};
  }
  let textMeasurer=null,defaultFont=FONT;
  const setTextMeasurer=fn=>textMeasurer=fn;
  const setDefaultFont=font=>defaultFont=font||FONT;
  const nodePadding=n=>n.molecule||n.shape==='none'||n.shape==='point'?4:7;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = (prefix='n') => prefix + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g,'');
  const clone = value => JSON.parse(JSON.stringify(value));
  const number = (x,fallback=0) => Number.isFinite(Number(x)) ? Number(x) : fallback;
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  function node(kind,x,y,label) {
    return {id:uid(),kind,x,y,w:kind==='module'?300:kind==='membrane'?32:100,h:kind==='module'?240:kind==='membrane'?330:40,
      label:label ?? ({text:'文字注释',module:'Module'}[kind] || ''),
      entityId: kind==='metabolite'?uid('m'):null,shape:kind==='module'?'round':'none',color:'#202c29',fill:kind==='membrane'?'#c8d1cb':'#dcebd0',stroke:kind==='membrane'?'#80948a':'#83988a',fontSize:22,italic:false,bold:false,dashed:kind==='module',rotation:0,groupId:null};
  }
  const ILLUSTRATIONS={channel:{name:'通道蛋白',group:'membrane',fill:'#c7e3fc',stroke:'#4a77a3',w:84,h:112},mitochondrion:{name:'线粒体',group:'organelle',fill:'#f1e3c7',stroke:'#a68b58',w:180,h:100},chloroplast:{name:'叶绿体',group:'organelle',fill:'#dcebcf',stroke:'#769358',w:180,h:110},nucleus:{name:'细胞核',group:'organelle',fill:'#e8def0',stroke:'#967cae',w:130,h:130},vacuole:{name:'液泡',group:'organelle',fill:'#e0eff2',stroke:'#78a6ac',w:150,h:120},rod:{name:'杆菌',group:'microbe',fill:'#d8eae5',stroke:'#688f82',w:180,h:90},coccus:{name:'球菌',group:'microbe',fill:'#deebd7',stroke:'#83a16e',w:120,h:120},yeast:{name:'酵母',group:'microbe',fill:'#f0e3ce',stroke:'#ac946a',w:140,h:150}};
  function illustrationNode(template,x,y){if(!Object.hasOwn(ILLUSTRATIONS,template))throw new Error('未知的示意组件');const info=ILLUSTRATIONS[template];return {...node('illustration',x,y,info.name),template,w:info.w,h:info.h,fill:info.fill,stroke:info.stroke,fontSize:17,...(template==='channel'?{standalone:true}:{})};}
  function componentBounds(n){const angle=(n.rotation||0)*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));return {w:n.w*c+n.h*s,h:n.w*s+n.h*c};}
  function illustrationLabelPosition(n){return {x:n.x+(n.labelDx||0),y:n.y+componentBounds(n).h/2+n.fontSize+7+(n.labelDy||0)};}
  const channelScale=n=>Math.min(n.w/(n.standalone?80:160),n.h/100);
  const channelOpening=n=>31*channelScale(n);
  function detachChannel(n){delete n.membraneId;delete n.membraneOffset;}
  function placeEmbeddedChannel(n,membrane){
    const angle=(membrane.rotation||0)*Math.PI/180;
    const limit=Math.max(0,membrane.h/2-channelOpening(n)-6);
    n.membraneOffset=clamp(n.membraneOffset,-limit,limit);
    n.x=membrane.x-Math.sin(angle)*n.membraneOffset;
    n.y=membrane.y+Math.cos(angle)*n.membraneOffset;
    n.rotation=((membrane.rotation||0)+450)%360;
  }
  function syncMembraneChannels(b){
    const membranes=new Map(b.nodes.filter(n=>n.kind==='membrane').map(n=>[n.id,n]));
    for(const n of b.nodes){
      if(!n.membraneId)continue;
      const membrane=membranes.get(n.membraneId);
      if(membrane)placeEmbeddedChannel(n,membrane);else detachChannel(n);
    }
  }
  function embedChannel(b,n,membraneId=null,snapDistance=10){
    if(n.template!=='channel')return false;
    const width=n.standalone?n.w:channelScale(n)*80;
    const opening=channelOpening({...n,w:width,standalone:true});
    let best=null;
    for(const membrane of b.nodes){
      if(membrane.kind!=='membrane'||membraneId&&membrane.id!==membraneId)continue;
      const limit=membrane.h/2-opening-6;
      if(limit<0)continue;
      const angle=(membrane.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),dx=n.x-membrane.x,dy=n.y-membrane.y;
      const perpendicular=Math.abs(dx*c+dy*s),axial=dy*c-dx*s;
      if(!membraneId&&(perpendicular>membrane.w/2+snapDistance||Math.abs(axial)>membrane.h/2))continue;
      const offset=clamp(axial,-limit,limit),distance=Math.hypot(perpendicular,axial-offset);
      if(best&&distance>=best.distance)continue;
      if(b.nodes.some(other=>other!==n&&other.membraneId===membrane.id&&Math.abs(other.membraneOffset-offset)<channelOpening(other)+opening+4))continue;
      best={membrane,offset,distance};
    }
    if(!best)return false;
    Object.assign(n,{w:width,standalone:true,membraneId:best.membrane.id,membraneOffset:best.offset});
    placeEmbeddedChannel(n,best.membrane);
    return true;
  }
  function nearestPathPosition(g,p){let best=.5,distance=Infinity;for(let i=0;i<=100;i++){const t=.05+i*.009,q=g.at(t),d=(q.x-p.x)**2+(q.y-p.y)**2;if(d<distance){distance=d;best=t;}}let lo=Math.max(.05,best-.009),hi=Math.min(.95,best+.009);for(let i=0;i<18;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3,pa=g.at(a),pb=g.at(b);if((pa.x-p.x)**2+(pa.y-p.y)**2<(pb.x-p.x)**2+(pb.y-p.y)**2)hi=b;else lo=a;}return (lo+hi)/2;}
  function moleculeNode(data,x,y,label=''){return {...node('metabolite',x,y,label),shape:'structure',w:220,h:150,fontSize:17,molecule:clone(data)};}
  const CHEMICAL_BONDS={wedge:'实楔键',hashed:'虚楔键',dashed:'虚线键',wavy:'波浪键'};
  function chemicalBondNode(style,x,y){if(!Object.hasOwn(CHEMICAL_BONDS,style))throw new Error('未知化学键样式');return {...node('text',x,y,''),chemicalBond:style,w:70,h:14,stroke:'#202c29',fill:'none'};}
  function moleculeLabelPosition(n){if(n.molecule?.display==='name')return {x:n.x,y:n.y};const box=moleculeGraphicBounds(n);return {x:(box.left+box.right)/2,y:box.bottom+(n.molecule?.labelGap??8)+n.fontSize*.55};}
  function moleculeAtomPosition(n,index,data=n.molecule){const p=data?.atomSites?.[index];if(!p)return null;const scale=Math.min(n.w/data.width,n.h/data.height);return {x:n.x+(p.x-data.width/2)*scale,y:n.y+(p.y-data.height/2)*scale};}
  const glyphCache=new WeakMap();
  function moleculeGlyphs(n){
    const m=n.molecule,scale=Math.min(n.w/m.width,n.h/m.height),fontSize=m.atomFontSize??18;
    const font=m.atomFontFamily||STRUCTURE_FONT;
    const key=n.w+'|'+n.h+'|'+fontSize+'|'+font,cached=glyphCache.get(m);
    if(cached?.key===key)return cached.groups;
    const groups=new Map();
    function group(atom){
      if(!groups.has(atom))groups.set(atom,{atom,paths:[],texts:[],minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity,capHeight:0});
      return groups.get(atom);
    }
    function include(g,x,y){
      g.minX=Math.min(g.minX,x); g.minY=Math.min(g.minY,y);
      g.maxX=Math.max(g.maxX,x); g.maxY=Math.max(g.maxY,y);
    }
    for(const path of m.paths){
      if(!m.atomSites?.[path.atom])continue;
      const values=path.d.match(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g)?.map(Number)||[];
      if(values.length<2)continue;
      const g=group(path.atom),ys=values.filter((_,i)=>i%2);
      g.paths.push(path);
      g.capHeight=Math.max(g.capHeight,Math.max(...ys)-Math.min(...ys));
      for(let i=0;i+1<values.length;i+=2)include(g,values[i],values[i+1]);
    }
    for(const t of m.atomTexts||[]){
      if(!m.atomSites?.[t.atom])continue;
      const g=group(t.atom);
      g.texts.push(t);
      const w=textMeasurer?textMeasurer(t.text,t.size,font,false,false):.75*t.size*t.text.length;
      include(g,t.x,t.y-t.size*.75);
      include(g,t.x+w,t.y+t.size*.08);
    }
    for(const g of groups.values()){
      g.site=m.atomSites[g.atom];
      g.factor=fontSize/Math.max(.01,(m.drawingFontSize||Math.max(.01,g.capHeight)/.75)*scale);
      g.box={x:g.site.x+(g.minX-g.site.x)*g.factor,y:g.site.y+(g.minY-g.site.y)*g.factor,w:(g.maxX-g.minX)*g.factor,h:(g.maxY-g.minY)*g.factor};
    }
    const result=[...groups.values()];
    glyphCache.set(m,{key,groups:result});
    return result;
  }
  const graphicBoundsCache=new WeakMap();
  function moleculeGraphicBounds(n){const m=n.molecule;if(!m)return {left:n.x-n.w/2,right:n.x+n.w/2,top:n.y-n.h/2,bottom:n.y+n.h/2};const scale=Math.min(n.w/m.width,n.h/m.height),key=[n.w,n.h,m.atomFontSize??18,m.atomFontFamily||STRUCTURE_FONT,m.bondWidth??1.8].join('|');let cached=graphicBoundsCache.get(m);if(cached?.key!==key){let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;const include=(x,y)=>{left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);};for(const path of m.paths){if(path.atom!==undefined||m.hiddenBonds?.includes(path.bond))continue;const values=path.d.match(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g)?.map(Number)||[];for(let i=0;i+1<values.length;i+=2)include(values[i],values[i+1]);}for(const g of moleculeGlyphs(n)){include(g.box.x,g.box.y);include(g.box.x+g.box.w,g.box.y+g.box.h);}for(const style of m.bondStyles||[]){const b=m.bondSites[style.index],a=m.atomSites[b.a],z=m.atomSites[b.b],length=Math.hypot(z.x-a.x,z.y-a.y)||1,h=(m.bondWidth??1.8)*2.8/scale;include(z.x-(z.y-a.y)/length*h,z.y+(z.x-a.x)/length*h);include(z.x+(z.y-a.y)/length*h,z.y-(z.x-a.x)/length*h);}if(!Number.isFinite(left)){left=0;right=m.width;top=0;bottom=m.height;}cached={key,left:(left-m.width/2)*scale,right:(right-m.width/2)*scale,top:(top-m.height/2)*scale,bottom:(bottom-m.height/2)*scale};graphicBoundsCache.set(m,cached);}return {left:n.x+cached.left,right:n.x+cached.right,top:n.y+cached.top,bottom:n.y+cached.bottom};}
  function fitMoleculeEdit(n,data,oldData=n.molecule,anchorIndex=0){const anchor=moleculeAtomPosition(n,anchorIndex,oldData),oldScale=Math.min(n.w/oldData.width,n.h/oldData.height);let scale=oldScale;if(oldData.atomSites?.length>1&&data.atomSites?.length>1){const a=oldData.atomSites,b=data.atomSites,oldD=Math.hypot(a[1].x-a[0].x,a[1].y-a[0].y),newD=Math.hypot(b[1].x-b[0].x,b[1].y-b[0].y);if(newD>.001)scale=oldScale*oldD/newD;}if(oldData.drawScale&&data.drawScale)scale=oldScale*oldData.drawScale/data.drawScale;n.w=Math.max(10,data.width*scale);n.h=Math.max(10,data.height*scale);if(anchor){n.x=anchor.x-(data.atomSites[anchorIndex].x-data.width/2)*scale;n.y=anchor.y-(data.atomSites[anchorIndex].y-data.height/2)*scale;}n.molecule=data;}
  function bondGlyph(style,a,b,width=1.8,metrics=null){const length=Math.hypot(b.x-a.x,b.y-a.y),angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI,h=metrics?.halfWedge??width*2.8;let body='';if(style==='wedge')body=`<path d="M0 0L${length} ${-h}L${length} ${h}Z" fill="#202c29"/>`;if(style==='hashed'){let d='';const count=metrics?Math.max(3,Math.round(length/metrics.hash)):Math.max(4,Math.min(9,Math.floor(length/(width*2.5))));for(let i=1;i<=count;i++){const t=i/count;d+=`M${length*t} ${-h*t}v${2*h*t} `;}body=`<path d="${d}" stroke="#202c29" stroke-width="${width}" fill="none"/>`;}if(style==='dashed')body=`<path d="M0 0H${length}" stroke="#202c29" stroke-width="${width}" stroke-dasharray="${width*2.7} ${width*2.2}" fill="none"/>`;if(style==='wavy'){let d='M0 0';for(let i=0;i<8;i++)d+=`Q${length*(i+.5)/8} ${i%2?-h:h} ${length*(i+1)/8} 0`;body=`<path d="${d}" stroke="#202c29" stroke-width="${width}" fill="none"/>`;}return `<g transform="translate(${a.x} ${a.y}) rotate(${angle})">${body}</g>`;}
  function edge(source,target) {
    return {id:uid('r'),source,target,mode:'curve',direction:'forward',sourcePort:'auto',targetPort:'auto',color:'#293b33',width:1.8,arrowSize:9,dashed:false,label:'',labelColor:'#bf503f',fontSize:18,labelDx:0,labelDy:-18,labelItalic:false,knockout:false,knockoutLabel:'Δgene',bulge:70,points:[],cofactors:[],groupId:null};
  }
  const isFreeArrow=e=>e?.kind==='arrow';
  function freeArrow(start,end){
    return {...edge(null,null),kind:'arrow',mode:'straight',start:{...start},end:{...end}};
  }
  function alignFreeArrow(arrow,board,axis){
    if(!isFreeArrow(arrow)||!['x','y'].includes(axis))return;
    const cross=axis==='x'?'y':'x',limit=axis==='x'?board.width:board.height;
    const crossLimit=axis==='x'?board.height:board.width;
    const length=Math.min(limit,Math.hypot(arrow.end.x-arrow.start.x,arrow.end.y-arrow.start.y));
    if(length<.01)return;
    const forward=arrow.end[axis]>=arrow.start[axis];
    const midpoint=clamp((arrow.start[axis]+arrow.end[axis])/2,length/2,limit-length/2);
    const offset=clamp((arrow.start[cross]+arrow.end[cross])/2,0,crossLimit);
    const halfLength=(forward?1:-1)*length/2;
    arrow.start={[axis]:midpoint-halfLength,[cross]:offset};
    arrow.end={[axis]:midpoint+halfLength,[cross]:offset};
    arrow.mode='straight';
    arrow.points=[];
    delete arrow.c1;
    delete arrow.c2;
  }
  function edgeLabelGeometry(edge,g){
    const vertical=isFreeArrow(edge)&&edge.mode==='straight'&&
      Math.abs(g.z.y-g.a.y)>0&&Math.abs(g.z.x-g.a.x)<=Math.abs(g.z.y-g.a.y)*.01;
    if(!vertical)return {x:g.mid.x+edge.labelDx,y:g.mid.y+edge.labelDy,anchor:'middle',vertical};
    const side=edge.labelDy>0?-1:1,gap=Math.max(4,Math.abs(edge.labelDy));
    return {x:g.mid.x+side*gap,y:g.mid.y+edge.labelDx,anchor:side>0?'start':'end',vertical};
  }
  function edgeLabelOffset(edge,g,dx,dy){
    return edgeLabelGeometry(edge,g).vertical?{labelDx:dy,labelDy:-dx}:{labelDx:dx,labelDy:dy};
  }
  function renderEdgeLabelHitArea(edge,label){
    if(!edge.label.trim())return '';
    const {w,h}=bounds({kind:'text',shape:'none',label:edge.label,fontSize:edge.fontSize,
      fontFamily:edge.labelFontFamily,bold:edge.labelBold,italic:edge.labelItalic});
    const x=label.x-(label.anchor==='end'?w:label.anchor==='start'?0:w/2);
    return '<rect data-label-hit="'+esc(edge.id)+'" x="'+(x-3)+'" y="'+(label.y-h/2-3)+
      '" width="'+(w+6)+'" height="'+(h+6)+'" fill="transparent" cursor="move"/>';
  }
  function edgeEndpoints(e,b){
    if(isFreeArrow(e))return [e.start,e.end];
    return [b.nodes.find(n=>n.id===e.source),b.nodes.find(n=>n.id===e.target)];
  }
  function translateEdge(e,original,dx,dy){
    const shift=point=>({x:point.x+dx,y:point.y+dy});
    if(isFreeArrow(e)){
      e.start=shift(original.start);
      e.end=shift(original.end);
    }
    e.points=original.points.map(shift);
  }
  function selectionScaleFrame(b,selection){
    const nodes=b.nodes.filter(n=>selection.has(n.id)||selection.has(n.membraneId));
    const nodeIds=new Set(nodes.map(n=>n.id));
    const edges=b.edges.filter(e=>isFreeArrow(e)?selection.has(e.id):nodeIds.has(e.source)&&nodeIds.has(e.target));
    if(!nodes.length&&!edges.length)return null;
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    const include=(x,y,w=0,h=0)=>{
      left=Math.min(left,x-w/2);right=Math.max(right,x+w/2);
      top=Math.min(top,y-h/2);bottom=Math.max(bottom,y+h/2);
    };
    const includeText=(p,label,style)=>{
      if(!label)return;
      const {w,h}=bounds({...style,kind:'text',shape:'none',label});
      include(p.x+(p.anchor==='start'?w/2:p.anchor==='end'?-w/2:0),p.y,w,h);
    };
    for(const n of nodes){
      const {w,h}=bounds(n);include(n.x,n.y,w,h);
      if(n.kind==='illustration')includeText(illustrationLabelPosition(n),n.label,n);
    }
    const paths=edges.map(e=>geometry(e,b));
    for(const [i,e] of edges.entries()){
      const g=paths[i];if(!g)continue;
      for(let step=0;step<=32;step++){const p=g.at(step/32);include(p.x,p.y,e.width,e.width);}
      includeText(edgeLabelGeometry(e,g),e.label,{fontSize:e.fontSize,fontFamily:e.labelFontFamily,bold:e.labelBold,italic:e.labelItalic});
      if(e.knockout){
        const p=knockoutMarkGeometry(e,g),label=knockoutTextGeometry(e,g);
        include(p.x,p.y,18,18);includeText(label,e.knockoutLabel,label);
      }
      for(const cf of e.cofactors){
        const q=cofactorGeometry(e,g,cf);
        include(q.input.x,q.input.y);include(q.output.x,q.output.y);
        includeText(q.inputLabel,cf.input,cofactorTextStyle(e,cf,'input'));
        includeText(q.outputLabel,cf.output,cofactorTextStyle(e,cf,'output'));
      }
    }
    const group=nodes[0]?.groupId,circle=paths[0]?.circleCenter;
    const isCircle=circle&&edges.length>=3&&group&&nodes.every(n=>n.groupId===group)&&edges.every((e,i)=>{
      const c=paths[i]?.circleCenter;
      return e.groupId===group&&c&&Math.hypot(c.x-circle.x,c.y-circle.y)<.01;
    });
    const center=isCircle?circle:{x:(left+right)/2,y:(top+bottom)/2};
    return {left,right,top,bottom,center,ids:new Set([...nodeIds,...edges.map(e=>e.id)])};
  }
  function scaleSelection(b,original,ids,center,factor){
    for(const e of original.edges){
      if(ids.has(e.id)&&isFreeArrow(e))factor=Math.max(factor,.010001/Math.hypot(e.end.x-e.start.x,e.end.y-e.start.y));
    }
    const scaled=(current,prev,keys,min=-100000,max=100000)=>{
      for(const key of keys)if(prev[key]!==undefined)current[key]=clamp(prev[key]*factor,min,max);
    };
    const point=p=>({x:center.x+(p.x-center.x)*factor,y:center.y+(p.y-center.y)*factor});
    const nodes=new Map(original.nodes.map(n=>[n.id,n]));
    for(const n of b.nodes){
      if(!ids.has(n.id))continue;
      const old=nodes.get(n.id);
      Object.assign(n,point(old));
      scaled(n,old,['w','h'],10,10000);scaled(n,old,['fontSize'],6,200);scaled(n,old,['labelDx','labelDy']);
      if(old.molecule){
        const m=old.molecule;
        n.molecule=factor===1?m:{...m,atomFontSize:clamp((m.atomFontSize??18)*factor,6,200),
          bondWidth:clamp((m.bondWidth??boardStructureBondWidth(original))*factor,.2,20)};
        scaled(n.molecule,m,['labelGap'],0,200);
      }
      if(old.membraneId){
        const host=nodes.get(old.membraneId);
        if(ids.has(host.id))n.membraneOffset=old.membraneOffset*factor;
        else{
          const angle=(host.rotation||0)*Math.PI/180;
          n.membraneOffset=(n.y-host.y)*Math.cos(angle)-(n.x-host.x)*Math.sin(angle);
        }
      }
    }
    const edges=new Map(original.edges.map(e=>[e.id,e]));
    for(const e of b.edges){
      if(!ids.has(e.id))continue;
      const old=edges.get(e.id);
      if(isFreeArrow(e)){e.start=point(old.start);e.end=point(old.end);}
      if(old.c1)e.c1={x:old.c1.x*factor,y:old.c1.y*factor};
      if(old.c2)e.c2={x:old.c2.x*factor,y:old.c2.y*factor};
      e.points=old.points.map(point);
      scaled(e,old,['labelDx','labelDy','knockoutDx','knockoutDy','knockoutMarkDx','knockoutMarkDy','bulge']);
      scaled(e,old,['width'],.2,20);scaled(e,old,['arrowSize'],3,40);scaled(e,old,['cornerRadius'],0,500);scaled(e,old,['fontSize'],6,200);
      if(old.knockoutStyle)scaled(e.knockoutStyle,old.knockoutStyle,['fontSize'],6,200);
      for(const [i,cf] of e.cofactors.entries()){
        const previous=old.cofactors[i];
        scaled(cf,previous,['dx','dy','inputLabelDx','inputLabelDy','outputLabelDx','outputLabelDy']);
        scaled(cf,previous,['spread'],10,300);scaled(cf,previous,['labelGap'],0,100);
        scaled(cf,previous,['fontSize'],6,200);scaled(cf,previous,['arrowSize'],3,40);
        for(const key of ['inputStyle','outputStyle'])if(previous[key])scaled(cf[key],previous[key],['fontSize'],6,200);
      }
    }
    syncMembraneChannels(b);
  }
  function board(name='画板 1') {return {id:uid('b'),name,width:1200,height:820,nodes:[],edges:[]};}
  function boardStructureBondWidth(b){
    if(b.structureBondWidth!==undefined)return b.structureBondWidth;
    const widths=b.edges.filter(e=>!isFreeArrow(e)).map(e=>e.width).sort((a,b)=>a-b);
    return widths.length?widths[Math.floor(widths.length/2)]:1.8;
  }
  function setBoardArrowWidth(b,width){
    if(!Number.isFinite(width)||width<.2||width>20)throw new Error('箭头线宽无效');
    b.structureBondWidth??=boardStructureBondWidth(b);
    b.arrowWidth=width;
    for(const edge of b.edges)edge.width=width;
  }
  function applyBoardFigureStyle(b,key){
    if(!Object.hasOwn(STRUCTURE_PRESETS,key))throw new Error('未知化学结构样式');
    const preset=STRUCTURE_PRESETS[key],fontSize=ptToPx(preset.captionPt),width=ptToPx(preset.linePt);
    const typography={fontFamily:STRUCTURE_FONT,fontSize};
    setBoardArrowWidth(b,width);
    for(const node of b.nodes){
      if(node.chemicalBond||node.kind==='membrane')continue;
      Object.assign(node,typography);
    }
    for(const edge of b.edges){
      edge.fontSize=fontSize;
      edge.labelFontFamily=STRUCTURE_FONT;
      edge.knockoutStyle={...edge.knockoutStyle,...typography};
      for(const cofactor of edge.cofactors){
        cofactor.fontSize=fontSize;
        cofactor.inputStyle={...cofactor.inputStyle,...typography};
        cofactor.outputStyle={...cofactor.outputStyle,...typography};
      }
    }
  }
  function emptyProject() {return {format:'pathway-studio',version:VERSION,name:'未命名路径图',fontFamily:FONT,boards:[board()]};}
  function labelRuns(value){const text=String(value),runs=[],re=/([_^])\{([^{}]*)\}/g;let cursor=0,m;while((m=re.exec(text))){if(m.index>cursor)runs.push({text:text.slice(cursor,m.index),script:'normal'});if(m[2])runs.push({text:m[2],script:m[1]==='_'?'sub':'super'});cursor=re.lastIndex;}if(cursor<text.length)runs.push({text:text.slice(cursor),script:'normal'});return runs;}
  function runsToLabel(runs){const merged=[];for(const r of runs){if(!r.text)continue;const script=['sub','super'].includes(r.script)?r.script:'normal',last=merged.at(-1);if(last?.script===script)last.text+=r.text;else merged.push({text:r.text,script});}return merged.map(r=>r.script==='normal'?r.text:r.text.split('\n').map(line=>line?(r.script==='sub'?'_':'^')+'{'+line+'}':'').join('\n')).join('');}
  function labelEditorHTML(value){return labelRuns(value).map(r=>r.script==='normal'?esc(r.text):`<${r.script==='sub'?'sub':'sup'}>${esc(r.text)}</${r.script==='sub'?'sub':'sup'}>`).join('');}
  function formatLabelRange(value,start,end,script){const result=[];let offset=0;for(const r of labelRuns(value)){const a=clamp(start-offset,0,r.text.length),z=clamp(end-offset,0,r.text.length);if(a)result.push({text:r.text.slice(0,a),script:r.script});if(z>a)result.push({text:r.text.slice(a,z),script});if(z<r.text.length)result.push({text:r.text.slice(Math.max(a,z)),script:r.script});offset+=r.text.length;}return runsToLabel(result);}
  function textMarkup(label,x,y,size=22,color='#202c29',opts={}) {
    const lines=String(label).split('\n');
    const content=lines.map((line,index)=>{
      let chunks='',cursor=0; const re=/([_^])\{([^{}]*)\}/g; let m;
      while((m=re.exec(line))){chunks+=esc(line.slice(cursor,m.index));chunks+=`<tspan baseline-shift="${m[1]==='_'?'sub':'super'}" font-size="70%">${esc(m[2])}</tspan>`;cursor=re.lastIndex;}
      chunks+=esc(line.slice(cursor));
      return `<tspan x="${x}" dy="${index===0?0:size*1.22}">${chunks || ' '}</tspan>`;
    }).join('');
    return `<text x="${x}" y="${y-(lines.length-1)*size*.61}" font-size="${size}" fill="${esc(color)}" text-anchor="${opts.anchor || 'middle'}" dominant-baseline="central" font-style="${opts.italic?'italic':'normal'}" font-weight="${opts.bold?'700':'400'}"${opts.fontFamily?` font-family="${esc(opts.fontFamily)}"`:''}${opts.attrs?' '+opts.attrs:''}>${content}</text>`;
  }
  function cofactorTextStyle(e,c,endpoint){const style=c[endpoint+'Style']||{};return {fontFamily:style.fontFamily||'',fontSize:style.fontSize??c.fontSize??Math.max(13,e.fontSize-2),color:style.color||e.color,bold:style.bold??false};}
  function knockoutTextGeometry(e,g){const style=e.knockoutStyle||{};return {x:g.mid.x+e.labelDx+(e.knockoutDx||0),y:g.mid.y+Math.abs(e.labelDy)+8+(e.knockoutDy||0),fontFamily:style.fontFamily||'',fontSize:style.fontSize??e.fontSize,color:style.color||'#c75140',bold:style.bold??false,italic:true};}
  function knockoutMarkGeometry(e,g){return {x:g.mid.x+(e.knockoutMarkDx||0),y:g.mid.y+(e.knockoutMarkDy||0)};}
  function bounds(n) {
    if(n.chemicalBond)return componentBounds(n);
    if(n.molecule){if(n.molecule.display==='name'){const {w,h}=bounds({...n,molecule:null,shape:'none',label:n.label||'结构式'});return n.structureHighlight?{w:w+14,h:h+14}: {w,h};}const box=n.structureHighlight?moleculeBackdrop(n):moleculeGraphicBounds(n),hasLabel=n.molecule.display==='both'&&n.label,p=hasLabel?moleculeLabelPosition(n):null,textBox=hasLabel?bounds({...n,molecule:null,shape:'none'}):{w:0,h:0};return {w:2*Math.max(n.x-box.left,box.right-n.x,hasLabel?Math.abs(p.x-n.x)+textBox.w/2:0),h:2*Math.max(n.y-box.top,box.bottom-n.y,hasLabel?p.y-n.y+textBox.h/2:0)};}
    if(['membrane','illustration'].includes(n.kind))return componentBounds(n);
    if(n.shape==='point')return {w:4,h:4};
    if(n.kind==='metabolite'&&n.shape==='round'&&n.highlightFit!==false){
      const label=bounds({...n,shape:'none'});
      const aligned=n.labelAnchor==='start'||n.labelAnchor==='end';
      return {
        w:Math.max(20,label.w*(aligned?2:1)+Math.abs(n.labelDx||0)*2+20),
        h:Math.max(20,label.h+Math.abs(n.labelDy||0)*2+12),
      };
    }
    const label=String(n.label).replace(/[_^]\{([^{}]*)\}/g,'$1').split('\n');
    const textW=textMeasurer?Math.max(1,...String(n.label).split('\n').map(l=>textMeasurer(l,n.fontSize,n.fontFamily||defaultFont,n.bold,n.italic))):Math.max(1,...label.map(l=>Array.from(l).reduce((sum,c)=>sum+(/[^\x00-\x7F]/.test(c)?1:.57),0)))*n.fontSize;
    return {w:n.shape==='none'&&n.kind!=='membrane'?Math.max(n.fontSize*.6,textW+2):n.w,h:n.shape==='none'&&n.kind!=='membrane'?n.fontSize*((label.length-1)*1.22+(/[_^]\{/.test(n.label)?1.35:1.05)):n.h};
  }
  function anchor(n,toward,port='auto') {
    const {w,h}=bounds(n),pad=nodePadding(n);
    if(n.molecule&&(n.molecule.display!=='name'||n.structureHighlight)){
      const direction={north:[0,-1],south:[0,1],west:[-1,0],east:[1,0]}[port];
      const [dx,dy]=direction||[toward.x-n.x,toward.y-n.y],d=Math.hypot(dx,dy);
      if(d){
        const length=Math.hypot(w,h)/2+pad+1;
        const ray=t=>({x:n.x+t*length*dx/d,y:n.y+t*length*dy/d});
        const end=lastContact(ray,moleculeObstacle(n));
        if(end!==null)return ray(end);
      }
    }
    if(port==='north')return{x:n.x,y:n.y-h/2-pad};if(port==='south')return{x:n.x,y:n.y+h/2+pad};if(port==='east')return{x:n.x+w/2+pad,y:n.y};if(port==='west')return{x:n.x-w/2-pad,y:n.y};
    let dx=toward.x-n.x,dy=toward.y-n.y;if(!dx&&!dy)dx=1;
    const scale=n.shape==='circle'?1/Math.sqrt(dx*dx/(w/2+pad)**2+dy*dy/(h/2+pad)**2):Math.min((w/2+pad)/Math.max(.001,Math.abs(dx)),(h/2+pad)/Math.max(.001,Math.abs(dy)));
    return{x:n.x+dx*scale,y:n.y+dy*scale};
  }
  function lastContact(at,inside){
    for(let i=127;i>=0;i--){
      const t=i/128;
      if(!inside(at(t)))continue;
      let lo=t,hi=(i+1)/128;
      for(let j=0;j<12;j++){const middle=(lo+hi)/2;if(inside(at(middle)))lo=middle;else hi=middle;}
      return hi;
    }
    return null;
  }
  function moleculeObstacle(n){
    const m=n.molecule,pad=nodePadding(n),scale=Math.min(n.w/m.width,n.h/m.height);
    const graphic=n.structureHighlight?moleculeBackdrop(n):moleculeGraphicBounds(n);
    const insideBox=(p,b,extra=pad)=>p.x>=b.left-extra&&p.x<=b.right+extra&&p.y>=b.top-extra&&p.y<=b.bottom+extra;
    if(n.structureHighlight||!m.atomSites?.length||!m.bondSites)return p=>insideBox(p,graphic);
    const ox=n.x-m.width*scale/2,oy=n.y-m.height*scale/2;
    const labels=moleculeGlyphs(n).map(({box:b})=>({left:ox+b.x*scale,right:ox+(b.x+b.w)*scale,top:oy+b.y*scale,bottom:oy+(b.y+b.h)*scale}));
    if(m.display==='both'&&n.label){
      const {x,y}=moleculeLabelPosition(n),{w,h}=bounds({...n,molecule:null,shape:'none'});
      labels.push({left:x-w/2,right:x+w/2,top:y-h/2,bottom:y+h/2});
    }
    const hidden=new Set(m.hiddenBonds||[]),lineRadius=pad+(m.bondWidth??1.8)/2;
    const strokes=m.bondSites.flatMap((bond,i)=>{
      if(hidden.has(i))return [];
      const a=moleculeAtomPosition(n,bond.a),b=moleculeAtomPosition(n,bond.b);
      if(!a||!b)return [];
      return [{a,dx:b.x-a.x,dy:b.y-a.y,radius:lineRadius+(bond.order>1?1.5:0)}];
    });
    return p=>{
      if(labels.some(box=>insideBox(p,box)))return true;
      if(!insideBox(p,graphic,pad+4))return false;
      return strokes.some(({a,dx,dy,radius})=>{
        const t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
        return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t)<=radius;
      });
    };
  }
  const fmt=p=>`${Math.round(p.x*100)/100},${Math.round(p.y*100)/100}`;
  const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  function roundedPath(points,radius=24) {
    let d=`M${fmt(points[0])}`;
    for(let i=1;i<points.length-1;i++){
      const a=points[i-1],b=points[i],c=points[i+1];const l1=Math.hypot(a.x-b.x,a.y-b.y),l2=Math.hypot(c.x-b.x,c.y-b.y);
      const r=Math.min(radius,l1/2,l2/2);const p=mix(b,a,l1?r/l1:0),q=mix(b,c,l2?r/l2:0);
      d+=` L${fmt(p)} Q${fmt(b)} ${fmt(q)}`;
    } return d+` L${fmt(points.at(-1))}`;
  }
  function rightRoutePreset(b,sourceId,targetId) {
    const source=b.nodes.find(n=>n.id===sourceId),target=b.nodes.find(n=>n.id===targetId);
    if(!source||!target||source===target)return null;
    const a=anchor(source,target,'south'),z=anchor(target,source,'east');
    const cornerRadius=24,clearance=12;
    const minX=Math.max(a.x+34,z.x+34,source.x+bounds(source).w/2+clearance);
    const minY=Math.max(a.y+24,z.y+24,target.y+bounds(target).h/2+clearance);
    let right=b.width-clearance,bottom=b.height-clearance;
    for(const n of b.nodes){
      if(n.kind!=='module'||n.shape==='circle')continue;
      const inside=p=>Math.abs(p.x-n.x)<n.w/2&&Math.abs(p.y-n.y)<n.h/2;
      if(![source,target].every(inside))continue;
      right=Math.min(right,n.x+n.w/2-clearance);
      bottom=Math.min(bottom,n.y+n.h/2-clearance);
    }
    if(Math.min(a.x,z.x)<0||Math.min(a.y,z.y)<0||minX>right||minY>bottom)return null;

    // Keep enough room for a quadratic corner to cut inside the right angle.
    const obstacles=b.nodes.filter(n=>n!==source&&n!==target&&n.kind!=='module').map(n=>{
      const {w,h}=bounds(n);
      return {left:n.x-w/2-clearance,right:n.x+w/2+clearance,top:n.y-h/2-clearance,bottom:n.y+h/2+clearance};
    }).filter(box=>box.right>Math.min(a.x,z.x)&&box.left<right&&box.bottom>Math.min(a.y,z.y)&&box.top<bottom);
    const clear=(x1,y1,x2,y2)=>!obstacles.some(box=>Math.max(x1,x2)>box.left&&Math.min(x1,x2)<box.right&&Math.max(y1,y2)>box.top&&Math.min(y1,y2)<box.bottom);
    const candidates=(start,end,side)=>[...new Set([start,...obstacles.map(o=>o[side]).filter(v=>v>start&&v<=end)])].sort((a,b)=>a-b);
    const xs=candidates(minX,right,'right').filter(x=>clear(x,z.y,z.x,z.y));
    for(const y of candidates(minY,bottom,'bottom')){
      if(!clear(a.x,a.y,a.x,y))break;
      for(const x of xs){
        if(!clear(a.x,y,x,y))break;
        if(!clear(x,y,x,z.y))continue;
        return {mode:'route',sourcePort:'south',targetPort:'east',cornerRadius,points:[{x:a.x,y},{x,y},{x,y:z.y}]};
      }
    }
    return null;
  }
  function structureArrowLine(e,s,t){
    if(![s,t].every(n=>n.molecule&&n.molecule.display!=='name')||e.sourcePort!=='auto'||e.targetPort!=='auto'||
       !(e.mode==='straight'||e.mode==='curve'&&!e.c1&&!e.c2))return null;
    const box=n=>n.structureHighlight?moleculeBackdrop(n):moleculeGraphicBounds(n);
    const source=box(s),target=box(t);
    const verticalBounds=(n,b)=>{
      if(n.molecule.display!=='both'||!n.label||n.structureHighlight)return b;
      const label=moleculeLabelPosition(n),{h}=bounds({...n,molecule:null,shape:'none'});
      return {...b,bottom:Math.max(b.bottom,label.y+h/2)};
    };
    function aligned(start,end,low,high,axis,sign){
      const gap=(end-start)*sign;
      if(gap<=0||low>high)return null;
      const clearance=Math.min(Math.max(8,e.width+4),gap/4),center=(low+high)/2;
      return axis==='x'?[{x:start+sign*clearance,y:center},{x:end-sign*clearance,y:center}]
        :[{x:center,y:start+sign*clearance},{x:center,y:end-sign*clearance}];
    }
    const xDirection=s.x<=t.x?1:-1;
    const across=aligned(xDirection>0?source.right:source.left,xDirection>0?target.left:target.right,
      Math.max(source.top,target.top),Math.min(source.bottom,target.bottom),'x',xDirection);
    if(across)return across;
    const [a,z]=[verticalBounds(s,source),verticalBounds(t,target)],yDirection=s.y<=t.y?1:-1;
    return aligned(yDirection>0?a.bottom:a.top,yDirection>0?z.top:z.bottom,
      Math.max(a.left,z.left),Math.min(a.right,z.right),'y',yDirection);
  }
  function geometry(e,b) {
    const free=isFreeArrow(e),[s,t]=edgeEndpoints(e,b);if(!s||!t)return null;
    const pair=!free&&structureArrowLine(e,s,t);
    if(pair){
      const [a,z]=pair,c1=mix(a,z,.32),c2=mix(a,z,.68),at=u=>mix(a,z,u);
      const handles=e.mode==='curve'?[{...c1,type:'c1'},{...c2,type:'c2'}]:[];
      const path=e.mode==='curve'?`M${fmt(a)} C${fmt(c1)} ${fmt(c2)} ${fmt(z)}`:`M${fmt(a)} L${fmt(z)}`;
      return {a,z,c1,c2,path,at,mid:at(.5),handles};
    }
    const dx=t.x-s.x,dy=t.y-s.y,d=Math.hypot(dx,dy)||1;
    const toward={x:(s.x+t.x)/2-dy/d*e.bulge,y:(s.y+t.y)/2+dx/d*e.bulge};
    let default1=Math.abs(dx)>Math.abs(dy)?{x:s.x+dx*.35,y:s.y}:{x:s.x,y:s.y+dy*.35};
    let default2=Math.abs(dx)>Math.abs(dy)?{x:t.x-dx*.35,y:t.y}:{x:t.x,y:t.y-dy*.35};
    const directions={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]},reach=Math.max(60,d*.35);
    if(directions[e.sourcePort]){const [x,y]=directions[e.sourcePort];default1={x:s.x+x*reach,y:s.y+y*reach};}
    if(directions[e.targetPort]){const [x,y]=directions[e.targetPort];default2={x:t.x+x*reach,y:t.y+y*reach};}
    const c1=e.c1?{x:s.x+e.c1.x,y:s.y+e.c1.y}:default1,c2=e.c2?{x:t.x+e.c2.x,y:t.y+e.c2.y}:default2;
    let a=free?s:anchor(s,e.mode==='curve'?c1:e.mode==='arc'?toward:e.mode==='route'&&e.points.length?e.points[0]:t,e.sourcePort);
    let z=free?t:anchor(t,e.mode==='curve'?c2:e.mode==='arc'?toward:e.mode==='route'&&e.points.length?e.points.at(-1):s,e.targetPort);
    let path,at,circleCenter=null,handles=[];
    if(e.mode==='curve') {
      // Trim the actual curve, including any return through the source label.
      // Ray-based anchors can leave a looping curve crossing a moved name.
      const rawA=e.sourcePort==='auto'?s:a,rawZ=e.targetPort==='auto'?t:z;
      const rawAt=u=>({x:(1-u)**3*rawA.x+3*(1-u)**2*u*c1.x+3*(1-u)*u*u*c2.x+u**3*rawZ.x,y:(1-u)**3*rawA.y+3*(1-u)**2*u*c1.y+3*(1-u)*u*u*c2.y+u**3*rawZ.y});
      const derivative=u=>({x:3*(1-u)**2*(c1.x-rawA.x)+6*(1-u)*u*(c2.x-c1.x)+3*u*u*(rawZ.x-c2.x),y:3*(1-u)**2*(c1.y-rawA.y)+6*(1-u)*u*(c2.y-c1.y)+3*u*u*(rawZ.y-c2.y)});
      const inside=(p,n)=>{const q=bounds(n),pad=nodePadding(n);return Math.abs(p.x-n.x)<q.w/2+pad&&Math.abs(p.y-n.y)<q.h/2+pad;};
      function exitTime(n,reverse){
        const sample=u=>rawAt(reverse?1-u:u);
        const visible=n.molecule&&(n.molecule.display!=='name'||n.structureHighlight)?lastContact(sample,moleculeObstacle(n)):null;
        return visible??lastContact(sample,p=>inside(p,n))??0;
      }
      let start=!free&&e.sourcePort==='auto'?exitTime(s,false):0,end=!free&&e.targetPort==='auto'?1-exitTime(t,true):1;
      if(start>=end){start=0;end=1;}
      a=rawAt(start);z=rawAt(end);const d1=derivative(start),d2=derivative(end),span=(end-start)/3,q1={x:a.x+span*d1.x,y:a.y+span*d1.y},q2={x:z.x-span*d2.x,y:z.y-span*d2.y};
      path=`M${fmt(a)} C${fmt(q1)} ${fmt(q2)} ${fmt(z)}`;
      at=u=>rawAt(start+(end-start)*u);
      handles=[{...c1,type:'c1'},{...c2,type:'c2'}];
    } else if(e.mode==='arc'&&Math.abs(e.bulge)>1e-6) {
      // Construct the circle through node centers FIRST, then trim it at node
      // boundaries. Rebuilding a circle after trimming produces scalloped loops.
      const rawA=e.sourcePort==='auto'?{x:s.x,y:s.y}:a,rawZ=e.targetPort==='auto'?{x:t.x,y:t.y}:z;
      const dd=Math.hypot(rawZ.x-rawA.x,rawZ.y-rawA.y)||1,nx=-(rawZ.y-rawA.y)/dd,ny=(rawZ.x-rawA.x)/dd,h=e.bulge,m=mix(rawA,rawZ,.5),off=h/2-dd*dd/(8*h);
      const center={x:m.x+nx*off,y:m.y+ny*off},mid={x:m.x+nx*h,y:m.y+ny*h};
      circleCenter=center;
      const radius=Math.hypot(rawA.x-center.x,rawA.y-center.y);
      const ta=Math.atan2(rawA.y-center.y,rawA.x-center.x),tz=Math.atan2(rawZ.y-center.y,rawZ.x-center.x),tm=Math.atan2(mid.y-center.y,mid.x-center.x),tau=2*Math.PI,norm=x=>(x%tau+tau)%tau;
      let da=norm(tz-ta);if(norm(tm-ta)>da)da-=tau;
      const rawAt=t=>({x:center.x+radius*Math.cos(ta+da*t),y:center.y+radius*Math.sin(ta+da*t)});
      const inside=(p,n)=>{const box=bounds(n),pad=nodePadding(n);return Math.abs(p.x-n.x)<box.w/2+pad&&Math.abs(p.y-n.y)<box.h/2+pad;};
      function trim(n,reverse){
        const sample=u=>rawAt(reverse?1-u:u);
        if(n.molecule&&(n.molecule.display!=='name'||n.structureHighlight)){
          const contact=lastContact(u=>sample(.49*u),moleculeObstacle(n));
          if(contact!==null)return .49*contact;
        }
        let lo=0,hi=.49;
        for(let j=0;j<24;j++){const q=(lo+hi)/2;if(inside(sample(q),n))lo=q;else hi=q;}
        return hi;
      }
      const start=!free&&e.sourcePort==='auto'?trim(s,false):0,end=!free&&e.targetPort==='auto'?1-trim(t,true):1;
      a=rawAt(start);z=rawAt(end);
      path=`M${fmt(a)} A${radius},${radius} 0 ${Math.abs(da*(end-start))>Math.PI?1:0} ${da>0?1:0} ${fmt(z)}`;
      at=t=>rawAt(start+(end-start)*t);handles=[{...mid,type:'arc'}];
    } else if(e.mode==='route'&&e.points.length) {
      const pts=[a,...e.points,z];path=roundedPath(pts,e.cornerRadius??24);
      const samples=[a];
      for(let i=1;i<pts.length-1;i++){const prev=pts[i-1],cur=pts[i],next=pts[i+1],l1=Math.hypot(prev.x-cur.x,prev.y-cur.y),l2=Math.hypot(next.x-cur.x,next.y-cur.y),r=Math.min(e.cornerRadius??24,l1/2,l2/2),p=mix(cur,prev,l1?r/l1:0),q=mix(cur,next,l2?r/l2:0);samples.push(p);for(let j=1;j<=24;j++){const t=j/24;samples.push({x:(1-t)**2*p.x+2*(1-t)*t*cur.x+t*t*q.x,y:(1-t)**2*p.y+2*(1-t)*t*cur.y+t*t*q.y});}}
      samples.push(z);const lengths=samples.slice(1).map((p,i)=>Math.hypot(p.x-samples[i].x,p.y-samples[i].y)),total=lengths.reduce((a,b)=>a+b,0);
      at=t=>{let dist=t*total;for(let i=0;i<lengths.length;i++){if(dist<=lengths[i])return mix(samples[i],samples[i+1],lengths[i]?dist/lengths[i]:0);dist-=lengths[i];}return z;};
      handles=e.points.map((p,i)=>({...p,type:'point',index:i}));
    } else {path=`M${fmt(a)} L${fmt(z)}`;at=t=>mix(a,z,t);if(e.mode==='arc')handles=[{...mix(a,z,.5),type:'arc'}];}
    return {a,z,c1,c2,path,at,mid:at(.5),handles,circleCenter};
  }
  function cofactorGeometry(e,g,c) {
    const p=g.at(clamp(c.t??.5,.05,.95)); const side=c.side??1;
    // Offsets are attached to the reaction, so branches follow its geometry.
    const x=p.x+(c.dx??-65),y=p.y+(c.dy??0),spread=c.spread??40;
    if(c.style==='compact'){
      const sign=c.orientation==='left'?-1:1,input={x:x-sign*spread,y},output={x:x+sign*spread,y},gap=8;
      const inputLabel={x:input.x-sign*gap+(c.inputLabelDx||0),y:y+(c.inputLabelDy||0),anchor:sign>0?'end':'start'},outputLabel={x:output.x+sign*gap+(c.outputLabelDx||0),y:y+(c.outputLabelDy||0),anchor:sign>0?'start':'end'};
      return {p,x,y,side,spread,input,output,outputControl:{x,y},labelOffset:{x:0,y:0,anchor:'middle'},inputLabel,outputLabel,path:`M${fmt(input)} L${fmt(output)}`,connector:`M${x},${y} L${fmt(p)}`};
    }
    let vx=0,vy=1;
    if(c.orientation==='auto'){const a=g.at(clamp((c.t??.5)-.01,0,1)),z=g.at(clamp((c.t??.5)+.01,0,1)),d=Math.hypot(z.x-a.x,z.y-a.y)||1;vx=(z.x-a.x)/d;vy=(z.y-a.y)/d;}
    if(c.orientation==='up')vy=-1;if(c.orientation==='right'){vx=1;vy=0;}if(c.orientation==='left'){vx=-1;vy=0;}
    // One shallow quadratic replaces the two tight turns at the reaction.
    // Its midpoint remains exactly on the main reaction attachment point.
    const input={x:x-vx*spread,y:y-vy*spread},output={x:x+vx*spread,y:y+vy*spread},control={x:2*p.x-x,y:2*p.y-y};
    const horizontalOffset=Math.abs(x-p.x)>=Math.abs(y-p.y),sign=horizontalOffset?Math.sign(x-p.x)||-side:Math.sign(y-p.y)||-1;
    const labelGap=c.labelGap??13;
    const labelOffset=horizontalOffset?{x:sign*labelGap,y:0,anchor:sign>0?'start':'end'}:{x:0,y:sign*(labelGap+3),anchor:'middle'};
    return {p,x,y,side,spread,input,output,outputControl:control,labelOffset,inputLabel:{x:input.x+labelOffset.x+(c.inputLabelDx||0),y:input.y+labelOffset.y+(c.inputLabelDy||0),anchor:labelOffset.anchor},outputLabel:{x:output.x+labelOffset.x+(c.outputLabelDx||0),y:output.y+labelOffset.y+(c.outputLabelDy||0),anchor:labelOffset.anchor},path:`M${fmt(input)} Q${fmt(control)} ${fmt(output)}`};
  }
  function cofactorLabelBackdrop(edge,cofactor,endpoint,point,hitArea=false){
    const label=cofactor[endpoint];
    if(!label.trim()||(!hitArea&&!cofactor[endpoint+'Highlight']))return '';
    const style=cofactorTextStyle(edge,cofactor,endpoint);
    const {w,h}=bounds({kind:'text',shape:'none',label,...style});
    const padX=clamp(style.fontSize*.22,3,6),padY=clamp(style.fontSize*.12,2,4);
    const alignedX=point.x-(point.anchor==='end'?w:point.anchor==='middle'?w/2:0);
    const appearance=hitArea
      ?'data-cofactor-label-hit="'+endpoint+'" fill="transparent" cursor="move"'
      :'data-role="cofactor-highlight" fill="#e1efff" stroke="#a0bad8" stroke-width="0.8" pointer-events="none"';
    return '<rect '+appearance+' x="'+(alignedX-padX)+'" y="'+(point.y-h/2-padY)+
      '" width="'+(w+2*padX)+'" height="'+(h+2*padY)+'" rx="4"/>';
  }
  function renderCofactorHighlights(edge,board){
    const highlighted=edge.cofactors.filter(c=>c.inputHighlight||c.outputHighlight);
    if(!highlighted.length)return '';
    const g=geometry(edge,board);
    if(!g)return '';
    return highlighted.map(c=>{
      const {inputLabel,outputLabel}=cofactorGeometry(edge,g,c);
      return cofactorLabelBackdrop(edge,c,'input',inputLabel)+cofactorLabelBackdrop(edge,c,'output',outputLabel);
    }).join('');
  }
  function arrowhead(tip,from,size) {
    const d=Math.hypot(tip.x-from.x,tip.y-from.y)||1,ux=(tip.x-from.x)/d,uy=(tip.y-from.y)/d;
    return `M${fmt(tip)} L${fmt({x:tip.x-ux*size-uy*size*.42,y:tip.y-uy*size+ux*size*.42})} L${fmt({x:tip.x-ux*size+uy*size*.42,y:tip.y-uy*size-ux*size*.42})} Z`;
  }
  function effectiveArrowSize(e,base,points){let length=0;for(let i=1;i<points.length;i++)length+=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);const requested=base*e.width/1.8,limit=length*.45;return Math.max(e.width*2,requested<=limit?requested:limit+(requested-limit)*.2);}
  function arrowShaftMask(id,points,tips,size){const pad=size+4,x=Math.min(...points.map(p=>p.x))-pad,y=Math.min(...points.map(p=>p.y))-pad,w=Math.max(...points.map(p=>p.x))-x+pad,h=Math.max(...points.map(p=>p.y))-y+pad;return `<mask id="${esc(id)}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>${tips.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="${size*.62}" fill="black"/>`).join('')}</mask>`;}
  function layoutCofactor(b,e,c,allowReflow=true) {
    const g=geometry(e,b);if(!g||isFreeArrow(e))return {clear:false,collisions:1};
    const textBox=(label,p,size)=>{const text=String(label).replace(/[_^]\{([^{}]*)\}/g,'$1'),w=Array.from(text).reduce((sum,ch)=>sum+(/[^\x00-\x7F]/.test(ch)?1:.62),0)*size+6,h=size*1.5;return{x:p.anchor==='start'?p.x:p.anchor==='end'?p.x-w:p.x-w/2,y:p.y-h/2,w,h};};
    const pairBoxes=(edge,cf,q)=>[textBox(cf.input,q.inputLabel,cofactorTextStyle(edge,cf,'input').fontSize),textBox(cf.output,q.outputLabel,cofactorTextStyle(edge,cf,'output').fontSize)];
    const intersects=(a,z,pad=4)=>a.x<z.x+z.w+pad&&a.x+a.w>z.x-pad&&a.y<z.y+z.h+pad&&a.y+a.h>z.y-pad;
    const inBox=(p,r,pad=3)=>p.x>r.x-pad&&p.x<r.x+r.w+pad&&p.y>r.y-pad&&p.y<r.y+r.h+pad;
    const cross=(a,z,p)=>(z.x-a.x)*(p.y-a.y)-(z.y-a.y)*(p.x-a.x);
    const crosses=(a,z,u,v)=>cross(a,z,u)*cross(a,z,v)<-1e-6&&cross(u,v,a)*cross(u,v,z)<-1e-6;
    const segmentBox=(a,z,r)=>inBox(a,r)||inBox(z,r)||[[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y}],[{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h}],[{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}],[{x:r.x,y:r.y+r.h},{x:r.x,y:r.y}]].some(([u,v])=>crosses(a,z,u,v));
    const source=b.nodes.find(n=>n.id===e.source),target=b.nodes.find(n=>n.id===e.target);
    const containers=b.nodes.filter(n=>n.kind==='module'&&[source,target].every(p=>Math.abs(p.x-n.x)<n.w/2&&Math.abs(p.y-n.y)<n.h/2));
    const regions=[{x:10,y:10,w:b.width-20,h:b.height-20},...containers.map(m=>({x:m.x-m.w/2+16,y:m.y-m.h/2+45,w:m.w-32,h:m.h-61,module:m}))];
    const contained=box=>regions.every(r=>box.x>=r.x&&box.y>=r.y&&box.x+box.w<=r.x+r.w&&box.y+box.h<=r.y+r.h&&(!r.module||r.module.shape!=='circle'||[[box.x,box.y],[box.x+box.w,box.y],[box.x,box.y+box.h],[box.x+box.w,box.y+box.h]].every(([x,y])=>((x-r.module.x)/(r.module.w/2-12))**2+((y-r.module.y)/(r.module.h/2-12))**2<=1)));
    const occupied=[],lines=[];
    for(const n of b.nodes){if(n.kind==='module'){if(n.label)occupied.push(textBox(n.label,{x:n.x-n.w/2+18,y:n.y-n.h/2+23,anchor:'start'},n.fontSize));continue;}const q=bounds(n);occupied.push({x:n.x+(n.labelDx||0)-q.w/2,y:n.y+(n.labelDy||0)-q.h/2,w:q.w,h:q.h});}
    for(const edge of b.edges){const path=geometry(edge,b);if(!path)continue;if(edge.label){
        occupied.push(textBox(edge.label,edgeLabelGeometry(edge,path),edge.fontSize));
      }
      if(edge.knockout){const label=knockoutTextGeometry(edge,path);occupied.push(textBox(edge.knockoutLabel,{...label,anchor:'middle'},label.fontSize));}
      let prev=path.at(0);for(let i=1;i<=40;i++){const next=path.at(i/40);lines.push([prev,next,edge.id===e.id]);prev=next;}
      for(const cf of edge.cofactors)if(cf.id!==c.id){const q=cofactorGeometry(edge,path,cf);occupied.push(...pairBoxes(edge,cf,q));let previous=q.input;for(let i=1;i<=16;i++){const t=i/16,next={x:(1-t)**2*q.input.x+2*(1-t)*t*q.outputControl.x+t*t*q.output.x,y:(1-t)**2*q.input.y+2*(1-t)*t*q.outputControl.y+t*t*q.output.y};lines.push([previous,next,false]);previous=next;}if(q.connector)lines.push([{x:q.x,y:q.y},q.p,false]);}
    }
    const mainPoints=Array.from({length:41},(_,i)=>g.at(i/40));let best=null;
    // Directly connected cofactor bows: keep their midpoint on the reaction,
    // with the same tangent direction and short, consistently placed labels.
    for(const t of [.5,.35,.65,.2,.8]){
      const before=g.at(t-.01),after=g.at(t+.01),length=Math.hypot(after.x-before.x,after.y-before.y)||1,vx=(after.x-before.x)/length,vy=(after.y-before.y)/length;
      for(const spread of [28,24,32,36])for(const depth of [10,14,18])for(const side of [1,-1])for(const shift of [0,-8,8])for(const labelGap of [8,13]){
        const candidate={...c,style:'branch',orientation:'auto',spread,t,dx:-vy*depth*side+vx*shift,dy:vx*depth*side+vy*shift,labelGap},q=cofactorGeometry(e,g,candidate),boxes=pairBoxes(e,candidate,q);
        const pts=Array.from({length:25},(_,i)=>{const v=i/24;return{x:(1-v)**2*q.input.x+2*(1-v)*v*q.outputControl.x+v*v*q.output.x,y:(1-v)**2*q.input.y+2*(1-v)*v*q.outputControl.y+v*v*q.output.y};});
        const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),arrow=c.arrowSize??10,pathBox={x:Math.min(...xs)-arrow/2,y:Math.min(...ys)-arrow/2,w:Math.max(...xs)-Math.min(...xs)+arrow,h:Math.max(...ys)-Math.min(...ys)+arrow};
        if(!contained(pathBox)||!boxes.every(contained)||intersects(boxes[0],boxes[1]))continue;
        if(boxes.some(box=>occupied.some(o=>intersects(box,o))||lines.some(([a,z])=>segmentBox(a,z,box))))continue;
        if(pts.some(p=>occupied.some(box=>inBox(p,box,4))))continue;
        if([q.input,q.output].some(p=>mainPoints.some(point=>Math.hypot(p.x-point.x,p.y-point.y)<9)))continue;
        if(lines.some(([a,z,own])=>pts.slice(1).some((p,i)=>crosses(pts[i],p,a,z)&&(!own||Math.hypot(p.x-q.p.x,p.y-q.p.y)>12))))continue;
        if([[q.input,q.inputLabel],[q.output,q.outputLabel]].some(([start,end])=>occupied.some(box=>segmentBox(start,end,box))))continue;
        const cost=Math.abs(t-.5)*35+Math.abs(spread-28)*.5+Math.abs(depth-12)+Math.abs(shift)*.6+Math.abs(labelGap-10)*.4;
        if(!best||cost<best.cost)best={candidate,cost};
      }
    }
    if(best){Object.assign(c,best.candidate);return {clear:true,collisions:0,style:'branch'};}
    if(allowReflow){
      const ids=new Set([e.source,e.target]);let changed=true;while(changed){changed=false;for(const edge of b.edges.filter(r=>r.mode==='arc'))if(ids.has(edge.source)||ids.has(edge.target))for(const id of [edge.source,edge.target])if(!ids.has(id)){ids.add(id);changed=true;}}
      const ring=b.nodes.filter(n=>ids.has(n.id)),edges=b.edges.filter(r=>r.mode==='arc'&&ids.has(r.source)&&ids.has(r.target));
      if(ring.length>=3&&edges.length===ring.length&&ring.every(n=>edges.filter(r=>r.source===n.id).length===1&&edges.filter(r=>r.target===n.id).length===1)){
        const [a,z,p]=ring,d=2*(a.x*(z.y-p.y)+z.x*(p.y-a.y)+p.x*(a.y-z.y));
        if(Math.abs(d)>1e-6){const aa=a.x*a.x+a.y*a.y,zz=z.x*z.x+z.y*z.y,pp=p.x*p.x+p.y*p.y,cx=(aa*(z.y-p.y)+zz*(p.y-a.y)+pp*(a.y-z.y))/d,cy=(aa*(p.x-z.x)+zz*(a.x-p.x)+pp*(z.x-a.x))/d,r=Math.hypot(a.x-cx,a.y-cy);
          if(ring.every(n=>Math.abs(Math.hypot(n.x-cx,n.y-cy)-r)<.01)){
            const order=[source];while(order.length<ring.length)order.push(ring.find(n=>n.id===edges.find(edge=>edge.source===order.at(-1).id).target));
            const sign=(order[0].x-cx)*(order[1].y-cy)-(order[0].y-cy)*(order[1].x-cx)>0?1:-1,tau=2*Math.PI,norm=x=>(x%tau+tau)%tau,angles=order.map(n=>Math.atan2(n.y-cy,n.x-cx)),gaps=angles.map((angle,i)=>norm(sign*(angles[(i+1)%angles.length]-angle))),middle=angles[0]+sign*gaps[0]/2;
            for(const extra of [Math.PI/12,Math.PI/6]){
              const gap=gaps[0]+extra;if(gap>Math.PI/2)continue;
              const trial=clone(b),tnodes=order.map(n=>trial.nodes.find(p=>p.id===n.id));let angle=middle-sign*gap/2;
              tnodes.forEach((n,i)=>{n.x=cx+r*Math.cos(angle);n.y=cy+r*Math.sin(angle);angle+=sign*(i===0?gap:gaps[i]*(tau-gap)/(tau-gaps[0]));});
              if(!tnodes.every(n=>{const q=bounds(n);return contained({x:n.x-q.w/2,y:n.y-q.h/2,w:q.w,h:q.h})&&!b.nodes.filter(p=>!ids.has(p.id)&&p.kind!=='module').some(p=>{const z=bounds(p);return intersects({x:n.x-q.w/2,y:n.y-q.h/2,w:q.w,h:q.h},{x:p.x-z.w/2,y:p.y-z.h/2,w:z.w,h:z.h});});}))continue;
              routeCircularEdges(trial,tnodes,cx,cy,r);
              const te=trial.edges.find(edge=>edge.id===e.id),tc=te.cofactors.find(cf=>cf.id===c.id);if(tc)Object.assign(tc,c);else te.cofactors.push({...c});const targetCf=te.cofactors.find(cf=>cf.id===c.id);
              const result=layoutCofactor(trial,te,targetCf,false);if(!result.clear)continue;
              let valid=true;for(const edge of trial.edges.filter(r=>edges.some(old=>old.id===r.id)))for(const cf of edge.cofactors)if(cf.id!==c.id&&!layoutCofactor(trial,edge,cf,false).clear)valid=false;
              if(!valid)continue;
              for(const n of ring)Object.assign(n,trial.nodes.find(p=>p.id===n.id));
              for(const edge of edges){const next=trial.edges.find(r=>r.id===edge.id);edge.bulge=next.bulge;edge.labelDx=next.labelDx;edge.labelDy=next.labelDy;edge.sourcePort=next.sourcePort;edge.targetPort=next.targetPort;for(const cf of edge.cofactors)Object.assign(cf,next.cofactors.find(p=>p.id===cf.id));}
              Object.assign(c,targetCf);return {clear:true,collisions:0,style:'branch',reflowed:true};
            }
          }
        }
      }
    }
    return {clear:false,collisions:1,unchanged:true};
  }
  function fitNewCofactor(b,e,c){
    const result=layoutCofactor(b,e,c);
    if(result.clear||isFreeArrow(e)||!['straight','curve'].includes(e.mode))return result;

    const [source,target]=edgeEndpoints(e,b);
    if(!source||!target)return result;
    const dx=target.x-source.x,dy=target.y-source.y,distance=Math.hypot(dx,dy);
    if(distance<.01)return result;
    const g=geometry(e,b);
    let visible=0;
    for(let i=1;i<=16;i++){
      const a=g.at((i-1)/16),z=g.at(i/16);
      visible+=Math.hypot(z.x-a.x,z.y-a.y);
    }
    const room=2*24+2*Math.max(cofactorTextStyle(e,c,'input').fontSize,cofactorTextStyle(e,c,'output').fontSize)+12;
    if(visible>=room)return result;

    // Keep a closed pathway intact, even when it was drawn with straight edges.
    const reached=new Set([source.id]);
    const neighbors=new Map();
    for(const edge of b.edges){
      if(edge.id===e.id||isFreeArrow(edge))continue;
      for(const [from,to] of [[edge.source,edge.target],[edge.target,edge.source]]){
        if(!neighbors.has(from))neighbors.set(from,[]);
        neighbors.get(from).push(to);
      }
    }
    for(const id of reached){
      if(id===target.id)return result;
      for(const neighbor of neighbors.get(id)||[])reached.add(neighbor);
    }

    const box=n=>{
      const {w,h}=bounds(n);
      return {left:n.x-w/2,top:n.y-h/2,right:n.x+w/2,bottom:n.y+h/2};
    };
    const overlaps=(a,z,pad=0)=>a.left<z.right+pad&&a.right>z.left-pad&&a.top<z.bottom+pad&&a.bottom>z.top-pad;
    const obstacles=b.nodes.filter(n=>n!==source&&n!==target&&n.kind!=='module').map(box);
    const compartments=b.nodes.filter(n=>n.kind==='module');
    function fits(original,moved){
      const a=box(moved);
      if(a.left<10||a.top<10||a.right>b.width-10||a.bottom>b.height-10)return false;
      if(obstacles.some(o=>overlaps(a,o,8)))return false;
      return compartments.every(m=>{
        const q=box(m);
        const inside=(x,y)=>m.shape==='circle'
          ? ((x-m.x)/(m.w/2))**2+((y-m.y)/(m.h/2))**2<=1
          : x>=q.left&&x<=q.right&&y>=q.top&&y<=q.bottom;
        if(!inside(original.x,original.y))return !overlaps(a,q)||overlaps(box(original),q);
        if(a.left<q.left+12||a.right>q.right-12||a.top<q.top+40||a.bottom>q.bottom-12)return false;
        return [[a.left,a.top],[a.left,a.bottom],[a.right,a.top],[a.right,a.bottom]].every(([x,y])=>inside(x,y));
      });
    }
    const move=(n,amount)=>amount?{...n,x:n.x+dx/distance*amount,y:n.y+dy/distance*amount}:n;
    const firstExtra=Math.max(12,room-visible);
    for(const additional of [0,16,32,56,84]){
      const extra=Math.min(160,firstExtra+additional);
      for(const fraction of [.5,0,1]){
        if((source.groupId&&fraction>0)||(target.groupId&&fraction<1))continue;
        const s=move(source,-extra*fraction),t=move(target,extra*(1-fraction));
        if((s!==source&&!fits(source,s))||(t!==target&&!fits(target,t))||overlaps(box(s),box(t),8))continue;
        const trial={...b,nodes:b.nodes.map(n=>n===source?s:n===target?t:n)};
        const path=geometry(e,trial);
        if(Array.from({length:33},(_,i)=>path.at(i/32)).some(p=>obstacles.some(o=>p.x>o.left&&p.x<o.right&&p.y>o.top&&p.y<o.bottom)))continue;
        const candidate={...c},fit=layoutCofactor(trial,e,candidate,false);
        if(!fit.clear)continue;
        Object.assign(source,{x:s.x,y:s.y});
        Object.assign(target,{x:t.x,y:t.y});
        Object.assign(c,candidate);
        return {...fit,spaced:true};
      }
    }
    return result;
  }
  function arrangeCircle(b,nodes,cx,cy,r,start=-Math.PI/2,clockwise=true) {
    const ids=new Set(nodes.map(n=>n.id));
    nodes.forEach((n,i)=>{const angle=start+(clockwise?1:-1)*i*2*Math.PI/nodes.length;n.x=cx+r*Math.cos(angle);n.y=cy+r*Math.sin(angle);if(!n.molecule)n.shape='none';n.labelDx=0;n.labelDy=0;n.labelAnchor='middle';});
    routeCircularEdges(b,nodes,cx,cy,r);
  }
  function routeCircularEdges(b,nodes,cx,cy,r){
    const ids=new Set(nodes.map(n=>n.id));
    for(const e of b.edges)if(ids.has(e.source)&&ids.has(e.target)){
      const s=nodes.find(n=>n.id===e.source),t=nodes.find(n=>n.id===e.target),dx=t.x-s.x,dy=t.y-s.y,chord=Math.hypot(dx,dy),dot=(cx-(s.x+t.x)/2)*(-dy)+(cy-(s.y+t.y)/2)*dx;
      e.mode='arc';e.bulge=-(Math.sign(dot)||1)*(r-Math.sqrt(Math.max(0,r*r-chord*chord/4)));e.sourcePort=e.targetPort='auto';delete e.c1;delete e.c2;
      const g=geometry(e,b),nx=(cx-g.mid.x)/r,ny=(cy-g.mid.y)/r;
      const halfW=Math.max(8,e.label.length*e.fontSize*.285),halfH=e.fontSize*.6;
      // A fixed visual gap keeps the enzyme beside its reaction, regardless
      // of circle radius. Try the outside only if an inside label hits a node.
      const distance=Math.abs(nx)*halfW+Math.abs(ny)*halfH+6;
      const blocked=(x,y)=>nodes.some(n=>{const q=bounds(n);return Math.abs(x-n.x)<halfW+q.w/2+4&&Math.abs(y-n.y)<halfH+q.h/2+4;});
      const side=blocked(g.mid.x+nx*distance,g.mid.y+ny*distance)?-1:1;
      e.labelDx=side*nx*distance;e.labelDy=side*ny*distance;
    }
  }
  const TCA_ROWS=[['Citrate','Acn'],['Isocitrate','Icd'],['α-KG','Odh'],['Succinyl-CoA','SucCD'],['Succinate','Sdh'],['Fumarate','Fum'],['Malate','Mdh'],['OAA','GltA']];
  function parseCycleRows(value) {
    const rows=String(value).split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map((line,i)=>{const parts=line.split(/[|｜]/).map(s=>s.trim());if(parts.length>2||!parts[0]||parts.some(s=>s.length>120))throw new Error(`第 ${i+1} 行请填写“化合物 | 酶名”，每项最多 120 字。`);return [parts[0],parts[1]||''];});
    if(rows.length<3||rows.length>32)throw new Error('环形途径需要 3–32 个化合物，每个化合物写一行。');return rows;
  }
  function buildCycle(rows,options={}) {
    rows=parseCycleRows(rows.map(row=>row.join(' | ')).join('\n'));
    const radius=Number(options.radius??180),fontSize=Number(options.fontSize??17);
    if(!Number.isFinite(radius)||radius<60||radius>2000||!Number.isFinite(fontSize)||fontSize<10||fontSize>40)throw new Error('半径应为 60–2000，字号应为 10–40。');
    const b=board('环形途径'),groupId=uid('g');
    b.nodes=rows.map(([label])=>({...node('metabolite',0,0,label),fontSize,groupId}));
    b.edges=rows.map(([,label],i)=>({...edge(b.nodes[i].id,b.nodes[(i+1)%rows.length].id),label,fontSize:Math.max(12,fontSize-2),width:2,arrowSize:11,groupId}));
    arrangeCircle(b,b.nodes,0,0,radius,-Math.PI/2,options.clockwise!==false);
    if(options.cofactors&&JSON.stringify(rows)===JSON.stringify(TCA_ROWS))addTcaCofactors(b,b.nodes.map(n=>n.id));
    if(String(options.title||'').trim())b.nodes.push({...node('text',0,0,String(options.title).trim().slice(0,80)),fontSize:fontSize+9,bold:true,color:'#4a7363',groupId});
    // Fit the complete figure, including labels and optional cofactor pairs.
    let minX=-radius,minY=-radius,maxX=radius,maxY=radius;
    const include=(x,y,w,h)=>{minX=Math.min(minX,x-w/2);maxX=Math.max(maxX,x+w/2);minY=Math.min(minY,y-h/2);maxY=Math.max(maxY,y+h/2);};
    for(const n of b.nodes){const q=bounds(n);include(n.x,n.y,q.w,q.h);}
    for(const e of b.edges){const g=geometry(e,b);include(g.mid.x+e.labelDx,g.mid.y+e.labelDy,e.label.length*e.fontSize*.65,e.fontSize*1.4);for(const c of e.cofactors){const q=cofactorGeometry(e,g,c),size=c.fontSize??13;for(const [label,p] of [[c.input,q.inputLabel],[c.output,q.outputLabel]]){const w=label.length*size*.65,x=p.x+(p.anchor==='start'?w/2:p.anchor==='end'?-w/2:0);include(x,p.y,w,size*1.5);}}}
    return {nodes:b.nodes,edges:b.edges,bounds:{x:minX-20,y:minY-20,w:maxX-minX+40,h:maxY-minY+40},radius};
  }
  function addTcaCofactors(b,ids) {
    const centerX=ids.reduce((sum,id)=>sum+b.nodes.find(n=>n.id===id).x,0)/ids.length;
    for(const [i,input,output,offset] of [[1,'NAD(P)^{+}','NAD(P)H',12],[2,'NAD^{+}','NADH',12],[6,'NAD^{+}','NADH',-12]]){
      const e=b.edges.find(e=>e.source===ids[i]&&e.target===ids[(i+1)%ids.length]),dx=(Math.sign(geometry(e,b).mid.x-centerX)||Math.sign(offset))*12;e.cofactors.push({id:uid('cf'),input,output,dx,dy:0,side:dx>0?-1:1,spread:28,t:.5,orientation:'auto',fontSize:13,arrowSize:10});
    }
  }
  function defs(prefix='') {
    return `<defs><marker id="${prefix}arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L10 5 L0 10 L3 5Z" fill="context-stroke"/></marker></defs>`;
  }
  function renderIllustration(n){
    const stroke=esc(n.stroke),fill=esc(n.fill),outline=`fill="${fill}" stroke="${stroke}" stroke-width="2" vector-effect="non-scaling-stroke"`,line=`fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linecap="round" vector-effect="non-scaling-stroke"`;let shape='';
    let sx=n.w/160,sy=n.h/100;
    if(n.template==='channel'){
      sx=sy=channelScale(n);
      if(!n.standalone){
        const last=n.w/(2*sx)-7,count=Math.min(300,Math.round((last-37)/12)+1);
        for(let i=0;i<count;i++)for(const sign of [-1,1])for(const side of [-1,1]){
          const x=sign*(37+i*(last-37)/(count-1)),y=side*18;
          shape+=`<circle cx="${x}" cy="${y}" r="4.1" fill="#e9f1f9" stroke="#9fb3c7" stroke-width="1"/><path d="M${x-1.6} ${y-side*3.8} l-1.1 ${-side*10} M${x+1.6} ${y-side*3.8} l1.1 ${-side*10}" fill="none" stroke="#9fb3c7" stroke-width="1" stroke-linecap="round"/>`;
        }
      }
      const subunit=`<path d="M-15 -43 C-29 -45 -34 -34 -32 -21 C-30 -11 -35 3 -32 14 C-29 23 -34 35 -24 41 C-18 45 -11 43 -8 38 C-5 32 -11 24 -10 16 C-9 7 -5 4 -5 -3 C-5 -13 -13 -18 -12 -27 C-12 -34 -7 -40 -15 -43Z" ${outline}/><path d="M-24 -34 C-28 -25 -20 -18 -22 -7 S-24 10 -21 19 M-22 24 Q-19 32 -22 36" ${line} opacity=".55"/>`;
      shape+=`<g data-role="channel-protein">${subunit}<g transform="scale(-1 1)">${subunit}</g></g>`;
    }
    if(n.template==='mitochondrion')shape=`<ellipse rx="77" ry="44" ${outline}/><ellipse rx="68" ry="35" ${line}/><path d="M-55 -14 C-40 -33 -30 -24 -32 -6 S-17 21 -13 0 S6 -31 10 -10 S17 25 26 5 S39 -24 48 -8 S49 20 58 14" ${line}/>`;
    if(n.template==='chloroplast'){shape=`<ellipse rx="77" ry="44" ${outline}/><ellipse rx="68" ry="35" ${line}/>`;for(const x of [-40,0,40])for(const y of [-12,-5,2,9])shape+=`<rect x="${x-12}" y="${y}" width="24" height="5" rx="3" fill="${stroke}" fill-opacity=".35" stroke="${stroke}" stroke-width=".7"/>`;shape+=`<path d="M-28 2 H-12 M12 2 H28" ${line}/>`;}
    if(n.template==='nucleus')shape=`<ellipse rx="69" ry="44" ${outline}/><ellipse rx="61" ry="37" ${line}/><ellipse cx="20" cy="6" rx="17" ry="12" fill="${stroke}" fill-opacity=".45"/><path d="M-43 -14 Q-10 -30 1 -12 T32 -20 M-44 15 Q-22 31 -10 10 T-21 -9 M-5 28 Q18 31 39 20" ${line}/>`;
    if(n.template==='vacuole')shape=`<path d="M-68 -20 C-61 -46 -7 -43 30 -35 S77 -11 64 19 S15 45 -24 37 S-79 12 -68 -20Z" ${outline}/><path d="M-53 -18 C-44 -32 -18 -31 -3 -29" stroke="white" stroke-width="4" stroke-linecap="round" fill="none" opacity=".7"/>`;
    const cellWall=(outer,inner)=>`<path data-role="microbe-wall" d="${outer} ${inner}" fill-rule="evenodd" ${outline} />`;
    if(n.template==='rod'){
      const outer='M-38 -31 H38 A31 31 0 0 1 38 31 H-38 A31 31 0 0 1 -38 -31 Z';
      const inner='M-38 -24 H38 A24 24 0 0 1 38 24 H-38 A24 24 0 0 1 -38 -24 Z';
      shape=cellWall(outer,inner);
      shape+=`<path d="M-38 -27.5 H38 M-38 27.5 H38" ${line} opacity=".46"/><path d="M68 5 C76 8 80 5 76 -3 S72 -14 79 -17 M-49 -29 Q-53 -33 -53 -38 M-29 -31 L-32 -42 M-9 -31 L-9 -39 M12 -31 Q13 -36 17 -41 M34 -31 L39 -39 M-45 30 L-49 39 M-20 31 L-22 41 M2 31 L3 40 M30 31 Q32 36 36 40" ${line} />`;
    }
    if(n.template==='coccus'){
      const outer='M-69 0 A69 44 0 1 0 69 0 A69 44 0 1 0 -69 0 Z';
      const inner='M-60 0 A60 36 0 1 0 60 0 A60 36 0 1 0 -60 0 Z';
      shape=cellWall(outer,inner);
      shape+=`<ellipse rx="64.5" ry="40" ${line} opacity=".4"/><path d="M-56 -24 Q-49 -30 -41 -33 M-31 -37 Q-24 -39 -19 -39 M-4 -40 Q4 -40 9 -40 M25 -38 Q32 -37 38 -34 M54 -23 Q58 -20 61 -15 M63 9 Q61 16 57 22 M39 32 Q33 35 26 37 M10 40 Q3 40 -3 40 M-19 38 Q-27 37 -33 35 M-50 28 Q-55 24 -58 20 M-64 7 Q-65 1 -64 -5" ${line} opacity=".68"/>`;
    }
    if(n.template==='yeast'){
      const outer='M-61 4 C-61 -20 -40 -38 -14 -38 C-4 -38 4 -35 12 -31 C14 -43 22 -49 36 -49 C54 -48 65 -38 64 -24 C63 -11 55 -4 43 -1 C46 23 24 45 -8 45 C-39 45 -61 28 -61 4 Z';
      const inner='M-53 4 C-53 -15 -36 -30 -14 -30 C-1 -30 8 -26 16 -20 C22 -20 20 -29 24 -36 C28 -43 39 -43 47 -38 C58 -31 58 -19 48 -12 C42 -8 34 -8 31 -5 C35 2 36 8 35 13 C30 28 13 37 -8 37 C-35 37 -53 22 -53 4 Z';
      shape=cellWall(outer,inner);
      shape+=`<path d="M-57 4 C-58 -17 -38 -34 -14 -34 C-5 -34 4 -32 10 -28 M17 -32 Q22 -45 35 -45 C49 -45 60 -35 60 -25 Q58 -10 43 -5 M39 10 C36 27 17 41 -8 41 C-36 41 -56 26 -57 7" ${line} opacity=".48"/><path d="M13 -28 Q14 -24 17 -23 M37 -7 Q39 -5 40 -2" ${line} />`;
    }
    return `<g transform="translate(${n.x} ${n.y}) rotate(${n.rotation||0}) scale(${sx} ${sy})"><rect x="${-n.w/(2*sx)}" y="${-n.h/(2*sy)}" width="${n.w/sx}" height="${n.h/sy}" fill="transparent"/>${shape}</g>`;
  }
  function moleculeBackdrop(n){
    const box=moleculeGraphicBounds(n),named=n.molecule.display==='both'&&n.label;
    const h=n.fontSize*.6,label=named?moleculeLabelPosition(n):null;
    const labelWidth=named||n.molecule.display==='name'?bounds({...n,molecule:null,shape:'none',label:n.label||'结构式'}).w:0;
    if(n.molecule.display==='name')return {left:n.x-labelWidth/2-7,right:n.x+labelWidth/2+7,top:n.y-h-7,bottom:n.y+h+7};
    const cx=(box.left+box.right)/2;
    return {left:Math.min(box.left,cx-labelWidth/2)-7,right:Math.max(box.right,cx+labelWidth/2)+7,top:box.top-7,bottom:(label?label.y+h:box.bottom)+7};
  }
  function moleculeBondOverrides(m){
    const overrides=new Map();
    if(Object.hasOwn(STRUCTURE_PRESETS,m.stylePreset)){
      (m.bondSites||[]).forEach((bond,index)=>{
        const type=({1:'wedge',6:'hashed'})[bond.stereo];
        if(bond.order===1&&type)overrides.set(index,{index,type});
      });
    }
    for(const style of m.bondStyles||[])overrides.set(style.index,style);
    return overrides;
  }
  function hasHighlight(n){
    return n.molecule?!!n.structureHighlight:n.kind==='metabolite'&&n.shape==='round';
  }
  function renderHighlight(n,interactive=false){
    const role=n.molecule?'structure-highlight':'metabolite-highlight';
    let box;
    if(n.molecule)box=moleculeBackdrop(n);
    else{
      const {w,h}=bounds(n);
      box={left:n.x-w/2,right:n.x+w/2,top:n.y-h/2,bottom:n.y+h/2};
    }
    const {left,right,top,bottom}=box;
    const owner=interactive?'data-highlight-owner="'+esc(n.id)+'"':'';
    return `<rect ${owner} data-role="${role}" x="${left}" y="${top}" width="${right-left}" height="${bottom-top}" rx="9" fill="${n.molecule?'#e1efff':esc(n.fill)}" stroke="${n.molecule?'#a0bad8':esc(n.stroke)}" stroke-width="1"/>`;
  }
  function renderNode(n,interactive=false,defaultBondWidth=1.8,paintHighlight=true,channels=[]) {
    if(n.previewRotation){const p=n.previewPivot||n;return `<g transform="rotate(${n.previewRotation} ${p.x} ${p.y})">${renderNode({...n,previewRotation:0},interactive,defaultBondWidth,paintHighlight)}</g>`;}
    const attrs=interactive?`data-id="${esc(n.id)}"`:'';let body='';const {w,h}=bounds(n);
    if(n.chemicalBond){const x=n.w/2,y=n.h/2,color=esc(n.stroke);let d='';if(n.chemicalBond==='wedge')body=`<path d="M${-x} 0 L${x} ${-y} L${x} ${y}Z" fill="${color}"/>`;if(n.chemicalBond==='hashed'){for(let i=1;i<=9;i++){const t=i/9;d+=`M${-x+n.w*t} ${-y*t}v${n.h*t} `;}body=`<path d="${d}" stroke="${color}" stroke-width="1.8" fill="none"/>`;}if(n.chemicalBond==='dashed')body=`<path d="M${-x} 0H${x}" stroke="${color}" stroke-width="1.8" stroke-dasharray="5 4" fill="none"/>`;if(n.chemicalBond==='wavy'){d=`M${-x} 0`;for(let i=0;i<8;i++){const a=-x+n.w*i/8,b=a+n.w/8;d+=` Q${(a+b)/2} ${i%2?-y:y} ${b} 0`;}body=`<path d="${d}" stroke="${color}" stroke-width="1.8" fill="none"/>`;}return `<g ${attrs} aria-label="${CHEMICAL_BONDS[n.chemicalBond]}" transform="translate(${n.x} ${n.y}) rotate(${n.rotation||0})">${interactive?`<rect x="${-x-4}" y="${-y-5}" width="${n.w+8}" height="${n.h+10}" fill="transparent"/>`:''}${body}</g>`;}
    if(n.molecule){const m=n.molecule,scale=Math.min(n.w/m.width,n.h/m.height),bondWidth=(m.bondWidth??defaultBondWidth)/Math.max(.001,scale),preset=STRUCTURE_PRESETS[m.stylePreset],margin=preset?ptToPx(preset.marginPt)/scale:bondWidth,metrics=preset?{halfWedge:ptToPx(preset.boldPt)/(2*scale),hash:ptToPx(preset.hashPt)/scale}:null,overrides=moleculeBondOverrides(m),hidden=new Set(m.hiddenBonds||[]),glyphs=moleculeGlyphs(n),maskId='atom-gap-'+n.id,p=moleculeLabelPosition(n),caption=m.display==='name'?(n.label||'结构式'):n.label;
      if(n.structureHighlight&&paintHighlight)body+=renderHighlight(n);
      if(m.display!=='name'){body+=`<svg pointer-events="none" x="${n.x-n.w/2}" y="${n.y-n.h/2}" width="${n.w}" height="${n.h}" viewBox="0 0 ${m.width} ${m.height}" preserveAspectRatio="xMidYMid meet" overflow="visible"><defs><mask id="${esc(maskId)}" maskUnits="userSpaceOnUse" x="-1000" y="-1000" width="4000" height="4000"><rect x="-1000" y="-1000" width="4000" height="4000" fill="white"/>${glyphs.map(g=>`<rect x="${g.box.x-margin}" y="${g.box.y-margin}" width="${g.box.w+2*margin}" height="${g.box.h+2*margin}" fill="black"/>`).join('')}</mask></defs><g mask="url(#${esc(maskId)})" pointer-events="visiblePainted">${m.paths.filter(path=>path.atom===undefined&&!hidden.has(path.bond)&&!overrides.has(path.bond)).map(path=>`<path d="${esc(path.d)}" fill="${m.colorMode==='mono'&&path.fill!=='none'?'#202c29':esc(path.fill)}" stroke="${m.colorMode==='mono'&&path.stroke!=='none'?'#202c29':esc(path.stroke)}" stroke-width="${path.width>0?bondWidth:0}" opacity="${path.opacity}" stroke-linecap="${path.cap}" stroke-linejoin="${path.join}" fill-rule="${path.rule}" ${path.dash?`stroke-dasharray="${path.dash}"`:''}/>`).join('')}${[...overrides.values()].filter(s=>!hidden.has(s.index)).map(s=>{const b=m.bondSites[s.index];return bondGlyph(s.type,m.atomSites[b.a],m.atomSites[b.b],bondWidth,metrics);}).join('')}</g>${glyphs.map(g=>`<g ${interactive?`data-chem-glyph="${g.atom}" data-chem-owner="${esc(n.id)}"`:""} pointer-events="visiblePainted" transform="translate(${g.site.x} ${g.site.y}) scale(${g.factor}) translate(${-g.site.x} ${-g.site.y})">${interactive?`<rect data-atom-glyph-hit x="${g.minX-1}" y="${g.minY-1}" width="${g.maxX-g.minX+2}" height="${g.maxY-g.minY+2}" fill="transparent"/>`:""}${g.paths.map(path=>`<path d="${esc(path.d)}" fill="${m.colorMode==='mono'&&path.fill!=='none'?'#202c29':esc(path.fill)}" stroke="${m.colorMode==='mono'&&path.stroke!=='none'?'#202c29':esc(path.stroke)}" stroke-width="0"/>`).join('')}${g.texts.map(t=>`<text x="${t.x}" y="${t.y}" font-size="${t.size}" font-family="${esc(m.atomFontFamily||STRUCTURE_FONT)}" fill="${m.colorMode==='mono'?'#202c29':esc(t.color)}">${esc(t.text)}</text>`).join('')}</g>`).join('')}</svg>`;}
      if(m.display!=='structure'&&caption)body+=textMarkup(caption,p.x,p.y,n.fontSize,n.color,{bold:n.bold,italic:n.italic,fontFamily:n.fontFamily,attrs:interactive?'data-molecule-name="true"':''});
      return `<g ${attrs} role="img" aria-label="${esc(n.label||'分子')}结构式">${body}</g>`;
    }
    if(n.kind==='membrane') {
      const length=n.h,r=Math.min(6,n.w*.125),cx=n.w/2-r,tail=cx-r;
      function lipids(start,end){
        if(end<start)return;
        const segments=Math.max(1,Math.floor((end-start)/11));
        for(let i=0;i<=segments;i++){
          const y=start+i*(end-start)/segments;
          body+=`<circle cx="${-cx}" cy="${y}" r="${r}" fill="${esc(n.fill)}" stroke="${esc(n.stroke)}" stroke-width=".7"/><circle cx="${cx}" cy="${y}" r="${r}" fill="${esc(n.fill)}" stroke="${esc(n.stroke)}" stroke-width=".7"/><path d="M${-tail} ${y-1.5} q${tail/2} -3 ${tail} 0 t${tail} 0 M${-tail} ${y+1.5} q${tail/2} -3 ${tail} 0 t${tail} 0" stroke="${esc(n.stroke)}" stroke-width=".8" fill="none"/>`;
        }
      }
      const gaps=channels.map(c=>({start:c.membraneOffset-channelOpening(c)-r,end:c.membraneOffset+channelOpening(c)+r})).sort((a,b)=>a.start-b.start);
      let start=-length/2;
      for(const gap of gaps){lipids(start,Math.min(length/2,gap.start));start=Math.max(start,gap.end);}
      lipids(start,length/2);
      return `<g ${attrs} transform="translate(${n.x} ${n.y}) rotate(${n.rotation || 0})"><rect x="${-n.w/2-4}" y="${-length/2-5}" width="${n.w+8}" height="${length+10}" fill="transparent"/>${body}</g>`;
    }
    if(n.kind==='illustration'){
      const p=illustrationLabelPosition(n);
      const labelAttrs=interactive&&n.template==='channel'?`data-node-label="${esc(n.id)}" pointer-events="bounding-box" style="cursor:move"`:'';
      return `<g ${attrs}>${renderIllustration(n)}${textMarkup(n.label,p.x,p.y,n.fontSize,n.color,{bold:n.bold,italic:n.italic,fontFamily:n.fontFamily,attrs:labelAttrs})}</g>`;
    }
    if(n.kind==='module') {
      body=n.shape==='circle'?`<ellipse cx="${n.x}" cy="${n.y}" rx="${n.w/2}" ry="${n.h/2}" fill="${esc(n.fill==='none'?'none':n.fill)}" fill-opacity="${n.fill==='none'?0:.25}" stroke="${esc(n.stroke)}" stroke-width="1.4" ${n.dashed?'stroke-dasharray="7 6"':''}/>`:`<rect x="${n.x-n.w/2}" y="${n.y-n.h/2}" width="${n.w}" height="${n.h}" rx="${n.shape==='round'?12:0}" fill="${esc(n.fill)}" fill-opacity=".18" stroke="${esc(n.stroke)}" stroke-width="1.4" ${n.dashed?'stroke-dasharray="7 6"':''}/>`;
      body+=textMarkup(n.label,n.x-n.w/2+18,n.y-n.h/2+23,n.fontSize,n.color,{anchor:'start',bold:n.labelBold??true,fontFamily:n.fontFamily});
    } else {
      if(hasHighlight(n)){if(paintHighlight)body+=renderHighlight(n);}
      else if(n.shape==='round'||n.shape==='rect')body+=`<rect x="${n.x-w/2}" y="${n.y-h/2}" width="${w}" height="${h}" rx="${n.shape==='round'?9:0}" fill="${esc(n.fill)}" stroke="${esc(n.stroke)}" stroke-width="1"/>`;
      if(n.shape==='circle')body+=`<ellipse cx="${n.x}" cy="${n.y}" rx="${w/2}" ry="${h/2}" fill="${esc(n.fill)}" stroke="${esc(n.stroke)}" stroke-width="1"/>`;
      if(n.shape==='point')body+=`<circle cx="${n.x}" cy="${n.y}" r="2.5" fill="${esc(n.color)}"/>`;
      if(interactive&&n.shape==='none')body+=`<rect x="${n.x-w/2}" y="${n.y-h/2}" width="${w}" height="${h}" fill="transparent"/>`;
      body+=textMarkup(n.label,n.x+(n.labelDx||0),n.y+(n.labelDy||0),n.fontSize,n.color,{italic:n.italic,bold:n.bold,fontFamily:n.fontFamily,anchor:n.labelAnchor||'middle',attrs:interactive&&n.shape==='point'?`data-node-label="${esc(n.id)}" style="cursor:move"`:''});
    }
    return `<g ${attrs}>${body}</g>`;
  }
  function renderEdge(e,b,prefix='',interactive=false) {
    const g=geometry(e,b);if(!g)return '';const markerId=prefix+'arrow-'+e.id,marker=`url(#${esc(markerId)})`,points=Array.from({length:33},(_,i)=>g.at(i/32)),size=effectiveArrowSize(e,e.arrowSize??9,points),maskId=prefix+'shaft-'+e.id,tips=e.direction==='both'?[g.a,g.z]:e.direction==='none'?[]:[g.z];
    let body=`<defs><marker id="${esc(markerId)}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="${size}" markerHeight="${size}" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L10 5 L0 10 L3 5Z" fill="${esc(e.color)}"/></marker>${tips.length?arrowShaftMask(maskId,points,tips,size):''}</defs>`;
    if(interactive)body+=`<path d="${g.path}" fill="none" stroke="transparent" stroke-width="16"/>`;
    body+=`<path d="${g.path}" fill="none" stroke="${esc(e.color)}" stroke-width="${e.width}" stroke-linecap="round" stroke-linejoin="round" ${e.dashed?'stroke-dasharray="7 6"':''} ${tips.length?`mask="url(#${esc(maskId)})"`:''}/>`;
    if(tips.length)body+=`<path d="${g.path}" fill="none" stroke="none" marker-end="${marker}" ${e.direction==='both'?`marker-start="${marker}"`:''}/>`;
    const label=edgeLabelGeometry(e,g);
    if(interactive)body+=renderEdgeLabelHitArea(e,label);
    body+=textMarkup(e.label,label.x,label.y,e.fontSize,e.labelColor,{anchor:label.anchor,italic:e.labelItalic,bold:e.labelBold,fontFamily:e.labelFontFamily,attrs:interactive?`data-label="${esc(e.id)}" style="cursor:move"`:''});
    if(e.knockout){const p=knockoutMarkGeometry(e,g),label=knockoutTextGeometry(e,g),d=`M${p.x-9} ${p.y-9} l18 18 m0 -18 l-18 18`;if(interactive)body+=`<path data-knockout-mark="${esc(e.id)}" d="${d}" stroke="transparent" stroke-width="14" fill="none" style="cursor:move"/>`;body+=`<path ${interactive?`data-knockout-mark="${esc(e.id)}" style="cursor:move"`:''} d="${d}" stroke="#c75140" stroke-width="2.5" fill="none"/>`;body+=textMarkup(e.knockoutLabel,label.x,label.y,label.fontSize,label.color,{...label,attrs:interactive?`data-knockout-label="${esc(e.id)}" style="cursor:move"`:''});}
    for(const c of e.cofactors) {const q=cofactorGeometry(e,g,c),inputStyle=cofactorTextStyle(e,c,'input'),outputStyle=cofactorTextStyle(e,c,'output'),samples=Array.from({length:25},(_,i)=>{const t=i/24;return{x:(1-t)**2*q.input.x+2*(1-t)*t*q.outputControl.x+t*t*q.output.x,y:(1-t)**2*q.input.y+2*(1-t)*t*q.outputControl.y+t*t*q.output.y};}),arrow=effectiveArrowSize(e,c.arrowSize??12,samples),cfMask=prefix+'cf-shaft-'+c.id;body+=`<g ${interactive?`data-cofactor="${esc(c.id)}"`:''}><defs>${arrowShaftMask(cfMask,samples,c.direction==='both'?[q.input,q.output]:[q.output],arrow)}</defs>${q.connector?`<path data-role="cofactor-connector" d="${q.connector}" fill="none" stroke="${esc(e.color)}" stroke-opacity=".5" stroke-width="1"/>`:""}${interactive?`<path d="${q.path}" fill="none" stroke="transparent" stroke-width="12"/>`:''}<path d="${q.path}" fill="none" stroke="${esc(e.color)}" stroke-width="${e.width}" mask="url(#${esc(cfMask)})"/><path data-role="cofactor-arrow" d="${arrowhead(q.output,q.outputControl,arrow)}" fill="${esc(e.color)}"/>${c.direction==='both'?`<path data-role="cofactor-arrow-start" d="${arrowhead(q.input,q.outputControl,arrow)}" fill="${esc(e.color)}"/>`:''}${interactive?cofactorLabelBackdrop(e,c,'input',q.inputLabel,true)+cofactorLabelBackdrop(e,c,'output',q.outputLabel,true):''}${textMarkup(c.input,q.inputLabel.x,q.inputLabel.y,inputStyle.fontSize,inputStyle.color,{...inputStyle,anchor:q.inputLabel.anchor,attrs:interactive?'data-cofactor-end="input" style="cursor:move"':''})}${textMarkup(c.output,q.outputLabel.x,q.outputLabel.y,outputStyle.fontSize,outputStyle.color,{...outputStyle,anchor:q.outputLabel.anchor,attrs:interactive?'data-cofactor-end="output" style="cursor:move"':''})}</g>`;}
    return `<g ${interactive?`data-edge-id="${esc(e.id)}"`:''}>${body}</g>`;
  }
  function renderMoleculeHitArea(n){
    const {left,right,top,bottom}=moleculeGraphicBounds(n),pad=5;
    return `<rect data-molecule-hit="${esc(n.id)}" x="${left-pad}" y="${top-pad}" width="${right-left+2*pad}" height="${bottom-top+2*pad}" fill="transparent"/>`;
  }
  function renderBoard(b,prefix='',interactive=false) {
    // Empty space inside a molecule remains selectable below the arrow hit paths.
    const moleculeHitAreas=interactive?b.nodes.filter(n=>n.molecule&&n.molecule.display!=='name').map(renderMoleculeHitArea).join(''):'';
    // A highlight background must never paint over the reaction or its cofactors.
    const highlights=b.nodes.filter(hasHighlight).map(n=>renderHighlight(n,interactive)).join('')+
      b.edges.map(e=>renderCofactorHighlights(e,b)).join('');
    const bondWidth=boardStructureBondWidth(b);
    const channels=new Map();
    for(const n of b.nodes)if(n.membraneId){if(!channels.has(n.membraneId))channels.set(n.membraneId,[]);channels.get(n.membraneId).push(n);}
    return defs(prefix)+b.nodes.filter(n=>n.kind==='module').map(n=>renderNode(n,interactive)).join('')+b.nodes.filter(n=>n.kind==='membrane').map(n=>renderNode(n,interactive,bondWidth,true,channels.get(n.id))).join('')+b.nodes.filter(n=>n.kind==='illustration').map(n=>renderNode(n,interactive)).join('')+moleculeHitAreas+highlights+b.edges.map(e=>renderEdge(e,b,prefix,interactive)).join('')+b.nodes.filter(n=>!['module','membrane','illustration'].includes(n.kind)).map(n=>renderNode(n,interactive,bondWidth,false)).join('');
  }
  function exportSVG(project,boardId=null) {
    setDefaultFont(project.fontFamily);
    const boards=boardId?project.boards.filter(b=>b.id===boardId):project.boards;
    const width=Math.max(...boards.map(b=>b.width)),height=boards.reduce((n,b)=>n+b.height,0);let y=0;
    const content=boards.map((b,i)=>{const s=`<svg x="0" y="${y}" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}" overflow="hidden">${renderBoard(b,'b'+i+'-')}</svg>`;y+=b.height;return s;}).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(project.fontFamily || FONT)}"><title>${esc(project.name)}</title><rect width="100%" height="100%" fill="white"/>${content}</svg>`;
  }
  function validateProject(raw) {
    if(!raw||raw.format!=='pathway-studio'||raw.version!==VERSION||!Array.isArray(raw.boards)||!raw.boards.length||raw.boards.length>50)throw new Error('这不是受支持的 Pathway Studio 项目文件。');
    const text=(v,max=2000)=>typeof v==='string'&&v.length<=max;
    const finite=(v,min=-100000,max=100000)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
    const color=v=>typeof v==='string'&&(/^(#[0-9a-f]{3,8}|none)$/i.test(v));
    const textStyle=s=>{if(s===undefined)return;if(!s||typeof s!=='object'||Array.isArray(s)||s.fontFamily!==undefined&&!text(s.fontFamily,200)||s.fontSize!==undefined&&!finite(s.fontSize,6,200)||s.color!==undefined&&!color(s.color)||s.bold!==undefined&&typeof s.bold!=='boolean')throw new Error('文字样式无效。');};
    const molecule=m=>{if(!m||typeof m!=='object'||!['smiles','mol'].includes(m.sourceType)||!text(m.source,200000)||!text(m.smiles,10000)||!Number.isInteger(m.atoms)||!finite(m.atoms,1,400)||!finite(m.width,10,4000)||!finite(m.height,10,4000)||!['name','structure','both'].includes(m.display)||!['mono','elements'].includes(m.colorMode)||!text(m.engine,200)||!Array.isArray(m.paths)||(!m.paths.length&&!m.atomTexts?.length)||m.paths.length>6000)throw new Error('化学结构数据无效。');if(m.labelGap!==undefined&&!finite(m.labelGap,0,200))throw new Error('名称间距无效');if(m.bondFragment!==undefined&&typeof m.bondFragment!=='boolean')throw new Error('键片段标志无效');if(m.atomFontFamily!==undefined&&!text(m.atomFontFamily,200))throw new Error('原子字体无效');if(m.atomFontSize!==undefined&&!finite(m.atomFontSize,6,200))throw new Error('原子字号无效');if(m.drawScale!==undefined&&!finite(m.drawScale,.0001,100000))throw new Error('结构坐标比例无效');if(m.bondWidth!==undefined&&!finite(m.bondWidth,.2,20))throw new Error('键线宽无效');if(m.molblock!==undefined&&!text(m.molblock,200000))throw new Error('分子连接数据无效');if(m.atomSites!==undefined&&(!Array.isArray(m.atomSites)||m.atomSites.length!==m.atoms||m.atomSites.some(p=>!p||!finite(p.x)||!finite(p.y))))throw new Error('原子位置无效');if(m.bondSites!==undefined&&(!Array.isArray(m.bondSites)||m.bondSites.length>1200||m.bondSites.some(b=>!b||!Number.isInteger(b.a)||!Number.isInteger(b.b)||b.a<0||b.b<0||b.a>=m.atoms||b.b>=m.atoms||!finite(b.order,1,4))))throw new Error('化学键连接无效');if(m.bondStyles!==undefined&&(!Array.isArray(m.bondStyles)||!m.atomSites||!m.bondSites||m.bondStyles.some(s=>!Number.isInteger(s.index)||s.index<0||s.index>=m.bondSites.length||!Object.hasOwn(CHEMICAL_BONDS,s.type))))throw new Error('化学键样式无效');if(m.stylePreset!==undefined&&!Object.hasOwn(STRUCTURE_PRESETS,m.stylePreset))throw new Error('化学结构样式无效');if(m.atomTexts!==undefined&&(!Array.isArray(m.atomTexts)||m.atomTexts.length>4000||!finite(m.drawingFontSize,1,1000)||m.atomTexts.some(t=>!t||!Number.isInteger(t.atom)||t.atom<0||t.atom>=m.atoms||!text(t.text,100)||!t.text||!finite(t.x)||!finite(t.y)||!finite(t.size,1,1000)||!color(t.color))))throw new Error('结构原子标签无效');if(m.hiddenBonds!==undefined&&(!Array.isArray(m.hiddenBonds)||!m.bondSites||m.hiddenBonds.some(i=>!Number.isInteger(i)||i<0||i>=m.bondSites.length)))throw new Error('结构缩写无效');let total=0;for(const p of m.paths){if(!p||p.atom!==undefined&&(!Number.isInteger(p.atom)||p.atom<0||p.atom>=m.atoms)||p.bond!==undefined&&(!Number.isInteger(p.bond)||p.bond<0||p.bond>1200)||!text(p.d,50000)||!/^[MmLlHhVvCcSsQqTtAaZzEe0-9\s,.+\-]+$/.test(p.d)||!color(p.fill)||!color(p.stroke)||!finite(p.width,0,20)||!finite(p.opacity,0,1)||!['butt','round','square'].includes(p.cap)||!['miter','round','bevel'].includes(p.join)||!['nonzero','evenodd'].includes(p.rule)||!text(p.dash,200)||p.dash&&!/^[\d.,\s]+$/.test(p.dash))throw new Error('化学结构图形无效。');total+=p.d.length;}if(total>1000000)throw new Error('化学结构图形过大。');};
    if(!text(raw.name,200)||!text(raw.fontFamily??FONT,200))throw new Error('项目名称或字体无效。');
    const allIds=new Set();
    function id(v){if(!text(v,120)||!v||allIds.has(v))throw new Error('对象 ID 缺失或重复。');allIds.add(v);}
    for(const b of raw.boards){
      id(b.id);if(!text(b.name,200)||!finite(b.width,200,10000)||!finite(b.height,200,10000)||!Array.isArray(b.nodes)||!Array.isArray(b.edges)||b.nodes.length+b.edges.length>10000)throw new Error('画板尺寸或对象数量无效。');
      for(const key of ['arrowWidth','structureBondWidth']){
        if(b[key]!==undefined&&!finite(b[key],.2,20))throw new Error('画板线宽无效。');
      }
      const nodeIds=new Set();
      for(const n of b.nodes){id(n.id);nodeIds.add(n.id);if(!['metabolite','text','module','membrane','illustration'].includes(n.kind)||!text(n.label)||!finite(n.x)||!finite(n.y)||!finite(n.w,10,10000)||!finite(n.h,10,10000)||!finite(n.fontSize,6,200)||!['none','round','rect','circle','point','structure'].includes(n.shape)||!color(n.color)||!color(n.fill)||!color(n.stroke))throw new Error('节点数据无效。');if(n.chemicalBond!==undefined&&(n.kind!=='text'||!Object.hasOwn(CHEMICAL_BONDS,n.chemicalBond)))throw new Error('化学键图元无效。');if(n.kind==='illustration'&&!Object.hasOwn(ILLUSTRATIONS,n.template))throw new Error('示意组件类型无效。');if(n.highlightFit!==undefined&&typeof n.highlightFit!=='boolean')throw new Error('文字高亮尺寸无效');if(n.structureHighlight!==undefined&&(typeof n.structureHighlight!=='boolean'||!n.molecule))throw new Error('结构高亮无效');if(n.molecule!==undefined){if(n.kind!=='metabolite'||n.shape!=='structure')throw new Error('结构式节点类型不匹配。');molecule(n.molecule);}else if(n.shape==='structure')throw new Error('结构式节点缺少结构数据。');textStyle({fontFamily:n.fontFamily,bold:n.labelBold});if(n.rotation!==undefined&&!finite(n.rotation,-360,360))throw new Error('膜方向无效。');for(const k of ['labelDx','labelDy'])if(n[k]!==undefined&&!finite(n[k]))throw new Error('节点标签偏移无效。');if(n.labelAnchor!==undefined&&!['start','end','middle'].includes(n.labelAnchor))throw new Error('标签对齐无效。');}
      const membraneIds=new Set(b.nodes.filter(n=>n.kind==='membrane').map(n=>n.id));
      for(const n of b.nodes){
        if(n.standalone!==undefined&&(n.template!=='channel'||typeof n.standalone!=='boolean'))throw new Error('通道蛋白显示方式无效。');
        if(n.membraneId===undefined&&n.membraneOffset===undefined)continue;
        if(n.kind!=='illustration'||n.template!=='channel'||!n.standalone||!membraneIds.has(n.membraneId)||!finite(n.membraneOffset))throw new Error('通道蛋白嵌入关系无效。');
      }
      for(const e of b.edges){
        id(e.id);
        if(!['straight','curve','arc','route'].includes(e.mode)||!['forward','both','none'].includes(e.direction)||!text(e.label)||!text(e.knockoutLabel)||!color(e.color)||!color(e.labelColor)||!finite(e.width,.2,20)||!finite(e.fontSize,6,200)||!finite(e.labelDx)||!finite(e.labelDy)||!finite(e.bulge)||!Array.isArray(e.points)||!Array.isArray(e.cofactors)||e.points.length>200||e.cofactors.length>30)throw new Error('线路数据无效。');
        if(isFreeArrow(e)){
          if(e.source!==null||e.target!==null||e.knockout||e.cofactors.length||
            ![e.start,e.end].every(p=>p&&finite(p.x)&&finite(p.y))||
            Math.hypot(e.end.x-e.start.x,e.end.y-e.start.y)<.01)throw new Error('独立箭头的端点或属性无效。');
        }else if(!nodeIds.has(e.source)||!nodeIds.has(e.target))throw new Error('反应连接关系无效。');
        textStyle({fontFamily:e.labelFontFamily,bold:e.labelBold});textStyle(e.knockoutStyle);for(const key of ['knockoutDx','knockoutDy','knockoutMarkDx','knockoutMarkDy'])if(e[key]!==undefined&&!finite(e[key]))throw new Error('敲除标记位置无效。');
        for(const port of [e.sourcePort,e.targetPort])if(!['auto','north','south','east','west'].includes(port))throw new Error('反应连接方向无效。');
        for(const p of [...e.points,...[e.c1,e.c2].filter(Boolean)])if(!p||!finite(p.x)||!finite(p.y))throw new Error('曲线控制点无效。');
        if(e.cornerRadius!==undefined&&!finite(e.cornerRadius,0,500))throw new Error('圆角无效。');
        if(e.arrowSize!==undefined&&!finite(e.arrowSize,3,40))throw new Error('箭头尺寸无效。');
        for(const c of e.cofactors){id(c.id);textStyle(c.inputStyle);textStyle(c.outputStyle);for(const key of ['inputHighlight','outputHighlight'])if(c[key]!==undefined&&typeof c[key]!=='boolean')throw new Error('辅因子高亮无效。');for(const key of ['inputLabelDx','inputLabelDy','outputLabelDx','outputLabelDy'])if(c[key]!==undefined&&!finite(c[key]))throw new Error('辅因子文字偏移无效。');if(!text(c.input)||!text(c.output)||!finite(c.dx)||!finite(c.dy)||!finite(c.spread,10,300)||![1,-1].includes(c.side)||!finite(c.t,0,1))throw new Error('辅因子数据无效。');if(c.style!==undefined&&!['branch','compact'].includes(c.style))throw new Error('辅因子样式无效。');if(c.labelGap!==undefined&&!finite(c.labelGap,0,100))throw new Error('辅因子文字间距无效。');if(c.direction!==undefined&&!['forward','both'].includes(c.direction))throw new Error('辅因子箭头方向无效。');if(c.orientation!==undefined&&!['auto','down','up','right','left'].includes(c.orientation))throw new Error('辅因子方向无效。');if(c.arrowSize!==undefined&&!finite(c.arrowSize,3,40))throw new Error('辅因子箭头大小无效。');if(c.fontSize!==undefined&&!finite(c.fontSize,6,200))throw new Error('辅因子字号无效。');}
      }
    }return clone(raw);
  }
  function deleteObjects(b,ids) {const selected=new Set(ids);b.nodes=b.nodes.filter(n=>!selected.has(n.id));const valid=new Set(b.nodes.map(n=>n.id));b.edges=b.edges.filter(e=>!selected.has(e.id)&&(isFreeArrow(e)||valid.has(e.source)&&valid.has(e.target)));syncMembraneChannels(b);}
  function copyObjects(b,ids){const selected=new Set(ids),originalNodes=new Set(b.nodes.filter(n=>selected.has(n.id)||selected.has(n.membraneId)).map(n=>n.id)),required=new Set(originalNodes),edges=b.edges.filter(e=>selected.has(e.id)||originalNodes.has(e.source)&&originalNodes.has(e.target));for(const e of edges){if(isFreeArrow(e))continue;required.add(e.source);required.add(e.target);}return clone({nodes:b.nodes.filter(n=>required.has(n.id)),edges});}
  function duplicateObjects(b,ids,offset=28) {
    const selected=new Set(ids),map=new Map(),groups=new Map(),newIds=[];
    function group(id){if(!id)return null;if(!groups.has(id))groups.set(id,uid('g'));return groups.get(id);}
    const nodes=b.nodes.filter(n=>selected.has(n.id)||selected.has(n.membraneId)).map(n=>{const c=clone(n);map.set(n.id,c.id=uid());c.x+=offset;c.y+=offset;c.groupId=group(c.groupId);newIds.push(c.id);return c;});
    for(const n of nodes)if(n.membraneId){const host=map.get(n.membraneId);if(host)n.membraneId=host;else detachChannel(n);}
    const edges=b.edges.filter(e=>selected.has(e.id)||(map.has(e.source)&&map.has(e.target))).map(e=>{
      const c=clone(e);
      c.id=uid('r');
      c.groupId=group(c.groupId);
      if(isFreeArrow(e))translateEdge(c,e,offset,offset);
      else{
        c.source=map.get(e.source)||e.source;
        c.target=map.get(e.target)||e.target;
        c.cofactors.forEach(x=>x.id=uid('cf'));
        if(map.has(e.source)&&map.has(e.target))translateEdge(c,e,offset,offset);
      }
      newIds.push(c.id);
      return c;
    });
    b.nodes.push(...nodes);b.edges.push(...edges);return newIds;
  }
  function demoProject() {
    const p=emptyProject();p.name='一碳代谢 · 路径示意图';const b=p.boards[0];b.name='碳同化与中心代谢';b.width=1200;b.height=820;
    const add=(kind,x,y,label,extra={})=>{const n={...node(kind,x,y,label),...extra};b.nodes.push(n);return n.id;};
    const connect=(s,t,label='',extra={})=>{const e={...edge(s,t),label,...extra};b.edges.push(e);return e;};
    add('text',135,42,'CARBON ASSIMILATION',{fontSize:11,color:'#819687',bold:true});
    add('text',600,77,'一碳同化与中心代谢',{fontSize:27,bold:true});
    add('text',600,112,'Carbon assimilation  ·  Central metabolism',{fontSize:13,color:'#8d9c91'});
    add('module',293,387,'a   Methanol assimilation / PPP',{w:500,h:455,fill:'#e5efe2',stroke:'#c8d7cb',fontSize:18,dashed:false});
    add('module',891,387,'b   TCA cycle',{w:576,h:455,fill:'#e8eff1',stroke:'#cad8d7',fontSize:18,dashed:false});
    const met=(x,y,l,opts={})=>add('metabolite',x,y,l,opts);
    const me=met(180,225,'CH_{3}OH',{shape:'round',fill:'#e6edcc',w:112,h:43});
    const fa=met(180,350,'HCHO');const h6=met(180,440,'H6P');const f6=met(180,550,'F6P');const ru=met(390,440,'Ru5P');const xu=met(390,330,'Xu5P');const s7=met(390,550,'S7P');
    connect(me,fa,'Mdh',{mode:'straight',labelDx:36,labelDy:0,cofactors:[{id:uid('cf'),input:'NAD^{+}',output:'NADH',dx:-12,dy:0,side:1,spread:26,t:.5,arrowSize:10}]});
    connect(fa,h6,'Hps',{mode:'straight',labelDx:34,labelDy:0});connect(h6,f6,'Phi',{mode:'straight',labelDx:32,labelDy:0});
    connect(ru,h6,'',{mode:'straight'});
    connect(f6,xu,'Tkt',{mode:'route',sourcePort:'south',targetPort:'east',points:[{x:180,y:588},{x:480,y:588},{x:480,y:330}],cornerRadius:25,labelDx:27,labelDy:0});
    connect(xu,ru,'',{mode:'straight'});
    connect(f6,s7,'Tal',{mode:'straight',labelDx:0,labelDy:-19});connect(s7,ru,'',{mode:'straight'});
    const ring=[];const names=['Citrate','Isocitrate','α-KG','Succinyl-CoA','Succinate','Fumarate','Malate','OAA'];
    for(let i=0;i<8;i++)ring.push(met(895,398,names[i],{fontSize:17}));
    const enzymes=['Acn','Icd','Odh','SucCD','Sdh','Fum','Mdh','GltA'];
    for(let i=0;i<8;i++)connect(ring[i],ring[(i+1)%8],enzymes[i],{mode:'arc',fontSize:15,width:2,arrowSize:11});
    arrangeCircle(b,ring.map(id=>b.nodes.find(n=>n.id===id)),895,398,155);
    addTcaCofactors(b,ring);
    const acetyl=met(680,229,'Acetyl-CoA',{fontSize:18});connect(acetyl,ring[0],'',{mode:'curve',c1:{x:80,y:0},c2:{x:-65,y:-25},targetPort:'west',arrowSize:11});
    add('text',895,389,'TCA',{fontSize:29,color:'#4a7363',bold:true});add('text',895,421,'Tricarboxylic acid cycle',{fontSize:12,color:'#8b9e93'});
    add('module',600,710,'c   Engineering annotations',{w:1114,h:142,fill:'#ffffff',stroke:'#d0dace',fontSize:17,dashed:true});
    const g3=met(160,738,'G3P'),bpg=met(400,738,'1,3BPG'),pg=met(685,738,'3PG'),py=met(1000,738,'Pyruvate',{shape:'round',w:135,fill:'#deebd5'});
    connect(g3,bpg,'GapA',{mode:'straight',labelDy:-22,knockout:true,knockoutLabel:'ΔgapA',labelDx:0});connect(bpg,pg,'Pgk',{mode:'straight',labelDy:24,cofactors:[{id:uid('cf'),input:'ADP',output:'ATP',dx:0,dy:-10,side:1,spread:32,t:.5,orientation:'right',fontSize:14,arrowSize:10}]});connect(pg,py,'Glycolysis',{mode:'straight',dashed:true,labelColor:'#708175',fontSize:16,labelDy:-23});
    return p;
  }
  function exampleBoard(key){
    if(key==='metabolism')return demoProject().boards[0];
    const b=board(key==='biology'?'细胞器与微生物示例':'环形途径 · 点击编辑示例');
    if(key==='cycle'){const f=buildCycle(TCA_ROWS,{radius:180,title:'TCA',cofactors:true});b.nodes=f.nodes;b.edges=f.edges;b.nodes.forEach(n=>{n.x+=600;n.y+=410;});return b;}
    if(key!=='biology')throw new Error('未知示例');
    for(const [template,x,y] of [['mitochondrion',200,230],['chloroplast',470,230],['nucleus',740,230],['vacuole',1010,230],['rod',200,530],['coccus',470,530],['yeast',740,530]])b.nodes.push(illustrationNode(template,x,y));
    b.nodes.push({...node('membrane',1010,530),rotation:35,fill:'#c9def2',stroke:'#326b8c'});
    b.nodes.push({...node('text',600,82,'细胞器与微生物示意组件'),fontSize:26,bold:true});
    b.nodes.push({...node('text',1010,704,'细胞膜'),fontSize:17});return b;
  }
  const api={STRUCTURE_PRESETS,STRUCTURE_FONT,ptToPx,typicalBondLength,applyStructurePreset,moleculeGraphicBounds,setTextMeasurer,setDefaultFont,moleculeAtomPosition,fitMoleculeEdit,bondGlyph,CHEMICAL_BONDS,chemicalBondNode,knockoutMarkGeometry,nearestPathPosition,VERSION,FONT,esc,uid,clone,number,clamp,node,ILLUSTRATIONS,illustrationNode,componentBounds,illustrationLabelPosition,moleculeNode,moleculeLabelPosition,edge,isFreeArrow,freeArrow,alignFreeArrow,edgeLabelGeometry,edgeLabelOffset,edgeEndpoints,translateEdge,setBoardArrowWidth,boardStructureBondWidth,applyBoardFigureStyle,board,emptyProject,labelRuns,runsToLabel,labelEditorHTML,formatLabelRange,textMarkup,cofactorTextStyle,knockoutTextGeometry,bounds,anchor,mix,geometry,rightRoutePreset,cofactorGeometry,effectiveArrowSize,layoutCofactor,fitNewCofactor,arrangeCircle,TCA_ROWS,parseCycleRows,buildCycle,renderBoard,renderNode,renderEdge,exportSVG,validateProject,deleteObjects,copyObjects,duplicateObjects,demoProject,exampleBoard};
  Object.assign(api,{embedChannel,detachChannel,syncMembraneChannels,selectionScaleFrame,scaleSelection});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PathwayCore=api;
})(globalThis);
