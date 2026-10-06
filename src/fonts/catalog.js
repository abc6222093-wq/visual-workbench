// 本地常用字体库的固定清单（第 13 轮，docs/round13-contract.md §9、docs/format.md §19）。
// 只从官方开源发布处下载：站酷小薇取 google/fonts 仓库；思源宋体 / 黑体取 adobe-fonts 仓库 release 分支的
// 可变字体按语言子集版（Variable/OTF/Subset）。简体中文在 Adobe 仓库里叫 CN（SourceHan*CN-VF.otf），没有 SC 命名的文件。
// bytes 是 2026-10-06 用 HEAD 请求核实到的 Content-Length（仅供参考；安装时以服务器实际返回为准）。

const RAW_GOOGLE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolxiaowei';
const RAW_SERIF = 'https://raw.githubusercontent.com/adobe-fonts/source-han-serif/release';
const RAW_SANS = 'https://raw.githubusercontent.com/adobe-fonts/source-han-sans/release';
const OFL = 'https://openfontlicense.org/open-font-license-official-text/';

const face = (file, url, bytes, extra = {}) => ({ file, url, weight: 'variable', style: 'normal', format: 'opentype', bytes, ...extra });
const licenseFile = (file, url, bytes) => ({ file, url, kind: 'license', bytes });

export const FONT_CATALOG = Object.freeze([
  {
    key: 'zcool-xiaowei',
    family: 'ZCOOL XiaoWei',
    aliases: ['ZCOOL XiaoWei', 'ZCOOLXiaoWei', 'ZCOOL-XiaoWei', 'ZCOOL XiaoWei Regular', 'ZCOOLXiaoWei-Regular', '站酷小薇', '站酷小薇体'],
    files: [
      face('ZCOOLXiaoWei-Regular.ttf', `${RAW_GOOGLE}/ZCOOLXiaoWei-Regular.ttf`, 6313808, { weight: 400, format: 'truetype' }),
      licenseFile('OFL.txt', `${RAW_GOOGLE}/OFL.txt`, 4400),
    ],
    license: { name: 'OFL-1.1', url: OFL, file: 'OFL.txt' },
  },
  {
    key: 'source-han-serif-sc',
    family: 'Source Han Serif SC',
    aliases: ['Source Han Serif SC', 'SourceHanSerifSC', 'Source-Han-Serif-SC', 'Source Han Serif CN', 'SourceHanSerifCN', 'Source Han Serif SC VF', 'Source Han Serif CN VF',
      'Noto Serif CJK SC', 'NotoSerifCJKSC', 'Noto Serif CJK', 'Noto Serif SC', 'NotoSerifSC', 'Source Han Serif', 'SourceHanSerif', '思源宋体', '思源宋体 SC', '思源宋体 CN', '思源宋体 简体'],
    files: [
      face('SourceHanSerifCN-VF.otf', `${RAW_SERIF}/Variable/OTF/Subset/SourceHanSerifCN-VF.otf`, 22613144),
      licenseFile('LICENSE.txt', `${RAW_SERIF}/LICENSE.txt`, 4463),
    ],
    license: { name: 'OFL-1.1', url: OFL, file: 'LICENSE.txt' },
  },
  {
    key: 'source-han-serif-jp',
    family: 'Source Han Serif JP',
    aliases: ['Source Han Serif JP', 'SourceHanSerifJP', 'Source-Han-Serif-JP', 'Source Han Serif JP VF', 'Noto Serif CJK JP', 'NotoSerifCJKJP', 'Noto Serif JP', 'NotoSerifJP',
      '思源宋体 日文', '思源宋体 JP', '源ノ明朝'],
    files: [
      face('SourceHanSerifJP-VF.otf', `${RAW_SERIF}/Variable/OTF/Subset/SourceHanSerifJP-VF.otf`, 11951108),
      licenseFile('LICENSE.txt', `${RAW_SERIF}/LICENSE.txt`, 4463),
    ],
    license: { name: 'OFL-1.1', url: OFL, file: 'LICENSE.txt' },
  },
  {
    key: 'source-han-sans-sc',
    family: 'Source Han Sans SC',
    aliases: ['Source Han Sans SC', 'SourceHanSansSC', 'Source-Han-Sans-SC', 'Source Han Sans CN', 'SourceHanSansCN', 'Source Han Sans SC VF', 'Source Han Sans CN VF',
      'Noto Sans CJK SC', 'NotoSansCJKSC', 'Noto Sans CJK', 'Noto Sans SC', 'NotoSansSC', 'Source Han Sans', 'SourceHanSans', '思源黑体', '思源黑体 SC', '思源黑体 CN', '思源黑体 简体'],
    files: [
      face('SourceHanSansCN-VF.otf', `${RAW_SANS}/Variable/OTF/Subset/SourceHanSansCN-VF.otf`, 15636088),
      licenseFile('LICENSE.txt', `${RAW_SANS}/LICENSE.txt`, 4463),
    ],
    license: { name: 'OFL-1.1', url: OFL, file: 'LICENSE.txt' },
  },
  {
    key: 'source-han-sans-jp',
    family: 'Source Han Sans JP',
    aliases: ['Source Han Sans JP', 'SourceHanSansJP', 'Source-Han-Sans-JP', 'Source Han Sans JP VF', 'Noto Sans CJK JP', 'NotoSansCJKJP', 'Noto Sans JP', 'NotoSansJP',
      '思源黑体 日文', '思源黑体 JP', '源ノ角ゴシック'],
    files: [
      face('SourceHanSansJP-VF.otf', `${RAW_SANS}/Variable/OTF/Subset/SourceHanSansJP-VF.otf`, 8423476),
      licenseFile('LICENSE.txt', `${RAW_SANS}/LICENSE.txt`, 4463),
    ],
    license: { name: 'OFL-1.1', url: OFL, file: 'LICENSE.txt' },
  },
]);

export const catalogEntry = key => FONT_CATALOG.find(entry => entry.key === key) || null;
/** 字体文件（不含许可证） */
export const fontFaces = entry => (entry?.files || []).filter(file => file.kind !== 'license');
