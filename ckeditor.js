// CKEditor iframe documents can be rewritten after content-script injection.
// Attach to the actual editable body, including same-origin nested frames.
(() => {
  const bound = new WeakSet(), frames = new WeakSet();
  const busy = new WeakSet();
  let snippets = new Map(), changed = false;
  const load = entries => { snippets = new Map(entries.map(x => [x.name, x])); };
  chrome.storage.onChanged.addListener((c,a) => { if(a === 'local' && c[snippetKey]) { changed=true; load(c[snippetKey].newValue ?? defaultSnippets); } });
  chrome.storage.local.get({[snippetKey]:defaultSnippets}).then(r=>{if(!changed)load(r[snippetKey]);}).catch(()=>{});
  function expand(body) {
    const doc=body.ownerDocument, sel=doc.getSelection();
    if(!body.isConnected || !body.isContentEditable || !doc.hasFocus() || !sel?.isCollapsed || !sel.rangeCount) return;
    const caret=sel.getRangeAt(0);
    if(!body.contains(caret.startContainer)) return;
    let node=caret.startContainer, offset=caret.startOffset;
    while(node.nodeType===1 && offset>0) {
      node=node.childNodes[offset-1];
      if(node.nodeType===1 && (!node.isContentEditable || /^(BR|IMG|TABLE|HR)$/.test(node.tagName)))return;
      offset=node.nodeType===3?node.length:node.childNodes.length;
    }
    if(node.nodeType!==3 || !node.parentElement.isContentEditable)return;
    // CKEditor may split text into inline formatting nodes. Do not cross a line or signature.
    const block=node.parentElement.closest('p,div,li,td,th,blockquote,pre,h1,h2,h3,h4,h5,h6') || body;
    let prefix=node.data.slice(0,offset), segments=[{node,end:offset,length:offset}];
    const walker=doc.createTreeWalker(block,4);walker.currentNode=node;
    let prev;
    while(prefix.length<42 && (prev=walker.previousNode())) {
      const gap=doc.createRange();gap.setStart(prev,prev.length);gap.setEnd(segments[0].node,0);
      if(!prev.parentElement.isContentEditable || gap.cloneContents().querySelector('br,img,table,hr,p,div,li,[contenteditable=false]'))break;
      prefix=prev.data+prefix;segments.unshift({node:prev,end:prev.length,length:prev.length});
    }
    const m=suffixPattern.exec(prefix);if(!m)return;
    const template=snippets.get(m[1].toLowerCase());if(template===undefined)return;
    let left=m[1].length+1;const range=doc.createRange();range.setEnd(node,offset);
    for(const seg of segments.reverse()){if(left<=seg.length){range.setStart(seg.node,seg.end-left);break;}left-=seg.length;}
    if(range.toString().toLowerCase()!==('/'+m[1]).toLowerCase())return;
    const text=fillTemplate(template.body), box=doc.createElement('div');
    text.split(/\r\n|\r|\n/).forEach((line,i)=>{if(i)box.append(doc.createElement('br'));box.append(doc.createTextNode(line));});
    const html=expandedRich(template,doc);if(html!==null)box.innerHTML=html;
    if(!box.firstChild)return;
    sel.removeAllRanges();sel.addRange(range);
    // Native edit preserves browser undo and emits input for CKEditor.
    if(doc.execCommand('insertHTML',false,box.innerHTML))return;
    if(!range.startContainer.isConnected || range.toString().toLowerCase()!==('/'+m[1]).toLowerCase())return;
    const fragment=doc.createDocumentFragment();while(box.firstChild)fragment.append(box.firstChild);
    const last=fragment.lastChild;range.deleteContents();range.insertNode(fragment);
    range.setStartAfter(last);range.collapse(true);sel.removeAllRanges();sel.addRange(range);
    body.dispatchEvent(new doc.defaultView.InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:text}));
  }
  function bind(body){
    if(bound.has(body))return;bound.add(body);body.setAttribute('data-atalho-pronto-cke-bound','');
    const doc = body.ownerDocument, win = doc.defaultView;
    let pending, retry, lastAttempt = 0, lastSelection = null;
    function attempt() {
      if (busy.has(body) || !body.isConnected || !doc.hasFocus()) return;
      const sel = doc.getSelection();
      if (!sel?.isCollapsed || !sel.rangeCount || !body.contains(sel.anchorNode)) return;
      // Skip identical caret/text snapshots (including our own mutation records).
      const node = sel.anchorNode, offset = sel.anchorOffset;
      const value = node.nodeType === 3 ? node.data : (node.childNodes[offset-1]?.textContent ?? '');
      if (lastSelection?.node === node && lastSelection.offset === offset && lastSelection.value === value) return;
      lastSelection = {node,offset,value};
      busy.add(body);
      try { expand(body); } catch(e) { console.debug('Atalho Pronto: CKEditor',e.name); }
      finally {
        busy.delete(body);
        observer.takeRecords();
        const after = doc.getSelection();
        if (after?.anchorNode) {
          const n=after.anchorNode,o=after.anchorOffset;
          lastSelection={node:n,offset:o,value:n.nodeType===3?n.data:(n.childNodes[o-1]?.textContent??'')};
        }
      }
    }
    function queue() {
      clearTimeout(pending); clearTimeout(retry);
      pending=setTimeout(attempt, 0);
      // Some spelling tools reconcile the editable DOM after the native input.
      retry=setTimeout(attempt, 100);
    }
    function schedule(e) {
      if(!e.isTrusted || e.isComposing || busy.has(body))return;
      if(e.type==='keyup' && (e.ctrlKey||e.altKey||e.metaKey||!(/^[a-z0-9_-]$/i.test(e.key))))return;
      if((e.type==='input'||e.type==='beforeinput') && e.inputType && !e.inputType.startsWith('insert'))return;
      if(e.target!==body && !body.contains(e.target))return;
      lastAttempt=Date.now(); lastSelection=null; queue();
    }
    // Window capture precedes most editor/grammar-extension listeners.
    for (const target of [win,doc,body]) {
      for(const type of ['beforeinput','input','keyup']) target.addEventListener(type,schedule,true);
    }
    // Fallback for tools that replace text nodes or suppress input bubbling.
    const observer = new win.MutationObserver(records => {
      if(busy.has(body)||!doc.hasFocus()||!body.isConnected)return;
      const sel=doc.getSelection(); if(!sel?.isCollapsed||!body.contains(sel.anchorNode))return;
      const anchor=sel.anchorNode;
      if(records.some(r=>r.target===anchor || (r.type==='childList' && [...r.addedNodes].some(n=>n===anchor||n.contains(anchor))) || (r.type==='childList' && r.target===anchor))) {
        if(Date.now()-lastAttempt>500) lastSelection=null;
        queue();
      }
    });
    observer.observe(body,{subtree:true,childList:true,characterData:true});
    // Remove document/window listeners if CKEditor replaces the body.
    const lifecycle = new win.MutationObserver(()=>{
      if(body.isConnected)return;
      observer.disconnect(); lifecycle.disconnect(); clearTimeout(pending);clearTimeout(retry);
      for(const target of [win,doc,body])for(const type of ['beforeinput','input','keyup'])target.removeEventListener(type,schedule,true);
    });
    lifecycle.observe(doc,{subtree:true,childList:true});
  }
  function scan(root,depth=0){
    if(!root||depth>12)return;
    if(root.body?.matches('body.cke_editable[contenteditable=true]'))bind(root.body);
    for(const el of root.querySelectorAll('*')){
      if(el.localName==='iframe'||el.localName==='frame'){
        if(!frames.has(el)){frames.add(el);el.addEventListener('load',()=>{try{scan(el.contentDocument,depth+1);}catch{} });}
        try{scan(el.contentDocument,depth+1);}catch{}
      } else {
        let shadow;try{shadow=el.shadowRoot||chrome.dom?.openOrClosedShadowRoot(el);}catch{}
        if(shadow)scan(shadow,depth+1);
      }
    }
  }
  // Limit recurring discovery to Salesforce and CKEditor documents; ordinary pages retain the original engine.
  const sf=/(^|\.)(salesforce\.com|force\.com|salesforce-sites\.com)$/i.test(location.hostname);
  function discover(){try{scan(document);}catch{}}
  if(sf){discover();setInterval(discover,1000);document.addEventListener('focusin',discover,true);}
  else {const own=()=>{if(document.body?.matches('body.cke_editable[contenteditable=true]'))bind(document.body);};own();document.addEventListener('DOMContentLoaded',own);setInterval(own,1000);}
})();
