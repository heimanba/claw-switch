export interface IconMetadata {
  name: string; // 图标名称（小写，如 "openai"）
  displayName: string; // 显示名称（如 "OpenAI"）
  category: string; // 分类（如 "ai-provider", "cloud", "tool"）
  keywords: string[]; // 搜索关键词
  defaultColor?: string; // 默认颜色
  /** 为 true 时不应用单色，保留 SVG 内置多色（如 bailian logo） */
  preserveNativeColors?: boolean;
}

export interface IconPreset {
  [key: string]: IconMetadata;
}
