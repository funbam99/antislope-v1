import { metadataBrowser } from "./metadata.js";
import { markdown } from "./markdown.js";

export const client = String.raw`
'use strict';
${markdown}
${metadataBrowser}
const $ = id => document.getElementById(id);
const base = location.pathname;
const capability = base.split('/')[1];
function applyAppearance(value){const theme=['light','dark','system'].includes(value)?value:'system';document.documentElement.dataset.theme=theme;$('appearance').value=theme;}
try{applyAppearance(localStorage.getItem('antislope-appearance'));}catch{applyAppearance('system');}
document.addEventListener('click',event=>{for(const id of ['workspace-menu','file-menu']){const menu=$(id);if(menu.open&&!menu.contains(event.target))menu.open=false;}});
document.addEventListener('keydown',event=>{if(event.key==='Escape')for(const id of ['workspace-menu','file-menu'])$(id).open=false;});
$('appearance').addEventListener('change',()=>{applyAppearance($('appearance').value);try{localStorage.setItem('antislope-appearance',$('appearance').value);}catch{error('Your appearance preference could not be saved in this browser.');}});

let state, selected = 0, mode = 'diff', notes = [], editId = null, busy = false;
let followPrediction = '', followDispute = '', referenceDispute = '';
let region = {kind:'',note:''};
const assessmentDrafts = new Map(), hints = [];
// Persist only reader comments and line ranges for this session; never source or answers.
const commentRanges = new Map();
let draftRange = null;
const commentStorageKey='minesweeper-comments:'+capability;
function persistComments(){try{localStorage.setItem(commentStorageKey,JSON.stringify({phase:state.phase,notes,ranges:[...commentRanges]}));}catch{error('Comments could not be saved in this browser. Keep this page open or export your handoff before closing it.');}}
function validSavedNote(n){if(!n||typeof n.id!=='string'||!n.id||n.id.length>100||!n.anchor||!['constraint','trigger','uncertainty'].every(k=>typeof n[k]==='string'&&n[k].length<=4000))return false;const a=n.anchor;if(a.kind==='change')return true;const file=state.files.find(f=>f.path===a.path);if(!file)return false;if(a.kind==='file')return true;if(!['candidate','baseline'].includes(a.kind)||!Number.isInteger(a.line)||a.line<1||a.line>file[a.kind].length)return false;return a.kind!=='baseline'||file.hunks.flat().some(r=>r.kind==='delete'&&r.oldLine===a.line);}
function restoreComments(){try{const saved=JSON.parse(localStorage.getItem(commentStorageKey)??sessionStorage.getItem(commentStorageKey)??'null');if(!saved)return;
  if(state.phase==='reading'&&saved.phase==='reading'&&Array.isArray(saved.notes))notes=saved.notes.filter(validSavedNote).slice(0,50).map(n=>({id:n.id,anchor:n.anchor.kind==='change'?{kind:'change'}:n.anchor.kind==='file'?{kind:'file',path:n.anchor.path}:{kind:n.anchor.kind,path:n.anchor.path,line:n.anchor.line},constraint:n.constraint,trigger:n.trigger,uncertainty:n.uncertainty}));
  for(const entry of saved.ranges??[]){if(!Array.isArray(entry))continue;const [id,r]=entry,note=notes.find(n=>n.id===id),a=note?.anchor,file=state.files.find(f=>f.path===a?.path);if(file&&['candidate','baseline'].includes(a.kind)&&Number.isInteger(r?.first)&&r.first===a.line&&Number.isInteger(r.last)&&r.last>=r.first&&r.last<=file[a.kind].length)commentRanges.set(id,{first:r.first,last:r.last});}persistComments();
}catch{error('Saved comments could not be restored.');}}

let assessmentDirty = false, followupDirty = false;
function updateDownloadLock(){if(state&&typeof chatState!=='undefined')renderChat();}
const assessmentChange = assign => value => {assign(value);assessmentDirty=true;updateDownloadLock();};
function ensureNoAnnotationDraft() { if(editId||['constraint','trigger','uncertainty'].some(id=>$(id).value.trim()))throw new Error('Add or clear your annotation draft before submitting, revealing, or downloading.'); }
function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
function button(text, action, secondary=false) { const e=node('button',text,secondary?'secondary':'');e.type='button';e.addEventListener('click',()=>guard(action));return e; }
function error(message){const target=$('error');if(target){target.textContent=message;target.hidden=!message;}if(message&&typeof chatState!=='undefined')addReviewMessage('Review action','notice',message);}
async function guard(action) { if(busy)return;busy=true;error('');try{await action();}catch(e){error(e.message || 'The local server is unavailable. Your drafts remain in this page.');}finally{busy=false;} }
async function post(action,data) { const response=await fetch(base+action,{method:'POST',headers:{'Content-Type':'application/json','X-Minesweeper-Session':capability},body:JSON.stringify(data)});if(!response.ok){const e=await response.json();throw new Error(e.error);}return response.json(); }
async function action(name,data) { const result=await post('action/'+name,data);if(name==='assess')assessmentDirty=false;if(name==='followup-dispute')followupDirty=false;state=result;if(state.phase!=='reading')notes=state.annotations;render(); }
function anchorText(a) { if(a.kind==='change')return 'Whole change';if(a.kind==='file')return 'File: '+a.path;return (a.kind==='baseline'?'Deleted baseline: ':'Candidate: ')+a.path+':'+a.line; }
function hasCommentDraft() {return !!editId||['constraint','trigger','uncertainty'].some(id=>$(id).value.trim());}
function showComment(rect) {const dialog=$('comment-dialog');if(!dialog.open)dialog.show();const width=Math.min(440,innerWidth-32);dialog.style.left=Math.max(16,Math.min(rect?.left??(innerWidth-width)/2,innerWidth-width-16))+'px';const top=Math.max(16,Math.min(rect?.bottom??120,innerHeight-360));dialog.style.top=top+'px';dialog.style.maxHeight=Math.max(80,innerHeight-top-16)+'px';$('comment-anchor').textContent=anchorText(getAnchor());$('selection-chat').hidden=!['candidate','baseline'].includes(getAnchor().kind);$('constraint').focus();}
function closeComment() {const dialog=$('comment-dialog');if(dialog.open)dialog.close();$('resume-comment').hidden=!hasCommentDraft();}
function setAnchor(anchor,rect) {if(hasCommentDraft()){error('Save or cancel your current comment before choosing another anchor.');showComment();return false;}draftRange=null;$('anchor-kind').value=anchor.kind;if(anchor.path)$('anchor-path').value=anchor.path;if(anchor.line)$('anchor-line').value=anchor.line;anchorControls();showComment(rect);return true;}
function commentOnSelection() {if(!state||state.preview||state.phase==='completed')return;const selection=getSelection();if(!selection||selection.isCollapsed||!selection.toString().trim())return;const rowFor=n=>(n?.nodeType===3?n.parentElement:n)?.closest?.('.code-row');const start=rowFor(selection.anchorNode),end=rowFor(selection.focusNode),code=$('code');if(!start||!end||!code.contains(start)||!code.contains(end))return;if(start.dataset.kind!==end.dataset.kind){error('Select code from one version at a time.');return;}const first=Math.min(Number(start.dataset.line),Number(end.dataset.line)),last=Math.max(Number(start.dataset.line),Number(end.dataset.line));const kind=start.dataset.kind,file=state.files[selected];if(kind==='baseline'&&Array.from({length:last-first+1},(_,i)=>first+i).some(line=>!file.hunks.flat().some(r=>r.kind==='delete'&&r.oldLine===line))){error('Baseline comments must refer to deleted lines.');return;}const rect=selection.rangeCount?selection.getRangeAt(0).getBoundingClientRect():undefined;if(setAnchor({kind,path:file.path,line:first},rect)){draftRange={first,last};if(last!==first)$('comment-anchor').textContent+=' · Selected lines '+first+'–'+last+'; attached to line '+first+'.';}}

function anchorControls() {const kind=$('anchor-kind').value;$('anchor-path-label').hidden=kind==='change';$('anchor-line-label').hidden=kind==='change'||kind==='file';$('anchor-line').required=kind==='candidate'||kind==='baseline';}
function getAnchor() { const kind=$('anchor-kind').value;if(kind==='change')return {kind};const path=$('anchor-path').value;if(kind==='file')return {kind,path};const line=Number($('anchor-line').value);const file=state.files.find(f=>f.path===path);if(!Number.isInteger(line)||line<1||line>(kind==='candidate'?file.candidate.length:file.baseline.length))throw new Error('Choose a line in the captured file.');if(kind==='baseline'&&!file.hunks.flat().some(r=>r.kind==='delete'&&r.oldLine===line))throw new Error('Baseline line anchors must refer to a deleted diff row.');return {kind,path,line}; }
function clearDraft() { editId=null;draftRange=null;for(const id of ['constraint','trigger','uncertainty'])$(id).value='';$('add-annotation').textContent='Save comment';closeComment();updateDownloadLock(); }
function renderNotes(){renderCode();}
function commentCard(note,offscreen=false){const a=note.anchor,r=commentRanges.get(note.id),item=node('div',undefined,'finding inline-comment');item.dataset.noteId=note.id;item.append(node('div',anchorText(a)+(r&&r.last!==r.first?'–'+r.last:''),'metadata'),node('p',note.constraint));
  if(offscreen&&(a.kind==='candidate'||a.kind==='baseline'))item.append(button(a.kind==='baseline'?'View baseline':'View full file',()=>{mode=a.kind;renderCode();},true));
  item.append(button('Quote in chat',()=>quoteComment(note),true));
  if(state.phase!=='completed')item.append(button('Edit',()=>{if(!setAnchor(a))return;editId=note.id;draftRange=commentRanges.get(note.id)??null;$('constraint').value=note.constraint;$('trigger').value=note.trigger==='Not yet established.'?'':note.trigger;$('uncertainty').value=note.uncertainty;$('add-annotation').textContent='Save comment';},true));
  if(state.phase==='reading')item.append(button('Remove',()=>{notes=notes.filter(n=>n.id!==note.id);commentRanges.delete(note.id);persistComments();renderCode();recordReviewMetadata();renderChat();},true));return item;
}
function quoteComment(note,selectionRange) {
  const a=note.anchor, range=selectionRange??commentRanges.get(note.id)??{first:a.line,last:a.line};
  const parts=['Review question · '+anchorText(a)];
  if(a.kind==='candidate'||a.kind==='baseline'){
    const file=state.files.find(f=>f.path===a.path), lines=a.kind==='baseline'?file.baseline:file.candidate;
    const label=a.kind==='baseline'?'Captured baseline':state.phase==='revealed'||state.phase==='completed'?'Captured clean candidate':'Displayed review version';
    const fence=String.fromCharCode(96).repeat(3);
    parts.push(label+' · '+a.path+':'+range.first+(range.last!==range.first?'–'+range.last:''),fence+'ts\n'+lines.slice(range.first-1,range.last).join('\n')+'\n'+fence);
  }
  if(note.constraint)parts.push('Comment: '+note.constraint);
  if(note.trigger&&note.trigger!=='Not yet established.')parts.push('Hypothesized trigger: '+note.trigger);
  if(note.uncertainty)parts.push('Uncertainty: '+note.uncertainty);
  const composer=$('chat-message'), next=(composer.value?composer.value+'\n\n':'')+parts.join('\n\n');
  if(next.length>4000){chatFailure='This quote and your draft exceed 4,000 characters. Shorten your draft or select fewer lines; nothing was changed.';chatRetryTurn=false;renderChat();return;}
  composer.value=next;chatRequest=null;chatFailure='';chatRetryTurn=false;renderChat();composer.focus();
}
function changedText(value,other,kind) {
  const fragment=document.createDocumentFragment();let start=0,end=0;
  while(start<value.length&&start<other.length&&value[start]===other[start])start++;
  while(end<value.length-start&&end<other.length-start&&value[value.length-1-end]===other[other.length-1-end])end++;
  fragment.append(document.createTextNode(value.slice(0,start)));
  fragment.append(node('span',value.slice(start,value.length-end),kind==='add'?'inline-add':'inline-delete'));
  fragment.append(document.createTextNode(value.slice(value.length-end)));return fragment;
}
function mineProgress(){
  if(state.preview||!['revealed','completed'].includes(state.phase))return null;
  const mine=state.mutationReference,total=mine?1:0;
  const covered=mine&&sourceNotes().some(note=>{const a=note.anchor,r=commentRanges.get(note.id);return a.kind==='candidate'&&a.path===mine.path&&a.line<=mine.line&&(r?.last??a.line)>=mine.line;})?1:0;
  const evidence=currentReviewEvidence().filter(entry=>entry.path===mine?.path&&entry.first<=mine.line&&entry.last>=mine.line&&(entry.kind!=='ai-counterexample'||entry.code.some(quote=>quote.line===mine.line)));
  const reviewed=mine&&evidence.length&&state.region?.kind!=='disputed'&&!state.referenceDispute?1:0;
  return {mine,total,covered,reviewed,evidence,pending:total-reviewed};
}
function mineSummaryText(progress){return 'Total mines: '+progress.total+' · Flagged by your comments: '+progress.covered+' · Reviewed with evidence: '+progress.reviewed+' · Pending verification: '+progress.pending;}
function showMine(){const mine=mineProgress()?.mine;if(!mine)return;selected=state.files.findIndex(file=>file.path===mine.path);mode='candidate';$('files').value=String(selected);renderCode();$('code').querySelector?.('[data-mine]')?.scrollIntoView({block:'center',behavior:'smooth'});}
function renderMineSummary(){const summary=$('mine-summary'),progress=mineProgress();summary.replaceChildren();summary.hidden=!progress;if(!progress)return;summary.append(node('span',mineSummaryText(progress)));if(progress.mine)summary.append(button('View mine',showMine,true));}
function codeRow(row,file,showFull=false) {
  const item=node('div',undefined,'code-row '+row.kind);
  const line=row.newLine ?? row.oldLine;
  const kind=row.newLine!==null?'candidate':'baseline';
  item.dataset.kind=kind;item.dataset.line=String(line);
  const progress=mineProgress();if(progress?.mine&&kind==='candidate'&&file.path===progress.mine.path&&line===progress.mine.line){item.dataset.mine='true';item.className+=' mine-row';}
  const number=button(String(line??''),()=>setAnchor({kind,path:file.path,line},number.getBoundingClientRect?.()),true);number.className='line-number';number.setAttribute('aria-label','Annotate '+kind+' line '+line);
  if(state.preview||state.phase==='completed'||(kind==='baseline'&&!file.hunks.flat().some(r=>r.kind==='delete'&&r.oldLine===line)))number.disabled=true;
  item.append(number);
  const text=node('span',undefined,'code-text');
  if(!showFull&&row.pair!==null){const paired=kind==='candidate'?file.baseline[row.pair-1]:file.candidate[row.pair-1];if(paired!==undefined)text.append(changedText(row.text,paired,row.kind));else text.textContent=row.text;}else text.textContent=row.text;
  item.append(text);if(item.dataset.mine)item.append(node('span',progress.reviewed?(progress.evidence.every(entry=>entry.kind==='ai-counterexample')?'Mine · AI counterexample, not executed':'Mine · evidence recorded'):progress.covered?'Mine · flagged · verification pending':'Mine · not flagged · verification pending','mine-marker'));return item;
}
function renderCode() {
  const file=state.files[selected];$('filename').textContent=file.path;renderMineSummary();
  const code=$('code');code.replaceChildren();const positioned=new Set();
  const appendRow=row=>{code.append(row);for(const note of notes){if(note.id===conversationItemId())continue;const a=note.anchor;if(a.path===file.path&&a.kind===row.dataset.kind&&(commentRanges.get(note.id)?.last??a.line)===Number(row.dataset.line)){code.append(commentCard(note));positioned.add(note.id);}}};
  $('file-view').value=mode;
  $('code-help').textContent=mode==='baseline'?'Captured baseline. Deleted rows can be annotated.':state.phase==='revealed'||state.phase==='completed'?'Captured clean candidate. Select code or click a line number to comment.':'Captured review version. Select code or click a line number to comment.';
  if(mode==='diff'){
    if(!file.hunks.length)code.append(node('p','No text diff. Open the full file for supporting context.','muted'));
    for(const rows of file.hunks){code.append(node('div','@@ baseline '+(rows.find(r=>r.oldLine!==null)?.oldLine??'—')+' · candidate '+(rows.find(r=>r.newLine!==null)?.newLine??'—')+' @@','hunk'));for(const row of rows)appendRow(codeRow(row,file));}
  }else{
    const content=mode==='candidate'?file.candidate:file.baseline;
    content.forEach((text,index)=>appendRow(codeRow({kind:'context',text,oldLine:mode==='baseline'?index+1:null,newLine:mode==='candidate'?index+1:null,pair:null},file,true)));
  }
  const contextual=notes.filter(note=>note.id!==conversationItemId()&&!positioned.has(note.id)&&(note.anchor.kind==='change'||note.anchor.path===file.path));
  if(contextual.length){const context=node('div',undefined,'context-comments');for(const note of contextual)context.append(commentCard(note,true));code.prepend(context);}
}
function field(parent,label,value,onInput,rows=3) { const container=node('label',label);const input=node('textarea');input.rows=rows;input.maxLength=4000;input.value=value;input.addEventListener('input',()=>onInput(input.value));container.append(input);parent.append(container);return input; }
function select(parent,label,options,value,onChange) {const container=node('label',label),input=node('select');for(const [v,t]of options){const option=node('option',t);option.value=v;input.append(option);}input.value=value;input.addEventListener('change',()=>onChange(input.value));container.append(input);parent.append(container);return input;}
function section(title) {const e=node('div',undefined,'step');const number=/^([1-5])/.exec(title);if(number)e.id='review-step-'+number[1];e.append(node('h2',title));$('steps').append(e);return e;}
function firstPassEvidence(){
  if(chatLoading||chatSending||chatState.busy||evidenceLoading)throw new Error('Wait for discussion and counterexample organization to finish before saving this pass.');
  const messages=chatState.messages.filter(message=>message.role==='user'||message.role==='assistant').map(message=>({role:message.role,text:message.text}));
  const key='minesweeper-author-evidence:'+capability;
  try{localStorage.setItem(key,JSON.stringify({firstPass:{annotations:notes,ranges:[...commentRanges],messages,reviewEvidence:currentReviewEvidence()}}));}catch{throw new Error('Your discussion snapshot could not be saved. Keep this page open and retry.');}
  const discussion=messages.filter(message=>message.role==='user').map((message,index)=>'Message '+(index+1)+': '+message.text).join('\n\n');
  const prefix=discussion.length>3900?'Author discussion excerpt (earlier text omitted; full discussion is saved locally):\n':'Author discussion:\n';
  return {prediction:discussion?prefix+discussion.slice(-(4000-prefix.length)):notes.length?'Comments are preserved with this pass. No separate prediction was requested.':'No comments or sent messages were recorded before saving this pass.',annotations:notes,noFindings:notes.length?'':'No comments were recorded before saving this pass; any sent messages are preserved as discussion.'};
}
function renderWorkflow(){}
async function download() {
  ensureNoAnnotationDraft();if(evidenceLoading)throw new Error('Wait for evidence organization to finish before exporting.');if(state.phase!=='completed'&&confirmedCardSource!==cardSourceSignature())throw new Error('Confirm the current review card before exporting.');
  const response=await fetch(base+'export',{method:'POST',headers:{'Content-Type':'application/json','X-Minesweeper-Session':capability},body:'{}'});
  if(!response.ok)throw new Error((await response.json()).error);
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='minesweeper-handoff.md';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  state=await (await fetch(base+'state')).json();render();
}
let reviewMetadata=null,metadataWarning='';
function initializeReviewMetadata(){if(reviewMetadata)return;try{const saved=localStorage.getItem('antislope-review-metadata');reviewMetadata=saved?validateMetadataExport(JSON.parse(saved)):{schemaVersion:1,participantId:crypto.randomUUID(),records:[]};}catch{metadataWarning='Existing metadata could not be read. It has been left untouched; new records are available for manual export only.';reviewMetadata={schemaVersion:1,participantId:crypto.randomUUID(),records:[]};}}
function saveReviewMetadata(){if(metadataWarning)return;try{localStorage.setItem('antislope-review-metadata',JSON.stringify(reviewMetadata));}catch{metadataWarning='Metadata could not be saved in this browser. Export the current records before closing the page.';}}
function recordReviewMetadata(){if(!state||state.preview)return;initializeReviewMetadata();const id=state.version.readerId,previous=reviewMetadata.records.find(r=>r.sessionId===id),day=new Date().toISOString().slice(0,10),assessments=state.assessments??[];
  const record=validateMetadataRecord({sessionId:id,revision:previous?.revision??1,startedOn:previous?.startedOn??day,updatedOn:previous?.updatedOn??day,phase:state.phase,freshness:state.freshness,stages:{firstPassSubmitted:state.phase!=='reading',revealed:state.phase==='revealed'||state.phase==='completed',assessed:Array.isArray(state.assessments),followupSubmitted:!!state.followup,completed:state.phase==='completed'},outcomes:{comments:notes.length,authorReportedRealIssues:assessments.filter(a=>a.kind==='real').length,evidenceBackedRealIssues:assessments.filter(a=>a.kind==='real'&&a.evidence.trim()).length,testHandoffs:assessments.filter(a=>a.kind==='real'&&a.disposition==='test').length,unresolvedQuestions:assessments.filter(a=>a.kind==='question'||(a.kind==='real'&&a.disposition==='question')).length},usefulness:previous?.usefulness??null});
  if(previous&&JSON.stringify(previous)===JSON.stringify(record))return;
  if(previous){record.revision++;record.updatedOn=day<record.startedOn?record.startedOn:day;reviewMetadata.records=reviewMetadata.records.filter(r=>r.sessionId!==id);}
  reviewMetadata.records.push(record);saveReviewMetadata();
}
function renderMetadata(){recordReviewMetadata();const summary=summarizeMetadata([reviewMetadata]),content=$('metadata-summary');content.replaceChildren();const facts=[['Reviews started',summary.reviews],['Handoffs completed',summary.completedReviews],['Real issues reported by the author',summary.authorReportedRealIssues],['Real issues with recorded evidence',summary.evidenceBackedRealIssues],['Test handoff items',summary.testHandoffs],['Unresolved questions',summary.unresolvedQuestions],['Marked useful by the user',summary.usefulReviews]];for(const [label,value]of facts){const item=node('div',undefined,'metadata-fact');item.append(node('strong',String(value)),node('span',label));content.append(item);}
  $('metadata-participant').value=reviewMetadata.participantId;$('metadata-warning').textContent=metadataWarning;$('metadata-warning').hidden=!metadataWarning;
  const current=reviewMetadata.records.find(r=>r.sessionId===state.version.readerId);$('metadata-usefulness').value=current?.usefulness??'';
  const history=$('metadata-history');history.replaceChildren();const table=node('table'),head=node('tr');for(const label of ['Started (UTC)','Stage','Real issues / evidence','Open questions','Useful?'])head.append(node('th',label));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');for(const record of [...reviewMetadata.records].reverse()){const row=node('tr');for(const value of [record.startedOn,record.phase,record.outcomes.authorReportedRealIssues+' / '+record.outcomes.evidenceBackedRealIssues,record.outcomes.unresolvedQuestions,record.usefulness??'Not answered'])row.append(node('td',String(value)));body.append(row);}table.append(body);history.append(table);
}
const metadataPanel=$('metadata-dialog');
function openMetadata(){if(!state||state.preview)return;renderMetadata();metadataPanel.hidden=false;addReviewMessage('Show my usage and outcomes','metadata');}
$('open-metadata').addEventListener('click',()=>{$('workspace-menu').open=false;openMetadata();});
$('close-metadata').addEventListener('click',()=>{metadataPanel.hidden=true;});
$('metadata-usefulness').addEventListener('change',()=>{recordReviewMetadata();const record=reviewMetadata.records.find(r=>r.sessionId===state.version.readerId),value=$('metadata-usefulness').value;if(!['','useful','uncertain','not-useful'].includes(value))return;record.usefulness=value||null;record.revision++;const day=new Date().toISOString().slice(0,10);record.updatedOn=day<record.startedOn?record.startedOn:day;saveReviewMetadata();renderMetadata();});
$('metadata-identity').addEventListener('click',()=>{try{const next=validateMetadataExport({...reviewMetadata,participantId:$('metadata-participant').value.trim()});reviewMetadata=next;saveReviewMetadata();renderMetadata();}catch{$('metadata-warning').textContent='Use a valid anonymous UUID. No identity or records were changed.';$('metadata-warning').hidden=false;}});
$('metadata-export').addEventListener('click',()=>{recordReviewMetadata();const payload=validateMetadataExport(reviewMetadata),blob=new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download='antislope-metadata.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function currentReviewStep(){return state.phase==='reading'?1:state.phase==='submitted'?2:state.phase==='completed'?5:!state.assessments?3:!state.followup?4:5;}
let reviewMessages=[],confirmedCardSource=null,postRevealEvidence=[];const cardDecisions=new Map();
function restorePostRevealEvidence(){try{const saved=JSON.parse(localStorage.getItem('minesweeper-clean-evidence:'+capability)||'null');if(saved?.readerId===state.version.readerId&&Array.isArray(saved.messages))postRevealEvidence=saved.messages.filter(text=>typeof text==='string'&&text.length<=4000).slice(-20);}catch{}}
function cleanEvidenceExcerpt(){const prefix='Author-confirmed verification on captured clean code. Recorded author evidence (not independently executed by this tool):\n';return prefix+postRevealEvidence.join('\n\n').slice(-(4000-prefix.length));}
function recordPostRevealEvidence(message,phase){if(phase!=='revealed')return;postRevealEvidence.push(message);postRevealEvidence=postRevealEvidence.slice(-20);try{localStorage.setItem('minesweeper-clean-evidence:'+capability,JSON.stringify({readerId:state.version.readerId,messages:postRevealEvidence}));}catch{}}

function conversationItemId(){return 'discussion-'+state.version.readerId;}
function sourceNotes(){return notes.filter(note=>note.id!==conversationItemId());}
let reviewEvidenceCache=null,evidenceLoading=false,evidenceAttempt=null,evidenceFailure='';
const reviewEvidenceKey='minesweeper-review-evidence:'+capability;
function evidenceSignature(){return JSON.stringify({schemaVersion:3,notes:sourceNotes(),messages:chatState.messages,readerId:state.version.readerId,codeVersion:"review"});}
function evidenceSources(){return [...sourceNotes().map(note=>({id:'comment:'+note.id,text:[note.constraint,note.trigger,note.uncertainty].join('\n')})),...chatState.messages.flatMap((message,index)=>message.role==='user'?[{id:'user:'+index,text:message.text}]:[])];}
function validEvidenceEntry(entry){
  const file=state.files.find(file=>file.path===entry?.path),sources=evidenceSources();
  if(!file||!Number.isInteger(entry.first)||!Number.isInteger(entry.last)||entry.first<1||entry.last<entry.first||entry.last>file.candidate.length||!['trace','test-report','ai-counterexample'].includes(entry.kind)||!Array.isArray(entry.sources)||!entry.sources.length||entry.sources.length>8||!entry.sources.every(citation=>citation&&typeof citation.quote==='string'&&citation.quote.trim()&&sources.some(source=>source.id===citation.id&&source.text.includes(citation.quote))))return false;
  const generated=entry.kind==='ai-counterexample';
  if(!['input','observed','expected','basis'].every(key=>typeof entry[key]==='string'&&entry[key].trim()&&entry[key].length<=1000&&(generated||entry.sources.some(source=>source.quote.includes(entry[key])))))return false;
  if(!generated)return entry.version===undefined&&entry.steps===undefined&&entry.code===undefined;
  if(entry.version!=='review'||!Array.isArray(entry.steps)||!entry.steps.length||entry.steps.length>12||!entry.steps.every(step=>typeof step==='string'&&step.trim()&&step.length<=2000)||!Array.isArray(entry.code)||!entry.code.length||entry.code.length>20)return false;
  const mutation=['revealed','completed'].includes(state.phase)?state.mutationReference:null;
  if(!entry.code.every(quote=>Number.isInteger(quote?.line)&&quote.line>=1&&quote.line<=file.candidate.length&&quote.text===(mutation?.path===file.path&&mutation.line===quote.line?mutation.replacement:file.candidate[quote.line-1]))||new Set(entry.code.map(quote=>quote.line)).size!==entry.code.length)return false;
  return entry.sources.some(citation=>{const note=sourceNotes().find(note=>'comment:'+note.id===citation.id),anchor=note?.anchor;return anchor?.kind==='candidate'&&anchor.path===entry.path&&anchor.line>=entry.first&&anchor.line<=entry.last&&entry.code.some(quote=>quote.line===anchor.line);});
}
function evidenceDescription(entry){if(entry.kind==='ai-counterexample')return 'AI code reasoning on the captured review version (not executed; not a verified clean-code issue):\nInput: '+entry.input+'\nPredicted behavior: '+entry.observed+'\nRequired behavior: '+entry.expected+'\nBasis: '+entry.basis+'\n'+entry.steps.map((step,index)=>(index+1)+'. '+step).join('\n');return 'Recorded author evidence (not independently executed or verified):\n'+entry.sources.map(source=>source.quote).join('\n');}
function renderEvidence(entry,parent){const panel=node('div',undefined,'finding');panel.append(node('strong',entry.kind==='ai-counterexample'?'AI counterexample · code reasoning, not executed':'Recorded '+(entry.kind==='trace'?'branch trace':'test report')));if(entry.kind==='ai-counterexample'){panel.append(renderMarkdown('**Input:** '+entry.input+'\n\n**Predicted displayed behavior:** '+entry.observed+'\n\n**Required behavior:** '+entry.expected+'\n\n**Basis:** '+entry.basis+'\n\n'+entry.steps.map((step,index)=>(index+1)+'. '+step).join('\n')));const fence=String.fromCharCode(96).repeat(3);panel.append(node('p',(['reading','submitted'].includes(state.phase)?'Displayed review excerpts · ':'Historical displayed review excerpts · ')+entry.path,'muted'),renderMarkdown(fence+'ts\n'+entry.code.map(quote=>'// Line '+quote.line+'\n'+quote.text).join('\n')+'\n'+fence));}for(const source of entry.sources)panel.append(renderMarkdown('> '+source.quote.replace(/\n/g,'\n> ')));parent.append(panel);}
function currentReviewEvidence(){return reviewEvidenceCache?.signature===evidenceSignature()?(reviewEvidenceCache.entries??[]).filter(validEvidenceEntry):[];}
function restoreReviewEvidence(){try{const saved=JSON.parse(localStorage.getItem(reviewEvidenceKey)||'null');if(saved?.schemaVersion===3&&saved.readerId===state.version.readerId&&typeof saved.signature==='string'&&Array.isArray(saved.entries)&&saved.entries.length<=50)reviewEvidenceCache=saved;}catch{}}
async function organizeReviewEvidence(){if(!state||state.preview||!['reading','submitted','revealed','completed'].includes(state.phase)||!reviewMessages.some(message=>['card','preview'].includes(message.kind))||chatLoading||chatSending||chatState.busy||evidenceLoading||!chatState.available||hasCommentDraft())return;const signature=evidenceSignature();if(reviewEvidenceCache?.signature===signature||evidenceAttempt===signature)return;evidenceAttempt=signature;evidenceLoading=true;evidenceFailure='';renderChat();
  try{const result=await post('review-evidence',{annotations:sourceNotes()});if(signature!==evidenceSignature())return;if(!Array.isArray(result.entries)||result.entries.length>50||!result.entries.every(validEvidenceEntry))throw new Error('Invalid evidence record.');reviewEvidenceCache={schemaVersion:3,readerId:state.version.readerId,signature,entries:result.entries};try{localStorage.setItem(reviewEvidenceKey,JSON.stringify(reviewEvidenceCache));}catch{evidenceFailure='Evidence is available in this page but could not be saved in this browser.';}}
  catch{evidenceFailure='Evidence could not be organized. Items remain pending; reopen the review card to retry.';}
  finally{evidenceLoading=false;renderCode();renderChat();}
}
function derivedMineRegion(){const progress=mineProgress();if(!progress?.mine)return {kind:'none',note:''};if(state.region?.kind==='disputed'||state.referenceDispute)return {kind:'disputed',note:state.region?.note||'The reference remains disputed; retain this region for clean-code review.'};if(progress.reviewed)return {kind:'explained',note:progress.evidence.map(evidenceDescription).join('\n\n').slice(0,4000)};return {kind:'handoff',note:'No sufficient recorded author verification evidence for this region. Recheck it against clean code; claims remain unresolved.'};}
function cardSourceSignature(){return JSON.stringify({notes:sourceNotes(),messages:chatState.messages,readerId:state.version.readerId,evidence:currentReviewEvidence()});}
function saveCardApproval(){try{localStorage.setItem('minesweeper-card-approval:'+capability,JSON.stringify({readerId:state.version.readerId,signature:confirmedCardSource}));}catch{}}
function restoreCardApproval(){try{const saved=JSON.parse(localStorage.getItem('minesweeper-card-approval:'+capability)||'null');if(saved?.readerId===state.version.readerId)confirmedCardSource=saved.signature;}catch{}}
const reviewHistoryKey='minesweeper-review-history:'+capability;
function saveReviewHistory(){try{localStorage.setItem(reviewHistoryKey,JSON.stringify({schemaVersion:1,readerId:state.version.readerId,messages:reviewMessages}));}catch{$('error').textContent='Review messages could not be saved in this browser. Keep this page open to retain them.';$('error').hidden=false;}}
function restoreReviewHistory(){try{const saved=JSON.parse(localStorage.getItem(reviewHistoryKey)||'null');if(saved?.schemaVersion!==1||saved.readerId!==state.version.readerId||!Array.isArray(saved.messages))return;const kinds=['first','reveal','preview','card','followup','references','hint','notice','context','metadata'];reviewMessages=saved.messages.filter(m=>m&&Number.isSafeInteger(m.at)&&m.at>=0&&typeof m.user==='string'&&m.user.length<=200&&kinds.includes(m.kind)&&typeof m.body==='string'&&m.body.length<=16000).map(m=>({at:m.at,user:m.user,kind:m.kind,body:m.body==='Loading hint…'?'This hint request was interrupted. Use Hint to request the next available hint.':m.body}));}catch{$('error').textContent='Saved review messages could not be restored.';$('error').hidden=false;}}
function addReviewMessage(user,kind,body=''){reviewMessages.push({at:chatState.messages.length,user,kind,body});saveReviewHistory();renderChat();}
function openReviewStep(number){if(state.phase==='reading')addReviewMessage('Next step','first');else if(state.phase==='submitted')addReviewMessage('Next step','reveal');else if(number===2)addReviewMessage('Show the revealed review','references');else if(number===4)addReviewMessage('Show follow-up context','followup');else openReviewCard();}
function renderChatShortcuts(){const unavailable=!state||state.preview;$('chat-hint').disabled=unavailable||state.phase!=='submitted';$('chat-hint').title=state.phase==='reading'?'Confirm your first pass to unlock hints.':'Show the next hint here; it is not shared with AI.';$('chat-next').disabled=unavailable;$('chat-card').disabled=unavailable;$('chat-next').title='Continue the review here; confirmation and reveal remain explicit.';}
function openReviewCard(){if(evidenceFailure){evidenceAttempt=null;evidenceFailure='';}if(state.phase==='reading'||state.phase==='submitted'){addReviewMessage('Show my review card','preview');return;}addReviewMessage('Organize my review card','card');}
async function requestReviewHint(){if(state?.phase!=='submitted'||state.preview||busy)return;const reply={at:chatState.messages.length,user:'Give me a hint',kind:'hint',body:'Loading hint…'};reviewMessages.push(reply);saveReviewHistory();renderChat();await guard(async()=>{try{const hint=await post('action/hint',{});reply.body=hint.count!==undefined?'Deliberate errors: '+hint.count+'. Other real issues may still exist.':hint.category?'Category: '+hint.category:hint.clue;saveReviewHistory();state=await(await fetch(base+'state')).json();render();}catch(e){reply.body='The hint could not be loaded, or no further hint is available.';saveReviewHistory();renderChat();throw e;}});}
function buildReviewDraft(){const annotations=structuredClone(sourceNotes()),existing=notes.find(note=>note.id===conversationItemId());const author=chatState.messages.filter(message=>message.role==='user').map(message=>message.text).join('\n\n').replace(/(?:\x60{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\x60{3,}|~{3,})/g,'[Historical code excerpt omitted. Recheck the clean repository.]');
  if(author&&annotations.length<50)annotations.push({id:conversationItemId(),anchor:{kind:'change'},constraint:'Author discussion — unverified context; recheck all claims against clean code:\n'+author.slice(-3800),trigger:'Not yet established.',uncertainty:'Discussion is not proof that tests passed or fixes succeeded.'});else if(existing)annotations.push(existing);
  const assessments=annotations.map(note=>{const choice=cardDecisions.get(cardSourceSignature()+':'+note.id),saved=state.assessments?.find(a=>a.id===note.id);return choice??saved??{id:note.id,kind:'question',evidence:'',disposition:'question',next:('Recheck on current clean code: '+note.constraint).slice(0,4000),repairNote:''};});return {annotations,assessments,signature:cardSourceSignature()};
}
async function confirmReviewCard(draft){ensureNoAnnotationDraft();if(chatLoading||chatSending||chatState.busy||evidenceLoading)throw new Error('Wait for discussion and evidence organization to finish before confirming.');if(state.phase!=='revealed'||draft.signature!==cardSourceSignature())throw new Error('The discussion changed. Open an updated review card before confirming.');const region=derivedMineRegion();const dispute=state.referenceDispute??'';
  await action('revise',{annotations:draft.annotations});await action('assess',{assessments:draft.assessments,region,referenceDispute:dispute});
  if(!state.followup)await action('followup',{prediction:'Comments and discussion are retained as context. No separate follow-up prediction was requested or inferred.',dispute:''});
  const key='minesweeper-author-evidence:'+capability;try{const saved=JSON.parse(localStorage.getItem(key)||'{}');saved.confirmedReview={annotations:draft.annotations,messages:chatState.messages};localStorage.setItem(key,JSON.stringify(saved));}catch{throw new Error('The review was saved by the session, but the local discussion snapshot could not be saved. Keep this page open and retry.');}
  confirmedCardSource=cardSourceSignature();saveCardApproval();renderChat();addReviewMessage('Confirm review card','notice','Review card confirmed. Unverified content stays as questions. You can export, or continue discussing and confirm an updated card.');
}
function renderReviewMessage(message,transcript){const request=node('div',undefined,'chat-message user');request.append(node('div','You','message-role'),node('p',message.user));transcript.append(request);const reply=node('div',undefined,'chat-message review');reply.append(node('div','Review','message-role'));
  if(message.kind==='hint'||message.kind==='notice')reply.append(renderMarkdown(message.body));
  if(message.kind==='first'){reply.append(node('p','Your comments and discussion are the first pass. No extra answers are required.'));const confirm=button('Submit first pass',async()=>{ensureNoAnnotationDraft();await action('submit',firstPassEvidence());addReviewMessage('Confirm first pass','notice','First pass saved. Hints are now available. Reveal remains your choice.');});confirm.disabled=state.phase!=='reading';reply.append(confirm);}
  if(message.kind==='reveal'){reply.append(node('p','Reveal switches the left pane to the captured clean code. Nothing is revealed until you confirm.'));const reveal=button('Reveal clean code',async()=>{ensureNoAnnotationDraft();if(chatLoading||chatSending||chatState.busy)throw new Error('Finish the current discussion before revealing.');await action('reveal',{});addReviewMessage('Reveal clean code','notice','Clean captured code is now shown. Continue discussing, or confirm a review card.');openReviewCard();});reveal.disabled=state.phase!=='submitted';reply.append(reveal);}
  if(message.kind==='followup'&&(state.phase==='revealed'||state.phase==='completed')){reply.append(node('h3','Follow-up context'),renderMarkdown(state.followupPrompt),node('p','Discuss this in chat if useful. Confirming the review card saves existing context without requiring a separate answer.','muted'));if(state.followupReference)reply.append(renderMarkdown('Released reference: '+state.followupReference.answer+'\n\n'+state.followupReference.explanation));}
  if(['card','preview'].includes(message.kind)){const draft=buildReviewDraft(),progress=mineProgress();if(progress){reply.append(node('p',mineSummaryText(progress),'mine-card-summary'),node('p','Flagged means the mine line is inside one of your candidate comment ranges; overlapping comments count it once. This acknowledges the location you marked, separately from verification. File comments and chat claims do not establish location or verification. Reviewed means author evidence or a labeled AI counterexample is recorded below. AI counterexamples are code reasoning, not executed tests or verified clean-code findings. Missing or disputed evidence remains pending.','muted'));if(progress.mine){reply.append(button('View mine in code',showMine,true));}}else reply.append(node('p','Mine count is hidden until reveal. Hints you request remain in this conversation.','muted'));for(const entry of currentReviewEvidence())renderEvidence(entry,reply);if(evidenceLoading)reply.append(node('p','Organizing your recorded evidence…','muted'));else if(evidenceFailure)reply.append(node('p',evidenceFailure,'muted'));reply.append(node('h3','Review card'),node('p',['reading','submitted'].includes(state.phase)?'Comments and AI counterexamples describe the displayed version. Reasoning has not been executed; observations remain questions. Save your first pass when ready, then choose when to reveal.':'New observations remain unverified questions. Confirming saves this record and follow-up context, releasing the follow-up reference. It does not verify claims or execute tests.','muted'));
    if(!draft.annotations.length)reply.append(node('p','No findings recorded. This is a valid review outcome.'));
    for(const note of draft.annotations){const panel=node('div',undefined,'finding'),assessment=draft.assessments.find(a=>a.id===note.id);panel.append(node('div',anchorText(note.anchor),'metadata'),renderMarkdown(note.constraint),node('p',assessment.kind==='real'?'Previously author-assessed real issue; recorded evidence retained.':'Unverified question','muted'));if(assessment.evidence)panel.append(renderMarkdown(assessment.evidence));if(state.phase==='revealed'&&note.id!==conversationItemId()){const verify=button(assessment.kind==='real'?'Keep as question':'Confirm verified issue',()=>{if(assessment.kind!=='real'&&!postRevealEvidence.length)throw new Error('Discuss your clean-code verification evidence in chat first.');const key=cardSourceSignature()+':'+note.id;if(assessment.kind==='real')cardDecisions.set(key,{id:note.id,kind:'question',evidence:'',disposition:'question',next:('Recheck on clean code: '+note.constraint).slice(0,4000),repairNote:''});else cardDecisions.set(key,{id:note.id,kind:'real',evidence:cleanEvidenceExcerpt(),disposition:'test',next:'Recheck this recorded clean-code evidence on the current branch before fixing.',repairNote:''});confirmedCardSource=null;renderChat();},true);verify.disabled=assessment.kind!=='real'&&!postRevealEvidence.length;verify.title='Confirm only if your recorded clean-code evidence verifies this issue. AI claims alone are not evidence.';panel.append(verify);}reply.append(panel);}
    if(state.phase==='revealed'||state.phase==='completed'){const follow=node('details');follow.append(node('summary','Follow-up context'),node('p',state.followupPrompt));if(state.followupReference)follow.append(node('p','Released reference: '+state.followupReference.answer+'\n'+state.followupReference.explanation));reply.append(follow);
      const confirm=button('Confirm review card',()=>confirmReviewCard(draft));confirm.disabled=state.phase==='completed'||chatLoading||chatSending||chatState.busy||evidenceLoading;reply.append(confirm);const exportButton=button('Export handoff',download,true);exportButton.disabled=state.phase!=='completed'&&(!state.assessments||!state.followup||confirmedCardSource!==cardSourceSignature()||hasCommentDraft()||evidenceLoading);reply.append(exportButton);
    }else reply.append(node('p','Reveal explicitly when you are ready to assess the captured clean version.','muted'));
  }
  if(message.kind==='references'&&(state.phase==='revealed'||state.phase==='completed')){reply.append(node('p','Released references are visible only here and are not sent to AI.'));const i=state.initialReference;reply.append(renderMarkdown('Displayed behavior: '+i.displayed+'\n\nClean behavior: '+i.clean+'\n\nRequirement: '+i.intended+'\n\n'+i.explanation));if(state.mutationReference)reply.append(node('p',state.mutationReference.path+':'+state.mutationReference.line+'\n'+state.mutationReference.explanation));}
  if(message.kind==='metadata')reply.append(metadataPanel);
  if(message.kind==='context')reply.append(renderMarkdown(state.requirements+'\n\n'+state.intent));
  transcript.append(reply);
}
$('chat-hint').addEventListener('click',requestReviewHint);
$('chat-next').addEventListener('click',()=>{if(state&&!state.preview)openReviewStep(currentReviewStep());});
$('chat-card').addEventListener('click',()=>{if(state&&!state.preview)openReviewCard();});
function renderProgress(){
  const progress=$('review-progress');progress.replaceChildren();progress.hidden=!!state.preview;if(state.preview)return;
  const current=currentReviewStep();
  const complete=[!!state.firstPass,state.phase==='revealed'||state.phase==='completed',!!state.assessments,!!state.followup,state.phase==='completed'];
  for(const [index,label]of ['First pass','Reveal','Review card','Follow-up','Export'].entries()){const number=index+1;const control=button('',()=>openReviewStep(number));control.dataset.step=String(number);control.className='progress-step'+(complete[index]?' done':'')+(number===current?' current':'');control.disabled=number>current&&!(state.phase==='revealed'&&number===4);control.setAttribute('aria-label',label+(complete[index]?' · complete':number===current?' · current':' · pending'));if(number===current)control.setAttribute('aria-current','step');control.title=control.disabled?'Complete the earlier step to continue.':'Open this step; submission and reveal require explicit action.';control.append(node('span',complete[index]?'✓':String(number),'progress-marker'),node('span',label));progress.append(control);}
}
function render() {
  $('title').textContent=state.title;$('intent').textContent=state.intent;$('requirements').textContent=state.requirements;
  $('phase').textContent=state.preview?'Curator preview':state.phase;
  $('version').textContent='Baseline '+state.version.baseline+' · '+(state.version.snapshot?'snapshot '+state.version.snapshot:'private review '+state.version.readerId)+' · HEAD at preparation '+state.version.headAtPreparation;
  $('excluded').textContent='Excluded paths: '+(state.version.excluded.join(', ')||'none');
  $('history').hidden=state.freshness==='current';$('history').textContent='Historical snapshot: current file contents changed or could not be checked. Your annotations are preserved; findings refer to the captured version and need rechecking on current code.';
  const nav=$('files');nav.replaceChildren();state.files.forEach((file,index)=>{const option=node('option',file.path);option.value=String(index);nav.append(option);});nav.value=String(selected);
  $('annotation-form').hidden=state.preview||state.phase==='completed';$('change-anchor').disabled=state.preview||state.phase==='completed';$('file-anchor').disabled=state.preview||state.phase==='completed';
  renderNotes();renderWorkflow();renderProgress();renderChatShortcuts();recordReviewMetadata();if(typeof chatState!=='undefined')renderChat();
}
const workspace=$('workspace'),divider=$('pane-divider');let split=68,dragPointer=null;
function splitBounds(){const width=workspace.getBoundingClientRect().width||innerWidth;const minimum=width<650?150:220;return [Math.min(40,minimum/width*100),Math.max(60,(width-minimum-6)/width*100)];}
function applySplit(value){const [minimum,maximum]=splitBounds();split=Math.max(minimum,Math.min(maximum,Number.isFinite(value)?value:68));workspace.style.setProperty('--code-width',split+'%');divider.setAttribute('aria-valuemin',String(Math.round(minimum)));divider.setAttribute('aria-valuemax',String(Math.round(maximum)));divider.setAttribute('aria-valuenow',String(Math.round(split)));divider.setAttribute('aria-valuetext',Math.round(split)+'% code');}
function saveSplit(){try{localStorage.setItem('antislope-code-width',String(split));}catch{}}
try{const stored=localStorage.getItem('antislope-code-width');applySplit(stored===null?68:Number(stored));}catch{applySplit(68);}
function moveDivider(event){const rect=workspace.getBoundingClientRect();applySplit((event.clientX-rect.left)/rect.width*100);}
divider.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();dragPointer=event.pointerId;divider.setPointerCapture(event.pointerId);document.body.classList.toggle('resizing',true);moveDivider(event);});
divider.addEventListener('pointermove',event=>{if(dragPointer===event.pointerId)moveDivider(event);});
const finishResize=event=>{if(dragPointer!==event.pointerId)return;dragPointer=null;document.body.classList.toggle('resizing',false);saveSplit();};
for(const event of ['pointerup','pointercancel','lostpointercapture'])divider.addEventListener(event,finishResize);
divider.addEventListener('keydown',event=>{const [minimum,maximum]=splitBounds();const values={ArrowLeft:split-2,ArrowRight:split+2,Home:minimum,End:maximum};if(values[event.key]===undefined)return;event.preventDefault();applySplit(values[event.key]);saveSplit();});
divider.addEventListener('dblclick',()=>{applySplit(68);saveSplit();});
addEventListener('resize',()=>applySplit(split));
$('files').addEventListener('change',()=>{selected=Number($('files').value);renderCode();});
let chatState={messages:[],busy:false,available:false}, chatLoading=false, chatFailure='', chatRetryTurn=false, chatPoll=null, chatRequest=null, chatSending=false, followChat=true;
$('chat-transcript').addEventListener('scroll',()=>{const transcript=$('chat-transcript');followChat=transcript.scrollHeight-transcript.clientHeight-transcript.scrollTop<=48;});
function renderChat() {
  if(state&&!state.preview&&sourceNotes().length&&!reviewMessages.some(message=>['card','preview'].includes(message.kind))){reviewMessages.push({at:chatState.messages.length,user:'Review my saved comments',kind:['reading','submitted'].includes(state.phase)?'preview':'card',body:''});saveReviewHistory();}
  const transcript=$('chat-transcript'),previousTop=transcript.scrollTop;transcript.replaceChildren();
  for(let index=0;index<=chatState.messages.length;index++){for(const review of reviewMessages.filter(item=>Math.min(item.at,chatState.messages.length)===index))renderReviewMessage(review,transcript);if(index===chatState.messages.length)break;const message=chatState.messages[index];const entry=node('div',undefined,'chat-message '+message.role);entry.append(node('div',message.role==='assistant'?'AI':'You','message-role'),renderMarkdown(message.text));transcript.append(entry);}
  if(chatState.pending){if(chatState.pending.message){const request=node('div',undefined,'chat-message user');request.append(node('div','You','message-role'),renderMarkdown(chatState.pending.message));transcript.append(request);}if(chatState.pending.text){const reply=node('div',undefined,'chat-message assistant');reply.append(node('div','AI','message-role'),renderMarkdown(chatState.pending.text));transcript.append(reply);}}
  transcript.scrollTop=followChat?transcript.scrollHeight:previousTop;
  $('chat-status').textContent=chatLoading||chatSending||chatState.busy?(chatState.pending?.text?'Responding…':'Thinking…'):chatState.available?'':'AI discussion is unavailable for this session.';
  $('chat-send').disabled=chatLoading||chatSending||chatState.busy||evidenceLoading||!chatState.available;
  $('chat-error').textContent=chatFailure;$('chat-error').hidden=!chatFailure;
  $('chat-retry').hidden=!chatFailure;$('chat-retry').disabled=chatLoading||chatSending||chatState.busy;
  renderMineSummary();void organizeReviewEvidence();
}
function pollChat() {
  if(chatState.busy&&!chatPoll)chatPoll=setTimeout(()=>{chatPoll=null;loadChat(false);},150);
}
async function loadChat(opening=true) {
  if(chatLoading||state?.preview)return;chatLoading=true;chatFailure='';let starting=false;renderChat();
  try{const response=await fetch(base+'chat');if(!response.ok)throw new Error('The discussion could not be loaded. Retry to reconnect.');chatState=await response.json();if(opening&&chatState.available&&!chatState.busy&&!chatState.messages.length){starting=true;chatLoading=false;chatSending=true;chatState.busy=true;pollChat();chatState=await post('chat',{});}}
  catch(e){chatFailure=e.message||'The discussion could not be loaded. Retry to reconnect.';chatRetryTurn=false;if(starting){chatState.busy=false;delete chatState.pending;}}
  finally{chatLoading=false;if(starting)chatSending=false;renderChat();pollChat();}
}
async function sendChat() {
  if(chatLoading||chatSending||chatState.busy||evidenceLoading||!chatState.available)return;const message=$('chat-message').value,submittedPhase=state.phase;if(!message.trim())return;
  const signature=JSON.stringify({message,annotations:notes});if(!chatRequest||chatRequest.signature!==signature)chatRequest={signature,id:crypto.randomUUID()};
  chatSending=true;chatState.busy=true;chatState.pending={message,text:''};chatFailure='';renderChat();pollChat();
  try{chatState=await post('chat',{message,annotations:notes,requestId:chatRequest.id});chatRequest=null;recordPostRevealEvidence(message,submittedPhase);if($('chat-message').value===message)$('chat-message').value='';chatRetryTurn=false;}
  catch(e){chatFailure=e.message||'The message could not be sent. Your draft is preserved.';chatRetryTurn=true;chatState.busy=false;delete chatState.pending;}
  finally{chatSending=false;renderChat();pollChat();}
}
$('chat-message').addEventListener('input',()=>{chatRequest=null;});
let composingChat=false;
$('chat-message').addEventListener('compositionstart',()=>{composingChat=true;});
$('chat-message').addEventListener('compositionend',()=>{composingChat=false;});
$('chat-message').addEventListener('keydown',event=>{if(event.key!=='Enter'||event.shiftKey||event.isComposing||composingChat||event.keyCode===229)return;event.preventDefault();if(!event.repeat)sendChat();});
$('chat-form').addEventListener('submit',event=>{event.preventDefault();sendChat();});
$('chat-retry').addEventListener('click',()=>chatRetryTurn?sendChat():loadChat());
$('open-details').addEventListener('click',()=>{$('workspace-menu').open=false;addReviewMessage('Show the requirements','context');});
$('open-workflow').addEventListener('click',()=>{$('workspace-menu').open=false;openReviewStep(currentReviewStep());});
$('anchor-kind').addEventListener('change',anchorControls);
$('clear-draft').addEventListener('click',clearDraft);
$('close-comment').addEventListener('click',closeComment);
$('resume-comment').addEventListener('click',()=>showComment());
$('comment-dialog').addEventListener('cancel',event=>{event.preventDefault();closeComment();});
let selectionTimer=null;
$('code').addEventListener('mouseup',event=>{if(selectionTimer)clearTimeout(selectionTimer);if(event?.detail===1)selectionTimer=setTimeout(()=>{selectionTimer=null;commentOnSelection();},240);else commentOnSelection();});
$('code').addEventListener('dblclick',()=>{if(selectionTimer)clearTimeout(selectionTimer);selectionTimer=null;commentOnSelection();});
$('selection-chat').addEventListener('click',()=>{const before=$('chat-message').value;quoteComment({anchor:getAnchor(),constraint:$('constraint').value,trigger:$('trigger').value,uncertainty:$('uncertainty').value},draftRange??undefined);if($('chat-message').value!==before)closeComment();});
$('code').addEventListener('keyup',event=>{if(event.key==='Shift')commentOnSelection();});
for(const id of ['constraint','trigger','uncertainty'])$(id).addEventListener('input',()=>{$('resume-comment').hidden=!hasCommentDraft();if(state?.phase==='revealed')updateDownloadLock();});
$('change-anchor').addEventListener('click',()=>{$('workspace-menu').open=false;setAnchor({kind:'change'});});
$('file-anchor').addEventListener('click',()=>{$('file-menu').open=false;setAnchor({kind:'file',path:state.files[selected].path});});
$('file-view').addEventListener('change',()=>{const value=$('file-view').value;if(['diff','candidate','baseline'].includes(value)){mode=value;renderCode();}});
$('annotation-form').addEventListener('submit',event=>{event.preventDefault();guard(async()=>{const note={id:editId??crypto.randomUUID(),anchor:getAnchor(),constraint:$('constraint').value,trigger:$('trigger').value.trim()||'Not yet established.',uncertainty:$('uncertainty').value};if(!note.constraint.trim())throw new Error('Write a comment before saving.');const next=notes.filter(n=>n.id!==note.id).concat(note);if(state.phase==='reading'){notes=next;assessmentDrafts.delete(note.id);renderNotes();}else{const result=await post('action/revise',{annotations:next});assessmentDrafts.delete(note.id);state=result;notes=state.annotations;assessmentDirty=true;render();}if(draftRange)commentRanges.set(note.id,draftRange);persistComments();renderCode();recordReviewMetadata();clearDraft();});});
guard(async()=>{const response=await fetch(base+'state');if(!response.ok)throw new Error('The local session could not be loaded.');state=await response.json();notes=state.annotations;restoreComments();restoreCardApproval();restorePostRevealEvidence();restoreReviewHistory();restoreReviewEvidence();followDispute=state.followup?.dispute??'';referenceDispute=state.referenceDispute??'';region=state.region??region;for(const f of state.files){const option=node('option',f.path);option.value=f.path;$('anchor-path').append(option);}anchorControls();render();if(state.preview){$('chat-status').textContent='Discussion is unavailable in curator preview.';$('chat-send').disabled=true;}else loadChat();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state&&!busy)guard(async()=>{const response=await fetch(base+'state');if(!response.ok)throw new Error('The local server is unavailable.');state=await response.json();render();loadChat(false);});});
`;
