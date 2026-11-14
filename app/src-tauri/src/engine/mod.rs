//! Engine infrastructure shared by the native agent runtime.
//!
//! Keep this module small and boring: run observability and transport
//! resilience do not belong inside the conversation loop.

pub mod journal;
pub mod retry;
pub mod deepseek;
pub mod context;
pub mod edit;
pub mod modes;
pub mod outcome;
pub mod policy;
pub mod process;
pub mod session;
pub mod tooling;
pub mod tool_pipeline;
