// 996长安酒店 - 前端脚本

// ========== 活动日历功能 ==========
let calendarData = null;
let selectedDate = new Date(); // 当前显示的日期
let calendarMonth = new Date().getMonth(); // 日历显示的月份
let calendarYear = new Date().getFullYear(); // 日历显示的年份

// 梦幻精灵API接口（需要后端代理才能跨域访问）
// const SPRITE_API = 'https://xyq.gm.163.com/cgi-bin/csa/csa_sprite.py?act=ask&product_name=xyq';

// 活动详情缓存
let activityDetailsCache = null;

// 加载活动详情数据
async function loadActivityDetails() {
    if (activityDetailsCache) return activityDetailsCache;
    try {
        const res = await fetch('/mhxy/static/activity_details.json');
        activityDetailsCache = await res.json();
        return activityDetailsCache;
    } catch (e) {
        console.error('加载活动详情失败:', e);
        return {};
    }
}

// 活动基本信息（备用）
const activityBasicInfo = {
    '皇宫飞贼': { icon: '贼', level: '≥40级', team: '≥3人组队' },
    '秘塔探险': { icon: '梦', level: '≥30级', team: '单人或组队' },
    '慈心渡鬼': { icon: '慈', level: '≥30级', team: '≥3人组队' },
    '帮派竞赛': { icon: '帮', level: '≥30级，入帮≥7天', team: '帮派成员' },
    '帮派迷宫': { icon: '迷', level: '≥50级', team: '3人组队' },
    '寻梦追忆': { icon: '梦', level: '≥30级', team: '≥3人组队' },
    '妙手仁心': { icon: '仁', level: '≥30级', team: '≥3人组队' },
    '天籁之音': { icon: '籁', level: '≥30级', team: '≥3人战斗' },
    '天降辰星': { icon: '星', level: '≥30级', team: '≥3人组队' },
    '门派闯关': { icon: '闯', level: '≥40级', team: '≥3人组队' },
    '科举大赛': { icon: '科', level: '≥10级', team: '单人' },
    '文韵墨香': { icon: '文', level: '≥30级', team: '≥3人组队' },
    '彩虹争霸赛': { icon: '彩', level: '≥40级', team: '单人或组队' },
    '英雄大会': { icon: '雄', level: '按等级分组', team: '单人报名' },
    '长安保卫战': { icon: '卫', level: '≥30级', team: '≥3人组队' },
    '降妖伏魔': { icon: '降', level: '≥40级', team: '≥3人组队' },
    '天下美食': { icon: '食', level: '≥40级', team: '≥3人' },
    '春色满园': { icon: '春', level: '≥30级', team: '单人' },
    '妙法慧心': { icon: '慧', level: '≥30级', team: '单人' },
    '巧诱妖灵': { icon: '妖', level: '≥30级', team: '≥3人组队' },
    '决战华山': { icon: '战', level: '按等级分组', team: '组队' },
    '剑会天下': { icon: '剑', level: '≥55级', team: '5人组队/单人' },
    '决胜召唤兽': { icon: '剑', level: '≥55级', team: '单人' },
    '校场演兵': { icon: '校', level: '≥50级', team: '单人报名' },
    '卡牌风云赛': { icon: '卡', level: '≥40级', team: '单人' },
    '乾坤盘大赛': { icon: '乾', level: '≥50级', team: '单人' },
    '钓鱼大赛': { icon: '钓', level: '≥50级', team: '单人或组队' }
};

async function loadCalendarData() {
    try {
        const res = await fetch('/mhxy/static/mhxy_calendar.json');
        return await res.json();
    } catch(e) {
        console.error('加载日历数据失败', e);
        return null;
    }
}

function getActivitiesForDate(data, date) {
    const day = date.getDay(); // 0=周日
    const dateNum = date.getDate();

    // 使用和小程序完全一样的周数计算公式
    const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    let u = firstDayOfMonth.getDay();
    if (u === 0) u = 7; // 周日改为7
    const g = dateNum + u - 1;
    const week = Math.floor((g - 1) / 7) + 1;

    const actives = [...data.actives, ...data.activesEx];
    const dateActives = actives.filter(a => {
        if (!a.day.includes(day)) return false;
        if (a.week && !a.week.includes(week)) return false;
        return true;
    });

    return dateActives.sort((a,b) => a.time.localeCompare(b.time));
}

