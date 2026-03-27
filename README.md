# ⚔ 名字竞技场 · Name Arena in D&D

> 输入一个名字，铸就一个命运。
> Enter a name. Forge a destiny.

A web game that converts any name into a full D&D 5e character and pits them against each other in auto-battle combat. The same name always generates the same character. The same matchup always plays the same battle.

---

## 玩法 · How to Play

### 1v1 决斗 · Duel
1. 输入两个名字（中文或英文均可）
2. 点击「决斗！」
3. 观看 D&D 风格的全自动战斗，带骰子动画和战斗日志
4. 复制结果分享给朋友

### 角色卡 · Character Sheet
1. 输入任意名字
2. 查看完整的 D&D 角色卡（6 属性、职业、技能、装备）
3. 复制文字分享

---

## 核心机制 · Core Mechanics

### 名字 → 角色

每个名字通过 **FNV-1a 哈希算法**转换为一个确定性随机种子，再用 **xorshift128 PRNG** 产出：

- **6 项属性**（STR/DEX/CON/INT/WIS/CHA）：D&D 标准"4d6取高三"，总点数归一化到 65–82
- **12 种职业**：根据最高属性组合自动分配
- **派生属性**：HP、AC、攻击加值、法术DC 按 D&D 5e 规则计算（固定 5 级）
- **标志性技能**：每职业 2–3 个特色技能
- **专属称号**：如"不屈的铁骑士"

### 12 职业 · 12 Classes

| 职业 | 主属性 | 特色技能 |
|------|--------|---------|
| ⚔ 战士 Fighter | STR | 动作如潮、再振旗鼓 |
| 🪓 野蛮人 Barbarian | STR | 狂暴、鲁莽攻击 |
| 🗡 游荡者 Rogue | DEX | 偷袭(3d6)、灵敏闪避 |
| 🛡 圣骑士 Paladin | STR/CHA | 神圣惩击(2d8)、圣疗之手 |
| 🏹 游侠 Ranger | DEX/WIS | 猎人印记、斩巨术 |
| 👊 武僧 Monk | DEX/WIS | 疾风连击、震慑打击 |
| 🔮 法师 Wizard | INT | 火球术(8d6)、护盾术 |
| ✝ 牧师 Cleric | WIS | 灵体卫士、治疗之语 |
| 💫 术士 Sorcerer | CHA | 七彩法球(3d8)、孪生法术 |
| 👁 邪术师 Warlock | CHA | 魔能爆(×2束)、妖火诅咒 |
| 🎵 吟游诗人 Bard | CHA | 恶毒嘲讽、讥讽之词 |
| 🌿 德鲁伊 Druid | WIS | 召唤闪电(3d10)、野性变身 |

### D&D 战斗系统

- **先攻**：d20 + DEX 修正决定行动顺序
- **攻击**：d20 + 攻击加值 vs 目标 AC
- **暴击**：自然 20 → 伤害骰双倍
- **豁免**：d20 + 属性修正 vs 法术 DC
- **战斗确定性**：同一对名字的战斗结果永远相同（种子 = hash(n1+"|vs|"+n2)）
- **最多 20 回合**，超时以 HP% 判胜

---

## 主题皮肤 · Themes

3 套主题 × 明/暗模式 = **6 种外观**，点击右上角 ⚙ 切换：

| 主题 | 风格 |
|------|------|
| PHB Classic | D&D 玩家手册经典：羊皮纸 + 栗红 + 金色 |
| Arcane Scholar | 学院风：冷灰白 + 深蓝，可读性最高 |
| Dragon & Flame | 龙与烈焰：暖白 + 深红 + 火金渐变 |

---

## 技术栈 · Tech Stack

- **单 HTML 文件**，无框架、无构建工具、无外部依赖
- 纯 Vanilla JS（ES6+）
- CSS 自定义属性主题系统（`data-theme` × `data-mode`）
- Google Fonts: Cinzel / Cinzel Decorative / Crimson Text / Noto Serif SC / JetBrains Mono
- URL hash 路由（`#duel=张伟,李明` 可直接分享对战链接）
- localStorage 持久化语言/主题/明暗偏好

---

## 本地运行 · Run Locally

无需任何安装，直接用浏览器打开 `index.html`：

```bash
git clone https://github.com/Isabelle20070607/Name_Arena_in_DND.git
# 用浏览器打开 Name_Arena_in_DND/index.html
```

---

## 后续计划 · Roadmap

- [ ] 🏆 锦标赛模式（淘汰赛括号图）
- [ ] 💀 Boss Rush 模式（预设 Boss 逐级挑战）
- [ ] 🔊 Web Audio API 音效
- [ ] 📸 角色卡截图导出

---

*D&D 5e 规则体系由 Wizards of the Coast 创作，本项目为非商业同人作品。*
*Built with ❤️ and many d20 rolls.*
