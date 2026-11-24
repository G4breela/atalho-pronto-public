const form = document.querySelector("#editor");
const nameField = document.querySelector("#name");
const bodyField = document.querySelector("#body");
const title = document.querySelector("#form-title");
const cancel = document.querySelector("#cancel");
const save = document.querySelector("#save");
const status = document.querySelector("#status");
const list = document.querySelector("#snippets");
let snippets = [];
let editing = null;
let busy = false;

function notify(message, error = false) {
  status.textContent = message;
  status.toggleAttribute("data-error", error);
}

function selectSnippet(snippet = null) {
  editing = snippet?.name ?? null;
  nameField.value = snippet?.name ?? "";
  bodyField.innerHTML = typeof snippet?.html === "string" ? cleanRich(snippet.html) : plainRich(snippet?.body ?? "");
  title.textContent = snippet ? "Editar atalho" : "Novo atalho";
  cancel.hidden = !snippet;
  if (snippet) nameField.focus();
}

function render() {
  list.replaceChildren();
  if (!snippets.length) {
    const item = document.createElement("li");
    item.textContent = "Nenhum atalho cadastrado.";
    list.append(item);
  }
  for (const snippet of snippets) {
    const item = document.createElement("li");
    const description = document.createElement("div");
    description.className = "snippet";
    const command = document.createElement("code");
    command.textContent = "/" + snippet.name;
    const preview = document.createElement("p");
    preview.textContent = snippet.body;
    description.append(command, preview);
    const edit = document.createElement("button");
    edit.textContent = "Editar";
    edit.setAttribute("aria-label", "Editar /" + snippet.name);
    edit.onclick = () => {
      if (!busy) selectSnippet(snippet);
    };
    const remove = document.createElement("button");
    remove.textContent = "Excluir";
    remove.setAttribute("aria-label", "Excluir /" + snippet.name);
    remove.onclick = () => {
      if (busy || !window.confirm("Excluir /" + snippet.name + "?")) return;
      commit(snippets.filter(entry => entry.name !== snippet.name), "Atalho excluído.", editing === snippet.name);
    };
    item.append(description, edit, remove);
    list.append(item);
  }
}

async function commit(next, message, reset) {
  busy = true;
  save.disabled = true;
  try {
    await chrome.storage.local.set({ [snippetKey]: next });
    snippets = next;
    if (reset) selectSnippet();
    render();
    notify(message);
  } catch {
    notify("Falha ao salvar. Tente novamente.", true);
  } finally {
    busy = false;
    save.disabled = false;
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  if (busy) return;
  const name = nameField.value.trim().toLowerCase().replace(/^\//, "");
  const html = cleanRich(bodyField.innerHTML);
  const temp = document.createElement("template"); temp.innerHTML = html;
  const body = richPlain(temp.content);
  if (!namePattern.test(name)) {
    notify("Use de 1 a 40 letras sem acento, números, hífen ou sublinhado.", true);
    return;
  }
  if (!body.trim()) {
    notify("Digite o texto da expansão.", true);
    return;
  }
  const others = snippets.filter(entry => entry.name !== editing);
  const conflict = others.find(entry => entry.name.startsWith(name) || name.startsWith(entry.name));
  if (conflict) {
    notify("Escolha um nome diferente. /" + conflict.name + " coincide com este atalho ou com seu início.", true);
    return;
  }
  const next = [...others, { name, body, html }].sort((a, b) => a.name.localeCompare(b.name));
  commit(next, "Atalho /" + name + " salvo.", true);
});

cancel.onclick = () => {
  if (!busy) selectSnippet();
};

for (const button of document.querySelectorAll("[data-token]")) {
  button.onclick = () => {
    restoreEditorSelection();
    document.execCommand("insertText", false, button.dataset.token);
  };
}

chrome.storage.local.get({ [snippetKey]: defaultSnippets }).then(result => {
  snippets = result[snippetKey];
  render();
  save.disabled = false;
}).catch(() => notify("Falha ao carregar os atalhos.", true));

let savedRange = null;
function rememberSelection(){const s=document.getSelection();if(s?.rangeCount && bodyField.contains(s.anchorNode) && bodyField.contains(s.focusNode))savedRange=s.getRangeAt(0).cloneRange();}
document.addEventListener('selectionchange',rememberSelection);
function restoreEditorSelection(){bodyField.focus();const s=document.getSelection();if(savedRange && bodyField.contains(savedRange.startContainer) && bodyField.contains(savedRange.endContainer)){s.removeAllRanges();s.addRange(savedRange);}else{const r=document.createRange();r.selectNodeContents(bodyField);r.collapse(false);s.removeAllRanges();s.addRange(r);}}
for(const b of document.querySelectorAll('[data-format], [data-token]'))b.addEventListener('mousedown',e=>e.preventDefault());
for(const b of document.querySelectorAll('[data-format]'))b.addEventListener('click',()=>{let value=null;if(b.dataset.format==='createLink'){value=prompt('URL do link (https://, mailto: ou tel:)');if(!value || !/^(https?:\/\/|mailto:|tel:)/i.test(value.trim()))return;}restoreEditorSelection();document.execCommand(b.dataset.format,false,value);rememberSelection();});
// Remove only clipboard padding at the edges; keep internal paragraphs and formatting.
function cleanClipboardHtml(html) {
  const t = document.createElement('template');
  t.innerHTML = cleanRich(html);
  const blank = /^[\s\u00a0\u200b\ufeff]*$/;
  const containers = /^(DIV|P|SPAN|B|STRONG|I|EM|U|S|STRIKE|DEL|FONT|A|BLOCKQUOTE|CODE|SUB|SUP|H[1-6])$/;
  function trimEdge(parent, first) {
    while (parent.childNodes.length) {
      const node = first ? parent.firstChild : parent.lastChild;
      if (node.nodeType === Node.TEXT_NODE) {
        if (blank.test(node.data)) { node.remove(); continue; }
        // Remove boundary newline padding, but retain ordinary inline spaces.
        node.data = first ? node.data.replace(/^(?:[^\S\r\n]*[\r\n])+[^\S\r\n]*/, '')
                          : node.data.replace(/(?:[\r\n][^\S\r\n]*)+$/, '');
        break;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); continue; }
      if (node.tagName === 'BR') { node.remove(); continue; }
      if (!containers.test(node.tagName)) break; // preserve lists, tables and preformatted blocks
      trimEdge(node, first);
      if (!node.hasChildNodes()) { node.remove(); continue; }
      break;
    }
  }
  trimEdge(t.content, true);
  trimEdge(t.content, false);
  return t.innerHTML;
}
function cleanClipboardText(text) {
  return text.replace(/^(?:[^\S\r\n]*\r?\n)+/, '').replace(/(?:\r?\n[^\S\r\n]*)+$/, '');
}
bodyField.addEventListener('paste', e => {
  e.preventDefault();
  const html = e.clipboardData.getData('text/html');
  const safe = html ? cleanClipboardHtml(html) : '';
  if (safe) document.execCommand('insertHTML', false, safe);
  else document.execCommand('insertText', false, cleanClipboardText(e.clipboardData.getData('text/plain')));
});
bodyField.addEventListener('drop',e=>e.preventDefault());
