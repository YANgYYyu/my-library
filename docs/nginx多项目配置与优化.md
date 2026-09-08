# nginx 配置（my-library 8001 + 另一项目 8000，单端口 80）

日期：2026-09-08
确认条件：无域名、另一个项目不需要 WebSocket、无大文件上传、尽量只用一个端口。

---

## 0. 一个必须纠正的点

现在 `sites-available/my-library` 里**同时存在** `root /data/apps/my-library/public;`
和 `proxy_pass http://127.0.0.1:8001;`。

`location /` 一旦配了 `proxy_pass`，`root` 就完全不生效——它是**残留的死配置**，
只会误导排查（我上一轮就是被它带偏，误判成"root 指错"）。
**删掉 `root`，只留 `proxy_pass`。**

---

## 1. 方案选定

端口 80 是一个监听套接字，同一时刻只能由一个 `server` 块按 Host 分流，
所以"同一个 URL 既给 8001 又给 8000"做不到。要区分两个项目必须引入额外维度：

| 方案 | 访问方式 | 可行性 |
| --- | --- | --- |
| ① 域名区分 | `lib.a.com` / `app.a.com` | 最干净，但**没有域名**，排除 |
| ② 端口区分 | `http://IP/` + `http://IP:8080/` | 可行，作退路（第 3 节） |
| **③ 路径前缀** | `http://IP/lib/` + `http://IP/app/` | **已选定** |

### 为什么 ③ 对 my-library 是可行的

已核对：`index.html` 与 `app.js` **没有任何绝对路径引用**。

```
index.html:   href="style.css"   src="vendor/marked.min.js"   src="app.js"
app.js:       fetch('data.json')
```

全是相对路径，浏览器按当前目录解析：访问 `/lib/` 时会去找 `/lib/style.css`、
`/lib/data.json`，正好落回同一个 `location`。
**若是 `/style.css` 这种绝对路径，子路径方案当场失效**——很多站点就死在这一条上，
my-library 天然支持。

---

## 2. 最终配置（方案 ③）

`/etc/nginx/sites-available/my-library`，**整份替换**：

```nginx
server {
    listen 80 default_server;
    server_name _;

    access_log /var/log/nginx/my-library.access.log;
    error_log  /var/log/nginx/my-library.error.log;

    # 根路径送到 my-library
    location = / {
        return 301 /lib/;
    }

    # ---- my-library → 8001 ----
    location = /lib {
        return 301 /lib/;
    }
    location /lib/ {
        # 结尾的 / 是关键：把 /lib/ 前缀剥掉再转发，
        # 上游收到的仍是 /、/app.js、/data.json
        proxy_pass http://127.0.0.1:8001/;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 5s;
        proxy_read_timeout    30s;
    }

    # ---- 另一个项目 → 8000 ----
    location = /app {
        return 301 /app/;
    }
    location /app/ {
        proxy_pass http://127.0.0.1:8000/;

        # 上游若返回 Location: /login，改写成 /app/login，
        # 否则浏览器会跳到 http://IP/login 直接 404
        proxy_redirect / /app/;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 5s;
        proxy_read_timeout    60s;
    }
}
```

> ⚠️ 两个 `proxy_pass` 结尾**必须带 `/`**。
> 写成 `proxy_pass http://127.0.0.1:8001;`（不带斜杠）时，nginx 会把完整 URI
> `/lib/app.js` 原样转发给上游，上游返回 404。这是本方案最常见的翻车点。

> 未写 `listen [::]:80` —— 服务器若未启用 IPv6，这行会让 nginx 起不来。

### 2.1 风险点在另一个项目，不在 my-library

my-library 已验证可用；剩下要看**另一个项目是否也只用相对路径**：

| 上游行为 | 后果 | 处理 |
| --- | --- | --- |
| HTML 里 `<script src="/static/app.js">`（绝对路径） | 浏览器请求 `/static/app.js`，无 location 命中 → 404 | `sub_filter` 改写，或给应用配 base path |
| 后端 302 到 `/login` | 跳到 `/login` → 404 | 已用 `proxy_redirect / /app/;` 兜住 |
| Cookie 带 `Path=/` | 两个项目的 cookie 互相踩 | 配 cookie path，或退回方案 ② |
| 前端用 History 路由 | 刷新子路由 404 | 加 `try_files` 或改 hash 路由 |

**最稳的做法**：给应用本身配根路径，比在 nginx 里改写可靠得多。
常见写法：Django `FORCE_SCRIPT_NAME`、Flask `APPLICATION_ROOT`、
FastAPI `root_path`、Rails `RAILS_RELATIVE_URL_ROOT`。

