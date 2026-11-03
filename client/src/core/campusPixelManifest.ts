/**
 * 照片参考校园像素资源的运行时索引与美术几何，保持纯数据。
 * 路径只在 assetManifest.ts 登记；这里不依赖 Phaser 或任何设计域。
 * bounds 是去除透明留白的裁切矩形，anchor 仍是原始 128² 画布坐标。
 */

export const CAMPUS_PIXEL_ART = {
  tiles: {
    classroom: 'tile_classroom_ceramic_clean',
    classroomWorn: 'tile_classroom_ceramic_worn',
    corridor: 'tile_corridor_ceramic_neutral',
    corridorWorn: 'tile_corridor_ceramic_worn',
    concrete: 'tile_lecture_concrete_base',
    concreteWorn: 'tile_lecture_concrete_scuffed',
    stone: 'tile_lobby_stone_base',
    stoneWorn: 'tile_lobby_stone_variant',
    plaster: 'tile_wall_plaster_warm',
    plasterCool: 'tile_wall_plaster_cool',
    brick: 'tile_wall_brick_base',
    brickWorn: 'tile_wall_brick_weathered',
    tread: 'tile_stair_tread_grooved',
    riser: 'tile_stair_riser_plain',
    skirt: 'tile_wall_skirt_charcoal',
    threshold: 'tile_door_threshold_metal',
  },
  furniture: {
    deskSingle: 'furniture_classroom_desk_yellow_single',
    deskDouble: 'furniture_classroom_desk_yellow_double',
    deskTriple: 'furniture_classroom_desk_yellow_triple',
    deskBack: 'furniture_classroom_desk_yellow_double_back',
    chairDown: 'furniture_lecture_chair_blue_down_back',
    chairFolded: 'furniture_lecture_chair_blue_folded_back',
    lectern: 'furniture_classroom_lectern_multimedia',
    woodLectern: 'furniture_classroom_lectern_wood',
    podium: 'furniture_classroom_podium_tile',
  },
  props: {
    chalkboard: 'prop_classroom_chalkboard_green',
    screen: 'prop_classroom_projection_screen_down',
    radiator: 'prop_classroom_radiator_castiron',
    ac: 'prop_classroom_ac_floor',
    clock: 'prop_classroom_clock_round',
    speaker: 'prop_classroom_speaker_wall',
    windowWide: 'prop_classroom_window_wide',
    windowNarrow: 'prop_classroom_window_narrow',
    curtainClosed: 'prop_classroom_curtain_blue_closed',
    curtainParted: 'prop_classroom_curtain_blue_parted',
    railingHorizontal: 'prop_classroom_railing_stainless_horizontal',
    railingVertical: 'prop_classroom_railing_stainless_vertical',
    pillar: 'prop_classroom_pillar_round_plaster',
    stairsUp: 'prop_stairwell_stairs_up',
    stairsDown: 'prop_stairwell_stairs_down',
    fireDoor: 'prop_corridor_door_fire_double_gray',
    woodDoor: 'prop_classroom_door_wood_closed',
    woodDoorOpen: 'prop_classroom_door_wood_open_left',
    exitSign: 'prop_corridor_exit_sign_green',
    firePipe: 'prop_stairwell_pipe_fire_red',
    fireCabinet: 'prop_corridor_fire_cabinet_brick',
    neon: 'prop_lobby_icecream_neon',
    floorMarker6: 'prop_stairwell_floor_marker_6',
    camera: 'prop_corridor_camera_dome',
    projector: 'prop_classroom_projector_white',
    light: 'prop_classroom_light_fluorescent',
    fan: 'prop_classroom_fan_ceiling',
    sockets: 'prop_classroom_switch_socket_cluster',
  },
} as const

export interface CampusPixelSpriteGeometry {
  readonly bounds: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly anchor: { readonly x: number; readonly y: number }
}

