---
intro: 把 Vite/React 单页应用（SPA）挂在 nginx 子路径（如 /teacher/）下时，用「症状 → 根因」映射表在几分钟内定位 502 / 404 / 白屏 / 接口失败，并给出 nginx 侧与前端侧两套互斥的修法。
---

# SPA 子路径部署（nginx 反代）排查与配置

## 核心原理

子路径部署有两个独立的前缀，**必须分开想**：

1. **nginx → 后端**：`proxy_pass` 决定 URI 前缀剥不剥。带尾斜杠 `proxy_pass http://127.0.0.1:9001/;` 会剥掉 `location` 前缀；不带则原样透传。
2. **浏览器 → 资源**：HTML 里的资源 URL、JS 里的接口 baseURL、路由 basename——这三者只要有一个是「站点根绝对路径」，就会绕过子路径前缀。

Vite 默认 `base: '/'`，所以构建产物里是 `<script src="/assets/index-xxx.js">` —— 这是**白屏的头号原因**（浏览器去请求 `http://IP/assets/...`，不经过子路径）。

## 症状 → 根因映射表

| 现象 | 唯一根因 | 验证方法 |
|---|---|---|
| 502 Bad Gateway | nginx 连不上上游（进程没起/端口不对/SELinux） | `error.log` 看报文：`111 Connection refused`=没监听、`13 Permission denied`=SELinux、`prematurely closed`=上游崩、`timed out`=其实 504 |
| 404（页面本身） | `proxy_pass` 少了尾斜杠，前缀没剥掉，后端收到 `/xxx/...` | `error.log` 里 `upstream: "http://127.0.0.1:9001/xxx/"` 带前缀即坐实 |
| **白屏/空白页**（HTML 200 但无内容） | 产物引用绝对 `/assets/...`，浏览器绕过前缀 → JS 404 → 挂载点空 | `curl` 后端 index.html 看 `src="/assets/..."`；F12 Network 里该 js 的完整 URL 是 `http://IP/assets/...` 且 404 |
| 页面能开、所有接口 404/失败 | axios `baseURL` 是 `/api`（站点根绝对路径） | F12 Network 看接口 URL 是否缺了子路径前缀 |
| 点击菜单跳飞（跳到 `http://IP/mood`） | React Router `BrowserRouter` 没设 `basename` | 看路由组件是否 `<BrowserRouter basename="/xxx">` |
| favicon 404 | `index.html` 里图标路径与产物文件名不一致 | `ls dist/` 对比 |

### ⚠️ `200 + text/html` 有两个根因，别只想到尾斜杠

子路径请求返回 **200 且 `Content-Type: text/html`**（而不是 404/401）时，要么
**（a）前缀没剥**（后端静态兜底路由把未知路径返回了 index.html），要么
**（b）请求压根没进你改的那个 server/location** —— 同一台 nginx 上还有别的站点时，
它的 `location /` + `try_files ... /index.html` 会对**任何**路径都回 200 + 它自己的首页。

**注意顺序**：先确认「配置是否已生效」，再怀疑配置本身。`nginx -T` 读的是**文件内容**，
不代表运行中的进程已经用了它——改了配置忘 reload 时，`nginx -T` 会显示出正确的新配置，
但线上跑的仍是旧配置。判定：

```bash
stat -c '%y  %n' /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf   # 配置改于何时
ps -o pid=,lstart=,cmd= -C nginx | head -3                       # nginx 进程起于何时
# 进程启动时间早于配置修改时间 → 没 reload
```

**三招分辨 (a) / (b) / 没 reload**：

> 更直接的一招：给可疑的 location 临时加一个 `add_header X-Loc teacher-proxy always;`，
> reload 后看响应头有没有 `X-Loc` —— 没有就证明**命中的不是这个 location**（用完记得删）。

```bash
# ① 看响应到底是谁给的（关键：有没有 gunicorn 的 Server 头、<title> 是不是本站）
#    ⚠️ 必须看**完整**响应头，不能 `| head -6`：nginx 会先输出自己的 `Server: nginx`，
#    再追加上游的 `Server: gunicorn`。截断输出会漏掉第二条，导致误判成「没走后端」。
curl -s -D - -o /tmp/b.html http://127.0.0.1/teacher/api/auth/me
grep -iE '^(server|vary)' /tmp/b.html
grep -o '<title>[^<]*</title>' /tmp/b.html
#   两条 Server 头（nginx + gunicorn）→ 请求到了后端 → 前缀没剥 = 命中错误 location
#   只有 `Server: nginx` 一条且 title 是本站 → nginx 自己从磁盘返回了 index.html
#   （说明有个 root/alias + try_files 的静态 location 在服务该路径）
#   只有 nginx 一条且 title 是**别的站** → 走错了 server 块

# ①' 更硬的决定性判据：看后端到底收到了什么路径
tail -n 5 <项目>/server/gunicorn.log      # 先记住当前末尾
curl -s -o /dev/null http://127.0.0.1/teacher/api/auth/me
tail -n 5 <项目>/server/gunicorn.log      # 再看新行
#   出现 `GET /teacher/api/auth/me` → 前缀未剥（ngin x 命中了无尾斜杠的 proxy_pass）
#   完全没有新行 → 请求根本没到后端（nginx 静态服务或别的站点接管了）

# ② 用正确的 Host 头复测（多站点时 IP 访问会落到默认块）
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H 'Host: <真实域名>' \
  http://127.0.0.1/teacher/api/auth/me
#   换 Host 后变成 401 application/json → 就是 server 块/server_name 匹配问题

# ③ 列出所有 server/location，找抢占者（正则 location 优先级高于前缀 location；
#    同一个 server 块内不允许重复 location，但**不同 server 块可以各写一份 /xxx/**）
nginx -T 2>/dev/null | grep -nE '^\s*(server\s*\{|server_name|listen|location|root|alias|try_files|proxy_pass)'
nginx -T 2>/dev/null | grep -n 'xxx' -B 25 | grep -E 'server_name|listen|location|root|alias|try_files|proxy_pass'
```


