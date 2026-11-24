(() => {
  let snippets = new Map();
  let storageChanged = false;
  let inserting = false;
  let pendingEditorInput;

  function load(entries) {
    snippets = new Map(entries.map(({ name, body }) => [name, body]));
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
    return body === undefined ? null : { length: match[1].length + 1, text: fillTemplate(body) };
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
    if (!editor.isConnected) return;
    const root = editor.getRootNode();
    const selection = root.getSelection?.() ?? document.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount) return;
    const caret = selection.getRangeAt(0);
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
    if (editor.matches('[data-lexical-editor="true"]')) {
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
    if (!document.execCommand("insertText", false, match.text)) {
      selection.removeAllRanges();
      selection.addRange(caret);
    }
  }

  function isTypedInput(event) {
    return !inserting && event.isTrusted && !event.isComposing &&
      ["insertText", "insertCompositionText"].includes(event.inputType) &&
      /[a-z0-9_-]$/i.test(event.data ?? "");
  }

  document.addEventListener("input", event => {
    if (!isTypedInput(event)) return;
    const origin = event.composedPath()[0];
    if (!(origin instanceof HTMLElement)) return;
    const editor = origin.isContentEditable ? origin :
      document.designMode === "on" ? document.body : null;
    if (!editor) return;

    // Rich editors can stop bubbling and reconcile their own DOM on input.
    clearTimeout(pendingEditorInput);
    pendingEditorInput = setTimeout(() => {
      if (document.designMode !== "on" && editor.getRootNode().activeElement !== editor) return;
      inserting = true;
      try {
        insertIntoEditor(editor);
      } finally {
        inserting = false;
      }
    }, 0);
  }, { capture: true });

  document.addEventListener("input", event => {
    if (!isTypedInput(event)) return;
    const origin = event.composedPath()[0];
    inserting = true;
    try {
      if (origin instanceof HTMLTextAreaElement ||
          (origin instanceof HTMLInputElement && ["text", "search", "tel", "url"].includes(origin.type))) {
        insertIntoField(origin);
      }
    } finally {
      inserting = false;
    }
  }, { capture: true });
})();
