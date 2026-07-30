# Bangumi Watch Planner

本地追番与补番计划应用。它通过 Bangumi OAuth 同步收藏，在 SQLite 中缓存番剧与分集，按 ACG Secrets 放送时间区分本季度追番和旧番补番，并在每天 20:00 通过 macOS 发送一条汇总通知。

## 页面与收藏状态

顶部固定为四个视图：

- **追番提醒**：仅显示活动季度内 Bangumi“在看”的动画，以及已经播出但未看的本篇集数。
- **补番计划**：显示今天任务、未来七天、进行中、搁置和已完成的旧番。
- **想看**：显示 Bangumi“想看”动画，可按名称和年份筛选。
- **每日放送**：显示 Bangumi 每日放送表和校正后的具体时间。

收藏状态映射：

| Bangumi 状态 | 本地用途 |
| --- | --- |
| `1` 想看 | 只进入想看列表，不会自动改为在看 |
| `3` 在看 + 活动季度 | 追番提醒 |
| `3` 在看 + 非活动季度 | 补番进行中 |
| `4` 搁置 | 补番搁置 |
| `2` 看过 | 补番已完成 |

想看中的本季度动画显示“开始追番”，旧番显示“加入补番”。只有手动点击按钮才会把它改为 Bangumi“在看”。

## 补番排期规则

每天的容量只由当天新播出的追番集数决定：

| 当天新番 | 补番容量 |
| --- | --- |
| 0–1 集 | 2 集 |
| 2–4 集 | 1 集 |
| 超过 4 集 | 0 集 |

多部旧番按公平轮转排期，例如 `A1, B1, C1, A2`。一天有两个名额时，只要有两部可选，就优先安排不同番剧。

- 自动同步会锁定今天已有任务，只重排明天到第七天。
- 没完成的历史任务不会变成逾期，会回到候选队列。
- “换一部”只替换当前任务；“今天跳过”清空今天；“重新规划今天”会明确解锁并重排今天。
- 标记今天任务已看、暂停番剧或手动完成时，会清理对应的锁定任务并补位。
- 页面只显示动态“预计完成”日期，不把它作为期限。
- 只安排 `episode.type === 0` 的本篇；SP、OVA、OP、ED 不占名额，也不参与自动完成。
- API 给出可信总集数、已获取足够本篇且全部看完时，自动改为“看过”。总集数未知时不会自动完成，可手动完成。

## 季度与时间

季度数据来自 [ACG Secrets](https://acgsecrets.hk/bangumi/)，以该季度最早的正常首播日为起点。新季度开始后的 14 个自然日内，新旧两季度可以共存；第 15 天仍在看的旧季度动画转入补番。跨季续播标记的动画继续留在追番。

提前放送和预览不作为季度起点。`25:00` 等 30 小时制时间会换算为上海时区次日 `01:00`，再参与星期、日期和每日负载计算。

## 准备 Bangumi OAuth

1. 在 [Bangumi 开发者平台](https://bgm.tv/dev)创建应用。
2. 回调地址填写：

   ```text
   http://127.0.0.1:3777/auth/callback
   ```

3. 启动应用，在追番提醒底部的“设置”中填写 Bangumi App ID 和 App Secret。
4. 点击“连接 Bangumi”，在 bgm.tv 完成授权。回调后应用会自动同步。

也可以使用本地环境文件：

```bash
cp .env.example .env.local
```

```text
BANGUMI_CLIENT_ID=你的 App ID
BANGUMI_CLIENT_SECRET=你的 App Secret
```

## 启动

开发模式：

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。

生产模式：

```bash
npm run build
npm start
```

打开 `http://127.0.0.1:3777`。

## Bangumi 登录

首次打开时直接使用 Bangumi OAuth 登录，不需要设置本地访问密码。若尚未配置开发者应用，页面会先要求填写 Bangumi App ID 和 App Secret。

OAuth 授权成功后会立即返回首页，首次数据同步在后台继续，不阻塞登录跳转。

## 内网访问

生产服务默认监听 `0.0.0.0:3777`。查询 Mac 的内网地址：

```bash
ipconfig getifaddr en0
```

假设输出 `192.168.1.23`，同一局域网设备可打开 `http://192.168.1.23:3777/`。如只允许本机访问，在 `.env.local` 设置：

```text
HOST=127.0.0.1
```

OAuth 回调仍使用 `http://127.0.0.1:3777/auth/callback`，重新授权时应在运行服务的 Mac 上操作。同一局域网设备不会再遇到额外的本地密码页面。

## 后台提醒

安装 LaunchAgent，让服务在登录后常驻：

```bash
bash scripts/install-launch-agent.sh
```

卸载：

```bash
bash scripts/uninstall-launch-agent.sh
```

默认每天 `20:00 Asia/Shanghai` 先同步，再发送一条通知。通知包含“今日新番待看”，有补番任务时再附加“今日补番计划”；同一天只发送一次。可在 `.env.local` 调整：

```text
REMINDER_CRON=0 20 * * *
NOTIFICATIONS_ENABLED=true
```

## 隐私

- Bangumi App Secret 只保存在本机环境文件或本地设置。
- refresh token 保存在 macOS Keychain；access token、refresh token 和本地写入令牌不会进入前端或 Git。
- 不需要也不会保存 Bangumi 账号密码。
- `.env.local`、SQLite 数据库和运行日志不应提交到仓库。

## 验证

```bash
npm test
npm run lint
npm run build
```
