(() => {
  let snippets = new Map();
  let storageChanged = false;
  let inserting = false;
  let pendingEditorInput;
  const observedRoots = new WeakSet();
  const seenEvents = new WeakSet();

  function shadowOf(element) {
    try { return element.shadowRoot || chrome.dom?.openOrClosedShadowRoot(element); }
    catch { return element.shadowRoot; }
  }

  function focusedElement(root = document) {
    let element = root.activeElement;
    while (element) {
      const shadow = shadowOf(element);
      if (!shadow) break;
      observeRoot(shadow);
      if (!shadow.activeElement) break;
      element = shadow.activeElement;
    }
    return element;
  }

  function editableHost(element) {
    if (!(element instanceof HTMLElement)) return null;
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element;
    if (!element.isContentEditable) return null;
    while (element.parentElement?.isContentEditable) element = element.parentElement;
    return element;
  }

  function targetOf(event) {
    const active = focusedElement();
    return event.composedPath().map(editableHost).find(Boolean) || editableHost(active) ||
      (document.designMode === "on" ? document.body : null);
  }

  function observeRoot(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    root.addEventListener("input", onInput, true);
    root.addEventListener("keyup", onKeyUp, true);
    root.addEventListener("beforeinput", onBeforeInput, true);
  }


  function load(entries) {
    snippets = new Map(entries.map(entry => [entry.name, entry]));
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[snippetKey]) {
      storageChanged = true;
      load(changes[snippetKey].newValue ?? defaultSnippets);
    }
  });

  chrome.storage.local.get({ [snippetKey]: defaultSnippets }).then(result => {
    if (!storageChanged) load(result[snippetKey]);
  });

  function findMatch(text) {
    const match = suffixPattern.exec(text);
    if (!match) return null;
    const body = snippets.get(match[1].toLowerCase());
    return body === undefined ? null : { length: match[1].length + 1, text: fillTemplate(body.body), html: expandedRich(body) };
  }

  function insertIntoField(field) {
    if (field.readOnly || field.disabled) return;
    const end = field.selectionEnd;
    if (end === null || end !== field.selectionStart) return;
    const match = findMatch(field.value.slice(Math.max(0, end - 42), end));
    if (!match) return;

    const start = end - match.length;
    const text = field instanceof HTMLInputElement ? match.text.replace(/\r?\n/g, " ") : match.text;
    if (field.maxLength >= 0 && field.value.length - match.length + text.length > field.maxLength) return;
    field.setSelectionRange(start, end);
    if (document.execCommand("insertText", false, text)) return;

    field.setRangeText(text, start, end, "end");
    field.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
  }

  function insertIntoEditor(editor) {
    if (!editor.isConnected || editor.matches("body.cke_editable, body[data-atalho-pronto-mce-bound]")) return;
    const root = editor.getRootNode();
    const selection = root.getSelection?.() ?? document.getSelection();
    if (!selection) return;
    let caret;
    // Chrome may retarget getRangeAt() to the shadow host, rather than the actual caret.
    const shadowRoots = [];
    for (let r = root; r instanceof ShadowRoot; r = r.host.getRootNode()) shadowRoots.push(r);
    try {
      const composed = document.getSelection()?.getComposedRanges?.({ shadowRoots })?.[0];
      if (composed && composed.collapsed && editor.contains(composed.startContainer)) {
        caret = document.createRange();
        caret.setStart(composed.startContainer, composed.startOffset);
        caret.collapse(true);
      }
    } catch { /* fall back to root selection */ }
    if (!caret && selection.rangeCount && selection.isCollapsed) caret = selection.getRangeAt(0).cloneRange();
    if (!caret && selection.anchorNode && selection.isCollapsed && editor.contains(selection.anchorNode)) {
      caret = document.createRange();
      caret.setStart(selection.anchorNode, selection.anchorOffset);
      caret.collapse(true);
    }
    if (!caret) return;
    let node = caret.startContainer;
    let offset = caret.startOffset;
    if (!editor.contains(node)) return;
    // A rich editor can leave the caret at an element boundary after rendering.
    while (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
      node = node.childNodes[offset - 1];
      if (node.nodeType === Node.ELEMENT_NODE && node.matches("br, [contenteditable=false]")) return;
      offset = node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length;
    }
    if (node.nodeType !== Node.TEXT_NODE || !node.parentElement.isContentEditable) return;

    // Read across adjacent inline formatting while respecting line boundaries.
    let block = node.parentElement;
    while (block !== editor && getComputedStyle(block).display.startsWith("inline")) {
      block = block.parentElement;
    }
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    walker.currentNode = node;
    let prefix = node.data.slice(Math.max(0, offset - 42), offset);
    const segments = [{ node, length: prefix.length, end: offset }];
    let previous;
    while (prefix.length < 42 && (previous = walker.previousNode())) {
      const gap = document.createRange();
      const first = segments[0].node;
      gap.setStart(previous, previous.length);
      gap.setEnd(first, 0);
      if (!previous.parentElement.isContentEditable ||
          gap.cloneContents().querySelector("br, div, p, li, [contenteditable=false]")) break;
      const text = previous.data.slice(-(42 - prefix.length));
      prefix = text + prefix;
      segments.unshift({ node: previous, length: text.length, end: previous.length });
    }
    const match = findMatch(prefix);
    if (!match) return;

    const replacement = caret.cloneRange();
    replacement.setEnd(node, offset);
    let remaining = match.length;
    for (const segment of segments.reverse()) {
      if (remaining <= segment.length) {
        replacement.setStart(segment.node, segment.end - remaining);
        break;
      }
      remaining -= segment.length;
    }
    selection.removeAllRanges();
    selection.addRange(replacement);
    // Explicit base/extent helps Chromium keep the selection inside a shadow tree.
    try { selection.setBaseAndExtent(replacement.startContainer, replacement.startOffset,
      replacement.endContainer, replacement.endOffset); } catch { /* range already selected */ }
    if (match.html === null && editor.matches('[data-lexical-editor="true"]')) {
      // Synchronize Lexical's selection before sending the replacement. The
      // browser queues its own selectionchange for a later task.
      root.dispatchEvent(new Event("selectionchange"));
      // Give Lexical both the replacement text and its range so it can update
      // its document model. The data transfer does not touch the clipboard.
      const data = new DataTransfer();
      data.setData("text/plain", match.text);
      const input = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: "insertText",
        dataTransfer: data,
        targetRanges: [new StaticRange({
          startContainer: replacement.startContainer,
          startOffset: replacement.startOffset,
          endContainer: replacement.endContainer,
          endOffset: replacement.endOffset
        })]
      });
      if (!editor.dispatchEvent(input)) return;
    }
    const previousText = editor.textContent;
    if (document.execCommand(match.html !== null && editor.getAttribute("contenteditable") !== "plaintext-only" ? "insertHTML" : "insertText", false, match.html !== null && editor.getAttribute("contenteditable") !== "plaintext-only" ? match.html : match.text)) return;
    if (editor.textContent !== previousText) return;
    // Editors such as Quill and CKEditor may handle a paste via their own model.
    // No system clipboard access: this is an in-memory ClipboardEvent.
    const transfer = new DataTransfer();
    transfer.setData("text/plain", match.text);
    if (match.html !== null && editor.getAttribute("contenteditable") !== "plaintext-only") transfer.setData("text/html", match.html);
    const accepted = !editor.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true, cancelable: true, composed: true, clipboardData: transfer
    }));
    if (accepted || editor.textContent !== previousText) return;
    // Last resort for standard contenteditable: replace only the matched range.
    if (!replacement.startContainer.isConnected || !replacement.endContainer.isConnected ||
        replacement.toString().toLowerCase() !== prefix.slice(-match.length).toLowerCase()) return;
    const fragment = document.createDocumentFragment();
    const lines = match.text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (i) fragment.append(document.createElement("br"));
      fragment.append(document.createTextNode(line));
    });
    if (match.html !== null && editor.getAttribute("contenteditable") !== "plaintext-only") { const t = document.createElement("template"); t.innerHTML = match.html; fragment.replaceChildren(t.content); }
    const last = fragment.lastChild;
    if (!last) return;
    replacement.deleteContents();
    replacement.insertNode(fragment);
    const end = document.createRange();
    end.setStartAfter(last);
    end.collapse(true);
    selection.removeAllRanges();
    selection.addRange(end);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true,
      inputType: "insertText", data: match.text }));
  }

  function run(target) {
    if (!target?.isConnected || inserting) return;
    const active = focusedElement();
    if (document.designMode !== "on" && editableHost(active) !== target && !target.contains(active) && !target.matches(":focus-within")) return;
    inserting = true;
    try {
      if (target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLInputElement && ["text", "search", "tel", "url"].includes(target.type))) {
        insertIntoField(target);
      } else if (target.isContentEditable || document.designMode === "on") {
        insertIntoEditor(target);
      }
    } catch (error) {
      console.debug("Atalho Pronto: editor incompatível", error.name);
    } finally { inserting = false; }
  }

  function schedule(target) {
    if (!target) return;
    clearTimeout(pendingEditorInput);
    pendingEditorInput = setTimeout(() => run(target), 0);
  }

  function onBeforeInput(event) {
    if (inserting || !event.isTrusted || event.isComposing) return;
    if (event.inputType === "insertText" && /[a-z0-9_-]$/i.test(event.data ?? "")) {
      const target = targetOf(event);
      if (target?.isContentEditable || document.designMode === "on") schedule(target);
    }
  }

  function onInput(event) {
    if (seenEvents.has(event) || inserting || !event.isTrusted || event.isComposing) return;
    seenEvents.add(event);
    if (!["insertText", "insertCompositionText", ""].includes(event.inputType || "")) return;
    if (event.data != null && !/[a-z0-9_-]$/i.test(event.data)) return;
    const target = targetOf(event);
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) run(target);
    else schedule(target);
  }

  function onKeyUp(event) {
    if (seenEvents.has(event) || inserting || !event.isTrusted || event.isComposing ||
        event.ctrlKey || event.metaKey || event.altKey || !/^[a-z0-9_-]$/i.test(event.key)) return;
    seenEvents.add(event);
    // Only inspect actual text at the caret, never a global keystroke buffer.
    schedule(targetOf(event));
  }

  observeRoot(document);
  document.addEventListener("focusin", () => focusedElement(), true);
  document.addEventListener("keydown", () => focusedElement(), true);
})();
