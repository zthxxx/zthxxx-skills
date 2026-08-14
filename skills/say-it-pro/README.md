# say-it-pro

给 Coding Agent 用的中文工作写作风格规范。装上以后，Agent 写文档、方案、commit/PR 描述、群消息、聊天回复时会照着这套规范组织内容，产出读起来像一个有品味的人在把事讲清楚，而非一眼能看出的 AI 味


## 安装

```bash
npx skills add zthxxx/zthxxx-skills --skill say-it-pro
```


## 怎么用

装上即生效，无需手动调用。Agent 在写「给人看的内容」时会自动加载本 skill：对话回复、方案文档、仓库 docs、PR/MR 描述、commit message、群消息都在覆盖范围内

也可以在项目或全局 `AGENTS.md` `CLAUDE.md` 里显式声明，让每次会话都遵循：

```markdown
- follow `say-it-pro` skill for responses to the user or write some docs.
```

## 有什么效果

规范管四层东西：

1. **内容取舍** — 正文只写读者需要的方案、结论、边界、待确认项；删掉「按你的要求」「我已调整」这类过程话和元叙述
2. **结构与排版** — 对话回复答案先行，长文档背景先行；段落短、有空行呼吸；列表和表格只在内容确实并列时用
3. **用词与标点** — 技术名词保持英文、中英混排加空格、中文里用半角括号、段末不加句号；细节 follow [中文文案排版指北](https://github.com/mzlogin/chinese-copywriting-guidelines)
4. **去 AI 味** — 一份具体的禁用清单：互联网黑话 (接住、钉死)、认证式夸奖 (「你问到了问题的核心」)、「不是…，而是…」、推销式助手腔 (「要不要我顺手帮你」)，每项都给了替换写法

效果对比一眼可见：

| 默认输出 | 遵循规范后 |
|---------|-----------|
| 我已经按你的要求完成了修改，这不仅提升了代码质量，更是从根本上解决了问题！ | 登录已支持 magic link，`npm run dev` 后打开 `/login` 可试 |
| 这个方案能够赋能团队、形成闭环、显著降本增效 | 这个方案把发布审批从 3 步减到 1 步，每次发布省约 20 分钟 |

完整规则见 [SKILL.md](./SKILL.md)
