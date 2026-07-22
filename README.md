# mihome-gw

Xiaomi Gateway (mihome) 监听代理 — 监听小米网关 UDP 组播 (9898)，通过 MQTT 桥接到 Home Assistant。

## 架构

```
┌─────────────┐    UDP:9898/4321    ┌──────────────┐    MQTT:1883    ┌─────────────────┐
│  Xiaomi GW   │ ◄───────────────►  │  mihome-gw    │ ◄────────────►  │  Home Assistant  │
│  (192.168.x) │   组播 224.0.0.50   │  (Node.js)    │   auto-discovery│  (Mosquitto MQTT)│
└─────────────┘                     └──────────────┘                 └─────────────────┘
                                           │
                                           │ 内置规则引擎
                                           │ (人体传感器→开灯, 门磁→延时关)
                                           ▼
                                      Xiaomi 设备控制
                                      (直接 UDP 指令)
```

## 快速开始

### Docker 部署

1. 创建 `data/options.json`:

```bash
mkdir -p data
cat > data/options.json <<EOF
{
  "gateway_ip": "192.168.50.115",
  "gateway_key": "0D54BEB644174D35",
  "mqtt_user": "mihome",
  "mqtt_password": "mihome123",
  "mqtt_server": "core-mosquitto",
  "mqtt_port": 1883,
  "debug": false,
  "enable_triggers": true
}
EOF
```

2. 启动:

```bash
docker compose up -d
```

### 独立运行

直接创建 `config.json` 并启动:

```bash
node index.js
```

## 配置

### options.json (HA Supervisor / Docker 部署)

`options2config.js` 会在启动时自动将 `data/options.json` 转换为 `config.json`。

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `gateway_ip` | 小米网关的 IP 地址 | - |
| `gateway_key` | 网关的开发者密钥 | - |
| `mqtt_server` | MQTT 服务器地址 | `core-mosquitto` |
| `mqtt_port` | MQTT 端口 | `1883` |
| `mqtt_user` | MQTT 用户名 | - |
| `mqtt_password` | MQTT 密码 | - |
| `debug` | 是否输出原始报文 | `false` |
| `enable_triggers` | 是否启用内置规则引擎 | `true` |
| `doorOpenCooldownMs` | 门磁从关闭变为打开后，短时间内抑制人体触发，避免灯被重新点亮 | `3000` |
| `rules` | 自定义自动化规则 | `[]` |

### config.json (独立运行)

直接使用 `config.json` 时可配置更多选项：

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `port` | 监听端口 | `9898` |
| `bind` | 绑定地址 | `0.0.0.0` |
| `debug` | 是否输出原始报文 | `false` |
| `enable_triggers` | 是否启用内置规则引擎 | `true` |
| `doorOpenCooldownMs` | 门磁开门后抑制窗口(ms) | `3000` |
| `heartbeatTimeout` | 心跳超时触发重连(秒) | `120` |
| `rediscoverInterval` | 设备重发现间隔(秒) | `60` |
| `gateways` | 网关数组 `[{ip, key}]` | - |
| `output` | 输出配置 `{type, url, prefix}` | `{type: 'console'}` |
| `rules` | 自定义自动化规则 | `[]` |

`config.json` 示例：

```json
{
  "port": 9898,
  "bind": "0.0.0.0",
  "debug": false,
  "enable_triggers": true,
  "gateways": [
    { "ip": "192.168.50.115", "key": "0D54BEB644174D35" }
  ],
  "output": {
    "type": "mqtt",
    "url": "mqtt://mihome:mihome123@core-mosquitto:1883",
    "prefix": "mihome/"
  },
  "rules": []
}
```

## 内置自动化规则

默认规则：人体传感器触发 → 开灯 → 10 秒后关灯（受门磁约束）。

可在 `options.json` 或 `config.json` 中添加自定义 `rules` 覆盖默认规则：

```json
{
  "rules": [
    {
      "name": "自定义规则",
      "match": { "sid": "158d000258361c", "attr": "state", "equals": true },
      "target": { "sid": "158d0002b062cd", "attr": "channel_0" },
      "onValue": true,
      "offValue": false,
      "delay": 30,
      "doorGuard": "158d00032b73ec"
    }
  ]
}
```

### 规则字段说明

| 字段 | 必需 | 说明 |
|------|------|------|
| `name` | 否 | 规则名称，用于日志 |
| `match` | 是 | 触发条件：`sid` 设备 ID、`attr` 属性名、`equals` 匹配值 |
| `target` | 是 | 控制目标：`sid` 设备 ID、`attr` 控制的属性名 |
| `onValue` | 是 | 触发时写入的值 |
| `offValue` | 否 | 延时到期后写入的值（需配合 `delay` 使用） |
| `delay` | 否 | 延时秒数，到期后写入 `offValue`。不设置则只执行 `onValue`，不自动关闭 |
| `doorGuard` | 否 | 门磁设备 ID，关联门磁实现"进门开灯、关门保持、开门关灯"逻辑 |
| `condition` | 否 | 前置条件，如 `{ "sid": "158d0002b062cd", "attr": "channel_0", "equals": false }` 仅在灯关闭时才触发 |

## 支持的设备

温湿度传感器、门窗磁、人体传感器、无线开关、墙壁开关、插座、窗帘、烟雾报警器、天然气报警器、水浸传感器、门锁、振动传感器、魔方、空调伴侣等。
