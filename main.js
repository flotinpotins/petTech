const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

let mainWindow;
let chatWindow;

// Chat config & memory
const CHAT_CONFIG = {
  baseUrl: process.env.CHAT_API_BASE || 'https://ai.comfly.chat',
  apiKey: process.env.CHAT_API_KEY || '',
  model: process.env.CHAT_API_MODEL || 'gpt-4o-mini',
  maxTurns: Number(process.env.CHAT_MAX_TURNS || 8),
  personaCustomFile: process.env.PERSONA_CUSTOM_FILE || '',
  personaGreetingFile: process.env.PERSONA_GREETING_FILE || ''
};

/**
 * Persistent in-memory conversation (user/assistant only)
 * Each entry: { role: 'user'|'assistant', content: string }
 */
let conversationHistory = [];

// 窗口配置
const WINDOW_CONFIG = {
  width: 360,
  height: 360,
  transparent: true,
  alwaysOnTop: true,
  frame: false,
  resizable: false,
  skipTaskbar: true,
  show: false,
  backgroundColor: '#00000000',
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    preload: path.join(__dirname, 'preload.js')
  }
};

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow(WINDOW_CONFIG);

  // 加载应用的 index.html
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 仅在显式开启时打开开发者工具
  if (process.env.OPEN_DEVTOOLS === 'true') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 就绪后再显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
    }
  });

  // 窗口关闭时的处理
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 防止窗口被最小化
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
  });
}

function getChatWindowBounds(anchorBounds) {
  const width = 440;
  const height = 560;
  const gap = 8;
  const x = Math.round(anchorBounds.x + anchorBounds.width + gap);
  const y = Math.round(anchorBounds.y); // align top
  return { x, y, width, height };
}

function ensureChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    return chatWindow;
  }
  const anchor = mainWindow ? mainWindow.getBounds() : { x: 100, y: 100, width: 360, height: 360 };
  const bounds = getChatWindowBounds(anchor);

  chatWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    skipTaskbar: false,
    show: false,
    backgroundColor: '#171717',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  chatWindow.setMenuBarVisibility(false);
  chatWindow.loadFile(path.join(__dirname, 'chat', 'index.html'));

  chatWindow.on('closed', () => {
    chatWindow = null;
  });

  chatWindow.once('ready-to-show', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.showInactive();
    }
  });

  return chatWindow;
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

// 高性能移动：目标屏幕坐标 -> DIP，合并 setBounds
let moveScheduled = false;
let pendingMove = null;

function scheduleMoveToDIP(targetDip) {
  pendingMove = targetDip;
  if (moveScheduled) return;
  moveScheduled = true;
  setImmediate(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && pendingMove) {
        const width = WINDOW_CONFIG.width;
        const height = WINDOW_CONFIG.height;
        mainWindow.setBounds({ x: pendingMove.x, y: pendingMove.y, width, height });
      }
    } catch (e) {
      console.warn('合并后的窗口定位失败:', e);
    } finally {
      moveScheduled = false;
      pendingMove = null;
    }
  });
}

ipcMain.on('win:moveTo', (event, payload) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { screenX, screenY } = payload || {};
    if (typeof screenX !== 'number' || typeof screenY !== 'number') return;
    const pt = { x: Math.round(screenX), y: Math.round(screenY) };
    const display = screen.getDisplayNearestPoint(pt) || screen.getPrimaryDisplay();
    const s = display.scaleFactor || 1;
    const xDip = Math.round(pt.x / s);
    const yDip = Math.round(pt.y / s);
    scheduleMoveToDIP({ x: xDip, y: yDip });
  } catch (e) {
    console.warn('win:moveTo 处理失败:', e);
  }
});

ipcMain.handle('win:getBounds', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return { bounds: null, scaleFactor: 1 };
    const b = mainWindow.getBounds(); // DIP
    const center = { x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) };
    const d = screen.getDisplayNearestPoint(center) || screen.getPrimaryDisplay();
    return { bounds: b, scaleFactor: d.scaleFactor || 1 };
  } catch (e) {
    return { bounds: null, scaleFactor: 1 };
  }
});

// 在此文件中，你可以包含应用程序剩余的所有主进程代码。
// 也可以拆分成几个文件，然后用 require 导入。

// ============ Chat IPC ============

