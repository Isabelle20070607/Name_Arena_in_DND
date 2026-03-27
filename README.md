# ⚔ 名字竞技场 · Name Arena in D&D

> 输入一个名字，铸就一个命运。
> Enter a name. Forge a destiny.

**[▶ 立即游玩 · Play Now](https://isabelle20070607.github.io/Name_Arena_in_DND/)**

将任意名字转化为完整的 D&D 5e 角色，然后让他们互相对战。同一名字永远生成同一角色，同一对阵永远重演同一战斗。

Convert any name into a full D&D 5e character and watch them fight. Same name, same character. Same matchup, same battle.

---

## 游戏模式 · Modes

### ⚔ 1v1 决斗 · Duel
输入两个名字，观看 D&D 风格的全自动战斗。带战斗日志逐条动画、HP 血条实时同步、骰子音效、暴击特效。战斗时角色卡自动滑入屏幕两侧，形成对峙感。

Enter two names and watch an auto-battle unfold with an animated log, synced HP bars, and dice sound effects. Character cards slide to the sides of the screen during combat for a face-off feel.

### 📜 角色卡 · Character Sheet
输入任意名字，查看完整的 D&D 角色卡：6 项属性、职业、子职业、技能说明、装备列表、D&D 阵营。

Enter any name to view a full character sheet with stats, class, subclass, skills, equipment, and alignment.

### 🏆 锦标赛 · Tournament
输入 4–16 名参赛者，自动生成单败淘汰赛括号，逐场对战，决出冠军。

Enter 4–16 names for a single-elimination bracket tournament.

### 💀 Boss 挑战 · Boss Rush
用自己的名字挑战 5 位预设 Boss，全程 HP 不恢复（仅在场间小幅回血），逐关递进。

Challenge 5 preset bosses with a fixed character. HP carries over between fights (partial restore only).

### ⚔⚔ 大混战 · Grand Melee
输入任意数量参赛者（至少 3 人），最后存活者获胜。每回合概率化选择攻击目标，权重综合考量：
- 目标剩余 HP 和 AC（越好打越可能被选）
- 仇恨：上回合攻击过自己的目标权重 +14
- 动量：正在追击的目标权重 +6
- 阵营：守序角色放大理性选择；混乱角色引入随机噪声；善良角色对未攻击自己的目标权重 × 0.25

Enter any number of fighters (3+). The last one standing wins. Target selection is probabilistic, weighted by success chance, aggro, momentum, and alignment.

---

## 核心机制 · Core Mechanics

### 名字 → 角色

每个名字通过 **FNV-1a** 哈希算法生成一个 32 位种子，再由 **xorshift128 PRNG** 确定性地产出：

| 属性 | 生成方式 |
|------|---------|
| 6 项能力值 | 4d6 取最高 3 个，总点数归一化到 65–82 |
| 职业 | 按最高属性组合自动分配（12 职业） |
| 子职业 | 每职业 3 个子职业，由名字哈希决定 |
| D&D 阵营 | 善良轴 + 守序轴各 0–8，映射到 9 阵营 |
| HP / AC / 攻击 / 法术 DC | D&D 5e 规则，固定 5 级 |
| 专属称号 | 如「不屈的铁骑士」 |

### 12 职业 · 36 子职业

| 职业 | 子职业 |
|------|--------|
| ⚔ 战士 Fighter | 战争领主 / 战斗大师 / 符文骑士 |
| 🪓 野蛮人 Barbarian | 猛虎之路 / 狂暴领主 / 祖灵卫士 |
| 🗡 游荡者 Rogue | 刺客 / 奥术骗徒 / 幽影 |
| 🛡 圣骑士 Paladin | 虔诚誓言 / 复仇誓言 / 古老誓言 |
| 🏹 游侠 Ranger | 野兽领主 / 猎人 / 暗影潜行者 |
| 👊 武僧 Monk | 开手之道 / 四元素之道 / 影之道 |
| 🔮 法师 Wizard | 变化学派 / 咒法学派 / 死灵学派 |
| ✝ 牧师 Cleric | 生命领域 / 光明领域 / 战争领域 |
| 💫 术士 Sorcerer | 龙裔血统 / 狂野魔法 / 神圣灵魂 |
| 👁 邪术师 Warlock | 古神之约 / 魔鬼之约 / 地精君主 |
| 🎵 吟游诗人 Bard | 英勇学院 / 魅惑学院 / 宝剑学院 |
| 🌿 德鲁伊 Druid | 大地圣环 / 月亮圣环 / 星辰圣环 |

### D&D 阵营系统 · Alignment

9 种阵营由名字哈希确定，**真实影响战斗逻辑**：

| 阵营 | 行为 |
|------|------|
| 守序（Lawful） | 优先选择稳定可靠的技能，目标选择更理性 |
| 混乱（Chaotic） | 偏好高风险高回报技能，目标选择有随机噪声 |
| 善良（Good） | 不愿攻击未挑衅自己的角色（-3 技能优先级） |
| 邪恶（Evil） | 无社交约束，纯效益导向 |

### 战斗系统

- **先攻**：d20 + DEX 修正决定行动顺序
- **攻击**：d20 + 攻击加值 vs 目标 AC；自然 20 = 暴击（伤害骰翻倍）
- **豁免**：d20 + 属性修正 vs 法术 DC
- **临时 HP**：先于本体 HP 扣除，血条显示为金色区段
- **战斗确定性**：同一对名字的战斗结果永远相同（种子 = hash(n1 + "|vs|" + n2)）
- **最多 20 回合**，超时以 HP 百分比判胜

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

- **单 HTML 文件**（~4000 行），无框架、无构建工具、无外部依赖
- 纯 Vanilla JS（ES6+）
- CSS 自定义属性主题系统（`data-theme` × `data-mode`）
- FNV-1a + xorshift128 确定性 PRNG
- Web Audio API 音效（攻击、暴击、治疗、胜利、死亡）
- URL hash 路由（`#duel=张伟,李明` 可直接分享对战链接）
- localStorage 持久化语言 / 主题 / 明暗偏好
- GitHub Pages 静态托管

---

## 本地运行 · Run Locally

无需任何安装，直接用浏览器打开 `index.html`：

```bash
git clone https://github.com/Isabelle20070607/Name_Arena_in_DND.git
# 用浏览器打开 Name_Arena_in_DND/index.html
```

---

*D&D 5e 规则体系由 Wizards of the Coast 创作，本项目为非商业同人作品。*
*Built with ❤️ and many d20 rolls.*
