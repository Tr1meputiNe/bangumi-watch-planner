# Bangumi Watch Planner

本地追番计划提醒应用。它通过 Bangumi OAuth 获取你的“在看”动画，缓存到本机 SQLite，找出已播出但未看的本篇集数，并在每天 20:00 通过 macOS 通知提醒。

## 准备 Bangumi OAuth

1. 在 Bangumi 开发者平台注册应用。
2. 回调地址填写：

   ```text
   http://127.0.0.1:3777/auth/callback
   ```

3. 启动应用后，在页面底部“设置”里打开 Bangumi 开发者平台，创建应用，把页面显示的回调地址填到应用里，再把 Bangumi App ID 和 App Secret 填回软件。
4. 保存配置后点击“连接 Bangumi”，浏览器会跳到 bgm.tv，用你的 Bangumi 账号授权。授权回调后软件会自动同步该账号的在看动画列表。

也可以继续用 `.env.local` 预先配置，环境变量会优先于页面设置：

   ```bash
   cp .env.example .env.local
   ```

4. 编辑 `.env.local`：

   ```text
   BANGUMI_CLIENT_ID=你的 App ID
   BANGUMI_CLIENT_SECRET=你的 App Secret
   ```

refresh token 会写入 macOS Keychain，不会写入 `.env.local`。

## 开发运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`，在“设置”里保存 OAuth 信息，然后点击“连接 Bangumi”完成授权。授权回调后应用会自动同步当前 Bangumi 账号的在看动画列表。

## 生产运行

```bash
npm run build
npm start
```

打开 `http://127.0.0.1:3777`，在“设置”里保存 OAuth 信息，然后点击“连接 Bangumi”完成授权。

## 内网访问

服务默认监听 `0.0.0.0:3777`，同一局域网设备可以通过这台 Mac 的内网 IP 访问：

```bash
ipconfig getifaddr en0
```

如果输出为 `192.168.1.23`，其他设备打开：

```text
http://192.168.1.23:3777/
```

如果只想允许本机访问，在 `.env.local` 设置：

```text
HOST=127.0.0.1
```

OAuth 回调地址仍建议保持 `http://127.0.0.1:3777/auth/callback`，重新连接 Bangumi 时在这台 Mac 上操作；内网设备更适合查看列表、手动同步、标记看过。

## 后台提醒

安装 LaunchAgent，让服务在登录后常驻：

```bash
bash scripts/install-launch-agent.sh
```

卸载：

```bash
bash scripts/uninstall-launch-agent.sh
```

默认每天 20:00 Asia/Shanghai 同步并提醒。可在 `.env.local` 调整：

```text
REMINDER_CRON=0 20 * * *
NOTIFICATIONS_ENABLED=true
```

## 验证

```bash
npm test
npm run lint
npm run build
```
