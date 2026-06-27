# 联盟成员与 Sky 到位查询

这是一个纯静态前端，适合直接部署到 GitHub Pages。页面不会读取 API key，不调用模型接口，也不需要后端。

## 文件说明

部署时提交这个文件夹内的文件即可：

```text
index.html          联盟目录查询页
app.js              联盟目录/成员统计逻辑
alliances.txt       联盟目录数据
members.txt         联盟成员数据
sky.html            Sky兵工厂/堡垒页面
sky.js              Sky到位情况解析逻辑
sky_fortress.txt    Sky兵工厂/堡垒数据
styles.css          共用样式
README.md           说明
.gitignore          Git忽略规则
```

日常主要维护三个数据文件：

```text
alliances.txt       联盟清单
members.txt         联盟成员
sky_fortress.txt    Sky兵工厂/堡垒
```

## 联盟成员数据格式

`alliances.txt` 维护联盟目录：

```text
[CDC]长冬彻
[Sky]酒鬼联盟
[Ami]种花家
[001]江湖故事
[KUU]望月楼
```

`members.txt` 维护具体人员：

```text
[联盟]当前名，ID，曾用名
[CDC]小妖࿐,1059855909
[CDC]黑白࿐，1060757307
[CDC]小～趴～菜，1057858649，擎天柱
[AMI]示例成员，1234567890
```

说明：

- 英文逗号 `,` 和中文逗号 `，` 都支持。
- 曾用名可以为空。
- 搜索支持 ID、当前名、曾用名、联盟。
- 页面会按 `alliances.txt` 显示联盟目录，并用 `members.txt` 统计成员数。
- `#` 和 `//` 开头的行会被当作注释忽略。

旧的 `black_name.txt` 已不再使用。

## Sky 数据格式

`sky_fortress.txt` 支持：

```text
兵工厂情况：人数，车头，车身，名称，到位条件
（2）车头：天，猫
（2）机动车头：郎君，毛豆
（21）车身：噜噜（包去），大角鹿（在线就去）
冬瓜（冰工厂包去，要塞在线就去）
兔子（难说）
```

说明：

- `（人数）分组：成员1，成员2` 会被解析为一个分组。
- `成员名（条件）` 会解析出到位条件。
- 没有分组前缀的成员行会归入上一行的分组，例如紧跟在 `车身` 后面的补充成员会归入 `车身`。
- 如果标注人数和实际解析人数不一致，页面底部会提示格式提示。

如果要让某些 Sky 分组固定排在前面，改 `sky.js` 顶部：

```js
pinnedRoles: ["车头", "机动车头", "车身"],
```

## 是否需要单独新建基础查询文件

建议单独维护这些数据文件：

```text
alliances.txt       联盟目录
members.txt         联盟成员
sky_fortress.txt    Sky兵工厂/堡垒
```

原因是两类数据格式不同。联盟成员是结构化成员表，Sky 页面是到位条件表。分开维护最稳，也方便后续 GitHub Pages 直接发布。

这里没有后端“接口”。所谓入口就在各 JS 文件顶部：

```js
alliancesFile: "alliances.txt"
membersFile: "members.txt"
dataFile: "sky_fortress.txt"
```

浏览器打开页面后，会自动读取同目录的数据文件，然后在浏览器本地完成搜索、筛选和统计。

## 本地预览

在本目录运行：

```powershell
python -m http.server 8000
```

然后打开：

```text
http://localhost:8000/
```

Sky 页面：

```text
http://localhost:8000/sky.html
```
