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
  bodyField.value = snippet?.body ?? "";
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
  const body = bodyField.value;
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
  const next = [...others, { name, body }].sort((a, b) => a.name.localeCompare(b.name));
  commit(next, "Atalho /" + name + " salvo.", true);
});

cancel.onclick = () => {
  if (!busy) selectSnippet();
};

for (const button of document.querySelectorAll("[data-token]")) {
  button.onclick = () => {
    bodyField.setRangeText(button.dataset.token, bodyField.selectionStart, bodyField.selectionEnd, "end");
    bodyField.focus();
  };
}

chrome.storage.local.get({ [snippetKey]: defaultSnippets }).then(result => {
  snippets = result[snippetKey];
  render();
  save.disabled = false;
}).catch(() => notify("Falha ao carregar os atalhos.", true));
