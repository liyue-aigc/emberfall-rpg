# Emberfall Leaderboard API

Vercel Function + Neon Postgres 实现的全服排行榜后端。

## 接口

- `GET /api/leaderboard?type=score&limit=20`：单局最高分榜
- `GET /api/leaderboard?type=points&limit=20`：累计积分榜
- `POST /api/leaderboard`：提交对局统计，服务端重新计算积分

服务端支持同一 `runId` 增量提交：章节通关和最终死亡可以重复提交，但累计积分只增加本局的新分数。

## 环境变量

使用 Vercel Marketplace Neon 注入的数据库连接变量：

- `DATABASE_URL`（推荐）
- `POSTGRES_URL`
- `DATABASE_URL_UNPOOLED`

首次请求会自动创建独立的玩家、对局去重和限流数据表。