ipcMain.handle('chat:openPopover', async () => {
  try {
    const win = ensureChatWindow();
    if (!win) return { success: false };
    // Re-anchor near pet window
    if (mainWindow && !mainWindow.isDestroyed()) {
      const anchor = mainWindow.getBounds();
      const b = getChatWindowBounds(anchor);
      win.setBounds(b);
    }
    win.show();
    win.focus();
    return { success: true };
  } catch (e) {
    console.error('打开聊天面板失败:', e);
    return { success: false, error: String(e) };
  }
});

ipcMain.handle('chat:getGreeting', async () => {
  try {
    const file = CHAT_CONFIG.personaGreetingFile;
    if (!file) return { greeting: '' };
    const abs = path.isAbsolute(file) ? file : path.resolve(app.getAppPath(), file);
    if (!fs.existsSync(abs)) return { greeting: '' };
    const text = fs.readFileSync(abs, 'utf8');
    return { greeting: text.trim() };
  } catch (e) {
    return { greeting: '' };
  }
});

function readPersonaSystemMessage() {
  try {
    const file = CHAT_CONFIG.personaCustomFile;
    if (!file) return '';
    const abs = path.isAbsolute(file) ? file : path.resolve(app.getAppPath(), file);
    if (!fs.existsSync(abs)) return '';
    const text = fs.readFileSync(abs, 'utf8');
    return text.trim();
  } catch (e) {
    return '';
  }
}

function buildMessagesWithMemory(userContent) {
  const systemPersona = readPersonaSystemMessage();
  const messages = [];
  const systemPrompt = '你是桌宠助手，语气亲切，中文回答。';
  messages.push({ role: 'system', content: systemPersona ? `${systemPrompt}\n\n${systemPersona}` : systemPrompt });

  const maxPairs = CHAT_CONFIG.maxTurns;
  const maxItems = Math.max(0, maxPairs * 2);
  const recent = conversationHistory.slice(-maxItems);
  recent.forEach(m => messages.push(m));

  messages.push({ role: 'user', content: userContent });
  return messages;
}

function tryExtractActionsFromText(text) {
  try {
    // naive search for { "actions": [...] }
    const match = text.match(/\{[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]);
    if (Array.isArray(obj.actions)) return obj.actions;
    return null;
  } catch (_) {
    return null;
  }
}

async function streamChatToWindow(userContent) {
  if (!chatWindow || chatWindow.isDestroyed()) return;
  const wc = chatWindow.webContents;

  if (!CHAT_CONFIG.apiKey) {
    wc.send('chat:delta', { error: '未配置 API Key，请在 .env 中设置 CHAT_API_KEY。' });
    return;
  }

  const url = `${CHAT_CONFIG.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let finalText = '';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHAT_CONFIG.apiKey}`
      },
      body: JSON.stringify({
        model: CHAT_CONFIG.model,
        stream: true,
        messages: buildMessagesWithMemory(userContent)
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text();
      wc.send('chat:delta', { error: `请求失败 (${res.status}): ${text.slice(0, 500)}` });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          wc.send('chat:delta', { done: true });
          break;
        }
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            finalText += delta;
            wc.send('chat:delta', { delta });
          }
        } catch (e) {
          // ignore bad chunk
        }
      }
    }

    // finalize
    if (finalText.trim().length === 0) {
      // non-stream fallback
      try {
        const res2 = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CHAT_CONFIG.apiKey}`
          },
          body: JSON.stringify({
            model: CHAT_CONFIG.model,
            messages: buildMessagesWithMemory(userContent)
          })
        });
        const json = await res2.json();
        const content = json.choices?.[0]?.message?.content || '';
        finalText = content;
        if (content) wc.send('chat:delta', { delta: content, done: true });
      } catch (e) {
        wc.send('chat:delta', { error: '流式失败且回退失败。' });
      }
    } else {
      wc.send('chat:delta', { done: true });
    }

    // memory append
    conversationHistory.push({ role: 'user', content: userContent });
    conversationHistory.push({ role: 'assistant', content: finalText });

    // try optional actions
    const actions = tryExtractActionsFromText(finalText);
    if (actions && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pet:actions', { actions });
    }
  } catch (e) {
    const msg = (e && e.name === 'AbortError') ? '请求超时' : `请求错误: ${String(e)}`;
    wc.send('chat:delta', { error: msg });
  } finally {
    clearTimeout(timeout);
  }
}

ipcMain.handle('chat:send', async (event, userText) => {
  try {
    await streamChatToWindow(userText);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});