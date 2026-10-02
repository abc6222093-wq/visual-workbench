// 极简 PDF 写入器：每页铺满一张 JPEG（/DCTDecode 直接嵌入，不重新压缩）。
// 只用到 PDF 1.4 最基础的结构：Catalog → Pages → Page（MediaBox + 内容流 + 图片 XObject），最后是 xref 和 trailer。

/** 从 JPEG 的 SOF 段读出宽、高和颜色通道数。 */
export function jpegInfo(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('不是 JPEG 图片');
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0..SOF15，排除 DHT(C4)、JPG(C8)、DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] };
    }
    i += 2 + length;
  }
  throw new Error('JPEG 里找不到尺寸信息');
}

const num = value => (Math.round(value * 1000) / 1000).toString();

/**
 * 生成 PDF。pages: [{ jpeg: Buffer, width, height }]，width/height 是 PDF 页面尺寸（单位 pt）。
 * 返回 Buffer。
 */
export function buildPdf(pages) {
  if (!pages.length) throw new Error('PDF 至少需要一页');
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = data => { const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1'); chunks.push(buffer); length += buffer.length; };
  const begin = id => { offsets[id] = length; push(`${id} 0 obj\n`); };
  const end = () => push('\nendobj\n');

  // 第二行的高位字节告诉阅读器这是二进制文件
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  // 编号：1 Catalog，2 Pages，之后每页占 3 个（Page、内容流、图片）
  const pageIds = pages.map((_, index) => 3 + index * 3);
  begin(1); push('<< /Type /Catalog /Pages 2 0 R >>'); end();
  begin(2); push(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`); end();
  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const info = jpegInfo(page.jpeg);
    const colorSpace = info.components === 1 ? '/DeviceGray' : info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    const w = num(page.width), h = num(page.height);
    begin(pageId);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    end();
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    begin(contentId); push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`); end();
    begin(imageId);
    push(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${info.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''} /Length ${page.jpeg.length} >>\nstream\n`);
    push(page.jpeg);
    push('\nendstream');
    end();
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  // 每条 xref 记录必须正好 20 字节（含行尾的空格 + 换行）
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks, length);
}
