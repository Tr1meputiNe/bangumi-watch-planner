# 番剧规划器 · 视觉重设计

来源：ConardLi/garden-skills 的 web-design-engineer（安装于 ~/.codex/skills/web-design-engineer）。
用户选择：保留粉色和动漫感，把排版、卡片和细节做精致。

## Design Read
- Artifact：真实 React 番剧片库和观看进度应用，不是营销展示页。
- Audience：维护大量追番、待补条目的个人用户，桌面和手机使用。
- Visual language：克制的樱色动漫编辑式界面，封面承载内容，细线和排版承载结构。
- Mode：Redesign · Preserve。
- Dials：视觉变化4、动效3、信息密度6、真实素材依赖8、品牌保真9。
- 变化作用：稳定导航与网格，增加更精细的内容层级；只用反馈型短动效；首屏有可用观看入口；使用真实条目封面；保留樱色、原字体和分集状态颜色。

## Positioning
- 页面角色：日常工具的工作页。今日页是快速继续入口，补番页是可浏览和检索的片库。
- 阅读距离：手机近距离和桌面显示器，正文14–16px、主标题28–32px、触控44px。
- 温度：温暖、有动漫气息、轻松，不表现成任务督办看板。
- 容量：长番名可自然换行；按钮区独立布局并底对齐；内容密集时渐进展开。

## Design Decisions
- Anchor：自定义，沿用项目 design.md、tokens.css 和 assets/readme/today.png 的现有品牌。
- Palette：主色 #b94669、强调文字 #96314f、樱色表面 #fff2f5、辅助蓝 #356aa7；纸色和深色表面继续使用现有语义 tokens。
- Typography：Bricolage Grotesque + Noto Sans SC；正文400–500、主要标题600–700，减少全页粗体。
- Spacing：4px基础，控件内部8/12px、卡片16/20px、区块24/32px。
- Radius：卡片8px、控件7px；仅小状态/数字允许胶囊，不添加混乱形状。
- Shadow：平时弱边框，仅浮层/按键细微阴影，不堆叠大面积悬浮卡片。
- Motion：140–220ms，hover/press/focus和内容切换；遵守 reduced-motion。

## Preserve / Improve / Remove
- 保留：粉色和动漫感、真实动画封面、原品牌标记和图标、浅/深色支持、7页导航与原记录规则。
- 改进：标题层级、卡片内留白、等高按钮区、工具栏基线、长标题和手机溢出。
- 删除：已取消的补番每日任务/七天/完成日期；批量补记；与当前操作无关的装饰性指标。
- Protected contracts：Bangumi授权与API、所有既有收藏/进度数据、原分集格点击行为、错误恢复和键盘可访问性。
- Highest risk：视觉漂移；先用独立可点击v0确认，再应用到全部真实页面。
- Rollback：原 styles.css 已恢复至任务开始前版本（含用户原有未提交修改）；v0 独立不覆盖生产页面。

## Assets
- Logo/wordmark：沿用应用既有 ListVideo 图标及 Bangumi Watch Planner 文本，不另造第三方品牌。
- 真实参考截图：assets/readme/today.png。
- 动画封面：只读本地 subjects 缓存的公开条目图像URL；预览只抽取8部，不读授权/令牌，不写真实收藏。
- 预览数据：.omx/design-sample.json；预览中明确标记为设计预览，仅作为版式样例。

## 用户补充
- 尽量不出弹窗；集数在卡片下方原位展开和收起，使用短动效，不增加模态遮罩。帮我挑的候选也直接在页面中展示。

- 文案保持简洁：只留番名、进度、必要操作与空/错状态；去掉口号和重复说明。

- 保留原分集格外观：未看为白/透明底，已看为粉色；取消所有新增的「记录第N集看过」快捷按钮，直接点格子记录。
