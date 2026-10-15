# 原素材映射（逐 PNG）

原始文件保留且客户端副本 SHA256 相同。Godot centered=false 仅表示导出左上原点；Phaser 战斗使用各帧脚底锚点，物理体独立。全部源PNG/TRES/TSCN已检查。

| 原文件（相对素材根） | 实际图片尺寸 | 裁切与时序 | 客户端新路径（assets/） |
|---|---|---|---|
| `1\image-3\textures\image-3_spritesheet.png` | `304×304` | `76×76` / 0–15 行优先；8fps；每帧125ms；循环 | `sprites/player/player_student_sword.png` |
| `2\image-3\textures\image-3_spritesheet.png` | `288×288` | `72×72` / 0–15 行优先；8fps；每帧125ms；循环 | `sprites/player/player_student_shoot.png` |
| `3\sprite-animations\textures\1791808305238-0cqkvd2dsynq_spritesheet.png` | `192×192` | `192×192` / 单帧；8fps；125ms；循环 | `sprites/player/player_student_idle_overview.png` |
| `3\sprite-animations\textures\1791808305467-8cjgbps995r_spritesheet.png` | `64×64` | `64×64` / 单帧；8fps；125ms；循环 | `sprites/player/player_student_idle_nw.png` |
| `3\sprite-animations\textures\1791808305648-f0wgzulx3ko_spritesheet.png` | `64×64` | `64×64` / 单帧；8fps；125ms；循环 | `sprites/player/player_student_idle_n.png` |
| `3\sprite-animations\textures\1791808305835-bo5lkvl0w1m_spritesheet.png` | `64×64` | `64×64` / 单帧；8fps；125ms；循环 | `sprites/player/player_student_idle_ne.png` |
| `3\sprite-animations\textures\1791808305968-vgil24uk1m8_spritesheet.png` | `64×64` | `64×64` / 单帧；8fps；125ms；循环 | `sprites/player/player_student_idle_e.png` |
| `3\sprite-animations\textures\1791808306212-c2o67tkgynq_spritesheet.png` | `64×64` | `64×64` / 单帧；8fps；125ms；循环 | `sprites/player/player_student_idle_w.png` |
| `3\sprite-animations\textures\1791808306413-f69xlv4bbxt_spritesheet.png` | `64×64` | `64×64` / 单帧；8fps；125ms；循环 | `sprites/player/player_student_idle_sw.png` |
| `3\sprite-animations\textures\1791808306636-82iedunn1ga_spritesheet.png` | `64×64` | `64×64` / 单帧；8fps；125ms；循环 | `sprites/player/player_student_idle_s.png` |
| `3\sprite-animations\textures\1791808306834-0pmdj35ltsxb_spritesheet.png` | `64×64` | `64×64` / 单帧；8fps；125ms；循环 | `sprites/player/player_student_idle_se.png` |
| `8\1791706540776-azoqw5we3hg\textures\1791706540776-azoqw5we3hg_spritesheet.png` | 原图 `284×284`，纯跑动图 `497×142` | `71×71`；仅移除原 0/1 开火帧，原 2–15 帧按原序重编号 0–13；8fps | `sprites/player/player_student_run_gun_clean.png` |
| `5\1791804968842-3eybyl6jfva\textures\1791804968842-3eybyl6jfva.png` | `2048×2048` | `2048×2048` / 静态 Sprite2D | `ui/d1/ui_campus_pixel_board.png` |
| `6\1791805180723-nlptk9r2uy9\textures\1791805180723-nlptk9r2uy9.png` | `2048×2048` | `2048×2048` / 静态 Sprite2D | `ui/d1/ui_campus_fantasy_board.png` |
| `8\1791809712754-qfaj3q6kaw\textures\1791809712754-qfaj3q6kaw_spritesheet.png` | `256×256` | `64×64` / 0–15 行优先；8fps；每帧125ms；循环 | `sprites/player/player_student_run.png` |

## 视觉识别与用途

1：同方向挥剑序列，资源展示播放，不给三种枪增加未设计的近战伤害。
2：同方向持枪射击序列，战斗原地攻击。
4：同方向持枪跑动序列，战斗移动攻击。
8：同方向徒手跑动序列，普通移动。
3 overview：八方向3×3总览，192×192整图是一个帧，不当角色动画；其余依次 NW/N/NE/E/W/SW/S/SE，各自是64×64单帧，用于待机方向选择。侧向/斜向为视觉判断，保留原图可复核。
5：像素校园UI整图；6：幻想校园UI整图。未提供可复用控件的精确裁切规范，均在预览展示，等待D4切图，不充当人物。

## 缺失与替代表现

没有专用受击、死亡动画。受击沿用当前动作加红白闪光，逻辑时间窗口只在有效伤害发生时设置；死亡使用最后帧倾斜/降暗。移动与射击仅右向序列，左向水平翻转；上下瞄准由独立枪管指示，角色保持侧向，这是明确的临时表现。

原始导出所有 duration=1.0、speed=8.0、loop=true；统一 ANIMS 注册为8fps/repeat=-1，逐帧125ms，没有变速丢失。运行时仅加载 PNG；玩家按 GameClock 取对应注册动画的帧，保证暂停、顿帧不继续播放。脚底锚点按每帧底部4行非透明像素范围中点确定，原始透明边距不参与碰撞。
