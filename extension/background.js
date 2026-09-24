// Opens the side panel when the toolbar button is clicked. Nothing runs in the background otherwise.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
