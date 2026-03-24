# 模型状态公开看板

这是一个独立的只读状态页，给没有后台权限的人查看模型状态和 CPA 号池摘要。

## 特性

- 无需登录
- 浏览器不持有上游 JWT 或 CPA Token
- 服务端聚合 CPA 号池数据，不向前端暴露原始 auth-files
- 展示系统摘要、CPA 号池、模型状态、24h 请求排行、只读配置
- 支持 Docker / Docker Compose 部署

## 目录结构

```text
model-status-public/
├── app.py
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .env.example
└── www/
    ├── index.html
    ├── app.js
    └── styles.css
```

## 部署步骤

1. 复制环境变量文件：

```bash
cp .env.example .env
```

2. 修改 `.env`：

```env
PUBLIC_PORT=8080
UPSTREAM_BASE=http://10.255.200.17:11145
UPSTREAM_JWT=你的有效JWT
CPA_BASE_URL=http://你的CPA地址
CPA_TOKEN=你的有效CPA_TOKEN
CPA_TARGET_TYPE=codex
CPA_MIN_CANDIDATES=800
REQUEST_TIMEOUT=15
```

3. 启动：

```bash
docker compose up --build -d
```

4. 打开页面：

```text
http://localhost:8080
```

## 页面数据来源

### 模型状态相关

- `GET /proxy/model-status/config`
- `GET /proxy/model-status/models`
- `POST /proxy/model-status/status?window=6h`
- `GET /proxy/system/warmup`
- `GET /proxy/health/db`

### CPA 号池相关

- `GET /proxy/cpa/pool-status`

服务端内部逻辑：

1. 请求 `GET {CPA_BASE_URL}/v0/management/auth-files`
2. 读取返回里的 `files`
3. 按 `type`，若无则按 `typo` 过滤
4. 统计 `CPA_TARGET_TYPE`（默认 `codex`）的数量
5. 只把汇总结果返回给前端，不返回原始 `files`

## CPA 展示字段

- `total`: 全部 auth-files 数量
- `candidates`: 目标类型账号数量
- `error_count`: 非目标类型数量
- `threshold`: 阈值
- `healthy`: 是否达标
- `percent`: 当前数量 / 阈值
- `last_checked`: 最近检查时间

## 验证点

- 页面可直接打开，无登录页
- 浏览器请求只访问当前服务的 `/proxy/...`
- `localStorage` / `sessionStorage` 中不出现上游 JWT 或 CPA Token
- 浏览器拿不到 CPA 原始 `auth-files`
- 模型状态、CPA 号池、排行、系统摘要、配置都能正常展示

## 备注

- 当前方案适合内网只读展示
- 如果 JWT 或 CPA Token 失效，页面会显示加载失败或 CPA 异常提示
