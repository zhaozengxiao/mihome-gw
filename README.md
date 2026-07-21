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

1. 创建配置目录并写入 options.json:

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

## 配置

| 选项 | 说明 |
|------|------|
| `gateway_ip` | 小米网关的 IP 地址 |
| `gateway_key` | 网关的开发者密钥 (小米网关底部或小米开发平台获取) |
| `mqtt_server` | MQTT 服务器地址 |
| `mqtt_port` | MQTT 端口 (默认 1883) |
| `mqtt_user` | MQTT 用户名 |
| `mqtt_password` | MQTT 密码 |
| `debug` | 是否输出原始报文 (默认 false) |
| `enable_triggers` | 是否启用内置规则引擎 (默认 true) |
| `doorOpenCooldownMs` | 门磁从关闭变为打开后，短时间内忽略人体触发，避免灯被重新点亮 (默认 3000) |
| `rules` | 自定义自动化规则 (可选) |

## 内置自动化规则

默认规则：人体传感器触发 → 开灯 → 10 秒后关灯（受门磁约束）。

可在 options.json 中添加自定义 rules 覆盖默认规则：

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

## 支持的设备

温湿度传感器、门窗磁、人体传感器、无线开关、墙壁开关、插座、窗帘、烟雾报警器、天然气报警器、水浸传感器、门锁、振动传感器、魔方、空调伴侣等。
