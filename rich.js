// Allow only inert formatting. Parse in a template; never mount untrusted markup.
function cleanRich(html, doc = document) {
  const src = doc.createElement('template'); src.innerHTML = String(html || '');
  const out = doc.createElement('template');
  const allowed = new Set('B STRONG I EM U S STRIKE DEL BR P DIV SPAN OL UL LI BLOCKQUOTE PRE CODE A H1 H2 H3 H4 H5 H6 SUB SUP FONT TABLE TBODY THEAD TR TD TH'.split(' '));
  const discard = new Set('SCRIPT STYLE IFRAME OBJECT EMBED SVG MATH IMG VIDEO AUDIO LINK META INPUT BUTTON TEXTAREA FORM TEMPLATE'.split(' '));
  const props = ['color','background-color','font-weight','font-style','font-size','font-family','text-decoration','text-decoration-line','text-align','white-space','list-style-type','vertical-align','margin-left','padding-left'];
  function copy(node, dest) {
    if(node.nodeType===3){dest.append(doc.createTextNode(node.data));return;}
    if(node.nodeType!==1 || discard.has(node.tagName) || node.namespaceURI!=='http://www.w3.org/1999/xhtml')return;
    let target=dest;
    if(allowed.has(node.tagName)){
      target=doc.createElement(node.tagName.toLowerCase());
      for(const p of props){const v=node.style.getPropertyValue(p);if(v && !/url\s*\(|expression\s*\(|var\s*\(|\\/i.test(v))target.style.setProperty(p,v);}
      if(node.tagName==='A'){const href=node.getAttribute('href')||'';if(/^(https?:\/\/|mailto:|tel:)/i.test(href.trim()))target.setAttribute('href',href.trim());}
      for(const a of ['start','value','colspan','rowspan']){const v=node.getAttribute(a);if(v && /^\d{1,5}$/.test(v))target.setAttribute(a,v);}
      if(node.tagName==='FONT')for(const a of ['color','face','size']){const v=node.getAttribute(a);if(v && /^[\w\s#,.%-]{1,100}$/.test(v))target.setAttribute(a,v);}
      dest.append(target);
    }
    for(const c of node.childNodes)copy(c,target);
  }
  for(const n of src.content.childNodes)copy(n,out.content);
  return out.innerHTML;
}
function plainRich(text, doc=document){const t=doc.createElement('div');String(text||'').split(/\r\n|\r|\n/).forEach((line,i)=>{if(i)t.append(doc.createElement('br'));t.append(doc.createTextNode(line));});return t.innerHTML;}
function expandedRich(entry, doc=document){if(typeof entry.html!=='string')return null;const t=doc.createElement('template');t.innerHTML=cleanRich(entry.html,doc);const walker=doc.createTreeWalker(t.content,4);const now=new Date();while(walker.nextNode())walker.currentNode.data=fillTemplate(walker.currentNode.data,now);return t.innerHTML;}
function richPlain(root){let result='';function newline(){if(result&&!result.endsWith('\n'))result+='\n';}function visit(n){if(n.nodeType===3){result+=n.data;return;}if(n.nodeType!==1)return;const tag=n.tagName;if(tag==='BR'){result+='\n';return;}const block=/^(P|DIV|LI|OL|UL|BLOCKQUOTE|PRE|H[1-6]|TR)$/.test(tag);if(block)newline();if(tag==='LI'){const p=n.parentElement;if(p?.tagName==='OL'){const items=[...p.children].filter(x=>x.tagName==='LI');result+=(Number(p.getAttribute('start')||1)+items.indexOf(n))+'. ';}else result+='• ';}for(const c of n.childNodes)visit(c);if(block)newline();}for(const n of root.childNodes)visit(n);return result.replace(/\n+$/,'');}
