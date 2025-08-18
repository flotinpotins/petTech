// 动画名称候选配置
const ANIMATION_CANDIDATES = {
    IDLE: ["Idle", "idle", "IdleLoop"],
    CLICK: ["Tap", "Click", "Wave", "TapOneShot"],
    SLEEP: ["Sleep", "sleep", "Away", "IdleSleep"]
};

// 交互配置
const INTERACTION_CONFIG = {
    CLICK_FALLBACK_MS: 800,  // 可配置的点击回退时间
    CLICK_THRESHOLD_MS: 200, // 点击判定时间阈值
    CLICK_THRESHOLD_PX: 5,   // 点击判定位移阈值
    SLEEP_GRACE_MS: 200,     // Sleep 触发宽限时间
    CANVAS_SIZE: 360,
    DPI_SCALE: window.devicePixelRatio || 1
};

// 全局变量
let riveInstance = null;
let riveFile = null;
let artboard = null;
let renderer = null;
let canvas = null;
let ctx = null;

// 动画状态管理
let currentState = 'IDLE';
let availableAnimations = {};
let clickFallbackTimer = null;

// 交互状态
let isDragging = false;
let dragStartTime = 0;
let dragStartPos = { x: 0, y: 0 };
let lastMoveTime = 0;
let sleepGraceTimer = null;
let isPointerInside = true;

// DOM 元素
let loadingOverlay = null;
let errorOverlay = null;
let errorText = null;
let retryBtn = null;

/**
 * 等待 Rive 库加载
 */
function waitForRive() {
    return new Promise((resolve, reject) => {
        if (typeof rive !== 'undefined') {
            resolve();
            return;
        }
        
        let attempts = 0;
        const maxAttempts = 50; // 5秒超时
        
        const checkRive = () => {
            attempts++;
            if (typeof rive !== 'undefined') {
                resolve();
            } else if (attempts >= maxAttempts) {
                reject(new Error('Rive 库加载超时'));
            } else {
                setTimeout(checkRive, 100);
            }
        };
        
        checkRive();
    });
}

/**
 * 初始化应用
 */
async function init() {
    try {
        // 等待 Rive 库加载
        await waitForRive();
        
        // 获取 DOM 元素
        canvas = document.getElementById('rive-canvas');
        loadingOverlay = document.getElementById('loading-overlay');
        errorOverlay = document.getElementById('error-overlay');
        errorText = document.getElementById('error-text');
        retryBtn = document.getElementById('retry-btn');
        
        if (!canvas) {
            throw new Error('找不到画布元素');
        }
        
        // 设置画布大小和 DPI 适配
        setupCanvas();
        
        // 绑定事件
        bindEvents();
        
        // 加载 Rive 动画
        await loadRiveAnimation();
        
        console.log('桌宠应用初始化完成');
    } catch (error) {
        console.error('初始化失败:', error);
        showError('初始化失败', error.message);
    }
}

/**
 * 设置画布大小和 DPI 适配
 */
function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const size = INTERACTION_CONFIG.CANVAS_SIZE;
    
    // 设置画布显示大小
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    
    // 设置画布实际大小（考虑 DPI）
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    
    // 获取 2D 上下文
    ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.scale(dpr, dpr);
    }
    
    console.log(`画布设置完成: ${size}x${size}, DPR: ${dpr}`);
}

/**
 * 加载 Rive 动画
 */
async function loadRiveAnimation() {
    try {
        showLoading(true);
        
        // 确保 electronAPI 可用
        if (!window.electronAPI) {
            throw new Error('electronAPI 未就绪');
        }
        
        // 获取动画文件路径
        const rivPath = window.electronAPI.getEnvVar('PET_RIV_PATH') || './assets/pet.riv';
        
        console.log('加载动画文件:', rivPath);
        
        // 读取动画文件
        const fileBuffer = await window.electronAPI.readFileBuffer(rivPath);
        
        // 创建 Rive 实例
        riveInstance = new rive.Rive({
            buffer: fileBuffer,
            canvas: canvas,
            autoplay: false,
            onLoad: () => {
                console.log('Rive 动画加载成功');
                onRiveLoaded();
            },
            onLoadError: (error) => {
                console.error('Rive 加载错误:', error);
                showError('动画加载失败', `无法加载动画文件: ${error}`);
            }
        });
        
    } catch (error) {
        console.error('加载动画文件失败:', error);
        showError('文件读取失败', error.message);
    }
}

/**
 * Rive 动画加载完成回调
 */
