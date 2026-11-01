# 校园梦境像素美术交付

从仓库根目录重建：`python client/tools/art/build_dream_pack.py`，需要 Pillow。

本批为用户选定的本地逐像素绘制，不访问网络或图像生成服务。番鸭参考照片中的
红色面瘤、黑羽白颈与宽蹼；小红果参考单颗红果，身体不含手臂或枪械。
动物原生48像素、红果和首领原生64像素、故事原生320×180，全部以最近邻放大。

`delivery.json` 列出路径、图集行列、状态帧区间、播放速率、地面锚点及SHA256。
`quality_report.json` 校验实际尺寸、透明角、有效帧和14幅画面独立性。
`sprite_sample.png` 是透明底造型预览，`animation_contact.png` 覆盖全部状态，
`story_contact.png` 为14幕分镜，每幕只显示一次。

动画身体地面锚点：番鸭与猫(48,82)、小红果(32,56)、首领(64,116)。
红果跳跃高度由RedBerryPose统一作用于身体与枪，图片不烘焙离地位移。
六张公共枪图与已有鹅枪图逐字节一致，仅提升为公共资源，画布48×32，
握点(12,16)、枪口(44,16)、原始朝右；不新增按角色、角度或动作的武器版本。

14幕共用教室、红色书签笔记本与棕衣考研学子；可玩新生穿蓝色校服，与学子区分。
睡眠/发热状态为侧脸伏在桌面交叠前臂上，没有桌前站姿双腿。最终心魔是试卷和
破碎钟环包围的学生阴影，只有两只人形手臂。入梦分镜含八级悬空平台，
梦境8F不声称来自真实校园测绘。中文字幕由story.json与运行时UI提供，不画入图片。

## Rebuild notes

Rebuild from repository root: `python client/tools/art/build_dream_pack.py` (Pillow).

All drawings are locally authored pixel art with no network or generation service.
The supplied Muscovy photographs guide the black plumage, red facial caruncles,
white neck and webbed feet. The supplied fruit photograph guides one red berry.
Native art uses 48px animals, 64px berry/boss drawings and 320x180 story paintings;
all export scaling uses nearest-neighbor. Story captions are runtime UI text.

`delivery.json` lists runtime paths, canvas/frame grids, counts, anchors, states
and SHA256 values. `sprite_sample.png`, `animation_contact.png`, and
`story_contact.png` provide transparent checker previews and all story scenes.

Animal frames use a fixed foot at (48,82), berry (32,56), boss (64,116).
Berry jump height comes from RedBerryPose, not vertically shifted image frames.
The six common weapon PNGs are promoted byte-identical from existing goose gun
layers; grip=(12,16), muzzle=(44,16), canvas=48x32, native facing right.

The fourteen story paintings share the same classroom, red-bookmark notebook,
brown examinee and blue freshman. The eight floating landings mark the dream
finale; the seventh real floor remains unchanged. No claim is made that the
dream eighth floor is a measured real campus location.