/** 裁切后归一化锚点应为 (anchor - bounds 起点) / bounds 尺寸。 */
export const CAMPUS_PIXEL_SPRITES: Readonly<Record<string, CampusPixelSpriteGeometry>> = {
  furniture_classroom_desk_yellow_single: {
    bounds: { x: 48, y: 63, width: 32, height: 46 },
    anchor: { x: 64, y: 108 },
  },
  furniture_classroom_desk_yellow_double: {
    bounds: { x: 31, y: 63, width: 66, height: 46 },
    anchor: { x: 64, y: 108 },
  },
  furniture_classroom_desk_yellow_triple: {
    bounds: { x: 16, y: 63, width: 96, height: 46 },
    anchor: { x: 64, y: 108 },
  },
  furniture_classroom_desk_yellow_double_back: {
    bounds: { x: 31, y: 63, width: 66, height: 46 },
    anchor: { x: 64, y: 108 },
  },
  furniture_lecture_chair_blue_down_back: {
    bounds: { x: 48, y: 59, width: 32, height: 50 },
    anchor: { x: 64, y: 108 },
  },
  furniture_lecture_chair_blue_folded_back: {
    bounds: { x: 48, y: 59, width: 32, height: 50 },
    anchor: { x: 64, y: 108 },
  },
  furniture_classroom_lectern_multimedia: {
    bounds: { x: 33, y: 41, width: 62, height: 68 },
    anchor: { x: 64, y: 108 },
  },
  furniture_classroom_lectern_wood: {
    bounds: { x: 38, y: 58, width: 52, height: 51 },
    anchor: { x: 64, y: 108 },
  },
  furniture_classroom_podium_tile: {
    bounds: { x: 17, y: 77, width: 94, height: 32 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_chalkboard_green: {
    bounds: { x: 18, y: 57, width: 93, height: 52 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_projection_screen_down: {
    bounds: { x: 19, y: 46, width: 91, height: 63 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_radiator_castiron: {
    bounds: { x: 28, y: 72, width: 71, height: 37 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_ac_floor: {
    bounds: { x: 51, y: 28, width: 26, height: 81 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_clock_round: {
    bounds: { x: 51, y: 82, width: 27, height: 27 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_speaker_wall: {
    bounds: { x: 55, y: 65, width: 16, height: 44 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_window_wide: {
    bounds: { x: 21, y: 21, width: 86, height: 88 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_window_narrow: {
    bounds: { x: 44, y: 21, width: 40, height: 88 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_curtain_blue_closed: {
    bounds: { x: 20, y: 25, width: 88, height: 83 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_curtain_blue_parted: {
    bounds: { x: 20, y: 25, width: 88, height: 83 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_railing_stainless_horizontal: {
    bounds: { x: 23, y: 73, width: 82, height: 36 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_railing_stainless_vertical: {
    bounds: { x: 54, y: 26, width: 15, height: 83 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_pillar_round_plaster: {
    bounds: { x: 42, y: 19, width: 44, height: 90 },
    anchor: { x: 64, y: 108 },
  },
  prop_stairwell_stairs_up: {
    bounds: { x: 20, y: 28, width: 89, height: 81 },
    anchor: { x: 64, y: 108 },
  },
  prop_stairwell_stairs_down: {
    bounds: { x: 20, y: 28, width: 89, height: 81 },
    anchor: { x: 64, y: 108 },
  },
  prop_corridor_door_fire_double_gray: {
    bounds: { x: 24, y: 24, width: 80, height: 85 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_door_wood_closed: {
    bounds: { x: 41, y: 23, width: 46, height: 86 },
    anchor: { x: 64, y: 108 },
  },
  prop_classroom_door_wood_open_left: {
    bounds: { x: 28, y: 23, width: 59, height: 86 },
    anchor: { x: 64, y: 108 },
  },
  prop_corridor_exit_sign_green: {
    bounds: { x: 46, y: 94, width: 37, height: 15 },
    anchor: { x: 64, y: 108 },
  },
  prop_stairwell_pipe_fire_red: {
    bounds: { x: 57, y: 21, width: 29, height: 88 },
    anchor: { x: 64, y: 108 },
  },
  prop_corridor_fire_cabinet_brick: {
    bounds: { x: 42, y: 36, width: 45, height: 73 },
    anchor: { x: 64, y: 108 },
  },
  prop_lobby_icecream_neon: {
    bounds: { x: 38, y: 37, width: 52, height: 73 },
    anchor: { x: 64, y: 108 },
  },
  prop_stairwell_floor_marker_6: {
    bounds: { x: 53, y: 85, width: 24, height: 24 },
    anchor: { x: 64, y: 108 },
  },
  prop_corridor_camera_dome: {
    bounds: { x: 54, y: 55, width: 21, height: 21 },
    anchor: { x: 64, y: 64 },
  },
  prop_classroom_projector_white: {
    bounds: { x: 46, y: 45, width: 35, height: 31 },
    anchor: { x: 64, y: 64 },
  },
  prop_classroom_light_fluorescent: {
    bounds: { x: 32, y: 57, width: 65, height: 14 },
    anchor: { x: 64, y: 64 },
  },
  prop_classroom_fan_ceiling: {
    bounds: { x: 27, y: 46, width: 78, height: 55 },
    anchor: { x: 64, y: 64 },
  },
  prop_classroom_switch_socket_cluster: {
    bounds: { x: 51, y: 95, width: 27, height: 14 },
    anchor: { x: 64, y: 108 },
  },
}

/** 只登记整层地图使用的独立图片；离线预览和重复图集不进首屏加载。 */
export const CAMPUS_PIXEL_TILE_KEYS: readonly string[] = Object.values(CAMPUS_PIXEL_ART.tiles)
export const CAMPUS_PIXEL_FURNITURE_KEYS: readonly string[] = Object.values(
  CAMPUS_PIXEL_ART.furniture,
)
export const CAMPUS_PIXEL_PROP_KEYS: readonly string[] = Object.values(CAMPUS_PIXEL_ART.props)
