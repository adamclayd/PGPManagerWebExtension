(() => {
    chrome.runtime.onInstalled.addListener(async ({reason}) => {
        if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
            let sync = await chrome.storage.sync.get();
            chrome.storage.local.set(sync);
        }
    });

})();