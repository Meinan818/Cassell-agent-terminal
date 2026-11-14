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
pub mod policy;
pub mod tooling;
