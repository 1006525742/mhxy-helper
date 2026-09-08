export interface CixinMapConfig {
  width: number
  height: number
  file: string
  available: boolean
}

/** 慈心涉及地图配置（游戏坐标尺寸 + 底图文件名）。
 * 数据合并自 backend/data/maps(ghost MAP_CONFIGS) 与 backend/data/maps_baotu(baotu MAP_CONFIGS)，仅用资源/数据，非后端逻辑。
 * 变换：px = x * imgW/gameW + 20; py = imgH + 20 - y * imgH/gameH; border=20。
 * 两套配置坐标变换一致(border=20)。西梁女国(=西凉女国)取 ghost；其余取 baotu(含长寿郊外/花果山/大唐国境/东海湾)。 */
export const CIXIN_MAPS: Record<string, CixinMapConfig> = {
  '长寿村': { width: 160, height: 210, file: 'csc.png', available: true },
  '西梁女国': { width: 163, height: 124, file: 'xlng.png', available: true },
  '宝象国': { width: 160, height: 120, file: 'bxg.png', available: true },
  '朱紫国': { width: 191, height: 120, file: 'zzg.png', available: true },
  '傲来国': { width: 224, height: 150, file: 'alg.png', available: true },
  '东海湾': { width: 120, height: 120, file: 'dhw.png', available: true },
  '江南野外': { width: 160, height: 120, file: 'jnyw.png', available: true },
  '大唐境外': { width: 640, height: 120, file: 'dtjw.png', available: true },
  '建邺城': { width: 288, height: 144, file: 'jyc.png', available: true },
  '长寿郊外': { width: 190, height: 170, file: 'csjy.png', available: true },
  '花果山': { width: 160, height: 120, file: 'hgs.png', available: true },
  '大唐国境': { width: 350, height: 335, file: 'dtgj.png', available: true },
}

export const CIXIN_MAP_BORDER = 20
