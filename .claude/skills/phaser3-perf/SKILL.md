---
name: phaser3-perf
description: 本项目（Phaser 3.90 浏览器 roguelike）的性能与引擎事实。写或改任何涉及 Phaser 实体、对象池、Arcade 物理、持续伤害 tick、寻路/分离、受击音效、粒子、场景生命周期的代码前先读。结论直接来自 Phaser 3.90.0 源码，与网上流传的说法有四处冲突（delta 钳制、固定时间步、SpriteGPULayer、RTree 上限）。
---

# Phaser 3 性能与引擎事实

**内容不在这个文件里。** 实际正文在仓库根目录的 **[`docs/Phaser3性能与引擎事实.md`](../../../docs/Phaser3性能与引擎事实.md)**，
请读那一份。

**为什么拆开放：** 这份内容的读者不只是 Claude Code —— 其他组员可能用 Cursor / Copilot / Codex /
通义灵码，那些工具不读 `.claude/skills/`。所以正文放在所有人都能读的 `docs/` 里，
这个 skill 只是一层「让 Claude Code 在该读的时候想得起来」的索引。

⚠️ 正文里有四条**与《技术选型》和常见教程冲突**的结论（Phaser 已内建 delta 钳制、Arcade 本来就是
固定时间步、`SpriteGPULayer` 是 Phaser 4 特性且不能交互、RTree 的 5,000 body 上限）。
**写涉及持续伤害、对象池、实体的代码前，务必先读那四条。**