function onRiveLoaded() {
    try {
        // 获取 artboard 和可用动画
        artboard = riveInstance.artboard;
        if (!artboard) {
            throw new Error('无法获取 artboard');
        }
        
        // 扫描可用动画
        scanAvailableAnimations();
        
        // 开始播放默认动画
        playAnimation('IDLE');
        
        // 隐藏加载界面
        showLoading(false);
        
        // 添加淡入效果
        canvas.classList.add('fade-in');
        
        console.log('动画系统就绪');
    } catch (error) {
        console.error('Rive 初始化失败:', error);
        showError('动画初始化失败', error.message);
    }
}

/**
 * 扫描可用动画
 */
function scanAvailableAnimations() {
    availableAnimations = {};
    
    Object.keys(ANIMATION_CANDIDATES).forEach(stateKey => {
        const candidates = ANIMATION_CANDIDATES[stateKey];
        
        for (const animName of candidates) {
            try {
                const animation = artboard.animationByName(animName);
                if (animation) {
                    availableAnimations[stateKey] = {
                        name: animName,
                        animation: animation,
                        duration: animation.duration * 1000 // 转换为毫秒
                    };
                    console.log(`匹配到 ${stateKey} 动画: ${animName}`);
                    break;
                }
            } catch (e) {
                // 动画不存在，继续尝试下一个
            }
        }
        
        if (!availableAnimations[stateKey]) {
            console.warn(`未找到 ${stateKey} 动画候选: ${candidates.join(', ')}`);
        }
    });
    
    // 检查是否至少有 Idle 动画
    if (!availableAnimations.IDLE) {
        throw new Error('未找到任何可用的 Idle 动画');
    }
}

/**
 * 播放指定动画
 * @param {string} stateKey - 动画状态键
 */
function playAnimation(stateKey) {
    try {
        const animData = availableAnimations[stateKey];
        
        if (!animData) {
            console.warn(`动画 ${stateKey} 不可用，回退到 Idle`);
            if (stateKey !== 'IDLE') {
                playAnimation('IDLE');
            }
            return;
        }
        
        // 清除之前的动画
        artboard.animationByIndex(0)?.delete();
        
        // 播放新动画
        const animationInstance = new rive.LinearAnimationInstance(animData.animation);
        artboard.addAnimationInstance(animationInstance);
        
        currentState = stateKey;
        console.log(`播放动画: ${animData.name} (${stateKey})`);
        
        // 如果是 Click 动画，设置回退定时器
        if (stateKey === 'CLICK') {
            setupClickFallback(animData.duration);
        }
        
    } catch (error) {
        console.error(`播放动画 ${stateKey} 失败:`, error);
        if (stateKey !== 'IDLE') {
            playAnimation('IDLE');
        }
    }
}

/**
 * 设置 Click 动画回退
 * @param {number} animationDuration - 动画时长（毫秒）
 */
function setupClickFallback(animationDuration) {
    // 清除之前的定时器
    if (clickFallbackTimer) {
        clearTimeout(clickFallbackTimer);
    }
    
    // 使用动画实际时长或配置的回退时间，取较小值
    const fallbackTime = Math.min(animationDuration || INTERACTION_CONFIG.CLICK_FALLBACK_MS, 
                                  INTERACTION_CONFIG.CLICK_FALLBACK_MS);
    
    clickFallbackTimer = setTimeout(() => {
        if (currentState === 'CLICK') {
            console.log('Click 动画回退到 Idle');
            playAnimation('IDLE');
        }
    }, fallbackTime);
}

/**
 * 绑定事件监听器
 */
function bindEvents() {
    // Pointer 事件（支持鼠标和触摸）
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    canvas.addEventListener('pointerenter', handlePointerEnter);
    
    // 防止右键菜单
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // 重试按钮
    if (retryBtn) {
        retryBtn.addEventListener('click', handleRetry);
    }
    
    // DPI 变化监听
    setupDPIListener();
    
    console.log('事件监听器绑定完成');
}

/**
 * 设置 DPI 变化监听
 */
function setupDPIListener() {
    // 监听窗口大小变化（可能伴随 DPI 变化）
    window.addEventListener('resize', () => {
        const newDPR = window.devicePixelRatio || 1;
        if (newDPR !== INTERACTION_CONFIG.DPI_SCALE) {
            console.log(`DPI 变化检测: ${INTERACTION_CONFIG.DPI_SCALE} -> ${newDPR}`);
            INTERACTION_CONFIG.DPI_SCALE = newDPR;
            setupCanvas();
        }
    });
    
    // 使用 matchMedia 监听分辨率变化
    const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mediaQuery.addEventListener('change', () => {
        const newDPR = window.devicePixelRatio || 1;
        console.log(`分辨率变化检测: ${INTERACTION_CONFIG.DPI_SCALE} -> ${newDPR}`);
        INTERACTION_CONFIG.DPI_SCALE = newDPR;
        setupCanvas();
    });
}

