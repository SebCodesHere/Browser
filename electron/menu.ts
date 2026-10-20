import { app, Menu, type MenuItemConstructorOptions } from "electron";

export interface MenuActions {
  newTab: () => void;
  newPrivateTab: () => void;
  closeTab: () => void;
  reopenClosedTab: () => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  forceReload: () => void;
  stop: () => void;
  home: () => void;
  focusAddress: () => void;
  find: () => void;
  toggleDevTools: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  toggleFullscreen: () => void;
  openSettings: () => void;
  openHistory: () => void;
  openBookmarks: () => void;
  openDownloads: () => void;
  bookmarkPage: () => void;
  clearBrowsingData: () => void;
  openDataDirectory: () => void;
  showAbout: () => void;
  quit: () => void;
}

export function buildAppMenu(actions: MenuActions, devMode: boolean): Menu {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { label: "About Xuvon Browser", click: actions.showAbout },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "Command+,",
          click: actions.openSettings
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { label: "Quit Xuvon", accelerator: "Command+Q", click: actions.quit }
      ]
    });
  }

  template.push({
    label: "File",
    submenu: [
      {
        label: "New Tab",
        accelerator: "CmdOrCtrl+T",
        click: actions.newTab
      },
      {
        label: "New Private Tab",
        accelerator: "CmdOrCtrl+Shift+N",
        click: actions.newPrivateTab
      },
      {
        label: "Reopen Closed Tab",
        accelerator: "CmdOrCtrl+Shift+T",
        click: actions.reopenClosedTab
      },
      { type: "separator" },
      {
        label: "Close Tab",
        accelerator: "CmdOrCtrl+W",
        click: actions.closeTab
      },
      { type: "separator" },
      {
        label: "Open Downloads",
        accelerator: "CmdOrCtrl+J",
        click: actions.openDownloads
      },
      {
        label: "Clear Browsing Data…",
        accelerator: "CmdOrCtrl+Shift+Delete",
        click: actions.clearBrowsingData
      },
      { type: "separator" },
      ...(isMac
        ? ([{ role: "close" }] as MenuItemConstructorOptions[])
        : ([
            {
              label: "Exit",
              accelerator: "Alt+F4",
              click: actions.quit
            }
          ] as MenuItemConstructorOptions[]))
    ]
  });

  template.push({
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
      ...(isMac
        ? ([
            { type: "separator" },
            {
              label: "Speech",
              submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }]
            }
          ] as MenuItemConstructorOptions[])
        : [])
    ]
  });

  template.push({
    label: "View",
    submenu: [
      {
        label: "Reload",
        accelerator: "CmdOrCtrl+R",
        click: actions.reload
      },
      {
        label: "Force Reload",
        accelerator: "CmdOrCtrl+Shift+R",
        click: actions.forceReload
      },
      { label: "Stop", click: actions.stop },
      { type: "separator" },
      {
        label: "Zoom In",
        accelerator: "CmdOrCtrl+Plus",
        click: actions.zoomIn
      },
      {
        label: "Zoom Out",
        accelerator: "CmdOrCtrl+-",
        click: actions.zoomOut
      },
      {
        label: "Actual Size",
        accelerator: "CmdOrCtrl+0",
        click: actions.resetZoom
      },
      { type: "separator" },
      {
        label: "Toggle Full Screen",
        accelerator: isMac ? "Ctrl+Command+F" : "F11",
        click: actions.toggleFullscreen
      },
      {
        label: "Developer Tools",
        accelerator: "Alt+CommandOrControl+I",
        enabled: devMode,
        click: actions.toggleDevTools
      }
    ]
  });

  template.push({
    label: "History",
    submenu: [
      {
        label: "Back",
        accelerator: isMac ? "Command+[" : "Alt+Left",
        click: actions.back
      },
      {
        label: "Forward",
        accelerator: isMac ? "Command+]" : "Alt+Right",
        click: actions.forward
      },
      {
        label: "Home",
        accelerator: isMac ? "Command+Shift+H" : "Alt+Home",
        click: actions.home
      },
      { type: "separator" },
      {
        label: "Show Full History",
        accelerator: "CmdOrCtrl+Y",
        click: actions.openHistory
      }
    ]
  });

  template.push({
    label: "Bookmarks",
    submenu: [
      {
        label: "Bookmark This Page",
        accelerator: "CmdOrCtrl+D",
        click: actions.bookmarkPage
      },
      {
        label: "Show All Bookmarks",
        accelerator: "CmdOrCtrl+Shift+O",
        click: actions.openBookmarks
      }
    ]
  });

  template.push({
    label: "Tools",
    submenu: [
      {
        label: "Find in Page…",
        accelerator: "CmdOrCtrl+F",
        click: actions.find
      },
      {
        label: "Focus Address Bar",
        accelerator: "CmdOrCtrl+L",
        click: actions.focusAddress
      },
      { type: "separator" },
      {
        label: "Settings",
        accelerator: isMac ? undefined : "CmdOrCtrl+,",
        click: actions.openSettings
      },
      {
        label: "Open Application Data Folder",
        click: actions.openDataDirectory
      }
    ]
  });

  template.push({
    role: "help",
    submenu: [
      {
        label: "About Xuvon Browser",
        click: actions.showAbout
      },
      {
        label: "Open Source & Licenses",
        click: actions.showAbout
      }
    ]
  });

  return Menu.buildFromTemplate(template);
}
