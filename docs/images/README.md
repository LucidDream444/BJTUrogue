# `docs/images/` — 文档配图

这里放**文档正文引用的图片**。图片是**从代码生成的**，不是手画的 ——
所以每张图下面的「怎么重截」那一行比图本身重要：代码一改，图就过期，
而过期的配图**不会报错**，只会让下一个人照着错的样子做。

> 美术资源**不在这儿**。真图片在 `client/public/assets/`（那是 D4 的管线，
> 命名规范见那边的 README）。这一目录只放「文档里嵌的说明性截图」。

---

## `d2_classroom_look.png`

**一张教室应该长什么样** —— D2 给出的目标样子，给美术定调子、给 D1 接家具用。
正文引用在 [`../地牢生成设计.md`](../地牢生成设计.md) §7.2。

它不是美术图，是**白箱测试场 `d2_classroom_scene` 的无头截图**：
画面里只有桌椅与门来自地图数据，黑板 / 窗 / 盆栽是这个场子自己画上去的装饰。

⚠️ 图上门洞里那一圈**绿框**是**调试用的，撤不掉**：它是「门关上时要封住的那块矩形」
（`collidersOf().barriers`，D1 封门要的就是这一块），绿 = 开着、红 = 关着（按 `E` 翻）。
**真美术不要照着它画** —— 门框是外圈那一圈橙色（见 `d2_classroom_scene.ts` 的 `INK`）。
（能关掉的只有 `D` 那一层判定叠加；绿框是底座画的，这一场没有给它开关。）

**怎么重截**（先起 dev server，注意**端口以实际输出为准** —— 5173 被占时 Vite 会自动换）：

```bash
cd client && npm run dev
```

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --disable-gpu --no-sandbox \
  --window-size=1280,720 --virtual-time-budget=12000 \
  --screenshot="C:\...\docs\images\d2_classroom_look.png" \
  "http://localhost:5173/test.html?arena=d2_classroom_scene"
```

三条已经踩过的坑，别再踩一遍：

1. **`--screenshot=` 必须给绝对 Windows 路径**（`C:\...`，不是 `/d/...`，也不是相对路径）。
   给相对路径时 Edge **一声不响地不生成文件** —— 没有报错，只有一个空目录。
2. **不要加 `--force-device-scale-factor`。** 加了之后游戏世界**只渲染在画布左上角一角**，
   看起来活像「布局坏了」，其实只是缩放和 `canvas` 尺寸对不上。
3. **`--virtual-time-budget` 会冻住虚拟时钟**，所以图里那行 `生成 <0.1ms` 是假数
   （见 §7.3「已知的读数陷阱」）。截图里其它读数是真读数。

换种子重截：改 URL 加不了（这一场用 `N` 键换），要固定某一间的话，
改 `d2_classroom_scene.ts` 里 `seedIndex` 的起点，或者照 `D2_SEEDS` 里的顺序数。