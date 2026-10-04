# 第 8 轮：本机配置测试隔离

迁移后本机配置已存在。旧 config 测试没有注入 home，意外读了真实设置，期望 config、实际 local，连续三次失败。修正只隔离夹具，不修改生产配置或放宽断言。

- test/config.test.js：每个配置用例注入 temporaryHome(t)，测试结束清理；原有来源、路径展开、绝对路径、缺参错误及参数剥离断言全部保留。路径展开的期待值采用注入的临时 home。
- test/helpers/temporary-home.js：mkdtemp 创建用户主目录，test.after/after 清理；不替换 HOME 环境变量。
- test/helpers/isolated-server.js：所有工作台测试服务默认指定独立的临时 configHome；原来明确指定的夹具 home 保持不变。
- test/machine-config.test.js 已对全部配置读写注入临时 home 并在 t.after 清理，审计后未改。
- 两设备设置接口与 UI 测试原本显式使用夹具 home，继续保留；其余服务夹具统一通过隔离入口，避免未来设置操作写入真实主目录。
- CLI 审计：validate/check-motion 不加载本机配置；export 测试显式传 --data-dir，优先级使其不读本机配置；没有测试调用无数据目录覆盖的启动服务或配置写入 CLI。

## 服务夹具改动文件（只换 import，断言全部原样保留）

- test/back-navigation.test.js
- test/drag.test.js
- test/export-ui.test.js
- test/focus-mode.test.js
- test/image-tint.test.js
- test/inspector-style.test.js
- test/motion-check.test.js
- test/motion-integration.test.js
- test/motion-preview.test.js
- test/motion-stage-error.test.js
- test/motion-ui.test.js
- test/outline-acceptance.test.js
- test/outline-server.test.js
- test/outline-ui.test.js
- test/round6-editor.test.js
- test/round6b-sidebar.test.js
- test/server-export.test.js
- test/server-round3.test.js
- test/server.test.js
- test/step-selection-regression.test.js
- test/step-view.test.js
- test/text-style.test.js
- test/two-devices-server.test.js
- test/two-devices-ui.test.js

## 真实配置人工核对（不放入自动测试）

数据目录仍为 `/Users/a/我的云端硬盘/visual-workbench-data`。隔离修改前后 config.json 字节一致，SHA-256 `e096e57030b5b937f96228b1b31bc5fbc8b6aba57c867bda43e47f0b9b0597fb`。仅只读核对，未改真实配置。
