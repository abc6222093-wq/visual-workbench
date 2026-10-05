// 导出前的校验：与 npm run validate 相同，只是修改单「对不上」（STALE_EDIT）不挡导出——
// 工作台显示时本来就跳过这些条目（docs/format.md §7），放映、图片、交接包照样按「页面 + 能对上的修改」出。
import { validateProjectData } from '../validate.js';

/** 返回 { stale: [错误…] }；有其他错误时抛出中文说明。 */
export function checkForExport(project, projectDir, hint = '先修好再导出') {
  const result = validateProjectData(project, { projectDir });
  const errors = (result.errors || []).filter(error => error.code !== 'STALE_EDIT');
  if (errors.length) throw new Error(`项目没通过校验，${hint}：\n${errors.map(error => `  ${error.path}: ${error.message}`).join('\n')}`);
  return { stale: (result.errors || []).filter(error => error.code === 'STALE_EDIT') };
}
