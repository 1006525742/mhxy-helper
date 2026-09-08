/**
 * BorderGlow - 边缘发光效果组件 (原生JavaScript版本)
 * 基于 React Bits 的 BorderGlow 组件
 */

(function() {
    'use strict';

    // 解析HSL字符串
    function parseHSL(hslStr) {
        const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
        if (!match) return { h: 40, s: 80, l: 80 };
        return { h: parseFloat(match[1]), s: parseFloat(match[2]), l: parseFloat(match[3]) };
    }

    // 构建发光颜色变量
    function buildGlowVars(glowColor, intensity) {
        const { h, s, l } = parseHSL(glowColor);
        const base = `${h}deg ${s}% ${l}%`;
        const opacities = [100, 60, 50, 40, 30, 20, 10];
        const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10'];
        const vars = {};
        for (let i = 0; i < opacities.length; i++) {
            vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`;
        }
        return vars;
    }

    // 渐变位置和键
    const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%'];
    const GRADIENT_KEYS = ['--gradient-one', '--gradient-two', '--gradient-three', '--gradient-four', '--gradient-five', '--gradient-six', '--gradient-seven'];
    const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];

    // 构建渐变变量
    function buildGradientVars(colors) {
        const vars = {};
        for (let i = 0; i < 7; i++) {
            const c = colors[Math.min(COLOR_MAP[i], colors.length - 1)];
            vars[GRADIENT_KEYS[i]] = `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`;
        }
        vars['--gradient-base'] = `linear-gradient(${colors[0]} 0 100%)`;
        return vars;
    }

    // 缓动函数
    function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
    function easeInCubic(x) { return x * x * x; }

    // 动画值
    function animateValue({ start = 0, end = 100, duration = 1000, delay = 0, ease = easeOutCubic, onUpdate, onEnd }) {
        const t0 = performance.now() + delay;
        function tick() {
            const elapsed = performance.now() - t0;
            const t = Math.min(elapsed / duration, 1);
            onUpdate(start + (end - start) * ease(t));
            if (t < 1) requestAnimationFrame(tick);
            else if (onEnd) onEnd();
        }
        setTimeout(() => requestAnimationFrame(tick), delay);
    }

    // 获取元素中心
    function getCenterOfElement(el) {
        const { width, height } = el.getBoundingClientRect();
        return [width / 2, height / 2];
    }

    // 获取边缘距离
    function getEdgeProximity(el, x, y) {
        const [cx, cy] = getCenterOfElement(el);
        const dx = x - cx;
        const dy = y - cy;
        let kx = Infinity;
        let ky = Infinity;
        if (dx !== 0) kx = cx / Math.abs(dx);
        if (dy !== 0) ky = cy / Math.abs(dy);
        return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    }

    // 获取光标角度
    function getCursorAngle(el, x, y) {
        const [cx, cy] = getCenterOfElement(el);
        const dx = x - cx;
        const dy = y - cy;
        if (dx === 0 && dy === 0) return 0;
        const radians = Math.atan2(dy, dx);
        let degrees = radians * (180 / Math.PI) + 90;
        if (degrees < 0) degrees += 360;
        return degrees;
    }

    // 创建BorderGlow元素
    function createBorderGlow(options = {}) {
        const {
            edgeSensitivity = 30,
            glowColor = '40 80 80',
            backgroundColor = '#120F17',
            borderRadius = 28,
            glowRadius = 40,
            glowIntensity = 1.0,
            coneSpread = 25,
            animated = false,
            colors = ['#c084fc', '#f472b6', '#38bdf8'],
            fillOpacity = 0.5,
            className = '',
        } = options;

        // 创建主容器
        const card = document.createElement('div');
        card.className = `border-glow-card ${className}`;

        // 创建边缘光层
        const edgeLight = document.createElement('span');
        edgeLight.className = 'edge-light';
        card.appendChild(edgeLight);

        // 创建内部容器
        const inner = document.createElement('div');
        inner.className = 'border-glow-inner';
        card.appendChild(inner);

        // 设置CSS变量
        const glowVars = buildGlowVars(glowColor, glowIntensity);
        const gradientVars = buildGradientVars(colors);

        card.style.setProperty('--card-bg', backgroundColor);
        card.style.setProperty('--edge-sensitivity', edgeSensitivity);
        card.style.setProperty('--border-radius', `${borderRadius}px`);
        card.style.setProperty('--glow-padding', `${glowRadius}px`);
        card.style.setProperty('--cone-spread', coneSpread);
        card.style.setProperty('--fill-opacity', fillOpacity);

        Object.entries(glowVars).forEach(([key, value]) => {
            card.style.setProperty(key, value);
        });
        Object.entries(gradientVars).forEach(([key, value]) => {
            card.style.setProperty(key, value);
        });

        // 指针移动处理
        function handlePointerMove(e) {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const edge = getEdgeProximity(card, x, y);
            const angle = getCursorAngle(card, x, y);

            card.style.setProperty('--edge-proximity', `${(edge * 100).toFixed(3)}`);
            card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
        }

        card.addEventListener('pointermove', handlePointerMove);

        // 动画效果
        if (animated) {
            const angleStart = 110;
            const angleEnd = 465;
            card.classList.add('sweep-active');
            card.style.setProperty('--cursor-angle', `${angleStart}deg`);

            animateValue({ duration: 500, onUpdate: v => card.style.setProperty('--edge-proximity', v) });
            animateValue({ ease: easeInCubic, duration: 1500, end: 50, onUpdate: v => {
                card.style.setProperty('--cursor-angle', `${(angleEnd - angleStart) * (v / 100) + angleStart}deg`);
            }});
            animateValue({ ease: easeOutCubic, delay: 1500, duration: 2250, start: 50, end: 100, onUpdate: v => {
                card.style.setProperty('--cursor-angle', `${(angleEnd - angleStart) * (v / 100) + angleStart}deg`);
            }});
            animateValue({ ease: easeInCubic, delay: 2500, duration: 1500, start: 100, end: 0,
                onUpdate: v => card.style.setProperty('--edge-proximity', v),
                onEnd: () => card.classList.remove('sweep-active'),
            });
        }

        // 返回对象，包含元素和设置内容的方法
        return {
            element: card,
            inner: inner,
            setContent: function(content) {
                if (typeof content === 'string') {
                    inner.innerHTML = content;
                } else if (content instanceof Element) {
                    inner.appendChild(content);
                }
            },
            updateOptions: function(newOptions) {
                Object.entries(newOptions).forEach(([key, value]) => {
                    if (key === 'glowColor' || key === 'glowIntensity') {
                        const newGlowVars = buildGlowVars(newOptions.glowColor || glowColor, newOptions.glowIntensity || glowIntensity);
                        Object.entries(newGlowVars).forEach(([k, v]) => card.style.setProperty(k, v));
                    } else if (key === 'colors') {
                        const newGradientVars = buildGradientVars(value);
                        Object.entries(newGradientVars).forEach(([k, v]) => card.style.setProperty(k, v));
                    } else {
                        card.style.setProperty(`--${key}`, value);
                    }
                });
            }
        };
    }

    // 暴露到全局
    window.BorderGlow = {
        create: createBorderGlow,
        parseHSL,
        buildGlowVars,
        buildGradientVars
    };

})();