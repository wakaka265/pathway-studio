/* Isolated local JSME surface; only its parent editor can exchange structures. */
(() => {
  'use strict';
  let editor,session=0,reading=false,history=[''],historyIndex=0;
  const requestedOrigin=new URLSearchParams(location.search).get('parentOrigin'),allowedOrigins=[location.origin,'http://127.0.0.1:4173','http://localhost:4173'];
  const parentOrigin=location.protocol==='file:'?'null':allowedOrigins.includes(requestedOrigin)?requestedOrigin:location.origin;
  // File documents have an opaque origin. The receiver still checks the parent window and origin.
  const send=data=>parent.postMessage({channel:'pathway-sketcher',session,...data},location.protocol==='file:'?'*':parentOrigin);
  const report=()=>{if(!editor||reading)return;try{const mol=editor.smiles()?editor.molFile():'';if(history[historyIndex]!==mol){history=history.slice(0,historyIndex+1);history.push(mol);historyIndex=history.length-1;}send({type:'change',mol,canUndo:historyIndex>0,canRedo:historyIndex<history.length-1});}catch{send({type:'error',message:'结构尚不完整，请检查原子或化学键。'});}};
  function selectAction(action){if(/^[CNOSP]$/.test(action)){const code=action.charCodeAt(0);document.getElementById('drawing').dispatchEvent(new KeyboardEvent('keydown',{key:action.toLowerCase(),code:'Key'+action,keyCode:code,which:code,bubbles:true}));}else if(['0','1301','106','201','202','203','204','205','206','207','208','209','210'].includes(String(action)))editor.setAction(Number(action));}
  window.jsmeOnLoad=()=>{
    document.getElementById('drawing').innerHTML='';
    editor=new JSApplet.JSME('drawing',(document.documentElement.clientWidth+24)+'px',(document.documentElement.clientHeight+48)+'px',{options:'oldlook,nozoomgui,noreaction,noquery,nomultipart,nosearchinchiKey,noexportinchi,noexportinchikey,nofullScreenIcon,nocontextmenu',guicolor:'#edf4fc'});
    editor.setCallBack('AfterStructureModified',report);
    new ResizeObserver(()=>editor.setSize((document.documentElement.clientWidth+24)+'px',(document.documentElement.clientHeight+48)+'px')).observe(document.documentElement);
    send({type:'ready'});
  };
  window.addEventListener('message',ev=>{
    if(ev.source!==parent||ev.origin!==parentOrigin||ev.data?.channel!=='pathway-sketcher'||!editor)return;
    const data=ev.data;
    if(data.type==='load'){session=data.session;reading=true;try{editor.reset();if(data.mol)editor.readMolFile(data.mol);history=[editor.smiles()?editor.molFile():''];historyIndex=0;selectAction(data.action||'202');}catch{send({type:'error',message:'无法载入结构，请检查 MOL 或 SMILES。'});}finally{reading=false;}report();}
    if(data.session!==session)return;
    if(data.type==='action')selectAction(data.action);
    if(data.type==='undo'||data.type==='redo'){const index=historyIndex+(data.type==='undo'?-1:1);if(index>=0&&index<history.length){historyIndex=index;reading=true;editor.reset();if(history[index])editor.readMolFile(history[index]);reading=false;report();}}
  });
})();
