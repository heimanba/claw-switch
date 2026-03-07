import { describe, expect, it } from "vitest";
import { opencodeProviderPresets } from "@/config/opencodeProviderPresets";
import {
  isOpencodePresetMappable,
  opencodePresetToQwenSettingsConfig,
  opencodePresetToQwenPreset,
} from "@/config/opencodeToQwenMapper";
import { qwenProviderPresets } from "@/config/qwenProviderPresets";

describe("opencodeToQwenMapper", () => {
  const deepSeekPreset = opencodeProviderPresets.find((p) => p.name === "DeepSeek")!;
  const katCoderPreset = opencodeProviderPresets.find((p) => p.name === "KAT-Coder")!;

  describe("isOpencodePresetMappable", () => {
    it("returns true for preset with plain baseURL", () => {
      expect(isOpencodePresetMappable(deepSeekPreset)).toBe(true);
    });

    it("returns false for preset with template variable in baseURL", () => {
      expect(isOpencodePresetMappable(katCoderPreset)).toBe(false);
    });
  });

  describe("opencodePresetToQwenSettingsConfig", () => {
    it("maps DeepSeek preset to Qwen settingsConfig shape", () => {
      const config = opencodePresetToQwenSettingsConfig(deepSeekPreset);
      expect(config.security?.auth?.selectedType).toBe("openai");
      expect(config.model?.name).toBe("deepseek-chat");
      expect(config.modelProviders?.openai).toBeDefined();
      expect(Array.isArray(config.modelProviders?.openai)).toBe(true);
      const openai = config.modelProviders!.openai as any[];
      expect(openai.length).toBeGreaterThan(0);
      expect(openai[0]).toMatchObject({
        id: "deepseek-chat",
        name: "DeepSeek V3.2",
        baseUrl: "https://api.deepseek.com/v1",
        envKey: "DEEPSEEK_API_KEY",
      });
      expect(config.env).toHaveProperty("DEEPSEEK_API_KEY");
    });

    it("throws for preset with template in baseURL", () => {
      expect(() => opencodePresetToQwenSettingsConfig(katCoderPreset)).toThrow(
        /template/
      );
    });
  });

  describe("opencodePresetToQwenPreset", () => {
    it("produces full QwenProviderPreset with name and websiteUrl", () => {
      const preset = opencodePresetToQwenPreset(deepSeekPreset);
      expect(preset.name).toBe("DeepSeek");
      expect(preset.websiteUrl).toBe("https://platform.deepseek.com");
      expect(preset.settingsConfig).toBeDefined();
      expect((preset.settingsConfig as any).model?.name).toBe("deepseek-chat");
    });
  });
});

describe("qwenProviderPresets includes mapped P0 presets", () => {
  const names = qwenProviderPresets.map((p) => p.name);

  it("keeps native presets: Coding Plan, 百炼, 自定义配置", () => {
    expect(names).toContain("Coding Plan");
    expect(names).toContain("百炼");
    expect(names).toContain("自定义配置");
  });

  it("includes P0 mapped presets from OpenCode", () => {
    expect(names).toContain("DeepSeek");
    expect(names).toContain("Zhipu GLM");
    expect(names).toContain("Kimi k2.5");
    expect(names).toContain("Kimi For Coding");
    expect(names).toContain("MiniMax");
    expect(names).toContain("DouBaoSeed");
  });

  it("each mapped preset has valid settingsConfig (modelProviders + env + security + model)", () => {
    const mapped = qwenProviderPresets.filter(
      (p) =>
        !["Coding Plan", "百炼", "自定义配置"].includes(p.name),
    );
    for (const p of mapped) {
      const c = p.settingsConfig as any;
      expect(c).toHaveProperty("modelProviders");
      expect(c).toHaveProperty("env");
      expect(c).toHaveProperty("security");
      expect(c.security?.auth).toHaveProperty("selectedType");
      expect(c).toHaveProperty("model");
      expect(c.model).toHaveProperty("name");
    }
  });
});
