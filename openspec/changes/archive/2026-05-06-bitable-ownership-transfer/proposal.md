# Bitable Ownership Transfer

## Why

当前 `symphony init` 向导通过机器人身份（tenant_access_token）创建飞书多维表格，导致 Bitable 的所有者是机器人应用，用户本人没有任何权限。用户创建完表格后无法在飞书中查看、编辑或管理这个表格，体验断裂。

## What Changes

在 `symphony init` 向导的 Bitable 创建步骤之后，新增「转让所有权」环节：
1. 询问用户手机号
2. 通过飞书通讯录 API 查询手机号对应的 `open_id`
3. 调用飞书权限转让 API 将 Bitable 所有权转移给用户
4. 转让后机器人保留 `full_access` 权限，确保后续 API 操作不受影响

## Flow

```
symphony init
      │
      ▼
  ① 用户输入 App ID / App Secret（现有）
      │
      ▼
  ② 测试连接 + 创建 Bitable App + 创建表（现有）
      │
      ▼
  ③ 新增：输入手机号
     CLI 提示: "请输入你的手机号（用于转让多维表格所有权）"
     格式: 中国大陆直接输入 11 位，其他国家加区号前缀如 +1-xxx
      │
      ▼
  ④ 新增：通过手机号查询 open_id
     POST /open-apis/contact/v3/users/batch_get_id
     Authorization: Bearer <tenant_access_token>
     Body: { "mobiles": ["13800138000"] }
     → 返回 open_id: "ou_xxx"
      │
      ▼
  ⑤ 新增：转让所有权
     POST /open-apis/drive/v1/permissions/{app_token}/members/transfer_owner?type=bitable
     Authorization: Bearer <tenant_access_token>
     Body: {
       "member_type": "openid",
       "member_id": "ou_xxx"
     }
     默认行为: remove_old_owner=false, old_owner_perm=full_access
     → 机器人保留 full_access，用户成为所有者
      │
      ▼
  ⑥ 继续现有流程（状态配置、Agent、Workspace、模板、存储偏好...）
```

## Capabilities

### Modified Capabilities
- `init-wizard`: 在 Bitable 创建后增加所有权转让步骤，需要用户提供手机号

### New Capabilities
（无 — 这是 init-wizard 功能的增强，不是新能力）

## API Details

### 1. 通过手机号获取用户 ID

```
POST https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id
Authorization: Bearer <tenant_access_token>
Content-Type: application/json

{
  "mobiles": ["13800138000"]
}
```

**权限要求**: `contact:user.id:readonly`（需在飞书开放平台申请）

**响应**:
```json
{
  "code": 0,
  "data": {
    "user_list": [{
      "user_id": "ou_979112345678741d29069abcdef01234",
      "mobile": "13800138000",
      "status": { "is_activated": true }
    }]
  }
}
```

**注意**: 不支持企业邮箱查询（这是选择手机号而非邮箱的原因之一）

### 2. 转移云文档所有者

```
POST https://open.feishu.cn/open-apis/drive/v1/permissions/{app_token}/members/transfer_owner?type=bitable
Authorization: Bearer <tenant_access_token>
Content-Type: application/json

{
  "member_type": "openid",
  "member_id": "ou_xxx"
}
```

**权限要求**: `bitable:app`（已有）或 `docs:permission.member:transfer`

**关键参数**:
- `remove_old_owner`: 默认 `false` — 不移除机器人权限
- `old_owner_perm`: 默认 `full_access` — 机器人保留可管理角色
- `stay_put`: 默认 `false` — 文档移至新所有者空间下

## Scope

- 修改 `FeishuBitableSetupApi`：新增 `lookupUserByMobile()` 和 `transferOwnership()` 方法
- 修改 `stepTracker()`：在创建表之后、配置状态之前，插入转让流程
- 需要用户在飞书开放平台额外开通 `contact:user.id:readonly` 权限
- 手机号输入为可选步骤（用户可跳过，后续手动在飞书中添加权限）

## Out of Scope

- 不涉及 OAuth 用户授权（方案 C，可作为后续增强）
- 不涉及添加协作者（方案 A，转让所有权更彻底）
- 不修改 `FeishuAuth` 或现有的 Bitable CRUD API
