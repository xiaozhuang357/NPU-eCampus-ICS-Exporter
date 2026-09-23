// ==UserScript==
// @name         NPU 翱翔教务课表导出 ICS
// @namespace    https://jwxt.nwpu.edu.cn/
// @version      0.2.0
// @description  西北工业大学翱翔教务“我的课表”一键导出 ICS
// @match        https://jwxt.nwpu.edu.cn/student/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    const win = unsafeWindow;

    let tableVm = null;
    let activities = null;
    let exportButton = null;

    // =========================================================
    // 1. Hook XMLHttpRequest
    //    只观察课程表 print-data 请求
    // =========================================================

    const originalOpen = win.XMLHttpRequest.prototype.open;

    win.XMLHttpRequest.prototype.open = function (
        method,
        url,
        ...rest
    ) {
        this.__NPU_REQUEST_URL__ = String(url || '');

        this.addEventListener('load', function () {
            const requestUrl = this.__NPU_REQUEST_URL__;

            if (!isCourseTableRequest(requestUrl)) {
                return;
            }

            try {
                let response;

                if (
                    this.responseType === 'json' &&
                    this.response &&
                    typeof this.response === 'object'
                ) {
                    response = this.response;
                } else {
                    response = JSON.parse(this.responseText);
                }

                captureCourseData(response);

            } catch (error) {
                console.error(
                    '[NPU ICS] 课程表数据解析失败',
                    error
                );

                showToast(
                    '课程表数据解析失败',
                    'error'
                );
            }
        });

        return originalOpen.call(
            this,
            method,
            url,
            ...rest
        );
    };


    function isCourseTableRequest(url) {
        return (
            url.includes('/course-table/semester/') &&
            url.includes('/print-data/')
        );
    }


    // =========================================================
    // 2. 捕获 studentTableVm
    // =========================================================

    function captureCourseData(response) {
        const vm =
            response?.studentTableVm ??
            findTableVm(response);

        if (!vm) {
            console.warn(
                '[NPU ICS] print-data 中没有找到 TableVm'
            );
            return;
        }

        if (!Array.isArray(vm.activities)) {
            console.warn(
                '[NPU ICS] activities 不是数组'
            );
            return;
        }

        tableVm = vm;
        activities = vm.activities;

        console.log(
            `[NPU ICS] 已获取 ${activities.length} 条排课记录`
        );

        ensureExportButton();
        updateExportButton();

        showToast(
            `课表已就绪：${activities.length} 条排课记录`,
            'success'
        );
    }


    function findTableVm(response) {
        if (!response || typeof response !== 'object') {
            return null;
        }

        for (const [key, value] of Object.entries(response)) {
            if (
                key.endsWith('TableVm') &&
                value &&
                Array.isArray(value.activities)
            ) {
                return value;
            }
        }

        return null;
    }


    // =========================================================
    // 3. 学期信息
    // =========================================================

    function getSemesterStartDate() {
        const text =
            document.body?.innerText || '';

        const match = text.match(
            /学期起始日期[:：]\s*(\d{4}-\d{2}-\d{2})/
        );

        return match?.[1] ?? null;
    }


    function getSemesterName() {
        const text =
            document.body?.innerText || '';

        // 例如：2026-2027秋
        const match = text.match(
            /\b(\d{4}-\d{4}[春秋])\b/
        );

        return match?.[1] ?? '';
    }


    // =========================================================
    // 4. 周次 → 实际日期
    //
    // 学期起始日期是第一教学周的星期一
    // =========================================================

    function calculateCourseDate(
        semesterStartDate,
        weekIndex,
        weekday
    ) {
        const [year, month, day] =
            semesterStartDate
                .split('-')
                .map(Number);

        const base =
            Date.UTC(
                year,
                month - 1,
                day
            );

        const offsetDays =
            (weekIndex - 1) * 7 +
            (weekday - 1);

        const result =
            new Date(
                base +
                offsetDays *
                24 * 60 * 60 * 1000
            );

        return [
            result.getUTCFullYear(),
            String(
                result.getUTCMonth() + 1
            ).padStart(2, '0'),
            String(
                result.getUTCDate()
            ).padStart(2, '0')
        ].join('-');
    }


    // =========================================================
    // 5. 周次字符串
    //
    // 优先使用学校自己的 weeksStr。
    //
    // 如果没有，就把：
    // [2,3,4,5,6]
    //
    // 转成：
    // 2-6周
    // =========================================================

    function formatWeeks(activity) {
        if (
            activity.weeksStr &&
            String(activity.weeksStr).trim()
        ) {
            return normalizeWeeksStr(
                String(activity.weeksStr)
            );
        }

        const weeks =
            activity.weekIndexes;

        if (!Array.isArray(weeks) || weeks.length === 0) {
            return '';
        }

        return compressWeekIndexes(weeks);
    }


    function normalizeWeeksStr(value) {
        let text = value
            .trim()
            .replace(/~/g, '-');

        if (!text.endsWith('周')) {
            text += '周';
        }

        return text;
    }


    function compressWeekIndexes(weeks) {
        const sorted = [
            ...new Set(
                weeks
                    .map(Number)
                    .filter(Number.isFinite)
            )
        ].sort((a, b) => a - b);

        if (sorted.length === 0) {
            return '';
        }

        const ranges = [];

        let start = sorted[0];
        let previous = sorted[0];

        for (let i = 1; i <= sorted.length; i++) {
            const current = sorted[i];

            if (current === previous + 1) {
                previous = current;
                continue;
            }

            if (start === previous) {
                ranges.push(String(start));
            } else {
                ranges.push(`${start}-${previous}`);
            }

            start = current;
            previous = current;
        }

        return `${ranges.join(',')}周`;
    }


    // =========================================================
    // 6. 节次
    //
    // 3 ~ 4
    // ->
    // 第3-4节
    // =========================================================

    function formatUnits(activity) {
        const start =
            activity.startUnit;

        const end =
            activity.endUnit;

        if (
            Number.isFinite(Number(start)) &&
            Number.isFinite(Number(end))
        ) {
            if (Number(start) === Number(end)) {
                return `第${start}节`;
            }

            return `第${start}-${end}节`;
        }

        return '';
    }


    // =========================================================
    // 7. 教师
    // =========================================================

    function formatTeachers(activity) {
        const teachers =
            activity.teachers;

        if (Array.isArray(teachers)) {
            return teachers
                .map(item => {
                    if (typeof item === 'string') {
                        return item;
                    }

                    return (
                        item?.nameZh ??
                        item?.name ??
                        ''
                    );
                })
                .filter(Boolean)
                .join('、');
        }

        if (typeof teachers === 'string') {
            return teachers;
        }

        return '';
    }


    // =========================================================
    // 8. 教室
    // =========================================================

    function formatRoom(activity) {
        const room =
            String(
                activity.room ?? ''
            ).trim();

        if (room) {
            return room;
        }

        return String(
            activity.building ?? ''
        ).trim();
    }


    // =========================================================
    // 9. 标题
    //
    // 目标：
    //
    // 算法分析与设计 教西C2-201
    //
    // 这样 Apple Calendar 卡片上直接能看到教室。
    // =========================================================

    function buildSummary(activity) {
        const courseName =
            String(
                activity.courseName ?? ''
            ).trim();

        const room =
            formatRoom(activity);

        return room
            ? `${courseName} ${room}`
            : courseName;
    }


    // =========================================================
    // 10. Description
    //
    // 最终效果：
    //
    // 教师：陆伟
    // 周次：2-6周
    // 节次：第3-4节
    // =========================================================

    function buildDescription(activity) {
        const lines = [];

        const teachers =
            formatTeachers(activity);

        const weeks =
            formatWeeks(activity);

        const units =
            formatUnits(activity);

        if (teachers) {
            lines.push(
                `教师：${teachers}`
            );
        }

        if (weeks) {
            lines.push(
                `周次：${weeks}`
            );
        }

        if (units) {
            lines.push(
                `节次：${units}`
            );
        }

        return lines.join('\n');
    }


    // =========================================================
    // 11. 转换成实际事件
    // =========================================================

    function buildEvents(
        activities,
        semesterStartDate
    ) {
        const events = [];

        const dedupe =
            new Set();

        for (const activity of activities) {
            if (
                !activity.courseName ||
                !activity.startTime ||
                !activity.endTime ||
                !activity.weekday
            ) {
                continue;
            }

            const weeks =
                Array.isArray(
                    activity.weekIndexes
                )
                    ? activity.weekIndexes
                    : [];

            const room =
                formatRoom(activity);

            const summary =
                buildSummary(activity);

            const description =
                buildDescription(activity);

            for (const week of weeks) {
                const date =
                    calculateCourseDate(
                        semesterStartDate,
                        Number(week),
                        Number(activity.weekday)
                    );

                const event = {
                    courseName:
                        activity.courseName,

                    courseCode:
                        activity.courseCode ?? '',

                    summary,

                    location:
                        room,

                    description,

                    date,

                    startTime:
                        activity.startTime,

                    endTime:
                        activity.endTime
                };

                const key = [
                    event.courseCode,
                    event.summary,
                    event.location,
                    event.date,
                    event.startTime,
                    event.endTime
                ].join('|');

                if (dedupe.has(key)) {
                    continue;
                }

                dedupe.add(key);
                events.push(event);
            }
        }

        events.sort((a, b) => {
            return (
                `${a.date} ${a.startTime}`
                    .localeCompare(
                        `${b.date} ${b.startTime}`
                    )
            );
        });

        return events;
    }


    // =========================================================
    // 12. ICS 时间
    // =========================================================

    function toIcsDateTime(
        date,
        time
    ) {
        const datePart =
            date.replaceAll('-', '');

        const [
            hour = '00',
            minute = '00',
            second = '00'
        ] = time.split(':');

        return (
            datePart +
            'T' +
            hour.padStart(2, '0') +
            minute.padStart(2, '0') +
            second.padStart(2, '0')
        );
    }


    // =========================================================
    // 13. ICS TEXT Escape
    // =========================================================

    function escapeIcsText(value) {
        return String(value ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/\r?\n/g, '\\n')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,');
    }


    // =========================================================
    // 14. 稳定 UID
    // =========================================================

    function simpleHash(text) {
        let hash = 2166136261;

        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);

            hash = Math.imul(
                hash,
                16777619
            );
        }

        return (
            hash >>> 0
        ).toString(16);
    }


    // =========================================================
    // 15. RFC 5545 行折叠
    //
    // 每行最多约 75 octets
    // continuation line 以空格开头
    // =========================================================

    function foldIcsLine(line) {
        const encoder =
            new TextEncoder();

        if (
            encoder.encode(line).length <= 75
        ) {
            return line;
        }

        const result = [];

        let current = '';
        let limit = 75;

        for (const char of line) {
            const candidate =
                current + char;

            if (
                encoder.encode(candidate).length >
                limit
            ) {
                result.push(current);

                current =
                    ' ' + char;

                // continuation 行开头的空格也算 1 byte
                limit = 75;
            } else {
                current = candidate;
            }
        }

        if (current) {
            result.push(current);
        }

        return result.join('\r\n');
    }


    // =========================================================
    // 16. ICS Generator
    // =========================================================

    function generateIcs(events) {
        const rawLines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//NPU Course Table Exporter//ZH-CN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:西北工业大学课程表',
            'X-WR-TIMEZONE:Asia/Shanghai',

            'BEGIN:VTIMEZONE',
            'TZID:Asia/Shanghai',
            'X-LIC-LOCATION:Asia/Shanghai',
            'BEGIN:STANDARD',
            'TZOFFSETFROM:+0800',
            'TZOFFSETTO:+0800',
            'TZNAME:CST',
            'DTSTART:19700101T000000',
            'END:STANDARD',
            'END:VTIMEZONE'
        ];

        const now =
            new Date()
                .toISOString()
                .replace(/[-:]/g, '')
                .replace(/\.\d{3}Z$/, 'Z');

        for (const event of events) {
            const uidSource = [
                event.courseCode,
                event.courseName,
                event.location,
                event.date,
                event.startTime,
                event.endTime
            ].join('|');

            const uid =
                `${simpleHash(uidSource)}@npu-course-table`;

            rawLines.push(
                'BEGIN:VEVENT',

                `UID:${uid}`,

                `DTSTAMP:${now}`,

                `SUMMARY:${escapeIcsText(
                    event.summary
                )}`,

                `LOCATION:${escapeIcsText(
                    event.location
                )}`,

                `DESCRIPTION:${escapeIcsText(
                    event.description
                )}`,

                `DTSTART;TZID=Asia/Shanghai:${toIcsDateTime(
                    event.date,
                    event.startTime
                )}`,

                `DTEND;TZID=Asia/Shanghai:${toIcsDateTime(
                    event.date,
                    event.endTime
                )}`,

                'END:VEVENT'
            );
        }

        rawLines.push(
            'END:VCALENDAR'
        );

        return (
            rawLines
                .map(foldIcsLine)
                .join('\r\n') +
            '\r\n'
        );
    }


    // =========================================================
    // 17. 下载 ICS
    // =========================================================

    function downloadIcs() {
        if (!activities) {
            showToast(
                '尚未获取到课程表，请刷新课表页面',
                'error'
            );
            return;
        }

        const semesterStartDate =
            getSemesterStartDate();

        if (!semesterStartDate) {
            showToast(
                '无法识别学期起始日期',
                'error'
            );
            return;
        }

        const events =
            buildEvents(
                activities,
                semesterStartDate
            );

        if (!events.length) {
            showToast(
                '没有找到可导出的课程',
                'error'
            );
            return;
        }

        const ics =
            generateIcs(events);

        const blob =
            new Blob(
                [ics],
                {
                    type:
                        'text/calendar;charset=utf-8'
                }
            );

        const url =
            URL.createObjectURL(blob);

        const link =
            document.createElement('a');

        const semesterName =
            getSemesterName();

        link.href = url;

        link.download =
            semesterName
                ? `西北工业大学_${semesterName}_课程表.ics`
                : `西北工业大学_课程表_${semesterStartDate}.ics`;

        document.body.appendChild(link);

        link.click();
        link.remove();

        setTimeout(
            () => URL.revokeObjectURL(url),
            1000
        );

        showToast(
            `导出完成：${events.length} 次课程`,
            'success'
        );
    }


    // =========================================================
    // 18. Button
    // =========================================================

    function ensureExportButton() {
        if (exportButton?.isConnected) {
            return;
        }

        if (!document.body) {
            return;
        }

        exportButton =
            document.createElement('button');

        exportButton.id =
            '__npu_ics_export_button__';

        exportButton.disabled = true;

        Object.assign(
            exportButton.style,
            {
                position: 'fixed',
                right: '24px',
                bottom: '24px',
                zIndex: '2147483647',

                border: 'none',
                borderRadius: '8px',

                padding:
                    '10px 18px',

                background:
                    '#8c8c8c',

                color: '#fff',

                fontSize: '14px',
                fontWeight: '500',

                cursor:
                    'default',

                boxShadow:
                    '0 4px 16px rgba(0,0,0,.18)',

                transition:
                    'all .2s ease'
            }
        );

        exportButton.addEventListener(
            'click',
            downloadIcs
        );

        document.body.appendChild(
            exportButton
        );

        updateExportButton();
    }


    function updateExportButton() {
        if (!exportButton) {
            return;
        }

        if (activities) {
            exportButton.disabled =
                false;

            exportButton.textContent =
                '导出课程表 ICS';

            exportButton.style.background =
                '#1677ff';

            exportButton.style.cursor =
                'pointer';

        } else {
            exportButton.disabled =
                true;

            exportButton.textContent =
                '等待课程表数据…';

            exportButton.style.background =
                '#8c8c8c';

            exportButton.style.cursor =
                'default';
        }
    }


    // =========================================================
    // 19. Toast
    // =========================================================

    function showToast(
        message,
        type = 'info'
    ) {
        if (!document.body) {
            return;
        }

        let toast =
            document.getElementById(
                '__npu_ics_toast__'
            );

        if (!toast) {
            toast =
                document.createElement('div');

            toast.id =
                '__npu_ics_toast__';

            Object.assign(
                toast.style,
                {
                    position: 'fixed',
                    right: '24px',
                    bottom: '76px',
                    zIndex: '2147483647',

                    padding:
                        '10px 14px',

                    borderRadius:
                        '8px',

                    color:
                        '#fff',

                    fontSize:
                        '13px',

                    boxShadow:
                        '0 4px 16px rgba(0,0,0,.18)',

                    transition:
                        'opacity .2s ease'
                }
            );

            document.body.appendChild(
                toast
            );
        }

        const backgrounds = {
            success: '#16a34a',
            error: '#dc2626',
            info: '#1677ff'
        };

        toast.style.background =
            backgrounds[type] ??
            backgrounds.info;

        toast.textContent =
            message;

        toast.style.opacity =
            '1';

        clearTimeout(
            toast.__hideTimer
        );

        toast.__hideTimer =
            setTimeout(() => {
                toast.style.opacity =
                    '0';
            }, 3000);
    }


    // =========================================================
    // 20. DOM 初始化
    // =========================================================

    function initDomObserver() {
        const tryInit = () => {
            if (!document.body) {
                return false;
            }

            if (activities) {
                ensureExportButton();
            }

            return true;
        };

        if (tryInit()) {
            return;
        }

        const observer =
            new MutationObserver(() => {
                if (tryInit()) {
                    observer.disconnect();
                }
            });

        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );
    }

    initDomObserver();

})();
