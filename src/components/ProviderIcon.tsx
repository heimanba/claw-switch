import React, { useMemo } from "react";
import { getIcon, hasIcon, getIconMetadata } from "@/icons/extracted";
import { cn } from "@/lib/utils";

interface ProviderIconProps {
  icon?: string; // 图标名称
  name: string; // 供应商名称（用于 fallback）
  color?: string; // 自定义颜色 (Deprecated, kept for compatibility but ignored for SVG)
  size?: number | string; // 尺寸
  className?: string;
  showFallback?: boolean; // 是否显示 fallback
}

export const ProviderIcon: React.FC<ProviderIconProps> = ({
  icon,
  name,
  color,
  size = 32,
  className,
  showFallback = true,
}) => {
  // 生成唯一 ID 用于 SVG 渐变
  const uniqueId = useMemo(() => Math.random().toString(36).substr(2, 9), []);

  // 获取图标 SVG
  const iconSvg = useMemo(() => {
    if (icon && hasIcon(icon)) {
      let svg = getIcon(icon);
      // 为 SVG 中的渐变 ID 添加唯一后缀，避免多个相同图标时 ID 冲突
      // 匹配 id="xxx" 和 url(#xxx) 模式
      svg = svg.replace(/id="([^"]+)"/g, `id="$1-${uniqueId}"`);
      svg = svg.replace(/url\(#([^)]+)\)/g, `url(#$1-${uniqueId})`);
      return svg;
    }
    return "";
  }, [icon, uniqueId]);

  // 计算尺寸样式
  const sizeStyle = useMemo(() => {
    const sizeValue = typeof size === "number" ? `${size}px` : size;
    return {
      width: sizeValue,
      height: sizeValue,
      // 内嵌 SVG 使用 1em 作为尺寸基准，这里同步 fontSize 让图标实际跟随 size 放大
      fontSize: sizeValue,
      lineHeight: 1,
    };
  }, [size]);

  // 获取有效颜色：若图标保留原生多色则不应用单色；否则优先传入 color，其次元数据 defaultColor
  const effectiveColor = useMemo(() => {
    if (icon) {
      const metadata = getIconMetadata(icon);
      if (metadata?.preserveNativeColors) return undefined;
    }
    if (color && typeof color === "string" && color.trim() !== "") {
      return color;
    }
    if (icon) {
      const metadata = getIconMetadata(icon);
      if (metadata?.defaultColor && metadata.defaultColor !== "currentColor") {
        return metadata.defaultColor;
      }
    }
    return undefined;
  }, [color, icon]);

  // 如果有图标，显示图标
  if (iconSvg) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center flex-shrink-0",
          className,
        )}
        style={{ ...sizeStyle, color: effectiveColor }}
        dangerouslySetInnerHTML={{ __html: iconSvg }}
      />
    );
  }

  // Fallback：显示首字母
  if (showFallback) {
    const initials = name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
    const fallbackFontSize =
      typeof size === "number" ? `${Math.max(size * 0.5, 12)}px` : "0.5em";
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center flex-shrink-0 rounded-lg",
          "bg-muted text-muted-foreground font-semibold",
          className,
        )}
        style={sizeStyle}
      >
        <span
          style={{
            fontSize: fallbackFontSize,
          }}
        >
          {initials}
        </span>
      </span>
    );
  }

  return null;
};