**验证**：浏览器打开 `http://IP/app/`，F12 Network 里
**有没有 `/static/...`、`/api/...` 这类不带 `/app/` 前缀的 404**。
只要出现一个就说明它不兼容，直接退回第 3 节的方案 ②，别在 nginx 里硬改。

### 2.2 部署与验证

```bash
# 1. 备份
sudo cp /etc/nginx/sites-available/my-library /etc/nginx/sites-available/my-library.bak

# 2. 编辑（把上面那份配置整份替换进去）
sudo nano /etc/nginx/sites-available/my-library

# 3. 检查并重载
sudo nginx -t
sudo systemctl reload nginx

# 4. 验证（注意 heredoc 后面别挂 &&，会被吞掉）
curl -s -o /dev/null -w "/           %{http_code}\n" http://127.0.0.1/
curl -s -o /dev/null -w "/lib/       %{http_code}\n" http://127.0.0.1/lib/
curl -s -o /dev/null -w "/lib/app.js %{http_code}\n" http://127.0.0.1/lib/app.js
curl -s -o /dev/null -w "/lib/data   %{http_code}\n" http://127.0.0.1/lib/data.json
curl -s -o /dev/null -w "/app/       %{http_code}\n" http://127.0.0.1/app/
```

预期：`/` 是 301（跳 `/lib/`），其余全是 200。
`/lib/app.js` 若 404，先确认 `proxy_pass` 结尾那个 `/` 有没有写。

---

## 3. 退路：方案 ② 端口区分

若另一个项目不兼容子路径，改成：`/` → my-library（80），`8080` → 另一个项目。

my-library 的 `location /` 换成：

```nginx
    location / {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout    30s;
    }
```

另一个项目单独一个文件 `/etc/nginx/sites-available/other-app`：

```nginx
server {
    listen 8080;
    server_name _;

    access_log /var/log/nginx/other.access.log;
    error_log  /var/log/nginx/other.error.log;

    location / {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout    60s;
    }
}
```

```bash
sudo ln -sf /etc/nginx/sites-available/other-app /etc/nginx/sites-enabled/other-app
sudo nginx -t && sudo systemctl reload nginx
sudo ufw allow 8080/tcp && sudo ufw reload     # 云服务器还要在安全组放行
```

---

## 4. nginx.conf 优化

现在这份是 Debian 默认模板，**最大的问题是 `gzip_types` 整行被注释掉了**——
`gzip on` 默认只压缩 `text/html`，`app.js`(23KB)、`style.css`(18KB)、
`data.json`(20KB) 一个都没压。

`http {}` 内改这几处：

```nginx
    ##
    # Gzip Settings
    ##
    gzip on;
    gzip_vary on;
    gzip_proxied any;          # 走反代时必需，否则上游响应不压缩
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_buffers 16 8k;
    gzip_http_version 1.1;
    gzip_types
        text/plain
        text/css
        text/xml
        application/json
        application/javascript
        application/xml+rss
        text/javascript
        image/svg+xml;

    server_tokens off;
```

另外建议：

| 项 | 现状 | 建议 | 原因 |
| --- | --- | --- | --- |
| `ssl_protocols` | 含 `TLSv1 TLSv1.1` | 只留 `TLSv1.2 TLSv1.3` | 1.0/1.1 已作废，有审计风险 |
| `worker_connections` | 768 | 1024 | 调高不花钱 |
| 日志 | 全站一个文件 | 每个 server 单独一份 | 两个项目混在一起排查会互相干扰 |

无 WebSocket、无大文件上传，所以**不需要** `map $http_upgrade` 和
`client_max_body_size`。

改完：`sudo nginx -t && sudo systemctl reload nginx`。

---

## 5. 验证清单

```bash
# 语法与监听
sudo nginx -t
sudo ss -lntp | grep -E ':80 |:8000|:8001'

# 资源可达性
curl -s -o /dev/null -w "%{http_code}  %{content_type}  %{size_download}B\n" http://127.0.0.1/lib/
curl -s -o /dev/null -w "%{http_code}  %{content_type}  %{size_download}B\n" http://127.0.0.1/lib/app.js
curl -s -o /dev/null -w "%{http_code}  %{content_type}  %{size_download}B\n" http://127.0.0.1/lib/data.json

# gzip 是否真的生效
curl -sI -H "Accept-Encoding: gzip" http://127.0.0.1/lib/app.js | grep -i content-encoding

# 版本号是否已隐藏
curl -sI http://127.0.0.1/lib/ | grep -i server
```

出问题按顺序排查：`nginx -t` → `ss -lntp` 有没有 LISTEN →
`curl 127.0.0.1` 本机通不通 → `tail /var/log/nginx/my-library.error.log`。