function getTodayActivities(data) {
    return getActivitiesForDate(data, selectedDate);
}

function getTodayFestival(data) {
    const now = new Date();
    now.setHours(now.getHours() + 8); // 北京时间
    const today = now.toISOString().substring(0, 10);
    return data.festivals.find(f => f.date === today);
}

function getNextFestivals(data, count = 4) {
    const now = new Date();
    now.setHours(now.getHours() + 8);
    const today = now.toISOString().substring(0, 10);
    return data.festivals.filter(f => f.date >= today).slice(0, count);
}

function getWeekActivities(data) {
    const weekdays = [0, 1, 2, 3, 4, 5, 6];
    const now = new Date();
    const date = now.getDate();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).getDay() || 7;
    const week = Math.floor((date + firstDay - 1) / 7) + 1;

    return weekdays.map(d => {
        const dayActives = [...data.actives, ...data.activesEx].filter(a => {
            if (!a.day.includes(d)) return false;
            if (a.week && !a.week.includes(week)) return false;
            return true;
        });
        return {
            day: d,
            actives: dayActives.sort((a,b) => a.time.localeCompare(b.time))
        };
    });
}

function renderActivityBar(data) {
    if (!data) return;

    // 渲染首页时间提醒
    renderHomeReminders(data);

    // 渲染活动列表（默认今天）
    selectedDate = new Date();
    const actives = getTodayActivities(data);
    const listEl = document.getElementById('activityList');

    if (actives.length === 0) {
        listEl.innerHTML = '<div class="activity-item"><span class="activity-icon">😴</span><span>当日无活动</span></div>';
    } else {
        listEl.innerHTML = actives.map((a, i) => `
            <div class="activity-item" data-index="${i}" data-name="${a.name}" data-sub="${a.sub || ''}">
                <span class="activity-icon">${a.icon}</span>
                <span class="activity-name">${a.name}</span>
                ${a.sub ? `<span class="activity-sub">${a.sub}</span>` : ''}
                <span class="activity-time">${a.time}</span>
            </div>
        `).join('');

        // 添加点击事件
        listEl.querySelectorAll('.activity-item[data-name]').forEach(item => {
            item.onclick = () => showActivityDetail(item.dataset.name, item.dataset.sub);
        });
    }
}

// 渲染首页时间提醒
function renderHomeReminders(data) {
    // 副本刷新时间
    const baseTime = new Date('2132-12-22T08:00:00').getTime();
    const now = Date.now();
    const diff = (baseTime - now) / 1000 % 345600;
    const fbDay = Math.floor(diff / 86400);
    const fbHour = Math.floor((diff % 86400) / 3600);
    document.getElementById('homeFBRefreshTime').textContent = `${fbDay}天${fbHour}小时`;

    // 今天是否节日
    const todayFestival = getTodayFestival(data);
    if (todayFestival) {
        document.getElementById('homeReminderFestival').style.display = 'flex';
        document.getElementById('homeFestivalName').textContent = todayFestival.name;
    } else {
        document.getElementById('homeReminderFestival').style.display = 'none';
    }

    // 下次节日
    const nextFestival = getNextFestival(data);
    if (nextFestival) {
        const fDate = new Date(nextFestival.date);
        document.getElementById('homeNextFestival').textContent =
            `${fDate.getMonth() + 1}月${fDate.getDate()}日 ${nextFestival.name}`;
    }
}

function isSameDay(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
}

function getFestivalForDate(data, date) {
    // 不要修改原日期对象，创建一个新的
    const newDate = new Date(date);
    newDate.setHours(newDate.getHours() + 8); // 北京时间
    const targetDate = newDate.toISOString().substring(0, 10);
    return data.festivals.find(f => f.date === targetDate);
}

