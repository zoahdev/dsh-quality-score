# dsh-quality-score

[![npm](https://img.shields.io/npm/v/dsh-quality-score.svg)](https://www.npmjs.com/package/dsh-quality-score)

[![CI](https://github.com/zoahdev/dsh-quality-score/actions/workflows/ci.yml/badge.svg)](https://github.com/zoahdev/dsh-quality-score/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-verified-blue)](https://github.com/topics/dsh-plugin)

Quality scorecard for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugins: **0-100 score + grade + per-component breakdown**, with issues and fix suggestions.

Built on the same methodology as the [ecosystem supply-chain health scan](https://github.com/zoahdev/dsh-ecosystem/blob/main/docs/ecosystem-supply-chain-health-2026-08-18.md): manifest completeness, peer resolvability, dist-tag health (the #2763 class), dead ranges, freshness, and dsh-tools peer compatibility. Zero runtime dependencies, read-only.

## Install

```sh
dsh plugin add dsh-quality-score
```

Or run standalone:

```sh
npx dsh-quality-score dsh-dep-audit
```

## CLI

```sh
dsh-quality-score <npm-name> [--json]
dsh-quality-score --batch <names-file> [--json]
dsh-quality-score --batch-registry <registry.json> [--category <name>] [--json]
```

Prints the score, grade, component breakdown, issues and suggestions. `--batch` scores every package name in a file (one per line, `#` comments ignored) and prints a ranked leaderboard — the building block for a registry-wide quality table.

```sh
npx dsh-quality-score dsh-dep-audit
npx dsh-quality-score dsh-vault --json
npx dsh-quality-score --batch registry-names.txt
```

## In-harness usage (agent-callable)

Ask your dsh agent:

> 给这个插件打个质量分：`quality_score`，包名 dsh-dep-audit。
> Score this plugin: `quality_score` with `name` set to the npm package.

Returns a `dsh-quality-score/v1` report:

```json
{
  "schema": "dsh-quality-score/v1",
  "name": "dsh-dep-audit",
  "ok": false,
  "score": 65,
  "grade": "C",
  "components": [
    { "id": "manifest", "name": "Manifest completeness", "max": 20, "earned": 20, "note": "version 0.1.1" },
    { "id": "peer-resolvable", "name": "Peer resolvability", "max": 20, "earned": 20, "note": "1 peer range(s)" },
    { "id": "dist-tag", "name": "Dist-tag health", "max": 15, "earned": 15, "note": "latest=0.1.1" },
    { "id": "dead-ranges", "name": "Dead ranges", "max": 15, "earned": 15, "note": "none" },
    { "id": "freshness", "name": "Freshness", "max": 10, "earned": 10, "note": "2026-08-18" },
    { "id": "dsh-tools-peer", "name": "dsh-tools peer compat", "max": 10, "earned": 0, "note": "declared ^0.1.0-rc.6; dsh-tools latest=0.0.1-rc.1" }
  ],
  "issues": ["declared @deepseek-ai/dsh-tools peer range is contradicted by the broken latest dist-tag (#2763 class)"],
  "suggestions": ["Install with @deepseek-ai/dsh-tools@0.1.0-rc.7 (or the matching rc) until the official latest is fixed"],
  "error": null
}
```

## Components

| Component | Max | What it measures |
|---|---|---|
| `manifest` | 20 | name / version / description / license present in the latest version |
| `peer-resolvable` | 20 | every peer range has a published match |
| `dist-tag` | 15 | latest vs next mismatch (#2763 class) |
| `dead-ranges` | 15 | peer ranges referencing unpublished package names |
| `freshness` | 10 | latest release within 365 days |
| `dsh-tools-peer` | 10 | declared dsh-tools peer satisfied by the current latest dist-tag |

Grade: A ≥ 95 · B ≥ 85 · C ≥ 70 · D ≥ 55 · F below.

## Why it exists

- The registry has 900+ plugins; quality signals exist (dsh-ecosystem, dsh-recommend) but nothing gives a per-plugin **actionable score with fix suggestions** from npm metadata alone.
- Same evidence basis as the supply-chain health scan — one dist-tag fix on the official side would raise scores across the ecosystem.
- Zero runtime dependencies, read-only; degrades gracefully offline.

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
```

CI runs the dsh-plugin-doctor preflight, unit tests (mock registry), packed-artifact integration, and a fresh-profile `dsh web` boot smoke on Windows.

## License

MIT © 2026 zoahdev

---

# dsh-quality-score（中文）

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）插件的**质量评分卡**：0-100 分 + 等级 + 分项明细，带问题与修复建议。

方法学与 [生态供应链健康扫描](https://github.com/zoahdev/dsh-ecosystem/blob/main/docs/ecosystem-supply-chain-health-2026-08-18.md) 一致：manifest 完整度、peer 可解析性、dist-tag 健康（#2763 类）、死依赖、新鲜度、dsh-tools peer 兼容性。零运行时依赖、只读。

## 安装

```sh
dsh plugin add dsh-quality-score
```

独立使用：

```sh
npx dsh-quality-score dsh-dep-audit
npx dsh-quality-score --batch registry-names.txt   # 批量评分，输出质量榜单
```

## 在 harness 内使用（agent 可调用）

> 给这个插件打个质量分：`quality_score`，包名 dsh-dep-audit。

返回 `dsh-quality-score/v1` 报告（结构见英文版 JSON 示例）。

## 分项

| 组件 | 满分 | 衡量 |
|---|---|---|
| `manifest` | 20 | latest 版本是否含 name/version/description/license |
| `peer-resolvable` | 20 | 每个 peer 范围是否有已发布版本匹配 |
| `dist-tag` | 15 | latest 与 next 不一致（#2763 类） |
| `dead-ranges` | 15 | peer 范围引用不存在的包名 |
| `freshness` | 10 | latest 发布时间是否在 365 天内 |
| `dsh-tools-peer` | 10 | 声明的 dsh-tools peer 是否被当前 latest 满足 |

等级：A ≥ 95 · B ≥ 85 · C ≥ 70 · D ≥ 55 · F 以下。

## 为什么需要它

- 注册表 900+ 插件，质量信号存在但没有“npm 元数据就能给分 + 修复建议”的插件。
- 与供应链健康扫描同一证据基础；官方修一个 dist-tag 就能拉高全生态分数。
- 零运行时依赖、只读；离线优雅降级。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
```

CI 跑 dsh-plugin-doctor 预检、单元测试（mock 注册表）、打包集成、Windows 全新 profile 的 `dsh web` 启动冒烟。

## 许可证

MIT © 2026 zoahdev
## Related ecosystem tools

- [dsh-dep-audit](https://github.com/zoahdev/dsh-dep-audit) - dependency supply-chain hygiene
- [dsh-quality-score](https://github.com/zoahdev/dsh-quality-score) - plugin quality scorecard + full-registry leaderboard
- [dsh-ecosystem](https://github.com/zoahdev/dsh-ecosystem) - health scan, impact, trend, live dashboard
- [dsh-tutorials](https://github.com/zoahdev/dsh-tutorials) - bilingual plugin pipeline tutorials
## FAQ

- **How do I install?** dsh plugin add dsh-quality-score or run the CLI directly (see README).
- **Does it need an API key?** No.
- **Is it read-only?** Yes by default; any write/apply is an explicit flag.

