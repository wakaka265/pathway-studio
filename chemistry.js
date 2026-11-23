/* Local chemical-structure input and RDKit SVG-to-primitive conversion. */
(function(root){
  'use strict';
  let loading;
  const assetBase=typeof document!=='undefined'?new URL('.',document.currentScript?.src||document.baseURI).href:null;
  function loadLocalScript(file,message){
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=new URL('vendor/rdkit/'+file,assetBase).href;
      script.onload=resolve;
      script.onerror=()=>{script.remove();reject(new Error(message));};
      document.head.append(script);
    });
  }
  async function offlineWasm(){
    // Classic scripts can load next to index.html even when file:// blocks fetch.
    await loadLocalScript('RDKit_offline.js','化学引擎文件缺失，请检查 vendor/rdkit 目录');
    const packed=root.PathwayOfflineWasm;
    delete root.PathwayOfflineWasm;
    const compressed=Uint8Array.from(atob(packed),c=>c.charCodeAt(0));
    const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function load(){
    if(loading)return loading;
    loading=(async()=>{
      if(typeof module!=='undefined'&&module.exports){const path=require('node:path');return require('./vendor/rdkit/RDKit_minimal.js')({locateFile:f=>path.join(__dirname,'vendor','rdkit',f),printErr:()=>{}});}
      if(typeof root.initRDKitModule!=='function')await loadLocalScript('RDKit_minimal.js','本地化学引擎文件缺失，请检查 vendor/rdkit 目录');
      const options={locateFile:f=>new URL('vendor/rdkit/'+f,assetBase).href,printErr:()=>{}};
      if(new URL(assetBase).protocol==='file:'){
        const wasm=await WebAssembly.compile(await offlineWasm());
        options.instantiateWasm=(imports,receive)=>receive(new WebAssembly.Instance(wasm,imports));
      }
      return root.initRDKitModule(options);
    })().catch(err=>{loading=null;throw err;});return loading;
  }
  function svgPaths(svg,allowEmpty=false){
    if(/<(?:script|foreignObject|image|use|text|line|polygon|polyline|circle|ellipse)\b/i.test(svg))throw new Error('化学引擎输出了当前未支持的图形，未导入不完整结构');
    const attr=(tag,name)=>{const match=tag.match(new RegExp('\\b'+name+'\\s*=\\s*([\'\"])([\\s\\S]*?)\\1','i'));return match?match[2]:'';};
    const paths=[];let total=0;
    for(const tag of svg.match(/<path\b[^>]*>/gi)||[]){const d=attr(tag,'d'),style=Object.fromEntries(attr(tag,'style').split(';').filter(Boolean).map(item=>{const i=item.indexOf(':');return[item.slice(0,i).trim(),item.slice(i+1).trim()];}));
      if(!d||!/^[MmLlHhVvCcSsQqTtAaZzEe0-9\s,.+\-]+$/.test(d))throw new Error('无效的结构路径');
      const fill=style.fill||attr(tag,'fill')||'none',stroke=style.stroke||attr(tag,'stroke')||'none',width=parseFloat(style['stroke-width']||attr(tag,'stroke-width')||'0'),opacity=Number(style.opacity??1),dash=style['stroke-dasharray']&&style['stroke-dasharray']!=='none'?style['stroke-dasharray']:'';
      if(!/^(none|#[0-9a-f]{6})$/i.test(fill)||!/^(none|#[0-9a-f]{6})$/i.test(stroke)||!Number.isFinite(width)||width<0||width>20||!Number.isFinite(opacity)||opacity<0||opacity>1||dash&&!/^[\d.,\s]+$/.test(dash))throw new Error('无效的结构绘图样式');
      const bond=attr(tag,'class').match(/\bbond-(\d+)\b/),atom=!bond&&attr(tag,'class').match(/\batom-(\d+)\b/);
      paths.push({d,fill,stroke,width,opacity,dash,...(bond?{bond:Number(bond[1])}:atom?{atom:Number(atom[1])}:{}),cap:['butt','round','square'].includes(style['stroke-linecap'])?style['stroke-linecap']:'butt',join:['miter','round','bevel'].includes(style['stroke-linejoin'])?style['stroke-linejoin']:'round',rule:style['fill-rule']==='evenodd'?'evenodd':'nonzero'});total+=d.length;
    }
    if((!allowEmpty&&!paths.length)||paths.length>6000||total>1000000)throw new Error('结构图过于复杂或未生成有效图形');return paths;
  }
  function drawingSites(svg,atoms){
    const sites=Array(atoms).fill(null);
    for(const tag of svg.match(/<ellipse\b[^>]*>/g)||[]){
      const index=tag.match(/class=['"]atom-(\d+)['"]/),x=tag.match(/cx=['"]([\d.eE+\-]+)['"]/),y=tag.match(/cy=['"]([\d.eE+\-]+)['"]/);
      if(index&&x&&y)sites[Number(index[1])]={x:Number(x[1]),y:Number(y[1])};
    }
    if(sites.length!==atoms||sites.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('无法定位结构中的原子');
    return sites;
  }
  function readAtomTexts(svg){
    const attr=(s,k)=>s.match(new RegExp('\\b'+k+"=['\"]([^'\"]+)['\"]"))?.[1];
    return [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].flatMap(([,tag,raw])=>{
      const atom=attr(tag,'class')?.match(/^atom-(\d+)$/),style=attr(tag,'style')||'';
      const size=Number(style.match(/font-size:([\d.]+)px/)?.[1]),color=style.match(/(?:^|;)fill:(#[0-9a-f]{6})/i)?.[1];
      const x=Number(attr(tag,'x')),y=Number(attr(tag,'y'));
      if(!atom||!raw.trim()||!color||![x,y,size].every(Number.isFinite)||size<=0)return [];
      return [{atom:Number(atom[1]),x,y,size,color,text:raw==='-'?'–':raw.replace(/&amp;/g,'&')}];
    });
  }
  function methylAbbreviations(mol,graph){
    const {defaults,molecules}=JSON.parse(mol.get_json()),atoms=molecules[0].atoms.map(a=>({...defaults.atom,...a}));
    const labels={},hiddenBonds=[];
    graph.atoms.forEach((atom,index)=>{
      if(!['O','N','S','P'].includes(atom.symbol))return;
      const a=atoms[index],bonds=graph.bonds.filter(b=>b.a===index||b.b===index);
      if(a.chg||a.impHs||a.isotope||a.nRad||bonds.length!==2||bonds.some(b=>b.order!==1||Number(b.line.slice(9,12))))return;
      const methyl=bonds.filter(b=>{
        const neighbor=atoms[b.a===index?b.b:b.a];
        return neighbor.z===6&&neighbor.impHs===3&&!neighbor.chg&&!neighbor.isotope&&!neighbor.nRad;
      });
      if(methyl.length!==1)return;
      labels[index]=atom.symbol+'Me';
      hiddenBonds.push(graph.bonds.indexOf(methyl[0]));
    });
    return {labels,hiddenBonds};
  }
  async function generate(source,sourceType='smiles',verifyAtom=null,preset=null,editableAtomText=false){
    if(!['smiles','mol'].includes(sourceType))throw new Error('不支持的结构输入格式');
    source=String(source).replace(/^﻿/,'');if(sourceType==='smiles')source=source.trim();if(!source.trim())throw new Error('请先输入 SMILES 或 MOL 内容');if(source.length>200000)throw new Error('结构输入过长');if(sourceType==='smiles'&&source.length>10000)throw new Error('SMILES 过长');
    const kit=await load();let mol;
    try{mol=kit.get_mol(source);if(!mol||!mol.is_valid())throw new Error('无法解析结构，请检查 SMILES、MOL 格式或原子价态');const atoms=mol.get_num_atoms();if(!atoms||atoms>400)throw new Error('目前支持 1–400 个原子的单个结构');
      if(verifyAtom){
        const {index,charge,hydrogens,label}=verifyAtom,details=atomDetails(mol,index);
        if(details.chg!==charge||(hydrogens!==null&&details.hydrogens!==hydrogens)){
          throw new Error('当前位置的化学键无法表示 '+label);
        }
      }
      if(sourceType==='smiles')mol.set_new_coords();
      const width=320,height=220,options={width,height,bondLineWidth:1.8,maxFontSize:22,minFontSize:12,padding:.08,atoms:Array.from({length:atoms},(_,i)=>i),bonds:[],highlightRadius:.001,highlightColour:[1,1,1],atomHighlightsAreCircles:true};
      let svg=mol.get_svg_with_highlights(JSON.stringify(options)),atomSites=drawingSites(svg,atoms);
      const molblock=mol.get_molblock(),graph=parseMol(molblock);
      const bondSites=graph.bonds.map(b=>({a:b.a,b:b.b,order:b.order,stereo:Number(b.line.slice(9,12))||0}));
      let publication={};
      if(preset||editableAtomText){
        const lengths=graph.bonds.map(b=>Math.hypot(atomSites[b.a].x-atomSites[b.b].x,atomSites[b.a].y-atomSites[b.b].y)).sort((a,b)=>a-b);
        const fontSize=preset?Math.max(5,Math.round((lengths[Math.floor(lengths.length/2)]||32)*preset.atomPt/preset.bondPt)):20;
        const {labels,hiddenBonds}=preset?.abbreviateMethyl?methylAbbreviations(mol,graph):{labels:{},hiddenBonds:[]};
        svg=mol.get_svg_with_highlights(JSON.stringify({...options,noFreetype:true,fixedFontSize:fontSize,
          ...(preset?{multipleBondOffset:preset.spacing}:{}),explicitMethyl:false,includeRadicals:true,atomLabels:labels}));
        atomSites=drawingSites(svg,atoms);
        publication={atomTexts:readAtomTexts(svg),drawingFontSize:fontSize,hiddenBonds};
        svg=svg.replace(/<text\b[\s\S]*?<\/text>/g,'');
      }
      let drawScale=60;for(let i=1;i<atoms;i++){const d=Math.hypot(graph.atoms[i].x-graph.atoms[0].x,graph.atoms[i].y-graph.atoms[0].y);if(d>.001){drawScale=Math.hypot(atomSites[i].x-atomSites[0].x,atomSites[i].y-atomSites[0].y)/d;break;}}
      const paths=svgPaths(svg.replace(/<ellipse\b[^>]*\/>/g,''),!!preset);
      return {sourceType,source,smiles:mol.get_smiles(),atoms,width,height,paths,molblock,atomSites,drawScale,
        atomRenderingVersion:1,bondSites,engine:'RDKit '+kit.version(),display:'both',colorMode:'mono',...publication};
    }catch(err){throw new Error(err instanceof Error?err.message:'无法解析或绘制结构，请检查输入');}finally{if(mol)mol.delete();}
  }
  async function toMol(source,type='smiles'){if(!String(source).trim())return '';const kit=await load();let mol;try{mol=kit.get_mol(source);if(!mol||!mol.is_valid())throw new Error('无法解析结构');if(type==='smiles')mol.set_new_coords();return mol.get_molblock();}finally{if(mol)mol.delete();}}
  function parseMol(source){const lines=source.replace(/\r/g,'').split('\n'),na=Number(lines[3]?.slice(0,3)),nb=Number(lines[3]?.slice(3,6));if(!lines[3]?.includes('V2000')||!Number.isInteger(na)||!Number.isInteger(nb)||na<1||na>400)throw new Error('当前直接连接支持 V2000 小分子结构');return {lines,atoms:lines.slice(4,4+na).map(line=>({x:Number(line.slice(0,10)),y:Number(line.slice(10,20)),symbol:line.slice(31,34).trim(),line})),bonds:lines.slice(4+na,4+na+nb).map(line=>({a:Number(line.slice(0,3))-1,b:Number(line.slice(3,6))-1,order:Number(line.slice(6,9)),line})),tail:lines.slice(4+na+nb)};}
  async function connect(data,atom,point,style='single',target=null,reverse=false){const graph=parseMol(data.molblock||await toMol(data.source,data.sourceType));if(!graph.atoms[atom])throw new Error('连接原子不存在');const a=graph.atoms[atom],sites=data.atomSites;let scale=0;for(const b of graph.bonds){const p=graph.atoms[b.a],q=graph.atoms[b.b],d=Math.hypot(q.x-p.x,q.y-p.y);if(d>.01&&sites?.[b.a]&&sites?.[b.b]){scale=Math.hypot(sites[b.a].x-sites[b.b].x,sites[b.a].y-sites[b.b].y)/d;break;}}if(!scale)scale=60;
    let end=target;if(end===null){if(graph.atoms.length>=400)throw new Error('结构最多支持 400 个原子');const x=a.x+(point.x-sites[atom].x)/scale,y=a.y-(point.y-sites[atom].y)/scale;end=graph.atoms.length;graph.atoms.push({x,y,symbol:'C',line:x.toFixed(4).padStart(10)+y.toFixed(4).padStart(10)+'    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0'});}else if(end===atom||!graph.atoms[end])throw new Error('请选择不同的原子');
    const existing=graph.bonds.findIndex(b=>(b.a===atom&&b.b===end)||(b.a===end&&b.b===atom)),order=style==='double'?2:style==='triple'?3:1,from=reverse?end:atom,to=reverse?atom:end,line=String(from+1).padStart(3)+String(to+1).padStart(3)+String(order).padStart(3)+String(style==='wedge'?1:style==='hashed'?6:style==='wavy'?4:0).padStart(3);
    const index=existing<0?graph.bonds.length:existing;if(existing<0)graph.bonds.push({a:from,b:to,order,line});else graph.bonds[index]={a:from,b:to,order,line};
    const counts=String(graph.atoms.length).padStart(3)+String(graph.bonds.length).padStart(3)+graph.lines[3].slice(6),mol=[...graph.lines.slice(0,3),counts,...graph.atoms.map(a=>a.line),...graph.bonds.map(b=>b.line),...graph.tail].join('\n');
    const next=await redraw(data,mol);if(data.bondFragment&&next.atoms===2)next.bondFragment=true;if(data.labelGap!==undefined)next.labelGap=data.labelGap;present(next,data);if(data.bondWidth!==undefined)next.bondWidth=data.bondWidth;if(data.atomFontSize!==undefined)next.atomFontSize=data.atomFontSize;next.bondStyles=(data.bondStyles||[]).filter(s=>s.index!==index);if(['wedge','hashed','dashed','wavy'].includes(style))next.bondStyles.push({index,type:style});return next;
  }
  function readFormalCharges(graph){
    const charges=new Map(),legacy={1:3,2:2,3:1,5:-1,6:-2,7:-3};
    graph.atoms.forEach((atom,index)=>{
      const charge=legacy[Number(atom.line.slice(36,39))];
      if(charge)charges.set(index,charge);
    });
    for(const line of graph.tail.filter(line=>line.startsWith('M  CHG'))){
      const [,count,...pairs]=line.slice(3).trim().split(/\s+/);
      for(let i=0;i<Number(count);i++)charges.set(Number(pairs[2*i])-1,Number(pairs[2*i+1]));
    }
    return charges;
  }
  function atomDetails(mol,index){
    const json=JSON.parse(mol.get_json()),molecule=json.molecules[0];
    const atom={...json.defaults.atom,...molecule.atoms[index]};
    const explicitHydrogens=(molecule.bonds||[]).filter(b=>{
      if(!b.atoms.includes(index))return false;
      return (molecule.atoms[b.atoms.find(i=>i!==index)].z??json.defaults.atom.z)===1;
    }).length;
    return {...atom,hydrogens:atom.impHs+explicitHydrogens,explicitHydrogens};
  }
  async function atomLabel(data,index){
    const g=parseMol(data.molblock),symbol=g.atoms[index].symbol,charge=readFormalCharges(g).get(index)||0;
    if(!charge)return symbol;
    const kit=await load(),mol=kit.get_mol(data.molblock);
    try{
      // Only hydrogens rendered in the atom label are shown here.
      const h=mol?atomDetails(mol,index).impHs:0;
      return symbol+(h?'H'+(h===1?'':h):'')+
        (Math.abs(charge)>1?Math.abs(charge):'')+(charge<0?'-':'+');
    }finally{mol?.delete();}
  }
  const elements=new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' '));
  function parseAtomLabel(label){
    let input=label.trim().replace(/^\[([^\[\]]+)\]$/,'$1').replace(/\s|\^/g,'')
      .replace(/[₀-₉]/g,c=>String(c.charCodeAt(0)-0x2080))
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g,c=>String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)))
      .replace(/[⁻−]/g,'-').replace(/⁺/g,'+');
    let charge=0;
    const suffix=input.match(/([+-])(\d*)$/);
    if(suffix){
      const [,sign,after]=suffix;
      input=input.slice(0,suffix.index);
      const before=!after&&input.match(/^([a-z]{1,2})(\d+)$/i);
      const base=before?.[1];
      const hydrogenGroup=base?.length===2&&base.endsWith('H');
      const amount=before&&!hydrogenGroup?before[2]:after;
      if(before&&!hydrogenGroup)input=base;
      charge=(sign==='-'?-1:1)*Number(amount||1);
    }
    const formula=input.match(/^([A-Za-z]{1,2})H([0-9]*)$/);
    const element=formula?formula[1]:input,symbol=element.slice(0,1).toUpperCase()+element.slice(1).toLowerCase();
    const hydrogens=formula?Number(formula[2]||1):null;
    if(!elements.has(symbol)||!Number.isInteger(charge)||Math.abs(charge)>8||
       (hydrogens!==null&&(hydrogens>8||symbol==='H'))){
      throw new Error('请输入元素或带电原子，例如 O-、NH3+、Fe2+');
    }
    return {symbol,charge,hydrogens};
  }
  function atomPropertyLines(name,records){
    const lines=[];
    for(let i=0;i<records.length;i+=8){
      const group=records.slice(i,i+8);
      lines.push('M  '+name+String(group.length).padStart(3)+group.map(([index,value])=>String(index+1).padStart(4)+String(value).padStart(4)).join(''));
    }
    return lines;
  }
  async function changeAtom(data,index,label){
    const {symbol,charge,hydrogens}=parseAtomLabel(label);
    const g=parseMol(data.molblock||await toMol(data.source,data.sourceType)),atom=g.atoms[index];
    if(!atom)throw new Error('原子不存在');
    const charges=readFormalCharges(g);
    charges.delete(index);
    if(charge)charges.set(index,charge);
    const oldSymbol=atom.symbol;
    atom.line=atom.line.slice(0,31)+symbol.padEnd(3)+atom.line.slice(34);
    if(hydrogens!==null||symbol!==oldSymbol){
      const bonds=g.bonds.filter(b=>b.a===index||b.b===index);
      const attachedH=bonds.filter(b=>g.atoms[b.a===index?b.b:b.a].symbol==='H').length;
      if(hydrogens!==null&&attachedH>hydrogens)throw new Error('请先移除多余的显式氢原子');
      const valence=hydrogens===null?0:bonds.reduce((sum,b)=>sum+b.order,0)+hydrogens-attachedH||15;
      if(valence>15)throw new Error('当前位置的化学键无法表示 '+label);
      atom.line=atom.line.slice(0,42)+'  0'+atom.line.slice(45,48)+String(valence).padStart(3)+atom.line.slice(51);
      g.tail=g.tail.flatMap(line=>{
        const match=line.match(/^M  (RAD|ISO)\s+\d+\s+(.+)$/);
        if(!match||match[1]==='ISO'&&symbol===oldSymbol)return [line];
        const values=match[2].trim().split(/\s+/).map(Number),records=[];
        for(let i=0;i<values.length;i+=2)if(values[i]!==index+1)records.push([values[i]-1,values[i+1]]);
        return atomPropertyLines(match[1],records);
      });
    }
    for(const a of g.atoms){
      if([1,2,3,5,6,7].includes(Number(a.line.slice(36,39))))a.line=a.line.slice(0,36)+'  0'+a.line.slice(39);
    }
    g.tail=[...atomPropertyLines('CHG',[...charges].filter(([,value])=>value!==0)),...g.tail.filter(line=>!line.startsWith('M  CHG'))];
    const next=await redraw(data,writeMol(g),{index,charge,hydrogens,label});
    present(next,data);
    next.bondStyles=data.bondStyles||[];
    return next;
  }
  function present(next,data){next.display=data.display;next.colorMode=data.colorMode;for(const key of ['bondWidth','atomFontSize','atomFontFamily','labelGap','stylePreset'])if(data[key]!==undefined)next[key]=data[key];if(data.bondFragment&&next.atoms===2)next.bondFragment=true;return next;}
  async function renderAtomText(data){
    if(data.atomTexts)return data;
    const source=data.molblock||data.source;
    const next=present(await generate(source,data.molblock?'mol':data.sourceType,null,null,true),data);
    if(next.smiles!==data.smiles)throw new Error('字体转换会改变结构，已保留原图');
    return {...next,source:data.source,sourceType:data.sourceType,bondStyles:data.bondStyles||[]};
  }
  async function renderPublicationStyle(data,key,preset){
    const drawn=await generate(data.molblock||data.source,data.molblock?'mol':data.sourceType,null,preset);
    if(drawn.smiles!==data.smiles)throw new Error('样式预设未能保留原结构');
    return {...data,...drawn,source:data.source,sourceType:data.sourceType,display:data.display,colorMode:data.colorMode,stylePreset:key};
  }
  function redraw(data,source,verifyAtom=null){
    const core=root.PathwayCore||(typeof module!=='undefined'&&module.exports?require('./core.js'):null);
    const preset=core&&Object.hasOwn(core.STRUCTURE_PRESETS,data.stylePreset)?core.STRUCTURE_PRESETS[data.stylePreset]:null;
    return generate(source,'mol',verifyAtom,preset,!!data.atomTexts);
  }
  function writeMol(g){return [...g.lines.slice(0,3),String(g.atoms.length).padStart(3)+String(g.bonds.length).padStart(3)+g.lines[3].slice(6),...g.atoms.map(a=>a.line),...g.bonds.map(b=>b.line),...g.tail].join('\n');}
  function atomLine(x,y,symbol='C'){return x.toFixed(4).padStart(10)+y.toFixed(4).padStart(10)+'    0.0000 '+symbol.padEnd(3)+' 0  0  0  0  0  0  0  0  0  0  0  0';}
  function bondLine(a,b,order=1){return String(a+1).padStart(3)+String(b+1).padStart(3)+String(order).padStart(3)+'  0';}
  async function attachRing(data,index,size,aromatic){
    if(![3,4,5,6].includes(size)||(aromatic&&size!==6))throw new Error('不支持的环大小');
    const g=parseMol(data.molblock),atom=g.atoms[index];
    if(!atom)throw new Error('请选择连接原子');
    const incident=g.bonds.filter(b=>b.a===index||b.b===index);
    const reuse=atom.symbol==='C'&&incident.length===1&&incident[0].order===1&&!readFormalCharges(g).get(index);
    if(g.atoms.length+size-Number(reuse)>400)throw new Error('结构原子过多');
    const site=data.atomSites[index];
    const near=incident.length===1?data.atomSites[incident[0].a===index?incident[0].b:incident[0].a]:null;
    const center=near||data.atomSites.reduce((p,q)=>({x:p.x+q.x/data.atoms,y:p.y+q.y/data.atoms}),{x:0,y:0});
    const hint={x:2*site.x-center.x,y:2*site.y-center.y};
    if(Math.hypot(hint.x-site.x,hint.y-site.y)<.01)hint.x+=60;
    const extended=snapEndpoint(data,index,hint),scale=data.drawScale||60;
    const length=Math.hypot(extended.x-site.x,extended.y-site.y)/scale;
    const aim=reuse?hint:extended,angle=Math.atan2(site.y-aim.y,aim.x-site.x);
    const radius=length/(2*Math.sin(Math.PI/size));
    const distance=radius+(reuse?0:length),cx=atom.x+distance*Math.cos(angle),cy=atom.y+distance*Math.sin(angle);
    const vertices=[];
    for(let i=0;i<size;i++){
      if(i===0&&reuse){vertices.push(index);continue;}
      const theta=angle+Math.PI+i*2*Math.PI/size;
      const x=cx+radius*Math.cos(theta),y=cy+radius*Math.sin(theta);
      vertices.push(g.atoms.length);
      g.atoms.push({x,y,symbol:'C',line:atomLine(x,y)});
    }
    for(let i=0;i<size;i++){
      const a=vertices[i],b=vertices[(i+1)%size],order=aromatic&&i%2===0?2:1;
      g.bonds.push({a,b,order,line:bondLine(a,b,order)});
    }
    if(!reuse)g.bonds.push({a:index,b:vertices[0],order:1,line:bondLine(index,vertices[0])});
    const next=present(await redraw(data,writeMol(g)),data);
    next.bondStyles=data.bondStyles||[];
    return next;
  }
  async function fuseRing(data,bondIndex,size=6,aromatic=false){if(![3,4,5,6].includes(size))throw new Error('不支持的环大小');const g=parseMol(data.molblock),bond=g.bonds[bondIndex];if(!bond)throw new Error('请选择已有化学键');if(g.atoms.length+size-2>400)throw new Error('结构原子过多');const a=g.atoms[bond.a],b=g.atoms[bond.b],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length<.01)throw new Error('键长太短');const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,nx=-dy/length,ny=dx/length,cx=g.atoms.reduce((s,a)=>s+a.x,0)/g.atoms.length,cy=g.atoms.reduce((s,a)=>s+a.y,0)/g.atoms.length,side=(mx-cx)*nx+(my-cy)*ny>=0?1:-1,apothem=length/(2*Math.tan(Math.PI/size)),center={x:mx+side*nx*apothem,y:my+side*ny*apothem},theta=Math.atan2(a.y-center.y,a.x-center.x),nextTheta=Math.atan2(b.y-center.y,b.x-center.x),delta=Math.atan2(Math.sin(nextTheta-theta),Math.cos(nextTheta-theta)),step=Math.sign(delta)*2*Math.PI/size,radius=length/(2*Math.sin(Math.PI/size)),indices=[bond.a,bond.b];
    for(let i=2;i<size;i++){const x=center.x+radius*Math.cos(theta+i*step),y=center.y+radius*Math.sin(theta+i*step);indices.push(g.atoms.length);g.atoms.push({x,y,symbol:'C',line:atomLine(x,y)});}
    for(let i=1;i<size;i++){const a=indices[i],b=indices[(i+1)%size],order=aromatic?(bond.order===2?(i%2?1:2):(i%2?2:1)):1;g.bonds.push({a,b,order,line:bondLine(a,b,order)});}
    let result;try{result=await redraw(data,writeMol(g));}catch(err){if(!aromatic)throw err;g.bonds[bondIndex].line=bondLine(bond.a,bond.b,4);for(let i=g.bonds.length-size+1;i<g.bonds.length;i++)g.bonds[i].line=bondLine(g.bonds[i].a,g.bonds[i].b,4);result=await redraw(data,writeMol(g));}
    present(result,data);result.bondStyles=data.bondStyles||[];if(data.bondWidth!==undefined)result.bondWidth=data.bondWidth;if(data.atomFontSize!==undefined)result.atomFontSize=data.atomFontSize;if(data.labelGap!==undefined)result.labelGap=data.labelGap;return result;
  }
  async function erase(data,kind,index){const g=parseMol(data.molblock),keptAtoms=g.atoms.map((_,i)=>i).filter(i=>kind!=='atom'||i!==index);if(!keptAtoms.length)return {data:null,keptAtoms};const map=new Map(keptAtoms.map((v,i)=>[v,i])),keptBonds=g.bonds.map((_,i)=>i).filter(i=>(kind!=='bond'||i!==index)&&map.has(g.bonds[i].a)&&map.has(g.bonds[i].b));g.atoms=keptAtoms.map(i=>g.atoms[i]);g.bonds=keptBonds.map(i=>{const b=g.bonds[i],a=map.get(b.a),z=map.get(b.b);return {...b,a,b:z,line:String(a+1).padStart(3)+String(z+1).padStart(3)+b.line.slice(6)};});
    if(kind==='atom')g.tail=g.tail.map(line=>{const match=line.match(/^M  (CHG|ISO|RAD)\s+(\d+)\s+(.*)$/);if(!match)return line;const values=match[3].trim().split(/\s+/).map(Number),pairs=[];for(let i=0;i<values.length;i+=2)if(map.has(values[i]-1))pairs.push([map.get(values[i]-1)+1,values[i+1]]);return pairs.length?'M  '+match[1]+String(pairs.length).padStart(3)+pairs.map(p=>String(p[0]).padStart(4)+String(p[1]).padStart(4)).join(''):'';});
    const next=await redraw(data,writeMol(g)),bondMap=new Map(keptBonds.map((v,i)=>[v,i]));present(next,data);next.bondStyles=(data.bondStyles||[]).filter(s=>bondMap.has(s.index)).map(s=>({...s,index:bondMap.get(s.index)}));if(data.bondWidth!==undefined)next.bondWidth=data.bondWidth;if(data.atomFontSize!==undefined)next.atomFontSize=data.atomFontSize;return {data:next,keptAtoms};
  }
  async function moveAtom(data,index,point){const g=parseMol(data.molblock),a=g.atoms[index],site=data.atomSites[index],scale=data.drawScale||60;if(!a)throw new Error('原子不存在');const x=a.x+(point.x-site.x)/scale,y=a.y-(point.y-site.y)/scale;g.atoms[index].line=x.toFixed(4).padStart(10)+y.toFixed(4).padStart(10)+a.line.slice(20);const next=await redraw(data,writeMol(g));present(next,data);next.bondStyles=data.bondStyles||[];if(data.bondWidth!==undefined)next.bondWidth=data.bondWidth;if(data.atomFontSize!==undefined)next.atomFontSize=data.atomFontSize;return next;}
  async function merge(first,a,second,b,sites,style='single'){const g=parseMol(first.molblock),h=parseMol(second.molblock),offset=g.atoms.length,bondOffset=g.bonds.length;if(offset+h.atoms.length>400)throw new Error('合并后结构超过 400 个原子');const scale=first.drawScale||60,origin=g.atoms[0],anchor=first.atomSites[0];for(let i=0;i<h.atoms.length;i++){const atom=h.atoms[i],x=origin.x+(sites[i].x-anchor.x)/scale,y=origin.y-(sites[i].y-anchor.y)/scale;g.atoms.push({...atom,x,y,line:x.toFixed(4).padStart(10)+y.toFixed(4).padStart(10)+atom.line.slice(20)});}for(const bond of h.bonds)g.bonds.push({...bond,a:bond.a+offset,b:bond.b+offset,line:String(bond.a+offset+1).padStart(3)+String(bond.b+offset+1).padStart(3)+bond.line.slice(6)});
    const props=h.tail.filter(line=>line.trim()&&line.trim()!=='M  END').map(line=>{const match=line.match(/^M  (CHG|ISO|RAD)\s+(\d+)\s+(.*)$/);if(!match)throw new Error('该结构包含暂不支持合并的扩展属性');const values=match[3].trim().split(/\s+/).map(Number);return 'M  '+match[1]+String(values.length/2).padStart(3)+values.map((v,i)=>String(i%2?v:v+offset).padStart(4)).join('');});g.tail=[...g.tail.filter(line=>line.trim()&&line.trim()!=='M  END'),...props,'M  END',''];const order=style==='double'?2:style==='triple'?3:1,index=g.bonds.length;g.bonds.push({a,b:b+offset,order,line:bondLine(a,b+offset,order)});
    const next=await redraw(first,writeMol(g));present(next,first);next.bondStyles=[...(first.bondStyles||[]),...(second.bondStyles||[]).map(s=>({...s,index:s.index+bondOffset}))];if(['wedge','hashed','dashed','wavy'].includes(style))next.bondStyles.push({index,type:style});if(first.labelGap!==undefined)next.labelGap=first.labelGap;if(first.bondWidth!==undefined)next.bondWidth=first.bondWidth;if(first.atomFontSize!==undefined)next.atomFontSize=first.atomFontSize;return next;}
  async function addGroup(data,index,group){if(!['COOH','CHO','OH','NH2','CH3'].includes(group))throw new Error('不支持的基团');const g=parseMol(data.molblock),original=g.atoms[index];if(!original)throw new Error('请选择原子');const incident=g.bonds.filter(b=>b.a===index||b.b===index),reuse=incident.length<=1&&incident.every(b=>b.order===1),symbol=group==='OH'?'O':group==='NH2'?'N':'C';let cx=original.x,cy=original.y,theta=0,central=index;const lengths=g.bonds.map(b=>Math.hypot(g.atoms[b.a].x-g.atoms[b.b].x,g.atoms[b.a].y-g.atoms[b.b].y)).filter(x=>x>.01).sort((a,b)=>a-b),length=lengths.length?lengths[Math.floor(lengths.length/2)]:1.5;
    if(incident.length===1&&incident[0].order!==1)throw new Error('请先将末端连接键改为单键，再添加基团');if(incident.length){const other=g.atoms[incident[0].a===index?incident[0].b:incident[0].a];theta=Math.atan2(cy-other.y,cx-other.x);}if(!reuse){const mx=g.atoms.reduce((s,a)=>s+a.x,0)/g.atoms.length,my=g.atoms.reduce((s,a)=>s+a.y,0)/g.atoms.length;theta=Math.atan2(cy-my,cx-mx);cx+=length*Math.cos(theta);cy+=length*Math.sin(theta);central=g.atoms.length;g.atoms.push({x:cx,y:cy,symbol,line:atomLine(cx,cy,symbol)});g.bonds.push({a:index,b:central,order:1,line:bondLine(index,central)});}else{g.atoms[index]={...original,symbol,line:atomLine(original.x,original.y,symbol)};g.tail=g.tail.map(line=>{const match=line.match(/^M  (CHG|ISO|RAD)\s+(\d+)\s+(.*)$/);if(!match)return line;const values=match[3].trim().split(/\s+/).map(Number),pairs=[];for(let i=0;i<values.length;i+=2)if(values[i]!==index+1)pairs.push([values[i],values[i+1]]);return pairs.length?'M  '+match[1]+String(pairs.length).padStart(3)+pairs.map(p=>String(p[0]).padStart(4)+String(p[1]).padStart(4)).join(''):'';});}
    if(group==='COOH'||group==='CHO'){for(const [order,angle] of group==='COOH'?[[2,theta+Math.PI/3],[1,theta-Math.PI/3]]:[[2,theta+Math.PI/3]]){const x=cx+length*Math.cos(angle),y=cy+length*Math.sin(angle),id=g.atoms.length;g.atoms.push({x,y,symbol:'O',line:atomLine(x,y,'O')});g.bonds.push({a:central,b:id,order,line:bondLine(central,id,order)});}}
    const next=await redraw(data,writeMol(g));present(next,data);next.bondStyles=data.bondStyles||[];if(data.bondWidth!==undefined)next.bondWidth=data.bondWidth;if(data.atomFontSize!==undefined)next.atomFontSize=data.atomFontSize;if(data.atomFontSize!==undefined)next.atomFontSize=data.atomFontSize;return {data:next,index:central};
  }
  async function rotate(data,degrees,pivot={x:data.width/2,y:data.height/2}){const g=parseMol(data.molblock),scale=data.drawScale||60,origin=g.atoms[0],site=data.atomSites[0],cx=origin.x+(pivot.x-site.x)/scale,cy=origin.y-(pivot.y-site.y)/scale,r=-degrees*Math.PI/180,c=Math.cos(r),s=Math.sin(r);for(const a of g.atoms){const dx=a.x-cx,dy=a.y-cy,x=cx+dx*c-dy*s,y=cy+dx*s+dy*c;a.line=x.toFixed(4).padStart(10)+y.toFixed(4).padStart(10)+a.line.slice(20);}const next=await redraw(data,writeMol(g));present(next,data);next.bondStyles=data.bondStyles||[];for(const key of ['bondWidth','atomFontSize','labelGap','bondFragment'])if(data[key]!==undefined)next[key]=data[key];const first=parseMol(next.molblock).atoms[0];return {data:next,pivot:{x:next.atomSites[0].x+(cx-first.x)*next.drawScale,y:next.atomSites[0].y-(cy-first.y)*next.drawScale}};}
  function snapEndpoint(data,index,point,style='single',exclude=null){const sites=data.atomSites,a=sites[index];if(!a)throw new Error('原子位置无效');const bonds=data.bondSites||[],incident=bonds.filter(b=>(b.a===index||b.b===index)&&b.a!==exclude&&b.b!==exclude),neighbors=incident.map(b=>sites[b.a===index?b.b:b.a]),lengths=bonds.map(b=>Math.hypot(sites[b.a].x-sites[b.b].x,sites[b.a].y-sites[b.b].y)).filter(x=>x>.01).sort((a,b)=>a-b),length=lengths.length?lengths[Math.floor(lengths.length/2)]:60,desired=Math.atan2(point.y-a.y,point.x-a.x),difference=t=>Math.abs(Math.atan2(Math.sin(t-desired),Math.cos(t-desired)));let candidates=[];
    if(neighbors.length===1){const t=Math.atan2(neighbors[0].y-a.y,neighbors[0].x-a.x);candidates=style==='triple'||incident[0].order===3?[t+Math.PI]:[t+2*Math.PI/3,t-2*Math.PI/3];}
    else if(neighbors.length===2){let x=0,y=0;for(const b of neighbors){const d=Math.hypot(b.x-a.x,b.y-a.y)||1;x-=(b.x-a.x)/d;y-=(b.y-a.y)/d;}if(Math.hypot(x,y)>.05)candidates=[Math.atan2(y,x)];else{const t=Math.atan2(neighbors[0].y-a.y,neighbors[0].x-a.x);candidates=[t+Math.PI/2,t-Math.PI/2];}}
    else if(neighbors.length>2){const angles=neighbors.map(b=>Math.atan2(b.y-a.y,b.x-a.x)).sort((a,b)=>a-b);let largest=0;for(let i=0;i<angles.length;i++){const start=angles[i],end=i+1<angles.length?angles[i+1]:angles[0]+2*Math.PI,gap=end-start;if(gap>largest+.01){largest=gap;candidates=[(start+end)/2];}else if(Math.abs(gap-largest)<.01)candidates.push((start+end)/2);}}
    else candidates=[Math.round(desired/(Math.PI/6))*Math.PI/6];const angle=candidates.sort((a,b)=>difference(a)-difference(b))[0];return {x:a.x+length*Math.cos(angle),y:a.y+length*Math.sin(angle)};
  }
  function chainOrder(chain,start){
    if(chain.smiles!=='CCCC')throw new Error('请选择四碳链');
    const order=[start];
    while(order.length<chain.atoms){
      const atom=order.at(-1);
      const neighbors=chain.bondSites.flatMap(b=>b.a===atom?[b.b]:b.b===atom?[b.a]:[]).filter(i=>!order.includes(i));
      if(neighbors.length!==1)throw new Error('请使用短碳链的末端连接');
      order.push(neighbors[0]);
    }
    return order;
  }
  function carbonChainSites(data,index,point,chain,start=0,free=false){
    const order=chainOrder(chain,start),anchor=data.atomSites[index];
    const origin=snapEndpoint(data,index,point);
    const length=Math.hypot(origin.x-anchor.x,origin.y-anchor.y);
    const heading=free?Math.atan2(point.y-anchor.y,point.x-anchor.x):Math.atan2(origin.y-anchor.y,origin.x-anchor.x);
    const first={x:anchor.x+length*Math.cos(heading),y:anchor.y+length*Math.sin(heading)};
    const requested=Math.atan2(point.y-anchor.y,point.x-anchor.x);
    const outward=Math.sin(requested-heading)<0?-1:1;
    const makeSites=side=>{
      const sites=[];
      sites[start]=first;
      for(let step=1;step<order.length;step++){
        const previous=sites[order[step-1]],angle=heading+(step%2?side*Math.PI/3:0);
        sites[order[step]]={x:previous.x+length*Math.cos(angle),y:previous.y+length*Math.sin(angle)};
      }
      return sites;
    };
    const nearAtoms=sites=>sites.reduce((count,p)=>count+data.atomSites.filter(q=>Math.hypot(p.x-q.x,p.y-q.y)<length*.55).length,0);
    const preferred=makeSites(outward),alternate=makeSites(-outward);
    return nearAtoms(alternate)<nearAtoms(preferred)?alternate:preferred;
  }
  async function extendCarbonChain(data,index,point,chain,start=0,free=false){
    const sites=carbonChainSites(data,index,point,chain,start,free);
    return merge(data,index,chain,start,sites);
  }
  async function tidy(data){const g=parseMol(data.molblock),degree=g.atoms.map((_,i)=>g.bonds.filter(b=>b.a===i||b.b===i).length),scale=data.drawScale||60;for(let i=0;i<g.atoms.length;i++){if(degree[i]!==1)continue;const bond=g.bonds.find(b=>b.a===i||b.b===i),parent=bond.a===i?bond.b:bond.a;if(degree[parent]<2)continue;const point=snapEndpoint(data,parent,data.atomSites[i],bond.order===3?'triple':bond.order===2?'double':'single',i),old=data.atomSites[i],a=g.atoms[i],x=a.x+(point.x-old.x)/scale,y=a.y-(point.y-old.y)/scale;a.line=x.toFixed(4).padStart(10)+y.toFixed(4).padStart(10)+a.line.slice(20);}const next=await redraw(data,writeMol(g));if(next.smiles!==data.smiles)throw new Error('整理会改变立体表示，已保留原结构');present(next,data);next.bondStyles=data.bondStyles||[];return next;}
  const api={assetBase,load,svgPaths,generate,toMol,parseMol,connect,changeAtom,atomLabel,attachRing,fuseRing,erase,moveAtom,merge,addGroup,rotate,snapEndpoint,carbonChainSites,extendCarbonChain,renderAtomText,renderPublicationStyle,tidy};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PathwayChemistry=api;
})(globalThis);
