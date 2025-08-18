const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// 安全配置
const SECURITY_CONFIG = {
  // 允许的文件扩展名
  ALLOWED_EXTENSIONS: ['.riv'],
  // 允许的根目录（从环境变量或默认路径获取）
  ALLOWED_ROOTS: [
    path.resolve(__dirname, 'assets'),
    process.env.PET_RIV_PATH ? path.dirname(path.resolve(process.env.PET_RIV_PATH)) : null
  ].filter(Boolean)
};

function resolveInputPath(filePath) {
  if (!filePath) return '';
  try {
    if (path.isAbsolute(filePath)) return path.normalize(filePath);
    return path.resolve(__dirname, filePath);
  } catch (_) {
    return '';
  }
}

/**
 * 路径安全检查
 * @param {string} filePath - 要检查的文件路径
 * @returns {boolean} - 路径是否安全
 */
function isPathSafe(filePath) {
  try {
    // 标准化路径（相对 preload 所在目录）
    const resolvedPath = resolveInputPath(filePath);
    
    // 检查文件扩展名
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!SECURITY_CONFIG.ALLOWED_EXTENSIONS.includes(ext)) {
      console.warn(`不允许的文件扩展名: ${ext}`);
      return false;
    }
    
    // 检查是否在允许的根目录内
    const isInAllowedRoot = SECURITY_CONFIG.ALLOWED_ROOTS.some(root => {
      const relativePath = path.relative(root, resolvedPath);
      return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
    });
    
    if (!isInAllowedRoot) {
      console.warn(`文件不在允许的目录内: ${resolvedPath}`);
      return false;
    }
    
    // 检查文件是否存在且不是软链接
    const stats = fs.lstatSync(resolvedPath);
    if (stats.isSymbolicLink()) {
      console.warn(`拒绝软链接文件: ${resolvedPath}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`路径安全检查失败: ${error.message}`);
    return false;
  }
}

/**
 * 安全的文件读取函数
 * @param {string} filePath - 文件路径
 * @returns {Promise<ArrayBuffer>} - 文件内容的 ArrayBuffer
 */
async function readFileBuffer(filePath) {
  return new Promise((resolve, reject) => {
    try {
      // 安全检查
      if (!isPathSafe(filePath)) {
        reject(new Error('文件路径不安全或不被允许'));
        return;
      }
      
      const resolvedPath = resolveInputPath(filePath);
      
      // 读取文件
      fs.readFile(resolvedPath, (err, data) => {
        if (err) {
          console.error(`文件读取失败: ${err.message}`);
          reject(new Error(`文件读取失败: ${err.message}`));
          return;
        }
        
        // 转换为 Uint8Array（避免某些环境下 ArrayBuffer 结构化克隆为空的问题）
        try {
          const bytes = new Uint8Array(data);
          resolve(bytes);
        } catch (e) {
          try {
            const arrayBuffer = data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength
            );
            resolve(new Uint8Array(arrayBuffer));
          } catch (e2) {
            reject(new Error('无法转换文件为二进制数组'));
          }
        }
      });
    } catch (error) {
      console.error(`readFileBuffer 错误: ${error.message}`);
      reject(error);
    }
  });
}

/**
 * 窗口移动函数
 * @param {number} deltaX - X 轴移动距离
 * @param {number} deltaY - Y 轴移动距离
 * @returns {Promise<{success: boolean}>} - 移动结果
 */
async function moveWindow(deltaX, deltaY) {
  try {
    const result = await ipcRenderer.invoke('win:moveBy', deltaX, deltaY);
    return result;
  } catch (error) {
    console.error(`窗口移动失败: ${error.message}`);
    return { success: false };
  }
}

// 向渲染进程暴露安全的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 文件读取 API
  readFileBuffer,
  
  // 窗口移动 API
  moveWindow,
  moveTo: (screenX, screenY) => ipcRenderer.send('win:moveTo', { screenX, screenY }),
  getBounds: () => ipcRenderer.invoke('win:getBounds'),
  
  // 获取环境变量（只暴露需要的）
  getEnvVar: (key) => {
    const allowedKeys = ['PET_RIV_PATH'];
    if (allowedKeys.includes(key)) {
      return process.env[key];
    }
    return undefined;
  },
  
  // 获取应用路径
  getAppPath: () => __dirname
});

// Chat safe bridge
contextBridge.exposeInMainWorld('chatAPI', {
  openPopover: () => ipcRenderer.invoke('chat:openPopover'),
  send: (text) => ipcRenderer.invoke('chat:send', text),
  getGreeting: () => ipcRenderer.invoke('chat:getGreeting'),
  onDelta: (handler) => {
    const listener = (_, payload) => handler(payload);
    ipcRenderer.on('chat:delta', listener);
    return () => ipcRenderer.removeListener('chat:delta', listener);
  },
});

// Pet actions from main
contextBridge.exposeInMainWorld('petAPI', {
  onActions: (handler) => {
    const listener = (_, payload) => handler(payload);
    ipcRenderer.on('pet:actions', listener);
    return () => ipcRenderer.removeListener('pet:actions', listener);
  }
});