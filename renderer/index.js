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

// State Machine 模式
let useStateMachine = false;
const STATE_MACHINE_NAME = 'State Machine 1';
let smInputs = { click: null, awake: null, sleep: null };

// 交互状态
let isDragging = false;
let dragStartTime = 0;
let dragStartPos = { x: 0, y: 0 };
let rafMoveId = 0;
let pendingScreenTarget = null;
let windowLeftTopAtDown = { x: 0, y: 0 };
let pointerOffsetAtDown = { x: 0, y: 0 };
let lastMoveTime = 0;
let sleepGraceTimer = null;
let isPointerInside = true;

// DOM 元素
let loadingOverlay = null;
let errorOverlay = null;
let errorText = null;
let retryBtn = null;
let chatFab = null;

/**
 * 等待 Rive 库加载
 */
function waitForRive() {
    return new Promise((resolve, reject) => {
        if (typeof rive !== 'undefined') {
            try {
                if (rive.RuntimeLoader && typeof rive.RuntimeLoader.setWasmUrl === 'function') {
                    rive.RuntimeLoader.setWasmUrl('../node_modules/@rive-app/canvas/rive.wasm');
                }
            } catch (e) {}
            resolve();
            return;
        }
        
        let attempts = 0;
        const maxAttempts = 50; // 5秒超时
        
        const checkRive = () => {
            attempts++;
            if (typeof rive !== 'undefined') {
                try {
                    if (rive.RuntimeLoader && typeof rive.RuntimeLoader.setWasmUrl === 'function') {
                        rive.RuntimeLoader.setWasmUrl('../node_modules/@rive-app/canvas/rive.wasm');
                    }
                } catch (e) {}
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
        chatFab = document.getElementById('chat-fab');
        
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
        
        let usedBufferMode = false;
        let rivSrc = '../assets/pet.riv';

        if (window.electronAPI) {
            try {
                const envPath = window.electronAPI.getEnvVar('PET_RIV_PATH');
                const rivPath = envPath || './assets/pet.riv';
                console.log('加载动画文件(IPC):', rivPath);
                const fileBuffer = await window.electronAPI.readFileBuffer(rivPath);
                if (!fileBuffer || typeof fileBuffer.byteLength === 'undefined' || fileBuffer.byteLength === 0) {
                    throw new Error('读取到的文件为空');
                }
                usedBufferMode = true;
                riveInstance = new rive.Rive({
                    buffer: fileBuffer,
                    canvas: canvas,
                    autoplay: true,
                    stateMachines: STATE_MACHINE_NAME,
                    onLoad: () => {
                        console.log('Rive 动画加载成功');
                        onRiveLoaded();
                    },
                    onLoadError: (error) => {
                        console.error('Rive 加载错误:', error);
                        showError('动画加载失败', `无法加载动画文件: ${error}`);
                    }
                });
            } catch (e) {
                console.warn('通过 electronAPI 加载失败，回退到相对路径:', e);
            }
        } else {
            console.warn('electronAPI 不可用，使用相对路径加载 .riv');
        }

        if (!usedBufferMode) {
            // 从相对路径回退加载（从 renderer/ 到 ../assets/）
            console.log('加载动画文件(src):', rivSrc);
            riveInstance = new rive.Rive({
                src: rivSrc,
                canvas: canvas,
                autoplay: true,
                stateMachines: STATE_MACHINE_NAME,
                onLoad: () => {
                    console.log('Rive 动画加载成功(src)');
                    onRiveLoaded();
                },
                onLoadError: (error) => {
                    console.error('Rive 加载错误(src):', error);
                    showError('动画加载失败', `无法加载动画文件: ${error}`);
                }
            });
        }
        
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
        
        // 优先尝试 State Machine 输入
        setupStateMachineInputs();

        // 如果没有 State Machine 输入则回退到动画扫描
        if (!useStateMachine) {
            scanAvailableAnimations();
        }
        
        // 开始播放默认动画/触发唤醒
        if (useStateMachine) {
            triggerStateAction('IDLE');
        } else {
            playAnimation('IDLE');
        }
        
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

function setupStateMachineInputs() {
    try {
        const inputs = riveInstance.stateMachineInputs(STATE_MACHINE_NAME) || [];
        const byName = {};
        for (const input of inputs) {
            byName[input.name] = input;
        }
        smInputs.click = byName['clik'] || byName['click'] || null;
        smInputs.awake = byName['chick-awake'] || byName['awake'] || null;
        smInputs.sleep = byName['chick-sleep'] || byName['sleep'] || null;
        useStateMachine = Boolean(smInputs.click || smInputs.awake || smInputs.sleep);
        if (useStateMachine) {
            console.log('使用 State Machine 模式');
        }
    } catch (e) {
        useStateMachine = false;
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
        if (useStateMachine) {
            triggerStateAction(stateKey);
            return;
        }
        const animData = availableAnimations[stateKey];
        
        if (!animData) {
            console.warn(`动画 ${stateKey} 不可用，回退到 Idle`);
            if (stateKey !== 'IDLE') {
                playAnimation('IDLE');
            }
            return;
        }
        
        // 播放新动画（清理已有动画实例后播放）
        try {
            artboard.animationByIndex(0)?.delete();
        } catch (e) {}
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

function triggerStateAction(stateKey) {
    if (!useStateMachine) return;
    if (stateKey === 'CLICK' && smInputs.click) {
        smInputs.click.fire();
    } else if (stateKey === 'SLEEP' && smInputs.sleep) {
        smInputs.sleep.fire();
    } else if (stateKey === 'IDLE' && smInputs.awake) {
        smInputs.awake.fire();
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

    if (chatFab) {
        chatFab.addEventListener('click', async () => {
            try {
                await window.chatAPI.openPopover();
            } catch (e) {}
        });
    }
    
    // DPI 变化监听
    setupDPIListener();

    // Listen optional pet actions from chat
    if (window.petAPI && typeof window.petAPI.onActions === 'function') {
        window.petAPI.onActions((payload) => {
            try {
                const actions = (payload && payload.actions) || [];
                for (const action of actions) {
                    if (!action || !action.name) continue;
                    if (action.name === 'click') {
                        playAnimation('CLICK');
                    } else if (action.name === 'awake') {
                        playAnimation('IDLE');
                    } else if (action.name === 'sleep') {
                        playAnimation('SLEEP');
                    }
                }
            } catch (e) {}
        });
    }
    
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
    // 记录窗口左上角的屏幕坐标与指针偏移
    if (window.electronAPI && typeof window.electronAPI.getBounds === 'function') {
        window.electronAPI.getBounds().then(({ bounds, scaleFactor }) => {
            if (!bounds) return;
            const s = scaleFactor || (window.devicePixelRatio || 1);
            const dipLeftTop = { x: bounds.x, y: bounds.y };
            windowLeftTopAtDown = { x: dipLeftTop.x * s, y: dipLeftTop.y * s };
            const pointerScreen = { x: e.screenX, y: e.screenY };
            pointerOffsetAtDown = { x: pointerScreen.x - windowLeftTopAtDown.x, y: pointerScreen.y - windowLeftTopAtDown.y };
        }).catch(() => {});
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
    
    // rAF 合并：计算目标屏幕左上角
    if (isDragging && window.electronAPI && typeof window.electronAPI.moveTo === 'function') {
        const targetScreenX = e.screenX - pointerOffsetAtDown.x;
        const targetScreenY = e.screenY - pointerOffsetAtDown.y;
        pendingScreenTarget = { x: targetScreenX, y: targetScreenY };
        if (!rafMoveId) {
            rafMoveId = requestAnimationFrame(() => {
                rafMoveId = 0;
                if (pendingScreenTarget) {
                    window.electronAPI.moveTo(pendingScreenTarget.x, pendingScreenTarget.y);
                    pendingScreenTarget = null;
                }
            });
        }
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
        // 触发点击动画/触发器
        console.log('触发点击动画');
        playAnimation('CLICK');
    }
    
    // 重置拖拽状态
    isDragging = false;
    dragStartTime = 0;
    if (rafMoveId) { cancelAnimationFrame(rafMoveId); rafMoveId = 0; }
    pendingScreenTarget = null;
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
                console.log('触发 Sleep 动作');
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