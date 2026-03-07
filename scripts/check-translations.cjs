#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const localesDir = path.join(__dirname, "..", "src", "i18n", "locales");

function flattenObject(obj, prefix = "") {
  const result = {};
  for (const key in obj) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (
      typeof obj[key] === "object" &&
      obj[key] !== null &&
      !Array.isArray(obj[key])
    ) {
      Object.assign(result, flattenObject(obj[key], newKey));
    } else {
      result[newKey] = obj[key];
    }
  }
  return result;
}

function findMissingKeys(reference, target) {
  const missing = [];
  for (const key in reference) {
    if (!(key in target)) {
      missing.push({ key, value: reference[key] });
    }
  }
  return missing;
}

function loadLocale(filename) {
  const filepath = path.join(localesDir, filename);
  if (fs.existsSync(filepath)) {
    const content = fs.readFileSync(filepath, "utf8");
    return JSON.parse(content);
  }
  return null;
}

const zh = loadLocale("zh.json");
const en = loadLocale("en.json");
const ja = loadLocale("ja.json");

const zhFlat = flattenObject(zh);
const enFlat = flattenObject(en);
const jaFlat = flattenObject(ja);

const enMissing = findMissingKeys(zhFlat, enFlat);
const jaMissing = findMissingKeys(zhFlat, jaFlat);

console.log("=== 翻译缺失报告 ===\n");

console.log(`中文键数量: ${Object.keys(zhFlat).length}`);
console.log(`英文键数量: ${Object.keys(enFlat).length}`);
console.log(`日文键数量: ${Object.keys(jaFlat).length}\n`);

console.log(`=== 英文缺失 (${enMissing.length} 个) ===`);
if (enMissing.length > 0) {
  enMissing.forEach(({ key, value }) => {
    console.log(`\n"${key}":`);
    console.log(`  zh: ${value}`);
    console.log(`  [TODO: Add English translation]`);
  });
} else {
  console.log("无");
}

console.log(`\n=== 日文缺失 (${jaMissing.length} 个) ===`);
if (jaMissing.length > 0) {
  jaMissing.forEach(({ key, value }) => {
    console.log(`\n"${key}":`);
    console.log(`  zh: ${value}`);
    console.log(`  [TODO: Add Japanese translation]`);
  });
} else {
  console.log("无");
}

if (process.argv.includes("--json")) {
  console.log("\n=== JSON 格式输出 ===\n");
  console.log(JSON.stringify({ en: enMissing, ja: jaMissing }, null, 2));
}
