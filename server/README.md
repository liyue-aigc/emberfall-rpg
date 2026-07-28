# Emberfall Leaderboard API

Vercel Function + Upstash Redis 实现的全服排行榜后端。

## 接口

- `GET /api/leaderboard?type=score&limit=20`：单局最高分榜
- `GET /api/leaderboard?type=points&limit=20`：累计积分榜
- `POST /api/leaderboard`：提交对局统计，服务端重新计算积分

服务端支持同一 `runId` 增量提交：章节通关和最终死亡可以重复提交，但累计积分只增加本局的新分数。

## 环境变量

支持 Vercel Marketplace Upstash Redis 注入的任一组变量：

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_URL` / `KV_REST_API_TOKEN`
- `REDIS_REST_URL` / `REDIS_REST_TOKEN`