/**
 * 处理指针按下事件
 */
function handlePointerDown(e) {
    e.preventDefault();
    
    // 设置指针捕获
    canvas.setPointerCapture(e.pointerId);
    
    isDragging = false;
    dragStartTime = Date.now();
    dragStartPos = { x: e.clientX, y: e.clientY };
    
    // 清除 Sleep 宽限定时器
    if (sleepGraceTimer) {
        clearTimeout(sleepGraceTimer);
        sleepGraceTimer = null;
    }
}

/**
 * 处理指针移动事件
 */
function handlePointerMove(e) {
    if (dragStartTime === 0) return;
    
    const currentTime = Date.now();
    const deltaX = e.clientX - dragStartPos.x;
    const deltaY = e.clientY - dragStartPos.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // 判断是否开始拖拽
    if (!isDragging && distance > INTERACTION_CONFIG.CLICK_THRESHOLD_PX) {
        isDragging = true;
        console.log('开始拖拽');
    }
    
    // 如果正在拖拽，移动窗口（节流处理）
    if (isDragging && currentTime - lastMoveTime > 8) { // ~120Hz
        window.electronAPI.moveWindow(deltaX, deltaY);
        dragStartPos = { x: e.clientX, y: e.clientY };
        lastMoveTime = currentTime;
    }
}

/**
 * 处理指针抬起事件
 */
function handlePointerUp(e) {
    e.preventDefault();
    
    // 释放指针捕获
    canvas.releasePointerCapture(e.pointerId);
    
    const clickDuration = Date.now() - dragStartTime;
    
    if (!isDragging && 
        clickDuration < INTERACTION_CONFIG.CLICK_THRESHOLD_MS && 
        currentState !== 'CLICK') {
        // 触发点击动画
        console.log('触发点击动画');
        playAnimation('CLICK');
    }
    
    // 重置拖拽状态
    isDragging = false;
    dragStartTime = 0;
}

/**
 * 处理指针离开事件
 */
function handlePointerLeave(e) {
    isPointerInside = false;
    
    // 如果不在拖拽中，设置 Sleep 宽限定时器
    if (!isDragging) {
        sleepGraceTimer = setTimeout(() => {
            if (!isPointerInside && currentState !== 'SLEEP') {
                console.log('触发 Sleep 动画');
                playAnimation('SLEEP');
            }
        }, INTERACTION_CONFIG.SLEEP_GRACE_MS);
    }
}

/**
 * 处理指针进入事件
 */
function handlePointerEnter(e) {
    isPointerInside = true;
    
    // 清除 Sleep 宽限定时器
    if (sleepGraceTimer) {
        clearTimeout(sleepGraceTimer);
        sleepGraceTimer = null;
    }
    
    // 如果当前是 Sleep 状态，切换回 Idle
    if (currentState === 'SLEEP') {
        console.log('从 Sleep 恢复到 Idle');
        playAnimation('IDLE');
    }
}

/**
 * 显示/隐藏加载界面
 */
function showLoading(show) {
    if (loadingOverlay) {
        if (show) {
            loadingOverlay.classList.remove('hidden');
        } else {
            loadingOverlay.classList.add('hidden');
        }
    }
}

/**
 * 显示错误信息
 */
function showError(title, message) {
    if (errorOverlay && errorText) {
        errorText.textContent = message;
        errorOverlay.classList.remove('hidden');
        showLoading(false);
    }
}

/**
 * 隐藏错误信息
 */
function hideError() {
    if (errorOverlay) {
        errorOverlay.classList.add('hidden');
    }
}

/**
 * 处理重试按钮点击
 */
function handleRetry() {
    hideError();
    // 清理之前的实例
    cleanup();
    // 重新初始化
    setTimeout(init, 100);
}

/**
 * 清理资源
 */
function cleanup() {
    // 清理定时器
    if (clickFallbackTimer) {
        clearTimeout(clickFallbackTimer);
        clickFallbackTimer = null;
    }
    
    if (sleepGraceTimer) {
        clearTimeout(sleepGraceTimer);
        sleepGraceTimer = null;
    }
    
    // 清理 Rive 实例
    if (riveInstance) {
        riveInstance.cleanup();
        riveInstance = null;
    }
    
    // 重置状态
    currentState = 'IDLE';
    availableAnimations = {};
    isDragging = false;
    dragStartTime = 0;
    isPointerInside = true;
    
    console.log('资源清理完成');
}

// 页面卸载时清理资源
window.addEventListener('beforeunload', cleanup);

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}