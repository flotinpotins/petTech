const { contextBridge, ipcRenderer } = require('electron');

// 安全配置
const SECURITY_CONFIG = {
  // 允许的文件扩展名
  ALLOWED_EXTENSIONS: ['.riv'],
  // 允许的根目录名称（用于基本检查）
  ALLOWED_DIRS: ['assets']
};

/**
 * 基本路径安全检查
 * @param {string} filePath - 要检查的文件路径
 * @returns {boolean} - 路径是否安全
 */
function isPathSafe(filePath) {
  try {
    // 基本安全检查
    if (!filePath || typeof filePath !== 'string') {
      return false;
    }
    
    // 检查是否包含危险字符
    if (filePath.includes('..') || filePath.includes('~')) {
      console.warn(`路径包含危险字符: ${filePath}`);
      return false;
    }
    
    // 检查文件扩展名
    const ext = filePath.toLowerCase().split('.').pop();
    if (!SECURITY_CONFIG.ALLOWED_EXTENSIONS.includes('.' + ext)) {
      console.warn(`不允许的文件扩展名: .${ext}`);
      return false;
    }
    
    // 检查是否在允许的目录内
    const hasAllowedDir = SECURITY_CONFIG.ALLOWED_DIRS.some(dir => 
      filePath.includes(dir)
    );
    
    if (!hasAllowedDir) {
      console.warn(`文件不在允许的目录内: ${filePath}`);
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
 * @returns {Promise<ArrayBuffer|null>} - 文件内容的 ArrayBuffer 或 null
 */
async function readFileBuffer(filePath) {
  try {
    // 路径安全检查
    if (!isPathSafe(filePath)) {
      throw new Error('文件路径不安全或不被允许');
    }
    
    console.log(`尝试读取文件: ${filePath}`);
    
    // 通过IPC请求主进程读取文件
    const result = await ipcRenderer.invoke('file:readBuffer', filePath);
    
    if (result.success && result.buffer) {
      console.log(`文件读取成功: ${filePath}, 大小: ${result.buffer.byteLength} 字节`);
      return result.buffer;
    } else {
      throw new Error(result.error || '文件读取失败');
    }
    
  } catch (error) {
    console.error(`文件读取失败: ${filePath}`, error);
    return null;
  }
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

/**
 * 设置窗口点击穿透
 * @param {boolean} ignore - 是否忽略鼠标事件
 * @param {Object} options - 选项配置
 * @returns {Promise<{success: boolean}>} - 操作结果
 */
async function setIgnoreMouseEvents(ignore, options = {}) {
  try {
    return await ipcRenderer.invoke('win:setIgnoreMouseEvents', ignore, options);
  } catch (error) {
    console.error('设置点击穿透失败:', error);
    return { success: false };
  }
}

// 向渲染进程暴露安全的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 文件读取 API
  readFileBuffer,
  
  // 窗口移动 API
  moveWindow,
  
  // 设置点击穿透
  setIgnoreMouseEvents,
  
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