## 第 0 步：先确认端口的架构角色（否则一开始就查错方向）

拿到 `Connection refused` 别急着怀疑云安全组——它只说明「该端口没有进程在 listen」，
**分不清**「这个端口本就不对外开放」和「该对外但应用挂了」。先跑这三条定性：

```bash
ss -ltnp | grep -E ':<端口>'                          # 谁在 listen，一眼看清
nginx -T 2>/dev/null | grep -cE 'listen[^;]*<端口>'   # 0 = 不是对外监听端口
nginx -T 2>/dev/null | grep -nE "proxy_pass.*<端口>"   # 有输出 = 它是 nginx 的上游
```

**判据：某端口只出现在 `proxy_pass` 里、从不出现在 `listen` 里 ⇒ 它只给 nginx 在服务器
本机内部用，直连必然 refused——这是预期行为，不是故障。** 正确入口是 nginx 的对外地址。

典型的白忙一场：看到 `IP:9001` refused → 去云控制台放行 9001 端口 —— 而 9001 从头到尾
就不对外监听，放行了也没用。此时真正的故障点是**上游应用有没有在跑**。

## 排查顺序（三步，哪步断了就停在那）

```bash
# 1) 后端 HTML 本身正常吗（在服务器本机，绕开 nginx）
curl --noproxy '*' -s http://127.0.0.1:9001/ | head -20
#   · 看到 <!doctype html> + /assets/...  → 后端 OK，问题在资源路径/nginx
#   · 看到 {"error":"Frontend not built..."} → dist 不存在，前端构建失败

# 2) 产物里的资源前缀是什么（决定要不要改 vite base）
grep -o 'src="[^"]*"' server/dist/index.html

# 3) 浏览器 F12 → Console 有无 404/module 加载失败；Network 看 assets 请求的完整 URL
#    这一步是判断「白屏」最快的，别无脑重启服务
```

## 修法 A：nginx 侧补 location（不改前端、不用重构建，最快）

```nginx
location /teacher { return 301 /teacher/; }
location /teacher/ {
    proxy_pass http://127.0.0.1:9001/;          # 尾斜杠必须有
    proxy_redirect / /teacher/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location /assets/ { proxy_pass http://127.0.0.1:9001/assets/; }   # 兜住绝对路径资源
location /api/    { proxy_pass http://127.0.0.1:9001/api/; }      # 兜住绝对路径接口
```

代价：`/assets/`、`/api/` 两个**根路径被占用**，同 IP 上若有其他站点会冲突。

## 修法 B：前端按子路径重配 + 重构建（推荐，长期干净）

三处**必须同时改**，缺一个就换一种坏法：

1. `vite.config.js` → `base: '/teacher/'`
2. `.env` → `VITE_API_BASE_URL=/teacher/api`
3. 路由入口 → `<BrowserRouter basename="/teacher">`

然后重新构建并部署（本项目：`./run_server.sh start` 会自动重建并替换 `server/dist/`）。

## 关键环境坑

- **测本机端口一律 `curl --noproxy '*'`**：本机设了 `HTTP_PROXY` 时，curl 打 `127.0.0.1:<port>` 会被代理拦成 `502 Bad Gateway`，极易误判成「服务没起来」。
- **`80` 返回 nginx 出厂欢迎页（`Welcome to nginx!`，约 615 字节，`Last-Modified` 停在安装日期）
  ≠ 自定义配置丢失**。它只说明请求落到的那个 `server{}` 里 `root` 为空/不存在，
  且**没有任何 `location` 命中 `/`**，nginx 于是回退到编译期默认的 `html/` 目录。
  **只要 `nginx -T` 里还能看到你自己的 `proxy_pass` / `server_name`，配置就在**——
  修法是把根路径导到正确前缀（`location = / { return 301 /xxx/; }`），
  **不是**去恢复 `sites-available` 或重装 nginx。判断「是否真被重装」要看
  `grep -i nginx /var/log/dpkg.log | tail` 和 `sites-enabled/` 软链时间戳，不看首页长相。
- **`nginx -t` 通过 ≠ 配置生效**，必须 reload；反之 502 而不是 404 说明 location 已生效。
- **`location = /path {` 等号两侧必须有空格**，否则 `=/path` 被当成普通前缀 URI，静默失效（现象是带尾斜杠正常、不带 404）。
- 后端若用「catch-all 返回 index.html」的 SPA 兜底，**HTML 能拿到不代表资源能拿到**——白屏往往正是这种情况。
