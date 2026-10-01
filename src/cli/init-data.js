// 初始化数据目录：npm run init-data [-- --data-dir <路径>]
import { loadConfig } from '../config.js';
import { initDataDir } from '../data-dir.js';

try {
  const { dataDir, source } = loadConfig();
  const { created, existed } = initDataDir(dataDir);
  console.log(`数据目录：${dataDir}（来源：${source}）`);
  for (const p of created) console.log(`  新建  ${p}`);
  for (const p of existed) console.log(`  已存在  ${p}`);
  process.exit(0);
} catch (e) {
  console.error(`出错：${e.message}`);
  process.exit(1);
}
