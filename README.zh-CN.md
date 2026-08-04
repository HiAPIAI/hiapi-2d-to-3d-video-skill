<p align="center">
  <img src="./assets/hiapi-animation-forge-cover.webp" alt="HiAPI Animation Forge：从二维动画证据到可绑定三维制作的资产优先管线" width="100%">
</p>

<h1 align="center">HiAPI Animation Forge</h1>

<p align="center">
  将已授权的二维素材规划为分阶段、可审查的三维制作管线。
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

HiAPI Animation Forge 是一个面向 Codex、Claude Code 及其他兼容 Agent Skills 工具的技能。它把二维图片或动画片段转化为有证据支撑的制作计划，覆盖三维资产、绑定、源动作、机位求解、Blender 预览，以及可选的生成式终稿渲染。

它不是“一键把二维视频完美转成三维”的包装。视频模型只能作为可选终稿渲染器，不能被当作确定性的几何、绑定、机位或逐帧动作求解器。

## 功能概览

- 按镜头、主体、道具、场景、接触关系和机位证据分析已授权图片与视频。
- 根据拓扑、可用视角、许可证和硬件条件选择资产优先的重建路线。
- 分别设置多视图补全、几何、绑定、蒙皮、动作求解、机位求解和合成门禁。
- 在昂贵的终稿渲染前，要求先通过确定性的 Blender 预览。
- 使用 source-lock 验收表和明确结果状态，避免把“API 成功”误报为“制作完成”。
- 仅在 fidelity contract 允许时，把候选结果路由到 Seedance 2.0 或 Kling。

## 制作管线

```text
已授权二维素材
  -> 镜头与资产分析
  -> 角色和场景证据
  -> 多视图 / 几何候选
  -> 绑定、蒙皮、材质与层级
  -> 源动作与机位求解
  -> 确定性 Blender 预览
  -> 可选 Seedance 或 Kling 渲染
  -> source-lock 质检
```

本地 planner 只创建制作计划，不会生成网格、绑定、Blender 场景或付费视频任务。

## 保真合约

| 合约 | 适用目标 | 强制行为 |
| --- | --- | --- |
| `frame-exact` | 必须控制每个源事件、姿势、接触、机位运动和帧间关系 | 必须具备确定性分割/跟踪、姿态或深度求解、机位求解、绑定/渲染与合成；否则在报价前返回 `frame_exact_blocked` |
| `source-locked` | 必须保留源视频的事件顺序、时间、构图、走位、接触和道具状态 | 视频输入的默认合约；优先资产管线，Seedance 结果在完整对照前只能标记为 `generated_unreviewed` |
| `appearance-first` | 目标外观比源同步更重要 | 允许从已批准的目标世界图片重新生成动作；使用 Kling 前必须明确承认已放弃源同步 |

合约不会被静默降级。

## 安装

要求：Node.js 18+ 与 Git。

```bash
npx -y github:HiAPIAI/hiapi-2d-to-3d-video-skill -y
```

指定 Agent 或自定义 skills 目录：

```bash
npx -y github:HiAPIAI/hiapi-2d-to-3d-video-skill --codex
npx -y github:HiAPIAI/hiapi-2d-to-3d-video-skill --claude
npx -y github:HiAPIAI/hiapi-2d-to-3d-video-skill --target=/path/to/skills
```

安装器默认保护已有目录。只有确实需要替换时才添加 `--force`。

## 快速开始

在本地规划已授权源素材，不创建资产，也不消耗额度：

```powershell
node scripts/plan-animation-forge.mjs `
  --source-file "D:\media\authorized-shot.mp4" `
  --goal cinematic-video `
  --fidelity source-locked `
  --source-style animation-frame `
  --subject-topology animal `
  --scene-mode dynamic `
  --available-adapter seedance `
  --rights-confirmed
```

只有在实际执行环境、许可证与硬件要求都核查通过后，才能把 adapter 声明为 available。参见[外部适配器](./references/external-adapters.md)和[管线架构](./references/pipeline-architecture.md)。

## 资产优先重建

当交付物是绑定资产、Blender-ready 场景或严格源重建时，使用这条路线：

1. 把源素材拆成镜头和可持续追踪的资产身份。
2. 提取干净证据、蒙版、转面图、环境底板和机位锚点。
3. 生成或重建候选几何，并在绑定前拒绝不可见侧幻觉和拓扑断裂。
4. 明确单位、坐标轴、材质、骨架、蒙皮权重、挂点、源哈希与 adapter 版本。
5. 对照锁定时间线验证绑定形变、接触、道具状态、源动作和机位。
6. 先渲染并验收确定性的 Blender clay preview，再进行任何终稿视频模型消费。

AniGen、DrawingSpinUp、Wonder3D、Zero123、img2threejs、Gaussian Splatting、Mesh2Motion 等均为外部 adapter，不随本仓库安装；使用前必须核查其真实能力与许可证。

## 可选生成式渲染

生成式视频只是候选渲染阶段，不是完成重建的证据。

- **Seedance 2.0 balanced：** 可用于 source-locked 候选，要求恰好一个源视频和一张已批准的完整目标世界图片。使用同组织的 [HiAPI Reference Motion Transfer Skill](https://github.com/HiAPIAI/hiapi-reference-motion-transfer-skill)。
- **Kling appearance-first：** 只有在明确承认“不要求源同步”后才可用。内置 CLI 会执行本地校验、实时定价、批准绑定、提交、轮询和结果打包。
- **Veo 类渲染：** 当前 skill 没有内置可执行 adapter 与请求合约，因此不会提交 Veo 任务。

每个付费任务都必须取得实时价格，并获得对完全相同请求的明确批准。失败后不会自动创建替代付费任务。

## 结果状态

| 状态 | 含义 |
| --- | --- |
| `pipeline_planned` | 只有本地计划，没有创建资产或付费任务 |
| `external_setup_required` | 所需 adapter 不可用或尚未验证 |
| `frame_exact_blocked` | 确定性控制能力不完整 |
| `asset_candidate_unreviewed` | 已有几何或绑定候选，但 artifact QC 未完成 |
| `generated_unreviewed` | 视频生成完成，但源对照未完成 |
| `source_lock_rejected` | 至少一个锁定事实与源素材不一致 |
| `source_lock_passed` | 所有锁定事实均通过正常速度和逐帧复核 |

宣告成功前阅读[输出验收](./references/output.md)，任何付费重试前阅读[故障排查](./references/troubleshooting.md)。

## 安全与权利

只能使用你拥有或获得授权的素材、肖像、Logo、模型、checkpoint、参考内容与音频。不要用本 skill 进行欺骗性冒充，也不要绕过同意和许可证要求。

不能仅凭计划、API 成功响应、接触表或看似可信的样片，就宣称“已生成 3D 资产”“已完成绑定”“完全同步”或“逐帧一致”。

## 开发验证

```bash
npm run check
node scripts/plan-animation-forge.mjs --help
node scripts/hiapi-2d-to-3d-video.mjs --help
node scripts/install.mjs --help
```

## 许可证

[MIT](./LICENSE) © 2026 HiAPIAI
