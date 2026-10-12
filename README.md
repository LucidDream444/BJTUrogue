# BJTUrogue

《课后勇者：异次元校园》是一款面向大学生群体的 2D 俯视角轻量化地牢闯关游戏，主打碎片化休闲玩法，
适配学生课后、宿舍休憩等零散空余时间，主打单局短时冒险体验。

运行形态是**浏览器网页游戏**（《技术选型》§2），因此反馈收集与版本回退的成本都远低于桌面客户端。

---

## 仓库结构

```
BJTUrogue/
├── client/          客户端：Phaser 3 + TypeScript + Vite   ← 游戏本体，D1—D4 在这里工作
├── server/          服务端：Django 5 + DRF + PostgreSQL     ← D5 的工作区（尚未开工）
├── docs/            项目文档（分工方案、技术选型、需求分析、各域设计文档）
├── .claude/         Claude Code 的项目级配置
└── openspec/        OpenSpec 工作目录
```

**为什么是 `client/` + `server/`：** 两边是两套互不相干的工具链（npm / Vite 对 pip / Django），
分目录后根目录保持干净，`node_modules/` 与 `.venv/` 不会混在同一个根下，
两边的依赖、配置、构建产物互不干扰。

---

## 快速开始

```bash
cd client
npm install
npm run dev          # 打开 http://localhost:5173
```

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器，热重载 |
| `npm run build` | 类型检查 + 生产构建，产物在 `client/dist/` |
| `npm run preview` | 本地预览构建产物 |
| `npm run typecheck` | 只做类型检查 |
| `npm test` | Vitest 单测（watch） |
| `npm run test:run` | Vitest 单测（跑一次，CI 用） |
| `npm run lint` / `npm run format` | ESLint / Prettier |

Node 版本锁定在 `client/.nvmrc`（20 LTS）。依赖版本一律写进 `client/package.json` 并锁定小版本。

---

## 白箱测试场

没有美术资源、没有玩家角色、各域尚未互相接通时，功能靠**测试场**验证 —— 用白色方块代替美术，
用 URL 参数选择要进哪个场景。所有测试场都在 [`client/src/test/`](client/src/test/)，
启动代码同样在那里，加一个新测试场不需要改任何其他域的文件。

```bash
cd client && npm run dev     # 然后打开 http://localhost:5173/test.html
```

详见 [`client/src/test/README.md`](client/src/test/README.md)（含运行方法、加场步骤、
以及可整段复制给 AI 助手的指令块）。

---

## 关键文档

| 文档 | 内容 |
|---|---|
| [docs/需求分析与产品设计.md](docs/需求分析与产品设计.md) | 需求基线：P0/P1/P2 需求、R01—R10 风险、UC01—UC11 用例。由 PDF 逐页转写，表格与图内文字均已还原 |
| [docs/人员分工方案.md](docs/人员分工方案.md) | 五个设计域的划分、域间契约（C1/C2/C3）、三条技术红线 |
| [docs/技术选型.md](docs/技术选型.md) | 技术栈、客户端架构、配置数据管线、浏览器特有的坑 |
| [docs/Phaser3性能与引擎事实.md](docs/Phaser3性能与引擎事实.md) | 引擎事实与性能约定。**结论来自 Phaser 3.90.0 源码**，纠正了多处流传的错误说法 |
| [docs/敌人设计.md](docs/敌人设计.md) | D3：分裂怪与肉盾怪完整规格（含数值表、Actor 基类、伤害账本、测试场）|
| [AGENTS.md](AGENTS.md) | **给所有 AI 助手的项目约定**（工具无关，Cursor / Copilot / Codex 都读这一份） |
| [CLAUDE.md](CLAUDE.md) | 仅一行 `@AGENTS.md` 导入，给 Claude Code 用 |
| [持续更新10.12.md](持续更新10.12.md) | **改动日志**。文件名里的日期 = 最后一次改动那天，改完东西要往上加一条（`AGENTS.md` §十一） |

## 三条技术红线（《人员分工方案》§9.4）

1. 游戏核心循环**永远不 `await` 网络**。遥测必须 fire-and-forget。
2. **配置数值不写死在代码里**，一律走配置表。
3. 所有本地存档数据带 `schemaVersion` 字段。