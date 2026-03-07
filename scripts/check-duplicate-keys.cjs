#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function findDuplicateKeysInRawJson(jsonStr, results = []) {
  const lines = jsonStr.split("\n");
  const stack = [{ key: "root", indent: -1, parentKeys: [] }];

  lines.forEach((line, lineNum) => {
    const match = line.match(/^(\s*)"([^"]+)":\s*\{/);
    if (match) {
      const indent = match[1].length;
      const key = match[2];

      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const parentKeys = stack.map((s) => s.key);
      const fullPath = parentKeys.join(".");
      const currentPath = fullPath ? `${fullPath}.${key}` : key;
      const parentKey = parentKeys[parentKeys.length - 1];

      results.push({
        line: lineNum + 1,
        key: key,
        path: currentPath,
        parentKey: parentKey,
      });

      stack.push({ key, indent, parentKeys });
    }
  });

  return results;
}

function findSameLevelDuplicates(entries) {
  const seen = new Map();
  const duplicates = [];

  entries.forEach((entry) => {
    // 使用完整路径（去掉 root）作为唯一键，精确检测真正的重复
    const pathWithoutRoot = entry.path.replace(/^root\./, "");
    const lookupKey = pathWithoutRoot;

    if (seen.has(lookupKey)) {
      const first = seen.get(lookupKey);
      duplicates.push({
        key: entry.key,
        parentKey: entry.parentKey,
        fullPath: pathWithoutRoot,
        firstLine: first.line,
        secondLine: entry.line,
        path: entry.path,
      });
    } else {
      seen.set(lookupKey, { line: entry.line, path: entry.path });
    }
  });

  return duplicates;
}

function checkJsonFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const entries = findDuplicateKeysInRawJson(content);
  const duplicates = findSameLevelDuplicates(entries);

  if (duplicates.length > 0) {
    console.log(`\n=== ${path.basename(filePath)} ===`);
    duplicates.forEach((dup) => {
      console.log(`  "${dup.key}" 在父级 "${dup.parentKey}" 下重复:`);
      console.log(
        `    行 ${dup.firstLine}: ${entries.find((e) => e.line === dup.firstLine)?.path}`,
      );
      console.log(`    行 ${dup.secondLine}: ${dup.path}`);
    });
    return false;
  } else {
    console.log(`✓ ${path.basename(filePath)}: 无重复键`);
    return true;
  }
}

const localesDir = path.join(__dirname, "..", "src", "i18n", "locales");
const files = fs.readdirSync(localesDir).filter((f) => f.endsWith(".json"));

let allPassed = true;
files.forEach((file) => {
  const filePath = path.join(localesDir, file);
  if (!checkJsonFile(filePath)) {
    allPassed = false;
  }
});

console.log("\n" + "=".repeat(50));
process.exit(allPassed ? 0 : 1);
