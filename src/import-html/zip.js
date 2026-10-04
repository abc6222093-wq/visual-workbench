// 解 .zip（不加依赖）：读中央目录拿到每个文件的大小和本地文件头位置，再按本地文件头取数据；只支持「存储」和「deflate」。
import { inflateRawSync } from 'node:zlib';

const fail = message => Object.assign(new Error(message), { status: 400 });

/** 返回 [{ path, data }]，跳过文件夹、__MACOSX/ 和 .DS_Store；路径不安全（../、绝对路径）的直接报错。 */
export function unzip(buf, { maxTotal = 400_000_000 } = {}) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw fail('这个 .zip 文件损坏或不是 zip 格式');
  const count = buf.readUInt16LE(eocd + 10), cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw fail('不支持 ZIP64 格式的压缩包，请换成普通 zip 或直接选择文件夹');
  const out = []; let pos = cdOffset, total = 0;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw fail('这个 .zip 文件的目录损坏');
    const flags = buf.readUInt16LE(pos + 8), method = buf.readUInt16LE(pos + 10), size = buf.readUInt32LE(pos + 20), raw = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28), extraLen = buf.readUInt16LE(pos + 30), commentLen = buf.readUInt16LE(pos + 32), local = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    pos += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || /(^|\/)__MACOSX\//.test(name) || /(^|\/)\.DS_Store$/.test(name)) continue;
    if (flags & 1) throw fail('压缩包加了密码，不能导入');
    if (buf.readUInt32LE(local) !== 0x04034b50) throw fail('这个 .zip 文件的数据损坏');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const chunk = buf.subarray(start, start + size);
    total += raw; if (total > maxTotal) throw fail('压缩包解开后太大（超过 400 MB）');
    let data;
    if (method === 0) data = Buffer.from(chunk);
    else if (method === 8) data = inflateRawSync(chunk);
    else throw fail(`压缩包里的「${name}」用了不支持的压缩方式，请重新用系统自带的压缩打包`);
    out.push({ path: name, data });
  }
  return out;
}
