const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();

let mainWindow;

// 窗口配置
const WINDOW_CONFIG = {
  width: 360,
  height: 360,
  transparent: true,
  alwaysOnTop: true,
  frame: false,
  resizable: false,
  skipTaskbar: true,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    preload: path.join(__dirname, 'preload.js')
  }
};

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow(WINDOW_CONFIG);

  // 加载应用的 index.html
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 开发模式下打开开发者工具
  if (process.env.DEV_MODE === 'true') {
    mainWindow.webContents.openDevTools();
  }

  // 窗口关闭时的处理
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 防止窗口被最小化
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
  });
}

// 当 Electron 完成初始化并准备创建浏览器窗口时调用此方法
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // 在 macOS 上，当点击 dock 图标并且没有其他窗口打开时，
    // 通常在应用程序中重新创建一个窗口。
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 当所有窗口都被关闭时退出应用
app.on('window-all-closed', () => {
  // 在 macOS 上，除非用户用 Cmd + Q 确定地退出，
  // 否则绝大部分应用及其菜单栏会保持激活。
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC 处理器：窗口移动
ipcMain.handle('win:moveBy', async (event, deltaX, deltaY) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [currentX, currentY] = mainWindow.getPosition();
      mainWindow.setPosition(currentX + deltaX, currentY + deltaY);
      return { success: true };
    }
    return { success: false };
  } catch (error) {
    console.error('窗口移动失败:', error);
    return { success: false };
  }
});

// 在此文件中，你可以包含应用程序剩余的所有主进程代码。
// 也可以拆分成几个文件，然后用 require 导入。