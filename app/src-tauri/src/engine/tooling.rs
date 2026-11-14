//! Tool schemas exposed to the model.
//!
//! Keep definitions separate from execution and permission policy.

use serde_json::{json, Value};

pub fn tool_definitions(run_mode: &str, mode: &str) -> Value {
    let mode_profile = crate::engine::modes::profile(mode);
    let mut tools = vec![
        json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "读取工作区里一个文件的完整内容。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "相对工作区的文件路径"}
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "list_dir",
                "description": "列出工作区里某个目录下的文件与子目录。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "相对工作区的目录路径，留空表示根目录"}
                    }
                }
            }
        }),
    ];
    if run_mode == "plan" {
        return Value::Array(tools);
    }
    tools.push(json!({
        "type": "function",
        "function": {
            "name": "write_file",
            "description": if mode_profile.is_code {
                "向工作区写入/覆盖一个文件。用于改代码。"
            } else {
                "向工作区写入/覆盖一个办公文档（Markdown/纯文本等）。"
            },
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对工作区的文件路径"},
                    "content": {"type": "string", "description": "要写入的完整内容"}
                },
                "required": ["path", "content"]
            }
        }
    }));
    tools.push(json!({
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": "对工作区文件做精确替换：把 old_string 替换成 new_string。适合改代码中的一小段，不要用它重写整个文件。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对工作区的文件路径"},
                    "old_string": {"type": "string", "description": "要替换的原文，必须足够精确"},
                    "new_string": {"type": "string", "description": "替换后的文本"},
                    "replace_all": {"type": "boolean", "description": "是否替换全部匹配；默认 false，多处匹配会拒绝"}
                },
                "required": ["path", "old_string", "new_string"]
            }
        }
    }));
    if mode_profile.can_run_shell {
        tools.push(json!({
            "type": "function",
            "function": {
                "name": "run_shell",
                "description": "在工作区目录下执行一条命令并返回输出。用于跑测试、看构建结果。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "要执行的命令"}
                    },
                    "required": ["command"]
                }
            }
        }));
        tools.push(json!({
            "type": "function",
            "function": {
                "name": "open_browser",
                "description": "在应用内置浏览器里打开一个网址（本地 dev server 或外网页面），不用跳系统浏览器。用于起服务后在应用内查看页面、确认效果。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "要打开的网址，如 http://localhost:3000 或 https://example.com"}
                    },
                    "required": ["url"]
                }
            }
        }));
        tools.push(json!({
            "type": "function",
            "function": {
                "name": "read_terminal",
                "description": "读取当前对话终端（Inspector 终端页签）最近的输出。用于构建挂了、服务起不来时看终端里的报错找原因。",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        }));
    }
    Value::Array(tools)
}

