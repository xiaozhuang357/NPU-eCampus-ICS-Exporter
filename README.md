# NWPU Timetable ICS Exporter

西北工业大学翱翔教务课表 ICS 导出用户脚本。

脚本在翱翔教务的学生页面读取课表请求数据，在页面右下角添加导出按钮，并将课程安排生成为 `.ics` 日历文件。导出内容包含课程名称、上课地点、教师、周次和节次。

## 安装

1. 在浏览器中安装支持 `unsafeWindow` 的用户脚本管理器，例如 Tampermonkey 或 Violentmonkey。
2. 在管理器中新建用户脚本，将 [`nwpu-timetable-ics-exporter.user.js`](nwpu-timetable-ics-exporter.user.js) 的内容粘贴进去并保存。
3. 登录[西北工业大学翱翔教务](https://jwxt.nwpu.edu.cn/)，打开学生端的“我的课表”页面。
4. 等待脚本获取课表数据，再点击页面右下角的“导出课程表 ICS”按钮。

## 使用说明

- 脚本会根据页面上的学期起始日期和课程周次计算每次课程的日期。
- 课表数据由教务页面原有请求提供，ICS 文件在浏览器中生成。
- 如果导出按钮一直处于等待状态，请刷新课表页面；如果提示无法识别学期起始日期，请确认页面显示了 `YYYY-MM-DD` 格式的学期起始日期。
- 将下载的 `.ics` 文件导入支持 iCalendar 的日历应用即可。