function renderCalendarModal(data) {
    if (!data) return;

    // 渲染周历
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekActives = getWeekActivities(data);
    const today = new Date().getDay();

    const weekEl = document.getElementById('calendarWeek');
    weekEl.innerHTML = weekActives.map((wa, i) => {
        const isToday = i === today;
        const dayDate = new Date();
        dayDate.setDate(dayDate.getDate() - today + i);

        return `
            <div class="calendar-day ${isToday ? 'today' : ''}">
                <div class="calendar-day-name">${weekdays[i]}</div>
                <div class="calendar-day-date">${dayDate.getDate()}</div>
                <div class="calendar-day-actives">
                    ${wa.actives.slice(0, 3).map(a => `
                        <div class="calendar-active-item">${a.icon} ${a.name}</div>
                    `).join('')}
                    ${wa.actives.length > 3 ? `<div class="calendar-active-item">+${wa.actives.length - 3}更多</div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    // 渲染节日列表
    const festivals = getNextFestivals(data, 8);
    const festivalsEl = document.getElementById('calendarFestivals');
    festivalsEl.innerHTML = festivals.map(f => {
        const fDate = new Date(f.date);
        const isUpcoming = fDate.getTime() - new Date().getTime() < 7 * 24 * 60 * 60 * 1000;
        return `
            <div class="festival-item ${isUpcoming ? 'upcoming' : ''}">
                <div class="festival-name">${f.name}</div>
                <div class="festival-date">${fDate.getMonth() + 1}/${fDate.getDate()}</div>
            </div>
        `;
    }).join('');
}

// 解析活动详情内容，生成美观的HTML
function parseActivityDetail(text) {
    if (!text) return '';

    // 按行分割
    const lines = text.split('\n').filter(l => l.trim());

    let html = '';
    let currentSection = '';
    let sectionContent = [];

    // 关键词对应图标
    const iconMap = {
        '时间': '⏰', '开启时间': '⏰', '活动时间': '⏰', '比赛时间': '⏰', '入场时间': '⏰', '进场时间': '⏰',
        '条件': '🎯', '要求': '🎯', '参加条件': '🎯', '参与条件': '🎯', '报名条件': '🎯', '领取条件': '🎯',
        'NPC': '📍', '活动NPC': '📍', '领取NPC': '📍', '报名NPC': '📍', '进场NPC': '📍', '入场NPC': '📍',
        '玩法': '🎮', '玩法介绍': '🎮', '玩法说明': '🎮', '玩法类型': '🎮',
        '奖励': '🎁',
        '说明': '📋', '其他说明': '📋', '任务说明': '📋',
        '胜负判断': '⚔️', '输赢判断': '⚔️', '规则': '📋',
        '开启条件': '🔓', '参与': '👥', '分组': '📊'
    };

    // 解析每一行
    for (const line of lines) {
        const trimmed = line.trim();

        // 标题行（包含【】的）
        if (trimmed.startsWith('【') && trimmed.includes('】')) {
            if (currentSection && sectionContent.length > 0) {
                html += renderSection(currentSection, sectionContent);
                sectionContent = [];
            }
            html += `<div class="detail-title">${trimmed}</div>`;
            continue;
        }

        // 带分隔符的属性行（包含：或:）
        const colonMatch = trimmed.match(/^(.+?)[：:](.+)$/);
        if (colonMatch) {
            const key = colonMatch[1].trim();
            const value = colonMatch[2].trim();
            const icon = iconMap[key] || '📌';

            // 检查是否是新段落的关键词
            const isSectionKey = ['玩法', '玩法介绍', '玩法说明', '胜负判断', '输赢判断', '规则', '说明', '其他说明', '任务说明', '开启条件'].includes(key);

            if (isSectionKey) {
                if (currentSection && sectionContent.length > 0) {
                    html += renderSection(currentSection, sectionContent);
                }
                currentSection = key;
                sectionContent = value ? [value] : [];
            } else {
                // 添加到信息列表
                html += `
                    <div class="detail-row">
                        <span class="detail-label">${icon} ${key}</span>
                        <span class="detail-value">${value}</span>
                    </div>
                `;
            }
            continue;
        }

        // 编号列表项（1、2、3... 或 1. 2. 3.）
        if (/^\d+[、.．]/.test(trimmed)) {
            const content = trimmed.replace(/^\d+[、.．]\s*/, '');
            if (currentSection) {
                sectionContent.push(`<span class="list-num">${trimmed.match(/^\d+/)[0]}.</span> ${content}`);
            } else {
                html += `<div class="detail-list-item"><span class="list-num">${trimmed.match(/^\d+/)[0]}.</span> ${content}</div>`;
            }
            continue;
        }

        // 子项（★或☆开头）
        if (/^[★☆]/.test(trimmed)) {
            const content = trimmed.replace(/^[★☆]\s*/, '');
            if (currentSection) {
                sectionContent.push(`<span class="detail-star">★</span> ${content}`);
            } else {
                html += `<div class="detail-star-item"><span class="detail-star">★</span> ${content}</div>`;
            }
            continue;
        }

        // 其他内容
        if (trimmed) {
            if (currentSection) {
                sectionContent.push(trimmed);
            } else {
                html += `<div class="detail-text">${trimmed}</div>`;
            }
        }
    }

    // 渲染最后一个段落
    if (currentSection && sectionContent.length > 0) {
        html += renderSection(currentSection, sectionContent);
    }

    return html;
}

// 渲染段落
function renderSection(title, contents) {
    const iconMap = {
        '玩法': '🎮', '玩法介绍': '🎮', '玩法说明': '🎮',
        '胜负判断': '⚔️', '输赢判断': '⚔️', '规则': '📋',
        '说明': '📋', '其他说明': '📋', '任务说明': '📋',
        '开启条件': '🔓'
    };
    const icon = iconMap[title] || '📋';

    return `
        <div class="detail-section">
            <div class="detail-section-title">${icon} ${title}</div>
            <div class="detail-section-content">
                ${contents.map(c => {
                    if (c.startsWith('<span class="list-num"') || c.startsWith('<span class="detail-star"')) {
                        return `<div class="detail-list-item">${c}</div>`;
                    }
                    return `<div class="detail-text">${c}</div>`;
                }).join('')}
            </div>
        </div>
    `;
}

async function showActivityDetail(name, sub) {
    const basic = activityBasicInfo[name] || {};

    // 查找活动的图标和时间
    const actives = [...calendarData.actives, ...calendarData.activesEx];
    const active = actives.find(a => a.name === name && (!sub || a.sub === sub));

    // 构建查询key
    let detailKey = name;
    if (name === '帮派竞赛' && sub) {
        detailKey = '帮派竞赛' + sub;
    }

    // 显示标题
    document.getElementById('activityDetailTitle').innerHTML = `
        <span style="font-size: 24px;">${active?.icon || basic?.icon || '📅'}</span>
        ${name}${sub ? ` - ${sub}` : ''}
    `;

    // 显示加载状态
    document.getElementById('activityDetailBody').innerHTML = `
        <div class="detail-loading">
            <div class="loading-spinner"></div>
            <span>正在加载活动详情...</span>
        </div>
    `;
    document.getElementById('activityDetailModal').classList.add('active');

    // 加载详情数据
    const details = await loadActivityDetails();
    const rawText = details[detailKey];

    if (rawText) {
        // 解析并美化显示
        const parsedHtml = parseActivityDetail(rawText);
        document.getElementById('activityDetailBody').innerHTML = `
            <div class="detail-scroll-content">${parsedHtml}</div>
        `;
    } else {
        // 降级显示基本信息
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const dayStr = active?.day?.map(d => weekdays[d]).join('、') || '不限';

        document.getElementById('activityDetailBody').innerHTML = `
            <div class="detail-info">
                <div class="detail-row">
                    <span class="detail-label">⏰ 活动时间</span>
                    <span class="detail-value">${active?.time || '请查看游戏内公告'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">📅 开放日期</span>
                    <span class="detail-value">${dayStr}</span>
                </div>
                ${active?.week ? `<div class="detail-row">
                    <span class="detail-label">📆 每月周次</span>
                    <span class="detail-value">第${active.week.join('、')}周</span>
                </div>` : ''}
                <div class="detail-row">
                    <span class="detail-label">🎯 等级要求</span>
                    <span class="detail-value">${basic?.level || '请查看游戏内公告'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">👥 参与方式</span>
                    <span class="detail-value">${basic?.team || '请查看游戏内公告'}</span>
                </div>
            </div>
            <div class="detail-section">
                <div class="detail-section-title">📝 提示</div>
                <div class="detail-desc">暂无详细说明，请查看游戏内梦幻精灵获取信息。</div>
            </div>
        `;
    }
}

function initCalendar() {
    loadCalendarData().then(data => {
        if (data) {
            calendarData = data;
            renderActivityBar(data);
            initScrollHint();

            // 点击展开按钮
            document.getElementById('activityExpand').onclick = () => {
                // 用当前选中的日期来初始化日历显示
                calendarYear = selectedDate.getFullYear();
                calendarMonth = selectedDate.getMonth();
                renderCalendarModal(data);
                document.getElementById('calendarModal').classList.add('active');
            };

            // 点击关闭按钮
            document.getElementById('calendarClose').onclick = () => {
                document.getElementById('calendarModal').classList.remove('active');
            };

            // 点击背景关闭
            document.getElementById('calendarModal').onclick = (e) => {
                if (e.target.id === 'calendarModal') {
                    document.getElementById('calendarModal').classList.remove('active');
                }
            };

            // 月份切换
            document.getElementById('monthPrev').onclick = () => {
                calendarMonth--;
                if (calendarMonth < 0) {
                    calendarMonth = 11;
                    calendarYear--;
                }
                renderCalendarGrid(data);
            };

            document.getElementById('monthNext').onclick = () => {
                calendarMonth++;
                if (calendarMonth > 11) {
                    calendarMonth = 0;
                    calendarYear++;
                }
                renderCalendarGrid(data);
            };

            // 日期面板中的前后切换
            document.getElementById('panelDatePrev').onclick = () => {
                selectedDate.setDate(selectedDate.getDate() - 1);
                syncCalendarMonth();
                renderCalendarGrid(data);
                renderPanelActivities(data);
            };

            document.getElementById('panelDateNext').onclick = () => {
                selectedDate.setDate(selectedDate.getDate() + 1);
                syncCalendarMonth();
                renderCalendarGrid(data);
                renderPanelActivities(data);
            };

            // 回到今天按钮
            document.getElementById('backToToday').onclick = () => {
                selectedDate = new Date();
                calendarYear = selectedDate.getFullYear();
                calendarMonth = selectedDate.getMonth();
                renderCalendarGrid(data);
                renderPanelActivities(data);
            };

            // 活动详情弹窗关闭
            document.getElementById('activityDetailClose').onclick = () => {
                document.getElementById('activityDetailModal').classList.remove('active');
            };

            document.getElementById('activityDetailModal').onclick = (e) => {
                if (e.target.id === 'activityDetailModal') {
                    document.getElementById('activityDetailModal').classList.remove('active');
                }
            };
        }
    });
}

// 同步日历月份与选中日期
function syncCalendarMonth() {
    if (selectedDate.getMonth() !== calendarMonth || selectedDate.getFullYear() !== calendarYear) {
        calendarYear = selectedDate.getFullYear();
        calendarMonth = selectedDate.getMonth();
    }
}

// 初始化自动滚动
function initScrollHint() {
    const list = document.getElementById('activityList');

    // 检查是否需要滚动
    if (list.scrollWidth <= list.clientWidth + 10) {
        return;
    }

    // 自动轮播
    let scrollDirection = 1;
    let isHovering = false;

    function autoScroll() {
        if (isHovering) return;

        const maxScroll = list.scrollWidth - list.clientWidth;
        const currentScroll = list.scrollLeft;

        // 到达边界时反向
        if (currentScroll >= maxScroll - 2) {
            scrollDirection = -1;
        } else if (currentScroll <= 1) {
            scrollDirection = 1;
        }

        list.scrollLeft += scrollDirection * 1.5;
    }

    // 启动自动滚动
    const scrollInterval = setInterval(autoScroll, 40);

    // 鼠标悬停时暂停
    list.addEventListener('mouseenter', () => {
        isHovering = true;
    });

    list.addEventListener('mouseleave', () => {
        isHovering = false;
    });
}

// 渲染日历弹窗
function renderCalendarModal(data) {
    renderCalendarGrid(data);
    renderPanelActivities(data);
}

// 渲染小程序风格的活动面板
function renderPanelActivities(data) {
    const date = selectedDate;
    const activities = getActivitiesForDate(data, date);

    // 更新日期文本
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    document.getElementById('panelDateText').textContent =
        `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`;

    const listEl = document.getElementById('panelActivityList');

    if (activities.length === 0) {
        listEl.innerHTML = '<div class="panel-no-activity">当日无特殊活动</div>';
    } else {
        listEl.innerHTML = activities.map(a => `
            <div class="panel-activity-item" onclick="showActivityDetail('${a.name}', '${a.sub || ''}')">
                <div class="panel-activity-icon">${a.icon}</div>
                <div class="panel-activity-name-wrap">
                    <div class="panel-activity-name">${a.name}</div>
                    ${a.sub ? `<div class="panel-activity-sub">${a.sub}</div>` : ''}
                </div>
                <div class="panel-activity-time">${a.time}</div>
                <div class="panel-activity-detail">详情</div>
            </div>
        `).join('');
    }
}

function getNextFestival(data) {
    const now = new Date();
    now.setHours(now.getHours() + 8);
    const today = now.toISOString().substring(0, 10);
    return data.festivals.find(f => f.date >= today);
}

// 渲染日历网格
function renderCalendarGrid(data) {
    document.getElementById('monthTitle').textContent = `${calendarYear}年${calendarMonth + 1}月`;

    const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const today = new Date();

    const grid = document.getElementById('calendarDays');
    grid.innerHTML = '';

    // 生成空白天
    for (let i = 0; i < firstDay; i++) {
        grid.innerHTML += `<div class="calendar-day-cell empty"></div>`;
    }

    // 生成日期
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(calendarYear, calendarMonth, day);
        const weekday = date.getDay();

        // 获取这天是否有特殊活动
        const dayActivities = getActivitiesForDate(data, date);
        const specialAct = dayActivities.length > 0 ? dayActivities[dayActivities.length - 1] : null;

        // 判断是否选中
        const isSelected = date.toDateString() === selectedDate.toDateString();

        let cellClass = 'calendar-day-cell';
        if (isSelected) cellClass += ' selected';

        // 使用和小程序一样的周数计算公式
        let u = firstDay;
        if (u === 0) u = 7;
        const g = day + u - 1;
        const week = Math.floor((g - 1) / 7) + 1;

        // 获取固定活动名称
        let fixedAct = '';

        if (weekday === 0) {
            // 周日特殊活动
            if (week === 1) fixedAct = '闯关';
            else if (week === 2) fixedAct = '科举';
            else if (week === 3) fixedAct = '彩虹';
            else if (week === 4) fixedAct = '英雄';
            else if (week === 5) fixedAct = '保卫';
        } else if (weekday === 1) {
            fixedAct = '妙手';
        } else if (weekday === 2) {
            fixedAct = '春色';
        } else if (weekday === 3) {
            fixedAct = '剑会';
        } else if (weekday === 4) {
            fixedAct = '巧诱';
        } else if (weekday === 5) {
            fixedAct = '天籁';
        } else if (weekday === 6) {
            fixedAct = '慈心';
        }

        grid.innerHTML += `
            <div class="${cellClass}" data-date="${calendarYear}-${calendarMonth + 1}-${day}" onclick="selectCalendarDate(${calendarYear}, ${calendarMonth}, ${day})">
                <span class="day-number">${day}</span>
                ${specialAct ? `<span class="day-activity-icon">${specialAct.icon}</span>` : ''}
                ${fixedAct ? `<span class="day-activity-name">${fixedAct}</span>` : ''}
            </div>
        `;
    }
}

// 选择日期
function selectCalendarDate(year, month, day) {
    // 同步更新日历显示的年月
    calendarYear = year;
    calendarMonth = month;
    selectedDate = new Date(year, month, day);
    renderCalendarGrid(calendarData);
    renderPanelActivities(calendarData);
}

// ========== 初始化Swiper轮播 ==========
function initSwiper() {
    const heroSwiper = new Swiper('.heroSwiper', {
        effect: 'fade',
        fadeEffect: {
            crossFade: true
        },
        loop: true,
        autoplay: {
            delay: 5000,
            disableOnInteraction: false,
        },
        pagination: {
            el: '.swiper-pagination',
            clickable: true,
        },
        navigation: {
            nextEl: '.swiper-button-next',
            prevEl: '.swiper-button-prev',
        },
        speed: 600,
        on: {
            slideChangeTransitionEnd: function() {
                // 添加动画类
                const activeSlide = document.querySelector('.swiper-slide-active');
                if (activeSlide) {
                    activeSlide.classList.add('hero-slide-active');
                }
            },
            slideChangeTransitionStart: function() {
                // 移除所有动画类
                document.querySelectorAll('.hero-slide').forEach(slide => {
                    slide.classList.remove('hero-slide-active');
                });
            }
        }
    });
}

// ========== 初始化页面 ==========
function init() {
    initCalendar();
    initSwiper();

    // 给第一个slide添加动画类
    const firstSlide = document.querySelector('.swiper-slide-active');
    if (firstSlide) {
        firstSlide.classList.add('hero-slide-active');
    }
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', init);