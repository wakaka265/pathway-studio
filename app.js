/* Browser controller for the local-first manual editor. */
(() => {
  'use strict';
  const C=PathwayCore,$=id=>document.getElementById(id),canvas=$('canvas'),stage=$('stage');
  const STORAGE='pathway-studio.project.v1';
  const EXAMPLE_STORAGE='pathway-studio.examples.v1';
  const exampleNames=[['metabolism','代谢路径示例'],['cycle','圆环编辑示例'],['biology','细胞器与微生物示例'],['chemical','化学结构途径示例']];
  let savedExamples=new Map();
  try{
    const stored=JSON.parse(localStorage.getItem(EXAMPLE_STORAGE)||'{}');
    for(const [key,entry] of Object.entries(stored)){
      try{
        const snapshot=C.validateProject({...C.emptyProject(),fontFamily:entry.fontFamily,boards:[entry.board]});
        savedExamples.set(key,{board:snapshot.boards[0],fontFamily:snapshot.fontFamily});
      }catch{}
    }
  }catch{}
  let project=C.demoProject(),boardId,selection=new Set(),tool='select',sourceId=null,drag=null,space=false,clipboard=null;
  let history=[],historyIndex=0,camera={x:0,y:0,w:1200,h:820},lastSize={w:0,h:0},inlineText=null,toastTimer,autoFit=true;
  let pendingCycle=null,cyclePointer=null,pendingIllustration=null,activeCofactor=null,activeKnockout=false,quickMenu=null,lastTextTap=null;
  const textMetrics=document.createElement('canvas').getContext('2d');
  C.setTextMeasurer((label,size,font,bold,italic)=>C.labelRuns(label).reduce((sum,run)=>{textMetrics.font=(italic?'italic ':'')+(bold?'700 ':'400 ')+(run.script&&run.script!=='normal'?size*.7:size)+'px '+font;return sum+textMetrics.measureText(run.text).width;},0));
  let pendingMolecule=null,chemicalTarget=null,chemicalPreview=null,chemicalRevision=0,chemicalLoading=null;
  let chemicalMode='draw',sketchReady=false,sketchSession=0,sketchMol='',sketchTimer=null;
  let sketchAction='202',pendingBondStyle='wedge';
  let chemicalToolRevision=0,chemicalDropPoint=null,chemicalToolLocked=false;
  const chemicalMetadata=new Map();let activeChemicalAtom=null,chemicalEditPending=false,atomTyping=null;
  let pendingChemicalGroup='COOH',atomEditorTarget=null,lastAtomTap=null;
  const cofactorPairs=[['NAD^{+}','NADH'],['NADP^{+}','NADPH'],['ATP','ADP'],['ADP','ATP'],['FAD','FADH_{2}'],['Q','QH_{2}']];
  const commonCofactors=['NAD^{+}','NADH','NADP^{+}','NADPH','ATP','ADP','AMP','P_{i}','PP_{i}','FAD','FADH_{2}','CoA','H_{2}O','H^{+}','CO_{2}','Q','QH_{2}'];
  const chemicalRingTools={'206':[3,false],'207':[4,false],'208':[5,false],'210':[6,false],'209':[6,true]};
  const atomFontOptions=[['','默认'],[C.STRUCTURE_FONT,'Arial'],['Times New Roman, serif','Times New Roman'],['Calibri, sans-serif','Calibri'],['Cambria, serif','Cambria'],['Consolas, monospace','Consolas']];
  const displayFormula=s=>C.esc(s).replace(/_\{([^}]*)\}/g,'<sub>$1</sub>').replace(/\^\{([^}]*)\}/g,'<sup>$1</sup>');
  let recovered=false,storageAvailable=true;
  try { const raw=localStorage.getItem(STORAGE);if(raw){project=C.validateProject(JSON.parse(raw));recovered=true;} }catch{storageAvailable=false;}
  boardId=project.boards[0].id;history=[C.clone(project)];
  try{const saved=JSON.parse(sessionStorage.getItem(STORAGE+'.history')||'null');if(saved&&Array.isArray(saved.states)&&saved.states.length<=30&&Number.isInteger(saved.index)&&saved.index>=0&&saved.index<saved.states.length&&JSON.stringify(saved.states[saved.index])===JSON.stringify(project)){history=saved.states.map(C.validateProject);historyIndex=saved.index;if(project.boards.some(b=>b.id===saved.boardId))boardId=saved.boardId;}}catch{}
  try{const active=sessionStorage.getItem(STORAGE+'.activeBoard');if(project.boards.some(b=>b.id===active))boardId=active;}catch{}
  const board=()=>project.boards.find(b=>b.id===boardId)||project.boards[0];
  const selectedNodes=()=>board().nodes.filter(n=>selection.has(n.id));
  const selectedEdge=()=>selection.size===1?board().edges.find(e=>selection.has(e.id)):null;
  const getObject=id=>board().nodes.find(n=>n.id===id)||board().edges.find(e=>e.id===id);
  const isReactionTool=()=>tool==='reaction'||tool==='right-route';
  function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200);}
  function persist(){try{localStorage.setItem(STORAGE,JSON.stringify(project));storageAvailable=true;$('save-state').textContent='已自动保存到本机';}catch{storageAvailable=false;$('save-state').textContent='自动保存不可用，请保存项目文件';}try{const start=Math.max(0,historyIndex-29);sessionStorage.setItem(STORAGE+'.history',JSON.stringify({states:history.slice(start,start+30),index:historyIndex-start,boardId}));}catch{}}
  function commit(message,keepInspector=false){C.syncMembraneChannels(board());const state=JSON.stringify(project);if(state!==JSON.stringify(history[historyIndex])){history=history.slice(0,historyIndex+1);history.push(C.clone(project));if(history.length>100)history.shift();historyIndex=history.length-1;persist();}if(keepInspector){renderCanvas();renderQuickActions();$('undo').disabled=historyIndex===0;$('redo').disabled=historyIndex===history.length-1;}else render();if(message)toast(message);}
  function update(fn,message,keepInspector=false){fn();commit(message,keepInspector);}
  function undo(){if($('chemical-dialog').open){sendSketchCommand('undo');return;}if(historyIndex>0){project=C.clone(history[--historyIndex]);afterHistory();}}
  function redo(){if($('chemical-dialog').open){sendSketchCommand('redo');return;}if(historyIndex<history.length-1){project=C.clone(history[++historyIndex]);afterHistory();}}
  function afterHistory(){activeChemicalAtom=null;if(!project.boards.some(b=>b.id===boardId))boardId=project.boards[0].id;selection.clear();sourceId=null;activeCofactor=null;activeKnockout=false;quickMenu=null;pendingCycle=null;cyclePointer=null;if(tool!=='chemical'||!chemicalToolLocked)tool='select';persist();render();}
  function world(e){const r=canvas.getBoundingClientRect();return{x:camera.x+(e.clientX-r.left)*camera.w/r.width,y:camera.y+(e.clientY-r.top)*camera.h/r.height};}
  function snap(v){return $('snap').checked?Math.round(v/10)*10:v;}
  function arrowPoint(p){
    const b=board();
    return {x:C.clamp(snap(p.x),0,b.width),y:C.clamp(snap(p.y),0,b.height)};
  }
  function fit(){autoFit=true;const r=stage.getBoundingClientRect(),b=board(),scale=Math.min((r.width-50)/b.width,(r.height-104)/b.height);const s=Math.max(.05,scale);camera={x:(b.width-r.width/s)/2,y:(b.height-r.height/s)/2,w:r.width/s,h:r.height/s};renderCanvas();}
  function zoom(factor,focus){autoFit=false;const p=focus||{x:camera.x+camera.w/2,y:camera.y+camera.h/2};const scale=stage.clientWidth/camera.w;factor=C.clamp(scale*factor,.06,5)/scale;camera={x:p.x-(p.x-camera.x)/factor,y:p.y-(p.y-camera.y)/factor,w:camera.w/factor,h:camera.h/factor};renderCanvas();}
  function setTool(value){if($('chemical-dialog').open)return;chemicalToolLocked=false;chemicalToolRevision++;chemicalDropPoint=null;activeChemicalAtom=null;tool=value;sourceId=null;pendingCycle=null;cyclePointer=null;pendingMolecule=null;quickMenu=null;render();}
  function scaleFrame(){
    if(tool!=='select'||!selection.size)return null;
    const n=selection.size===1?selectedNodes()[0]:null;
    if(n&&(n.chemicalBond||['membrane','illustration','module'].includes(n.kind)||
       (n.molecule?n.molecule.display!=='name':!['none','point'].includes(n.shape))))return null;
    return C.selectionScaleFrame(board(),selection);
  }
  function selectionMarkup(){let out='';const zoom=stage.clientWidth/camera.w,stroke=1.3/zoom,rad=4.5/zoom;
    const frame=scaleFrame(),groupScale=frame&&selection.size>1;
    const rotating=drag?.handle==='molecule-rotate',bondTool=!rotating&&isChemicalDrawingTool(),movingBond=drag?.type==='nodes'&&[...drag.ids].some(id=>getObject(id)?.chemicalBond);
    const singleMoleculeEdit=!rotating&&tool==='select'&&selection.size===1;
    for(const n of board().nodes.filter(n=>n.molecule&&n.molecule.display!=='name')){const m=moleculeMetadata(n);if(!m?.bondSites||!(bondTool||singleMoleculeEdit&&selection.has(n.id)))continue;for(let i=0;i<m.bondSites.length;i++){const b=m.bondSites[i],a=C.moleculeAtomPosition(n,b.a,m),z=C.moleculeAtomPosition(n,b.b,m);out+=`<path data-chem-bond="${i}" data-chem-owner="${n.id}" d="M${a.x} ${a.y}L${z.x} ${z.y}" stroke="transparent" stroke-width="${11/zoom}" fill="none" style="cursor:crosshair"><title>化学键 ${i+1} · 点选键型可修改；选环后点击可拼环</title></path>`;}}
    for(const n of board().nodes.filter(n=>n.molecule&&n.molecule.display!=='name')){const m=moleculeMetadata(n);if(!m?.atomSites||!(bondTool||movingBond||singleMoleculeEdit&&selection.has(n.id)))continue;for(let i=0;i<m.atomSites.length;i++){const p=C.moleculeAtomPosition(n,i,m),active=activeChemicalAtom?.owner===n.id&&activeChemicalAtom.index===i;out+=`<circle data-chem-atom="${i}" data-chem-owner="${n.id}" cx="${p.x}" cy="${p.y}" r="${active?5.5/zoom:3.7/zoom}" fill="${active?'var(--guide-tint)':'#ffffff01'}" stroke="var(--guide)" stroke-width="${1.1/zoom}" style="cursor:crosshair"><title>原子 ${i+1} · 输入元素字母，或用键工具拖出连接</title></circle>`;}}
    if(drag?.type==='chemical-link'||drag?.type==='chemical-atom-move'){
      const n=getObject(drag.owner),a=C.moleculeAtomPosition(n,drag.atom,moleculeMetadata(n));
      const path=[a,...(drag.preview||[drag.current])].map(p=>p.x+' '+p.y).join(' L');
      out+=`<path d="M${path}" stroke="var(--guide)" stroke-width="${1.8/zoom}" stroke-dasharray="${4/zoom} ${3/zoom}" fill="none" pointer-events="none"/>`;
    }
    for(const n of frame?[]:selectedNodes()){
      if(drag?.handle==='molecule-rotate'&&drag.owner===n.id){out+=`<path d="M${drag.pivot.x} ${drag.pivot.y}L${drag.current.x} ${drag.current.y}" stroke="var(--guide)" stroke-width="${stroke}" stroke-dasharray="${4/zoom} ${3/zoom}"/><circle cx="${drag.current.x}" cy="${drag.current.y}" r="${rad*1.2}" fill="white" stroke="var(--guide)"/>`;continue;}
      if(n.molecule&&n.molecule.display!=='name'){
        const box=C.moleculeGraphicBounds(n),x=(box.left+box.right)/2,y=box.top-24/zoom,pad=5/zoom;
        out+=`<rect x="${box.left-pad}" y="${box.top-pad}" width="${box.right-box.left+2*pad}" height="${box.bottom-box.top+2*pad}" fill="none" stroke="var(--guide)" stroke-width="${stroke}" stroke-dasharray="${4/zoom} ${3/zoom}" pointer-events="none"/>`;
        if(!singleMoleculeEdit)continue;
        out+=`<rect data-handle="molecule-resize" data-owner="${n.id}" x="${box.right+pad-rad}" y="${box.bottom+pad-rad}" width="${rad*2}" height="${rad*2}" fill="white" stroke="var(--guide)" stroke-width="${stroke}" cursor="nwse-resize"><title>拖动缩放化学结构</title></rect>`;
        out+=`<path d="M${x} ${box.top-pad}V${y}" stroke="var(--guide)" stroke-width="${stroke}" pointer-events="none"/><circle data-handle="molecule-rotate" data-owner="${n.id}" cx="${x}" cy="${y}" r="${rad*1.2}" fill="white" stroke="var(--guide)" stroke-width="${stroke}"><title>拖动旋转化学结构</title></circle>`;
        continue;
      }
      const {w,h}=C.bounds(n);
      out+=`<rect x="${n.x-w/2-6}" y="${n.y-h/2-6}" width="${w+12}" height="${h+12}" fill="none" stroke="var(--guide)" stroke-width="${stroke}" stroke-dasharray="${4/zoom} ${3/zoom}" pointer-events="none"/>`;
      if(n.chemicalBond||['membrane','illustration'].includes(n.kind)){const angle=(n.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),rx=n.x+n.w/2*c-n.h/2*s,ry=n.y+n.w/2*s+n.h/2*c,top={x:n.x+n.h/2*s,y:n.y-n.h/2*c},handle={x:n.x+(n.h/2+24/zoom)*s,y:n.y-(n.h/2+24/zoom)*c};out+=`<rect data-handle="resize" data-owner="${n.id}" x="${rx-rad}" y="${ry-rad}" width="${rad*2}" height="${rad*2}" fill="white" stroke="var(--guide)" stroke-width="${stroke}"/>`;if(!n.membraneId)out+=`<path d="M${top.x} ${top.y} L${handle.x} ${handle.y}" fill="none" stroke="var(--guide)" stroke-width="${stroke}"/><circle data-handle="rotate" data-owner="${n.id}" cx="${handle.x}" cy="${handle.y}" r="${rad*1.2}" fill="white" stroke="var(--guide)" stroke-width="${stroke}"><title>拖动旋转</title></circle>`;}
      else if((n.kind==='module'||!['none','point'].includes(n.shape))&&!(n.molecule&&n.molecule.display==='name'))out+=`<rect data-handle="resize" data-owner="${n.id}" x="${n.x+w/2-rad}" y="${n.y+h/2-rad}" width="${rad*2}" height="${rad*2}" fill="white" stroke="var(--guide)" stroke-width="${stroke}"/>`;
    }
    for(const e of board().edges.filter(e=>selection.has(e.id))){const g=C.geometry(e,board());if(!g)continue;
      const showLineControls=!e.cofactors.some(cf=>cf.id===activeCofactor);
      out+=`<path d="${g.path}" fill="none" stroke="#53a5df" stroke-opacity=".18" stroke-width="${7/zoom}" pointer-events="none"/>`;
      if(groupScale)continue;
      if(showLineControls&&e.mode==='curve')out+=`<path d="M${g.a.x},${g.a.y} L${g.c1.x},${g.c1.y} M${g.z.x},${g.z.y} L${g.c2.x},${g.c2.y}" stroke="#78aee0" stroke-dasharray="4 4" stroke-width="${stroke}" fill="none" pointer-events="none"/>`;
      if(showLineControls&&!isReactionTool())for(const h of g.handles)out+=`<circle data-handle="${h.type}" data-owner="${e.id}" data-index="${h.index??0}" cx="${h.x}" cy="${h.y}" r="${rad}" fill="white" stroke="#428ac1" stroke-width="${stroke*1.5}" cursor="move"><title>${h.type==='point'?`拖动第 ${h.index+1} 个转角`:'拖动调整线路'}</title></circle>`;
      if(C.isFreeArrow(e))for(const key of ['start','end']){
        const p=e[key];
        out+=`<circle data-handle="${key}" data-owner="${e.id}" cx="${p.x}" cy="${p.y}" r="${rad}" fill="white" stroke="var(--guide)" stroke-width="${stroke*1.5}" cursor="move"><title>${key==='start'?'拖动起点':'拖动终点'}</title></circle>`;
      }
      for(const cf of e.cofactors){
        const q=C.cofactorGeometry(e,g,cf);
        out+=`<circle data-handle="cofactor" data-owner="${e.id}" data-cf="${cf.id}" cx="${q.x}" cy="${q.y}" r="${rad}" fill="#fff6df" stroke="#c28d32" stroke-width="${stroke*1.5}" cursor="move"><title>拖动侧支中点</title></circle>`;
        if(tool!=='select'||cf.id!==activeCofactor)continue;
        const cursor=Math.abs(q.output.x-q.input.x)>=Math.abs(q.output.y-q.input.y)?'ew-resize':'ns-resize';
        const away=q.labelOffset,d=Math.hypot(away.x,away.y)||1,shift=5/zoom;
        for(const [index,p] of [q.input,q.output].entries())out+=`<circle data-handle="cofactor-spread" data-owner="${e.id}" data-cf="${cf.id}" data-index="${index}" cx="${p.x-away.x/d*shift}" cy="${p.y-away.y/d*shift}" r="${rad*.86}" fill="white" stroke="#c28d32" stroke-width="${stroke*1.5}" cursor="${cursor}"><title>拖动调整支路开口宽度</title></circle>`;
      }
    }
    if(frame){
      const pad=9/zoom,{left,right,top,bottom}=frame;
      out+=`<rect x="${left-pad}" y="${top-pad}" width="${right-left+2*pad}" height="${bottom-top+2*pad}" fill="none" stroke="var(--guide)" stroke-width="${stroke}" stroke-dasharray="${5/zoom} ${4/zoom}" pointer-events="none"/>`;
      out+=`<rect data-handle="selection-scale" x="${right+pad-rad}" y="${bottom+pad-rad}" width="${rad*2}" height="${rad*2}" fill="white" stroke="var(--guide)" stroke-width="${stroke}" cursor="nwse-resize"><title>拖动以等比例缩放选区</title></rect>`;
    }
    if(sourceId){const n=board().nodes.find(n=>n.id===sourceId),b=C.bounds(n);out+=`<rect x="${n.x-b.w/2-9}" y="${n.y-b.h/2-9}" width="${b.w+18}" height="${b.h+18}" rx="7" stroke="var(--guide)" fill="var(--guide-tint)" stroke-width="2" pointer-events="none"/>`;}
    if(drag?.type==='marquee'){const x=Math.min(drag.start.x,drag.current.x),y=Math.min(drag.start.y,drag.current.y);out+=`<rect x="${x}" y="${y}" width="${Math.abs(drag.start.x-drag.current.x)}" height="${Math.abs(drag.start.y-drag.current.y)}" fill="var(--guide-tint)" stroke="var(--guide)" stroke-width="${stroke}" pointer-events="none"/>`;}
    if(tool==='cycle'&&pendingCycle&&cyclePointer){const p=cyclePlacement(cyclePointer);out+=`<g pointer-events="none" opacity=".5" transform="translate(${p.x} ${p.y})">${C.renderBoard(pendingCycle,'ghost-')}</g>`;}
    if(drag?.type==='draw-arrow'&&drag.moved){
      const {arrow}=drag;
      if(Math.hypot(arrow.end.x-arrow.start.x,arrow.end.y-arrow.start.y)>=.01){
        out+='<g pointer-events="none" opacity=".65">'+C.renderEdge(arrow,board(),'draft-')+'</g>';
      }
    }
    return out;
  }
  function renderCanvas(){C.setDefaultFont(project.fontFamily);const original=board(),b=drag?.handle==='molecule-rotate'?{...original,nodes:original.nodes.map(n=>n.id===drag.owner?{...n,previewRotation:drag.rotationDelta||0,previewPivot:drag.pivot}:n)}:original;canvas.setAttribute('viewBox',`${camera.x} ${camera.y} ${camera.w} ${camera.h}`);canvas.setAttribute('font-family',project.fontFamily||C.FONT);
    canvas.innerHTML=`<defs><filter id="paper-shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="5" stdDeviation="10" flood-color="#294767" flood-opacity=".08"/></filter><clipPath id="paper-clip"><rect width="${b.width}" height="${b.height}"/></clipPath></defs><rect width="${b.width}" height="${b.height}" fill="white" stroke="var(--line)" stroke-width="1" filter="url(#paper-shadow)"/><g clip-path="url(#paper-clip)">${C.renderBoard(b,'edit-',true)}</g><g id="editing-overlay">${selectionMarkup()}</g>`;
    $('zoom-value').textContent=Math.round(stage.clientWidth/camera.w*100)+'%';canvas.style.cursor=tool==='pan'||space?'grab':tool==='select'?'default':'crosshair';
    const arrows=b.edges.filter(C.isFreeArrow).length;
    $('object-count').textContent=`${b.nodes.filter(n=>n.kind==='metabolite').length} 个代谢物 · ${b.edges.length-arrows} 条反应${arrows?' · '+arrows+' 个箭头':''}${b.nodes.some(n=>['membrane','illustration'].includes(n.kind))?' · '+b.nodes.filter(n=>['membrane','illustration'].includes(n.kind)).length+' 个图形':''}`;
    $('selection-status').textContent=selection.size?`已选择 ${selection.size} 个对象`:'未选择对象';positionTextEditor();
  }
  function render(){renderCanvas();renderInspector();renderQuickActions();$('project-name').value=project.name;$('undo').disabled=historyIndex===0;$('redo').disabled=historyIndex===history.length-1;
    if(tool!=='select'&&window.innerWidth<=650)document.querySelector('.inspector').classList.remove('open');
    if(!$('chemical-dialog').open)markChemicalTool();
    $('copy-button').disabled=selection.size===0;$('paste-button').disabled=!clipboard;
    try{sessionStorage.setItem(STORAGE+'.activeBoard',boardId);}catch{}
    document.querySelectorAll('[data-tool]').forEach(el=>el.classList.toggle('active',el.dataset.tool===tool));
    $('board-list').innerHTML=project.boards.map((b,i)=>`<div class="board-item ${b.id===boardId?'active':''}" data-board="${b.id}" role="tab" aria-selected="${b.id===boardId}" title="${C.esc(b.name)}" tabindex="0"><span class="board-number">${String(i+1).padStart(2,'0')}</span><span class="board-name">${C.esc(b.name)}</span><button data-delete-board="${b.id}" title="删除画板" aria-label="删除画板 ${C.esc(b.name)}">×</button></div>`).join('');
    $('board-caption').textContent=`FIGURE ${String(project.boards.findIndex(b=>b.id===boardId)+1).padStart(2,'0')} / ${board().name}`;$('paper-size').textContent=`${board().width} × ${board().height} px`;
    $('tool-hint').textContent=canvas.querySelector('[data-handle="selection-scale"]')?'拖动右下角方块 · 按比例缩放选区':tool==='arrow'?'从起点拖到终点绘制箭头 · Esc 取消':tool==='cycle'?'点击画布，一次放置整条环形途径 · Esc 取消':isReactionTool()?(sourceId?'点击产物节点完成连线 · Esc 取消':'依次点击底物和产物节点 · Esc 取消'):tool==='select'?(selectedNodes().some(n=>n.molecule)?'点原子输入元素 · 选键工具拖出连接 · 选环后点击已有键拼环':'拖动箭头或辅因子上的文字调整位置 · 双击编辑'):tool==='pan'?'拖动画布平移 · 滚轮缩放':tool==='rounded'?'点击代谢物、结构或辅因子名称添加高亮 · Esc 取消':tool==='metabolite'?'点击已有代谢物更改样式 · 点击空白处新建':'点击画布放置组件 · Esc 返回选择';
  }
  function renderQuickActions(){const e=selectedEdge(),host=$('reaction-actions'),n=selection.size===1?selectedNodes()[0]:null;if(n?.chemicalBond){host.hidden=false;host.innerHTML='<div class="quick-action-row"><span>'+C.CHEMICAL_BONDS[n.chemicalBond]+'</span><button data-bond-turn="-15">左转15°</button><button data-bond-turn="15">右转15°</button><button data-bond-turn="180">翻转方向</button></div>';return;}if(n?.molecule){host.hidden=false;host.innerHTML='<div class="quick-action-row"><span>化学结构</span><button data-molecule-action="edit">编辑结构</button><button data-molecule-tidy="true">整理键角</button><button data-molecule-action="both">结构＋名称</button><button data-molecule-action="structure">仅结构</button><button data-molecule-action="name">仅名称</button><button data-molecule-rotate="-15">左转15°</button><button data-molecule-rotate="15">右转15°</button><button data-molecule-rotate="90">转90°</button></div>';return;}if(n&&['membrane','illustration'].includes(n.kind)){host.hidden=false;host.innerHTML=`<div class="quick-action-row"><span>${n.kind==='membrane'?'细胞膜':C.ILLUSTRATIONS[n.template].name}</span><button data-component-rotate="-15">左转15°</button><button data-component-rotate="15">右转15°</button><button data-component-rotate="90">转90°</button><label>角度 <input data-component-prop="rotation" type="number" min="0" max="360" value="${Math.round(n.rotation||0)}" aria-label="组件旋转角度"></label><label>填充 <input data-component-prop="fill" type="color" value="${n.fill==='none'?'#ffffff':n.fill}" aria-label="组件填充颜色"></label><label>线条 <input data-component-prop="stroke" type="color" value="${n.stroke}" aria-label="组件线条颜色"></label><button data-component-fill="#c9def2">浅蓝</button><button data-component-fill="#dcebcf">浅绿</button></div>`;return;}host.hidden=!e;if(!e)return;
    if(C.isFreeArrow(e)){
      const directions=[['forward','单向'],['both','双向'],['none','无箭头']];
      host.innerHTML='<div class="quick-action-row"><span>独立箭头</span>'+
        directions.map(([value,label])=>'<button data-quick="'+value+'" class="'+(e.direction===value?'active':'')+'">'+label+'</button>').join('')+
        '<button data-quick="arrow-horizontal">水平</button><button data-quick="arrow-vertical">垂直</button>'+
        '<button data-quick="reverse">反向</button><button data-quick="arrow-label">文字标注</button></div>';
      return;
    }
    const cf=e.cofactors.find(c=>c.id===activeCofactor),o=cf||e;if(!cf&&activeKnockout&&e.knockout){host.innerHTML='<div class="quick-action-row"><span>敲除标记</span><button data-quick="edit-knockout">编辑文字</button><button data-quick="remove-knockout" class="danger">移除敲除</button><button data-quick="main">主反应</button><button data-quick="undo">撤销</button></div>';return;}host.innerHTML=`<div class="quick-action-row"><span>${cf?'辅因子支路':'反应箭头'}</span><button data-quick="forward" class="${o.direction!=='both'?'active':''}">单向</button><button data-quick="both" class="${o.direction==='both'?'active':''}">双向</button><button data-quick="pairs">${cf?'更换组合':'＋ 辅因子'}</button>${!cf?`<button data-quick="knockout" class="${e.knockout?'active':''}">${e.knockout?'取消敲除':'× 敲除标记'}</button><button data-quick="right-route" title="应用右侧圆角绕行">右侧绕行</button>`:''}${cf?'<button data-quick="auto-layout">自适应</button><button data-quick="remove-cf" class="danger">删除辅因子</button><button data-quick="main">主反应</button>':''}<button data-quick="undo" ${historyIndex===0?'disabled':''}>撤销</button></div>`;
    if(quickMenu==='pairs')host.innerHTML+=`<div class="quick-palette"><p>${cf?'点击更换两端的辅因子':'点击组合，立即添加侧支'}</p>${cofactorPairs.map((p,i)=>`<button data-pair="${i}">${displayFormula(p[0])} / ${displayFormula(p[1])}</button>`).join('')}<button data-quick="custom">自定义</button></div>`;
    if(cf&&['input','output'].includes(quickMenu))host.innerHTML+=`<div class="quick-palette"><p>更换${quickMenu==='input'?'底物端':'产物端'}辅因子</p><button data-quick="edit-cofactor-text">编辑文字和字体</button><button data-quick="toggle-cofactor-highlight" aria-pressed="${!!cf[quickMenu+'Highlight']}">${cf[quickMenu+'Highlight']?'取消高亮':'高亮此名称'}</button>${commonCofactors.map((s,i)=>`<button data-common="${i}">${displayFormula(s)}</button>`).join('')}<div class="quick-custom"><input id="quick-custom-value" aria-label="自定义辅因子名称" value="${C.esc(cf[quickMenu])}"><button data-quick="apply-name">应用</button></div></div>`;
  }
  $('reaction-actions').addEventListener('click',ev=>{const button=ev.target.closest('button');if(!button)return;const n=selection.size===1?selectedNodes()[0]:null;if(n?.chemicalBond&&button.dataset.bondTurn){update(()=>n.rotation=((n.rotation||0)+Number(button.dataset.bondTurn)+360)%360);return;}if(n?.molecule&&button.dataset.moleculeTidy){tidyChemical(n.id);return;}if(n?.molecule&&button.dataset.moleculeRotate){rotateChemical(n.id,Number(button.dataset.moleculeRotate));return;}if(n?.molecule){const mode=button.dataset.moleculeAction;if(mode==='edit')editChemicalOnCanvas(n.id);else if(['both','structure','name'].includes(mode))update(()=>n.molecule.display=mode);return;}if(n&&['membrane','illustration'].includes(n.kind)){if(button.dataset.componentRotate)update(()=>n.rotation=((n.rotation||0)+Number(button.dataset.componentRotate)+360)%360);if(button.dataset.componentFill)update(()=>n.fill=button.dataset.componentFill);return;}const e=selectedEdge();if(!e)return;const cf=e.cofactors.find(c=>c.id===activeCofactor),action=button.dataset.quick;
    if(action==='reverse'){actions.reverse();return;}
    if(action==='right-route'){
      const preset=C.rightRoutePreset(board(),e.source,e.target);
      if(!preset)return toast('右侧或下方空间不足，请调整节点位置后再试');
      quickMenu=null;
      update(()=>Object.assign(e,preset),'已应用右侧圆角绕行');
      return;
    }
    if(action==='arrow-label'){editText(e.id);return;}
    if(C.isFreeArrow(e)&&(action==='arrow-horizontal'||action==='arrow-vertical')){
      update(()=>C.alignFreeArrow(e,board(),action==='arrow-horizontal'?'x':'y'));
      return;
    }
    if(['forward','both','none'].includes(action)){update(()=>(cf||e).direction=action);return;}
    if(action==='pairs'){quickMenu=quickMenu==='pairs'?null:'pairs';renderQuickActions();return;}
    if(action==='knockout'){knockout();return;}
    if(action==='main'){activeCofactor=null;activeKnockout=false;quickMenu=null;render();return;}
    if(action==='edit-knockout'){editText(e.id,{knockout:true});return;}
    if(action==='remove-knockout'){removeKnockout();return;}
    if(action==='undo'){undo();return;}
    if(action==='remove-cf'){removeCofactor();return;}
    if(action==='edit-cofactor-text'&&cf&&['input','output'].includes(quickMenu)){
      editText(e.id,{cf:cf.id,endpoint:quickMenu});return;
    }
    if(action==='toggle-cofactor-highlight'&&cf&&['input','output'].includes(quickMenu)){
      setCofactorHighlight(e,cf,quickMenu,!cf[quickMenu+'Highlight']);
      return;
    }
    if(action==='auto-layout'&&cf){let result;update(()=>result=C.layoutCofactor(board(),e,cf));toast(result.reflowed?'已沿圆周留出空间，辅因子直接接入主反应':result.clear?'已将辅因子直接接入主反应':'反应附近空间不足，未移动支路；请扩大分区或先调整相邻节点');return;}
    if(button.dataset.pair!==undefined){const pair=cofactorPairs[Number(button.dataset.pair)];quickMenu=null;if(cf)editCofactor(e,cf,{input:pair[0],output:pair[1]});else addCofactor(pair);return;}
    if(button.dataset.common!==undefined&&cf){const endpoint=quickMenu;if(!['input','output'].includes(endpoint))return;const name=commonCofactors[Number(button.dataset.common)];quickMenu=null;editCofactor(e,cf,{[endpoint]:name});return;}
    if(action==='apply-name'&&cf&&['input','output'].includes(quickMenu)){const endpoint=quickMenu,name=$('quick-custom-value').value.trim().slice(0,200);if(!name)return;quickMenu=null;editCofactor(e,cf,{[endpoint]:name});return;}
    if(action==='custom'){if(!cf)addCofactor();quickMenu='input';renderQuickActions();}
  });
  $('reaction-actions').addEventListener('change',ev=>{const n=selection.size===1?selectedNodes()[0]:null,key=ev.target.dataset.componentProp;if(n&&['membrane','illustration'].includes(n.kind)&&['rotation','fill','stroke'].includes(key))update(()=>n[key]=key==='rotation'?C.clamp(Number(ev.target.value)||0,0,360):ev.target.value);});
  function renderComponentOptions(group){$('component-options').dataset.group=group;$('component-filters').querySelectorAll('button').forEach(button=>{button.classList.toggle('active',button.dataset.componentGroup===group);button.setAttribute('aria-pressed',String(button.dataset.componentGroup===group));});const entries=[['membrane',{name:'细胞膜',group:'membrane'}],...Object.entries(C.ILLUSTRATIONS)];$('component-options').innerHTML=entries.filter(([,info])=>group==='all'||info.group===group).map(([key,info])=>{const n=key==='membrane'?{...C.node('membrane',90,60),w:28,h:96}:C.illustrationNode(key,90,60);if(key!=='membrane'){n.w=info.w*.7;n.h=info.h*.7;}n.label='';return `<button type="button" class="component-template" data-template="${key}"><svg viewBox="0 0 180 120" aria-hidden="true">${C.renderNode(n)}</svg><b>${info.name}</b></button>`;}).join('');}
  $('structure-button').onclick=()=>{setTool('select');renderComponentOptions('all');$('component-dialog').showModal();};
  $('component-filters').addEventListener('click',ev=>{const button=ev.target.closest('[data-component-group]');if(button)renderComponentOptions(button.dataset.componentGroup);});
  $('component-options').addEventListener('click',ev=>{const button=ev.target.closest('[data-template]');if(!button)return;const key=button.dataset.template;pendingIllustration=key==='membrane'?null:key;tool=key==='membrane'?'membrane':'illustration';$('component-dialog').close();render();toast('点击画布放置'+(key==='membrane'?'细胞膜':C.ILLUSTRATIONS[key].name));});
  async function chemicalEngine(){if(globalThis.PathwayChemistry)return globalThis.PathwayChemistry;if(!chemicalLoading)chemicalLoading=(async()=>{const local=new URL('chemistry.js',document.baseURI).href,urls=[local];if(['127.0.0.1','localhost'].includes(location.hostname)&&location.port!=='4174')urls.push('http://127.0.0.1:4174/chemistry.js');for(const url of urls){try{await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('模块未加载'));};document.head.append(script);});if(globalThis.PathwayChemistry)return globalThis.PathwayChemistry;}catch{}}throw new Error(location.protocol==='file:'?'无法加载化学模块，请确认项目文件和 vendor 目录完整':'本地化学绘图服务未启动，请在项目目录运行 start.cmd 4174');})().catch(err=>{chemicalLoading=null;throw err;});return chemicalLoading;}
  function drawChemicalPreview(){const svg=$('chemical-preview');if(!chemicalPreview){svg.innerHTML='';$('chemical-apply').disabled=true;return;}const data={...chemicalPreview,display:$('chemical-display').value,colorMode:$('chemical-colors').value},n=C.moleculeNode(data,160,116,$('chemical-name').value);n.w=280;n.h=185;svg.innerHTML=C.renderNode(n);$('chemical-apply').disabled=false;}
  stage.append($('chemical-dialog'));
  function sendSketchCommand(type,extra={}){if(!sketchReady)return;const frame=$('chemical-sketcher'),url=new URL(frame.src,document.baseURI);frame.contentWindow.postMessage({channel:'pathway-sketcher',type,session:sketchSession,...extra},url.protocol==='file:'?'*':url.origin);}
  function moleculeMetadata(n){if(n.molecule?.atomSites)return n.molecule;const cached=chemicalMetadata.get(n.id);return cached?.source===n.molecule?.source?cached.data:null;}
  async function prepareChemicalTargets(){const engine=await chemicalEngine();await Promise.all(board().nodes.filter(n=>n.molecule&&(!moleculeMetadata(n)||n.molecule.atomRenderingVersion!==1)).map(async n=>{const source=n.molecule.source,type=n.molecule.sourceType,data=await engine.generate(source,type);if(n.molecule.source===source){n.molecule={...n.molecule,...data,source,sourceType:type,display:n.molecule.display,colorMode:n.molecule.colorMode,bondStyles:n.molecule.bondStyles||[],...(n.molecule.atomFontSize!==undefined?{atomFontSize:n.molecule.atomFontSize}:{}),...(n.molecule.bondWidth!==undefined?{bondWidth:n.molecule.bondWidth}:{})};chemicalMetadata.set(n.id,{source,data:{...data,display:n.molecule.display,colorMode:n.molecule.colorMode,...(n.molecule.bondWidth!==undefined?{bondWidth:n.molecule.bondWidth}:{})}});}}));}
  function isChemicalBondTool(){return tool==='chemical-bond'||tool==='chemical'&&(['202','203','204'].includes(sketchAction)||Object.hasOwn(C.CHEMICAL_BONDS,sketchAction));}
  function isCarbonChainTool(){return tool==='chemical'&&pendingMolecule?.action==='chain';}
  function isChemicalRingTool(){return tool==='chemical'&&Object.hasOwn(chemicalRingTools,sketchAction);}
  function isChemicalDrawingTool(){return ['chemical','chemical-bond','chemical-erase','chemical-group'].includes(tool);}
  async function editChemicalOnCanvas(id){selection=new Set([id]);tool='select';try{await prepareChemicalTargets();render();toast('点击原子后输入元素字母；选择键或环工具直接在结构上编辑');}catch(err){toast(err.message);}}
  async function setMoleculeAtomFont(n,font){
    if(!n?.molecule||chemicalEditPending)return;
    const original=n.molecule;
    if(original.atomTexts){update(()=>original.atomFontFamily=font);return;}
    chemicalEditPending=true;
    try{
      const engine=await chemicalEngine(),next=await engine.renderAtomText(original);
      if(getObject(n.id)!==n||n.molecule!==original)return;
      update(()=>C.fitMoleculeEdit(n,{...next,atomFontFamily:font},original));
    }catch(err){renderInspector();toast(err.message);}finally{chemicalEditPending=false;}
  }
  async function addChemicalRing(owner,{atom=null,bond=null}){
    const n=getObject(owner),m=n&&moleculeMetadata(n),settings=chemicalRingTools[sketchAction];
    if(!m||!settings||chemicalEditPending)return;
    if(bond!==null&&m.bondSites[bond]?.order===1){
      const {a,b}=m.bondSites[bond],terminal=[a,b].filter(index=>m.bondSites.filter(k=>k.a===index||k.b===index).length===1);
      if(terminal.length===1)atom=terminal[0];
    }
    const original=n.molecule;
    chemicalEditPending=true;
    try{
      const engine=await chemicalEngine();
      const next=atom===null?await engine.fuseRing(m,bond,...settings):await engine.attachRing(m,atom,...settings);
      if(getObject(owner)!==n||n.molecule!==original)return;
      update(()=>{
        C.fitMoleculeEdit(n,next,m,atom??0);
        n.entityId=C.uid('m');selection=new Set([n.id]);
        if(!chemicalToolLocked)tool='select';
      },atom===null?'已拼接共用化学键的环':'已接上新的环');
    }catch(err){toast('未接上环：'+err.message);}finally{chemicalEditPending=false;}
  }
  function selectedBondStyle(){return {'202':'single','203':'double','204':'triple'}[sketchAction]||pendingBondStyle;}
  function nearbyChemicalAtom(point,radius,skip){
    let nearest=null;
    for(const node of board().nodes){
      if(!node.molecule||node.molecule.display==='name')continue;
      const data=moleculeMetadata(node);
      if(!data?.atomSites)continue;
      for(let index=0;index<data.atoms;index++){
        if(skip(node,index))continue;
        const p=C.moleculeAtomPosition(node,index,data),distance=Math.hypot(p.x-point.x,p.y-point.y);
        if(distance<radius&&(!nearest||distance<nearest.distance))nearest={node,data,index,point:p,distance};
      }
    }
    return nearest;
  }
  async function extendChemical(owner,index,end,style,{removeId=null,reverse=false,free=false,chain=null,chainIndex=0,appendOnly=false}={}){
    const n=getObject(owner),m=n?.molecule&&moleculeMetadata(n);
    if(!m)throw new Error('结构原子还未定位，请稍后重试');
    if(chemicalEditPending)return false;
    const source=n.molecule.source,detached=removeId&&getObject(removeId);
    const start=C.moleculeAtomPosition(n,index,m),zoom=stage.clientWidth/camera.w;
    const hit=appendOnly?null:nearbyChemicalAtom(end,10/zoom,(node,i)=>node.id===removeId||(node.id===owner&&i===index));
    const target=hit?.node===n?hit.index:null,other=hit&&hit.node!==n?hit:null;
    const scale=Math.min(n.w/m.width,n.h/m.height);
    const toSite=p=>({x:(p.x-n.x)/scale+m.width/2,y:(p.y-n.y)/scale+m.height/2});
    if(!hit&&Math.hypot(end.x-start.x,end.y-start.y)<8/zoom){
      const dx=start.x-n.x,dy=start.y-n.y,length=Math.hypot(dx,dy);
      end=length>.01?{x:start.x+dx/length*35,y:start.y+dy/length*35}:{x:start.x+35,y:start.y};
    }
    chemicalEditPending=true;
    try{
      const engine=await chemicalEngine();
      let next,lastAtom;
      if(other){
        const sites=other.data.atomSites.map((_,i)=>toSite(C.moleculeAtomPosition(other.node,i,other.data)));
        next=await engine.merge(m,index,other.data,other.index,sites,style);
        lastAtom=m.atoms+other.index;
      }else if(chain&&target===null){
        next=await engine.extendCarbonChain(m,index,toSite(end),chain,chainIndex,free);
        const farEnd=chain.bondSites.reduce((degree,b)=>{degree[b.a]++;degree[b.b]++;return degree;},Array(chain.atoms).fill(0))
          .findIndex((degree,i)=>degree===1&&i!==chainIndex);
        lastAtom=m.atoms+farEnd;
      }else{
        const point=toSite(end),tip=free||target!==null?point:engine.snapEndpoint(m,index,point,style);
        next=await engine.connect(m,index,tip,style,target,reverse);
        lastAtom=target??next.atoms-1;
      }
      if(getObject(owner)!==n||n.molecule.source!==source||
         (other&&(getObject(other.node.id)!==other.node||other.node.molecule.source!==other.data.source))||
         (detached&&getObject(removeId)!==detached))throw new Error('结构已变化，请重新连接');
      update(()=>{
        C.fitMoleculeEdit(n,next,m);
        n.entityId=C.uid('m');
        const combined=other?.node||(chain&&detached);
        if(combined){
          for(const edge of board().edges){
            if(edge.source===combined.id)edge.source=n.id;
            if(edge.target===combined.id)edge.target=n.id;
          }
          board().edges=board().edges.filter(e=>C.isFreeArrow(e)||e.source!==e.target);
          C.deleteObjects(board(),[combined.id]);
        }else if(removeId)C.deleteObjects(board(),[removeId]);
        selection=new Set([n.id]);
        activeChemicalAtom={owner:n.id,index:lastAtom};
        if(!chemicalToolLocked)tool='select';
      },chain&&!hit?'已接上短碳链':'化学键已连接到原子，结构会一起移动');
      return true;
    }finally{
      chemicalEditPending=false;
    }
  }
  async function attachLooseBond(n,free=false){await prepareChemicalTargets();const angle=(n.rotation||0)*Math.PI/180,dx=n.w/2*Math.cos(angle),dy=n.w/2*Math.sin(angle),ends=[{x:n.x-dx,y:n.y-dy},{x:n.x+dx,y:n.y+dy}],threshold=12*camera.w/stage.clientWidth;let best=null;
    for(const owner of board().nodes.filter(x=>x.molecule&&x.id!==n.id)){const m=moleculeMetadata(owner);if(!m?.atomSites)continue;for(let i=0;i<m.atoms;i++)for(let end=0;end<2;end++){const p=C.moleculeAtomPosition(owner,i,m),distance=Math.hypot(p.x-ends[end].x,p.y-ends[end].y);if(distance<threshold&&(!best||distance<best.distance))best={owner:owner.id,index:i,end,distance};}}
    return best?extendChemical(best.owner,best.index,ends[1-best.end],n.chemicalBond,{removeId:n.id,reverse:best.end===1,free}):false;
  }
  async function attachLooseChain(n){
    const chain=moleculeMetadata(n),radius=12*camera.w/stage.clientWidth;
    let nearest=null;
    for(let index=0;index<chain.atoms;index++){
      const incident=chain.bondSites.filter(b=>b.a===index||b.b===index);
      if(incident.length!==1)continue;
      const terminal=C.moleculeAtomPosition(n,index,chain);
      const target=nearbyChemicalAtom(terminal,radius,node=>node.id===n.id);
      if(!target||(nearest&&target.distance>=nearest.target.distance))continue;
      const bond=incident[0],neighbor=C.moleculeAtomPosition(n,bond.a===index?bond.b:bond.a,chain);
      nearest={target,index,dx:neighbor.x-terminal.x,dy:neighbor.y-terminal.y};
    }
    if(!nearest)return false;
    const {target,index,dx,dy}=nearest;
    return extendChemical(target.node.id,target.index,{x:target.point.x+dx,y:target.point.y+dy},'single',
      {removeId:n.id,chain,chainIndex:index,appendOnly:true});
  }
  async function changeSelectedAtom(symbol){const target=activeChemicalAtom,n=target&&getObject(target.owner);if(!n?.molecule)return;const m=moleculeMetadata(n),source=n.molecule.source;chemicalEditPending=true;try{const engine=await chemicalEngine(),next=await engine.changeAtom(m,target.index,symbol);if(getObject(n.id)!==n||n.molecule.source!==source)return;update(()=>{C.fitMoleculeEdit(n,next,m);n.entityId=C.uid('m');},'原子已改为 '+symbol);}catch(err){toast('未修改结构：'+err.message);}finally{chemicalEditPending=false;}}
  async function eraseChemical(owner,kind,index){const n=getObject(owner),m=n&&moleculeMetadata(n);if(!m)return;const source=n.molecule.source;chemicalEditPending=true;try{const engine=await chemicalEngine(),result=await engine.erase(m,kind,index);if(getObject(owner)!==n||n.molecule.source!==source)return;update(()=>{if(!result.data){C.deleteObjects(board(),[owner]);selection.clear();}else{C.fitMoleculeEdit(n,result.data,{...m,atomSites:result.keptAtoms.map(i=>m.atomSites[i])});n.entityId=C.uid('m');selection=new Set([owner]);}activeChemicalAtom=null;},'已擦除，可撤销恢复');}catch(err){toast('未擦除：'+err.message);}finally{chemicalEditPending=false;}}
  async function moveChemicalAtom(owner,index,end){const n=getObject(owner),m=n&&moleculeMetadata(n);if(!m)return;const source=n.molecule.source,scale=Math.min(n.w/m.width,n.h/m.height);chemicalEditPending=true;try{const engine=await chemicalEngine(),next=await engine.moveAtom(m,index,{x:(end.x-n.x)/scale+m.width/2,y:(end.y-n.y)/scale+m.height/2});if(getObject(owner)!==n||n.molecule.source!==source)return;update(()=>{C.fitMoleculeEdit(n,next,m,index===0&&m.atoms>1?1:0);selection=new Set([owner]);},'原子位置已调整，化学键保持连接');}catch(err){toast('未移动：'+err.message);}finally{chemicalEditPending=false;}}
  async function applyChemicalGroup(owner,index,group){const n=getObject(owner),m=n&&moleculeMetadata(n);if(!m)return;const source=n.molecule.source;chemicalEditPending=true;try{const engine=await chemicalEngine(),result=await engine.addGroup(m,index,group);if(getObject(owner)!==n||n.molecule.source!==source)return;update(()=>{C.fitMoleculeEdit(n,result.data,m);n.entityId=C.uid('m');selection=new Set([owner]);activeChemicalAtom={owner,index:result.index};tool='select';},'已加入 '+group+' 基团');}catch(err){toast('未加入基团：'+err.message);}finally{chemicalEditPending=false;}}
  async function rotateChemical(owner,angle,pivotWorld=null){if(chemicalEditPending||Math.abs(angle)<.05)return;const n=getObject(owner);if(!n?.molecule)return;chemicalEditPending=true;try{await prepareChemicalTargets();const m=moleculeMetadata(n),source=n.molecule.source,box=C.moleculeGraphicBounds(n),pivot=pivotWorld||{x:(box.left+box.right)/2,y:(box.top+box.bottom)/2},oldScale=Math.min(n.w/m.width,n.h/m.height),engine=await chemicalEngine(),result=await engine.rotate(m,angle,{x:(pivot.x-n.x)/oldScale+m.width/2,y:(pivot.y-n.y)/oldScale+m.height/2});if(getObject(owner)!==n||n.molecule.source!==source)return;const scale=oldScale*m.drawScale/result.data.drawScale;update(()=>{n.molecule=result.data;n.w=result.data.width*scale;n.h=result.data.height*scale;n.x=pivot.x-(result.pivot.x-result.data.width/2)*scale;n.y=pivot.y-(result.pivot.y-result.data.height/2)*scale;n.rotation=((n.rotation||0)+angle+3600)%360;activeChemicalAtom=null;selection=new Set([n.id]);},'结构已旋转，原子和名称保持正向显示');}catch(err){toast('未旋转：'+err.message);render();}finally{chemicalEditPending=false;}}
  async function tidyChemical(owner){const n=getObject(owner);if(!n?.molecule||chemicalEditPending)return;chemicalEditPending=true;try{await prepareChemicalTargets();const m=moleculeMetadata(n),source=n.molecule.source,engine=await chemicalEngine(),next=await engine.tidy(m);if(getObject(owner)!==n||n.molecule.source!==source)return;update(()=>C.fitMoleculeEdit(n,next,m),'已按邻接键整理支链角度和长度');}catch(err){toast(err.message);}finally{chemicalEditPending=false;}}
  async function openAtomEditor(owner,index){
    const n=getObject(owner),m=n&&moleculeMetadata(n);
    if(!m)return;
    const target={owner,index};
    atomEditorTarget=target;
    try{
      const engine=await chemicalEngine();
      if(atomEditorTarget!==target)return;
      if(getObject(owner)!==n||!selection.has(owner)){closeAtomEditor();return;}
      const label=await engine.atomLabel(m,index);
      if(atomEditorTarget!==target||getObject(owner)!==n||!selection.has(owner))return;
      const p=C.moleculeAtomPosition(n,index,m),r=stage.getBoundingClientRect();
      const editor=$('atom-label-editor'),input=$('atom-label-input');
      activeChemicalAtom=target;
      editor.style.left=C.clamp((p.x-camera.x)*r.width/camera.w-75,4,r.width-176)+'px';
      editor.style.top=C.clamp((p.y-camera.y)*r.height/camera.h-58,4,r.height-64)+'px';
      input.value=label;
      editor.hidden=false;
      input.focus();
      input.select();
    }catch(err){
      if(atomEditorTarget!==target)return;
      closeAtomEditor();
      toast('无法编辑原子：'+err.message);
    }
  }
  function closeAtomEditor(){atomEditorTarget=null;$('atom-label-editor').hidden=true;}
  async function submitAtomEditor(){if(!atomEditorTarget)return;const target=atomEditorTarget,value=$('atom-label-input').value.trim(),group=value.toUpperCase().replace('CO2H','COOH');closeAtomEditor();if(['COOH','OH','NH2','CH3','CHO'].includes(group))await applyChemicalGroup(target.owner,target.index,group);else{activeChemicalAtom=target;await changeSelectedAtom(value);}canvas.focus();}
  $('atom-label-input').addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();submitAtomEditor();}if(ev.key==='Escape'){ev.preventDefault();closeAtomEditor();canvas.focus();}});
  $('atom-label-input').addEventListener('blur',()=>{if(atomEditorTarget)submitAtomEditor();});
  async function selectChemicalGroup(group){
    if($('chemical-dialog').open||chemicalEditPending)return;
    const request=++chemicalToolRevision;
    chemicalToolLocked=false;
    chemicalDropPoint=null;
    pendingChemicalGroup=group;
    sourceId=null;
    if(activeChemicalAtom&&selection.has(activeChemicalAtom.owner)){
      await applyChemicalGroup(activeChemicalAtom.owner,activeChemicalAtom.index,group);
      return;
    }
    tool='chemical-group';
    selection.clear();
    render();
    try{
      await prepareChemicalTargets();
      if(request===chemicalToolRevision)render();
    }catch(err){
      if(request!==chemicalToolRevision)return;
      setTool('select');
      toast(err.message);
    }
  }
  function updateChemicalToolbar(){const open=$('chemical-dialog').open;document.querySelector('.inspector').inert=open;document.querySelectorAll('[data-chem-action="wedge"],[data-chem-action="hashed"],[data-chem-action="dashed"],[data-chem-action="wavy"]').forEach(button=>button.disabled=open);$('chemical-toolbar').querySelectorAll('[data-chem-action]').forEach(button=>button.setAttribute('aria-pressed',String(open&&button.dataset.chemAction===sketchAction)));$('chemical-tool-state').textContent=open?'正在编辑结构':'';for(const button of $('chemical-toolbar').querySelectorAll('[data-chem-group]')){button.disabled=open;if(open)button.setAttribute('aria-pressed','false');}$('board-list').inert=open;for(const id of ['add-board','copy-button','paste-button','align-x','align-y','ring-button','group-button','ungroup-button','save-button','open-button','export-button']){const button=$(id);if(open){if(button.dataset.chemicalWasDisabled===undefined)button.dataset.chemicalWasDisabled=String(button.disabled);button.disabled=true;}else if(button.dataset.chemicalWasDisabled!==undefined){button.disabled=button.dataset.chemicalWasDisabled==='true';delete button.dataset.chemicalWasDisabled;}}document.querySelectorAll('[data-tool],.library button').forEach(button=>button.disabled=open);}
  async function selectChemicalTool(action,locked=false){chemicalToolLocked=locked&&action!=='106';activeChemicalAtom=null;sketchAction=action;const request=++chemicalToolRevision;if(action==='106'){tool='chemical-erase';pendingMolecule=null;selection.clear();render();markChemicalTool();toast('点击要删除的结构式，可撤销恢复');return;}const templates={wedge:'CC',hashed:'CC',dashed:'CC',wavy:'CC','206':'C1CC1','207':'C1CCC1','chain':'CCCC','202':'CC','203':'C=C','204':'C#C','208':'C1CCCC1','210':'C1CCCCC1','209':'c1ccccc1'};if(Object.hasOwn(C.CHEMICAL_BONDS,action))pendingBondStyle=action;if(!templates[action])return;tool='chemical-loading';chemicalDropPoint=null;pendingMolecule=null;selection.clear();render();$('chemical-tool-state').textContent='加载结构…';try{const engine=await chemicalEngine();let data=await engine.generate(templates[action]);if(Object.hasOwn(C.CHEMICAL_BONDS,action))data=await engine.connect(data,0,data.atomSites[1],action,1);data.bondFragment=['202','203','204'].includes(action)||Object.hasOwn(C.CHEMICAL_BONDS,action);if(request!==chemicalToolRevision)return;data.display='structure';pendingMolecule={data,label:'',compact:true,action};await prepareChemicalTargets();if(request!==chemicalToolRevision)return;tool='chemical';render();markChemicalTool();if(chemicalDropPoint){const p=chemicalDropPoint;chemicalDropPoint=null;addNode('chemical',p);}else if(action!=='chain')toast('点击主画板直接放置结构式');}catch(err){if(request===chemicalToolRevision){chemicalToolLocked=false;tool='select';chemicalDropPoint=null;render();$('chemical-tool-state').textContent='加载失败';toast(err.message);}}}
  function markChemicalTool(){
    const toolbar=$('chemical-toolbar'),addingGroup=tool==='chemical-group';
    const drawing=['chemical','chemical-bond','chemical-erase','chemical-loading'].includes(tool);
    for(const button of toolbar.querySelectorAll('[data-chem-action]')){
      button.setAttribute('aria-pressed',String(drawing&&button.dataset.chemAction===sketchAction));
    }
    for(const button of toolbar.querySelectorAll('[data-chem-group]')){
      button.setAttribute('aria-pressed',String(addingGroup&&button.dataset.chemGroup===pendingChemicalGroup));
    }
    $('chemical-tool-state').textContent=addingGroup?'点击原子添加 '+pendingChemicalGroup
      :tool==='chemical-erase'?'点击结构擦除'
      :tool==='chemical-loading'?'加载结构…'
      :isCarbonChainTool()?(chemicalToolLocked?'连续接碳链 · Esc 退出':'点原子接碳链 · 点空白放置')
      :isChemicalRingTool()?'点原子接环 · 点已有环的边拼环 · 点空白放置'
      :drawing?(chemicalToolLocked?'已锁定 · 连续绘制 · Esc 退出':'点击画板放置'):'';
  }
  $('chemical-toolbar').addEventListener('click',ev=>{
    const button=ev.target.closest('button[data-chem-action],button[data-chem-group]');
    if(!button)return;
    if(button.dataset.chemGroup){selectChemicalGroup(button.dataset.chemGroup);return;}
    const action=button.dataset.chemAction;
    if(!$('chemical-dialog').open){selectChemicalTool(action,ev.detail===2);return;}
    sketchAction=action;
    showChemicalMode('draw');
    sendSketchCommand('action',{action:action==='chain'?'205':action});
    updateChemicalToolbar();
  });
  $('chemical-import-tool').onclick=()=>{if(!$('chemical-dialog').open)openChemical();showChemicalMode('input');};
  $('chemical-style-tool').onclick=openStructureStyles;
  function openStructureStyles(){
    if($('chemical-dialog').open||chemicalEditPending)return;
    if(!board().nodes.some(n=>n.molecule))return toast('请先在当前画板放置化学结构');
    const scope=$('structure-style-scope');
    scope.options[1].disabled=!selectedNodes().some(n=>n.molecule);
    scope.value='board';
    $('structure-style-status').hidden=true;
    $('structure-style-options').innerHTML=Object.entries(C.STRUCTURE_PRESETS).map(([key,preset])=>
      '<button type="button" data-structure-preset="'+key+'"><strong>'+C.esc(preset.label)+'</strong>'+
      '<small>Arial '+preset.atomPt+' pt · 键长 '+preset.bondPt+' pt · 线宽 '+preset.linePt+' pt</small></button>'
    ).join('');
    $('structure-style-dialog').showModal();
  }
  $('structure-style-options').addEventListener('click',async event=>{
    const button=event.target.closest('[data-structure-preset]');
    if(!button||chemicalEditPending)return;
    const key=button.dataset.structurePreset,preset=C.STRUCTURE_PRESETS[key];
    const current=board(),scope=$('structure-style-scope'),status=$('structure-style-status');
    const entireBoard=scope.value==='board';
    const targets=(entireBoard?current.nodes:selectedNodes()).filter(n=>n.molecule);
    chemicalEditPending=true;
    scope.disabled=true;
    $('structure-style-options').inert=true;
    status.hidden=false;
    status.textContent='正在应用样式…';
    try{
      const engine=await chemicalEngine(),results=[];
      for(const node of targets)results.push(await engine.renderPublicationStyle(node.molecule,key,preset));
      if(!$('structure-style-dialog').open||board()!==current)return;
      update(()=>{
        targets.forEach((node,i)=>C.applyStructurePreset(node,results[i],key));
        if(entireBoard)C.applyBoardFigureStyle(current,key);
      },entireBoard?'已应用 '+preset.label+' · 当前画板':'已应用 '+preset.label+' · '+targets.length+' 个结构');
      $('structure-style-dialog').close();
    }catch(err){
      status.textContent='未应用样式：'+err.message;
    }finally{
      chemicalEditPending=false;
      scope.disabled=false;
      $('structure-style-options').inert=false;
    }
  });
  function showChemicalMode(mode){chemicalMode=mode;$('chemical-draw-panel').hidden=mode!=='draw';$('chemical-input-panel').hidden=mode!=='input';$('chemical-draw-tab').setAttribute('aria-pressed',String(mode==='draw'));$('chemical-input-tab').setAttribute('aria-pressed',String(mode==='input'));}
  async function loadSketchSource(){const session=++sketchSession;sketchMol='';chemicalRevision++;clearTimeout(sketchTimer);try{const engine=await chemicalEngine();if(session!==sketchSession||!$('chemical-dialog').open)return;if(!sketchReady){if(!$('chemical-sketcher').getAttribute('src')){const url=new URL('sketcher.html',engine.assetBase||document.baseURI);url.searchParams.set('parentOrigin',location.protocol==='file:'?'null':location.origin);$('chemical-sketcher').src=url.href;}return;}const source=$('chemical-source').value,mol=source.trim()?($('chemical-type').value==='mol'?source:await engine.toMol(source,'smiles')):'';if(session!==sketchSession||!$('chemical-dialog').open)return;sendSketchCommand('load',{mol,action:sketchAction==='chain'?'205':sketchAction});}catch(err){$('chemical-status').textContent=err.message;showChemicalMode('input');}}
  window.addEventListener('message',ev=>{const url=new URL($('chemical-sketcher').src||document.baseURI,document.baseURI);if(ev.source!==$('chemical-sketcher').contentWindow||ev.origin!==(url.protocol==='file:'?'null':url.origin)||ev.data?.channel!=='pathway-sketcher')return;const data=ev.data;if(data.type==='ready'){sketchReady=true;if($('chemical-dialog').open)loadSketchSource();return;}if(data.session!==sketchSession||!$('chemical-dialog').open||chemicalMode!=='draw')return;if(data.type==='error'){$('chemical-status').textContent=data.message;return;}if(data.type==='change'){$('undo').disabled=!data.canUndo;$('redo').disabled=!data.canRedo;sketchMol=typeof data.mol==='string'?data.mol:'';chemicalRevision++;chemicalPreview=null;drawChemicalPreview();clearTimeout(sketchTimer);$('chemical-status').textContent=sketchMol?'正在更新结构预览…':'选择原子、键或环，在白色区域开始绘制。';if(sketchMol)sketchTimer=setTimeout(()=>previewChemical(),250);}});
  $('chemical-draw-tab').onclick=()=>{if(chemicalMode==='draw')return;showChemicalMode('draw');loadSketchSource();};
  $('chemical-input-tab').onclick=()=>{if(chemicalMode==='input')return;clearTimeout(sketchTimer);$('chemical-type').value='mol';$('chemical-source').value=sketchMol;showChemicalMode('input');};
  function openChemical(id=null){chemicalToolLocked=false;chemicalToolRevision++;chemicalDropPoint=null;chemicalTarget=id;chemicalRevision++;const n=id?getObject(id):null;chemicalPreview=n?.molecule?C.clone(n.molecule):null;$('chemical-type').value=chemicalPreview?.sourceType||'smiles';$('chemical-source').value=chemicalPreview?.source||'';$('chemical-name').value=n?.label||'';$('chemical-display').value=chemicalPreview?.display||'both';$('chemical-colors').value=chemicalPreview?.colorMode||'mono';$('chemical-apply').textContent=id?'应用修改':'放到画布';$('chemical-status').textContent=chemicalPreview?chemicalPreview.atoms+' 个原子 · '+chemicalPreview.engine:'输入结构后点击“生成预览”。';$('chemical-status').classList.remove('error');drawChemicalPreview();$('chemical-dialog').show();showChemicalMode('draw');loadSketchSource();updateChemicalToolbar();}
  $('chemical-close').onclick=()=>$('chemical-dialog').close();
  $('chemical-preset').addEventListener('change',()=>{const preset=$('chemical-preset');if(!preset.value)return;$('chemical-type').value='smiles';$('chemical-source').value=preset.value;$('chemical-name').value=preset.options[preset.selectedIndex].text;chemicalRevision++;chemicalPreview=null;drawChemicalPreview();$('chemical-status').textContent='模板已填入，可继续绘制或修改。';preset.value='';if(chemicalMode==='draw')loadSketchSource();else previewChemical();});
  $('chemical-dialog').addEventListener('close',()=>{chemicalRevision++;sketchSession++;clearTimeout(sketchTimer);updateChemicalToolbar();render();});
  for(const id of ['chemical-source','chemical-type'])$(id).addEventListener('input',()=>{chemicalRevision++;chemicalPreview=null;drawChemicalPreview();$('chemical-status').textContent='输入已改变，请重新生成预览。';});
  for(const id of ['chemical-name','chemical-display','chemical-colors'])$(id).addEventListener('input',drawChemicalPreview);
  async function previewChemical(){const revision=++chemicalRevision,button=$('chemical-preview-button'),source=chemicalMode==='draw'?sketchMol:$('chemical-source').value,type=chemicalMode==='draw'?'mol':$('chemical-type').value;button.disabled=true;$('chemical-apply').disabled=true;$('chemical-status').classList.remove('error');$('chemical-status').textContent='正在生成结构预览…';try{const engine=await chemicalEngine(),data=await engine.generate(source,type);if(revision!==chemicalRevision||!$('chemical-dialog').open)return;chemicalPreview=data;drawChemicalPreview();$('chemical-status').textContent=data.atoms+' 个原子 · '+(type==='mol'?'保留手绘位置':'自动二维排版')+' · 本机处理';}catch(err){if(revision===chemicalRevision){chemicalPreview=null;drawChemicalPreview();$('chemical-status').classList.add('error');$('chemical-status').textContent=err.message;}}finally{button.disabled=false;}}
  $('chemical-preview-button').onclick=previewChemical;
  $('chemical-import').onclick=()=>$('chemical-file').click();$('chemical-file').addEventListener('change',async ev=>{const file=ev.target.files[0];ev.target.value='';if(!file)return;if(file.size>1024*1024)return toast('MOL 文件不能超过 1 MB');const value=await file.text();chemicalRevision++;chemicalPreview=null;$('chemical-type').value='mol';$('chemical-source').value=value;if(!$('chemical-name').value)$('chemical-name').value=file.name.replace(/\.mol$/i,'');drawChemicalPreview();$('chemical-status').textContent='MOL 已读取，请生成预览。';});
  $('chemical-form').onsubmit=ev=>{ev.preventDefault();if(!chemicalPreview)return;const data={...C.clone(chemicalPreview),display:$('chemical-display').value,colorMode:$('chemical-colors').value},label=$('chemical-name').value.slice(0,2000);$('chemical-dialog').close();if(chemicalTarget){const n=getObject(chemicalTarget);if(!n)return;update(()=>{const wasStructure=!!n.molecule;if(n.molecule&&n.molecule.smiles!==data.smiles)n.entityId=C.uid('m');n.molecule=data;n.shape='structure';if(!wasStructure){n.w=Math.max(180,n.w);n.h=Math.max(130,n.h);}n.label=label;},'结构已更新');}else{pendingMolecule={data,label};tool='chemical';selection.clear();render();toast('点击画布放置化学结构');}};
  function editCofactor(edge,cf,patch){const candidate={...cf,...patch},result=C.layoutCofactor(board(),edge,candidate);if(!result.clear){toast('当前分区放不下这个组合，已保留原支路');render();return false;}update(()=>Object.assign(cf,candidate));return true;}
  function cyclePlacement(p){const box=pendingCycle.bounds;return {x:C.clamp(p.x,-box.x,board().width-box.x-box.w),y:C.clamp(p.y,-box.y,board().height-box.y-box.h)};}
  function cycleConfig(){return C.buildCycle(C.parseCycleRows($('cycle-rows').value),{radius:Number($('cycle-radius').value),fontSize:Number($('cycle-font').value),title:$('cycle-title').value,clockwise:$('cycle-direction').value==='clockwise',cofactors:$('cycle-cofactors').checked});}
  function previewCycle(){try{const result=cycleConfig(),q=result.bounds;const svg=$('cycle-preview');svg.setAttribute('viewBox',`${q.x} ${q.y} ${q.w} ${q.h}`);svg.setAttribute('font-family',project.fontFamily||C.FONT);svg.innerHTML=C.renderBoard(result,'preview-');if(q.w>board().width||q.h>board().height)throw new Error('当前画板放不下此尺寸，请减小半径或字号，或先增大画板。');$('cycle-feedback').classList.remove('error');$('cycle-feedback').textContent=`${result.edges.length} 个化合物 · ${result.edges.length} 条反应 · 自动闭合，整组移动`;$('cycle-submit').disabled=false;return result;}catch(err){$('cycle-feedback').textContent=err.message;$('cycle-feedback').classList.add('error');$('cycle-submit').disabled=true;return null;}}
  function openCycle(){setTool('select');if(!$('cycle-rows').value)$('cycle-rows').value=C.TCA_ROWS.map(row=>row.join(' | ')).join('\n');previewCycle();$('cycle-dialog').showModal();}
  $('cycle-button').onclick=openCycle;
  $('cycle-template').onchange=()=>{const tca=$('cycle-template').value==='tca';$('cycle-rows').value=tca?C.TCA_ROWS.map(row=>row.join(' | ')).join('\n'):'A | Enzyme 1\nB | Enzyme 2\nC | Enzyme 3\nD | Enzyme 4';$('cycle-title').value=tca?'TCA':'途径名称';$('cycle-cofactors').checked=tca;$('cycle-cofactors').disabled=!tca;previewCycle();};
  $('cycle-form').addEventListener('input',ev=>{if(ev.target.id==='cycle-rows'){const isTca=$('cycle-rows').value.trim()===C.TCA_ROWS.map(row=>row.join(' | ')).join('\n');$('cycle-cofactors').disabled=!isTca;if(!isTca){$('cycle-template').value='custom';$('cycle-cofactors').checked=false;}}previewCycle();});
  $('cycle-form').addEventListener('change',previewCycle);
  $('cycle-form').onsubmit=ev=>{ev.preventDefault();const result=previewCycle();if(!result)return;pendingCycle=result;cyclePointer=null;selection.clear();tool='cycle';$('cycle-dialog').close();render();toast('在画布上点一下，即可生成整条环形途径');};
  $('cycle-close').onclick=$('cycle-cancel').onclick=()=>$('cycle-dialog').close();
  const field=(name,label,value,type='text',extra='')=>`<label class="field">${label}<input data-prop="${name}" type="${type}" value="${C.esc(value)}" ${extra}></label>`;
  const check=(name,label,value)=>`<label class="field"><input data-prop="${name}" type="checkbox" ${value?'checked':''}> ${label}</label>`;
  const select=(name,label,value,options)=>`<label class="field">${label}<select data-prop="${name}">${options.map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select></label>`;
  const section=(title,body)=>`<section class="inspector-section"><h3>${title}</h3>${body}</section>`;
  const row=body=>`<div class="field-row">${body}</div>`;
  let inspectorContext='',inspectorPage='';
  function renderInspector(){
    const root=$('inspector-content'),e=selectedEdge(),n=selection.size===1?selectedNodes()[0]:null;
    let badge='',context='board',pages=[];
    const addPage=(id,label,content)=>pages.push({id,label,content});
    if(e){
      const free=C.isFreeArrow(e);
      context=free?'arrow':'reaction';
      badge=free?'<div class="object-badge">⟶ 独立箭头</div>':'<div class="object-badge">⤳ 反应连线</div>';
      const ports=[['auto','自动'],['north','上侧'],['east','右侧'],['south','下侧'],['west','左侧']];
      addPage('line','线路',
        section('线路形状',select('mode','路径类型',e.mode,[['straight','直线'],['curve','贝塞尔曲线'],['arc','圆弧 · 适合循环'],['route','多段绕行 · 适合分支']])+select('direction','箭头',e.direction,[['forward','单向'],['both','双向'],['none','无箭头']])+row(field('width','线宽',e.width,'number','min="0.2" max="20" step="0.2"')+field('arrowSize','箭头大小',e.arrowSize??9,'number','min="3" max="40"'))+row(field('color','颜色',e.color,'color')+check('dashed','虚线',e.dashed)))+
        section('端点与控制点',(free?'':row(select('sourcePort','底物端口',e.sourcePort,ports)+select('targetPort','产物端口',e.targetPort,ports)))+(e.mode==='arc'?field('bulge','弧高（负值翻转）',e.bulge,'number','min="-2000" max="2000" step="5"'):'')+(e.mode==='route'?field('cornerRadius','转角圆润度',e.cornerRadius??24,'number','min="0" max="500"')+'<button data-action="add-waypoint">添加绕行点</button> <button data-action="remove-waypoint">移除末点</button>':'')+'<div class="inspector-actions"><button data-action="reset-path">重置形状</button><button data-action="reverse">'+(free?'反向':'反转反应')+'</button></div>'));
      addPage('labels','标签',
        section(free?'文字标注':'酶与标签',field('label',free?'文字':'酶名 / 标签',e.label)+row(field('fontSize','字号',e.fontSize,'number','min="6" max="200"')+field('labelColor','标签颜色',e.labelColor,'color'))+row(field('labelDx','偏移 X',Math.round(e.labelDx),'number')+field('labelDy','偏移 Y',Math.round(e.labelDy),'number'))+check('labelItalic','斜体',e.labelItalic))+(free?'':section('代谢工程',check('knockout','显示敲除标记',e.knockout)+(e.knockout?field('knockoutLabel','基因标注',e.knockoutLabel):''))));
      if(!free){
        const expandedCofactors=new Set(root.dataset.owner===e.id?
          [...root.querySelectorAll('details[data-cf-id][open]')].map(d=>d.dataset.cfId):[]);
        if(activeCofactor)expandedCofactors.add(activeCofactor);
        if(e.cofactors.length===1)expandedCofactors.add(e.cofactors[0].id);
        addPage('cofactors','辅因子',section('辅因子侧支',e.cofactors.map(cf=>`<details class="cofactor-item" data-cf-id="${cf.id}" ${expandedCofactors.has(cf.id)?'open':''}><summary>${displayFormula(cf.input)} → ${displayFormula(cf.output)}</summary>${field('input','底物',cf.input)}${field('output','产物',cf.output)}${select('orientation','流向',cf.orientation??'down',(cf.style==='compact'?[['right','从左到右'],['left','从右到左']]:[['auto','沿主反应方向'],['down','从上到下'],['up','从下到上'],['right','从左到右'],['left','从右到左']]))}${row(field('spread','半间距',cf.spread,'number','min="10" max="300"')+field('arrowSize','侧支箭头',cf.arrowSize??12,'number','min="3" max="40"'))}${field('t','沿反应的位置',cf.t??.5,'number','min="0.05" max="0.95" step="0.01"')}${field('fontSize','辅因子字号',cf.fontSize??Math.max(13,e.fontSize-2),'number','min="6" max="200"')}<button data-action="remove-cofactor" data-cf="${cf.id}">移除侧支</button></details>`).join('')+'<button class="inspector-add-cofactor" data-action="cofactor">＋ 添加辅因子</button>'));
      }
    }else if(n){
      context=n.chemicalBond?'bond':n.molecule?'molecule':n.kind;
      badge=`<div class="object-badge">${{metabolite:'◉ 代谢物',text:'Aa 文字注释',module:'▢ 模块 / 区室',membrane:'≋ 细胞膜',illustration:'◉ '+(C.ILLUSTRATIONS[n.template]?.name||'示意图')}[n.kind]}</div>`;
      if(n.molecule)badge='<div class="object-badge">化学结构</div>';
      const drawing=['membrane','illustration'].includes(n.kind);
      const displaySize=n.kind==='metabolite'&&n.shape==='round'?C.bounds(n):n;
      const position=section('位置与尺寸',row(field('x','X',Math.round(n.x),'number')+field('y','Y',Math.round(n.y),'number'))+row(field('w','宽度',Number(displaySize.w.toFixed(2)),'number','min="10" max="10000"')+field('h','高度',Number(displaySize.h.toFixed(2)),'number','min="10" max="10000"'))+(drawing?field('rotation','旋转角度',n.rotation||0,'number','min="0" max="360" step="1"'):''));
      if(n.chemicalBond){
        badge='<div class="object-badge">化学键图元</div>';
        addPage('style','样式',section('化学键',row(select('chemicalBond','键型',n.chemicalBond,Object.entries(C.CHEMICAL_BONDS))+field('stroke','颜色',n.stroke,'color'))));
        addPage('position','位置',section('位置与尺寸',row(field('x','X',Math.round(n.x),'number')+field('y','Y',Math.round(n.y),'number'))+row(field('w','长度',n.w,'number','min="10" max="1000"')+field('h','宽度',n.h,'number','min="10" max="100"'))+field('rotation','角度',n.rotation||0,'number','min="0" max="360"')));
      }else{
        if(n.molecule)addPage('structure','结构',section('化学结构',row(field('molecule-angle','旋转角度',Math.round(n.rotation||0),'number','min="0" max="360" step="15"')+field('molecule-label-gap','名称间距',n.molecule.labelGap??8,'number','min="0" max="100"'))+select('molecule-atom-family','原子字体',n.molecule.atomFontFamily||'',atomFontOptions)+row(field('molecule-atom-font','原子字号',Number((n.molecule.atomFontSize??18).toFixed(3)),'number','min="6" max="80"')+field('molecule-width','键线宽',Number((n.molecule.bondWidth??1.8).toFixed(3)),'number','min="0.2" max="20" step="0.2"'))+select('molecule-display','显示方式',n.molecule.display,[['both','结构＋名称'],['structure','仅结构'],['name','仅名称']])+select('molecule-colors','原子配色',n.molecule.colorMode,[['mono','黑白'],['elements','元素配色']])+'<button data-action="structure-styles">结构样式</button><p class="chemical-smiles">'+C.esc(n.molecule.smiles)+'</p><button data-action="edit-chemical">编辑结构</button>'));
        if(drawing)addPage('style','外观',section('图形颜色',row(field('fill','填充颜色',n.fill==='none'?'#ffffff':n.fill,'color')+field('stroke','线条颜色',n.stroke==='none'?'#80948a':n.stroke,'color'))));
        if(n.kind!=='membrane'){
          addPage('text','文字',section('内容',`<label class="field">显示文字<textarea data-prop="label" rows="2">${C.esc(n.label)}</textarea></label>`+row(field('fontSize','字号',n.fontSize,'number','min="6" max="200"')+field('color','文字颜色',n.color,'color'))+check('italic','斜体',n.italic)+check('bold','粗体',n.kind==='module'?(n.labelBold??true):n.bold))+(n.shape==='point'?section('环外标签',row(field('labelDx','标签偏移 X',Math.round(n.labelDx||0),'number')+field('labelDy','标签偏移 Y',Math.round(n.labelDy||0),'number'))+select('labelAnchor','文字对齐',n.labelAnchor||'middle',[['start','左对齐'],['middle','居中'],['end','右对齐']])+'<p class="muted">连线连接圆周上的点；调整标签位置不改变圆环。</p>'):''));
        }
        if(!drawing&&!n.molecule)addPage('style','外观',section('外观',select('shape','形状',n.shape,[['none','无边框文字'],['round','圆角矩形'],['rect','矩形'],['circle','圆 / 椭圆'],...(n.kind==='metabolite'?[['point','连接点 + 独立标签']]:[])])+row(field('fill','填充',n.fill==='none'?'#ffffff':n.fill,'color')+field('stroke','边框',n.stroke,'color'))+(n.kind==='module'?check('dashed','虚线边框',n.dashed):'')+(n.kind==='metabolite'&&n.shape==='round'?check('highlightFit','高亮框贴合文字',n.highlightFit!==false):''))+(n.kind==='metabolite'?'<button data-action="edit-chemical">设置化学结构</button>':''));
        addPage('position','位置',n.membraneId?section('嵌入细胞膜',row(field('w','宽度',Number(n.w.toFixed(2)),'number','min="10" max="10000"')+field('h','高度',Number(n.h.toFixed(2)),'number','min="10" max="10000"'))+'<button data-action="detach-channel">从膜上移出</button>'):position);
      }
    }else if(selection.size>1){
      context='multiple';
      badge=`<div class="object-badge">${selection.size} 个对象</div>`;
      addPage('layout','布局',section('布局','<div class="inspector-actions"><button data-action="align-x">水平对齐</button><button data-action="align-y">垂直对齐</button></div><div class="inspector-actions"><button data-action="ring">圆环排列</button><button data-action="group">组合</button><button data-action="ungroup">解组</button></div>')+section('统一样式',row(field('fontSize','字号',22,'number','min="6" max="200"')+field('color','颜色','#293b33','color'))));
    }else{
      const current=board(),widths=[...new Set(current.edges.map(edge=>edge.width))];
      const width=widths.length>1?'':Number((widths[0]??current.arrowWidth??1.8).toFixed(3));
      addPage('board','画板',section('当前画板',field('board-name','名称',current.name)
        +row(field('board-width','宽度',current.width,'number','min="200" max="10000"')
          +field('board-height','高度',current.height,'number','min="200" max="10000"'))
        +field('board-arrow-width','箭头线宽',width,'number','min="0.2" max="20" step="0.2" placeholder="混合" aria-describedby="board-arrow-width-note"')
        +'<p id="board-arrow-width-note" class="muted">统一当前画板的反应连线和独立箭头</p>')
        +'<button data-action="new-project">空白项目</button>');
      addPage('global','整体样式',section('整体样式',select('fontFamily','字体',project.fontFamily,[ [C.FONT,'Arial / 微软雅黑'],['Times New Roman, Microsoft YaHei, serif','Times New Roman'],['Calibri, Microsoft YaHei, sans-serif','Calibri']])+row(field('all-fontSize','统一字号',20,'number','min="6" max="200"')+field('all-width','统一线宽',1.8,'number','min="0.2" max="20" step="0.2"'))+'<button data-action="label-avoid">整理酶标签</button>'));
    }
    if(inspectorContext!==context||!pages.some(page=>page.id===inspectorPage))inspectorPage=pages[0].id;
    if(inspectorContext!==context)root.closest('.inspector').scrollTop=0;
    inspectorContext=context;
    root.dataset.owner=e?.id||'';
    const navigation=pages.length>1?'<div class="inspector-tabs" role="group" aria-label="属性分类">'+pages.map(({id,label})=>'<button type="button" data-inspector-tab="'+id+'" aria-pressed="'+(id===inspectorPage)+'">'+label+'</button>').join('')+'</div>':'';
    const content=pages.map(({id,content})=>'<div data-inspector-panel="'+id+'"'+(id===inspectorPage?'':' hidden')+'>'+content+'</div>').join('');
    const actions=selection.size?'<div class="inspector-actions inspector-object-actions"><button data-action="duplicate">复制一份</button><button data-action="delete" class="danger">删除所选</button></div>':'';
    root.innerHTML='<div class="inspector-head">'+badge+navigation+'</div>'+content+actions;
  }
  function showInspectorPage(page){
    inspectorPage=page;
    const root=$('inspector-content');
    for(const button of root.querySelectorAll('[data-inspector-tab]'))button.setAttribute('aria-pressed',String(button.dataset.inspectorTab===page));
    for(const panel of root.querySelectorAll('[data-inspector-panel]'))panel.hidden=panel.dataset.inspectorPanel!==page;
    root.closest('.inspector').scrollTop=0;
  }
  function expandGroup(id){const o=getObject(id);return o?.groupId?[...board().nodes,...board().edges].filter(x=>x.groupId===o.groupId).map(x=>x.id):[id];}
  function moveNodes(ids,dx,dy,initial,snapChannel=false){
    const b=board();
    for(const n of b.nodes)if(ids.has(n.id)){
      const old=initial.nodes.find(x=>x.id===n.id);n.x=old.x+dx;n.y=old.y+dy;
      if(n.template!=='channel'||ids.has(old.membraneId))continue;
      C.detachChannel(n);
      n.w=old.w;if(old.standalone===undefined)delete n.standalone;else n.standalone=old.standalone;
      if(ids.size===1&&(snapChannel||old.membraneId))C.embedChannel(b,n,snapChannel?null:old.membraneId,10*camera.w/stage.clientWidth);
    }
    C.syncMembraneChannels(b);
    for(const e of b.edges){
      if(C.isFreeArrow(e)?!ids.has(e.id):!ids.has(e.source)||!ids.has(e.target))continue;
      C.translateEdge(e,initial.edges.find(x=>x.id===e.id),dx,dy);
    }
  }
  function styleMetabolites(nodes,highlighted){
    const shape=highlighted?'round':'none';
    selection=new Set(nodes.map(node=>node.id));
    tool='select';
    update(()=>{
      for(const node of nodes){
        if(node.molecule){
          if(highlighted)node.structureHighlight=true;
          else delete node.structureHighlight;
        }else if(node.shape!==shape){
          node.shape=shape;
          if(highlighted){
            if(node.fill==='#dcebd0')node.fill='#e1efff';
            node.highlightFit=true;
          }
        }
      }
    },highlighted?'已高亮所选代谢物或结构':'已恢复普通代谢物样式');
  }
  function cofactorEndpointAt(element){
    const target=element.closest('[data-cofactor-end],[data-cofactor-label-hit]');
    return target?.dataset.cofactorEnd||target?.dataset.cofactorLabelHit;
  }
  function setCofactorHighlight(edge,cofactor,endpoint,highlighted){
    selection=new Set([edge.id]);
    activeCofactor=cofactor.id;
    activeKnockout=false;
    tool='select';
    quickMenu=endpoint;
    update(()=>{
      const key=endpoint+'Highlight';
      if(highlighted)cofactor[key]=true;
      else delete cofactor[key];
    },highlighted?'已高亮辅因子名称':'已取消辅因子高亮');
  }
  function placeCofactorHighlight(type,element){
    if(type!=='rounded'&&type!=='metabolite')return false;
    const endpoint=cofactorEndpointAt(element);
    if(!endpoint)return false;
    const id=element.closest('[data-edge-id]')?.dataset.edgeId;
    const edge=id&&getObject(id),cofactor=edge?.cofactors.find(cf=>cf.id===element.closest('[data-cofactor]')?.dataset.cofactor);
    if(!cofactor)return false;
    setCofactorHighlight(edge,cofactor,endpoint,type==='rounded');
    return true;
  }
  function placeMetabolite(type,nodeElement){
    if(type!=='metabolite'&&type!=='rounded')return false;
    const id=nodeElement?.dataset.id||nodeElement?.dataset.moleculeHit||nodeElement?.dataset.highlightOwner;
    const node=id&&getObject(id);
    if(node?.kind==='metabolite'){styleMetabolites([node],type==='rounded');return true;}
    if(type==='rounded'){
      toast('请点击已有的代谢物、结构或辅因子名称');
      return true;
    }
    return false;
  }
  function chooseHighlight(){
    if($('chemical-dialog').open||chemicalEditPending)return;
    const edge=selectedEdge(),cofactor=edge?.cofactors.find(cf=>cf.id===activeCofactor);
    if(cofactor&&['input','output'].includes(quickMenu)){
      setCofactorHighlight(edge,cofactor,quickMenu,true);
      return;
    }
    const targets=selectedNodes().filter(n=>n.kind==='metabolite');
    if(!targets.length){setTool('rounded');return;}
    styleMetabolites(targets,true);
  }
  function addNode(type,p){
    const kind=type;
    const x=snap(p.x),y=snap(p.y);
    const n=type==='chemical-bond'?C.chemicalBondNode(pendingBondStyle,x,y)
      :type==='chemical'?C.moleculeNode(pendingMolecule.data,x,y,pendingMolecule.label)
      :type==='illustration'?C.illustrationNode(pendingIllustration,x,y):C.node(kind,x,y);
    if(type==='chemical'&&pendingMolecule.compact){n.w=n.molecule.bondFragment?64:140;n.h=n.molecule.bondFragment?44:120;}
    const embedded=type==='illustration'&&C.embedChannel(board(),n,null,10*camera.w/stage.clientWidth);
    board().nodes.push(n);
    selection=new Set([n.id]);
    if(type!=='chemical'||!chemicalToolLocked)tool='select';
    markChemicalTool();
    if(kind==='metabolite'||kind==='text'){render();editText(n.id,{isNew:true});}
    else commit(embedded?'通道蛋白已嵌入细胞膜':'已添加组件');
  }
  function startDrag(type,p,extra={}){drag={type,start:p,current:p,initial:C.clone(board()),...extra};}
  canvas.addEventListener('pointerdown',e=>{
    if(chemicalEditPending){toast('正在更新化学结构');return;}
    if(e.button!==0&&e.button!==1)return;const p=world(e);canvas.focus();canvas.setPointerCapture(e.pointerId);
    if(e.button===1||tool==='pan'||space){startDrag('pan',p,{camera:{...camera},client:{x:e.clientX,y:e.clientY}});return;}
    if(tool==='arrow'){
      if(p.x<0||p.y<0||p.x>board().width||p.y>board().height)return;
      const start=arrowPoint(p);
      const arrow=C.freeArrow(start,start);
      arrow.width=board().arrowWidth??arrow.width;
      startDrag('draw-arrow',p,{arrow,boardId});
      selection.clear();
      render();
      return;
    }
    if(tool==='cycle'&&pendingCycle){if(p.x<0||p.y<0||p.x>board().width||p.y>board().height)return;const center=cyclePlacement(p),fragment=pendingCycle;fragment.nodes.forEach(n=>{n.x+=center.x;n.y+=center.y;});board().nodes.push(...fragment.nodes);if(board().arrowWidth!==undefined)fragment.edges.forEach(edge=>edge.width=board().arrowWidth);board().edges.push(...fragment.edges);selection=new Set([...fragment.nodes,...fragment.edges].map(o=>o.id));pendingCycle=null;cyclePointer=null;tool='select';commit('整条环形途径已生成；点箭头即可改双向或添加辅因子');return;}
    if(placeCofactorHighlight(tool,e.target))return;
    const handle=e.target.closest('[data-handle]');
    const chemicalPart=e.target.closest('[data-chem-owner]');
    const extendSelection=tool==='select'&&(e.shiftKey||e.ctrlKey||e.metaKey);
    const moveSelection=tool==='select'&&(extendSelection||selection.size>1);
    const chemicalBond=moveSelection?null:e.target.closest('[data-chem-bond]');if(chemicalBond){const owner=chemicalBond.dataset.chemOwner,index=Number(chemicalBond.dataset.chemBond),n=getObject(owner),m=moleculeMetadata(n);selection=new Set([owner]);activeChemicalAtom=null;if(tool==='chemical-erase'){eraseChemical(owner,'bond',index);return;}if(isChemicalRingTool()){addChemicalRing(owner,{bond:index});return;}if(isChemicalBondTool()){const b=m.bondSites[index];extendChemical(owner,b.a,C.moleculeAtomPosition(n,b.b,m),selectedBondStyle()).catch(err=>toast(err.message));return;}startDrag('nodes',p,{ids:new Set([owner]),editId:owner,chemical:true});render();return;}
    const atom=!moveSelection&&(tool==='select'||isChemicalDrawingTool())?e.target.closest('[data-chem-atom],[data-chem-glyph]'):null;
    if(atom){
      const owner=atom.dataset.chemOwner,index=Number(atom.dataset.chemAtom??atom.dataset.chemGlyph);
      selection=new Set([owner]);
      activeChemicalAtom={owner,index};
      if(tool==='chemical-group'){applyChemicalGroup(owner,index,pendingChemicalGroup);return;}
      if(tool==='chemical-erase'){eraseChemical(owner,'atom',index);return;}
      if(isChemicalRingTool()){addChemicalRing(owner,{atom:index});return;}
      if(tool==='select')startDrag('chemical-atom-move',p,{owner,atom:index});
      if(isCarbonChainTool()){
        startDrag('chemical-link',p,{owner,atom:index,style:'single',chain:pendingMolecule.data,free:e.altKey});
      }else if(isChemicalBondTool())startDrag('chemical-link',p,{owner,atom:index,style:selectedBondStyle(),free:e.altKey});
      render();
      return;
    }
    activeChemicalAtom=null;
    if(handle?.dataset.handle==='selection-scale'&&!extendSelection){
      const frame=scaleFrame();
      if(frame)startDrag('selection-scale',p,{pivot:frame.center,ids:frame.ids});
      return;
    }
    if(handle&&!extendSelection&&!isReactionTool()){
      const n=getObject(handle.dataset.owner),box=n?.molecule?C.moleculeGraphicBounds(n):null,pivot=box?{x:(box.left+box.right)/2,y:(box.top+box.bottom)/2}:null;
      const cf=handle.dataset.cf;
      startDrag('handle',p,{owner:handle.dataset.owner,handle:handle.dataset.handle,index:Number(handle.dataset.index||0),cf,pivot,startAngle:pivot?Math.atan2(p.y-pivot.y,p.x-pivot.x):0});
      if(cf&&cf!==activeCofactor){activeCofactor=cf;activeKnockout=false;quickMenu=null;render();}
      return;
    }
    const nodeEl=e.target.closest('[data-id],[data-molecule-hit],[data-highlight-owner]'),edgeEl=e.target.closest('[data-edge-id]');
    const nodeId=nodeEl?.dataset.id||nodeEl?.dataset.moleculeHit||nodeEl?.dataset.highlightOwner||(moveSelection?chemicalPart?.dataset.chemOwner:null),id=nodeId||edgeEl?.dataset.edgeId||(extendSelection?handle?.dataset.owner:null);
    if(tool==='chemical-loading'){if(p.x>=0&&p.y>=0&&p.x<=board().width&&p.y<=board().height)chemicalDropPoint=p;return;}
    if(tool==='chemical-group'){toast('请点击结构中的原子顶点');return;}
    if(tool==='chemical-erase'){if(nodeEl&&(getObject(id)?.molecule||getObject(id)?.chemicalBond))update(()=>C.deleteObjects(board(),[id]),'已删除结构，可撤销恢复');return;}
    if(isReactionTool()){
      const n=nodeId&&getObject(nodeId);if(!n||n.chemicalBond||!['metabolite','text'].includes(n.kind)){toast('请选择代谢物节点作为反应端点');return;}
      if(!sourceId){sourceId=n.id;render();return;}
      if(sourceId===n.id)return;
      const re=C.edge(sourceId,n.id),routed=tool==='right-route';
      if(routed){
        const preset=C.rightRoutePreset(board(),sourceId,n.id);
        if(!preset)return toast('右侧或下方空间不足，请调整节点位置后再试');
        Object.assign(re,preset);
      }
      re.width=board().arrowWidth??re.width;
      board().edges.push(re);selection=new Set([re.id]);sourceId=null;tool='select';
      commit(routed?'已绘制右侧圆角绕行':'已连接反应，可在右侧设置路径与酶标签');return;
    }
    if(tool!=='select'){
      if(placeMetabolite(tool,nodeEl))return;
      if(p.x>=0&&p.y>=0&&p.x<=board().width&&p.y<=board().height)addNode(tool,p);
      return;
    }
    if(id){
      const ids=nodeId||C.isFreeArrow(getObject(id))?expandGroup(id):[id];
      if(extendSelection){
        const remove=ids.every(id=>selection.has(id));
        for(const id of ids)if(remove)selection.delete(id);else selection.add(id);
        activeCofactor=null;
        activeKnockout=false;
        quickMenu=null;
        render();
        return;
      }
      if(edgeEl&&!nodeId)selection=new Set(ids);else if(!selection.has(id))selection=new Set(ids);
      activeCofactor=e.target.closest('[data-cofactor]')?.dataset.cofactor||null;quickMenu=null;
      const endpoint=cofactorEndpointAt(e.target);
      const label=e.target.closest('[data-label],[data-label-hit]'),nodeLabel=e.target.closest('[data-node-label]'),knockoutText=e.target.closest('[data-knockout-label]'),knockoutMark=e.target.closest('[data-knockout-mark]');
      activeKnockout=!!(knockoutText||knockoutMark);
      if(endpoint&&activeCofactor)startDrag('cofactor-label',p,{owner:id,cf:activeCofactor,endpoint});
      else if(activeCofactor)startDrag('cofactor-branch',p,{owner:id,cf:activeCofactor});
      else if(knockoutMark)startDrag('knockout-mark',p,{owner:id});
      else if(knockoutText)startDrag('knockout-label',p,{owner:id});
      else if(nodeLabel&&selection.size===1)startDrag('node-label',p,{owner:nodeLabel.dataset.nodeLabel});
      else if(label)startDrag('label',p,{owner:label.dataset.label||label.dataset.labelHit});
      else if(nodeId)startDrag('nodes',p,{ids:new Set(selection),editId:id,chemical:!!getObject(id)?.molecule&&!e.target.closest('[data-molecule-name]')});
      else if(C.isFreeArrow(getObject(id)))startDrag('nodes',p,{ids:new Set(expandGroup(id))});
      render();if(nodeId&&getObject(id)?.molecule&&!moleculeMetadata(getObject(id)))prepareChemicalTargets().then(()=>renderCanvas()).catch(err=>toast(err.message));
    }else{if(!extendSelection)selection.clear();startDrag('marquee',p,{prior:new Set(selection)});render();}
  });
  canvas.addEventListener('pointermove',e=>{if(tool==='cycle'&&pendingCycle&&!drag){cyclePointer=world(e);renderCanvas();return;}if(!drag)return;const p=world(e);drag.current=p;const dx=p.x-drag.start.x,dy=p.y-drag.start.y;
    if(drag.type==='draw-arrow'){
      drag.moved=Math.hypot(dx,dy)>=3*camera.w/stage.clientWidth;
      drag.arrow.end=arrowPoint(p);
      renderCanvas();
      return;
    }
    if(['nodes','label','node-label','cofactor-label','cofactor-branch','knockout-label','knockout-mark','chemical-link','chemical-atom-move','handle','selection-scale'].includes(drag.type)&&!drag.moved){if(Math.hypot(dx,dy)<3*camera.w/stage.clientWidth)return;drag.moved=true;}
    if(drag.type==='chemical-link'){
      const n=getObject(drag.owner),m=moleculeMetadata(n),scale=Math.min(n.w/m.width,n.h/m.height);
      const hit=nearbyChemicalAtom(p,10*camera.w/stage.clientWidth,(node,i)=>node.id===drag.owner&&i===drag.atom);
      const toWorld=q=>({x:n.x+(q.x-m.width/2)*scale,y:n.y+(q.y-m.height/2)*scale});
      const site={x:(p.x-n.x)/scale+m.width/2,y:(p.y-n.y)/scale+m.height/2},free=drag.free||e.altKey;
      if(hit)drag.preview=[hit.point];
      else if(drag.chain)drag.preview=PathwayChemistry.carbonChainSites(m,drag.atom,site,drag.chain,0,free).map(toWorld);
      else drag.preview=[free?p:toWorld(PathwayChemistry.snapEndpoint(m,drag.atom,site,drag.style))];
    }
    if(drag.type==='pan'){autoFit=false;camera.x=drag.camera.x-(e.clientX-drag.client.x)*camera.w/stage.clientWidth;camera.y=drag.camera.y-(e.clientY-drag.client.y)*camera.h/stage.clientHeight;}
    if(drag.type==='nodes')moveNodes(drag.ids,snap(dx),snap(dy),drag.initial,true);
    if(drag.type==='selection-scale'){
      const x=drag.start.x-drag.pivot.x,y=drag.start.y-drag.pivot.y;
      const ratio=1+(x*dx+y*dy)/Math.max(1,x*x+y*y);
      C.scaleSelection(board(),drag.initial,drag.ids,drag.pivot,C.clamp(ratio,.12,8));
    }
    if(drag.type==='label'){
      const edge=getObject(drag.owner),original=drag.initial.edges.find(e=>e.id===edge.id);
      const delta=C.edgeLabelOffset(edge,C.geometry(edge,board()),dx,dy);
      edge.labelDx=original.labelDx+delta.labelDx;
      edge.labelDy=original.labelDy+delta.labelDy;
    }
    if(drag.type==='knockout-mark'){const re=getObject(drag.owner),old=drag.initial.edges.find(x=>x.id===re.id);re.knockoutMarkDx=(old.knockoutMarkDx||0)+snap(dx);re.knockoutMarkDy=(old.knockoutMarkDy||0)+snap(dy);}
    if(drag.type==='knockout-label'){const re=getObject(drag.owner),old=drag.initial.edges.find(x=>x.id===re.id);re.knockoutDx=(old.knockoutDx||0)+snap(dx);re.knockoutDy=(old.knockoutDy||0)+snap(dy);}
    if(drag.type==='node-label'){const n=getObject(drag.owner),old=drag.initial.nodes.find(x=>x.id===n.id);n.labelDx=(old.labelDx||0)+dx;n.labelDy=(old.labelDy||0)+dy;}
    if(drag.type==='cofactor-label'){const cf=getObject(drag.owner).cofactors.find(c=>c.id===drag.cf),old=drag.initial.edges.find(e=>e.id===drag.owner).cofactors.find(c=>c.id===drag.cf),key=drag.endpoint+'Label';cf[key+'Dx']=(old[key+'Dx']||0)+snap(dx);cf[key+'Dy']=(old[key+'Dy']||0)+snap(dy);}
    if(drag.type==='cofactor-branch'){const re=getObject(drag.owner),cf=re.cofactors.find(c=>c.id===drag.cf),old=drag.initial.edges.find(e=>e.id===drag.owner).cofactors.find(c=>c.id===drag.cf),g=C.geometry(re,board()),at=g.at(old.t??.5);cf.t=C.nearestPathPosition(g,{x:at.x+dx,y:at.y+dy});}
    if(drag.type==='handle'){
      const o=getObject(drag.owner),free=C.isFreeArrow(o),g=o.source||free?C.geometry(o,board()):null;
      if(free&&(drag.handle==='start'||drag.handle==='end')){
        const point=arrowPoint(p),other=o[drag.handle==='start'?'end':'start'];
        if(Math.hypot(point.x-other.x,point.y-other.y)>=.01)o[drag.handle]=point;
      }
      if(drag.handle==='molecule-rotate')drag.rotationDelta=(Math.atan2(p.y-drag.pivot.y,p.x-drag.pivot.x)-drag.startAngle)*180/Math.PI;
      if(drag.handle==='molecule-resize'){
        const old=drag.initial.nodes.find(n=>n.id===o.id);
        const x=drag.start.x-old.x,y=drag.start.y-old.y;
        const ratio=1+(x*dx+y*dy)/Math.max(1,x*x+y*y);
        const scale=C.clamp(ratio,10/Math.min(old.w,old.h),10000/Math.max(old.w,old.h));
        o.w=old.w*scale;
        o.h=old.h*scale;
      }
      if(drag.handle==='resize'){if(o.kind==='metabolite'&&o.shape==='round')o.highlightFit=false;const angle=o.chemicalBond||['membrane','illustration'].includes(o.kind)?-(o.rotation||0)*Math.PI/180:0,dx=p.x-o.x,dy=p.y-o.y;o.w=Math.max(20,snap((dx*Math.cos(angle)-dy*Math.sin(angle))*2));o.h=Math.max(20,snap((dx*Math.sin(angle)+dy*Math.cos(angle))*2));}
      if(drag.handle==='rotate'&&!o.membraneId)o.rotation=(Math.round(Math.atan2(p.y-o.y,p.x-o.x)*180/Math.PI+90)+360)%360;
      if(drag.handle==='c1'||drag.handle==='c2'){const n=C.edgeEndpoints(o,board())[drag.handle==='c1'?0:1];o[drag.handle]={x:snap(p.x)-n.x,y:snap(p.y)-n.y};}
      if(drag.handle==='arc'){const [s,t]=C.edgeEndpoints(o,board()),a=o.sourcePort==='auto'?s:g.a,z=o.targetPort==='auto'?t:g.z,d=Math.hypot(z.x-a.x,z.y-a.y)||1,m=C.mix(a,z,.5);o.bulge=C.clamp((p.x-m.x)*-(z.y-a.y)/d+(p.y-m.y)*(z.x-a.x)/d,-2000,2000);}
      if(drag.handle==='point')o.points[drag.index]={x:snap(p.x),y:snap(p.y)};
      if(drag.handle==='cofactor'){const cf=o.cofactors.find(x=>x.id===drag.cf),at=g.at(cf.t);cf.dx=p.x-at.x;cf.dy=p.y-at.y;}
      if(drag.handle==='cofactor-spread'){
        const cf=o.cofactors.find(c=>c.id===drag.cf),old=drag.initial.edges.find(e=>e.id===o.id).cofactors.find(c=>c.id===cf.id);
        const q=C.cofactorGeometry(o,g,old),vx=q.output.x-q.input.x,vy=q.output.y-q.input.y;
        const change=(dx*vx+dy*vy)/(Math.hypot(vx,vy)||1);
        cf.spread=C.clamp(q.spread+(drag.index===0?-change:change),10,300);
      }
      if(o.kind==='membrane'||o.membraneId)C.syncMembraneChannels(board());
    }
    renderCanvas();
  });
  async function finishDrag(e){if(!drag)return;const d=drag;drag=null;
    if(d.type==='draw-arrow'){
      if(e&&canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
      if(!e||d.boardId!==boardId){render();return;}
      const p=world(e),{arrow}=d;
      arrow.end=arrowPoint(p);
      if(Math.hypot(p.x-d.start.x,p.y-d.start.y)<3*camera.w/stage.clientWidth||
         Math.hypot(arrow.end.x-arrow.start.x,arrow.end.y-arrow.start.y)<.01){render();return;}
      board().edges.push(arrow);
      selection=new Set([arrow.id]);
      tool='select';
      commit('已添加独立箭头');
      return;
    }
    if(d.handle==='molecule-rotate'){if(e&&canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(d.moved)await rotateChemical(d.owner,d.rotationDelta||0,d.pivot);else render();return;}
    if(d.type==='chemical-atom-move'){if(e&&canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(d.moved)await moveChemicalAtom(d.owner,d.atom,d.current);else{const key=d.owner+'|'+d.atom,now=Date.now();if(lastAtomTap?.key===key&&now-lastAtomTap.time<450){lastAtomTap=null;openAtomEditor(d.owner,d.atom);}else{lastAtomTap={key,time:now};render();}}return;}
    if(d.type==='chemical-link'){
      if(e&&canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
      try{
        await extendChemical(d.owner,d.atom,d.current,d.style,{chain:d.chain,free:d.free||e?.altKey,appendOnly:!!d.chain&&!d.moved});
      }catch(err){toast('未连接：'+err.message);render();}
      return;
    }
    if(d.type==='nodes'&&d.moved&&d.ids.size===1){
      const node=getObject([...d.ids][0]);
      if(node?.molecule?.smiles==='CCCC'&&node.molecule.atomSites){
        try{if(await attachLooseChain(node))return;}
        catch(err){toast('未吸附：'+err.message);}
      }
    }
    if(d.type==='nodes'&&d.moved&&d.ids.size===1){const n=getObject([...d.ids][0]);if(n?.molecule?.bondFragment&&n.molecule.atoms===2){if(e&&canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);try{const engine=await chemicalEngine(),m=moleculeMetadata(n),g=engine.parseMol(m.molblock);if(g.atoms.every(a=>a.symbol==='C')&&!/M  (ISO|CHG)/.test(m.molblock)){const b=m.bondSites[0],a=C.moleculeAtomPosition(n,b.a,m),z=C.moleculeAtomPosition(n,b.b,m),proxy={id:n.id,x:(a.x+z.x)/2,y:(a.y+z.y)/2,w:Math.hypot(z.x-a.x,z.y-a.y),rotation:Math.atan2(z.y-a.y,z.x-a.x)*180/Math.PI,chemicalBond:m.bondStyles?.[0]?.type||({1:'single',2:'double',3:'triple'}[b.order])};if(await attachLooseBond(proxy,e?.altKey))return;}}catch(err){toast('未吸附：'+err.message);}}if(n?.chemicalBond){if(e&&canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);try{if(await attachLooseBond(n,e?.altKey))return;}catch(err){toast('未吸附：'+err.message);}}}
    if(e&&!d.moved&&d.type==='node-label'&&getObject(d.owner)?.template==='channel'){
      if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
      editText(d.owner);return;
    }
    const editNode=d.type==='nodes'?getObject(d.editId):null;
    const editGroupedLabel=editNode?.groupId&&!editNode.molecule&&['metabolite','text'].includes(editNode.kind);
    const canEditNode=editNode&&editNode.kind!=='membrane'&&!editNode.chemicalBond&&(d.ids.size===1||editGroupedLabel);
    const editId=canEditNode?editNode.id:['label','node-label','cofactor-label','knockout-label'].includes(d.type)?d.owner:null;
    if(editId&&!d.moved&&e){const key=editId+'|'+d.type+'|'+(d.cf||'')+'|'+(d.endpoint||''),now=Date.now(),second=lastTextTap?.key===key&&now-lastTextTap.time<450;lastTextTap={key,time:now};if(second){lastTextTap=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(d.chemical){editChemicalOnCanvas(editId);return;}editText(editId,d.type==='cofactor-label'?{cf:d.cf,endpoint:d.endpoint}:d.type==='knockout-label'?{knockout:true}:{});return;}}else if(d.moved)lastTextTap=null;
    if(d.type==='cofactor-label'&&!d.moved){if(e)quickMenu=d.endpoint;if(e&&canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);render();return;}
    if(d.type==='marquee'){
      const x1=Math.min(d.start.x,d.current.x),x2=Math.max(d.start.x,d.current.x),y1=Math.min(d.start.y,d.current.y),y2=Math.max(d.start.y,d.current.y);
      const contains=p=>p.x>=x1&&p.x<=x2&&p.y>=y1&&p.y<=y2;
      selection=d.prior;
      for(const n of board().nodes)if(contains(n))expandGroup(n.id).forEach(id=>selection.add(id));
      for(const e of board().edges){
        if(C.isFreeArrow(e)){if(contains(e.start)&&contains(e.end))expandGroup(e.id).forEach(id=>selection.add(id));}
        else if(selection.has(e.source)&&selection.has(e.target))selection.add(e.id);
      }
    }
    if(e&&canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(d.type!=='pan'&&d.type!=='marquee')commit();else render();
  }
  canvas.addEventListener('pointerup',finishDrag);canvas.addEventListener('pointercancel',()=>{if(drag){const i=project.boards.findIndex(b=>b.id===boardId);project.boards[i]=drag.initial;drag=null;render();}});
  canvas.addEventListener('dblclick',e=>{if(tool==='select'&&selection.size>1)return;const atom=e.target.closest('[data-chem-atom],[data-chem-glyph]');if(atom){if(!atomEditorTarget)openAtomEditor(atom.dataset.chemOwner,Number(atom.dataset.chemAtom??atom.dataset.chemGlyph));return;}if(e.target.closest('[data-knockout-mark]'))return;if(inlineText||$('chemical-dialog').open)return;const ko=e.target.closest('[data-knockout-label]');if(ko){editText(ko.dataset.knockoutLabel,{knockout:true});return;}const cf=e.target.closest('[data-cofactor]'),end=cofactorEndpointAt(e.target);if(cf&&end){editText(e.target.closest('[data-edge-id]').dataset.edgeId,{cf:cf.dataset.cofactor,endpoint:end});return;}if(cf)return;const n=e.target.closest('[data-id],[data-molecule-hit],[data-highlight-owner]'),label=e.target.closest('[data-label],[data-label-hit]'),re=e.target.closest('[data-edge-id]');if(n){const id=n.dataset.id||n.dataset.moleculeHit||n.dataset.highlightOwner,object=getObject(id);if(object?.chemicalBond)return;if(object?.molecule&&!e.target.closest('[data-molecule-name]'))editChemicalOnCanvas(id);else if(object?.kind!=='membrane')editText(id);}else if(label)editText(label.dataset.label||label.dataset.labelHit);else if(re){const obj=getObject(re.dataset.edgeId);addWaypoint(obj,world(e));commit('已添加绕行点，拖动蓝色点调整');}});
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.0013),world(e));},{passive:false});
  document.querySelectorAll('[data-tool]').forEach(el=>{el.addEventListener('click',()=>el.dataset.tool==='rounded'?chooseHighlight():setTool(el.dataset.tool));el.addEventListener('dragstart',e=>e.dataTransfer.setData('application/pathway-component',el.dataset.tool));});
  stage.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('application/pathway-component'))e.preventDefault();});
  stage.addEventListener('drop',e=>{
    e.preventDefault();
    const type=e.dataTransfer.getData('application/pathway-component');
    if(placeCofactorHighlight(type,e.target))return;
    if(placeMetabolite(type,e.target.closest('[data-id],[data-molecule-hit],[data-highlight-owner]')))return;
    if(['metabolite','rounded','text','membrane','module'].includes(type))addNode(type,world(e));
  });
  function editorLabel(){const runs=[];function walk(node,script='normal'){if(node.nodeType===3){runs.push({text:node.textContent,script});return;}if(node.nodeName==='BR'){runs.push({text:'\n',script:'normal'});return;}const mark=node.nodeName==='SUB'?'sub':node.nodeName==='SUP'?'super':script;for(const child of node.childNodes)walk(child,mark);}const input=$('inline-text-input');if(input.innerHTML==='<br>')return '';for(const child of input.childNodes)walk(child);return C.runsToLabel(runs);}
  function editorSelection(){const input=$('inline-text-input'),selection=window.getSelection();if(!selection.rangeCount)return inlineText?.range||null;const range=selection.getRangeAt(0);if(!input.contains(range.startContainer)||!input.contains(range.endContainer))return inlineText?.range||null;const before=range.cloneRange();before.selectNodeContents(input);before.setEnd(range.startContainer,range.startOffset);const after=range.cloneRange();after.selectNodeContents(input);after.setEnd(range.endContainer,range.endOffset);const result={start:before.toString().length,end:after.toString().length};if(inlineText)inlineText.range=result;return result;}
  function selectEditorText(start,end){const input=$('inline-text-input'),walker=document.createTreeWalker(input,NodeFilter.SHOW_TEXT),nodes=[];let node;while((node=walker.nextNode()))nodes.push(node);const point=offset=>{for(const n of nodes){if(offset<=n.textContent.length)return[n,offset];offset-=n.textContent.length;}return nodes.length?[nodes.at(-1),nodes.at(-1).textContent.length]:[input,0];};const a=point(start),z=point(end),range=document.createRange();range.setStart(...a);range.setEnd(...z);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);input.focus();}
  function editorTarget(){
    if(!inlineText)return null;const object=getObject(inlineText.id);if(!object)return null;let target;
    if(inlineText.cf){const cf=object.cofactors.find(c=>c.id===inlineText.cf),g=C.geometry(object,board());if(!cf)return null;const q=C.cofactorGeometry(object,g,cf),point=inlineText.endpoint==='input'?q.inputLabel:q.outputLabel,style=C.cofactorTextStyle(object,cf,inlineText.endpoint);target={object:cf,key:inlineText.endpoint,styleKey:inlineText.endpoint+'Style',x:point.x,y:point.y,anchor:point.anchor,size:style.fontSize,color:style.color,fontFamily:style.fontFamily,bold:style.bold};}
    else if(inlineText.knockout){const label=C.knockoutTextGeometry(object,C.geometry(object,board()));target={object,key:'knockoutLabel',styleKey:'knockoutStyle',...label,anchor:'middle',size:label.fontSize};}
    else if(object.source||C.isFreeArrow(object)){const g=C.geometry(object,board());target={object,key:'label',styleMap:{fontFamily:'labelFontFamily',size:'fontSize',color:'labelColor',bold:'labelBold'},...C.edgeLabelGeometry(object,g),size:object.fontSize,color:object.labelColor,italic:object.labelItalic,bold:object.labelBold??false,fontFamily:object.labelFontFamily||''};}
    else target={object,key:'label',styleMap:{fontFamily:'fontFamily',size:'fontSize',color:'color',bold:object.kind==='module'?'labelBold':'bold'},x:object.kind==='module'?object.x-object.w/2+18:object.x+(object.labelDx||0),y:object.kind==='module'?object.y-object.h/2+23:object.y+(object.labelDy||0),anchor:object.kind==='module'?'start':object.labelAnchor||'middle',size:object.fontSize,color:object.color,italic:object.italic,bold:object.kind==='module'?(object.labelBold??true):object.bold,fontFamily:object.fontFamily||''};
    if(!inlineText.cf&&!inlineText.knockout&&object.kind==='illustration')Object.assign(target,C.illustrationLabelPosition(object));if(object.molecule)Object.assign(target,C.moleculeLabelPosition(object));return inlineText.style?{...target,...inlineText.style}:target;
  }
  function syncEditorStyle(){if(!inlineText)return;const style=inlineText.style,select=$('inline-font-family');if(![...select.options].some(o=>o.value===style.fontFamily))select.add(new Option(style.fontFamily,style.fontFamily));select.value=style.fontFamily;$('inline-font-size').value=style.size;$('inline-font-color').value=/^#[0-9a-f]{6}$/i.test(style.color)?style.color:'#202c29';$('inline-font-bold').setAttribute('aria-pressed',String(!!style.bold));$('inline-font-bold').classList.toggle('active',!!style.bold);}
  function applyEditorStyle(target,state){for(const key of ['fontFamily','size','color','bold'])if(state.style[key]!==state.initialStyle[key]){if(target.styleKey){const storageKey=key==='size'?'fontSize':key;target.object[target.styleKey]={...(target.object[target.styleKey]||{}),[storageKey]:state.style[key]};}else target.object[target.styleMap[key]]=state.style[key];}}
  function positionTextEditor(){if(!inlineText)return;const target=editorTarget();if(!target)return;const root=$('inline-text-editor'),input=$('inline-text-input'),scale=stage.clientWidth/camera.w,size=Math.max(6,target.size*scale),plain=C.labelRuns(editorLabel()).map(r=>r.text).join(''),lines=plain.split('\n'),width=Math.min(stage.clientWidth-20,Math.max(150,...lines.map(l=>Array.from(l).length*size*.66+24))),height=Math.max(40,lines.length*size*1.45+14),x=(target.x-camera.x)*scale,y=(target.y-camera.y)*scale,left=C.clamp(x-(target.anchor==='start'?8:target.anchor==='end'?width-8:width/2),8,stage.clientWidth-width-8),top=C.clamp(y-height/2,8,stage.clientHeight-height-45);root.style.left=left+'px';root.style.top=top+'px';root.style.width=width+'px';root.classList.toggle('tools-below',top<48);input.style.fontSize=size+'px';input.style.color=target.color;input.style.fontFamily=target.fontFamily||project.fontFamily||C.FONT;input.style.fontStyle=target.italic?'italic':'normal';input.style.fontWeight=target.bold?'700':'400';input.style.textAlign=target.anchor==='start'?'left':target.anchor==='end'?'right':'center';const tools=root.querySelector('.inline-text-tools');tools.style.maxWidth=Math.max(100,stage.clientWidth-16)+'px';tools.style.left=Math.max(8-left,Math.min(0,stage.clientWidth-8-left-tools.offsetWidth))+'px';root.classList.toggle('tools-below',top<tools.offsetHeight+8);for(const text of canvas.querySelectorAll('text')){const node=text.closest('[data-id]'),cf=text.closest('[data-cofactor]');if(inlineText.cf?cf?.dataset.cofactor===inlineText.cf&&text.dataset.cofactorEnd===inlineText.endpoint:node?.dataset.id===inlineText.id||text.dataset.label===inlineText.id)text.style.visibility='hidden';}}
  function recordEditor(){if(!inlineText)return;const value=editorLabel(),range=editorSelection()||{start:0,end:0},style=C.clone(inlineText.style),last=inlineText.history[inlineText.index];if(value!==last.value||JSON.stringify(style)!==JSON.stringify(last.style)){inlineText.history=inlineText.history.slice(0,inlineText.index+1);inlineText.history.push({value,range,style});inlineText.index=inlineText.history.length-1;}positionTextEditor();}
  function editText(id,options={}){if(inlineText&&!finishText(true))return;inlineText={id,...options,history:[],index:0,composing:false};const target=editorTarget();if(!target){inlineText=null;return;}quickMenu=null;activeKnockout=!!options.knockout;activeCofactor=options.cf||null;const value=target.object[target.key]||'',style={fontFamily:target.fontFamily||'',size:target.size,color:target.color,bold:!!target.bold},range={start:options.knockout&&/^[Δ△]/.test(value)?1:0,end:C.labelRuns(value).reduce((n,r)=>n+r.text.length,0)};inlineText.style=C.clone(style);inlineText.initialStyle=C.clone(style);inlineText.range=range;inlineText.history=[{value,range,style:C.clone(style)}];$('inline-text-input').innerHTML=C.labelEditorHTML(value);$('inline-text-editor').hidden=false;syncEditorStyle();renderQuickActions();$('reaction-actions').hidden=true;positionTextEditor();const current=inlineText;requestAnimationFrame(()=>{if(inlineText===current)selectEditorText(current.history[0].range.start,current.history[0].range.end);});}
  function finishText(accept){if(!inlineText)return true;const state=inlineText,target=editorTarget(),value=editorLabel();if(accept&&value.length>2000){toast('文字过长，请缩短到 2000 字符以内');return false;}inlineText=null;$('inline-text-editor').hidden=true;if(!target)return true;if(!accept||!value.trim()&&state.isNew){if(state.isNew){C.deleteObjects(board(),[state.id]);selection.clear();}render();return true;}target.object[target.key]=value;applyEditorStyle(target,state);commit();return true;}
  function insertEditorText(value,formatted=false){const input=$('inline-text-input'),saved=editorSelection();selectEditorText(saved?.start??input.textContent.length,saved?.end??input.textContent.length);const selection=window.getSelection(),range=selection.getRangeAt(0);range.deleteContents();let last;if(formatted){const template=document.createElement('template');template.innerHTML=C.labelEditorHTML(value);last=template.content.lastChild;range.insertNode(template.content);}else{last=document.createTextNode(value);range.insertNode(last);}if(last){range.setStartAfter(last);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}recordEditor();}
  function undoEditor(forward){if(!inlineText)return;const next=inlineText.index+(forward?1:-1);if(next<0||next>=inlineText.history.length)return;inlineText.index=next;const entry=inlineText.history[next];inlineText.style=C.clone(entry.style);syncEditorStyle();$('inline-text-input').innerHTML=C.labelEditorHTML(entry.value);selectEditorText(entry.range.start,entry.range.end);positionTextEditor();}
  $('inline-text-input').addEventListener('input',()=>{if(!inlineText?.composing)recordEditor();});
  $('inline-text-input').addEventListener('compositionstart',()=>{if(inlineText)inlineText.composing=true;});
  $('inline-text-input').addEventListener('compositionend',()=>{if(inlineText){inlineText.composing=false;recordEditor();}});
  $('inline-text-input').addEventListener('paste',ev=>{ev.preventDefault();insertEditorText(ev.clipboardData.getData('text/plain'));});
  $('inline-text-input').addEventListener('drop',ev=>{ev.preventDefault();ev.stopPropagation();insertEditorText(ev.dataTransfer.getData('text/plain'));});
  $('inline-text-input').addEventListener('keydown',ev=>{if(!inlineText||ev.isComposing||inlineText.composing)return;const mod=ev.ctrlKey||ev.metaKey,key=ev.key.toLowerCase();if(key==='escape'){ev.preventDefault();ev.stopPropagation();finishText(false);return;}if(key==='enter'){ev.preventDefault();ev.stopPropagation();if(ev.shiftKey)insertEditorText('\n');else finishText(true);return;}if(mod&&key==='s'){ev.preventDefault();ev.stopPropagation();if(finishText(true))save();return;}if(mod&&key==='b'){ev.preventDefault();ev.stopPropagation();inlineText.style.bold=!inlineText.style.bold;syncEditorStyle();recordEditor();return;}if(mod&&['z','y'].includes(key)){ev.preventDefault();ev.stopPropagation();undoEditor(key==='y'||ev.shiftKey);}});
  $('inline-text-editor').addEventListener('mousedown',ev=>{if(ev.target.closest('button'))ev.preventDefault();});
  document.addEventListener('selectionchange',()=>{if(inlineText)editorSelection();});
  $('inline-font-family').addEventListener('change',ev=>{if(!inlineText)return;inlineText.style.fontFamily=ev.target.value;recordEditor();});
  $('inline-font-size').addEventListener('input',ev=>{if(!inlineText||ev.target.value==='')return;const size=Number(ev.target.value);if(Number.isFinite(size)){inlineText.style.size=C.clamp(size,6,200);recordEditor();}});
  $('inline-font-size').addEventListener('change',()=>{if(inlineText)syncEditorStyle();});
  $('inline-font-color').addEventListener('input',ev=>{if(inlineText){inlineText.style.color=ev.target.value;recordEditor();}});
  $('inline-text-editor').addEventListener('keydown',ev=>{if(ev.target.id==='inline-text-input'||!inlineText)return;if((ev.ctrlKey||ev.metaKey)&&['z','y'].includes(ev.key.toLowerCase())){ev.preventDefault();ev.stopPropagation();undoEditor(ev.key.toLowerCase()==='y'||ev.shiftKey);}else if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();finishText(false);}else if(ev.key==='Enter'&&ev.target.id==='inline-font-size'){ev.preventDefault();ev.stopPropagation();finishText(true);}});
  $('inline-text-editor').addEventListener('click',ev=>{const button=ev.target.closest('button');if(!button||!inlineText)return;if(button.dataset.textColor){inlineText.style.color=button.dataset.textColor;syncEditorStyle();recordEditor();return;}if(button.id==='inline-font-bold'){inlineText.style.bold=!inlineText.style.bold;syncEditorStyle();recordEditor();return;}if(button.dataset.script){const range=editorSelection();if(!range||range.start===range.end){toast('请先选中需要设置上下标的字符');return;}const value=C.formatLabelRange(editorLabel(),range.start,range.end,button.dataset.script);$('inline-text-input').innerHTML=C.labelEditorHTML(value);selectEditorText(range.start,range.end);recordEditor();}});
  $('inline-text-done').onclick=()=>finishText(true);$('inline-text-cancel').onclick=()=>finishText(false);
  document.addEventListener('pointerdown',ev=>{if(inlineText&&!ev.target.closest('#inline-text-editor')){if(!finishText(true)){ev.preventDefault();ev.stopPropagation();}}},true);
  function addWaypoint(e,p){const g=C.geometry(e,board());if(e.mode!=='route'){e.mode='route';e.points=[];}if(e.points.length>=200)return;const pts=[g.a,...e.points,g.z];if(!p){let longest=-1;for(let i=0;i<pts.length-1;i++){const length=Math.hypot(pts[i+1].x-pts[i].x,pts[i+1].y-pts[i].y);if(length>longest){longest=length;p=C.mix(pts[i],pts[i+1],.5);}}}let best=0,distance=Infinity;
    for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],dx=b.x-a.x,dy=b.y-a.y,t=C.clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1),q=C.mix(a,b,t),d=Math.hypot(q.x-p.x,q.y-p.y);if(d<distance){distance=d;best=i;}}
    e.points.splice(best,0,{x:snap(p.x),y:snap(p.y)});
  }
  function addCofactor(pair=cofactorPairs[0]){if(!Array.isArray(pair))pair=cofactorPairs[0];const re=selectedEdge();if(!re||C.isFreeArrow(re))return toast('请先选中一条反应连线');if(re.cofactors.length>=30)return toast('每条反应最多 30 个侧支');const g=C.geometry(re,board()),a=g.at(.49),z=g.at(.51),d=Math.hypot(z.x-a.x,z.y-a.y)||1,vx=(z.x-a.x)/d,vy=(z.y-a.y)/d,horizontal=Math.abs(vx)>Math.abs(vy),cf={id:C.uid('cf'),input:pair[0],output:pair[1],dx:(horizontal?vy:-vy)*12,dy:(horizontal?-vx:vx)*12,spread:32,side:1,t:.5,orientation:'auto',direction:'forward',arrowSize:10,fontSize:Math.max(14,re.fontSize-2)};const layoutResult=C.fitNewCofactor(board(),re,cf);if(!layoutResult.clear){toast('反应附近空间不足，未添加；请扩大分区或先调整相邻节点');renderQuickActions();return;}re.cofactors.push(cf);activeCofactor=cf.id;quickMenu=null;commit(layoutResult.spaced?'已拉开反应间距并添加辅因子':layoutResult.reflowed?'已沿圆周留出空间并添加直连辅因子支路':'已添加直连辅因子支路；点击两端名称可更换');}
  function knockout(){const re=selectedEdge();if(!re||C.isFreeArrow(re))return toast('请先选中一条反应连线');update(()=>{re.knockout=!re.knockout;activeKnockout=re.knockout;activeCofactor=null;});}
  function removeCofactor(id=activeCofactor){const re=selectedEdge();if(!re||!re.cofactors.some(c=>c.id===id))return;update(()=>{re.cofactors=re.cofactors.filter(c=>c.id!==id);activeCofactor=null;quickMenu=null;selection.clear();},'已删除辅因子，主反应保留；可以撤销');}
  function removeKnockout(){const e=selectedEdge();if(!e)return;update(()=>{e.knockout=false;activeKnockout=false;selection.clear();},'已移除敲除标记，主反应保留');}
  function remove(){if(!selection.size)return;const re=selectedEdge();if(re&&re.cofactors.some(c=>c.id===activeCofactor)){removeCofactor();return;}if(re&&activeKnockout&&re.knockout){removeKnockout();return;}update(()=>{C.deleteObjects(board(),selection);selection.clear();},'已删除，可撤销恢复');}
  function insertCofactorCopy(e,source){const c={...C.clone(source),id:C.uid('cf')},result=C.fitNewCofactor(board(),e,c);if(!result.clear)return toast('此处没有足够空间放置副本，请先调整布局');update(()=>{e.cofactors.push(c);activeCofactor=c.id;activeKnockout=false;quickMenu=null;},result.spaced?'已拉开反应间距并粘贴辅因子':'已复制辅因子，主反应保持一条');}
  function duplicate(){if(!selection.size)return;const e=selectedEdge(),cf=e?.cofactors.find(c=>c.id===activeCofactor);if(cf)return insertCofactorCopy(e,cf);if(e&&activeKnockout)return toast('可用复制和粘贴，把敲除标记放到另一条反应');update(()=>selection=new Set(C.duplicateObjects(board(),selection)),'已复制所选对象');}
  function align(axis){const ns=selectedNodes();if(ns.length<2)return toast('请至少选择两个节点');update(()=>{const target=ns.reduce((sum,n)=>sum+n[axis],0)/ns.length;ns.forEach(n=>n[axis]=target);},'已对齐');}
  function group(){
    if(selection.size<2)return toast('请先多选需要组合的对象');
    if(selection.size===2){
      const nodes=selectedNodes(),membrane=nodes.find(n=>n.kind==='membrane'),channel=nodes.find(n=>n.template==='channel');
      if(membrane&&channel){
        if(!C.embedChannel(board(),channel,membrane.id))return toast('膜上的可用空间不足，无法嵌入通道蛋白');
        selection=new Set([membrane.id]);
        commit('通道蛋白已嵌入细胞膜');
        return;
      }
    }
    update(()=>{const id=C.uid('g');[...board().nodes,...board().edges].filter(o=>selection.has(o.id)||(selection.has(o.source)&&selection.has(o.target))).forEach(o=>{o.groupId=id;selection.add(o.id);});},'已组合，拖动时整体移动');
  }
  function ungroup(){update(()=>[...board().nodes,...board().edges].filter(o=>selection.has(o.id)).forEach(o=>o.groupId=null),'已解除组合');}
  function ring(){const ns=selectedNodes().filter(n=>n.kind==='metabolite');if(ns.length<3)return toast('请至少选择 3 个代谢物，再使用圆环排列');
    let cx=ns.reduce((s,n)=>s+n.x,0)/ns.length,cy=ns.reduce((s,n)=>s+n.y,0)/ns.length,r=Math.max(130,ns.length*25);
    if(ns.some(n=>n.molecule)){const extent=Math.max(...ns.map(n=>{const b=C.bounds(n);return Math.hypot(b.w,b.h);}))/2;r=Math.max(r,(extent+32)/Math.sin(Math.PI/ns.length));const margin=r+extent+20;if(2*margin>Math.min(board().width,board().height))return toast('结构式圆环需要更大画板，请先扩大画板或缩小结构');cx=C.clamp(cx,margin,board().width-margin);cy=C.clamp(cy,margin,board().height-margin);}
    update(()=>{ns.sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));C.arrangeCircle(board(),ns,cx,cy,r);}
    ,'已排列圆环并调整内部反应；可继续拖动圆弧控制点');
  }
  function labelAvoid(){const occupied=board().nodes.map(n=>{const s=C.bounds(n);return n.kind==='module'||n.kind==='membrane'?null:{x:n.x-s.w/2-5,y:n.y-s.h/2-5,w:s.w+10,h:s.h+10};}).filter(Boolean);const hit=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
    update(()=>{for(const e of board().edges){if(!e.label)continue;const g=C.geometry(e,board()),vertical=C.edgeLabelGeometry(e,g).vertical;
        const w=e.label.length*e.fontSize*.57+8,h=e.fontSize*1.3;let candidate=null;for(const radius of [22,38,60,85]){for(const [dx,dy] of [[0,-radius],[radius,0],[0,radius],[-radius,0],[radius,-radius],[-radius,-radius]]){if(vertical&&dx===0)continue;const left=vertical?(dx<0?w:0):w/2;
          const box={x:g.mid.x+dx-left,y:g.mid.y+dy-h/2,w,h};if(box.x>0&&box.y>0&&box.x+w<board().width&&box.y+h<board().height&&!occupied.some(b=>hit(box,b))){candidate={dx,dy,box};break;}}if(candidate)break;}if(candidate){Object.assign(e,C.edgeLabelOffset(e,g,candidate.dx,candidate.dy));occupied.push(candidate.box);}}},'已整理标签；复杂交叉处仍可手动调整');
  }
  const actions={'structure-styles':openStructureStyles,'edit-chemical':()=>{const n=selectedNodes()[0];if(n?.molecule)editChemicalOnCanvas(n.id);else if(n)openChemical(n.id);},'cofactor':addCofactor,'delete':remove,'duplicate':duplicate,'align-x':()=>align('y'),'align-y':()=>align('x'),'ring':ring,'group':group,'ungroup':ungroup,'label-avoid':labelAvoid,'new-project':async()=>{if(await confirmAction('新建空白项目','当前编辑内容将替换。未保存的项目可先取消并保存；替换后也可通过撤销恢复。')){project=C.emptyProject();boardId=project.boards[0].id;selection.clear();commit();fit();}},'reset-path':()=>{const e=selectedEdge();if(e)update(()=>{delete e.c1;delete e.c2;e.bulge=70;e.points=[];e.sourcePort=e.targetPort='auto';});},'reverse':()=>{const e=selectedEdge();if(e)update(()=>{if(C.isFreeArrow(e))[e.start,e.end]=[e.end,e.start];else [e.source,e.target]=[e.target,e.source];[e.sourcePort,e.targetPort]=[e.targetPort,e.sourcePort];[e.c1,e.c2]=[e.c2,e.c1];e.bulge=-e.bulge;e.points.reverse();});},'add-waypoint':()=>{const e=selectedEdge();if(e)update(()=>addWaypoint(e));},'remove-waypoint':()=>{const e=selectedEdge();if(e)update(()=>e.points.pop());}};
  actions['detach-channel']=()=>{const n=selectedNodes()[0];if(n?.membraneId)update(()=>C.detachChannel(n),'已解除嵌入，可拖动通道蛋白');};
  $('inspector-content').addEventListener('click',e=>{const tab=e.target.closest('[data-inspector-tab]');if(tab){showInspectorPage(tab.dataset.inspectorTab);return;}const button=e.target.closest('[data-action]');if(!button)return;if(button.dataset.action==='remove-cofactor')removeCofactor(button.dataset.cf);else actions[button.dataset.action]?.();});
  function handleProperty(event,live=false){
    const input=event.target,prop=input.dataset.prop;if(!prop)return;
    if(prop==='board-arrow-width'&&(!input.value||!Number.isFinite(input.valueAsNumber)))return;
    let value=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;if(input.type==='number'&&(!Number.isFinite(value)||input.value===''))return renderInspector();
    if(input.type==='number'){if(input.min!=='')value=Math.max(Number(input.min),value);if(input.max!=='')value=Math.min(Number(input.max),value);}
    if(typeof value==='string')value=value.slice(0,prop==='label'?2000:200);
    if(prop==='board-arrow-width'){
      if(!live)input.value=value;
      update(()=>C.setBoardArrowWidth(board(),value),live?undefined:'已设置当前画板的箭头线宽',true);
      return;
    }
    if(prop==='molecule-angle'){if(!live){const n=selectedNodes()[0];if(n?.molecule)rotateChemical(n.id,value-(n.rotation||0));}return;}
    if(prop==='molecule-atom-family'){setMoleculeAtomFont(selectedNodes()[0],value);return;}
    const cfId=input.closest('[data-cf-id]')?.dataset.cfId;
    update(()=>{
      if(cfId){const edge=selectedEdge(),cf=edge.cofactors.find(c=>c.id===cfId);cf[prop]=prop==='side'?Number(value):value;if(prop==='side')cf.dx=-cf.side*Math.abs(cf.dx);if(['input','output','fontSize'].includes(prop)){const result=C.layoutCofactor(board(),edge,cf);if(!result.clear)toast('分区内空间不足，保留当前位置；请扩大分区后再自适应');}return;}
      if(prop==='board-name'){board().name=value;return;}if(prop==='board-width'){board().width=value;return;}if(prop==='board-height'){board().height=value;return;}
      if(prop==='molecule-label-gap'){const n=selectedNodes()[0];if(n?.molecule)n.molecule.labelGap=value;return;}if(prop==='molecule-atom-font'){const n=selectedNodes()[0];if(n?.molecule)n.molecule.atomFontSize=value;return;}if(prop==='molecule-width'){const n=selectedNodes()[0];if(n?.molecule)n.molecule.bondWidth=value;return;}if(prop==='fontFamily'){project.fontFamily=value;return;}if(prop==='molecule-display'||prop==='molecule-colors'){const n=selectedNodes()[0];if(n?.molecule)n.molecule[prop==='molecule-display'?'display':'colorMode']=value;return;}
      if(prop==='all-fontSize'){board().nodes.filter(n=>n.molecule).forEach(n=>n.molecule.atomFontSize=value);[...board().nodes,...board().edges].filter(x=>x.kind!=='module').forEach(x=>x.fontSize=value);return;}
      if(prop==='all-width'){C.setBoardArrowWidth(board(),value);board().structureBondWidth=value;board().nodes.filter(n=>n.molecule).forEach(n=>n.molecule.bondWidth=value);return;}
      for(const id of selection){const o=getObject(id);if(!o)continue;if((prop==='w'||prop==='h')&&o.kind==='metabolite'&&o.shape==='round'&&o.highlightFit!==false){const size=C.bounds(o);o.w=size.w;o.h=size.h;o.highlightFit=false;}o[prop]=prop==='rotation'?Number(value):value;if(prop==='bold'&&o.kind==='module')o.labelBold=value;if(prop==='mode'&&value==='route'&&!o.points.length){const g=C.geometry(o,board()),vertical=Math.abs(g.z.y-g.a.y)>Math.abs(g.z.x-g.a.x);o.points=vertical?[{x:g.a.x+60,y:g.a.y+20},{x:g.z.x+60,y:g.z.y-20}]:[{x:g.a.x+20,y:g.a.y+60},{x:g.z.x-20,y:g.z.y+60}];}}
    },undefined,live||event.type==='change'&&input.tagName!=='SELECT'&&input.type!=='checkbox');
    if(prop==='board-name'){const item=$('board-list').querySelector('.board-item.active .board-name');if(item)item.textContent=board().name;$('board-caption').textContent=`FIGURE ${String(project.boards.findIndex(b=>b.id===boardId)+1).padStart(2,'0')} / ${board().name}`;}
  }
  $('inspector-content').addEventListener('change',event=>handleProperty(event));
  $('inspector-content').addEventListener('input',event=>{if(event.target.tagName!=='SELECT'&&event.target.type!=='checkbox')handleProperty(event,true);});
  async function confirmAction(title,message){$('confirm-title').textContent=title;$('confirm-message').textContent=message;const dialog=$('confirm-dialog');dialog.returnValue='';dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));}
  $('board-list').addEventListener('click',async e=>{const del=e.target.closest('[data-delete-board]');if(del){if(project.boards.length===1)return toast('至少保留一个画板');if(await confirmAction('删除画板','该画板中的节点与反应将一并删除，可通过撤销恢复。'))update(()=>{project.boards=project.boards.filter(b=>b.id!==del.dataset.deleteBoard);if(!project.boards.some(b=>b.id===boardId))boardId=project.boards[0].id;selection.clear();fit();});return;}const item=e.target.closest('[data-board]');if(item){boardId=item.dataset.board;selection.clear();activeChemicalAtom=null;sourceId=null;render();fit();if(board().nodes.some(n=>n.molecule&&n.molecule.atomRenderingVersion!==1))prepareChemicalTargets().then(()=>renderCanvas()).catch(err=>toast(err.message));}});
  $('board-list').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[data-board]'))e.target.click();});
  $('add-board').onclick=()=>{update(()=>{const b=C.board(`画板 ${project.boards.length+1}`);project.boards.push(b);boardId=b.id;selection.clear();});fit();};
  async function chemicalExample(){const engine=await chemicalEngine(),b=C.board('化学结构 · 乙醇氧化示例');b.width=1200;b.height=600;const rows=[['CCO','Ethanol'],['CC=O','Acetaldehyde'],['CC(=O)O','Acetic acid']];for(let i=0;i<rows.length;i++){const n=C.moleculeNode(await engine.generate(rows[i][0]),210+i*390,285,rows[i][1]);n.w=180;n.h=150;b.nodes.push(n);}for(let i=0;i<2;i++){const e=C.edge(b.nodes[i].id,b.nodes[i+1].id);e.label=['ADH','ALDH'][i];e.labelDy=-20;e.cofactors=[{id:C.uid('cf'),input:'NAD^{+}',output:'NADH',dx:0,dy:10,spread:28,side:1,t:.5,fontSize:15,direction:'forward'}];b.edges.push(e);}const title=C.node('text',600,85,'Chemical structures in a pathway');title.fontSize=28;title.bold=true;const note=C.node('text',600,490,'结构、酶名与辅因子可分别编辑；本图为排版示例，省略水及质子。');note.fontSize=16;note.color='#7c8a88';b.nodes.push(title,note);for(const e of b.edges)for(const c of e.cofactors)C.layoutCofactor(b,e,c);return b;}
  function renderExampleGallery(){
    const currentId=board().exampleId,knownNames=new Map(exampleNames);
    const cards=[...exampleNames,...[...savedExamples.keys()].filter(key=>!knownNames.has(key)).map(key=>[key,savedExamples.get(key).board.name])];
    $('example-update').hidden=!currentId||!knownNames.has(currentId)&&!savedExamples.has(currentId);
    $('example-options').innerHTML=cards.map(([key,defaultName],i)=>{
      const entry=savedExamples.get(key),b=entry?.board||(key==='chemical'?null:C.exampleBoard(key));
      const font=entry?.fontFamily||project.fontFamily||C.FONT;
      C.setDefaultFont(font);
      const preview=b?`<svg viewBox="0 0 ${b.width} ${b.height}" aria-hidden="true" font-family="${C.esc(font)}">${C.renderBoard(b,'example-'+i+'-')}</svg>`:'<svg viewBox="0 0 600 250" aria-hidden="true"><text x="300" y="140" text-anchor="middle" font-size="64" fill="#247969">⌬ → ⌬ → ⌬</text></svg>';
      return `<button type="button" class="example-card" data-example="${C.esc(key)}">${preview}<b>${C.esc(entry?.board.name||defaultName)}</b></button>`;
    }).join('');
    C.setDefaultFont(project.fontFamily);
  }
  function saveExample(key){
    const snapshot=C.clone(board());delete snapshot.exampleId;
    const next=new Map(savedExamples).set(key,{board:snapshot,fontFamily:project.fontFamily});
    try{localStorage.setItem(EXAMPLE_STORAGE,JSON.stringify(Object.fromEntries(next)));}
    catch{return toast('本地存储不可用或空间不足，示例未保存');}
    savedExamples=next;
    board().exampleId=key;
    commit('当前画板已保存到示例图库');
    renderExampleGallery();
  }
  $('example-save').onclick=()=>saveExample(C.uid('example'));
  $('example-update').onclick=()=>saveExample(board().exampleId);
  $('demo-button').onclick=()=>{renderExampleGallery();$('example-dialog').showModal();};
  $('example-options').addEventListener('click',async ev=>{
    const button=ev.target.closest('[data-example]');if(!button||button.disabled)return;
    if(project.boards.length>=50)return toast('当前项目已达到 50 个画板');
    button.disabled=true;
    try{
      const key=button.dataset.example,entry=savedExamples.get(key);
      let b;
      if(entry){
        const temp=C.clone(entry.board);
        const ids=C.duplicateObjects(temp,[...temp.nodes,...temp.edges].map(o=>o.id),0);
        const copied=new Set(ids);
        b={...temp,id:C.uid('b'),nodes:temp.nodes.filter(n=>copied.has(n.id)),edges:temp.edges.filter(e=>copied.has(e.id))};
      }else b=key==='chemical'?await chemicalExample():C.exampleBoard(key);
      if(!$('example-dialog').open)return;
      b.exampleId=key;
      project.boards.push(b);boardId=b.id;selection.clear();sourceId=null;tool='select';
      $('example-dialog').close();commit('示例已加入新画板');fit();
    }catch(err){toast(err.message);}finally{button.disabled=false;}
  });
  function filename(ext){return (project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim()||'pathway')+'.'+ext;}
  function download(data,name,type){const blob=data instanceof Blob?data:new Blob([data],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function save(){download(JSON.stringify(project,null,2),filename('json'),'application/json');$('save-state').textContent='已导出项目备份 · 本机自动保存';toast('项目文件已下载，包含全部画板与可编辑数据');}
  $('file-input').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>20*1024*1024)return toast('项目文件不能超过 20 MB');try{const imported=C.validateProject(JSON.parse(await file.text()));if(!await confirmAction('打开项目',`打开“${imported.name}”将替换当前内容。建议先保存当前项目；打开后也可撤销恢复。`))return;project=imported;boardId=project.boards[0].id;selection.clear();sourceId=null;commit('项目已完整恢复');fit();}catch(err){toast('打开失败：'+err.message);}});
  function selectedExport(){return C.exportSVG(project,$('export-scope').value==='all'?null:boardId);}
  $('export-svg').onclick=()=>{download(selectedExport(),filename('svg'),'image/svg+xml;charset=utf-8');$('export-dialog').close();toast('SVG 已导出，可在矢量绘图软件中继续编辑');};
  $('export-png').onclick=async()=>{const btn=$('export-png');btn.disabled=true;let url;try{const svg=selectedExport(),doc=new DOMParser().parseFromString(svg,'image/svg+xml'),root=doc.documentElement,w=Number(root.getAttribute('width')),h=Number(root.getAttribute('height'));if(w*h*9>64000000||w*3>16384||h*3>16384)throw new Error('3 倍 PNG 尺寸过大，请缩小画板或分别导出');url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('SVG 渲染失败'));image.src=url;});const out=document.createElement('canvas');out.width=w*3;out.height=h*3;const ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(image,0,0,out.width,out.height);const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG 编码失败');download(blob,filename('png'));$('export-dialog').close();toast(`PNG 已导出 · ${out.width} × ${out.height} px`);}catch(err){toast(err.message);}finally{btn.disabled=false;if(url)URL.revokeObjectURL(url);}};
  $('project-name').onchange=e=>update(()=>project.name=e.target.value.slice(0,200)||'未命名路径图');
  $('save-button').onclick=save;$('open-button').onclick=()=>$('file-input').click();$('export-button').onclick=()=>$('export-dialog').showModal();$('help-button').onclick=()=>$('help-dialog').showModal();
  $('inspector-toggle').onclick=()=>document.querySelector('.inspector').classList.toggle('open');
  $('undo').onclick=undo;$('redo').onclick=redo;$('fit').onclick=fit;$('zoom-in').onclick=()=>zoom(1.2);$('zoom-out').onclick=()=>zoom(1/1.2);
  $('align-x').onclick=()=>align('y');$('align-y').onclick=()=>align('x');$('group-button').onclick=group;$('ungroup-button').onclick=ungroup;$('ring-button').onclick=ring;
  function copy(){if(!selection.size)return;const e=selectedEdge(),cf=e?.cofactors.find(c=>c.id===activeCofactor);if(cf)clipboard={type:'cofactor',cofactor:C.clone(cf)};else if(e&&activeKnockout&&e.knockout)clipboard={type:'knockout',label:e.knockoutLabel,style:C.clone(e.knockoutStyle||{}),dx:e.knockoutDx||0,dy:e.knockoutDy||0,markDx:e.knockoutMarkDx||0,markDy:e.knockoutMarkDy||0};else clipboard={type:'graph',...C.copyObjects(board(),selection)};render();toast(clipboard.type==='graph'?'已复制对象及必要的反应端点，可粘贴到其他画板':'已复制标注，请选中目标反应后粘贴');}
  function paste(){if(!clipboard)return;if(clipboard.type==='cofactor'){const e=selectedEdge();if(!e||C.isFreeArrow(e))return toast('请先选中要接收辅因子的反应箭头');return insertCofactorCopy(e,clipboard.cofactor);}if(clipboard.type==='knockout'){const e=selectedEdge();if(!e||C.isFreeArrow(e))return toast('请先选中要添加敲除标记的反应箭头');return update(()=>{e.knockout=true;e.knockoutLabel=clipboard.label;e.knockoutStyle=C.clone(clipboard.style);e.knockoutDx=clipboard.dx;e.knockoutDy=clipboard.dy;e.knockoutMarkDx=clipboard.markDx||0;e.knockoutMarkDy=clipboard.markDy||0;activeKnockout=true;activeCofactor=null;},'已粘贴敲除标记');}update(()=>{const b=board(),temp={nodes:C.clone(clipboard.nodes),edges:C.clone(clipboard.edges)};const ids=[...temp.nodes,...temp.edges].map(o=>o.id),newIds=C.duplicateObjects(temp,ids);b.nodes.push(...temp.nodes.filter(o=>newIds.includes(o.id)));b.edges.push(...temp.edges.filter(o=>newIds.includes(o.id)&&(C.isFreeArrow(o)||b.nodes.some(n=>n.id===o.source)&&b.nodes.some(n=>n.id===o.target))));selection=new Set(newIds.filter(id=>getObject(id)));activeCofactor=null;activeKnockout=false;},'已粘贴');}
  $('copy-button').onclick=copy;$('paste-button').onclick=paste;
  document.addEventListener('keydown',e=>{
    const mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();if(document.querySelector('dialog[open]'))return;
    if(mod&&['z','y'].includes(key)&&e.target.closest('#inspector-content')){e.preventDefault();return key==='y'||e.shiftKey?redo():undo();}
    if(e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
    if(!mod&&activeChemicalAtom&&selection.has(activeChemicalAtom.owner)&&!chemicalEditPending){const now=Date.now(),pair=atomTyping&&now-atomTyping.time<1000?atomTyping.key+key:'';let symbol=pair==='cl'?'Cl':pair==='br'?'Br':/^[cnospfihb]$/.test(key)?key.toUpperCase():null;if(symbol){e.preventDefault();atomTyping={key,time:now};changeSelectedAtom(symbol);return;}}

    if(mod&&['z','y','s','d','g','a','c','v'].includes(key))e.preventDefault();
    if(mod){if(key==='z')return e.shiftKey?redo():undo();if(key==='y')return redo();if(key==='s')return save();if(key==='d')return duplicate();if(key==='g')return e.shiftKey?ungroup():group();if(key==='a'){selection=new Set([...board().nodes,...board().edges].map(o=>o.id));render();return;}if(key==='c')return copy();if(key==='v')return paste();}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();if(activeChemicalAtom&&selection.has(activeChemicalAtom.owner)){eraseChemical(activeChemicalAtom.owner,'atom',activeChemicalAtom.index);return;}remove();}if(e.key==='Escape'){chemicalToolLocked=false;chemicalToolRevision++;chemicalDropPoint=null;activeChemicalAtom=null;tool='select';sourceId=null;pendingCycle=null;cyclePointer=null;quickMenu=null;selection.clear();if(drag){const i=project.boards.findIndex(b=>b.id===boardId);project.boards[i]=drag.initial;drag=null;}render();}
    if(e.code==='Space'){e.preventDefault();space=true;canvas.style.cursor='grab';}
    if(key==='v')setTool('select');if(key==='r')setTool('reaction');if(key==='a')setTool('arrow');if(key==='h')setTool('pan');if(key==='m')setTool('metabolite');if(key==='0')fit();
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&selection.size){e.preventDefault();const amount=e.shiftKey?10:1,dx=e.key==='ArrowLeft'?-amount:e.key==='ArrowRight'?amount:0,dy=e.key==='ArrowUp'?-amount:e.key==='ArrowDown'?amount:0;moveNodes(selection,dx,dy,C.clone(board()));commit();}
  });
  document.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;renderCanvas();}});window.addEventListener('blur',()=>{space=false;if(drag)finishDrag();});
  new ResizeObserver(()=>{const w=stage.clientWidth,h=stage.clientHeight;if(!lastSize.w||autoFit){fit();}else{camera.w*=w/lastSize.w;camera.h*=h/lastSize.h;renderCanvas();}lastSize={w,h};}).observe(stage);
  render();fit();if(board().nodes.some(n=>n.molecule&&n.molecule.atomRenderingVersion!==1))prepareChemicalTargets().then(()=>renderCanvas()).catch(err=>toast(err.message));if(recovered)$('save-state').textContent='已恢复本机自动保存';else if(!storageAvailable)$('save-state').textContent='自动保存不可用，请保存项目文件';
})();
