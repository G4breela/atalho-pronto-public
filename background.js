const pageUrl = chrome.runtime.getURL("atalhos.html");
let openingPage = false;

chrome.action.onClicked.addListener(async () => {
  if (openingPage) return;
  openingPage = true;

  try {
    const [page] = await chrome.runtime.getContexts({
      contextTypes: ["TAB"],
      documentUrls: [pageUrl]
    });

    if (page) {
      try {
        await chrome.tabs.update(page.tabId, { active: true });
        await chrome.windows.update(page.windowId, { focused: true });
        return;
      } catch {
        // A aba pode ter sido fechada entre a consulta e a ativação.
      }
    }

    await chrome.tabs.create({ url: pageUrl, active: true });
  } catch (error) {
    console.error("Falha ao abrir a página de atalhos.", error);
  } finally {
    openingPage = false;
  }
});
