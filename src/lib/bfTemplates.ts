/** Catalog template funnel của BF (Splash/Language/Onboarding/WelcomeBack/Uninstall).
 *
 *  ⚠️ SEED — vài mẫu để Ads Builder dùng ngay. SAU NÀY đọc từ BF (BF sẽ khai template
 *  nó support). Khi có nguồn thật, thay BF_SCREENS bằng fetch + giữ nguyên shape.
 *
 *  Bắt nguồn từ từ vựng funnel ở instructions/funnel/AD_SHEET_PATTERN.md §A. */

export const BF_TEMPLATES_SOURCE = 'seed' as const

export type BfTemplate = { code: string; label: string; desc?: string }
export type BfScreen = { id: string; label: string; templates: BfTemplate[] }

export const BF_SCREENS: BfScreen[] = [
  {
    id: 'splash', label: 'Splash',
    templates: [
      { code: 'splash_min1200', label: 'Min 1.2s', desc: 'splashMinDisplayMs = 1200' },
      { code: 'splash_min2000', label: 'Min 2.0s', desc: 'splashMinDisplayMs = 2000' },
      { code: 'splash_min3000', label: 'Min 3.0s', desc: 'splashMinDisplayMs = 3000' },
    ],
  },
  {
    id: 'language', label: 'Language',
    templates: [
      { code: 'lang_single', label: 'Single page', desc: 'không màn region / apply-language' },
      { code: 'lang_region', label: 'Có Region', desc: 'thêm màn region sau Language' },
    ],
  },
  {
    id: 'onboarding', label: 'Onboarding',
    templates: [
      { code: 'ob_3', label: '3 trang', desc: '[hero,hero,hero]' },
      { code: 'ob_6', label: '6 trang', desc: '[hero×6]' },
      { code: 'ob_6s2', label: '6 trang + 2 survey', desc: '[hero×4, choice, choice]' },
    ],
  },
  {
    id: 'welcome_back', label: 'Welcome-back',
    templates: [
      { code: 'wb_on', label: 'Bật', desc: 'native ngay + inter sau Continue' },
      { code: 'wb_off', label: 'Tắt', desc: 'không có welcome-back' },
    ],
  },
  {
    id: 'uninstall', label: 'Uninstall (in-app)',
    templates: [
      { code: 'uninstall_2', label: '2 màn', desc: 'warning → reason → inter' },
      { code: 'uninstall_off', label: 'Tắt', desc: 'không có luồng uninstall in-app' },
    ],
  },
]
