# Tasks

## 1. 在 FeishuBitableSetupApi 中新增两个方法
- [x] `lookupUserByMobile(mobile: string): Promise<string>` — 调用 `/contact/v3/users/batch_get_id` 返回 `open_id`
- [x] `transferOwnership(appToken: string, openId: string): Promise<void>` — 调用 `/drive/v1/permissions/{appToken}/members/transfer_owner?type=bitable`

**文件**: `src/adapters/tracker/feishu-bitable/setup-api.ts`

## 2. 修改 stepTracker() 增加所有权转让环节
- [x] 在创建表成功后、状态配置之前，插入手机号输入提示
- [x] 调用 `lookupUserByMobile` 查询用户 open_id
- [x] 调用 `transferOwnership` 转让所有权
- [x] 处理错误情况（查询失败、转让失败），允许跳过

**文件**: `src/commands/init.ts` — `stepTracker()` 函数

## 3. 更新测试
- [x] 为 `lookupUserByMobile` 添加测试（成功 / 用户不存在 / API 错误）
- [x] 为 `transferOwnership` 添加测试（成功 / 权限不足 / API 错误）

**文件**: `src/adapters/tracker/feishu-bitable/setup-api.test.ts`

## 4. 更新 init-wizard spec
- [x] 将 `openspec/changes/bitable-ownership-transfer/spec-update.md` 的内容合并到 `openspec/specs/init-wizard/spec.md`

**文件**: `openspec/specs/init-wizard/spec.md`

## 5. 前置条件：飞书开放平台权限配置
- [x] 在飞书开放平台应用管理中，为应用开通 `contact:user.id:readonly` 权限
- [x] 文档中补充说明：使用 init 向导需要此权限
