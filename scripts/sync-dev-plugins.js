#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PLUGINS = ['mcp-bridge'];
const FILES = ['manifest.json', 'plugin.js', 'index.html', 'icon.svg', 'package.json'];

const repoRoot = path.resolve(__dirname, '..');
const pluginsSource = path.resolve(repoRoot, '..', 'productivity-plugins', 'plugins');
const pluginsDest = path.join(repoRoot, 'packages', 'plugin-dev');

if (!fs.existsSync(pluginsSource)) {
  console.error(`Source not found: ${pluginsSource}`);
  console.error('Clone productivity-plugins as a sibling directory first.');
  process.exit(1);
}

let copied = 0;
for (const name of PLUGINS) {
  const src = path.join(pluginsSource, name);
  const dest = path.join(pluginsDest, name);

  if (!fs.existsSync(src)) {
    console.warn(`  skip ${name} (not found in source)`);
    continue;
  }

  fs.mkdirSync(dest, { recursive: true });

  for (const file of FILES) {
    const srcFile = path.join(src, file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(dest, file));
      copied++;
    }
  }
  console.log(`  synced ${name}`);
}

console.log(`Done — ${copied} files copied to packages/plugin-dev/`);
